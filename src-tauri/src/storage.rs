use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, error::Error, path::Path};
use uuid::Uuid;

type Result<T> = std::result::Result<T, Box<dyn Error>>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry { pub id: String, pub kind: String, pub text: String, pub done: bool, pub cancelled: bool }
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Day { pub date: String, pub title: String, pub body: String, pub revision: i64, pub entries: Vec<Entry> }
pub struct Store { conn: Connection }

impl Store {
    pub fn open(path: &Path) -> Result<Self> { Self::from_connection(Connection::open(path)?) }
    fn from_connection(mut conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        // WAL needs fewer syncs per save than the rollback journal and keeps reads independent of writes.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > 2 { return Err("Die Datenbank wurde mit einer neueren Version erstellt".into()); }
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
        Ok(Self { conn })
    }
    pub fn load(&self, date: &str) -> Result<Day> {
        validate_date(date)?;
        let mut day = self.conn.query_row("SELECT title, body, revision FROM days WHERE date = ?1", [date], |r| Ok(Day { date: date.into(), title: r.get(0)?, body: r.get(1)?, revision: r.get(2)?, entries: vec![] })).optional()?.unwrap_or(Day { date: date.into(), title: String::new(), body: String::new(), revision: 0, entries: vec![] });
        let mut stmt = self.conn.prepare_cached("SELECT id, kind, text, done, cancelled FROM entries WHERE day_date = ?1 ORDER BY position")?;
        day.entries = stmt.query_map([date], |r| Ok(Entry { id:r.get(0)?, kind:r.get(1)?, text:r.get(2)?, done:r.get(3)?, cancelled:r.get(4)? }))?.collect::<rusqlite::Result<_>>()?;
        Ok(day)
    }
    pub fn save(&mut self, mut day: Day) -> Result<Day> {
        validate_date(&day.date)?;
        let mut ids = HashSet::new();
        for entry in &day.entries {
            if Uuid::parse_str(&entry.id).is_err() || !ids.insert(&entry.id) || !matches!(entry.kind.as_str(), "task" | "event" | "note") || (entry.kind != "task" && (entry.done || entry.cancelled)) || (entry.done && entry.cancelled) { return Err("Ungültiger Eintrag".into()); }
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
        day.revision += 1;
        tx.execute("INSERT INTO days(date,title,body,revision) VALUES(?1,?2,?3,?4) ON CONFLICT(date) DO UPDATE SET title=excluded.title, body=excluded.body, revision=excluded.revision", params![day.date, day.title, day.body, day.revision])?;
        tx.execute("DELETE FROM entries WHERE day_date=?1", [&day.date])?;
        {
            let mut insert = tx.prepare_cached("INSERT INTO entries(id,day_date,kind,text,done,position,cancelled) VALUES(?1,?2,?3,?4,?5,?6,?7)")?;
            for (position, entry) in day.entries.iter().enumerate() {
                insert.execute(params![entry.id,day.date,entry.kind,entry.text,entry.done,position as i64,entry.cancelled])?;
            }
        }
        tx.commit()?;
        Ok(day)
    }
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
    fn entry(kind: &str) -> Entry { Entry { id:Uuid::new_v4().to_string(), kind:kind.into(), text:"Beispiel".into(), done:false, cancelled:false } }
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
}
