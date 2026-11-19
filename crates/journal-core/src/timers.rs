//! Activity timers in the database, shared by every window of the app and by J-TerminaL (they lived in one webview's
//! local storage before). One settings row `activity-timers` holds `{ "stamp": n, "timers": { "<date>:<activity>": … } }`;
//! `stamp` grows with every write, so `watch.rs` can tell other programs that the timers changed (timers are not part of
//! the undo history and not of the Drive snapshot: a running clock belongs to this computer).
//!
//! Starting, pausing and stopping are single transactions, so two programs cannot lose each other's timers. Stopping
//! does what the app's timer did: the sessions become calendar entries with the activity's tag (ids derived from the
//! session, so a retried stop updates instead of duplicating), the tag is made or recoloured, the activity is ticked in
//! the period data and remembers its tag, and the timer goes.
use std::collections::BTreeMap;
use chrono::{Local, NaiveDate, TimeZone, Timelike};
use rusqlite::{OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::storage::{CalendarImport, Entry, Result, Store, Tag};

pub const KEY: &str = "activity-timers";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Segment { pub start: i64, pub end: i64 }

/// A timer as the app has always written it (`src/activityTimer.ts`): milliseconds since 1970.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivityTimer {
    pub id: String,
    #[serde(rename = "startedAt")]
    pub started_at: Option<i64>,
    #[serde(rename = "elapsedMs")]
    pub elapsed_ms: i64,
    #[serde(default)]
    pub segments: Vec<Segment>,
    #[serde(rename = "tagId")]
    pub tag_id: String,
}

impl ActivityTimer {
    /// The time recorded, the running part included.
    pub fn elapsed(&self, now: i64) -> i64 { self.elapsed_ms + self.started_at.map_or(0, |started| (now - started).max(0)) }
    pub fn running(&self) -> bool { self.started_at.is_some() }
    /// Paused at `now`: the running part becomes a segment.
    pub fn paused(&self, now: i64) -> ActivityTimer {
        let Some(started) = self.started_at else { return self.clone() };
        let mut timer = ActivityTimer { started_at: None, elapsed_ms: self.elapsed(now), ..self.clone() };
        if now > started { timer.segments.push(Segment { start: started, end: now }); }
        timer
    }
}

/// The key of a timer: the day it was started for and the activity.
pub fn timer_key(date: &str, activity: &str) -> String { format!("{date}:{activity}") }

/// What stopping needs to know of the activity (from the period data's definition).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimerActivity { pub id: String, pub name: String, pub color: String, pub calendar_tag_id: Option<String> }

#[derive(Serialize, Deserialize, Default)]
struct Row { #[serde(default)] stamp: i64, #[serde(default)] timers: BTreeMap<String, serde_json::Value> }

fn valid(timer: &ActivityTimer) -> bool { timer.elapsed_ms >= 0 && !timer.id.is_empty() && !timer.tag_id.is_empty() }

fn read_row(conn: &rusqlite::Connection) -> Result<Row> {
    let raw: Option<String> = conn.query_row("SELECT value FROM settings WHERE key=?1", [KEY], |row| row.get(0)).optional()?;
    Ok(raw.and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default())
}

fn parse(row: &Row) -> BTreeMap<String, ActivityTimer> {
    row.timers.iter().filter_map(|(key, value)| serde_json::from_value::<ActivityTimer>(value.clone()).ok().filter(valid).map(|timer| (key.clone(), timer))).collect()
}

/// The stamp of the timers row (0 without one): it changes with every write.
pub(crate) fn stamp(conn: &rusqlite::Connection) -> rusqlite::Result<i64> {
    Ok(conn.query_row("SELECT COALESCE(json_extract(value,'$.stamp'),0) FROM settings WHERE key=?1", [KEY], |row| row.get(0)).optional()?.unwrap_or(0))
}

fn write(tx: &Transaction, mut row: Row, timers: &BTreeMap<String, ActivityTimer>) -> Result<()> {
    row.stamp += 1;
    row.timers = timers.iter().map(|(key, timer)| Ok((key.clone(), serde_json::to_value(timer)?))).collect::<std::result::Result<_, serde_json::Error>>()?;
    tx.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [KEY, &serde_json::to_string(&row)?])?;
    Ok(())
}

/// Changes the period data inside `tx` (recorded in the undo history like every period-data save).
fn change_period(tx: &Transaction, change: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>)) -> Result<()> {
    let raw: String = tx.query_row("SELECT value FROM settings WHERE key='period-data'", [], |row| row.get(0)).optional()?.unwrap_or_else(|| "{}".into());
    let mut value: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    let Some(data) = value.as_object_mut() else { return Err("Periodendaten sind kein Objekt".into()) };
    change(data);
    crate::history::begin(tx)?;
    tx.execute("INSERT INTO settings(key,value) VALUES('period-data',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(&value)?])?;
    Ok(())
}

/// `days[date].items[activity].done = true`, the rest of the record kept.
fn tick(data: &mut serde_json::Map<String, serde_json::Value>, date: &str, activity: &str) {
    let days = data.entry("days").or_insert_with(|| serde_json::json!({}));
    if !days.is_object() { *days = serde_json::json!({}); }
    let day = days.as_object_mut().unwrap().entry(date).or_insert_with(|| serde_json::json!({ "items": {} }));
    if !day.is_object() { *day = serde_json::json!({ "items": {} }); }
    let items = day.as_object_mut().unwrap().entry("items").or_insert_with(|| serde_json::json!({}));
    if !items.is_object() { *items = serde_json::json!({}); }
    let record = items.as_object_mut().unwrap().entry(activity).or_insert_with(|| serde_json::json!({}));
    if !record.is_object() { *record = serde_json::json!({}); }
    record.as_object_mut().unwrap().insert("done".into(), serde_json::Value::Bool(true));
}

/// The id the app derives from a session's uid (`entryId` in `activityTimer.ts`): SHA-256 shaped as a UUID.
pub fn entry_id(uid: &str) -> String {
    let hex: String = Sha256::digest(uid.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{}-{}-8{}-a{}-{}", &hex[0..8], &hex[8..12], &hex[13..16], &hex[17..20], &hex[20..32])
}

fn clock(minute: u32) -> String { format!("{:02}:{:02}", minute / 60, minute % 60) }

/// A local moment from milliseconds (the earlier one when the clock is turned back).
fn local(ms: i64) -> Option<chrono::DateTime<Local>> { Local.timestamp_millis_opt(ms).earliest() }

/// The sessions as calendar entries (`timerCalendarEntries`): split at local midnight, minutes rounded outward so that
/// short sessions stay visible.
pub fn calendar_entries(timer: &ActivityTimer, title: &str, description: &str) -> Vec<CalendarImport> {
    let mut entries = Vec::new();
    for segment in &timer.segments {
        let mut cursor = segment.start;
        while cursor < segment.end {
            let Some(start) = local(cursor) else { break };
            let date: NaiveDate = start.date_naive();
            let midnight = date.succ_opt().and_then(|next| next.and_hms_opt(0, 0, 0)).and_then(|next| Local.from_local_datetime(&next).earliest()).map_or(i64::MAX, |m| m.timestamp_millis());
            let end = segment.end.min(midnight);
            let from = start.hour() * 60 + start.minute();
            let to = if end == midnight { 1440 } else {
                let finish = local(end).unwrap_or(start);
                let rounded = finish.hour() * 60 + finish.minute() + u32::from(finish.second() != 0 || finish.nanosecond() >= 1_000_000);
                rounded.max(from + 1).min(1440)
            };
            let uid = format!("activity-time:{}:{}:{}", timer.id, segment.start, date);
            let entry: Entry = serde_json::from_value(serde_json::json!({
                "id": entry_id(&uid), "calendarUid": uid, "kind": "event", "text": title, "description": description,
                "time": clock(from), "end": clock(to), "done": false, "cancelled": false, "priority": false, "reminder": false,
                "showInJournal": false, "tag": timer.tag_id, "plan": null,
            })).expect("a valid entry");
            entries.push(CalendarImport { date: date.to_string(), entry, tag: None });
            if end <= cursor { break; }
            cursor = end;
        }
    }
    entries
}

impl Store {
    /// Every timer, by `<date>:<activity>`.
    pub fn activity_timers(&self) -> Result<BTreeMap<String, ActivityTimer>> { Ok(parse(&read_row(&self.conn)?)) }

    /// Starts (or resumes) the activity's timer for `date` and ticks the activity there. A running timer stays as it is.
    pub fn start_activity_timer(&self, date: &str, activity: &str, calendar_tag_id: Option<&str>, now: i64) -> Result<ActivityTimer> {
        let tx = self.conn.unchecked_transaction()?;
        let row = read_row(&tx)?;
        let mut timers = parse(&row);
        let key = timer_key(date, activity);
        if let Some(timer) = timers.get(&key).filter(|timer| timer.running()) { return Ok(timer.clone()); }
        let mut timer = timers.remove(&key).unwrap_or_else(|| ActivityTimer {
            id: uuid::Uuid::new_v4().to_string(), started_at: None, elapsed_ms: 0, segments: Vec::new(),
            tag_id: calendar_tag_id.map(str::to_string).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        });
        timer.started_at = Some(now);
        timers.insert(key, timer.clone());
        write(&tx, row, &timers)?;
        change_period(&tx, |data| tick(data, date, activity))?;
        tx.commit()?;
        Ok(timer)
    }

    /// Pauses the timer; None when there is none.
    pub fn pause_activity_timer(&self, date: &str, activity: &str, now: i64) -> Result<Option<ActivityTimer>> {
        let tx = self.conn.unchecked_transaction()?;
        let row = read_row(&tx)?;
        let mut timers = parse(&row);
        let key = timer_key(date, activity);
        let Some(timer) = timers.get(&key).map(|timer| timer.paused(now)) else { return Ok(None) };
        timers.insert(key, timer.clone());
        write(&tx, row, &timers)?;
        tx.commit()?;
        Ok(Some(timer))
    }

    /// Stops the timer: its sessions go into the calendar (see the module), then it is removed. Returns the days whose
    /// entries changed. Without a timer nothing happens. On an error the timer stays, paused; stopping again is safe.
    pub fn stop_activity_timer(&mut self, date: &str, activity: &TimerActivity, description: &str, fallback_name: &str, now: i64) -> Result<Vec<String>> {
        let key = timer_key(date, &activity.id);
        // Paused first, with the tag it will keep (its own one from the activity when that has one).
        let stopped = {
            let tx = self.conn.unchecked_transaction()?;
            let row = read_row(&tx)?;
            let mut timers = parse(&row);
            let Some(current) = timers.get(&key) else { return Ok(Vec::new()) };
            let stopped = ActivityTimer { tag_id: activity.calendar_tag_id.clone().unwrap_or_else(|| current.tag_id.clone()), ..current.paused(now) };
            timers.insert(key.clone(), stopped.clone());
            write(&tx, row, &timers)?;
            tx.commit()?;
            stopped
        };
        // The tag: recoloured when it exists, otherwise made with the activity's name (unique, as in the app).
        let color = if activity.color.len() == 7 && activity.color.starts_with('#') && activity.color[1..].chars().all(|c| c.is_ascii_hexdigit()) { activity.color.to_lowercase() } else { "#569eff".into() };
        let mut tags = self.tags()?;
        let mut dates = Vec::new();
        match tags.iter_mut().find(|tag| tag.id == stopped.tag_id) {
            Some(tag) if tag.color != color => { tag.color = color; dates.extend(self.save_tags(&tags)?); }
            Some(_) => {}
            None => {
                let trimmed = activity.name.trim();
                let base: String = (if trimmed.is_empty() { fallback_name } else { trimmed }).chars().take(32).collect();
                let (mut name, mut suffix) = (base.clone(), 1);
                while tags.iter().any(|tag| tag.name.to_lowercase() == name.to_lowercase()) { suffix += 1; name = format!("{base} ({suffix})"); }
                tags.push(Tag { id: stopped.tag_id.clone(), name, color, icon: None });
                dates.extend(self.save_tags(&tags)?);
            }
        }
        let entries = calendar_entries(&stopped, &activity.name, description);
        if !entries.is_empty() { dates.extend(self.import_calendar(entries)?); }
        // Ticked, the tag remembered, and the timer gone, together.
        let tx = self.conn.unchecked_transaction()?;
        change_period(&tx, |data| {
            if let Some(definitions) = data.get_mut("definitions").and_then(|value| value.as_array_mut()) {
                for definition in definitions.iter_mut().filter(|definition| definition.get("id").and_then(|id| id.as_str()) == Some(activity.id.as_str())) {
                    if let Some(definition) = definition.as_object_mut() { definition.insert("calendarTagId".into(), serde_json::Value::String(stopped.tag_id.clone())); }
                }
            }
            tick(data, date, &activity.id);
        })?;
        let row = read_row(&tx)?;
        let mut timers = parse(&row);
        timers.remove(&key);
        write(&tx, row, &timers)?;
        tx.commit()?;
        dates.sort();
        dates.dedup();
        Ok(dates)
    }

    /// Takes over timers kept elsewhere before (the app's local storage): those not known yet are added.
    pub fn adopt_activity_timers(&self, found: &BTreeMap<String, ActivityTimer>) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let row = read_row(&tx)?;
        let mut timers = parse(&row);
        let mut added = 0;
        for (key, timer) in found.iter().filter(|(_, timer)| valid(timer)) {
            if !timers.contains_key(key) { timers.insert(key.clone(), timer.clone()); added += 1; }
        }
        if added > 0 { write(&tx, row, &timers)?; tx.commit()?; }
        Ok(added)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Db { store: Store, path: std::path::PathBuf }
    impl Drop for Db { fn drop(&mut self) { for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display())); } } }
    fn db() -> Db {
        let path = std::env::temp_dir().join(format!("timers-{}.db", uuid::Uuid::new_v4()));
        Db { store: Store::open(&path).unwrap(), path }
    }
    fn at(y: i32, m: u32, d: u32, h: u32, min: u32, s: u32) -> i64 { Local.with_ymd_and_hms(y, m, d, h, min, s).earliest().unwrap().timestamp_millis() }
    fn reading() -> TimerActivity { TimerActivity { id: "reading".into(), name: "Lesen".into(), color: "#76D982".into(), calendar_tag_id: None } }

    #[test]
    fn ids_match_the_apps_derivation() {
        // SHA-256("abc") = ba7816bf 8f01 cfea 4141 40de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(entry_id("abc"), "ba7816bf-8f01-8fea-a141-40de5dae2223");
        assert!(uuid::Uuid::parse_str(&entry_id("activity-time:x:1:2026-11-02")).is_ok());
    }

    #[test]
    fn sessions_split_at_midnight_round_outward_and_keep_their_ids() {
        let timer = ActivityTimer { id: "session".into(), started_at: None, elapsed_ms: 0, tag_id: "tag".into(),
            segments: vec![Segment { start: at(2026, 11, 2, 23, 59, 45), end: at(2026, 11, 3, 0, 1, 5) }] };
        let entries = calendar_entries(&timer, "Lesen", "Notiz");
        let shown: Vec<_> = entries.iter().map(|item| (item.date.as_str(), item.entry.time.as_deref().unwrap(), item.entry.end.as_deref().unwrap())).collect();
        assert_eq!(shown, [("2026-11-02", "23:59", "24:00"), ("2026-11-03", "00:00", "00:02")]);
        let ids = |list: &[CalendarImport]| list.iter().map(|item| (item.entry.id.clone(), item.entry.calendar_uid.clone())).collect::<Vec<_>>();
        assert_eq!(ids(&entries), ids(&calendar_entries(&timer, "Lesen", "Notiz")), "Stable identities on retry.");
        assert!(!entries[0].entry.show_in_journal);
        assert_eq!(entries[0].entry.tag.as_deref(), Some("tag"));
        let short = ActivityTimer { segments: vec![Segment { start: at(2026, 11, 2, 12, 0, 10), end: at(2026, 11, 2, 12, 0, 10) + 100 }], ..timer };
        assert_eq!(calendar_entries(&short, "Sport", "")[0].entry.end.as_deref(), Some("12:01"), "A short session stays visible.");
    }

    #[test]
    fn two_programs_share_the_timers_and_stopping_writes_the_calendar() {
        let mut a = db();
        let b = Store::open(&a.path).unwrap();
        a.store.save_period_data(&serde_json::json!({ "definitions": [{ "id": "reading", "name": "Lesen", "color": "#76d982" }], "days": {} }).to_string()).unwrap();
        let mut watch = a.store.watch().unwrap();
        let t0 = at(2026, 11, 19, 10, 0, 0);
        // J-TerminaL starts; the app sees it, with the activity ticked.
        let started = b.start_activity_timer("2026-11-19", "reading", None, t0).unwrap();
        assert!(started.running());
        let changes = a.store.external_changes(&mut watch).unwrap().unwrap();
        assert!(changes.timers && changes.period);
        assert_eq!(a.store.activity_timers().unwrap()["2026-11-19:reading"], started);
        assert_eq!(b.start_activity_timer("2026-11-19", "reading", None, t0 + 5000).unwrap(), started, "Starting a running timer changes nothing.");
        // The app pauses, J-TerminaL resumes.
        let paused = a.store.pause_activity_timer("2026-11-19", "reading", t0 + 30 * 60_000).unwrap().unwrap();
        assert_eq!((paused.elapsed_ms, paused.segments.len(), paused.running()), (30 * 60_000, 1, false));
        assert!(b.activity_timers().unwrap()["2026-11-19:reading"].started_at.is_none());
        let resumed = b.start_activity_timer("2026-11-19", "reading", None, t0 + 60 * 60_000).unwrap();
        assert_eq!(resumed.id, started.id);
        assert_eq!(resumed.elapsed(t0 + 75 * 60_000), 45 * 60_000);
        // Stopping: two sessions in the calendar with a new tag, the activity remembers it, the timer is gone.
        let dates = a.store.stop_activity_timer("2026-11-19", &reading(), "Checklisten-Zeit · 2026-11-19", "Aktivität", t0 + 90 * 60_000).unwrap();
        assert_eq!(dates, ["2026-11-19"]);
        assert!(a.store.activity_timers().unwrap().is_empty());
        let day = a.store.load("2026-11-19").unwrap();
        let times: Vec<_> = day.entries.iter().map(|e| (e.time.as_deref().unwrap(), e.end.as_deref().unwrap(), e.show_in_journal)).collect();
        assert_eq!(times, [("10:00", "10:30", false), ("11:00", "11:30", false)]);
        let tag = a.store.tags().unwrap().into_iter().find(|tag| tag.name == "Lesen").expect("a tag for the activity");
        assert_eq!((tag.id.as_str(), tag.color.as_str()), (resumed.tag_id.as_str(), "#76d982"));
        assert!(day.entries.iter().all(|e| e.tag.as_deref() == Some(tag.id.as_str())));
        let period: serde_json::Value = serde_json::from_str(&a.store.period_data().unwrap()).unwrap();
        assert_eq!(period["definitions"][0]["calendarTagId"], serde_json::json!(tag.id));
        assert_eq!(period["days"]["2026-11-19"]["items"]["reading"]["done"], serde_json::json!(true));
        // Stopping again does nothing; a retried stop of the same sessions would update the same entries.
        assert!(a.store.stop_activity_timer("2026-11-19", &reading(), "", "Aktivität", t0).unwrap().is_empty());
        assert_eq!(a.store.load("2026-11-19").unwrap().entries.len(), 2);
    }

    #[test]
    fn an_existing_tag_is_recoloured_and_a_taken_name_gets_a_number() {
        let mut d = db();
        let taken = Tag { id: uuid::Uuid::new_v4().to_string(), name: "Lesen".into(), color: "#000000".into(), icon: None };
        d.store.save_tags(std::slice::from_ref(&taken)).unwrap();
        let t0 = at(2026, 11, 19, 8, 0, 0);
        d.store.start_activity_timer("2026-11-19", "reading", None, t0).unwrap();
        d.store.stop_activity_timer("2026-11-19", &reading(), "", "Aktivität", t0 + 60_000).unwrap();
        let names: Vec<_> = d.store.tags().unwrap().into_iter().map(|tag| tag.name).collect();
        assert_eq!(names, ["Lesen", "Lesen (2)"]);
        let own = TimerActivity { calendar_tag_id: Some(taken.id.clone()), ..reading() };
        d.store.start_activity_timer("2026-11-20", "reading", Some(&taken.id), t0).unwrap();
        d.store.stop_activity_timer("2026-11-20", &own, "", "Aktivität", t0 + 60_000).unwrap();
        assert_eq!(d.store.tags().unwrap()[0].color, "#76d982", "The activity's tag takes its colour.");
    }

    #[test]
    fn timers_from_local_storage_are_adopted_once_and_bad_ones_skipped() {
        let d = db();
        let timer = ActivityTimer { id: "s".into(), started_at: Some(1000), elapsed_ms: 0, segments: vec![], tag_id: "t".into() };
        let found = BTreeMap::from([("2026-11-19:a".to_string(), timer.clone()), ("2026-11-19:b".to_string(), ActivityTimer { elapsed_ms: -1, ..timer.clone() })]);
        assert_eq!(d.store.adopt_activity_timers(&found).unwrap(), 1);
        assert_eq!(d.store.adopt_activity_timers(&found).unwrap(), 0);
        assert_eq!(d.store.activity_timers().unwrap().len(), 1);
        // Not undoable: an undo does not take a timer back.
        assert!(!crate::history::step(&mut Store::open(&d.path).unwrap(), false).unwrap());
    }
}
