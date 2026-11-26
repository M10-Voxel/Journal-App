//! Which views and parts are on (F1 → Funktionen), as the app's `features.ts` (branch `Windows`). The calendar is always
//! there; the notebook and each view (day … year) can be switched off, and every view shows the parts chosen for it.
//!
//! The app keeps its switches in its own browser storage, which J-TerminaL cannot read; so these are J-TerminaL's own,
//! kept with its settings on this device, with the app's defaults and rules.
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use crate::analysis;

/// A view of the left side: a day, or a week … year (the app's `PeriodMode`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum View { #[default] Day, Week, Month, Quarter, Year }

impl View {
    pub const ALL: [View; 5] = [View::Day, View::Week, View::Month, View::Quarter, View::Year];
    pub fn index(self) -> usize { self as usize }
    /// The app's name of it (`day`, `week` …), also the first part of a period's key.
    pub fn key(self) -> &'static str { ["day", "week", "month", "quarter", "year"][self.index()] }
    /// The analysis' period of the same length (none for a day).
    pub fn period(self) -> Option<analysis::Mode> {
        match self { View::Day => None, View::Week => Some(analysis::Mode::Week), View::Month => Some(analysis::Mode::Month),
            View::Quarter => Some(analysis::Mode::Quarter), View::Year => Some(analysis::Mode::Year) }
    }
    /// The first and last day around `date` (`periodBounds`).
    pub fn bounds(self, date: NaiveDate) -> (NaiveDate, NaiveDate) { self.period().map_or((date, date), |mode| mode.bounds(date)) }
    /// The same place a view before or after.
    pub fn step(self, date: NaiveDate, forward: bool) -> NaiveDate {
        match self {
            View::Day => date + chrono::Duration::days(if forward { 1 } else { -1 }),
            // A week on keeps the weekday, so the day view shows the same weekday again.
            View::Week => date + chrono::Duration::days(if forward { 7 } else { -7 }),
            _ => self.period().map_or(date, |mode| mode.step(date, forward)),
        }
    }
    /// The key of the period around `date` in the period data (`periodKey`): `day:2026-11-18`, `week:2026-11-16` …
    pub fn period_key(self, date: NaiveDate) -> String { format!("{}:{}", self.key(), self.bounds(date).0) }
    /// How many views lie between the one around `today` and the one around `date` (negative: before).
    pub fn distance(self, today: NaiveDate, date: NaiveDate) -> i64 {
        let (a, b) = (self.bounds(today).0, self.bounds(date).0);
        match self {
            View::Day => (b - a).num_days(),
            View::Week => (b - a).num_days() / 7,
            View::Month => (b.year() - a.year()) as i64 * 12 + b.month() as i64 - a.month() as i64,
            View::Quarter => ((b.year() - a.year()) as i64 * 12 + b.month() as i64 - a.month() as i64) / 3,
            View::Year => (b.year() - a.year()) as i64,
        }
    }
}

/// The board of a view (`/Pinnwand-Woche` …).
pub fn board_period(view: View) -> crate::board::Period { crate::board::Period::ALL[view.index()] }

/// A part of a view (`Module`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Module { Entries, Rating, Scales, Activities, Note, Evaluation, Board, Title }

impl Module {
    /// Every part in the order a view shows them (`moduleOrder`, with J-TerminaL's title first: the app has none for a
    /// week … year, so it is J-TerminaL's own part).
    pub const ORDER: [Module; 8] = [Module::Title, Module::Entries, Module::Rating, Module::Scales, Module::Activities, Module::Note, Module::Evaluation, Module::Board];
    pub fn key(self) -> &'static str {
        match self {
            Module::Entries => "entries", Module::Rating => "rating", Module::Scales => "scales", Module::Activities => "activities",
            Module::Note => "note", Module::Evaluation => "evaluation", Module::Board => "board", Module::Title => "title",
        }
    }
    pub fn from_key(key: &str) -> Option<Module> { Module::ORDER.into_iter().find(|module| module.key() == key) }
    fn bit(self) -> u8 { 1 << self as u8 }
}

/// The parts a view offers: a day has no evaluation (`modulesOf`).
pub fn modules_of(view: View) -> impl Iterator<Item = Module> {
    Module::ORDER.into_iter().filter(move |module| view != View::Day || *module != Module::Evaluation)
}

/// A set of parts (kept as their names, as the app writes them).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modules(u8);

impl Modules {
    pub fn of(list: &[Module]) -> Self { Modules(list.iter().fold(0, |bits, module| bits | module.bit())) }
    pub fn has(self, module: Module) -> bool { self.0 & module.bit() != 0 }
    pub fn is_empty(self) -> bool { self.0 == 0 }
    fn with(self, module: Module, on: bool) -> Self { Modules(if on { self.0 | module.bit() } else { self.0 & !module.bit() }) }
    fn only(self, view: View) -> Self { Modules(modules_of(view).filter(|module| self.has(*module)).fold(0, |bits, module| bits | module.bit())) }
}

impl Serialize for Modules {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_seq(Module::ORDER.iter().filter(|module| self.has(**module)).map(|module| module.key()))
    }
}

impl<'de> Deserialize<'de> for Modules {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let names = Vec::<String>::deserialize(deserializer)?;
        Ok(Modules::of(&names.iter().filter_map(|name| Module::from_key(name)).collect::<Vec<_>>()))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewFeatures { pub on: bool, pub modules: Modules }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Views { pub day: ViewFeatures, pub week: ViewFeatures, pub month: ViewFeatures, pub quarter: ViewFeatures, pub year: ViewFeatures }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Features {
    pub notebook: bool,
    pub views: Views,
    /// The title part is known (switches stored before it came had the day's title always on: it is added once). Missing
    /// in what was stored: false.
    #[serde(default)]
    pub titles: bool,
}

fn view_of(on: bool, modules: &[Module]) -> ViewFeatures { ViewFeatures { on, modules: Modules::of(modules) } }

impl Default for Views {
    /// What the app showed before the views could be chosen (`defaultFeatures`).
    fn default() -> Self {
        use Module::*;
        Views {
            day: view_of(true, &[Title, Entries, Rating, Scales, Activities, Board]),
            week: view_of(true, &[Note, Evaluation]),
            month: view_of(true, &[Note, Evaluation, Board]),
            quarter: view_of(true, &[Note, Evaluation]),
            year: view_of(true, &[Note, Evaluation, Board]),
        }
    }
}

impl Default for Features {
    fn default() -> Self { Features { notebook: true, views: Views::default(), titles: true } }
}

impl Features {
    pub fn view(&self, view: View) -> ViewFeatures {
        let v = &self.views;
        [v.day, v.week, v.month, v.quarter, v.year][view.index()]
    }
    fn view_mut(&mut self, view: View) -> &mut ViewFeatures {
        let v = &mut self.views;
        match view { View::Day => &mut v.day, View::Week => &mut v.week, View::Month => &mut v.month, View::Quarter => &mut v.quarter, View::Year => &mut v.year }
    }

    /// Made valid (`normalizeFeatures`): known parts only; a view without any part is off; with every view off the day
    /// comes back (something has to stand beside the calendar).
    pub fn normalized(mut self) -> Self {
        if !self.titles {
            self.titles = true;
            self.views.day.modules = self.views.day.modules.with(Module::Title, true);
        }
        for view in View::ALL {
            let current = self.view_mut(view);
            current.modules = current.modules.only(view);
            current.on = current.on && !current.modules.is_empty();
        }
        if !View::ALL.iter().any(|view| self.view(*view).on) {
            let day = self.view_mut(View::Day);
            if day.modules.is_empty() { day.modules = Views::default().day.modules; }
            day.on = true;
        }
        self
    }

    /// The boards as the app has them on (its `board-scopes`): each view's board on or off, the rest as it is.
    pub fn with_boards(mut self, boards: &[crate::board::Period]) -> Self {
        for view in View::ALL {
            let on = boards.contains(&board_period(view));
            let next = self.view(view).modules.with(Module::Board, on).only(view);
            if !next.is_empty() { self.view_mut(view).modules = next; }
        }
        self
    }

    /// The views on, in their order (never empty once normalized).
    pub fn views_on(&self) -> Vec<View> { View::ALL.into_iter().filter(|view| self.view(*view).on).collect() }
    pub fn is_on(&self, view: View) -> bool { self.view(view).on }
    /// `hasModule`: the view is on and shows the part.
    pub fn has(&self, view: View, module: Module) -> bool { let v = self.view(view); v.on && v.modules.has(module) }

    /// The view to show instead of one switched off: the nearest one on, a smaller one first (`availableMode`).
    pub fn available(&self, view: View) -> View {
        if self.is_on(view) { return view; }
        let mut near = View::ALL.to_vec();
        near.sort_by_key(|other| ((other.index() as i32 - view.index() as i32).abs(), other.index()));
        near.into_iter().find(|other| self.is_on(*other)).unwrap_or(View::Day)
    }

    /// The view after or before `view` among those on, round again.
    pub fn next(&self, view: View, forward: bool) -> View {
        let on = self.views_on();
        let at = on.iter().position(|other| *other == view).unwrap_or(0) as i32;
        let count = on.len().max(1) as i32;
        on.get((at + if forward { 1 } else { -1 }).rem_euclid(count) as usize).copied().unwrap_or(View::Day)
    }

    /// A view on or off; the last view on stays on, and one switched on without parts gets its default ones (`withView`).
    pub fn with_view(mut self, view: View, on: bool) -> Self {
        if !on && self.views_on().iter().all(|other| *other == view) { return self; }
        let defaults = Features::default().view(view).modules;
        let current = self.view_mut(view);
        if on && current.modules.is_empty() { current.modules = defaults; }
        current.on = on;
        self
    }

    /// A part of a view on or off; the last part of a view stays (switch the view off instead) (`withModule`).
    pub fn with_module(mut self, view: View, module: Module, on: bool) -> Self {
        if !modules_of(view).any(|known| known == module) { return self; }
        let next = self.view(view).modules.with(module, on).only(view);
        if next.is_empty() { return self; }
        self.view_mut(view).modules = next;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repeat::d;

    #[test]
    fn the_defaults_and_rules_are_the_apps() {
        let features = Features::default();
        assert!(features.has(View::Day, Module::Entries) && !features.has(View::Day, Module::Note));
        assert!(features.has(View::Month, Module::Board) && !features.has(View::Week, Module::Board));
        assert_eq!(features.views_on().len(), 5);
        // The last part of a view stays; the last view stays.
        let only_note = Features::default().with_module(View::Week, Module::Evaluation, false);
        assert!(only_note.has(View::Week, Module::Note));
        assert_eq!(only_note.with_module(View::Week, Module::Note, false), only_note);
        let mut alone = Features::default();
        for view in [View::Week, View::Month, View::Quarter, View::Year] { alone = alone.with_view(view, false); }
        assert_eq!(alone.views_on(), [View::Day]);
        assert_eq!(alone.with_view(View::Day, false).views_on(), [View::Day]);
        assert_eq!(alone.available(View::Month), View::Day);
        // A day has no evaluation.
        assert!(!Features::default().with_module(View::Day, Module::Evaluation, true).has(View::Day, Module::Evaluation));
        assert_eq!(Features::default().next(View::Year, true), View::Day);
        assert_eq!(Features::default().with_view(View::Week, false).next(View::Day, true), View::Month);
    }

    #[test]
    fn stored_as_the_app_writes_them_and_made_valid() {
        let json = serde_json::to_value(Features::default()).unwrap();
        assert_eq!(json["views"]["day"]["modules"][0], "title", "The day's title, as before.");
        let older: Features = serde_json::from_value(serde_json::json!({ "views": { "day": { "on": true, "modules": ["entries"] } } })).unwrap();
        assert!(older.normalized().has(View::Day, Module::Title), "Switches stored before the title came keep the day's title.");
        assert_eq!(json["views"]["month"]["modules"], serde_json::json!(["note", "evaluation", "board"]));
        let read: Features = serde_json::from_value(serde_json::json!({ "titles": true, "views": { "day": { "on": true, "modules": ["evaluation"] }, "week": { "on": false, "modules": [] } } })).unwrap();
        let read = read.normalized();
        assert!(!read.is_on(View::Day), "A day with only an evaluation shows nothing: off.");
        assert!(read.is_on(View::Month), "Views not stored keep their defaults.");
        let none: Features = serde_json::from_value(serde_json::json!({ "views": { "day": { "on": false, "modules": [] }, "week": { "on": false, "modules": [] }, "month": { "on": false, "modules": [] }, "quarter": { "on": false, "modules": [] }, "year": { "on": false, "modules": [] } } })).unwrap();
        assert_eq!(none.normalized().views_on(), [View::Day], "With every view off the day comes back.");
    }

    #[test]
    fn periods_have_their_keys_and_distances() {
        assert_eq!(View::Week.period_key(d("2026-11-18")), "week:2026-11-16");
        assert_eq!(View::Day.period_key(d("2026-11-18")), "day:2026-11-18");
        assert_eq!(View::Quarter.period_key(d("2026-11-18")), "quarter:2026-10-01");
        assert_eq!(View::Month.distance(d("2026-11-18"), d("2027-01-03")), 2);
        assert_eq!(View::Week.distance(d("2026-11-18"), d("2026-11-09")), -1);
        assert_eq!(View::Week.step(d("2026-11-18"), true), d("2026-11-25"));
    }
}
