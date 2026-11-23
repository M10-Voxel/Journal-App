//! Every text J-TerminaL shows, German first with the English beside it. The language follows the Journal app's
//! setting (`ui-language`); keywords typed into the line work in both languages regardless (docs/plan.md, 1.4).

pub mod settings;
pub mod search;
pub mod board;
pub mod templates;
pub mod tags;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language { De, En }

impl Language {
    /// The app stores `de` or `en`; anything else falls back to German, as in the app.
    pub fn from_setting(value: &str) -> Self {
        if value.trim().eq_ignore_ascii_case("en") { Language::En } else { Language::De }
    }
}

pub struct Texts {
    pub kw_start: &'static str,
    pub unclear: &'static str,
    pub months: [&'static str; 12],
    pub week_short: &'static str,
    pub no_vault: &'static str,
    /// Followed by the vault's folder.
    pub unreachable: &'static str,
    pub too_new: &'static str,
    /// Followed by the reason.
    pub open_failed: &'static str,
    /// Followed by the reason.
    pub alternate_hotkey: &'static str,
    pub hotkey_failed: &'static str,
    pub today: &'static str,
    pub tomorrow: &'static str,
    pub after_tomorrow: &'static str,
    pub saved: &'static str,
    pub undone: &'static str,
    pub nothing_to_undo: &'static str,
    pub unknown_tag: &'static str,
    pub note_time: &'static str,
    pub note_repeat: &'static str,
    pub no_days: &'static str,
    pub save_failed: &'static str,
    pub read_only: &'static str,
    pub until_day: &'static str,
}

const DE: Texts = Texts {
    kw_start: "ab", 
    unclear: "Bitte vervollständigen oder korrigieren:",
    week_short: "KW",
    months: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
    no_vault: "Journal-Datenordner nicht verfügbar oder Vault-Wechsel ausstehend.",
    unreachable: "Journal nicht erreichbar:",
    too_new: "Das Journal ist neuer als J-TerminaL. Bitte J-TerminaL aktualisieren.",
    open_failed: "Journal konnte nicht geöffnet werden:",
    alternate_hotkey: "Globales Ersatzkürzel:",
    hotkey_failed: "Kein globales Kürzel verfügbar. In F1 ein anderes wählen.",
    today: "heute",
    tomorrow: "morgen",
    after_tomorrow: "übermorgen",
    saved: "Gespeichert",
    undone: "Zurückgenommen",
    nothing_to_undo: "Nichts rückgängig zu machen",
    unknown_tag: "Unbekannter Tag:",
    note_time: "Notizen haben keine Uhrzeit.",
    note_repeat: "Notizen wiederholen sich nicht.",
    no_days: "Die Wiederholung hat keinen Tag.",
    save_failed: "Nicht gespeichert:",
    read_only: "Nur lesen: das Journal ist nicht offen.",
    until_day: "bis",
    
    
    
};

const EN: Texts = Texts {
    kw_start: "starting", 
    unclear: "Please complete or correct:",
    week_short: "CW",
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    no_vault: "Journal data folder unavailable or vault switch pending.",
    unreachable: "Journal not reachable:",
    too_new: "The journal is newer than J-TerminaL. Please update J-TerminaL.",
    open_failed: "The journal could not be opened:",
    alternate_hotkey: "Alternate global shortcut:",
    hotkey_failed: "No global shortcut available. Choose another in F1.",
    today: "today",
    tomorrow: "tomorrow",
    after_tomorrow: "day after tomorrow",
    saved: "Saved",
    undone: "Taken back",
    nothing_to_undo: "Nothing to undo",
    unknown_tag: "Unknown tag:",
    note_time: "Notes have no time.",
    note_repeat: "Notes do not repeat.",
    no_days: "The repetition has no day.",
    save_failed: "Not saved:",
    read_only: "Read only: the journal is not open.",
    until_day: "until",
    
    
    
};

pub fn texts(language: Language) -> &'static Texts {
    match language { Language::De => &DE, Language::En => &EN }
}

pub struct ShortcutTexts {
    pub settings: &'static str,
    pub search: &'static str,
    pub empty: &'static str,
    pub record: &'static str,
    pub reset: &'static str,
    pub change: &'static str,
    pub reserved: &'static str,
    pub conflict: &'static str,
    pub persist_error: &'static str,
    /// Own keys left out on loading (now taken): followed by the actions' names.
    pub reset_taken: &'static str,
    pub system_error: &'static str,
}

pub fn shortcut_labels(language: Language) -> ShortcutTexts {
    match language {
        Language::De => ShortcutTexts {
            settings: "Einstellungen", search: "Einstellungen suchen …",
            empty: "Keine passenden Einstellungen",
            record: "Neues Kürzel drücken. Esc bricht ab.",
            reset: "Auf Standard zurücksetzen", change: "Tastenkürzel ändern",
            reserved: "Wähle eine Funktionstaste oder eine Kombination mit Strg oder Alt.",
            conflict: "Dieses Kürzel ist bereits belegt für",
            persist_error: "Tastenkürzel konnten nicht gespeichert werden.",
            reset_taken: "Eigenes Kürzel ist jetzt belegt, zurückgesetzt:",
            system_error: "Das globale Kürzel ist im System nicht verfügbar.",
        },
        Language::En => ShortcutTexts {
            settings: "Settings", search: "Search settings…",
            empty: "No matching settings",
            record: "Press the new shortcut. Esc cancels.",
            reset: "Restore default", change: "Change shortcut",
            reserved: "Choose a function key or a combination with Ctrl or Alt.",
            conflict: "This shortcut is already assigned to",
            persist_error: "The shortcuts could not be saved.",
            reset_taken: "Own shortcut is taken now and was reset:",
            system_error: "The system shortcut is unavailable.",
        },
    }
}

pub struct NotepadTexts {
    pub command: &'static str,
    pub heading: &'static str,
    pub command_detail: &'static str,
    pub untitled: &'static str,
    pub browse_empty: &'static str,
    pub filter_notes: &'static str,
    pub choose_tag: &'static str,
    pub choose_folder: &'static str,
    pub current_folder: &'static str,
    pub no_tag: &'static str,
    pub attachments: &'static str,
    pub filter_attachments: &'static str,
    pub attachments_empty: &'static str,
    pub image: &'static str,
    pub link: &'static str,
    pub preview: &'static str,
    pub dirty_switch: &'static str,
    pub invalid_link: &'static str,
    pub too_large: &'static str,
    pub note_title: &'static str,
    pub note_body: &'static str,
    pub pinned: &'static str,
    pub unfiled: &'static str,
    pub all_notes: &'static str,
    pub day_notes: &'static str,
    pub copy_code: &'static str,
    pub image_loading_preview: &'static str,
    pub image_unavailable: &'static str,
    pub new_note: &'static str,
    pub edit_note: &'static str,
    pub edit_heading: &'static str,
    pub save_note: &'static str,
    pub back: &'static str,
    pub exit: &'static str,
    pub source: &'static str,
    pub add_link: &'static str,
    pub image_loading: &'static str,
    pub discard: &'static str,
    pub conflict: &'static str,
    pub saved: &'static str,
}

pub fn notepad_texts(language: Language) -> &'static NotepadTexts {
    match language {
        Language::De => &NotepadTexts {
            command: "/Notizblock",
            heading: "Notizblock",
            command_detail: "Zettel erstellen und bearbeiten",
            untitled: "Neue Notiz",
            browse_empty: "Keine Zettel gefunden",
            filter_notes: "Zettel suchen …",
            choose_tag: "Tag zuweisen",
            choose_folder: "Ordner zuweisen",
            current_folder: "Aktuell",
            no_tag: "Ohne Tag",
            attachments: "Anhänge",
            filter_attachments: "Anhänge suchen …",
            attachments_empty: "Keine Anhänge",
            image: "Bild anhängen",
            link: "Link anhängen",
            preview: "Markdown-Vorschau",
            dirty_switch: "Speichere oder verwerfe zuerst den aktuellen Entwurf.",
            invalid_link: "Bitte eine gültige Webadresse eingeben.",
            too_large: "Die Notiz oder das Bild ist zu groß.",
            note_title: "Titel der Notiz",
            note_body: "Notiztext (Markdown)",
            pinned: "Tagespinnwand",
            unfiled: "Ohne Ordner",
            all_notes: "Alle Zettel",
            day_notes: "An diesem Tag",
            copy_code: "Code kopieren",
            image_loading_preview: "Bild wird geladen …",
            image_unavailable: "Bildvorschau nicht verfügbar",
            new_note: "Neue Notiz",
            edit_note: "Bearbeiten",
            edit_heading: "Notiz bearbeiten",
            save_note: "Speichern",
            back: "Zurück",
            exit: "Schließen",
            source: "Zum Text",
            add_link: "Link hinzufügen",
            image_loading: "Bild wird vorbereitet …",
            discard: "Ungespeicherte Änderungen. Drücke Esc oder die gleiche Schaltfläche erneut, um sie zu verwerfen.",
            conflict: "Dasselbe Feld wurde inzwischen geändert. Dein Entwurf bleibt geöffnet. Kopiere deinen Text, bevor du den Notizblock neu öffnest.",
            saved: "Gespeichert",
        },
        Language::En => &NotepadTexts {
            command: "/Notepad",
            heading: "Notepad",
            command_detail: "Create and edit notebook cards",
            untitled: "New note",
            browse_empty: "No notes found",
            filter_notes: "Search notes …",
            choose_tag: "Assign tag",
            choose_folder: "Assign folder",
            current_folder: "Current",
            no_tag: "No tag",
            attachments: "Attachments",
            filter_attachments: "Search attachments …",
            attachments_empty: "No attachments",
            image: "Attach image",
            link: "Attach link",
            preview: "Markdown preview",
            dirty_switch: "Save or discard the current draft first.",
            invalid_link: "Enter a valid web address.",
            too_large: "The note or image is too large.",
            note_title: "Note title",
            note_body: "Note text (Markdown)",
            pinned: "Day pinboard",
            unfiled: "Unfiled",
            all_notes: "All notes",
            day_notes: "On this day",
            copy_code: "Copy code",
            image_loading_preview: "Loading image …",
            image_unavailable: "Image preview unavailable",
            new_note: "New note",
            edit_note: "Edit",
            edit_heading: "Edit note",
            save_note: "Save",
            back: "Back",
            exit: "Close",
            source: "Back to text",
            add_link: "Add link",
            image_loading: "Preparing the image …",
            discard: "Unsaved changes. Press Esc or click the same button again to discard them.",
            conflict: "The same field changed elsewhere. Your draft is still open. Copy your text before reopening the notepad.",
            saved: "Saved",
        },
    }
}

/// The form's own words: the lines, the empty states, the choices under a line, the keys shown while Strg is held.
pub struct FormTexts {
    /// The four types, as the app has them: calendar only, event (in the journal too), task, note.
    pub types: [&'static str; 4],
    /// Line labels: type, title, when, repetition, tag, more, description, important, reminder, icon.
    pub labels: [&'static str; 11],
    /// What an empty title, date, start, end, repetition, tag, description, reminder and icon show, pale.
    pub empty_title: &'static str,
    pub empty_day: &'static str,
    pub empty_start: &'static str,
    pub empty_end: &'static str,
    pub empty_repeat: &'static str,
    pub empty_tag: &'static str,
    pub empty_description: &'static str,
    pub empty_reminder: &'static str,
    pub empty_icon: &'static str,
    pub priority_on: &'static str,
    pub priority_off: &'static str,
    pub no_tag: &'static str,
    pub no_icons: &'static str,
    /// Reminders ready to choose; the rest is typed ("45", "2 h", "1 Tag").
    pub reminder_presets: [&'static str; 11],
    /// "%s vorher" for a typed reminder.
    pub reminder_before: &'static str,
    pub reminder_at_time: &'static str,
    pub minutes: &'static str,
    pub hours: &'static str,
    pub day: &'static str,
    pub days: &'static str,
    pub bad_time: &'static str,
    pub bad_end: &'static str,
    pub bad_day: &'static str,
    pub bad_repeat: &'static str,
    pub bad_icon: &'static str,
    pub bad_tag: &'static str,
    pub bad_reminder: &'static str,
    pub title_needed: &'static str,
    pub clock_start: &'static str,
    pub clock_end: &'static str,
    pub cal_day: &'static str,
    pub cal_moment: &'static str,
    pub cal_range: &'static str,
    pub search: &'static str,
    pub no_hits: &'static str,
    pub plan_hint: &'static str,
    pub entry_changed: &'static str,
    pub finish_entry_first: &'static str,
    pub plan_single: &'static str,
    pub cmd_entry: &'static str,
    pub cmd_day: &'static str,
    pub cmd_day_detail: &'static str,
    pub cmd_unknown: &'static str,
    /// The repetition's sentence.
    pub repeat_presets: [&'static str; 6],
    pub rp_rhythm: &'static str,
    pub rp_unit: &'static str,
    pub rp_every: &'static str,
    pub rp_on_label: &'static str,
    pub rp_from: &'static str,
    pub rp_until: &'static str,
    pub rp_never: &'static str,
    pub rp_times: &'static str,
    pub rp_pause: &'static str,
    pub rp_on_word: &'static str,
    pub rp_off_word: &'static str,
    pub rp_only_in: &'static str,
}

const FORM_DE: FormTexts = FormTexts {
    types: ["Kalender", "Ereignis", "Aufgabe", "Notiz"],
    labels: ["Typ", "Titel", "Wann", "Wiederholung", "Tag", "Mehr", "Beschreibung", "Wichtig", "Erinnerung", "Symbol", "Planen auf"],
    empty_title: "Was?",
    empty_day: "Heute",
    empty_start: "ganztägig",
    empty_end: "Zeitpunkt",
    empty_repeat: "Einmalig",
    empty_tag: "Ohne Tag",
    empty_description: "Keine Beschreibung",
    empty_reminder: "Keine",
    empty_icon: "Keines",
    priority_on: "★ Wichtig",
    priority_off: "Normal",
    no_tag: "Ohne Tag",
    no_icons: "Kein Symbol mit diesem Namen",
    reminder_presets: ["Keine", "Zur Uhrzeit", "5 Min.", "10 Min.", "15 Min.", "30 Min.", "1 Std.", "2 Std.", "1 Tag", "2 Tage", "1 Woche"],
    reminder_before: "vorher",
    reminder_at_time: "Zur Uhrzeit",
    minutes: "Min.",
    hours: "Std.",
    day: "Tag",
    days: "Tage",
    bad_time: "Uhrzeit nicht verstanden (z. B. 14, 1430, 14:30, 2pm)",
    bad_end: "Ende nicht verstanden (z. B. 15:30, +45, +1,5h) – oder leer lassen für einen Zeitpunkt",
    bad_day: "Tag nicht verstanden (z. B. morgen, Mi, 19.11., Mo–Fr)",
    bad_repeat: "Wiederholung nicht verstanden (z. B. jede Woche)",
    bad_icon: "Kein Symbol mit diesem Namen",
    bad_tag: "Diesen Tag gibt es nicht",
    bad_reminder: "Erinnerung nicht verstanden (z. B. 45, 2 h, 1 Tag; höchstens 30 Tage)",
    title_needed: "Der Titel fehlt",
    search: "Suchen oder / für Befehle",
    no_hits: "Keine Treffer",
    plan_hint: "Zieltage, z. B. morgen, Freitag",
    entry_changed: "Der Eintrag wurde zwischenzeitlich geändert oder entfernt.",
    finish_entry_first: "Zuerst den offenen Eintrag speichern oder verwerfen.",
    plan_single: "Für weitere Tage die Zieltage unter „Planen auf“ angeben.",
    cmd_entry: "Neuen Eintrag anlegen",
    cmd_day: "Tag", cmd_day_detail: "Tag auswählen",
    cmd_unknown: "Unbekannter Befehl:",
    repeat_presets: ["D", "M-F", "W", "2W", "M", "Y"],
    rp_every: "Alle",
    rp_from: "Ab",
    rp_until: "Bis",
    rp_never: "nie",
    rp_times: "mal",
    rp_pause: "Pause",
    rp_on_word: "an",
    rp_off_word: "aus",
    rp_only_in: "Nur in",
    clock_start: "Beginn",
    clock_end: "Ende",
    cal_day: "Ganzer Tag",
    cal_moment: "Zeitpunkt",
    cal_range: "Bereich",
    rp_rhythm: "Rhythmus",
    rp_unit: "Einheit",
    rp_on_label: "Am",
};

const FORM_EN: FormTexts = FormTexts {
    types: ["Calendar", "Event", "Task", "Note"],
    labels: ["Type", "Title", "When", "Repeat", "Tag", "More", "Description", "Important", "Reminder", "Icon", "Plan for"],
    empty_title: "What?",
    empty_day: "Today",
    empty_start: "all day",
    empty_end: "point in time",
    empty_repeat: "Once",
    empty_tag: "No tag",
    empty_description: "No description",
    empty_reminder: "None",
    empty_icon: "None",
    priority_on: "★ Important",
    priority_off: "Normal",
    no_tag: "No tag",
    no_icons: "No icon by that name",
    reminder_presets: ["None", "At the time", "5 min", "10 min", "15 min", "30 min", "1 h", "2 h", "1 day", "2 days", "1 week"],
    reminder_before: "before",
    reminder_at_time: "At the time",
    minutes: "min",
    hours: "h",
    day: "day",
    days: "days",
    bad_time: "Time not understood (e.g. 14, 1430, 14:30, 2pm)",
    bad_end: "End not understood (e.g. 15:30, +45, +1.5h) – or leave it empty for a point in time",
    bad_day: "Day not understood (e.g. tomorrow, Wed, 19.11., Mon–Fri)",
    bad_repeat: "Repetition not understood (e.g. every week)",
    bad_icon: "No icon by that name",
    bad_tag: "There is no such tag",
    bad_reminder: "Reminder not understood (e.g. 45, 2 h, 1 day; 30 days at most)",
    title_needed: "The title is missing",
    search: "Search, or / for commands",
    no_hits: "No matches",
    plan_hint: "Target dates, e.g. tomorrow, Friday",
    entry_changed: "The entry was changed or removed.",
    finish_entry_first: "Save or discard the open entry first.",
    plan_single: "Enter additional target dates under “Plan for”.",
    cmd_entry: "Make a new entry",
    cmd_day: "Day", cmd_day_detail: "Choose a day",
    cmd_unknown: "Unknown command:",
    repeat_presets: ["D", "M-F", "W", "2W", "M", "Y"],
    rp_every: "Every",
    rp_from: "From",
    rp_until: "Until",
    rp_never: "never",
    rp_times: "times",
    rp_pause: "Pause",
    rp_on_word: "on",
    rp_off_word: "off",
    rp_only_in: "Only in",
    clock_start: "Start",
    clock_end: "End",
    cal_day: "Whole day",
    cal_moment: "Point in time",
    cal_range: "Range",
    rp_rhythm: "Rhythm",
    rp_unit: "Unit",
    rp_on_label: "On",
};

pub fn form_texts(language: Language) -> &'static FormTexts {
    match language { Language::De => &FORM_DE, Language::En => &FORM_EN }
}

/// The day view's words (docs/plan.md, 0c).
pub struct DayTexts {
    /// Monday first.
    pub weekdays: [&'static str; 7],
    pub today: &'static str,
    /// `%d` is the number of days.
    pub in_days: &'static str,
    pub days_ago: &'static str,
    pub minutes: &'static str,
    pub hours: &'static str,
    pub untitled: &'static str,
    pub nothing: &'static str,
    pub events: &'static str,
    pub tasks: &'static str,
    /// `%o` open, `%d` done.
    pub entries: &'static str,
    pub tasks_count: &'static str,
    pub notes: &'static str,
    /// A trace planned to several days: `%d` days.
    pub planned_days: &'static str,
    pub values: &'static str,
    pub rating: &'static str,
    pub activities: &'static str,
    pub no_activities: &'static str,
    /// Under the date of another day than today (click or Alt+H).
    /// Shown while Strg is held.
    pub title_placeholder: &'static str,
    pub take: &'static str,
    pub foreign: &'static str,
    pub cannot_plan: &'static str,
    pub timer_description: &'static str,
    pub activity_fallback: &'static str,
    pub kind: &'static str,
    pub kind_event: &'static str,
    pub kind_task: &'static str,
    pub kind_note: &'static str,
    pub status: &'static str,
    pub status_open: &'static str,
    pub status_done: &'static str,
    pub status_cancelled: &'static str,
    pub priority: &'static str,
    pub tag: &'static str,
    pub time: &'static str,
    pub reminder: &'static str,
    pub icon: &'static str,
    pub description: &'static str,
    pub description_placeholder: &'static str,
    pub icon_search: &'static str,
    pub tag_search: &'static str,
    pub tomorrow_action: &'static str,
    pub plan: &'static str,
    pub plan_on: &'static str,
    pub plan_on_days: &'static str,
    pub jump: &'static str,
    pub delete: &'static str,
}

const DAY_DE: DayTexts = DayTexts {
    weekdays: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
    today: "Heute",
    in_days: "in %d d",
    days_ago: "vor %d d",
    minutes: "Min.",
    hours: "Std.",
    untitled: "ohne Text",
    nothing: "Ein neuer Tag. Platz für deine Gedanken.",
    events: "Termine",
    tasks: "Aufgaben",
    entries: "Einträge",
    tasks_count: "%o offen · %d erledigt",
    notes: "Notizen",
    planned_days: "→ %d Tage",
    values: "Werte",
    rating: "Bewertung",
    activities: "Aktivitäten",
    no_activities: "Keine Aktivitäten für diesen Tag",
    title_placeholder: "Gib deinem Tag einen Namen …",
    take: "Übernehmen",
    foreign: "Dieser Eintrag beginnt an einem früheren Tag und wird dort geändert.",
    cannot_plan: "Dieser Eintrag lässt sich nicht planen.",
    timer_description: "Checklisten-Zeit",
    activity_fallback: "Aktivität",
    kind: "Typ",
    kind_event: "Ereignis",
    kind_task: "Aufgabe",
    kind_note: "Notiz",
    status: "Status",
    status_open: "Offen",
    status_done: "Erledigt",
    status_cancelled: "Abgebrochen",
    priority: "Wichtig",
    tag: "Tag",
    time: "Uhrzeit",
    reminder: "Erinnerung",
    icon: "Symbol",
    description: "Beschreibung",
    description_placeholder: "Beschreibung hinzufügen …",
    icon_search: "Symbol suchen …",
    tag_search: "Tag suchen …",
    tomorrow_action: "Auf morgen",
    plan: "Planen",
    plan_on: "Planen auf %s",
    plan_on_days: "Auf %d Tage planen",
    jump: "Zum geplanten Tag",
    delete: "Löschen",
};

const DAY_EN: DayTexts = DayTexts {
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    today: "Today",
    in_days: "in %d d",
    days_ago: "%d d ago",
    minutes: "min",
    hours: "h",
    untitled: "no text",
    nothing: "A new day. Room for your thoughts.",
    events: "Appointments",
    tasks: "Tasks",
    entries: "Entries",
    tasks_count: "%o open · %d done",
    notes: "Notes",
    planned_days: "→ %d days",
    values: "Values",
    rating: "Rating",
    activities: "Activities",
    no_activities: "No activities for this day",
    title_placeholder: "Give your day a name …",
    take: "Take",
    foreign: "This entry begins on an earlier day and is changed there.",
    cannot_plan: "This entry cannot be planned.",
    timer_description: "Checklist time",
    activity_fallback: "Activity",
    kind: "Type",
    kind_event: "Event",
    kind_task: "Task",
    kind_note: "Note",
    status: "Status",
    status_open: "Open",
    status_done: "Done",
    status_cancelled: "Cancelled",
    priority: "Important",
    tag: "Tag",
    time: "Time",
    reminder: "Reminder",
    icon: "Icon",
    description: "Description",
    description_placeholder: "Add a description …",
    icon_search: "Search icons …",
    tag_search: "Search tags …",
    tomorrow_action: "To tomorrow",
    plan: "Plan",
    plan_on: "Plan for %s",
    plan_on_days: "Plan for %d days",
    jump: "Go to the planned day",
    delete: "Delete",
};

pub fn day_texts(language: Language) -> &'static DayTexts {
    match language { Language::De => &DAY_DE, Language::En => &DAY_EN }
}

/// The actions behind Strg+K and the footer (as Raycast's action panel and action bar).
pub struct ActionTexts {
    pub menu: &'static str,
    pub actions: &'static str,
    pub search: &'static str,
    pub nothing: &'static str,
    pub section_entry: &'static str,
    pub section_general: &'static str,
    pub section_note: &'static str,
    pub new_task: &'static str,
    pub new_event: &'static str,
    pub new_note: &'static str,
    pub today: &'static str,
    pub notebook: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub settings: &'static str,
    pub save: &'static str,
    pub save_stay: &'static str,
    pub edit_save_stay: &'static str,
    pub priority: &'static str,
    pub description: &'static str,
    pub reminder: &'static str,
    pub icon: &'static str,
    pub discard: &'static str,
    pub notes_new: &'static str,
    pub notes_edit: &'static str,
    pub notes_save: &'static str,
    pub notes_preview: &'static str,
    pub notes_tag: &'static str,
    pub notes_attachments: &'static str,
    pub notes_list: &'static str,
    pub notes_close: &'static str,
    /// The footer's main action.
    pub edit: &'static str,
    pub create: &'static str,
    /// The footer's context.
    pub new_entry: &'static str,
    pub notepad: &'static str,
    pub search_title: &'static str,
}

const ACTIONS_DE: ActionTexts = ActionTexts {
    menu: "Menü",
    actions: "Aktionen", search: "Aktionen suchen …", nothing: "Keine passende Aktion",
    section_entry: "Eintrag", section_general: "Allgemein", section_note: "Notiz",
    new_task: "Neue Aufgabe", new_event: "Neues Ereignis", new_note: "Neue Notiz", today: "Zu heute", notebook: "Notizblock öffnen",
    undo: "Rückgängig", redo: "Wiederherstellen", settings: "Einstellungen",
    save: "Erstellen", save_stay: "Erstellen und weiter", edit_save_stay: "Speichern und weiter", priority: "Wichtig", description: "Beschreibung", reminder: "Erinnerung", icon: "Symbol", discard: "Verwerfen",
    notes_new: "Neue Notiz", notes_edit: "Bearbeiten", notes_save: "Speichern", notes_preview: "Vorschau umschalten", notes_tag: "Tag zuweisen",
    notes_attachments: "Anhänge", notes_list: "Zettelliste", notes_close: "Schließen",
    edit: "Bearbeiten", create: "Erstellen",
    new_entry: "Neuer Eintrag", notepad: "Notizblock", search_title: "Titel des Eintrags …",
};

const ACTIONS_EN: ActionTexts = ActionTexts {
    menu: "Menu",
    actions: "Actions", search: "Search for actions …", nothing: "No matching action",
    section_entry: "Entry", section_general: "General", section_note: "Note",
    new_task: "New task", new_event: "New event", new_note: "New note", today: "Go to today", notebook: "Open the notebook",
    undo: "Undo", redo: "Redo", settings: "Settings",
    save: "Create", save_stay: "Create and continue", edit_save_stay: "Save and continue", priority: "Important", description: "Description", reminder: "Reminder", icon: "Icon", discard: "Discard",
    notes_new: "New note", notes_edit: "Edit", notes_save: "Save", notes_preview: "Toggle preview", notes_tag: "Assign a tag",
    notes_attachments: "Attachments", notes_list: "Note list", notes_close: "Close",
    edit: "Edit", create: "Create",
    new_entry: "New entry", notepad: "Notebook", search_title: "Title of the entry …",
};

pub fn action_texts(language: Language) -> &'static ActionTexts {
    match language { Language::De => &ACTIONS_DE, Language::En => &ACTIONS_EN }
}

/// The reminder cards at the bottom right (`reminder.rs`), worded as the Journal app's.
pub struct ReminderTexts {
    pub task: &'static str,
    pub event: &'static str,
    pub again: &'static str,
    pub missed: &'static str,
    pub untitled: &'static str,
    pub weekdays: [&'static str; 7],
    pub done: &'static str,
    /// After the minutes: "10 Min. später".
    pub later: &'static str,
    pub dismiss: &'static str,
    /// `%n` is the number of further missed reminders.
    pub more_one: &'static str,
    pub more_many: &'static str,
}

const REMINDERS_DE: ReminderTexts = ReminderTexts {
    task: "Aufgabe", event: "Ereignis", again: "erneut", missed: "verpasst", untitled: "Ohne Text",
    weekdays: ["Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa.", "So."],
    done: "Erledigt", later: "Min. später", dismiss: "Ausblenden",
    more_one: "Noch %n weitere verpasste Erinnerung – im Journal an ihrem Tag.",
    more_many: "Noch %n weitere verpasste Erinnerungen – im Journal an ihren Tagen.",
};

const REMINDERS_EN: ReminderTexts = ReminderTexts {
    task: "Task", event: "Event", again: "again", missed: "missed", untitled: "No text",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    done: "Completed", later: "min later", dismiss: "Dismiss",
    more_one: "%n more missed reminder – in the journal on its day.",
    more_many: "%n more missed reminders – in the journal on their days.",
};

pub fn reminder_texts(language: Language) -> &'static ReminderTexts {
    match language { Language::De => &REMINDERS_DE, Language::En => &REMINDERS_EN }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_app_setting() {
        assert_eq!(Language::from_setting("en"), Language::En);
        assert_eq!(Language::from_setting(" EN "), Language::En);
        assert_eq!(Language::from_setting("de"), Language::De);
        assert_eq!(Language::from_setting(""), Language::De);
        assert_eq!(Language::from_setting("fr"), Language::De);
    }

    #[test]
    fn every_text_exists_in_both_languages() {
        for language in [Language::De, Language::En] {
            let t = texts(language);
            let f = form_texts(language);
            for text in [t.no_vault, t.unreachable, t.too_new, t.open_failed, t.hotkey_failed, f.title_needed, f.empty_end] {
                assert!(!text.trim().is_empty(), "{language:?}");
            }
            assert!(f.labels.iter().all(|label| !label.is_empty()));
        }
        assert_ne!(form_texts(Language::De).labels, form_texts(Language::En).labels);
        assert_ne!(texts(Language::De).no_vault, texts(Language::En).no_vault);
        let (de, en) = (day_texts(Language::De), day_texts(Language::En));
        for d in [de, en] {
            assert!(d.weekdays.iter().chain([&d.nothing, &d.events, &d.tasks, &d.notes, &d.values, &d.activities]).all(|text| !text.trim().is_empty()));
            assert!(d.in_days.contains("%d") && d.days_ago.contains("%d") && d.tasks_count.contains("%o"));
        }
        assert_ne!(de.weekdays, en.weekdays);
    }
}
