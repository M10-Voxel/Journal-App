//! The entry form without the window (docs/input.md): a compact form under the search bar, with the calendar beside it
//! as the preview. Every piece of an entry has one place where it is changed, and Enter never saves.
//!
//! * Lines: the type (four, as in the app), the title, "when" (date │ start – end), the repetition, the tag, and behind
//!   "more" the description, important, reminder and icon.
//! * `↑`/`↓` move between lines, `Tab` always to the next field (in "when" from the date to the start and the end).
//! * `Enter` opens a field's options (the calendar for the date, the clock for a time, the lists for tag, icon and
//!   reminder, the repetition's lines); inside, all arrows move. `Enter` takes it and goes on, `Esc` cancels and stays.
//!   Everything shows in the calendar at once.
//! * `Shift+Enter` creates the entry and keeps the window, `Strg+Enter` creates it and closes.
mod search;
mod notes;

use std::collections::BTreeSet;
use chrono::{Local, NaiveDate, Timelike};
use crate::calendar::{self, Item, Layout, Metrics};
use crate::day::{self as day_pane, DayPane};
use crate::day_view::DayView;
use crate::engine::{
    parse::{self, format_time, Draft, Kind, Mode, TagName},
    resolve::{resolve, Outcome, Problem},
};
use crate::actions::{self, Id as ActionId, Item as ActionItem};
use crate::icons;
use crate::journal::Journal;
use crate::{note_markdown, notebook, notepad};
use crate::repeat::{self, Rule};
use crate::repeat_sentence::{self, Act, DateField, Editor, Line};
use crate::save::{self, Extras, Saved};
use crate::snapshot::Snapshot;
use crate::texts::{action_texts, form_texts, notepad_texts, texts, FormTexts, Language, Texts};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key { Tab, Up, Down, Left, Right, Enter, Escape, Space, PageUp, PageDown, Home, End, Insert, Delete, Digit(u8), Undo, Redo, Quit,
    /// F6: the keyboard goes to the calendar and back.
    Focus,
    /// Alt+P: important or not (the flag beside the title).
    Priority,
    /// Alt+B/R/I: to the description, the reminder or the icon (their line shows while it is used).
    Extra(Field),
    /// The back arrow in the top line: the form closes, what was in it is dropped.
    Close,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Mods { pub shift: bool, pub ctrl: bool, pub alt: bool }

/// The four types of the app: an appointment only in the calendar, an event (also in the journal), a task, a note.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Type { Calendar, Event, Task, Note }
const TYPES: [Type; 4] = [Type::Calendar, Type::Event, Type::Task, Type::Note];
impl Type {
    fn kind(self) -> Kind { match self { Type::Calendar | Type::Event => Kind::Event, Type::Task => Kind::Task, Type::Note => Kind::Note } }
    fn journal(self) -> bool { self != Type::Calendar }
    fn index(self) -> usize { TYPES.iter().position(|t| *t == self).unwrap_or(0) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Field { Kind, Title, Day, Start, End, Repeat, Tag, More, Description, Priority, Reminder, Icon, Plan }
pub const FIELDS: [Field; 13] = [Field::Kind, Field::Title, Field::Day, Field::Start, Field::End, Field::Repeat, Field::Tag, Field::More, Field::Description, Field::Priority, Field::Reminder, Field::Icon, Field::Plan];
const TITLE: usize = 1;

impl Field {
    pub fn index(self) -> usize { FIELDS.iter().position(|f| *f == self).unwrap() }
    /// The line it is on (the date, start and end share "when").
    fn line(self) -> usize {
        match self { Field::Kind => 0, Field::Title => 1, Field::Day | Field::Start | Field::End => 2, Field::Repeat => 3, Field::Tag => 4, Field::More => 5, Field::Description => 6, Field::Priority => 7, Field::Reminder => 8, Field::Icon => 9, Field::Plan => 10 }
    }
    fn cell(self) -> usize { match self { Field::Start => 1, Field::End => 2, _ => 0 } }
    /// The field has text the input edits.
    fn text(self) -> bool { !matches!(self, Field::Kind | Field::More | Field::Priority) }
    /// `←`/`→` move the cursor in the text (otherwise they choose).
    fn native_arrows(self) -> bool { matches!(self, Field::Title | Field::Day | Field::Plan | Field::Start | Field::End | Field::Repeat | Field::Description) }
    /// Not one of the lines under the title (the type and the title are in the top line, important is its flag).
    fn in_header(self) -> bool { matches!(self, Field::Kind | Field::Title) }
}

/// Reminders ready to choose: minutes before the entry's time (0 at the time itself).
pub const REMINDERS: [Option<i64>; 11] = [None, Some(0), Some(5), Some(10), Some(15), Some(30), Some(60), Some(120), Some(1440), Some(2880), Some(10080)];
/// The icons shown before anything is typed.
pub const COMMON_ICONS: [&str; 48] = ["calendar", "clock", "bell", "star", "heart", "house", "briefcase", "book-open", "graduation-cap", "stethoscope", "dumbbell", "utensils",
    "shopping-cart", "car", "plane", "train-front", "bike", "music", "phone", "mail", "users", "user", "gift", "cake", "coffee", "party-popper", "pill", "hospital",
    "building-2", "map-pin", "flag", "sun", "moon", "cloud", "umbrella", "tree-pine", "dog", "cat", "baby", "wrench", "laptop", "code", "pen", "camera", "film",
    "gamepad-2", "trophy", "wallet"];
const ICON_ROOM: usize = 56;
/// Icons per line of the grid (as in `ui/theme.slint`).
const ICON_COLUMNS: i32 = 10;

#[derive(Clone, Debug, PartialEq)]
struct Values {
    typ: Type,
    title: String,
    /// Empty: today.
    days: BTreeSet<NaiveDate>,
    plan_days: BTreeSet<NaiveDate>,
    mode: Mode,
    /// Minutes since midnight; no end is a point in time.
    start: Option<u32>,
    end: Option<u32>,
    /// Kept with a draft made by marking the hour grid, independently of later text edits.
    time_grid: bool,
    rule: Option<Rule>,
    tag: Option<String>,
    description: String,
    priority: bool,
    reminder: Option<i64>,
    icon: Option<String>,
}

impl Default for Values {
    fn default() -> Self {
        Values { typ: Type::Task, title: String::new(), days: BTreeSet::new(), plan_days: BTreeSet::new(), mode: Mode::Continuous, start: None, end: None, time_grid: false, rule: None, tag: None,
            description: String::new(), priority: false, reminder: None, icon: None }
    }
}

/// One field as drawn: its line (counting only the lines shown), its place in the line, and what it shows.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RowView {
    pub field: usize,
    pub line: usize,
    pub cell: usize,
    /// The line has several fields ("when").
    pub multi: bool,
    /// The line's label, on its first field only.
    pub label: String,
    /// The line's icon, beside its label.
    pub label_icon: &'static str,
    pub value: String,
    pub hint: String,
    pub filled: bool,
    pub error: bool,
    pub color: Option<calendar::Rgb>,
    pub icon: String,
}

/// A choice under the active line.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Choice { pub label: String, pub color: Option<calendar::Rgb>, pub icon: String, pub selected: bool }

#[derive(Clone, Debug, Default, PartialEq)]
pub enum Panel {
    #[default]
    None,
    Tags(Vec<Choice>),
    Icons(Vec<Choice>),
    Reminders(Vec<Choice>),
    Repeat(Vec<Line>),
    /// The clock: hours and minutes, which of them has the arrows, and a word on what it is.
    Clock { label: String, hours: String, minutes: String, on_minutes: bool },
    /// The calendar has the keyboard: what is chosen and how.
    Calendar { label: String, hours: bool },
}

/// The calendar beside the form as the window draws it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CalendarView { pub layout: Layout, pub focus: bool, pub metrics: Metrics }

#[derive(Clone, Debug, Default, PartialEq)]
pub struct View {
    pub rows: Vec<RowView>,
    pub active: usize,
    pub active_line: usize,
    pub active_cell: usize,
    pub active_multi: bool,
    /// The input shows the active field's text.
    pub editable: bool,
    /// `←`/`→` move the cursor instead of choosing.
    pub native_arrows: bool,
    pub type_names: [String; 4],
    pub type_icons: [&'static str; 4],
    /// A field's options are open (Enter took it there).
    pub options: bool,
    pub type_selected: usize,
    pub panel: Panel,
    /// A line under the choices with the chosen icon’s name.
    pub panel_note: String,
    pub summary: String,
    pub calendar: CalendarView,
    /// The entry form is open (otherwise the search bar and the day view under it).
    pub entry_open: bool,
    pub day: DayView,
    /// The panel at the left of the window (an entry's settings and pickers), when open.
    pub side: Option<day_pane::SidePanel>,
    /// The day view's own message (an error of a change, a hint).
    pub day_message: Option<(String, bool)>,
    pub commands: Vec<Command>,
    pub searching: bool,
    pub command_selected: usize,
    pub search_placeholder: String,
    pub status: Option<(String, bool)>,
    pub placeholder: String,
    /// The title in the top line (shown while another field has the keyboard), and what it says when empty.
    pub title: String,
    pub title_hint: String,
    /// The title or the type has the keyboard (the input sits in the top line).
    pub in_header: bool,
    /// The title has a problem (it is missing when creating was tried).
    pub title_error: bool,
    /// The entry is important (the flag beside the title).
    pub priority: bool,
    /// The actions behind Strg+K, when open.
    pub menu: Option<MenuView>,
    /// What the footer names and offers.
    pub context: Context,
}

/// The open actions: what they are about and the lines left after the search.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MenuView { pub title: String, pub items: Vec<actions::Item>, pub pick: usize, pub app_menu: bool }

/// Where the keyboard is, for the footer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Context {
    /// The search bar and the day view; `entry`: a line is chosen there.
    #[default]
    Day,
    DayLine,
    Entry,
    NotesList,
    NotesRead,
    NotesEdit,
}

/// What the window has to do after a key.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Effect {
    /// The input gets this text, all selected.
    pub text: Option<String>,
    /// Then only this part of it is selected (byte offsets): a gap of a template's title.
    pub select: Option<(usize, usize)>,
    /// A tag was just made in a picker: the tag editor opens on it.
    pub edit_tag: Option<String>,
    pub hide: bool,
    /// Created: show it briefly, then hide.
    pub hide_soon: bool,
    pub quit: bool,
    pub board: Option<crate::board::Period>,
    /// The settings window is to open.
    pub settings: bool,
    /// The search bar gets this text.
    pub search: Option<String>,
    pub search_cursor: Option<usize>,
    pub attachment: Option<uuid::Uuid>,
    /// Where the keyboard goes.
    pub focus: Option<Pane>,
    /// The text of the line written in the day view (`Pane::DayEdit`) or of the panel's input (`Pane::SideText`).
    pub day_text: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pane { Search, Entry,
    /// The day view's keys (its focus scope; the panel at the left too).
    Day,
    /// The text input of a line of the day view.
    DayEdit,
    /// The text input of the popover's pickers (a tag filter, an icon search, a description).
    SideText,
    /// The search of the actions (Strg+K).
    Menu,
    /// The notepad's own inputs.
    Notes,
}

/// A command offered under the search bar.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Command {
    pub name: String, pub detail: String, pub look: SearchRow, action: CommandAction,
}

impl Command {
    pub fn has_preview(&self) -> bool {
        matches!(self.action, CommandAction::Hit(..) | CommandAction::Day(_) | CommandAction::Card(..))
    }

    pub fn primary_label(&self, language: Language) -> &'static str {
        use crate::texts::search;
        let label = match self.action {
            CommandAction::Filter(..) => search::APPLY_FILTER,
            CommandAction::Hit(..) | CommandAction::Day(_) | CommandAction::Card(..) => search::OPEN,
            _ => search::RUN,
        };
        label[usize::from(language == Language::En)]
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SearchRow {
    pub heading: String, pub icon: &'static str, pub tag: String, pub color: Option<calendar::Rgb>,
    pub snippet: String, pub description: String, pub words: Vec<String>, pub sigil: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CommandAction {
    Board(crate::board::Period), BoardHelp, Filter(String, usize), Card(uuid::Uuid, bool), Entry, Notepad, Hit(NaiveDate, String), Day(NaiveDate),
    PickDay, Today, Undo, Redo, Rating, Activities,
    /// `#Name`: a new entry from the template. `/Vorlage Name`: the template is written (made or changed).
    Template(String), TemplateEdit(String), TemplateHelp,
}

#[derive(Default)]
pub struct NotepadChoice {
    pub key: String,
    pub group: String,
    pub title: String,
    pub detail: String,
    pub color: Option<calendar::Rgb>,
    /// The list of notes as a tree: how deep the line is, whether it is a folder (open or not), the cursor, its icon.
    pub depth: usize,
    pub folder: bool,
    pub open: bool,
    pub selected: bool,
    pub icon: &'static str,
}

pub struct Form {
    pub(crate) journal: Option<Journal>,
    pub board_scopes: Option<Vec<crate::board::Period>>,
    snapshot: Option<Snapshot>,
    pub language: Language,
    pub preferences: crate::settings::Preferences,
    today: NaiveDate,
    now: u32,
    v: Values,
    /// The values when the active field was entered (`Esc` brings them back).
    backup: Values,
    active: usize,
    buffer: String,
    row_error: Option<String>,
    /// What is typed into the tag or icon field: it filters the choices.
    query: String,
    /// The highlighted choice under the active line.
    pick: usize,
    /// The repetition's sentence and where its keyboard is.
    editor: Editor,
    /// The actions behind Strg+K, while open.
    pub menu: Option<actions::Menu>,
    /// Creating was tried: a missing title is named from now on.
    tried: bool,
    last_saved: Option<Saved>,
    status: Option<(String, bool)>,
    flash: Option<String>,
    /// Sizes of the calendar, from the theme.
    pub metrics: Metrics,
    /// The open options of the active field, and the values from before they opened (`Esc` brings them back).
    options: Option<Options>,
    options_backup: Values,
    /// The day at the top of the calendar and how far it is scrolled out of view.
    cal_top: NaiveDate,
    cal_offset: f32,
    /// The day the calendar was last brought to (it only moves again when that changes).
    cal_target: Option<NaiveDate>,
    /// Days opened with a click, and the last one clicked (Shift+click opens everything up to it).
    cal_open: BTreeSet<NaiveDate>,
    cal_clicked: Option<NaiveDate>,
    /// A right-button drag marking a new entry, and the calendar as it was when the button went down: the draft may
    /// change the days' heights while dragging, the pointer is matched against what was under it.
    mark: Option<MarkDrag>,
    mark_layout: Option<(Layout, Metrics)>,
    /// What the calendar shows now (the mouse is matched against it).
    shown_layout: Layout,
    shown_entries: Vec<Option<(NaiveDate, String)>>,
    shown_metrics: Metrics,
    /// The moment given to `at` stays (tests); otherwise each showing reads the clock.
    fixed_clock: bool,
    /// Milliseconds since 1970 when the clock is fixed (tests: timers).
    pub clock_ms: i64,
    /// The type was chosen on purpose (then the calendar leaves it alone).
    kind_chosen: bool,
    /// What is shown at the left: the search bar alone, or the entry form under it.
    entry_open: bool,
    search: String,
    search_cursor: usize,
    hits: Vec<Command>,
    editing: Option<(NaiveDate, journal_core::storage::Entry)>,
    command_selected: usize,
    notepad: Option<notepad::Draft>,
    suspended_notes: Vec<notepad::Draft>,
    /// How much taller the days are (Strg+wheel), how much wider the hours (Strg+Shift+wheel), and the minute at the
    /// left edge of the hours (Shift+wheel).
    zoom_days: f32,
    zoom_hours: f32,
    pan: f32,
    /// The day the day view shows when it is not today (chosen in the calendar or with Alt+←/→); none follows today.
    view_day: Option<NaiveDate>,
    /// What the calendar marks as the day view's day.
    cal_selected: BTreeSet<NaiveDate>,
    /// The day view as something to work in: its cursor, the line being written, the panel at the left.
    pub pane: DayPane,
    /// The templates (`#Name`), and the name of the one being written in the form (`/Vorlage Name`).
    pub templates: crate::templates::Templates,
    template: Option<String>,
    /// Where the gap of the title chosen last begins (Tab goes on to the gap after it).
    gap_at: Option<usize>,
    /// A tag made in a picker that only hands back a choice (the notepad): the window opens the tag editor on it.
    tag_edit: Option<String>,
    /// The notepad's list: its cursor, folders closed, what is moved or named; what is typed in it; text it is to get.
    pub(crate) notes_list: crate::notes_list::List,
    notes_query: String,
    notes_query_set: Option<String>,
    /// The form was filled from a template: its title stays as written (its words are not read as a day or a tag).
    from_template: bool,
}

/// The options of a field, open after Enter.
#[derive(Clone, Debug, PartialEq)]
enum Options {
    /// The date in the calendar, with the keyboard.
    Calendar(CalCursor),
    /// A time on the clock (the start or the end).
    Clock(Clock),
    /// The tag, icon or reminder lists.
    Choices,
    /// The repetition's lines.
    Repeat,
    RepeatDate { field: DateField, cursor: NaiveDate },
    PlanDates(day_pane::PlanCursor),
    GoToDate(NaiveDate),
}

/// The keyboard in the calendar: on the side of the days (whole days) or in the 24 hours (a moment); with Shift a range
/// from where Shift was first held.
#[derive(Clone, Copy, Debug, PartialEq)]
struct CalCursor { hours: bool, day: NaiveDate, minute: u32, anchor: Option<(NaiveDate, u32)> }

/// The clock: the hours or the minutes have the arrows; digits typed so far.
#[derive(Clone, Debug, PartialEq)]
struct Clock { end: bool, minutes: bool, typed: String }

/// A new entry marked with the right mouse button, as in the app.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MarkDrag {
    /// On the side of the days: whole days, from one to the other.
    Days(NaiveDate, NaiveDate),
    /// In the 24 hours: from one moment to another, also over midnight and several days.
    Time((NaiveDate, u32), (NaiveDate, u32)),
}

fn now() -> (NaiveDate, u32) {
    let now = Local::now();
    (now.date_naive(), now.hour() * 60 + now.minute())
}

/// A template's type ("calendar", "event", "task", "note"; anything else a task).
fn type_of(kind: &str) -> Type {
    match kind { "calendar" => Type::Calendar, "event" => Type::Event, "note" => Type::Note, _ => Type::Task }
}

fn ranges(days: &BTreeSet<NaiveDate>) -> Vec<(NaiveDate, NaiveDate)> {
    let mut out: Vec<(NaiveDate, NaiveDate)> = Vec::new();
    for day in days {
        match out.last_mut().filter(|last| repeat::shift(last.1, 1) == *day) { Some(last) => last.1 = *day, None => out.push((*day, *day)) }
    }
    out
}

/// A clock time: "14", "14:30", "1430", "930", "2pm"; with `midnight` also "24"/"24:00" (the end of the day).
fn parse_clock(text: &str, midnight: bool) -> Option<u32> {
    let text = text.trim().to_lowercase();
    if midnight && (text == "24" || text == "24:00") { return Some(1440); }
    if (3..=4).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_digit()) {
        let (hours, minutes) = text.split_at(text.len() - 2);
        let (hours, minutes) = (hours.parse::<u32>().ok()?, minutes.parse::<u32>().ok()?);
        return (hours <= 23 && minutes <= 59).then_some(hours * 60 + minutes);
    }
    parse::parse_time(&text)
}

/// A length: "45", "45 min", "1,5h", "1h30", "2 Std.", "1 Tag", "2 days", "1 Woche" → minutes.
fn parse_length(text: &str) -> Option<i64> {
    let text = text.trim().to_lowercase().replace(',', ".");
    let (mut total, mut number, mut seen) = (0.0f64, String::new(), false);
    let mut rest = text.as_str();
    while !rest.is_empty() {
        let c = rest.chars().next()?;
        if c.is_ascii_digit() || c == '.' { number.push(c); rest = &rest[1..]; continue; }
        if c.is_whitespace() { rest = &rest[1..]; continue; }
        let word: String = rest.chars().take_while(|c| c.is_alphabetic() || *c == '.').collect();
        rest = &rest[word.len()..];
        let word = word.trim_end_matches('.');
        let unit = match word {
            "m" | "min" | "mins" | "minute" | "minuten" | "minutes" => 1.0,
            "h" | "std" | "stunde" | "stunden" | "hour" | "hours" => 60.0,
            "d" | "t" | "tag" | "tage" | "day" | "days" => 1440.0,
            "w" | "woche" | "wochen" | "week" | "weeks" => 10080.0,
            _ => return None,
        };
        total += number.parse::<f64>().ok()? * unit;
        number.clear();
        seen = true;
    }
    if !number.is_empty() {
        // A number after a unit is the next smaller one ("1h30"); alone it is minutes.
        total += number.parse::<f64>().ok()?;
        seen = true;
    }
    seen.then_some(total.round() as i64)
}

/// A length in words: "45 Min.", "1 Std. 30 Min.", "2 Tage".
fn length_text(minutes: i64, ft: &FormTexts) -> String {
    if minutes > 0 && minutes % 1440 == 0 { let days = minutes / 1440; return format!("{days} {}", if days == 1 { ft.day } else { ft.days }); }
    let (hours, rest) = (minutes / 60, minutes % 60);
    match (hours, rest) { (0, m) => format!("{m} {}", ft.minutes), (h, 0) => format!("{h} {}", ft.hours), (h, m) => format!("{h} {} {m} {}", ft.hours, ft.minutes) }
}

/// The days, kind and mode a draft says (from a typed day or a quick title).
fn days_of(draft: &Draft, kind: Kind) -> Option<(BTreeSet<NaiveDate>, Mode)> {
    let mut set: BTreeSet<NaiveDate> = draft.dates.iter().copied().collect();
    let spans = if draft.spans.is_empty() { draft.span.into_iter().collect::<Vec<_>>() } else { draft.spans.clone() };
    for (first, last) in spans {
        for n in 0..=repeat::days_between(first, last).clamp(0, 3660) { set.insert(repeat::shift(first, n)); }
    }
    if set.is_empty() { return None; }
    // A range of days is one entry over all of them (repeating is the repetition's business); single days separated
    // by commas are entries of their own.
    let _ = kind;
    Some((set, Mode::Continuous))
}

impl Form {
    pub fn new(journal: Option<Journal>, language: Language) -> Self {
        let (today, minutes) = now();
        Self { fixed_clock: false, ..Self::at(journal, language, today, minutes) }
    }

    /// At a given moment (tests).
    pub fn at(journal: Option<Journal>, language: Language, today: NaiveDate, minutes: u32) -> Self {
        let snapshot = journal.as_ref().and_then(|journal| Snapshot::load(&journal.store, today).ok());
        let v = Values::default();
        Form { journal, snapshot, language, preferences: Default::default(), today, now: minutes, backup: v.clone(), v, active: TITLE, buffer: String::new(), row_error: None, query: String::new(),
            pick: 0, editor: Editor::default(), menu: None, tried: false, last_saved: None, status: None, flash: None,
            metrics: Metrics::default(), options: None, options_backup: Values::default(), cal_top: repeat::shift(today, -1), cal_offset: 0.0, cal_target: None,
            cal_open: BTreeSet::from([today]), cal_clicked: None, mark: None, mark_layout: None, shown_layout: Layout::default(), shown_entries: Vec::new(), shown_metrics: Metrics::default(),
            board_scopes: None, fixed_clock: true, clock_ms: 0, kind_chosen: false, entry_open: false, hits: Vec::new(), editing: None, search: String::new(), search_cursor: 0, command_selected: 0, notepad: None, suspended_notes: Vec::new(), zoom_days: 1.0, zoom_hours: 1.0, pan: 0.0, view_day: None, cal_selected: BTreeSet::new(), pane: DayPane::default(),
            templates: Default::default(), template: None, gap_at: None, from_template: false, tag_edit: None, notes_list: Default::default(), notes_query: String::new(), notes_query_set: None }
    }

    fn t(&self) -> &'static Texts { texts(self.language) }
    fn ft(&self) -> &'static FormTexts { form_texts(self.language) }
    pub fn field(&self) -> Field { FIELDS[self.active] }
    pub fn editing_entry(&self) -> bool { self.editing.is_some() }
    #[cfg(test)]
    pub fn title(&self) -> &str { &self.v.title }

    fn tags(&self) -> Vec<TagName> {
        self.snapshot.as_ref().map(|snapshot| snapshot.tags.iter().map(|tag| TagName { id: tag.id.clone(), name: tag.name.clone() }).collect()).unwrap_or_default()
    }
    fn tag_name(&self, id: &str) -> Option<String> { self.tags().into_iter().find(|tag| tag.id == id).map(|tag| tag.name) }

    /// The window was shown: the moment and the warm data are brought up to date.
    pub fn shown(&mut self) -> Effect {
        let (today, minutes) = if self.fixed_clock { (self.today, self.now) } else { now() };
        self.set_clock(today, minutes);
        if let Some(draft) = &mut self.notepad {
            if draft.confirm_discard {
                draft.confirm_discard = false;
                self.status = None;
            }
            return Effect::default();
        }
        self.options = None;
        self.cal_close();
        if self.preferences.return_today {
            self.cal_top = repeat::shift(today, -1); self.cal_offset = 0.0; self.cal_target = None;
            self.view_day = None;
        }
        self.pane.reset();
        if !self.dirty() { self.template = None; self.from_template = false; self.entry_open = self.preferences.start_view == crate::settings::StartView::Entry; }
        let effect = self.enter_row(TITLE);
        Effect { focus: Some(if self.entry_open { Pane::Entry } else { Pane::Search }), ..effect }
    }
    pub fn set_clock(&mut self, today: NaiveDate, minutes: u32) {
        self.today = today;
        self.now = minutes;
        if let (Some(journal), Some(snapshot)) = (&self.journal, &mut self.snapshot) {
            if snapshot.refresh(&journal.store, today).unwrap_or(false) && !self.search.is_empty() {
                self.search_at(&self.search.clone(), self.search_cursor);
            }
        }
        self.flash = None;
    }

    // ----- The search bar and its commands -----

    /// The search bar's text changed.
    pub fn search_edited(&mut self, text: &str) {
        self.search_at(text, text.len());
    }

    pub fn search_at(&mut self, text: &str, cursor: usize) {
        if matches!(self.options, Some(Options::GoToDate(_))) { self.options = None; }
        self.search = text.to_string();
        self.search_cursor = cursor;
        self.command_selected = 0;
        self.status = None;
        self.flash = None;
        self.hits.clear();
        if !text.trim().is_empty() && !text.trim_start().starts_with(['/', '#']) {
            match self.find_entries(text, cursor) {
                Ok(hits) => self.hits = hits,
                Err(error) => self.status = Some((error, true)),
            }
        }
    }

    pub fn move_search_cursor(&mut self, text: &str, cursor: usize) -> bool {
        if text != self.search || cursor == self.search_cursor || !text.contains(['@', '\\']) { return false; }
        self.search_at(text, cursor);
        true
    }

    fn commands(&self) -> Vec<Command> {
        let query = self.search.trim();
        if let Some(name) = query.strip_prefix('#') { return self.template_commands(name); }
        if !query.starts_with('/') { return self.hits.clone(); }
        // `/Vorlage ` with its space already lists the templates there are.
        if let Some(commands) = self.template_command(&self.search.trim_start()[1..]) { return commands; }
        let query = parse::fold(&query[1..]);
        let notepad = notepad_texts(self.language);
        let actions = crate::texts::action_texts(self.language);
        let day = crate::texts::day_texts(self.language);
        let ft = self.ft();
        let all = [
            ("/Entry".into(), ["entry", "eintrag"], ft.cmd_entry, "journal-pencil", CommandAction::Entry),
            (notepad.command.into(), ["notepad", "notizblock"], notepad.command_detail, "notebook-pen", CommandAction::Notepad),
            (format!("/{}", ft.cmd_day), ["day", "tag"], ft.cmd_day_detail, "journal-calendar", CommandAction::PickDay),
            (format!("/{}", day.today), ["today", "heute"], actions.today, "calendar-check", CommandAction::Today),
            (format!("/{}", actions.undo), ["undo", "ruckgangig"], actions.undo, "undo-2", CommandAction::Undo),
            (format!("/{}", actions.redo), ["redo", "wiederherstellen"], actions.redo, "redo-2", CommandAction::Redo),
            (format!("/{}", day.rating), ["rating", "bewertung"], day.rating, "gauge", CommandAction::Rating),
            (format!("/{}", day.activities), ["activities", "aktivitaten"], day.activities, "activity", CommandAction::Activities),
        ];
        let mut matching: Vec<_> = all.into_iter().filter(|(_, names, ..)| names.iter().any(|name| name.starts_with(&query))).collect();
        matching.sort_by_key(|(_, names, ..)| !names.contains(&query.as_str()));
        let mut commands: Vec<_> = matching.into_iter()
            .map(|(name, _, detail, icon, action)| Command { name, detail: detail.into(), look: SearchRow { icon, ..Default::default() }, action }).collect();
        let en = self.language == Language::En;
        if crate::texts::templates::COMMAND_WORDS.iter().any(|word| word.starts_with(&query)) {
            let tt = usize::from(en);
            commands.push(Command { name: format!("{} ", crate::texts::templates::COMMAND[tt]), detail: crate::texts::templates::COMMAND_DETAIL[tt].into(),
                look: SearchRow { icon: "copy-plus", ..Default::default() }, action: CommandAction::TemplateHelp });
        }
        if let Some(enabled) = &self.board_scopes {
            for period in crate::board::Period::ALL {
                if enabled.contains(&period) && [Language::De, Language::En].iter().any(|lang| parse::fold(&period.command(*lang)[1..]).starts_with(&query)) {
                    commands.push(Command { name: period.command(self.language).into(), detail: if en {"Open board"}else{"Pinnwand öffnen"}.into(),look:SearchRow { icon: "panels-top-left", ..Default::default() },action:CommandAction::Board(period) });
                }
            }
        } else if !query.is_empty() && ["pinnwand","board"].iter().any(|s|s.starts_with(&query)||query.starts_with(s)) {
            commands.push(Command {name: if en {"Board"}else{"Pinnwand"}.into(), detail: crate::board_ui::projection_hint(self.language).into(),look:SearchRow { icon: "panels-top-left", ..Default::default() },action:CommandAction::BoardHelp});
        }
        if let Some(first) = commands.first_mut() {
            first.look.heading = crate::texts::search::COMMANDS[usize::from(en)].into();
        }
        commands
    }

    fn searching(&self) -> bool {
        !self.entry_open && self.notepad.is_none() && !self.search.trim().is_empty()
    }

    pub fn choose_command(&mut self, index: usize) -> Effect {
        if self.entry_open || self.notepad.is_some() { return Effect::default(); }
        match self.commands().get(index).map(|command| command.action.clone()) {
            Some(CommandAction::Filter(query, cursor)) => {
                self.search_at(&query, cursor);
                Effect { search: Some(query), search_cursor: Some(cursor), focus: Some(Pane::Search), ..Effect::default() }
            }
            Some(CommandAction::Card(id, attachment)) => {
                let effect = self.open_notepad();
                if !attachment { self.pick_notepad(&id.to_string()); }
                Effect { attachment: attachment.then_some(id), focus: Some(Pane::Notes), ..effect }
            }
            Some(CommandAction::Hit(date, id)) => self.edit_hit(date, &id),
            Some(CommandAction::Day(date)) => {
                self.search_edited("");
                self.show_day(date);
                Effect { search: Some(String::new()), focus: Some(Pane::Day), ..Effect::default() }
            }
            Some(CommandAction::Entry) => self.open_entry(),
            Some(CommandAction::Template(name)) => self.open_template(&name),
            Some(CommandAction::TemplateEdit(name)) => self.write_template(&name),
            Some(CommandAction::TemplateHelp) => {
                let name = format!("{} ", crate::texts::templates::COMMAND[usize::from(self.language == Language::En)]);
                self.search_edited(&name);
                Effect { search: Some(name.clone()), search_cursor: Some(name.len()), focus: Some(Pane::Search), ..Effect::default() }
            }
            Some(CommandAction::Board(period)) => {
                self.search_edited("");
                Effect {board:Some(period),search:Some(String::new()),..Effect::default()}
            }
            Some(CommandAction::BoardHelp) => { self.status=Some((crate::board_ui::projection_hint(self.language).into(),false)); Effect::default() }
            Some(CommandAction::Notepad) => self.open_notepad(),
            Some(action @ (CommandAction::PickDay | CommandAction::Today | CommandAction::Undo |
                CommandAction::Redo | CommandAction::Rating | CommandAction::Activities)) => {
                self.search_edited("");
                let effect = match action {
                    CommandAction::PickDay => {
                        self.options = Some(Options::GoToDate(self.day_shown()));
                        Effect { focus: Some(Pane::Search), ..Effect::default() }
                    }
                    CommandAction::Today => self.run(ActionId::Today, None),
                    CommandAction::Undo => self.run(ActionId::Undo, None),
                    CommandAction::Redo => self.run(ActionId::Redo, None),
                    _ => {
                        let rating = action == CommandAction::Rating;
                        let out = self.with_pane(|pane, cx| pane.focus_period(cx, rating));
                        self.pane_effect(out)
                    }
                };
                Effect { search: Some(String::new()), ..effect }
            }
            None => {
                let l = usize::from(self.language == Language::En);
                if self.search.trim().starts_with('/') {
                    self.status = Some((format!("{} {}", self.ft().cmd_unknown, self.search.trim()), true));
                } else if self.search.trim().starts_with('#') {
                    let text = if self.templates.list.is_empty() { crate::texts::templates::NONE_YET[l] } else { crate::texts::templates::NONE[l] };
                    self.status = Some((text.into(), true));
                }
                Effect::default()
            }
        }
    }

    fn search_key(&mut self, key: Key, mods: Mods) -> Effect {
        let commands = self.commands();
        match key {
            Key::Left | Key::Right if mods.alt => { self.show_day(repeat::shift(self.day_shown(), if key == Key::Left { -1 } else { 1 })); Effect::default() }
            Key::Home if mods.alt => { self.show_today(); Effect::default() }
            Key::Undo => self.undo_last(false),
            Key::Redo => self.undo_last(true),
            Key::Quit => Effect { quit: true, ..Effect::default() },
            Key::Focus => { self.open_entry(); let effect = self.open_options(Field::Day); Effect { focus: Some(Pane::Entry), ..effect } }
            // ↓ (or Tab) without commands: into the day view.
            Key::Down | Key::Tab if commands.is_empty() && !self.searching() => { let out = self.with_pane(|pane, cx| pane.enter(cx)); self.pane_effect(out) }
            Key::Up | Key::Down if !commands.is_empty() => {
                let n = commands.len();
                self.command_selected = (self.command_selected + if key == Key::Down { 1 } else { n - 1 }) % n;
                Effect::default()
            }
            Key::Tab if commands.get(self.command_selected).is_some_and(|c| matches!(c.action, CommandAction::Filter(..))) => self.choose_command(self.command_selected),
            Key::Tab if !commands.is_empty() => {
                let name = commands[self.command_selected.min(commands.len() - 1)].name.clone();
                self.search_edited(&name);
                Effect { search: Some(name), ..Effect::default() }
            }
            Key::Enter => self.choose_command(self.command_selected),
            Key::Escape if !self.search.is_empty() => { self.search_edited(""); Effect { search: Some(String::new()), ..Effect::default() } }
            Key::Escape => Effect { hide: true, ..Effect::default() },
            _ => Effect::default(),
        }
    }

    /// `/Entry`: the entry form opens under the search bar, with the cursor in the title.
    fn open_entry(&mut self) -> Effect {
        self.entry_open = true;
        self.search.clear();
        self.hits.clear();
        self.status = None;
        let effect = self.enter_row(TITLE);
        Effect { search: Some(String::new()), focus: Some(Pane::Entry), ..effect }
    }

    /// The form closes and what was in it is dropped; the search bar has the keyboard again.
    fn close_entry(&mut self) -> Effect {
        self.entry_open = false;
        self.editing = None;
        self.template = None;
        self.gap_at = None;
        self.from_template = false;
        self.v = Values::default();
        self.kind_chosen = false;
        self.tried = false;
        self.options = None;
        self.cal_close();
        let effect = self.enter_row(TITLE);
        Effect { focus: Some(Pane::Search), ..effect }
    }

    // ----- Templates (`#Name`, `/Vorlage Name`) -----

    /// `#…`: the templates whose name matches, each opening a new entry from it.
    fn template_commands(&self, name: &str) -> Vec<Command> {
        let l = usize::from(self.language == Language::En);
        let mut out: Vec<Command> = self.templates.matching(name).into_iter().map(|t| {
            let icon = t.icon.as_deref().and_then(|own| icons::all().iter().find(|(id, _)| *id == own).map(|(id, _)| *id))
                .unwrap_or(["journal-calendar", "journal-event", "journal-task", "journal-note"][type_of(&t.kind).index()]);
            let detail = if t.title.trim().is_empty() { crate::texts::templates::OPEN[l].to_string() } else { t.title.clone() };
            Command { name: format!("#{}", t.name), detail, look: SearchRow { icon, ..Default::default() }, action: CommandAction::Template(t.name.clone()) }
        }).collect();
        if let Some(first) = out.first_mut() { first.look.heading = crate::texts::templates::HEADING[l].into(); }
        out
    }

    /// `/Vorlage Name`: the template of that name is written (made, or changed when it is there). `None`: it is not
    /// this command (or it has no name yet: then it is listed with the others).
    fn template_command(&self, query: &str) -> Option<Vec<Command>> {
        let (word, name) = query.split_once(char::is_whitespace)?;
        let word = parse::fold(word);
        if !crate::texts::templates::COMMAND_WORDS.iter().any(|known| *known == word) { return None; }
        let l = usize::from(self.language == Language::En);
        let command = crate::texts::templates::COMMAND[l];
        let name = crate::templates::clean_name(name);
        let mut out = Vec::new();
        if !name.is_empty() {
            let known = self.templates.find(&name);
            let detail = if known.is_some() { crate::texts::templates::CHANGE[l] } else { crate::texts::templates::MAKE[l] };
            let name = known.map_or(name.clone(), |t| t.name.clone());
            out.push(Command { name: format!("{command} {name}"), detail: detail.into(), look: SearchRow { icon: "copy-plus", ..Default::default() }, action: CommandAction::TemplateEdit(name) });
        }
        // The templates there are, to change one.
        let typed = self.templates.find(&name).map(|t| t.name.clone());
        for t in self.templates.matching(&name) {
            if Some(&t.name) == typed.as_ref() { continue; }
            out.push(Command { name: format!("{command} {}", t.name), detail: crate::texts::templates::CHANGE[l].into(), look: SearchRow { icon: "pencil", ..Default::default() }, action: CommandAction::TemplateEdit(t.name.clone()) });
        }
        if let Some(first) = out.first_mut() { first.look.heading = crate::texts::templates::HEADING[l].into(); }
        Some(out)
    }

    /// The form's values from a template, for an entry on `day`.
    fn values_of(t: &crate::templates::Template, day: NaiveDate) -> Values {
        Values {
            typ: type_of(&t.kind), title: t.title.clone(), start: t.start, end: t.start.and(t.end),
            rule: t.repeat.as_ref().map(|rule| repeat::with_start(rule, day)), tag: t.tag.clone(),
            description: t.description.clone(), priority: t.priority, reminder: t.reminder, icon: t.icon.clone(),
            ..Values::default()
        }
    }

    /// The form as a template of this name.
    fn template_of(&self, name: &str) -> crate::templates::Template {
        let v = &self.v;
        crate::templates::Template {
            name: name.to_string(), kind: ["calendar", "event", "task", "note"][v.typ.index()].into(), title: v.title.trim().to_string(),
            start: v.start, end: v.start.and(v.end), repeat: v.rule.clone(), tag: v.tag.clone(), description: v.description.trim().to_string(),
            priority: v.priority, reminder: v.reminder, icon: v.icon.clone(),
        }
    }

    /// `#Name`: a new entry from the template on the day shown, its first gap selected.
    fn open_template(&mut self, name: &str) -> Effect {
        let Some(t) = self.templates.find(name).cloned() else { return Effect::default() };
        let day = self.day_shown();
        self.v = Self::values_of(&t, day);
        if day != self.today { self.v.days = BTreeSet::from([day]); }
        self.editing = None;
        self.template = None;
        self.from_template = true;
        self.kind_chosen = true;
        self.tried = false;
        self.options = None;
        self.entry_open = true;
        self.search.clear();
        self.hits.clear();
        self.status = None;
        let effect = self.enter_row(TITLE);
        let select = self.select_gap(None);
        Effect { search: Some(String::new()), focus: Some(Pane::Entry), select, ..effect }
    }

    /// `/Vorlage Name`: the form opens for the template (with what it has when it is there), without a day.
    fn write_template(&mut self, name: &str) -> Effect {
        let name = crate::templates::clean_name(name);
        if name.is_empty() { return Effect::default(); }
        if self.dirty() { self.status = Some((self.ft().finish_entry_first.into(), true)); return Effect::default(); }
        let known = self.templates.find(&name).cloned();
        self.v = known.as_ref().map_or_else(Values::default, |t| Self::values_of(t, self.today));
        self.template = Some(known.map_or(name, |t| t.name));
        self.from_template = false;
        self.editing = None;
        self.kind_chosen = true;
        self.tried = false;
        self.options = None;
        self.entry_open = true;
        self.search.clear();
        self.hits.clear();
        self.status = None;
        let effect = self.enter_row(TITLE);
        Effect { search: Some(String::new()), focus: Some(Pane::Entry), ..effect }
    }

    /// The template being written is kept, and the form closes.
    fn save_template(&mut self, name: &str) -> Effect {
        let l = usize::from(self.language == Language::En);
        let template = self.template_of(name);
        match self.templates.put(template) {
            Ok(()) => {
                let effect = self.close_entry();
                self.flash = Some(crate::texts::templates::SAVED[l].into());
                effect
            }
            Err(error) => { self.status = Some((format!("{} {error}", crate::texts::templates::WRITE_FAILED[l]), true)); Effect::default() }
        }
    }

    fn delete_template(&mut self) -> Effect {
        let l = usize::from(self.language == Language::En);
        let Some(name) = self.template.clone() else { return Effect::default() };
        match self.templates.remove(&name) {
            Ok(_) => {
                let effect = self.close_entry();
                self.flash = Some(crate::texts::templates::DELETED[l].into());
                effect
            }
            Err(error) => { self.status = Some((format!("{} {error}", crate::texts::templates::WRITE_FAILED[l]), true)); Effect { focus: Some(Pane::Entry), ..Effect::default() } }
        }
    }

    /// An entry from a template repeats from its own first day: when the day is changed, the repetition follows it.
    fn follow_template_day(&mut self) {
        if !self.from_template { return; }
        let first = self.v.days.iter().next().copied().unwrap_or(self.today);
        if let Some(rule) = &self.v.rule {
            if rule.start != first { self.v.rule = Some(repeat::with_start(rule, first)); }
        }
    }

    /// The title's next gap after the one chosen last (none: the first) is selected.
    fn select_gap(&mut self, after: Option<usize>) -> Option<(usize, usize)> {
        let gap = crate::templates::next_gap(&self.buffer, after)?;
        self.gap_at = Some(gap.start);
        Some((gap.start, gap.end))
    }

    // ----- Text of the fields -----

    fn days_text(&self) -> String {
        let parts = ranges(&self.v.days);
        if parts.is_empty() { return String::new(); }
        let text = parts.iter().map(|(first, last)| if first == last { first.format("%d.%m.%Y").to_string() } else { format!("{}–{}", first.format("%d.%m.%Y"), last.format("%d.%m.%Y")) }).collect::<Vec<_>>().join(", ");
        text
    }

    fn reminder_text(&self) -> String {
        match self.v.reminder { None => String::new(), Some(0) => self.ft().reminder_at_time.into(), Some(minutes) => length_text(minutes, self.ft()) }
    }

    /// What the input holds while the field is active.
    fn text_of(&self, field: Field) -> String {
        match field {
            Field::Title => self.v.title.clone(),
            Field::Day => self.days_text(),
            Field::Plan => self.v.plan_days.iter().map(|d| d.format("%d.%m.%Y").to_string()).collect::<Vec<_>>().join(", "),
            Field::Start => self.v.start.map(format_time).unwrap_or_default(),
            Field::End => self.v.start.and(self.v.end).map(format_time).unwrap_or_default(),
            Field::Repeat => self.v.rule.as_ref().map(|rule| repeat_sentence::expression(rule, self.language)).unwrap_or_default(),
            Field::Tag => self.v.tag.as_deref().and_then(|id| self.tag_name(id)).unwrap_or_default(),
            Field::Description => self.v.description.clone(),
            Field::Reminder => self.reminder_text(),
            Field::Icon => self.v.icon.clone().unwrap_or_default(),
            Field::Kind | Field::More | Field::Priority => String::new(),
        }
    }

    /// What the field shows while it is not active.
    fn shown_value(&self, field: Field) -> String {
        let ft = self.ft();
        match field {
            Field::Kind => ft.types[self.v.typ.index()].to_string(),
            Field::Day => match self.v.days.len() {
                0 => String::new(),
                1 => {
                    let day = *self.v.days.iter().next().unwrap();
                    let relative = match repeat::days_between(self.today, day) { 0 => Some(self.t().today), 1 => Some(self.t().tomorrow), 2 => Some(self.t().after_tomorrow), _ => None };
                    let label = format!("{} {}", repeat::weekday_short(self.language)[repeat::weekday_of(day) as usize], day.format("%d.%m.%Y"));
                    relative.map_or(label.clone(), |relative| format!("{label} · {relative}"))
                }
                _ => self.days_text(),
            },
            Field::End => match (self.v.start, self.v.end) {
                (Some(start), Some(end)) => {
                    // An end on a later day says how many days later.
                    let span = ranges(&self.v.days).first().map_or(0, |(first, last)| repeat::days_between(*first, *last));
                    let later = if span > 0 { span } else { i64::from(end <= start) };
                    match later { 0 => format_time(end), n => format!("{} (+{n} {})", format_time(end), if n == 1 { ft.day } else { ft.days }) }
                }
                _ => self.text_of(Field::End),
            },
            Field::Repeat => self.v.rule.as_ref().map(|rule| repeat::describe(rule, self.language)).unwrap_or_default(),
            Field::More => String::new(),
            Field::Priority => if self.v.priority { ft.priority_on.to_string() } else { String::new() },
            Field::Reminder => match self.v.reminder { None => String::new(), Some(0) => ft.reminder_at_time.into(), Some(_) => format!("{} {}", self.reminder_text(), ft.reminder_before) },
            other => self.text_of(other),
        }
    }

    fn line_icon(field: Field) -> &'static str {
        match field.line() { 1 => "type", 2 => "clock", 3 => "repeat", 4 => "tag", 5 => "ellipsis", 6 => "text-align-start", 7 => "star", 8 => "bell", 9 => "shapes", 10 => "calendar", _ => "" }
    }

    fn hint_of(&self, field: Field) -> &'static str {
        let ft = self.ft();
        match field {
            Field::Plan => ft.plan_hint, Field::Title => ft.empty_title, Field::Day => ft.empty_day, Field::Start => ft.empty_start, Field::End => ft.empty_end, Field::Repeat => ft.empty_repeat,
            Field::Tag => ft.empty_tag, Field::Description => ft.empty_description, Field::Reminder => ft.empty_reminder, Field::Icon => ft.empty_icon,
            Field::Priority => ft.priority_off, _ => "",
        }
    }

    /// A field the keyboard can reach: the end only after a start, the description only while it holds something or is
    /// being written (Strg+K, Alt+B). Reminder and icon are always there for a new entry; for one being changed only
    /// while they hold something or are being set (Alt+R/I). Important is the title's flag (Alt+P), not a line.
    fn visible(&self, field: Field) -> bool {
        let active = self.field() == field;
        let new = self.editing.is_none();
        match field {
            Field::Day => self.template.is_none(),
            Field::Plan => self.template.is_none() && (active || !self.v.plan_days.is_empty() || self.editing.is_some() && self.v.typ != Type::Note),
            Field::End => self.v.start.is_some(),
            Field::More | Field::Priority => false,
            Field::Description => active || !self.v.description.is_empty(),
            Field::Reminder => new || active || self.v.reminder.is_some(),
            Field::Icon => new || active || self.v.icon.is_some(),
            _ => true,
        }
    }

    // ----- Moving between fields -----

    fn enter_row(&mut self, index: usize) -> Effect {
        self.active = index;
        self.backup = self.v.clone();
        self.gap_at = None;
        self.row_error = None;
        self.query.clear();
        self.flash = None;
        let field = FIELDS[index];
        self.pick = match field {
            Field::Tag => self.tag_options().iter().position(|(id, _, _)| *id == self.v.tag).unwrap_or(0),
            Field::Icon => self.icon_results().iter().position(|name| Some(name.to_string()) == self.v.icon).unwrap_or(0),
            Field::Reminder => REMINDERS.iter().position(|r| *r == self.v.reminder).unwrap_or(usize::MAX),
            _ => 0,
        };
        self.buffer = self.text_of(field);
        Effect { text: Some(if field.text() { self.buffer.clone() } else { String::new() }), ..Effect::default() }
    }

    /// Finishes the active field: a problem in it keeps it open; a quick title hands its day, time and tag to theirs.
    fn commit(&mut self) -> Result<(), String> {
        if let Some(error) = &self.row_error { return Err(error.clone()); }
        if self.field() == Field::Title && self.editing.is_none() && self.template.is_none() && !self.from_template && self.preferences.parse_titles { self.extract_title(); }
        Ok(())
    }

    fn extract_title(&mut self) {
        let draft = parse::parse(&self.v.title, self.today, &self.tags());
        let found = draft.kind.is_some() || !draft.dates.is_empty() || draft.span.is_some() || draft.time.is_some() || draft.tag.is_some() || draft.repeat.is_some();
        if !draft.unclear.is_empty() || draft.tag_word.is_some() { return; }
        if !found {
            // Quotes only protect the words; they are not part of the title.
            if self.v.title.trim_start().starts_with('"') && !draft.text.is_empty() { self.v.title = draft.text; self.buffer = self.v.title.clone(); }
            return;
        }
        let calendar_word = self.v.title.split_whitespace().any(|word| matches!(parse::fold(word).as_str(), "kalender" | "calendar" | "@calendar" | "@kalender"));
        match draft.kind {
            Some(Kind::Task) => { self.v.typ = Type::Task; self.kind_chosen = true; }
            Some(Kind::Note) => { self.v.typ = Type::Note; self.kind_chosen = true; }
            Some(Kind::Event) => { self.v.typ = if calendar_word { Type::Calendar } else { Type::Event }; self.kind_chosen = true; }
            // A time without a word for the type makes an appointment, as the app makes it in its calendar.
            None if draft.time.is_some() && !self.kind_chosen => self.v.typ = Type::Calendar,
            None => {}
        }
        if let Some((days, mode)) = days_of(&draft, self.v.typ.kind()) { self.v.days = days; self.v.mode = mode; }
        if draft.time.is_some() { self.v.start = draft.time; self.v.end = draft.end; }
        if draft.tag.is_some() { self.v.tag = draft.tag.clone(); }
        if draft.repeat.is_some() { self.v.rule = draft.repeat.clone(); }
        self.v.title = draft.text.clone();
        self.buffer = self.v.title.clone();
    }

    /// To the next field shown (or back).
    fn move_field(&mut self, delta: i32) -> Effect {
        if let Err(error) = self.commit() { self.status = Some((error, true)); return Effect::default(); }
        self.status = None;
        let mut index = self.active as i32;
        loop {
            index += delta;
            if index < 0 || index >= FIELDS.len() as i32 { return self.stay(); }
            if self.visible(FIELDS[index as usize]) { return self.enter_row(index as usize); }
        }
    }

    /// To the line above or below, at its first field.
    fn move_line(&mut self, delta: i32) -> Effect {
        if let Err(error) = self.commit() { self.status = Some((error, true)); return Effect::default(); }
        self.status = None;
        let line = self.field().line() as i32;
        let target = FIELDS.iter().filter(|f| self.visible(**f) && (f.line() as i32 - line).signum() == delta.signum())
            .min_by_key(|f| ((f.line() as i32 - line).abs(), f.cell()));
        match target { Some(field) => self.enter_row(field.index()), None => self.stay() }
    }

    /// Nothing to move to; the title may just have given its words to other fields.
    fn stay(&mut self) -> Effect {
        Effect { text: self.field().text().then(|| self.text_of(self.field())), ..Effect::default() }
    }

    // ----- Typing -----

    /// The input's text changed (typed, deleted, pasted).
    pub fn edited(&mut self, text: &str) {
        self.buffer = text.to_string();
        self.status = None;
        self.flash = None;
        self.row_error = self.apply_text(self.field(), text).err();
    }

    fn apply_text(&mut self, field: Field, text: &str) -> Result<(), String> {
        let ft = self.ft();
        let trimmed = text.trim();
        match field {
            Field::Title => self.v.title = text.to_string(),
            Field::Description => self.v.description = text.to_string(),
            Field::Plan => {
                let mut dates = BTreeSet::new();
                for part in trimmed.split(',').map(str::trim).filter(|part| !part.is_empty()) {
                    let draft = parse::parse(part, self.today, &[]);
                    if !draft.text.is_empty() || !draft.unclear.is_empty() || draft.time.is_some() || draft.dates.is_empty() && draft.span.is_none() {
                        return Err(ft.bad_day.into());
                    }
                    dates.extend(days_of(&draft, Kind::Event).ok_or(ft.bad_day)?.0);
                }
                dates.remove(&self.plan_source());
                self.v.plan_days = dates;
            }
            Field::Day => {
                if trimmed.is_empty() { self.v.days.clear(); return Ok(()); }
                let draft = parse::parse(text, self.today, &[]);
                if !draft.text.trim().is_empty() || !draft.unclear.is_empty() || draft.time.is_some() || draft.repeat.is_some() { return Err(ft.bad_day.into()); }
                let (days, mode) = days_of(&draft, self.v.typ.kind()).ok_or_else(|| ft.bad_day.to_string())?;
                self.v.days = days; self.v.mode = mode;
            }
            Field::Start => {
                if trimmed.is_empty() { self.v.start = None; self.v.end = None; return Ok(()); }
                let range = trimmed.to_lowercase().replace(" bis ", "-").replace(" to ", "-").replace('–', "-").replace('—', "-");
                match range.split_once('-') {
                    Some((a, b)) => {
                        let start = parse_clock(a, false).ok_or_else(|| ft.bad_time.to_string())?;
                        let end = parse_clock(b, true).ok_or_else(|| ft.bad_time.to_string())?;
                        self.v.start = Some(start); self.v.end = Some(end);
                    }
                    None => self.v.start = Some(parse_clock(trimmed, false).ok_or_else(|| ft.bad_time.to_string())?),
                }
            }
            Field::End => {
                if trimmed.is_empty() { self.v.end = None; return Ok(()); }
                let start = self.v.start.ok_or_else(|| ft.bad_end.to_string())?;
                let end = match trimmed.strip_prefix('+') {
                    Some(length) => { let length = parse_length(length).filter(|m| *m > 0 && *m <= 1440).ok_or_else(|| ft.bad_end.to_string())?; ((start as i64 + length) % 1440) as u32 }
                    None => parse_clock(trimmed, true).ok_or_else(|| ft.bad_end.to_string())?,
                };
                self.v.end = Some(end);
            }
            Field::Repeat => {
                if trimmed.is_empty() { self.v.rule = None; return Ok(()); }
                let draft = parse::parse(text, self.today, &[]);
                if !draft.text.trim().is_empty() || !draft.unclear.is_empty() { return Err(ft.bad_repeat.into()); }
                self.v.rule = Some(draft.repeat.ok_or_else(|| ft.bad_repeat.to_string())?);
            }
            Field::Tag => {
                self.query = text.to_string();
                if trimmed.is_empty() { self.v.tag = None; self.pick = 0; return Ok(()); }
                let options = self.tag_options();
                // With the choices open, the line that makes it is there (Enter on it); typed straight into the field it stays an error.
                if options.len() == 1 && self.new_tag().is_some() && self.options.is_some() { self.pick = 1; return Ok(()); }
                self.pick = 1;
                self.v.tag = Some(options.get(1).and_then(|(id, _, _)| id.clone()).ok_or_else(|| ft.bad_tag.to_string())?);
            }
            Field::Icon => {
                self.query = text.to_string();
                self.pick = 0;
                if trimmed.is_empty() { self.v.icon = None; return Ok(()); }
                self.v.icon = Some(self.icon_results().first().ok_or_else(|| ft.bad_icon.to_string())?.to_string());
            }
            Field::Reminder => {
                let folded = parse::fold(trimmed);
                self.v.reminder = if trimmed.is_empty() || folded == parse::fold(ft.reminder_presets[0]) { None }
                    else if folded == parse::fold(ft.reminder_at_time) || trimmed == "0" { Some(0) }
                    else { Some(parse_length(trimmed).filter(|m| *m >= 0 && *m <= storage_max_reminder()).ok_or_else(|| ft.bad_reminder.to_string())?) };
                self.pick = REMINDERS.iter().position(|r| *r == self.v.reminder).unwrap_or(usize::MAX);
            }
            Field::Kind | Field::More | Field::Priority => {}
        }
        Ok(())
    }

    /// What is typed in the tag field names no tag: the line after the tags makes it.
    fn new_tag(&self) -> Option<String> {
        crate::tag_edit::creatable(self.snapshot.as_ref().map_or(&[][..], |s| &s.tags[..]), &self.query)
    }

    /// The tag typed is made; the warm data learns it.
    fn make_tag(&mut self) -> Result<String, String> {
        let name = self.new_tag().ok_or_else(|| self.ft().bad_tag.to_string())?;
        let read_only = self.t().read_only;
        let journal = self.journal.as_mut().ok_or_else(|| read_only.to_string())?;
        let tag = crate::tag_edit::create(&mut journal.store, &name)?;
        if let Some(snapshot) = &mut self.snapshot { snapshot.reload(&journal.store)?; }
        Ok(tag.id)
    }

    /// A tag made where no effect goes back (the notepad's picker): the tag editor is to open on it.
    pub fn take_tag_edit(&mut self) -> Option<String> { self.tag_edit.take() }

    /// The tags changed elsewhere (the tag editor): the warm data reads them again.
    pub fn reload_tags(&mut self) {
        if let (Some(journal), Some(snapshot)) = (&self.journal, &mut self.snapshot) { let _ = snapshot.reload(&journal.store); }
    }

    /// The tag choices: none first, then the tags whose name has the query in it (starting with it first).
    fn tag_options(&self) -> Vec<(Option<String>, String, Option<calendar::Rgb>)> {
        let query = parse::fold(self.query.trim());
        let mut options = vec![(None, self.ft().no_tag.to_string(), None)];
        let Some(snapshot) = &self.snapshot else { return options };
        let mut found: Vec<(bool, &journal_core::storage::Tag)> = snapshot.tags.iter().filter_map(|tag| {
            let name = parse::fold(&tag.name);
            name.contains(&query).then_some((!name.starts_with(&query), tag))
        }).collect();
        found.sort_by_key(|(later, _)| *later);
        options.extend(found.into_iter().map(|(_, tag)| (Some(tag.id.clone()), tag.name.clone(), calendar::parse_color(&tag.color))));
        options
    }

    fn icon_results(&self) -> Vec<&'static str> {
        if self.query.trim().is_empty() {
            let mut common: Vec<&'static str> = COMMON_ICONS.iter().copied().filter(|name| icons::exists(name)).collect();
            // The chosen icon is offered too, even when it is not a common one.
            if let Some(icon) = self.v.icon.as_deref() { if let Some((name, _)) = icons::all().iter().find(|(name, _)| *name == icon) { if !common.contains(name) { common.insert(0, name); } } }
            return common;
        }
        icons::search(&self.query, ICON_ROOM)
    }

    // ----- The notepad -----

    pub fn notepad(&self) -> Option<&notepad::Draft> { self.notepad.as_ref() }

    pub fn open_notepad(&mut self) -> Effect {
        if self.notepad.is_some() {
            self.menu = None;
            return Effect { focus: Some(Pane::Notes), ..Effect::default() };
        }
        if self.journal.is_none() {
            self.status = Some((self.t().read_only.into(), true));
            return Effect::default();
        }
        let mut draft = notepad::Draft::new_card(self.day_shown());
        draft.panel = 1;
        draft.editing = false;
        draft.notes_on_day = true;
        self.enter_notepad(draft)
    }

    fn enter_notepad(&mut self, draft: notepad::Draft) -> Effect {
        self.notepad = Some(draft);
        self.menu = None;
        self.cal_close();
        self.search_edited("");
        Effect { search: Some(String::new()), focus: Some(Pane::Notes), ..Effect::default() }
    }

    pub fn notepad_error(&mut self, error: notepad::SaveError) {
        let labels = notepad_texts(self.language);
        let message = match error {
            notepad::SaveError::Conflict => labels.conflict.to_owned(),
            notepad::SaveError::InvalidLink => labels.invalid_link.to_owned(),
            notepad::SaveError::TooLarge => labels.too_large.to_owned(),
            notepad::SaveError::Store(message) => message,
        };
        self.status = Some((message, true));
    }

    pub fn notepad_panel(&mut self, panel: i32) {
        if let Some(draft) = self.notepad.as_mut() {
            if panel == 2 && !draft.editing || panel == 4 && !draft.editing && draft.card.original.is_none() { return; }
            if panel == 1 {
                if draft.dirty() {
                    self.status = Some((notepad_texts(self.language).dirty_switch.into(), true));
                } else {
                    self.show_notepad_list();
                }
                return;
            }
            draft.panel = if draft.panel == panel { 0 } else { panel };
            draft.confirm_discard = false;
            self.status = None;
        }
    }

    pub fn new_notepad_note(&mut self) -> Effect {
        if self.journal.is_none() { return self.open_notepad(); }
        let mut draft = notepad::Draft::new_card(self.day_shown());
        if let Some(current) = self.notepad.take() {
            draft.notes_on_day = current.notes_on_day;
            if current.dirty() { self.suspended_notes.push(current); }
        }
        self.enter_notepad(draft)
    }

    pub fn notepad_preview(&mut self) {
        if let Some(draft) = self.notepad.as_mut() {
            draft.panel = 0;
            draft.preview = !draft.preview;
            draft.editing = true;
            self.status = None;
        }
    }

    pub fn set_notepad_day_filter(&mut self, selected: bool) {
        if let Some(draft) = &mut self.notepad { draft.notes_on_day = selected; }
    }

    pub fn notepad_images(&self) -> Vec<notebook::Item> {
        let Some((draft, journal)) = self.notepad.as_ref().zip(self.journal.as_ref()) else { return Vec::new(); };
        if !draft.preview && draft.panel != 3 { return Vec::new(); }
        draft.card.attachments(&journal.store, &journal.vault).unwrap_or_default().into_iter().filter(|item| item.image.is_some()).collect()
    }

    pub fn notepad_target(&mut self, key: &str) -> Option<notebook::Target> {
        let (draft, journal) = self.notepad.as_ref().zip(self.journal.as_ref())?;
        match draft.card.target(&journal.store, &journal.vault, key.parse().ok()?) {
            Ok(target) => target,
            Err(error) => { self.notepad_error(error); None }
        }
    }

    pub fn notepad_toggle_check(&mut self, offset: usize) {
        let Some(draft) = self.notepad.as_mut() else { return; };
        let Some(text) = note_markdown::toggle(draft.body(), offset) else { return; };
        draft.edit(true, &text);
        if !draft.editing { self.save_notepad_card(); }
    }

    pub fn notepad_choices(&mut self, query: &str) -> Vec<NotepadChoice> {
        if self.notepad.as_ref().is_some_and(|draft| draft.panel == 1) { return self.notes_rows(query); }
        let Some((draft, journal)) = self.notepad.as_ref().zip(self.journal.as_ref()) else { return Vec::new(); };
        let labels = notepad_texts(self.language);
        if draft.panel == 2 {
            let tags = match journal.store.tags() {
                Ok(tags) => tags,
                Err(error) => { self.notepad_error(notepad::SaveError::Store(error.to_string())); return Vec::new(); }
            };
            let new = crate::tag_edit::creatable(&tags, query).map(|name| NotepadChoice {
                key: format!("new-tag:{name}"), group: String::new(), title: crate::texts::tags::make_tag(&name, self.language), detail: String::new(), color: None, ..NotepadChoice::default()
            });
            let query = query.to_lowercase();
            return std::iter::once(NotepadChoice { key: String::new(), group: String::new(), title: labels.no_tag.to_owned(), detail: String::new(), color: None, ..NotepadChoice::default() })
                .chain(tags.into_iter().filter(|tag| tag.name.to_lowercase().contains(&query)).map(|tag| NotepadChoice {
                    key: tag.id, group: String::new(), title: tag.name, detail: String::new(), color: calendar::parse_color(&tag.color), ..NotepadChoice::default()
                })).chain(new).collect();
        }
        if draft.panel == 4 {
            let folders = match notebook::folders(&journal.store) {
                Ok(folders) => folders,
                Err(error) => { self.notepad_error(error); return Vec::new(); }
            };
            let new = notebook::new_folder_name(&folders, query).map(|name| NotepadChoice {
                key: format!("new-folder:{name}"), group: String::new(), title: crate::texts::tags::make_folder(&name, self.language), detail: String::new(), color: None, ..NotepadChoice::default()
            });
            let query = query.to_lowercase();
            let current = draft.card.folder.as_deref().unwrap_or_default();
            return std::iter::once((String::new(), labels.unfiled.to_owned())).chain(folders)
                .filter(|(_, title)| title.to_lowercase().contains(&query))
                .map(|(key, title)| NotepadChoice {
                    detail: if key == current { labels.current_folder.to_owned() } else { String::new() },
                    key, title, group: String::new(), color: None, ..NotepadChoice::default()
                }).chain(new).collect();
        }
        let items = match draft.panel {
            1 => notebook::notes(&journal.store, query, draft.notes_on_day.then_some(draft.date)),
            3 => draft.card.attachments(&journal.store, &journal.vault),
            _ => return Vec::new(),
        };
        match items {
            Ok(items) => {
                let mut last_group = None;
                let attachment_filter = (draft.panel == 3 && !draft.editing).then(|| query.to_lowercase());
                items.into_iter().filter(|item| attachment_filter.as_ref().is_none_or(|query| {
                    item.title.to_lowercase().contains(query) || item.detail.to_lowercase().contains(query)
                })).map(|item| {
                    let mut group = String::new();
                    if draft.panel == 1 && last_group.as_ref() != Some(&item.folder) {
                        group = item.folder.as_ref().map_or_else(|| labels.unfiled.to_owned(), |path| {
                            path.iter().map(|(_, name)| name.as_str()).collect::<Vec<_>>().join(" / ")
                        });
                        last_group = Some(item.folder);
                    }
                    NotepadChoice {
                        key: item.id.to_string(), group, title: if item.title.is_empty() { labels.untitled.to_owned() } else { item.title },
                        detail: item.detail, color: None, ..NotepadChoice::default()
                    }
                }).collect()
            }
            Err(error) => { self.notepad_error(error); Vec::new() }
        }
    }

    /// Selecting a card reads its latest state. Selecting an attachment can open it outside the editor.
    pub fn pick_notepad(&mut self, key: &str) -> Option<notebook::Target> {
        if self.notepad.as_ref().is_some_and(|draft| draft.panel == 1) {
            if let Some(out) = self.notes_click(key) { if out.query.is_some() { self.notes_query_set = out.query; } return out.target; }
        }
        // A tag or folder typed in its picker is made first, then chosen like the others.
        let made = if let Some(name) = key.strip_prefix("new-tag:") {
            let journal = self.journal.as_mut()?;
            crate::tag_edit::create(&mut journal.store, name).map(|tag| { self.tag_edit = Some(tag.id.clone()); tag.id })
        } else if let Some(name) = key.strip_prefix("new-folder:") {
            let journal = self.journal.as_mut()?;
            notebook::create_folder(&mut journal.store, name, None).map_err(|error| format!("{error:?}"))
        } else { Ok(key.to_string()) };
        let chosen = match made {
            Ok(key) => key,
            Err(error) => { self.notepad_error(notepad::SaveError::Store(error)); return None; }
        };
        self.reload_tags();
        let key = chosen.as_str();
        let (draft, journal) = self.notepad.as_mut().zip(self.journal.as_ref())?;
        if matches!(draft.panel, 2 | 4) {
            let save_folder = draft.panel == 4 && !draft.editing;
            let value = (!key.is_empty()).then(|| key.to_owned());
            if draft.panel == 2 { draft.card.tag = value; } else { draft.card.folder = value; }
            draft.panel = 0;
            draft.confirm_discard = false;
            self.status = None;
            if save_folder { self.save_notepad_card(); }
            return None;
        }
        let id = key.parse().ok()?;
        if draft.panel == 3 {
            return self.notepad_target(key);
        }
        if draft.panel != 1 { return None; }
        if draft.dirty() {
            self.status = Some((notepad_texts(self.language).dirty_switch.to_owned(), true));
        } else {
            match notepad::Draft::open_card(&journal.store, draft.date, id) {
                Ok(mut chosen) => {
                    chosen.notes_on_day = draft.notes_on_day;
                    chosen.preview = !self.preferences.edit_notes;
                    chosen.editing = self.preferences.edit_notes;
                    self.notepad = Some(chosen);
                    self.status = None;
                }
                Err(error) => self.notepad_error(error),
            }
        }
        None
    }

    pub fn attach_notepad(&mut self, attachment: Result<notebook::Attachment, notepad::SaveError>) -> bool {
        let Some(draft) = &mut self.notepad else { return false; };
        let card = &mut draft.card;
        if !draft.editing { return false; }
        match attachment {
            Ok(attachment) => {
                card.pending.push(attachment);
                draft.confirm_discard = false;
                self.status = None;
                true
            }
            Err(error) => { self.notepad_error(error); false }
        }
    }

    pub fn notepad_image_loading(&mut self, loading: bool) {
        if let Some(draft) = &mut self.notepad {
            draft.loading_image = loading;
            self.status = loading.then(|| (notepad_texts(self.language).image_loading.to_owned(), false));
        }
    }

    pub fn finish_notepad_image(&mut self, id: uuid::Uuid, result: Result<notebook::Attachment, notepad::SaveError>) {
        if self.notepad.as_ref().is_some_and(|draft| draft.card.id == id) {
            self.notepad_image_loading(false);
            self.attach_notepad(result);
        } else if let Some(draft) = self.suspended_notes.iter_mut().find(|draft| draft.card.id == id) {
            draft.loading_image = false;
            if let Ok(attachment) = result { draft.card.pending.push(attachment); }
        }
    }

    pub fn notepad_tag_name(&self) -> Option<String> {
        self.notepad.as_ref()?.card.tag.as_deref().and_then(|id| self.tag_name(id))
    }

    pub fn edit_notepad(&mut self, body: bool, text: &str) {
        if let Some(draft) = &mut self.notepad {
            draft.edit(body, text);
            self.status = None;
        }
    }

    fn save_notepad_card(&mut self) {
        let Some((draft, journal)) = self.notepad.as_mut().zip(self.journal.as_mut()) else { return; };
        let card = &draft.card;
        if draft.loading_image || draft.panel == 1 { return; }
        if card.original.is_none() && !draft.dirty() {
            draft.panel = 1;
            return;
        }
        let labels = notepad_texts(self.language);
        draft.confirm_discard = false;
        match draft.save(&mut journal.store, &journal.vault, labels.untitled) {
            Ok(written) => {
                if written { self.last_saved = None; }
                match notepad::Draft::open_card(&journal.store, draft.date, card.id) {
                    Ok(mut saved) => {
                        saved.notes_on_day = draft.notes_on_day;
                        saved.editing = false;
                        saved.preview = true;
                        self.notepad = Some(saved);
                        self.status = written.then(|| (labels.saved.to_owned(), false));
                    }
                    Err(error) => self.notepad_error(error),
                }
            }
            Err(error) => {
                draft.editing = true;
                self.notepad_error(error);
            }
        }
    }

    fn back_from_notepad_card(&mut self) -> Effect {
        let Some(draft) = self.notepad.as_mut() else { return Effect::default(); };
        if draft.panel == 1 { return self.close_notepad(); }
        if draft.panel > 1 {
            draft.panel = 0;
            self.status = None;
            return Effect::default();
        }
        if draft.editing && draft.preview {
            draft.preview = false;
            self.status = None;
            return Effect::default();
        }
        if draft.dirty() && !draft.confirm_discard {
            draft.confirm_discard = true;
            self.status = Some((notepad_texts(self.language).discard.into(), false));
            return Effect::default();
        }
        if !self.suspended_notes.is_empty() { return self.close_notepad(); }
        let original = draft.card.original.as_ref().map(|_| draft.card.id);
        if draft.editing {
            if let Some((id, journal)) = original.zip(self.journal.as_ref()) {
                if let Ok(mut old) = notepad::Draft::open_card(&journal.store, draft.date, id) {
                    old.notes_on_day = draft.notes_on_day;
                    old.preview = true;
                    old.editing = false;
                    self.notepad = Some(old);
                    self.status = None;
                    return Effect::default();
                }
            }
        }
        self.show_notepad_list();
        Effect::default()
    }

    fn show_notepad_list(&mut self) {
        let Some(draft) = &self.notepad else { return; };
        if draft.panel != 1 {
            let mut browser = notepad::Draft::new_card(draft.date);
            browser.notes_on_day = draft.notes_on_day;
            browser.panel = 1;
            self.notepad = Some(browser);
        }
        self.notes_list.mode = crate::notes_list::Mode::Browse;
        self.status = None;
    }

    fn close_notepad(&mut self) -> Effect {
        if let Some(mut previous) = self.suspended_notes.pop() {
            previous.confirm_discard = false;
            self.notepad = Some(previous);
            self.status = None;
            return Effect { focus: Some(Pane::Notes), ..Effect::default() };
        }
        let Some(draft) = self.notepad.take() else { return Effect::default(); };
        self.show_day(draft.date);
        Effect { focus: Some(if self.entry_open { Pane::Entry } else if self.pane.edit.is_some() { Pane::DayEdit } else { Pane::Search }), ..Effect::default() }
    }

    pub fn finish_notepad(&mut self, save: bool) -> Effect {
        if !save { return self.back_from_notepad_card(); }
        self.save_notepad_card();
        Effect::default()
    }

    // ----- Keys -----

    pub fn key(&mut self, key: Key, mods: Mods) -> Effect {
        if let Some(Options::GoToDate(cursor)) = self.options {
            if key == Key::Enter { return self.pick_month_date(cursor); }
            if key == Key::Escape {
                self.options = None;
                return Effect { focus: Some(Pane::Search), ..Effect::default() };
            }
            if let Some(date) = self.month_cursor(cursor, key) { self.options = Some(Options::GoToDate(date)); }
            return Effect::default();
        }
        if self.notepad.is_some() {
            return match key {
                Key::Enter if mods.ctrl => self.finish_notepad(true),
                Key::Escape => self.finish_notepad(false),
                _ => Effect::default(),
            };
        }
        if !self.entry_open && self.options.is_none() { return self.search_key(key, mods); }
        self.status = None;
        match key {
            Key::Undo => return self.undo_last(false),
            Key::Redo => return self.undo_last(true),
            Key::Quit => return Effect { quit: true, ..Effect::default() },
            Key::Digit(digit @ 1..=4) if mods.alt => return self.set_type(TYPES[digit as usize - 1]),
            Key::Priority => { self.v.priority = !self.v.priority; if self.field() == Field::Priority { self.backup.priority = self.v.priority; } return Effect::default(); }
            Key::Extra(field) => { self.options = None; return self.open_extra(field); }
            Key::Close => return self.close_entry(),
            // The delete key of the day view (Alt+Entf): the entry open, with the choice of its series.
            Key::Delete if mods.alt && self.editing_entry() => return self.run(ActionId::EntryDelete, None),
            // Alt+H: back to today (the day view and the calendar); what is being written stays.
            Key::Home if mods.alt => { self.show_today(); return Effect::default(); }
            Key::Enter if mods.ctrl || mods.shift => {
                self.options = None;
                return self.save(mods.shift);
            }
            _ => {}
        }
        if self.options.is_some() { return self.options_key(key, mods); }
        match key {
            Key::Focus => self.open_options(Field::Day),
            Key::Escape => {
                if self.v != self.backup {
                    self.v = self.backup.clone();
                    self.row_error = None;
                    self.query.clear();
                    self.buffer = self.text_of(self.field());
                    return Effect { text: Some(if self.field().text() { self.buffer.clone() } else { String::new() }), ..Effect::default() };
                }
                self.close_entry()
            }
            Key::Down if mods.alt => self.open_options(self.field()),
            Key::Up => self.move_line(-1),
            Key::Down => self.move_line(1),
            Key::Tab if !mods.shift && self.field() == Field::Title && self.gap_at.is_some() => match self.select_gap(self.gap_at) {
                Some(select) => Effect { select: Some(select), ..Effect::default() },
                None => self.move_field(1),
            },
            Key::Tab => self.move_field(if mods.shift { -1 } else { 1 }),
            Key::Enter => match self.field() {
                Field::Plan | Field::Day | Field::Start | Field::End | Field::Repeat | Field::Tag | Field::Icon | Field::Reminder => self.open_options(self.field()),
                _ => self.move_field(1),
            },
            _ => self.value_key(key),
        }
    }

    fn set_type(&mut self, typ: Type) -> Effect {
        self.v.typ = typ;
        self.kind_chosen = true;
        if self.field() == Field::Kind { self.backup.typ = typ; }
        Effect::default()
    }

    /// `←`/`→`/`Space`/`Delete`/digits on the fields that are a switch.
    fn value_key(&mut self, key: Key) -> Effect {
        let step: i32 = match key { Key::Left => -1, Key::Right => 1, Key::Space if !self.field().text() => 1, _ => 0 };
        match self.field() {
            Field::Kind => {
                if let Key::Digit(digit @ 1..=4) = key { return self.set_type(TYPES[digit as usize - 1]); }
                if step != 0 { return self.set_type(TYPES[(self.v.typ.index() as i32 + step).rem_euclid(4) as usize]); }
            }
            _ => {}
        }
        Effect::default()
    }

    /// The description, the reminder or the icon (Alt+B/R/I, Strg+K): its line shows and has the keyboard; the reminder's
    /// and the icon's choices open at once.
    fn open_extra(&mut self, field: Field) -> Effect {
        if let Err(error) = self.commit() { self.status = Some((error, true)); return Effect::default(); }
        self.entry_open = true;
        let effect = self.enter_row(field.index());
        match field {
            Field::Reminder | Field::Icon => { let opened = self.open_options(field); Effect { focus: Some(Pane::Entry), ..opened } }
            _ => Effect { focus: Some(Pane::Entry), ..effect },
        }
    }

    /// A click on a field (or the title in the top line): it gets the keyboard.
    pub fn click_field(&mut self, index: usize) -> Effect {
        if index >= FIELDS.len() || !self.entry_open { return Effect::default(); }
        if self.options.is_some() { self.options = None; self.refresh_text(); }
        if FIELDS[index] == Field::Plan { let effect = self.open_options(Field::Plan); return Effect { focus: Some(Pane::Entry), ..effect }; }
        if index == self.active { return Effect { focus: Some(Pane::Entry), ..Effect::default() }; }
        if let Err(error) = self.commit() { self.status = Some((error, true)); return Effect::default(); }
        self.status = None;
        Effect { focus: Some(Pane::Entry), ..self.enter_row(index) }
    }

    // ----- Options: Enter in, Enter on, Esc back -----

    /// Enter on a field: its options open; the values are kept for `Esc`.
    fn open_options(&mut self, field: Field) -> Effect {
        if let Err(error) = self.commit() { self.status = Some((error, true)); return Effect::default(); }
        self.entry_open = true;
        if self.field() != field { self.enter_row(field.index()); }
        self.options_backup = self.v.clone();
        let next_hour = ((self.now / 60 + 1) % 24) * 60;
        self.options = Some(match field {
            Field::Plan => Options::PlanDates(day_pane::PlanCursor::new(self.v.plan_days.first().copied().unwrap_or_else(|| repeat::shift(self.plan_source(), 1)))),
            Field::Day => {
                let day = self.v.days.iter().next().copied().unwrap_or(self.today);
                Options::Calendar(CalCursor { hours: self.v.start.is_some(), day, minute: self.v.start.unwrap_or(next_hour), anchor: None })
            }
            Field::Start | Field::End => {
                if self.v.start.is_none() { self.v.start = Some(next_hour); }
                if field == Field::End && self.v.end.is_none() { self.v.end = Some((self.v.start.unwrap() + 60).min(1440)); }
                Options::Clock(Clock { end: field == Field::End, minutes: false, typed: String::new() })
            }
            Field::Repeat => { self.editor.enter(self.v.rule.as_ref()); Options::Repeat }
            Field::Tag | Field::Icon | Field::Reminder => Options::Choices,
            _ => return self.move_field(1),
        });
        self.query.clear();
        self.sync_options();
        self.refresh_text()
    }

    /// The input shows the field's value again.
    fn refresh_text(&mut self) -> Effect {
        self.row_error = None;
        self.buffer = self.text_of(self.field());
        Effect { text: Some(if self.field().text() { self.buffer.clone() } else { String::new() }), ..Effect::default() }
    }

    /// Enter: the options are taken; on to the next field (or back with Shift+Tab).
    fn take_options(&mut self, delta: i32) -> Effect {
        self.options = None;
        self.refresh_text();
        self.move_field(delta)
    }

    /// Esc: the values from before the options came back; the field stays.
    fn cancel_options(&mut self) -> Effect {
        self.options = None;
        self.v = self.options_backup.clone();
        self.query.clear();
        self.refresh_text()
    }

    fn options_key(&mut self, key: Key, mods: Mods) -> Effect {
        match self.options.clone() {
            Some(Options::Calendar(cursor)) => self.calendar_key(cursor, key, mods),
            Some(Options::Clock(clock)) => self.clock_key(clock, key, mods),
            Some(Options::PlanDates(mut cursor)) => {
                let own = self.plan_source();
                match key {
                    Key::Space => cursor.space(own, &mut self.v.plan_days),
                    Key::Enter | Key::Tab => return self.take_options(if mods.shift { -1 } else { 1 }),
                    Key::Escape => return self.cancel_options(),
                    _ => if let Some(next) = self.month_cursor(cursor.date, key) { cursor.travel(next, mods.shift, own, &mut self.v.plan_days); },
                }
                self.options = Some(Options::PlanDates(cursor));
                self.refresh_text()
            }
            Some(Options::RepeatDate { field, cursor }) => self.repeat_date_key(field, cursor, key),
            Some(Options::Repeat) => {
                let base = self.v.days.iter().next().copied().unwrap_or(self.today);
                let act = match (key, mods.shift) {
                    (Key::Enter, _) => return self.take_options(1),
                    (Key::Tab, shift) => return self.take_options(if shift { -1 } else { 1 }),
                    (Key::Escape, _) => return self.cancel_options(),
                    (Key::Left, false) => Act::Left, (Key::Right, false) => Act::Right, (Key::Up, false) => Act::Up, (Key::Down, false) => Act::Down,
                    (Key::Left, true) => Act::ShiftLeft, (Key::Right, true) => Act::ShiftRight, (Key::Up, true) => Act::ShiftUp, (Key::Down, true) => Act::ShiftDown,
                    (Key::Space, _) => {
                        if let Some(field) = self.editor.date_field(self.v.rule.as_ref()) {
                            self.open_repeat_date(field);
                            return Effect::default();
                        }
                        Act::Toggle
                    }
                    (Key::Delete, _) => Act::Delete, (Key::Digit(digit), _) => Act::Digit(digit),
                    _ => return Effect::default(),
                };
                self.editor.act(&mut self.v.rule, base, act);
                if self.v.typ == Type::Note && self.v.rule.is_some() && !self.kind_chosen { self.v.typ = Type::Task; }
                self.buffer = self.text_of(Field::Repeat);
                Effect::default()
            }
            Some(Options::Choices) => {
                let columns: i32 = match self.field() { Field::Icon => ICON_COLUMNS, Field::Reminder => 4, _ => 1 };
                let step = match key { Key::Left => -1, Key::Right => 1, Key::Up => -columns, Key::Down => columns, _ => 0 };
                match key {
                    Key::Enter if self.field() == Field::Tag && self.pick == self.tag_options().len() && self.new_tag().is_some() => match self.make_tag() {
                        Ok(id) => { self.v.tag = Some(id.clone()); self.query.clear(); Effect { edit_tag: Some(id), ..self.take_options(1) } }
                        Err(error) => { self.status = Some((error, true)); Effect::default() }
                    },
                    Key::Enter => self.take_options(1),
                    Key::Tab => self.take_options(if mods.shift { -1 } else { 1 }),
                    Key::Escape => self.cancel_options(),
                    Key::Delete => self.choose(None),
                    _ if step != 0 => {
                        let count = self.choice_count() as i32;
                        if count == 0 { return Effect::default(); }
                        let at = if self.pick == usize::MAX { if step > 0 { -1 } else { count } } else { self.pick as i32 };
                        self.choose(Some((at + step).clamp(0, count - 1) as usize))
                    }
                    _ => Effect::default(),
                }
            }
            None | Some(Options::GoToDate(_)) => Effect::default(),
        }
    }

    // ----- The clock -----

    fn clock_key(&mut self, mut clock: Clock, key: Key, mods: Mods) -> Effect {
        let field_value = |form: &Form| if clock.end { form.v.end } else { form.v.start };
        let Some(value) = field_value(self) else { return self.cancel_options() };
        let (hours, minutes) = ((value / 60) as i32, (value % 60) as i32);
        let next = match key {
            Key::Enter => return self.take_options(1),
            Key::Tab => return self.take_options(if mods.shift { -1 } else { 1 }),
            Key::Escape => return self.cancel_options(),
            Key::Delete => {
                // No end: a point in time; no start: the whole day.
                if clock.end { self.v.end = None; } else { self.v.start = None; self.v.end = None; }
                self.options = None;
                return self.refresh_text();
            }
            Key::Left | Key::Right => { clock.minutes = key == Key::Right; clock.typed.clear(); value }
            Key::Up | Key::Down => {
                let sign = if key == Key::Up { 1 } else { -1 };
                clock.typed.clear();
                if clock.minutes {
                    let step = if mods.ctrl { 15 } else { 1 };
                    let m = if mods.ctrl { (minutes / 15 * 15 + if sign < 0 && minutes % 15 != 0 { 15 } else { 0 }) + sign * step } else { minutes + sign * step };
                    (hours * 60 + m.rem_euclid(60)) as u32
                } else {
                    let step = if mods.ctrl { 4 } else { 1 };
                    ((hours + sign * step).rem_euclid(24) * 60 + minutes) as u32
                }
            }
            Key::Digit(digit) => {
                if clock.typed.len() >= 4 { clock.typed.clear(); }
                clock.typed.push((b'0' + digit) as char);
                let typed = &clock.typed;
                let parsed = if typed.len() <= 2 { typed.parse::<u32>().ok().filter(|h| *h <= 23).map(|h| h * 60 + if clock.minutes { 0 } else { minutes as u32 }) } else { parse_clock(typed, clock.end) };
                if typed.len() == 2 { clock.minutes = true; }
                match parsed { Some(value) => value, None => { clock.typed = digit.to_string(); value } }
            }
            _ => value,
        };
        if clock.end { self.v.end = Some(next); } else {
            // The end moves along with the start.
            if let (Some(old), Some(end)) = (self.v.start, self.v.end) { self.v.end = Some(((end as i32 + next as i32 - old as i32).rem_euclid(1440)) as u32); }
            self.v.start = Some(next);
        }
        self.options = Some(Options::Clock(clock));
        self.refresh_text()
    }

    // ----- The calendar with the keyboard -----

    /// The keyboard in the calendar: Tab between the side (whole days) and the 24 hours; ↑/↓ a day; ←/→ a week on the
    /// side, an hour in the hours (Strg: a quarter); Shift draws a range from where it was first held. Enter takes it
    /// (no range: the day, or in the hours the moment), Esc first drops the range, then goes back without a date.
    fn calendar_key(&mut self, mut c: CalCursor, key: Key, mods: Mods) -> Effect {
        match key {
            Key::Enter => return self.take_options(1),
            Key::Escape if c.anchor.is_some() => { c.anchor = None; }
            Key::Escape => return self.cancel_options(),
            Key::Tab => { c.hours = !c.hours; c.anchor = None; }
            Key::Focus => return self.take_options(0),
            Key::Up | Key::Down | Key::Left | Key::Right | Key::PageUp | Key::PageDown | Key::Home => {
                if mods.shift { if c.anchor.is_none() { c.anchor = Some((c.day, c.minute)); } } else { c.anchor = None; }
                let sign: i64 = if matches!(key, Key::Up | Key::Left | Key::PageUp) { -1 } else { 1 };
                match key {
                    Key::Up | Key::Down => c.day = repeat::shift(c.day, sign),
                    Key::PageUp | Key::PageDown => c.day = if sign < 0 { c.day.checked_sub_months(chrono::Months::new(1)) } else { c.day.checked_add_months(chrono::Months::new(1)) }.unwrap_or(c.day),
                    Key::Home => c.day = self.today,
                    _ if !c.hours => c.day = repeat::shift(c.day, 7 * sign),
                    _ => {
                        let step = if mods.ctrl { 15 } else { 60 };
                        let minute = (c.minute as i64 / step * step) + sign * step;
                        c.day = repeat::shift(c.day, minute.div_euclid(1440));
                        c.minute = minute.rem_euclid(1440) as u32;
                    }
                }
            }
            _ => return Effect::default(),
        }
        self.options = Some(Options::Calendar(c));
        self.sync_options();
        self.refresh_text()
    }

    /// The calendar's cursor and range become the entry's date and time, live.
    fn sync_options(&mut self) {
        let Some(Options::Calendar(c)) = self.options else { return };
        let days = |a: NaiveDate, b: NaiveDate| -> BTreeSet<NaiveDate> { (0..=repeat::days_between(a.min(b), a.max(b)).clamp(0, 366)).map(|n| repeat::shift(a.min(b), n)).collect() };
        self.v.mode = Mode::Continuous;
        self.v.time_grid = c.hours;
        match (c.hours, c.anchor) {
            (false, None) => { self.v.days = BTreeSet::from([c.day]); self.v.start = None; self.v.end = None; }
            (false, Some((from, _))) => { self.v.days = days(from, c.day); self.v.start = None; self.v.end = None; }
            (true, None) => { self.v.days = BTreeSet::from([c.day]); self.v.start = Some(c.minute); self.v.end = None; }
            (true, Some(anchor)) => {
                let step = if anchor.1 % 60 == 0 && c.minute % 60 == 0 { 60 } else { 15 };
                let (from, to) = if anchor <= (c.day, c.minute) { (anchor, (c.day, c.minute)) } else { ((c.day, c.minute), anchor) };
                let end = to.1 + step;
                let (last, end) = if end > 1440 { (repeat::shift(to.0, 1), end - 1440) } else { (to.0, end) };
                self.v.days = days(from.0, last); self.v.start = Some(from.1); self.v.end = Some(end);
            }
        }
        if self.v.typ == Type::Note && self.v.start.is_some() { self.v.typ = Type::Calendar; }
    }

    fn choice_count(&self) -> usize {
        match self.field() { Field::Tag => self.tag_options().len() + usize::from(self.new_tag().is_some()), Field::Icon => self.icon_results().len(), Field::Reminder => REMINDERS.len(), _ => 0 }
    }

    /// The choice `index` under the active line is taken (`None`: none). Typed filters stay.
    fn choose(&mut self, index: Option<usize>) -> Effect {
        self.row_error = None;
        match self.field() {
            Field::Tag => {
                let options = self.tag_options();
                // The line that makes the tag typed: chosen, it waits for Enter.
                if index == Some(options.len()) && self.new_tag().is_some() { self.pick = options.len(); return Effect::default(); }
                self.pick = index.unwrap_or(0).min(options.len() - 1);
                self.v.tag = options[self.pick].0.clone();
                if index.is_none() { self.query.clear(); }
            }
            Field::Icon => {
                let results = self.icon_results();
                match index.and_then(|i| results.get(i)) { Some(name) => { self.pick = index.unwrap(); self.v.icon = Some(name.to_string()); } None => { self.v.icon = None; self.query.clear(); self.pick = 0; } }
            }
            Field::Reminder => {
                self.pick = index.unwrap_or(0).min(REMINDERS.len() - 1);
                self.v.reminder = REMINDERS[self.pick];
                self.buffer = self.text_of(Field::Reminder);
                return Effect { text: Some(self.buffer.clone()), ..Effect::default() };
            }
            _ => return Effect::default(),
        }
        if self.query.is_empty() {
            self.buffer = self.text_of(self.field());
            return Effect { text: Some(self.buffer.clone()), ..Effect::default() };
        }
        Effect::default()
    }

    /// A click on a choice under the active line.
    pub fn choice_click(&mut self, index: usize) -> Effect { self.choose(Some(index)) }

    /// A click on a choice of the repetition.
    pub fn repeat_click(&mut self, slot: i32, value: i32) {
        if self.field() != Field::Repeat { return; }
        if self.options.is_none() { self.open_options(Field::Repeat); }
        let base = self.v.days.iter().next().copied().unwrap_or(self.today);
        if let Some(field) = self.editor.click(&mut self.v.rule, base, slot, value) {
            self.open_repeat_date(field);
        }
        self.buffer = self.text_of(Field::Repeat);
    }

    fn plan_source(&self) -> NaiveDate { self.editing.as_ref().map(|e| e.0).or_else(|| self.v.days.first().copied()).unwrap_or(self.today) }

    pub fn release_plan_space(&mut self) {
        if let Some(Options::PlanDates(cursor)) = &mut self.options { cursor.release_space(); }
        if let Some(day_pane::Side { view: day_pane::SideView::Plan { cursor, .. }, .. }) = &mut self.pane.side { cursor.release_space(); }
    }

    pub fn month_picker_open(&self) -> bool {
        matches!(self.options, Some(Options::RepeatDate { .. } | Options::PlanDates(_) | Options::GoToDate(_)))
    }

    pub fn day_picker_open(&self) -> bool { matches!(self.options, Some(Options::GoToDate(_))) }

    fn open_repeat_date(&mut self, field: DateField) {
        if let Some(rule) = &self.v.rule {
            self.options = Some(Options::RepeatDate { field, cursor: field.date(rule) });
        }
    }

    pub fn pick_month_date(&mut self, date: NaiveDate) -> Effect {
        if matches!(self.options, Some(Options::GoToDate(_))) {
            self.options = None;
            self.show_day(date);
            return Effect { focus: Some(Pane::Search), ..Effect::default() };
        }
        let own = self.plan_source();
        if let Some(Options::PlanDates(cursor)) = &mut self.options {
            cursor.click(date, own, &mut self.v.plan_days);
            return self.refresh_text();
        }
        if let (Some(Options::RepeatDate { field, .. }), Some(rule)) = (&self.options, &mut self.v.rule) {
            if *field == DateField::Until && date < rule.start { return Effect::default(); }
            field.apply(rule, date);
            self.options = Some(Options::Repeat);
            return self.refresh_text();
        }
        Effect::default()
    }

    fn repeat_date_key(&mut self, field: DateField, cursor: NaiveDate, key: Key) -> Effect {
        match key {
            Key::Enter => return self.pick_month_date(cursor),
            Key::Escape => {
                self.options = Some(Options::Repeat);
                return Effect::default();
            }
            _ => {}
        }
        let Some(next) = self.month_cursor(cursor, key) else { return Effect::default(); };
        let Some(rule) = self.v.rule.as_ref() else { return self.cancel_options() };
        let cursor = if field == DateField::Until { next.max(rule.start) } else { next };
        self.options = Some(Options::RepeatDate { field, cursor });
        Effect::default()
    }

    fn month_cursor(&self, cursor: NaiveDate, key: Key) -> Option<NaiveDate> {
        let days = match key {
            Key::Left => -1, Key::Right => 1, Key::Up => -7, Key::Down => 7,
            Key::PageUp => return Some(day_pane::add_months(cursor, -1)),
            Key::PageDown => return Some(day_pane::add_months(cursor, 1)),
            Key::Home => return Some(self.today),
            _ => return None,
        };
        cursor.checked_add_signed(chrono::Duration::days(days))
    }

    fn month_panel(&self) -> Option<day_pane::SidePanel> {
        if let Some(Options::GoToDate(cursor)) = self.options {
            let mut panel = day_pane::SidePanel {
                kind: 5, heading: self.ft().cmd_day_detail.into(),
                confirm: crate::texts::day_texts(self.language).take.into(), ..Default::default()
            };
            panel.set_month(cursor, self.today, self.language, None, None, |date| date == self.day_shown());
            return Some(panel);
        }
        if let Some(Options::PlanDates(cursor)) = &self.options {
            let mut panel = day_pane::SidePanel {
                kind: 5, heading: self.ft().labels[Field::Plan.line()].into(),
                confirm: crate::texts::day_texts(self.language).take.into(), ..Default::default()
            };
            let own = self.plan_source();
            panel.set_month(cursor.date, self.today, self.language, Some(own), None, |date| date != own && self.v.plan_days.contains(&date));
            for cell in &mut panel.cells { cell.pending = !cell.disabled && cursor.preview(cell.date); }
            return Some(panel);
        }
        let Some(Options::RepeatDate { field, cursor }) = self.options else { return None };
        let rule = self.v.rule.as_ref()?;
        let ft = self.ft();
        let dt = crate::texts::day_texts(self.language);
        let (heading, earliest) = match field {
            DateField::Start => (ft.rp_from, None),
            DateField::Until => (ft.rp_until, Some(rule.start)),
        };
        let mut panel = day_pane::SidePanel {
            kind: 5, heading: heading.into(), confirm: dt.take.into(), ..Default::default()
        };
        let selected = field.date(rule);
        panel.set_month(cursor, self.today, self.language, None, earliest, |date| date == selected);
        Some(panel)
    }

    // ----- The calendar beside the form -----

    fn cal_close(&mut self) {
        if matches!(self.options, Some(Options::Calendar(_))) { self.options = None; }
        self.mark = None; self.mark_layout = None;
    }

    /// The left button opens entries and toggles days (Shift: open the range to the last clicked day).
    /// The right button marks a new entry, whole days on the side,
    /// times in the 24 hours, and writes it into the form. `button` 0 left, 1 right; `kind` 0 pressed, 1 moved, 2 released.
    pub fn cal_mouse(&mut self, button: i32, kind: i32, x: f32, y: f32, shift: bool) -> Effect {
        if self.month_picker_open() {
            return if kind == 0 { self.key(Key::Escape, Mods::default()) } else { Effect::default() };
        }
        if self.notepad.is_some() && button != 0 { return Effect::default(); }
        let m = self.shown_metrics;
        // The middle button chooses the day the day view shows (opening a day stays with the left one).
        if button == 2 {
            if kind != 0 { return Effect::default(); }
            match calendar::spot(&self.shown_layout, &m, x, y) {
                calendar::Spot::Nothing => {}
                calendar::Spot::Item(_, day) | calendar::Spot::Side(day) | calendar::Spot::Time(day, _) => self.show_day(day),
            }
            return Effect::default();
        }
        if button == 0 {
            if kind != 0 { return Effect::default(); }
            let day = match calendar::spot(&self.shown_layout, &m, x, y) {
                calendar::Spot::Nothing => return Effect::default(),
                calendar::Spot::Item(index, _) if !shift => {
                    return self.open_calendar_entry(index);
                }
                calendar::Spot::Item(_, day) | calendar::Spot::Side(day) | calendar::Spot::Time(day, _) => day,
            };
            match self.cal_clicked.filter(|_| shift) {
                Some(from) => for n in 0..=repeat::days_between(from.min(day), from.max(day)).clamp(0, 400) { self.cal_open.insert(repeat::shift(from.min(day), n)); },
                None => if !self.cal_open.remove(&day) { self.cal_open.insert(day); },
            }
            self.cal_clicked = Some(day);
            return Effect::default();
        }
        match kind {
            0 => {
                if y < m.head_h { return Effect::default(); }
                if let calendar::Spot::Item(..) = calendar::spot(&self.shown_layout, &m, x, y) { return Effect::default(); }
                let Some(day) = calendar::day_at(&self.shown_layout, y) else { return Effect::default() };
                if self.entry_open { if let Err(error) = self.commit() { self.status = Some((error, true)); return Effect::default(); } }
                self.cal_close();
                // Marking something in the calendar opens the entry form for it.
                self.entry_open = true;
                self.options = None;
                self.mark = Some(if x < m.time_x() { MarkDrag::Days(day, day) } else { let minute = m.minute_at(x); MarkDrag::Time((day, minute), (day, minute)) });
                self.mark_layout = Some((self.shown_layout.clone(), m));
                self.apply_mark()
            }
            1 => {
                let Some((layout, m)) = &self.mark_layout else { return Effect::default() };
                let (Some(mark), Some(day), minute) = (self.mark, calendar::day_at(layout, y), m.minute_at(x)) else { return Effect::default() };
                self.mark = Some(match mark { MarkDrag::Days(from, _) => MarkDrag::Days(from, day), MarkDrag::Time(from, _) => MarkDrag::Time(from, (day, minute)) });
                self.apply_mark()
            }
            _ => {
                self.mark_layout = None;
                if self.mark.take().is_none() { return Effect::default(); }
                // The title is what is missing then: the cursor goes there, as the app's composer opens.
                let row = if self.v.title.trim().is_empty() { TITLE } else { self.active };
                let effect = self.enter_row(row);
                Effect { focus: Some(Pane::Entry), search: Some(String::new()), ..effect }
            }
        }
    }

    fn open_calendar_entry(&mut self, index: usize) -> Effect {
        let Some((date, id)) = self.shown_entries.get(index).and_then(Clone::clone) else { return Effect::default(); };
        if self.notepad.is_some() || self.pane.edit.is_some() || self.pane.side.is_some() { return Effect::default(); }
        let original = self.editing.as_ref().map(|(date, entry)| Self::entry_values(*date, entry)).unwrap_or_default();
        if self.entry_open && (self.v != original || self.row_error.is_some()) {
            self.status = Some((self.ft().finish_entry_first.into(), true));
            return Effect::default();
        }
        let effect = self.edit_hit(date, &id);
        if effect.focus == Some(Pane::Entry) {
            self.menu = None;
            self.options = None;
            self.tried = false;
        }
        effect
    }

    fn calendar_preview_entry(&self, index: usize) -> Option<&journal_core::storage::Entry> {
        let (date, id) = self.shown_entries.get(index)?.as_ref()?;
        self.snapshot.as_ref()?.days.get(date)?.iter().find(|entry| entry.id == *id)
    }

    /// Visible parts of the entries on one day, including continuations and collapsed chips.
    fn preview_anchors(&self, day: NaiveDate) -> impl Iterator<Item = (usize, f32, f32)> + '_ {
        let layout = &self.shown_layout;
        let m = &self.shown_metrics;
        let row = layout.rows.iter().find(|row| row.date == day);
        layout.blocks.iter().map(|b| (b.item, b.x, b.y, b.w, b.h))
            .chain(layout.chips.iter().map(|c| (c.item, c.x, c.y, c.w, c.h)))
            .chain(layout.lanes.iter().map(|l| (l.item, l.x, l.y, l.w, l.h)))
            .filter_map(move |(index, x, y, w, h)| {
                let row = row?;
                let left = x.max(0.0);
                let right = (x + w).min(m.width);
                let top = y.max(row.y).max(m.head_h);
                let bottom = (y + h).min(row.y + row.h).min(m.height);
                (right > left && bottom > top).then_some((index, (left + right) / 2.0, (top + bottom) / 2.0))
            })
    }

    pub fn calendar_hover_entry(&self, x: f32, y: f32) -> Option<(usize, f32, f32, &journal_core::storage::Entry)> {
        if self.mark.is_some() { return None; }
        let calendar::Spot::Item(index, day) = calendar::spot(&self.shown_layout, &self.shown_metrics, x, y) else { return None; };
        let (_, x, y) = self.preview_anchors(day).find(|(item, ..)| *item == index)?;
        Some((index, x, y, self.calendar_preview_entry(index)?))
    }

    pub fn calendar_keyboard_preview(&self, step: usize) -> Option<(usize, f32, f32, &journal_core::storage::Entry)> {
        let Some(Options::Calendar(cursor)) = self.options else { return None; };
        let mut seen = BTreeSet::new();
        let mut candidates = self.preview_anchors(cursor.day)
            .filter(|(index, ..)| seen.insert(*index))
            .filter_map(|(index, x, y)| Some((index, x, y, self.calendar_preview_entry(index)?)))
            .collect::<Vec<_>>();
        candidates.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.2.total_cmp(&b.2)));
        candidates.get(step.checked_rem(candidates.len())?).copied()
    }

    /// The marked range becomes the entry's day(s) and time.
    fn apply_mark(&mut self) -> Effect {
        let Some(mark) = self.mark else { return Effect::default() };
        let days = |a: NaiveDate, b: NaiveDate| -> BTreeSet<NaiveDate> { (0..=repeat::days_between(a.min(b), a.max(b)).clamp(0, 366)).map(|n| repeat::shift(a.min(b), n)).collect() };
        match mark {
            MarkDrag::Days(a, b) => { self.v.days = days(a, b); self.v.start = None; self.v.end = None; self.v.time_grid = false; }
            MarkDrag::Time(a, b) => {
                let ((first, start), (last, end)) = calendar::marked(a, b);
                self.v.days = days(first, last); self.v.start = Some(start); self.v.end = Some(end);
                self.v.time_grid = true;
            }
        }
        self.v.mode = Mode::Continuous;
        // As in the app's calendar: a new entry there is an appointment for the calendar only, unless chosen otherwise.
        if !self.kind_chosen || self.v.typ == Type::Note && self.v.start.is_some() { self.v.typ = Type::Calendar; }
        self.row_error = None;
        self.status = None;
        self.buffer = self.text_of(self.field());
        Effect { text: Some(if self.field().text() { self.buffer.clone() } else { String::new() }), ..Effect::default() }
    }

    // ----- The day view -----

    /// The day the day view shows.
    pub fn day_shown(&self) -> NaiveDate { self.notepad.as_ref().map_or(self.view_day.unwrap_or(self.today), |draft| draft.date) }

    /// The day view moves to `day` (today again follows the clock, also over midnight).
    pub fn show_day(&mut self, day: NaiveDate) {
        if self.day_picker_open() { self.options = None; }
        if day != self.day_shown() { self.pane.reset(); }
        self.view_day = (day != self.today).then_some(day);
        self.status = None;
        self.flash = None;
    }

    /// Back to today (a click on the day view's date, Alt+H).
    pub fn show_today(&mut self) {
        self.show_day(self.today);
        self.reset_calendar();
    }

    /// The calendar scrolls back to today, with its default zoom and pan.
    fn reset_calendar(&mut self) {
        self.cal_top = repeat::shift(self.today, -1);
        self.cal_offset = 0.0;
        self.cal_target = None;
        self.zoom_days = 1.0;
        self.zoom_hours = 1.0;
        self.pan = 0.0;
    }

    /// A reminder card's title was clicked: the day view shows the reminder's day. An entry form with
    /// unsaved changes stays open.
    pub fn reveal_day(&mut self, day: NaiveDate) {
        if !self.dirty() { self.entry_open = false; }
        self.show_day(day);
    }

    /// "Erledigt" on a reminder card: the task is done, as with the app's reminder (`change_linked`).
    pub fn finish_task(&mut self, id: &str) -> Result<(), String> {
        let Some(journal) = self.journal.as_mut() else { return Ok(()) };
        let dates = journal.store.change_linked(&[journal_core::storage::LinkedChange { id: id.to_string(), action: "done".into() }]).map_err(|e| e.to_string())?;
        let dates: Vec<NaiveDate> = dates.iter().filter_map(|date| date.parse().ok()).collect();
        if let Some(snapshot) = self.snapshot.as_mut() { snapshot.reload_days(&journal.store, &dates)?; }
        Ok(())
    }

    /// Runs `f` with the day view and what it needs (the store, the warm data, the day shown, the clock).
    pub fn with_pane<T>(&mut self, f: impl FnOnce(&mut DayPane, &mut day_pane::Ctx) -> T) -> T {
        let date = self.day_shown();
        let now = if self.fixed_clock { self.clock_ms } else { day_pane::Ctx::clock() };
        let mut cx = day_pane::Ctx { store: self.journal.as_mut().map(|journal| &mut journal.store), snapshot: self.snapshot.as_mut(), date, today: self.today, language: self.language, now };
        f(&mut self.pane, &mut cx)
    }

    /// What the day view asks of the window.
    pub fn pane_effect(&mut self, out: day_pane::Out) -> Effect {
        if out.changed { self.last_saved = None; }
        // The day view's list of an entry's actions is the menu behind Strg+K (a picker's Esc comes back to it).
        if let Some(day_pane::Side { view: day_pane::SideView::Actions, entry, .. }) = self.pane.side.clone() {
            self.pane.side = None;
            self.menu = Some(actions::Menu { entry: Some(entry), ..actions::Menu::default() });
            return Effect { focus: Some(Pane::Menu), ..Effect::default() };
        }
        if let Some(day) = out.go_to { self.show_day(day); let out = self.with_pane(|pane, cx| pane.enter(cx)); return self.pane_effect(out); }
        let edit_tag = out.edit_tag.clone();
        let focus = if out.to_search { Some(Pane::Search) } else if out.edit.is_some() { Some(Pane::DayEdit) } else if out.side_text.is_some() { Some(Pane::SideText) } else if out.focus { Some(Pane::Day) } else { None };
        Effect { focus, day_text: out.edit.or(out.side_text), edit_tag, ..Effect::default() }
    }

    /// A key while the day view (or its panel, or one of their inputs) has the keyboard.
    pub fn day_key(&mut self, key: day_pane::K, mods: day_pane::Mods) -> Effect {
        if self.entry_open || self.notepad.is_some() { return Effect::default(); }
        let clear_search = mods.alt && !self.search.is_empty();
        if clear_search { self.search_edited(""); }
        self.status = None;
        self.flash = None;
        let busy = self.pane.edit.is_some() || self.pane.side.is_some();
        // The day: Alt+←/→ and Alt+H as in the search bar (not while writing or in the panel).
        if mods.alt && !busy {
            match key {
                day_pane::K::Left | day_pane::K::Right => { self.show_day(repeat::shift(self.day_shown(), if key == day_pane::K::Left { -1 } else { 1 })); let out = self.with_pane(|pane, cx| pane.enter(cx)); return self.pane_effect(out); }
                day_pane::K::Char('h' | 'H') => { self.show_today(); let out = self.with_pane(|pane, cx| pane.enter(cx)); return self.pane_effect(out); }
                _ => {}
            }
        }
        if mods.ctrl && !mods.alt {
            match key {
                day_pane::K::Char('z' | 'Z') if self.pane.edit.is_none() => return Effect { focus: Some(Pane::Day), ..self.undo_last(false) },
                day_pane::K::Char('y' | 'Y') if self.pane.edit.is_none() => return Effect { focus: Some(Pane::Day), ..self.undo_last(true) },
                day_pane::K::Char('q' | 'Q') => return Effect { quit: true, ..Effect::default() },
                _ => {}
            }
        }
        let out = self.with_pane(|pane, cx| pane.key(cx, key, mods));
        let effect = self.pane_effect(out);
        Effect { search: clear_search.then(String::new), ..effect }
    }

    /// The day view as drawn; the days it needs are read first.
    fn day_view(&mut self) -> DayView {
        let date = self.day_shown();
        if let (Some(journal), Some(snapshot)) = (&self.journal, &mut self.snapshot) {
            let _ = snapshot.ensure(&journal.store, repeat::shift(date, -crate::snapshot::LOOKBACK), repeat::shift(date, 1));
        }
        self.with_pane(|pane, cx| pane.view(cx))
    }

    /// The entry form is open (the day view is hidden).
    pub fn entry_shown(&self) -> bool { self.entry_open }

    /// A timer is running (its clock is drawn anew every second).
    pub fn timers_running(&self) -> bool {
        self.journal.as_ref().and_then(|journal| journal.store.activity_timers().ok()).is_some_and(|timers| timers.values().any(|timer| timer.running()))
    }


    /// The right button is marking a new entry.
    pub fn marking(&self) -> bool { self.mark.is_some() }

    /// Days opened in the calendar (tests).
    #[cfg(test)]
    pub fn opened(&self) -> &BTreeSet<NaiveDate> { &self.cal_open }

    /// The wheel over the calendar (`delta` as the wheel gives it, positive away from the user): it scrolls the days;
    /// with Strg the days grow or shrink, with Strg+Shift the hours, with Shift the hours move sideways.
    pub fn cal_wheel(&mut self, x: f32, delta: f32, ctrl: bool, shift: bool) {
        let m = self.metrics_now();
        let factor = (delta * 0.002).exp();
        match (ctrl, shift) {
            (true, true) => { let (zoom, pan) = calendar::zoom_hours(&m, x, factor); self.zoom_hours = zoom; self.pan = pan; }
            (true, false) => self.zoom_days = (self.zoom_days * factor).clamp(0.5, 2.5),
            (false, true) => self.pan = m.clamp_pan(self.pan - delta / (m.time_w() * m.zoom / 1440.0)),
            (false, false) => self.cal_scroll(-delta),
        }
    }

    /// Scrolling the days by `delta` pixels, positive to later days.
    pub fn cal_scroll(&mut self, delta: f32) {
        let (outcome, _) = self.outcome();
        let items = self.calendar_items(&outcome);
        let open = self.open_days();
        let (top, offset) = calendar::scroll(&self.cal_input(&items, &open), &self.metrics_now(), delta);
        self.cal_top = top; self.cal_offset = offset;
    }

    /// The theme's sizes with the zoom applied.
    pub fn metrics_now(&self) -> Metrics {
        let (base, z) = (self.metrics, self.zoom_days);
        Metrics {
            day_h: (base.day_h * z).max(14.0), thin_h: (base.thin_h * z).max(3.0), row_h: (base.row_h * z).max(16.0),
            chip_h: (base.chip_h * z).clamp(14.0, base.chip_h * 1.5), date_h: (base.date_h * z).clamp(14.0, base.date_h),
            zoom: self.zoom_hours, pan: self.pan, ..base
        }
    }

    /// The days shown open: the ones clicked open, and the draft's day while an entry is made (not while marking).
    fn open_days(&self) -> BTreeSet<NaiveDate> {
        let mut open = self.cal_open.clone();
        if self.entry_open && self.dirty() && self.mark.is_none() { open.insert(self.v.days.iter().next().copied().unwrap_or(self.today)); }
        open
    }

    fn cal_input<'a>(&'a self, items: &'a [Item], open: &'a BTreeSet<NaiveDate>) -> calendar::Input<'a> {
        let cursor = match self.options { Some(Options::Calendar(c)) => Some(c), _ => None };
        calendar::Input {
            today: self.today, now: self.now, top: self.cal_top, offset: self.cal_offset, items, open,
            cursor: cursor.map(|c| c.day),
            caret: cursor.filter(|c| c.hours).map(|c| c.minute),
            selected: &self.cal_selected, language: self.language,
        }
    }

    fn dirty(&self) -> bool { self.v != Values::default() }

    /// The day the calendar should keep in view: the cursor, else where the draft is.
    fn cal_wanted(&self) -> Option<NaiveDate> {
        if let Some(Options::Calendar(c)) = self.options { return Some(c.day); }
        if self.entry_open && self.dirty() { return self.v.days.iter().next().copied().or(Some(self.today)); }
        None
    }

    fn color_of(&self, tag: Option<&str>) -> Option<calendar::Rgb> {
        let tag = tag?;
        self.snapshot.as_ref()?.tags.iter().find(|known| known.id == tag).and_then(|known| calendar::parse_color(&known.color))
    }

    /// Use the entry's own Lucide icon first, then its tag's. Old/unknown names keep the colour dot.
    fn icon_of<'a>(&'a self, own: Option<&'a str>, tag: Option<&str>) -> &'a str {
        own.filter(|name| icons::exists(name)).or_else(|| {
            let id = tag?;
            self.snapshot.as_ref()?.tags.iter().find(|known| known.id == id)?.icon.as_deref().filter(|name| icons::exists(name))
        }).unwrap_or_default()
    }

    /// What is in the journal, plus the entry being made.
    fn calendar_items(&self, outcome: &Outcome) -> Vec<Item> {
        let mut items = Vec::new();
        if let Some(snapshot) = &self.snapshot {
            for (date, entries) in &snapshot.days {
                for entry in entries.iter().filter(|entry| entry.plan.is_none()) {
                    if self.entry_open && self.editing.as_ref().is_some_and(|(_, original)| original.id == entry.id) { continue; }
                    let mut item = Item::from_entry(*date, entry, self.color_of(entry.tag.as_deref()));
                    item.icon = self.icon_of(entry.icon.as_deref(), entry.tag.as_deref()).to_string();
                    items.push(item);
                }
            }
        }
        if self.entry_open && self.dirty() { self.draft_items(outcome, &mut items); }
        items
    }

    fn draft_items(&self, outcome: &Outcome, items: &mut Vec<Item>) {
        let title = if outcome.text.trim().is_empty() { "…" } else { outcome.text.as_str() };
        let color = self.color_of(outcome.tag.as_deref());
        let mut add = |day: NaiveDate| {
            let mut item = Item::new(day, outcome.time.as_deref(), outcome.end.as_deref(), title, color, true, false);
            item.time_grid = self.v.time_grid;
            item.icon = self.icon_of(self.v.icon.as_deref(), outcome.tag.as_deref()).to_string();
            items.push(item);
        };
        if self.v.plan_days.iter().any(|date| *date != outcome.day) {
            for &date in &self.v.plan_days { if date != outcome.day { add(date); } }
            return;
        }
        match &outcome.repeat {
            Some(rule) => for day in repeat::occurrences(rule, rule.start, repeat::shift(rule.start, 366), 400) { add(day); },
            None => add(outcome.day),
        }
        for copy in &outcome.copies { add(*copy); }
        for part in &outcome.additional { self.draft_items(part, items); }
    }

    /// The calendar for what the form holds now: the days around it are read, and it moves to the cursor or the draft
    /// when that left what is shown (but never while the mouse marks something).
    pub fn calendar_view(&mut self) -> CalendarView {
        // The day view's day, marked while the day view is what the left shows.
        self.cal_selected = self.notepad.as_ref().map(|draft| draft.date).or(self.view_day.filter(|_| !self.entry_open)).into_iter().collect();
        if let (Some(journal), Some(snapshot)) = (&self.journal, &mut self.snapshot) {
            let _ = snapshot.ensure(&journal.store, repeat::shift(self.cal_top, -crate::snapshot::LOOKBACK), repeat::shift(self.cal_top, crate::snapshot::AHEAD));
        }
        let (outcome, _) = self.outcome();
        let items = self.calendar_items(&outcome);
        let open = self.open_days();
        let m = self.metrics_now();
        let wanted = if self.mark.is_some() { self.cal_target } else { self.cal_wanted() };
        if wanted != self.cal_target {
            if let Some(day) = wanted {
                let layout = calendar::layout(&self.cal_input(&items, &open), &m);
                let seen = layout.rows.iter().any(|row| row.date == day && row.y >= m.head_h && row.y + row.h <= m.height);
                if !seen { self.cal_top = repeat::shift(day, -2); self.cal_offset = 0.0; }
            }
            self.cal_target = wanted;
        }
        let layout = calendar::layout(&self.cal_input(&items, &open), &m);
        self.shown_layout = layout.clone();
        self.shown_entries = items.into_iter().map(|item| item.entry_id.map(|id| (item.first, id))).collect();
        self.shown_metrics = m;
        CalendarView { layout, focus: matches!(self.options, Some(Options::Calendar(_))), metrics: m }
    }

    // ----- Reading the form -----

    fn draft(&self) -> Draft {
        let v = &self.v;
        let mut draft = Draft { kind: Some(v.typ.kind()), text: crate::templates::without_gaps(&v.title), time: v.start, end: v.start.and(v.end), tag: v.tag.clone(), repeat: v.rule.clone(), ..Draft::default() };
        let parts = ranges(&v.days);
        if parts.iter().all(|(first, last)| first == last) {
            draft.dates = parts.iter().map(|(first, _)| *first).collect();
        } else {
            draft.span = parts.first().copied();
            draft.spans = parts;
            draft.mode = Some(v.mode);
        }
        draft
    }

    fn outcome(&self) -> (Outcome, Option<Problem>) {
        let mut draft = self.draft();
        // Resolve the dates of this occurrence independently of its existing series anchor.
        if let Some((_, original)) = &self.editing {
            let original_rule = original.repeat.as_ref().and_then(|r| r.rule.clone()).and_then(|r| serde_json::from_value(r).ok());
            if draft.repeat == original_rule { draft.repeat = None; }
        }
        let resolved = resolve(&draft, self.today);
        (resolved.choices.into_iter().next().expect("a choice"), resolved.problem)
    }

    fn problem_text(&self, problem: &Problem) -> String {
        let t = self.t();
        match problem {
            Problem::NoText => self.ft().title_needed.into(),
            Problem::UnknownTag(word) => format!("{} {word}", t.unknown_tag),
            Problem::NoteWithTime => t.note_time.into(),
            Problem::NoteRepeats => t.note_repeat.into(),
            Problem::NoDays => t.no_days.into(),
            Problem::Unclear(words) => format!("{} {words}", t.unclear),
        }
    }

    /// Where a problem is mended.
    fn problem_field(problem: &Problem) -> Field {
        match problem {
            Problem::NoText | Problem::Unclear(_) => Field::Title,
            Problem::UnknownTag(_) => Field::Tag,
            Problem::NoteWithTime => Field::Start,
            Problem::NoteRepeats | Problem::NoDays => Field::Repeat,
        }
    }

    /// The problem the entry has now, as it is shown: a missing title only once creating was tried.
    fn live_problem(&self) -> Option<Problem> {
        if self.template.is_some() { return None; }
        self.outcome().1.filter(|problem| *problem != Problem::NoText || self.tried)
    }

    fn extras(&self) -> Extras {
        Extras { description: self.v.description.trim().to_string(), priority: self.v.priority, reminder: self.v.reminder, icon: self.v.icon.clone(), show_in_journal: self.v.typ.journal(), time_grid: self.v.time_grid && self.v.start.is_some() }
    }

    // ----- Creating -----

    fn save(&mut self, stay: bool) -> Effect {
        let t = self.t();
        if let Err(error) = self.commit() { self.status = Some((error, true)); return Effect::default(); }
        if let Some(name) = self.template.clone() { return self.save_template(&name); }
        self.follow_template_day();
        self.tried = true;
        let (outcome, problem) = self.outcome();
        if let Some(problem) = problem {
            let message = self.problem_text(&problem);
            let field = Self::problem_field(&problem);
            let effect = if self.field() != field && self.visible(field) { self.enter_row(field.index()) } else { Effect::default() };
            self.status = Some((message, true));
            return effect;
        }
        let extras = self.extras();
        let ft = self.ft();
        let targets: Vec<_> = self.v.plan_days.iter().copied().collect();
        let Some(journal) = &mut self.journal else { self.status = Some((t.read_only.into(), true)); return Effect::default() };
        let result = if self.editing.is_some() || !targets.is_empty() {
            save::save_planned_or_edited(&mut journal.store, &outcome, &extras, self.today,
                self.editing.as_ref(), &self.v.rule, &targets, ft)
        } else { save::save_with(&mut journal.store, &outcome, &extras, self.today) };
        match result {
            Ok(saved) => {
                if let Some(snapshot) = &mut self.snapshot { let _ = snapshot.reload(&journal.store); }
                self.last_saved = Some(saved);
                self.editing = None;
                self.from_template = false;
                self.v = Values::default();
                self.kind_chosen = false;
                self.tried = false;
                let effect = self.enter_row(TITLE);
                self.flash = Some(t.saved.into());
                if !stay { self.entry_open = false; }
                Effect { focus: Some(if stay { Pane::Entry } else { Pane::Search }), ..effect }
            }
            Err(error) => { self.status = Some((format!("{} {error}", t.save_failed), true)); Effect::default() }
        }
    }

    fn undo_last(&mut self, redo: bool) -> Effect {
        let t = self.t();
        let Some(journal) = &mut self.journal else { return Effect::default() };
        let done = if redo { save::step(&mut journal.store, true).unwrap_or(false) }
            else { match self.last_saved.take() { Some(saved) => save::undo(&mut journal.store, &saved).unwrap_or(false), None => save::step(&mut journal.store, false).unwrap_or(false) } };
        if let Some(snapshot) = &mut self.snapshot { let _ = snapshot.reload(&journal.store); }
        self.status = Some((if done { if redo { t.saved } else { t.undone } } else { t.nothing_to_undo }.into(), !done));
        Effect::default()
    }

    // ----- What is drawn -----

    pub fn view(&mut self) -> View {
        self.follow_template_day();
        let calendar = self.calendar_view();
        let (day, side) = if self.notepad.is_some() {
            (DayView::default(), None)
        } else {
            (self.day_view(), self.with_pane(|pane, cx| pane.side_view(cx)))
        };
        let day_message = self.pane.message.clone();
        let ft = self.ft();
        let field = self.field();
        let problem = self.live_problem();
        let problem_field = problem.as_ref().map(Self::problem_field);
        // Lines counted as shown: the hidden ones do not take room; the type and the title are in the top line.
        let mut lines: Vec<usize> = FIELDS.iter().filter(|f| !f.in_header() && self.visible(**f)).map(|f| f.line()).collect();
        lines.dedup();
        let line_of = |f: Field| lines.iter().position(|line| *line == f.line()).unwrap_or(0);
        let rows: Vec<RowView> = FIELDS.iter().enumerate().filter(|(_, f)| !f.in_header() && self.visible(**f)).map(|(index, f)| {
            let value = self.shown_value(*f);
            RowView {
                field: index, line: line_of(*f), cell: f.cell(), multi: f.line() == 2,
                label: if f.cell() == 0 || *f == Field::Start && !self.visible(Field::Day) { ft.labels[f.line()].to_string() } else { String::new() },
                label_icon: if f.cell() == 0 || *f == Field::Start && !self.visible(Field::Day) { Self::line_icon(*f) } else { "" },
                filled: !value.is_empty(), value,
                hint: self.hint_of(*f).to_string(),
                error: index == self.active && self.row_error.is_some() || problem_field == Some(*f),
                color: if *f == Field::Tag { self.color_of(self.v.tag.as_deref()) } else { None },
                icon: if *f == Field::Icon { self.v.icon.clone().unwrap_or_default() } else if *f == Field::Tag { self.icon_of(None, self.v.tag.as_deref()).to_string() } else { String::new() },
            }
        }).collect();
        let (panel, panel_note) = self.panel();
        let status = self.status.clone()
            .or_else(|| self.row_error.clone().map(|error| (error, true)))
            .or_else(|| problem.as_ref().map(|problem| (self.problem_text(problem), true)))
            .or_else(|| self.flash.clone().map(|text| (text, false)));
        // In the calendar, the clock and the repetition the keys belong to the options; in the lists typing filters.
        let keys_to_options = matches!(self.options, Some(Options::Calendar(_) | Options::Clock(_) | Options::Repeat | Options::RepeatDate { .. } | Options::PlanDates(_)));
        View {
            rows,
            active: self.active,
            active_line: line_of(field),
            active_cell: field.cell(),
            active_multi: field.line() == 2,
            editable: field.text() && !keys_to_options,
            native_arrows: field.native_arrows() && self.options.is_none(),
            type_names: ft.types.map(str::to_string),
            type_icons: ["journal-calendar", "journal-event", "journal-task", "journal-note"],
            options: self.options.is_some(),
            type_selected: self.v.typ.index(),
            panel, panel_note,
            summary: String::new(),
            calendar,
            entry_open: self.entry_open && self.notepad.is_none(),
            day,
            side: self.month_panel().or(side),
            day_message,
            commands: if self.notepad.is_some() { Vec::new() } else { self.commands() },
            searching: self.searching(),
            command_selected: self.command_selected,
            search_placeholder: match &self.template {
                Some(name) => { let l = usize::from(self.language == Language::En); format!("{} #{name} · {}", crate::texts::templates::EDITING[l], crate::texts::templates::EDITING_HINT[l]) }
                None => ft.search.to_string(),
            },
            status,
            placeholder: self.hint_of(field).to_string(),
            title: self.v.title.clone(),
            title_hint: action_texts(self.language).search_title.to_string(),
            in_header: field.in_header(),
            title_error: field == Field::Title && self.row_error.is_some() || problem_field == Some(Field::Title),
            priority: self.v.priority,
            menu: self.menu_view(),
            context: self.context(),
        }
    }

    // ----- The actions behind Strg+K -----

    /// Where the keyboard is, for the footer and the actions.
    pub fn context(&self) -> Context {
        match &self.notepad {
            Some(draft) if draft.panel == 1 => Context::NotesList,
            Some(draft) if draft.editing => Context::NotesEdit,
            Some(_) => Context::NotesRead,
            None if self.entry_open => Context::Entry,
            None if matches!(self.pane.cursor, Some(crate::day_view::Item::Entry(_))) && self.pane.edit.is_none() => Context::DayLine,
            None => Context::Day,
        }
    }

    /// Strg+K: the actions open (about the chosen entry of the day view, the form or the notepad), or close again.
    pub fn toggle_menu(&mut self) -> Effect {
        if self.month_picker_open() { return self.key(Key::Escape, Mods::default()); }
        if self.menu.is_some() || self.pane.side.is_some() { return self.close_menu(); }
        // What is being written in the day view is written first; the actions are then about that entry.
        if self.pane.edit.is_some() && !self.entry_open && self.notepad.is_none() {
            let _ = self.with_pane(|pane, cx| pane.key(cx, day_pane::K::Escape, day_pane::Mods::default()));
        }
        let entry = match (&self.notepad, self.entry_open, &self.pane.cursor) {
            (None, false, Some(crate::day_view::Item::Entry(id))) => Some(id.clone()),
            _ => None,
        };
        self.menu = Some(actions::Menu { entry, ..actions::Menu::default() });
        Effect { focus: Some(Pane::Menu), ..Effect::default() }
    }

    pub fn toggle_app_menu(&mut self) -> Effect {
        if self.menu.as_ref().is_some_and(|menu| menu.app_menu) { return self.close_menu(); }
        self.close_menu();
        if self.pane.edit.is_some() {
            let _ = self.with_pane(|pane, cx| pane.key(cx, day_pane::K::Escape, day_pane::Mods::default()));
        }
        self.menu = Some(actions::Menu { app_menu: true, ..actions::Menu::default() });
        Effect { focus: Some(Pane::Menu), ..Effect::default() }
    }

    /// The actions (or a picker opened from them) close; the keyboard goes back where it was.
    pub fn close_menu(&mut self) -> Effect {
        self.menu = None;
        if self.pane.side.is_some() {
            let out = self.pane.close_side();
            let _ = out;
        }
        Effect { focus: Some(self.home_pane()), ..Effect::default() }
    }

    fn home_pane(&self) -> Pane {
        if self.notepad.is_some() { Pane::Notes } else if self.entry_open { Pane::Entry } else if !self.searching() && self.pane.cursor.is_some() { Pane::Day } else { Pane::Search }
    }

    /// The search of the actions changed.
    pub fn menu_edited(&mut self, text: &str) {
        if let Some(menu) = &mut self.menu { menu.query = text.to_string(); menu.pick = 0; }
    }

    /// ↑/↓ move, Enter carries out, Esc closes.
    pub fn menu_key(&mut self, key: Key) -> Effect {
        let count = self.menu_items().1.len();
        let Some(menu) = &mut self.menu else { return Effect::default() };
        match key {
            Key::Up | Key::Down if count > 0 => {
                let by = if key == Key::Up { count - 1 } else { 1 };
                menu.pick = (menu.pick.min(count - 1) + by) % count;
                Effect::default()
            }
            Key::Home | Key::End if count > 0 => {
                menu.pick = if key == Key::Home { 0 } else { count - 1 };
                Effect::default()
            }
            Key::Enter => { let pick = menu.pick; self.menu_choose(pick) }
            Key::Escape => self.close_menu(),
            _ => Effect::default(),
        }
    }

    /// The lines of the open actions, after the search, with what they are about.
    fn menu_items(&mut self) -> (String, Vec<ActionItem>) {
        let Some(menu) = self.menu.clone() else { return (String::new(), Vec::new()) };
        let at = action_texts(self.language);
        let mut items = Vec::new();
        let title: String;
        if menu.app_menu {
            title = String::new();
            items.push(ActionItem::new(ActionId::Settings, 0, "settings", at.settings));
        } else if let Some(draft) = &self.notepad {
            title = if draft.panel == 1 { at.notepad.to_string() } else if draft.title().is_empty() { notepad_texts(self.language).untitled.to_string() } else { draft.title().to_string() };
            if draft.panel == 1 {
                items.push(ActionItem::new(ActionId::NotesNew, 0, "square-pen", at.notes_new));
                self.notes_actions(&mut items);
            } else if draft.editing {
                items.push(ActionItem::new(ActionId::NotesSave, 0, "save", at.notes_save));
                items.push(ActionItem::new(ActionId::NotesPreview, 0, "eye", at.notes_preview).on(draft.preview));
                items.push(ActionItem::new(ActionId::NotesTag, 0, "tag", at.notes_tag).value(self.notepad_tag_name().unwrap_or_default()));
            } else {
                items.push(ActionItem::new(ActionId::NotesEdit, 0, "pencil", at.notes_edit));
            }
            if draft.panel != 1 && draft.card.original.is_some() {
                items.push(ActionItem { danger: true, ..ActionItem::new(ActionId::NoteDelete, 0, "trash", crate::texts::tags::delete_note(self.language)) });
            }
            if draft.panel != 1 {
                items.push(ActionItem::new(ActionId::NotesFolder, 0, "folder", notepad_texts(self.language).choose_folder));
                items.push(ActionItem::new(ActionId::NotesAttachments, 0, "paperclip", at.notes_attachments));
                items.push(ActionItem::new(ActionId::NotesList, 0, "list", at.notes_list));
            }
            items.push(ActionItem::new(ActionId::NotesClose, 0, "x", at.notes_close));
            items.push(ActionItem::new(ActionId::Settings, 1, "settings", at.settings));
        } else if let (true, Some(name)) = (self.entry_open, &self.template) {
            let l = usize::from(self.language == Language::En);
            title = format!("{} #{name}", crate::texts::templates::EDITING[l]);
            let known = self.templates.find(name).is_some();
            items.push(ActionItem::new(ActionId::Save, 0, "circle-check", crate::texts::templates::SAVE[l]));
            items.push(ActionItem::new(ActionId::Priority, 0, "flag", at.priority).on(self.v.priority));
            items.push(ActionItem::new(ActionId::Repeat, 0, "repeat", self.ft().labels[3]).value(self.shown_value(Field::Repeat)));
            items.push(ActionItem::new(ActionId::Description, 0, "text-align-start", at.description).value(self.v.description.lines().next().unwrap_or_default().to_string()));
            items.push(ActionItem::new(ActionId::Reminder, 0, "bell", at.reminder).value(self.shown_value(Field::Reminder)));
            items.push(ActionItem::new(ActionId::Icon, 0, "image", at.icon).value(self.v.icon.clone().unwrap_or_default()));
            if known { items.push(ActionItem { danger: true, ..ActionItem::new(ActionId::TemplateDelete, 0, "trash", crate::texts::templates::DELETE[l]) }); }
            items.push(ActionItem::new(ActionId::Discard, 0, "x", at.discard));
        } else if self.entry_open {
            title = if self.v.title.trim().is_empty() { at.new_entry.to_string() } else { self.v.title.clone() };
            items.push(ActionItem::new(ActionId::Save, 0, "circle-check", if self.editing_entry() { at.notes_save } else { at.save }));
            items.push(ActionItem::new(ActionId::SaveStay, 0, "circle-plus", if self.editing_entry() { at.edit_save_stay } else { at.save_stay }));
            items.push(ActionItem::new(ActionId::Priority, 0, "flag", at.priority).on(self.v.priority));
            items.push(ActionItem::new(ActionId::Repeat, 0, "repeat", self.ft().labels[3]).value(self.shown_value(Field::Repeat)));
            if self.v.typ != Type::Note {
                items.push(ActionItem::new(ActionId::Plan, 0, "calendar", self.ft().labels[Field::Plan.line()]).value(self.text_of(Field::Plan)));
            }
            items.push(ActionItem::new(ActionId::Description, 0, "text-align-start", at.description).value(self.v.description.lines().next().unwrap_or_default().to_string()));
            items.push(ActionItem::new(ActionId::Reminder, 0, "bell", at.reminder).value(self.shown_value(Field::Reminder)));
            items.push(ActionItem::new(ActionId::Icon, 0, "image", at.icon).value(self.v.icon.clone().unwrap_or_default()));
            if let Some((date, entry)) = self.editing.clone() {
                let scopes = self.delete_items(&entry.id, date);
                if scopes.is_empty() { items.push(ActionItem { danger: true, ..ActionItem::new(ActionId::EntryDelete, 0, "journal-trash", crate::texts::tags::delete_entry(self.language)) }); }
                items.extend(scopes);
            }
            items.push(ActionItem::new(ActionId::Discard, 0, "x", at.discard));
            items.push(ActionItem::new(ActionId::Notebook, 1, "notebook-pen", at.notebook));
            items.push(ActionItem::new(ActionId::Settings, 1, "settings", at.settings));
        } else {
            let entry = menu.entry.as_deref().and_then(|id| self.with_pane(|pane, cx| pane.entry_actions(cx, id)));
            title = match &entry { Some((name, _)) => name.clone(), None => crate::day_view::long_date(self.day_shown(), self.language) };
            for line in entry.map(|(_, lines)| lines).unwrap_or_default() {
                // Deleting: one line, or one per way when the entry has a series or plans.
                if line.action == day_pane::Action::Delete {
                    let scopes = self.delete_items(menu.entry.as_deref().unwrap_or_default(), self.day_shown());
                    if !scopes.is_empty() { items.extend(scopes); continue; }
                }
                items.push(ActionItem { id: ActionId::Entry(line.action), section: 0, icon: line.icon, label: line.label, value: line.value, on: line.on, danger: line.danger, color: line.color });
            }
            items.push(ActionItem::new(ActionId::NewTask, 1, "journal-task", at.new_task));
            items.push(ActionItem::new(ActionId::NewEvent, 1, "journal-event", at.new_event));
            items.push(ActionItem::new(ActionId::NewNote, 1, "journal-note", at.new_note));
            if self.day_shown() != self.today { items.push(ActionItem::new(ActionId::Today, 1, "calendar-check", at.today)); }
            items.push(ActionItem::new(ActionId::Notebook, 1, "notebook-pen", at.notebook));
            items.push(ActionItem::new(ActionId::Undo, 1, "undo-2", at.undo));
            items.push(ActionItem::new(ActionId::Redo, 1, "redo-2", at.redo));
            items.push(ActionItem::new(ActionId::Settings, 1, "settings", at.settings));
        }
        // Deleting is always last, so ↑ from the first line reaches it (the smallest way at the very bottom).
        let deleting = |id: ActionId| matches!(id, ActionId::Entry(day_pane::Action::Delete) | ActionId::DeleteScope(_) | ActionId::NoteDelete | ActionId::FolderDelete | ActionId::EntryDelete);
        items.sort_by_key(|item| deleting(item.id));
        for item in items.iter_mut().filter(|item| deleting(item.id)) { item.section = 2; }
        (title, actions::filter(items, &menu.query))
    }

    fn menu_view(&mut self) -> Option<MenuView> {
        let menu = self.menu.as_ref()?;
        let (pick, app_menu) = (menu.pick, menu.app_menu);
        let (title, items) = self.menu_items();
        Some(MenuView { pick: pick.min(items.len().saturating_sub(1)), title, items, app_menu })
    }

    /// A line of the actions is carried out (Enter or a click). Pickers stay in the popover; anything else closes it.
    pub fn menu_choose(&mut self, index: usize) -> Effect {
        let (_, items) = self.menu_items();
        let Some(item) = items.get(index).cloned() else { return Effect::default() };
        let entry = self.menu.as_ref().and_then(|menu| menu.entry.clone());
        self.menu = None;
        self.run(item.id, entry)
    }

    /// An icon of the day view's footer: a new event (0), task (1) or note (2) in the day shown.
    pub fn create_in_day(&mut self, kind: usize) -> Effect {
        self.menu = None;
        self.run([ActionId::NewEvent, ActionId::NewTask, ActionId::NewNote][kind.min(2)], None)
    }

    /// The footer's main action (Enter's meaning where the keyboard is).
    pub fn footer_primary(&mut self) -> Effect {
        self.menu = None;
        if self.searching() { return self.choose_command(self.command_selected); }
        match self.context() {
            Context::Day => self.run(ActionId::NewTask, None),
            Context::DayLine => { let out = self.with_pane(|pane, cx| pane.key(cx, day_pane::K::Enter, day_pane::Mods::default())); self.pane_effect(out) }
            Context::Entry => self.run(ActionId::Save, None),
            Context::NotesList => self.run(ActionId::NotesNew, None),
            Context::NotesRead => self.run(ActionId::NotesEdit, None),
            Context::NotesEdit => self.run(ActionId::NotesSave, None),
        }
    }

    /// The ways to delete the entry `id` of `date` as lines of the actions, when it has more than one: the largest on top,
    /// "only this one" at the bottom.
    fn delete_items(&self, id: &str, date: NaiveDate) -> Vec<ActionItem> {
        let Some(journal) = self.journal.as_ref() else { return Vec::new() };
        let Ok(scopes) = day_pane::delete_scopes(&journal.store, id, date, self.language) else { return Vec::new() };
        if scopes.len() < 2 { return Vec::new(); }
        let mut ranked: Vec<(usize, day_pane::DeleteScope)> = scopes.into_iter().enumerate().collect();
        ranked.sort_by_key(|(_, scope)| scope.rank);
        ranked.into_iter().map(|(index, scope)| ActionItem { danger: true,
            ..ActionItem::new(ActionId::DeleteScope(index as u8), 2, "journal-trash", &crate::texts::tags::delete_scope(&scope.label, self.language)) }).collect()
    }

    /// One way of deleting, taken from the actions: in the form the entry's day shows first.
    fn delete_scope(&mut self, index: usize, entry: Option<String>) -> Effect {
        let (id, date) = match (&self.editing, entry) {
            (Some((date, open)), _) if self.entry_open => (open.id.clone(), *date),
            (_, Some(id)) => (id, self.day_shown()),
            _ => return Effect::default(),
        };
        let Some(journal) = self.journal.as_ref() else { return Effect::default() };
        let Some(scope) = day_pane::delete_scopes(&journal.store, &id, date, self.language).ok().and_then(|scopes| scopes.into_iter().nth(index)) else { return Effect::default() };
        if self.entry_open { self.close_entry(); }
        self.show_day(date);
        let out = self.with_pane(|pane, cx| pane.remove_scope(cx, &id, scope.ids));
        self.pane_effect(out)
    }

    /// Carries out an action (`entry`: the entry of the day view it is about).
    fn run(&mut self, id: ActionId, entry: Option<String>) -> Effect {
        let alt = day_pane::Mods { alt: true, ..day_pane::Mods::default() };
        match id {
            ActionId::Entry(action) => {
                let Some(id) = entry else { return Effect::default() };
                let out = self.with_pane(|pane, cx| pane.act_on(cx, &id, action));
                self.pane_effect(out)
            }
            ActionId::NewTask => { let out = self.with_pane(|pane, cx| pane.key(cx, day_pane::K::Char('a'), alt)); self.pane_effect(out) }
            ActionId::NewEvent => { let out = self.with_pane(|pane, cx| pane.key(cx, day_pane::K::Char('e'), alt)); self.pane_effect(out) }
            ActionId::NewNote => { let out = self.with_pane(|pane, cx| pane.key(cx, day_pane::K::Char('n'), alt)); self.pane_effect(out) }
            ActionId::Today => { self.show_today(); Effect { focus: Some(Pane::Search), ..Effect::default() } }
            ActionId::Notebook => { let effect = self.open_notepad(); Effect { focus: Some(Pane::Notes), ..effect } }
            ActionId::Undo => Effect { focus: Some(self.home_pane()), ..self.undo_last(false) },
            ActionId::Redo => Effect { focus: Some(self.home_pane()), ..self.undo_last(true) },
            ActionId::Settings => Effect { settings: true, focus: Some(self.home_pane()), ..Effect::default() },
            ActionId::Save => self.key(Key::Enter, Mods { ctrl: true, ..Mods::default() }),
            ActionId::SaveStay => self.key(Key::Enter, Mods { shift: true, ..Mods::default() }),
            ActionId::Priority => { self.v.priority = !self.v.priority; Effect { focus: Some(Pane::Entry), ..Effect::default() } }
            ActionId::Repeat => { self.options = None; let effect = self.open_options(Field::Repeat); Effect { focus: Some(Pane::Entry), ..effect } }
            ActionId::Description => self.open_extra(Field::Description),
            ActionId::Plan => { let effect = self.open_options(Field::Plan); Effect { focus: Some(Pane::Entry), ..effect } }
            ActionId::Reminder => self.open_extra(Field::Reminder),
            ActionId::Icon => self.open_extra(Field::Icon),
            ActionId::Discard => self.close_entry(),
            ActionId::TemplateDelete => self.delete_template(),
            ActionId::NoteDelete if self.notepad.as_ref().is_some_and(|draft| draft.panel != 1) => self.delete_open_note(),
            ActionId::FolderNew | ActionId::FolderSub | ActionId::FolderRename | ActionId::ListMove | ActionId::NotesNewHere | ActionId::NoteDelete | ActionId::FolderDelete => self.run_notes_action(id),
            // The entry open in the form: its day shows, and the day view deletes it there (asking which of a series).
            ActionId::DeleteScope(index) => self.delete_scope(index as usize, entry),
            ActionId::EntryDelete => {
                let Some((date, entry)) = self.editing.clone() else { return Effect::default() };
                self.close_entry();
                self.show_day(date);
                let out = self.with_pane(|pane, cx| pane.act_on(cx, &entry.id, day_pane::Action::Delete));
                self.pane_effect(out)
            }
            ActionId::NotesNew => self.new_notepad_note(),
            ActionId::NotesEdit | ActionId::NotesPreview => { self.notepad_preview(); Effect { focus: Some(Pane::Notes), ..Effect::default() } }
            ActionId::NotesSave => { self.save_notepad_card(); Effect { focus: Some(Pane::Notes), ..Effect::default() } }
            ActionId::NotesTag => { self.notepad_panel(2); Effect { focus: Some(Pane::Notes), ..Effect::default() } }
            ActionId::NotesFolder => { self.notepad_panel(4); Effect { focus: Some(Pane::Notes), ..Effect::default() } }
            ActionId::NotesAttachments => { self.notepad_panel(3); Effect { focus: Some(Pane::Notes), ..Effect::default() } }
            ActionId::NotesList => { self.notepad_panel(1); Effect { focus: Some(Pane::Notes), ..Effect::default() } }
            ActionId::NotesClose => { let effect = self.finish_notepad(false); Effect { focus: effect.focus.or(Some(Pane::Notes)), ..effect } }
        }
    }

    /// The open options under the active line and a note under them.
    fn panel(&self) -> (Panel, String) {
        let ft = self.ft();
        match &self.options {
            None | Some(Options::PlanDates(_) | Options::GoToDate(_)) => (Panel::None, String::new()),
            Some(Options::Calendar(c)) => {
                let label = if c.anchor.is_some() { ft.cal_range } else if c.hours { ft.cal_moment } else { ft.cal_day };
                (Panel::Calendar { label: format!("{label}: {}", self.when_text()), hours: c.hours }, String::new())
            }
            Some(Options::Clock(clock)) => {
                let value = if clock.end { self.v.end } else { self.v.start }.unwrap_or(0);
                let label = if clock.end { match self.v.start { Some(start) => format!("{} · {}", ft.clock_end, length_text(((value as i64 - start as i64).rem_euclid(1440)).max(0), ft)), None => ft.clock_end.into() } } else { ft.clock_start.into() };
                (Panel::Clock { label, hours: format!("{:02}", value / 60 % 24 + if value == 1440 { 24 } else { 0 }), minutes: format!("{:02}", value % 60), on_minutes: clock.minutes }, String::new())
            }
            Some(Options::Repeat | Options::RepeatDate { .. }) => (Panel::Repeat(self.editor.view(self.v.rule.as_ref(), self.language)), String::new()),
            Some(Options::Choices) => match self.field() {
                Field::Tag => {
                    let mut choices: Vec<Choice> = self.tag_options().into_iter().enumerate().map(|(i, (id, name, color))| Choice { label: name, color, icon: self.icon_of(None, id.as_deref()).to_string(), selected: i == self.pick }).collect();
                    if let Some(name) = self.new_tag() { let selected = self.pick == choices.len(); choices.push(Choice { label: crate::texts::tags::make_tag(&name, self.language), color: None, icon: "plus".into(), selected }); }
                    (Panel::Tags(choices), String::new())
                }
                Field::Icon => {
                    let results = self.icon_results();
                    let note = if results.is_empty() { ft.no_icons.to_string() } else { results.get(self.pick).map(|name| name.to_string()).unwrap_or_default() };
                    (Panel::Icons(results.iter().enumerate().map(|(i, name)| Choice { label: name.to_string(), color: None, icon: name.to_string(), selected: i == self.pick }).collect()), note)
                }
                Field::Reminder => (Panel::Reminders(ft.reminder_presets.iter().enumerate().map(|(i, label)| Choice { label: label.to_string(), color: None, icon: String::new(), selected: i == self.pick }).collect()), String::new()),
                _ => (Panel::None, String::new()),
            },
        }
    }

    /// The date and time as one short line ("Do 19.11. · 14:00–15:30", "Mo 23.11. – Fr 27.11.").
    fn when_text(&self) -> String {
        let label = |day: NaiveDate| repeat::format_occurrence(day, self.language);
        let (first, last) = (self.v.days.iter().next().copied().unwrap_or(self.today), self.v.days.iter().last().copied().unwrap_or(self.today));
        let days = if first == last { label(first) } else { format!("{} – {}", label(first), label(last)) };
        match (self.v.start, self.v.end) {
            (Some(start), Some(end)) => format!("{days} · {}–{}", format_time(start), format_time(end)),
            (Some(start), None) => format!("{days} · {}", format_time(start)),
            _ => days,
        }
    }
}

/// The longest a reminder may come before its entry (as the app allows).
fn storage_max_reminder() -> i64 { journal_core::storage::MAX_REMINDER_BEFORE }

#[cfg(test)]
#[path = "form_tests.rs"]
mod tests;
