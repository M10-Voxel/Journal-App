//! The actions behind `Strg+K`, as Raycast's action panel: a short list over the footer with a search under it. What
//! is listed depends on where the keyboard is: the chosen entry of the day view (its settings and pickers) and the
//! day's general actions, the entry form, or the notepad. Every action shows the keys it also has, as they are set now.
//! The model has no window; `form.rs` keeps the open menu and carries out what is chosen.
use crate::calendar::Rgb;
use crate::day::Action;
use crate::engine::parse::fold;

/// What an action does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Id {
    /// Something done to the chosen entry of the day view.
    Entry(Action),
    NewTask, NewEvent, NewNote, Today, Notebook, Undo, Redo, Settings,
    /// The entry form.
    Save, SaveStay, Priority, Repeat, Plan, Description, Reminder, Icon, Discard,
    /// A template being written (`/Vorlage Name`) is deleted.
    TemplateDelete,
    /// The notepad.
    NotesNew, NotesEdit, NotesSave, NotesPreview, NotesTag, NotesFolder, NotesAttachments, NotesList, NotesClose,
}

impl Id {
    /// The shortcut it has in the settings (its keys are shown beside it).
    pub fn binding(self) -> Option<&'static str> {
        Some(match self {
            Id::Entry(action) => match action {
                Action::Status => "day-done",
                Action::Priority => "day-priority",
                Action::Tag => "day-tag",
                Action::Time => "day-time",
                Action::Reminder => "day-reminder",
                Action::Icon => "day-icon",
                Action::Description => "day-description",
                Action::Tomorrow => "day-tomorrow",
                Action::Plan => "day-plan",
                Action::Delete => "day-remove",
                Action::Kind | Action::Jump => return None,
            },
            Id::NewTask => "day-task",
            Id::NewEvent => "day-event",
            Id::NewNote => "day-note",
            Id::Today => "today",
            Id::Notebook => "notebook",
            Id::Undo => "undo",
            Id::Redo => "redo",
            Id::Settings => "settings",
            Id::Save => "form-save",
            Id::SaveStay => "form-save-stay",
            Id::Priority => "form-priority",
            Id::Description => "form-description",
            Id::Reminder => "form-reminder",
            Id::Icon => "form-icon",
            Id::NotesNew => "notes-new",
            Id::NotesEdit => "notes-edit",
            Id::NotesSave => "notes-save",
            Id::NotesPreview => "notes-preview",
            Id::NotesTag => "notes-tag",
            Id::NotesAttachments => "notes-attachments",
            Id::NotesList => "notes-list",
            Id::Repeat | Id::Plan | Id::Discard | Id::TemplateDelete | Id::NotesFolder | Id::NotesClose => return None,
        })
    }

    /// Keys that are fixed (not in the settings).
    pub fn fixed_keys(self) -> &'static str {
        match self { Id::Discard | Id::NotesClose => "Esc", _ => "" }
    }
}

/// One line of the list.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: Id,
    /// 0 the entry (or form, or note), 1 general.
    pub section: usize,
    pub icon: String,
    pub label: String,
    /// What it is set to now (a tag's name, a time), quiet at the right.
    pub value: String,
    pub on: bool,
    pub danger: bool,
    pub color: Option<Rgb>,
}

impl Item {
    pub fn new(id: Id, section: usize, icon: &str, label: &str) -> Self {
        Item { id, section, icon: icon.into(), label: label.into(), value: String::new(), on: false, danger: false, color: None }
    }
    pub fn value(mut self, value: impl Into<String>) -> Self { self.value = value.into(); self }
    pub fn on(mut self, on: bool) -> Self { self.on = on; self }
}

/// The open menu: what is typed into its search, the chosen line, and the entry it is about.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Menu {
    pub query: String,
    pub pick: usize,
    pub entry: Option<String>,
    pub app_menu: bool,
}

/// The lines whose name (or value) has what is typed: names starting with it first, then words starting with it,
/// then the rest; otherwise in their order.
pub fn filter(items: Vec<Item>, query: &str) -> Vec<Item> {
    let query = fold(query.trim());
    if query.is_empty() { return items; }
    let mut found: Vec<(u8, Item)> = items.into_iter().filter_map(|item| {
        let label = fold(&item.label);
        let rank = if label.starts_with(&query) { 0 }
            else if label.split_whitespace().any(|word| word.starts_with(&query)) { 1 }
            else if label.contains(&query) || fold(&item.value).contains(&query) { 2 }
            else { return None };
        Some((rank, item))
    }).collect();
    found.sort_by_key(|(rank, _)| *rank);
    found.into_iter().map(|(_, item)| item).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list() -> Vec<Item> {
        vec![
            Item::new(Id::Entry(Action::Status), 0, "", "Status").value("Offen"),
            Item::new(Id::Entry(Action::Tag), 0, "", "Tag").value("Gesundheit"),
            Item::new(Id::Entry(Action::Plan), 0, "", "Planen"),
            Item::new(Id::NewTask, 1, "", "Neue Aufgabe"),
            Item::new(Id::Notebook, 1, "", "Notizblock öffnen"),
        ]
    }

    #[test]
    fn filters_by_name_and_value_with_the_best_matches_first() {
        assert_eq!(filter(list(), "").len(), 5);
        let ids: Vec<Id> = filter(list(), "auf").into_iter().map(|item| item.id).collect();
        assert_eq!(ids, [Id::NewTask], "A word of the name that starts with it.");
        let ids: Vec<Id> = filter(list(), "ges").into_iter().map(|item| item.id).collect();
        assert_eq!(ids, [Id::Entry(Action::Tag)], "The value counts too.");
        let ids: Vec<Id> = filter(list(), "N").into_iter().map(|item| item.id).collect();
        assert_eq!(ids[0], Id::NewTask, "Names starting with it come first.");
        assert!(ids.contains(&Id::Entry(Action::Plan)));
        assert!(filter(list(), "xyz").is_empty());
        assert_eq!(filter(list(), "OFFEN")[0].id, Id::Entry(Action::Status));
    }

    #[test]
    fn every_action_with_keys_names_a_known_shortcut() {
        let bindings = crate::shortcuts::Bindings::default();
        let all = [Id::NewTask, Id::NewEvent, Id::NewNote, Id::Today, Id::Notebook, Id::Undo, Id::Redo, Id::Settings, Id::Save, Id::SaveStay,
            Id::Priority, Id::Description, Id::Reminder, Id::Icon, Id::NotesNew, Id::NotesEdit, Id::NotesSave, Id::NotesPreview, Id::NotesTag,
            Id::NotesAttachments, Id::NotesList, Id::Entry(Action::Status), Id::Entry(Action::Delete), Id::Entry(Action::Plan)];
        for id in all {
            let keys = crate::shortcuts::keys(&bindings, id.binding().unwrap(), crate::texts::Language::De);
            assert!(!keys.is_empty(), "{id:?}");
        }
    }
}
