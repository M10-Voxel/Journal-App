//! The notebook preview keeps the original Markdown and its checkbox byte offsets.
use std::{collections::HashMap, ops::Range};
use pulldown_cmark::{Alignment, CodeBlockKind, Event, Options, Parser, Tag, TagEnd};
use slint::StyledText;
use crate::notebook::web_address;

/// A table: the header is the first row; `aligns` are 0 left, 1 centre, 2 right for each column.
#[derive(Default)]
pub struct Table {
    pub aligns: Vec<i32>,
    pub rows: Vec<Vec<StyledText>>,
}

#[derive(Default)]
pub struct Block {
    pub table: Option<Table>,
    pub display: StyledText,
    pub heading: u8,
    pub indent: usize,
    pub marker: String,
    pub code: Option<String>,
    pub language: String,
    pub check: Option<(usize, bool)>,
    pub links: Vec<String>,
}

/// The colours of `[text]{rot}` (`textColors` in the app's `markdown.ts`, its default theme). On a paper card they are
/// darkened, so yellow and cyan stay readable on the light paper.
const COLORS: [(&str, [u8; 3]); 8] = [
    ("rot", [0xdf, 0x62, 0x62]), ("orange", [0xe6, 0xa8, 0x5c]), ("gelb", [0xe2, 0xd7, 0xb7]), ("grün", [0x76, 0xd9, 0x82]),
    ("cyan", [0xc2, 0xdc, 0xe9]), ("blau", [0x56, 0x9e, 0xff]), ("lila", [0xc6, 0x9b, 0xff]), ("pink", [0xad, 0x40, 0x75]),
];
/// Stand-ins in the inline text while a paragraph is built: a `[`, a `]` and `==`. Which of them are formatting is only
/// known once the whole paragraph is there (`resolve`). Characters of the private use area never come from a note.
const OPEN: char = '\u{E000}';
const CLOSE: char = '\u{E001}';
const MARK: char = '\u{E002}';

#[derive(Default)]
struct TableBuild {
    aligns: Vec<i32>,
    rows: Vec<Vec<StyledText>>,
    row: Vec<StyledText>,
    head: bool,
}

#[derive(Default)]
struct Preview {
    paper: bool,
    table: Option<TableBuild>,
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
            block.display = self.styled(block.heading > 0);
        }
        self.blocks.push(block);
        self.inline.clear();
        self.plain.clear();
    }

    /// The inline text built so far as styled text (bold for a heading), then cleared.
    fn styled(&mut self, bold: bool) -> StyledText {
        let inline = resolve(self.inline.trim_end(), self.paper);
        let inline = if bold && !inline.is_empty() { format!("**{inline}**") } else { inline };
        let styled = StyledText::from_markdown(&inline).unwrap_or_else(|_| StyledText::from_plain_text(&strip(self.plain.trim_end())));
        self.inline.clear();
        self.plain.clear();
        styled
    }

    /// Text that is no address: escaped, with the stand-ins for `[`, `]` and `==`.
    fn words(&mut self, text: &str) {
        if self.link.is_some() { escape(&mut self.inline, text); return; }
        let mut chars = text.chars().peekable();
        while let Some(ch) = chars.next() {
            match ch {
                '[' => self.inline.push(OPEN),
                ']' => self.inline.push(CLOSE),
                '=' if chars.peek() == Some(&'=') => { chars.next(); self.inline.push(MARK); }
                '\u{E000}'..='\u{E0FF}' => {}
                _ => escape(&mut self.inline, ch.encode_utf8(&mut [0; 4])),
            }
        }
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
                self.words(&word[..start]);
                self.inline.push('[');
                escape(&mut self.inline, address);
                self.inline.push_str(&format!("](<{url}>)"));
                self.block.links.push(url);
                self.words(&word[start + address.len()..]);
            } else {
                self.words(word);
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
            Event::Start(Tag::Table(aligns)) => {
                self.flush();
                let aligns = aligns.iter().map(|align| match align { Alignment::Center => 1, Alignment::Right => 2, _ => 0 }).collect();
                self.table = Some(TableBuild { aligns, ..TableBuild::default() });
            }
            Event::Start(Tag::TableHead) => { if let Some(table) = &mut self.table { table.head = true; } }
            Event::Start(Tag::TableRow) => { if let Some(table) = &mut self.table { table.head = false; } }
            Event::Start(Tag::TableCell) => { self.inline.clear(); self.plain.clear(); }
            Event::End(TagEnd::TableCell) => {
                let head = self.table.as_ref().is_some_and(|table| table.head);
                let cell = self.styled(head);
                if let Some(table) = &mut self.table { table.row.push(cell); }
            }
            Event::End(TagEnd::TableRow | TagEnd::TableHead) => {
                if let Some(table) = &mut self.table { let row = std::mem::take(&mut table.row); table.rows.push(row); }
            }
            Event::End(TagEnd::Table) => {
                if let Some(table) = self.table.take() {
                    let columns = table.rows.iter().map(Vec::len).max().unwrap_or(0);
                    let rows = table.rows.into_iter().map(|mut row| { row.resize_with(columns, StyledText::default); row }).collect();
                    let indent = self.quotes + self.lists.len().saturating_sub(1);
                    self.blocks.push(Block { indent, table: Some(Table { aligns: table.aligns, rows }), ..Block::default() });
                }
            }
            Event::Rule => { self.flush(); self.text("────────"); self.flush(); }
            _ => {}
        }
    }
}

/// The text of a paragraph without the stand-ins.
fn strip(text: &str) -> String { text.chars().filter(|ch| !matches!(ch, '\u{E000}'..='\u{E0FF}')).collect() }

/// The stand-ins become `<font color>` and `<u>` where they pair up (`[text]{rot}`, `==text==`) and the characters they
/// were where they do not.
fn resolve(inline: &str, paper: bool) -> String {
    if !inline.contains([OPEN, CLOSE, MARK]) { return inline.to_owned(); }
    let chars: Vec<char> = inline.chars().collect();
    // A `]` followed by `{name}` (its braces are escaped) closes a colour span; this is the colour's place in COLORS.
    let colour_at = |at: usize| COLORS.iter().position(|(name, _)| {
        let tail: String = chars[at + 1..].iter().take(name.chars().count() + 4).collect();
        tail == format!("\\{{{name}\\}}")
    });
    let mut open: Vec<usize> = Vec::new();
    let mut paired: HashMap<usize, (usize, Option<usize>)> = HashMap::new();
    let mut mark: Option<usize> = None;
    for (at, ch) in chars.iter().enumerate() {
        match *ch {
            OPEN => open.push(at),
            CLOSE => {
                if let (Some(colour), Some(start)) = (colour_at(at), open.last().copied()) {
                    open.pop();
                    paired.insert(start, (at, Some(colour)));
                    paired.insert(at, (start, Some(colour)));
                }
            }
            MARK => match mark.take() {
                Some(start) => { paired.insert(start, (at, None)); paired.insert(at, (start, None)); }
                None => mark = Some(at),
            },
            _ => {}
        }
    }
    let mut out = String::new();
    let mut at = 0;
    while at < chars.len() {
        let ch = chars[at];
        match (ch, paired.get(&at)) {
            (OPEN, Some((_, Some(colour)))) => {
                let [r, g, b] = COLORS[*colour].1.map(|channel| if paper { (f32::from(channel) * 0.55) as u8 } else { channel });
                out.push_str(&format!("<font color=\"#{r:02x}{g:02x}{b:02x}\">"));
            }
            (CLOSE, Some((_, Some(colour)))) => {
                out.push_str("</font>");
                // The `{name}` after it names the colour; it is no text.
                at += 1 + COLORS[*colour].0.chars().count() + 4;
                continue;
            }
            (MARK, Some((start, None))) => out.push_str(if *start < at { "</u>" } else { "<u>" }),
            (OPEN, _) => out.push_str("\\["),
            (CLOSE, _) => out.push_str("\\]"),
            (MARK, _) => out.push_str("=="),
            _ => out.push(ch),
        }
        at += 1;
    }
    out
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

/// The blocks of a note. `paper`: on a light paper card, where the colours of `[text]{rot}` are darker.
pub fn blocks(text: &str, paper: bool) -> Vec<Block> {
    let mut preview = Preview { paper, ..Preview::default() };
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

// ----- Tables in the editor: Enter adds a row, Tab moves between the cells (as in the app's notes) -----

/// The text of a table's cells in a line: their byte ranges, without the spaces around them. An empty cell is a
/// collapsed range after the space that follows its bar.
fn cell_ranges(line: &str) -> Vec<Range<usize>> {
    let bars: Vec<usize> = line.char_indices().filter(|(at, ch)| *ch == '|' && !line[..*at].ends_with('\\')).map(|(at, _)| at).collect();
    let mut cells = Vec::new();
    for pair in bars.windows(2) {
        let (from, to) = (pair[0] + 1, pair[1]);
        let inner = &line[from..to];
        let lead = inner.len() - inner.trim_start().len();
        cells.push(if inner.trim().is_empty() { let at = (from + 1).min(to); at..at } else { from + lead..from + lead + inner.trim().len() });
    }
    cells
}

/// A rule line (`| --- | :-: |`) between the header and the rows.
fn is_rule(line: &str) -> bool {
    let cells = cell_ranges(line);
    !cells.is_empty() && cells.iter().all(|cell| { let text = &line[cell.clone()]; text.len() >= 2 && text.trim_matches(':').chars().all(|ch| ch == '-') && text.contains('-') })
}

/// The lines (byte ranges, without line ends) of the table the line at `line_start` belongs to.
fn table_lines(text: &str, line_start: usize) -> Option<Vec<Range<usize>>> {
    let span = events(text).find_map(|(event, span)| (matches!(event, Event::Start(Tag::Table(_))) && span.contains(&line_start)).then_some(span))?;
    let mut lines = Vec::new();
    let mut at = span.start;
    while at < span.end.min(text.len()) {
        let end = text[at..].find('\n').map_or(text.len(), |n| at + n).min(span.end.max(at));
        lines.push(at..text[at..end].trim_end_matches('\r').len() + at);
        at = text[at..].find('\n').map_or(text.len(), |n| at + n + 1);
    }
    Some(lines)
}

fn empty_row(columns: usize) -> String { format!("|{}", "   |".repeat(columns.max(1))) }

/// Enter at the end of a table row: a new row with the same columns below it (below the rule when it is the header);
/// an empty row ends the table.
fn continue_table(text: &str, line_start: usize, line_end: usize) -> Option<Edit> {
    let lines = table_lines(text, line_start)?;
    let index = lines.iter().position(|line| line.start == line_start)?;
    let line = &text[lines[index].clone()];
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    if index > 0 && !is_rule(line) && cell_ranges(line).iter().all(Range::is_empty) {
        // An empty row: it goes, a blank line ends the table, and the cursor stands below it.
        let mut updated = text.to_owned();
        updated.replace_range(line_start..line_end, newline);
        let at = line_start + newline.len();
        return Some(Edit { text: updated, anchor: at, cursor: at });
    }
    let columns = cell_ranges(&text[lines[0].clone()]).len();
    let after = if index == 0 { lines.get(1).filter(|rule| is_rule(&text[(*rule).clone()])).map_or(lines[0].end, |rule| rule.end) } else { lines[index].end };
    let row = empty_row(columns);
    let mut updated = text.to_owned();
    updated.insert_str(after, &format!("{newline}{row}"));
    let first = after + newline.len() + cell_ranges(&row)[0].start;
    Some(Edit { text: updated, anchor: first, cursor: first })
}

/// Tab or Shift+Tab in a table row: the next or previous cell, its text selected; Tab in the last cell adds a row.
/// None outside tables and for a selection across lines.
pub fn table_tab(text: &str, anchor: usize, cursor: usize, reverse: bool) -> Option<Edit> {
    let (anchor, cursor) = (char_boundary(text, anchor), char_boundary(text, cursor));
    let (start, end) = (anchor.min(cursor), anchor.max(cursor));
    let line_start = text[..start].rfind('\n').map_or(0, |at| at + 1);
    if text[start..end].contains('\n') { return None; }
    let lines = table_lines(text, line_start)?;
    let row = lines.iter().position(|line| line.start == line_start)?;
    let cells = cell_ranges(&text[lines[row].clone()]);
    let column = cells.iter().rposition(|cell| lines[row].start + cell.start <= start).unwrap_or(0);
    let select = |text: String, line: &Range<usize>, cell: &Range<usize>| Edit { text, anchor: line.start + cell.start, cursor: line.start + cell.end };
    let step = |from: usize, forward: bool| -> Option<usize> {
        let mut at = from;
        loop {
            at = if forward { at + 1 } else { at.checked_sub(1)? };
            let line = lines.get(at)?;
            if !is_rule(&text[line.clone()]) { return Some(at); }
        }
    };
    if !reverse && column + 1 < cells.len() { return Some(select(text.to_owned(), &lines[row], &cells[column + 1])); }
    if reverse && column > 0 { return Some(select(text.to_owned(), &lines[row], &cells[column - 1])); }
    if reverse {
        let Some(previous) = step(row, false) else { return Some(select(text.to_owned(), &lines[row], &cells[column])) };
        let last = cell_ranges(&text[lines[previous].clone()]);
        return last.last().map(|cell| select(text.to_owned(), &lines[previous], cell));
    }
    if let Some(next) = step(row, true) {
        let first = cell_ranges(&text[lines[next].clone()]);
        return first.first().map(|cell| select(text.to_owned(), &lines[next], cell));
    }
    // After the last cell of the last row: a new row.
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let mut updated = text.to_owned();
    let new = empty_row(cells.len());
    updated.insert_str(lines[row].end, &format!("{newline}{new}"));
    let first = lines[row].end + newline.len() + cell_ranges(&new)[0].start;
    Some(Edit { text: updated, anchor: first, cursor: first })
}

/// Tab or Shift+Tab: the next cell in a table, else the indentation of the touched lines.
pub fn tab(text: &str, anchor: usize, cursor: usize, reverse: bool) -> Edit {
    table_tab(text, anchor, cursor, reverse).unwrap_or_else(|| indent(text, anchor, cursor, reverse))
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
    // In (or after) the last cell of a table row, or anywhere in an empty one: a row below, or the end of the table.
    let cells = cell_ranges(line);
    if start == end && line.trim_start().starts_with('|') && line.trim_end().ends_with('|')
        && (cells.last().is_some_and(|cell| cursor >= line_start + cell.end) || cells.iter().all(Range::is_empty)) {
        if let Some(edit) = continue_table(text, line_start, line_start + line.len()) { return Some(edit); }
    }

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
        let rows = blocks(&text.replace("\\n", "\n").replace("\\u{60}", "\u{60}"), false);
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
        let rows = blocks(text, false);
        assert_eq!(toggle(text, rows[1].check.unwrap().0).unwrap(), "- [ ] Grüß dich\n- [ ] Fertig");
        let original = "Öl\n- Zeile\n";
        let edit = indent(original, 0, original.len(), false);
        assert_eq!(edit.text, "    Öl\n    - Zeile\n");
        assert_eq!(indent(&edit.text, edit.anchor, edit.cursor, true).text, original);
    }

    /// The text of styled text without its formatting, read from its `Debug` form (Slint gives no accessor).
    fn raw(text: &StyledText) -> String {
        let debug = format!("{text:?}");
        let mut texts = Vec::new();
        let mut rest = debug.as_str();
        while let Some(at) = rest.find("text: \"") {
            let tail = &rest[at + 7..];
            let end = tail.find("\", formatting").expect("a paragraph's text ends before its formatting");
            texts.push(tail[..end].replace("\\\"", "\""));
            rest = &tail[end..];
        }
        texts.join("
")
    }
    fn cells(row: &[StyledText]) -> Vec<String> { row.iter().map(raw).collect() }

    #[test]
    fn tables_are_real_tables_with_a_header_alignments_and_formatted_cells() {
        let text = "Vorher\n\n| Name | Wert | Rest |\n|:--|:-:|--:|\n| **Fett** | `code` | [rot]{rot} |\n| nur eine |\n\nNachher";
        let rows = blocks(text, false);
        let table = rows.iter().find_map(|row| row.table.as_ref()).expect("a table block");
        assert_eq!(table.aligns, [0, 1, 2]);
        assert_eq!(table.rows.len(), 3, "The header and two rows.");
        assert_eq!(cells(&table.rows[0]), ["Name", "Wert", "Rest"]);
        assert_eq!(cells(&table.rows[1]), ["Fett", "code", "rot"]);
        assert_eq!(cells(&table.rows[2]), ["nur eine", "", ""], "A short row is filled up to the header's columns.");
        assert_eq!(rows.iter().filter(|row| row.table.is_none()).count(), 2, "The paragraphs around it stay paragraphs.");
        assert!(rows.iter().filter(|row| row.table.is_none()).all(|row| cells(&[row.display.clone()]).iter().all(|text| !text.contains('|'))));
    }

    #[test]
    fn highlight_and_colours_follow_the_apps_markdown() {
        let text = |source: &str, paper: bool| cells(&[blocks(source, paper).remove(0).display]).remove(0);
        assert_eq!(text("a ==markiert== b", false), "a markiert b");
        assert_eq!(text("[rot]{rot} und [grün]{grün}", false), "rot und grün");
        assert_eq!(text("[**fett** und [innen]{blau}]{lila}!", false), "fett und innen!");
        // What is no pair stays as written.
        assert_eq!(text("1 == 2 und [kein]{farbe} und [offen", false), "1 == 2 und [kein]{farbe} und [offen");
        assert_eq!(text("[Text]{rot", false), "[Text]{rot");
        assert_eq!(text("==offen", false), "==offen");
        assert_eq!(resolve(&format!("{OPEN}x{CLOSE}\\{{rot\\}}"), false), "<font color=\"#df6262\">x</font>");
        assert_eq!(resolve(&format!("{OPEN}x{CLOSE}\\{{gelb\\}}"), true), "<font color=\"#7c7664\">x</font>", "Darker on paper.");
        assert_eq!(resolve(&format!("{MARK}x{MARK}"), false), "<u>x</u>");
    }

    #[test]
    fn enter_in_a_table_adds_a_row_and_an_empty_row_ends_it() {
        let source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
        let edit = continue_list(source, source.len(), source.len()).unwrap();
        assert_eq!(edit.text, format!("{source}\n|   |   |"));
        assert_eq!((edit.anchor, edit.cursor), (source.len() + 3, source.len() + 3), "The cursor stands in the first cell.");
        let header = "| A | B |\n| --- | --- |\n| 1 | 2 |";
        let edit = continue_list(header, 9, 9).unwrap();
        assert_eq!(edit.text, "| A | B |\n| --- | --- |\n|   |   |\n| 1 | 2 |", "From the header: under the rule.");
        let empty = "| A | B |\n| --- | --- |\n|   |   |";
        let edit = continue_list(empty, empty.len(), empty.len()).unwrap();
        assert_eq!(edit.text, "| A | B |\n| --- | --- |\n\n", "The empty row becomes the blank line that ends the table.");
        assert_eq!(edit.cursor, edit.text.len());
        let inside = "| A | B |\n| --- | --- |\n|   |   |";
        assert_eq!(continue_list(inside, inside.len() - 7, inside.len() - 7).unwrap().text, edit.text, "Anywhere in an empty row.");
        assert!(continue_list("| kein | Tabellenkopf |", 21, 21).is_none(), "A line with bars is no table without its rule.");
    }

    #[test]
    fn tab_moves_between_cells_adds_a_row_at_the_end_and_indents_elsewhere() {
        let source = "| A | B |\n| --- | --- |\n| 1 | 2 |";
        let select = |edit: &Edit| source_text(&edit.text)[edit.anchor..edit.cursor].to_owned();
        fn source_text(text: &str) -> &str { text }
        let edit = tab(source, 2, 2, false);
        assert_eq!(select(&edit), "B", "Tab: the next cell, selected.");
        let edit = tab(source, edit.anchor, edit.cursor, false);
        assert_eq!(select(&edit), "1", "From the last cell of a row to the next row, over the rule.");
        let edit = tab(source, edit.anchor, edit.cursor, true);
        assert_eq!(select(&edit), "B", "Shift+Tab goes back over the rule.");
        let last = source.len() - 2;
        let edit = tab(source, last, last, false);
        assert!(edit.text.ends_with("\n|   |   |") && edit.anchor == edit.cursor, "Tab in the last cell: a new row.");
        let list = tab("- a", 0, 0, false);
        assert_eq!(list.text, "    - a", "Outside tables Tab still indents.");
    }
}
