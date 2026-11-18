//! Every text J-TerminaL shows, German first with the English beside it. The language follows the Journal app's
//! setting (`ui-language`); keywords typed into the line work in both languages regardless (docs/plan.md, 1.4).

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
    no_vault: "Noch kein Journal eingerichtet. Bitte zuerst die Journal-App starten.",
    unreachable: "Journal nicht erreichbar:",
    too_new: "Das Journal ist neuer als J-TerminaL. Bitte J-TerminaL aktualisieren.",
    open_failed: "Journal konnte nicht geöffnet werden:",
    hotkey_failed: "Strg+Alt+Leertaste ist schon belegt:",
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
    no_vault: "No journal set up yet. Please start the Journal app first.",
    unreachable: "Journal not reachable:",
    too_new: "The journal is newer than J-TerminaL. Please update J-TerminaL.",
    open_failed: "The journal could not be opened:",
    hotkey_failed: "Ctrl+Alt+Space is already taken:",
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

/// The form's own words: the lines, the empty states, the choices under a line, the keys shown while Strg is held.
pub struct FormTexts {
    /// The four types, as the app has them: calendar only, event (in the journal too), task, note.
    pub types: [&'static str; 4],
    /// Line labels: type, title, when, repetition, tag, more, description, important, reminder, icon.
    pub labels: [&'static str; 10],
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
    pub more: &'static str,
    pub less: &'static str,
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
    pub hint_rows: &'static str,
    pub hint_pick: &'static str,
    pub hint_save: &'static str,
    pub hint_undo: &'static str,
    pub hint_calendar: &'static str,
    pub hint_repeat: &'static str,
    pub hint_choice: &'static str,
    pub hint_clock: &'static str,
    pub hint_calendar_days: &'static str,
    pub hint_calendar_hours: &'static str,
    pub clock_start: &'static str,
    pub clock_end: &'static str,
    pub cal_day: &'static str,
    pub cal_moment: &'static str,
    pub cal_range: &'static str,
    pub search: &'static str,
    pub cmd_entry: &'static str,
    pub cmd_unknown: &'static str,
    /// The repetition's sentence.
    pub repeat_presets: [&'static str; 7],
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
    labels: ["Typ", "Titel", "Wann", "Wiederholung", "Tag", "Mehr", "Beschreibung", "Wichtig", "Erinnerung", "Symbol"],
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
    more: "Beschreibung · Wichtig · Erinnerung · Symbol",
    less: "Weniger anzeigen",
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
    hint_rows: "↑↓ Zeile · Tab nächstes Feld · Enter Optionen des Felds · Alt+1–4 Typ",
    hint_pick: "In den Optionen: Pfeile bewegen · Enter übernehmen und weiter · Esc abbrechen",
    hint_save: "⇧Enter erstellen, Fenster bleibt · Strg+Enter erstellen und schließen · Esc zurück",
    hint_undo: "Strg+Z letzten Eintrag zurücknehmen · Strg+Q beenden",
    hint_calendar: "Kalender: Linksklick Tag auf/zu · ⇧Linksklick Bereich · Rechtsklick links ganztägig · rechts ziehen in den Stunden: Zeit · rechts ziehen links: mehrere Tage · Rad blättert · Strg+Rad Tage größer/kleiner · Strg+⇧+Rad Stunden zoomen · ⇧+Rad Stunden verschieben · F6 Tastatur",
    hint_repeat: "↑↓ Zeile · ←→ wählen · Leertaste/1–7 umschalten · Ziffern tippen Zahlen · ⇧+Pfeile Datum/Zahl · Entf zurücksetzen · Enter übernehmen · Esc abbrechen",
    hint_choice: "Tippen filtert · Pfeile wählen · Klick wählt · Enter übernehmen · Esc abbrechen",
    search: "Journal durchsuchen · / für Befehle",
    cmd_entry: "Neuen Eintrag anlegen",
    cmd_unknown: "Unbekannter Befehl:",
    repeat_presets: ["Einmalig", "Täglich", "Werktags", "Wöchentlich", "Zweiwöchentlich", "Monatlich", "Jährlich"],
    rp_every: "Alle",
    rp_from: "Ab",
    rp_until: "Bis",
    rp_never: "nie",
    rp_times: "mal",
    rp_pause: "Pause",
    rp_on_word: "an",
    rp_off_word: "aus",
    rp_only_in: "Nur in",
    hint_clock: "↑↓ ±1 (Strg: Stunden ±4, Minuten ±15) · ←→ Stunden/Minuten · Ziffern tippen · Entf leeren · Enter übernehmen · Esc abbrechen",
    hint_calendar_days: "Ganze Tage: ↑↓ Tag · ←→ Woche · ⇧ Bereich (mehrtägig) · PgUp/PgDn Monat · Tab zu den Stunden · Enter übernehmen · Esc Bereich weg / abbrechen",
    hint_calendar_hours: "Stunden: ←→ Stunde (Strg: Viertelstunde) · ↑↓ Tag · ⇧ Zeitraum, auch über Tage · Tab zu den ganzen Tagen · Enter übernehmen · Esc Bereich weg / abbrechen",
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
    labels: ["Type", "Title", "When", "Repeat", "Tag", "More", "Description", "Important", "Reminder", "Icon"],
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
    more: "Description · Important · Reminder · Icon",
    less: "Show less",
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
    hint_rows: "↑↓ line · Tab next field · Enter the field's options · Alt+1–4 type",
    hint_pick: "In the options: arrows move · Enter take and go on · Esc cancel",
    hint_save: "⇧Enter create, window stays · Ctrl+Enter create and close · Esc back",
    hint_undo: "Ctrl+Z take the last entry back · Ctrl+Q quit",
    hint_calendar: "Calendar: left click opens/closes a day · ⇧left click a range · right click at the left: all day · right drag in the hours: time · right drag at the left: several days · wheel scrolls · Ctrl+wheel days taller/flatter · Ctrl+⇧+wheel zoom the hours · ⇧+wheel move the hours · F6 keyboard",
    hint_repeat: "↑↓ line · ←→ choose · Space/1–7 switch · digits type numbers · ⇧+arrows date/number · Del reset · Enter take · Esc cancel",
    hint_choice: "Typing filters · arrows choose · click chooses · Enter take · Esc cancel",
    search: "Search the journal · / for commands",
    cmd_entry: "Make a new entry",
    cmd_unknown: "Unknown command:",
    repeat_presets: ["Once", "Daily", "Workdays", "Weekly", "Every 2 weeks", "Monthly", "Yearly"],
    rp_every: "Every",
    rp_from: "From",
    rp_until: "Until",
    rp_never: "never",
    rp_times: "times",
    rp_pause: "Pause",
    rp_on_word: "on",
    rp_off_word: "off",
    rp_only_in: "Only in",
    hint_clock: "↑↓ ±1 (Ctrl: hours ±4, minutes ±15) · ←→ hours/minutes · type digits · Del clear · Enter take · Esc cancel",
    hint_calendar_days: "Whole days: ↑↓ day · ←→ week · ⇧ range (several days) · PgUp/PgDn month · Tab to the hours · Enter take · Esc drop range / cancel",
    hint_calendar_hours: "Hours: ←→ hour (Ctrl: quarter) · ↑↓ day · ⇧ span, also over days · Tab to whole days · Enter take · Esc drop range / cancel",
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
            for text in [t.no_vault, t.unreachable, t.too_new, t.open_failed, t.hotkey_failed, f.title_needed, f.hint_rows, f.hint_save, f.hint_repeat, f.empty_end] {
                assert!(!text.trim().is_empty(), "{language:?}");
            }
            assert!(f.labels.iter().all(|label| !label.is_empty()));
        }
        assert_ne!(form_texts(Language::De).labels, form_texts(Language::En).labels);
        assert_ne!(texts(Language::De).no_vault, texts(Language::En).no_vault);
    }
}
