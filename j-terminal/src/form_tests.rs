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

/// Tab until the field has the keyboard (the description, reminder and icon are taken directly, as with a click).
fn go(form: &mut Form, field: Field) {
    if !form.visible(field) { form.click_field(field.index()); }
    let back = field.index() < form.field().index();
    for _ in 0..20 { if form.field() == field { return; } form.key(Key::Tab, if back { SHIFT } else { NONE }); }
    panic!("{field:?} not reached");
}
fn type_in(form: &mut Form, text: &str) { form.edited(text); }

#[test]
fn search_filters_follow_shared_tag_order_and_replace_only_the_active_token() {
    let mut t = test();
    t.form.close_entry();
    let db = &mut t.form.journal.as_mut().unwrap().store;
    let mail = crate::texts::search::MAIL_IDS[0];
    let mut tags = db.tags().unwrap();
    tags.push(Tag { id: mail.into(), name: "Lieferung".into(), color: "#aaaaaa".into(), icon: None });
    db.save_tags(&tags).unwrap();
    db.save_period_data(&serde_json::json!({"definitions":[{"id":"work","calendarTagId":WORK}]}).to_string()).unwrap();
    t.form.snapshot.as_mut().unwrap().reload(db).unwrap();
    t.form.search_edited("\\");
    assert_eq!(t.form.commands()[0].name, "Gesundheit");
    let journal_app = Store::open(&t.path).unwrap();
    journal_app.conn.execute("INSERT INTO settings(key,value) VALUES('tag-kind-order',?1)", [r#"["mail","activity","own"]"#]).unwrap();
    t.form.set_clock(d("2026-11-18"), 800);
    assert_eq!(t.form.commands().iter().map(|r| (r.name.as_str(),r.detail.as_str())).collect::<Vec<_>>(),
        [("Lieferung","E-Mail"),("Arbeit","Checkliste"),("Gesundheit","Eigene")]);
    t.form.search_at("Brief @pi \\Arbeit", "Brief @pi".len());
    assert_eq!(t.form.commands().len(), 4);
    t.form.key(Key::Down, NONE);
    let effect = t.form.key(Key::Tab, NONE);
    assert_eq!(effect.search.as_deref(), Some("Brief @Pinnwand/Zettel \\Arbeit"));
    t.form.search_edited("@");
    assert_eq!(t.form.commands().len(), 10);
}

#[test]
fn search_finds_linked_pages_and_opens_an_unpinned_attachment_at_its_note() {
    let mut t = test();
    t.form.close_entry();
    let store = &t.form.journal.as_ref().unwrap().store;
    let [root, page, link] = std::array::from_fn::<_, 3, _>(|_| uuid::Uuid::new_v4().to_string());
    for card in [
        serde_json::json!({"id":root,"kind":"note","title":"Projekt","boards":{"year:2026":{},"month:2026-09":{},"month:2026-11":{}},"links":[page]}),
        serde_json::json!({"id":page,"kind":"note","title":"Kapitel","links":[root,link]}),
        serde_json::json!({"id":link,"kind":"link","title":"Quelle","url":"https://example.org","links":[page]}),
    ] {
        store.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2)",
            rusqlite::params![format!("board:card:{}", card["id"].as_str().unwrap()), card.to_string()]).unwrap();
    }
    let hits = notebook::search_cards(store, &[], &[], &[]).unwrap();
    let find = |name| hits.iter().find(|hit| hit.title == name).unwrap();
    assert_eq!(find("Projekt").date, Some(d("2026-11-01")));
    assert_eq!(find("Kapitel").kind, "notebook");
    assert_eq!((find("Quelle").kind, find("Quelle").id.to_string(), find("Quelle").open_attachment), ("board-link", page, false));
    t.form.search_edited("@Pinnwand/Link Quelle");
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.notepad().unwrap().title(), "Kapitel");
}

#[test]
fn planning_space_adds_visited_days_and_confirms_a_range_without_the_source() {
    let mut t = test();
    t.form.run(ActionId::Plan, None);
    let key = |f: &mut Form, k| f.key(k, NONE);
    key(&mut t.form, Key::Space);
    key(&mut t.form, Key::Space); // OS repeat
    key(&mut t.form, Key::Right);
    t.form.release_plan_space();
    key(&mut t.form, Key::Right);
    assert_eq!(t.form.v.plan_days, [d("2026-11-19"),d("2026-11-20")].into());
    for _ in 0..4 { t.form.key(Key::Left, SHIFT); }
    assert!(t.form.month_panel().unwrap().cells.iter().any(|c| c.pending && c.date == d("2026-11-17")));
    key(&mut t.form, Key::Space);
    assert_eq!(t.form.v.plan_days, [d("2026-11-17"),d("2026-11-19"),d("2026-11-20"),d("2026-11-21")].into());
    t.form.pick_month_date(d("2026-11-18"));
    assert!(t.form.month_panel().unwrap().cells.iter().any(|c| c.disabled && !c.picked && c.date == d("2026-11-18")));
}

#[test]
fn planning_space_fills_and_clears_week_jumps_and_shift_ranges() {
    let mut t = test();
    t.form.run(ActionId::Plan, None);
    t.form.key(Key::Space, NONE);
    t.form.key(Key::Up, NONE);
    t.form.release_plan_space();
    let week = d("2026-11-12").iter_days().take(8).filter(|date| *date != t.form.today).collect();
    assert_eq!(t.form.v.plan_days, week);
    t.form.key(Key::Space, NONE);
    t.form.key(Key::Down, NONE);
    t.form.release_plan_space();
    assert!(t.form.v.plan_days.is_empty());
    for direction in [Key::Up, Key::Down] {
        t.form.key(direction, SHIFT);
        t.form.key(Key::Space, NONE);
        t.form.release_plan_space();
        if direction == Key::Up { assert_eq!(t.form.v.plan_days, week); }
    }
    assert!(t.form.v.plan_days.is_empty());
}

#[test]
fn search_edit_and_plan_retain_the_entry_and_detect_a_stale_edit() {
    let mut t = test();
    type_in(&mut t.form, "Projekt \\Arbeit");
    assert!(!t.form.key(Key::Enter, CTRL).hide_soon);
    let id = day(&t, "2026-11-18")[0].id.clone();
    t.form.search_edited("Projekt @Note ");
    assert!(t.form.commands().is_empty());
    t.form.search_edited("Projekt @Aufgabe \\Arbeit ");
    assert_eq!(t.form.commands().len(), 1);
    t.form.choose_command(0);
    type_in(&mut t.form, "Projekt morgen");
    go(&mut t.form, Field::Plan);
    type_in(&mut t.form, "19.11.2026, 21.11.2026");
    assert!(!t.form.key(Key::Enter, CTRL).hide_soon);
    let source = day(&t, "2026-11-18");
    assert_eq!(source.len(), 1);
    assert_eq!(source[0].id, id);
    assert_eq!(source[0].plan.as_ref().unwrap().targets.len(), 2);
    assert_eq!(day(&t, "2026-11-21")[0].text, "Projekt morgen");
    t.form.search_edited("Projekt @Task ");
    assert_eq!(t.form.commands().len(), 2);
    t.form.choose_command(0);
    let store = &mut t.form.journal.as_mut().unwrap().store;
    let mut changed = store.load("2026-11-21").unwrap();
    changed.entries[0].text = "Extern geändert".into();
    store.save(changed).unwrap();
    type_in(&mut t.form, "Konflikt");
    assert!(!t.form.key(Key::Enter, CTRL).hide_soon);
    assert_eq!(day(&t, "2026-11-21")[0].text, "Extern geändert");
    assert_eq!(t.form.title(), "Konflikt");
}

#[test]
fn planning_a_new_task_with_the_month_picker_can_be_cancelled_and_saved() {
    let mut t = test();
    t.form.edited("Einkaufen");
    t.form.run(ActionId::Plan, None);
    t.form.pick_month_date(d("2026-11-20"));
    t.form.key(Key::Escape, NONE);
    assert!(t.form.v.plan_days.is_empty());
    t.form.run(ActionId::Plan, None);
    t.form.key(Key::Space, NONE);
    t.form.pick_month_date(d("2026-11-21"));
    assert_eq!(t.form.month_panel().unwrap().cells.iter().filter(|c| c.picked).count(), 2);
    t.form.key(Key::Enter, NONE);
    assert!(!t.form.key(Key::Enter, CTRL).hide_soon);
    assert_eq!(day(&t, "2026-11-19")[0].origin.as_deref(), Some("2026-11-18"));
    assert_eq!(day(&t, "2026-11-21")[0].text, "Einkaufen");
}

#[test]
fn editing_a_series_occurrence_preserves_its_day_status_and_series() {
    let mut t = test();
    type_in(&mut t.form, "Sport jeden Mo bis 7.12.");
    assert!(!t.form.key(Key::Enter, CTRL).hide_soon);
    let store = &mut t.form.journal.as_mut().unwrap().store;
    let mut occurrence = store.load("2026-11-30").unwrap();
    occurrence.entries[0].done = true;
    store.save(occurrence).unwrap();
    let before = day(&t, "2026-11-30").remove(0);
    t.form.search_edited("Sport");
    let index = t.form.commands().iter().position(|hit| matches!(&hit.action, CommandAction::Hit(date, _) if *date == d("2026-11-30"))).unwrap();
    t.form.choose_command(index);
    type_in(&mut t.form, "Training");
    assert!(!t.form.key(Key::Enter, CTRL).hide_soon);
    let after = day(&t, "2026-11-30").remove(0);
    assert_eq!(after.text, "Training");
    assert!(after.done && after.plan.is_none());
    assert_eq!(after.id, before.id);
    assert_eq!(after.repeat.unwrap().series, before.repeat.unwrap().series);
}

#[test]
fn opening_and_title_preferences_preserve_the_selected_day_and_a_literal_draft() {
    let mut t = test();
    t.form.close_entry();
    t.form.preferences.start_view = crate::settings::StartView::Entry;
    t.form.preferences.return_today = false;
    t.form.preferences.parse_titles = false;
    let chosen = d("2026-11-24");
    t.form.show_day(chosen);
    assert!(matches!(t.form.shown().focus, Some(Pane::Entry)));
    assert_eq!(t.form.day_shown(), chosen);
    type_in(&mut t.form, "Plan morgen 14:00");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.title(), "Plan morgen 14:00");
    assert!(t.form.v.days.is_empty() && t.form.v.start.is_none());
    t.form.preferences.start_view = crate::settings::StartView::Day;
    t.form.preferences.return_today = true;
    t.form.shown();
    assert!(t.form.entry_shown());
    assert_eq!(t.form.title(), "Plan morgen 14:00");
    assert_eq!(t.form.day_shown(), t.form.today);
}

#[test]
fn starting_another_note_preserves_the_unsaved_draft() {
    let mut t = test();
    t.form.new_notepad_note();
    let first = t.form.notepad().unwrap().card.id;
    t.form.edit_notepad(true, "Entwurf behalten");
    t.form.new_notepad_note();
    assert_ne!(t.form.notepad().unwrap().card.id, first);
    assert_eq!(t.form.notepad().unwrap().body(), "");
    t.form.finish_notepad(false);
    assert_eq!(t.form.notepad().unwrap().card.id, first);
    assert_eq!(t.form.notepad().unwrap().body(), "Entwurf behalten");
}

#[test]
fn notebook_defaults_apply_on_open_and_leave_the_current_session_in_control() {
    let mut t = test();
    t.form.close_entry();
    t.form.preferences.edit_notes = true;
    t.form.open_notepad();
    assert!(t.form.notepad().unwrap().notes_on_day);
    t.form.set_notepad_day_filter(false);
    t.form.new_notepad_note();
    let id = t.form.notepad().unwrap().card.id.to_string();
    t.form.notepad.as_mut().unwrap().edit(false, "Testnotiz");
    t.form.finish_notepad(true);
    t.form.notepad_panel(1);
    t.form.pick_notepad(&id);
    let note = t.form.notepad().unwrap();
    assert!(note.editing && !note.preview && !note.notes_on_day);
    assert_eq!(note.title(), "Testnotiz");
}

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
    let mut observer = Store::open(&t.path).unwrap();
    let mut journal_day = observer.load("2026-11-19").unwrap();
    journal_day.title = "Tagestitel".into();
    journal_day.body = "Vorhandener Freitext".into();
    observer.save(journal_day).unwrap();
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
    let id = t.form.notepad().unwrap().card.id;
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
    let journal_day = observer.load("2026-11-19").unwrap();
    assert_eq!((journal_day.title.as_str(), journal_day.body.as_str()), ("Tagestitel", "Vorhandener Freitext"));
    let attachment = read(format!("board:card:{}", card["links"][0].as_str().unwrap()));
    assert_eq!(attachment["kind"], "link");
    assert_eq!(attachment["url"], "https://example.org/journal");
    assert_eq!(attachment["links"], serde_json::json!([id.to_string()]));

    t.form.finish_notepad(false);
    t.form.finish_notepad(false);
    t.form.open_notepad();
    assert!(t.form.notepad().unwrap().notes_on_day);
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
    t.form.open_notepad();
    t.form.new_notepad_note();
    t.form.attach_notepad(notebook::Attachment::image(&source));
    let note = t.form.notepad().unwrap().card.id;
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
    t.form.open_notepad();
    assert!(t.form.notepad().unwrap().notes_on_day);
    t.form.set_notepad_day_filter(false);
    let tree = t.form.notepad_choices("");
    assert_eq!(tree.iter().map(|row| (row.title.as_str(), row.depth, row.folder)).collect::<Vec<_>>(),
        [("Projekt", 0, true), ("Notizen", 1, true), ("Angepinnt", 2, false), ("Gestern", 1, false), ("Lose", 0, false)], "All notes: the folders as a tree.");
    t.form.set_notepad_day_filter(true);
    let rows = t.form.notepad_choices("");
    assert_eq!(rows.iter().map(|row| (row.title.as_str(), row.group.as_str())).collect::<Vec<_>>(),
        [("Lose", "Ohne Ordner"), ("Angepinnt", "Projekt / Notizen")]);
    t.form.pick_notepad(&rows[0].key);
    if !t.form.notepad().unwrap().editing { t.form.notepad_preview(); }
    t.form.run(ActionId::NotesFolder, None);
    let choices = t.form.notepad_choices("Projekt / Notizen");
    assert_eq!(choices.len(), 1);
    assert_eq!(choices[0].key, child);
    t.form.pick_notepad(&child);
    t.form.finish_notepad(true);
    assert_eq!(t.form.notepad().unwrap().card.original.as_ref().unwrap()["folder"], child);
    t.form.notepad_preview();
    t.form.notepad_panel(4);
    t.form.pick_notepad("");
    t.form.finish_notepad(true);
    assert!(t.form.notepad().unwrap().card.original.as_ref().unwrap()["folder"].is_null());
}

#[test]
fn journal_text_command_is_unavailable_in_both_languages() {
    let mut t = test();
    t.form.close_entry();
    for (language, command) in [(Language::De, "/Journaltext"), (Language::En, "/JournalText")] {
        t.form.language = language;
        t.form.search_edited("/");
        assert!(t.form.view().commands.iter().all(|item| item.name != command));
        t.form.search_edited(command);
        assert!(t.form.view().commands.is_empty());
        t.form.key(Key::Enter, NONE);
        assert!(t.form.notepad().is_none());
    }
}

#[test]
fn notepad_reports_conflicting_card_edits_and_keeps_the_draft() {
    let mut t = test();
    t.form.close_entry();
    t.form.open_notepad();
    t.form.new_notepad_note();
    t.form.edit_notepad(true, "Original");
    let id = t.form.notepad().unwrap().card.id;
    t.form.finish_notepad(true);
    t.form.notepad_preview();
    t.form.edit_notepad(true, "Mein Entwurf");

    let other = Store::open(&t.path).unwrap();
    let key = format!("board:card:{id}");
    other.conn.execute("UPDATE settings SET value=json_set(value, '$.text', ?1) WHERE key=?2",
        ["In der Haupt-App", &key]).unwrap();
    t.form.finish_notepad(true);
    assert_eq!(t.form.view().status, Some((notepad_texts(Language::De).conflict.into(), true)));
    assert_eq!(t.form.notepad().unwrap().body(), "Mein Entwurf");
    t.form.key(Key::Escape, NONE);
    assert_eq!(t.form.notepad().unwrap().body(), "Mein Entwurf");
    t.form.key(Key::Escape, NONE);
    let reader = t.form.notepad().unwrap();
    assert!(!reader.editing && reader.preview);
    assert_eq!(reader.body(), "In der Haupt-App");
}

#[test]
fn closing_an_unchanged_notepad_does_not_create_an_empty_day() {
    let mut t = test();
    t.form.close_entry();
    t.form.show_day(d("2026-11-20"));
    t.form.open_notepad();
    t.form.new_notepad_note();
    assert!(!t.form.notepad().unwrap().can_save());
    t.form.finish_notepad(false);
    t.form.finish_notepad(false);
    assert!(t.form.notepad().is_none());
    let store = &t.form.journal.as_ref().unwrap().store;
    assert_eq!(store.load("2026-11-20").unwrap().revision, 0);
    assert!(notebook::notes(store, "", None).is_ok_and(|notes| notes.is_empty()));
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
    assert!(!t.form.key(Key::Enter, CTRL).hide_soon, "Strg+Enter creates and keeps the window open.");
    let entries = day(&t, "2026-11-18");
    assert_eq!((entries[0].kind.as_str(), entries[0].text.as_str(), entries[0].show_in_journal), ("task", "Einkaufen", true));
}

#[test]
fn tab_always_goes_to_the_next_field() {
    let mut t = test();
    let mut seen = vec![t.form.field()];
    for _ in 0..7 { t.form.key(Key::Tab, NONE); seen.push(t.form.field()); }
    assert_eq!(seen, [Field::Title, Field::Day, Field::Start, Field::Repeat, Field::Tag, Field::Reminder, Field::Icon, Field::Icon],
        "No end without a start; a new entry always shows its reminder and icon, the icon is the last.");
    t.form.key(Key::Tab, SHIFT);
    assert_eq!(t.form.field(), Field::Reminder, "Shift+Tab goes back.");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::Icon);
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
    let later = saved.blocks.iter().max_by(|a, b| a.y.total_cmp(&b.y)).unwrap();
    let opened = t.form.cal_mouse(0, 0, later.x + later.w / 2.0, later.y + later.h / 2.0, false);
    assert_eq!(opened.focus, Some(Pane::Entry));
    let (date, entry) = t.form.editing.as_ref().unwrap();
    assert_eq!((*date, entry.text.as_str()), (d("2026-11-18"), "Projekt"));
    t.form.close_entry();
    open(&mut t.form);
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
fn the_extras_come_with_their_keys_and_every_field_reaches_the_journal() {
    let mut t = test();
    type_in(&mut t.form, "Bericht");
    assert!(t.form.view().rows.iter().all(|r| r.field != Field::Description.index()), "Not a line while empty.");
    go(&mut t.form, Field::Day); type_in(&mut t.form, "morgen");
    go(&mut t.form, Field::Start); type_in(&mut t.form, "9");
    go(&mut t.form, Field::End); type_in(&mut t.form, "10");
    go(&mut t.form, Field::Tag); type_in(&mut t.form, "arb");
    t.form.key(Key::Extra(Field::Description), ALT);
    assert_eq!(t.form.field(), Field::Description, "Alt+B goes into the description.");
    type_in(&mut t.form, "Zahlen von Q3");
    t.form.key(Key::Priority, ALT);
    assert!(t.form.view().priority, "Alt+P sets the flag.");
    t.form.key(Key::Extra(Field::Reminder), ALT); type_in(&mut t.form, "45");
    assert_eq!(t.form.field(), Field::Reminder);
    t.form.key(Key::Extra(Field::Icon), ALT); type_in(&mut t.form, "bell-ring");
    assert!(t.form.view().rows.iter().any(|r| r.field == Field::Description.index()), "A filled extra keeps its line.");
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
    assert_eq!(choices.len(), 3, "Typing filters; no tag is called so: the last line makes one.");
    t.form.choice_click(1);
    t.form.key(Key::Enter, NONE);
    assert_eq!((t.form.field(), value(&mut t.form, Field::Tag)), (Field::Reminder, "Arbeit".to_string()), "Enter takes it and goes on to the reminder.");
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
    assert_eq!(lines.len(), 1, "Without a rule, one row of rhythms.");
    assert!(!t.form.view().editable, "The keys belong to the options.");
    for _ in 0..3 { t.form.key(Key::Right, NONE); }
    assert_eq!(t.form.v.rule.as_ref().map(|r| r.unit), Some(repeat::Unit::Week));
    let fresh = |form: &mut Form| { let layout = form.view().calendar.layout; layout.blocks.iter().filter(|b| b.fresh).count() + layout.chips.iter().filter(|c| c.fresh).count() };
    let weekly = fresh(&mut t.form);
    for _ in 0..3 { t.form.key(Key::Down, NONE); }
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
    t.form.key(Key::Delete, NONE);
    assert!(t.form.v.rule.is_none());
}

#[test]
fn the_repeat_month_picker_confirms_only_valid_dates_and_escape_keeps_the_rule() {
    let mut t = test();
    go(&mut t.form, Field::Repeat);
    t.form.key(Key::Enter, NONE);
    t.form.key(Key::Digit(5), NONE);
    let date_part = |form: &mut Form, label: &str| {
        let Panel::Repeat(lines) = form.view().panel else { panic!("the repetition's lines") };
        lines.into_iter().find(|line| line.label == label).unwrap().parts.pop().unwrap()
    };
    let start = date_part(&mut t.form, "Ab");
    t.form.repeat_click(start.slot, start.value);
    assert!(t.form.month_picker_open());
    t.form.key(Key::PageDown, NONE);
    t.form.key(Key::Right, NONE);
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.v.rule.as_ref().unwrap().start, d("2026-12-19"));
    assert!(!t.form.month_picker_open());

    let until = date_part(&mut t.form, "Bis");
    t.form.repeat_click(until.slot, until.value);
    t.form.key(Key::Home, NONE);
    let panel = t.form.view().side.unwrap();
    assert!(panel.cells.iter().any(|cell| cell.date == d("2026-12-18") && cell.disabled));
    t.form.pick_month_date(d("2026-12-18"));
    assert!(t.form.month_picker_open());
    t.form.key(Key::Escape, NONE);
    assert!(t.form.v.rule.as_ref().unwrap().end.is_none());
    t.form.key(Key::Space, NONE);
    assert!(t.form.month_picker_open(), "Escape returns focus to the end date.");
    t.form.pick_month_date(d("2026-12-20"));
    assert_eq!(t.form.v.rule.as_ref().unwrap().end.unwrap().until, Some(d("2026-12-20")));
}

#[test]
fn problems_are_shown_at_their_field() {
    let mut t = test();
    assert!(t.form.view().status.is_none(), "An empty title is no problem until creating is tried.");
    go(&mut t.form, Field::Tag);
    t.form.key(Key::Enter, CTRL);
    assert_eq!(t.form.field(), Field::Title, "The missing title is where the cursor goes.");
    assert!(t.form.view().title_error, "The title in the top line is marked.");
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
fn search_actions_choose_a_day_focus_its_values_and_use_shared_history() {
    let mut t = test();
    type_in(&mut t.form, "Probe");
    t.form.key(Key::Enter, CTRL);
    let date = d("2026-11-18");

    t.form.search_edited("/Undo");
    assert_eq!(t.form.key(Key::Enter, NONE).search.as_deref(), Some(""));
    assert!(t.form.journal.as_ref().unwrap().store.load(&date.to_string()).unwrap().entries.is_empty());
    t.form.search_edited("/Wiederherstellen");
    t.form.choose_command(0);
    assert_eq!(t.form.journal.as_ref().unwrap().store.load(&date.to_string()).unwrap().entries[0].text, "Probe");

    t.form.search_edited("/Tag");
    t.form.key(Key::Enter, NONE);
    assert!(t.form.day_picker_open());
    t.form.key(Key::Right, NONE);
    t.form.key(Key::Escape, NONE);
    assert_eq!(t.form.day_shown(), date);
    t.form.search_edited("/Day");
    t.form.choose_command(0);
    t.form.key(Key::Right, NONE);
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.day_shown(), d("2026-11-19"));
    assert!(!t.form.view().entry_open);

    t.form.search_edited("/Rating");
    assert_eq!(t.form.key(Key::Enter, NONE).focus, Some(Pane::Day));
    assert_eq!(t.form.pane.cursor, Some(day_view::Item::Value("rating".into())));
    t.form.search_edited("/Aktivitäten");
    assert_eq!(t.form.choose_command(0).focus, Some(Pane::Search));
    assert_eq!(t.form.pane.message.as_ref().unwrap().0, "Keine Aktivitäten für diesen Tag");

    let db = &mut t.form.journal.as_mut().unwrap().store;
    db.save_period_data(r#"{"definitions":[{"id":"walk","name":"Spaziergang"}]}"#).unwrap();
    t.form.snapshot.as_mut().unwrap().reload(db).unwrap();
    t.form.search_edited("/Activities");
    assert_eq!(t.form.key(Key::Enter, NONE).focus, Some(Pane::Day));
    assert_eq!(t.form.pane.cursor, Some(day_view::Item::Activity("walk".into())));
    t.form.search_edited("/Heute");
    t.form.choose_command(0);
    assert_eq!(t.form.day_shown(), date);
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
    assert_eq!((view.day.date, view.day.relative.as_str()), (d("2026-11-19"), "in 1 d"));
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

#[test]
fn a_new_entry_shows_its_reminder_and_icon_at_once() {
    let mut t = test();
    let fields: Vec<usize> = t.form.view().rows.iter().map(|r| r.field).collect();
    assert!(fields.contains(&Field::Reminder.index()) && fields.contains(&Field::Icon.index()), "Reminder and icon without Strg+K.");
    assert!(!fields.contains(&Field::Description.index()), "The description still waits for Alt+B.");
}

#[test]
fn a_template_is_written_with_its_command_and_opened_with_its_name() {
    let mut t = test();
    t.form.close_entry();
    t.form.search_edited("/vorlage Geburtstag");
    let commands = t.form.commands();
    assert_eq!((commands[0].name.as_str(), commands[0].detail.as_str()), ("/Vorlage Geburtstag", "Neue Vorlage anlegen"));
    t.form.key(Key::Enter, NONE);
    let view = t.form.view();
    assert!(view.entry_open);
    assert!(view.search_placeholder.contains("#Geburtstag"), "The search bar names the template.");
    assert!(!view.rows.iter().any(|r| r.field == Field::Day.index()), "A template has no day.");
    assert_eq!(row(&mut t.form, Field::Start).label, "Wann");
    type_in(&mut t.form, "... hat Geburtstag");
    t.form.set_type(Type::Event);
    t.form.v.icon = Some("cake".into());
    t.form.v.reminder = Some(1440);
    t.form.v.rule = Some(Rule::new(d("2026-11-18"), crate::repeat::Unit::Year, 1));
    let effect = t.form.key(Key::Enter, CTRL);
    assert_eq!(effect.focus, Some(Pane::Search));
    assert!(!t.form.view().entry_open);
    assert!(day(&t, "2026-11-18").is_empty(), "A template is no entry.");
    assert_eq!(t.form.templates.find("geburtstag").unwrap().title, "... hat Geburtstag");

    // `#` finds it and opens a new entry on the day shown, its gap selected.
    t.form.show_day(d("2026-11-25"));
    t.form.search_edited("#geb");
    let commands = t.form.commands();
    assert_eq!((commands[0].name.as_str(), commands[0].detail.as_str()), ("#Geburtstag", "... hat Geburtstag"));
    let effect = t.form.key(Key::Enter, NONE);
    assert_eq!((t.form.field(), effect.select), (Field::Title, Some((0, 3))), "Typing fills the gap.");
    assert!(t.form.view().rows.iter().any(|r| r.field == Field::Day.index()));
    type_in(&mut t.form, "Anna hat Geburtstag");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::Day, "No gap left: Tab goes on.");
    t.form.key(Key::Enter, CTRL);
    let entries = day(&t, "2026-11-25");
    assert_eq!((entries[0].kind.as_str(), entries[0].text.as_str(), entries[0].icon.as_deref(), entries[0].reminder_before),
        ("event", "Anna hat Geburtstag", Some("cake"), 1440));
    assert!(entries[0].repeat.is_some(), "Every year from the day it was made on.");

    // `/Vorlage ` lists it to change; Strg+K deletes it there.
    t.form.search_edited("/vorlage ");
    let commands = t.form.commands();
    assert_eq!((commands[0].name.as_str(), commands[0].detail.as_str()), ("/Vorlage Geburtstag", "Vorlage bearbeiten"));
    t.form.key(Key::Enter, NONE);
    assert_eq!(t.form.title(), "... hat Geburtstag");
    t.form.run(ActionId::TemplateDelete, None);
    assert!(t.form.templates.find("Geburtstag").is_none());
    t.form.search_edited("#");
    assert!(t.form.commands().is_empty());
    t.form.key(Key::Enter, NONE);
    assert!(t.form.view().status.unwrap().0.contains("/Vorlage"), "With none there, it says how to make one.");
}

#[test]
fn tab_goes_through_the_gaps_of_a_template_title_and_open_ones_fall_out() {
    let mut t = test();
    t.form.close_entry();
    t.form.templates.put(crate::templates::Template { name: "Vorlesung".into(), kind: "calendar".into(), title: "Vorlesung ... bei ... Uni".into(),
        start: Some(600), end: Some(690), ..Default::default() }).unwrap();
    t.form.search_edited("#Vorlesung");
    let effect = t.form.key(Key::Enter, NONE);
    assert_eq!(effect.select, Some((10, 13)));
    type_in(&mut t.form, "Vorlesung Analysis bei ... Uni");
    let effect = t.form.key(Key::Tab, NONE);
    assert_eq!((t.form.field(), effect.select), (Field::Title, Some((23, 26))), "Tab: the next gap.");
    t.form.key(Key::Tab, NONE);
    assert_eq!(t.form.field(), Field::Day, "After the last gap Tab goes on.");
    t.form.key(Key::Enter, CTRL);
    let entries = day(&t, "2026-11-18");
    assert_eq!((entries[0].text.as_str(), entries[0].time.as_deref(), entries[0].end.as_deref()), ("Vorlesung Analysis bei Uni", Some("10:00"), Some("11:30")));
}
#[test]
fn an_entry_from_a_template_repeats_from_the_day_chosen_not_the_day_it_was_made() {
    let mut t = test();
    t.form.close_entry();
    t.form.templates.put(crate::templates::Template { name: "Geburtstag".into(), kind: "event".into(), title: "... hat Geburtstag".into(),
        repeat: Some(Rule::new(d("2026-11-18"), crate::repeat::Unit::Year, 1)), ..Default::default() }).unwrap();
    t.form.search_edited("#Geburtstag");
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "Anna hat Geburtstag");
    t.form.key(Key::Tab, NONE);
    type_in(&mut t.form, "03.03.2027");
    t.form.key(Key::Enter, CTRL);
    let entries = day(&t, "2027-03-03");
    assert_eq!(entries[0].text, "Anna hat Geburtstag");
    assert!(entries[0].repeat.is_some());
    assert!(day(&t, "2027-11-18").is_empty(), "Not on the day the template was made.");
    assert_eq!(day(&t, "2028-03-03")[0].text, "Anna hat Geburtstag", "Every year on that day.");
    // An earlier day than the template's too.
    t.form.search_edited("#Geburtstag");
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "Ben hat Geburtstag");
    t.form.key(Key::Tab, NONE);
    type_in(&mut t.form, "10.11.2026");
    t.form.key(Key::Enter, CTRL);
    assert_eq!(day(&t, "2026-11-10")[0].text, "Ben hat Geburtstag");
    assert_eq!(day(&t, "2027-11-10")[0].text, "Ben hat Geburtstag");
}
#[test]
fn alt_h_returns_to_today_and_resets_the_calendar_also_in_the_form() {
    let mut t = test();
    t.form.show_day(d("2026-12-24"));
    t.form.cal_top = d("2027-03-01");
    t.form.cal_offset = 7.0;
    t.form.zoom_days = 2.0;
    type_in(&mut t.form, "Bleibt");
    t.form.key(Key::Home, ALT);
    assert_eq!(t.form.day_shown(), d("2026-11-18"));
    assert_eq!((t.form.cal_top, t.form.cal_offset, t.form.zoom_days), (d("2026-11-17"), 0.0, 1.0));
    assert_eq!(t.form.title(), "Bleibt", "What is being written stays.");
    // From the search bar too.
    t.form.close_entry();
    t.form.show_day(d("2026-12-24"));
    t.form.cal_top = d("2027-03-01");
    t.form.search_edited("");
    t.form.key(Key::Home, ALT);
    assert_eq!((t.form.day_shown(), t.form.cal_top), (d("2026-11-18"), d("2026-11-17")));
}
#[test]
fn a_tag_typed_in_the_form_is_made_and_the_tag_editor_opens_on_it() {
    let mut t = test();
    go(&mut t.form, Field::Tag);
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "Sport");
    let Panel::Tags(choices) = t.form.view().panel else { panic!() };
    assert_eq!((choices.len(), choices[1].label.as_str(), choices[1].selected), (2, "Tag „Sport“ anlegen", true));
    assert!(t.form.view().status.is_none(), "No error: the tag can be made.");
    let effect = t.form.key(Key::Enter, NONE);
    let tags = t.form.journal.as_ref().unwrap().store.tags().unwrap();
    let sport = tags.iter().find(|tag| tag.name == "Sport").unwrap();
    assert_eq!((effect.edit_tag.as_deref(), t.form.v.tag.as_deref()), (Some(sport.id.as_str()), Some(sport.id.as_str())));
    assert_eq!(sport.color, crate::tag_edit::next_color(&tags[..2]));
    assert_eq!(value(&mut t.form, Field::Tag), "Sport");
    // Esc in the tag editor does not keep it: the tag goes again and the form has none.
    let sport_id = sport.id.clone();
    crate::tag_edit::delete(&mut t.form.journal.as_mut().unwrap().store, &sport_id).unwrap();
    t.form.forget_tag(&sport_id);
    t.form.reload_tags();
    assert!(!t.form.journal.as_ref().unwrap().store.tags().unwrap().iter().any(|tag| tag.id == sport_id));
    assert_eq!(t.form.v.tag, None);
    // Made again, as Enter in the editor keeps it.
    go(&mut t.form, Field::Tag);
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "Sport");
    t.form.key(Key::Enter, NONE);
    assert!(t.form.journal.as_ref().unwrap().store.tags().unwrap().iter().any(|tag| tag.name == "Sport"));
    // A name there already makes nothing.
    go(&mut t.form, Field::Tag);
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "arbeit");
    let Panel::Tags(choices) = t.form.view().panel else { panic!() };
    assert!(!choices.iter().any(|c| c.label.contains("anlegen")));
}

#[test]
fn the_notepad_makes_a_tag_and_a_folder_from_what_is_typed() {
    let mut t = test();
    t.form.close_entry();
    t.form.search_edited("/Notizblock");
    t.form.key(Key::Enter, NONE);
    t.form.new_notepad_note();
    t.form.edit_notepad(false, "Planung");
    t.form.notepad_panel(2);
    let last = t.form.notepad_choices("Garten").pop().unwrap();
    assert_eq!((last.key.as_str(), last.title.as_str()), ("new-tag:Garten", "Tag „Garten“ anlegen"));
    t.form.pick_notepad(&last.key);
    let tags = t.form.journal.as_ref().unwrap().store.tags().unwrap();
    let garden = tags.iter().find(|tag| tag.name == "Garten").unwrap().id.clone();
    assert_eq!(t.form.notepad().unwrap().card.tag.as_deref(), Some(garden.as_str()));
    assert_eq!(t.form.take_tag_edit(), Some(garden));
    assert_eq!(t.form.take_tag_edit(), None);
    t.form.notepad_panel(4);
    let last = t.form.notepad_choices("Projekte").pop().unwrap();
    assert_eq!((last.key.as_str(), last.title.as_str()), ("new-folder:Projekte", "Ordner „Projekte“ anlegen"));
    t.form.pick_notepad(&last.key);
    let folders = notebook::folders(&t.form.journal.as_ref().unwrap().store).unwrap();
    assert_eq!(folders.iter().map(|(_, path)| path.as_str()).collect::<Vec<_>>(), ["Projekte"]);
    assert_eq!(t.form.notepad().unwrap().card.folder.as_deref(), Some(folders[0].0.as_str()));
    t.form.notepad_panel(4);
    assert!(!t.form.notepad_choices("projekte").iter().any(|c| c.key.starts_with("new-folder:")), "There already.");
    let folder: serde_json::Value = serde_json::from_str(&t.form.journal.as_ref().unwrap().store.conn.query_row(
        "SELECT value FROM settings WHERE key=?1", [format!("board:folder:{}", folders[0].0)], |r| r.get::<_, String>(0)).unwrap()).unwrap();
    assert_eq!((folder["parent"].clone(), folder["order"].clone()), (serde_json::Value::Null, serde_json::json!(0)), "As the app makes it.");
}
#[test]
fn the_notepad_list_walks_the_tree_makes_folders_and_moves_notes_and_folders() {
    use serde_json::json;
    let mut t = test();
    t.form.close_entry();
    let note = uuid::Uuid::new_v4();
    {
        let store = &t.form.journal.as_ref().unwrap().store;
        let card = json!({"id": note.to_string(), "kind":"note", "title":"Skript", "dates":[], "created":"2026-11-18", "notebook":true});
        store.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2)", rusqlite::params![format!("board:card:{note}"), card.to_string()]).unwrap();
    }
    t.form.open_notepad();
    t.form.set_notepad_day_filter(false);
    let titles = |t: &mut Test| t.form.notepad_choices("").iter().map(|r| format!("{}{}{}", "  ".repeat(r.depth), r.title, if r.selected { " <" } else { "" })).collect::<Vec<_>>();
    assert_eq!(titles(&mut t), ["Skript <"]);
    // Strg+K: a new folder at the top; its name is typed, Enter makes it.
    t.form.toggle_menu();
    t.form.run(ActionId::FolderNew, None);
    assert_eq!(t.form.notes_list_mode(), 3);
    assert_eq!(t.form.notes_list_hint().unwrap().0, "Neuer Ordner");
    t.form.notepad_choices("Uni");
    let out = t.form.notes_list_key("enter");
    assert_eq!(out.query.as_deref(), Some(""), "The input is cleared.");
    assert_eq!(titles(&mut t), ["Uni <", "Skript"], "The cursor on the new folder.");
    // On the folder: a subfolder.
    t.form.run(ActionId::FolderSub, None);
    assert_eq!(t.form.notes_list_hint().unwrap().0, "Neuer Ordner in „Uni“");
    t.form.notepad_choices("Analysis");
    t.form.notes_list_key("enter");
    assert_eq!(titles(&mut t), ["Uni", "  Analysis <", "Skript"]);
    // The note, moved with the actions: the places to go, typed to filter, Enter.
    t.form.notes_list_key("down");
    assert_eq!(titles(&mut t)[2], "Skript <", "↓ walks the tree.");
    t.form.notes_list_menu(&note.to_string());
    let labels: Vec<String> = t.form.menu_items().1.iter().map(|item| item.label.clone()).collect();
    assert!(labels.contains(&"Verschieben nach …".to_string()) && labels.contains(&"Neuer Ordner".to_string()), "{labels:?}");
    assert!(!labels.contains(&"Unterordner anlegen".to_string()), "A note has no subfolders.");
    t.form.run(ActionId::ListMove, None);
    assert_eq!(t.form.notes_list_hint().unwrap().0, "„Skript“ verschieben nach …");
    let places: Vec<String> = t.form.notepad_choices("ana").iter().map(|r| r.title.clone()).collect();
    assert_eq!(places, ["Uni / Analysis"]);
    t.form.notes_list_key("enter");
    assert_eq!(titles(&mut t), ["Uni", "  Analysis", "    Skript <"]);
    // ← to its folder, ← closes it, → opens it again.
    t.form.notes_list_key("left");
    t.form.notes_list_key("left");
    assert_eq!(titles(&mut t), ["Uni", "  Analysis <"]);
    t.form.notes_list_key("right");
    assert_eq!(titles(&mut t).len(), 3);
    // A folder cannot go into one inside it: Uni dropped on Analysis stays where it is.
    let rows = t.form.notepad_choices("");
    t.form.notes_list_drop(&rows[0].key, 1);
    assert_eq!(titles(&mut t), ["Uni <", "  Analysis", "    Skript"]);
    // Analysis renamed, then dragged out of Uni onto the note's line… which is inside it: nothing. Its folder out by the actions.
    t.form.notes_list_menu(&rows[1].key);
    t.form.run(ActionId::FolderRename, None);
    assert_eq!(t.form.take_notes_query().as_deref(), Some("Analysis"), "The name to change is in the input.");
    t.form.notepad_choices("Mathe");
    t.form.notes_list_key("enter");
    t.form.run(ActionId::ListMove, None);
    let places = t.form.notepad_choices("");
    assert_eq!(places.iter().map(|r| (r.title.as_str(), r.detail.as_str())).collect::<Vec<_>>(), [("Ohne Ordner", ""), ("Uni", "Aktuell")], "Not into itself; where it is now is marked.");
    t.form.notes_list_key("escape");
    // The note dragged onto Uni.
    let rows = t.form.notepad_choices("");
    let skript = rows.iter().position(|r| r.title == "Skript").unwrap();
    t.form.notes_list_drop(&rows[skript].key, 0);
    assert_eq!(titles(&mut t), ["Uni", "  Mathe", "  Skript <"]);
    let card = notebook::Card::open(&t.form.journal.as_ref().unwrap().store, note).unwrap();
    let folders = notebook::folder_list(&t.form.journal.as_ref().unwrap().store).unwrap();
    assert_eq!(card.folder.as_deref(), folders.iter().find(|f| f.name == "Uni").map(|f| f.id.as_str()));
    assert_eq!(folders.iter().find(|f| f.name == "Mathe").unwrap().parent.as_deref(), card.folder.as_deref());
    // Enter on a folder closes it; Enter on a note opens it.
    t.form.notes_list_key("home");
    t.form.notes_list_key("enter");
    assert_eq!(titles(&mut t), ["Uni <"]);
    t.form.notes_list_key("enter");
    t.form.notes_list_key("down");
    t.form.notes_list_key("down");
    t.form.notes_list_key("enter");
    assert_eq!(t.form.notepad().unwrap().title(), "Skript");
}
#[test]
fn an_entry_opened_in_the_form_is_deleted_with_the_choice_of_its_series() {
    let mut t = test();
    type_in(&mut t.form, "Kurs");
    t.form.v.rule = Some(Rule::new(d("2026-11-18"), crate::repeat::Unit::Week, 1));
    t.form.key(Key::Enter, CTRL);
    let id = day(&t, "2026-11-25")[0].id.clone();
    t.form.edit_hit(d("2026-11-25"), &id);
    assert!(t.form.editing_entry());
    t.form.toggle_menu();
    let labels: Vec<String> = t.form.menu_items().1.iter().map(|item| item.label.clone()).collect();
    // The ways to delete are the last lines, the smallest at the very bottom: ↑ from the first line reaches it.
    let deletes: Vec<&str> = labels.iter().map(String::as_str).filter(|label| label.ends_with("löschen")).collect();
    assert_eq!(deletes.last(), Some(&"Nur diesen löschen"), "{labels:?}");
    assert!(deletes[0].starts_with("Alle") && labels.ends_with(&deletes.iter().map(|s| s.to_string()).collect::<Vec<_>>()), "{labels:?}");
    t.form.menu_key(Key::Up);
    assert_eq!(t.form.menu_view().unwrap().pick, labels.len() - 1);
    t.form.close_menu();
    // The delete key (Alt+Entf) still asks which ones.
    let effect = t.form.key(Key::Delete, ALT);
    assert!(!t.form.view().entry_open, "The form closes; its day shows.");
    assert_eq!(t.form.day_shown(), d("2026-11-25"));
    let side = t.form.view().side.unwrap();
    let scopes: Vec<String> = side.rows.iter().map(|row| row.label.clone()).collect();
    assert_eq!((side.kind, scopes.first().map(String::as_str)), (7, Some("Nur diesen")), "{scopes:?}");
    assert!(scopes.last().unwrap().starts_with("Alle"));
    assert_eq!(effect.focus, Some(Pane::Day));
    let all = scopes.len() - 1;
    t.form.with_pane(|pane, cx| pane.choose(cx, all));
    for date in ["2026-11-18", "2026-11-25", "2026-12-02"] { assert!(day(&t, date).is_empty(), "{date}"); }
    // A single entry goes at once.
    t.form.search_edited("/entry");
    t.form.key(Key::Enter, NONE);
    type_in(&mut t.form, "Einmal");
    t.form.key(Key::Enter, CTRL);
    let id = day(&t, "2026-11-18")[0].id.clone();
    t.form.edit_hit(d("2026-11-18"), &id);
    t.form.run(ActionId::EntryDelete, None);
    assert!(day(&t, "2026-11-18").is_empty());
}

#[test]
fn notes_are_deleted_after_asking_and_folders_hand_their_contents_up() {
    use serde_json::json;
    let mut t = test();
    t.form.close_entry();
    let (note, other) = (uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    let (top, inner) = (uuid::Uuid::new_v4().to_string(), uuid::Uuid::new_v4().to_string());
    {
        let store = &t.form.journal.as_ref().unwrap().store;
        let put = |key: String, value: serde_json::Value| { store.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2)", rusqlite::params![key, value.to_string()]).unwrap(); };
        put(format!("board:folder:{top}"), json!({"id": top, "name": "Oben", "parent": null, "order": 0}));
        put(format!("board:folder:{inner}"), json!({"id": inner, "name": "Innen", "parent": top, "order": 0}));
        put(format!("board:card:{note}"), json!({"id": note.to_string(), "kind":"note", "title":"Weg", "dates":[], "created":"2026-11-18", "notebook":true, "folder": inner}));
        put(format!("board:card:{other}"), json!({"id": other.to_string(), "kind":"note", "title":"Bleibt", "dates":[], "created":"2026-11-18", "notebook":true, "folder": top, "links": [note.to_string()]}));
    }
    t.form.open_notepad();
    t.form.set_notepad_day_filter(false);
    let titles = |t: &mut Test| t.form.notepad_choices("").iter().map(|r| format!("{}{}", "  ".repeat(r.depth), r.title)).collect::<Vec<_>>();
    assert_eq!(titles(&mut t), ["Oben", "  Innen", "    Weg", "  Bleibt"]);
    // Entf on a note asks first; Esc keeps it.
    t.form.notepad_choices("");
    for _ in 0..2 { t.form.notes_list_key("down"); }
    t.form.notes_list_key("delete");
    assert_eq!(t.form.notes_list_hint().unwrap().0, "Zettel endgültig löschen?");
    assert_eq!(titles(&mut t), ["„Weg“ endgültig löschen (auch von der Pinnwand)", "Abbrechen"]);
    t.form.notes_list_key("escape");
    assert_eq!(titles(&mut t).len(), 4);
    // Strg+K → delete, Enter on the first line.
    t.form.toggle_menu();
    assert!(t.form.menu_items().1.iter().any(|item| item.id == ActionId::NoteDelete && item.danger));
    t.form.run(ActionId::NoteDelete, None);
    t.form.notes_list_key("enter");
    assert_eq!(titles(&mut t), ["Oben", "  Innen", "  Bleibt"]);
    let store = &t.form.journal.as_ref().unwrap().store;
    assert!(notebook::Card::open(store, note).is_err(), "Gone.");
    assert_eq!(notebook::Card::open(store, other).unwrap().original.unwrap()["links"], json!([]), "No link to it is left.");
    // The folder Oben goes: Innen and Bleibt move up.
    t.form.notes_list_key("home");
    t.form.toggle_menu();
    t.form.run(ActionId::FolderDelete, None);
    assert_eq!(titles(&mut t), ["Innen", "Bleibt"]);
    assert!(crate::save::step(&mut t.form.journal.as_mut().unwrap().store, false).unwrap(), "Strg+Z brings it back.");
    assert_eq!(titles(&mut t), ["Oben", "  Innen", "  Bleibt"]);
}

#[test]
fn the_note_open_in_the_notepad_can_be_deleted_from_its_actions() {
    let mut t = test();
    t.form.close_entry();
    t.form.search_edited("/Notizblock");
    t.form.key(Key::Enter, NONE);
    t.form.new_notepad_note();
    t.form.edit_notepad(false, "Kurz");
    t.form.finish_notepad(true);
    let id = t.form.notepad().unwrap().card.id;
    t.form.toggle_menu();
    assert!(t.form.menu_items().1.iter().any(|item| item.id == ActionId::NoteDelete));
    t.form.run(ActionId::NoteDelete, None);
    assert_eq!(t.form.notepad().unwrap().panel, 1, "Back to the list, asked there.");
    t.form.notes_list_key("enter");
    assert!(notebook::Card::open(&t.form.journal.as_ref().unwrap().store, id).is_err());
}
#[test]
fn the_ways_to_delete_a_series_are_lines_of_the_actions_and_take_effect_at_once() {
    let mut t = test();
    type_in(&mut t.form, "Kurs");
    t.form.v.rule = Some(Rule::new(d("2026-11-18"), crate::repeat::Unit::Week, 1));
    t.form.key(Key::Enter, CTRL);
    t.form.close_entry();
    t.form.show_day(d("2026-11-25"));
    let id = day(&t, "2026-11-25")[0].id.clone();
    t.form.pane.cursor = Some(crate::day_view::Item::Entry(id.clone()));
    t.form.toggle_menu();
    let items = t.form.menu_items().1;
    let last = items.last().unwrap();
    assert_eq!((last.label.as_str(), last.danger, last.section), ("Nur diesen löschen", true, 2));
    assert!(!items.iter().any(|item| item.id == ActionId::Entry(day_pane::Action::Delete)), "No single line that asks.");
    let at = items.len() - 1;
    t.form.menu_choose(at);
    assert!(day(&t, "2026-11-25").is_empty(), "Only this one, without asking.");
    assert_eq!((day(&t, "2026-11-18").len(), day(&t, "2026-12-02").len()), (1, 1));
}
#[test]
fn strg_k_while_writing_a_new_entry_writes_it_and_opens_its_actions() {
    let mut t = test();
    t.form.close_entry();
    t.form.create_in_day(1);
    assert!(t.form.pane.edit.is_some(), "The footer's task icon starts a new task.");
    t.form.with_pane(|pane, _| pane.edited("Brief schreiben"));
    t.form.toggle_menu();
    assert_eq!(day(&t, "2026-11-18")[0].text, "Brief schreiben", "Written without Esc or Enter.");
    let (title, items) = t.form.menu_items();
    assert_eq!(title, "Brief schreiben", "The actions are about it.");
    assert!(items.iter().any(|item| item.id == ActionId::Entry(day_pane::Action::Tag)));
}