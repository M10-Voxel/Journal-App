//! Repetitions written as text, in German or English, carried over from the app's `src/repeatText.ts`: "alle 3 Wochen am
//! Montag, Mittwoch", "every other week on tue and thu", "jährlich am 12. März", "last friday of the month",
//! "Karfreitag", "täglich, 10 mal", "3 Wochen an, 1 aus", "bis 30.11.". Everything `describe` writes reads back. Text
//! that names no days at all only changes the pause or end of the current rule.
use chrono::{Datelike, NaiveDate};
use super::*;

#[derive(Debug, PartialEq, Eq)]
pub struct Parsed {
    pub rule: Rule,
    /// Words that meant nothing here (shown, so a typo is noticed).
    pub unknown: Vec<String>,
}

pub(crate) fn number_word(word: &str) -> Option<u32> {
    Some(match word {
        "ein" | "eins" | "eine" | "einen" | "einem" | "einer" | "one" | "a" => 1, "zwei" | "two" => 2, "drei" | "three" => 3,
        "vier" | "four" => 4, "fünf" | "fuenf" | "five" => 5, "sechs" | "six" => 6, "sieben" | "seven" => 7, "acht" | "eight" => 8,
        "neun" | "nine" => 9, "zehn" | "ten" => 10, "elf" | "eleven" => 11, "zwölf" | "zwoelf" | "twelve" => 12,
        _ => return None,
    })
}
fn ordinal_word(word: &str) -> Option<i32> {
    Some(match word {
        "erste" | "ersten" | "erster" | "erstes" | "first" => 1, "zweite" | "zweiten" | "zweiter" | "zweites" | "second" | "other" => 2,
        "dritte" | "dritten" | "dritter" | "drittes" | "third" => 3, "vierte" | "vierten" | "vierter" | "fourth" => 4,
        "fünfte" | "fünften" | "fifth" => 5, "letzte" | "letzten" | "letzter" | "letztes" | "last" => -1,
        _ => return None,
    })
}
/// 0 = Monday … 6 = Sunday.
pub(crate) fn weekday_word(word: &str) -> Option<u8> {
    Some(match word {
        "montag" | "montags" | "mo" | "mon" | "monday" | "mondays" => 0,
        "dienstag" | "dienstags" | "di" | "tue" | "tues" | "tuesday" | "tuesdays" => 1,
        "mittwoch" | "mittwochs" | "mi" | "wed" | "weds" | "wednesday" | "wednesdays" => 2,
        "donnerstag" | "donnerstags" | "do" | "thu" | "thur" | "thurs" | "thursday" | "thursdays" => 3,
        "freitag" | "freitags" | "fr" | "fri" | "friday" | "fridays" => 4,
        "samstag" | "samstags" | "sonnabend" | "sonnabends" | "sa" | "sam" | "sat" | "saturday" | "saturdays" => 5,
        "sonntag" | "sonntags" | "so" | "sun" | "sunday" | "sundays" => 6,
        _ => return None,
    })
}
/// 1 = January.
pub(crate) fn month_word(word: &str) -> Option<u8> {
    Some(match word {
        "januar" | "jänner" | "jan" | "january" => 1, "februar" | "feb" | "february" => 2, "märz" | "maerz" | "mär" | "mrz" | "mar" | "march" => 3,
        "april" | "apr" => 4, "mai" | "may" => 5, "juni" | "jun" | "june" => 6, "juli" | "jul" | "july" => 7, "august" | "aug" => 8,
        "september" | "sep" | "sept" => 9, "oktober" | "okt" | "oct" | "october" => 10, "november" | "nov" => 11, "dezember" | "dez" | "dec" | "december" => 12,
        _ => return None,
    })
}
pub(crate) fn unit_word(word: &str) -> Option<Unit> {
    Some(match word {
        "tag" | "tage" | "tagn" | "tagen" | "day" | "days" => Unit::Day,
        "woche" | "wochen" | "week" | "weeks" => Unit::Week,
        "monat" | "monate" | "monatn" | "monaten" | "month" | "months" => Unit::Month,
        "jahr" | "jahre" | "jahrn" | "jahren" | "year" | "years" => Unit::Year,
        _ => return None,
    })
}
/// Days from Easter Sunday; also names of two words ("good friday").
fn easter_word(word: &str) -> Option<i64> {
    let word = word.replace(' ', "");
    Some(match word.as_str() {
        "rosenmontag" => -48, "fastnacht" | "faschingsdienstag" | "shrovetuesday" => -47, "aschermittwoch" | "ashwednesday" => -46,
        "gründonnerstag" | "maundythursday" => -3, "karfreitag" | "goodfriday" => -2, "ostersonntag" | "ostern" | "eastersunday" | "easter" => 0,
        "ostermontag" | "eastermonday" => 1, "christihimmelfahrt" | "himmelfahrt" | "ascension" | "ascensionday" => 39,
        "pfingstsonntag" | "pfingsten" | "pentecost" | "whitsunday" => 49, "pfingstmontag" | "whitmonday" => 50, "fronleichnam" | "corpuschristi" => 60,
        _ => return None,
    })
}
fn adverb_word(word: &str) -> Option<(Unit, u32)> {
    Some(match word {
        "täglich" | "daily" => (Unit::Day, 1), "wöchentlich" | "weekly" => (Unit::Week, 1), "monatlich" | "monthly" => (Unit::Month, 1),
        "jährlich" | "yearly" | "annually" | "annual" => (Unit::Year, 1), "zweiwöchentlich" | "vierzehntägig" | "biweekly" | "fortnightly" => (Unit::Week, 2),
        "halbjährlich" => (Unit::Month, 6), "quartalsweise" | "vierteljährlich" | "quarterly" => (Unit::Month, 3),
        "geburtstag" | "birthday" | "jahrestag" | "anniversary" => (Unit::Year, 1),
        _ => return None,
    })
}
/// Words that only join the others.
pub(crate) fn is_filler(word: &str) -> bool {
    matches!(word, "am" | "an" | "den" | "dem" | "der" | "die" | "das" | "des" | "im" | "in" | "um" | "und" | "sowie" | "oder" | "immer" | "jeweils" | "je"
        | "jeden" | "jede" | "jedes" | "jeder" | "alle" | "allen" | "wiederholen" | "wiederholt" | "wiederholung" | "on" | "the" | "of" | "every" | "each"
        | "and" | "or" | "at" | "repeat" | "repeats" | "repeating" | "monats" | "month" | "monat" | "mal" | "x" | "times" | "zum" | "zur" | "to" | "einmal"
        | "once" | "a" | "nur" | "only" | "von" | "vom" | "from" | "during" | "zwischen" | "between" | "pause" | "pausen" | "pausiere" | "pausieren")
}

fn digits(word: &str) -> bool { !word.is_empty() && word.bytes().all(|b| b.is_ascii_digit()) }
/// The number at the start of a word ("15." → 15, "3rd" → 3).
fn leading_number(word: &str) -> Option<u32> {
    let end = word.bytes().take_while(u8::is_ascii_digit).count();
    word[..end].parse().ok()
}
/// "15.", "3rd", "1st" …
fn is_numbered(word: &str, max_digits: usize, suffix_needed: bool) -> bool {
    let end = word.bytes().take_while(u8::is_ascii_digit).count();
    if end == 0 || end > max_digits { return false; }
    match &word[end..] { "" => !suffix_needed, "." | "st" | "nd" | "rd" | "th" => true, _ => false }
}
fn amount(word: Option<&str>) -> Option<u32> {
    let word = word?;
    if digits(word) { word.parse().ok() } else { number_word(word) }
}
fn ordinal(word: Option<&str>) -> Option<i32> {
    let word = word?;
    if is_numbered(word, usize::MAX, true) { leading_number(word).map(|n| n as i32) } else { ordinal_word(word) }
}

/// The words: "12.3.", "12.03.2027", "15.", "3rd", "10" kept whole, "mo-fr" as "mo bis fr", "+" and "-" alone.
pub(crate) fn words(text: &str) -> Vec<String> {
    let text: Vec<char> = text.to_lowercase().replace('×', "x").replace(['–', '—'], "-").chars().collect();
    let letter = |c: char| c.is_ascii_lowercase() || matches!(c, 'ä' | 'ö' | 'ü' | 'ß');
    let digit = |c: char| c.is_ascii_digit();
    let take_digits = |from: usize| { let mut i = from; while i < text.len() && digit(text[i]) { i += 1; } i };
    let mut words = Vec::new();
    let mut i = 0;
    while i < text.len() {
        let c = text[i];
        if digit(c) {
            let end = take_digits(i);
            let run: String = text[i..end].iter().collect();
            // "12.3." and "12.03.2027"
            if end - i <= 2 && text.get(end) == Some(&'.') {
                let month_end = take_digits(end + 1);
                if month_end > end + 1 && month_end - end - 1 <= 2 && text.get(month_end) == Some(&'.') {
                    let year_end = take_digits(month_end + 1);
                    let year_end = if year_end - month_end - 1 >= 2 { (month_end + 1 + 4).min(year_end) } else { month_end + 1 };
                    words.push(text[i..year_end].iter().collect());
                    i = year_end;
                    continue;
                }
            }
            let rest: String = text[end..text.len().min(end + 6)].iter().collect();
            if rest.starts_with('.') { words.push(format!("{run}.")); i = end + 1; continue; }
            if let Some(suffix) = ["st", "nd", "rd", "th"].iter().find(|suffix| rest.starts_with(**suffix)) { words.push(format!("{run}{suffix}")); i = end + 2; continue; }
            if rest.starts_with("-tägig") { words.push(format!("{run}-tägig")); i = end + 6; continue; }
            words.push(run);
            i = end;
        } else if letter(c) {
            let mut end = i;
            while end < text.len() && letter(text[end]) { end += 1; }
            words.push(text[i..end].iter().collect());
            // "mo-fr" → "mo bis fr"
            if text.get(end) == Some(&'-') && text.get(end + 1).is_some_and(|c| letter(*c)) { words.push("bis".into()); end += 1; }
            i = end;
        } else {
            if c == '+' || c == '-' { words.push(c.to_string()); }
            i += 1;
        }
    }
    words
}

fn first_from(from: NaiveDate, days: i64, test: impl Fn(NaiveDate) -> bool) -> Option<NaiveDate> {
    (0..days).map(|step| shift(from, step)).find(|day| test(*day))
}
/// A day and month (and maybe year) as the next such date from `from` on.
pub(crate) fn date_from(from: NaiveDate, day: u32, month: u32, year: Option<i32>) -> Option<NaiveDate> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) { return None; }
    if let Some(year) = year {
        let full = if year < 100 { 2000 + year } else { year };
        return (day <= days_in(full, month)).then(|| date(full, month, day));
    }
    (from.year()..from.year() + 5).find_map(|year| (day <= days_in(year, month) && date(year, month, day) >= from).then(|| date(year, month, day)))
}
fn add_months(day: NaiveDate, months: i32) -> NaiveDate {
    let index = day.month0() as i32 + months;
    let (year, month) = (day.year() + index.div_euclid(12), index.rem_euclid(12) as u32 + 1);
    date(year, month, day.day().min(days_in(year, month)))
}
/// The first `nth` (or last: -1) `weekday` of a month from `from` on – of `month` only when given.
fn position_from(from: NaiveDate, nth: i32, weekday: u8, month: Option<u8>) -> NaiveDate {
    let fits = |day: NaiveDate| weekday_of(day) == weekday && month.is_none_or(|month| day.month() == month as u32)
        && if nth == -1 { is_last_weekday(day) } else { weekday_index(day) == nth as u32 };
    first_from(from, if month.is_none() { 400 } else { 3 * 366 }, fits).unwrap_or(from)
}

pub fn parse(text: &str, current: &Rule) -> Option<Parsed> {
    let words = words(text);
    let word_at = |index: usize| words.get(index).map(String::as_str);
    let mut used = vec![false; words.len()];
    let start = current.start;

    let mut unit: Option<Unit> = None;
    let mut every: Option<u32> = None;
    let mut on: Option<On> = None;
    let mut rule_start: Option<NaiveDate> = None;
    let mut explicit_start: Option<NaiveDate> = None;
    let mut weekdays: Vec<u8> = Vec::new();
    let mut pause: Option<(u32, u32, Option<PauseUnit>)> = None;
    // Some(None): "für immer", no end.
    let mut end: Option<Option<End>> = None;
    let mut year_month: Option<u8> = None;
    let mut months: Vec<u8> = Vec::new();

    let read_date = |i: usize| -> Option<(NaiveDate, u8, usize)> {
        let word = word_at(i)?;
        let (next, after) = (word_at(i + 1), word_at(i + 2));
        let parts: Vec<&str> = word.split('.').collect();
        if parts.len() >= 3 && parts.len() <= 3 && digits(parts[0]) && digits(parts[1]) && parts[0].len() <= 2 && parts[1].len() <= 2 && (parts[2].is_empty() || digits(parts[2])) {
            let year = (!parts[2].is_empty()).then(|| parts[2].parse::<i32>().unwrap());
            let month: u32 = parts[1].parse().unwrap();
            return date_from(start, parts[0].parse().unwrap(), month, year).map(|value| (value, month as u8, i + 1));
        }
        let year_at = |index: usize| word_at(index).filter(|word| word.len() == 4 && digits(word)).map(|word| word.parse::<i32>().unwrap());
        if is_numbered(word, 2, false) {
            let skip = usize::from(next == Some("of"));
            if let Some(month) = word_at(i + 1 + skip).and_then(month_word) {
                let year = year_at(i + 2 + skip);
                return date_from(start, leading_number(word)?, month as u32, year).map(|value| (value, month, i + 2 + skip + usize::from(year.is_some())));
            }
        }
        if let (Some(month), Some(next)) = (month_word(word), next) {
            if is_numbered(next, 2, false) {
                let year = after.filter(|after| after.len() == 4 && digits(after)).map(|after| after.parse::<i32>().unwrap());
                return date_from(start, leading_number(next)?, month as u32, year).map(|value| (value, month, i + 2 + usize::from(year.is_some())));
            }
        }
        None
    };

    let mut i = 0;
    while i < words.len() {
        if used[i] { i += 1; continue; }
        let word = words[i].as_str();
        let (next, after) = (word_at(i + 1), word_at(i + 2));
        let mut take = |indices: &[usize]| { for &index in indices { if index < used.len() { used[index] = true; } } };
        let range = |from: usize, to: usize| (from..to.max(from)).collect::<Vec<_>>();

        // The launcher serializes its date anchor inside the editable repetition block.
        if matches!(word, "ab" | "starting" | "start") {
            if let Some((value, _, next_index)) = read_date(i + 1) {
                explicit_start = Some(value); take(&range(i, next_index)); i = next_index; continue;
            }
        }
        // End: "bis 30.11.", "until nov 30", "10 mal", "10x", "für 2 wochen", "für immer".
        if matches!(word, "bis" | "until" | "till" | "through") {
            let mut j = i + 1;
            while word_at(j).is_some_and(|w| matches!(w, "zum" | "to" | "the" | "am" | "on" | "einschließlich")) { j += 1; }
            while word_at(j).and_then(weekday_word).is_some() { j += 1; }
            if let Some((value, _, next_index)) = read_date(j) {
                end = Some(Some(End { count: None, until: Some(value) }));
                take(&[i]); take(&range(i + 1, next_index)); i += 1; continue;
            }
        }
        if (digits(word) || number_word(word).is_some()) && next.is_some_and(|n| matches!(n, "mal" | "x" | "times")) && !after.is_some_and(|a| matches!(a, "im" | "in")) {
            end = Some(Some(End { count: amount(Some(word)), until: None })); take(&[i, i + 1]); i += 1; continue;
        }
        if word.len() > 1 && word.ends_with('x') && digits(&word[..word.len() - 1]) {
            end = Some(Some(End { count: word[..word.len() - 1].parse().ok(), until: None })); take(&[i]); i += 1; continue;
        }
        if matches!(word, "für" | "for") {
            if next.is_some_and(|n| matches!(n, "immer" | "ever")) { end = Some(None); take(&[i, i + 1]); i += 1; continue; }
            if let (Some(count), Some(per)) = (amount(next).filter(|c| *c > 0), after.and_then(unit_word)) {
                let until = match per {
                    Unit::Day => shift(start, count as i64 - 1),
                    Unit::Week => shift(start, count as i64 * 7 - 1),
                    Unit::Month => shift(add_months(start, count as i32), -1),
                    Unit::Year => shift(add_months(start, count as i32 * 12), -1),
                };
                end = Some(Some(End { count: None, until: Some(until) })); take(&[i, i + 1, i + 2]); i += 1; continue;
            }
        }
        if matches!(word, "forever" | "endlos") || (word == "ohne" && next == Some("ende")) || (word == "no" && next == Some("end")) {
            end = Some(None); take(&[i]); if matches!(word, "ohne" | "no") { take(&[i + 1]); } i += 1; continue;
        }
        // Pause: "3 wochen an, 1 woche aus", "3 an 1 aus", "3 weeks on 1 week off".
        if let Some(first) = amount(Some(word)).filter(|n| *n > 0) {
            let unit_at = |index: usize| match word_at(index).and_then(unit_word) { Some(Unit::Day) => Some(PauseUnit::Day), Some(Unit::Week) => Some(PauseUnit::Week), _ => None };
            let mut j = i + 1;
            let mut pause_unit = None;
            if let Some(value) = unit_at(j) { pause_unit = Some(value); j += 1; }
            if word_at(j).is_some_and(|w| matches!(w, "an" | "on")) {
                let mut k = j + 1;
                if let Some(second) = amount(word_at(k)).filter(|n| *n > 0) {
                    k += 1;
                    if let Some(value) = unit_at(k) { pause_unit = pause_unit.or(Some(value)); k += 1; }
                    if word_at(k).is_some_and(|w| matches!(w, "aus" | "off" | "pause")) {
                        pause = Some((first, second, pause_unit));
                        take(&range(i, k + 1)); i += 1; continue;
                    }
                }
            }
        }
        // Easter-based holidays, also of two words.
        {
            let two = next.map(|next| format!("{word} {next}"));
            let two_offset = two.as_deref().and_then(easter_word);
            if let Some(offset) = two_offset.or_else(|| easter_word(word)) {
                let candidates = [start.year(), start.year() + 1].map(|year| shift(easter(year), offset));
                rule_start = Some(candidates.into_iter().find(|day| *day >= start).unwrap_or(candidates[1]));
                unit = Some(Unit::Year); on = Some(On::Easter);
                take(&[i]); if two_offset.is_some() { take(&[i + 1]); }
                i += 1; continue;
            }
        }
        // Weekday positions: "am 2. Dienstag", "letzter Freitag im Monat", "4. Do im Nov", "second sunday of may".
        {
            let nth = ordinal(Some(word));
            let day = next.and_then(weekday_word);
            if let (Some(nth), Some(day)) = (nth, day) {
                if nth == -1 || (1..=4).contains(&nth) {
                    let skippable = |w: &str, des: bool| matches!(w, "im" | "in" | "of" | "the" | "monats" | "month" | "monat") || (des && w == "des");
                    let mut j = i + 2;
                    while word_at(j).is_some_and(|w| skippable(w, true)) { j += 1; }
                    let month = word_at(j).and_then(month_word);
                    if let Some(month) = month { year_month = Some(month); unit = unit.or(Some(Unit::Year)); j += 1; }
                    else { j = i + 2; while word_at(j).is_some_and(|w| skippable(w, false)) { j += 1; } }
                    on = Some(if nth == -1 { On::LastWeekday } else { On::Weekday });
                    rule_start = Some(position_from(start, nth, day, month));
                    take(&range(i, j)); i += 1; continue;
                }
            }
            let month_end_word = matches!(word, "monatsende" | "monatsletzte" | "monatsletzten" | "monatsletzter" | "ultimo");
            if (nth == Some(-1) && next.is_some_and(|n| matches!(n, "tag" | "tage" | "day"))) || month_end_word || (word == "end" && next == Some("of")) {
                let mut j = if word == "end" { i + 2 } else if month_end_word { i + 1 } else { i + 2 };
                while word_at(j).is_some_and(|w| matches!(w, "im" | "in" | "of" | "the" | "des" | "monats" | "month" | "monat")) { j += 1; }
                let month = word_at(j).and_then(month_word);
                if let Some(month) = month { year_month = Some(month); unit = unit.or(Some(Unit::Year)); j += 1; }
                on = Some(On::LastDay);
                let year = start.year();
                rule_start = Some(match month {
                    Some(month) => date_from(start, days_in(year, month as u32), month as u32, None).unwrap_or_else(|| date(year + 1, month as u32, days_in(year + 1, month as u32))),
                    None => date(year, start.month(), days_in(year, start.month())),
                });
                take(&range(i, j)); i += 1; continue;
            }
        }
        // Dates: "12.3.", "12. März", "march 12", "12th of march", and days of the month: "am 15.", "on the 15th".
        if let Some((value, month, next_index)) = read_date(i).filter(|_| !words[..i].iter().any(|word| matches!(word.as_str(), "nur" | "only"))) {
            year_month = Some(month); unit = unit.or(Some(Unit::Year)); on = Some(On::Date); rule_start = Some(value);
            take(&range(i, next_index)); i += 1; continue;
        }
        if is_numbered(word, 2, true) {
            let day = leading_number(word).unwrap_or(0);
            if (1..=31).contains(&day) && next.is_none_or(|n| weekday_word(n).is_none() && unit_word(n).is_none()) {
                on = Some(On::Date);
                rule_start = Some(first_from(start, 400, |d| d.day() == day).unwrap_or(start));
                take(&[i]); i += 1; continue;
            }
        }
        // Intervals and units: "alle 3 wochen", "every 2 days", "jede zweite Woche", "jeden 3. Tag", "täglich" …
        {
            let interval = amount(Some(word)).map(|n| n as i32)
                .or_else(|| (word.ends_with('.') && digits(&word[..word.len() - 1])).then(|| word[..word.len() - 1].parse().unwrap_or(0)))
                .or_else(|| ordinal(Some(word)));
            if let (Some(interval), Some(per)) = (interval.filter(|n| *n > 0), next.and_then(unit_word)) {
                unit = Some(per); every = Some(interval as u32); take(&[i, i + 1]); i += 1; continue;
            }
            if let Some(alone) = unit_word(word) { unit = Some(alone); take(&[i]); i += 1; continue; }
            if let Some((value, count)) = adverb_word(word) { unit = Some(value); every = every.or(Some(count)); take(&[i]); i += 1; continue; }
            if let Some(count) = word.strip_suffix("-tägig").filter(|n| digits(n)).and_then(|n| n.parse::<u32>().ok()) {
                (unit, every) = if count % 7 == 0 { (Some(Unit::Week), Some(count / 7)) } else { (Some(Unit::Day), Some(count)) };
                take(&[i]); i += 1; continue;
            }
        }
        // Months on their own restrict the days: "jeden Mittwoch im März", "täglich von Mai bis September".
        if let Some(month) = month_word(word) {
            let to = if next.is_some_and(|n| matches!(n, "bis" | "to" | "through" | "thru" | "-")) { after.and_then(month_word) } else { None };
            if let Some(to) = to {
                let mut value = month;
                loop { months.push(value); if value == to { break; } value = value % 12 + 1; }
                take(&[i, i + 1, i + 2]); i += 1; continue;
            }
            months.push(month); take(&[i]); i += 1; continue;
        }
        // Weekdays, lists and ranges: "Mo, Mi", "mo-fr", "monday to friday", "werktags", "am Wochenende".
        if let Some(day) = weekday_word(word) {
            // "Mo bis Fr" is a range, "Mo bis Fr 20.11." an end on that Friday.
            let to = if next.is_some_and(|n| matches!(n, "bis" | "to" | "through" | "thru" | "-")) && read_date(i + 3).is_none() { after.and_then(weekday_word) } else { None };
            if let Some(to) = to {
                let mut value = day;
                loop { weekdays.push(value); if value == to { break; } value = (value + 1) % 7; }
                take(&[i, i + 1, i + 2]); i += 1; continue;
            }
            weekdays.push(day); take(&[i]); i += 1; continue;
        }
        if matches!(word, "werktags" | "wochentags" | "werktage" | "werktagen" | "weekdays" | "weekday" | "workdays") { weekdays.extend([0, 1, 2, 3, 4]); take(&[i]); i += 1; continue; }
        if matches!(word, "wochenende" | "wochenenden" | "weekend" | "weekends") { weekdays.extend([5, 6]); take(&[i]); i += 1; continue; }
        i += 1;
    }

    let unknown: Vec<String> = words.iter().enumerate().filter(|(index, word)| !used[*index] && !is_filler(word) && !matches!(word.as_str(), "+" | "-")).map(|(_, word)| word.clone()).collect();
    weekdays.sort_unstable();
    weekdays.dedup();
    let pattern = unit.is_some() || !weekdays.is_empty() || on.is_some();
    let in_these_months = |day: NaiveDate| months.is_empty() || months.contains(&(day.month() as u8));
    if !pattern && pause.is_none() && end.is_none() && months.is_empty() && explicit_start.is_none() { return None; }
    if !pattern {
        // Only the pause, end or months of the rule there is.
        let mut rule = current.clone();
        if let Some(start) = explicit_start { rule.start = start; }
        if let Some((on, off, pause_unit)) = pause {
            rule.pause = Some(Pause { on, off, unit: pause_unit.unwrap_or(if current.unit == Unit::Day { PauseUnit::Day } else { PauseUnit::Week }) });
        }
        if let Some(end) = end { rule.end = end; }
        if !months.is_empty() { rule.months = Some(months.clone()); }
        if !months.is_empty() && !in_these_months(rule.start) {
            let days = rule.weekdays.clone().filter(|days| !days.is_empty()).unwrap_or_else(|| vec![weekday_of(current.start)]);
            let unit = rule.unit;
            rule.start = first_from(rule.start, 400, |day| in_these_months(day) && (unit != Unit::Week || days.contains(&weekday_of(day)))).unwrap_or(rule.start);
        }
        return Some(Parsed { rule: clean(&rule), unknown });
    }
    let mut unit = unit.unwrap_or(if !weekdays.is_empty() { Unit::Week } else if on == Some(On::Easter) || year_month.is_some() { Unit::Year } else { Unit::Month });
    if unit == Unit::Week && weekdays.is_empty() && on.is_some() { unit = Unit::Month; }
    let mut first = explicit_start.or(rule_start).unwrap_or(start);
    if unit == Unit::Week && !weekdays.is_empty() && explicit_start.is_none() {
        first = first_from(first, if months.is_empty() { 7 } else { 400 }, |day| weekdays.contains(&weekday_of(day)) && in_these_months(day)).unwrap_or(start);
    } else if !months.is_empty() && unit != Unit::Year && !in_these_months(first) {
        let from = first;
        first = first_from(from, 400, |day| in_these_months(day) && (unit == Unit::Day || day.day() == from.day())).unwrap_or(from);
    }
    if unit == Unit::Month && on == Some(On::Easter) { unit = Unit::Year; }
    let rule = Rule {
        start: first,
        unit,
        every: every.unwrap_or(1),
        weekdays: (unit == Unit::Week).then(|| if weekdays.is_empty() { vec![weekday_of(first)] } else { weekdays.clone() }),
        on: matches!(unit, Unit::Month | Unit::Year).then(|| on.unwrap_or(On::Date)),
        pause: pause.map(|(on, off, pause_unit)| Pause { on, off, unit: if unit == Unit::Week { PauseUnit::Week } else { pause_unit.unwrap_or(PauseUnit::Day) } }),
        end: end.flatten(),
        months: (!months.is_empty() && unit != Unit::Year).then(|| months.clone()),
    };
    Some(Parsed { rule: clean(&rule), unknown })
}

#[cfg(test)]
mod tests {
    //! The cases of the app's `tests/repeatText.test.mjs`, with the same expectations.
    use super::*;
    use crate::repeat::d;
    const DE: Language = Language::De;

    fn current() -> Rule { Rule { weekdays: Some(vec![4]), ..Rule::new(d("2026-10-30"), Unit::Week, 1) } }
    fn read(text: &str) -> Option<Parsed> { parse(text, &current()) }
    fn says(text: &str) -> String { describe(&read(text).unwrap_or_else(|| panic!("{text}")).rule, DE) }

    #[test]
    fn weekdays_every_n_weeks() {
        let parsed = read("alle 3 Wochen am Montag, Mittwoch").unwrap();
        assert_eq!(parsed.rule, Rule { weekdays: Some(vec![0, 2]), ..Rule::new(d("2026-11-02"), Unit::Week, 3) });
        assert!(parsed.unknown.is_empty());
        for (text, expected) in [
            ("every 3 weeks on monday and wednesday", "Alle 3 Wochen am Mo, Mi"), ("jede zweite Woche dienstags und donnerstags", "Alle 2 Wochen am Di, Do"),
            ("every other week on tue, thu", "Alle 2 Wochen am Di, Do"), ("Mo, Do und Fr alle 4 Wochen", "Alle 4 Wochen am Mo, Do, Fr"),
            ("montags", "Wöchentlich am Mo"), ("mo-fr", "Werktags"), ("monday to friday", "Werktags"), ("werktags", "Werktags"),
            ("weekends", "Wöchentlich am Sa, So"), ("zweiwöchentlich", "Alle 2 Wochen am Fr"), ("biweekly", "Alle 2 Wochen am Fr"),
        ] { assert_eq!(says(text), expected, "{text}"); }
    }

    #[test]
    fn days_months_and_years() {
        for (text, expected) in [
            ("täglich", "Täglich"), ("every day", "Täglich"), ("jeden zweiten Tag", "Alle 2 Tage"), ("every 3rd day", "Alle 3 Tage"),
            ("alle 10 Tage", "Alle 10 Tage"), ("monatlich", "Monatlich am 30."), ("every month on the 15th", "Monatlich am 15."),
            ("alle 3 Monate", "Alle 3 Monate am 30."), ("jährlich", "Jährlich am 30. Okt"), ("every year", "Jährlich am 30. Okt"),
        ] { assert_eq!(says(text), expected, "{text}"); }
        assert_eq!(read("am 15. jeden Monats").unwrap().rule.start, d("2026-11-15"));
    }

    #[test]
    fn birthdays_and_holidays() {
        let parsed = read("jedes Jahr am 12. März").unwrap();
        assert_eq!(parsed.rule, Rule { on: Some(On::Date), ..Rule::new(d("2027-03-12"), Unit::Year, 1) });
        assert!(parsed.unknown.is_empty());
        assert_eq!(read("Geburtstag am 12.3.").unwrap().rule.start, d("2027-03-12"));
        assert_eq!(read("am 31.12.2026").unwrap().rule.start, d("2026-12-31"));
        assert_eq!(read("jeden 2. Dienstag").unwrap().rule.start, d("2026-11-10"));
        assert_eq!(read("4. Donnerstag im November").unwrap().rule.start, d("2026-11-26"));
        assert_eq!(read("Karfreitag").unwrap().rule.start, d("2027-03-26"));
        for (text, expected) in [
            ("birthday on march 12", "Jährlich am 12. Mär"), ("every year on 4 may", "Jährlich am 4. Mai"),
            ("am letzten Freitag im Monat", "Monatlich am letzten Fr"), ("the last friday of the month", "Monatlich am letzten Fr"),
            ("jeden 2. Dienstag", "Monatlich am 2. Di"), ("first monday of every month", "Monatlich am 1. Mo"),
            ("am letzten Tag im Monat", "Monatlich am Monatsende"), ("end of month", "Monatlich am Monatsende"),
            ("4. Donnerstag im November", "Jährlich am 4. Do im Nov"), ("second sunday of may", "Jährlich am 2. So im Mai"),
            ("Karfreitag", "Jährlich · Karfreitag"), ("easter monday", "Jährlich · Ostermontag"), ("Pfingstmontag", "Jährlich · Pfingstmontag"),
        ] { assert_eq!(says(text), expected, "{text}"); }
    }

    #[test]
    fn only_in_some_months() {
        let parsed = read("jeden Mittwoch im März").unwrap();
        assert_eq!(parsed.rule, Rule { weekdays: Some(vec![2]), months: Some(vec![3]), ..Rule::new(d("2027-03-03"), Unit::Week, 1) });
        assert!(parsed.unknown.is_empty());
        for (text, expected) in [
            ("jeden Mittwoch im März", "Wöchentlich am Mi · nur im Mär"), ("täglich von Mai bis September", "Täglich · nur Mai–Sep"),
            ("mondays in june and july", "Wöchentlich am Mo · nur Jun, Jul"), ("every wednesday in march", "Wöchentlich am Mi · nur im Mär"),
            ("nur im Dezember", "Wöchentlich am Fr · nur im Dez"),
        ] { assert_eq!(says(text), expected, "{text}"); }
        assert_eq!(read("nur im Dezember").unwrap().rule.start, d("2026-12-04"));
    }

    #[test]
    fn pauses_and_ends() {
        for (text, expected) in [
            ("montags, 3 Wochen an, 1 Woche aus", "Wöchentlich am Mo · 3 Wochen an, 1 Woche aus"), ("mondays 3 weeks on 1 week off", "Wöchentlich am Mo · 3 Wochen an, 1 Woche aus"),
            ("täglich 5 an 2 aus", "Täglich · 5 Tage an, 2 Tage aus"), ("täglich, 10 mal", "Täglich · 10×"), ("daily 7 times", "Täglich · 7×"),
            ("täglich 10x", "Täglich · 10×"), ("täglich für 2 Wochen", "Täglich · bis Do 12.11."), ("weekly until 30.11.", "Wöchentlich am Fr · bis Mo 30.11."),
            ("wöchentlich bis zum 20. november", "Wöchentlich am Fr · bis Fr 20.11."), ("every monday until dec 21", "Wöchentlich am Mo · bis Mo 21.12."),
            ("10 mal", "Wöchentlich am Fr · 10×"), ("bis 27.11.", "Wöchentlich am Fr · bis Fr 27.11."),
        ] { assert_eq!(says(text), expected, "{text}"); }
    }

    #[test]
    fn what_describe_writes_reads_back() {
        let rules = [
            Rule { weekdays: Some(vec![0, 3, 4]), pause: Some(Pause { on: 3, off: 1, unit: PauseUnit::Week }), end: Some(End { count: Some(10), until: None }), ..Rule::new(d("2026-10-29"), Unit::Week, 4) },
            Rule { weekdays: Some(vec![0, 1, 2, 3, 4]), ..Rule::new(d("2026-11-02"), Unit::Week, 1) },
            Rule { end: Some(End { count: Some(5), until: None }), ..Rule::new(d("2026-10-30"), Unit::Day, 1) },
            Rule { on: Some(On::Date), ..Rule::new(d("2028-02-29"), Unit::Year, 1) },
            Rule { on: Some(On::LastWeekday), ..Rule::new(d("2026-10-30"), Unit::Month, 1) },
            Rule { on: Some(On::Weekday), ..Rule::new(d("2026-11-26"), Unit::Year, 1) },
            Rule { on: Some(On::Easter), ..Rule::new(d("2027-03-26"), Unit::Year, 1) },
            Rule { weekdays: Some(vec![0]), end: Some(End { count: None, until: Some(d("2026-11-20")) }), ..Rule::new(d("2026-11-02"), Unit::Week, 1) },
            Rule { on: Some(On::LastDay), ..Rule::new(d("2026-10-31"), Unit::Month, 2) },
            Rule { on: Some(On::Weekday), ..Rule::new(d("2026-11-10"), Unit::Month, 1) },
            Rule { pause: Some(Pause { on: 21, off: 7, unit: PauseUnit::Day }), ..Rule::new(d("2026-11-04"), Unit::Day, 1) },
            Rule { weekdays: Some(vec![2]), months: Some(vec![3]), ..Rule::new(d("2027-03-03"), Unit::Week, 1) },
            Rule { months: Some(vec![5, 6, 7, 8, 9]), ..Rule::new(d("2027-05-01"), Unit::Day, 1) },
            Rule { weekdays: Some(vec![0]), months: Some(vec![1, 3, 12]), ..Rule::new(d("2027-01-04"), Unit::Week, 2) },
        ];
        for rule in rules {
            let text = describe(&rule, DE);
            let back = parse(&text, &Rule { start: rule.start, ..current() }).unwrap_or_else(|| panic!("{text}"));
            assert_eq!(back, Parsed { rule: clean(&rule), unknown: vec![] }, "{text}");
        }
        assert_eq!(read("alle 2 Wochen am Montag bitte").unwrap().unknown, ["bitte"]);
        assert_eq!(read("hallo welt"), None);
        assert_eq!(read(""), None);
    }

}
