//! The card records used by the Journal app's notebook and pinboards.
use std::{collections::{BTreeMap, BTreeSet}, fs, io::Write, path::{Path, PathBuf}};

use chrono::{NaiveDate, Utc};
use journal_core::{history, storage::Store};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use crate::notepad::{merge, SaveError};

const MAX_CARD_BYTES: usize = 2_000_000;
const MAX_IMAGE_BYTES: u64 = 30_000_000;

pub struct Card {
    pub id: Uuid,
    pub original: Option<Value>,
    pub tag: Option<String>,
    pub folder: Option<String>,
    pub pending: Vec<Attachment>,
}

pub struct Attachment {
    id: Uuid,
    title: String,
    content: AttachmentContent,
}

enum AttachmentContent { Link(String), Image(Arc<[u8]>) }

pub struct Item {
    pub id: Uuid,
    pub title: String,
    pub detail: String,
    pub folder: Option<Vec<(i64, String)>>,
    /// The folder the note is in (an unknown one counts as none).
    pub folder_id: Option<String>,
    pub image: Option<ImageSource>,
}

pub enum Target { Link(String), Image { title: String, source: ImageSource } }

pub struct SearchCard {
    pub kind: &'static str,
    pub id: Uuid,
    pub open_attachment: bool,
    pub title: String,
    pub snippet: String,
    pub date: Option<NaiveDate>,
    pub tag: Option<String>,
}

fn board_date(card: &Value) -> Option<NaiveDate> {
    if let Some(day) = card["dates"][0].as_str().and_then(|s| s.parse().ok()) { return Some(day); }
    let boards = card["boards"].as_object()?;
    let (_, date) = boards.iter().filter(|(_, placement)| placement.is_object()).filter_map(|(key, _)| {
        let (period, value) = key.split_once(':')?;
        let (rank, date) = match period {
            "week" => (0, value.parse().ok()?),
            "month" => (1, format!("{value}-01").parse().ok()?),
            "quarter" => {
                let (year, quarter) = value.split_once("-Q")?;
                let q = quarter.parse::<u32>().ok().filter(|q| (1..=4).contains(q))?;
                (2, NaiveDate::from_ymd_opt(year.parse().ok()?, 1 + 3 * (q - 1), 1)?)
            }
            "year" => (3, NaiveDate::from_ymd_opt(value.parse().ok()?, 1, 1)?),
            _ => return None,
        };
        Some((rank, std::cmp::Reverse(date)))
    }).min()?;
    Some(date.0)
}

pub fn search_cards(store: &Store, words: &[String], tags: &[String], kinds: &[String]) -> Result<Vec<SearchCard>, String> {
    // Select searchable fields only. Historical image cards can contain their entire image.
    let mut stmt = store.conn.prepare_cached("SELECT json_object(
        'id', value->'id', 'kind', value->'kind', 'title', value->'title', 'text', value->'text',
        'url', value->'url', 'tag', value->'tag', 'dates', value->'dates', 'boards', value->'boards',
        'notebook', value->'notebook', 'links', value->'links') FROM settings
        WHERE key >= 'board:card:' AND key < 'board:card;'").map_err(|e| e.to_string())?;
    let records = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    let mut cards = BTreeMap::new();
    for record in records {
        let card: Value = serde_json::from_str(&record.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        cards.insert(text(&card, "id").to_owned(), card);
    }

    // A note linked to a visible page also belongs to its notebook, including chains and old one-way links.
    let mut neighbors = BTreeMap::<&str, Vec<&str>>::new();
    let mut queue = Vec::new();
    for (id, note) in cards.iter().filter(|(_, c)| c["kind"] == "note") {
        if note["notebook"] == true || board_date(note).is_some() { queue.push(id.as_str()); }
        for other in links(note).filter(|other| cards.get(*other).is_some_and(|c| c["kind"] == "note")) {
            neighbors.entry(id).or_default().push(other);
            neighbors.entry(other).or_default().push(id);
        }
    }
    let mut visible_notes = BTreeSet::new();
    while let Some(id) = queue.pop() {
        if visible_notes.insert(id) {
            if let Some(others) = neighbors.get(id) { queue.extend(others); }
        }
    }

    let folded: Vec<_> = words.iter().map(|w| crate::engine::parse::fold(w)).collect();
    let mut found = Vec::new();
    for (id, card) in &cards {
        let mut date = board_date(card);
        let mut target = id.as_str();
        let mut open_attachment = false;
        let kind = match text(card, "kind") {
            "note" if visible_notes.contains(id.as_str()) => {
                if date.is_some() && card["notebook"] != true { "board-note" } else { "notebook" }
            }
            "image" | "link" => {
                if date.is_some() { open_attachment = true; }
                else if let Some(owner) = links(card).find(|key| visible_notes.contains(key)) {
                    target = owner;
                    date = board_date(&cards[owner]);
                } else { continue; }
                if card["kind"] == "image" { "board-image" } else { "board-link" }
            }
            _ => continue,
        };
        if !kinds.is_empty() && !kinds.iter().any(|k| k == kind || k == "board" && kind.starts_with("board-")) { continue; }
        let tag = card["tag"].as_str();
        if !tags.is_empty() && !tags.iter().any(|t| Some(t.as_str()) == tag) { continue; }
        let title = text(card, "title");
        let snippet = format!("{} {}", text(card, "text"), text(card, "url"));
        let haystack = crate::engine::parse::fold(&format!("{title} {snippet}"));
        if !folded.iter().all(|w| haystack.contains(w)) { continue; }
        if let Ok(id) = target.parse() {
            found.push(SearchCard { kind, id, open_attachment, date, title: title.to_owned(), snippet, tag: tag.map(str::to_owned) });
        }
    }
    Ok(found)
}

#[derive(Clone)]
pub enum ImageSource { File(PathBuf), Bytes(Arc<[u8]>) }

pub fn text<'a>(card: &'a Value, field: &str) -> &'a str {
    card[field].as_str().unwrap_or_default()
}

fn links(card: &Value) -> impl Iterator<Item = &str> {
    card["links"].as_array().into_iter().flatten().filter_map(Value::as_str)
}

fn all(conn: &Connection) -> Result<Vec<Value>, SaveError> {
    let mut query = conn.prepare_cached("SELECT value FROM settings WHERE key >= 'board:card:' AND key < 'board:card;'")?;
    let rows = query.query_map([], |row| row.get::<_, String>(0))?;
    rows.map(|row| serde_json::from_str(&row?).map_err(|error| SaveError::Store(error.to_string()))).collect()
}

fn read(conn: &Connection, id: Uuid) -> Result<Option<Value>, SaveError> {
    let json: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1", [format!("board:card:{id}")], |row| row.get(0)
    ).optional()?;
    json.map(|value| serde_json::from_str(&value).map_err(|error| SaveError::Store(error.to_string()))).transpose()
}

fn write(conn: &Connection, id: &str, card: &Value) -> Result<(), SaveError> {
    let value = card.to_string();
    if value.len() > MAX_CARD_BYTES { return Err(SaveError::TooLarge); }
    conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![format!("board:card:{id}"), value])?;
    Ok(())
}

type FolderPath = Vec<(i64, String)>;

fn folder_paths(conn: &Connection) -> Result<BTreeMap<String, FolderPath>, SaveError> {
    let mut statement = conn.prepare_cached("SELECT value FROM settings WHERE key >= 'board:folder:' AND key < 'board:folder;'")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut folders = BTreeMap::new();
    for row in rows {
        let folder: Value = serde_json::from_str(&row?).map_err(|error| SaveError::Store(error.to_string()))?;
        if let Some(id) = folder["id"].as_str() { folders.insert(id.to_owned(), folder); }
    }
    Ok(folders.keys().map(|id| {
        let mut path = Vec::new();
        let mut seen = BTreeSet::new();
        let mut parent = Some(id.as_str());
        while let Some(id) = parent.filter(|id| seen.insert(*id)) {
            let Some(folder) = folders.get(id) else { break; };
            path.push((folder["order"].as_i64().unwrap_or_default(), text(folder, "name").to_owned()));
            parent = folder["parent"].as_str();
        }
        path.reverse();
        (id.clone(), path)
    }).collect())
}

pub fn folders(store: &Store) -> Result<Vec<(String, String)>, SaveError> {
    let mut paths: Vec<_> = folder_paths(&store.conn)?.into_iter().collect();
    paths.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(paths.into_iter().map(|(id, path)| {
        (id, path.into_iter().map(|(_, name)| name).collect::<Vec<_>>().join(" / "))
    }).collect())
}

/// A folder of that name could be made from what is typed in a folder picker: not empty, at most 120 characters, and no
/// folder at the top is called so already.
pub fn new_folder_name(folders: &[(String, String)], query: &str) -> Option<String> {
    let name = query.trim();
    let taken = folders.iter().any(|(_, path)| path.to_lowercase() == name.to_lowercase());
    (!name.is_empty() && name.chars().count() <= 120 && !taken).then(|| name.to_string())
}

/// A folder of the notebook, as the app keeps it: `board:folder:{id}` → `{"id","name","parent","order"}`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Folder { pub id: String, pub name: String, pub parent: Option<String>, pub order: i64 }

fn read_folders(conn: &Connection) -> Result<Vec<(Folder, Value)>, SaveError> {
    let mut statement = conn.prepare_cached("SELECT value FROM settings WHERE key >= 'board:folder:' AND key < 'board:folder;'")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut folders = Vec::new();
    for row in rows {
        let value: Value = serde_json::from_str(&row?).map_err(|error| SaveError::Store(error.to_string()))?;
        let Some(id) = value["id"].as_str() else { continue };
        folders.push((Folder { id: id.to_owned(), name: text(&value, "name").to_owned(), parent: value["parent"].as_str().map(str::to_owned),
            order: value["order"].as_i64().unwrap_or_default() }, value));
    }
    Ok(folders)
}

/// All folders, by their order and name.
pub fn folder_list(store: &Store) -> Result<Vec<Folder>, SaveError> {
    let mut folders: Vec<Folder> = read_folders(&store.conn)?.into_iter().map(|(folder, _)| folder).collect();
    folders.sort_by(|a, b| (a.order, a.name.to_lowercase()).cmp(&(b.order, b.name.to_lowercase())));
    Ok(folders)
}

/// A folder may go into `parent` when that is none, or neither the folder itself nor one inside it (`canMoveFolder`).
pub fn can_move_folder(folders: &[Folder], id: &str, parent: Option<&str>) -> bool {
    let mut at = parent;
    let mut seen = BTreeSet::new();
    while let Some(current) = at {
        if current == id || !seen.insert(current) { return false; }
        at = folders.iter().find(|f| f.id == current).and_then(|f| f.parent.as_deref());
    }
    true
}

/// After the last folder in `parent` (`nextFolderOrder`).
fn next_folder_order(folders: &[Folder], parent: Option<&str>) -> i64 {
    folders.iter().filter(|f| f.parent.as_deref() == parent).map(|f| f.order).max().map_or(0, |order| order + 1)
}

fn folder_name(name: &str) -> Result<&str, SaveError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 { return Err(SaveError::Store("folder name".into())); }
    Ok(name)
}

fn write_folder(conn: &Connection, id: &str, value: &Value) -> Result<(), SaveError> {
    conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![format!("board:folder:{id}"), value.to_string()])?;
    Ok(())
}

/// A new folder in `parent` (none: at the top), after the others there.
pub fn create_folder(store: &mut Store, name: &str, parent: Option<&str>) -> Result<String, SaveError> {
    let name = folder_name(name)?;
    let tx = store.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let folders: Vec<Folder> = read_folders(&tx)?.into_iter().map(|(folder, _)| folder).collect();
    if parent.is_some_and(|parent| !folders.iter().any(|f| f.id == parent)) { return Err(SaveError::Conflict); }
    let id = Uuid::new_v4().to_string();
    history::begin(&tx)?;
    write_folder(&tx, &id, &json!({ "id": id, "name": name, "parent": parent, "order": next_folder_order(&folders, parent) }))?;
    tx.commit()?;
    Ok(id)
}

/// The folder gets another name.
pub fn rename_folder(store: &mut Store, id: &str, name: &str) -> Result<(), SaveError> {
    let name = folder_name(name)?;
    let tx = store.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let (_, mut value) = read_folders(&tx)?.into_iter().find(|(f, _)| f.id == id).ok_or(SaveError::Conflict)?;
    value["name"] = json!(name);
    history::begin(&tx)?;
    write_folder(&tx, id, &value)?;
    tx.commit()?;
    Ok(())
}

/// The folder goes into `parent` (none: to the top), after the others there; not into itself or one inside it.
pub fn move_folder(store: &mut Store, id: &str, parent: Option<&str>) -> Result<bool, SaveError> {
    let tx = store.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let all = read_folders(&tx)?;
    let folders: Vec<Folder> = all.iter().map(|(folder, _)| folder.clone()).collect();
    let (folder, mut value) = all.into_iter().find(|(f, _)| f.id == id).ok_or(SaveError::Conflict)?;
    if folder.parent.as_deref() == parent || !can_move_folder(&folders, id, parent) { return Ok(false); }
    value["parent"] = json!(parent);
    value["order"] = json!(next_folder_order(&folders, parent));
    history::begin(&tx)?;
    write_folder(&tx, id, &value)?;
    tx.commit()?;
    Ok(true)
}

/// The note goes into the folder (none: out of every folder).
pub fn move_note(store: &mut Store, id: Uuid, folder: Option<&str>) -> Result<bool, SaveError> {
    let tx = store.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut card = read(&tx, id)?.ok_or(SaveError::Conflict)?;
    if card["folder"].as_str() == folder { return Ok(false); }
    card["folder"] = json!(folder);
    history::begin(&tx)?;
    write(&tx, &id.to_string(), &card)?;
    tx.commit()?;
    Ok(true)
}

/// The note goes for good, as in the app (also from the board): with the attachments made for it alone; other cards
/// lose their links to it.
pub fn remove_note(store: &mut Store, id: Uuid) -> Result<(), SaveError> {
    let cards = journal_core::board::cards(&store.conn).map_err(SaveError::Store)?;
    if !cards.iter().any(|card| card["id"] == id.to_string()) { return Err(SaveError::Conflict); }
    let changes = crate::board::removal(&cards, &BTreeSet::from([id.to_string()]));
    journal_core::board::edit(store, &changes).map_err(SaveError::Store)
}

/// The folder goes; what was in it (its folders and notes) moves up to where it was (`remove_folder` of the app).
pub fn remove_folder(store: &mut Store, id: &str) -> Result<(), SaveError> {
    let tx = store.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let all = read_folders(&tx)?;
    let (folder, _) = all.iter().find(|(f, _)| f.id == id).cloned().ok_or(SaveError::Conflict)?;
    let folders: Vec<Folder> = all.iter().map(|(f, _)| f.clone()).collect();
    history::begin(&tx)?;
    let mut order = next_folder_order(&folders, folder.parent.as_deref());
    for (child, mut value) in all.into_iter().filter(|(f, _)| f.parent.as_deref() == Some(id)) {
        value["parent"] = json!(folder.parent);
        value["order"] = json!(order);
        order += 1;
        write_folder(&tx, &child.id, &value)?;
    }
    for mut card in self::all(&tx)? {
        if card["folder"].as_str() != Some(id) { continue; }
        card["folder"] = json!(folder.parent);
        let card_id = text(&card, "id").to_owned();
        write(&tx, &card_id, &card)?;
    }
    tx.execute("DELETE FROM settings WHERE key = ?1", [format!("board:folder:{id}")])?;
    tx.commit()?;
    Ok(())
}
pub fn notes(store: &Store, query: &str, day: Option<NaiveDate>) -> Result<Vec<Item>, SaveError> {
    let words: Vec<_> = query.split_whitespace().map(str::to_lowercase).collect();
    let day = day.map(|date| date.to_string());
    let folders = folder_paths(&store.conn)?;
    let mut cards = all(&store.conn)?;
    cards.retain(|card| {
        card["kind"] == "note" && (
            card["notebook"] == true || card["dates"].as_array().is_some_and(|dates| !dates.is_empty())
            || card["boards"].as_object().is_some_and(|boards| boards.values().any(|board| !board.is_null()))
        ) && day.as_deref().is_none_or(|date| {
            card["created"] == date || card["dates"].as_array().is_some_and(|dates| dates.iter().any(|day| day == date))
        })
    });
    cards.sort_by_key(|card| std::cmp::Reverse((card["updatedAt"].as_i64().unwrap_or_default(), card["order"].as_i64().unwrap_or_default())));
    let mut items: Vec<_> = cards.into_iter().filter_map(|card| {
        if !words.is_empty() {
            let haystack = format!("{} {}", text(&card, "title"), text(&card, "text")).to_lowercase();
            if !words.iter().all(|word| haystack.contains(word)) { return None; }
        }
        let folder = folders.get(text(&card, "folder")).filter(|path| !path.is_empty()).cloned();
        let folder_id = folder.as_ref().map(|_| text(&card, "folder").to_owned());
        Some(Item { id: text(&card, "id").parse().ok()?, title: text(&card, "title").to_owned(),
            detail: text(&card, "created").to_owned(), folder, folder_id, image: None })
    }).collect();
    items.sort_by(|a, b| a.folder.cmp(&b.folder));
    Ok(items)
}

impl Card {
    pub fn new() -> Self {
        Self { id: Uuid::new_v4(), original: None, tag: None, folder: None, pending: Vec::new() }
    }

    pub fn open(store: &Store, id: Uuid) -> Result<Self, SaveError> {
        let record = read(&store.conn, id)?.filter(|card| card["kind"] == "note").ok_or(SaveError::Conflict)?;
        Ok(Self { id, tag: record["tag"].as_str().map(str::to_owned), folder: record["folder"].as_str().map(str::to_owned), original: Some(record), pending: Vec::new() })
    }

    pub fn dirty(&self) -> bool {
        let original_tag = self.original.as_ref().and_then(|card| card["tag"].as_str());
        let original_folder = self.original.as_ref().and_then(|card| card["folder"].as_str());
        original_tag != self.tag.as_deref() || original_folder != self.folder.as_deref() || !self.pending.is_empty()
    }

    pub fn attachments(&self, store: &Store, vault: &Path) -> Result<Vec<Item>, SaveError> {
        let mut listed = Vec::new();
        if let Some(card) = read(&store.conn, self.id)? {
            for id in links(&card).filter_map(|id| id.parse().ok()) {
                if let Some(card) = read(&store.conn, id)? {
                    if card["kind"] == "link" || card["kind"] == "image" {
                        listed.push(Item { id, title: text(&card, "title").to_owned(), detail: text(&card, "url").to_owned(),
                            folder: None, folder_id: None, image: stored_image(&card, vault) });
                    }
                }
            }
        }
        listed.extend(self.pending.iter().map(|item| Item {
            id: item.id,
            title: item.title.clone(),
            detail: match &item.content { AttachmentContent::Link(url) => url.clone(), AttachmentContent::Image(_) => String::new() },
            folder: None,
            folder_id: None,
            image: match &item.content { AttachmentContent::Image(bytes) => Some(ImageSource::Bytes(bytes.clone())), _ => None },
        }));
        Ok(listed)
    }

    pub fn target(&self, store: &Store, vault: &Path, id: Uuid) -> Result<Option<Target>, SaveError> {
        if let Some(item) = self.pending.iter().find(|item| item.id == id) {
            return Ok(Some(match &item.content {
                AttachmentContent::Link(url) => Target::Link(url.clone()),
                AttachmentContent::Image(bytes) => Target::Image { title: item.title.clone(), source: ImageSource::Bytes(bytes.clone()) },
            }));
        }
        let Some(card) = read(&store.conn, id)? else { return Ok(None); };
        Ok(match text(&card, "kind") {
            "link" => web_address(text(&card, "url")).map(Target::Link),
            "image" => stored_image(&card, vault).map(|source| Target::Image { title: text(&card, "title").to_owned(), source }),
            _ => None,
        })
    }

    pub fn save(&self, store: &mut Store, vault: &Path, date: NaiveDate, title: &str, body: &str) -> Result<bool, SaveError> {
        let tx = store.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut cards = all(&tx)?;
        let now = Utc::now().timestamp_millis();
        let date = date.to_string();
        let id = self.id.to_string();
        let mut order = cards.iter().filter_map(|card| card["order"].as_i64()).max().unwrap_or(0).saturating_add(1);
        let current = read(&tx, self.id)?;
        let mut record = match (&self.original, current) {
            (Some(_), Some(card)) if card["kind"] == "note" => card,
            (None, None) => {
                // As the app's notebook makes a note (`Notebook.tsx`): in the notebook only, on no board (no `dates`).
                let card = json!({ "id": id, "kind": "note", "title": "", "text": "", "tag": null, "created": date,
                    "createdAt": now, "updatedAt": now, "dates": [], "notebook": true, "paper": "yellow", "order": order });
                order = order.saturating_add(1);
                card
            }
            _ => return Err(SaveError::Conflict),
        };
        let mut changed = Vec::new();
        for (field, draft) in [("title", title), ("text", body), ("tag", self.tag.as_deref().unwrap_or_default())] {
            let before = self.original.as_ref().map_or("", |card| text(card, field));
            let current = text(&record, field);
            let merged = merge(before, draft, current)?;
            if merged != current {
                if field == "tag" && !merged.is_empty() {
                    let exists = tx.query_row("SELECT 1 FROM tags WHERE id=?1", [merged], |_| Ok(())).optional()?.is_some();
                    if !exists { return Err(SaveError::Conflict); }
                }
                let value = if field == "tag" && merged.is_empty() { Value::Null } else { json!(merged) };
                record[field] = value.clone();
                changed.push((field, value));
            }
        }
        // Folder placement belongs to the individual card, including for synced copies.
        let current_folder = text(&record, "folder");
        let before_folder = self.original.as_ref().map_or("", |card| text(card, "folder"));
        let folder = merge(before_folder, self.folder.as_deref().unwrap_or_default(), current_folder)?;
        let moved = folder != current_folder;
        if moved {
            if !folder.is_empty() && !folder_paths(&tx)?.contains_key(folder) { return Err(SaveError::Conflict); }
            record["folder"] = if folder.is_empty() { Value::Null } else { json!(folder) };
        }
        if self.original.is_some() && !moved && changed.is_empty() && self.pending.is_empty() { return Ok(false); }
        let content_changed = changed.iter().any(|(field, _)| *field == "title" || *field == "text");
        if content_changed { record["updatedAt"] = json!(now); }
        let mut files = Vec::new();
        let mut record_links: Vec<_> = links(&record).map(str::to_owned).collect();
        history::begin(&tx)?;
        for attachment in &self.pending {
            let attachment_id = attachment.id.to_string();
            let mut entry = json!({ "id": attachment_id, "title": attachment.title, "text": "", "dates": [],
                "created": date, "createdAt": now, "updatedAt": now, "notebook": true, "order": order, "links": [id] });
            match &attachment.content {
                AttachmentContent::Link(url) => { entry["kind"] = json!("link"); entry["url"] = json!(url); }
                AttachmentContent::Image(bytes) => {
                    // Match the app's vault-relative AVIF asset format.
                    let asset = Uuid::new_v4();
                    entry["kind"] = json!("image");
                    entry["asset"] = json!(asset.to_string());
                    entry["size"] = json!(bytes.len());
                    files.push((asset_path(vault, asset), bytes));
                }
            }
            order = order.saturating_add(1);
            write(&tx, &attachment_id, &entry)?;
            record_links.push(attachment_id);
        }
        if !self.pending.is_empty() { record["links"] = json!(record_links); }
        write(&tx, &id, &record)?;
        if !changed.is_empty() {
            let group = synced_copies(&cards, &id);
            for card in cards.iter_mut() {
                let member = text(card, "id").to_owned();
                if member == id || !group.contains(&member) { continue; }
                for (field, value) in &changed { card[*field] = value.clone(); }
                if content_changed { card["updatedAt"] = json!(now); }
                write(&tx, &member, card)?;
            }
        }
        let mut assets = PendingFiles::default();
        for (path, bytes) in files { assets.write(path, bytes)?; }
        tx.commit()?;
        assets.committed = true;
        Ok(true)
    }
}

pub(crate) fn synced_copies(cards: &[Value], id: &str) -> BTreeSet<String> {
    let mut group = BTreeSet::from([id.to_owned()]);
    loop {
        let before = group.len();
        for card in cards.iter().filter(|card| card["copySync"] == true) {
            let copy = text(card, "id");
            let source = text(card, "copyOf");
            if !source.is_empty() && cards.iter().any(|card| text(card, "id") == source)
                && (group.contains(copy) || group.contains(source)) {
                group.insert(copy.to_owned());
                group.insert(source.to_owned());
            }
        }
        if group.len() == before { return group; }
    }
}

pub fn web_address(input: &str) -> Option<String> {
    let input = input.trim();
    if input.is_empty() || input.contains(char::is_whitespace) { return None; }
    let explicit = input.get(..7).is_some_and(|head| head.eq_ignore_ascii_case("http://"))
        || input.get(..8).is_some_and(|head| head.eq_ignore_ascii_case("https://"));
    if !explicit && (input.contains("://") || input.starts_with(['/', '\\', '.'])) { return None; }
    let mut url = if explicit { url::Url::parse(input) } else { url::Url::parse(&format!("https://{input}")) }.ok()?;
    if !url.has_host() || !url.username().is_empty() || url.password().is_some() { return None; }
    if !explicit {
        let domain = url.domain()?.trim_end_matches('.');
        let (_, suffix) = domain.rsplit_once('.')?;
        if suffix.len() < 2 || !suffix.bytes().any(|ch| ch.is_ascii_alphabetic()) { return None; }
    }
    url.set_scheme("https").ok()?;
    Some(url.into())
}

impl Attachment {
    pub fn link(input: &str) -> Result<Self, SaveError> {
        let url = web_address(input).ok_or(SaveError::InvalidLink)?;
        let title = url::Url::parse(&url).ok().and_then(|url| url.host_str().map(str::to_owned)).unwrap_or_else(|| url.clone());
        Ok(Self { id: Uuid::new_v4(), title, content: AttachmentContent::Link(url) })
    }

    pub fn pin(self,store:&mut Store,vault:&Path,date:NaiveDate,key:&str,position:Option<(f32,f32)>)->Result<String,String>{
        let AttachmentContent::Image(bytes)=self.content else{return Err("image".into())};
        let mut files=PendingFiles::default();files.write(asset_path(vault,self.id),&bytes).map_err(|e|format!("{e:?}"))?;
        let id=self.id.to_string();let now=Utc::now().timestamp_millis();
        let mut card=json!({"id":id,"kind":"image","asset":id,"size":bytes.len(),"title":self.title,"text":"","dates":[],
            "order":now,"created":date.to_string(),"createdAt":now,"updatedAt":now});
        crate::board::assign(&mut card,key,true);
        if let Some((x,y))=position {
            let layout=crate::board::layout_mut(&mut card,key);
            layout["boardX"]=json!(x); layout["y"]=json!(y);
        }
        journal_core::board::edit(store,&[(Value::Null,card)])?;
        files.committed=true;Ok(id)
    }
    pub fn image(path: &Path) -> Result<Self, SaveError> {
        use image::{codecs::avif::AvifEncoder, ColorType, ImageEncoder};
        if fs::metadata(path)?.len() > MAX_IMAGE_BYTES { return Err(SaveError::TooLarge); }
        let mut reader = image::ImageReader::open(path)?.with_guessed_format()?;
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let image = reader.decode().map_err(|error| SaveError::Store(error.to_string()))?;
        let image = if image.width() > 2048 || image.height() > 2048 { image.thumbnail(2048, 2048) } else { image }.into_rgba8();
        let mut encoded = Vec::new();
        AvifEncoder::new_with_speed_quality(&mut encoded, 8, 55)
            .write_image(image.as_raw(), image.width(), image.height(), ColorType::Rgba8.into())
            .map_err(|error| SaveError::Store(error.to_string()))?;
        let title = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
        Ok(Self { id: Uuid::new_v4(), title, content: AttachmentContent::Image(encoded.into()) })
    }
}

fn asset_path(vault: &Path, id: Uuid) -> PathBuf {
    vault.join("board-images").join(format!("{id}.avif"))
}

pub(crate) fn stored_image(card: &Value, vault: &Path) -> Option<ImageSource> {
    Some(ImageSource::File(asset_path(vault, text(card, "asset").parse().ok()?)))
}

#[derive(Default)]
struct PendingFiles { paths: Vec<PathBuf>, committed: bool }

impl PendingFiles {
    fn write(&mut self, path: PathBuf, bytes: &[u8]) -> Result<(), SaveError> {
        fs::create_dir_all(path.parent().expect("asset directory"))?;
        let mut file = fs::File::create_new(&path)?;
        self.paths.push(path);
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    }
}

impl Drop for PendingFiles {
    fn drop(&mut self) {
        if !self.committed {
            for path in &self.paths { let _ = fs::remove_file(path); }
        }
    }
}
