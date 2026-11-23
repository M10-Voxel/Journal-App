//! Templates for entries (`/Vorlage Name` makes or changes one, `#Name` in the search bar opens it). A template keeps
//! everything of an entry except its day: the type, the title, the times, the repetition, the tag, the reminder, the icon,
//! the description and the importance. They live in a file of J-TerminaL beside its settings, not in the journal.
//!
//! The title may have gaps, written as `...` (or `…`): "Vorlesung ... Uni". Opening the template selects the first
//! gap, so typing fills it; Tab goes to the next one. Gaps left open fall out when the entry is created.
use std::{fs, io, ops::Range, path::PathBuf};
use serde::{Deserialize, Serialize};
use crate::engine::parse::fold;
use crate::repeat::Rule;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "kebab-case")]
pub struct Template {
    pub name: String,
    /// "calendar", "event", "task" or "note".
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub start: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")] pub end: Option<u32>,
    /// Its start is the day it was made on; opening the template moves it to the entry's day.
    #[serde(skip_serializing_if = "Option::is_none")] pub repeat: Option<Rule>,
    #[serde(skip_serializing_if = "Option::is_none")] pub tag: Option<String>,
    #[serde(skip_serializing_if = "String::is_empty")] pub description: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")] pub priority: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub reminder: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub icon: Option<String>,
}

/// The templates and the file they are kept in (none: only in memory, as in tests without a folder).
#[derive(Clone, Debug, Default)]
pub struct Templates {
    pub list: Vec<Template>,
    path: Option<PathBuf>,
}

impl Templates {
    pub fn load(path: Option<PathBuf>) -> io::Result<Self> {
        let list = match &path {
            Some(path) => match fs::read(path) {
                Ok(data) => serde_json::from_slice(&data)?,
                Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
                Err(error) => return Err(error),
            },
            None => Vec::new(),
        };
        Ok(Self { list, path })
    }

    /// The template of this name (the case and umlauts do not matter).
    pub fn find(&self, name: &str) -> Option<&Template> {
        let wanted = fold(name.trim());
        self.list.iter().find(|t| fold(&t.name) == wanted)
    }

    /// The templates whose name starts with what is typed (then those that contain it), by name.
    pub fn matching(&self, query: &str) -> Vec<&Template> {
        let query = fold(query.trim());
        let mut found: Vec<_> = self.list.iter().filter(|t| fold(&t.name).contains(&query)).collect();
        found.sort_by_key(|t| (!fold(&t.name).starts_with(&query), fold(&t.name)));
        found
    }

    /// Kept under its name: a template of the same name is replaced.
    pub fn put(&mut self, template: Template) -> io::Result<()> {
        let mut list = self.list.clone();
        let wanted = fold(&template.name);
        match list.iter_mut().find(|t| fold(&t.name) == wanted) {
            Some(old) => *old = template,
            None => list.push(template),
        }
        self.write(list)
    }

    pub fn remove(&mut self, name: &str) -> io::Result<bool> {
        let wanted = fold(name.trim());
        let list: Vec<_> = self.list.iter().filter(|t| fold(&t.name) != wanted).cloned().collect();
        let removed = list.len() != self.list.len();
        if removed { self.write(list)?; }
        Ok(removed)
    }

    fn write(&mut self, list: Vec<Template>) -> io::Result<()> {
        if let Some(path) = &self.path { crate::settings::write_json(path, &list)?; }
        self.list = list;
        Ok(())
    }
}

/// A name for a template: what follows `#`, so no spaces at the ends and none of `#`.
pub fn clean_name(name: &str) -> String { name.trim().trim_start_matches('#').trim().to_string() }

const GAPS: [&str; 2] = ["...", "…"];

/// The gaps of a title (byte ranges), in order.
pub fn gaps(title: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut at = 0;
    while at < title.len() {
        let rest = &title[at..];
        if let Some(gap) = GAPS.iter().find(|gap| rest.starts_with(**gap)) {
            // A longer run of dots is one gap.
            let mut end = at + gap.len();
            while title[end..].starts_with('.') || title[end..].starts_with('…') { end += title[end..].chars().next().map_or(1, char::len_utf8); }
            out.push(at..end);
            at = end;
        } else {
            at += rest.chars().next().map_or(1, char::len_utf8);
        }
    }
    out
}

/// The first gap after `after` (a byte offset; none: the first of all).
pub fn next_gap(title: &str, after: Option<usize>) -> Option<Range<usize>> {
    gaps(title).into_iter().find(|gap| after.map_or(true, |after| gap.start > after))
}

/// The title with the gaps left open taken out.
pub fn without_gaps(title: &str) -> String {
    if gaps(title).is_empty() { return title.trim().to_string(); }
    let mut out = String::new();
    let mut last = 0;
    for gap in gaps(title) {
        out.push_str(&title[last..gap.start]);
        last = gap.end;
    }
    out.push_str(&title[last..]);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gaps_in_a_title() {
        assert_eq!(gaps("Vorlesung ... Uni"), vec![10..13]);
        assert_eq!(gaps("... trifft …, um ...."), vec![0..3, 11..14, 19..23]);
        assert_eq!(gaps("Ohne Lücke"), Vec::<Range<usize>>::new());
        assert_eq!(next_gap("a ... b ... c", None), Some(2..5));
        assert_eq!(next_gap("a ... b ... c", Some(2)), Some(8..11));
        assert_eq!(next_gap("a ... b ... c", Some(8)), None);
        // Filling the first gap moves the second; it still comes after where the first began.
        assert_eq!(next_gap("a Anna b ... c", Some(2)), Some(9..12));
    }

    #[test]
    fn open_gaps_fall_out() {
        assert_eq!(without_gaps("Vorlesung ... Uni"), "Vorlesung Uni");
        assert_eq!(without_gaps("Geburtstag ..."), "Geburtstag");
        assert_eq!(without_gaps("Anna … Geburtstag"), "Anna Geburtstag");
        assert_eq!(without_gaps("Nichts offen"), "Nichts offen");
    }

    #[test]
    fn kept_found_replaced_and_removed() {
        let dir = std::env::temp_dir().join(format!("j-terminal-templates-{}", uuid::Uuid::new_v4()));
        let path = dir.join("j-terminal-templates.json");
        let mut templates = Templates::load(Some(path.clone())).unwrap();
        assert!(templates.list.is_empty());
        templates.put(Template { name: "Geburtstag".into(), kind: "event".into(), title: "... hat Geburtstag".into(), icon: Some("cake".into()), ..Template::default() }).unwrap();
        templates.put(Template { name: "Vorlesung".into(), kind: "calendar".into(), title: "Vorlesung ... Uni".into(), start: Some(600), ..Template::default() }).unwrap();
        templates.put(Template { name: "geburtstag".into(), kind: "event".into(), title: "Geburtstag von ...".into(), ..Template::default() }).unwrap();
        let again = Templates::load(Some(path.clone())).unwrap();
        assert_eq!(again.list.len(), 2);
        assert_eq!(again.find("GEBURTSTAG").unwrap().title, "Geburtstag von ...");
        assert_eq!(again.matching("vor").iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), ["Vorlesung"]);
        assert_eq!(again.matching("").len(), 2);
        let mut again = again;
        assert!(again.remove("Vorlesung").unwrap());
        assert!(!again.remove("Vorlesung").unwrap());
        assert_eq!(Templates::load(Some(path)).unwrap().list.len(), 1);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn names_lose_the_sign() {
        assert_eq!(clean_name("  #Geburtstag "), "Geburtstag");
    }
}
