//! The warm data (docs/plan.md, 3): the entries of a stretch of days and the tags, ready when the window opens. The
//! stretch grows as the calendar is scrolled (it is endless); it is read again only when the database changed
//! (`PRAGMA data_version`, through `journal-core`'s watch). The app's period data (rating, day values, activities) is
//! read with them, for the day view.
use std::collections::BTreeMap;
use chrono::NaiveDate;
use journal_core::{storage::{Entry, Store, Tag}, watch::Watch};
use crate::{day_view::PeriodData, repeat};

/// Kept before what is shown: an entry over several days (at most 366 in the app) may reach into the view from there.
pub const LOOKBACK: i64 = 370;
/// Read ahead of what is shown.
pub const AHEAD: i64 = 120;
/// `Store::load_range` takes at most 400 days at once.
const CHUNK: i64 = 360;

pub struct Snapshot {
    pub today: NaiveDate,
    pub days: BTreeMap<NaiveDate, Vec<Entry>>,
    pub tags: Vec<Tag>,
    pub tag_kind_order: Vec<String>,
    pub period: PeriodData,
    /// The days read: `from..=to`.
    from: NaiveDate,
    to: NaiveDate,
    watch: Watch,
}

fn parse_date(text: &str) -> Option<NaiveDate> { NaiveDate::parse_from_str(text, "%Y-%m-%d").ok() }

fn read_days(store: &Store, from: NaiveDate, to: NaiveDate, into: &mut BTreeMap<NaiveDate, Vec<Entry>>) -> Result<(), String> {
    let mut start = from;
    while start <= to {
        let end = repeat::shift(start, CHUNK - 1).min(to);
        for day in store.load_range(&start.to_string(), &end.to_string()).map_err(|e| e.to_string())? {
            let Some(date) = parse_date(&day.date) else { continue };
            into.insert(date, day.entries.into_iter().filter(|entry| entry.plan.is_none()).collect());
        }
        start = repeat::shift(end, 1);
    }
    Ok(())
}

impl Snapshot {
    pub fn load(store: &Store, today: NaiveDate) -> Result<Self, String> {
        let watch = store.watch().map_err(|e| e.to_string())?;
        let mut snapshot = Snapshot { today, days: BTreeMap::new(), tags: Vec::new(), tag_kind_order: Vec::new(), period: PeriodData::default(), from: repeat::shift(today, -LOOKBACK), to: repeat::shift(today, AHEAD), watch };
        snapshot.read(store)?;
        Ok(snapshot)
    }

    fn read(&mut self, store: &Store) -> Result<(), String> {
        self.days.clear();
        read_days(store, self.from, self.to, &mut self.days)?;
        self.read_tags(store)?;
        self.period = PeriodData::parse(&store.period_data().map_err(|e| e.to_string())?);
        Ok(())
    }

    fn read_tags(&mut self, store: &Store) -> Result<(), String> {
        self.tags = store.tags().map_err(|e| e.to_string())?;
        use rusqlite::OptionalExtension;
        let raw: Option<String> = store.conn.query_row("SELECT value FROM settings WHERE key='tag-kind-order'", [], |r| r.get(0))
            .optional().map_err(|e| e.to_string())?;
        self.tag_kind_order = raw.and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
            .filter(|order| order.len() == 3 && ["own", "activity", "mail"].iter().all(|k| order.iter().any(|item| item == k)))
            .unwrap_or_else(|| ["own", "activity", "mail"].map(str::to_owned).to_vec());
        Ok(())
    }

    /// Makes sure the days `from..=to` are read (scrolling the calendar). True when something was added.
    pub fn ensure(&mut self, store: &Store, from: NaiveDate, to: NaiveDate) -> Result<bool, String> {
        let mut grew = false;
        if from < self.from {
            read_days(store, from, repeat::shift(self.from, -1), &mut self.days)?;
            self.from = from; grew = true;
        }
        if to > self.to {
            read_days(store, repeat::shift(self.to, 1), to, &mut self.days)?;
            self.to = to; grew = true;
        }
        Ok(grew)
    }

    /// Reads again when something changed; true when it did.
    pub fn refresh(&mut self, store: &Store, today: NaiveDate) -> Result<bool, String> {
        let changed = store.external_changes(&mut self.watch).map_err(|e| e.to_string())?.is_some();
        if !changed && today == self.today { return Ok(false); }
        self.today = today;
        self.read(store)?;
        self.watch = store.watch().map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// After our own change of a few days (the day view): only they and the tags are read again.
    pub fn reload_days(&mut self, store: &Store, dates: &[NaiveDate]) -> Result<(), String> {
        for date in dates.iter().filter(|date| **date >= self.from && **date <= self.to) {
            let mut one = BTreeMap::new();
            read_days(store, *date, *date, &mut one)?;
            match one.remove(date) { Some(entries) => { self.days.insert(*date, entries); } None => { self.days.remove(date); } }
        }
        self.read_tags(store)?;
        self.watch = store.watch().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// After our own change of the period data.
    pub fn set_period(&mut self, store: &Store, json: &str) -> Result<(), String> {
        self.period = PeriodData::parse(json);
        self.watch = store.watch().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// After our own save.
    pub fn reload(&mut self, store: &Store) -> Result<(), String> {
        self.read(store)?;
        self.watch = store.watch().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repeat::d;

    #[test]
    fn the_stretch_grows_in_both_directions_beyond_what_one_read_may_take() {
        let path = std::env::temp_dir().join(format!("j-terminal-snapshot-{}.sqlite3", uuid::Uuid::new_v4()));
        {
            let mut store = Store::open(&path).unwrap();
            for date in ["2024-01-10", "2026-11-20", "2029-06-01"] {
                let mut day = store.load(date).unwrap();
                day.entries.push(serde_json::from_value(serde_json::json!({ "id": uuid::Uuid::new_v4().to_string(), "kind": "task", "text": date, "done": false, "cancelled": false })).unwrap());
                store.save(day).unwrap();
            }
            let mut snapshot = Snapshot::load(&store, d("2026-11-18")).unwrap();
            assert!(snapshot.days.contains_key(&d("2026-11-20")));
            assert!(!snapshot.days.contains_key(&d("2029-06-01")));
            assert!(snapshot.ensure(&store, d("2023-12-01"), d("2029-07-01")).unwrap());
            assert!(snapshot.days.contains_key(&d("2024-01-10")) && snapshot.days.contains_key(&d("2029-06-01")));
            assert!(!snapshot.ensure(&store, d("2025-01-01"), d("2026-01-01")).unwrap(), "Nothing new to read.");
        }
        for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
    }
}
