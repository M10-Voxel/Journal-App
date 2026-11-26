//! The settings of the activities and the day values (F1: „Aktivitäten“, „Tageswerte“), as the Journal app has them
//! (`ActivitySettings.tsx`, `ScaleSettings.tsx`; the rules from `periodData.ts`, `activityColors.ts`,
//! `activityCalendar.ts` `activityTags`). Everything works on the app's `period-data` JSON as it is stored, so fields the
//! terminal does not know stay as they are. Every activity has a tag of its own: its calendar entries count as its time;
//! the tag follows the activity's colour, and its name once the name is written.
use journal_core::storage::Tag;
use serde_json::{json, Map, Value};
use crate::{analysis, day_view::scale_range, tag_edit::SWATCHES, texts::Language};

/// The longest name of a tag (`maxTagName` in the app).
const MAX_TAG_NAME: usize = 40;
/// The widest span of a value (`maxScaleSpan`).
const MAX_SPAN: i64 = 1000;
/// The most minutes a shade can stand for (`maxRangeMinutes`).
const MAX_MINUTES: i64 = 1440;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page { Activities, Values }

/// What a line shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind { Activity, Scale, Rating }

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub kind: Kind,
    /// The activity's or value's id; `rating` for the daily rating.
    pub id: String,
    pub name: String,
    pub color: String,
    pub active: bool,
    pub track: bool,
    pub text_field: bool,
    /// Activities: the shades' minutes; values: the span.
    pub min: i64,
    pub max: i64,
    /// A range of its own was set (its reset is offered).
    pub custom_range: bool,
    /// The seven shades (activities).
    pub palette: [[u8; 3]; 7],
}

fn valid_color(value: &Value) -> String {
    value.as_str().filter(|text| crate::calendar::parse_color(text).is_some()).unwrap_or("#569eff").to_lowercase()
}

fn list<'a>(data: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    data.get(key).and_then(Value::as_array).into_iter().flatten().filter(|item| item.get("id").and_then(Value::as_str).is_some_and(|id| !id.is_empty()))
}

/// The lines of a page.
pub fn rows(data: &Value, page: Page) -> Vec<Row> {
    let text = |item: &Value, key: &str| item.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    let flag = |item: &Value, key: &str| item.get(key).and_then(Value::as_bool) != Some(false);
    match page {
        Page::Activities => list(data, "definitions").map(|item| {
            let (min, max) = analysis::activity_range(item.get("minMinutes").and_then(Value::as_f64), item.get("maxMinutes").and_then(Value::as_f64));
            let color = valid_color(&item["color"]);
            Row { kind: Kind::Activity, id: text(item, "id"), name: text(item, "name"), palette: analysis::palette(crate::calendar::parse_color(&color).unwrap_or(analysis::ACCENT)),
                color, active: flag(item, "active"), track: flag(item, "trackTime"), text_field: flag(item, "textField"),
                min: min as i64, max: max as i64, custom_range: item.get("minMinutes").is_some_and(|v| !v.is_null()) || item.get("maxMinutes").is_some_and(|v| !v.is_null()) }
        }).collect(),
        Page::Values => {
            let rating = data.get("rating");
            let (min, max) = scale_range(rating.and_then(|r| r.get("min")).and_then(Value::as_f64), rating.and_then(|r| r.get("max")).and_then(Value::as_f64));
            let mut rows = vec![Row { kind: Kind::Rating, id: "rating".into(), name: String::new(), color: rating.map_or_else(|| "#569eff".into(), |r| valid_color(&r["color"])),
                active: true, track: false, text_field: false, min, max, custom_range: (min, max) != (0, 10), palette: [[0; 3]; 7] }];
            rows.extend(list(data, "scales").map(|item| {
                let (min, max) = scale_range(item.get("min").and_then(Value::as_f64), item.get("max").and_then(Value::as_f64));
                Row { kind: Kind::Scale, id: text(item, "id"), name: text(item, "name"), color: valid_color(&item["color"]), active: flag(item, "active"),
                    track: false, text_field: false, min, max, custom_range: (min, max) != (0, 10), palette: [[0; 3]; 7] }
            }));
            rows
        }
    }
}

/// What a change did besides the period data.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// The tags changed (they are saved with the data).
    pub tags: bool,
    /// The lines were added, removed or moved (the list is drawn anew, not only its values).
    pub structure: bool,
}

fn array<'a>(data: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    if !data.is_object() { *data = json!({}); }
    let object = data.as_object_mut().unwrap();
    if !object.get(key).is_some_and(Value::is_array) { object.insert(key.into(), json!([])); }
    object.get_mut(key).and_then(Value::as_array_mut).unwrap()
}

fn find<'a>(data: &'a mut Value, key: &str, id: &str) -> Option<&'a mut Map<String, Value>> {
    array(data, key).iter_mut().find(|item| item.get("id").and_then(Value::as_str) == Some(id)).and_then(Value::as_object_mut)
}

/// A whole number typed in, or none.
fn whole(text: &str) -> Option<i64> {
    let value: f64 = text.trim().replace(',', ".").parse().ok()?;
    value.is_finite().then(|| value.round() as i64)
}

/// Gives every activity a tag (`activityTags`): an existing tag of the same name that no other activity uses, or a new one
/// in the activity's colour. A remembered tag that was deleted comes back under its id.
pub fn link_tags(data: &mut Value, tags: &mut Vec<Tag>) -> bool {
    let mut used: Vec<String> = list(data, "definitions").filter_map(|item| item.get("calendarTagId").and_then(Value::as_str).map(str::to_owned)).collect();
    let mut changed = false;
    for item in array(data, "definitions").iter_mut() {
        let Some(object) = item.as_object_mut() else { continue };
        let linked = object.get("calendarTagId").and_then(Value::as_str).map(str::to_owned);
        if linked.as_ref().is_some_and(|id| tags.iter().any(|tag| &tag.id == id)) { continue; }
        let name = object.get("name").and_then(Value::as_str).unwrap_or_default().trim().to_string();
        let base: String = if name.is_empty() { "Aktivität".into() } else { name.chars().take(MAX_TAG_NAME - 5).collect() };
        let named = |tags: &[Tag], name: &str| tags.iter().position(|tag| tag.name.to_lowercase() == name.to_lowercase());
        if linked.is_none() {
            if let Some(at) = named(tags, &base).filter(|at| !used.contains(&tags[*at].id)) {
                used.push(tags[at].id.clone());
                object.insert("calendarTagId".into(), json!(tags[at].id));
                continue;
            }
        }
        let mut unique = base.clone();
        let mut suffix = 1;
        while named(tags, &unique).is_some() { suffix += 1; unique = format!("{base} ({suffix})"); }
        let id = linked.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let color = valid_color(object.get("color").unwrap_or(&Value::Null));
        tags.push(Tag { id: id.clone(), name: unique, color, icon: None });
        used.push(id.clone());
        object.insert("calendarTagId".into(), json!(id));
        changed = true;
    }
    changed
}

/// A new activity or value at the end (`Hinzufügen`), coloured by its place among the swatches.
pub fn add(data: &mut Value, tags: &mut Vec<Tag>, page: Page, name: &str) -> Option<Outcome> {
    let name: String = name.trim().chars().take(80).collect();
    if name.is_empty() { return None; }
    let id = uuid::Uuid::new_v4().to_string();
    match page {
        Page::Activities => {
            let items = array(data, "definitions");
            let color = SWATCHES[items.len() % SWATCHES.len()];
            items.push(json!({ "id": id, "name": name, "color": color, "trackTime": true, "textField": false, "active": true }));
            let tags_changed = link_tags(data, tags);
            Some(Outcome { tags: tags_changed, structure: true })
        }
        Page::Values => {
            let items = array(data, "scales");
            let color = SWATCHES[items.len() % SWATCHES.len()];
            items.push(json!({ "id": id, "name": name, "color": color, "min": 0, "max": 10, "active": true }));
            Some(Outcome { tags: false, structure: true })
        }
    }
}

/// One change of a line. `field`: `name`, `name-done` (the tag follows the name), `color`, `active`, `track`, `text`,
/// `min`, `max`, `reset`, `up`, `down`, `delete` (values only). None when nothing changed.
pub fn change(data: &mut Value, tags: &mut Vec<Tag>, page: Page, id: &str, field: &str, value: &str) -> Option<Outcome> {
    let key = if page == Page::Activities { "definitions" } else { "scales" };
    if field == "up" || field == "down" || field == "move" {
        let items = array(data, key);
        let from = items.iter().position(|item| item.get("id").and_then(Value::as_str) == Some(id))?;
        let by = match field { "up" => -1, "down" => 1, _ => value.parse::<i64>().ok()? };
        let to = (from as i64 + by).clamp(0, items.len() as i64 - 1) as usize;
        if to == from { return None; }
        let item = items.remove(from);
        items.insert(to, item);
        return Some(Outcome { structure: true, ..Outcome::default() });
    }
    if field == "delete" {
        if page != Page::Values { return None; }
        let items = array(data, key);
        let before = items.len();
        items.retain(|item| item.get("id").and_then(Value::as_str) != Some(id));
        return (items.len() < before).then(|| Outcome { structure: true, ..Outcome::default() });
    }
    // The daily rating: its colour and span, stored once it differs from the default.
    if id == "rating" {
        if page != Page::Values { return None; }
        let current = rows(data, Page::Values).remove(0);
        let (mut min, mut max, mut color) = (current.min, current.max, current.color);
        match field {
            "color" => color = crate::tag_edit::parse_hex(value)?,
            "min" => { let v = whole(value)?; if v >= max || max - v > MAX_SPAN || v.abs() > 100_000 { return None; } min = v; }
            "max" => { let v = whole(value)?; if v <= min || v - min > MAX_SPAN || v.abs() > 100_000 { return None; } max = v; }
            "reset" => { min = 0; max = 10; }
            _ => return None,
        }
        if !data.is_object() { *data = json!({}); }
        data.as_object_mut()?.insert("rating".into(), json!({ "color": color, "min": min, "max": max }));
        return Some(Outcome::default());
    }
    let row = rows(data, page).into_iter().find(|row| row.id == id)?;
    let item = find(data, key, id)?;
    let mut outcome = Outcome::default();
    match (page, field) {
        (_, "name") => { item.insert("name".into(), json!(value.chars().take(80).collect::<String>())); }
        (Page::Activities, "name-done") => {
            // The tag takes the name, unless another tag has it already.
            let name: String = row.name.trim().chars().take(MAX_TAG_NAME).collect();
            let tag_id = item.get("calendarTagId").and_then(Value::as_str)?.to_string();
            if name.is_empty() || tags.iter().any(|tag| tag.id != tag_id && tag.name.to_lowercase() == name.to_lowercase()) { return None; }
            let tag = tags.iter_mut().find(|tag| tag.id == tag_id)?;
            if tag.name == name { return None; }
            tag.name = name;
            outcome.tags = true;
        }
        (_, "color") => {
            let color = crate::tag_edit::parse_hex(value)?;
            item.insert("color".into(), json!(color));
            if page == Page::Activities {
                if let Some(tag) = item.get("calendarTagId").and_then(Value::as_str).and_then(|tag_id| tags.iter_mut().find(|tag| tag.id == tag_id)) {
                    tag.color = color;
                    outcome.tags = true;
                }
            }
        }
        (_, "active") => { item.insert("active".into(), json!(!row.active)); }
        (Page::Activities, "track") => { item.insert("trackTime".into(), json!(!row.track)); }
        (Page::Activities, "text") => { item.insert("textField".into(), json!(!row.text_field)); }
        // One end of the shades' minutes typed in: the other end is kept and stays six minutes away.
        (Page::Activities, "min" | "max") => {
            let Some(v) = whole(value) else { item.remove("minMinutes"); item.remove("maxMinutes"); return Some(outcome); };
            let (min, max) = if field == "min" { (v.min(row.max - 6).max(0), row.max) } else { (row.min, v.max(row.min + 6).min(MAX_MINUTES)) };
            item.insert("minMinutes".into(), json!(min));
            item.insert("maxMinutes".into(), json!(max));
        }
        (Page::Activities, "reset") => { item.remove("minMinutes"); item.remove("maxMinutes"); }
        // A value's span: whole numbers, the lowest below the highest (typing one end keeps the other).
        (Page::Values, "min") => { let v = whole(value)?; if v >= row.max || row.max - v > MAX_SPAN || v.abs() > 100_000 { return None; } item.insert("min".into(), json!(v)); }
        (Page::Values, "max") => { let v = whole(value)?; if v <= row.min || v - row.min > MAX_SPAN || v.abs() > 100_000 { return None; } item.insert("max".into(), json!(v)); }
        (Page::Values, "reset") => { item.insert("min".into(), json!(0)); item.insert("max".into(), json!(10)); }
        _ => return None,
    }
    Some(outcome)
}

/// The texts of the pages (the app's, `src/locales/en.ts`).
pub struct Texts {
    pub activities_hint: &'static str,
    pub values_hint: &'static str,
    pub name_activity: &'static str,
    pub name_value: &'static str,
    pub daily_rating: &'static str,
    pub shades: &'static str,
    pub lightest: &'static str,
    pub darkest: &'static str,
    pub reset: &'static str,
    pub active: &'static str,
    pub track: &'static str,
    pub notes: &'static str,
    pub new_activity: &'static str,
    pub new_value: &'static str,
    pub add: &'static str,
    pub from: &'static str,
    pub until: &'static str,
    pub delete: &'static str,
    pub delete_ask: &'static str,
    pub untracked: &'static str,
    pub color: &'static str,
    pub hex: &'static str,
    pub move_hint: &'static str,
}

pub fn texts(language: Language) -> &'static Texts {
    const DE: Texts = Texts {
        activities_hint: "Lege deine tägliche Checkliste fest. Farbe, Zeiterfassung und Notizfeld gelten für alle Tage. Jede Aktivität hat ein eigenes Tag: Kalender-Einträge mit diesem Tag zählen als ihre Zeit. Deaktivierte Aktivitäten bleiben in vergangenen Auswertungen erhalten.",
        values_hint: "Werte, die du jeden Tag mit der Maus einträgst – etwa Stress oder Schlaf. Jeder Wert hat eine Farbe und eine Spanne aus ganzen Zahlen. Die Zeiträume zeigen alle Werte zusammen mit der Tagesbewertung in einem Verlauf.",
        name_activity: "Name der Aktivität", name_value: "Name des Tageswerts", daily_rating: "Tagesbewertung",
        shades: "Graphen-Farbstufen", lightest: "Hellste Stufe ab", darkest: "Dunkelste Stufe ab", reset: "Zurücksetzen",
        active: "Aktiv", track: "Zeit erfassen", notes: "Notizfeld", new_activity: "Neue Aktivität …", new_value: "Neuer Tageswert, z. B. Stress …",
        add: "Hinzufügen", from: "Von", until: "bis", delete: "Löschen", delete_ask: "Löschen?",
        untracked: "Zeiterfassung aus: Erledigte Tage verwenden die erste Farbstufe.", color: "Farbe wählen", hex: "Hex",
        move_hint: "Alt+↑/↓ oder am Griff ziehen: Reihenfolge",
    };
    const EN: Texts = Texts {
        activities_hint: "Set up your daily checklist. Color, time tracking and notes apply to every day. Each activity has its own tag: calendar entries with that tag count as its time. Inactive activities remain in past analytics.",
        values_hint: "Values you enter each day with the mouse – such as stress or sleep. Each value has a colour and a span of whole numbers. The periods show all values together with the daily rating as one course.",
        name_activity: "Activity name", name_value: "Name of the day value", daily_rating: "Daily rating",
        shades: "Graph shades", lightest: "Lightest shade from", darkest: "Darkest shade from", reset: "Reset",
        active: "Active", track: "Track time", notes: "Notes", new_activity: "New activity …", new_value: "New day value, e.g. stress …",
        add: "Add", from: "From", until: "until", delete: "Delete", delete_ask: "Delete?",
        untracked: "Time tracking off: completed days use the first shade.", color: "Choose colour", hex: "Hex",
        move_hint: "Alt+↑/↓ or drag the grip: order",
    };
    if language == Language::En { &EN } else { &DE }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tag(name: &str) -> Tag { Tag { id: uuid::Uuid::new_v4().to_string(), name: name.into(), color: "#a8a8a8".into(), icon: None } }

    #[test]
    fn a_new_activity_gets_a_swatch_and_its_own_tag_or_a_free_tag_of_its_name() {
        let mut data = json!({ "days": { "2026-11-18": { "items": {} } }, "notes": { "week:2026-11-16": "bleibt" } });
        let mut tags = vec![tag("Laufen")];
        let outcome = add(&mut data, &mut tags, Page::Activities, "  Laufen ").unwrap();
        assert_eq!(outcome, Outcome { tags: false, structure: true }, "An unused tag of the same name is taken.");
        assert_eq!(data["definitions"][0]["calendarTagId"], json!(tags[0].id));
        assert_eq!((data["definitions"][0]["color"].as_str(), data["definitions"][0]["trackTime"].as_bool()), (Some("#569eff"), Some(true)));
        assert_eq!(data["notes"]["week:2026-11-16"], "bleibt", "What the terminal does not know stays.");
        let outcome = add(&mut data, &mut tags, Page::Activities, "laufen").unwrap();
        assert!(outcome.tags);
        assert_eq!(tags.last().unwrap().name, "laufen (2)", "The tag is taken: a new one with a number.");
        assert_eq!(data["definitions"][1]["color"], "#76d982");
        assert!(add(&mut data, &mut tags, Page::Activities, "   ").is_none());
    }

    #[test]
    fn colour_and_name_reach_the_activitys_tag() {
        let mut data = json!({});
        let mut tags = vec![tag("Lesen")];
        add(&mut data, &mut tags, Page::Activities, "Sport").unwrap();
        let id = data["definitions"][0]["id"].as_str().unwrap().to_string();
        assert!(change(&mut data, &mut tags, Page::Activities, &id, "color", "#FF0000").unwrap().tags);
        assert_eq!((data["definitions"][0]["color"].as_str(), tags[1].color.as_str()), (Some("#ff0000"), "#ff0000"));
        change(&mut data, &mut tags, Page::Activities, &id, "name", "Lesen").unwrap();
        assert!(change(&mut data, &mut tags, Page::Activities, &id, "name-done", "").is_none(), "Another tag has the name: the tag keeps its own.");
        change(&mut data, &mut tags, Page::Activities, &id, "name", "Joggen").unwrap();
        assert!(change(&mut data, &mut tags, Page::Activities, &id, "name-done", "").unwrap().tags);
        assert_eq!(tags[1].name, "Joggen");
    }

    #[test]
    fn toggles_shade_minutes_and_order_follow_the_app() {
        let mut data = json!({});
        let mut tags = Vec::new();
        for name in ["A", "B", "C"] { add(&mut data, &mut tags, Page::Activities, name).unwrap(); }
        let id = |data: &Value, at: usize| data["definitions"][at]["id"].as_str().unwrap().to_string();
        let a = id(&data, 0);
        for field in ["active", "track", "text"] { change(&mut data, &mut tags, Page::Activities, &a, field, "").unwrap(); }
        let row = rows(&data, Page::Activities).remove(0);
        assert_eq!((row.active, row.track, row.text_field), (false, false, true));
        change(&mut data, &mut tags, Page::Activities, &a, "max", "30").unwrap();
        assert_eq!((data["definitions"][0]["minMinutes"].as_i64(), data["definitions"][0]["maxMinutes"].as_i64()), (Some(0), Some(30)));
        change(&mut data, &mut tags, Page::Activities, &a, "min", "50").unwrap();
        assert_eq!(data["definitions"][0]["minMinutes"].as_i64(), Some(24), "The lowest stays six below the highest.");
        assert!(rows(&data, Page::Activities)[0].custom_range);
        change(&mut data, &mut tags, Page::Activities, &a, "reset", "").unwrap();
        assert!(!rows(&data, Page::Activities)[0].custom_range && data["definitions"][0].get("minMinutes").is_none());
        assert!(change(&mut data, &mut tags, Page::Activities, &a, "down", "").unwrap().structure);
        assert_eq!(id(&data, 1), a);
        change(&mut data, &mut tags, Page::Activities, &a, "move", "-5").unwrap();
        assert_eq!(id(&data, 0), a, "A drag past the top ends at the top.");
        assert!(change(&mut data, &mut tags, Page::Activities, &a, "up", "").is_none());
        assert!(change(&mut data, &mut tags, Page::Activities, &a, "delete", "").is_none(), "Activities are switched off, not deleted (as in the app).");
    }

    #[test]
    fn values_have_the_rating_first_spans_and_can_be_deleted() {
        let mut data = json!({ "rating": { "color": "#123456", "min": 0, "max": 10 } });
        let mut tags = Vec::new();
        add(&mut data, &mut tags, Page::Values, "Stress").unwrap();
        let lines = rows(&data, Page::Values);
        assert_eq!((lines[0].kind, lines[0].color.as_str(), lines[1].name.as_str(), lines[1].max), (Kind::Rating, "#123456", "Stress", 10));
        let id = lines[1].id.clone();
        assert!(change(&mut data, &mut tags, Page::Values, &id, "min", "10").is_none(), "The lowest stays below the highest.");
        change(&mut data, &mut tags, Page::Values, &id, "min", "1").unwrap();
        change(&mut data, &mut tags, Page::Values, &id, "max", "5").unwrap();
        assert_eq!((rows(&data, Page::Values)[1].min, rows(&data, Page::Values)[1].max), (1, 5));
        assert!(change(&mut data, &mut tags, Page::Values, &id, "max", "5000").is_none(), "At most 1000 apart.");
        change(&mut data, &mut tags, Page::Values, "rating", "max", "5").unwrap();
        change(&mut data, &mut tags, Page::Values, "rating", "color", "#abc").unwrap();
        assert_eq!(data["rating"], json!({ "color": "#aabbcc", "min": 0, "max": 5 }));
        change(&mut data, &mut tags, Page::Values, "rating", "reset", "").unwrap();
        assert_eq!(data["rating"]["max"], 10);
        assert!(change(&mut data, &mut tags, Page::Values, &id, "delete", "").unwrap().structure);
        assert_eq!(rows(&data, Page::Values).len(), 1);
    }
}
