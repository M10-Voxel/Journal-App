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
}

impl Default for Preferences {
    fn default() -> Self {
        Self { start_view: StartView::Day, center_window: false, return_today: true,
            language: DisplayLanguage::Journal, keycaps: true, parse_titles: true,
            week_numbers: true, weekends: true, now_line: true, edit_notes: false, calendar_label_width: None }
    }
}

impl Preferences {
    pub fn load(path: Option<&Path>) -> io::Result<Self> {
        let Some(path) = path else { return Ok(Self::default()); };
        match fs::read(path) {
            Ok(data) => Ok(serde_json::from_slice(&data)?),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error),
        }
    }

    pub fn effective_language(&self, journal: Language) -> Language {
        match self.language { DisplayLanguage::Journal => journal, DisplayLanguage::German => Language::De, DisplayLanguage::English => Language::En }
    }

    fn index(&self, key: PreferenceKey) -> i32 {
        match key {
            PreferenceKey::None => 0,
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
        }
    }

    pub fn change(&mut self, key: PreferenceKey, index: i32) -> Option<()> {
        use PreferenceKey as K;
        let checked = index == 1;
        match key {
            K::StartView => self.start_view = *[StartView::Day, StartView::Entry].get(index as usize)?,
            K::Language => self.language = *[DisplayLanguage::Journal, DisplayLanguage::German, DisplayLanguage::English].get(index as usize)?,
            _ if !(0..=1).contains(&index) => return None,
            K::WindowPosition => self.center_window = checked,
            K::ReturnToday => self.return_today = checked,
            K::Keycaps => self.keycaps = checked,
            K::ParseTitles => self.parse_titles = checked,
            K::WeekNumbers => self.week_numbers = checked,
            K::Weekends => self.weekends = checked,
            K::NowLine => self.now_line = checked,
            K::NoteMode => self.edit_notes = checked,
            K::None => return None,
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
pub enum Page { #[default] General, Keyboard, Entry, Calendar, Notebook }
const PAGES: [Page; 5] = [Page::General, Page::Keyboard, Page::Entry, Page::Calendar, Page::Notebook];

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
            let (title, detail) = (tr(option.title, language), tr(option.detail, language));
            let index = prefs.index(option.key);
            let choices: Vec<_> = option.choices.iter().map(|t| tr(*t, language)).collect();
            if searching {
                let haystack = fold(&format!("{page} {heading} {title} {detail} {}", choices.join(" ")));
                if !query.split_whitespace().all(|term| haystack.contains(term)) { continue; }
            }
            rows.push(SettingsRow { preference: option.key, starts_group: first,
                heading: (if !first { "" } else if searching && heading.is_empty() { page } else { heading }).into(),
                control: if choices.is_empty() { RowControl::Toggle } else { RowControl::Choice },
                action: title.into(), detail: detail.into(), value: choices.get(index as usize).copied().unwrap_or_default().into(),
                choices: crate::strings(choices.into_iter().map(str::to_owned)), index, ..Default::default() });
            first = false;
        }
    }
    if location.page == Page::Keyboard || searching {
        rows.extend(shortcuts::rows(bindings, language, &location.query).into_iter().map(|row| SettingsRow {
            starts_group: !row.heading.is_empty(), heading: row.heading.into(), id: row.id.into(),
            action: row.action.into(), value: row.keys.into(), changed: row.changed,
            control: if row.id.is_empty() { RowControl::Fixed } else { RowControl::Shortcut }, ..Default::default()
        }));
    }
    rows
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
