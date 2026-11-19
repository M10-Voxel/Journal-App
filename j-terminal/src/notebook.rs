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
    pub image: Option<ImageSource>,
}

pub enum Target { Link(String), Image { title: String, source: ImageSource } }

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

fn folder_paths(conn: &Connection) -> Result<BTreeMap<String, Vec<(i64, String)>>, SaveError> {
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
        Some(Item { id: text(&card, "id").parse().ok()?, title: text(&card, "title").to_owned(),
            detail: text(&card, "created").to_owned(), folder, image: None })
    }).collect();
    items.sort_by(|a, b| a.folder.cmp(&b.folder));
    Ok(items)
}

impl Card {
    pub fn new() -> Self {
        Self { id: Uuid::new_v4(), original: None, tag: None, pending: Vec::new() }
    }

    pub fn open(store: &Store, id: Uuid) -> Result<Self, SaveError> {
        let record = read(&store.conn, id)?.filter(|card| card["kind"] == "note").ok_or(SaveError::Conflict)?;
        Ok(Self { id, tag: record["tag"].as_str().map(str::to_owned), original: Some(record), pending: Vec::new() })
    }

    pub fn dirty(&self) -> bool {
        let original_tag = self.original.as_ref().and_then(|card| card["tag"].as_str());
        original_tag != self.tag.as_deref() || !self.pending.is_empty()
    }

    pub fn attachments(&self, store: &Store, vault: &Path) -> Result<Vec<Item>, SaveError> {
        let mut listed = Vec::new();
        if let Some(card) = read(&store.conn, self.id)? {
            for id in links(&card).filter_map(|id| id.parse().ok()) {
                if let Some(card) = read(&store.conn, id)? {
                    if card["kind"] == "link" || card["kind"] == "image" {
                        listed.push(Item { id, title: text(&card, "title").to_owned(), detail: text(&card, "url").to_owned(),
                            folder: None, image: stored_image(&card, vault) });
                    }
                }
            }
        }
        listed.extend(self.pending.iter().map(|item| Item {
            id: item.id,
            title: item.title.clone(),
            detail: match &item.content { AttachmentContent::Link(url) => url.clone(), AttachmentContent::Image(_) => String::new() },
            folder: None,
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
                let card = json!({ "id": id, "kind": "note", "title": "", "text": "", "tag": null, "created": date,
                    "createdAt": now, "updatedAt": now, "dates": [date], "onDay": true, "notebook": true, "paper": "yellow", "order": order });
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
        if self.original.is_some() && changed.is_empty() && self.pending.is_empty() { return Ok(false); }
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

fn synced_copies(cards: &[Value], id: &str) -> BTreeSet<String> {
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

fn stored_image(card: &Value, vault: &Path) -> Option<ImageSource> {
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
