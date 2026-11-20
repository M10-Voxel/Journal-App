//! Writing what the line says into the journal, through `journal-core` like the app's `save_day`: the day is loaded,
//! the entry added at its end and the day saved. Every save lands in the shared history, so `Strg+Z` in the app takes
//! it back as well; here the first suggestion after saving does.
use chrono::NaiveDate;
use journal_core::{history, storage::{Entry, Store}};
use serde_json::json;
use crate::engine::{parse::Kind, resolve::Outcome};
use crate::repeat;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Saved {
    /// The history groups the save made, in order (one per day written).
    pub groups: Vec<i64>,
    pub text: String,
    pub days: Vec<NaiveDate>,
}

/// What an entry has beyond what `Outcome` knows: the fields of the app's entry editor.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Extras {
    pub description: String,
    pub priority: bool,
    /// Minutes before the entry's time; `None` without a reminder.
    pub reminder: Option<i64>,
    pub icon: Option<String>,
    pub show_in_journal: bool,
    pub time_grid: bool,
}
impl Default for Extras {
    fn default() -> Self { Extras { description: String::new(), priority: false, reminder: None, icon: None, show_in_journal: true, time_grid: false } }
}

fn kind_name(kind: Kind) -> &'static str { match kind { Kind::Task => "task", Kind::Event => "event", Kind::Note => "note" } }

/// The history's position: the newest group not taken back.
pub fn cursor(store: &Store) -> Result<i64, String> {
    store.conn.query_row("SELECT cursor FROM undo_state WHERE id=1", [], |row| row.get(0)).map_err(|e| e.to_string())
}

fn entry(outcome: &Outcome, extras: &Extras, today: NaiveDate, with_repeat: bool) -> Result<Entry, String> {
    let mut value = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "kind": kind_name(outcome.kind),
        "text": outcome.text,
        "done": false,
        "cancelled": false,
        "time": outcome.time,
        "end": outcome.end,
        "tag": outcome.tag,
        "description": extras.description,
        "priority": extras.priority,
        "reminder": extras.reminder.is_some(),
        "reminderBefore": extras.reminder.unwrap_or(0),
        "icon": extras.icon,
        "showInJournal": extras.show_in_journal,
        "timeGrid": extras.time_grid,
    });
    if let (true, Some(rule)) = (with_repeat, &outcome.repeat) {
        // A new series: the entry is its first occurrence, the further ones up to the horizon are made with it.
        let horizon = repeat::series_horizon(today, outcome.day);
        let dates: Vec<String> = repeat::occurrences(rule, repeat::shift(outcome.day, 1), horizon, 5000).iter().map(|day| day.to_string()).collect();
        value["repeat"] = json!({ "series": uuid::Uuid::new_v4().to_string(), "rule": repeat::clean(rule), "horizon": horizon.to_string(), "dates": dates });
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

fn add(store: &mut Store, day: NaiveDate, entry: Entry) -> Result<i64, String> {
    let mut loaded = store.load(&day.to_string()).map_err(|e| e.to_string())?;
    loaded.entries.push(entry);
    store.save(loaded).map_err(|e| e.to_string())?;
    cursor(store)
}

#[cfg(test)]
pub fn save(store: &mut Store, outcome: &Outcome, today: NaiveDate) -> Result<Saved, String> { save_with(store, outcome, &Extras::default(), today) }

pub fn save_with(store: &mut Store, outcome: &Outcome, extras: &Extras, today: NaiveDate) -> Result<Saved, String> {
    let mut groups = vec![add(store, outcome.day, entry(outcome, extras, today, true)?)?];
    for day in &outcome.copies { groups.push(add(store, *day, entry(outcome, extras, today, false)?)?); }
    let mut days = vec![outcome.day];
    days.extend(&outcome.copies);
    for part in &outcome.additional {
        let saved = save_with(store, part, extras, today)?;
        groups.extend(saved.groups); days.extend(saved.days);
    }
    Ok(Saved { groups, text: outcome.text.clone(), days })
}

/// Save the source entry and its plan in one core transaction, checking for a stale edit first.
pub fn save_planned_or_edited(store: &mut Store, outcome: &Outcome, extras: &Extras, today: NaiveDate,
    editing: Option<&(NaiveDate, Entry)>, rule: &Option<repeat::Rule>, targets: &[NaiveDate],
    labels: &crate::texts::FormTexts) -> Result<Saved, String> {
    if !outcome.additional.is_empty() || !outcome.copies.is_empty() { return Err(labels.plan_single.into()); }
    let source = editing.map_or(outcome.day, |(date, _)| *date);
    let mut day = store.load(&source.to_string()).map_err(|e| e.to_string())?;
    let mut updated = entry(outcome, extras, today, true)?;
    let id = if let Some((_, original)) = editing {
        let current = day.entries.iter_mut().find(|e| e.id == original.id).ok_or(labels.entry_changed)?;
        if serde_json::to_value(&*current).map_err(|e| e.to_string())? != serde_json::to_value(original).map_err(|e| e.to_string())? {
            return Err(labels.entry_changed.into());
        }
        updated.id = current.id.clone();
        updated.calendar_uid = current.calendar_uid.clone();
        updated.done = current.done && updated.kind == current.kind;
        updated.cancelled = current.cancelled && updated.kind == current.kind;
        updated.origin = current.origin.clone();
        if !current.reminder && !updated.reminder { updated.reminder_before = current.reminder_before; }
        if updated.kind == current.kind && updated.kind != "event" { updated.show_in_journal = current.show_in_journal; }
        let old_rule = current.repeat.as_ref().and_then(|r| r.rule.clone()).and_then(|r| serde_json::from_value(r).ok());
        if &old_rule == rule {
            updated.repeat = current.repeat.clone();
        } else if rule.is_none() {
            updated.repeat = current.repeat.clone().map(|mut r| { r.rule = None; r });
        }
        *current = updated;
        current.id.clone()
    } else {
        let id = updated.id.clone();
        day.entries.push(updated);
        id
    };
    let mut dates = targets.to_vec();
    if outcome.day != source { dates.push(outcome.day); }
    if !dates.is_empty() { crate::day_ops::plan(&mut day, &id, &dates, "days")?; }
    store.save(day).map_err(|e| e.to_string())?;
    dates.push(source);
    dates.sort();
    dates.dedup();
    Ok(Saved { groups: vec![cursor(store)?], text: outcome.text.clone(), days: dates })
}

/// Takes the save back, as long as nothing was written after it (then that would go first). True when it did.
pub fn undo(store: &mut Store, saved: &Saved) -> Result<bool, String> {
    if cursor(store)? != *saved.groups.last().unwrap_or(&-1) { return Ok(false); }
    for group in saved.groups.iter().rev() {
        if cursor(store)? != *group { break; }
        history::step(store, false).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

/// One step back or forward in the shared history (`> Rückgängig`, `> Wiederherstellen`).
pub fn step(store: &mut Store, redo: bool) -> Result<bool, String> { history::step(store, redo).map_err(|e| e.to_string()) }

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{parse::{parse, TagName}, resolve::resolve};
    use crate::repeat::d;

    struct Db(std::path::PathBuf, Store);
    impl Db {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("j-terminal-save-{}.sqlite3", uuid::Uuid::new_v4()));
            let store = Store::open(&path).unwrap();
            Db(path, store)
        }
    }
    impl Drop for Db {
        fn drop(&mut self) { for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display())); } }
    }
    fn today() -> NaiveDate { d("2026-11-18") }
    fn outcome(line: &str, tags: &[TagName]) -> Outcome { resolve(&parse(line, today(), tags), today()).choices.remove(0) }

    #[test]
    fn an_appointment_lands_on_its_day() {
        let mut db = Db::new();
        let id = uuid::Uuid::new_v4().to_string();
        let tags = [TagName { id: id.clone(), name: "Gesundheit".into() }];
        db.1.save_tags(&[journal_core::storage::Tag { id: id.clone(), name: "Gesundheit".into(), color: "#76d982".into(), icon: None }]).unwrap();
        let saved = save(&mut db.1, &outcome("Zahnarzt Do 14–15 \\Gesundheit", &tags), today()).unwrap();
        assert_eq!(saved.days, [d("2026-11-19")]);
        let day = db.1.load("2026-11-19").unwrap();
        let entry = &day.entries[0];
        assert_eq!((entry.kind.as_str(), entry.text.as_str(), entry.time.as_deref(), entry.end.as_deref(), entry.tag.as_deref()), ("event", "Zahnarzt", Some("14:00"), Some("15:00"), Some(id.as_str())));
    }

    #[test]
    fn a_series_gets_its_occurrences() {
        let mut db = Db::new();
        save(&mut db.1, &outcome("Sport jeden Mo bis 7.12.", &[]), today()).unwrap();
        let days = db.1.load_range("2026-11-18", "2026-12-31").unwrap();
        let dates: Vec<&str> = days.iter().filter(|day| !day.entries.is_empty()).map(|day| day.date.as_str()).collect();
        assert_eq!(dates, ["2026-11-23", "2026-11-30", "2026-12-07"]);
        let first = &days[0].entries[0];
        assert!(first.repeat.as_ref().is_some_and(|repeat| repeat.rule.as_ref().is_some_and(|rule| rule["unit"] == "week")));
    }

    #[test]
    fn a_continuous_span_is_one_entry() {
        let mut db = Db::new();
        save(&mut db.1, &outcome("Urlaub ▬ Mo–Fr", &[]), today()).unwrap();
        let day = db.1.load("2026-11-23").unwrap();
        assert_eq!((day.entries.len(), day.entries[0].end.as_deref()), (1, Some("120:00")));
        assert!(db.1.load("2026-11-24").unwrap().entries.is_empty());
    }

    #[test]
    fn several_days_and_taking_it_back() {
        let mut db = Db::new();
        let saved = save(&mut db.1, &outcome("Kurs 19.11., 26.11.", &[]), today()).unwrap();
        assert_eq!(saved.groups.len(), 2);
        assert_eq!(db.1.load("2026-11-26").unwrap().entries.len(), 1);
        assert!(undo(&mut db.1, &saved).unwrap());
        assert!(db.1.load("2026-11-19").unwrap().entries.is_empty());
        assert!(db.1.load("2026-11-26").unwrap().entries.is_empty());
        assert!(step(&mut db.1, true).unwrap(), "And forward again.");
        assert_eq!(db.1.load("2026-11-19").unwrap().entries.len(), 1);
    }

    #[test]
    fn undo_leaves_later_writes_alone() {
        let mut db = Db::new();
        let saved = save(&mut db.1, &outcome("Einkaufen", &[]), today()).unwrap();
        save(&mut db.1, &outcome("Putzen", &[]), today()).unwrap();
        assert!(!undo(&mut db.1, &saved).unwrap());
        assert_eq!(db.1.load("2026-11-18").unwrap().entries.len(), 2);
    }
}
