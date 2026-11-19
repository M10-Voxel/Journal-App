//! German and English copy for the settings window, in sidebar and reading order.
use crate::{settings::Page, PreferenceKey};
use super::Language;

pub type Text = [&'static str; 2];
pub fn tr(text: Text, language: Language) -> &'static str {
    text[match language { Language::De => 0, Language::En => 1 }]
}

pub const BACK: Text = ["Zurück", "Back"];
pub const FORWARD: Text = ["Vorwärts", "Forward"];
pub const MINIMIZE: Text = ["Minimieren", "Minimize"];
pub const CLOSE: Text = ["Schließen", "Close"];
pub const KEYBOARD: Text = ["Tastatur", "Keyboard"];
pub const GLOBAL_KEY: Text = ["Globales Tastenkürzel", "Global shortcut"];
pub const GLOBAL_DETAIL: Text = ["Öffne J-TerminaL aus jeder Anwendung.", "Open J-TerminaL from any application."];
pub const WRITE_ERROR: Text = ["Einstellung konnte nicht gespeichert werden.", "Could not save the setting."];

impl Page {
    pub fn copy(self) -> (Text, Text, &'static str) {
        match self {
            Self::General => (["Allgemein", "General"], ["Fenster, Sprache und Bedienung.", "Window, language and controls."], "settings"),
            Self::Keyboard => (KEYBOARD, ["Lege die Tastenkürzel für das Terminal fest.", "Customize your terminal shortcuts."], "keyboard"),
            Self::Entry => (["Eintragsformular", "Entry form"], ["Passe die Eingabe neuer Journaleinträge an.", "Choose how you enter new journal entries."], "square-pen"),
            Self::Calendar => (["Kalender", "Calendar"], ["Wähle, welche Orientierungshilfen im Kalender erscheinen.", "Choose which guides appear in the calendar."], "calendar-days"),
            Self::Notebook => (["Notizblock", "Notebook"], ["Lege fest, wie du deine Notizen öffnest und bearbeitest.", "Choose how you open and edit notes."], "book-open-text"),
        }
    }
}

pub struct OptionText {
    pub key: PreferenceKey,
    pub title: Text,
    pub detail: Text,
    /// Empty for switches.
    pub choices: &'static [Text],
}

pub struct Group {
    pub page: Page,
    pub heading: Text,
    pub options: &'static [OptionText],
}

use PreferenceKey::*;
const NO_HEADING: Text = ["", ""];
pub const GROUPS: &[Group] = &[
    Group { page: Page::General, heading: NO_HEADING, options: &[
        OptionText { key: WindowPosition, title: ["Fensterposition", "Window position"],
            detail: ["Öffnet das Terminal auf dem Bildschirm mit dem Mauszeiger.", "Place the terminal on the display that contains the pointer."],
            choices: &[["Oben zentriert", "Top center"], ["Bildschirmmitte", "Center of screen"]] },
        OptionText { key: HideOnBlur, title: ["Bei Fokusverlust ausblenden", "Hide on focus loss"],
            detail: ["Blendet das Terminal aus, sobald du in ein anderes Fenster wechselst.", "Hide the terminal when you switch to another window."], choices: &[] },
    ] },
    Group { page: Page::General, heading: ["Darstellung", "Appearance"], options: &[
        OptionText { key: Language, title: ["Sprache", "Language"], detail: ["Anzeigesprache für J-TerminaL.", "Display language for J-TerminaL."],
            choices: &[["Wie im Journal", "Follow Journal"], ["Deutsch", "Deutsch"], ["English", "English"]] },
        OptionText { key: Keycaps, title: ["Tastenkürzel in der Fußzeile", "Shortcut hints in the footer"],
            detail: ["Zeigt neben jeder Aktion die zugehörigen Tasten.", "Show the assigned keys beside each action."], choices: &[] },
    ] },
    Group { page: Page::General, heading: NO_HEADING, options: &[
        OptionText { key: StartView, title: ["Startansicht", "Opening view"],
            detail: ["Wähle die Ansicht für den nächsten Aufruf. Ein offener Entwurf bleibt erhalten.", "Choose the view shown when you open the terminal. An open draft is preserved."],
            choices: &[["Tagesansicht", "Day view"], ["Eintragsformular", "Entry form"]] },
        OptionText { key: ReturnToday, title: ["Beim Öffnen zu heute springen", "Return to today when opening"],
            detail: ["Zeigt beim nächsten Aufruf den aktuellen Tag.", "Show the current day the next time you open the terminal."], choices: &[] },
    ] },
    Group { page: Page::Entry, heading: NO_HEADING, options: &[
        OptionText { key: ParseTitles, title: ["Angaben im Titel erkennen", "Recognize details in titles"],
            detail: ["Übernimmt beim Verlassen des Titels Datum, Uhrzeit, Typ, Tag und Wiederholung in die passenden Felder.", "Move dates, times, types, tags and repeats into their fields when you leave the title."], choices: &[] },
        OptionText { key: SaveDelay, title: ["Dauer der Speicherbestätigung", "Save confirmation duration"],
            detail: ["So lange bleibt die Bestätigung sichtbar, bevor das Terminal schließt.", "How long the confirmation stays visible before the terminal hides."],
            choices: &[["Kurz", "Brief"], ["1 Sekunde", "1 second"], ["2 Sekunden", "2 seconds"]] },
    ] },
    Group { page: Page::Calendar, heading: NO_HEADING, options: &[
        OptionText { key: WeekNumbers, title: ["Kalenderwochen anzeigen", "Show week numbers"],
            detail: ["Zeigt die Wochennummer jeweils am Wochenanfang.", "Show the week number at the beginning of each week."], choices: &[] },
        OptionText { key: Weekends, title: ["Wochenenden hervorheben", "Highlight weekends"],
            detail: ["Hebt Samstage und Sonntage im Kalender farblich hervor.", "Distinguish Saturdays and Sundays in the calendar."], choices: &[] },
        OptionText { key: NowLine, title: ["Aktuelle Uhrzeit markieren", "Show current time"],
            detail: ["Markiert die aktuelle Minute in der heutigen Tageszeile.", "Mark the current minute in today's row."], choices: &[] },
    ] },
    Group { page: Page::Notebook, heading: NO_HEADING, options: &[
        OptionText { key: NotesOnDay, title: ["Notizliste auf den Tag begrenzen", "Filter notes by day"],
            detail: ["Aktiviert beim Öffnen des Notizblocks den Filter für den angezeigten Tag.", "Open the notebook with the current day filter enabled."], choices: &[] },
        OptionText { key: NoteMode, title: ["Gespeicherte Notizen öffnen", "Open saved notes in"],
            detail: ["Wählt die Ansicht beim Öffnen einer Notiz aus der Liste.", "Choose the view used when opening a note from the list."],
            choices: &[["Leseansicht", "Reader"], ["Editor", "Editor"]] },
    ] },
];
