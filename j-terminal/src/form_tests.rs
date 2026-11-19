use super::*;
use journal_core::storage::{Entry, Store, Tag};
use crate::repeat::d;
use crate::day_view;

const HEALTH: &str = "3f2a6c1e-0000-4000-8000-000000000001";
const WORK: &str = "3f2a6c1e-0000-4000-8000-000000000002";

struct Test { form: Form, path: std::path::PathBuf }
impl Drop for Test { fn drop(&mut self) { for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", self.path.display())); } } }

fn test() -> Test {
    let path = std::env::temp_dir().join(format!("j-terminal-form-{}.sqlite3", uuid::Uuid::new_v4()));
    let mut store = Store::open(&path).unwrap();
    store.save_tags(&[
        Tag { id: HEALTH.into(), name: "Gesundheit".into(), color: "#76d982".into(), icon: None },
        Tag { id: WORK.into(), name: "Arbeit".into(), color: "#569eff".into(), icon: None },
    ]).unwrap();
    let journal = Journal { vault: path.parent().unwrap().to_path_buf(), store };
    let mut form = Form::at(Some(journal), Language::De, d("2026-11-18"), 13 * 60 + 20);
    form.shown();
    open(&mut form);
    Test { form, path }
}

const NONE: Mods = Mods { shift: false, ctrl: false, alt: false };
const CTRL: Mods = Mods { shift: false, ctrl: true, alt: false };
const SHIFT: Mods = Mods { shift: true, ctrl: false, alt: false };
const ALT: Mods = Mods { shift: false, ctrl: false, alt: true };

/// `/Entry` in the search bar: the form the tests work with.
fn open(form: &mut Form) {
    form.search_edited("/entry");
    form.key(Key::Enter, NONE);
    assert!(form.view().entry_open);
}

/// Tab until the field has the keyboard ("more" opened on the way when needed).
fn go(form: &mut Form, field: Field) {
    if field.extra() && !form.more_visible() { go(form, Field::More); form.key(Key::Enter, NONE); }
    let back = field.index() < form.field().index();
    for _ in 0..20 { if form.field() == field { return; } form.key(Key::Tab, if back { SHIFT } else { NONE }); }
    panic!("{field:?} not reached");
}
fn type_in(form: &mut Form, text: &str) { form.edited(text); }
fn day(test: &Test, date: &str) -> Vec<Entry> { test.form.journal.as_ref().unwrap().store.load(date).unwrap().entries }
fn row(form: &mut Form, field: Field) -> RowView { form.view().rows.into_iter().find(|row| row.field == field.index()).unwrap() }
fn value(form: &mut Form, field: Field) -> String { form.view().rows.into_iter().find(|row| row.field == field.index()).map(|row| row.value).unwrap_or_default() }

#[test]
fn notepad_writes_a_pinned_card_and_reopens_the_same_note_with_its_tag_and_attachments() {
    use serde_json::Value;
    let mut t = test();
    t.form.close_entry();
    let date = d("2026-11-19");
    t.form.show_day(date);
    let observer = Store::open(&t.path).unwrap();
    let mut watch = observer.watch().unwrap();
    t.form.search_edited("/Notizblock");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.notepad().unwrap().panel, 1);
    t.form.new_notepad_note();
    t.form.edit_notepad(false, "Planung");
    t.form.edit_notepad(true, "# Privat\n\n- [ ] Erledigen");
    t.form.notepad_panel(2);
    assert!(t.form.notepad_choices("Gesund").iter().any(|row| row.key == HEALTH));
    t.form.pick_notepad(HEALTH);
    t.form.attach_notepad(notebook::Attachment::link("https://example.org/journal"));
    let id = t.form.notepad().unwrap().card.as_ref().unwrap().id;
    t.form.finish_notepad(true);
    let saved = t.form.notepad().unwrap();
    assert!(saved.preview && !saved.editing && !saved.dirty());

    assert!(observer.external_changes(&mut watch).unwrap().unwrap().board);
    let read = |key: String| -> Value {
        let value: String = observer.conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0)).unwrap();
        serde_json::from_str(&value).unwrap()
    };
    let key = format!("board:card:{id}");
    let card = read(key.clone());
    assert_eq!(card["kind"], "note");
    assert_eq!(card["notebook"], true);
    assert_eq!(card["onDay"], true);
    assert_eq!(card["dates"], serde_json::json!([date]));
    assert_eq!(card["tag"], HEALTH);
    assert_eq!(card["text"], "# Privat\n\n- [ ] Erledigen");
    assert!(observer.load("2026-11-19").unwrap().body.is_empty());
    let attachment = read(format!("board:card:{}", card["links"][0].as_str().unwrap()));
    assert_eq!(attachment["kind"], "link");
    assert_eq!(attachment["url"], "https://example.org/journal");
    assert_eq!(attachment["links"], serde_json::json!([id.to_string()]));

    t.form.open_notepad(false);
    assert_eq!(t.form.notepad_choices("Planung")[0].key, id.to_string());
    t.form.pick_notepad(&id.to_string());
    assert!(t.form.notepad().unwrap().preview && !t.form.notepad().unwrap().editing);
    t.form.notepad_panel(3);
    assert_eq!(t.form.notepad_choices("journal").len(), 1);
    assert!(t.form.notepad_choices("unmatched").is_empty());
    t.form.finish_notepad(false);
    let changed_in_app = serde_json::json!("pink").to_string();
    observer.conn.execute("UPDATE settings SET value=json_set(value, '$.paper', json(?1)) WHERE key=?2",
        rusqlite::params![changed_in_app, &key]).unwrap();
    let check = note_markdown::blocks(t.form.notepad().unwrap().body()).iter().find_map(|row| row.check).unwrap();
    t.form.notepad_toggle_check(check.0);
    let card = read(key);
    assert_eq!(card["text"], "# Privat\n\n- [x] Erledigen");
    assert_eq!(card["links"][0], attachment["id"]);
    assert_eq!(card["paper"], "pink", "Keep a concurrent pinboard edit.");
}

#[test]
fn notepad_image_uses_the_apps_vault_asset_format() {
    let mut t = test();
    t.form.close_entry();
    let vault = t.path.with_extension("assets-test");
    std::fs::create_dir(&vault).unwrap();
    let source = vault.join("fixture.png");
    image::RgbImage::from_pixel(4, 4, image::Rgb([255, 99, 28])).save(&source).unwrap();
    t.form.journal.as_mut().unwrap().vault = vault.clone();
    t.form.open_notepad(false);
    t.form.new_notepad_note();
    t.form.attach_notepad(notebook::Attachment::image(&source));
    let note = t.form.notepad().unwrap().card.as_ref().unwrap().id;
    t.form.finish_notepad(true);
    let journal = t.form.journal.as_ref().unwrap();
    let asset: String = journal.store.conn.query_row(
        "SELECT json_extract(value, '$.asset') FROM settings WHERE json_extract(value, '$.kind') = 'image' AND json_extract(value, '$.links[0]') = ?1",
        [note.to_string()], |row| row.get(0),
    ).unwrap();
    let folder = vault.join("board-images");
    let file = folder.join(format!("{asset}.avif"));
    let avif = std::fs::read(&file).unwrap();
    assert_eq!(&avif[4..12], b"ftypavif");
    let preview = crate::note_images::decode(&notebook::ImageSource::File(file.clone()), 256).unwrap();
    assert_eq!((preview.width(), preview.height()), (4, 4));
    std::fs::remove_file(file).unwrap();
    std::fs::remove_file(source).unwrap();
    std::fs::remove_dir(folder).unwrap();
    std::fs::remove_dir(vault).unwrap();
}

#[test]
fn notebook_browses_today_by_nested_folder_and_keeps_the_other_days_in_all() {
    use serde_json::json;
    let mut t = test();
    t.form.close_entry();
    let store = &t.form.journal.as_ref().unwrap().store;
    let parent = uuid::Uuid::new_v4().to_string();
    let child = uuid::Uuid::new_v4().to_string();
    for folder in [
        json!({"id": parent, "name":"Projekt", "parent":null, "order":1}),
        json!({"id": child, "name":"Notizen", "parent":parent, "order":1}),
    ] {
        store.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2)",
            rusqlite::params![format!("board:folder:{}", folder["id"].as_str().unwrap()), folder.to_string()]).unwrap();
    }
    for (title, date, created, folder) in [
        ("Angepinnt", "2026-11-18", "2026-11-17", Some(&child)),
        ("Lose", "", "2026-11-18", None),
        ("Gestern", "2026-11-17", "2026-11-17", Some(&parent)),
    ] {
        let id = uuid::Uuid::new_v4().to_string();
        let dates = if date.is_empty() { vec![] } else { vec![date] };
        let card = json!({"id":id, "kind":"note", "title":title, "dates":dates, "created":created, "notebook":true, "folder":folder});
        store.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2)",
            rusqlite::params![format!("board:card:{id}"), card.to_string()]).unwrap();
    }
    t.form.open_notepad(false);
    t.form.notepad_panel(1);
    assert_eq!(t.form.notepad_choices("").len(), 3);
    t.form.set_notepad_day_filter(true);
    let rows = t.form.notepad_choices("");
    assert_eq!(rows.iter().map(|row| (row.title.as_str(), row.group.as_str())).collect::<Vec<_>>(),
        [("Lose", "Ohne Ordner"), ("Angepinnt", "Projekt / Notizen")]);
}

#[test]
fn notepad_edits_the_selected_day_and_keeps_the_draft_on_reopen() {
    let mut t = test();
    t.form.close_entry();
    let date = d("2026-11-19");
    let store = &mut t.form.journal.as_mut().unwrap().store;
    let mut day = store.load("2026-11-19").unwrap();
    day.title = "Morgen".into();
    day.body = "**Vorhandener Text**\n".into();
    store.save(day).unwrap();

    t.form.show_day(date);
    t.form.search_edited("/Journaltext");
    t.form.key(Key::Enter, NONE);
    let draft = t.form.notepad().unwrap();
    assert_eq!((draft.date, draft.title(), draft.body()), (date, "Morgen", "**Vorhandener Text**\n"));
    t.form.edit_notepad(false, "Besuch");
    t.form.edit_notepad(true, "Zeile eins\n\n- Zeile zwei");
    t.form.shown();
    assert_eq!(t.form.notepad().unwrap().body(), "Zeile eins\n\n- Zeile zwei");
    assert_eq!(t.form.key(Key::Enter, CTRL).focus, Some(Pane::Search));
    assert!(t.form.notepad().is_none());
    assert_eq!(t.form.view().day.title, "Besuch");
    let store = &t.form.journal.as_ref().unwrap().store;
    assert_eq!(store.load("2026-11-19").unwrap().body, "Zeile eins\n\n- Zeile zwei");
    assert!(store.load("2026-11-18").unwrap().body.is_empty());
}

#[test]
fn notepad_keeps_other_writes_and_reports_a_conflict_in_an_edited_field() {
    let mut t = test();
    t.form.edited("Erster Eintrag");
    t.form.key(Key::Enter, SHIFT);
    t.form.close_entry();
    t.form.open_notepad(true);
    t.form.edit_notepad(true, "Journaltext");
    let mut other = Store::open(&t.path).unwrap();
    let mut day = other.load("2026-11-18").unwrap();
    day.entries[0].text = "Geänderter Eintrag".into();
    day.title = "Anderer Titel".into();
    other.save(day).unwrap();

    t.form.finish_notepad(true);
    assert!(t.form.notepad().is_none());
    let updated = other.load("2026-11-18").unwrap();
    assert_eq!((updated.title.as_str(), updated.body.as_str(), updated.entries[0].text.as_str()),
        ("Anderer Titel", "Journaltext", "Geänderter Eintrag"));

    t.form.open_notepad(true);
    t.form.edit_notepad(true, "Mein Entwurf");
    let mut updated = updated;
    updated.body = "In der Haupt-App".into();
    other.save(updated).unwrap();
    t.form.finish_notepad(true);
    assert_eq!(t.form.view().status, Some((notepad_texts(Language::De).conflict.into(), true)));
    assert_eq!(t.form.notepad().unwrap().body(), "Mein Entwurf");
    t.form.key(Key::Escape, NONE);
    assert!(t.form.notepad().is_some(), "The first Esc warns about the unsaved draft.");
    t.form.key(Key::Escape, NONE);
    assert!(t.form.notepad().is_none());
    assert_eq!(other.load("2026-11-18").unwrap().body, "In der Haupt-App");
}

#[test]
fn closing_an_unchanged_notepad_does_not_create_an_empty_day() {
    let mut t = test();
    t.form.close_entry();
    t.form.show_day(d("2026-11-20"));
    t.form.open_notepad(true);
    t.form.finish_notepad(true);
    assert_eq!(t.form.journal.as_ref().unwrap().store.load("2026-11-20").unwrap().revision, 0);
}

#[test]
fn copying_legacy_journal_text_pins_a_new_card_without_removing_the_source() {
    let mut t = test();
    t.form.close_entry();
    t.form.open_notepad(true);
    t.form.edit_notepad(true, "**Alter Text**");
    t.form.finish_notepad(true);
    t.form.open_notepad(true);
    t.form.copy_journal_text_to_card();
    assert!(t.form.notepad().unwrap().card.is_some());
    t.form.finish_notepad(true);
    let store = &t.form.journal.as_ref().unwrap().store;
    assert_eq!(store.load("2026-11-18").unwrap().body, "**Alter Text**");
    let body: String = store.conn.query_row(
        "SELECT json_extract(value, '$.text') FROM settings WHERE key LIKE 'board:card:%' AND json_extract(value, '$.dates[0]') = ?1",
        ["2026-11-18"], |row| row.get(0),
    ).unwrap();
    assert_eq!(body, "**Alter Text**");
}

#[test]
fn enter_moves_on_from_a_field_without_options_and_strg_enter_creates() {
    let mut t = test();
    assert_eq!(t.form.field(), Field::Title);
    type_in(&mut t.form, "Einkaufen");
    let effect = t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.field(), Field::Day);
    assert!(!effect.hide && !effect.hide_soon);
    assert!(day(&t, "2026-11-18").is_empty(), "Enter never creates an entry.");
    assert!(t.form.key(Key::Enter, CTRL).hide_soon, "Strg+Enter creates and closes.");
    let entries = day(&t, "2026-11-18");
    assert_eq!((entries[0].kind.as_str(), entries[0].text.as_str(), entries[0].show_in_journal), ("task", "Einkaufen", true));
}

#[test]
fn tab_always_goes_to_the_next_field() {
    let mut t = test();
    let mut seen = vec![t.form.field()];
    for _ in 0..6 { t.form.key(Key::Tab, NONE); seen.push(t.form.field()); }
    assert_eq!(seen, [Field::Title, Field::Day, Field::Start, Field::Repeat, Field::Tag, Field::More, Field::More], "No end without a start; more is the last until opened.");
    t.form.key(Key::Tab, SHIFT);
    t.form.key(Key::Tab, SHIFT);
    assert_eq!(t.form.field(), Field::Repeat, "Also from the repetition, Tab goes on (Shift+Tab back).");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::Tag);
}

#[test]
fn shift_enter_creates_and_keeps_an_empty_form() {
    let mut t = test();
    type_in(&mut t.form, "Sport");
    let effect = t.form.key(Key::Enter, SHIFT);
    assert!(!effect.hide_soon && !effect.hide);
    assert_eq!((t.form.field(), t.form.title()), (Field::Title, ""));
    assert_eq!(t.form.view().status, Some(("Gespeichert".into(), false)));
    assert_eq!(day(&t, "2026-11-18").len(), 1);
}

#[test]
fn the_four_types_of_the_app() {
    let mut t = test();
    type_in(&mut t.form, "Zahnarzt");
    for (digit, kind, journal) in [(1, "event", false), (2, "event", true), (3, "task", true)] {
        t.form.key(Key::Digit(digit), ALT);
        assert_eq!(t.form.view().type_selected, digit as usize - 1);
        t.form.key(Key::Enter, SHIFT);
        type_in(&mut t.form, "Zahnarzt");
        let made = day(&t, "2026-11-18").pop().unwrap();
        assert_eq!((made.kind.as_str(), made.show_in_journal), (kind, journal), "Type {digit}");
    }
    t.form.key(Key::Digit(4), ALT);
    t.form.key(Key::Enter, SHIFT);
    assert_eq!(day(&t, "2026-11-18").pop().unwrap().kind, "note");
    t.form.key(Key::Up, NONE);
    assert_eq!(t.form.field(), Field::Kind);
    t.form.key(Key::Right, NONE);
    t.form.key(Key::Right, NONE);
    assert_eq!(t.form.view().type_selected, 0, "It wraps: Kalender after Notiz.");
    assert_eq!(t.form.view().type_icons, ["journal-calendar", "journal-event", "journal-task", "journal-note"]);
}

#[test]
fn a_quick_title_hands_its_words_to_the_fields() {
    let mut t = test();
    type_in(&mut t.form, "Zahnarzt Do 14 \\Gesundheit");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.title(), "Zahnarzt");
    assert_eq!(value(&mut t.form, Field::Day), "Do 19.11.2026 · morgen");
    assert_eq!(value(&mut t.form, Field::Start), "14:00");
    let tag = row(&mut t.form, Field::Tag);
    assert_eq!((tag.value.as_str(), tag.color), ("Gesundheit", Some([0x76, 0xd9, 0x82])), "The tag shows its colour.");
    assert_eq!(t.form.view().type_selected, 0, "A time without a type word: an appointment in the calendar, as in the app.");
    t.form.key(Key::Enter, CTRL);
    let e = &day(&t, "2026-11-19")[0];
    assert_eq!((e.kind.as_str(), e.time.as_deref(), e.end.as_deref(), e.tag.as_deref(), e.show_in_journal), ("event", Some("14:00"), None, Some(HEALTH), false));
}

#[test]
fn a_quoted_title_stays_as_written() {
    let mut t = test();
    type_in(&mut t.form, "\"Montag um 14 besprechen\"");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.title(), "Montag um 14 besprechen");
    assert!(!row(&mut t.form, Field::Start).filled);
}

#[test]
fn a_typed_range_is_always_one_entry_over_its_days_and_commas_are_separate_entries() {
    for typ in [Type::Task, Type::Event, Type::Calendar] {
        let mut t = test();
        type_in(&mut t.form, "Urlaub");
        t.form.key(Key::Digit(typ.index() as u8 + 1), ALT);
        go(&mut t.form, Field::Day);
        type_in(&mut t.form, "23.11.2026-27.11.2026");
        assert_eq!(value(&mut t.form, Field::Day), "23.11.2026–27.11.2026");
        t.form.key(Key::Enter, SHIFT);
        let monday = day(&t, "2026-11-23");
        assert_eq!((monday.len(), monday[0].end.as_deref(), monday[0].repeat.is_none()), (1, Some("120:00"), true), "{typ:?}: one entry, no series.");
        assert!(day(&t, "2026-11-24").is_empty());
    }
    let mut t = test();
    type_in(&mut t.form, "Kurs");
    go(&mut t.form, Field::Day);
    type_in(&mut t.form, "19.11.2026, 26.11.2026");
    t.form.key(Key::Enter, SHIFT);
    assert_eq!((day(&t, "2026-11-19").len(), day(&t, "2026-11-26").len()), (1, 1));
    t.form.key(Key::Undo, CTRL);
    assert!(day(&t, "2026-11-19").is_empty() && day(&t, "2026-11-26").is_empty());
}

#[test]
fn when_is_one_line_date_start_and_end_and_an_empty_end_is_a_point_in_time() {
    let mut t = test();
    type_in(&mut t.form, "Treffen");
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "morgen");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::Start, "From the date to the start.");
    assert!(t.form.view().rows.iter().all(|r| r.field != Field::End.index()), "Without a start there is no end.");
    type_in(&mut t.form, "1430");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::End);
    let when: Vec<usize> = t.form.view().rows.iter().filter(|r| r.multi).map(|r| r.line).collect();
    assert!(when.windows(2).all(|pair| pair[0] == pair[1]) && when.len() == 3, "Date, start and end share a line.");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::Repeat, "An empty end: a point in time.");
    t.form.key(Key::Enter, SHIFT);
    let e = &day(&t, "2026-11-19")[0];
    assert_eq!((e.time.as_deref(), e.end.as_deref()), (Some("14:30"), None));
}

#[test]
fn an_end_is_typed_as_a_time_or_a_length() {
    let mut t = test();
    type_in(&mut t.form, "Meeting");
    go(&mut t.form, Field::Start);
    type_in(&mut t.form, "9:00");
    go(&mut t.form, Field::End);
    type_in(&mut t.form, "+1,5h");
    assert_eq!(value(&mut t.form, Field::End), "10:30");
    type_in(&mut t.form, "1:00");
    assert_eq!(value(&mut t.form, Field::End), "01:00 (+1 Tag)", "Before the start: the next day.");
    type_in(&mut t.form, "abc");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::End, "Not understood: the field stays.");
    assert!(t.form.view().status.unwrap().1);
    type_in(&mut t.form, "14-15:30");
    let mut s = test();
    type_in(&mut s.form, "Kurs");
    go(&mut s.form, Field::Start);
    type_in(&mut s.form, "14-15:30");
    s.form.key(Key::Enter, SHIFT);
    let e = &day(&s, "2026-11-18")[0];
    assert_eq!((e.time.as_deref(), e.end.as_deref()), (Some("14:00"), Some("15:30")), "The start takes the whole range too.");
}

#[test]
fn enter_on_a_time_opens_the_clock_with_hours_and_minutes() {
    let mut t = test();
    type_in(&mut t.form, "Meeting");
    go(&mut t.form, Field::Start);
    t.form.key(Key::Enter, NONE);
    let Panel::Clock { hours, minutes, on_minutes, .. } = t.form.view().panel else { panic!("the clock") };
    assert_eq!((hours.as_str(), minutes.as_str(), on_minutes), ("14", "00", false), "The next full hour.");
    assert!(!t.form.view().editable, "The keys belong to the clock.");
    t.form.key(Key::Up, NONE);
    t.form.key(Key::Up, CTRL);
    assert_eq!(t.form.text_of(Field::Start), "19:00", "↑ an hour, Strg+↑ four.");
    t.form.key(Key::Right, NONE);
    t.form.key(Key::Up, CTRL);
    t.form.key(Key::Up, CTRL);
    t.form.key(Key::Down, NONE);
    assert_eq!(t.form.text_of(Field::Start), "19:29", "On the minutes: Strg+↑ a quarter, ↑/↓ a minute.");
    t.form.key(Key::Enter, NONE);
    assert_eq!((t.form.field(), t.form.view().panel), (Field::End, Panel::None), "Enter takes it and goes on.");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.text_of(Field::End), "20:29", "An end starts an hour later.");
    for digit in [2, 1, 4, 5] { t.form.key(Key::Digit(digit), NONE); }
    assert_eq!(t.form.text_of(Field::End), "21:45", "Digits are typed.");
    t.form.key(Key::Escape, NONE);
    assert_eq!((t.form.field(), t.form.text_of(Field::End)), (Field::End, String::new()), "Esc: as before, in the same field.");
    t.form.key(Key::Enter, NONE);
    t.form.key(Key::Delete, NONE);
    assert_eq!(t.form.text_of(Field::End), "", "Delete: no end, a point in time.");
}

#[test]
fn enter_on_the_date_gives_the_calendar_the_keyboard_with_days_and_hours() {
    let mut t = test();
    type_in(&mut t.form, "Projekt");
    go(&mut t.form, Field::Day);
    t.form.key(Key::Enter, NONE);
    assert!(t.form.view().calendar.focus);
    assert!(t.form.view().calendar.layout.caret_side, "First on the side: whole days.");
    t.form.key(Key::Down, NONE);
    assert_eq!(value(&mut t.form, Field::Day), "Do 19.11.2026 · morgen", "↓ a day, live.");
    t.form.key(Key::Down, SHIFT);
    t.form.key(Key::Down, SHIFT);
    assert_eq!(value(&mut t.form, Field::Day), "19.11.2026–21.11.2026", "Shift draws a range: several days.");
    t.form.key(Key::Escape, NONE);
    assert_eq!(value(&mut t.form, Field::Day), "Sa 21.11.2026", "Esc drops the range first.");
    t.form.key(Key::Tab, NONE);
    assert!(!t.form.view().calendar.layout.caret_side, "Tab: into the hours.");
    assert_eq!(value(&mut t.form, Field::Start), "14:00");
    t.form.key(Key::Right, NONE);
    t.form.key(Key::Right, CTRL);
    assert_eq!(value(&mut t.form, Field::Start), "15:15", "→ an hour, Strg+→ a quarter.");
    t.form.key(Key::Right, SHIFT);
    t.form.key(Key::Down, SHIFT);
    assert_eq!((value(&mut t.form, Field::Day), value(&mut t.form, Field::Start), value(&mut t.form, Field::End)),
        ("21.11.2026–22.11.2026".to_string(), "15:15".to_string(), "16:15 (+1 Tag)".to_string()), "A span over days, as it is in the calendar (→ snaps to the hour).");
    t.form.key(Key::Enter, NONE);
    assert!(!t.form.view().calendar.focus);
    assert_eq!(t.form.field(), Field::Start, "Back to the form, the next field.");
    t.form.key(Key::Enter, SHIFT);
    let e = &day(&t, "2026-11-21")[0];
    assert_eq!((e.time.as_deref(), e.end.as_deref()), (Some("15:15"), Some("40:15")));
    assert!(e.time_grid, "The keyboard's hour grid records the same origin as a mouse range.");
}

#[test]
fn mouse_hour_ranges_keep_their_presentation_after_saving_but_typed_ranges_keep_lanes() {
    let mut t = test();
    type_in(&mut t.form, "Projekt");
    let layout = t.form.view().calendar.layout;
    let y = |day| layout.rows.iter().find(|row| row.date == d(day)).unwrap().y + 2.0;
    let m = t.form.shown_metrics;
    t.form.cal_mouse(1, 0, m.x_of(840.0), y("2026-11-18"), false);
    t.form.cal_mouse(1, 1, m.x_of(946.0), y("2026-11-20"), false);
    t.form.cal_mouse(1, 2, m.x_of(946.0), y("2026-11-20"), false);
    assert_eq!(t.form.view().calendar.layout.blocks.iter().filter(|b| b.fresh).count(), 3);
    t.form.key(Key::Enter, SHIFT);
    assert!(day(&t,"2026-11-18")[0].time_grid);
    let saved = t.form.view().calendar.layout;
    assert_eq!(saved.blocks.len(), 3);
    assert!(saved.lanes.is_empty());
    type_in(&mut t.form,"Manuell");
    go(&mut t.form,Field::Day); type_in(&mut t.form,"18.11.2026–20.11.2026");
    go(&mut t.form,Field::Start); type_in(&mut t.form,"14");
    go(&mut t.form,Field::End); type_in(&mut t.form,"16");
    assert!(t.form.view().calendar.layout.lanes.iter().any(|lane| lane.fresh));
    t.form.key(Key::Enter,SHIFT);
    assert!(!day(&t,"2026-11-18")[1].time_grid);
}

#[test]
fn the_calendar_without_a_range_takes_the_day_or_the_moment_and_esc_twice_goes_back_unchanged() {
    let mut t = test();
    type_in(&mut t.form, "Arzt");
    go(&mut t.form, Field::Day);
    t.form.key(Key::Enter, NONE);
    t.form.key(Key::Down, NONE);
    t.form.key(Key::Tab, NONE);
    t.form.key(Key::Left, NONE);
    t.form.key(Key::Enter, NONE);
    assert_eq!((value(&mut t.form, Field::Day), value(&mut t.form, Field::Start), value(&mut t.form, Field::End)), ("Do 19.11.2026 · morgen".to_string(), "13:00".to_string(), String::new()), "In the hours: a point in time.");
    go(&mut t.form, Field::Day);
    t.form.key(Key::Enter, NONE);
    t.form.key(Key::Down, NONE);
    t.form.key(Key::Escape, NONE);
    assert!(!t.form.view().calendar.focus);
    assert_eq!((t.form.field(), value(&mut t.form, Field::Day)), (Field::Day, "Do 19.11.2026 · morgen".to_string()), "Esc without a range: back to the date, as it was.");
}

#[test]
fn more_opens_the_rest_and_every_field_reaches_the_journal() {
    let mut t = test();
    type_in(&mut t.form, "Bericht");
    assert!(t.form.view().rows.iter().all(|r| r.field != Field::Description.index()), "Behind more at first.");
    go(&mut t.form, Field::Day); type_in(&mut t.form, "morgen");
    go(&mut t.form, Field::Start); type_in(&mut t.form, "9");
    go(&mut t.form, Field::End); type_in(&mut t.form, "10");
    go(&mut t.form, Field::Tag); type_in(&mut t.form, "arb");
    go(&mut t.form, Field::More);
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.field(), Field::Description, "Enter on more opens it and goes in.");
    type_in(&mut t.form, "Zahlen von Q3");
    go(&mut t.form, Field::Priority); t.form.key(Key::Space, NONE);
    go(&mut t.form, Field::Reminder); type_in(&mut t.form, "45");
    go(&mut t.form, Field::Icon); type_in(&mut t.form, "bell-ring");
    t.form.key(Key::Enter, CTRL);
    let e = &day(&t, "2026-11-19")[0];
    assert_eq!((e.text.as_str(), e.kind.as_str(), e.time.as_deref(), e.end.as_deref()), ("Bericht", "task", Some("09:00"), Some("10:00")));
    assert_eq!((e.tag.as_deref(), e.description.as_str(), e.priority), (Some(WORK), "Zahlen von Q3", true));
    assert_eq!((e.reminder, e.reminder_before, e.icon.as_deref()), (true, 45, Some("bell-ring")));
}

#[test]
fn tags_are_chosen_in_their_options_with_their_colours() {
    let mut t = test();
    go(&mut t.form, Field::Tag);
    assert_eq!(t.form.view().panel, Panel::None, "The list opens with Enter.");
    t.form.key(Key::Enter, NONE);
    let Panel::Tags(choices) = t.form.view().panel else { panic!("tags under the line") };
    assert_eq!(choices.iter().map(|c| c.label.as_str()).collect::<Vec<_>>(), ["Ohne Tag", "Gesundheit", "Arbeit"]);
    assert!(choices[1].color.is_some() && choices[0].selected);
    t.form.key(Key::Down, NONE);
    t.form.key(Key::Down, NONE);
    assert_eq!(value(&mut t.form, Field::Tag), "Arbeit", "↓ goes down the list.");
    t.form.key(Key::Up, NONE);
    assert_eq!(value(&mut t.form, Field::Tag), "Gesundheit");
    t.form.key(Key::Escape, NONE);
    assert_eq!((t.form.field(), value(&mut t.form, Field::Tag)), (Field::Tag, String::new()), "Esc: as before, same field.");
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "ar");
    let Panel::Tags(choices) = t.form.view().panel else { panic!() };
    assert_eq!(choices.len(), 2, "Typing filters.");
    t.form.choice_click(1);
    t.form.key(Key::Enter, NONE);
    assert_eq!((t.form.field(), value(&mut t.form, Field::Tag)), (Field::More, "Arbeit".to_string()), "Enter takes it and goes on.");
    go(&mut t.form, Field::Tag);
    type_in(&mut t.form, "xyz");
    assert!(row(&mut t.form, Field::Tag).error);
}

#[test]
fn entry_and_tag_icons_follow_the_draft_and_saved_calendar() {
    let mut t = test();
    let snapshot = t.form.snapshot.as_mut().unwrap();
    snapshot.tags[0].icon = Some("stethoscope".into());
    t.form.journal.as_mut().unwrap().store.save_tags(&snapshot.tags).unwrap();

    type_in(&mut t.form, "Kontrolle");
    go(&mut t.form, Field::Tag);
    type_in(&mut t.form, "Gesundheit");
    assert_eq!(row(&mut t.form, Field::Tag).icon, "stethoscope");
    t.form.key(Key::Enter, NONE);
    let Panel::Tags(tags) = t.form.view().panel else { panic!("tag options") };
    assert_eq!(tags.iter().find(|tag| tag.label == "Gesundheit").unwrap().icon, "stethoscope");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.view().calendar.layout.chips[0].icon, "stethoscope", "The draft inherits the tag's icon.");

    go(&mut t.form, Field::Icon);
    type_in(&mut t.form, "heart");
    assert_eq!(t.form.view().calendar.layout.chips[0].icon, "heart", "An entry's own icon takes precedence.");
    t.form.key(Key::Enter, SHIFT);
    assert_eq!(day(&t, "2026-11-18")[0].icon.as_deref(), Some("heart"));
    assert_eq!(t.form.view().calendar.layout.chips[0].icon, "heart", "The saved entry keeps it.");

    assert_eq!(t.form.icon_of(Some("unknown-icon"), Some(HEALTH)), "stethoscope");
    assert_eq!(t.form.icon_of(Some("unknown-icon"), Some(WORK)), "", "Unknown names keep the colour-dot fallback.");
}

#[test]
fn icons_are_chosen_in_a_grid_in_all_directions() {
    let mut t = test();
    go(&mut t.form, Field::Icon);
    t.form.key(Key::Enter, NONE);
    let Panel::Icons(common) = t.form.view().panel else { panic!("icons") };
    assert!(common.len() >= 40 && common.iter().all(|c| icons::exists(&c.icon)));
    t.form.key(Key::Down, NONE);
    t.form.key(Key::Right, NONE);
    let Panel::Icons(grid) = t.form.view().panel else { panic!() };
    assert!(grid[ICON_COLUMNS as usize + 1].selected, "↓ a line of the grid, → one further.");
    type_in(&mut t.form, "stetho");
    assert_eq!(value(&mut t.form, Field::Icon), "stethoscope");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.view().panel, Panel::None);
    go(&mut t.form, Field::Icon);
    type_in(&mut t.form, "kein-solches-symbol");
    assert!(row(&mut t.form, Field::Icon).error);
}

#[test]
fn reminders_are_ready_made_or_typed() {
    let mut t = test();
    go(&mut t.form, Field::Reminder);
    t.form.key(Key::Enter, NONE);
    t.form.key(Key::Right, NONE);
    t.form.key(Key::Down, NONE);
    assert_eq!(value(&mut t.form, Field::Reminder), "30 Min. vorher", "→ then ↓ a line of four.");
    for (typed, minutes) in [("45", 45), ("2 h", 120), ("1h30", 90), ("1 Tag", 1440), ("2 Tage", 2880), ("1 Woche", 10080), ("Zur Uhrzeit", 0)] {
        type_in(&mut t.form, typed);
        assert_eq!(t.form.v.reminder, Some(minutes), "{typed}");
    }
    type_in(&mut t.form, "45 Tage");
    assert!(row(&mut t.form, Field::Reminder).error, "More than 30 days is not allowed.");
    type_in(&mut t.form, "");
    assert_eq!(t.form.v.reminder, None);
}

#[test]
fn the_repetition_opens_with_enter_and_the_calendar_follows_every_change() {
    let mut t = test();
    type_in(&mut t.form, "Sport");
    go(&mut t.form, Field::Repeat);
    t.form.key(Key::Enter, NONE);
    let Panel::Repeat(lines) = t.form.view().panel else { panic!("the repetition's lines") };
    assert_eq!(lines.len(), 2, "Once: only the rhythms (two rows).");
    assert!(!t.form.view().editable, "The keys belong to the options.");
    for _ in 0..3 { t.form.key(Key::Right, NONE); }
    assert_eq!(t.form.v.rule.as_ref().map(|r| r.unit), Some(repeat::Unit::Week));
    let fresh = |form: &mut Form| { let layout = form.view().calendar.layout; layout.blocks.iter().filter(|b| b.fresh).count() + layout.chips.iter().filter(|c| c.fresh).count() };
    let weekly = fresh(&mut t.form);
    for _ in 0..3 { t.form.key(Key::Down, NONE); }
    assert_eq!(t.form.view().panel, t.form.view().panel);
    t.form.key(Key::Down, NONE);
    t.form.key(Key::Digit(1), NONE);
    t.form.key(Key::Digit(5), NONE);
    assert_eq!(t.form.v.rule.as_ref().unwrap().weekdays, Some(vec![0, 2, 4]));
    assert!(fresh(&mut t.form) > weekly, "The calendar shows the new days before anything is taken.");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.field(), Field::Tag, "Enter takes it and goes on.");
    go(&mut t.form, Field::Repeat);
    t.form.key(Key::Enter, NONE);
    t.form.key(Key::Left, NONE);
    t.form.key(Key::Escape, NONE);
    assert_eq!(t.form.v.rule.as_ref().unwrap().weekdays, Some(vec![0, 2, 4]), "Esc: the rule from before.");
    t.form.key(Key::Enter, CTRL);
    assert!(day(&t, "2026-11-18")[0].repeat.is_some());
}

#[test]
fn a_repetition_can_still_be_typed_and_clicked() {
    let mut t = test();
    type_in(&mut t.form, "Sport");
    go(&mut t.form, Field::Repeat);
    type_in(&mut t.form, "jede Woche");
    assert!(row(&mut t.form, Field::Repeat).filled);
    t.form.repeat_click(0, 5);
    assert_eq!(t.form.v.rule.as_ref().map(|r| r.unit), Some(repeat::Unit::Month), "A click on Monatlich.");
    t.form.repeat_click(0, 0);
    assert!(t.form.v.rule.is_none());
}

#[test]
fn problems_are_shown_at_their_field() {
    let mut t = test();
    assert!(t.form.view().status.is_none(), "An empty title is no problem until creating is tried.");
    go(&mut t.form, Field::Tag);
    t.form.key(Key::Enter, CTRL);
    assert_eq!(t.form.field(), Field::Title, "The missing title is where the cursor goes.");
    assert!(row(&mut t.form, Field::Title).error);
    assert_eq!(t.form.view().status, Some(("Der Titel fehlt".into(), true)));
    type_in(&mut t.form, "Idee");
    t.form.key(Key::Digit(4), ALT);
    go(&mut t.form, Field::Start);
    type_in(&mut t.form, "14");
    assert!(row(&mut t.form, Field::Start).error, "A note with a time: shown at the time at once.");
    t.form.key(Key::Enter, CTRL);
    assert!(day(&t, "2026-11-18").is_empty());
}

#[test]
fn escape_takes_back_the_field_then_closes_the_form_then_the_window() {
    let mut t = test();
    type_in(&mut t.form, "Entwurf");
    let effect = t.form.key(Key::Escape, NONE);
    assert_eq!((t.form.title(), effect.text.as_deref(), effect.hide), ("", Some(""), false));
    assert_eq!(t.form.key(Key::Escape, NONE).focus, Some(Pane::Search));
    assert!(t.form.key(Key::Escape, NONE).hide);
}

#[test]
fn the_calendar_opens_the_drafts_day_by_itself() {
    let mut t = test();
    type_in(&mut t.form, "Zahnarzt");
    go(&mut t.form, Field::Day);
    type_in(&mut t.form, "25.11.2026");
    let layout = t.form.view().calendar.layout;
    assert!(layout.bands.iter().any(|b| b.date == d("2026-11-25") && b.open), "The day of the draft is open.");
    assert!(!t.form.opened().contains(&d("2026-11-25")), "Without being clicked open.");
}

#[test]
fn every_line_has_its_icon() {
    let mut t = test();
    go(&mut t.form, Field::Icon);
    for row in t.form.view().rows.iter().filter(|row| !row.label.is_empty()) {
        assert!(icons::exists(row.label_icon), "{}: {}", row.label, row.label_icon);
    }
}

#[test]
fn the_search_bar_comes_first_and_only_knows_its_commands() {
    let mut form = Form::at(None, Language::De, d("2026-11-18"), 600);
    form.shown();
    assert!(!form.view().entry_open);
    form.search_edited("/x");
    assert!(form.view().commands.is_empty());
    form.key(Key::Enter, NONE);
    assert!(!form.view().entry_open && form.view().status.unwrap().1, "An unknown command is named.");
    form.search_edited("/E");
    assert_eq!(form.view().commands[0].name, "/Entry");
    assert_eq!(form.key(Key::Enter, NONE).focus, Some(Pane::Entry));
    assert!(form.view().entry_open);
    assert_eq!(form.key(Key::Escape, NONE).focus, Some(Pane::Search), "Esc without changes closes the form again.");
    assert!(form.key(Key::Escape, NONE).hide, "And then the window.");
}

#[test]
fn without_a_journal_nothing_is_created_and_it_says_so() {
    let mut form = Form::at(None, Language::De, d("2026-11-18"), 600);
    form.shown();
    open(&mut form);
    type_in(&mut form, "Test");
    form.key(Key::Enter, SHIFT);
    assert_eq!(form.view().status.map(|(_, error)| error), Some(true));
}

#[test]
fn lengths_and_clock_times_are_read_as_written() {
    assert_eq!(parse_clock("1430", false), Some(870));
    assert_eq!(parse_clock("930", false), Some(570));
    assert_eq!(parse_clock("24:00", true), Some(1440));
    assert_eq!(parse_clock("24:00", false), None);
    assert_eq!(parse_length("1,5h"), Some(90));
    assert_eq!(parse_length("1 Std. 30 Min."), Some(90));
    assert_eq!(parse_length("2 days"), Some(2880));
    assert_eq!(parse_length("bald"), None);
    let ft = form_texts(Language::De);
    assert_eq!((length_text(45, ft), length_text(90, ft), length_text(2880, ft)), ("45 Min.".into(), "1 Std. 30 Min.".into(), "2 Tage".into()));
}

#[test]
fn the_day_view_shows_today_follows_the_calendar_and_comes_back_after_the_form() {
    let mut t = test();
    // Something today, something tomorrow, and the app's rating for tomorrow.
    type_in(&mut t.form, "Einkaufen");
    t.form.key(Key::Enter, SHIFT);
    type_in(&mut t.form, "Zahnarzt morgen 14-15");
    t.form.key(Key::Digit(2), ALT);
    t.form.key(Key::Enter, SHIFT);
    // Only in the calendar: not in the day view.
    type_in(&mut t.form, "Nur Kalender morgen 16-17");
    t.form.key(Key::Enter, SHIFT);
    t.form.journal.as_ref().unwrap().store.save_period_data(&serde_json::json!({ "definitions": [], "days": { "2026-11-19": { "rating": 8, "items": {} } }, "notes": {} }).to_string()).unwrap();
    let journal = t.form.journal.as_ref().unwrap();
    t.form.snapshot.as_mut().unwrap().reload(&journal.store).unwrap();
    // Esc on the empty form: the day view is back, with today.
    t.form.key(Key::Escape, NONE);
    let view = t.form.view();
    assert!(!view.entry_open);
    assert_eq!((view.day.date, view.day.relative.as_str()), (d("2026-11-18"), "Heute"));
    let entries = |view: &View| view.day.rows.iter().filter(|row| row.kind == day_view::RowKind::Entry).map(|row| row.label.clone()).collect::<Vec<_>>();
    assert_eq!(entries(&view), ["Einkaufen"]);
    assert!(view.calendar.layout.bands.iter().all(|band| !band.selected), "Today is not marked twice.");
    // Alt+→: tomorrow, marked in the calendar, with its own rating; Alt+← back, Alt+H today.
    t.form.key(Key::Right, ALT);
    let view = t.form.view();
    assert_eq!((view.day.date, view.day.relative.as_str()), (d("2026-11-19"), "Morgen"));
    assert_eq!(entries(&view), ["Zahnarzt"]);
    assert_eq!(view.day.rows.iter().find(|row| row.kind == day_view::RowKind::Dials).unwrap().dials[0].value, "8");
    assert!(view.calendar.layout.bands.iter().any(|band| band.selected && band.date == d("2026-11-19")));
    t.form.key(Key::Right, ALT);
    t.form.key(Key::Left, ALT);
    assert_eq!(t.form.day_shown(), d("2026-11-19"));
    t.form.key(Key::Home, ALT);
    assert_eq!(t.form.day_shown(), d("2026-11-18"));
    assert_eq!(t.form.key(Key::Home, ALT), Effect::default(), "Alt+H leaves the search bar and the window as they are.");
    // The middle button on a day in the calendar shows that day; opening days stays with the left button.
    let layout = t.form.view().calendar.layout;
    let y = |day| layout.rows.iter().find(|row| row.date == d(day)).unwrap().y + 2.0;
    let opened = t.form.opened().clone();
    t.form.cal_mouse(2, 0, 30.0, y("2026-11-20"), false);
    assert_eq!(t.form.day_shown(), d("2026-11-20"));
    assert_eq!(t.form.opened(), &opened, "The middle button does not open or close days.");
    assert!(!t.form.view().entry_open, "Nor does it open the form.");
    // The form uses the same space; the chosen day stays for when it closes, but is not marked meanwhile.
    open(&mut t.form);
    assert!(t.form.view().calendar.layout.bands.iter().all(|band| !band.selected));
    t.form.key(Key::Escape, NONE);
    assert_eq!(t.form.view().day.date, d("2026-11-20"));
    // Shown anew, the window is about today again; nothing was written meanwhile.
    t.form.shown();
    assert_eq!(t.form.view().day.date, d("2026-11-18"));
    assert_eq!((day(&t, "2026-11-18").len(), day(&t, "2026-11-19").len(), day(&t, "2026-11-20").len()), (1, 2, 0));
}

#[test]
fn the_day_view_reads_days_beyond_the_warm_stretch_and_works_without_a_journal() {
    let mut t = test();
    t.form.key(Key::Escape, NONE);
    {
        let store = &mut t.form.journal.as_mut().unwrap().store;
        let mut far = store.load("2028-03-01").unwrap();
        far.entries.push(serde_json::from_value(serde_json::json!({ "id": uuid::Uuid::new_v4().to_string(), "kind": "note", "text": "Weit weg", "done": false, "cancelled": false })).unwrap());
        store.save(far).unwrap();
    }
    t.form.show_day(d("2028-03-01"));
    let view = t.form.view();
    assert!(view.day.rows.iter().any(|row| row.label == "Weit weg"), "The days are read when the view goes there.");
    assert_eq!(view.day.heading, "Mittwoch, 1. März 2028");
    let mut alone = Form::at(None, Language::En, d("2026-11-18"), 600);
    alone.shown();
    let view = alone.view();
    assert_eq!((view.day.heading.as_str(), view.day.relative.as_str()), ("Wednesday, November 18, 2026", "Today"));
    assert_eq!(view.day.rows[2].kind, day_view::RowKind::Empty);
}
