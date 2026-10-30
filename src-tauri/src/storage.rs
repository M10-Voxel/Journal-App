use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeSet, HashSet, VecDeque}, error::Error, path::Path};
use uuid::Uuid;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: String, pub kind: String, pub text: String, pub done: bool, pub cancelled: bool, #[serde(default)] pub priority: bool,
    /// Optional `HH:MM` on the entry's own day.
    #[serde(default)] pub time: Option<String>,
    /// Optional end `HH:MM` on the same day, after `time` (entries made by marking a range in the calendar).
    #[serde(default)] pub end: Option<String>,
    /// Whether the user wants a reminder. Only stored; notifications are not implemented yet.
    #[serde(default)] pub reminder: bool,
    /// Set on an entry that was planned away and stays behind as a trace.
    #[serde(default)] pub plan: Option<Plan>,
    /// Date of the trace this entry was planned from. Derived when loading, ignored when saving.
    #[serde(default, skip_serializing_if = "Option::is_none")] pub origin: Option<String>,
}
/// `via` is `tomorrow`, `date` or `days`. Each target is created once, as an entry with the target's ID, when the trace is first saved.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Plan { pub via: String, pub targets: Vec<PlanTarget>, #[serde(default)] pub time: Option<String>, #[serde(default, skip_serializing_if = "Option::is_none")] pub end: Option<String>, #[serde(default)] pub reminder: bool }
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
pub struct LinkedEntry { pub id: String, pub date: String, pub kind: String, pub done: bool, pub cancelled: bool, pub trace: bool }
/// `action` is `remove`, `done`, `cancelled` or `open`.
#[derive(Clone, Debug, Deserialize)]
pub struct LinkedChange { pub id: String, pub action: String }
pub struct Store { conn: Connection }

impl Store {
    pub fn open(path: &Path) -> Result<Self> { Self::from_connection(Connection::open(path)?) }
    fn from_connection(mut conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        // WAL needs fewer syncs per save than the rollback journal and keeps reads independent of writes.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > 5 { return Err("Die Datenbank wurde mit einer neueren Version erstellt".into()); }
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
        Ok(Self { conn })
    }
    pub fn load(&self, date: &str) -> Result<Day> {
        validate_date(date)?;
        let mut day = self.conn.query_row("SELECT title, body, revision FROM days WHERE date = ?1", [date], |r| Ok(Day { date: date.into(), title: r.get(0)?, body: r.get(1)?, revision: r.get(2)?, entries: vec![], touched: vec![] })).optional()?.unwrap_or(Day { date: date.into(), title: String::new(), body: String::new(), revision: 0, entries: vec![], touched: vec![] });
        let mut stmt = self.conn.prepare_cached("SELECT id, kind, text, done, cancelled, priority, time, reminder, plan, end_time FROM entries WHERE day_date = ?1 ORDER BY position")?;
        let rows = stmt.query_map([date], |r| Ok((Entry { id:r.get(0)?, kind:r.get(1)?, text:r.get(2)?, done:r.get(3)?, cancelled:r.get(4)?, priority:r.get(5)?, time:r.get(6)?, end:r.get(9)?, reminder:r.get(7)?, plan:None, origin:None }, r.get::<_, Option<String>>(8)?)))?;
        let mut origins = self.conn.prepare_cached("SELECT json_extract(t.value, '$.id'), e.day_date FROM entries e, json_each(e.plan, '$.targets') t WHERE json_extract(t.value, '$.date') = ?1")?;
        let origins = origins.query_map([date], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()?;
        for row in rows {
            let (mut entry, plan) = row?;
            entry.plan = plan.map(|plan| serde_json::from_str(&plan)).transpose()?;
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
        let mut stmt = self.conn.prepare_cached("SELECT day_date, id, kind, text, done, cancelled, priority, time, reminder, end_time FROM entries WHERE day_date BETWEEN ?1 AND ?2 AND plan IS NULL ORDER BY day_date, position")?;
        let rows = stmt.query_map([from, to], |r| Ok((r.get::<_, String>(0)?, Entry { id:r.get(1)?, kind:r.get(2)?, text:r.get(3)?, done:r.get(4)?, cancelled:r.get(5)?, priority:r.get(6)?, time:r.get(7)?, end:r.get(9)?, reminder:r.get(8)?, plan:None, origin:None })))?;
        let mut index = 0;
        for row in rows {
            let (date, entry) = row?;
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
            if !valid_time(&entry.time) || !valid_span(&entry.time, &entry.end) { return Err("Ungültige Uhrzeit".into()); }
        }
        for plan in day.entries.iter().filter_map(|entry| entry.plan.as_ref()) {
            let single = matches!(plan.via.as_str(), "tomorrow" | "date");
            if !(single || plan.via == "days") || plan.targets.is_empty() || (single && plan.targets.len() != 1) || !valid_time(&plan.time) || !valid_span(&plan.time, &plan.end) { return Err("Ungültige Planung".into()); }
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
            let mut original = tx.prepare_cached("SELECT day_date, kind, text, priority FROM entries WHERE id=?1")?;
            for entry in &day.entries {
                let found: Option<(String, String, String, bool)> = original.query_row([&entry.id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()?;
                if let Some((date, kind, text, priority)) = found {
                    if date != day.date { return Err("Eintrag gehört zu einem anderen Tag".into()); }
                    if kind != entry.kind || text != entry.text || priority != entry.priority { edited.push(entry.id.clone()); }
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
        day.revision += 1;
        tx.execute("INSERT INTO days(date,title,body,revision) VALUES(?1,?2,?3,?4) ON CONFLICT(date) DO UPDATE SET title=excluded.title, body=excluded.body, revision=excluded.revision", params![day.date, day.title, day.body, day.revision])?;
        tx.execute("DELETE FROM entries WHERE day_date=?1", [&day.date])?;
        {
            let mut insert = tx.prepare_cached("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan,end_time) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)")?;
            for (position, entry) in day.entries.iter().enumerate() {
                let plan = entry.plan.as_ref().map(serde_json::to_string).transpose()?;
                insert.execute(params![entry.id,day.date,entry.kind,entry.text,entry.done,position as i64,entry.cancelled,entry.priority,entry.time,entry.reminder,plan,entry.end])?;
            }
            // A newly planned trace moves its entry: an open copy with the planned time and reminder is appended to every target day.
            let mut exists = tx.prepare_cached("SELECT 1 FROM entries WHERE id=?1")?;
            let mut touch = tx.prepare_cached("INSERT INTO days(date,title,body,revision) VALUES(?1,'','',1) ON CONFLICT(date) DO UPDATE SET revision=revision+1")?;
            let mut next_position = tx.prepare_cached("SELECT COALESCE(MAX(position)+1,0) FROM entries WHERE day_date=?1")?;
            for entry in &day.entries {
                let Some(plan) = &entry.plan else { continue };
                for target in plan.targets.iter().filter(|target| !created.contains(&target.id)) {
                    if exists.query_row([&target.id], |_| Ok(())).optional()?.is_some() { return Err("Der geplante Eintrag existiert bereits".into()); }
                    touch.execute([&target.date])?;
                    let position: i64 = next_position.query_row([&target.date], |r| r.get(0))?;
                    insert.execute(params![target.id,target.date,entry.kind,entry.text,false,position,false,entry.priority,plan.time,plan.reminder,None::<String>,plan.end])?;
                }
            }
        }
        let mut touched: BTreeSet<String> = day.entries.iter().filter_map(|entry| entry.plan.as_ref()).flat_map(|plan| plan.targets.iter())
            .filter(|target| !created.contains(&target.id)).map(|target| target.date.clone()).collect();
        let mut linked = BTreeSet::new();
        for id in &edited {
            let entry = day.entries.iter().find(|entry| &entry.id == id).expect("edited entries come from this day");
            sync_linked(&tx, entry, &mut linked)?;
        }
        linked.remove(&day.date);
        for date in &linked { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        touched.extend(linked);
        tx.commit()?;
        let mut saved = self.load(&day.date)?;
        saved.touched = touched.into_iter().collect();
        Ok(saved)
    }
    /// The group an entry belongs to – the entry itself, the traces it was planned from and the copies planned from it,
    /// along whole chains – in date order.
    pub fn linked(&self, id: &str) -> Result<Vec<LinkedEntry>> {
        let mut group = Vec::new();
        let mut entry = self.conn.prepare_cached("SELECT day_date, kind, done, cancelled, plan IS NOT NULL FROM entries WHERE id=?1")?;
        for id in linked_ids(&self.conn, id)? {
            if let Some((date, kind, done, cancelled, trace)) = entry.query_row([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()? {
                group.push(LinkedEntry { id, date, kind, done, cancelled, trace });
            }
        }
        group.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(group)
    }
    /// Removes entries or sets the status of tasks on other days in one go (an action reaching linked entries).
    /// Traces keep no status. Returns the days that changed.
    pub fn change_linked(&mut self, changes: &[LinkedChange]) -> Result<Vec<String>> {
        let tx = self.conn.transaction()?;
        let mut touched = BTreeSet::new();
        {
            let mut remove = tx.prepare_cached("DELETE FROM entries WHERE id=?1 RETURNING day_date")?;
            let mut status = tx.prepare_cached("UPDATE entries SET done=?2, cancelled=?3 WHERE id=?1 AND kind='task' AND plan IS NULL AND (done<>?2 OR cancelled<>?3) RETURNING day_date")?;
            for change in changes {
                let date: Option<String> = match change.action.as_str() {
                    "remove" => remove.query_row([&change.id], |r| r.get(0)).optional()?,
                    "done" | "cancelled" | "open" => status.query_row(params![change.id, change.action == "done", change.action == "cancelled"], |r| r.get(0)).optional()?,
                    _ => return Err("Unbekannte Änderung".into()),
                };
                touched.extend(date);
            }
            for date in &touched { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        }
        tx.commit()?;
        Ok(touched.into_iter().collect())
    }
}
/// Every entry linked with `id` (itself included): through plan targets in both directions, along whole chains.
fn linked_ids(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut targets = conn.prepare_cached("SELECT json_extract(t.value, '$.id') FROM entries e, json_each(e.plan, '$.targets') t WHERE e.id = ?1")?;
    let mut traces = conn.prepare_cached("SELECT e.id FROM entries e, json_each(e.plan, '$.targets') t WHERE json_extract(t.value, '$.id') = ?1")?;
    let mut seen = vec![id.to_string()];
    let mut queue = VecDeque::from([id.to_string()]);
    while let Some(current) = queue.pop_front() {
        let mut next: Vec<String> = targets.query_map([&current], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        next.extend(traces.query_map([&current], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?);
        for other in next { if !seen.contains(&other) { seen.push(other.clone()); queue.push_back(other); } }
    }
    Ok(seen)
}
/// An entry and the places it was planned to are one item: a new text, kind or priority reaches all of them, along whole
/// chains (planned on again) and in both directions (from a trace to its copies and from a copy back to its trace).
/// Only the task keeps a done or cancelled state; the time and status of each occurrence stay its own.
fn sync_linked(tx: &Connection, entry: &Entry, touched: &mut BTreeSet<String>) -> Result<()> {
    let mut update = tx.prepare_cached("UPDATE entries SET kind=?2, text=?3, priority=?4, done=CASE WHEN ?2='task' THEN done ELSE 0 END, cancelled=CASE WHEN ?2='task' THEN cancelled ELSE 0 END
        WHERE id=?1 AND (kind<>?2 OR text<>?3 OR priority<>?4) RETURNING day_date")?;
    for other in linked_ids(tx, &entry.id)?.into_iter().skip(1) {
        if let Some(date) = update.query_row(params![other, entry.kind, entry.text, entry.priority], |r| r.get::<_, String>(0)).optional()? { touched.insert(date); }
    }
    Ok(())
}
fn valid_time(time: &Option<String>) -> bool {
    time.as_deref().is_none_or(|time| time.len() == 5 && chrono::NaiveTime::parse_from_str(time, "%H:%M").is_ok())
}
/// An end needs a start and lies after it on the same day.
fn valid_span(time: &Option<String>, end: &Option<String>) -> bool {
    match (time, end) { (_, None) => true, (Some(time), Some(end)) => valid_time(&Some(end.clone())) && end > time, (None, Some(_)) => false }
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
    fn entry(kind: &str) -> Entry { Entry { id:Uuid::new_v4().to_string(), kind:kind.into(), text:"Beispiel".into(), done:false, cancelled:false, priority:false, time:None, end:None, reminder:false, plan:None, origin:None } }
    fn plan(via: &str, dates: &[&str], time: Option<&str>, reminder: bool) -> Plan {
        Plan { via: via.into(), targets: dates.iter().map(|date| PlanTarget { date: (*date).into(), id: Uuid::new_v4().to_string() }).collect(), time: time.map(Into::into), end: None, reminder }
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
        for (time, end) in [(Some("10:00"), "10:00"), (Some("10:00"), "09:45"), (None, "10:00"), (Some("10:00"), "24:00")] {
            let mut day = db.load("2026-10-30").unwrap();
            let mut item = entry("event"); item.time = time.map(Into::into); item.end = Some(end.into()); day.entries.push(item);
            assert!(db.save(day).is_err(), "{time:?}–{end} must be rejected");
        }
        assert!(db.conn.execute("UPDATE entries SET end_time = '08:00' WHERE day_date = '2026-10-28' AND end_time IS NOT NULL", []).is_err(), "The database itself refuses an end before the start.");
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
        day.entries[0].plan = Some(plan("tomorrow", &["2026-10-29"], None, false));
        db.save(day).unwrap();
        assert_eq!(db.load("2026-10-29").unwrap().entries[0].text, "Bestehend");
        assert_eq!(db.conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 5);
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
