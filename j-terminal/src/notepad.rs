use chrono::NaiveDate;
use journal_core::storage::Store;
use std::path::Path;
use uuid::Uuid;

use crate::notebook;

#[derive(Clone, PartialEq, Eq)]
struct Text {
    title: String,
    body: String,
}

pub struct Draft {
    pub date: NaiveDate,
    original: Text,
    text: Text,
    pub confirm_discard: bool,
    pub card: notebook::Card,
    pub panel: i32,
    pub preview: bool,
    pub editing: bool,
    pub notes_on_day: bool,
    pub loading_image: bool,
}

pub enum SaveError {
    Conflict,
    InvalidLink,
    TooLarge,
    Store(String),
}

impl From<rusqlite::Error> for SaveError {
    fn from(error: rusqlite::Error) -> Self { Self::Store(error.to_string()) }
}

impl From<std::io::Error> for SaveError {
    fn from(error: std::io::Error) -> Self { Self::Store(error.to_string()) }
}

impl Draft {
    pub fn new_card(date: NaiveDate) -> Self {
        Self::from_text(date, Text { title: String::new(), body: String::new() }, notebook::Card::new())
    }

    pub fn open_card(store: &Store, date: NaiveDate, id: Uuid) -> Result<Self, SaveError> {
        let card = notebook::Card::open(store, id)?;
        let original = card.original.as_ref().expect("existing card");
        let text = Text { title: notebook::text(original, "title").to_owned(), body: notebook::text(original, "text").to_owned() };
        Ok(Self::from_text(date, text, card))
    }

    fn from_text(date: NaiveDate, text: Text, card: notebook::Card) -> Self {
        Self { date, original: text.clone(), text, confirm_discard: false, card, panel: 0, preview: false, editing: true, notes_on_day: false, loading_image: false }
    }

    pub fn title(&self) -> &str { &self.text.title }
    pub fn body(&self) -> &str { &self.text.body }
    pub fn dirty(&self) -> bool {
        self.loading_image || self.original != self.text || self.card.dirty()
    }

    pub fn can_save(&self) -> bool {
        !self.loading_image && (self.dirty() || self.card.original.is_some())
    }

    pub fn edit(&mut self, body: bool, text: &str) {
        let field = if body { &mut self.text.body } else { &mut self.text.title };
        text.clone_into(field);
        self.confirm_discard = false;
    }

    pub fn save(&self, store: &mut Store, vault: &Path, untitled: &str) -> Result<bool, SaveError> {
        if !self.dirty() { return Ok(false); }
        let title = if self.card.original.is_none() && self.text.title.trim().is_empty() { untitled } else { &self.text.title };
        self.card.save(store, vault, self.date, title, &self.text.body)
    }
}

pub fn merge<'a>(original: &str, edited: &'a str, current: &'a str) -> Result<&'a str, SaveError> {
    if original == edited || current == edited {
        Ok(current)
    } else if current == original {
        Ok(edited)
    } else {
        Err(SaveError::Conflict)
    }
}
