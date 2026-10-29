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
    /// Whether the user wants a reminder. Only stored; notifications are not implemented yet.
    #[serde(default)] pub reminder: bool,
    /// Set on an entry that was planned away and stays behind as a trace.
    #[serde(default)] pub plan: Option<Plan>,
    /// Date of the trace this entry was planned from. Derived when loading, ignored when saving.
    #[serde(default, skip_serializing_if = "Option::is_none")] pub origin: Option<String>,
}
/// `via` is `tomorrow`, `date` or `days`. Each target is created once, as an entry with the target's ID, when the trace is first saved.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Plan { pub via: String, pub targets: Vec<PlanTarget>, #[serde(default)] pub time: Option<String>, #[serde(default)] pub reminder: bool }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlanTarget { pub date: String, pub id: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Day {
    pub date: String, pub title: String, pub body: String, pub revision: i64, pub entries: Vec<Entry>,
    /// Other days changed by a save (planned copies created, linked entries removed). Empty when loading.
    #[serde(default, skip_serializing_if = "Vec::is_empty")] pub touched: Vec<String>,
}
pub struct Store { conn: Connection }

impl Store {
    pub fn open(path: &Path) -> Result<Self> { Self::from_connection(Connection::open(path)?) }
    fn from_connection(mut conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        // WAL needs fewer syncs per save than the rollback journal and keeps reads independent of writes.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > 4 { return Err("Die Datenbank wurde mit einer neueren Version erstellt".into()); }
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
        Ok(Self { conn })
    }
    pub fn load(&self, date: &str) -> Result<Day> {
        validate_date(date)?;
        let mut day = self.conn.query_row("SELECT title, body, revision FROM days WHERE date = ?1", [date], |r| Ok(Day { date: date.into(), title: r.get(0)?, body: r.get(1)?, revision: r.get(2)?, entries: vec![], touched: vec![] })).optional()?.unwrap_or(Day { date: date.into(), title: String::new(), body: String::new(), revision: 0, entries: vec![], touched: vec![] });
        let mut stmt = self.conn.prepare_cached("SELECT id, kind, text, done, cancelled, priority, time, reminder, plan FROM entries WHERE day_date = ?1 ORDER BY position")?;
        let rows = stmt.query_map([date], |r| Ok((Entry { id:r.get(0)?, kind:r.get(1)?, text:r.get(2)?, done:r.get(3)?, cancelled:r.get(4)?, priority:r.get(5)?, time:r.get(6)?, reminder:r.get(7)?, plan:None, origin:None }, r.get::<_, Option<String>>(8)?)))?;
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
    pub fn save(&mut self, mut day: Day) -> Result<Day> {
        validate_date(&day.date)?;
        let mut ids = HashSet::new();
        for entry in &day.entries {
            if Uuid::parse_str(&entry.id).is_err() || !ids.insert(&entry.id) || !matches!(entry.kind.as_str(), "task" | "event" | "note") || (entry.kind != "task" && (entry.done || entry.cancelled)) || (entry.done && entry.cancelled) { return Err("Ungültiger Eintrag".into()); }
            if entry.kind == "note" && (entry.time.is_some() || entry.reminder || entry.plan.is_some()) { return Err("Notizen können nicht geplant werden".into()); }
            if !valid_time(&entry.time) { return Err("Ungültige Uhrzeit".into()); }
        }
        for plan in day.entries.iter().filter_map(|entry| entry.plan.as_ref()) {
            let single = matches!(plan.via.as_str(), "tomorrow" | "date");
            if !(single || plan.via == "days") || plan.targets.is_empty() || (single && plan.targets.len() != 1) || !valid_time(&plan.time) { return Err("Ungültige Planung".into()); }
            let mut dates = HashSet::new();
            for target in &plan.targets {
                validate_date(&target.date)?;
                if target.date == day.date || !dates.insert(&target.date) || Uuid::parse_str(&target.id).is_err() || !ids.insert(&target.id) { return Err("Ungültige Planung".into()); }
            }
        }
        let tx = self.conn.transaction()?;
        let current: Option<i64> = tx.prepare_cached("SELECT revision FROM days WHERE date=?1")?.query_row([&day.date], |r| r.get(0)).optional()?;
        if current.unwrap_or(0) != day.revision { return Err("Dieser Tag wurde inzwischen geändert. Bitte neu laden.".into()); }
        {
            let mut original = tx.prepare_cached("SELECT day_date, kind FROM entries WHERE id=?1")?;
            for entry in &day.entries {
                let found: Option<(String, String)> = original.query_row([&entry.id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
                if let Some((date, kind)) = found { if date != day.date || kind != entry.kind { return Err("Eintrag gehört zu einem anderen Tag oder Typ".into()); } }
            }
        }
        // Targets of traces that were already saved exist (or were deliberately deleted) on their days and must not be created again.
        let mut created = HashSet::new();
        let mut removed = Vec::new();
        {
            let kept: HashSet<&String> = day.entries.iter().map(|entry| &entry.id).collect();
            let mut stored = tx.prepare_cached("SELECT id, plan FROM entries WHERE day_date=?1")?;
            let rows = stored.query_map([&day.date], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
            for (id, plan) in rows {
                let plan = plan.map(|plan| serde_json::from_str::<Plan>(&plan)).transpose()?;
                if let Some(plan) = &plan { created.extend(plan.targets.iter().map(|target| target.id.clone())); }
                if !kept.contains(&id) { removed.push((id, plan)); }
            }
        }
        day.revision += 1;
        tx.execute("INSERT INTO days(date,title,body,revision) VALUES(?1,?2,?3,?4) ON CONFLICT(date) DO UPDATE SET title=excluded.title, body=excluded.body, revision=excluded.revision", params![day.date, day.title, day.body, day.revision])?;
        tx.execute("DELETE FROM entries WHERE day_date=?1", [&day.date])?;
        {
            let mut insert = tx.prepare_cached("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled,priority,time,reminder,plan) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")?;
            for (position, entry) in day.entries.iter().enumerate() {
                let plan = entry.plan.as_ref().map(serde_json::to_string).transpose()?;
                insert.execute(params![entry.id,day.date,entry.kind,entry.text,entry.done,position as i64,entry.cancelled,entry.priority,entry.time,entry.reminder,plan])?;
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
                    insert.execute(params![target.id,target.date,entry.kind,entry.text,false,position,false,entry.priority,plan.time,plan.reminder,None::<String>])?;
                }
            }
        }
        let mut touched: BTreeSet<String> = day.entries.iter().filter_map(|entry| entry.plan.as_ref()).flat_map(|plan| plan.targets.iter())
            .filter(|target| !created.contains(&target.id)).map(|target| target.date.clone()).collect();
        let mut linked = BTreeSet::new();
        remove_linked(&tx, removed, &mut linked)?;
        for date in &linked { tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [date])?; }
        touched.extend(linked);
        tx.commit()?;
        let mut saved = self.load(&day.date)?;
        saved.touched = touched.into_iter().collect();
        Ok(saved)
    }
}
/// An entry and the places it was planned to are one item: removing any of them removes the others.
/// Removing a trace removes its target entries; removing a target drops it from its trace, and a trace without targets goes too.
/// This follows whole chains (an entry planned on again), so the work list may revisit days, including the one being saved.
fn remove_linked(tx: &Connection, removed: Vec<(String, Option<Plan>)>, touched: &mut BTreeSet<String>) -> Result<()> {
    let mut queue: VecDeque<(String, Option<Plan>)> = removed.into();
    let mut seen = HashSet::new();
    let mut take = tx.prepare_cached("DELETE FROM entries WHERE id=?1 RETURNING day_date, plan")?;
    let mut traces = tx.prepare_cached("SELECT e.id, e.day_date, e.plan FROM entries e, json_each(e.plan, '$.targets') t WHERE json_extract(t.value, '$.id') = ?1")?;
    let mut update = tx.prepare_cached("UPDATE entries SET plan=?2 WHERE id=?1")?;
    while let Some((id, plan)) = queue.pop_front() {
        if !seen.insert(id.clone()) { continue; }
        for target in plan.map(|plan| plan.targets).unwrap_or_default() {
            let row: Option<(String, Option<String>)> = take.query_row([&target.id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            if let Some((date, plan)) = row {
                touched.insert(date);
                queue.push_back((target.id, plan.map(|plan| serde_json::from_str(&plan)).transpose()?));
            }
        }
        let referencing = traces.query_map([&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
        for (trace_id, date, plan) in referencing {
            let mut plan: Plan = serde_json::from_str(&plan)?;
            plan.targets.retain(|target| target.id != id);
            touched.insert(date);
            if plan.targets.is_empty() {
                take.query_row([&trace_id], |_| Ok(())).optional()?;
                queue.push_back((trace_id, None));
            } else {
                update.execute(params![trace_id, serde_json::to_string(&plan)?])?;
            }
        }
    }
    Ok(())
}
fn valid_time(time: &Option<String>) -> bool {
    time.as_deref().is_none_or(|time| time.len() == 5 && chrono::NaiveTime::parse_from_str(time, "%H:%M").is_ok())
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
    fn entry(kind: &str) -> Entry { Entry { id:Uuid::new_v4().to_string(), kind:kind.into(), text:"Beispiel".into(), done:false, cancelled:false, priority:false, time:None, reminder:false, plan:None, origin:None } }
    fn plan(via: &str, dates: &[&str], time: Option<&str>, reminder: bool) -> Plan {
        Plan { via: via.into(), targets: dates.iter().map(|date| PlanTarget { date: (*date).into(), id: Uuid::new_v4().to_string() }).collect(), time: time.map(Into::into), reminder }
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
        // Deleting the moved entry also removes its trace, and saving the origin again creates nothing.
        target.entries.clear(); db.save(target).unwrap();
        let mut origin = db.load("2026-10-28").unwrap();
        assert_eq!(origin.entries.len(), 1, "Only the unrelated event remains.");
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
    #[test] fn removing_a_trace_removes_the_moved_entry() {
        let mut db = store();
        let (trace, targets) = planned(&mut db, "2026-10-28", "task", &["2026-10-30"]);
        let mut other = db.load("2026-10-30").unwrap(); other.entries.push(entry("note")); db.save(other).unwrap();
        assert_eq!(db.load("2026-10-30").unwrap().entries[0].origin.as_deref(), Some("2026-10-28"), "Moved entries know their trace's day.");
        let before = db.load("2026-10-30").unwrap().revision;
        let mut day = db.load("2026-10-28").unwrap(); day.entries.retain(|item| item.id != trace);
        let saved = db.save(day).unwrap();
        assert_eq!(saved.touched, vec!["2026-10-30".to_string()]);
        let target = db.load("2026-10-30").unwrap();
        assert!(target.entries.iter().all(|item| item.id != targets[0])); assert_eq!(target.entries.len(), 1, "Unrelated entries stay.");
        assert_eq!(target.revision, before + 1, "The changed day must reject stale saves.");
    }
    #[test] fn removing_the_moved_entry_removes_its_trace() {
        let mut db = store();
        let (trace, targets) = planned(&mut db, "2026-10-28", "event", &["2026-10-30"]);
        let mut target = db.load("2026-10-30").unwrap(); target.entries.retain(|item| item.id != targets[0]);
        assert_eq!(db.save(target).unwrap().touched, vec!["2026-10-28".to_string()]);
        assert!(db.load("2026-10-28").unwrap().entries.iter().all(|item| item.id != trace));
    }
    #[test] fn removing_one_of_several_days_keeps_the_others() {
        let mut db = store();
        let (trace, targets) = planned(&mut db, "2026-10-28", "event", &["2026-10-29", "2026-10-30"]);
        let mut first = db.load("2026-10-29").unwrap(); first.entries.clear(); db.save(first).unwrap();
        let origin = db.load("2026-10-28").unwrap();
        let plan = origin.entries.iter().find(|item| item.id == trace).unwrap().plan.as_ref().unwrap();
        assert_eq!(plan.targets.iter().map(|target| target.id.clone()).collect::<Vec<_>>(), vec![targets[1].clone()]);
        assert_eq!(db.load("2026-10-30").unwrap().entries.len(), 1);
        db.save(origin).unwrap();
        assert_eq!(db.load("2026-10-29").unwrap().entries.len(), 0, "A removed occurrence is not created again.");
    }
    #[test] fn removing_any_link_of_a_chain_removes_the_whole_chain() {
        let mut db = store();
        let (first, targets) = planned(&mut db, "2026-10-28", "task", &["2026-10-29"]);
        let mut middle = db.load("2026-10-29").unwrap();
        let next = plan("tomorrow", &["2026-10-30"], Some("08:00"), true); let last = next.targets[0].id.clone();
        middle.entries[0].plan = Some(next); db.save(middle).unwrap();
        assert_eq!(db.load("2026-10-30").unwrap().entries[0].id, last);
        let mut end = db.load("2026-10-30").unwrap(); end.entries.clear();
        let saved = db.save(end).unwrap();
        assert_eq!(saved.touched, vec!["2026-10-28".to_string(), "2026-10-29".to_string()]);
        assert!(db.load("2026-10-29").unwrap().entries.iter().all(|item| item.id != targets[0]));
        assert!(db.load("2026-10-28").unwrap().entries.iter().all(|item| item.id != first));
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
        assert_eq!(db.conn.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0)).unwrap(), 4);
    }
    #[test] fn save_reload_and_isolate_days() {
        let mut db = store(); let mut day = db.load("2024-02-29").unwrap(); day.title="Ein Tag".into(); day.entries=vec![entry("task"),entry("event"),entry("note")];
        let saved = db.save(day).unwrap(); let loaded = db.load("2024-02-29").unwrap();
        assert_eq!(loaded.entries.len(),3); assert_eq!(loaded.entries[0].id,saved.entries[0].id); assert_eq!(loaded.title,"Ein Tag"); assert!(db.load("2024-03-01").unwrap().entries.is_empty());
    }
    #[test] fn reject_stale_and_type_change_without_partial_writes() {
        let mut db = store(); let mut day = db.load("2025-12-31").unwrap(); day.entries.push(entry("task")); let saved = db.save(day).unwrap();
        let mut changed=saved.clone(); changed.entries[0].kind="event".into(); changed.title="Darf nicht gespeichert werden".into(); assert!(db.save(changed).is_err());
        assert_eq!(db.load("2025-12-31").unwrap().title, ""); let mut next=saved.clone(); next.title="Neu".into(); db.save(next).unwrap(); assert!(db.save(saved).is_err());
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
