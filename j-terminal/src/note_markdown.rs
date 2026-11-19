//! The notebook preview keeps the original Markdown and its checkbox byte offsets.
use std::ops::Range;
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use slint::StyledText;
use crate::notebook::web_address;

#[derive(Default)]
pub struct Block {
    pub display: StyledText,
    pub heading: u8,
    pub indent: usize,
    pub marker: String,
    pub code: Option<String>,
    pub language: String,
    pub check: Option<(usize, bool)>,
    pub links: Vec<String>,
}

#[derive(Default)]
struct Preview {
    blocks: Vec<Block>,
    block: Block,
    inline: String,
    plain: String,
    lists: Vec<Option<u64>>,
    quotes: usize,
    link: Option<String>,
}

impl Preview {
    fn flush(&mut self) {
        if self.inline.is_empty() && self.block.code.is_none() && self.block.check.is_none() && self.block.marker.is_empty() { return; }
        let mut block = std::mem::take(&mut self.block);
        block.indent = self.quotes + self.lists.len().saturating_sub(1);
        if self.quotes > 0 && block.marker.is_empty() { block.marker = "›".to_owned(); }
        if block.code.is_none() {
            let styled = if block.heading > 0 { format!("**{}**", self.inline.trim_end()) } else { self.inline.trim_end().to_owned() };
            block.display = StyledText::from_markdown(&styled).unwrap_or_else(|_| StyledText::from_plain_text(self.plain.trim_end()));
        }
        self.blocks.push(block);
        self.inline.clear();
        self.plain.clear();
    }

    fn text(&mut self, text: &str) {
        if let Some(code) = &mut self.block.code { code.push_str(text); return; }
        self.plain.push_str(text);
        if self.link.is_some() {
            escape(&mut self.inline, text);
            return;
        }
        for word in text.split_inclusive(char::is_whitespace) {
            let trimmed = word.trim_end_matches(char::is_whitespace);
            let address = trimmed.trim_start_matches(['(', '[', '{', '"', '\''])
                .trim_end_matches(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', '\'']);
            if let Some(url) = web_address(address) {
                let start = trimmed.find(address).unwrap_or(0);
                escape(&mut self.inline, &word[..start]);
                self.inline.push('[');
                escape(&mut self.inline, address);
                self.inline.push_str(&format!("](<{url}>)"));
                self.block.links.push(url);
                escape(&mut self.inline, &word[start + address.len()..]);
            } else {
                escape(&mut self.inline, word);
            }
        }
    }

    fn event(&mut self, event: Event<'_>, range: Range<usize>) {
        match event {
            Event::Start(Tag::Paragraph) => {
                // Loose list items start with a paragraph after their bullet.
                if !self.inline.is_empty() { self.flush(); }
            }
            Event::Start(Tag::Heading { level, .. }) => { self.flush(); self.block.heading = level as u8; }
            Event::Start(Tag::CodeBlock(kind)) => {
                self.flush();
                self.block.code = Some(String::new());
                if let CodeBlockKind::Fenced(info) = kind {
                    self.block.language = info.split_whitespace().next().unwrap_or_default().to_owned();
                }
            }
            Event::Start(Tag::BlockQuote(_)) => { self.flush(); self.quotes += 1; }
            Event::Start(Tag::List(number)) => { self.flush(); self.lists.push(number); }
            Event::Start(Tag::Item) => {
                self.flush();
                self.block.marker = match self.lists.last_mut() {
                    Some(Some(number)) => {
                        let marker = format!("{number}.");
                        *number = number.saturating_add(1);
                        marker
                    }
                    _ => "•".to_owned(),
                };
            }
            Event::End(TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::Item | TagEnd::CodeBlock) => self.flush(),
            Event::End(TagEnd::List(_)) => { self.flush(); self.lists.pop(); }
            Event::End(TagEnd::BlockQuote(_)) => { self.flush(); self.quotes -= 1; }
            Event::Start(Tag::Emphasis) | Event::End(TagEnd::Emphasis) => self.inline.push('*'),
            Event::Start(Tag::Strong) | Event::End(TagEnd::Strong) => self.inline.push_str("**"),
            Event::Start(Tag::Strikethrough) | Event::End(TagEnd::Strikethrough) => self.inline.push_str("~~"),
            Event::Start(Tag::Link { dest_url, .. }) => {
                self.link = web_address(&dest_url);
                if self.link.is_some() { self.inline.push('['); }
            }
            Event::End(TagEnd::Link) => {
                if let Some(url) = self.link.take() {
                    self.inline.push_str(&format!("](<{url}>)"));
                    self.block.links.push(url);
                }
            }
            Event::Code(code) => {
                self.plain.push_str(&code);
                let longest = code.split(|ch| ch != '\u{60}').map(str::len).max().unwrap_or(0);
                let fence = "\u{60}".repeat(longest + 1);
                self.inline.push_str(&format!("{fence} {code} {fence}"));
            }
            Event::TaskListMarker(checked) => {
                self.block.marker.clear();
                self.block.check = Some((range.start, checked));
            }
            Event::Text(text) => self.text(&text),
            Event::SoftBreak | Event::HardBreak => {
                self.inline.push_str("  \n");
                self.plain.push('\n');
            }
            Event::End(TagEnd::TableCell) => self.text("  ·  "),
            Event::End(TagEnd::TableRow | TagEnd::TableHead) => self.flush(),
            Event::Rule => { self.flush(); self.text("────────"); self.flush(); }
            _ => {}
        }
    }
}

fn escape(out: &mut String, text: &str) {
    for ch in text.chars() {
        if matches!(ch, '\\' | '*' | '_' | '~' | '[' | ']' | '<' | '>' | '\u{60}' | '#' | '!' | '&' | '|' | '{' | '}') {
            out.push('\\');
        }
        out.push(ch);
    }
}

fn events(text: &str) -> impl Iterator<Item = (Event<'_>, Range<usize>)> {
    Parser::new_ext(text, Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES).into_offset_iter()
}

pub fn blocks(text: &str) -> Vec<Block> {
    let mut preview = Preview::default();
    for (event, range) in events(text) { preview.event(event, range); }
    preview.flush();
    preview.blocks
}

pub fn toggle(text: &str, offset: usize) -> Option<String> {
    let (range, checked) = events(text).find_map(|(event, range)| match event {
        Event::TaskListMarker(checked) if range.start == offset => Some((range, checked)),
        _ => None,
    })?;
    let mut updated = text.to_owned();
    updated.replace_range(range, if checked { "[ ]" } else { "[x]" });
    Some(updated)
}

#[derive(Debug, PartialEq, Eq)]
pub struct Edit { pub text: String, pub anchor: usize, pub cursor: usize }

fn char_boundary(text: &str, offset: usize) -> usize {
    let mut offset = offset.min(text.len());
    while !text.is_char_boundary(offset) { offset -= 1; }
    offset
}

/// Continue a Markdown list item. An empty item ends the list.
pub fn continue_list(text: &str, anchor: usize, cursor: usize) -> Option<Edit> {
    let anchor = char_boundary(text, anchor);
    let cursor = char_boundary(text, cursor);
    let (start, end) = (anchor.min(cursor), anchor.max(cursor));
    let line_start = text[..start].rfind('\n').map_or(0, |at| at + 1);
    let line_end = text[start..].find('\n').map_or(text.len(), |at| start + at);
    let line = text[line_start..line_end].trim_end_matches('\r');
    if end > line_start + line.len() { return None; }

    let rest = line.trim_start_matches([' ', '\t']);
    let indented = line.len() - rest.len();
    let bullet = rest.as_bytes().first().copied()?;
    let marker_len = if matches!(bullet, b'-' | b'+' | b'*') {
        1
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if !(1..=9).contains(&digits) || !matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) { return None; }
        digits + 1
    };
    let (marker, after_marker) = rest.split_at(marker_len);
    if !after_marker.is_empty() && !after_marker.starts_with([' ', '\t']) { return None; }
    let marker_start = line_start + indented;
    if !events(text).any(|(event, span)| matches!(event, Event::Start(Tag::Item))
        && (line_start..=marker_start).contains(&span.start)) {
        return None;
    }

    let mut content = after_marker.trim_start_matches([' ', '\t']);
    let is_task = content.get(..3).is_some_and(|marker| matches!(marker, "[ ]" | "[x]" | "[X]"))
        && (content.len() == 3 || content[3..].starts_with([' ', '\t']));
    if is_task { content = content[3..].trim_start_matches([' ', '\t']); }
    let content_start = line_start + line.len() - content.len();
    let mut updated = text.to_owned();
    let position = if content.is_empty() {
        updated.replace_range(marker_start..line_start + line.len(), "");
        marker_start
    } else {
        if start < content_start { return None; }
        let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
        let marker = if marker_len == 1 {
            marker.to_owned()
        } else {
            let (digits, delimiter) = marker.split_at(marker_len - 1);
            format!("{}{delimiter}", digits.parse::<u64>().ok()? + 1)
        };
        let task = if is_task { "[ ] " } else { "" };
        let insert = format!("{newline}{}{marker} {task}", &line[..indented]);
        updated.replace_range(start..end, &insert);
        start + insert.len()
    };
    Some(Edit { text: updated, anchor: position, cursor: position })
}

/// Adjust every touched line and map the UTF-8 selection through its new leading spaces.
pub fn indent(text: &str, anchor: usize, cursor: usize, reverse: bool) -> Edit {
    const INDENT: &str = "    ";
    let anchor = char_boundary(text, anchor);
    let cursor = char_boundary(text, cursor);
    let (start, end) = (anchor.min(cursor), anchor.max(cursor));
    let first = text[..start].rfind('\n').map_or(0, |at| at + 1);
    let lines = std::iter::once(first).chain(text[first..end].match_indices('\n')
        .map(|(at, _)| first + at + 1).take_while(|&at| at < end));
    let mut edit = Edit { text: String::new(), anchor, cursor };
    let mut from = 0;
    for line in lines {
        let remove = if !reverse { 0 } else if text[line..].starts_with('\t') { 1 }
            else { text[line..].bytes().take(INDENT.len()).take_while(|&ch| ch == b' ').count() };
        let insert = if reverse { "" } else { INDENT };
        edit.text.push_str(&text[from..line]);
        edit.text.push_str(insert);
        from = line + remove;
        for (old, adjusted) in [(anchor, &mut edit.anchor), (cursor, &mut edit.cursor)] {
            if old >= line { *adjusted = *adjusted + insert.len() - (old - line).min(remove); }
        }
    }
    edit.text.push_str(&text[from..]);
    edit
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enter_continues_nested_and_ordered_lists_and_unchecks_new_tasks() {
        for (source, result) in [
            ("- Äpfel", "- Äpfel\n- "),
            ("+ [x] Fertig", "+ [x] Fertig\n+ [ ] "),
            ("- Eltern\n    * [ ] Offen", "- Eltern\n    * [ ] Offen\n    * [ ] "),
            ("9) Neun", "9) Neun\n10) "),
            ("- Erstes\r\n- Zweites", "- Erstes\r\n- Zweites\r\n- "),
        ] {
            let edit = continue_list(source, source.len(), source.len()).unwrap();
            assert_eq!(edit.text, result);
            assert_eq!(edit.cursor, result.len());
        }
    }

    #[test]
    fn enter_exits_empty_list_items_and_keeps_examples_inside_code_verbatim() {
        let source = "- Zeile\n- [ ] ";
        assert_eq!(continue_list(source, source.len(), source.len()).unwrap().text, "- Zeile\n");
        let source = "~~~text\n- kein Listeneintrag";
        assert!(continue_list(source, source.len(), source.len()).is_none());
        assert!(continue_list("normaler Absatz", 8, 8).is_none());
    }

    #[test]
    fn renders_headings_nested_tasks_code_and_bare_domain_links() {
        let text = "Hallo\\nHallo\\n======\\n\\n### Titel\\n\\n- [ ] **Entwurf**\\n    - [X] Fertig\\n\\n~~~rust\\n    let x = 1;\\n~~~\\n\\n[Klick](example.org/a) www.example.com. \\u{60}- [ ] kein Eintrag\\u{60}";
        let rows = blocks(&text.replace("\\n", "\n").replace("\\u{60}", "\u{60}"));
        assert!(rows.iter().any(|row| row.heading == 1));
        assert!(rows.iter().any(|row| row.heading == 3));
        let checks: Vec<_> = rows.iter().filter(|row| row.check.is_some()).collect();
        assert_eq!(checks.len(), 2);
        assert_eq!(checks[1].indent, 1);
        assert_eq!(rows.iter().find_map(|row| row.code.as_deref()), Some("    let x = 1;\n"));
        assert_eq!(rows.last().unwrap().links, ["https://example.org/a", "https://www.example.com/"]);
    }

    #[test]
    fn check_toggle_and_indentation_keep_utf8_text_intact() {
        let text = "- [ ] Grüß dich\n- [X] Fertig";
        let rows = blocks(text);
        assert_eq!(toggle(text, rows[1].check.unwrap().0).unwrap(), "- [ ] Grüß dich\n- [ ] Fertig");
        let original = "Öl\n- Zeile\n";
        let edit = indent(original, 0, original.len(), false);
        assert_eq!(edit.text, "    Öl\n    - Zeile\n");
        assert_eq!(indent(&edit.text, edit.anchor, edit.cursor, true).text, original);
    }
}
