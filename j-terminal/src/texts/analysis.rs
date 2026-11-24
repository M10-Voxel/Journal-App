//! The analysis (`/Auswertung`): the app's words for the overview's evaluation (`PeriodNotes.tsx`, `ValueChart.tsx`,
//! `ActivitySummary.tsx`, `ActivityHeatmap.tsx`, `ActivityPalette.tsx` and their English in `src/locales/en.ts`).
//! Index 0 German, 1 English.

pub const COMMAND: [&str; 2] = ["/Auswertung", "/Analysis"];
pub const COMMAND_DETAIL: [&str; 2] = ["Verlauf und Aktivitäten eines Zeitraums", "Values and activities of a period"];

/// Woche, Monat, Quartal, Jahr: the switch in the header.
pub const MODES: [[&str; 4]; 2] = [["Woche", "Monat", "Quartal", "Jahr"], ["Week", "Month", "Quarter", "Year"]];
pub const EYEBROWS: [[&str; 4]; 2] = [["Wochenübersicht", "Monatsübersicht", "Quartalsübersicht", "Jahresübersicht"], ["Weekly overview", "Monthly overview", "Quarterly overview", "Yearly overview"]];
pub const QUARTER: [&str; 2] = ["Quartal", "Quarter"];

pub const RATINGS: [&str; 2] = ["Bewertungen", "Ratings"];
pub const RATINGS_HINT: [&str; 2] = ["Tagesbewertung und Tageswerte im Verlauf.", "Daily rating and day values over time."];
pub const DAILY_RATING: [&str; 2] = ["Tagesbewertung", "Daily rating"];
pub const UNNAMED: [&str; 2] = ["Ohne Namen", "Unnamed"];
pub const NO_VALUES: [&str; 2] = ["noch keine Werte", "no values yet"];
/// "Ø {0} / {1}".
pub const AVERAGE: [&str; 2] = ["Ø {0} / {1}", "avg {0} / {1}"];
pub const ONE_DAY: [&str; 2] = ["1 Tag", "1 day"];
pub const DAYS_COUNT: [&str; 2] = ["{0} Tage", "{0} days"];
pub const HINT_MONTHLY: [&str; 2] = ["Monatsmittel · Punkt für Details auswählen", "Monthly averages · select a point for details"];
pub const HINT_DAILY: [&str; 2] = ["Tageswerte · Punkt für Details auswählen", "Day values · select a point for details"];
pub const ALL_HIDDEN: [&str; 2] = ["Alle Reihen ausgeblendet.", "All lines hidden."];
pub const NO_LINES: [&str; 2] = ["keine Reihen", "no lines"];

pub const ACTIVITIES: [&str; 2] = ["Aktivitäten im Überblick", "Activity overview"];
pub const ACTIVITIES_HINT: [&str; 2] = ["Erfasste Zeit und Aktivitätstage im gewählten Zeitraum.", "Recorded time and activity days in this period."];
pub const NO_ACTIVITIES: [&str; 2] = ["Lege deine Aktivitäten in den Einstellungen fest.", "Set up your activities in settings."];
pub const DAYS: [&str; 2] = ["Tage", "Days"];
pub const COMPLETED_LOWER: [&str; 2] = ["erledigt", "completed"];
pub const COMPLETED: [&str; 2] = ["Erledigt", "Completed"];
pub const NO_ACTIVITY: [&str; 2] = ["Keine Aktivität", "No activity"];
pub const MINUTES_PER_DAY: [&str; 2] = ["Minuten pro Tag", "Minutes per day"];
pub const PICK_DAY: [&str; 2] = ["Tag für Details auswählen", "Select a day for details"];
pub const LESS: [&str; 2] = ["Weniger", "Less"];
pub const MORE: [&str; 2] = ["Mehr", "More"];

/// Intl's short months: alone (`{ month: 'short' }`) and with a day (`{ day: 'numeric', month: 'short' }`).
pub const MONTHS_ALONE: [[&str; 12]; 2] = [
    ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"],
];
pub const MONTHS_WITH_DAY: [[&str; 12]; 2] = [
    ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."],
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"],
];
/// Intl's short weekdays, alone and in a full date ("Mo., 7. Sept. 2026", "Mon, 7 Sept 2026").
pub const WEEKDAYS_ALONE: [[&str; 7]; 2] = [["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]];
pub const WEEKDAYS_IN_DATE: [[&str; 7]; 2] = [["Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa.", "So."], ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]];
