use super::*;
use journal_core::storage::Tag;
use crate::repeat::d;

const WORK: &str = "3f2a6c1e-0000-4000-8000-000000000002";

struct T { store: Store, snapshot: Snapshot, pane: DayPane, date: NaiveDate, now: i64, path: std::path::PathBuf }
impl Drop for T { fn drop(&mut self) { for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display())); } } }

fn t() -> T {
    let path = std::env::temp_dir().join(format!("j-terminal-day-{}.sqlite3", uuid::Uuid::new_v4()));
    let mut store = Store::open(&path).unwrap();
    store.save_tags(&[Tag { id: WORK.into(), name: "Arbeit".into(), color: "#569eff".into(), icon: Some("briefcase".into()) }]).unwrap();
    store.save_period_data(&serde_json::json!({
        "definitions": [{ "id": "read", "name": "Lesen", "color": "#76d982", "trackTime": true, "active": true }],
        "scales": [{ "id": "stress", "name": "Stress", "color": "#e57b7b", "min": 1, "max": 5, "active": true }],
        "days": {}, "notes": {}
    }).to_string()).unwrap();
    let snapshot = Snapshot::load(&store, d("2026-11-19")).unwrap();
    // 19.11.2026, 10:00 local time.
    let now = chrono::TimeZone::with_ymd_and_hms(&chrono::Local, 2026, 11, 19, 10, 0, 0).earliest().unwrap().timestamp_millis();
    T { store, snapshot, pane: DayPane::default(), date: d("2026-11-19"), now, path }
}

impl T {
    fn cx(&mut self) -> Ctx<'_> { Ctx { store: Some(&mut self.store), snapshot: Some(&mut self.snapshot), date: self.date, today: d("2026-11-19"), language: Language::De, now: self.now } }
    fn key(&mut self, key: K, mods: Mods) -> Out { let mut pane = std::mem::take(&mut self.pane); let out = { let mut cx = self.cx(); pane.key(&mut cx, key, mods) }; self.pane = pane; out }
    fn press(&mut self, key: K) -> Out { self.key(key, Mods::default()) }
    fn alt(&mut self, c: char) -> Out { self.key(K::Char(c), ALT) }
    fn typed(&mut self, text: &str) { self.pane.edited(text); }
    fn view(&mut self) -> DayView { let pane = std::mem::take(&mut self.pane); let view = { let cx = self.cx(); pane.view(&cx) }; self.pane = pane; view }
    fn side(&mut self) -> Option<SidePanel> { let pane = std::mem::take(&mut self.pane); let view = { let cx = self.cx(); pane.side_view(&cx) }; self.pane = pane; view }
    fn with<R>(&mut self, f: impl FnOnce(&mut DayPane, &mut Ctx) -> R) -> R { let mut pane = std::mem::take(&mut self.pane); let r = { let mut cx = self.cx(); f(&mut pane, &mut cx) }; self.pane = pane; r }
    fn day(&self, date: &str) -> Day { self.store.load(date).unwrap() }
    fn entries(&mut self) -> Vec<String> { self.view().rows.iter().filter(|r| r.kind == RowKind::Entry && !r.editing).map(|r| r.label.clone()).collect() }
    fn period(&self) -> serde_json::Value { serde_json::from_str(&self.store.period_data().unwrap()).unwrap() }
    fn select(&mut self, label: &str) { let id = self.day("2026-11-19").entries.iter().find(|e| e.text == label).unwrap().id.clone(); self.pane.cursor = Some(Item::Entry(id)); }
}

const ALT: Mods = Mods { shift: false, ctrl: false, alt: true };
const ALT_SHIFT: Mods = Mods { shift: true, ctrl: false, alt: true };
const SHIFT: Mods = Mods { shift: true, ctrl: false, alt: false };

#[test]
fn writing_new_entries_with_the_apps_shortcuts_and_enter_for_the_next() {
    let mut t = t();
    let out = t.with(|pane, cx| pane.enter(cx));
    assert!(out.focus);
    assert_eq!(t.pane.cursor, Some(Item::Title), "The day's title comes first.");
    // The title is written in place.
    assert_eq!(t.press(K::Enter).edit, Some(String::new()));
    t.typed("Ruhiger Tag");
    t.press(K::Enter);
    assert_eq!(t.day("2026-11-19").title, "Ruhiger Tag");
    // Alt+A: a new task; Enter writes it and starts the next one of its kind.
    let out = t.alt('a');
    assert_eq!(out.edit, Some(String::new()));
    assert!(t.view().rows.iter().any(|r| r.editing && r.kind == RowKind::Entry), "The new line stands where it will be.");
    let draft = t.view();
    let position = draft.rows.iter().position(|row| row.editing).unwrap();
    assert_eq!(draft.rows[position - 1].label, "Einträge");
    assert_eq!(draft.rows[position + 1].label, "Werte");
    t.typed("Einkaufen");
    let out = t.press(K::Enter);
    assert_eq!(out.edit, Some(String::new()), "Enter: the next task.");
    t.typed("Steuer");
    t.press(K::Escape);
    assert_eq!(t.entries(), ["Einkaufen", "Steuer"]);
    // A new entry left empty is not made.
    t.alt('n');
    t.press(K::Escape);
    assert_eq!(t.day("2026-11-19").entries.len(), 2);
    // An event goes before the tasks.
    t.alt('e');
    t.typed("Zahnarzt");
    t.press(K::Escape);
    assert_eq!(t.entries(), ["Zahnarzt", "Einkaufen", "Steuer"]);
    assert_eq!(t.view().rows.iter().filter(|r| r.kind == RowKind::Heading).map(|r| r.label.as_str()).collect::<Vec<_>>(), ["Einträge", "Werte", "Aktivitäten"]);
}

#[test]
fn the_apps_entry_shortcuts_change_the_chosen_entry() {
    let mut t = t();
    for (kind, text) in [('a', "Einkaufen"), ('a', "Steuer")] { t.alt(kind); t.typed(text); t.press(K::Escape); }
    t.select("Steuer");
    t.alt('d');
    assert!(t.day("2026-11-19").entries[1].done, "Alt+D done.");
    t.press(K::Space);
    assert!(!t.day("2026-11-19").entries[1].done, "Space too.");
    t.alt('p');
    assert_eq!(t.entries(), ["Steuer", "Einkaufen"], "Important first.");
    t.alt('p');
    t.key(K::Up, ALT);
    assert_eq!(t.entries(), ["Steuer", "Einkaufen"], "Alt+↑ moves it.");
    t.key(K::Char('E'), ALT_SHIFT);
    assert_eq!(t.day("2026-11-19").entries.iter().find(|e| e.text == "Steuer").unwrap().kind, "event");
    t.key(K::Char('A'), ALT_SHIFT);
    // Enter writes in it; the text is written when leaving.
    t.press(K::Enter);
    t.typed("Steuererklärung");
    t.press(K::Down);
    assert!(t.entries().contains(&"Steuererklärung".to_string()));
    // Alt+M: to tomorrow, a trace stays.
    t.select("Einkaufen");
    t.alt('m');
    assert_eq!(t.day("2026-11-20").entries.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), ["Einkaufen"]);
    let trace = t.view().rows.into_iter().find(|r| r.label == "Einkaufen").unwrap();
    assert!(trace.trace && trace.detail.starts_with("→ "));
    // On a trace Alt+T goes to where it went.
    assert_eq!(t.alt('t').go_to, Some(d("2026-11-20")));
    // Entf removes; the cursor goes on.
    t.select("Steuererklärung");
    t.press(K::Delete);
    assert!(!t.entries().contains(&"Steuererklärung".to_string()));
    assert!(t.pane.cursor.is_some());
}

#[test]
fn the_panel_at_the_left_sets_tag_time_reminder_icon_description_and_plans_on_a_month() {
    let mut t = t();
    t.alt('a'); t.typed("Bericht"); t.press(K::Escape);
    t.select("Bericht");
    // Alt+Enter (or a click on the symbol): the actions.
    t.key(K::Enter, ALT);
    let side = t.side().unwrap();
    assert_eq!((side.kind, side.title.as_str()), (0, "Bericht"));
    let labels: Vec<_> = side.rows.iter().map(|r| r.label.as_str()).collect();
    assert_eq!(labels, ["Status", "Typ", "Wichtig", "Tag", "Uhrzeit", "Erinnerung", "Symbol", "Beschreibung", "Auf morgen", "Planen", "Mehrere Tage", "Löschen"]);
    // The tag: Enter on its line, ↓ to "Arbeit", Enter.
    for _ in 0..3 { t.press(K::Down); }
    t.press(K::Enter);
    assert_eq!(t.side().unwrap().kind, 1);
    t.press(K::Down);
    t.press(K::Enter);
    assert_eq!(t.day("2026-11-19").entries[0].tag.as_deref(), Some(WORK));
    assert!(t.side().is_none(), "Chosen: the card closes (as in Raycast).");
    // The time on the clock: digits, Enter.
    t.alt('u');
    for c in "1430".chars() { t.press(K::Char(c)); }
    assert_eq!(t.side().unwrap().clock, ("14".into(), "30".into(), true));
    t.press(K::Enter);
    assert_eq!(t.day("2026-11-19").entries[0].time.as_deref(), Some("14:30"));
    // The reminder.
    t.alt('r');
    t.with(|pane, cx| pane.choose(cx, 4));
    assert!(t.day("2026-11-19").entries[0].reminder && t.day("2026-11-19").entries[0].reminder_before == 15);
    // The icon: typing searches.
    t.alt('i');
    t.pane.side_edited("stetho");
    assert_eq!(t.side().unwrap().rows[0].icon, "stethoscope");
    t.press(K::Enter);
    assert_eq!(t.day("2026-11-19").entries[0].icon.as_deref(), Some("stethoscope"));
    // The description: Esc saves.
    let out = t.alt('b');
    assert_eq!(out.side_text, Some(String::new()));
    t.pane.side_edited("Bis Freitag abgeben");
    t.press(K::Escape);
    assert_eq!(t.day("2026-11-19").entries[0].description, "Bis Freitag abgeben");
    t.press(K::Escape);
    assert!(t.pane.side.is_none(), "Esc on the actions closes the panel.");
    // Planning on the month: tomorrow is offered, → a day later, Enter.
    t.alt('t');
    let month = t.side().unwrap();
    assert_eq!((month.kind, month.month.as_str(), month.cells.len()), (5, "November 2026", 42));
    assert!(month.cells.iter().any(|c| c.cursor && c.date == d("2026-11-20")));
    assert_eq!(month.confirm, "Planen auf Fr 20.11.");
    t.press(K::Right);
    t.press(K::Enter);
    assert_eq!(t.day("2026-11-21").entries.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), ["Bericht"]);
    assert!(t.pane.side.is_none());
}

#[test]
fn several_days_are_collected_with_space_or_clicks() {
    let mut t = t();
    t.alt('e'); t.typed("Kurs"); t.press(K::Escape);
    t.select("Kurs");
    t.key(K::Char('T'), ALT_SHIFT);
    t.press(K::Space);
    t.with(|pane, cx| pane.plan_click(cx, d("2026-11-26")));
    t.with(|pane, cx| pane.plan_click(cx, d("2026-11-19")));
    assert_eq!(t.side().unwrap().confirm, "Auf 2 Tage planen", "Its own day is not a target.");
    t.with(|pane, cx| pane.confirm_plan(cx));
    for date in ["2026-11-20", "2026-11-26"] { assert_eq!(t.day(date).entries.len(), 1, "{date}"); }
    // A single day: a second click on it plans.
    let mut t = self::t();
    t.alt('a'); t.typed("Anrufen"); t.press(K::Escape);
    t.select("Anrufen");
    t.alt('t');
    t.with(|pane, cx| pane.plan_click(cx, d("2026-11-24")));
    assert_eq!(t.day("2026-11-24").entries.len(), 0);
    t.with(|pane, cx| pane.plan_click(cx, d("2026-11-24")));
    assert_eq!(t.day("2026-11-24").entries.len(), 1);
}

#[test]
fn dials_activities_and_timers_write_the_shared_data() {
    let mut t = t();
    t.pane.cursor = Some(Item::Value("rating".into()));
    t.press(K::Right);
    assert_eq!(t.period()["days"]["2026-11-19"]["rating"], serde_json::json!(0), "From nothing → starts at the lowest.");
    t.press(K::Char('7'));
    assert_eq!(t.period()["days"]["2026-11-19"]["rating"], serde_json::json!(7));
    t.press(K::Char('1'));
    t.press(K::Char('0'));
    assert_eq!(t.period()["days"]["2026-11-19"]["rating"], serde_json::json!(10), "Two digits.");
    t.press(K::Delete);
    assert!(t.period()["days"]["2026-11-19"].get("rating").is_none());
    // The mouse: a click on the ring sets by position, the wheel steps; the span is the scale's.
    t.with(|pane, cx| pane.dial_at(cx, "stress", 1.0));
    assert_eq!(t.period()["days"]["2026-11-19"]["scales"]["stress"], serde_json::json!(5));
    t.with(|pane, cx| pane.dial_wheel(cx, "stress", -2));
    assert_eq!(t.period()["days"]["2026-11-19"]["scales"]["stress"], serde_json::json!(3));
    let dials = t.view().rows.into_iter().find(|r| r.kind == RowKind::Dials).unwrap().dials;
    assert_eq!(dials.iter().map(|d| (d.label.as_str(), d.value.as_str())).collect::<Vec<_>>(), [("Bewertung", "–"), ("Stress", "3")]);
    assert!(dials[1].selected, "The keyboard follows the mouse.");
    // An activity: Space ticks, digits + Enter set minutes.
    t.pane.cursor = Some(Item::Activity("read".into()));
    t.press(K::Space);
    assert_eq!(t.period()["days"]["2026-11-19"]["items"]["read"]["done"], serde_json::json!(true));
    for c in "45".chars() { t.press(K::Char(c)); }
    t.press(K::Enter);
    assert_eq!(t.period()["days"]["2026-11-19"]["items"]["read"]["minutes"], serde_json::json!(45));
    // Enter starts the shared timer, Enter again pauses, Shift+Enter stops it into the calendar.
    t.press(K::Enter);
    let timers = t.store.activity_timers().unwrap();
    assert!(timers["2026-11-19:read"].running());
    t.now += 20 * 60_000;
    let row = t.view().rows.into_iter().find(|r| r.kind == RowKind::Activity).unwrap();
    assert_eq!(row.timer.unwrap(), day_view::TimerView { running: true, clock: "00:20:00".into() });
    t.press(K::Enter);
    assert!(!t.store.activity_timers().unwrap()["2026-11-19:read"].running());
    // Another day keeps showing the timer on top.
    t.date = d("2026-11-21");
    let other = t.view().rows.into_iter().find(|r| r.kind == RowKind::Timer).expect("the timer of the 19th");
    assert_eq!(other.item, Some(Item::Timer("2026-11-19:read".into())));
    t.date = d("2026-11-19");
    t.pane.cursor = Some(Item::Activity("read".into()));
    t.key(K::Enter, SHIFT);
    assert!(t.store.activity_timers().unwrap().is_empty());
    let calendar: Vec<_> = t.store.load_range("2026-01-01", "2026-12-31").unwrap().into_iter().flat_map(|day| day.entries).filter(|e| e.calendar_uid.as_deref().is_some_and(|uid| uid.starts_with("activity-time:"))).collect();
    assert_eq!(calendar.len(), 1, "The session is in the calendar.");
    assert!(!calendar[0].show_in_journal);
    assert!(t.entries().is_empty(), "…and not in the day view.");
}

#[test]
fn the_mouse_chooses_writes_and_opens_the_panel() {
    let mut t = t();
    t.alt('a'); t.typed("Lesen"); t.press(K::Escape);
    let id = t.day("2026-11-19").entries[0].id.clone();
    let out = t.with(|pane, cx| pane.click(cx, Item::Entry(id.clone()), 0));
    assert_eq!(out.edit, Some("Lesen".into()), "A click on the text writes in it.");
    t.typed("Lesen am Abend");
    t.with(|pane, cx| pane.click(cx, Item::Entry(id.clone()), 1));
    assert_eq!(t.day("2026-11-19").entries[0].text, "Lesen am Abend", "What was written stays.");
    assert_eq!(t.side().unwrap().kind, 0, "A click on the symbol opens the panel.");
    t.with(|pane, cx| pane.choose(cx, 0));
    assert!(t.day("2026-11-19").entries[0].done, "A click on Status ticks it.");
    t.with(|pane, cx| pane.click(cx, Item::Activity("read".into()), 1));
    assert_eq!(t.period()["days"]["2026-11-19"]["items"]["read"]["done"], serde_json::json!(true));
    // ↑ from the first line goes back to the search bar.
    t.pane.side = None;
    t.pane.cursor = Some(Item::Title);
    assert!(t.press(K::Up).to_search);
}
