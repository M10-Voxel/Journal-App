use super::*;
use std::cmp::Reverse;
use crate::texts::search::{self as copy, FILTERS};

impl Form {
    fn filter_choices(&self, text: &str, cursor: usize) -> Vec<Command> {
        let cursor = text.floor_char_boundary(cursor.min(text.len()));
        let from = text[..cursor].rfind(char::is_whitespace).map_or(0, |i| i + text[i..].chars().next().unwrap().len_utf8());
        let to = cursor + text[cursor..].find(char::is_whitespace).unwrap_or(text.len() - cursor);
        let token = &text[from..to];
        let Some(sigil @ ('@' | '\\')) = token.chars().next() else { return Vec::new(); };
        let needle = parse::fold(&token[1..].replace('_', " "));
        let lang = usize::from(self.language == Language::En);
        let mut options = Vec::new();
        let mut offer = |label: &str, detail: &str, group: usize, color| {
            let folded = parse::fold(label);
            if !folded.contains(&needle) { return; }
            let insert = format!("{sigil}{} ", parse::tag_word(label));
            let query = format!("{}{}{}", &text[..from], insert, text[to..].trim_start());
            options.push((group, !folded.starts_with(&needle), Command { name: label.to_owned(), detail: detail.to_owned(),
                look: SearchRow { sigil: sigil == '@', color, words: vec![needle.clone()], ..Default::default() },
                action: CommandAction::Filter(query, from + insert.len()) }));
        };
        if sigil == '@' {
            for (_, labels, details) in FILTERS { offer(labels[lang], details[lang], 0, None); }
        } else if let Some(snapshot) = &self.snapshot {
            for tag in &snapshot.tags {
                let group = if copy::MAIL_IDS.contains(&tag.id.as_str()) { 2 }
                    else if snapshot.period.definitions.iter().any(|d| d.calendar_tag_id.as_ref() == Some(&tag.id)) { 1 }
                    else { 0 };
                let key = ["own", "activity", "mail"][group];
                let position = snapshot.tag_kind_order.iter().position(|kind| kind == key).unwrap_or(group);
                offer(&tag.name, copy::TAG_GROUPS[group][lang], position, calendar::parse_color(&tag.color));
            }
        }
        options.sort_by_key(|(group, partial, _)| (*group, *partial));
        options.into_iter().map(|(_, _, row)| row).collect()
    }

    pub(super) fn find_entries(&self, query: &str, cursor: usize) -> Result<Vec<Command>, String> {
        let choices = self.filter_choices(query, cursor);
        if !choices.is_empty() { return Ok(choices); }
        let Some(journal) = &self.journal else { return Ok(Vec::new()); };
        let mut words = Vec::new();
        let mut kinds = Vec::new();
        let mut tags = Vec::new();
        for word in query.split_whitespace() {
            if let Some(name) = word.strip_prefix('@') {
                let name = parse::fold(name);
                let Some((kind, _, _)) = FILTERS.iter().find(|(_, labels, _)| labels.iter().any(|s| parse::fold(s) == name)) else {
                    if name == "termin" { kinds.push("event".into()); continue; }
                    return Ok(Vec::new());
                };
                kinds.push(kind.to_string());
            } else if let Some(name) = word.strip_prefix('\\') {
                let name = parse::fold(name);
                let Some(tag) = self.tags().into_iter().find(|tag| parse::fold(&parse::tag_word(&tag.name)) == name) else { return Ok(Vec::new()); };
                tags.push(tag.id);
            } else { words.push(word.to_owned()); }
        }
        let lang = usize::from(self.language == Language::En);
        let mut rows = Vec::new();
        let mut add = |kind: &str, title: String, snippet: &str, date: Option<NaiveDate>, tag_id: Option<&str>, action| {
            let (group, icon) = match kind {
                "task" => (0, "journal-task"), "event" => (0, "journal-event"), "note" => (0, "journal-note"),
                "calendar" => (1, "calendar"), "title" => (2, "book-open"), "notebook" => (4, "notebook-pen"),
                "board-note" => (3, "file-text"), "board-image" => (3, "image"), _ => (3, "link"),
            };
            let tag = tag_id.and_then(|id| self.snapshot.as_ref()?.tags.iter().find(|t| t.id == id));
            let detail = date.map(|d| format!("{} {}", repeat::weekday_short(self.language)[repeat::weekday_of(d) as usize],
                d.format(if lang == 1 { "%d/%m" } else { "%d.%m." }))).unwrap_or_default();
            let look = SearchRow { heading: copy::SECTIONS[group][lang].to_owned(), icon, tag: tag.map(|t| t.name.clone()).unwrap_or_default(),
                color: tag.and_then(|t| calendar::parse_color(&t.color)), snippet: excerpt(snippet, &words), words: words.clone(), sigil: false };
            rows.push((group, Reverse(date), parse::fold(&title), Command { name: title, detail, look, action }));
        };
        let store_kinds: Vec<_> = kinds.iter().filter(|k| !k.starts_with("board") && *k != "notebook").cloned().collect();
        if kinds.is_empty() || !store_kinds.is_empty() {
            for hit in journal.store.search(&words, &store_kinds, &tags, 100).map_err(|e| e.to_string())? {
                let date = hit.date.parse::<NaiveDate>().map_err(|e| e.to_string())?;
                if let Some(e) = hit.entry {
                    add(if e.show_in_journal { &e.kind } else { "calendar" }, e.text, &e.description, Some(date), e.tag.as_deref(), CommandAction::Hit(date, e.id));
                } else if let Some(title) = hit.title { add("title", title, "", Some(date), None, CommandAction::Day(date)); }
            }
        }
        if kinds.is_empty() || kinds.iter().any(|k| k.starts_with("board") || k == "notebook") {
            for card in notebook::search_cards(&journal.store, &words, &tags, &kinds)? {
                let title = if card.title.is_empty() { notepad_texts(self.language).untitled.to_owned() } else { card.title };
                add(card.kind, title, &card.snippet, card.date, card.tag.as_deref(), CommandAction::Card(card.id, card.open_attachment));
            }
        }
        rows.sort_by(|a,b| (&a.1,&a.2).cmp(&(&b.1,&b.2)));
        rows.truncate(60);
        rows.sort_by_key(|r| r.0);
        let mut previous = None;
        Ok(rows.into_iter().map(|(group, _, _, mut row)| {
            if previous == Some(group) { row.look.heading.clear(); }
            previous = Some(group);
            row
        }).collect())
    }

    pub(super) fn edit_hit(&mut self, date: NaiveDate, id: &str) -> Effect {
        let Some(journal) = &self.journal else { return Effect::default(); };
        let day = match journal.store.load(&date.to_string()) {
            Ok(day) => day,
            Err(error) => { self.status = Some((error.to_string(), true)); return Effect::default(); }
        };
        let Some(entry) = day.entries.into_iter().find(|e| e.id == id && e.plan.is_none()) else {
            self.status = Some((self.ft().entry_changed.into(), true));
            return Effect::default();
        };
        self.v = Values {
            typ: entry_type(&entry), title: entry.text.clone(), description: entry.description.clone(),
            days: BTreeSet::from([date]), start: entry.time.as_deref().and_then(crate::day_ops::minutes),
            end: entry.end.as_deref().and_then(crate::day_ops::minutes), time_grid: entry.time_grid,
            rule: entry.repeat.as_ref().and_then(|r| r.rule.clone()).and_then(|r| serde_json::from_value(r).ok()),
            tag: entry.tag.clone(), icon: entry.icon.clone(), priority: entry.priority,
            reminder: entry.reminder.then_some(entry.reminder_before), ..Values::default()
        };
        if let Some(end) = self.v.end.filter(|end| *end > 1440) {
            let last = (end - 1) / 1440;
            self.v.days.extend((1..=last).map(|offset| repeat::shift(date, i64::from(offset))));
            self.v.end = Some(end - last * 1440);
        }
        self.editing = Some((date, entry));
        self.kind_chosen = true;
        self.open_entry()
    }
}

fn entry_type(entry: &journal_core::storage::Entry) -> Type {
    match entry.kind.as_str() {
        "task" => Type::Task,
        "note" => Type::Note,
        _ if !entry.show_in_journal => Type::Calendar,
        _ => Type::Event,
    }
}

fn excerpt(text: &str, words: &[String]) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<_> = flat.chars().collect();
    if chars.len() <= 90 { return flat; }
    let folded = parse::fold(&flat);
    let first = words.iter().filter_map(|w| folded.find(&parse::fold(w))).min().unwrap_or(0);
    let start = folded[..first].chars().count().saturating_sub(24).min(chars.len()-90);
    format!("{}{}{}", if start > 0 { "…" } else { "" }, chars[start..start+90].iter().collect::<String>(),
        if start+90 < chars.len() { "…" } else { "" })
}
