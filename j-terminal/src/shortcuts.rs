use crate::{engine::parse::fold, texts::Language};
use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use slint::platform::Key;
use std::{collections::BTreeMap, fs, io, path::PathBuf, str::FromStr};

pub const WINDOW: i32 = 1;
pub const SEARCH: i32 = 2;
pub const FORM: i32 = 4;
pub const DAY: i32 = 8;
pub const DAY_EDIT: i32 = 16;
pub const SIDE: i32 = 32;
pub const NOTES: i32 = 64;
const SYSTEM: i32 = 128;
const JOURNAL: i32 = SEARCH | FORM | DAY;
const DATE: i32 = SEARCH | DAY;
const ENTRY_ACTIONS: i32 = DAY | DAY_EDIT | SIDE;

struct Shortcut {
    id: &'static str,
    contexts: i32,
    keys: &'static str,
    label: [&'static str; 2],
}

macro_rules! fixed {
    ($keys:literal, $de:literal, $en:literal) => {
        Shortcut { id: "", contexts: 0, keys: $keys, label: [$de, $en] }
    };
}
macro_rules! binding {
    ($id:literal, $ctx:expr, $keys:literal, $de:literal, $en:literal) => {
        Shortcut { id: $id, contexts: $ctx, keys: $keys, label: [$de, $en] }
    };
}

struct Group {
    name: [&'static str; 2],
    shortcuts: &'static [Shortcut],
}

const GROUPS: &[Group] = &[
    Group { name: ["Allgemein", "General"], shortcuts: &[
        binding!("window-toggle", SYSTEM, "Ctrl+Alt+Space", "J-TerminaL ein- oder ausblenden", "Show or hide J-TerminaL"),
        binding!("settings", WINDOW, "F1", "Einstellungen öffnen oder schließen", "Open or close settings"),
        binding!("day-actions", WINDOW, "Ctrl+K", "Aktionen öffnen oder schließen", "Open or close the actions"),
        fixed!("Esc", "Einstellungen schließen", "Close settings"),
        binding!("notebook", WINDOW, "Ctrl+Shift+N", "Notizblock öffnen", "Open the notebook"),
        binding!("undo", JOURNAL, "Ctrl+Z", "Rückgängig machen", "Undo"),
        binding!("redo", JOURNAL, "Ctrl+Y", "Wiederherstellen", "Redo"),
        binding!("quit", JOURNAL, "Ctrl+Q", "J-TerminaL beenden", "Quit J-TerminaL"),
        fixed!("Esc", "Zurück, Suche leeren oder Fenster ausblenden", "Go back, clear search or hide the window"),
    ] },
    Group { name: ["Tagesansicht", "Day view"], shortcuts: &[
        binding!("previous-day", DATE, "Alt+ArrowLeft", "Vorheriger Tag", "Previous day"),
        binding!("next-day", DATE, "Alt+ArrowRight", "Nächster Tag", "Next day"),
        binding!("today", DATE, "Alt+H", "Zu heute springen", "Go to today"),
        fixed!("↓ / Tab", "Von der Suche in die Tagesansicht wechseln", "Move from search to the day view"),
        fixed!("↑ / ↓", "Eine Zeile auswählen", "Select a row"),
        fixed!("Enter", "Titel oder Eintrag bearbeiten. Beim Schreiben übernehmen und weiterschreiben.", "Edit the title or entry. While typing, confirm and continue."),
        binding!("day-task", ENTRY_ACTIONS, "Alt+A", "Aufgabe anlegen", "Create a task"),
        binding!("day-event", ENTRY_ACTIONS, "Alt+E", "Ereignis anlegen", "Create an event"),
        binding!("day-note", ENTRY_ACTIONS, "Alt+N", "Notiz anlegen", "Create a note"),
        binding!("day-done", ENTRY_ACTIONS, "Alt+D", "Aufgabe abhaken oder wieder öffnen", "Toggle completion"),
        binding!("day-cancel", ENTRY_ACTIONS, "Alt+X", "Aufgabe abbrechen", "Cancel the task"),
        binding!("day-untagged", DAY_EDIT, "Ctrl+Enter", "Eintrag übernehmen und darunter ohne Tag weiter", "Save the entry and continue below without a tag"),
        fixed!("Space", "Status der Aufgabe oder Aktivität umschalten", "Toggle the status of a task or activity"),
        binding!("day-priority", ENTRY_ACTIONS, "Alt+P", "Wichtigkeit umschalten", "Toggle priority"),
        binding!("day-tomorrow", ENTRY_ACTIONS, "Alt+M", "Auf morgen verschieben", "Move to tomorrow"),
        binding!("day-plan", ENTRY_ACTIONS, "Alt+T", "Für einen Tag planen", "Schedule on one day"),
        binding!("day-plan-days", ENTRY_ACTIONS, "Alt+Shift+T", "Für mehrere Tage planen", "Schedule on several days"),
        binding!("day-time", ENTRY_ACTIONS, "Alt+U", "Uhrzeit bearbeiten", "Edit time"),
        binding!("day-reminder", ENTRY_ACTIONS, "Alt+R", "Erinnerung bearbeiten", "Edit reminder"),
        binding!("day-tag", ENTRY_ACTIONS, "Alt+G", "Tag zuweisen", "Assign a tag"),
        binding!("day-icon", ENTRY_ACTIONS, "Alt+I", "Symbol auswählen", "Choose an icon"),
        binding!("day-description", ENTRY_ACTIONS, "Alt+B", "Beschreibung bearbeiten", "Edit description"),
        binding!("day-to-event", ENTRY_ACTIONS, "Alt+Shift+E", "Typ auf Ereignis ändern", "Change type to event"),
        binding!("day-to-task", ENTRY_ACTIONS, "Alt+Shift+A", "Typ auf Aufgabe ändern", "Change type to task"),
        binding!("day-to-note", ENTRY_ACTIONS, "Alt+Shift+N", "Typ auf Notiz ändern", "Change type to note"),
        fixed!("Alt+Enter", "Aktionen für den ausgewählten Eintrag öffnen", "Open actions for the selected entry"),
        binding!("day-move-up", ENTRY_ACTIONS, "Alt+ArrowUp", "Eintrag nach oben verschieben", "Move the entry up"),
        binding!("day-move-down", ENTRY_ACTIONS, "Alt+ArrowDown", "Eintrag nach unten verschieben", "Move the entry down"),
        fixed!("Del / Backspace", "Auswahl löschen oder Wert zurücksetzen", "Delete the selection or reset a value"),
        binding!("day-remove", ENTRY_ACTIONS, "Alt+Delete", "Ausgewählten Eintrag löschen", "Delete the selected entry"),
        fixed!("← / → / 0–9 / Del", "Regler schrittweise ändern, Wert eingeben oder zurücksetzen", "Adjust a dial, type a value or reset"),
        fixed!("Enter", "Aktivitätstimer starten oder pausieren", "Start or pause the activity timer"),
        binding!("day-timer-stop", DAY, "Shift+Enter", "Aktivitätstimer stoppen", "Stop the activity timer"),
        fixed!("0–9, Enter", "Minuten für eine Aktivität nachtragen", "Enter minutes for an activity"),
    ] },
    Group { name: ["Eintragsformular", "Entry form"], shortcuts: &[
        fixed!("/Entry, Enter", "Eintragsformular öffnen", "Open the entry form"),
        fixed!("Tab / Shift+Tab", "Nächstes / vorheriges Feld", "Next / previous field"),
        fixed!("↑ / ↓", "Formularzeile wechseln oder einen Vorschlag wählen", "Switch rows or select a suggestion"),
        fixed!("Enter", "Feld bestätigen, Optionen öffnen oder Auswahl übernehmen", "Confirm the field, open options or apply the selection"),
        binding!("form-calendar", FORM, "Alt+1", "Kalendereintrag wählen", "Choose calendar entry"),
        binding!("form-event", FORM, "Alt+2", "Ereignis wählen", "Choose event"),
        binding!("form-task", FORM, "Alt+3", "Aufgabe wählen", "Choose task"),
        binding!("form-note", FORM, "Alt+4", "Notiz wählen", "Choose note"),
        binding!("form-options", FORM, "Alt+ArrowDown", "Optionen des Felds öffnen", "Open the field’s options"),
        binding!("form-priority", FORM, "Alt+P", "Wichtigkeit umschalten", "Toggle priority"),
        binding!("form-description", FORM, "Alt+B", "Beschreibung bearbeiten", "Edit description"),
        binding!("form-reminder", FORM, "Alt+R", "Erinnerung bearbeiten", "Edit reminder"),
        binding!("form-icon", FORM, "Alt+I", "Symbol auswählen", "Choose an icon"),
        binding!("form-save-stay", FORM, "Shift+Enter", "Eintrag erstellen und Formular geöffnet lassen", "Create the entry and keep the form open"),
        binding!("form-save", FORM, "Ctrl+Enter", "Eintrag erstellen und Fenster schließen", "Create the entry and close the window"),
        fixed!("Esc", "Geöffnete Auswahl schließen oder zum vorherigen Schritt zurück", "Close the picker or return to the previous step"),
    ] },
    Group { name: ["Kalender", "Calendar"], shortcuts: &[
        binding!("calendar-focus", SEARCH | FORM, "F6", "Zum Kalender wechseln", "Move to the calendar"),
        fixed!("Tab", "Zwischen ganzen Tagen und Stunden wechseln", "Switch between whole days and hours"),
        fixed!("↑ / ↓", "Einen Tag zurück oder weiter", "Go back or forward a day"),
        fixed!("← / →", "Eine Woche oder Stunde zurück oder weiter", "Go back or forward a week or hour"),
        fixed!("Ctrl+← / Ctrl+→", "In den Stunden um eine Viertelstunde wechseln", "Move by fifteen minutes in the hours"),
        fixed!("Shift+↑ / ↓ / ← / →", "Tag- oder Zeitbereich erweitern", "Extend the date or time range"),
        fixed!("PgUp / PgDn / Home", "Voriger Monat / nächster Monat / heute", "Previous month / next month / today"),
        fixed!("Enter / Esc", "Datum oder Bereich übernehmen / zurück", "Apply date or range / go back"),
        fixed!("Wheel / Ctrl+Wheel", "Kalender scrollen / Tageshöhe ändern", "Scroll the calendar / change day height"),
        fixed!("Ctrl+Shift+Wheel / Shift+Wheel", "Stundenraster zoomen / horizontal verschieben", "Zoom the hour grid / pan horizontally"),
    ] },
    Group { name: ["Auswahl und Uhr", "Pickers and clock"], shortcuts: &[
        fixed!("↑ / ↓ / Enter", "Option wählen und übernehmen", "Select and apply an option"),
        fixed!("← / →", "In der Uhr Stunden oder Minuten wählen", "Select hours or minutes on the clock"),
        fixed!("↑ / ↓", "Uhrzeit schrittweise ändern", "Adjust the time one step"),
        fixed!("Ctrl+↑ / Ctrl+↓", "Uhrzeit in vier Stunden oder 15 Minuten ändern", "Adjust time by four hours or fifteen minutes"),
        fixed!("0–9 / Del", "Uhrzeit eintippen / Feld leeren", "Type a time / clear the field"),
        binding!("side-icon-reset", SIDE, "Ctrl+Delete", "Symbolzuweisung entfernen", "Remove the assigned icon"),
        fixed!("PgUp / PgDn / H", "Im Planer den Monat wechseln oder zu heute springen", "Change month in the planner or go to today"),
        fixed!("Space", "Beim Planen über mehrere Tage den gewählten Tag umschalten", "Toggle the selected day when planning several days"),
        fixed!("Esc", "Auswahl schließen. In der Beschreibung speichert Esc den Text.", "Close the picker. In the description, Esc saves the text."),
    ] },
    Group { name: ["Wiederholung", "Repeating"], shortcuts: &[
        fixed!("↑ / ↓ / Tab", "Zeile wechseln oder zur nächsten Stelle im Satz", "Switch rows or move to the next part of the sentence"),
        fixed!("← / →", "Auswahl ändern", "Change the selection"),
        fixed!("Space / 1–7", "Wochentage umschalten", "Toggle weekdays"),
        fixed!("Space", "Kalender für Start- oder Enddatum öffnen", "Open the calendar for the start or end date"),
        fixed!("PgUp / PgDn / Home", "Im Datumspopup den Monat wechseln oder zu heute springen", "Change month in the date picker or go to today"),
        fixed!("1–6 / Backspace", "Rhythmus wählen oder Wiederholung ausschalten", "Choose a rhythm or turn repetition off"),
        fixed!("0–9 / Shift+↑ / ↓", "Abstand, Anzahl oder Pause eingeben oder ändern", "Type or adjust an interval, count or pause"),
        fixed!("Shift+← / → / ↑ / ↓", "Datum um einen Tag oder eine Woche ändern", "Adjust a date by a day or a week"),
        fixed!("Del / Enter / Esc", "Zurücksetzen / übernehmen / abbrechen", "Reset / apply / cancel"),
    ] },
    Group { name: ["Notizblock", "Notebook"], shortcuts: &[
        binding!("notes-list", NOTES, "Ctrl+O", "Zur Zettelliste wechseln", "Go to the note list"),
        binding!("notes-all", NOTES, "Alt+ArrowLeft", "Alle Zettel anzeigen", "Show all notes"),
        binding!("notes-day", NOTES, "Alt+ArrowRight", "Zettel am ausgewählten Tag anzeigen", "Show notes for the selected day"),
        binding!("notes-new", NOTES, "Ctrl+N", "Neue Notiz anlegen", "Create a note"),
        binding!("notes-edit", NOTES, "F2", "Geöffnete Notiz bearbeiten", "Edit the open note"),
        binding!("notes-save", NOTES, "Ctrl+Enter", "Notiz speichern und anzeigen", "Save and read the note"),
        fixed!("Enter", "Aufzählung oder Checkliste fortsetzen", "Continue a list or checklist"),
        fixed!("Tab / Shift+Tab", "Zeilen ein- oder ausrücken", "Indent or outdent lines"),
        binding!("notes-title", NOTES, "Ctrl+Tab", "Zwischen Titel und Text wechseln", "Switch between title and text"),
        binding!("notes-tag", NOTES, "Ctrl+T", "Tag zuweisen", "Assign a tag"),
        binding!("notes-attachments", NOTES, "Ctrl+L", "Anhänge öffnen", "Open attachments"),
        binding!("notes-image", NOTES, "Ctrl+I", "Bilddatei anhängen", "Attach an image"),
        binding!("notes-preview", NOTES, "Ctrl+M", "Markdown-Vorschau umschalten", "Toggle Markdown preview"),
        fixed!("↑ / ↓ / ← / → / Enter", "In der Leseansicht Zeile oder Link wählen und Aktion ausführen", "In the reader, select a line or link and run its action"),
        fixed!("Esc", "Eine Ansicht zurückgehen", "Go back one view"),
    ] },
];

fn language_index(language: Language) -> usize {
    usize::from(matches!(language, Language::En))
}


const LETTERS: [Code; 26] = [Code::KeyA, Code::KeyB, Code::KeyC, Code::KeyD, Code::KeyE, Code::KeyF, Code::KeyG, Code::KeyH, Code::KeyI, Code::KeyJ, Code::KeyK, Code::KeyL, Code::KeyM, Code::KeyN, Code::KeyO, Code::KeyP, Code::KeyQ, Code::KeyR, Code::KeyS, Code::KeyT, Code::KeyU, Code::KeyV, Code::KeyW, Code::KeyX, Code::KeyY, Code::KeyZ];
const DIGITS: [Code; 10] = [Code::Digit0, Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4, Code::Digit5, Code::Digit6, Code::Digit7, Code::Digit8, Code::Digit9];
const PUNCTUATION: &[(char, Code)] = &[
    (',', Code::Comma), ('.', Code::Period), ('-', Code::Minus), ('=', Code::Equal),
    ('/', Code::Slash), ('\\', Code::Backslash), ('[', Code::BracketLeft), (']', Code::BracketRight),
    (';', Code::Semicolon), ('\'', Code::Quote),
];
const SPECIAL: &[(Code, Key, [&str; 2])] = &[
    (Code::Enter, Key::Return, ["Enter", "Enter"]),
    (Code::Tab, Key::Tab, ["Tab", "Tab"]),
    (Code::Delete, Key::Delete, ["Entf", "Del"]),
    (Code::Insert, Key::Insert, ["Einfg", "Ins"]),
    (Code::Backspace, Key::Backspace, ["Rücktaste", "Backspace"]),
    (Code::Escape, Key::Escape, ["Esc", "Esc"]),
    (Code::Home, Key::Home, ["Pos1", "Home"]),
    (Code::End, Key::End, ["Ende", "End"]),
    (Code::PageUp, Key::PageUp, ["Bild↑", "PgUp"]),
    (Code::PageDown, Key::PageDown, ["Bild↓", "PgDn"]),
    (Code::ArrowUp, Key::UpArrow, ["↑", "↑"]),
    (Code::ArrowDown, Key::DownArrow, ["↓", "↓"]),
    (Code::ArrowLeft, Key::LeftArrow, ["←", "←"]),
    (Code::ArrowRight, Key::RightArrow, ["→", "→"]),
    (Code::F1, Key::F1, ["F1", "F1"]),
    (Code::F2, Key::F2, ["F2", "F2"]),
    (Code::F3, Key::F3, ["F3", "F3"]),
    (Code::F4, Key::F4, ["F4", "F4"]),
    (Code::F5, Key::F5, ["F5", "F5"]),
    (Code::F6, Key::F6, ["F6", "F6"]),
    (Code::F7, Key::F7, ["F7", "F7"]),
    (Code::F8, Key::F8, ["F8", "F8"]),
    (Code::F9, Key::F9, ["F9", "F9"]),
    (Code::F10, Key::F10, ["F10", "F10"]),
    (Code::F11, Key::F11, ["F11", "F11"]),
    (Code::F12, Key::F12, ["F12", "F12"]),
];

fn definitions() -> impl Iterator<Item = &'static Shortcut> {
    GROUPS.iter().flat_map(|group| group.shortcuts).filter(|shortcut| !shortcut.id.is_empty())
}

fn definition(id: &str) -> Option<&'static Shortcut> { definitions().find(|shortcut| shortcut.id == id) }

fn modifiers(mask: i32) -> Modifiers {
    let mut flags = Modifiers::empty();
    flags.set(Modifiers::SHIFT, mask & 1 != 0);
    flags.set(Modifiers::CONTROL, mask & 2 != 0);
    flags.set(Modifiers::ALT, mask & 4 != 0);
    flags.set(Modifiers::META, mask & 8 != 0);
    flags
}

fn mask(flags: Modifiers) -> i32 {
    i32::from(flags.contains(Modifiers::SHIFT)) | i32::from(flags.contains(Modifiers::CONTROL)) * 2
        | i32::from(flags.contains(Modifiers::ALT)) * 4 | i32::from(flags.contains(Modifiers::META)) * 8
}

pub fn chord(text: &str, mask: i32) -> Option<HotKey> {
    let mut chars = text.chars();
    let character = chars.next()?;
    if chars.next().is_some() { return None; }
    let mut flags = modifiers(mask);
    let code = match character {
        'a'..='z' | 'A'..='Z' => LETTERS[usize::from(character.to_ascii_lowercase() as u8 - b'a')],
        '0'..='9' => DIGITS[usize::from(character as u8 - b'0')],
        ' ' => Code::Space,
        c if c == char::from(Key::Backtab) => { flags.insert(Modifiers::SHIFT); Code::Tab }
        c => SPECIAL.iter().find(|(_, key, _)| char::from(*key) == c).map(|(code, _, _)| *code)
            .or_else(|| PUNCTUATION.iter().find(|(character, _)| *character == c).map(|(_, code)| *code))?,
    };
    Some(HotKey::new(Some(flags), code))
}

fn text(code: Code) -> Option<char> {
    if code == Code::Space { return Some(' '); }
    if let Some(index) = LETTERS.iter().position(|key| *key == code) { return Some(char::from(b'a' + index as u8)); }
    if let Some(index) = DIGITS.iter().position(|key| *key == code) { return Some(char::from(b'0' + index as u8)); }
    SPECIAL.iter().find(|(key, _, _)| *key == code).map(|(_, key, _)| char::from(*key))
        .or_else(|| PUNCTUATION.iter().find(|(_, key)| *key == code).map(|(character, _)| *character))
}

fn label(key: HotKey, language: Language) -> String {
    let lang = language_index(language);
    let mut parts = Vec::with_capacity(4);
    if key.mods.contains(Modifiers::CONTROL) { parts.push(["Strg", "Ctrl"][lang].to_owned()); }
    if key.mods.contains(Modifiers::ALT) { parts.push("Alt".to_owned()); }
    if key.mods.contains(Modifiers::SHIFT) { parts.push(["Umschalt", "Shift"][lang].to_owned()); }
    parts.push(if key.key == Code::Space { ["Leertaste", "Space"][lang].to_owned() }
        else if let Some((_, _, names)) = SPECIAL.iter().find(|(code, _, _)| *code == key.key) { names[lang].to_owned() }
        else { text(key.key).unwrap_or_default().to_ascii_uppercase().to_string() });
    parts.join("+")
}

fn overlaps(a: i32, b: i32) -> bool {
    a & b != 0 || (a | b) & (WINDOW | SYSTEM) != 0
}

fn assignable(key: HotKey) -> bool {
    if text(key.key).is_none() || key.mods.contains(Modifiers::META) { return false; }
    if matches!(key.key, Code::F1 | Code::F2 | Code::F3 | Code::F4 | Code::F5 | Code::F6
        | Code::F7 | Code::F8 | Code::F9 | Code::F10 | Code::F11 | Code::F12) { return true; }
    if key.key == Code::Escape { return false; }
    // Leave ordinary editing and navigation available in every pane.
    if key.mods.intersects(Modifiers::CONTROL) && !key.mods.intersects(Modifiers::ALT) &&
        matches!(key.key, Code::KeyA | Code::KeyC | Code::KeyV | Code::KeyX | Code::Insert | Code::Backspace | Code::Delete
            | Code::ArrowLeft | Code::ArrowRight | Code::ArrowUp | Code::ArrowDown | Code::Home | Code::End) {
        return false;
    }
    key.mods.intersects(Modifiers::CONTROL | Modifiers::ALT)
        || (key.mods.contains(Modifiers::SHIFT) && key.key == Code::Enter)
}

#[derive(Debug)]
pub enum EditError { Invalid, Reserved, Conflict(&'static str) }

impl EditError {
    pub fn conflict_label(id: &str, language: Language) -> &str {
        definition(id).map_or(id, |shortcut| shortcut.label[language_index(language)])
    }
}

#[derive(Clone)]
pub struct Bindings {
    path: Option<PathBuf>,
    defaults: BTreeMap<&'static str, HotKey>,
    overrides: BTreeMap<&'static str, HotKey>,
}

impl Default for Bindings { fn default() -> Self { Self::at(None) } }
impl Bindings {
    pub fn at(path: Option<PathBuf>) -> Self {
        let defaults = definitions().map(|shortcut| (shortcut.id, shortcut.keys.parse().expect("default shortcut"))).collect();
        Self { path, defaults, overrides: BTreeMap::new() }
    }

    fn effective(&self, id: &str) -> Option<HotKey> {
        self.overrides.get(id).or_else(|| self.defaults.get(id)).copied()
    }

    pub fn system_hotkey(&self) -> HotKey { self.effective("window-toggle").expect("default global hotkey") }
    pub fn default_system_hotkey(&self) -> HotKey { self.defaults["window-toggle"] }

    /// Reads the own keys. One that no longer fits (unknown, reserved, or taken by another, e.g. by a shortcut that is
    /// new in this version) is left out; the others stay. Returns the ids left out.
    pub fn load(&mut self) -> io::Result<Vec<&'static str>> {
        let Some(path) = &self.path else { return Ok(Vec::new()); };
        let contents = match fs::read(path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let stored: BTreeMap<String, String> = serde_json::from_slice(&contents)?;
        let mut next = self.clone();
        let mut dropped = Vec::new();
        for (id, keys) in stored {
            let Some(shortcut) = definition(&id) else { continue; };
            match HotKey::from_str(&keys) {
                Ok(key) if key == next.defaults[shortcut.id] => {}
                Ok(key) if assignable(key) => { next.overrides.insert(shortcut.id, key); }
                _ => dropped.push(shortcut.id),
            }
        }
        // An own key that collides is given up (the others keep theirs), until nothing collides.
        loop {
            let clash = definitions().find(|shortcut| next.overrides.contains_key(shortcut.id)
                && next.validate_conflicts(shortcut, next.effective(shortcut.id).unwrap()).is_err());
            let Some(shortcut) = clash else { break };
            next.overrides.remove(shortcut.id);
            dropped.push(shortcut.id);
        }
        *self = next;
        Ok(dropped)
    }

    /// The name of a shortcut ("Zum Kalender wechseln").
    pub fn action_label(id: &str, language: Language) -> &'static str {
        definition(id).map_or("", |shortcut| shortcut.label[language_index(language)])
    }

    fn validate_conflicts(&self, shortcut: &Shortcut, key: HotKey) -> Result<(), EditError> {
        if let Some(other) = definitions().find(|other| other.id != shortcut.id && overlaps(other.contexts, shortcut.contexts)
            && self.effective(other.id) == Some(key)) {
            return Err(EditError::Conflict(other.id));
        }
        Ok(())
    }

    pub fn set(&mut self, id: &str, proposed: Option<HotKey>) -> Result<(), EditError> {
        let shortcut = definition(id).ok_or(EditError::Invalid)?;
        let default = self.defaults[shortcut.id];
        let key = proposed.unwrap_or(default);
        if key != default && !assignable(key) { return Err(EditError::Reserved); }
        self.validate_conflicts(shortcut, key)?;
        if key == default { self.overrides.remove(shortcut.id); }
        else { self.overrides.insert(shortcut.id, key); }
        Ok(())
    }

    pub fn save(&self) -> io::Result<()> {
        let Some(path) = &self.path else { return Ok(()); };
        let stored = self.overrides.iter().map(|(id, key)| (*id, key.to_string())).collect::<BTreeMap<_, _>>();
        crate::settings::write_json(path, &stored)
    }

    /// Adapt configured chords to the existing input handlers. A rejected event still edits text as before.
    pub fn route(&self, context: i32, input: &str, mods: i32) -> Option<(String, i32)> {
        if self.overrides.is_empty() { return None; }
        let pressed = chord(input, mods)?;
        for binding in definitions().filter(|binding| binding.contexts & context != 0) {
            if self.overrides.get(binding.id) == Some(&pressed) {
                let default = self.defaults[binding.id];
                return Some((text(default.key)?.to_string(), mask(default.mods)));
            }
            // An unchanged assignment takes precedence over a displaced default in this context.
            if self.effective(binding.id) == Some(pressed) { return None; }
        }
        for (&id, _) in &self.overrides {
            let binding = definition(id)?;
            let default = self.defaults[binding.id];
            if binding.contexts & context != 0 && pressed.key == default.key && pressed.mods.contains(default.mods) {
                return Some((String::new(), 0));
            }
        }
        None
    }
}

pub struct Row {
    pub id: &'static str,
    pub heading: &'static str,
    pub action: &'static str,
    pub keys: String,
    pub changed: bool,
}

fn fixed_label(keys: &str, language: Language) -> String {
    match language {
        Language::En => keys.to_owned(),
        Language::De => keys.replace("Ctrl", "Strg").replace("Shift", "Umschalt")
            .replace("Space", "Leertaste").replace("Del", "Entf").replace("Home", "Pos1")
            .replace("PgUp", "Bild↑").replace("PgDn", "Bild↓").replace("Wheel", "Mausrad"),
    }
}

pub fn rows(bindings: &Bindings, language: Language, query: &str) -> Vec<Row> {
    use crate::texts::settings::{tr, GLOBAL_DETAIL, GLOBAL_KEY, KEYBOARD};
    let query = fold(query);
    let terms: Vec<_> = query.split(|ch: char| ch.is_whitespace() || ch == '+')
        .filter(|term| !term.is_empty()).collect();
    let mut result = Vec::new();
    for group in GROUPS {
        let name = group.name[language_index(language)];
        let mut heading = name;
        for shortcut in group.shortcuts {
            let action = shortcut.label[language_index(language)];
            let current = bindings.effective(shortcut.id);
            let keys = current.map_or_else(|| fixed_label(shortcut.keys, language), |key| label(key, language));
            if !terms.is_empty() {
                let canonical = current.map_or_else(|| shortcut.keys.to_owned(), |key| label(key, Language::En));
                let keyboard = tr(KEYBOARD, language);
                let mut haystack = format!("{keyboard} {name} {action} {canonical} {keys}");
                if shortcut.id == "window-toggle" {
                    haystack.push_str(&format!(" {} {}", tr(GLOBAL_KEY, language), tr(GLOBAL_DETAIL, language)));
                }
                let haystack = fold(&haystack);
                if !terms.iter().all(|term| haystack.contains(term)) { continue; }
            }
            result.push(Row { id: shortcut.id, heading, action, keys, changed: bindings.overrides.contains_key(shortcut.id) });
            heading = "";
        }
    }
    result
}

/// The keys of an action as they are set now ("Strg+Umschalt+N"); empty for an unknown id.
pub fn keys(bindings: &Bindings, id: &str, language: Language) -> String {
    bindings.effective(id).map(|key| label(key, language)).unwrap_or_default()
}

/// Keys as caps, one per key ("Strg+Umschalt+Enter" → Strg, ⇧, ↵), as Raycast shows them.
pub fn caps(keys: &str) -> Vec<String> {
    if keys.is_empty() { return Vec::new(); }
    let mut parts: Vec<&str> = keys.split('+').collect();
    // A key that is itself "+" leaves an empty part behind.
    if keys.ends_with("++") { parts.retain(|part| !part.is_empty()); parts.push("+"); }
    parts.into_iter().filter(|part| !part.is_empty()).map(|part| match part {
        "Umschalt" | "Shift" => "⇧".to_owned(),
        "Enter" => "↵".to_owned(),
        other => other.to_owned(),
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_own_key_taken_by_a_new_shortcut_is_reset_and_the_others_stay() {
        let path = std::env::temp_dir().join(format!("j-terminal-shortcuts-{}.json", uuid::Uuid::new_v4()));
        fs::write(&path, r#"{ "calendar-focus": "control+KeyK", "notes-preview": "F8" }"#).unwrap();
        let mut profile = Bindings::at(Some(path.clone()));
        assert_eq!(profile.load().unwrap(), ["calendar-focus"], "Strg+K belongs to the actions now.");
        assert_eq!(keys(&profile, "calendar-focus", Language::En), "F6");
        assert_eq!(keys(&profile, "notes-preview", Language::En), "F8", "The others are kept.");
        assert_eq!(keys(&profile, "day-actions", Language::En), "Ctrl+K");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn keys_become_caps_and_follow_changes() {
        let mut profile = Bindings::default();
        assert_eq!(caps(&keys(&profile, "day-actions", Language::De)), ["Strg", "K"]);
        assert_eq!(caps(&keys(&profile, "notebook", Language::De)), ["Strg", "⇧", "N"]);
        assert_eq!(caps(&keys(&profile, "form-save", Language::En)), ["Ctrl", "↵"]);
        profile.set("day-actions", Some("Ctrl+J".parse().unwrap())).unwrap();
        assert_eq!(caps(&keys(&profile, "day-actions", Language::De)), ["Strg", "J"]);
        assert!(caps("").is_empty());
    }

    #[test]
    fn default_bindings_resolve_without_conflicts() {
        let profile = Bindings::default();
        for shortcut in definitions() {
            let key = profile.effective(shortcut.id).unwrap();
            assert!(text(key.key).is_some(), "{}", shortcut.id);
            assert!(profile.validate_conflicts(shortcut, key).is_ok(), "{}", shortcut.id);
        }
    }

    #[test]
    fn rejects_occupied_keys_in_the_same_context_and_allows_them_in_other_panes() {
        let mut profile = Bindings::default();
        let key = Some("Ctrl+L".parse().unwrap());
        assert!(matches!(profile.set("notes-preview", key), Err(EditError::Conflict("notes-attachments"))));
        assert!(matches!(profile.set("settings", key), Err(EditError::Conflict("notes-attachments"))));
        assert!(matches!(profile.set("undo", Some("Ctrl+C".parse().unwrap())), Err(EditError::Reserved)));
        profile.set("day-task", key).unwrap();
        assert_eq!(profile.route(DAY, "l", 2), Some(("a".into(), 4)));
        assert_eq!(profile.route(NOTES, "l", 2), None);
        assert_eq!(profile.route(DAY_EDIT, "a", 4), Some((String::new(), 0)));
        assert_eq!(profile.route(DAY_EDIT, "A", 5), None, "Keep the distinct shift binding");
    }

    #[test]
    fn saves_reloads_and_resets_the_profile() {
        let path = std::env::temp_dir().join(format!("j-terminal-shortcuts-{}.json", uuid::Uuid::new_v4()));
        let mut profile = Bindings::at(Some(path.clone()));
        profile.set("notes-preview", Some("F8".parse().unwrap())).unwrap();
        profile.set("window-toggle", Some("Ctrl+Shift+Space".parse().unwrap())).unwrap();
        profile.save().unwrap();
        let mut reopened = Bindings::at(Some(path.clone()));
        reopened.load().unwrap();
        let row = &rows(&reopened, Language::De, "Markdown")[0];
        assert_eq!(row.keys, "F8");
        assert!(row.changed);
        assert_eq!(reopened.system_hotkey(), "Ctrl+Shift+Space".parse().unwrap());
        assert_eq!(reopened.route(NOTES, &char::from(Key::F8).to_string(), 0), Some(("m".into(), 2)));
        assert_eq!(reopened.route(NOTES, "m", 2), Some((String::new(), 0)));
        reopened.set("notes-preview", None).unwrap();
        reopened.save().unwrap();
        let mut restored = Bindings::at(Some(path.clone()));
        restored.load().unwrap();
        assert_eq!(rows(&restored, Language::De, "Markdown")[0].keys, "Strg+M");
        fs::remove_file(path).unwrap();
    }
}
