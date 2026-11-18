//! Noticing what other programs wrote into the same database (J-TerminaL, or anything else using journal-core).
//! `PRAGMA data_version` changes only when another connection commits, so a poll costs one query while nothing happens.
//! What changed is read from the undo history every write records into (`history.rs`): the groups added since the last
//! look name their tables and rows. An undo or redo elsewhere adds no group but moves the history's cursor.
use rusqlite::{params, Result};
use crate::storage::Store;

/// Where the last look stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Watch { version: i64, group: i64, cursor: i64 }

/// What other programs changed since the last look.
#[derive(Default, Debug, PartialEq, Eq)]
pub struct Changes {
    /// Days whose title or entries changed, in order.
    pub dates: Vec<String>,
    pub tags: bool,
    /// The ratings, scales, activities and period notes (`period-data`).
    pub period: bool,
    /// Board cards or folders.
    pub board: bool,
    /// Their history was stepped (undo/redo): what changed is not listed, everything shown should be read again.
    pub restored: bool,
}

impl Store {
    /// The current marks; changes before this are not reported.
    pub fn watch(&self) -> Result<Watch> {
        Ok(Watch {
            version: self.conn.query_row("PRAGMA data_version", [], |row| row.get(0))?,
            group: self.conn.query_row("SELECT COALESCE(MAX(id), 0) FROM undo_groups", [], |row| row.get(0))?,
            cursor: self.conn.query_row("SELECT cursor FROM undo_state WHERE id=1", [], |row| row.get(0))?,
        })
    }

    /// What other connections committed since `watch`, which then moves on; None while they wrote nothing.
    /// Own writes in between may be listed too (harmless: they are only read again).
    pub fn external_changes(&self, watch: &mut Watch) -> Result<Option<Changes>> {
        let version: i64 = self.conn.query_row("PRAGMA data_version", [], |row| row.get(0))?;
        if version == watch.version { return Ok(None); }
        let next = self.watch()?;
        let mut changes = Changes::default();
        let mut dates = std::collections::BTreeSet::new();
        let mut rows = self.conn.prepare(
            "SELECT t, k, json_extract(b, '$.day_date'), json_extract(a, '$.day_date') FROM undo_rows WHERE g > ?1")?;
        let found = rows.query_map(params![watch.group], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, Option<String>>(3)?)))?;
        for row in found {
            let (table, key, before, after) = row?;
            match table.as_str() {
                "days" => { dates.insert(key); }
                "entries" => { dates.extend(before); dates.extend(after); }
                "tags" => changes.tags = true,
                "settings" if key == "period-data" => changes.period = true,
                "settings" if key.starts_with("board:") => changes.board = true,
                _ => {}
            }
        }
        // A new write puts the cursor on the newest group; behind it, history was stepped back. (The history is shared,
        // so an undo elsewhere may take back one of our own writes, and the cursor can end where it was last time.)
        // A redo onto an older group moved the cursor; one onto a group made since the last look shows in its rows.
        changes.restored = next.cursor != next.group || (next.cursor != watch.cursor && next.cursor <= watch.group);
        changes.dates = dates.into_iter().collect();
        *watch = next;
        Ok(Some(changes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Day;

    fn day(date: &str, id: &str, text: &str) -> Day {
        serde_json::from_value(serde_json::json!({ "date": date, "title": "", "body": "", "revision": 0,
            "entries": [{ "id": id, "kind": "task", "text": text, "done": false, "cancelled": false }] })).unwrap()
    }

    #[test]
    fn reports_what_another_program_wrote_and_nothing_else() {
        let path = std::env::temp_dir().join(format!("watch-{}.db", uuid::Uuid::new_v4()));
        let app = Store::open(&path).unwrap();
        let mut other = Store::open(&path).unwrap();
        let mut watch = app.watch().unwrap();
        assert_eq!(app.external_changes(&mut watch).unwrap(), None, "Nothing written yet.");

        // J-TerminaL adds a task on one day and changes the ratings.
        other.save(day("2026-11-20", "10000000-0000-4000-8000-000000000001", "Zahnarzt")).unwrap();
        other.save_period_data("{\"rating\":3}").unwrap();
        let changes = app.external_changes(&mut watch).unwrap().expect("another connection committed");
        assert_eq!(changes.dates, vec!["2026-11-20".to_string()]);
        assert!(changes.period && !changes.tags && !changes.board && !changes.restored);
        assert_eq!(app.external_changes(&mut watch).unwrap(), None, "Reported once.");

        // Writing through the app's own connection is not reported.
        app.save_period_data("{\"rating\":4}").unwrap();
        assert_eq!(app.external_changes(&mut watch).unwrap(), None);

        // An undo in the other program is reported as restored history (here it takes back the app's own last write:
        // the history is shared).
        assert!(crate::history::step(&mut other, false).unwrap());
        let changes = app.external_changes(&mut watch).unwrap().expect("the undo was committed elsewhere");
        assert!(changes.restored);
        assert_eq!(app.period_data().unwrap(), "{\"rating\":3}");
        // A redo too; a new write afterwards is a plain change again.
        assert!(crate::history::step(&mut other, true).unwrap());
        assert!(app.external_changes(&mut watch).unwrap().unwrap().restored);
        other.save_period_data("{\"rating\":5}").unwrap();
        let changes = app.external_changes(&mut watch).unwrap().unwrap();
        assert!(changes.period && !changes.restored);
        drop(app); drop(other);
        for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
    }
}
