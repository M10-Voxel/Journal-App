//! The notepad's list (panel 1) as a tree of folders and notes: the cursor, folders opening and closing, making and
//! naming folders, and moving notes and folders into folders (from the actions, a right click or by dragging).
use super::*;
use crate::notes_list::{self, Item as ListItem, Line, Mode};
use crate::texts::tags as words;
use uuid::Uuid;

/// What a key in the list asks of the window.
#[derive(Default)]
pub struct ListOut {
    /// The list's input gets this text (cleared, or a folder's name to change).
    pub query: Option<String>,
    /// A note's attachment to show (as a chosen line of the list).
    pub target: Option<notebook::Target>,
    /// Esc on the list: out of the notepad, as before.
    pub close: bool,
    pub effect: Effect,
}

impl Form {
    /// The lines of the list: the tree while nothing is typed and all notes are shown, else the notes found.
    pub(super) fn notes_lines(&self, query: &str) -> Vec<(Line, String)> {
        let Some((draft, journal)) = self.notepad.as_ref().zip(self.journal.as_ref()) else { return Vec::new() };
        let on_day = draft.notes_on_day.then_some(draft.date);
        let Ok(notes) = notebook::notes(&journal.store, query, on_day) else { return Vec::new() };
        if query.trim().is_empty() && on_day.is_none() {
            let folders = notebook::folder_list(&journal.store).unwrap_or_default();
            return notes_list::tree(&folders, &notes, &self.notes_list.closed).into_iter().map(|line| (line, String::new())).collect();
        }
        let labels = notepad_texts(self.language);
        let mut last_group = None;
        notes.into_iter().map(|item| {
            let mut group = String::new();
            if last_group.as_ref() != Some(&item.folder) {
                group = item.folder.as_ref().map_or_else(|| labels.unfiled.to_owned(), |path| path.iter().map(|(_, name)| name.as_str()).collect::<Vec<_>>().join(" / "));
                last_group = Some(item.folder.clone());
            }
            (Line::Note { id: item.id, title: item.title, detail: item.detail, depth: 0, folder: item.folder_id }, group)
        }).collect()
    }

    /// The list's lines as the window shows them.
    pub(super) fn notes_rows(&mut self, query: &str) -> Vec<NotepadChoice> {
        self.notes_query = query.to_string();
        let labels = notepad_texts(self.language);
        match self.notes_list.mode.clone() {
            Mode::Name { .. } => Vec::new(),
            Mode::Confirm(id) => {
                let name = self.item_name(&ListItem::Note(id));
                self.notes_list.clamp(2);
                [(format!("delete:{id}"), words::confirm_delete(&name, self.language), "trash"), ("cancel".to_string(), words::cancel(self.language).to_string(), "x")]
                    .into_iter().enumerate().map(|(i, (key, title, icon))| NotepadChoice { key, title, icon, selected: i == self.notes_list.cursor, ..NotepadChoice::default() }).collect()
            }
            Mode::Move(item) => {
                let Some(journal) = self.journal.as_ref() else { return Vec::new() };
                let folders = notebook::folder_list(&journal.store).unwrap_or_default();
                let current = match &item {
                    ListItem::Folder(id) => folders.iter().find(|f| &f.id == id).and_then(|f| f.parent.clone()),
                    ListItem::Note(id) => notebook::Card::open(&journal.store, *id).ok().and_then(|card| card.folder),
                };
                let targets = notes_list::targets(&folders, &item, query);
                self.notes_list.clamp(targets.len());
                targets.into_iter().enumerate().map(|(i, (id, path))| NotepadChoice {
                    detail: if id == current { labels.current_folder.to_owned() } else { String::new() },
                    key: format!("to:{}", id.clone().unwrap_or_default()),
                    title: if id.is_none() { labels.unfiled.to_owned() } else { path },
                    selected: i == self.notes_list.cursor, folder: true, icon: if id.is_none() { "notebook-pen" } else { "folder" },
                    ..NotepadChoice::default()
                }).collect()
            }
            Mode::Browse => {
                let lines = self.notes_lines(query);
                self.notes_list.clamp(lines.len());
                lines.into_iter().enumerate().map(|(i, (line, group))| {
                    let selected = i == self.notes_list.cursor;
                    match line {
                        Line::Folder { id, name, depth, open, .. } => NotepadChoice {
                            key: format!("folder:{id}"), title: name, depth, folder: true, open, selected,
                            icon: if open { "folder-open" } else { "folder" }, ..NotepadChoice::default()
                        },
                        Line::Note { id, title, detail, depth, .. } => NotepadChoice {
                            key: id.to_string(), title: if title.is_empty() { labels.untitled.to_owned() } else { title }, detail, group, depth, selected,
                            icon: if self.notes_lines_tree(query) { "sticky-note" } else { "" }, ..NotepadChoice::default()
                        },
                    }
                }).collect()
            }
        }
    }

    fn notes_lines_tree(&self, query: &str) -> bool {
        query.trim().is_empty() && !self.notepad.as_ref().is_some_and(|draft| draft.notes_on_day)
    }

    /// 0 the tree, 1 found notes, 2 choosing where something goes, 3 typing a folder's name.
    pub fn notes_list_mode(&self) -> i32 {
        match self.notes_list.mode {
            Mode::Browse if self.notes_lines_tree(&self.notes_query) => 0,
            Mode::Browse => 1,
            Mode::Move(_) | Mode::Confirm(_) => 2,
            Mode::Name { .. } => 3,
        }
    }

    /// What the list's input and an empty list say while something is moved or named.
    pub fn notes_list_hint(&self) -> Option<(String, String)> {
        let l = self.language;
        match &self.notes_list.mode {
            Mode::Browse => None,
            Mode::Confirm(_) => Some((words::delete_question(l).into(), String::new())),
            Mode::Move(item) => Some((words::move_to(&self.item_name(item), l), String::new())),
            Mode::Name { rename: Some(_), .. } => Some((words::rename_folder(l).into(), words::folder_name_hint(l).into())),
            Mode::Name { parent: Some(parent), .. } => Some((words::new_subfolder(&self.folder_name(parent), l), words::folder_name_hint(l).into())),
            Mode::Name { .. } => Some((words::new_folder(l).into(), words::folder_name_hint(l).into())),
        }
    }

    fn folder_name(&self, id: &str) -> String {
        self.journal.as_ref().and_then(|j| notebook::folder_list(&j.store).ok()).and_then(|folders| folders.into_iter().find(|f| f.id == id)).map(|f| f.name).unwrap_or_default()
    }

    fn item_name(&self, item: &ListItem) -> String {
        match item {
            ListItem::Folder(id) => self.folder_name(id),
            ListItem::Note(id) => self.journal.as_ref().and_then(|j| notebook::Card::open(&j.store, *id).ok()).and_then(|card| card.original)
                .map(|card| notebook::text(&card, "title").to_owned()).filter(|t| !t.is_empty()).unwrap_or_else(|| notepad_texts(self.language).untitled.to_owned()),
        }
    }

    /// The line the cursor is on (in the tree or the notes found).
    pub(super) fn notes_line(&self) -> Option<Line> {
        if self.notes_list.mode != Mode::Browse { return None; }
        self.notes_lines(&self.notes_query).into_iter().nth(self.notes_list.cursor).map(|(line, _)| line)
    }

    /// A key in the list (its input keeps the other keys).
    pub fn notes_list_key(&mut self, key: &str) -> ListOut {
        // The note open: Alt+Entf deletes it (back in the list, asked there).
        if key == "delete" && self.notepad.as_ref().is_some_and(|draft| draft.panel != 1) {
            return ListOut { effect: self.delete_open_note(), ..ListOut::default() };
        }
        let query = self.notes_query.clone();
        self.status = None;
        match self.notes_list.mode.clone() {
            Mode::Browse => {
                let lines: Vec<Line> = self.notes_lines(&query).into_iter().map(|(line, _)| line).collect();
                let step = match key { "up" => Some(notes_list::Key::Up), "down" => Some(notes_list::Key::Down), "left" => Some(notes_list::Key::Left),
                    "right" => Some(notes_list::Key::Right), "home" => Some(notes_list::Key::Home), "end" => Some(notes_list::Key::End), _ => None };
                if let Some(step) = step { self.notes_list.key(&lines, step); return ListOut::default(); }
                match (key, lines.get(self.notes_list.cursor)) {
                    ("delete", Some(Line::Folder { id, .. })) => self.delete_folder(&id.clone()),
                    ("delete", Some(Line::Note { id, .. })) => self.ask_delete(*id),
                    ("enter", Some(Line::Folder { id, .. })) => { self.notes_list.toggle(id); ListOut::default() }
                    ("enter", Some(line @ Line::Note { .. })) => ListOut { target: self.pick_notepad(&line.key()), ..ListOut::default() },
                    ("escape", _) => ListOut { close: true, ..ListOut::default() },
                    _ => ListOut::default(),
                }
            }
            Mode::Move(item) => match key {
                "up" => { self.notes_list.cursor = self.notes_list.cursor.saturating_sub(1); ListOut::default() }
                "down" => { self.notes_list.cursor += 1; ListOut::default() }
                "enter" => {
                    let Some(journal) = self.journal.as_ref() else { return ListOut::default() };
                    let folders = notebook::folder_list(&journal.store).unwrap_or_default();
                    match notes_list::targets(&folders, &item, &query).into_iter().nth(self.notes_list.cursor) {
                        Some((to, _)) => self.move_item(&item, to.as_deref()),
                        None => ListOut::default(),
                    }
                }
                "escape" => self.browse(None),
                _ => ListOut::default(),
            },
            Mode::Confirm(id) => match key {
                "up" | "down" => { self.notes_list.cursor = usize::from(key == "down"); ListOut::default() }
                "enter" if self.notes_list.cursor == 0 => self.delete_note(id),
                "enter" | "escape" => self.browse(Some(id.to_string())),
                _ => ListOut::default(),
            },
            Mode::Name { parent, rename } => match key {
                "enter" => {
                    let Some(journal) = self.journal.as_mut() else { return ListOut::default() };
                    let made = match &rename {
                        Some(id) => notebook::rename_folder(&mut journal.store, id, &query).map(|()| id.clone()),
                        None => notebook::create_folder(&mut journal.store, &query, parent.as_deref()),
                    };
                    match made {
                        Ok(id) => {
                            if let Some(parent) = &parent { self.notes_list.closed.remove(parent); }
                            self.last_saved = None;
                            self.browse(Some(format!("folder:{id}")))
                        }
                        Err(_) => { self.status = Some((words::folder_name_hint(self.language).into(), true)); ListOut::default() }
                    }
                }
                "escape" => self.browse(None),
                _ => ListOut::default(),
            },
        }
    }

    /// Back to the tree, the cursor on `at` (a line's key) when given.
    fn browse(&mut self, at: Option<String>) -> ListOut {
        self.notes_list.mode = Mode::Browse;
        self.notes_query.clear();
        if let Some(key) = at {
            let lines: Vec<Line> = self.notes_lines("").into_iter().map(|(line, _)| line).collect();
            self.notes_list.point_at(&lines, &key);
        }
        ListOut { query: Some(String::new()), effect: Effect { focus: Some(Pane::Notes), ..Effect::default() }, ..ListOut::default() }
    }

    /// The note or folder goes into `to` (none: out of every folder); the tree shows it there.
    fn move_item(&mut self, item: &ListItem, to: Option<&str>) -> ListOut {
        let Some(journal) = self.journal.as_mut() else { return ListOut::default() };
        let moved = match item {
            ListItem::Folder(id) => notebook::move_folder(&mut journal.store, id, to),
            ListItem::Note(id) => notebook::move_note(&mut journal.store, *id, to),
        };
        if let Err(error) = moved { self.notepad_error(error); return ListOut::default(); }
        if let Some(to) = to { self.notes_list.closed.remove(to); }
        self.last_saved = None;
        let key = match item { ListItem::Folder(id) => format!("folder:{id}"), ListItem::Note(id) => id.to_string() };
        self.browse(Some(key))
    }

    /// A click on a line of the list: a folder opens or closes, a place to move to is taken, a note opens.
    pub(super) fn notes_click(&mut self, key: &str) -> Option<ListOut> {
        if let Some(id) = key.strip_prefix("folder:") {
            let lines: Vec<Line> = self.notes_lines(&self.notes_query.clone()).into_iter().map(|(line, _)| line).collect();
            self.notes_list.point_at(&lines, key);
            self.notes_list.toggle(id);
            return Some(ListOut::default());
        }
        if let Some(id) = key.strip_prefix("delete:") { return id.parse().ok().map(|id| self.delete_note(id)); }
        if key == "cancel" {
            let at = match &self.notes_list.mode { Mode::Confirm(id) => Some(id.to_string()), _ => None };
            return Some(self.browse(at));
        }
        if let Some(to) = key.strip_prefix("to:") {
            let Mode::Move(item) = self.notes_list.mode.clone() else { return Some(ListOut::default()) };
            return Some(self.move_item(&item, (!to.is_empty()).then_some(to)));
        }
        None
    }

    /// A right click on a line: the cursor goes there and the actions open about it.
    pub fn notes_list_menu(&mut self, key: &str) -> Effect {
        if self.notes_list.mode != Mode::Browse { return Effect::default(); }
        let lines: Vec<Line> = self.notes_lines(&self.notes_query.clone()).into_iter().map(|(line, _)| line).collect();
        self.notes_list.point_at(&lines, key);
        self.menu = None;
        self.toggle_menu()
    }

    /// A line dragged onto the line `to`: into that folder (or the folder of that note).
    pub fn notes_list_drop(&mut self, key: &str, to: usize) -> ListOut {
        let lines: Vec<Line> = self.notes_lines(&self.notes_query.clone()).into_iter().map(|(line, _)| line).collect();
        let Some(target) = lines.get(to) else { return ListOut::default() };
        let folder = target.folder_for_drop();
        let item = if let Some(id) = key.strip_prefix("folder:") { ListItem::Folder(id.to_owned()) } else if let Ok(id) = key.parse() { ListItem::Note(id) } else { return ListOut::default() };
        if matches!(&item, ListItem::Folder(id) if Some(id) == folder.as_ref()) { return ListOut::default(); }
        self.move_item(&item, folder.as_deref())
    }

    /// The list's actions (Strg+K, a right click): about the line under the cursor, then for the whole list.
    pub(super) fn notes_actions(&self, items: &mut Vec<ActionItem>) {
        let l = self.language;
        match self.notes_line() {
            Some(Line::Folder { .. }) => {
                items.push(ActionItem::new(ActionId::NotesNewHere, 0, "square-pen", words::new_note_here(l)));
                items.push(ActionItem::new(ActionId::FolderSub, 0, "folder-plus", words::subfolder(l)));
                items.push(ActionItem::new(ActionId::FolderRename, 0, "pencil", words::rename(l)));
                items.push(ActionItem::new(ActionId::ListMove, 0, "folder-input", words::move_item(l)));
                items.push(ActionItem { danger: true, ..ActionItem::new(ActionId::FolderDelete, 0, "trash", words::delete_folder(l)) });
            }
            Some(Line::Note { .. }) => {
                items.push(ActionItem::new(ActionId::ListMove, 0, "folder-input", words::move_item(l)));
                items.push(ActionItem { danger: true, ..ActionItem::new(ActionId::NoteDelete, 0, "trash", words::delete_note(l)) });
            }
            None => {}
        }
        items.push(ActionItem::new(ActionId::FolderNew, 0, "folder-plus", words::new_folder(l)));
    }

    /// An action of the list.
    pub(super) fn run_notes_action(&mut self, id: ActionId) -> Effect {
        let line = self.notes_line();
        let folder = match &line { Some(Line::Folder { id, .. }) => Some(id.clone()), _ => None };
        let (mode, query) = match (id, &line) {
            (ActionId::FolderNew, _) => (Mode::Name { parent: None, rename: None }, String::new()),
            (ActionId::FolderSub, Some(Line::Folder { id, .. })) => (Mode::Name { parent: Some(id.clone()), rename: None }, String::new()),
            (ActionId::FolderRename, Some(Line::Folder { id, name, .. })) => (Mode::Name { parent: None, rename: Some(id.clone()) }, name.clone()),
            (ActionId::ListMove, Some(Line::Folder { id, .. })) => (Mode::Move(ListItem::Folder(id.clone())), String::new()),
            (ActionId::ListMove, Some(Line::Note { id, .. })) => (Mode::Move(ListItem::Note(*id)), String::new()),
            (ActionId::FolderDelete, Some(Line::Folder { id, .. })) => { let out = self.delete_folder(&id.clone()); self.notes_query_set = out.query; return out.effect; }
            (ActionId::NoteDelete, Some(Line::Note { id, .. })) => { let out = self.ask_delete(*id); self.notes_query_set = out.query; return out.effect; }
            (ActionId::NotesNewHere, Some(Line::Folder { .. })) => {
                let effect = self.new_notepad_note();
                if let Some(draft) = &mut self.notepad { draft.card.folder = folder; }
                return Effect { focus: Some(Pane::Notes), ..effect };
            }
            _ => return Effect { focus: Some(Pane::Notes), ..Effect::default() },
        };
        self.notes_list.mode = mode;
        self.notes_list.cursor = 0;
        self.notes_query = query.clone();
        self.notes_query_set = Some(query);
        Effect { focus: Some(Pane::Notes), ..Effect::default() }
    }

    /// Esc or Entf on a note: first asked (as the app asks), the cursor on "delete".
    fn ask_delete(&mut self, id: Uuid) -> ListOut {
        self.notes_list.mode = Mode::Confirm(id);
        self.notes_list.cursor = 0;
        self.notes_query.clear();
        ListOut { query: Some(String::new()), effect: Effect { focus: Some(Pane::Notes), ..Effect::default() }, ..ListOut::default() }
    }

    /// The note goes for good (Strg+Z brings it back).
    fn delete_note(&mut self, id: Uuid) -> ListOut {
        let Some(journal) = self.journal.as_mut() else { return ListOut::default() };
        if let Err(error) = notebook::remove_note(&mut journal.store, id) { self.notepad_error(error); return ListOut::default(); }
        self.last_saved = None;
        let at = self.notes_list.cursor;
        let out = self.browse(None);
        self.notes_list.cursor = at;
        self.status = Some((words::deleted(self.language).into(), false));
        out
    }

    /// The folder goes; what was in it moves up (as in the app, without asking: Strg+Z brings it back).
    fn delete_folder(&mut self, id: &str) -> ListOut {
        let Some(journal) = self.journal.as_mut() else { return ListOut::default() };
        if let Err(error) = notebook::remove_folder(&mut journal.store, id) { self.notepad_error(error); return ListOut::default(); }
        self.last_saved = None;
        self.notes_list.closed.remove(id);
        self.status = Some((words::deleted(self.language).into(), false));
        let at = self.notes_list.cursor;
        let out = self.browse(None);
        self.notes_list.cursor = at;
        out
    }

    /// The note open in the notepad is to be deleted: back to the list, asked there.
    pub(super) fn delete_open_note(&mut self) -> Effect {
        let Some(draft) = &self.notepad else { return Effect::default() };
        if draft.card.original.is_none() { return self.finish_notepad(false); }
        let id = draft.card.id;
        let mut browser = notepad::Draft::new_card(self.notepad.as_ref().map_or(self.today, |d| d.date));
        browser.notes_on_day = false;
        browser.panel = 1;
        browser.editing = false;
        self.notepad = Some(browser);
        let out = self.ask_delete(id);
        self.notes_query_set = out.query;
        out.effect
    }

    /// The text the list's input is to get (an action set it).
    pub fn take_notes_query(&mut self) -> Option<String> { self.notes_query_set.take() }
}
