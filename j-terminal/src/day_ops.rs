//! What the day view does to a day and to the period data, as the app's day page does it (`src/App.tsx`, `entries.ts`,
//! `planning.ts`, branch `Windows`). Pure functions on `journal_core::storage::Day` and the period data's JSON; saving is
//! the caller's (`Store::save` checks the revision and writes the copies of planned entries itself).
use chrono::NaiveDate;
use journal_core::storage::{Day, Entry, Plan, PlanTarget, Tag};
use serde_json::{json, Value};
use crate::repeat;

pub const KINDS: [&str; 3] = ["event", "task", "note"];

/// The tag's rank in the order of entries: untagged first, then the tags in their order (`tagRank`).
fn tag_rank(tags: &[Tag], tag: Option<&str>) -> usize {
    tag.and_then(|id| tags.iter().position(|known| known.id == id)).map_or(0, |at| at + 1)
}

/// By kind (event, task, note), within a kind by tag, within a tag the important first; otherwise as they were
/// (`orderEntries`).
pub fn order(entries: &mut [Entry], tags: &[Tag]) {
    entries.sort_by_key(|entry| (KINDS.iter().position(|kind| *kind == entry.kind).unwrap_or(3), tag_rank(tags, entry.tag.as_deref()), !entry.priority));
}

/// Two entries may change places: same kind, priority and tag (`sameGroup`).
fn same_group(a: &Entry, b: &Entry, tags: &[Tag]) -> bool {
    a.kind == b.kind && a.priority == b.priority && tag_rank(tags, a.tag.as_deref()) == tag_rank(tags, b.tag.as_deref())
}

/// A trace stays where a planned entry was; it has no status of its own.
pub fn is_trace(entry: &Entry) -> bool { entry.plan.is_some() }
/// Planning needs an entry that is not a note and not planned yet (`canPlan`).
pub fn can_plan(entry: &Entry) -> bool { entry.kind != "note" && entry.plan.is_none() }
/// A note has no time, reminder, plan or repetition (`canBeNote`).
pub fn can_be_note(entry: &Entry) -> bool {
    entry.time.is_none() && entry.end.is_none() && !entry.reminder && entry.plan.is_none() && entry.repeat.as_ref().is_none_or(|repeat| repeat.rule.is_none())
}

fn find<'a>(day: &'a mut Day, id: &str) -> Result<&'a mut Entry, String> {
    day.entries.iter_mut().find(|entry| entry.id == id).ok_or_else(|| "Eintrag nicht gefunden".to_string())
}

/// A new entry with `text`, after `after` when that is of the same kind and tag (Enter in an entry), otherwise at the
/// end of its kind; returns its id.
pub fn create(day: &mut Day, tags: &[Tag], kind: &str, text: &str, after: Option<&str>, tag: Option<String>) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let entry: Entry = serde_json::from_value(json!({ "id": id, "kind": kind, "text": text, "done": false, "cancelled": false, "priority": false,
        "time": null, "reminder": false, "plan": null, "tag": tag })).expect("a valid entry");
    let at = after.and_then(|after| day.entries.iter().position(|e| e.id == after))
        .filter(|at| { let other = &day.entries[*at]; other.kind == entry.kind && tag_rank(tags, other.tag.as_deref()) == tag_rank(tags, entry.tag.as_deref()) });
    match at { Some(at) => day.entries.insert(at + 1, entry), None => day.entries.push(entry) }
    order(&mut day.entries, tags);
    id
}

pub fn set_text(day: &mut Day, id: &str, text: &str) -> Result<(), String> { find(day, id)?.text = text.to_string(); Ok(()) }
pub fn set_title(day: &mut Day, title: &str) { day.title = title.to_string(); }

/// Done ↔ open (tasks, not traces); with `cancelled` the same for cancelled.
pub fn toggle_status(day: &mut Day, id: &str, cancelled: bool) -> Result<(), String> {
    let entry = find(day, id)?;
    if entry.kind != "task" || is_trace(entry) { return Err("Nur Aufgaben haben einen Status".into()); }
    let on = if cancelled { !entry.cancelled } else { !entry.done };
    entry.done = on && !cancelled;
    entry.cancelled = on && cancelled;
    Ok(())
}

pub fn toggle_priority(day: &mut Day, tags: &[Tag], id: &str) -> Result<(), String> {
    let entry = find(day, id)?;
    if is_trace(entry) { return Err("Ein geplanter Eintrag ändert sich an seinem neuen Tag".into()); }
    entry.priority = !entry.priority;
    order(&mut day.entries, tags);
    Ok(())
}

/// Another kind; a note only when it has nothing a note cannot have.
pub fn set_kind(day: &mut Day, tags: &[Tag], id: &str, kind: &str) -> Result<(), String> {
    let entry = find(day, id)?;
    if kind == "note" && !can_be_note(entry) { return Err("Eine Notiz hat keine Uhrzeit, Erinnerung, Planung oder Wiederholung".into()); }
    entry.kind = kind.to_string();
    if kind != "task" { entry.done = false; entry.cancelled = false; }
    order(&mut day.entries, tags);
    Ok(())
}

pub fn set_tag(day: &mut Day, tags: &[Tag], id: &str, tag: Option<String>) -> Result<(), String> {
    let entry = find(day, id)?;
    if is_trace(entry) { return Err("Ein geplanter Eintrag ändert sich an seinem neuen Tag".into()); }
    entry.tag = tag;
    order(&mut day.entries, tags);
    Ok(())
}

pub fn set_icon(day: &mut Day, id: &str, icon: Option<String>) -> Result<(), String> { find(day, id)?.icon = icon; Ok(()) }
pub fn set_description(day: &mut Day, id: &str, description: &str) -> Result<(), String> {
    find(day, id)?.description = if description.trim().is_empty() { String::new() } else { description.to_string() };
    Ok(())
}

/// Minutes from "HH:MM" (the end may pass 24:00: hours since the first day's midnight).
pub fn minutes(text: &str) -> Option<u32> {
    let (hours, minutes) = text.split_once(':')?;
    Some(hours.parse::<u32>().ok()? * 60 + minutes.parse::<u32>().ok()?)
}
fn clock(minutes: u32) -> String { format!("{:02}:{:02}", minutes / 60, minutes % 60) }

/// The time of an entry; the end keeps its distance to the start (`keepDuration`), no time takes the end too. A note
/// cannot have one.
pub fn set_time(day: &mut Day, id: &str, start: Option<u32>) -> Result<(), String> {
    let entry = find(day, id)?;
    if entry.kind == "note" && start.is_some() { return Err("Notizen haben keine Uhrzeit".into()); }
    let length = match (entry.time.as_deref().and_then(minutes), entry.end.as_deref().and_then(minutes)) { (Some(from), Some(to)) if to > from => Some(to - from), _ => None };
    entry.time = start.map(clock);
    entry.end = start.zip(length).map(|(start, length)| clock(start + length));
    if start.is_none() { entry.time_grid = false; }
    Ok(())
}

/// The reminder: none, or this many minutes before (0 at the time).
pub fn set_reminder(day: &mut Day, id: &str, before: Option<i64>) -> Result<(), String> {
    let entry = find(day, id)?;
    if entry.kind == "note" && before.is_some() { return Err("Notizen haben keine Erinnerung".into()); }
    entry.reminder = before.is_some();
    entry.reminder_before = before.unwrap_or(0).clamp(0, journal_core::storage::MAX_REMINDER_BEFORE);
    Ok(())
}

/// Planning to other days (`planChange`): the entry stays here as a trace, the targets get copies when the day is saved.
/// Only today's date in `dates`: nothing to plan.
pub fn plan(day: &mut Day, id: &str, dates: &[NaiveDate], via: &str) -> Result<(), String> {
    let date = day.date.clone();
    let entry = find(day, id)?;
    if !can_plan(entry) { return Err("Dieser Eintrag lässt sich nicht planen".into()); }
    let mut targets: Vec<String> = dates.iter().map(|d| d.to_string()).filter(|d| *d != date).collect();
    targets.sort();
    targets.dedup();
    if targets.is_empty() { return Ok(()); }
    let via = if targets.len() > 1 { "days" } else if via == "days" { "date" } else { via };
    entry.plan = Some(Plan { via: via.into(), targets: targets.into_iter().map(|date| PlanTarget { date, id: uuid::Uuid::new_v4().to_string() }).collect(),
        time: entry.time.clone(), end: entry.end.clone(), reminder: entry.reminder, repeat: None });
    Ok(())
}

/// Tomorrow (`tomorrowChange`, tasks only as with Alt+M).
pub fn plan_tomorrow(day: &mut Day, id: &str) -> Result<(), String> {
    let today = NaiveDate::parse_from_str(&day.date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    if day.entries.iter().find(|e| e.id == id).is_some_and(|e| e.kind != "task") { return Err("Morgen gibt es für Aufgaben".into()); }
    plan(day, id, &[repeat::shift(today, 1)], "tomorrow")
}

/// One place up or down among the shown entries of its group (`moveEntryByOffset`); false when it cannot.
pub fn move_by(day: &mut Day, tags: &[Tag], id: &str, offset: i32) -> bool {
    let Some(at) = day.entries.iter().position(|e| e.id == id) else { return false };
    let shown: Vec<usize> = (0..day.entries.len()).filter(|i| day.entries[*i].show_in_journal).collect();
    let Some(place) = shown.iter().position(|i| *i == at) else { return false };
    let Some(&other) = shown.get((place as i32 + offset) as usize).filter(|_| place as i32 + offset >= 0) else { return false };
    if !same_group(&day.entries[at], &day.entries[other], tags) { return false; }
    day.entries.swap(at, other);
    true
}

// ----- The period data (ratings, day values, activities) -----

fn day_record<'a>(data: &'a mut Value, date: &str) -> &'a mut serde_json::Map<String, Value> {
    if !data.is_object() { *data = json!({}); }
    let days = data.as_object_mut().unwrap().entry("days").or_insert_with(|| json!({}));
    if !days.is_object() { *days = json!({}); }
    let day = days.as_object_mut().unwrap().entry(date).or_insert_with(|| json!({ "items": {} }));
    if !day.is_object() { *day = json!({ "items": {} }); }
    day.as_object_mut().unwrap()
}

/// The day's rating; none removes it.
pub fn set_rating(data: &mut Value, date: &str, value: Option<i64>) {
    let day = day_record(data, date);
    match value { Some(value) => { day.insert("rating".into(), json!(value)); } None => { day.remove("rating"); } }
}

/// A day value of a scale; none removes it.
pub fn set_scale(data: &mut Value, date: &str, scale: &str, value: Option<i64>) {
    let day = day_record(data, date);
    let scales = day.entry("scales").or_insert_with(|| json!({}));
    if !scales.is_object() { *scales = json!({}); }
    let scales = scales.as_object_mut().unwrap();
    match value { Some(value) => { scales.insert(scale.into(), json!(value)); } None => { scales.remove(scale); } }
    if scales.is_empty() { day.remove("scales"); }
}

fn activity_record<'a>(data: &'a mut Value, date: &str, activity: &str) -> &'a mut serde_json::Map<String, Value> {
    let day = day_record(data, date);
    let items = day.entry("items").or_insert_with(|| json!({}));
    if !items.is_object() { *items = json!({}); }
    let record = items.as_object_mut().unwrap().entry(activity).or_insert_with(|| json!({ "done": false }));
    if !record.is_object() { *record = json!({ "done": false }); }
    record.as_object_mut().unwrap()
}

/// Ticks an activity or takes the tick back.
pub fn toggle_activity(data: &mut Value, date: &str, activity: &str) {
    let record = activity_record(data, date, activity);
    let done = record.get("done").and_then(Value::as_bool).unwrap_or(false);
    record.insert("done".into(), json!(!done));
}

/// The minutes typed for an activity (none removes them); typing time ticks it, as in the app.
pub fn set_minutes(data: &mut Value, date: &str, activity: &str, minutes: Option<i64>) {
    let record = activity_record(data, date, activity);
    match minutes.filter(|m| *m > 0) {
        Some(minutes) => { record.insert("minutes".into(), json!(minutes)); record.insert("done".into(), json!(true)); }
        None => { record.remove("minutes"); }
    }
}

// ----- A day's note and a week's … year's own data (`notes`, `periods`, `entries`, keyed by the period) -----

/// An object member of `data` made an object (and the root too).
fn object<'a>(data: &'a mut Value, field: &str) -> &'a mut serde_json::Map<String, Value> {
    if !data.is_object() { *data = json!({}); }
    let member = data.as_object_mut().unwrap().entry(field).or_insert_with(|| json!({}));
    if !member.is_object() { *member = json!({}); }
    member.as_object_mut().unwrap()
}

/// The note of a day or a period (by its key); an empty one goes.
pub fn set_note(data: &mut Value, key: &str, text: &str) {
    let notes = object(data, "notes");
    if text.trim().is_empty() { notes.remove(key); } else { notes.insert(key.into(), json!(text)); }
}

/// A period's own rating (`withPeriodValues`); none removes it, empty values go.
pub fn set_period_rating(data: &mut Value, key: &str, value: Option<i64>) {
    period_values(data, key, |values| match value { Some(value) => { values.insert("rating".into(), json!(value)); } None => { values.remove("rating"); } });
}

/// A period's own value of a scale; none removes it.
pub fn set_period_scale(data: &mut Value, key: &str, scale: &str, value: Option<i64>) {
    period_values(data, key, |values| {
        let scales = values.entry("scales").or_insert_with(|| json!({}));
        if !scales.is_object() { *scales = json!({}); }
        let scales = scales.as_object_mut().unwrap();
        match value { Some(value) => { scales.insert(scale.into(), json!(value)); } None => { scales.remove(scale); } }
        if scales.is_empty() { values.remove("scales"); }
    });
}

fn period_values(data: &mut Value, key: &str, change: impl FnOnce(&mut serde_json::Map<String, Value>)) {
    let periods = object(data, "periods");
    let values = periods.entry(key).or_insert_with(|| json!({}));
    if !values.is_object() { *values = json!({}); }
    change(values.as_object_mut().unwrap());
    if values.as_object().is_some_and(|values| values.is_empty()) { periods.remove(key); }
    if periods.is_empty() { data.as_object_mut().unwrap().remove("periods"); }
}

/// A period's own entries (`withPeriodEntries`); a list left empty goes.
fn period_entries(data: &mut Value, key: &str, change: impl FnOnce(&mut serde_json::Map<String, Value>)) {
    let entries = object(data, "entries");
    let list = entries.entry(key).or_insert_with(|| json!({}));
    if !list.is_object() { *list = json!({}); }
    change(list.as_object_mut().unwrap());
    if list.as_object().is_some_and(|list| list.is_empty()) { entries.remove(key); }
    if entries.is_empty() { data.as_object_mut().unwrap().remove("entries"); }
}

/// A new entry of a period: a task or a note at the end of its kind (`PeriodEntries.tsx` `add`). Returns its id.
pub fn add_period_entry(data: &mut Value, key: &str, note: bool, text: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let kind = if note { "note" } else { "task" };
    period_entries(data, key, |list| {
        let order = list.values().filter(|entry| entry["kind"] == kind).filter_map(|entry| entry["order"].as_f64()).fold(-1.0, f64::max) + 1.0;
        list.insert(id.clone(), json!({ "kind": kind, "text": text, "order": order }));
    });
    id
}

pub fn set_period_text(data: &mut Value, key: &str, id: &str, text: &str) {
    period_entries(data, key, |list| { if let Some(entry) = list.get_mut(id).and_then(Value::as_object_mut) { entry.insert("text".into(), json!(text)); } });
}

/// A task's tick on or off (a note has none).
pub fn toggle_period_done(data: &mut Value, key: &str, id: &str) {
    period_entries(data, key, |list| {
        let Some(entry) = list.get_mut(id).and_then(Value::as_object_mut) else { return };
        if entry.get("kind").and_then(Value::as_str) == Some("note") { return; }
        if entry.get("done").and_then(Value::as_bool) == Some(true) { entry.remove("done"); } else { entry.insert("done".into(), json!(true)); }
    });
}

pub fn remove_period_entry(data: &mut Value, key: &str, id: &str) { period_entries(data, key, |list| { list.remove(id); }); }

/// One place up or down among the entries of its kind (`movePeriodEntry`; their order is numbered anew). False when it
/// cannot go further.
pub fn move_period_entry(data: &mut Value, key: &str, id: &str, by: i32) -> bool {
    let mut moved = false;
    period_entries(data, key, |list| {
        let Some(kind) = list.get(id).map(|entry| entry["kind"].as_str().unwrap_or("task").to_string()) else { return };
        let mut same: Vec<(f64, String)> = list.iter().filter(|(_, entry)| entry["kind"].as_str().unwrap_or("task") == kind)
            .map(|(other, entry)| (entry["order"].as_f64().unwrap_or(0.0), other.clone())).collect();
        same.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let Some(at) = same.iter().position(|(_, other)| other == id) else { return };
        let target = at as i32 + by;
        if target < 0 || target as usize >= same.len() { return; }
        same.swap(at, target as usize);
        for (order, (_, other)) in same.iter().enumerate() { if let Some(entry) = list.get_mut(other).and_then(Value::as_object_mut) { entry.insert("order".into(), json!(order)); } }
        moved = true;
    });
    moved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_periods_own_data_is_written_as_the_app_keeps_it() {
        let mut data = json!({ "days": {} });
        set_note(&mut data, "week:2026-11-16", "Gute Woche");
        assert_eq!(data["notes"]["week:2026-11-16"], "Gute Woche");
        set_note(&mut data, "week:2026-11-16", "  ");
        assert!(data["notes"].get("week:2026-11-16").is_none(), "An empty note goes.");
        set_period_rating(&mut data, "month:2026-11-01", Some(7));
        set_period_scale(&mut data, "month:2026-11-01", "stress", Some(3));
        assert_eq!(data["periods"]["month:2026-11-01"], json!({ "rating": 7, "scales": { "stress": 3 } }));
        set_period_rating(&mut data, "month:2026-11-01", None);
        set_period_scale(&mut data, "month:2026-11-01", "stress", None);
        assert!(data.get("periods").is_none(), "Empty values go.");
        let first = add_period_entry(&mut data, "week:2026-11-16", false, "Steuer");
        let second = add_period_entry(&mut data, "week:2026-11-16", false, "Bericht");
        let note = add_period_entry(&mut data, "week:2026-11-16", true, "Idee");
        assert_eq!((data["entries"]["week:2026-11-16"][&second]["order"].as_f64(), data["entries"]["week:2026-11-16"][&note]["order"].as_f64()), (Some(1.0), Some(0.0)));
        toggle_period_done(&mut data, "week:2026-11-16", &first);
        toggle_period_done(&mut data, "week:2026-11-16", &note);
        assert_eq!((data["entries"]["week:2026-11-16"][&first]["done"].as_bool(), data["entries"]["week:2026-11-16"][&note].get("done")), (Some(true), None));
        assert!(move_period_entry(&mut data, "week:2026-11-16", &second, -1));
        assert_eq!(data["entries"]["week:2026-11-16"][&second]["order"].as_f64(), Some(0.0));
        assert!(!move_period_entry(&mut data, "week:2026-11-16", &second, -1), "Already first of the tasks.");
        set_period_text(&mut data, "week:2026-11-16", &note, "Neue Idee");
        assert_eq!(data["entries"]["week:2026-11-16"][&note]["text"], "Neue Idee");
        for id in [&first, &second, &note] { remove_period_entry(&mut data, "week:2026-11-16", id); }
        assert!(data.get("entries").is_none(), "A list left empty goes.");
    }

    fn tag(id: &str) -> Tag { Tag { id: id.into(), name: id.into(), color: "#569eff".into(), icon: None } }
    fn day(entries: serde_json::Value) -> Day {
        serde_json::from_value(json!({ "date": "2026-11-19", "title": "", "body": "", "revision": 1, "entries": entries })).unwrap()
    }
    fn e(id: &str, kind: &str, extra: serde_json::Value) -> serde_json::Value {
        let mut value = json!({ "id": id, "kind": kind, "text": id, "done": false, "cancelled": false });
        for (k, v) in extra.as_object().unwrap() { value[k] = v.clone(); }
        value
    }
    fn texts(day: &Day) -> Vec<&str> { day.entries.iter().map(|e| e.text.as_str()).collect() }

    #[test]
    fn new_entries_find_their_place_and_order_follows_the_app() {
        let tags = vec![tag("work")];
        let mut d = day(json!([e("a", "task", json!({})), e("b", "task", json!({ "tag": "work" })), e("n", "note", json!({}))]));
        create(&mut d, &tags, "event", "Termin", None, None);
        create(&mut d, &tags, "task", "Nach a", Some("a"), None);
        create(&mut d, &tags, "task", "Wichtig", None, Some("work".into()));
        let important = d.entries.iter().find(|e| e.text == "Wichtig").unwrap().id.clone();
        toggle_priority(&mut d, &tags, &important).unwrap();
        assert_eq!(texts(&d), ["Termin", "a", "Nach a", "Wichtig", "b", "n"]);
        assert!(uuid::Uuid::parse_str(&d.entries[0].id).is_ok());
    }

    #[test]
    fn status_kind_and_moving_keep_the_apps_rules() {
        let tags = vec![];
        let mut d = day(json!([e("a", "task", json!({})), e("b", "task", json!({})), e("c", "event", json!({ "time": "10:00" }))]));
        toggle_status(&mut d, "a", false).unwrap();
        assert!(d.entries[0].done);
        toggle_status(&mut d, "a", true).unwrap();
        assert!(!d.entries[0].done && d.entries[0].cancelled, "Cancelled replaces done.");
        toggle_status(&mut d, "a", true).unwrap();
        assert!(!d.entries[0].done && !d.entries[0].cancelled);
        assert!(toggle_status(&mut d, "c", false).is_err(), "Events have no status.");
        assert!(set_kind(&mut d, &tags, "c", "note").is_err(), "A note has no time.");
        toggle_status(&mut d, "b", false).unwrap();
        set_kind(&mut d, &tags, "b", "event").unwrap();
        let b = d.entries.iter().find(|e| e.id == "b").unwrap();
        assert!(!b.done && b.kind == "event");
        assert_eq!(texts(&d), ["b", "c", "a"], "Events first, otherwise as they were.");
        assert!(move_by(&mut d, &tags, "b", 1), "Within its group.");
        assert_eq!(texts(&d), ["c", "b", "a"]);
        assert!(!move_by(&mut d, &tags, "c", -1), "Nothing above.");
        assert!(!move_by(&mut d, &tags, "b", 1), "Not into another kind.");
    }

    #[test]
    fn time_keeps_its_length_and_planning_leaves_a_trace() {
        let mut d = day(json!([e("t", "task", json!({ "time": "09:00", "end": "10:30" })), e("n", "note", json!({}))]));
        set_time(&mut d, "t", Some(14 * 60)).unwrap();
        assert_eq!((d.entries[0].time.as_deref(), d.entries[0].end.as_deref()), (Some("14:00"), Some("15:30")));
        set_time(&mut d, "t", None).unwrap();
        assert_eq!((d.entries[0].time.as_deref(), d.entries[0].end.as_deref()), (None, None));
        assert!(set_time(&mut d, "n", Some(600)).is_err());
        set_reminder(&mut d, "t", Some(15)).unwrap();
        assert!(d.entries[0].reminder && d.entries[0].reminder_before == 15);
        plan_tomorrow(&mut d, "t").unwrap();
        let planned = d.entries[0].plan.clone().unwrap();
        assert_eq!((planned.via.as_str(), planned.targets.len(), planned.targets[0].date.as_str()), ("tomorrow", 1, "2026-11-20"));
        assert!(plan_tomorrow(&mut d, "t").is_err(), "Planned once.");
        assert!(toggle_status(&mut d, "t", false).is_err(), "A trace has no status.");
        let mut d = day(json!([e("x", "event", json!({}))]));
        plan(&mut d, "x", &[repeat::d("2026-11-21"), repeat::d("2026-11-19"), repeat::d("2026-11-23")], "days").unwrap();
        let planned = d.entries[0].plan.clone().unwrap();
        assert_eq!((planned.via.as_str(), planned.targets.iter().map(|t| t.date.as_str()).collect::<Vec<_>>()), ("days", vec!["2026-11-21", "2026-11-23"]), "Its own day is no target.");
        assert!(plan_tomorrow(&mut day(json!([e("y", "event", json!({}))])), "y").is_err(), "Tomorrow is for tasks.");
    }

    #[test]
    fn a_planned_entry_reaches_its_target_when_saved() {
        let path = std::env::temp_dir().join(format!("j-terminal-ops-{}.sqlite3", uuid::Uuid::new_v4()));
        {
            let mut store = journal_core::storage::Store::open(&path).unwrap();
            let mut d = store.load("2026-11-19").unwrap();
            let id = create(&mut d, &[], "task", "Steuer", None, None);
            let d = store.save(d).unwrap();
            let mut d = d;
            plan(&mut d, &id, &[repeat::d("2026-11-25")], "date").unwrap();
            store.save(d).unwrap();
            let target = store.load("2026-11-25").unwrap();
            assert_eq!(target.entries.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), ["Steuer"]);
            assert!(store.load("2026-11-19").unwrap().entries[0].plan.is_some(), "A trace stays.");
        }
        for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
    }

    #[test]
    fn values_and_activities_change_only_their_day() {
        let mut data = json!({ "definitions": [], "days": { "2026-11-18": { "rating": 3, "items": {} } } });
        set_rating(&mut data, "2026-11-19", Some(8));
        set_scale(&mut data, "2026-11-19", "stress", Some(2));
        toggle_activity(&mut data, "2026-11-19", "run");
        set_minutes(&mut data, "2026-11-19", "read", Some(45));
        assert_eq!(data["days"]["2026-11-19"], json!({ "rating": 8, "scales": { "stress": 2 }, "items": { "run": { "done": true }, "read": { "done": true, "minutes": 45 } } }));
        assert_eq!(data["days"]["2026-11-18"]["rating"], json!(3));
        set_rating(&mut data, "2026-11-19", None);
        set_scale(&mut data, "2026-11-19", "stress", None);
        toggle_activity(&mut data, "2026-11-19", "run");
        set_minutes(&mut data, "2026-11-19", "read", None);
        assert_eq!(data["days"]["2026-11-19"], json!({ "items": { "run": { "done": false }, "read": { "done": true } } }));
    }
}
