//! Reading the line: which words are the date, the span, the time, the tag, the kind and the repetition, and what is
//! left as the entry's text. German and English keywords always work both (docs/plan.md, 1.4).
use chrono::NaiveDate;
use crate::repeat::{self, text as repeat_text, Rule, Unit};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind { Task, Event, Note }

/// How a span of days is kept: one continuous entry (▬) or one entry per day (┆).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode { Continuous, Repeated }
impl Mode {
    #[cfg(test)]
    pub fn sign(self) -> char { match self { Mode::Continuous => '▬', Mode::Repeated => '┆' } }
}

/// What a word of the line was read as (for the light tint of recognised values).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role { Kind, Date, Time, Tag, Repeat, Mode, Filler, Pending, Text }

/// A word of the line, by character positions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Token { pub start: usize, pub end: usize, pub text: String, pub role: Role }

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Draft {
    pub kind: Option<Kind>,
    /// The entry's own words.
    pub text: String,
    /// One or several single days ("Mo, Mi, Fr" or "19.11., 21.11.").
    pub dates: Vec<NaiveDate>,
    /// Whether `dates` were written as weekdays (an enumeration of those means "every …").
    pub weekdays: bool,
    pub span: Option<(NaiveDate, NaiveDate)>,
    pub spans: Vec<(NaiveDate, NaiveDate)>,
    pub unclear: Vec<String>,
    /// Minutes since midnight.
    pub time: Option<u32>,
    pub end: Option<u32>,
    /// The tag's id; `tag_word` is what was typed after `\` when no tag fits (yet).
    pub tag: Option<String>,
    pub tag_word: Option<String>,
    pub repeat: Option<Rule>,
    pub mode: Option<Mode>,
    pub tokens: Vec<Token>,
}

/// A tag as the line knows it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TagName { pub id: String, pub name: String }

/// A tag as a word: spaces become underscores (`\Neues_Projekt`).
pub fn tag_word(name: &str) -> String { name.split_whitespace().collect::<Vec<_>>().join("_") }
pub fn fold(text: &str) -> String {
    text.to_lowercase().chars().map(|c| match c { 'ä' => 'a', 'ö' => 'o', 'ü' => 'u', 'é' | 'è' | 'ê' => 'e', 'á' | 'à' => 'a', _ => c }).collect()
}

// ----- Words -----

pub fn kind_word(word: &str) -> Option<Kind> {
    Some(match word {
        "aufgabe" | "task" | "todo" => Kind::Task,
        "termin" | "ereignis" | "event" | "appointment" | "kalender" | "calendar" => Kind::Event,
        "notiz" | "note" => Kind::Note,
        _ => return None,
    })
}
fn mode_word(word: &str) -> Option<Mode> {
    Some(match word {
        "▬" | "durchgehend" | "mehrtägig" | "continuous" | "multiday" => Mode::Continuous,
        "┆" => Mode::Repeated,
        _ => return None,
    })
}
/// Words that start a repetition.
fn repeat_trigger(word: &str) -> bool {
    matches!(word, "jede" | "jeden" | "jedes" | "jeder" | "alle" | "every" | "each" | "täglich" | "daily" | "wöchentlich" | "weekly" | "monatlich"
        | "monthly" | "jährlich" | "yearly" | "annually" | "zweiwöchentlich" | "vierzehntägig" | "biweekly" | "fortnightly" | "quartalsweise"
        | "quarterly" | "vierteljährlich" | "halbjährlich" | "werktags" | "wochentags" | "weekdays" | "wochenende" | "wochenenden" | "weekends"
        | "montags" | "dienstags" | "mittwochs" | "donnerstags" | "freitags" | "samstags" | "sonntags"
        | "geburtstag" | "birthday" | "ostern" | "karfreitag" | "good" | "easter" | "mondays" | "tuesdays" | "wednesdays" | "thursdays" | "fridays" | "saturdays" | "sundays")
}
/// Words a repetition may go on with.
fn repeat_word(word: &str) -> bool {
    repeat_trigger(word) || repeat_text::weekday_word(word).is_some() || repeat_text::month_word(word).is_some() || repeat_text::unit_word(word).is_some()
        || matches!(word, "am" | "an" | "im" | "in" | "und" | "and" | "on" | "the" | "of" | "den" | "dem" | "der" | "des" | "monats" | "zum" | "nur" | "only"
            | "ab" | "starting" | "start" | "x" | "mal" | "times" | "aus" | "off" | "pause" | "für" | "for" | "immer" | "ever" | "ohne" | "ende" | "no" | "end" | "bis" | "until" | "from" | "von" | "through" | "till" | "-" | "–"
            | "erste" | "ersten" | "erster" | "zweite" | "zweiten" | "dritte" | "dritten" | "vierte" | "vierten" | "letzte" | "letzten" | "letzter"
            | "first" | "second" | "third" | "fourth" | "last" | "other" | "monatsende" | "ultimo")
}
fn filler_before_date(word: &str) -> bool { matches!(word, "am" | "on" | "ab" | "from") }
fn filler_before_time(word: &str) -> bool { matches!(word, "um" | "at" | "ab" | "von" | "from") }
fn range_word(word: &str) -> bool { matches!(word, "bis" | "to" | "until" | "till" | "-" | "–" | "—") }

/// "14:30", "9:05", "14h", "14uhr", "2pm", "2:30pm" → minutes since midnight.
pub fn parse_time(word: &str) -> Option<u32> {
    let word = word.trim_end_matches("uhr").trim_end_matches('h');
    let (word, offset) = if let Some(rest) = word.strip_suffix("pm") { (rest, 12) } else if let Some(rest) = word.strip_suffix("am") { (rest, 0) } else { (word, u32::MAX) };
    let (hour, minute) = match word.split_once(':') {
        Some((hour, minute)) if minute.len() == 2 => (hour.parse::<u32>().ok()?, minute.parse::<u32>().ok()?),
        Some(_) => return None,
        None if offset != u32::MAX || word.len() <= 2 => (word.parse::<u32>().ok()?, 0),
        None => return None,
    };
    if !word.bytes().all(|b| b.is_ascii_digit() || b == b':') || minute > 59 { return None; }
    let hour = match offset { u32::MAX => hour, add if (1..=12).contains(&hour) => hour % 12 + add, _ => return None };
    (hour <= 23).then_some(hour * 60 + minute)
}
/// A time written with something that marks it as one ("14:00", "2pm", "14 Uhr"), not a bare number.
fn marked_time(word: &str) -> Option<u32> {
    if word.bytes().all(|b| b.is_ascii_digit()) { return None; }
    parse_time(word)
}
pub fn format_time(minutes: u32) -> String { format!("{:02}:{:02}", minutes / 60, minutes % 60) }

/// "19.11.", "19.11.2026", "19.11" → the next such date from `today` on (a year given is kept).
fn numeric_date(word: &str, today: NaiveDate) -> Option<NaiveDate> {
    let parts: Vec<&str> = word.trim_end_matches('.').split('.').collect();
    if !(2..=3).contains(&parts.len()) || parts.iter().any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit())) { return None; }
    if parts[0].len() > 2 || parts[1].len() > 2 { return None; }
    let year = parts.get(2).map(|year| year.parse::<i32>().ok()).unwrap_or(None);
    if parts.len() == 3 && !(2..=4).contains(&parts[2].len()) { return None; }
    repeat_text::date_from(today, parts[0].parse().ok()?, parts[1].parse().ok()?, year)
}
/// A weekday's name; short forms of up to three letters only with a capital (so "so" stays a word), except the
/// unmistakable ones.
fn weekday_of_word(original: &str, lower: &str) -> Option<u8> {
    let day = repeat_text::weekday_word(lower)?;
    if lower.ends_with('s') && lower.len() > 4 { return None; } // "montags" repeats
    let short = lower.chars().count() <= 3;
    if short && !original.starts_with(char::is_uppercase) && !matches!(lower, "mo" | "di" | "mi" | "fr") { return None; }
    Some(day)
}
/// The next day with `weekday` from `from` on (`from` included).
pub fn next_weekday(from: NaiveDate, weekday: u8) -> NaiveDate {
    repeat::shift(from, ((weekday as i64 - repeat::weekday_of(from) as i64) + 7) % 7)
}

// ----- Tokens -----

#[derive(Clone, Debug)]
struct Word { text: String, lower: String, start: usize, end: usize, comma: bool }

fn split_words(line: &str) -> Vec<Word> {
    let chars: Vec<char> = line.chars().collect();
    let mut words: Vec<Word> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() { i += 1; continue; }
        if chars[i] == ',' || chars[i] == ';' { if let Some(last) = words.last_mut() { last.comma = true; } i += 1; continue; }
        let start = i;
        if matches!(chars[i], '"' | '“' | '„') {
            i += 1;
            while i < chars.len() && !matches!(chars[i], '"' | '”' | '“') { i += 1; }
            if i < chars.len() { i += 1; }
        } else {
            while i < chars.len() && !chars[i].is_whitespace() && chars[i] != ',' && chars[i] != ';' { i += 1; }
        }
        let text: String = chars[start..i].iter().collect();
        let comma = chars.get(i).is_some_and(|c| *c == ',' || *c == ';');
        words.push(Word { lower: text.to_lowercase(), text, start, end: i, comma });
    }
    words
}

/// "Mo–Fr", "19.11.-21.11.", "14–15:30" are split into both ends and the dash between; other words stay whole.
fn split_ranges(words: Vec<Word>, today: NaiveDate) -> Vec<Word> {
    let mut out = Vec::new();
    for word in words {
        if word.text.starts_with(['"', '„', '“']) { out.push(word); continue; }
        let found = word.text.char_indices().find(|(index, c)| *index > 0 && matches!(c, '–' | '-' | '—'));
        if let Some((byte, dash)) = found {
            let (left, right) = (&word.text[..byte], &word.text[byte + dash.len_utf8()..]);
            let (left_lower, right_lower) = (left.to_lowercase(), right.to_lowercase());
            let dates = (weekday_of_word(left, &left_lower).is_some() || numeric_date(left, today).is_some())
                && (right.is_empty() || weekday_of_word(right, &right_lower).is_some() || numeric_date(right, today).is_some());
            let times = parse_time(&left_lower).is_some() && (right.is_empty() || parse_time(&right_lower).is_some());
            if dates || times {
                let left_end = word.start + left.chars().count();
                out.push(Word { text: left.into(), lower: left_lower, start: word.start, end: left_end, comma: false });
                out.push(Word { text: dash.to_string(), lower: dash.to_string(), start: left_end, end: left_end + 1, comma: false });
                if !right.is_empty() { out.push(Word { text: right.into(), lower: right_lower, start: left_end + 1, end: word.end, comma: word.comma }); }
                continue;
            }
        }
        out.push(word);
    }
    out
}

/// A date at `i` (and how many words it took): "heute", "morgen", "Mi", "Mi 19.11.", "19.11.", "nächsten Fr",
/// "in 3 Tagen", "19. November".
fn date_at(words: &[Word], i: usize, today: NaiveDate) -> Option<(NaiveDate, usize, bool)> {
    let word = words.get(i)?;
    let lower = word.lower.as_str();
    let next = words.get(i + 1);
    match lower {
        "heute" | "today" => return Some((today, 1, false)),
        "morgen" | "tomorrow" => return Some((repeat::shift(today, 1), 1, false)),
        "übermorgen" => return Some((repeat::shift(today, 2), 1, false)),
        "gestern" | "yesterday" => return Some((repeat::shift(today, -1), 1, false)),
        "nächsten" | "nächste" | "nächster" | "next" => {
            let next = next?;
            let day = weekday_of_word(&next.text, &next.lower)?;
            return Some((next_weekday(repeat::shift(today, 1), day), 2, true));
        }
        "in" => {
            let (count, unit) = (words.get(i + 1)?, words.get(i + 2)?);
            let count: i64 = count.lower.parse().ok().or_else(|| repeat_text::number_word(&count.lower).map(i64::from))?;
            let day = match repeat_text::unit_word(&unit.lower)? {
                Unit::Day => repeat::shift(today, count),
                Unit::Week => repeat::shift(today, count * 7),
                Unit::Month => today.checked_add_months(chrono::Months::new(count as u32))?,
                Unit::Year => today.checked_add_months(chrono::Months::new(count as u32 * 12))?,
            };
            return Some((day, 3, false));
        }
        _ => {}
    }
    if let Some(weekday) = weekday_of_word(&word.text, lower) {
        // "Mi 19.11." is the date; the weekday only names it.
        if let Some(day) = next.and_then(|next| numeric_date(&next.lower, today)) { return Some((day, 2, false)); }
        return Some((next_weekday(today, weekday), 1, true));
    }
    if let Some(day) = numeric_date(lower, today) { return Some((day, 1, false)); }
    // "19. November", "19 nov"
    if lower.trim_end_matches('.').bytes().all(|b| b.is_ascii_digit()) && !lower.is_empty() {
        if let Some(month) = next.and_then(|next| repeat_text::month_word(&next.lower)) {
            let day = repeat_text::date_from(today, lower.trim_end_matches('.').parse().ok()?, month as u32, None)?;
            return Some((day, 2, false));
        }
    }
    None
}

fn bare_hour(word: &str) -> Option<u32> {
    (word.len() <= 2 && word.bytes().all(|b| b.is_ascii_digit())).then(|| word.parse::<u32>().ok()).flatten().filter(|hour| *hour <= 23).map(|hour| hour * 60)
}

/// Reads the line. `today` anchors relative dates; `tags` are the journal's.
pub fn parse(line: &str, today: NaiveDate, tags: &[TagName]) -> Draft {
    let words = split_ranges(split_words(line), today);
    let mut draft = Draft::default();
    let mut roles = vec![Role::Text; words.len()];
    let mut i = 0;
    let mut after_date = false;
    let mut after_time_word = false;
    // A repetition's text, kept to read it once its anchor (the date) is known.
    let mut repeat_parts: Vec<(usize, usize)> = Vec::new();
    while i < words.len() {
        let word = &words[i];
        let lower = word.lower.as_str();
        if word.text.starts_with(['"', '„', '“']) { i += 1; continue; }
        if i == 0 || lower.starts_with('@') {
            if let Some(kind) = kind_word(lower.trim_start_matches('@')) { draft.kind = Some(kind); roles[i] = Role::Kind; i += 1; continue; }
        }
        if let Some(name) = word.text.strip_prefix('\\') {
            roles[i] = Role::Tag;
            let folded = fold(&name.replace('_', " "));
            match tags.iter().find(|tag| fold(&tag.name) == folded) {
                Some(tag) => { draft.tag = Some(tag.id.clone()); draft.tag_word = None; }
                None => draft.tag_word = Some(name.to_string()),
            }
            i += 1; continue;
        }
        if let Some(mode) = mode_word(lower) { draft.mode = Some(mode); roles[i] = Role::Mode; i += 1; continue; }
        if word.text.chars().all(|c| c == '_') { roles[i] = Role::Filler; i += 1; continue; }
        // A repetition: from its first word as long as the words belong to it.
        if repeat_trigger(lower) {
            let from = i;
            let mut j = i + 1;
            while j < words.len() {
                let w = &words[j].lower;
                if words[j].text.starts_with(['\\', '"', '„', '“', '@']) || mode_word(w).is_some() || marked_time(w).is_some() { break; }
                let digits = w.bytes().all(|b| b.is_ascii_digit());
                let next = words.get(j + 1).map(|next| next.lower.as_str());
                let previous = words[j - 1].lower.as_str();
                let counted = digits && (next.is_some_and(|n| repeat_text::unit_word(n).is_some() || matches!(n, "mal" | "x" | "times" | "an" | "on" | "aus" | "off"))
                    || matches!(previous, "alle" | "every" | "für" | "for" | "an" | "on"));
                let number = w.trim_end_matches(['.', 'x']).trim_end_matches("st").trim_end_matches("nd").trim_end_matches("rd").trim_end_matches("th");
                let numbered = !digits && number != w && !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit());
                let dated = numeric_date(w, today).is_some() && (matches!(previous, "ab" | "starting" | "start" | "bis" | "until" | "zum" | "on" | "am")
                    || words[from..j].iter().any(|word| matches!(word.lower.as_str(), "bis" | "until" | "through" | "till")));
                if counted || numbered || dated || (!digits && repeat_word(w)) { j += 1; } else { break; }
            }
            // A trailing joining word ("jeden Mo um") is not the repetition's.
            while j > from + 1 && matches!(words[j - 1].lower.as_str(), "am" | "an" | "im" | "in" | "und" | "and" | "on" | "the" | "bis" | "until" | "from" | "von" | "through" | "till" | "-" | "–") { j -= 1; }
            for role in &mut roles[from..j] { *role = Role::Repeat; }
            repeat_parts.push((from, j));
            i = j; continue;
        }
        // "von Mo bis Fr", "from 19.11. to 21.11."
        if matches!(lower, "von" | "vom" | "from") {
            if let Some((start, used, _)) = date_at(&words, i + 1, today) {
                let k = i + 1 + used;
                if words.get(k).is_some_and(|w| range_word(&w.lower)) {
                    if let Some((end, used_end, _)) = date_at(&words, k + 1, start) {
                        let span = (start.min(end), start.max(end));
                        draft.spans.push(span);
                        draft.span = draft.spans.first().copied();
                        roles[i] = Role::Filler;
                        for role in &mut roles[i + 1..k + 1 + used_end] { *role = Role::Date; }
                        i = k + 1 + used_end; after_date = true; continue;
                    }
                }
            }
        }
        // A keyword in front of a field still empty ("am __").
        if matches!(lower, "am" | "um" | "on" | "at" | "bis" | "to" | "von" | "from") && words.get(i + 1).is_some_and(|w| w.text.chars().all(|c| c == '_')) {
            roles[i] = Role::Filler; i += 1; continue;
        }
        if filler_before_date(lower) && (date_at(&words, i + 1, today).is_some()
            || words.get(i + 1).is_some_and(|word| mode_word(&word.lower).is_some()) && date_at(&words, i + 2, today).is_some()) {
            roles[i] = Role::Filler; i += 1; continue;
        }
        if filler_before_time(lower) && words.get(i + 1).is_some_and(|w| parse_time(&w.lower).is_some()) { roles[i] = Role::Filler; after_time_word = true; i += 1; continue; }
        if let Some((day, used, weekday)) = date_at(&words, i, today) {
            for role in &mut roles[i..i + used] { *role = Role::Date; }
            let k = i + used;
            // A span: "Mo–Fr", "Mo bis Fr", "19.11. – 21.11."
            if words.get(k).is_some_and(|w| range_word(&w.lower)) {
                if let Some((end, used_end, _)) = date_at(&words, k + 1, day) {
                    let span = (day.min(end), day.max(end));
                    draft.spans.push(span);
                    draft.span = draft.spans.first().copied();
                    for role in &mut roles[k..k + 1 + used_end] { *role = Role::Date; }
                    i = k + 1 + used_end; after_date = true; continue;
                }
            }
            if draft.dates.is_empty() { draft.weekdays = weekday; } else { draft.weekdays &= weekday; }
            draft.dates.push(day);
            // An enumeration: "Mo, Mi, Fr", "Mo und Mi"
            let mut k = k;
            loop {
                let joined = words[k - 1].comma || words.get(k).is_some_and(|w| matches!(w.lower.as_str(), "und" | "and" | "+"));
                let skip = usize::from(!words[k - 1].comma && words.get(k).is_some());
                let Some((more, used_more, weekday_more)) = joined.then(|| date_at(&words, k + skip, today)).flatten() else { break };
                for role in &mut roles[k..k + skip + used_more] { *role = Role::Date; }
                draft.dates.push(more);
                draft.weekdays &= weekday_more;
                k += skip + used_more;
            }
            i = k; after_date = true; continue;
        }
        // A time: "14:30", "2pm", "14 Uhr", and a bare hour right after a date or "um".
        let time = parse_time(lower).filter(|_| marked_time(lower).is_some() || after_date || after_time_word || draft.time.is_some()
            || words.get(i + 1).is_some_and(|w| matches!(w.lower.as_str(), "uhr" | "h") || range_word(&w.lower)) && bare_hour(lower).is_some());
        if let Some(time) = time {
            roles[i] = Role::Time;
            let mut k = i + 1;
            if words.get(k).is_some_and(|w| w.lower == "uhr") { roles[k] = Role::Time; k += 1; }
            if draft.time.is_none() {
                draft.time = Some(time);
                // "14–15:30", "14 bis 15"
                if words.get(k).is_some_and(|w| range_word(&w.lower)) {
                    if let Some(end) = words.get(k + 1).and_then(|w| parse_time(&w.lower)) {
                        draft.end = Some(end);
                        roles[k] = Role::Time; roles[k + 1] = Role::Time; k += 2;
                        if words.get(k).is_some_and(|w| w.lower == "uhr") { roles[k] = Role::Time; k += 1; }
                    }
                }
            } else if draft.end.is_none() { draft.end = Some(time); }
            i = k; after_time_word = false; continue;
        }
        after_date = false;
        after_time_word = false;
        i += 1;
    }

    // The repetition, read from its words with the date as its anchor.
    if !repeat_parts.is_empty() {
        let anchor = draft.span.map(|span| span.0).or(draft.dates.first().copied()).unwrap_or(today);
        let current = Rule { weekdays: Some(vec![repeat::weekday_of(anchor)]), ..Rule::new(anchor, Unit::Week, 1) };
        let text: Vec<&str> = repeat_parts.iter().flat_map(|(from, to)| words[*from..*to].iter().map(|w| w.text.as_str())).collect();
        match repeat_text::parse(&text.join(" "), &current) {
            Some(parsed) => { draft.unclear.extend(parsed.unknown); draft.repeat = Some(parsed.rule); },
            None => for (from, to) in &repeat_parts { for role in &mut roles[*from..*to] { *role = Role::Text; } },
        }
    }

    // Metadata that is still incomplete stays visible as such and blocks saving.
    for (index, word) in words.iter().enumerate() {
        if roles[index] == Role::Text && !word.text.starts_with(['"', '„', '“'])
            && (matches!(word.lower.as_str(), "from" | "von" | "until" | "bis" | "every" | "each" | "jede" | "jeden" | "jedes" | "alle" | "repeat" | "wiederholen" | "um" | "at" | "to")
                || word.text.contains(':') && word.text.chars().next().is_some_and(|c| c.is_ascii_digit())) {
            roles[index] = Role::Pending;
            draft.unclear.push(word.text.clone());
        }
    }
    draft.text = words.iter().zip(&roles).filter(|(_, role)| **role == Role::Text).map(|(w, _)| w.text.trim_matches(['"', '„', '“', '”'])).collect::<Vec<_>>().join(" ");
    draft.tokens = words.into_iter().zip(roles).map(|(w, role)| Token { start: w.start, end: w.end, text: w.text, role }).collect();
    draft
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repeat::{d, End};

    // Wednesday, 18 November 2026.
    fn today() -> NaiveDate { d("2026-11-18") }

    #[test]
    fn quoted_title_and_a_weekday_series_with_an_end_are_kept_separate() {
        for line in ["\"Hallo\" each Monday Tuesday Thursday until 04.12.2026", "\"Hallo\" each Monday Tuesday Thursday until on 04.12.2026"] {
            let draft = read(line);
            assert_eq!(draft.text, "Hallo");
            let rule = draft.repeat.unwrap();
            assert_eq!(rule.weekdays.as_deref(), Some([0, 1, 3].as_slice()));
            assert_eq!(rule.end.unwrap().until, Some(d("2026-12-04")));
            assert!(draft.unclear.is_empty(), "{:?}", draft.unclear);
            assert!(draft.dates.is_empty());
        }
        assert_eq!(read("\"from Monday until Friday at 14\"").text, "from Monday until Friday at 14");
        assert!(read("\"from Monday until Friday at 14\"").tokens.iter().all(|token| token.role == Role::Text));
    }

    #[test]
    fn from_can_be_a_time_span_and_incomplete_times_are_not_title_words() {
        for line in ["Meeting from 14 to 16", "Meeting von 14:00 bis 16:00", "event Meeting from 2pm to 4pm"] {
            let draft = read(line);
            assert_eq!(draft.text, "Meeting", "{line}");
            assert_eq!((draft.time, draft.end), (Some(840), Some(960)), "{line}");
        }
        assert!(!read("Meeting at 25:99").unclear.is_empty());
        assert!(!read("Hallo each Monday until").unclear.is_empty());
        assert_eq!(read("Bericht morgen @task").kind, Some(Kind::Task));
        assert_eq!(read("calendar Sitzung morgen").kind, Some(Kind::Event));
    }
    fn tags() -> Vec<TagName> { vec![TagName { id: "t1".into(), name: "Gesundheit".into() }, TagName { id: "t2".into(), name: "Neues Projekt".into() }] }
    fn read(line: &str) -> Draft { parse(line, today(), &tags()) }

    #[test]
    fn an_appointment_with_day_time_and_tag() {
        let draft = read("Zahnarzt Mi 14 \\Gesundheit");
        assert_eq!(draft.text, "Zahnarzt");
        assert_eq!(draft.dates, [d("2026-11-18")], "Today is a Wednesday.");
        assert_eq!(draft.time, Some(14 * 60));
        assert_eq!(draft.tag.as_deref(), Some("t1"));
        assert_eq!(read("Zahnarzt Do 19.11. um 9:30 \\neues_projekt").tag.as_deref(), Some("t2"));
    }

    #[test]
    fn days_in_both_languages() {
        assert_eq!(read("Einkaufen morgen").dates, [d("2026-11-19")]);
        assert_eq!(read("buy milk tomorrow").dates, [d("2026-11-19")]);
        assert_eq!(read("Anruf übermorgen").dates, [d("2026-11-20")]);
        assert_eq!(read("Anruf nächsten Mi").dates, [d("2026-11-25")]);
        assert_eq!(read("call next wednesday").dates, [d("2026-11-25")]);
        assert_eq!(read("Abgabe 3.12.").dates, [d("2026-12-03")]);
        assert_eq!(read("Abgabe 3.1.").dates, [d("2027-01-03")], "A day already past this year is next year's.");
        assert_eq!(read("Abgabe 17.11.2027").dates, [d("2027-11-17")]);
        assert_eq!(read("Abgabe in 3 Tagen").dates, [d("2026-11-21")]);
        assert_eq!(read("submit in 2 weeks").dates, [d("2026-12-02")]);
        assert_eq!(read("Party am 19. November").dates, [d("2026-11-19")]);
        assert_eq!(read("Party am Fr").text, "Party");
    }

    #[test]
    fn ordinary_words_stay_text() {
        let draft = read("so viel zu tun");
        assert_eq!((draft.text.as_str(), draft.dates.len()), ("so viel zu tun", 0));
        assert_eq!(read("Seite 14 lesen").time, None, "A bare number is no time without a date or \"um\".");
        assert_eq!(read("E-Mail schreiben").text, "E-Mail schreiben");
    }

    #[test]
    fn times_and_spans_of_time() {
        assert_eq!(read("Meeting um 9").time, Some(9 * 60));
        assert_eq!(read("Meeting 14:30").time, Some(14 * 60 + 30));
        assert_eq!(read("meeting at 2pm").time, Some(14 * 60));
        assert_eq!(read("Meeting 14 Uhr").time, Some(14 * 60));
        let draft = read("Meeting Mo 14–15:30");
        assert_eq!((draft.time, draft.end), (Some(14 * 60), Some(15 * 60 + 30)));
        let draft = read("Meeting morgen 9 bis 11");
        assert_eq!((draft.time, draft.end, draft.text.as_str()), (Some(9 * 60), Some(11 * 60), "Meeting"));
    }

    #[test]
    fn spans_of_days() {
        assert_eq!(read("Urlaub Mo–Fr").span, Some((d("2026-11-23"), d("2026-11-27"))));
        assert_eq!(read("Urlaub Mo-Fr").span, Some((d("2026-11-23"), d("2026-11-27"))));
        assert_eq!(read("Urlaub von Mo bis Fr").span, Some((d("2026-11-23"), d("2026-11-27"))));
        assert_eq!(read("Urlaub from 19.11. to 21.11.").span, Some((d("2026-11-19"), d("2026-11-21"))));
        assert_eq!(read("Urlaub Mi–Di").span, Some((d("2026-11-18"), d("2026-11-24"))), "The end follows the start.");
        assert_eq!(read("Urlaub ▬ Mo–Fr").mode, Some(Mode::Continuous));
        assert_eq!(read("Lernen ┆ Mo–Fr").mode, Some(Mode::Repeated));
        assert_eq!(read("Urlaub Mo–Fr").text, "Urlaub");
    }

    #[test]
    fn enumerations() {
        let draft = read("Sport Mo, Mi, Fr");
        assert_eq!(draft.dates, [d("2026-11-23"), d("2026-11-18"), d("2026-11-20")]);
        assert!(draft.weekdays);
        assert_eq!(draft.text, "Sport");
        let draft = read("Kurs 19.11., 26.11.");
        assert_eq!((draft.dates.len(), draft.weekdays), (2, false));
        assert_eq!(read("Sport Mo und Do").dates.len(), 2);
    }

    #[test]
    fn repetitions() {
        let draft = read("Sport jeden Mo 18:00");
        let rule = draft.repeat.unwrap();
        assert_eq!((rule.unit, rule.weekdays, rule.start), (Unit::Week, Some(vec![0]), d("2026-11-23")));
        assert_eq!(draft.time, Some(18 * 60));
        assert_eq!(draft.text, "Sport");
        let draft = read("Vitamine täglich");
        assert_eq!((draft.repeat.unwrap().unit, draft.text.as_str()), (Unit::Day, "Vitamine"));
        let rule = read("Miete monatlich am 1.").repeat.unwrap();
        assert_eq!((rule.unit, rule.start), (Unit::Month, d("2026-12-01")));
        let rule = read("Gießen alle 3 Tage bis 20.12.").repeat.unwrap();
        assert_eq!((rule.every, rule.end), (3, Some(End { count: None, until: Some(d("2026-12-20")) })));
        let rule = read("Standup werktags 9:30").repeat.unwrap();
        assert_eq!(rule.weekdays, Some(vec![0, 1, 2, 3, 4]));
        let draft = read("Lernen Mo–Fr täglich");
        assert_eq!((draft.span.is_some(), draft.repeat.map(|r| r.unit)), (true, Some(Unit::Day)));
        assert_eq!(read("Jeden Tag ein Apfel").text, "ein Apfel");
        assert_eq!(read("Geburtstag Anna 12.3.").text, "Anna");
    }

    #[test]
    fn kinds_and_tokens() {
        let draft = read("Termin Zahnarzt am Mi um 14");
        assert_eq!((draft.kind, draft.text.as_str(), draft.time), (Some(Kind::Event), "Zahnarzt", Some(14 * 60)));
        assert_eq!(read("Notiz Idee für das Projekt").kind, Some(Kind::Note));
        assert_eq!(read("task call Bob").kind, Some(Kind::Task));
        assert_eq!(read("Lies die Aufgabe").kind, None, "Only as the first word.");
        let roles: Vec<Role> = read("Zahnarzt Mi 14").tokens.iter().map(|t| t.role).collect();
        assert_eq!(roles, [Role::Text, Role::Date, Role::Time]);
        let unknown = read("Arzt \\Gesund");
        assert_eq!((unknown.tag, unknown.tag_word.as_deref()), (None, Some("Gesund")));
        assert_eq!(read("Termin __ am __ um __").text, "", "Empty fields are no text.");
    }
}
