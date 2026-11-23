//! The notepad's list as a tree, as in the app's notebook: folders with their subfolders and notes, open or closed, then
//! the notes in no folder. The keyboard moves a cursor through it (↑/↓; → opens a folder or goes into it, ← closes it or
//! goes to the folder above). Strg+K or a right click on a line offers what can be done there; one way is to move a
//! note or a folder into another folder (also by dragging it onto one), another to make a folder or a subfolder.
use std::collections::BTreeSet;
use uuid::Uuid;
use crate::notebook::{self, Folder};

/// A line of the tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Line {
    Folder { id: String, name: String, depth: usize, open: bool, filled: bool },
    Note { id: Uuid, title: String, detail: String, depth: usize, folder: Option<String> },
}

impl Line {
    /// What the line is called in the list's keys: `folder:{id}` or the note's id.
    pub fn key(&self) -> String {
        match self { Line::Folder { id, .. } => format!("folder:{id}"), Line::Note { id, .. } => id.to_string() }
    }
    pub fn depth(&self) -> usize { match self { Line::Folder { depth, .. } | Line::Note { depth, .. } => *depth } }
    /// The folder a note dropped on this line goes into.
    pub fn folder_for_drop(&self) -> Option<String> {
        match self { Line::Folder { id, .. } => Some(id.clone()), Line::Note { folder, .. } => folder.clone() }
    }
}

/// What is being moved or named.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Item { Folder(String), Note(Uuid) }

/// What the list is doing: showing the notes, choosing where something goes, or asking for a folder's name.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    #[default]
    Browse,
    Move(Item),
    /// A new folder in `parent` (none: at the top), or another name for `rename`.
    Name { parent: Option<String>, rename: Option<String> },
    /// A note is to go for good: Enter on the first line deletes it, the second (or Esc) does not.
    Confirm(Uuid),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct List {
    pub cursor: usize,
    /// The folders closed (they are open at first).
    pub closed: BTreeSet<String>,
    pub mode: Mode,
}

/// The tree of the folders and notes: in each folder its subfolders, then its notes; the notes in no folder last.
pub fn tree(folders: &[Folder], notes: &[notebook::Item], closed: &BTreeSet<String>) -> Vec<Line> {
    let known: BTreeSet<&str> = folders.iter().map(|f| f.id.as_str()).collect();
    let home = |note: &notebook::Item| note.folder_id.as_deref().filter(|id| known.contains(id)).map(str::to_owned);
    let mut lines = Vec::new();
    fn add(lines: &mut Vec<Line>, parent: Option<&str>, depth: usize, folders: &[Folder], notes: &[notebook::Item],
        closed: &BTreeSet<String>, home: &dyn Fn(&notebook::Item) -> Option<String>) {
        for folder in folders.iter().filter(|f| f.parent.as_deref() == parent) {
            let filled = folders.iter().any(|f| f.parent.as_deref() == Some(folder.id.as_str())) || notes.iter().any(|n| home(n).as_deref() == Some(folder.id.as_str()));
            let open = !closed.contains(&folder.id);
            lines.push(Line::Folder { id: folder.id.clone(), name: folder.name.clone(), depth, open, filled });
            if open {
                add(lines, Some(&folder.id), depth + 1, folders, notes, closed, home);
                for note in notes.iter().filter(|n| home(n).as_deref() == Some(folder.id.as_str())) {
                    lines.push(Line::Note { id: note.id, title: note.title.clone(), detail: note.detail.clone(), depth: depth + 1, folder: Some(folder.id.clone()) });
                }
            }
        }
    }
    // Folders whose parent is gone count as at the top.
    let tops: Vec<Folder> = folders.iter().map(|f| Folder { parent: f.parent.clone().filter(|p| known.contains(p.as_str())), ..f.clone() }).collect();
    add(&mut lines, None, 0, &tops, notes, closed, &home);
    for note in notes.iter().filter(|n| home(n).is_none()) {
        lines.push(Line::Note { id: note.id, title: note.title.clone(), detail: note.detail.clone(), depth: 0, folder: None });
    }
    lines
}

/// Where `item` can go: out of every folder, then each folder by its path (not the folder itself or one inside it).
pub fn targets(folders: &[Folder], item: &Item, query: &str) -> Vec<(Option<String>, String)> {
    let paths = paths(folders);
    let query = query.trim().to_lowercase();
    std::iter::once((None, String::new()))
        .chain(paths.into_iter().map(|(id, path)| (Some(id), path)))
        .filter(|(id, _)| match item { Item::Folder(moved) => notebook::can_move_folder(folders, moved, id.as_deref()), Item::Note(_) => true })
        .filter(|(id, path)| query.is_empty() || id.is_some() && path.to_lowercase().contains(&query))
        .collect()
}

/// Each folder's path ("Uni / Analysis"), in the order of the tree.
pub fn paths(folders: &[Folder]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    fn walk(out: &mut Vec<(String, String)>, folders: &[Folder], parent: Option<&str>, prefix: &str, seen: &mut BTreeSet<String>) {
        for folder in folders.iter().filter(|f| f.parent.as_deref() == parent) {
            if !seen.insert(folder.id.clone()) { continue; }
            let path = if prefix.is_empty() { folder.name.clone() } else { format!("{prefix} / {}", folder.name) };
            out.push((folder.id.clone(), path.clone()));
            walk(out, folders, Some(&folder.id), &path, seen);
        }
    }
    let known: BTreeSet<&str> = folders.iter().map(|f| f.id.as_str()).collect();
    let tops: Vec<Folder> = folders.iter().map(|f| Folder { parent: f.parent.clone().filter(|p| known.contains(p.as_str())), ..f.clone() }).collect();
    walk(&mut out, &tops, None, "", &mut BTreeSet::new());
    out
}

/// A key in the tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key { Up, Down, Left, Right, Home, End }

impl List {
    /// The cursor stays on a line there is.
    pub fn clamp(&mut self, count: usize) { self.cursor = self.cursor.min(count.saturating_sub(1)); }

    /// The cursor goes to the line with this key (after a change, a click, a drop).
    pub fn point_at(&mut self, lines: &[Line], key: &str) { if let Some(at) = lines.iter().position(|l| l.key() == key) { self.cursor = at; } }

    /// A key in the tree: the cursor moves, or a folder opens or closes. True when the tree changed (it is built anew).
    pub fn key(&mut self, lines: &[Line], key: Key) -> bool {
        let count = lines.len();
        if count == 0 { return false; }
        self.clamp(count);
        match key {
            Key::Up => self.cursor = self.cursor.saturating_sub(1),
            Key::Down => self.cursor = (self.cursor + 1).min(count - 1),
            Key::Home => self.cursor = 0,
            Key::End => self.cursor = count - 1,
            Key::Right => match &lines[self.cursor] {
                Line::Folder { id, open: false, filled: true, .. } => { self.closed.remove(id); return true; }
                Line::Folder { open: true, filled: true, .. } => self.cursor = (self.cursor + 1).min(count - 1),
                _ => {}
            },
            Key::Left => {
                let line = &lines[self.cursor];
                match line {
                    Line::Folder { id, open: true, filled: true, .. } => { self.closed.insert(id.clone()); return true; }
                    _ => {
                        // To the folder this line is in.
                        let depth = line.depth();
                        if depth > 0 { if let Some(at) = lines[..self.cursor].iter().rposition(|l| matches!(l, Line::Folder { .. }) && l.depth() < depth) { self.cursor = at; } }
                    }
                }
            }
        }
        false
    }

    /// A folder line was chosen (Enter, a click): it opens or closes.
    pub fn toggle(&mut self, id: &str) {
        if !self.closed.remove(id) { self.closed.insert(id.to_owned()); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, name: &str, parent: Option<&str>, order: i64) -> Folder { Folder { id: id.into(), name: name.into(), parent: parent.map(str::to_owned), order } }
    fn note(n: u128, title: &str, folder: Option<&str>) -> notebook::Item {
        notebook::Item { id: Uuid::from_u128(n), title: title.into(), detail: String::new(), folder: None, folder_id: folder.map(str::to_owned), image: None }
    }
    fn names(lines: &[Line]) -> Vec<String> {
        lines.iter().map(|l| match l { Line::Folder { name, depth, open, .. } => format!("{}{}{name}", "  ".repeat(*depth), if *open { "v" } else { ">" }), Line::Note { title, depth, .. } => format!("{}{title}", "  ".repeat(*depth)) }).collect()
    }

    fn sample() -> (Vec<Folder>, Vec<notebook::Item>) {
        (vec![folder("uni", "Uni", None, 0), folder("ana", "Analysis", Some("uni"), 0), folder("home", "Zuhause", None, 1), folder("lost", "Weg", Some("gone"), 2)],
         vec![note(1, "Skript", Some("ana")), note(2, "Einkauf", Some("home")), note(3, "Lose", None), note(4, "Verirrt", Some("gone"))])
    }

    #[test]
    fn folders_hold_their_subfolders_then_their_notes_and_loose_notes_come_last() {
        let (folders, notes) = sample();
        let lines = tree(&folders, &notes, &BTreeSet::new());
        assert_eq!(names(&lines), ["vUni", "  vAnalysis", "    Skript", "vZuhause", "  Einkauf", "vWeg", "Lose", "Verirrt"]);
        let closed = BTreeSet::from(["uni".to_string()]);
        assert_eq!(names(&tree(&folders, &notes, &closed))[..2], [">Uni", "vZuhause"]);
    }

    #[test]
    fn the_arrows_walk_open_and_close() {
        let (folders, notes) = sample();
        let mut list = List::default();
        let lines = tree(&folders, &notes, &list.closed);
        list.key(&lines, Key::Down);
        list.key(&lines, Key::Down);
        assert_eq!(list.cursor, 2, "On Skript.");
        list.key(&lines, Key::Left);
        assert_eq!(list.cursor, 1, "← goes to its folder.");
        assert!(list.key(&lines, Key::Left), "← again closes it.");
        let lines = tree(&folders, &notes, &list.closed);
        assert_eq!(names(&lines)[1], "  >Analysis");
        assert!(list.key(&lines, Key::Right), "→ opens it.");
        let lines = tree(&folders, &notes, &list.closed);
        list.key(&lines, Key::Right);
        assert_eq!(list.cursor, 2, "→ on an open folder: into it.");
        list.key(&lines, Key::End);
        list.key(&lines, Key::Down);
        assert_eq!(list.cursor, lines.len() - 1);
        list.toggle("uni");
        assert!(list.closed.contains("uni"));
    }

    #[test]
    fn a_folder_cannot_go_into_itself_or_its_subfolders() {
        let (folders, _) = sample();
        let to = |item: &Item, query: &str| targets(&folders, item, query).into_iter().map(|(_, path)| path).collect::<Vec<_>>();
        assert_eq!(to(&Item::Folder("uni".into()), ""), ["", "Zuhause", "Weg"]);
        assert_eq!(to(&Item::Note(Uuid::from_u128(1)), ""), ["", "Uni", "Uni / Analysis", "Zuhause", "Weg"]);
        assert_eq!(to(&Item::Note(Uuid::from_u128(1)), "ana"), ["Uni / Analysis"]);
    }
}
