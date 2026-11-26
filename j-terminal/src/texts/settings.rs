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
            Self::Features => (["Funktionen", "Features"], ["Was das Terminal zeigt. Ausgeschaltetes bleibt gespeichert und kommt beim Einschalten zurück.", "What the terminal shows. What is switched off stays saved and comes back when switched on."], "toggle-right"),
            Self::Activities => (["Aktivitäten", "Activities"], ["Deine tägliche Checkliste, wie in der Journal-App.", "Your daily checklist, as in the Journal app."], "activity"),
            Self::Values => (["Tageswerte", "Day values"], ["Tagesbewertung und eigene Werte wie Stress oder Schlaf.", "The daily rating and values of your own such as stress or sleep."], "gauge"),
        }
    }
}

// ----- F1 → Funktionen (the app's FeatureSettings) -----
use crate::features::{Module, View};
pub const FEATURE_NOTEBOOK: (Text, Text) = (["Notizen", "Notes"], ["Der Notizblock mit allen Zetteln (Strg+N).", "The notebook with all its notes (Ctrl+N)."]);
pub const VIEW_DETAIL: Text = ["Links neben dem Kalender; Strg+Tab wechselt zwischen den Ansichten.", "At the left beside the calendar; Ctrl+Tab switches between the views."];
pub const NOTEBOOK_OFF: Text = ["Der Notizblock ist in F1 → Funktionen ausgeschaltet.", "The notebook is switched off in F1 → Features."];
pub const LAST_VIEW: Text = ["Eine Ansicht bleibt immer an.", "One view always stays on."];
pub fn view_name(view: View) -> Text {
    [["Tag", "Day"], ["Woche", "Week"], ["Monat", "Month"], ["Quartal", "Quarter"], ["Jahr", "Year"]][view.index()]
}
pub fn view_title(view: View) -> Text {
    [["Tagesansicht", "Day view"], ["Wochenansicht", "Week view"], ["Monatsansicht", "Month view"], ["Quartalsansicht", "Quarter view"], ["Jahresansicht", "Year view"]][view.index()]
}
/// What a part is called in a view, and what it does there (a period's values and checklist differ from a day's).
pub fn module_text(module: Module, view: View) -> (Text, Text) {
    let day = view == View::Day;
    match module {
        Module::Entries => (["Einträge", "Entries"], if day { ["Aufgaben, Ereignisse und Notizen des Tages", "The day's tasks, events and notes"] } else { ["Eine eigene Liste mit Aufgaben und Notizen für den Zeitraum", "A list of its own with tasks and notes for the period"] }),
        Module::Note => (["Notiz", "Note"], ["Ein freier Text", "A free text"]),
        Module::Title => (["Titel", "Title"], if day { ["Ein Name für den Tag", "A name for the day"] } else { ["Ein Name für den Zeitraum, wie beim Tag", "A name for the period, as for a day"] }),
        Module::Rating => (["Bewertung", "Rating"], if day { ["Wie war der Tag?", "How was the day?"] } else { ["Eine eigene Bewertung des Zeitraums", "A rating of the period itself"] }),
        Module::Scales => (if day { ["Tageswerte", "Day values"] } else { ["Werte", "Values"] }, if day { ["Eigene Werte wie Stress oder Schlaf", "Values of your own such as stress or sleep"] } else { ["Eigene Werte für den Zeitraum, unabhängig von den Tagen", "Values of your own for the period, apart from its days"] }),
        Module::Activities => (["Checkliste", "Checklist"], if day { ["Aktivitäten mit Zeit und Timer", "Activities with time and timer"] } else { ["Zählt die Zeit der Tage zusammen; der Haken gilt für heute", "Adds up the days' time; the tick is today's"] }),
        Module::Evaluation => (["Auswertung", "Evaluation"], ["Verlauf der Tageswerte und Aktivitäten im Überblick", "The course of the day values and the activities at a glance"]),
        Module::Board => (["Pinnwand", "Pinboard"], if day { ["Zettel, Bilder und Links des Tages", "The day's notes, images and links"] } else { ["Eine eigene Pinnwand; Zettel lassen sich darauf anheften", "A board of its own; notes can be pinned to it"] }),
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
    ] },
    Group { page: Page::General, heading: ["Darstellung", "Appearance"], options: &[
        OptionText { key: Language, title: ["Sprache", "Language"], detail: ["Anzeigesprache für J-TerminaL.", "Display language for J-TerminaL."],
            choices: &[["Wie im Journal", "Follow Journal"], ["Deutsch", "Deutsch"], ["English", "English"]] },
        OptionText { key: Orientation, title: ["Ausrichtung", "Orientation"],
            detail: ["Formular und Kalender nebeneinander (horizontal), übereinander (vertikal, für einen hochkant stehenden Bildschirm) oder je nach Bildschirmbreite.",
                "Form and calendar side by side (horizontal), one above the other (vertical, for a screen standing upright) or by the screen's width."],
            choices: &[["Automatisch", "Automatic"], ["Horizontal", "Horizontal"], ["Vertikal", "Vertical"]] },
        OptionText { key: Keycaps, title: ["Tastenkürzel in der Fußzeile", "Shortcut hints in the footer"],
            detail: ["Zeigt neben jeder Aktion die zugehörigen Tasten.", "Show the assigned keys beside each action."], choices: &[] },
    ] },
    Group { page: Page::General, heading: NO_HEADING, options: &[
        OptionText { key: StartView, title: ["Startansicht", "Opening view"],
            detail: ["Wähle die Ansicht für den nächsten Aufruf. Ein offener Entwurf bleibt erhalten.", "Choose the view shown when you open the terminal. An open draft is preserved."],
            choices: &[["Tagesansicht", "Day view"], ["Eintragsformular", "Entry form"]] },
        OptionText { key: ReturnToday, title: ["Beim Öffnen zu heute springen", "Return to today when opening"],
            detail: ["Zeigt beim nächsten Aufruf den aktuellen Tag.", "Show the current day the next time you open the terminal."], choices: &[] },
        OptionText { key: Reopen, title: ["Beim erneuten Öffnen", "When opened again"],
            detail: ["Startansicht oder dort weitermachen, wo du warst (Formular, Notizblock, Pinnwand, Auswertung).", "The opening view, or carry on where you were (form, notebook, board, analysis)."],
            choices: &[["Zur Startansicht", "Opening view"], ["Dort bleiben, wo ich war", "Stay where I was"]] },
        OptionText { key: ReopenAfter, title: ["Zurück zur Startansicht nach", "Back to the opening view after"],
            detail: ["So lange bleibt die Ansicht nach dem Schließen erhalten. ←/→ ändern, Ziffern tippen.", "How long the view is kept after closing. ←/→ to change, or type digits."], choices: &[] },
        OptionText { key: ReopenUnit, title: ["Einheit", "Unit"], detail: ["", ""],
            choices: &[["Sekunden", "Seconds"], ["Minuten", "Minutes"]] },
    ] },
    Group { page: Page::Entry, heading: NO_HEADING, options: &[
        OptionText { key: ParseTitles, title: ["Angaben im Titel erkennen", "Recognize details in titles"],
            detail: ["Übernimmt beim Verlassen des Titels Datum, Uhrzeit, Typ, Tag und Wiederholung in die passenden Felder.", "Move dates, times, types, tags and repeats into their fields when you leave the title."], choices: &[] },
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
        OptionText { key: NoteMode, title: ["Gespeicherte Notizen öffnen", "Open saved notes in"],
            detail: ["Wählt die Ansicht beim Öffnen einer Notiz aus der Liste.", "Choose the view used when opening a note from the list."],
            choices: &[["Leseansicht", "Reader"], ["Editor", "Editor"]] },
    ] },
];
