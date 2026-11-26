use std::{fs, io, path::Path};
use serde::{Deserialize, Serialize};
use crate::{
    engine::parse::fold, shortcuts, texts::{settings::{self as copy, tr}, Language},
    PreferenceKey, RowControl, SettingsCategory, SettingsRow, SettingsWindow,
};
use slint::ComponentHandle;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StartView { #[default] Day, Entry }

/// How the window is laid out: side by side (form and calendar beside each other), one above the other (for a
/// screen standing upright), or chosen by the screen's width.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Orientation { #[default] Auto, Horizontal, Vertical }

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DisplayLanguage { #[default] Journal, German, English }

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "kebab-case")]
pub struct Preferences {
    pub start_view: StartView,
    pub center_window: bool,
    pub return_today: bool,
    pub language: DisplayLanguage,
    pub keycaps: bool,
    pub parse_titles: bool,
    pub week_numbers: bool,
    pub weekends: bool,
    pub now_line: bool,
    pub edit_notes: bool,
    /// The calendar's day column, dragged wider or narrower with the mouse (None: the theme's width).
    pub calendar_label_width: Option<u16>,
    /// The notepad beside the calendar, dragged wider at its edge (None: the theme's width).
    pub notepad_width: Option<u16>,
    /// The notepad takes the whole window (F11 or the actions); the calendar is hidden meanwhile.
    pub notepad_wide: bool,
    /// Opened again: where it was (false: the start view).
    pub reopen_stay: bool,
    /// How long it stays where it was after being hidden, in seconds or minutes (`reopen_minutes`).
    pub reopen_after: u32,
    pub reopen_minutes: bool,
    pub orientation: Orientation,
    /// F1 → Funktionen: the notebook and the views with their parts (as the app's, kept here on this device).
    pub features: crate::features::Features,
    /// The switches were changed here: from then on they are J-TerminaL's own. Until then the boards follow the app
    /// (its `board-scopes` file, which tells which views have a board).
    pub features_set: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self { start_view: StartView::Day, center_window: false, return_today: true,
            language: DisplayLanguage::Journal, keycaps: true, parse_titles: true,
            week_numbers: true, weekends: true, now_line: true, edit_notes: false, calendar_label_width: None,
            notepad_width: None, notepad_wide: false, reopen_stay: false, reopen_after: 5, reopen_minutes: true, orientation: Orientation::Auto,
            features: crate::features::Features::default(), features_set: false }
    }
}

impl Preferences {
    pub fn load(path: Option<&Path>) -> io::Result<Self> {
        let Some(path) = path else { return Ok(Self::default()); };
        match fs::read(path) {
            Ok(data) => {
                let mut read: Self = serde_json::from_slice(&data)?;
                read.features = read.features.normalized();
                Ok(read)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error),
        }
    }

    /// Whether the window, hidden for `away`, opens where it was (else at the start view).
    pub fn keeps_place(&self, away: Option<std::time::Duration>) -> bool {
        let unit = if self.reopen_minutes { 60 } else { 1 };
        self.reopen_stay && away.is_some_and(|away| away.as_secs() < u64::from(self.reopen_after) * unit)
    }

    pub fn effective_language(&self, journal: Language) -> Language {
        match self.language { DisplayLanguage::Journal => journal, DisplayLanguage::German => Language::De, DisplayLanguage::English => Language::En }
    }

    fn index(&self, key: PreferenceKey) -> i32 {
        match key {
            PreferenceKey::None | PreferenceKey::Feature => 0,
            PreferenceKey::StartView => self.start_view as i32,
            PreferenceKey::WindowPosition => self.center_window.into(),
            PreferenceKey::ReturnToday => self.return_today.into(),
            PreferenceKey::Language => self.language as i32,
            PreferenceKey::Keycaps => self.keycaps.into(),
            PreferenceKey::ParseTitles => self.parse_titles.into(),
            PreferenceKey::WeekNumbers => self.week_numbers.into(),
            PreferenceKey::Weekends => self.weekends.into(),
            PreferenceKey::NowLine => self.now_line.into(),
            PreferenceKey::NoteMode => self.edit_notes.into(),
            PreferenceKey::Reopen => self.reopen_stay.into(),
            PreferenceKey::Orientation => self.orientation as i32,
            PreferenceKey::ReopenAfter => self.reopen_after as i32,
            PreferenceKey::ReopenUnit => self.reopen_minutes.into(),
        }
    }

    pub fn change(&mut self, key: PreferenceKey, index: i32) -> Option<()> {
        use PreferenceKey as K;
        let checked = index == 1;
        match key {
            K::StartView => self.start_view = *[StartView::Day, StartView::Entry].get(index as usize)?,
            K::Language => self.language = *[DisplayLanguage::Journal, DisplayLanguage::German, DisplayLanguage::English].get(index as usize)?,
            K::Orientation => self.orientation = *[Orientation::Auto, Orientation::Horizontal, Orientation::Vertical].get(index as usize)?,
            K::ReopenAfter => self.reopen_after = u32::try_from(index).ok().filter(|n| (1..=999).contains(n))?,
            _ if !(0..=1).contains(&index) => return None,
            K::WindowPosition => self.center_window = checked,
            K::ReturnToday => self.return_today = checked,
            K::Keycaps => self.keycaps = checked,
            K::ParseTitles => self.parse_titles = checked,
            K::WeekNumbers => self.week_numbers = checked,
            K::Weekends => self.weekends = checked,
            K::NowLine => self.now_line = checked,
            K::NoteMode => self.edit_notes = checked,
            K::Reopen => self.reopen_stay = checked,
            K::ReopenUnit => self.reopen_minutes = checked,
            K::None | K::Feature => return None,
        }
        Some(())
    }
}

/// Replace the complete configuration only after serialization and writing have succeeded.
pub fn write_json(path: &Path, values: &impl Serialize) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(values)?;
    if let Some(directory) = path.parent() { fs::create_dir_all(directory)?; }
    let scratch = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    if let Err(error) = fs::write(&scratch, bytes).and_then(|()| fs::rename(&scratch, path)) {
        let _ = fs::remove_file(scratch);
        return Err(error);
    }
    Ok(())
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Page { #[default] General, Keyboard, Entry, Calendar, Notebook, Features, Activities, Values }
const PAGES: [Page; 8] = [Page::General, Page::Keyboard, Page::Entry, Page::Calendar, Page::Notebook, Page::Features, Page::Activities, Page::Values];

impl Page {
    /// The page of the period data it shows (its own panel instead of options).
    pub fn period(self) -> Option<crate::period_settings::Page> {
        match self { Page::Activities => Some(crate::period_settings::Page::Activities), Page::Values => Some(crate::period_settings::Page::Values), _ => None }
    }
}

#[derive(Default)]
pub struct Location { pub page: Page, pub query: String }

pub struct Navigation { locations: Vec<Location>, current: usize }
impl Default for Navigation {
    fn default() -> Self { Self { locations: vec![Location::default()], current: 0 } }
}
impl Navigation {
    pub fn location(&self) -> &Location { &self.locations[self.current] }
    pub fn search(&mut self, text: &str) { self.locations[self.current].query = text.to_owned(); }
    pub fn back(&self) -> bool { self.current > 0 }
    pub fn forward(&self) -> bool { self.current + 1 < self.locations.len() }
    pub fn visit(&mut self, index: i32) {
        let Some(&page) = PAGES.get(index as usize) else { return };
        if self.location().page == page && self.location().query.is_empty() { return; }
        self.locations.truncate(self.current + 1);
        self.locations.push(Location { page, query: String::new() });
        self.current += 1;
    }
    pub fn travel(&mut self, forward: bool) {
        if forward && self.forward() { self.current += 1; }
        if !forward && self.back() { self.current -= 1; }
    }
}

pub fn icon(window: &SettingsWindow, name: &str, size: f32) -> slint::Image {
    let px = (size * window.window().scale_factor()).round().max(1.0) as u32;
    crate::raster_icon(name, px)
}

pub fn categories(window: &SettingsWindow, language: Language) -> slint::ModelRc<SettingsCategory> {
    let theme = window.global::<crate::Theme>();
    PAGES.iter().map(|page| {
        let (name, description, symbol) = page.copy();
        SettingsCategory { name: tr(name, language).into(), description: tr(description, language).into(),
            icon: icon(window, symbol, theme.get_settings_icon_size()),
            hero_icon: icon(window, symbol, theme.get_settings_hero_symbol()) }
    }).collect::<Vec<_>>().as_slice().into()
}

pub fn rows(location: &Location, prefs: &Preferences, bindings: &shortcuts::Bindings, language: Language) -> Vec<SettingsRow> {
    let query = fold(location.query.trim());
    let searching = !query.is_empty();
    let mut rows = Vec::new();
    if location.page == Page::General && !searching {
        rows.push(SettingsRow { control: RowControl::Featured, id: "window-toggle".into(), action: tr(copy::GLOBAL_KEY, language).into(),
            detail: tr(copy::GLOBAL_DETAIL, language).into(), value: shortcuts::keys(bindings, "window-toggle", language).into(),
            changed: bindings.system_hotkey() != bindings.default_system_hotkey(), starts_group: true, ..Default::default() });
    }
    for group in copy::GROUPS.iter().filter(|group| searching || group.page == location.page) {
        let page = tr(group.page.copy().0, language);
        let heading = tr(group.heading, language);
        let mut first = true;
        for option in group.options {
            // How long it stays only matters while it stays at all.
            if matches!(option.key, PreferenceKey::ReopenAfter | PreferenceKey::ReopenUnit) && !prefs.reopen_stay { continue; }
            let (title, detail) = (tr(option.title, language), tr(option.detail, language));
            let index = prefs.index(option.key);
            let choices: Vec<_> = option.choices.iter().map(|t| tr(*t, language)).collect();
            if searching {
                let haystack = fold(&format!("{page} {heading} {title} {detail} {}", choices.join(" ")));
                if !query.split_whitespace().all(|term| haystack.contains(term)) { continue; }
            }
            rows.push(SettingsRow { preference: option.key, starts_group: first,
                heading: (if !first { "" } else if searching && heading.is_empty() { page } else { heading }).into(),
                control: if option.key == PreferenceKey::ReopenAfter { RowControl::Amount } else if choices.is_empty() { RowControl::Toggle } else { RowControl::Choice },
                action: title.into(), detail: detail.into(),
                value: if option.key == PreferenceKey::ReopenAfter { index.to_string().into() } else { choices.get(index as usize).copied().unwrap_or_default().into() },
                choices: crate::strings(choices.into_iter().map(str::to_owned)), index, ..Default::default() });
            first = false;
        }
    }
    if location.page == Page::Features || searching { rows.extend(feature_rows(&prefs.features, language, &query)); }
    if location.page == Page::Keyboard || searching {
        rows.extend(shortcuts::rows(bindings, language, &location.query).into_iter().map(|row| SettingsRow {
            starts_group: !row.heading.is_empty(), heading: row.heading.into(), id: row.id.into(),
            action: row.action.into(), value: row.keys.into(), changed: row.changed,
            control: if row.id.is_empty() { RowControl::Fixed } else { RowControl::Shortcut }, ..Default::default()
        }));
    }
    rows
}

/// The switches of F1 → Funktionen: the notebook, then each view with its parts (only while it is on), as the app's
/// `FeatureSettings`. `query`: only the switches whose words have it (searching all pages).
fn feature_rows(features: &crate::features::Features, language: Language, query: &str) -> Vec<SettingsRow> {
    use crate::features::{modules_of, View};
    let mut rows = Vec::new();
    let page = tr(Page::Features.copy().0, language);
    let fits = |words: &str| query.is_empty() || { let haystack = fold(&format!("{page} {words}")); query.split_whitespace().all(|term| haystack.contains(term)) };
    let push = |rows: &mut Vec<SettingsRow>, id: String, title: &str, detail: &str, on: bool, heading: &str, first: bool| {
        rows.push(SettingsRow { preference: PreferenceKey::Feature, control: RowControl::Toggle, id: id.into(), starts_group: first,
            heading: heading.into(), action: title.into(), detail: detail.into(), index: on.into(), ..Default::default() });
    };
    let (title, detail) = (tr(copy::FEATURE_NOTEBOOK.0, language), tr(copy::FEATURE_NOTEBOOK.1, language));
    if fits(&format!("{title} {detail}")) { push(&mut rows, "feature:notebook".into(), title, detail, features.notebook, "", true); }
    let last = features.views_on().len() == 1;
    for view in View::ALL {
        let on = features.is_on(view);
        let name = tr(copy::view_name(view), language);
        let (title, detail) = (tr(copy::view_title(view), language), if last && on { tr(copy::LAST_VIEW, language) } else { tr(copy::VIEW_DETAIL, language) });
        let mut first = true;
        if fits(&format!("{name} {title} {detail}")) { push(&mut rows, format!("feature:{}", view.key()), title, detail, on, name, true); first = false; }
        if !on { continue; }
        for module in modules_of(view) {
            let (title, detail) = copy::module_text(module, view);
            let (title, detail) = (tr(title, language), tr(detail, language));
            if !fits(&format!("{name} {title} {detail}")) { continue; }
            push(&mut rows, format!("feature:{}:{}", view.key(), module.key()), title, detail, features.has(view, module), if first { name } else { "" }, first);
            first = false;
        }
    }
    rows
}

/// A switch of F1 → Funktionen by its id; false when it changes nothing (the last view, a view's last part).
pub fn change_feature(features: &mut crate::features::Features, id: &str, on: bool) -> bool {
    use crate::features::{Module, View};
    let mut parts = id.strip_prefix("feature:").unwrap_or_default().split(':');
    let next = match (parts.next(), parts.next()) {
        (Some("notebook"), None) => crate::features::Features { notebook: on, ..*features },
        (Some(view), module) => {
            let Some(view) = View::ALL.into_iter().find(|known| known.key() == view) else { return false };
            match module.map(Module::from_key) {
                None => features.with_view(view, on),
                Some(Some(module)) => features.with_module(view, module, on),
                Some(None) => return false,
            }
        }
        _ => return false,
    };
    let changed = next != *features;
    *features = next;
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_controls_round_trip_in_an_older_profile() {
        let path = std::env::temp_dir().join(format!("j-terminal-preferences-{}.json", uuid::Uuid::new_v4()));
        assert_eq!(Preferences::load(Some(&path)).unwrap(), Preferences::default());
        fs::write(&path, br#"{"hide-on-blur":false,"save-delay":"two-seconds","start-view":"entry"}"#).unwrap();
        let mut prefs = Preferences::load(Some(&path)).unwrap();
        assert_eq!(prefs, Preferences { start_view: StartView::Entry, ..Default::default() });
        for option in copy::GROUPS.iter().flat_map(|group| group.options) {
            // A number: 1–999.
            if option.key == PreferenceKey::ReopenAfter {
                for index in [1, 30, 999] { prefs.change(option.key, index).unwrap(); assert_eq!(prefs.index(option.key), index); }
                assert!(prefs.change(option.key, 0).is_none() && prefs.change(option.key, 1000).is_none());
                continue;
            }
            let limit = option.choices.len().max(2) as i32;
            for index in 0..limit {
                prefs.change(option.key, index).unwrap();
                assert_eq!(prefs.index(option.key), index);
            }
            let previous = prefs;
            assert!(prefs.change(option.key, limit).is_none());
            assert_eq!(prefs, previous);
        }
        prefs.calendar_label_width = Some(210);
        write_json(&path, &prefs).unwrap();
        assert_eq!(Preferences::load(Some(&path)).unwrap(), prefs);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn the_feature_switches_follow_the_apps_rules() {
        use crate::features::{Module, View};
        let mut features = crate::features::Features::default();
        let location = Location { page: Page::Features, query: String::new() };
        let prefs = Preferences::default();
        let rows = rows(&location, &prefs, &shortcuts::Bindings::default(), Language::De);
        let ids: Vec<&str> = rows.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(ids[..4], ["feature:notebook", "feature:day", "feature:day:title", "feature:day:entries"]);
        assert!(!ids.contains(&"feature:day:evaluation"), "A day has no evaluation.");
        assert!(ids.contains(&"feature:year:board"));
        assert!(change_feature(&mut features, "feature:week:entries", true));
        assert!(features.has(View::Week, Module::Entries));
        assert!(change_feature(&mut features, "feature:month", false));
        assert!(!features.is_on(View::Month));
        assert!(!change_feature(&mut features, "feature:month:note", false) || !features.is_on(View::Month));
        assert!(change_feature(&mut features, "feature:notebook", false) && !features.notebook);
        assert!(!change_feature(&mut features, "feature:unknown", true));
        // Searching finds them by the view and the part.
        let found = super::rows(&Location { page: Page::General, query: "Woche Notiz".into() }, &prefs, &shortcuts::Bindings::default(), Language::De);
        assert!(found.iter().any(|row| row.id == "feature:week:note"));
    }

    #[test]
    fn the_view_is_kept_for_the_time_set() {
        use std::time::Duration;
        let mut prefs = Preferences::default();
        assert!(!prefs.keeps_place(Some(Duration::from_secs(1))), "At first it opens at the start view.");
        prefs.reopen_stay = true;
        assert!(prefs.keeps_place(Some(Duration::from_secs(299))) && !prefs.keeps_place(Some(Duration::from_secs(300))), "Five minutes.");
        prefs.reopen_minutes = false;
        prefs.reopen_after = 20;
        assert!(prefs.keeps_place(Some(Duration::from_secs(19))) && !prefs.keeps_place(Some(Duration::from_secs(20))));
        assert!(!prefs.keeps_place(None), "Never hidden: the start view.");
        // The time and its unit are offered only while it stays.
        let general = Location::default();
        let bindings = shortcuts::Bindings::default();
        let keys = |prefs: &Preferences| rows(&general, prefs, &bindings, Language::De).into_iter().map(|row| row.preference).collect::<Vec<_>>();
        assert!(keys(&prefs).contains(&PreferenceKey::ReopenAfter));
        let amount = rows(&general, &prefs, &bindings, Language::De).into_iter().find(|row| row.preference == PreferenceKey::ReopenAfter).unwrap();
        assert_eq!((amount.control, amount.value.as_str()), (RowControl::Amount, "20"));
        prefs.reopen_stay = false;
        assert!(!keys(&prefs).contains(&PreferenceKey::ReopenAfter) && !keys(&prefs).contains(&PreferenceKey::ReopenUnit));
    }

    #[test]
    fn back_and_forward_restore_search_and_a_new_visit_discards_the_forward_branch() {
        let mut nav = Navigation::default();
        nav.search("montag");
        nav.visit(Page::Calendar as i32);
        nav.visit(Page::Keyboard as i32);
        nav.travel(false);
        assert_eq!(nav.location().page, Page::Calendar);
        nav.travel(false);
        assert_eq!(nav.location().query, "montag");
        nav.travel(true);
        nav.visit(Page::Notebook as i32);
        assert!(!nav.forward());
        assert_eq!(nav.location().page, Page::Notebook);
    }

    #[test]
    fn search_covers_both_languages_and_all_categories_without_duplicating_the_featured_key() {
        let bindings = shortcuts::Bindings::default();
        for (lang, query) in [(Language::De, "Wochennummer"), (Language::En, "week number")] {
            let location = Location { query: query.into(), ..Default::default() };
            let found = rows(&location, &Preferences::default(), &bindings, lang);
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].preference, PreferenceKey::WeekNumbers);
            assert!(found[0].starts_group);
        }
        for query in ["Ctrl+Alt+Space", "Globales Tastenkürzel", "Tasta ausblenden"] {
            let hotkey = Location { query: query.into(), ..Default::default() };
            assert_eq!(rows(&hotkey, &Preferences::default(), &bindings, Language::De).iter().filter(|row| row.id == "window-toggle").count(), 1);
        }
    }
}
