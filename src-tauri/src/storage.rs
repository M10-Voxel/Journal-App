use chrono::{Duration, NaiveDate, NaiveDateTime};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeSet, HashMap, HashSet, VecDeque}, error::Error, path::Path};
use uuid::Uuid;

mod schema;
mod read;
#[cfg(test)]
mod performance_tests;

pub type ActivityMinutes = std::collections::BTreeMap<String, std::collections::BTreeMap<String, i64>>;

fn default_true() -> bool { true }

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: String, pub kind: String, pub text: String, pub done: bool, pub cancelled: bool, #[serde(default)] pub priority: bool,
    #[serde(default)] pub description: String,
    /// The tag (see `Tag`) the entry belongs to; an unknown one is dropped when saving.
    #[serde(default)] pub tag: Option<String>,
    /// Optional `HH:MM` on the entry's own day.
    #[serde(default)] pub time: Option<String>,
    /// Optional end `HH:MM` on the same day, after `time` (entries made by marking a range in the calendar).
    #[serde(default)] pub end: Option<String>,
    /// Whether the user wants a reminder (see `due_reminders`).
    #[serde(default)] pub reminder: bool,
    /// How many minutes before the entry's time (or `REMINDER_DEFAULT`) the reminder comes; 0 at the time itself.
    #[serde(default, rename = "reminderBefore")] pub reminder_before: i64,
    /// A symbol of the entry (a Lucide icon's name, drawn in the tag's colour in the calendar).
    #[serde(default)] pub icon: Option<String>,
    #[serde(default = "default_true", rename = "showInJournal")] pub show_in_journal: bool,
    #[serde(default, rename = "calendarUid")] pub calendar_uid: Option<String>,
    /// Set on an entry that was planned away and stays behind as a trace.
    #[serde(default)] pub plan: Option<Plan>,
    /// Date of the trace this entry was planned from. Derived when loading, ignored when saving.
    #[serde(default, skip_serializing_if = "Option::is_none")] pub origin: Option<String>,
    /// The repeating series this entry is an occurrence of (see `Repeat`). Left out when saving, the entry stays where it is.
    #[serde(default)] pub repeat: Option<Repeat>,
}
/// A repeating entry: every occurrence is an entry of its own (with its own status and time), linked like planned copies.
/// Saving an entry with a series that does not exist yet starts it from that entry: `dates` are created as copies. With
/// no rule, the entry leaves its series instead. Leaving a series (also for a new one) ends it: its open occurrences after
/// the entry's day go, finished ones stay.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Repeat {
    pub series: String,
    /// The rule as the app describes it (src/repeat.ts); stored as given, only its `start` is read here.
    #[serde(default)] pub rule: Option<serde_json::Value>,
    /// Occurrences exist up to this date; later ones are added when the app moves it on (see `extend_series`).
    #[serde(default)] pub horizon: String,
    /// Only when starting a series: the further occurrences after the entry's own day, up to the horizon.
    #[serde(default, skip_serializing)] pub dates: Vec<String>,
}
/// `via` is `tomorrow`, `date` or `days`. Each target is created once, as an entry with the target's ID, when the trace is first saved.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Plan { pub via: String, pub targets: Vec<PlanTarget>, #[serde(default)] pub time: Option<String>, #[serde(default, skip_serializing_if = "Option::is_none")] pub end: Option<String>, #[serde(default)] pub reminder: bool,
    /// A single target may start a repeating series there (the copy is its first occurrence).
    #[serde(default, skip_serializing_if = "Option::is_none")] pub repeat: Option<Repeat> }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlanTarget { pub date: String, pub id: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Day {
    pub date: String, pub title: String, pub body: String, pub revision: i64, pub entries: Vec<Entry>,
    /// Other days changed by a save (planned copies created, edits passed on to linked entries). Empty when loading.
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub touched: Vec<String>,
    /// Entries whose edits stay with them in this save instead of reaching their linked entries (an edit made for
    /// "only this one", see `edit_linked`). Only read when saving.
    #[serde(default, rename = "keepAlone", skip_serializing)] pub keep_alone: Vec<String>,
}
/// A day as the calendar shows it: its title and the entries that live there (traces are left out, their copies count).
#[derive(Clone, Debug, Serialize)]
pub struct CalendarDay { pub date: String, pub title: String, #[serde(rename="hasJournal")] pub has_journal: bool, pub entries: Vec<Entry> }
/// One entry of a linked group (a trace, its copies, copies planned on again), for choosing which of them an action reaches.
#[derive(Clone, Debug, Serialize)]
pub struct LinkedEntry { pub id: String, pub date: String, pub kind: String, pub done: bool, pub cancelled: bool, pub trace: bool, pub series: Option<String> }
/// An edit made in the calendar, passed on to chosen entries of the same group ("every Tuesday", "all"); see `edit_linked`.
/// `times` is given when the edit set the time (moved or resized the entry).
#[derive(Clone, Debug, Deserialize)]
pub struct LinkedEdit {
    pub kind: String, pub text: String, #[serde(default)] pub description: String, #[serde(default)] pub tag: Option<String>, pub priority: bool, pub reminder: bool,
    #[serde(default = "default_true", rename = "showInJournal")] pub show_in_journal: bool, #[serde(default)] pub times: Option<LinkedTimes>,
    #[serde(default, rename = "reminderBefore")] pub reminder_before: i64, #[serde(default)] pub icon: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct LinkedTimes { pub time: Option<String>, #[serde(default)] pub end: Option<String> }
/// `action` is `remove`, `done`, `cancelled` or `open`.
#[derive(Clone, Debug, Deserialize)]
pub struct LinkedChange { pub id: String, pub action: String }
/// A series as the app needs it to add occurrences when its horizon moves on.
#[derive(Clone, Debug, Serialize)]
pub struct SeriesInfo { pub series: String, pub rule: serde_json::Value, pub horizon: String }
/// New occurrences of a series from the day after `from` (its current horizon) up to `to`.
#[derive(Clone, Debug, Deserialize)]
pub struct SeriesExtension { pub series: String, pub from: String, pub to: String, pub dates: Vec<String> }
#[derive(Clone, Debug, Deserialize)]
pub struct CalendarImport { pub date: String, pub entry: Entry, #[serde(default)] pub tag: Option<Tag> }
/// A search hit: an entry on its day, or a day by its title.
#[derive(Clone, Debug, Serialize)]
pub struct SearchHit { pub date: String, #[serde(skip_serializing_if = "Option::is_none")] pub title: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] pub entry: Option<Entry> }
/// A tag like "Arbeit" or "Uni" with its colour (`#rrggbb`) and optionally an icon (a Lucide name, see `valid_icon`) shown
/// in its place at the entries; entries are grouped and coloured by it. The list is ordered.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Tag { pub id: String, pub name: String, pub color: String, #[serde(default, skip_serializing_if = "Option::is_none")] pub icon: Option<String> }
/// A reminder that is due: an open task or event with the bell, at its time (without one at `REMINDER_DEFAULT`).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Reminder {
    pub id: String, pub date: String, pub kind: String, pub text: String, pub time: Option<String>, pub end: Option<String>,
    /// `YYYY-MM-DDTHH:MM`, the moment it was due (also after snoozing; it identifies the reminder).
    pub due: String,
    /// Shown later than due: missed while the app was closed, or snoozed.
    pub late: bool,
    pub snoozed: bool,
}
/// When entries without a time remind.
pub const REMINDER_DEFAULT: &str = "09:00";
/// A reminder comes at most 30 days before its entry.
pub const MAX_REMINDER_BEFORE: i64 = 30 * 24 * 60;
/// An entry's icon: a Lucide name (lower-case words joined by hyphens).
pub fn valid_icon(icon: &str) -> bool { !icon.is_empty() && icon.len() <= 64 && icon.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') }
pub struct Store { pub(crate) conn: Connection }

impl Store {
    pub fn interface_language(&self) -> Result<String> { Ok(self.conn.query_row("SELECT value FROM settings WHERE key='ui-language'", [], |row|row.get(0)).optional()?.unwrap_or_else(||"de".into())) }
    pub fn period_data(&self) -> Result<String> { Ok(self.conn.query_row("SELECT value FROM settings WHERE key='period-data'", [], |row| row.get(0)).optional()?.unwrap_or_else(|| "{}".into())) }
    pub fn save_period_data(&self, data: &str) -> Result<()> {
        if data.len() > 10_000_000 { return Err("Periodendaten sind zu groß".into()); }
        let _: serde_json::Value = serde_json::from_str(data)?;
        let tx=self.conn.unchecked_transaction()?; crate::history::begin(&tx)?;
        tx.execute("INSERT INTO settings(key,value) VALUES('period-data',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [data])?;
        tx.commit()?;
        Ok(())
    }
    pub fn set_interface_language(&self, language: &str) -> Result<()> { self.conn.prepare_cached("INSERT INTO settings(key,value) VALUES('ui-language',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE settings.value IS NOT excluded.value")?.execute([language])?; Ok(()) }
    /// An import is atomic. Matching UIDs update the occurrence, even when it moved to another day.
    pub fn import_calendar(&mut self, entries: Vec<CalendarImport>) -> Result<Vec<String>> {
        if entries.len() > 5000 { return Err("Zu viele Kalendereinträge (höchstens 5000 pro Import)".into()); }
        let mut uids = HashSet::new();
        let mut ids = HashSet::new();
        for item in &entries {
            validate_date(&item.date)?;
            let e = &item.entry;
            let uid = e.calendar_uid.as_deref().ok_or("Kalendereintrag ohne UID")?;
            if uid.is_empty() || uid.len() > 2048 || !uids.insert(uid) || !ids.insert(&e.id) || Uuid::parse_str(&e.id).is_err() || !matches!(e.kind.as_str(), "event" | "task") || e.plan.is_some() || !valid_time(&e.time) || !valid_span(&e.time, &e.end) || e.text.len() > 1_000_000 || e.description.len() > 1_000_000 || (e.kind != "task" && (e.done || e.cancelled)) || (e.done && e.cancelled) {
                return Err("Ungültiger Kalendereintrag".into());
            }
        }
        let tx = self.conn.transaction()?;
        crate::history::begin(&tx)?;
        let mut touched = BTreeSet::new();
        let mut series_map=std::collections::HashMap::<String,String>::new();
        for item in entries {
            let mut e = item.entry;
            if let Some(tag)=item.tag {
                if tag.name.trim().is_empty() || tag.name.chars().count()>40 || tag.color.len()!=7 || !tag.color.starts_with('#') || !tag.color[1..].chars().all(|c|c.is_ascii_hexdigit()) {return Err("Ungültiger ICS-Tag".into());}
                let existing=tx.prepare("SELECT id,name FROM tags")?.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
                let id=if let Some((id,_))=existing.into_iter().find(|(_,name)|name.to_lowercase()==tag.name.to_lowercase()){id}else{let id=Uuid::new_v4().to_string();tx.execute("INSERT INTO tags(id,name,color,position) VALUES(?1,?2,?3,(SELECT COALESCE(MAX(position)+1,0) FROM tags))",params![id,tag.name,tag.color])?;id};e.tag=Some(id);
            }
            let series=if let Some(repeat)=e.repeat.as_ref(){
                if let Some(id)=series_map.get(&repeat.series){Some(id.clone())}else{
                    let existing:Option<String>=tx.query_row("SELECT series FROM entries WHERE calendar_uid=?1 AND series IS NOT NULL",[&e.calendar_uid],|r|r.get(0)).optional()?;
                    let existing=if existing.is_some(){existing}else{let uid=repeat.rule.as_ref().and_then(|r|r.get("icsUid")).and_then(serde_json::Value::as_str).unwrap_or("");tx.query_row("SELECT id FROM series WHERE json_extract(rule,'$.icsUid')=?1",[uid],|r|r.get(0)).optional()?};
                    let mut imported=repeat.clone();imported.series=existing.unwrap_or_else(||Uuid::new_v4().to_string());imported.dates.clear();
                    if !series_exists(&tx,&imported.series)?{start_series(&tx,&imported,&item.date)?;}else{tx.execute("UPDATE series SET rule=?2,horizon=?3 WHERE id=?1",params![imported.series,serde_json::to_string(&imported.rule)?,imported.horizon])?;}
                    series_map.insert(repeat.series.clone(),imported.series.clone());Some(imported.series)
                }
            }else{None};
            let found: Option<(String, String, Option<String>)> = tx.query_row("SELECT id, day_date, plan FROM entries WHERE calendar_uid=?1 OR id=?2", params![e.calendar_uid, e.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
            let id = if let Some((id, old_date, plan)) = found {
                if plan.is_some() || (old_date != item.date && linked_ids(&tx, &id)?.len() > 1) { return Err("Ein bereits weitergeplanter Eintrag kann nicht durch einen ICS-Import verschoben werden".into()); }
                touched.insert(old_date); id
            } else { e.id.clone() };
            tx.execute("INSERT INTO days(date,title,body,revision) VALUES(?1,'','',1) ON CONFLICT(date) DO NOTHING", [&item.date])?;
            let position: i64 = tx.query_row("SELECT COALESCE(MAX(position)+1,0) FROM entries WHERE day_date=?1", [&item.date], |r| r.get(0))?;
            tx.execute("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan,end_time,show_in_journal,calendar_uid,description,series,tag,reminder_before,icon)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,?11,?12,?13,?14,?16,(SELECT id FROM tags WHERE id=?15),?17,?18)
                ON CONFLICT(id) DO UPDATE SET reminder_before=excluded.reminder_before,icon=COALESCE(excluded.icon,entries.icon),day_date=excluded.day_date,kind=excluded.kind,text=excluded.text,description=excluded.description,done=excluded.done,cancelled=excluded.cancelled,priority=excluded.priority,time=excluded.time,reminder=excluded.reminder,end_time=excluded.end_time,show_in_journal=excluded.show_in_journal,calendar_uid=excluded.calendar_uid,series=excluded.series,tag=COALESCE(excluded.tag,entries.tag),position=CASE WHEN entries.day_date=excluded.day_date THEN entries.position ELSE excluded.position END",
                params![id,item.date,e.kind,e.text,e.done,position,e.cancelled,e.priority,e.time,e.reminder,e.end,e.show_in_journal,e.calendar_uid,e.description,e.tag,series,e.reminder_before.clamp(0, MAX_REMINDER_BEFORE),e.icon.as_deref().filter(|icon| valid_icon(icon))])?;
            // Keep a local tag when the source supplies none; otherwise use the imported category.
            let mut updated = e; updated.tag = tx.query_row("SELECT tag FROM entries WHERE id=?1", [&id], |r| r.get(0))?; updated.id = id;
            sync_linked(&tx, &updated, &mut touched)?;
            touched.insert(item.date);
        }
        for date in &touched { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }
    /// Move one calendar occurrence, preserving its identity, tags and links.
    pub fn move_calendar_entry(&mut self, id: &str, from: &str, to: &str, time: Option<String>, end: Option<String>) -> Result<Vec<String>> {
        validate_date(from)?; validate_date(to)?;
        if !valid_time(&time) || !valid_span(&time, &end) { return Err("Ungültige Uhrzeit".into()); }
        let tx = self.conn.transaction()?;
        let actual: Option<String> = tx.query_row("SELECT day_date FROM entries WHERE id=?1", [id], |r| r.get(0)).optional()?;
        if actual.as_deref() != Some(from) { return Err("Der Eintrag wurde inzwischen geändert. Bitte erneut versuchen.".into()); }
        crate::history::begin(&tx)?;
        tx.execute("INSERT INTO days(date,title,body,revision) VALUES(?1,'','',1) ON CONFLICT(date) DO NOTHING", [to])?;
        let position: i64 = tx.query_row("SELECT COALESCE(MAX(position)+1,0) FROM entries WHERE day_date=?1", [to], |r| r.get(0))?;
        tx.execute("UPDATE entries SET day_date=?2,time=?3,end_time=?4,position=CASE WHEN day_date=?2 THEN position ELSE ?5 END WHERE id=?1", params![id,to,time,end,position])?;
        let mut touched = BTreeSet::from([from.to_string(), to.to_string()]);
        let plans = tx.prepare("SELECT id,day_date,plan FROM entries WHERE plan IS NOT NULL")?.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for (plan_id, date, raw) in plans {
            let mut plan: Plan = serde_json::from_str(&raw)?;
            let mut changed = false;
            for target in &mut plan.targets { if target.id == id && target.date != to { target.date=to.to_string(); changed=true; } }
            if changed { tx.execute("UPDATE entries SET plan=?2 WHERE id=?1", params![plan_id,serde_json::to_string(&plan)?])?; touched.insert(date); }
        }
        for date in &touched { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        tx.commit()?; Ok(touched.into_iter().collect())
    }
    pub fn tags(&self) -> Result<Vec<Tag>> {
        let mut stmt = self.conn.prepare_cached("SELECT id, name, color, icon FROM tags ORDER BY position")?;
        let tags = stmt.query_map([], |r| Ok(Tag { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, icon: r.get(3)? }))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(tags)
    }
    /// Replaces the list of tags (in this order). Tags left out are removed and their entries keep no tag; the days of
    /// those entries are returned, so the windows can show them anew.
    pub fn save_tags(&mut self, tags: &[Tag]) -> Result<Vec<String>> {
        if tags.len() > 200 { return Err("Zu viele Tags".into()); }
        let (mut ids, mut names) = (HashSet::new(), HashSet::new());
        for tag in tags {
            let name = tag.name.trim();
            let hex = tag.color.len() == 7 && tag.color.starts_with('#') && tag.color[1..].chars().all(|c| c.is_ascii_hexdigit());
            if Uuid::parse_str(&tag.id).is_err() || !ids.insert(tag.id.as_str()) || name.is_empty() || name.chars().count() > 40 || name != tag.name || !names.insert(name.to_lowercase()) || !hex || !tag.icon.as_deref().is_none_or(valid_icon) { return Err("Ungültiger Tag".into()); }
        }
        let tx = self.conn.transaction()?;
        crate::history::begin(&tx)?;
        let removed: Vec<String> = tx.prepare("SELECT id FROM tags")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?
            .into_iter().filter(|id| !ids.contains(id.as_str())).collect();
        let mut touched = BTreeSet::new();
        for id in &removed {
            for date in tx.prepare_cached("SELECT DISTINCT day_date FROM entries WHERE tag=?1")?.query_map([id], |r| r.get::<_, String>(0))? { touched.insert(date?); }
            tx.execute("DELETE FROM tags WHERE id=?1", [id])?;
        }
        for (position, tag) in tags.iter().enumerate() {
            tx.execute("INSERT INTO tags(id,name,color,position,icon) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, position=excluded.position, icon=excluded.icon",
                params![tag.id, tag.name, tag.color.to_lowercase(), position as i64, tag.icon])?;
        }
        for date in &touched { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }
    pub fn save(&mut self, mut day: Day) -> Result<Day> {
        validate_date(&day.date)?;
        let mut ids = HashSet::new();
        for entry in &day.entries {
            if Uuid::parse_str(&entry.id).is_err() || !ids.insert(&entry.id) || !matches!(entry.kind.as_str(), "task" | "event" | "note") || (entry.kind != "task" && (entry.done || entry.cancelled)) || (entry.done && entry.cancelled) { return Err("Ungültiger Eintrag".into()); }
            if entry.kind == "note" && (entry.time.is_some() || entry.reminder || entry.plan.is_some()) { return Err("Notizen können nicht geplant werden".into()); }
            if entry.description.len() > 1_000_000 || !valid_time(&entry.time) || !valid_span(&entry.time, &entry.end) { return Err("Ungültige Uhrzeit".into()); }
            if !(0..=MAX_REMINDER_BEFORE).contains(&entry.reminder_before) || !entry.icon.as_deref().is_none_or(valid_icon) { return Err("Ungültiger Eintrag".into()); }
        }
        for plan in day.entries.iter().filter_map(|entry| entry.plan.as_ref()) {
            let single = matches!(plan.via.as_str(), "tomorrow" | "date");
            if !(single || plan.via == "days") || plan.targets.is_empty() || (single && plan.targets.len() != 1) || !valid_time(&plan.time) || !valid_span(&plan.time, &plan.end) { return Err("Ungültige Planung".into()); }
            if plan.repeat.as_ref().is_some_and(|repeat| plan.targets.len() != 1 || repeat.rule.is_none()) { return Err("Ungültige Planung".into()); }
            let mut dates = HashSet::new();
            for target in &plan.targets {
                validate_date(&target.date)?;
                if target.date == day.date || !dates.insert(&target.date) || Uuid::parse_str(&target.id).is_err() || !ids.insert(&target.id) { return Err("Ungültige Planung".into()); }
            }
        }
        let tx = self.conn.transaction()?;
        crate::history::begin(&tx)?;
        // A tag removed meanwhile (in another window) is simply gone from the entry.
        {
            let mut known = tx.prepare_cached("SELECT 1 FROM tags WHERE id=?1")?;
            for entry in &mut day.entries {
                if let Some(tag) = &entry.tag { if known.query_row([tag], |_| Ok(())).optional()?.is_none() { entry.tag = None; } }
            }
        }
        let current: Option<i64> = tx.prepare_cached("SELECT revision FROM days WHERE date=?1")?.query_row([&day.date], |r| r.get(0)).optional()?;
        if current.unwrap_or(0) != day.revision { return Err("Dieser Tag wurde inzwischen geändert. Bitte neu laden.".into()); }
        // Entries keep their day; their kind may change (an event becomes a task and back). What changed in text, kind or
        // priority is passed on to the entries linked with them (see sync_linked), and only that, so an unchanged trace
        // never overwrites a newer edit made at its target.
        let mut edited = Vec::new();
        {
            let mut original = tx.prepare_cached("SELECT day_date, kind, text, priority, description, tag FROM entries WHERE id=?1")?;
            for entry in &day.entries {
                let found: Option<(String, String, String, bool, String, Option<String>)> = original.query_row([&entry.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).optional()?;
                if let Some((date, kind, text, priority, description, tag)) = found {
                    if date != day.date { return Err("Eintrag gehört zu einem anderen Tag".into()); }
                    if kind != entry.kind || text != entry.text || priority != entry.priority || description != entry.description || tag != entry.tag { edited.push(entry.id.clone()); }
                }
            }
        }
        // Targets of traces that were already saved exist (or were deliberately deleted) on their days and must not be created again.
        // Removing an entry removes only it: a trace stays as the record of the move, copies stay where they are. Linked
        // entries go along only when asked for (see change_linked).
        let mut created = HashSet::new();
        {
            let mut stored = tx.prepare_cached("SELECT plan FROM entries WHERE day_date=?1 AND plan IS NOT NULL")?;
            let plans = stored.query_map([&day.date], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
            for plan in plans { created.extend(serde_json::from_str::<Plan>(&plan)?.targets.into_iter().map(|target| target.id)); }
        }
        // The series each entry belongs to after this save (see Repeat). Without a `repeat`, an entry keeps its series; a
        // series not known yet starts here; an entry leaving its series (for a new one or none) ends it on this day.
        // Days that changed: `touched` were created or appended to (which marks them), `changed` still need marking.
        let (mut touched, mut changed) = (BTreeSet::new(), BTreeSet::new());
        let mut series: Vec<Option<String>> = Vec::with_capacity(day.entries.len());
        let mut started: Vec<(usize, Vec<String>)> = Vec::new();
        {
            let mut stored = tx.prepare_cached("SELECT series FROM entries WHERE id=?1 AND day_date=?2")?;
            for (index, entry) in day.entries.iter().enumerate() {
                let old: Option<String> = stored.query_row([&entry.id, &day.date], |r| r.get(0)).optional()?.flatten();
                let next = match &entry.repeat {
                    None => old.clone(),
                    Some(repeat) if series_exists(&tx, &repeat.series)? => Some(repeat.series.clone()),
                    Some(repeat) if repeat.rule.is_none() => None,
                    Some(repeat) => { start_series(&tx, repeat, &day.date)?; started.push((index, repeat.dates.clone())); Some(repeat.series.clone()) }
                };
                if next.is_some() && entry.kind == "note" { return Err("Notizen können nicht wiederholt werden".into()); }
                if let Some(old) = old.as_ref().filter(|old| next.as_ref() != Some(*old)) {
                    let successor = started.last_mut().filter(|(at, _)| *at == index).map(|(_, dates)| (next.as_deref().unwrap_or_default(), dates));
                    end_series(&tx, old, &day.date, successor, &mut changed)?;
                }
                series.push(next);
            }
        }
        day.revision += 1;
        tx.execute("INSERT INTO days(date,title,body,revision) VALUES(?1,?2,?3,?4) ON CONFLICT(date) DO UPDATE SET title=excluded.title, body=excluded.body, revision=excluded.revision", params![day.date, day.title, day.body, day.revision])?;
        // Remove only entries actually taken out of this day. json_each avoids SQLite's parameter limit.
        let kept: Vec<&str> = day.entries.iter().map(|entry| entry.id.as_str()).collect();
        tx.execute("DELETE FROM entries WHERE day_date=?1 AND id NOT IN (SELECT value FROM json_each(?2))", params![day.date, serde_json::to_string(&kept)?])?;
        // Release only UIDs that change, before assigning any new ones. This preserves swaps within one save.
        {
            let mut clear = tx.prepare_cached("UPDATE entries SET calendar_uid=NULL WHERE id=?1 AND calendar_uid IS NOT NULL AND calendar_uid IS NOT ?2")?;
            for entry in &day.entries { clear.execute(params![entry.id, entry.calendar_uid])?; }
        }
        {
            let mut insert = tx.prepare_cached("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan,end_time,show_in_journal,calendar_uid,series,description,tag,reminder_before,icon) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
                ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,text=excluded.text,done=excluded.done,position=excluded.position,cancelled=excluded.cancelled,priority=excluded.priority,time=excluded.time,reminder=excluded.reminder,plan=excluded.plan,end_time=excluded.end_time,show_in_journal=excluded.show_in_journal,calendar_uid=excluded.calendar_uid,series=excluded.series,description=excluded.description,tag=excluded.tag,reminder_before=excluded.reminder_before,icon=excluded.icon
                WHERE (entries.kind,entries.text,entries.done,entries.position,entries.cancelled,entries.priority,entries.time,entries.reminder,entries.plan,entries.end_time,entries.show_in_journal,entries.calendar_uid,entries.series,entries.description,entries.tag,entries.reminder_before,entries.icon)
                  IS NOT (excluded.kind,excluded.text,excluded.done,excluded.position,excluded.cancelled,excluded.priority,excluded.time,excluded.reminder,excluded.plan,excluded.end_time,excluded.show_in_journal,excluded.calendar_uid,excluded.series,excluded.description,excluded.tag,excluded.reminder_before,excluded.icon)")?;
            for (position, entry) in day.entries.iter().enumerate() {
                let plan = entry.plan.as_ref().map(serde_json::to_string).transpose()?;
                insert.execute(params![entry.id,day.date,entry.kind,entry.text,entry.done,position as i64,entry.cancelled,entry.priority,entry.time,entry.reminder,plan,entry.end,entry.show_in_journal,entry.calendar_uid,series[position],entry.description,entry.tag,entry.reminder_before,entry.icon])?;
            }
        }
        // A series started here gets its further occurrences, as open copies with this entry's time and reminder.
        for (index, dates) in &started {
            let entry = &day.entries[*index];
            let copy = Template { kind: &entry.kind, text: &entry.text, description: &entry.description, tag: entry.tag.as_deref(), priority: entry.priority, time: entry.time.as_deref(), end: entry.end.as_deref(), reminder: entry.reminder, show_in_journal: entry.show_in_journal, reminder_before: entry.reminder_before, icon: entry.icon.as_deref() };
            for date in dates { add_copy(&tx, date, &Uuid::new_v4().to_string(), &copy, series[*index].as_deref())?; touched.insert(date.clone()); }
        }
        // A newly planned trace moves its entry: an open copy with the planned time and reminder is appended to every target day.
        // A repeating plan starts its series there; an entry that repeated already continues differently from then on.
        for (index, entry) in day.entries.iter().enumerate() {
            let Some(plan) = &entry.plan else { continue };
            let copy = Template { kind: &entry.kind, text: &entry.text, description: &entry.description, tag: entry.tag.as_deref(), priority: entry.priority, time: plan.time.as_deref(), end: plan.end.as_deref(), reminder: plan.reminder, show_in_journal: entry.show_in_journal, reminder_before: entry.reminder_before, icon: entry.icon.as_deref() };
            for target in plan.targets.iter().filter(|target| !created.contains(&target.id)) {
                let mut dates = Vec::new();
                let repeating = match &plan.repeat {
                    Some(repeat) if !series_exists(&tx, &repeat.series)? => {
                        start_series(&tx, repeat, &target.date)?;
                        dates.clone_from(&repeat.dates);
                        if let Some(old) = &series[index] { end_series(&tx, old, &day.date, Some((&repeat.series, &mut dates)), &mut changed)?; }
                        Some(repeat.series.as_str())
                    }
                    _ => None,
                };
                add_copy(&tx, &target.date, &target.id, &copy, repeating)?;
                touched.insert(target.date.clone());
                for date in &dates { add_copy(&tx, date, &Uuid::new_v4().to_string(), &copy, repeating)?; touched.insert(date.clone()); }
            }
        }
        for id in edited.iter().filter(|id| !day.keep_alone.contains(id)) {
            let entry = day.entries.iter().find(|entry| &entry.id == id).expect("edited entries come from this day");
            sync_linked(&tx, entry, &mut changed)?;
        }
        changed.remove(&day.date);
        for date in &changed { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        touched.extend(changed);
        touched.remove(&day.date);
        drop_empty_series(&tx)?;
        tx.commit()?;
        let mut saved = self.load(&day.date)?;
        saved.touched = touched.into_iter().collect();
        Ok(saved)
    }
    /// The group an entry belongs to – the entry itself, the traces it was planned from and the copies planned from it,
    /// along whole chains, and the other occurrences of its series – in date order.
    pub fn linked(&self, id: &str) -> Result<Vec<LinkedEntry>> {
        let mut group = Vec::new();
        let mut entry = self.conn.prepare_cached("SELECT day_date, kind, done, cancelled, plan IS NOT NULL, series FROM entries WHERE id=?1")?;
        for id in linked_ids(&self.conn, id)? {
            if let Some((date, kind, done, cancelled, trace, series)) = entry.query_row([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).optional()? {
                group.push(LinkedEntry { id, date, kind, done, cancelled, trace, series });
            }
        }
        group.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(group)
    }
    /// Removes entries or sets the status of tasks on other days in one go (an action reaching linked entries).
    /// Traces keep no status. Returns the days that changed. A series whose occurrences from some day on were all removed
    /// (the following ones of an occurrence) ends the day before, so that no new ones follow when its horizon moves on.
    /// Gives the chosen entries (of one group, on other days) the same kind, text, details and – when moved – times as an
    /// entry edited in the calendar. Traces stay as they are; a task becoming an event or note loses its state.
    pub fn edit_linked(&mut self, ids: &[String], edit: &LinkedEdit) -> Result<Vec<String>> {
        let times = edit.times.as_ref();
        if !matches!(edit.kind.as_str(), "task" | "event" | "note") || edit.text.len() > 20_000
            || times.is_some_and(|times| !valid_time(&times.time) || !valid_span(&times.time, &times.end) || (edit.kind == "note" && times.time.is_some())) {
            return Err("Ungültige Änderung".into());
        }
        let tx = self.conn.transaction()?;
        crate::history::begin(&tx)?;
        let mut touched = BTreeSet::new();
        {
            let mut update = tx.prepare_cached("UPDATE entries SET kind=?2, text=?3, description=?4, tag=(SELECT id FROM tags WHERE id=?5), priority=?6, reminder=?7, show_in_journal=?8, reminder_before=?12, icon=?13,
                done=CASE WHEN ?2='task' THEN done ELSE 0 END, cancelled=CASE WHEN ?2='task' THEN cancelled ELSE 0 END,
                time=CASE WHEN ?9 THEN ?10 ELSE time END, end_time=CASE WHEN ?9 THEN ?11 ELSE end_time END WHERE id=?1 AND plan IS NULL RETURNING day_date")?;
            for id in ids {
                let reminder = edit.reminder && edit.kind != "note";
                let date: Option<String> = update.query_row(params![id, edit.kind, edit.text, edit.description, edit.tag, edit.priority, reminder, edit.show_in_journal,
                    times.is_some(), times.and_then(|times| times.time.clone()), times.and_then(|times| times.end.clone()), edit.reminder_before, edit.icon], |r| r.get(0)).optional()?;
                touched.extend(date);
            }
            for date in &touched { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        }
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }
    pub fn change_linked(&mut self, changes: &[LinkedChange]) -> Result<Vec<String>> {
        let tx = self.conn.transaction()?;
        crate::history::begin(&tx)?;
        let mut touched = BTreeSet::new();
        {
            let mut remove = tx.prepare_cached("DELETE FROM entries WHERE id=?1 RETURNING day_date, series")?;
            let mut status = tx.prepare_cached("UPDATE entries SET done=?2, cancelled=?3 WHERE id=?1 AND kind='task' AND plan IS NULL AND (done<>?2 OR cancelled<>?3) RETURNING day_date")?;
            let mut removed_from: HashMap<String, String> = HashMap::new();
            for change in changes {
                let date: Option<String> = match change.action.as_str() {
                    "remove" => remove.query_row([&change.id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))).optional()?.map(|(date, series)| {
                        if let Some(series) = series { let first = removed_from.entry(series).or_insert_with(|| date.clone()); if date < *first { first.clone_from(&date); } }
                        date
                    }),
                    "done" | "cancelled" | "open" => status.query_row(params![change.id, change.action == "done", change.action == "cancelled"], |r| r.get(0)).optional()?,
                    _ => return Err("Unbekannte Änderung".into()),
                };
                touched.extend(date);
            }
            for (series, first) in &removed_from {
                if tx.prepare_cached("SELECT 1 FROM entries WHERE series=?1 AND day_date>=?2 LIMIT 1")?.query_row([series, first], |_| Ok(())).optional()?.is_none() {
                    tx.execute("UPDATE series SET rule=json_set(rule, '$.end', json_object('until', date(?2, '-1 day'))) WHERE id=?1", [series, first])?;
                }
            }
            for date in &touched { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        }
        drop_empty_series(&tx)?;
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }
    /// The reminders that became due since the last check (up to two weeks back, so ones missed while the app was closed –
    /// also for days – come once on the next start), and snoozed ones whose time has come. Each is returned once: they are logged as shown.
    /// A reminder set for a moment already past when it was set does not come, as that moment lies before the last check.
    pub fn due_reminders(&mut self, now: NaiveDateTime) -> Result<Vec<Reminder>> {
        let format = |moment: NaiveDateTime| moment.format("%Y-%m-%dT%H:%M").to_string();
        let tx = self.conn.transaction()?;
        crate::history::begin(&tx)?;
        let checked: Option<String> = tx.query_row("SELECT value FROM settings WHERE key='reminders.checked'", [], |r| r.get(0)).optional()?;
        let floor = now - Duration::days(14);
        let from = checked.and_then(|value| NaiveDateTime::parse_from_str(&value, "%Y-%m-%dT%H:%M:%S").ok()).map_or(now - Duration::minutes(1), |last| last.max(floor));
        let mut due = Vec::new();
        {
            // A reminder before its entry comes up to 30 days earlier: entries of the days ahead count as well.
            let mut stmt = tx.prepare_cached("SELECT id, day_date, kind, text, time, end_time, reminder_before FROM entries WHERE reminder=1 AND plan IS NULL AND kind<>'note' AND done=0 AND cancelled=0 AND day_date BETWEEN ?1 AND ?2 ORDER BY day_date, time, position")?;
            let ahead = (now + Duration::minutes(MAX_REMINDER_BEFORE)).date().to_string();
            let rows = stmt.query_map([from.date().to_string(), ahead], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, i64>(6)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut logged = tx.prepare_cached("INSERT OR IGNORE INTO reminder_log(id, due) VALUES(?1, ?2)")?;
            for (id, date, kind, text, time, end, before) in rows {
                let Ok(start) = NaiveDateTime::parse_from_str(&format!("{date}T{}", time.as_deref().unwrap_or(REMINDER_DEFAULT)), "%Y-%m-%dT%H:%M") else { continue };
                let moment = start - Duration::minutes(before.clamp(0, MAX_REMINDER_BEFORE));
                if moment <= from || moment > now { continue; }
                if logged.execute([&id, &format(moment)])? == 0 { continue; }
                due.push(Reminder { id, date, kind, text, time, end, due: format(moment), late: now - moment > Duration::minutes(2), snoozed: false });
            }
            let mut snoozed = tx.prepare_cached("SELECT l.id, l.due, e.day_date, e.kind, e.text, e.time, e.end_time FROM reminder_log l JOIN entries e ON e.id = l.id
                WHERE l.snooze IS NOT NULL AND l.snooze <= ?1 AND e.reminder=1 AND e.plan IS NULL AND e.done=0 AND e.cancelled=0 ORDER BY l.snooze")?;
            let rows = snoozed.query_map([format(now)], |r| Ok(Reminder { id: r.get(0)?, due: r.get(1)?, date: r.get(2)?, kind: r.get(3)?, text: r.get(4)?, time: r.get(5)?, end: r.get(6)?, late: true, snoozed: true }))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            due.extend(rows);
        }
        tx.execute("UPDATE reminder_log SET snooze=NULL WHERE snooze IS NOT NULL AND snooze <= ?1", [format(now)])?;
        tx.execute("DELETE FROM reminder_log WHERE due < ?1 AND snooze IS NULL", [format(now - Duration::days(3))])?;
        tx.execute("INSERT INTO settings(key, value) VALUES('reminders.checked', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [now.format("%Y-%m-%dT%H:%M:%S").to_string()])?;
        tx.commit()?;
        Ok(due)
    }
    /// Shows a reminder (`id`, `due`) again at `until`.
    pub fn snooze_reminder(&mut self, id: &str, due: &str, until: NaiveDateTime) -> Result<()> {
        self.conn.execute("INSERT INTO reminder_log(id, due, snooze) VALUES(?1, ?2, ?3) ON CONFLICT(id, due) DO UPDATE SET snooze=excluded.snooze", params![id, due, until.format("%Y-%m-%dT%H:%M").to_string()])?;
        Ok(())
    }
    /// Every series, for adding occurrences when the app's horizon moves on.
    pub fn series(&self) -> Result<Vec<SeriesInfo>> {
        let mut stmt = self.conn.prepare_cached("SELECT id, rule, horizon FROM series ORDER BY id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter().map(|(series, rule, horizon)| Ok(SeriesInfo { series, rule: serde_json::from_str(&rule)?, horizon })).collect()
    }
    /// Adds occurrences after a series' horizon, as open copies of its latest occurrence, and moves the horizon on.
    /// A series whose horizon is no longer `from` was extended already (by another window) and stays as it is.
    pub fn extend_series(&mut self, extensions: &[SeriesExtension]) -> Result<Vec<String>> {
        if extensions.iter().map(|extension| extension.dates.len()).sum::<usize>() > 20_000 { return Err("Zu viele Wiederholungen auf einmal".into()); }
        let tx = self.conn.transaction()?;
        crate::history::begin(&tx)?;
        let mut touched = BTreeSet::new();
        for extension in extensions {
            validate_date(&extension.from)?; validate_date(&extension.to)?;
            if extension.to < extension.from { return Err("Ungültige Wiederholung".into()); }
            let mut previous = extension.from.as_str();
            for date in &extension.dates {
                validate_date(date)?;
                if date.as_str() <= previous || date > &extension.to { return Err("Ungültige Wiederholung".into()); }
                previous = date;
            }
            let horizon: Option<String> = tx.prepare_cached("SELECT horizon FROM series WHERE id=?1")?.query_row([&extension.series], |r| r.get(0)).optional()?;
            if horizon.as_deref() != Some(extension.from.as_str()) { continue; }
            let latest: Option<((String, String, bool, Option<String>, Option<String>, bool, bool, String, Option<String>), (i64, Option<String>))> = tx.prepare_cached("SELECT kind, text, priority, time, end_time, reminder, show_in_journal, description, tag, reminder_before, icon FROM entries WHERE series=?1 ORDER BY plan IS NOT NULL, day_date DESC LIMIT 1")?
                .query_row([&extension.series], |r| Ok(((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?), (r.get(9)?, r.get(10)?)))).optional()?;
            let Some(((kind, text, priority, time, end, reminder, show_in_journal, description, tag), (reminder_before, icon))) = latest else { continue };
            let copy = Template { kind: &kind, text: &text, description: &description, tag: tag.as_deref(), priority, time: time.as_deref(), end: end.as_deref(), reminder, show_in_journal, reminder_before, icon: icon.as_deref() };
            for date in &extension.dates { add_copy(&tx, date, &Uuid::new_v4().to_string(), &copy, Some(&extension.series))?; touched.insert(date.clone()); }
            tx.execute("UPDATE series SET horizon=?2 WHERE id=?1", [&extension.series, &extension.to])?;
        }
        drop_empty_series(&tx)?;
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }
}
/// Every entry linked with `id` (itself included): through plan targets in both directions and through series, along
/// whole chains. The plan links are read once; a series' occurrences once per series.
fn linked_ids(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut links: HashMap<String, Vec<String>> = HashMap::new();
    let mut plans = conn.prepare_cached("SELECT e.id, json_extract(t.value, '$.id') FROM entries e, json_each(e.plan, '$.targets') t")?;
    for row in plans.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (trace, target) = row?;
        links.entry(trace.clone()).or_default().push(target.clone());
        links.entry(target).or_default().push(trace);
    }
    let mut series_of = conn.prepare_cached("SELECT series FROM entries WHERE id=?1")?;
    let mut members = conn.prepare_cached("SELECT id FROM entries WHERE series=?1")?;
    let (mut seen, mut series_seen) = (HashSet::from([id.to_string()]), HashSet::new());
    let mut order = vec![id.to_string()];
    let mut queue = VecDeque::from([id.to_string()]);
    while let Some(current) = queue.pop_front() {
        let mut next = links.get(&current).cloned().unwrap_or_default();
        if let Some(series) = series_of.query_row([&current], |r| r.get::<_, Option<String>>(0)).optional()?.flatten() {
            if series_seen.insert(series.clone()) { next.extend(members.query_map([&series], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?); }
        }
        for other in next { if seen.insert(other.clone()) { order.push(other.clone()); queue.push_back(other); } }
    }
    Ok(order)
}
/// An entry and the places it was planned to are one item: a new text, kind, priority or tag reaches all of them, along whole
/// chains (planned on again) and in both directions (from a trace to its copies and from a copy back to its trace).
/// Only the task keeps a done or cancelled state; the time and status of each occurrence stay its own.
fn sync_linked(tx: &Connection, entry: &Entry, touched: &mut BTreeSet<String>) -> Result<()> {
    let mut update = tx.prepare_cached("UPDATE entries SET kind=?2, text=?3, priority=?4, description=?5, tag=?6, icon=?7, done=CASE WHEN ?2='task' THEN done ELSE 0 END, cancelled=CASE WHEN ?2='task' THEN cancelled ELSE 0 END
        WHERE id=?1 AND (kind<>?2 OR text<>?3 OR priority<>?4 OR description<>?5 OR tag IS NOT ?6 OR icon IS NOT ?7) RETURNING day_date")?;
    for other in linked_ids(tx, &entry.id)?.into_iter().skip(1) {
        if let Some(date) = update.query_row(params![other, entry.kind, entry.text, entry.priority, entry.description, entry.tag, entry.icon], |r| r.get::<_, String>(0)).optional()? { touched.insert(date); }
    }
    Ok(())
}
/// The series columns of a loaded entry (`series`, `rule`, `horizon`).
fn repeat_of((series, rule, horizon): (Option<String>, Option<String>, Option<String>)) -> Result<Option<Repeat>> {
    let (Some(series), Some(rule), Some(horizon)) = (series, rule, horizon) else { return Ok(None) };
    Ok(Some(Repeat { series, rule: Some(serde_json::from_str(&rule)?), horizon, dates: vec![] }))
}
fn series_exists(tx: &Connection, id: &str) -> Result<bool> {
    Ok(tx.prepare_cached("SELECT 1 FROM series WHERE id=?1")?.query_row([id], |_| Ok(())).optional()?.is_some())
}
/// Stores a new series whose first occurrence is on `first`; its further `dates` follow, up to its horizon.
fn start_series(tx: &Connection, repeat: &Repeat, first: &str) -> Result<()> {
    let invalid = || -> Box<dyn Error> { "Ungültige Wiederholung".into() };
    let rule = repeat.rule.as_ref().filter(|rule| rule.is_object()).ok_or_else(invalid)?;
    let start = rule.get("start").and_then(serde_json::Value::as_str).ok_or_else(invalid)?;
    let text = serde_json::to_string(rule)?;
    validate_date(start)?; validate_date(&repeat.horizon)?;
    if Uuid::parse_str(&repeat.series).is_err() || start > first || repeat.horizon.as_str() < first || repeat.dates.len() > 5000 || text.len() > 4096 { return Err(invalid()); }
    let mut previous = first;
    for date in &repeat.dates {
        validate_date(date)?;
        if date.as_str() <= previous || date > &repeat.horizon { return Err(invalid()); }
        previous = date;
    }
    tx.execute("INSERT INTO series(id, rule, horizon) VALUES(?1, ?2, ?3)", params![repeat.series, text, repeat.horizon])?;
    Ok(())
}
/// The entry on `date` leaves `series` (its rule changed from there, or it stopped repeating): the series ends the day
/// before, its open occurrences after `date` go. Finished ones stay – in the `successor` when that has the same date too,
/// which then is not created again.
fn end_series(tx: &Connection, series: &str, date: &str, successor: Option<(&str, &mut Vec<String>)>, touched: &mut BTreeSet<String>) -> Result<()> {
    let mut removed = tx.prepare_cached("DELETE FROM entries WHERE series=?1 AND day_date>?2 AND plan IS NULL AND done=0 AND cancelled=0 RETURNING day_date")?;
    for day in removed.query_map([series, date], |r| r.get::<_, String>(0))? { touched.insert(day?); }
    if let Some((next, dates)) = successor {
        let kept = tx.prepare_cached("SELECT id, day_date FROM entries WHERE series=?1 AND day_date>?2")?
            .query_map([series, date], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, day) in kept {
            let Ok(index) = dates.binary_search(&day) else { continue };
            dates.remove(index);
            tx.execute("UPDATE entries SET series=?2 WHERE id=?1", [&id, next])?;
            touched.insert(day);
        }
    }
    tx.execute("UPDATE series SET rule=json_set(rule, '$.end', json_object('until', date(?2, '-1 day'))) WHERE id=?1", [series, date])?;
    Ok(())
}
/// What a copy (planned or repeated) takes from its original.
struct Template<'a> { kind: &'a str, text: &'a str, description: &'a str, tag: Option<&'a str>, priority: bool, time: Option<&'a str>, end: Option<&'a str>, reminder: bool, show_in_journal: bool, reminder_before: i64, icon: Option<&'a str> }
/// Appends an open copy to `date` (creating the day if needed, otherwise marking it changed).
fn add_copy(tx: &Connection, date: &str, id: &str, copy: &Template, series: Option<&str>) -> Result<()> {
    if tx.prepare_cached("SELECT 1 FROM entries WHERE id=?1")?.query_row([id], |_| Ok(())).optional()?.is_some() { return Err("Der geplante Eintrag existiert bereits".into()); }
    tx.prepare_cached("INSERT INTO days(date,title,body,revision) VALUES(?1,'','',1) ON CONFLICT(date) DO UPDATE SET revision=revision+1")?.execute([date])?;
    let position: i64 = tx.prepare_cached("SELECT COALESCE(MAX(position)+1,0) FROM entries WHERE day_date=?1")?.query_row([date], |r| r.get(0))?;
    tx.prepare_cached("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan,end_time,show_in_journal,calendar_uid,series,description,tag,reminder_before,icon) VALUES(?1,?2,?3,?4,0,?5,0,?6,?7,?8,NULL,?9,?10,NULL,?11,?12,?13,?14,?15)")?
        .execute(params![id, date, copy.kind, copy.text, position, copy.priority, copy.time, copy.reminder, copy.end, copy.show_in_journal, series, copy.description, copy.tag, copy.reminder_before, copy.icon])?;
    Ok(())
}
/// A series without occurrences is gone.
fn drop_empty_series(tx: &Connection) -> Result<()> {
    tx.execute("DELETE FROM series WHERE NOT EXISTS (SELECT 1 FROM entries e WHERE e.series = series.id)", [])?;
    Ok(())
}
fn valid_time(time: &Option<String>) -> bool {
    time.as_deref().is_none_or(|time| time.len() == 5 && chrono::NaiveTime::parse_from_str(time, "%H:%M").is_ok())
}
/// An end needs a start and lies after it – on the same day, or on the next as 24:00–47:59 ("26:00" is 02:00 the next morning).
fn valid_span(time: &Option<String>, end: &Option<String>) -> bool {
    let minutes=|value:&str| -> Option<u32> {let (h,m)=value.split_once(':')?;if h.len()<2 || h.len()>4 || m.len()!=2{return None;}let h=h.parse::<u32>().ok()?;let m=m.parse::<u32>().ok()?;if h>8784 || m>59{return None;}Some(h*60+m)};
    match (time,end){(_,None)=>true,(Some(time),Some(end))=>minutes(end).zip(minutes(time)).is_some_and(|(end,start)|end>start && end-start<=366*1440),_=>false}

}
fn validate_date(date: &str) -> Result<()> {
    let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")?;
    if parsed.format("%Y-%m-%d").to_string() != date { return Err("Ungültiges Datum".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn store() -> Store { Store::from_connection(Connection::open_in_memory().unwrap()).unwrap() }
    fn entry(kind: &str) -> Entry { Entry { id:Uuid::new_v4().to_string(), kind:kind.into(), text:"Beispiel".into(), done:false, cancelled:false, priority:false, time:None, end:None, reminder:false, plan:None, origin:None, show_in_journal:true, calendar_uid:None, description:String::new(), tag:None, repeat:None, reminder_before:0, icon:None } }
    fn plan(via: &str, dates: &[&str], time: Option<&str>, reminder: bool) -> Plan {
        Plan { via: via.into(), targets: dates.iter().map(|date| PlanTarget { date: (*date).into(), id: Uuid::new_v4().to_string() }).collect(), time: time.map(Into::into), end: None, reminder, repeat: None }
    }
    fn weekly_rule(start: &str, every: u32) -> serde_json::Value { serde_json::json!({ "start": start, "unit": "week", "every": every }) }
    fn repeat(rule: serde_json::Value, dates: &[&str], horizon: &str) -> Repeat {
        Repeat { series: Uuid::new_v4().to_string(), rule: Some(rule), horizon: horizon.into(), dates: dates.iter().map(|date| (*date).into()).collect() }
    }
    #[test] fn moving_calendar_entry_preserves_tag_span_and_plan_references() {
        let mut db=store(); let work=tag("Arbeit", "#569eff"); db.save_tags(&[work.clone()]).unwrap();
        let mut day=db.load("2026-11-01").unwrap(); let mut item=entry("task");
        let planned=plan("date", &["2026-11-02"], None, false); let id=planned.targets[0].id.clone(); item.plan=Some(planned); day.entries.push(item); db.save(day).unwrap();
        let mut copy=db.load("2026-11-02").unwrap(); copy.entries[0].tag=Some(work.id.clone()); db.save(copy).unwrap();
        let touched=db.move_calendar_entry(&id,"2026-11-02","2026-11-04",Some("10:00".into()),Some("58:00".into())).unwrap();
        assert!(touched.contains(&"2026-11-01".into()));
        let moved=db.load("2026-11-04").unwrap().entries.remove(0);
        assert_eq!((moved.id.as_str(),moved.tag.as_deref(),moved.time.as_deref(),moved.end.as_deref()),(id.as_str(),Some(work.id.as_str()),Some("10:00"),Some("58:00")));
        assert_eq!(db.load("2026-11-01").unwrap().entries[0].plan.as_ref().unwrap().targets[0].date,"2026-11-04");
        assert!(db.move_calendar_entry(&id,"2026-11-02","2026-11-05",None,None).is_err());
        assert_eq!(db.load("2026-11-04").unwrap().entries[0].id,id);
    }
    /// A task "Sport" at 18:00 every Monday from 2 November, created up to the 29th; returns the series.
    fn weekly(db: &mut Store) -> String {
        let mut day = db.load("2026-11-02").unwrap();
        let mut task = entry("task"); task.text = "Sport".into(); task.description = "Schuhe mitbringen".into(); task.time = Some("18:00".into());
        let series = repeat(weekly_rule("2026-11-02", 1), &["2026-11-09", "2026-11-16", "2026-11-23"], "2026-11-29");
        let id = series.series.clone(); task.repeat = Some(series); day.entries.push(task);
        assert_eq!(db.save(day).unwrap().touched, vec!["2026-11-09", "2026-11-16", "2026-11-23"]);
        id
    }
    #[test] fn descriptions_survive_save_planning_and_linked_edits() {
        let mut db=store(); let mut day=db.load("2026-11-01").unwrap();
        let mut item=entry("event"); item.description="Raum 2\nUnterlagen mitbringen".into();
        item.plan=Some(plan("tomorrow",&["2026-11-02"],None,false)); day.entries.push(item);
        db.save(day).unwrap();
        let mut copy=db.load("2026-11-02").unwrap();
        assert_eq!(copy.entries[0].description,"Raum 2\nUnterlagen mitbringen");
        assert_eq!(db.load_range("2026-11-02","2026-11-02").unwrap()[0].entries[0].description,copy.entries[0].description);
        copy.entries[0].description="Raum 3".into(); db.save(copy).unwrap();
        assert_eq!(db.load("2026-11-01").unwrap().entries[0].description,"Raum 3");
    }
    #[test] fn imported_descriptions_update_and_remain_in_calendar_exports() {
        let mut db=store(); let mut item=entry("event"); item.calendar_uid=Some("details@example.org".into()); item.description="Erste Beschreibung".into();
        db.import_calendar(vec![CalendarImport { tag:None, date:"2026-11-01".into(),entry:item.clone() }]).unwrap();
        item.description="Neue Beschreibung\nMit Details".into();
        db.import_calendar(vec![CalendarImport { tag:None, date:"2026-11-02".into(),entry:item.clone() }]).unwrap();
        let exported=db.export_calendar().unwrap(); assert_eq!(exported.len(),1);
        assert_eq!(exported[0].entries[0].description,item.description);
        assert!(db.load("2026-11-01").unwrap().entries.is_empty());
    }
    #[test] fn version_eight_migration_preserves_entries_and_reopening_keeps_descriptions() {
        let mut db=store(); let mut day=db.load("2026-11-01").unwrap();
        let mut item=entry("event"); item.time=Some("04:00".into()); day.entries.push(item.clone()); db.save(day).unwrap();
        let conn=db.conn;
        conn.execute_batch("DROP TRIGGER IF EXISTS temp.undo_entries_INSERT; DROP TRIGGER IF EXISTS temp.undo_entries_UPDATE; DROP TRIGGER IF EXISTS temp.undo_entries_DELETE; ALTER TABLE entries DROP COLUMN description; PRAGMA user_version=8;").unwrap();
        let mut migrated=Store::from_connection(conn).unwrap(); let mut loaded=migrated.load("2026-11-01").unwrap();
        assert_eq!(loaded.entries[0].id,item.id); assert_eq!(loaded.entries[0].time,item.time); assert!(loaded.entries[0].description.is_empty());
        loaded.entries[0].description="Nach der Migration".into(); migrated.save(loaded).unwrap();
        let reopened=Store::from_connection(migrated.conn).unwrap(); assert_eq!(reopened.load("2026-11-01").unwrap().entries[0].description,"Nach der Migration");
    }
    #[test] fn display_language_persists_independently_of_journal_entries() {
        let db=store(); assert_eq!(db.interface_language().unwrap(),"de");
        db.set_interface_language("en").unwrap();
        let reopened=Store::from_connection(db.conn).unwrap();
        assert_eq!(reopened.interface_language().unwrap(),"en");
        assert!(reopened.export_calendar().unwrap().is_empty());
    }
    #[test] fn repeating_entries_become_linked_occurrences() {
        let mut db = store();
        let series = weekly(&mut db);
        for date in ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"] {
            let day = db.load(date).unwrap();
            assert_eq!(day.entries.len(), 1, "{date}");
            let item = &day.entries[0];
            assert_eq!((item.text.as_str(), item.time.as_deref(), item.done), ("Sport", Some("18:00"), false));
            let repeat = item.repeat.as_ref().unwrap();
            assert_eq!((repeat.series.as_str(), repeat.horizon.as_str()), (series.as_str(), "2026-11-29"));
            assert_eq!(repeat.rule.as_ref().unwrap()["every"], 1);
        }
        assert_eq!(db.load_range("2026-11-01", "2026-11-30").unwrap().iter().filter(|day| day.entries[0].repeat.is_some()).count(), 4);
        let first = db.load("2026-11-02").unwrap();
        let group = db.linked(&first.entries[0].id).unwrap();
        assert_eq!(group.len(), 4); assert!(group.iter().all(|item| item.series.as_deref() == Some(series.as_str())));
        // Saving again (with the series as loaded) creates nothing; an edit reaches every occurrence, the status stays each one's own.
        let mut again = first; again.entries[0].text = "Laufen".into(); again.entries[0].done = true;
        assert_eq!(db.save(again).unwrap().touched, vec!["2026-11-09", "2026-11-16", "2026-11-23"]);
        let later = &db.load("2026-11-16").unwrap().entries[0];
        assert_eq!(later.text, "Laufen"); assert!(!later.done);
        assert_eq!(db.load("2026-11-09").unwrap().entries.len(), 1);
        // An entry without `repeat` (as an older window would send it) stays in its series.
        let mut plain = db.load("2026-11-09").unwrap(); plain.entries[0].repeat = None; plain.title = "Titel".into(); db.save(plain).unwrap();
        assert!(db.load("2026-11-09").unwrap().entries[0].repeat.is_some());
    }
    #[test] fn a_changed_rule_continues_the_series_from_that_occurrence() {
        let mut db = store();
        let old = weekly(&mut db);
        let mut finished = db.load("2026-11-23").unwrap(); finished.entries[0].done = true; db.save(finished).unwrap();
        // From the 9th on every second week: the open 16th goes, the finished 23rd stays and now belongs to the new series.
        let mut day = db.load("2026-11-09").unwrap();
        let next = repeat(weekly_rule("2026-11-09", 2), &["2026-11-23", "2026-12-07", "2026-12-21"], "2026-12-31");
        let new = next.series.clone(); day.entries[0].repeat = Some(next);
        assert_eq!(db.save(day).unwrap().touched, vec!["2026-11-16", "2026-11-23", "2026-12-07", "2026-12-21"]);
        assert!(db.load("2026-11-16").unwrap().entries.is_empty());
        let kept = db.load("2026-11-23").unwrap();
        assert_eq!(kept.entries.len(), 1); assert!(kept.entries[0].done); assert_eq!(kept.entries[0].repeat.as_ref().unwrap().series, new);
        assert_eq!(db.load("2026-12-21").unwrap().entries[0].repeat.as_ref().unwrap().series, new);
        let past = db.load("2026-11-02").unwrap();
        let rule = past.entries[0].repeat.as_ref().unwrap().rule.clone().unwrap();
        assert_eq!(past.entries[0].repeat.as_ref().unwrap().series, old);
        assert_eq!(rule["end"]["until"], "2026-11-08", "The old series ends the day before.");
        assert_eq!(db.linked(&past.entries[0].id).unwrap().len(), 1);
        assert_eq!(db.linked(&kept.entries[0].id).unwrap().len(), 4);
        // Without a rule the entry stops repeating: it stays, later open occurrences go, earlier ones keep their series.
        let mut day = db.load("2026-12-07").unwrap();
        day.entries[0].repeat = Some(Repeat { series: Uuid::new_v4().to_string(), rule: None, horizon: String::new(), dates: vec![] });
        assert_eq!(db.save(day).unwrap().touched, vec!["2026-12-21"]);
        assert!(db.load("2026-12-07").unwrap().entries[0].repeat.is_none());
        assert!(db.load("2026-12-21").unwrap().entries.is_empty());
        assert_eq!(db.load("2026-11-09").unwrap().entries[0].repeat.as_ref().unwrap().rule.as_ref().unwrap()["end"]["until"], "2026-12-06");
    }
    #[test] fn planning_can_start_a_series_on_another_day() {
        let mut db = store();
        let mut day = db.load("2026-10-30").unwrap();
        let mut birthday = entry("event"); birthday.text = "Geburtstag".into();
        let mut p = plan("date", &["2027-03-12"], None, true);
        p.repeat = Some(repeat(serde_json::json!({ "start": "2027-03-12", "unit": "year", "every": 1, "on": "date" }), &["2028-03-12"], "2028-12-31"));
        birthday.plan = Some(p); day.entries.push(birthday);
        assert_eq!(db.save(day).unwrap().touched, vec!["2027-03-12", "2028-03-12"]);
        let copy = &db.load("2027-03-12").unwrap().entries[0];
        assert_eq!(copy.origin.as_deref(), Some("2026-10-30")); assert!(copy.reminder);
        assert_eq!(db.load("2028-03-12").unwrap().entries[0].repeat.as_ref().unwrap().series, copy.repeat.as_ref().unwrap().series);
        assert_eq!(db.linked(&copy.id).unwrap().len(), 3, "Trace, copy and the further occurrence.");
        // Saving the trace again starts nothing anew.
        let mut again = db.load("2026-10-30").unwrap(); again.title = "Noch einmal".into();
        assert!(db.save(again).unwrap().touched.is_empty());
        assert_eq!(db.series().unwrap().len(), 1);
    }
    #[test] fn series_extend_once_and_end_with_their_occurrences() {
        let mut db = store();
        let series = weekly(&mut db);
        let info = db.series().unwrap();
        assert_eq!((info.len(), info[0].series.as_str(), info[0].horizon.as_str()), (1, series.as_str(), "2026-11-29"));
        let extension = SeriesExtension { series: series.clone(), from: "2026-11-29".into(), to: "2026-12-13".into(), dates: vec!["2026-11-30".into(), "2026-12-07".into()] };
        assert_eq!(db.extend_series(std::slice::from_ref(&extension)).unwrap(), vec!["2026-11-30", "2026-12-07"]);
        assert!(db.extend_series(&[extension]).unwrap().is_empty(), "Another window extended it already.");
        let added = &db.load("2026-12-07").unwrap().entries[0];
        assert_eq!((added.text.as_str(), added.time.as_deref()), ("Sport", Some("18:00")));
        assert_eq!(added.description, "Schuhe mitbringen");
        assert_eq!(added.repeat.as_ref().unwrap().horizon, "2026-12-13");
        assert!(db.extend_series(&[SeriesExtension { series: series.clone(), from: "2026-12-13".into(), to: "2026-12-20".into(), dates: vec!["2026-12-13".into()] }]).is_err(), "Dates lie after the horizon.");
        // Removing one occurrence in between keeps the series going; removing all from the 30th on ends it the day before;
        // removing all of them removes it.
        fn ids(db: &Store, date: &str) -> String { db.load(date).unwrap().entries[0].id.clone() }
        let (middle, later, last) = (ids(&db, "2026-11-16"), ids(&db, "2026-11-30"), ids(&db, "2026-12-07"));
        db.change_linked(&[LinkedChange { id: middle, action: "remove".into() }]).unwrap();
        assert!(db.series().unwrap()[0].rule.get("end").is_none());
        db.change_linked(&[LinkedChange { id: later, action: "remove".into() }, LinkedChange { id: last, action: "remove".into() }]).unwrap();
        assert_eq!(db.series().unwrap()[0].rule["end"]["until"], "2026-11-29");
        let rest: Vec<LinkedChange> = ["2026-11-02", "2026-11-09", "2026-11-23"].iter().map(|date| LinkedChange { id: ids(&db, date), action: "remove".into() }).collect();
        db.change_linked(&rest).unwrap();
        assert!(db.series().unwrap().is_empty());
    }
    #[test] fn invalid_repeats_are_rejected_without_writes() {
        let mut db = store();
        let rule = weekly_rule("2026-11-02", 1);
        let invalid = [
            { let mut e = entry("note"); e.repeat = Some(repeat(rule.clone(), &[], "2026-12-31")); e },
            { let mut e = entry("task"); e.repeat = Some(repeat(rule.clone(), &["2026-11-02"], "2026-12-31")); e },
            { let mut e = entry("task"); e.repeat = Some(repeat(rule.clone(), &["2026-11-16", "2026-11-09"], "2026-12-31")); e },
            { let mut e = entry("task"); e.repeat = Some(repeat(rule.clone(), &["2027-01-04"], "2026-12-31")); e },
            { let mut e = entry("task"); e.repeat = Some(repeat(weekly_rule("2026-11-03", 1), &[], "2026-12-31")); e },
            { let mut e = entry("task"); e.repeat = Some(repeat(serde_json::json!(7), &[], "2026-12-31")); e },
            { let mut e = entry("task"); e.repeat = Some(repeat(rule.clone(), &[], "2026-11-01")); e },
            { let mut e = entry("task"); let mut r = repeat(rule.clone(), &[], "2026-12-31"); r.series = "series".into(); e.repeat = Some(r); e },
            { let mut e = entry("task"); let mut p = plan("days", &["2026-11-09", "2026-11-10"], None, false); p.repeat = Some(repeat(weekly_rule("2026-11-09", 1), &[], "2026-12-31")); e.plan = Some(p); e },
        ];
        for item in invalid {
            let mut day = db.load("2026-11-02").unwrap(); day.entries.push(item);
            assert!(db.save(day).is_err());
        }
        assert!(db.load("2026-11-02").unwrap().entries.is_empty()); assert!(db.load("2026-11-09").unwrap().entries.is_empty());
        assert!(db.series().unwrap().is_empty());
    }
    fn at(value: &str) -> NaiveDateTime { NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M").unwrap() }
    #[test] fn reminders_come_once_at_their_time_and_again_when_snoozed() {
        let mut db = store();
        let mut day = db.load("2026-10-30").unwrap();
        let mut timed = entry("task"); timed.text = "Anrufen".into(); timed.time = Some("14:15".into()); timed.reminder = true;
        let mut untimed = entry("event"); untimed.reminder = true;
        let mut silent = entry("task"); silent.time = Some("14:15".into());
        let mut finished = entry("task"); finished.time = Some("14:15".into()); finished.reminder = true; finished.done = true;
        day.entries = vec![timed.clone(), untimed.clone(), silent, finished];
        db.save(day).unwrap();
        assert!(db.due_reminders(at("2026-10-30T08:00")).unwrap().is_empty(), "The first check only starts the clock.");
        let morning = db.due_reminders(at("2026-10-30T09:00")).unwrap();
        assert_eq!(morning.iter().map(|r| (r.id.as_str(), r.due.as_str(), r.late)).collect::<Vec<_>>(), vec![(untimed.id.as_str(), "2026-10-30T09:00", false)], "Without a time at nine.");
        assert!(db.due_reminders(at("2026-10-30T14:14")).unwrap().is_empty());
        let afternoon = db.due_reminders(at("2026-10-30T14:15")).unwrap();
        assert_eq!(afternoon.len(), 1, "Only open entries with the bell, and each once.");
        assert_eq!((afternoon[0].text.as_str(), afternoon[0].time.as_deref(), afternoon[0].kind.as_str()), ("Anrufen", Some("14:15"), "task"));
        assert!(db.due_reminders(at("2026-10-30T14:16")).unwrap().is_empty());
        db.snooze_reminder(&timed.id, "2026-10-30T14:15", at("2026-10-30T14:25")).unwrap();
        assert!(db.due_reminders(at("2026-10-30T14:20")).unwrap().is_empty());
        let again = db.due_reminders(at("2026-10-30T14:25")).unwrap();
        assert_eq!((again.len(), again[0].snoozed, again[0].due.as_str()), (1, true, "2026-10-30T14:15"));
        assert!(db.due_reminders(at("2026-10-30T14:30")).unwrap().is_empty());
        // A time moved to later reminds again at the new time; one set into the past does not come.
        let mut day = db.load("2026-10-30").unwrap(); day.entries[0].time = Some("16:00".into()); day.entries[1].time = Some("10:00".into()); db.save(day).unwrap();
        assert!(db.due_reminders(at("2026-10-30T15:00")).unwrap().is_empty());
        assert_eq!(db.due_reminders(at("2026-10-30T16:00")).unwrap()[0].id, timed.id);
    }
    #[test] fn snoozing_with_real_clock_values() {
        let mut db = store();
        let exact = |value: &str| NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f").unwrap();
        db.due_reminders(exact("2026-10-30T14:10:01.123")).unwrap();
        let mut day = db.load("2026-10-30").unwrap();
        let mut task = entry("task"); task.time = Some("14:15".into()); task.reminder = true; day.entries.push(task); db.save(day).unwrap();
        for minute in 11..15 { assert!(db.due_reminders(exact(&format!("2026-10-30T14:{minute}:01.5"))).unwrap().is_empty()); }
        let shown = db.due_reminders(exact("2026-10-30T14:15:01.2")).unwrap();
        assert_eq!(shown.len(), 1);
        db.snooze_reminder(&shown[0].id, &shown[0].due, exact("2026-10-30T14:15:40.7") + Duration::minutes(10)).unwrap();
        let mut back = Vec::new();
        for minute in 16..30 { back.extend(db.due_reminders(exact(&format!("2026-10-30T14:{minute}:01.4"))).unwrap().into_iter().map(|r| (minute, r.snoozed))); }
        assert_eq!(back, vec![(25, true)]);
    }
    #[test] fn reminders_come_ahead_of_their_entry_and_icons_reach_copies() {
        let mut db = store();
        db.due_reminders(at("2026-10-29T20:00")).unwrap();
        let mut day = db.load("2026-10-30").unwrap();
        let mut early = entry("event"); early.text = "Zahnarzt".into(); early.time = Some("09:00".into()); early.reminder = true; early.reminder_before = 60; early.icon = Some("stethoscope".into());
        let mut ahead = entry("task"); ahead.time = Some("08:00".into()); ahead.reminder = true; ahead.reminder_before = 24 * 60;
        day.entries = vec![early.clone(), ahead.clone()];
        db.save(day).unwrap();
        // A day ahead: the entry of the 30th comes on the evening before.
        let before = db.due_reminders(at("2026-10-29T20:00")).unwrap();
        assert!(before.is_empty());
        let night = db.due_reminders(at("2026-10-29T23:59")).unwrap();
        assert!(night.is_empty());
        let morning = db.due_reminders(at("2026-10-30T08:00")).unwrap();
        assert_eq!(morning.iter().map(|r| (r.id.as_str(), r.due.as_str())).collect::<Vec<_>>(), vec![(early.id.as_str(), "2026-10-30T08:00")], "An hour ahead of nine.");
        assert!(db.due_reminders(at("2026-10-30T09:00")).unwrap().is_empty(), "Only once, not at the time again.");
        let loaded = db.load("2026-10-30").unwrap();
        assert_eq!((loaded.entries[0].reminder_before, loaded.entries[0].icon.as_deref()), (60, Some("stethoscope")));
        // Invalid lead times and icons are refused.
        let mut wrong = loaded.clone(); wrong.entries[0].reminder_before = MAX_REMINDER_BEFORE + 1; assert!(db.save(wrong).is_err());
        let mut wrong = loaded.clone(); wrong.entries[0].icon = Some("Not An Icon".into()); assert!(db.save(wrong).is_err());
        // A repeating entry's copies take its icon and lead time.
        let mut series = loaded.clone();
        series.entries[0].repeat = Some(serde_json::from_value(serde_json::json!({"series": Uuid::new_v4().to_string(), "rule": "FREQ=DAILY", "horizon": "2026-11-01", "dates": ["2026-10-31"]})).unwrap());
        if db.save(series).is_ok() {
            let copy = &db.load("2026-10-31").unwrap().entries[0];
            assert_eq!((copy.reminder_before, copy.icon.as_deref()), (60, Some("stethoscope")));
        }
    }
    #[test] fn reminders_missed_while_closed_come_late_once() {
        let mut db = store();
        db.due_reminders(at("2026-10-29T22:00")).unwrap();
        let mut day = db.load("2026-10-30").unwrap();
        let mut early = entry("task"); early.time = Some("07:30".into()); early.reminder = true;
        let mut planned = entry("task"); planned.time = Some("07:30".into()); planned.reminder = true; planned.plan = Some(plan("date", &["2026-11-02"], Some("07:30"), true));
        day.entries = vec![early.clone(), planned]; db.save(day).unwrap();
        let missed = db.due_reminders(at("2026-10-30T11:00")).unwrap();
        assert_eq!(missed.iter().map(|r| (r.id.as_str(), r.late)).collect::<Vec<_>>(), vec![(early.id.as_str(), true)], "A trace does not remind; its copy will.");
        assert!(db.due_reminders(at("2026-10-30T11:01")).unwrap().is_empty());
        assert_eq!(db.due_reminders(at("2026-11-02T07:30")).unwrap().len(), 1, "The planned copy on its day.");
    }
    #[test] fn calendar_only_entries_survive_daily_saves_and_planning() {
        let mut db = store();
        let mut day = db.load("2026-10-30").unwrap();
        let mut hidden = entry("event"); hidden.show_in_journal = false; hidden.time = Some("23:00".into()); hidden.end = Some("24:00".into());
        day.entries = vec![entry("note"), hidden];
        let mut saved = db.save(day).unwrap();
        assert!(!saved.entries[1].show_in_journal);
        saved.title = "Daily edit".into();
        let mut saved = db.save(saved).unwrap();
        assert!(!db.load_range("2026-10-30", "2026-10-30").unwrap()[0].entries[1].show_in_journal);
        let exported = db.export_calendar().unwrap();
        assert_eq!(exported[0].entries.len(), 1);
        assert_eq!(exported[0].entries[0].end.as_deref(), Some("24:00"));
        saved.entries[1].plan = Some(plan("date", &["2026-10-31"], None, false)); db.save(saved).unwrap();
        assert!(!db.load("2026-10-31").unwrap().entries[0].show_in_journal);
    }
    #[test] fn calendar_import_updates_uids_moves_dates_and_preserves_notes() {
        let mut db = store();
        let mut day = db.load("2026-10-30").unwrap(); day.body = "Keep body".into(); day.entries.push(entry("note")); db.save(day).unwrap();
        let mut event = entry("event"); event.calendar_uid = Some("external-event".into()); event.show_in_journal = false;
        let first_id = event.id.clone();
        db.import_calendar(vec![CalendarImport { tag:None, date:"2026-10-30".into(), entry:event.clone() }]).unwrap();
        event.id = Uuid::new_v4().to_string(); event.text = "Changed".into(); event.show_in_journal = true;
        let touched = db.import_calendar(vec![CalendarImport { tag:None, date:"2026-11-01".into(), entry:event.clone() }]).unwrap();
        assert_eq!(touched, vec!["2026-10-30", "2026-11-01"]);
        let original = db.load("2026-10-30").unwrap(); assert_eq!(original.body, "Keep body"); assert_eq!(original.entries.len(), 1);
        let imported = &db.load("2026-11-01").unwrap().entries[0]; assert_eq!(imported.id, first_id); assert!(imported.show_in_journal); assert_eq!(imported.text, "Changed");
        db.import_calendar(vec![CalendarImport { tag:None, date:"2026-11-01".into(), entry:event }]).unwrap();
        assert_eq!(db.load("2026-11-01").unwrap().entries.len(), 1);
    }
    #[test] fn invalid_calendar_import_rolls_back_and_old_json_defaults_to_visible() {
        let mut db = store();
        let mut valid = entry("event"); valid.calendar_uid = Some("valid".into());
        let mut invalid = entry("event"); invalid.calendar_uid = Some("invalid".into()); invalid.time = Some("25:00".into());
        assert!(db.import_calendar(vec![CalendarImport { tag:None, date:"2026-10-30".into(), entry:valid.clone() }, CalendarImport { tag:None, date:"2026-10-31".into(), entry:invalid }]).is_err());
        assert!(db.export_calendar().unwrap().is_empty());
        let mut old = serde_json::to_value(&valid).unwrap(); old.as_object_mut().unwrap().remove("showInJournal");
        assert!(serde_json::from_value::<Entry>(old).unwrap().show_in_journal);
        let mut day = db.load("2026-10-30").unwrap(); valid.plan = Some(plan("tomorrow", &["2026-10-31"], None, false)); day.entries.push(valid.clone()); db.save(day).unwrap();
        valid.plan = None;
        assert!(db.import_calendar(vec![CalendarImport { tag:None, date:"2026-10-30".into(), entry:valid }]).is_err());
        assert!(db.load("2026-10-30").unwrap().entries[0].plan.is_some());
    }
    #[test] fn planning_moves_entry_once_and_leaves_a_trace() {
        let mut db = store();
        let mut day = db.load("2026-10-28").unwrap();
        let mut task = entry("task"); task.text = "Steuererklärung".into(); task.priority = true; task.done = true;
        day.entries = vec![task, entry("event")];
        let mut saved = db.save(day).unwrap();
        saved.entries[0].plan = Some(plan("date", &["2026-11-02"], Some("15:30"), true));
        let target_id = saved.entries[0].plan.as_ref().unwrap().targets[0].id.clone();
        let mut saved = db.save(saved).unwrap();
        let trace = &db.load("2026-10-28").unwrap().entries[0];
        assert_eq!(trace.plan.as_ref().unwrap().targets[0].date, "2026-11-02"); assert_eq!(trace.text, "Steuererklärung");
        let target = db.load("2026-11-02").unwrap();
        assert_eq!(target.revision, 1); assert_eq!(target.entries.len(), 1);
        let copy = &target.entries[0];
        assert_eq!(copy.id, target_id); assert_eq!(copy.text, "Steuererklärung"); assert_eq!(copy.time.as_deref(), Some("15:30"));
        assert!(copy.reminder && copy.priority && !copy.done && copy.plan.is_none());
        // Saving the origin again must not duplicate the copy.
        saved.title = "Noch einmal".into();
        db.save(saved).unwrap();
        let mut target = db.load("2026-11-02").unwrap(); assert_eq!(target.entries.len(), 1);
        // Deleting the moved entry leaves its trace as the record of the move, and saving the origin again creates nothing.
        target.entries.clear(); db.save(target).unwrap();
        let mut origin = db.load("2026-10-28").unwrap();
        assert_eq!(origin.entries.len(), 2, "The trace stays.");
        origin.title = "Und noch einmal".into(); db.save(origin).unwrap();
        assert!(db.load("2026-11-02").unwrap().entries.is_empty());
    }
    #[test] fn planning_appends_to_existing_days_and_supports_several_days() {
        let mut db = store();
        let mut existing = db.load("2026-10-29").unwrap(); existing.entries.push(entry("note")); let existing = db.save(existing).unwrap();
        let mut day = db.load("2026-10-28").unwrap();
        let mut event = entry("event"); event.plan = Some(plan("days", &["2026-10-29", "2026-10-30"], None, false));
        day.entries.push(event); db.save(day).unwrap();
        let next = db.load("2026-10-29").unwrap();
        assert_eq!(next.revision, existing.revision + 1); assert_eq!(next.entries.len(), 2); assert_eq!(next.entries[1].kind, "event");
        assert_eq!(db.load("2026-10-30").unwrap().entries.len(), 1);
        assert!(db.save(existing).is_err(), "The target day changed, so its stale state must be rejected.");
    }
    fn planned(db: &mut Store, from: &str, kind: &str, dates: &[&str]) -> (String, Vec<String>) {
        let mut day = db.load(from).unwrap();
        let mut item = entry(kind); let p = plan(if dates.len() > 1 { "days" } else { "date" }, dates, None, false);
        let targets = p.targets.iter().map(|target| target.id.clone()).collect(); item.plan = Some(p);
        let id = item.id.clone(); day.entries.push(item); db.save(day).unwrap();
        (id, targets)
    }
    #[test] fn removing_one_entry_leaves_its_links_alone() {
        let mut db = store();
        let (trace, targets) = planned(&mut db, "2026-10-28", "task", &["2026-10-30"]);
        let mut other = db.load("2026-10-30").unwrap(); other.entries.push(entry("note")); db.save(other).unwrap();
        assert_eq!(db.load("2026-10-30").unwrap().entries[0].origin.as_deref(), Some("2026-10-28"), "Moved entries know their trace's day.");
        // Removing the trace leaves the moved entry, which no longer knows an origin.
        let mut day = db.load("2026-10-28").unwrap(); day.entries.retain(|item| item.id != trace);
        assert!(db.save(day).unwrap().touched.is_empty());
        let target = db.load("2026-10-30").unwrap();
        assert_eq!(target.entries[0].id, targets[0]); assert!(target.entries[0].origin.is_none());
        // Removing a copy leaves the trace (and the copy is not created again).
        let (trace, targets) = planned(&mut db, "2026-10-28", "event", &["2026-10-29", "2026-10-31"]);
        let mut first = db.load("2026-10-29").unwrap(); first.entries.clear(); db.save(first).unwrap();
        let origin = db.load("2026-10-28").unwrap();
        assert_eq!(origin.entries.iter().find(|item| item.id == trace).unwrap().plan.as_ref().unwrap().targets.len(), 2, "The trace keeps the record.");
        db.save(origin).unwrap();
        assert!(db.load("2026-10-29").unwrap().entries.is_empty(), "A removed occurrence is not created again.");
        assert_eq!(db.load("2026-10-31").unwrap().entries[0].id, targets[1]);
    }
    #[test] fn linked_groups_follow_chains_in_date_order() {
        let mut db = store();
        let (first, targets) = planned(&mut db, "2026-10-28", "task", &["2026-10-29"]);
        let mut middle = db.load("2026-10-29").unwrap();
        let next = plan("days", &["2026-10-30", "2026-11-02"], None, false); let later: Vec<String> = next.targets.iter().map(|target| target.id.clone()).collect();
        middle.entries[0].plan = Some(next); db.save(middle).unwrap();
        let mut unrelated = db.load("2026-10-30").unwrap(); unrelated.entries.push(entry("task")); db.save(unrelated).unwrap();
        for id in [&first, &targets[0], &later[1]] {
            let group = db.linked(id).unwrap();
            assert_eq!(group.iter().map(|item| (item.date.as_str(), item.trace)).collect::<Vec<_>>(), vec![("2026-10-28", true), ("2026-10-29", true), ("2026-10-30", false), ("2026-11-02", false)]);
        }
        assert_eq!(db.linked(&db.load("2026-10-30").unwrap().entries[1].id).unwrap().len(), 1, "An unrelated entry is alone.");
    }
    #[test] fn calendar_edits_reach_only_the_chosen_linked_entries() {
        let mut db = store();
        let (trace, targets) = planned(&mut db, "2026-10-28", "task", &["2026-10-29", "2026-11-05", "2026-11-12"]);
        // "Only this one": the edit stays with the entry instead of reaching the others.
        let mut first = db.load("2026-10-29").unwrap();
        first.entries[0].text = "Nur hier".into(); first.entries[0].time = Some("10:00".into()); first.keep_alone = vec![first.entries[0].id.clone()];
        assert!(db.save(first).unwrap().touched.is_empty());
        assert_eq!(db.load("2026-11-05").unwrap().entries[0].text, "Beispiel");
        // "Every Thursday" (or all): the chosen ones get kind, text, details and times; the trace stays as it is.
        let edit = LinkedEdit { kind: "event".into(), text: "Donnerstags".into(), description: "Raum 2".into(), tag: Some("unbekannt".into()), priority: true, reminder: true, show_in_journal: true,
            times: Some(LinkedTimes { time: Some("09:15".into()), end: Some("10:30".into()) }), reminder_before: 0, icon: None };
        let changed = db.edit_linked(&[targets[1].clone(), targets[2].clone(), trace.clone()], &edit).unwrap();
        assert_eq!(changed, vec!["2026-11-05".to_string(), "2026-11-12".to_string()]);
        let moved = &db.load("2026-11-12").unwrap().entries[0];
        assert_eq!((moved.kind.as_str(), moved.text.as_str(), moved.description.as_str(), moved.tag.as_deref(), moved.time.as_deref(), moved.end.as_deref()), ("event", "Donnerstags", "Raum 2", None, Some("09:15"), Some("10:30")));
        assert!(moved.priority && moved.reminder);
        assert_eq!(db.load("2026-10-29").unwrap().entries[0].text, "Nur hier");
        assert_eq!(db.load("2026-10-28").unwrap().entries[0].kind, "task", "Traces are left alone.");
        // Without times the time stays; a note cannot take one.
        db.edit_linked(&[targets[1].clone()], &LinkedEdit { times: None, text: "Ohne Zeit".into(), ..edit.clone() }).unwrap();
        assert_eq!(db.load("2026-11-05").unwrap().entries[0].time.as_deref(), Some("09:15"));
        assert!(db.edit_linked(&[targets[1].clone()], &LinkedEdit { kind: "note".into(), ..edit.clone() }).is_err());
        assert!(db.edit_linked(&[targets[1].clone()], &LinkedEdit { times: Some(LinkedTimes { time: Some("10:00".into()), end: Some("09:00".into()) }), ..edit }).is_err());
    }
    #[test] fn changes_reach_chosen_linked_entries_and_mark_their_days() {
        let mut db = store();
        let (trace, targets) = planned(&mut db, "2026-10-28", "task", &["2026-10-29", "2026-10-30", "2026-10-31"]);
        let before = db.load("2026-10-30").unwrap().revision;
        let changed = db.change_linked(&[LinkedChange { id: targets[1].clone(), action: "done".into() }, LinkedChange { id: targets[2].clone(), action: "remove".into() }, LinkedChange { id: trace.clone(), action: "cancelled".into() }]).unwrap();
        assert_eq!(changed, vec!["2026-10-30".to_string(), "2026-10-31".to_string()], "A trace keeps no status.");
        assert!(db.load("2026-10-30").unwrap().entries[0].done); assert_eq!(db.load("2026-10-30").unwrap().revision, before + 1);
        assert!(db.load("2026-10-31").unwrap().entries.is_empty()); assert!(!db.load("2026-10-29").unwrap().entries[0].done);
        db.change_linked(&[LinkedChange { id: targets[1].clone(), action: "cancelled".into() }]).unwrap();
        let cancelled = &db.load("2026-10-30").unwrap().entries[0]; assert!(cancelled.cancelled && !cancelled.done);
        assert!(db.change_linked(&[LinkedChange { id: trace, action: "later".into() }]).is_err());
    }
    #[test] fn kinds_change_and_edits_reach_linked_entries_both_ways() {
        let mut db = store();
        let (trace, targets) = planned(&mut db, "2026-10-28", "task", &["2026-10-29"]);
        let mut middle = db.load("2026-10-29").unwrap();
        middle.entries[0].plan = Some(plan("tomorrow", &["2026-10-30"], None, false)); db.save(middle).unwrap();
        // Editing the trace reaches the copy and, along the chain, the copy of the copy.
        let mut origin = db.load("2026-10-28").unwrap();
        let item = origin.entries.iter_mut().find(|item| item.id == trace).unwrap();
        item.text = "Neuer Text".into(); item.kind = "event".into(); item.priority = true;
        let saved = db.save(origin).unwrap();
        assert_eq!(saved.touched, vec!["2026-10-29".to_string(), "2026-10-30".to_string()]);
        for date in ["2026-10-29", "2026-10-30"] {
            let copy = &db.load(date).unwrap().entries[0];
            assert_eq!((copy.text.as_str(), copy.kind.as_str(), copy.priority), ("Neuer Text", "event", true), "{date}");
        }
        // A finished task copy loses its state when it becomes an event; editing the last copy reaches back to the trace.
        let mut last = db.load("2026-10-30").unwrap();
        last.entries[0].kind = "task".into(); last.entries[0].done = true; last.entries[0].text = "Zurück".into();
        db.save(last).unwrap();
        assert_eq!(db.load("2026-10-28").unwrap().entries[0].text, "Zurück");
        assert_eq!(db.load("2026-10-29").unwrap().entries[0].kind, "task");
        assert!(db.load("2026-10-30").unwrap().entries[0].done, "Only the edited occurrence's own state is kept.");
        // Saving the trace's day unchanged must not undo the newer edit at the target.
        let mut stale = db.load("2026-10-28").unwrap(); stale.title = "Nur der Titel".into(); db.save(stale).unwrap();
        assert_eq!(db.load("2026-10-30").unwrap().entries[0].text, "Zurück");
        assert_eq!(targets.len(), 1);
        // A note cannot carry a time; an event cannot be done.
        let mut day = db.load("2026-10-31").unwrap(); let mut timed = entry("event"); timed.time = Some("09:00".into()); day.entries.push(timed); let mut day = db.save(day).unwrap();
        day.entries[0].kind = "note".into(); assert!(db.save(day.clone()).is_err());
        day.entries[0].kind = "event".into(); day.entries[0].done = true; assert!(db.save(day).is_err());
    }
    #[test] fn time_spans_round_trip_and_planned_copies_keep_them() {
        let mut db = store(); let mut day = db.load("2026-10-28").unwrap();
        let mut event = entry("event"); event.time = Some("09:15".into()); event.end = Some("10:45".into()); day.entries.push(event);
        let mut moved = entry("task"); let mut p = plan("date", &["2026-10-29"], Some("14:00"), false); p.end = Some("14:30".into()); moved.plan = Some(p); day.entries.push(moved);
        db.save(day).unwrap();
        assert_eq!(db.load("2026-10-28").unwrap().entries[0].end.as_deref(), Some("10:45"));
        assert_eq!(db.load_range("2026-10-28", "2026-10-28").unwrap()[0].entries[0].end.as_deref(), Some("10:45"));
        let copy = &db.load("2026-10-29").unwrap().entries[0];
        assert_eq!((copy.time.as_deref(), copy.end.as_deref()), (Some("14:00"), Some("14:30")));
        for (time, end) in [(Some("10:00"), "10:00"), (Some("10:00"), "09:45"), (None, "10:00"), (Some("10:00"), "8785:00"), (Some("10:00"), "26:60")] {
            let mut day = db.load("2026-10-30").unwrap();
            let mut item = entry("event"); item.time = time.map(Into::into); item.end = Some(end.into()); day.entries.push(item);
            assert!(db.save(day).is_err(), "{time:?}–{end} must be rejected");
        }
        assert!(db.conn.execute("UPDATE entries SET end_time = '08:00' WHERE day_date = '2026-10-28' AND end_time IS NOT NULL", []).is_err(), "The database itself refuses an end before the start.");
    }
    #[test] fn ics_import_links_series_and_reuses_category_tags() {
        let mut db=store();let rule=serde_json::json!({"start":"2026-11-03","unit":"week","every":1,"icsUid":"work-series"});
        let mut first=entry("event");first.calendar_uid=Some("work-series#first".into());first.repeat=Some(repeat(rule.clone(),&[],"2028-12-31"));
        let mut second=first.clone();second.id=Uuid::new_v4().to_string();second.calendar_uid=Some("work-series#second".into());
        let tag=Tag{id:Uuid::new_v4().to_string(),name:"Arbeit".into(),color:"#AEFF00".into(),icon:None};
        let batch=vec![CalendarImport{date:"2026-11-03".into(),entry:first.clone(),tag:Some(tag.clone())},CalendarImport{date:"2026-11-10".into(),entry:second.clone(),tag:Some(tag.clone())}];
        db.import_calendar(batch.clone()).unwrap();assert_eq!(db.linked(&first.id).unwrap().len(),2);assert_eq!(db.tags().unwrap().len(),1);
        let saved=db.load("2026-11-03").unwrap();let series=saved.entries[0].repeat.as_ref().unwrap().series.clone();assert_eq!(saved.entries[0].tag,Some(db.tags().unwrap()[0].id.clone()));
        db.import_calendar(batch).unwrap();assert_eq!(db.tags().unwrap().len(),1);assert_eq!(db.series().unwrap().len(),1);assert_eq!(db.load("2026-11-10").unwrap().entries[0].repeat.as_ref().unwrap().series,series);
    }
    #[test] fn appointments_can_span_weeks_and_survive_reopening() {
        let path=std::env::temp_dir().join(format!("span-{}.db",Uuid::new_v4()));
        let mut db=Store::open(&path).unwrap();let mut day=db.load("2026-11-03").unwrap();let mut item=entry("event");item.time=Some("09:00".into());item.end=Some("513:30".into());day.entries.push(item);db.save(day).unwrap();drop(db);
        let db=Store::open(&path).unwrap();assert_eq!(db.load("2026-11-03").unwrap().entries[0].end.as_deref(),Some("513:30"));drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test] fn appointments_may_end_on_the_next_day() {
        let mut db = store(); let mut day = db.load("2026-10-31").unwrap();
        let mut night = entry("event"); night.text = "Nachtschicht".into(); night.time = Some("22:00".into()); night.end = Some("30:30".into()); day.entries.push(night);
        db.save(day).unwrap();
        let loaded = &db.load("2026-10-31").unwrap().entries[0];
        assert_eq!((loaded.time.as_deref(), loaded.end.as_deref()), (Some("22:00"), Some("30:30")), "Until 06:30 the next morning.");
        assert!(db.conn.execute("UPDATE entries SET end_time = '8785:00'", []).is_err(), "The database itself refuses an end beyond the supported year.");
        assert!(db.conn.execute("UPDATE entries SET end_time = '21:00'", []).is_err(), "And an end before the start.");
        // Indexes and links survive the rebuild: a planned copy and a unique calendar UID still work.
        let mut day = db.load("2026-10-31").unwrap(); day.entries[0].plan = Some(plan("date", &["2026-11-01"], Some("23:00"), false)); db.save(day).unwrap();
        assert_eq!(db.load("2026-11-01").unwrap().entries[0].text, "Nachtschicht");
        assert!(db.conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('entries_day_order','entries_calendar_uid','entries_series')", [], |r| r.get::<_, i64>(0)).unwrap() == 3);
    }
    #[test] fn search_finds_words_kinds_tags_and_titles_on_every_day() {
        let mut db = store();
        let work = Tag { id: Uuid::new_v4().to_string(), name: "Arbeit".into(), color: "#569eff".into(), icon: None };
        db.save_tags(&[work.clone()]).unwrap();
        let mut day = db.load("2020-01-02").unwrap(); day.title = "Umzug geplant".into();
        let mut task = entry("task"); task.text = "Kisten **packen**".into(); task.tag = Some(work.id.clone());
        let mut event = entry("event"); event.text = "Arzt".into(); event.description = "Kisten mitbringen".into(); event.show_in_journal = false;
        day.entries = vec![task.clone(), event.clone()]; db.save(day).unwrap();
        let ids = |hits: Vec<SearchHit>| hits.into_iter().map(|hit| hit.entry.map(|entry| entry.id).or(hit.title).unwrap()).collect::<Vec<_>>();
        assert_eq!(ids(db.search(&["kisten".into()], &[], &[], 50).unwrap()), [task.id.clone(), event.id.clone()], "Text and description, years back.");
        assert_eq!(ids(db.search(&["kisten".into()], &["calendar".into()], &[], 50).unwrap()), [event.id.clone()]);
        assert_eq!(ids(db.search(&[], &[], &[work.id.clone()], 50).unwrap()), [task.id.clone()]);
        assert_eq!(ids(db.search(&["umzug".into()], &["title".into()], &[], 50).unwrap()), ["Umzug geplant".to_string()]);
        assert!(db.search(&["100%".into()], &[], &[], 50).unwrap().is_empty(), "Wildcards are taken literally.");
    }
    fn tag(name: &str, color: &str) -> Tag { Tag { id: Uuid::new_v4().to_string(), name: name.into(), color: color.into(), icon: None } }
    #[test] fn a_tag_keeps_its_icon_and_a_wrong_one_is_refused() {
        let mut db = store();
        let mut uni = tag("Uni", "#76d982"); uni.icon = Some("graduation-cap".into());
        db.save_tags(&[uni.clone()]).unwrap();
        assert_eq!(db.tags().unwrap()[0].icon.as_deref(), Some("graduation-cap"));
        uni.icon = None; db.save_tags(&[uni.clone()]).unwrap();
        assert_eq!(db.tags().unwrap()[0].icon, None);
        uni.icon = Some("Not an icon!".into());
        assert!(db.save_tags(&[uni]).is_err());
    }
    #[test] fn tags_are_ordered_validated_and_removing_one_untags_its_entries() {
        let mut db = store();
        let (work, uni) = (tag("Arbeit", "#569EFF"), tag("Uni", "#76d982"));
        db.save_tags(&[uni.clone(), work.clone()]).unwrap();
        assert_eq!(db.tags().unwrap().iter().map(|tag| (tag.name.as_str(), tag.color.as_str())).collect::<Vec<_>>(), [("Uni", "#76d982"), ("Arbeit", "#569eff")]);
        for bad in [tag(" Arbeit", "#000000"), tag("arbeit", "#000000"), tag("", "#000000"), tag("Rot", "red"), tag("Rot", "#12345")] {
            assert!(db.save_tags(&[work.clone(), bad]).is_err());
        }
        let mut day = db.load("2026-11-02").unwrap();
        let mut task = entry("task"); task.tag = Some(work.id.clone());
        let mut stale = entry("note"); stale.tag = Some(Uuid::new_v4().to_string());
        day.entries = vec![task, stale];
        db.save(day).unwrap();
        let loaded = db.load("2026-11-02").unwrap();
        assert_eq!(loaded.entries[0].tag.as_deref(), Some(work.id.as_str()));
        assert_eq!(loaded.entries[1].tag, None, "An unknown tag is dropped instead of failing the save.");
        let mut renamed=work.clone(); renamed.name="Beruf".into(); renamed.color="#ff9944".into();
        db.save_tags(&[uni.clone(),renamed]).unwrap();
        assert_eq!(db.load("2026-11-02").unwrap().entries[0].tag.as_deref(),Some(work.id.as_str()),"Renaming and recolouring keep the same tag identity.");
        assert_eq!(db.save_tags(&[uni.clone()]).unwrap(), ["2026-11-02"]);
        let after = db.load("2026-11-02").unwrap();
        assert_eq!(after.entries[0].tag, None);
        assert_eq!(after.revision, loaded.revision + 1, "The day changed, so a stale editor cannot overwrite it.");
    }
    #[test] fn tags_reach_planned_copies_series_and_linked_entries() {
        let mut db = store();
        let (work, uni) = (tag("Arbeit", "#569eff"), tag("Uni", "#76d982"));
        db.save_tags(&[work.clone(), uni.clone()]).unwrap();
        let mut day = db.load("2026-11-02").unwrap();
        let mut task = entry("task"); task.tag = Some(work.id.clone()); task.plan = Some(plan("date", &["2026-11-05"], None, false));
        day.entries = vec![task];
        db.save(day).unwrap();
        assert_eq!(db.load("2026-11-05").unwrap().entries[0].tag.as_deref(), Some(work.id.as_str()), "A planned copy keeps the tag.");
        let mut copy = db.load("2026-11-05").unwrap(); copy.entries[0].tag = Some(uni.id.clone()); db.save(copy).unwrap();
        assert_eq!(db.load("2026-11-02").unwrap().entries[0].tag.as_deref(), Some(uni.id.as_str()), "A new tag reaches the trace, too.");
        let mut repeated = db.load("2026-11-09").unwrap();
        let mut sport = entry("event"); sport.tag = Some(work.id.clone()); sport.repeat = Some(repeat(weekly_rule("2026-11-09", 1), &["2026-11-16"], "2026-11-16"));
        repeated.entries = vec![sport]; db.save(repeated).unwrap();
        assert_eq!(db.load("2026-11-16").unwrap().entries[0].tag.as_deref(), Some(work.id.as_str()), "Occurrences of a series share it.");
        let series = db.series().unwrap()[0].series.clone();
        db.extend_series(&[SeriesExtension { series, from: "2026-11-16".into(), to: "2026-11-23".into(), dates: vec!["2026-11-23".into()] }]).unwrap();
        assert_eq!(db.load("2026-11-23").unwrap().entries[0].tag.as_deref(), Some(work.id.as_str()), "And so do later ones.");
    }
    #[test] fn calendar_imports_keep_the_tag_of_an_updated_entry() {
        let mut db = store(); let work = tag("Arbeit", "#569eff"); db.save_tags(&[work.clone()]).unwrap();
        let mut item = entry("event"); item.calendar_uid = Some("tagged@example.org".into());
        db.import_calendar(vec![CalendarImport { tag:None, date: "2026-11-02".into(), entry: item.clone() }]).unwrap();
        let mut day = db.load("2026-11-02").unwrap(); day.entries[0].tag = Some(work.id.clone()); db.save(day).unwrap();
        item.text = "Neu".into();
        db.import_calendar(vec![CalendarImport { tag:None, date: "2026-11-02".into(), entry: item }]).unwrap();
        let loaded = &db.load("2026-11-02").unwrap().entries[0];
        assert_eq!((loaded.text.as_str(), loaded.tag.as_deref()), ("Neu", Some(work.id.as_str())));
    }
    #[test] fn calendar_import_stores_the_tag_of_a_new_entry() {
        let mut db = store(); let payment = tag("Bezahlung", "#76d982"); db.save_tags(&[payment.clone()]).unwrap();
        let mut item = entry("event"); item.calendar_uid = Some("mail:payment".into()); item.tag = Some(payment.id.clone());
        db.import_calendar(vec![CalendarImport { tag:None, date: "2026-11-02".into(), entry: item }]).unwrap();
        assert_eq!(db.load("2026-11-02").unwrap().entries[0].tag.as_deref(), Some(payment.id.as_str()));
    }
    #[test] fn time_and_reminder_on_the_same_day_round_trip() {
        let mut db = store(); let mut day = db.load("2026-10-28").unwrap();
        let mut event = entry("event"); event.time = Some("09:05".into()); event.reminder = true; day.entries.push(event);
        db.save(day).unwrap();
        let loaded = &db.load("2026-10-28").unwrap().entries[0];
        assert_eq!(loaded.time.as_deref(), Some("09:05")); assert!(loaded.reminder && loaded.plan.is_none());
    }
    #[test] fn invalid_plans_are_rejected_without_writes() {
        let mut db = store();
        let invalid = [
            { let mut e = entry("task"); e.time = Some("24:00".into()); e },
            { let mut e = entry("task"); e.time = Some("9:00".into()); e },
            { let mut e = entry("note"); e.time = Some("09:00".into()); e },
            { let mut e = entry("note"); e.plan = Some(plan("date", &["2026-10-30"], None, false)); e },
            { let mut e = entry("task"); e.plan = Some(plan("date", &["2026-10-28"], None, false)); e },
            { let mut e = entry("task"); e.plan = Some(plan("date", &["2026-10-29", "2026-10-30"], None, false)); e },
            { let mut e = entry("task"); e.plan = Some(plan("days", &[], None, false)); e },
            { let mut e = entry("task"); e.plan = Some(plan("later", &["2026-10-30"], None, false)); e },
            { let mut e = entry("task"); e.plan = Some(plan("date", &["2026-02-30"], None, false)); e },
            { let mut e = entry("task"); e.plan = Some(plan("days", &["2026-10-30", "2026-10-30"], None, false)); e },
            { let mut e = entry("task"); e.plan = Some(plan("date", &["2026-10-30"], Some("12:60"), false)); e },
            { let mut e = entry("task"); let mut p = plan("date", &["2026-10-30"], None, false); p.targets[0].id = e.id.clone(); e.plan = Some(p); e },
        ];
        for item in invalid {
            let mut day = db.load("2026-10-28").unwrap(); day.entries.push(item);
            assert!(db.save(day).is_err());
        }
        assert!(db.load("2026-10-28").unwrap().entries.is_empty()); assert!(db.load("2026-10-30").unwrap().entries.is_empty());
    }
    #[test] fn version_three_databases_migrate_to_planning() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE days (date TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0));
            CREATE TABLE entries (id TEXT PRIMARY KEY, day_date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE, kind TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL, position INTEGER NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0);
            PRAGMA user_version = 3;
            INSERT INTO days VALUES ('2026-10-28', 'Alt', '', 2);
            INSERT INTO entries VALUES ('a8df60c2-2215-4afa-a949-2a462f7ce275', '2026-10-28', 'task', 'Bestehend', 0, 0, 0, 1);").unwrap();
        let mut db = Store::from_connection(conn).unwrap();
        let mut day = db.load("2026-10-28").unwrap();
        assert_eq!(day.entries[0].text, "Bestehend"); assert!(day.entries[0].priority && day.entries[0].time.is_none() && !day.entries[0].reminder && day.entries[0].plan.is_none());
        assert!(day.entries[0].description.is_empty());
        day.entries[0].plan = Some(plan("tomorrow", &["2026-10-29"], None, false));
        db.save(day).unwrap();
        assert_eq!(db.load("2026-10-29").unwrap().entries[0].text, "Bestehend");
        assert_eq!(db.conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 14);
    }
    #[test] fn save_reload_and_isolate_days() {
        let mut db = store(); let mut day = db.load("2024-02-29").unwrap(); day.title="Ein Tag".into(); day.entries=vec![entry("task"),entry("event"),entry("note")];
        let saved = db.save(day).unwrap(); let loaded = db.load("2024-02-29").unwrap();
        assert_eq!(loaded.entries.len(),3); assert_eq!(loaded.entries[0].id,saved.entries[0].id); assert_eq!(loaded.title,"Ein Tag"); assert!(db.load("2024-03-01").unwrap().entries.is_empty());
    }
    #[test] fn reject_stale_and_moved_entries_without_partial_writes() {
        let mut db = store(); let mut day = db.load("2025-12-31").unwrap(); day.entries.push(entry("task")); let saved = db.save(day).unwrap();
        let mut moved=saved.clone(); moved.date="2026-01-01".into(); moved.revision=0; moved.title="Darf nicht gespeichert werden".into(); assert!(db.save(moved).is_err(), "Entries keep their day.");
        assert_eq!(db.load("2026-01-01").unwrap().title, ""); let mut next=saved.clone(); next.title="Neu".into(); db.save(next).unwrap(); assert!(db.save(saved).is_err());
    }
    #[test] fn delete_entry_and_validate_date() {
        let mut db=store(); assert!(db.load("2025-02-29").is_err()); let mut day=db.load("2026-01-01").unwrap(); day.entries.push(entry("note")); let mut saved=db.save(day).unwrap(); saved.entries.clear(); db.save(saved).unwrap(); assert!(db.load("2026-01-01").unwrap().entries.is_empty());
    }
    #[test] fn data_survives_closing_and_reopening_database() {
        let path = std::env::temp_dir().join(format!("journal-test-{}.sqlite3", Uuid::new_v4()));
        let id;
        {
            let mut db=Store::open(&path).unwrap();
            let mut day=db.load("2026-10-27").unwrap();
            day.title="Testtag".into(); day.entries.push(entry("event")); id=day.entries[0].id.clone();
            db.save(day).unwrap();
        }
        {
            let db=Store::open(&path).unwrap(); let day=db.load("2026-10-27").unwrap();
            assert_eq!(day.title, "Testtag"); assert_eq!(day.entries[0].id,id); assert_eq!(day.entries[0].kind,"event");
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test] fn migration_preserves_existing_tasks_and_statuses_round_trip() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE days (date TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0));
            CREATE TABLE entries (id TEXT PRIMARY KEY, day_date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('task','event','note')), text TEXT NOT NULL, done INTEGER NOT NULL CHECK(done IN (0,1)), position INTEGER NOT NULL, CHECK(kind = 'task' OR done = 0));
            CREATE INDEX entries_day_order ON entries(day_date, position); PRAGMA user_version = 1;
            INSERT INTO days VALUES ('2026-10-28', 'Testtag', '', 1);
            INSERT INTO entries VALUES ('a8df60c2-2215-4afa-a949-2a462f7ce275', '2026-10-28', 'task', 'Beispiel', 1, 0);").unwrap();
        let mut db = Store::from_connection(conn).unwrap();
        let mut day = db.load("2026-10-28").unwrap();
        assert_eq!(day.title, "Testtag"); assert!(day.entries[0].done); assert!(!day.entries[0].cancelled);
        day.entries[0].done = false; day.entries[0].cancelled = true;
        let saved = db.save(day).unwrap(); let loaded = db.load("2026-10-28").unwrap();
        assert!(!loaded.entries[0].done); assert!(loaded.entries[0].cancelled); assert_eq!(loaded.entries[0].id, saved.entries[0].id);
        let mut invalid = saved; invalid.entries[0].done = true;
        assert!(db.save(invalid).is_err()); assert!(db.load("2026-10-28").unwrap().entries[0].cancelled);
    }
    #[test] fn only_tasks_can_be_cancelled() {
        let mut db = store(); let mut day = db.load("2026-10-28").unwrap();
        let mut event = entry("event"); event.cancelled = true; day.entries.push(event);
        assert!(db.save(day).is_err()); assert!(db.load("2026-10-28").unwrap().entries.is_empty());
    }
    #[test] fn reordered_entries_survive_database_reopening() {
        let path = std::env::temp_dir().join(format!("journal-order-test-{}.sqlite3", Uuid::new_v4()));
        let expected_ids;
        {
            let mut db = Store::open(&path).unwrap();
            let mut day = db.load("2026-10-28").unwrap();
            let mut first = entry("task"); first.done = true;
            let mut second = entry("task"); second.cancelled = true;
            day.entries = vec![entry("event"), first, second, entry("note")];
            let mut saved = db.save(day).unwrap();
            saved.entries.swap(1, 2);
            expected_ids = saved.entries.iter().map(|item| item.id.clone()).collect::<Vec<_>>();
            db.save(saved).unwrap();
        }
        {
            let db = Store::open(&path).unwrap();
            let day = db.load("2026-10-28").unwrap();
            assert_eq!(day.entries.iter().map(|item| item.id.clone()).collect::<Vec<_>>(), expected_ids);
            assert_eq!(day.entries.iter().map(|item| item.kind.as_str()).collect::<Vec<_>>(), vec!["event", "task", "task", "note"]);
            assert!(day.entries[1].cancelled); assert!(day.entries[2].done);
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test] fn priority_migration_preserves_version_two_entries() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE days (date TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0));
            CREATE TABLE entries (id TEXT PRIMARY KEY, day_date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('task','event','note')), text TEXT NOT NULL, done INTEGER NOT NULL CHECK(done IN (0,1)), position INTEGER NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1) AND (kind = 'task' OR cancelled = 0) AND (done = 0 OR cancelled = 0)), CHECK(kind = 'task' OR done = 0));
            CREATE INDEX entries_day_order ON entries(day_date, position); PRAGMA user_version = 2;
            INSERT INTO days VALUES ('2026-10-28', 'Testtag', 'Beispieltext', 7);").unwrap();
        let mut done = entry("task"); done.done = true;
        let mut cancelled = entry("task"); cancelled.cancelled = true;
        let original = vec![entry("event"), done, cancelled, entry("note")];
        for (position, item) in original.iter().enumerate() {
            conn.execute("INSERT INTO entries VALUES (?1,'2026-10-28',?2,?3,?4,?5,?6)", params![item.id,item.kind,item.text,item.done,position as i64,item.cancelled]).unwrap();
        }
        let db = Store::from_connection(conn).unwrap();
        let loaded = db.load("2026-10-28").unwrap();
        assert_eq!(loaded.title, "Testtag"); assert_eq!(loaded.body, "Beispieltext"); assert_eq!(loaded.revision, 7);
        for (before, after) in original.iter().zip(&loaded.entries) {
            assert_eq!(before.id, after.id); assert_eq!(before.kind, after.kind); assert_eq!(before.text, after.text);
            assert_eq!(before.done, after.done); assert_eq!(before.cancelled, after.cancelled); assert!(!after.priority);
        }
        assert!(db.conn.execute("UPDATE entries SET priority = 2", []).is_err());
        let reopened = Store::from_connection(db.conn).unwrap();
        assert_eq!(reopened.load("2026-10-28").unwrap().entries.len(), original.len());
    }
    #[test] fn priority_survives_status_edits_reordering_and_database_reopening() {
        let path = std::env::temp_dir().join(format!("journal-priority-test-{}.sqlite3", Uuid::new_v4()));
        let expected_ids;
        {
            let mut db = Store::open(&path).unwrap();
            let mut day = db.load("2026-10-28").unwrap();
            day.entries = vec![entry("event"), entry("task"), entry("task"), entry("note")];
            for item in &mut day.entries { item.priority = true; }
            let stale = db.save(day).unwrap();
            let mut changed = db.load("2026-10-28").unwrap();
            changed.entries[0].priority = false;
            changed.entries[1].done = true; changed.entries[2].cancelled = true;
            changed.entries[3].text = "Bearbeitete Testnotiz".into(); changed.entries.swap(1, 2);
            expected_ids = changed.entries.iter().map(|item| item.id.clone()).collect::<Vec<_>>();
            db.save(changed).unwrap();
            assert!(db.save(stale).is_err());
        }
        {
            let mut db = Store::open(&path).unwrap();
            let mut loaded = db.load("2026-10-28").unwrap();
            assert_eq!(loaded.entries.iter().map(|item| item.id.clone()).collect::<Vec<_>>(), expected_ids);
            assert_eq!(loaded.entries.iter().map(|item| item.priority).collect::<Vec<_>>(), vec![false,true,true,true]);
            assert!(loaded.entries[1].cancelled); assert!(loaded.entries[2].done);
            assert_eq!(loaded.entries[3].text, "Bearbeitete Testnotiz");
            assert!(db.load("2026-10-29").unwrap().entries.is_empty());
            for item in &mut loaded.entries { item.priority = false; }
            db.save(loaded).unwrap();
        }
        {
            let db = Store::open(&path).unwrap();
            assert!(db.load("2026-10-28").unwrap().entries.iter().all(|item| !item.priority));
        }
        std::fs::remove_file(path).unwrap();
    }
}
