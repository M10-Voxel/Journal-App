use chrono::{Duration, NaiveDate, NaiveDateTime};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeSet, HashMap, HashSet, VecDeque}, error::Error, path::Path};
use uuid::Uuid;

fn default_true() -> bool { true }

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: String, pub kind: String, pub text: String, pub done: bool, pub cancelled: bool, #[serde(default)] pub priority: bool,
    #[serde(default)] pub description: String,
    /// Optional `HH:MM` on the entry's own day.
    #[serde(default)] pub time: Option<String>,
    /// Optional end `HH:MM` on the same day, after `time` (entries made by marking a range in the calendar).
    #[serde(default)] pub end: Option<String>,
    /// Whether the user wants a reminder. Only stored; notifications are not implemented yet.
    #[serde(default)] pub reminder: bool,
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
}
/// A day as the calendar shows it: its title and the entries that live there (traces are left out, their copies count).
#[derive(Clone, Debug, Serialize)]
pub struct CalendarDay { pub date: String, pub title: String, pub entries: Vec<Entry> }
/// One entry of a linked group (a trace, its copies, copies planned on again), for choosing which of them an action reaches.
#[derive(Clone, Debug, Serialize)]
pub struct LinkedEntry { pub id: String, pub date: String, pub kind: String, pub done: bool, pub cancelled: bool, pub trace: bool, pub series: Option<String> }
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
pub struct CalendarImport { pub date: String, pub entry: Entry }
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
pub struct Store { conn: Connection }

impl Store {
    /// Export every task and event, including calendar-only entries, without the UI's range limit.
    pub fn export_calendar(&self) -> Result<Vec<CalendarDay>> {
        let mut stmt = self.conn.prepare("SELECT DISTINCT day_date FROM entries WHERE plan IS NULL AND kind <> 'note' ORDER BY day_date")?;
        let dates = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        dates.into_iter().map(|date| {
            let day = self.load(&date)?;
            Ok(CalendarDay { date, title: day.title, entries: day.entries.into_iter().filter(|e| e.plan.is_none() && e.kind != "note").collect() })
        }).collect()
    }
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
        let mut touched = BTreeSet::new();
        for item in entries {
            let e = item.entry;
            let found: Option<(String, String, Option<String>)> = tx.query_row("SELECT id, day_date, plan FROM entries WHERE calendar_uid=?1 OR id=?2", params![e.calendar_uid, e.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
            let id = if let Some((id, old_date, plan)) = found {
                if plan.is_some() || (old_date != item.date && linked_ids(&tx, &id)?.len() > 1) { return Err("Ein bereits weitergeplanter Eintrag kann nicht durch einen ICS-Import verschoben werden".into()); }
                touched.insert(old_date); id
            } else { e.id.clone() };
            tx.execute("INSERT INTO days(date,title,body,revision) VALUES(?1,'','',1) ON CONFLICT(date) DO NOTHING", [&item.date])?;
            let position: i64 = tx.query_row("SELECT COALESCE(MAX(position)+1,0) FROM entries WHERE day_date=?1", [&item.date], |r| r.get(0))?;
            tx.execute("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan,end_time,show_in_journal,calendar_uid,description)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,?11,?12,?13,?14)
                ON CONFLICT(id) DO UPDATE SET day_date=excluded.day_date,kind=excluded.kind,text=excluded.text,description=excluded.description,done=excluded.done,cancelled=excluded.cancelled,priority=excluded.priority,time=excluded.time,reminder=excluded.reminder,end_time=excluded.end_time,show_in_journal=excluded.show_in_journal,calendar_uid=excluded.calendar_uid,position=CASE WHEN entries.day_date=excluded.day_date THEN entries.position ELSE excluded.position END",
                params![id,item.date,e.kind,e.text,e.done,position,e.cancelled,e.priority,e.time,e.reminder,e.end,e.show_in_journal,e.calendar_uid,e.description])?;
            let mut updated = e; updated.id = id;
            sync_linked(&tx, &updated, &mut touched)?;
            touched.insert(item.date);
        }
        for date in &touched { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }
    pub fn open(path: &Path) -> Result<Self> { Self::from_connection(Connection::open(path)?) }
    fn from_connection(mut conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        // WAL needs fewer syncs per save than the rollback journal and keeps reads independent of writes.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > 10 { return Err("Die Datenbank wurde mit einer neueren Version erstellt".into()); }
        if version == 0 {
            let tx = conn.transaction()?;
            tx.execute_batch("CREATE TABLE days (date TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0));
                CREATE TABLE entries (id TEXT PRIMARY KEY, day_date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('task','event','note')), text TEXT NOT NULL, done INTEGER NOT NULL CHECK(done IN (0,1)), position INTEGER NOT NULL, CHECK(kind = 'task' OR done = 0));
                CREATE INDEX entries_day_order ON entries(day_date, position);
                PRAGMA user_version = 1;")?;
            tx.commit()?;
        }
        if version < 2 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1) AND (kind = 'task' OR cancelled = 0) AND (done = 0 OR cancelled = 0)); PRAGMA user_version = 2;")?;
            tx.commit()?;
        }
        if version < 3 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK(priority IN (0,1)); PRAGMA user_version = 3;")?;
            tx.commit()?;
        }
        if version < 4 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN time TEXT CHECK(time IS NULL OR (kind <> 'note' AND time GLOB '[0-2][0-9]:[0-5][0-9]'));
                ALTER TABLE entries ADD COLUMN reminder INTEGER NOT NULL DEFAULT 0 CHECK(reminder IN (0,1) AND (kind <> 'note' OR reminder = 0));
                ALTER TABLE entries ADD COLUMN plan TEXT CHECK(plan IS NULL OR kind <> 'note');
                PRAGMA user_version = 4;")?;
            tx.commit()?;
        }
        if version < 5 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN end_time TEXT CHECK(end_time IS NULL OR (time IS NOT NULL AND end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time > time));
                PRAGMA user_version = 5;")?;
            tx.commit()?;
        }
        if version < 6 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN show_in_journal INTEGER NOT NULL DEFAULT 1 CHECK(show_in_journal IN (0,1));
                ALTER TABLE entries ADD COLUMN calendar_uid TEXT;
                CREATE UNIQUE INDEX entries_calendar_uid ON entries(calendar_uid) WHERE calendar_uid IS NOT NULL;
                PRAGMA user_version = 6;")?;
            tx.commit()?;
        }
        if version < 7 {
            let tx = conn.transaction()?;
            tx.execute_batch("CREATE TABLE series (id TEXT PRIMARY KEY, rule TEXT NOT NULL, horizon TEXT NOT NULL);
                ALTER TABLE entries ADD COLUMN series TEXT REFERENCES series(id) ON DELETE SET NULL;
                CREATE INDEX entries_series ON entries(series, day_date) WHERE series IS NOT NULL;
                PRAGMA user_version = 7;")?;
            tx.commit()?;
        }
        if version < 8 {
            let tx = conn.transaction()?;
            tx.execute_batch("CREATE TABLE reminder_log (id TEXT NOT NULL, due TEXT NOT NULL, snooze TEXT, PRIMARY KEY(id, due));
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                PRAGMA user_version = 8;")?;
            tx.commit()?;
        }
        if version < 9 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN description TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 9;")?;
            tx.commit()?;
        }
        if version < 10 {
            // Appointments may end on the next day: an end of 24:00–47:59 lies that many hours after the day's start
            // ("26:00" is 02:00 the next morning). SQLite changes a CHECK only by building the table anew, so the table is
            // copied under its own definition with just that rule replaced – whatever columns it has by now.
            let old: String = conn.query_row("SELECT sql FROM sqlite_master WHERE type='table' AND name='entries'", [], |r| r.get(0))?;
            let (rule, relaxed) = ("end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time > time", "end_time GLOB '[0-4][0-9]:[0-5][0-9]' AND end_time > time AND end_time < '48:00'");
            if !old.contains(rule) && !old.contains(relaxed) { return Err("Unerwartetes Datenbankschema (entries)".into()); }
            let next = old.replacen("CREATE TABLE entries", "CREATE TABLE entries_next", 1).replace(rule, relaxed);
            let indexes: Vec<String> = conn.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='entries' AND sql IS NOT NULL")?
                .query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            // A table that already has the rule (made new) only needs the version.
            if old.contains(relaxed) { conn.execute_batch("PRAGMA user_version = 10;")?; } else {
            conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
            let rebuilt = (|| -> Result<()> {
                let tx = conn.transaction()?;
                tx.execute_batch(&next)?;
                tx.execute_batch("INSERT INTO entries_next SELECT * FROM entries; DROP TABLE entries; ALTER TABLE entries_next RENAME TO entries;")?;
                for index in &indexes { tx.execute_batch(index)?; }
                if tx.prepare("PRAGMA foreign_key_check")?.query([])?.next()?.is_some() { return Err("Fremdschlüssel nach dem Umbau verletzt".into()); }
                tx.execute_batch("PRAGMA user_version = 10;")?;
                tx.commit()?;
                Ok(())
            })();
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;
            rebuilt?;
            }
        }
        Ok(Self { conn })
    }
    pub fn load(&self, date: &str) -> Result<Day> {
        validate_date(date)?;
        let mut day = self.conn.query_row("SELECT title, body, revision FROM days WHERE date = ?1", [date], |r| Ok(Day { date: date.into(), title: r.get(0)?, body: r.get(1)?, revision: r.get(2)?, entries: vec![], touched: vec![] })).optional()?.unwrap_or(Day { date: date.into(), title: String::new(), body: String::new(), revision: 0, entries: vec![], touched: vec![] });
        let mut stmt = self.conn.prepare_cached("SELECT e.id, e.kind, e.text, e.done, e.cancelled, e.priority, e.time, e.reminder, e.plan, e.end_time, e.show_in_journal, e.calendar_uid, e.series, s.rule, s.horizon, e.description
            FROM entries e LEFT JOIN series s ON s.id = e.series WHERE e.day_date = ?1 ORDER BY e.position")?;
        let rows = stmt.query_map([date], |r| Ok((Entry { id:r.get(0)?, kind:r.get(1)?, text:r.get(2)?, done:r.get(3)?, cancelled:r.get(4)?, priority:r.get(5)?, time:r.get(6)?, end:r.get(9)?, reminder:r.get(7)?, plan:None, origin:None, show_in_journal:r.get(10)?, calendar_uid:r.get(11)?, description:r.get(15)?, repeat:None }, r.get::<_, Option<String>>(8)?, (r.get(12)?, r.get(13)?, r.get(14)?))))?;
        let mut origins = self.conn.prepare_cached("SELECT json_extract(t.value, '$.id'), e.day_date FROM entries e, json_each(e.plan, '$.targets') t WHERE json_extract(t.value, '$.date') = ?1")?;
        let origins = origins.query_map([date], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()?;
        for row in rows {
            let (mut entry, plan, series) = row?;
            entry.plan = plan.map(|plan| serde_json::from_str(&plan)).transpose()?;
            entry.repeat = repeat_of(series)?;
            entry.origin = origins.get(&entry.id).cloned();
            day.entries.push(entry);
        }
        Ok(day)
    }
    /// Every day from `from` to `to` (inclusive) that has a title or entries, in date order.
    pub fn load_range(&self, from: &str, to: &str) -> Result<Vec<CalendarDay>> {
        validate_date(from)?; validate_date(to)?;
        if from > to || NaiveDate::parse_from_str(to, "%Y-%m-%d")?.signed_duration_since(NaiveDate::parse_from_str(from, "%Y-%m-%d")?).num_days() > 400 { return Err("Ungültiger Zeitraum".into()); }
        let mut days: Vec<CalendarDay> = Vec::new();
        let mut titles = self.conn.prepare_cached("SELECT date, title FROM days WHERE date BETWEEN ?1 AND ?2 AND (title <> '' OR EXISTS (SELECT 1 FROM entries WHERE day_date = date AND plan IS NULL)) ORDER BY date")?;
        for row in titles.query_map([from, to], |r| Ok(CalendarDay { date: r.get(0)?, title: r.get(1)?, entries: vec![] }))? { days.push(row?); }
        let mut stmt = self.conn.prepare_cached("SELECT e.day_date, e.id, e.kind, e.text, e.done, e.cancelled, e.priority, e.time, e.reminder, e.end_time, e.show_in_journal, e.calendar_uid, e.series, s.rule, s.horizon, e.description
            FROM entries e LEFT JOIN series s ON s.id = e.series WHERE e.day_date BETWEEN ?1 AND ?2 AND e.plan IS NULL ORDER BY e.day_date, e.position")?;
        let rows = stmt.query_map([from, to], |r| Ok((r.get::<_, String>(0)?, Entry { id:r.get(1)?, kind:r.get(2)?, text:r.get(3)?, done:r.get(4)?, cancelled:r.get(5)?, priority:r.get(6)?, time:r.get(7)?, end:r.get(9)?, reminder:r.get(8)?, plan:None, origin:None, show_in_journal:r.get(10)?, calendar_uid:r.get(11)?, description:r.get(15)?, repeat:None }, (r.get(12)?, r.get(13)?, r.get(14)?))))?;
        let mut index = 0;
        for row in rows {
            let (date, mut entry, series) = row?;
            entry.repeat = repeat_of(series)?;
            while days[index].date != date { index += 1; }
            days[index].entries.push(entry);
        }
        Ok(days)
    }
    pub fn save(&mut self, mut day: Day) -> Result<Day> {
        validate_date(&day.date)?;
        let mut ids = HashSet::new();
        for entry in &day.entries {
            if Uuid::parse_str(&entry.id).is_err() || !ids.insert(&entry.id) || !matches!(entry.kind.as_str(), "task" | "event" | "note") || (entry.kind != "task" && (entry.done || entry.cancelled)) || (entry.done && entry.cancelled) { return Err("Ungültiger Eintrag".into()); }
            if entry.kind == "note" && (entry.time.is_some() || entry.reminder || entry.plan.is_some()) { return Err("Notizen können nicht geplant werden".into()); }
            if entry.description.len() > 1_000_000 || !valid_time(&entry.time) || !valid_span(&entry.time, &entry.end) { return Err("Ungültige Uhrzeit".into()); }
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
        let current: Option<i64> = tx.prepare_cached("SELECT revision FROM days WHERE date=?1")?.query_row([&day.date], |r| r.get(0)).optional()?;
        if current.unwrap_or(0) != day.revision { return Err("Dieser Tag wurde inzwischen geändert. Bitte neu laden.".into()); }
        // Entries keep their day; their kind may change (an event becomes a task and back). What changed in text, kind or
        // priority is passed on to the entries linked with them (see sync_linked), and only that, so an unchanged trace
        // never overwrites a newer edit made at its target.
        let mut edited = Vec::new();
        {
            let mut original = tx.prepare_cached("SELECT day_date, kind, text, priority, description FROM entries WHERE id=?1")?;
            for entry in &day.entries {
                let found: Option<(String, String, String, bool, String)> = original.query_row([&entry.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?;
                if let Some((date, kind, text, priority, description)) = found {
                    if date != day.date { return Err("Eintrag gehört zu einem anderen Tag".into()); }
                    if kind != entry.kind || text != entry.text || priority != entry.priority || description != entry.description { edited.push(entry.id.clone()); }
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
        tx.execute("DELETE FROM entries WHERE day_date=?1", [&day.date])?;
        {
            let mut insert = tx.prepare_cached("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan,end_time,show_in_journal,calendar_uid,series,description) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)")?;
            for (position, entry) in day.entries.iter().enumerate() {
                let plan = entry.plan.as_ref().map(serde_json::to_string).transpose()?;
                insert.execute(params![entry.id,day.date,entry.kind,entry.text,entry.done,position as i64,entry.cancelled,entry.priority,entry.time,entry.reminder,plan,entry.end,entry.show_in_journal,entry.calendar_uid,series[position],entry.description])?;
            }
        }
        // A series started here gets its further occurrences, as open copies with this entry's time and reminder.
        for (index, dates) in &started {
            let entry = &day.entries[*index];
            let copy = Template { kind: &entry.kind, text: &entry.text, description: &entry.description, priority: entry.priority, time: entry.time.as_deref(), end: entry.end.as_deref(), reminder: entry.reminder, show_in_journal: entry.show_in_journal };
            for date in dates { add_copy(&tx, date, &Uuid::new_v4().to_string(), &copy, series[*index].as_deref())?; touched.insert(date.clone()); }
        }
        // A newly planned trace moves its entry: an open copy with the planned time and reminder is appended to every target day.
        // A repeating plan starts its series there; an entry that repeated already continues differently from then on.
        for (index, entry) in day.entries.iter().enumerate() {
            let Some(plan) = &entry.plan else { continue };
            let copy = Template { kind: &entry.kind, text: &entry.text, description: &entry.description, priority: entry.priority, time: plan.time.as_deref(), end: plan.end.as_deref(), reminder: plan.reminder, show_in_journal: entry.show_in_journal };
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
        for id in &edited {
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
    pub fn change_linked(&mut self, changes: &[LinkedChange]) -> Result<Vec<String>> {
        let tx = self.conn.transaction()?;
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
        let checked: Option<String> = tx.query_row("SELECT value FROM settings WHERE key='reminders.checked'", [], |r| r.get(0)).optional()?;
        let floor = now - Duration::days(14);
        let from = checked.and_then(|value| NaiveDateTime::parse_from_str(&value, "%Y-%m-%dT%H:%M:%S").ok()).map_or(now - Duration::minutes(1), |last| last.max(floor));
        let mut due = Vec::new();
        {
            let mut stmt = tx.prepare_cached("SELECT id, day_date, kind, text, time, end_time FROM entries WHERE reminder=1 AND plan IS NULL AND kind<>'note' AND done=0 AND cancelled=0 AND day_date BETWEEN ?1 AND ?2 ORDER BY day_date, time, position")?;
            let rows = stmt.query_map([from.date().to_string(), now.date().to_string()], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut logged = tx.prepare_cached("INSERT OR IGNORE INTO reminder_log(id, due) VALUES(?1, ?2)")?;
            for (id, date, kind, text, time, end) in rows {
                let Ok(moment) = NaiveDateTime::parse_from_str(&format!("{date}T{}", time.as_deref().unwrap_or(REMINDER_DEFAULT)), "%Y-%m-%dT%H:%M") else { continue };
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
            let latest: Option<(String, String, bool, Option<String>, Option<String>, bool, bool, String)> = tx.prepare_cached("SELECT kind, text, priority, time, end_time, reminder, show_in_journal, description FROM entries WHERE series=?1 ORDER BY plan IS NOT NULL, day_date DESC LIMIT 1")?
                .query_row([&extension.series], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))).optional()?;
            let Some((kind, text, priority, time, end, reminder, show_in_journal, description)) = latest else { continue };
            let copy = Template { kind: &kind, text: &text, description: &description, priority, time: time.as_deref(), end: end.as_deref(), reminder, show_in_journal };
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
/// An entry and the places it was planned to are one item: a new text, kind or priority reaches all of them, along whole
/// chains (planned on again) and in both directions (from a trace to its copies and from a copy back to its trace).
/// Only the task keeps a done or cancelled state; the time and status of each occurrence stay its own.
fn sync_linked(tx: &Connection, entry: &Entry, touched: &mut BTreeSet<String>) -> Result<()> {
    let mut update = tx.prepare_cached("UPDATE entries SET kind=?2, text=?3, priority=?4, description=?5, done=CASE WHEN ?2='task' THEN done ELSE 0 END, cancelled=CASE WHEN ?2='task' THEN cancelled ELSE 0 END
        WHERE id=?1 AND (kind<>?2 OR text<>?3 OR priority<>?4 OR description<>?5) RETURNING day_date")?;
    for other in linked_ids(tx, &entry.id)?.into_iter().skip(1) {
        if let Some(date) = update.query_row(params![other, entry.kind, entry.text, entry.priority, entry.description], |r| r.get::<_, String>(0)).optional()? { touched.insert(date); }
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
struct Template<'a> { kind: &'a str, text: &'a str, description: &'a str, priority: bool, time: Option<&'a str>, end: Option<&'a str>, reminder: bool, show_in_journal: bool }
/// Appends an open copy to `date` (creating the day if needed, otherwise marking it changed).
fn add_copy(tx: &Connection, date: &str, id: &str, copy: &Template, series: Option<&str>) -> Result<()> {
    if tx.prepare_cached("SELECT 1 FROM entries WHERE id=?1")?.query_row([id], |_| Ok(())).optional()?.is_some() { return Err("Der geplante Eintrag existiert bereits".into()); }
    tx.prepare_cached("INSERT INTO days(date,title,body,revision) VALUES(?1,'','',1) ON CONFLICT(date) DO UPDATE SET revision=revision+1")?.execute([date])?;
    let position: i64 = tx.prepare_cached("SELECT COALESCE(MAX(position)+1,0) FROM entries WHERE day_date=?1")?.query_row([date], |r| r.get(0))?;
    tx.prepare_cached("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan,end_time,show_in_journal,calendar_uid,series,description) VALUES(?1,?2,?3,?4,0,?5,0,?6,?7,?8,NULL,?9,?10,NULL,?11,?12)")?
        .execute(params![id, date, copy.kind, copy.text, position, copy.priority, copy.time, copy.reminder, copy.end, copy.show_in_journal, series, copy.description])?;
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
    let valid_end = |end: &str| end.len() == 5 && end.as_bytes()[2] == b':' && end[..2].parse::<u32>().is_ok_and(|hours| hours < 48) && end[3..].parse::<u32>().is_ok_and(|minutes| minutes < 60);
    match (time, end) { (_, None) => true, (Some(time), Some(end)) => valid_end(end) && end > time, (None, Some(_)) => false }
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
    fn entry(kind: &str) -> Entry { Entry { id:Uuid::new_v4().to_string(), kind:kind.into(), text:"Beispiel".into(), done:false, cancelled:false, priority:false, time:None, end:None, reminder:false, plan:None, origin:None, show_in_journal:true, calendar_uid:None, description:String::new(), repeat:None } }
    fn plan(via: &str, dates: &[&str], time: Option<&str>, reminder: bool) -> Plan {
        Plan { via: via.into(), targets: dates.iter().map(|date| PlanTarget { date: (*date).into(), id: Uuid::new_v4().to_string() }).collect(), time: time.map(Into::into), end: None, reminder, repeat: None }
    }
    fn weekly_rule(start: &str, every: u32) -> serde_json::Value { serde_json::json!({ "start": start, "unit": "week", "every": every }) }
    fn repeat(rule: serde_json::Value, dates: &[&str], horizon: &str) -> Repeat {
        Repeat { series: Uuid::new_v4().to_string(), rule: Some(rule), horizon: horizon.into(), dates: dates.iter().map(|date| (*date).into()).collect() }
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
        db.import_calendar(vec![CalendarImport { date:"2026-11-01".into(),entry:item.clone() }]).unwrap();
        item.description="Neue Beschreibung\nMit Details".into();
        db.import_calendar(vec![CalendarImport { date:"2026-11-02".into(),entry:item.clone() }]).unwrap();
        let exported=db.export_calendar().unwrap(); assert_eq!(exported.len(),1);
        assert_eq!(exported[0].entries[0].description,item.description);
        assert!(db.load("2026-11-01").unwrap().entries.is_empty());
    }
    #[test] fn version_eight_migration_preserves_entries_and_reopening_keeps_descriptions() {
        let mut db=store(); let mut day=db.load("2026-11-01").unwrap();
        let mut item=entry("event"); item.time=Some("04:00".into()); day.entries.push(item.clone()); db.save(day).unwrap();
        let conn=db.conn;
        conn.execute_batch("ALTER TABLE entries DROP COLUMN description; PRAGMA user_version=8;").unwrap();
        let mut migrated=Store::from_connection(conn).unwrap(); let mut loaded=migrated.load("2026-11-01").unwrap();
        assert_eq!(loaded.entries[0].id,item.id); assert_eq!(loaded.entries[0].time,item.time); assert!(loaded.entries[0].description.is_empty());
        loaded.entries[0].description="Nach der Migration".into(); migrated.save(loaded).unwrap();
        let reopened=Store::from_connection(migrated.conn).unwrap(); assert_eq!(reopened.load("2026-11-01").unwrap().entries[0].description,"Nach der Migration");
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
        db.import_calendar(vec![CalendarImport { date:"2026-10-30".into(), entry:event.clone() }]).unwrap();
        event.id = Uuid::new_v4().to_string(); event.text = "Changed".into(); event.show_in_journal = true;
        let touched = db.import_calendar(vec![CalendarImport { date:"2026-11-01".into(), entry:event.clone() }]).unwrap();
        assert_eq!(touched, vec!["2026-10-30", "2026-11-01"]);
        let original = db.load("2026-10-30").unwrap(); assert_eq!(original.body, "Keep body"); assert_eq!(original.entries.len(), 1);
        let imported = &db.load("2026-11-01").unwrap().entries[0]; assert_eq!(imported.id, first_id); assert!(imported.show_in_journal); assert_eq!(imported.text, "Changed");
        db.import_calendar(vec![CalendarImport { date:"2026-11-01".into(), entry:event }]).unwrap();
        assert_eq!(db.load("2026-11-01").unwrap().entries.len(), 1);
    }
    #[test] fn invalid_calendar_import_rolls_back_and_old_json_defaults_to_visible() {
        let mut db = store();
        let mut valid = entry("event"); valid.calendar_uid = Some("valid".into());
        let mut invalid = entry("event"); invalid.calendar_uid = Some("invalid".into()); invalid.time = Some("25:00".into());
        assert!(db.import_calendar(vec![CalendarImport { date:"2026-10-30".into(), entry:valid.clone() }, CalendarImport { date:"2026-10-31".into(), entry:invalid }]).is_err());
        assert!(db.export_calendar().unwrap().is_empty());
        let mut old = serde_json::to_value(&valid).unwrap(); old.as_object_mut().unwrap().remove("showInJournal");
        assert!(serde_json::from_value::<Entry>(old).unwrap().show_in_journal);
        let mut day = db.load("2026-10-30").unwrap(); valid.plan = Some(plan("tomorrow", &["2026-10-31"], None, false)); day.entries.push(valid.clone()); db.save(day).unwrap();
        valid.plan = None;
        assert!(db.import_calendar(vec![CalendarImport { date:"2026-10-30".into(), entry:valid }]).is_err());
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
        for (time, end) in [(Some("10:00"), "10:00"), (Some("10:00"), "09:45"), (None, "10:00"), (Some("10:00"), "48:00"), (Some("10:00"), "26:60")] {
            let mut day = db.load("2026-10-30").unwrap();
            let mut item = entry("event"); item.time = time.map(Into::into); item.end = Some(end.into()); day.entries.push(item);
            assert!(db.save(day).is_err(), "{time:?}–{end} must be rejected");
        }
        assert!(db.conn.execute("UPDATE entries SET end_time = '08:00' WHERE day_date = '2026-10-28' AND end_time IS NOT NULL", []).is_err(), "The database itself refuses an end before the start.");
    }
    #[test] fn appointments_may_end_on_the_next_day() {
        let mut db = store(); let mut day = db.load("2026-10-31").unwrap();
        let mut night = entry("event"); night.text = "Nachtschicht".into(); night.time = Some("22:00".into()); night.end = Some("30:30".into()); day.entries.push(night);
        db.save(day).unwrap();
        let loaded = &db.load("2026-10-31").unwrap().entries[0];
        assert_eq!((loaded.time.as_deref(), loaded.end.as_deref()), (Some("22:00"), Some("30:30")), "Until 06:30 the next morning.");
        assert!(db.conn.execute("UPDATE entries SET end_time = '48:00'", []).is_err(), "The database itself refuses more than a day after.");
        assert!(db.conn.execute("UPDATE entries SET end_time = '21:00'", []).is_err(), "And an end before the start.");
        // Indexes and links survive the rebuild: a planned copy and a unique calendar UID still work.
        let mut day = db.load("2026-10-31").unwrap(); day.entries[0].plan = Some(plan("date", &["2026-11-01"], Some("23:00"), false)); db.save(day).unwrap();
        assert_eq!(db.load("2026-11-01").unwrap().entries[0].text, "Nachtschicht");
        assert!(db.conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name IN ('entries_day_order','entries_calendar_uid','entries_series')", [], |r| r.get::<_, i64>(0)).unwrap() == 3);
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
        assert_eq!(db.conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 10);
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
