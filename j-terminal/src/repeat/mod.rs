//! Repeating entries, carried over from the Journal app (`src/repeat.ts` in the branch `Windows`). A rule describes
//! which days an entry recurs on, starting with its first day (`start`, always an occurrence). Rules are stored as JSON
//! in the shape the app writes, so either program reads what the other made.
pub mod text;

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use crate::texts::Language;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit { Day, Week, Month, Year }

/// Where in a month an occurrence falls (monthly and yearly): the same date (clamped to the month's last day), the same
/// weekday position ("2nd Tuesday"), the last such weekday, the month's last day, or – yearly – the distance to Easter.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum On { Date, Weekday, LastWeekday, LastDay, Easter }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pause { pub on: u32, pub off: u32, pub unit: PauseUnit }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PauseUnit { Day, Week }

/// After `count` occurrences (the start included) or on `until` (inclusive).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct End {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub until: Option<NaiveDate>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rule {
    pub start: NaiveDate,
    pub unit: Unit,
    /// Every n days, weeks, months or years.
    pub every: u32,
    /// Weekly: the days, 0 = Monday … 6 = Sunday (the start's weekday without).
    #[serde(default, skip_serializing_if = "Option::is_none")] pub weekdays: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub on: Option<On>,
    /// Daily and weekly: `on` periods with occurrences, then `off` without.
    #[serde(default, skip_serializing_if = "Option::is_none")] pub pause: Option<Pause>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub end: Option<End>,
    /// Daily, weekly and monthly: only in these months, 1 = January.
    #[serde(default, skip_serializing_if = "Option::is_none")] pub months: Option<Vec<u8>>,
}

impl Rule {
    pub fn new(start: NaiveDate, unit: Unit, every: u32) -> Self {
        Rule { start, unit, every, weekdays: None, on: None, pause: None, end: None, months: None }
    }
}

pub fn date(year: i32, month: u32, day: u32) -> NaiveDate { NaiveDate::from_ymd_opt(year, month, day).expect("valid date") }
pub fn days_in(year: i32, month: u32) -> u32 {
    let next = if month == 12 { date(year + 1, 1, 1) } else { date(year, month + 1, 1) };
    (next - date(year, month, 1)).num_days() as u32
}
/// 0 = Monday … 6 = Sunday.
pub fn weekday_of(day: NaiveDate) -> u8 { day.weekday().num_days_from_monday() as u8 }
pub fn shift(day: NaiveDate, days: i64) -> NaiveDate { day + Duration::days(days) }
pub fn days_between(from: NaiveDate, to: NaiveDate) -> i64 { (to - from).num_days() }

/// Easter Sunday (Gregorian calendar, anonymous algorithm).
pub fn easter(year: i32) -> NaiveDate {
    let (a, b, c) = (year % 19, year / 100, year % 100);
    let (d, e) = (b / 4, b % 4);
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let (i, k) = (c / 4, c % 4);
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    date(year, month as u32, day as u32)
}
pub fn easter_offset(day: NaiveDate) -> i64 { days_between(easter(day.year()), day) }
/// 1–5: which of its weekday in the month the date is.
pub fn weekday_index(day: NaiveDate) -> u32 { day.day().div_ceil(7) }
/// Whether no later day of the month has the same weekday.
pub fn is_last_weekday(day: NaiveDate) -> bool { day.day() + 7 > days_in(day.year(), day.month()) }

fn weekdays_of(rule: &Rule) -> Vec<u8> {
    let mut days = match &rule.weekdays { Some(days) if !days.is_empty() => days.clone(), _ => vec![weekday_of(rule.start)] };
    days.sort_unstable();
    days.dedup();
    days
}

/// The day in `year`-`month` a monthly or yearly rule falls on, or None when that month has none (a 5th weekday).
fn day_in_month(rule: &Rule, year: i32, month: u32) -> Option<NaiveDate> {
    let last = days_in(year, month);
    let weekday = weekday_of(rule.start) as i64;
    match rule.on.unwrap_or(On::Date) {
        On::LastDay => Some(date(year, month, last)),
        On::LastWeekday => {
            let back = (weekday_of(date(year, month, last)) as i64 - weekday + 7) % 7;
            Some(date(year, month, last - back as u32))
        }
        On::Weekday => {
            let first = 1 + (weekday - weekday_of(date(year, month, 1)) as i64 + 7) % 7;
            let day = first as u32 + 7 * (weekday_index(rule.start) - 1);
            (day <= last).then(|| date(year, month, day))
        }
        _ => Some(date(year, month, rule.start.day().min(last))),
    }
}

/// Candidate days in ascending order, the start first, until `visit` says stop. Pause and end are `occurrences`'.
fn candidates(rule: &Rule, mut visit: impl FnMut(NaiveDate) -> bool) {
    let every = rule.every.max(1) as i64;
    if !visit(rule.start) { return; }
    let mut later = |day: Option<NaiveDate>| match day { Some(day) if day > rule.start => visit(day), _ => true };
    match rule.unit {
        Unit::Day => { for step in 1.. { if !later(Some(shift(rule.start, step * every))) { return; } } }
        Unit::Week => {
            let days = weekdays_of(rule);
            let monday = shift(rule.start, -(weekday_of(rule.start) as i64));
            for week in 0.. {
                for &day in &days { if !later(Some(shift(monday, week * every * 7 + day as i64))) { return; } }
            }
        }
        Unit::Month => {
            for step in 0..100_000i64 {
                let index = rule.start.month0() as i64 + step * every;
                let (year, month) = (rule.start.year() + (index / 12) as i32, (index % 12) as u32 + 1);
                if !later(day_in_month(rule, year, month)) { return; }
            }
        }
        Unit::Year => {
            let offset = easter_offset(rule.start);
            for step in 0..10_000i64 {
                let year = rule.start.year() + (step * every) as i32;
                let day = if rule.on == Some(On::Easter) { Some(shift(easter(year), offset)) } else { day_in_month(rule, year, rule.start.month()) };
                if !later(day) { return; }
            }
        }
    }
}

fn months_of(rule: &Rule) -> Option<Vec<u8>> {
    let months = rule.months.as_ref()?;
    if rule.unit == Unit::Year || months.is_empty() || months.len() >= 12 { return None; }
    let mut months = months.clone();
    months.sort_unstable();
    months.dedup();
    Some(months)
}
/// Whether the date lies in one of the rule's months (always without a restriction).
pub fn in_months(rule: &Rule, day: NaiveDate) -> bool { months_of(rule).is_none_or(|months| months.contains(&(day.month() as u8))) }

fn pause_of(rule: &Rule) -> Option<Pause> {
    matches!(rule.unit, Unit::Day | Unit::Week).then_some(rule.pause).flatten().filter(|pause| pause.on > 0 && pause.off > 0)
}
/// With a pause: whether the date lies in an "on" period.
fn in_active_period(rule: &Rule, day: NaiveDate) -> bool {
    let Some(pause) = pause_of(rule) else { return true };
    let size = if pause.unit == PauseUnit::Week { 7 } else { 1 };
    let origin = if rule.unit == Unit::Week { shift(rule.start, -(weekday_of(rule.start) as i64)) } else { rule.start };
    (days_between(origin, day) / size) % ((pause.on + pause.off) as i64) < (pause.on as i64)
}

/// The occurrences from `from` to `to` (inclusive), at most `limit` of them.
pub fn occurrences(rule: &Rule, from: NaiveDate, to: NaiveDate, limit: usize) -> Vec<NaiveDate> {
    let mut result = Vec::new();
    let until = rule.end.and_then(|end| end.until);
    let count = rule.end.and_then(|end| end.count).filter(|count| *count > 0);
    let mut counted = 0;
    candidates(rule, |day| {
        if day > to || until.is_some_and(|until| day > until) || result.len() >= limit { return false; }
        if day != rule.start && (!in_active_period(rule, day) || !in_months(rule, day)) { return true; }
        counted += 1;
        if count.is_some_and(|count| counted > count) { return false; }
        if day >= from { result.push(day); }
        true
    });
    result
}

#[cfg(test)]
/// The date of the last occurrence a rule can have, or None when it is open-ended.
pub fn last_occurrence(rule: &Rule) -> Option<NaiveDate> {
    let end = rule.end?;
    if let Some(until) = end.until { return Some(occurrences(rule, rule.start, until, 5000).last().copied().unwrap_or(rule.start)); }
    let count = end.count.filter(|count| *count > 0)?;
    Some(occurrences(rule, rule.start, NaiveDate::MAX, count as usize).last().copied().unwrap_or(rule.start))
}

/// A rule as it is stored: only what applies to its unit.
pub fn clean(rule: &Rule) -> Rule {
    Rule {
        start: rule.start,
        unit: rule.unit,
        every: rule.every.max(1),
        weekdays: (rule.unit == Unit::Week).then(|| weekdays_of(rule)),
        on: matches!(rule.unit, Unit::Month | Unit::Year).then(|| rule.on.unwrap_or(On::Date)),
        pause: pause_of(rule),
        end: rule.end.and_then(|end| match end {
            End { count: Some(count), .. } if count > 0 => Some(End { count: Some(count), until: None }),
            End { until: Some(until), .. } => Some(End { count: None, until: Some(until) }),
            _ => None,
        }),
        months: months_of(rule),
    }
}
/// Whether two rules give the same occurrences the same way.

#[cfg(test)]
pub fn same(a: &Rule, b: &Rule) -> bool { clean(a) == clean(b) }
/// The monthly/yearly positions a start date offers: same date, nth weekday (not a 5th), last weekday, last day, Easter.
pub fn on_choices(start: NaiveDate, unit: Unit) -> Vec<On> {
    let mut choices = vec![On::Date];
    if weekday_index(start) <= 4 { choices.push(On::Weekday); }
    if is_last_weekday(start) { choices.push(On::LastWeekday); }
    if start.day() == days_in(start.year(), start.month()) { choices.push(On::LastDay); }
    if unit == Unit::Year && easter_offset(start).abs() <= 70 { choices.push(On::Easter); }
    choices
}
/// A rule started on another day keeps its pattern where it can and fits the rest: a single weekday follows the start's,
/// a position the new date does not offer becomes the nearest one it does.
pub fn with_start(rule: &Rule, start: NaiveDate) -> Rule {
    let mut next = Rule { start, ..rule.clone() };
    if let Some(days) = &rule.weekdays {
        if days.len() == 1 && days[0] == weekday_of(rule.start) { next.weekdays = Some(vec![weekday_of(start)]); }
    }
    let offered = on_choices(start, next.unit);
    if let Some(on) = next.on {
        if !offered.contains(&on) { next.on = Some(if on != On::LastWeekday && offered.contains(&On::LastWeekday) { On::LastWeekday } else { On::Date }); }
    }
    if let Some(End { until: Some(until), .. }) = next.end { if until < start { next.end = Some(End { count: None, until: Some(start) }); } }
    next
}

/// Occurrences are created ahead up to the end of the year after next, or to the end of the start's year when later.
pub fn series_horizon(today: NaiveDate, start: NaiveDate) -> NaiveDate {
    date(today.year() + 2, 12, 31).max(date(start.year(), 12, 31))
}

// ----- Words -----

pub fn weekday_short(language: Language) -> [&'static str; 7] {
    match language { Language::En => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], Language::De => ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] }
}
pub fn month_short(language: Language) -> [&'static str; 12] {
    match language {
        Language::En => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        Language::De => ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    }
}
pub fn unit_names(unit: Unit, language: Language) -> [&'static str; 2] {
    match (language, unit) {
        (Language::En, Unit::Day) => ["day", "days"], (Language::En, Unit::Week) => ["week", "weeks"],
        (Language::En, Unit::Month) => ["month", "months"], (Language::En, Unit::Year) => ["year", "years"],
        (Language::De, Unit::Day) => ["Tag", "Tage"], (Language::De, Unit::Week) => ["Woche", "Wochen"],
        (Language::De, Unit::Month) => ["Monat", "Monate"], (Language::De, Unit::Year) => ["Jahr", "Jahre"],
    }
}
const EASTER_NAMES: [(i64, &str, &str); 11] = [
    (-48, "Rosenmontag", "Rose Monday"), (-47, "Fastnacht", "Shrove Tuesday"), (-46, "Aschermittwoch", "Ash Wednesday"),
    (-3, "Gründonnerstag", "Maundy Thursday"), (-2, "Karfreitag", "Good Friday"), (0, "Ostersonntag", "Easter Sunday"),
    (1, "Ostermontag", "Easter Monday"), (39, "Christi Himmelfahrt", "Ascension Day"), (49, "Pfingstsonntag", "Pentecost"),
    (50, "Pfingstmontag", "Whit Monday"), (60, "Fronleichnam", "Corpus Christi"),
];
pub fn easter_name(offset: i64, language: Language) -> String {
    match EASTER_NAMES.iter().find(|(value, ..)| *value == offset) {
        Some((_, de, en)) => if language == Language::En { en } else { de }.to_string(),
        None => format!("{} {}{}", if language == Language::En { "Easter" } else { "Ostern" }, if offset > 0 { '+' } else { '−' }, offset.abs()),
    }
}
/// "Mo 2.11."
pub fn format_occurrence(day: NaiveDate, language: Language) -> String {
    format!("{} {}.{}.", weekday_short(language)[weekday_of(day) as usize], day.day(), day.month())
}

fn ordinal_en(n: u32) -> String {
    let suffix = if (11..=13).contains(&(n % 100)) { "th" } else { match n % 10 { 1 => "st", 2 => "nd", 3 => "rd", _ => "th" } };
    format!("{n}{suffix}")
}
fn english_on(rule: &Rule) -> String {
    let (month, day) = (rule.start.month(), rule.start.day());
    let weekday = weekday_short(Language::En)[weekday_of(rule.start) as usize];
    let in_month = if rule.unit == Unit::Year { format!(" in {}", month_short(Language::En)[month as usize - 1]) } else { String::new() };
    match rule.on.unwrap_or(On::Date) {
        On::Weekday => format!("on {} {weekday}{in_month}", ordinal_en(weekday_index(rule.start))),
        On::LastWeekday => format!("on last {weekday}{in_month}"),
        On::LastDay => format!("on last day of the month{in_month}"),
        On::Easter => format!("· {}", easter_name(easter_offset(rule.start), Language::En)),
        On::Date => if rule.unit == Unit::Year { format!("on {day} {}", month_short(Language::En)[month as usize - 1]) } else { format!("on {}", ordinal_en(day)) },
    }
}
/// "am 30." / "am 2. Di" / "am letzten Fr" / "am Monatsende" – yearly in the start's month ("am 2. So im Mai").
fn german_on(rule: &Rule) -> String {
    let (month, day) = (rule.start.month(), rule.start.day());
    let weekday = weekday_short(Language::De)[weekday_of(rule.start) as usize];
    let in_month = if rule.unit == Unit::Year { format!(" im {}", month_short(Language::De)[month as usize - 1]) } else { String::new() };
    match rule.on.unwrap_or(On::Date) {
        On::Weekday => format!("am {}. {weekday}{in_month}", weekday_index(rule.start)),
        On::LastWeekday => format!("am letzten {weekday}{in_month}"),
        On::LastDay => format!("am Monatsende{in_month}"),
        On::Easter => format!("· {}", easter_name(easter_offset(rule.start), Language::De)),
        On::Date => if rule.unit == Unit::Year { format!("am {day}. {}", month_short(Language::De)[month as usize - 1]) } else { format!("am {day}.") },
    }
}

/// Compact choice labels from Journal's RepeatPanel (onLabel).
pub fn on_label(rule: &Rule, on: On, language: Language) -> String {
    let weekday = weekday_short(language)[weekday_of(rule.start) as usize];
    if language == Language::En {
        return match on { On::Weekday => format!("{} {weekday}", ordinal_en(weekday_index(rule.start))), On::LastWeekday => format!("last {weekday}"), On::LastDay => "month end".into(), On::Easter => easter_name(easter_offset(rule.start), language).into(), On::Date => if rule.unit == Unit::Year { format!("{} {}", rule.start.day(), month_short(language)[rule.start.month() as usize - 1]) } else { ordinal_en(rule.start.day()) } };
    }
    match on { On::Weekday => format!("{}. {weekday}", weekday_index(rule.start)), On::LastWeekday => format!("letzter {weekday}"), On::LastDay => "Monatsende".into(), On::Easter => easter_name(easter_offset(rule.start), language).into(), On::Date => if rule.unit == Unit::Year { format!("{}. {}", rule.start.day(), month_short(language)[rule.start.month() as usize - 1]) } else { format!("{}.", rule.start.day()) } }
}

/// Which days, as a short phrase: "Alle 4 Wochen am Mo, Do, Fr", "Werktags", "Jährlich am 12. Mär".
pub fn describe_pattern(rule: &Rule, language: Language) -> String {
    let every = rule.every.max(1);
    let en = language == Language::En;
    let lead = if every == 1 {
        match (en, rule.unit) {
            (true, Unit::Day) => "Daily", (true, Unit::Week) => "Weekly", (true, Unit::Month) => "Monthly", (true, Unit::Year) => "Yearly",
            (false, Unit::Day) => "Täglich", (false, Unit::Week) => "Wöchentlich", (false, Unit::Month) => "Monatlich", (false, Unit::Year) => "Jährlich",
        }.to_string()
    } else {
        format!("{} {every} {}", if en { "Every" } else { "Alle" }, unit_names(rule.unit, language)[1])
    };
    if rule.unit == Unit::Day { return lead; }
    if rule.unit != Unit::Week { return format!("{lead} {}", if en { english_on(rule) } else { german_on(rule) }); }
    let days = weekdays_of(rule);
    if days == [0, 1, 2, 3, 4] { return if every == 1 { if en { "Weekdays" } else { "Werktags" }.into() } else { format!("{lead} {}", if en { "on weekdays" } else { "werktags" }) }; }
    if days.len() == 7 { return if every == 1 { if en { "Daily" } else { "Täglich" }.into() } else { format!("{lead} {}", if en { "every day" } else { "jeden Tag" }) }; }
    let names: Vec<&str> = days.iter().map(|day| weekday_short(language)[*day as usize]).collect();
    format!("{lead} {} {}", if en { "on" } else { "am" }, names.join(", "))
}
/// "Mär", "Mär, Jun", "Mär–Mai" (runs of three and more as a range).
pub fn describe_months(months: &[u8], language: Language) -> String {
    let names = month_short(language);
    let mut parts = Vec::new();
    let mut index = 0;
    while index < months.len() {
        let mut end = index;
        while end + 1 < months.len() && months[end + 1] == months[end] + 1 { end += 1; }
        if end - index >= 2 { parts.push(format!("{}–{}", names[months[index] as usize - 1], names[months[end] as usize - 1])); }
        else { for value in &months[index..=end] { parts.push(names[*value as usize - 1].to_string()); } }
        index = end + 1;
    }
    parts.join(", ")
}
/// The whole rule: "Alle 4 Wochen am Mo, Do, Fr · nur im Mär · 3 Wochen an, 1 Woche aus · 10×".
pub fn describe(rule: &Rule, language: Language) -> String {
    let en = language == Language::En;
    let mut text = describe_pattern(rule, language);
    if let Some(months) = months_of(rule) {
        let names = describe_months(&months, language);
        if en { text += &format!(" · only in {names}"); } else { text += &format!(" · nur {}{names}", if months.len() == 1 { "im " } else { "" }); }
    }
    if let Some(pause) = pause_of(rule) {
        let unit = if pause.unit == PauseUnit::Week { Unit::Week } else { Unit::Day };
        let periods = |count: u32| format!("{count} {}", unit_names(unit, language)[if count == 1 { 0 } else { 1 }]);
        if en { text += &format!(" · {} on, {} off", periods(pause.on), periods(pause.off)); }
        else { text += &format!(" · {} an, {} aus", periods(pause.on), periods(pause.off)); }
    }
    match clean(rule).end {
        Some(End { count: Some(count), .. }) => text += &if en { format!(" · {count} times") } else { format!(" · {count}×") },
        Some(End { until: Some(until), .. }) => text += &format!(" · {} {}", if en { "until" } else { "bis" }, format_occurrence(until, language)),
        _ => {}
    }
    text
}

#[cfg(test)]
pub(crate) fn d(text: &str) -> NaiveDate { NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap() }

#[cfg(test)]
mod tests {
    //! The cases of the app's `tests/repeat.test.mjs`, with the same expectations.
    use super::*;
    const DE: Language = Language::De;

    fn weekly(start: &str, weekdays: &[u8]) -> Rule { Rule { weekdays: Some(weekdays.to_vec()), ..Rule::new(d(start), Unit::Week, 1) } }
    fn until(rule: &Rule, to: &str) -> Vec<String> { occurrences(rule, rule.start, d(to), 5000).iter().map(|day| day.to_string()).collect() }

    #[test]
    fn weekly_on_chosen_weekdays_every_nth_week() {
        let rule = Rule { every: 4, ..weekly("2026-10-29", &[0, 3, 4]) };
        assert_eq!(until(&rule, "2026-12-31"), ["2026-10-29", "2026-10-30", "2026-11-23", "2026-11-26", "2026-11-27", "2026-12-21", "2026-12-24", "2026-12-25"]);
        assert_eq!(describe(&rule, DE), "Alle 4 Wochen am Mo, Do, Fr");
        assert_eq!(describe(&weekly("2026-11-02", &[0, 1, 2, 3, 4]), DE), "Werktags");
        assert_eq!(describe(&rule, Language::En), "Every 4 weeks on Mon, Thu, Fri");
    }

    #[test]
    fn daily_for_n_days_or_until_a_date() {
        let rule = Rule { end: Some(End { count: Some(5), until: None }), ..Rule::new(d("2026-10-30"), Unit::Day, 1) };
        assert_eq!(until(&rule, "2026-12-31"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
        assert_eq!(last_occurrence(&rule), Some(d("2026-11-03")));
        assert_eq!(describe(&rule, DE), "Täglich · 5×");
        let monday = Rule { end: Some(End { count: None, until: Some(d("2026-11-20")) }), ..weekly("2026-11-02", &[0]) };
        assert_eq!(until(&monday, "2026-12-31"), ["2026-11-02", "2026-11-09", "2026-11-16"]);
        assert_eq!(describe(&monday, DE), "Wöchentlich am Mo · bis Fr 20.11.");
        assert_eq!(last_occurrence(&weekly("2026-11-02", &[0])), None);
    }

    #[test]
    fn pauses_three_weeks_on_one_off() {
        let rule = Rule { pause: Some(Pause { on: 3, off: 1, unit: PauseUnit::Week }), ..weekly("2026-11-02", &[0]) };
        assert_eq!(until(&rule, "2026-12-31"), ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-28"]);
        assert_eq!(describe(&rule, DE), "Wöchentlich am Mo · 3 Wochen an, 1 Woche aus");
        let days = Rule { pause: Some(Pause { on: 21, off: 7, unit: PauseUnit::Day }), ..Rule::new(d("2026-11-04"), Unit::Day, 1) };
        let weeks = Rule { pause: Some(Pause { on: 3, off: 1, unit: PauseUnit::Week }), ..days.clone() };
        assert_eq!(occurrences(&days, d("2026-11-24"), d("2026-12-02"), 50), [d("2026-11-24"), d("2026-12-02")]);
        assert_eq!(occurrences(&weeks, d("2026-11-24"), d("2026-12-02"), 50), [d("2026-11-24"), d("2026-12-02")]);
        let monthly = Rule::new(d("2026-11-02"), Unit::Month, 1);
        assert!(same(&Rule { pause: Some(Pause { on: 3, off: 1, unit: PauseUnit::Week }), ..monthly.clone() }, &monthly));
    }

    #[test]
    fn only_in_some_months() {
        let rule = Rule { months: Some(vec![3]), ..weekly("2027-03-03", &[2]) };
        assert_eq!(until(&rule, "2028-03-31"), ["2027-03-03", "2027-03-10", "2027-03-17", "2027-03-24", "2027-03-31", "2028-03-01", "2028-03-08", "2028-03-15", "2028-03-22", "2028-03-29"]);
        assert_eq!(describe(&rule, DE), "Wöchentlich am Mi · nur im Mär");
        assert!(!same(&rule, &weekly("2027-03-03", &[2])));
    }

    #[test]
    fn birthdays_on_29_february() {
        let rule = Rule { on: Some(On::Date), ..Rule::new(d("2024-02-29"), Unit::Year, 1) };
        assert_eq!(until(&rule, "2029-12-31"), ["2024-02-29", "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29", "2029-02-28"]);
        assert_eq!(describe(&rule, DE), "Jährlich am 29. Feb");
    }

    #[test]
    fn monthly_by_date_position_last_weekday_and_month_end() {
        assert_eq!(until(&Rule::new(d("2026-01-31"), Unit::Month, 1), "2026-04-30"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
        assert_eq!(until(&Rule { on: Some(On::Weekday), ..Rule::new(d("2026-11-10"), Unit::Month, 1) }, "2027-01-31"), ["2026-11-10", "2026-12-08", "2027-01-12"]);
        let last_friday = Rule { on: Some(On::LastWeekday), ..Rule::new(d("2026-10-30"), Unit::Month, 1) };
        assert_eq!(until(&last_friday, "2026-12-31"), ["2026-10-30", "2026-11-27", "2026-12-25"]);
        assert_eq!(describe(&last_friday, DE), "Monatlich am letzten Fr");
        assert_eq!(until(&Rule { on: Some(On::LastDay), ..Rule::new(d("2026-10-31"), Unit::Month, 1) }, "2027-02-28"), ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
        assert_eq!(on_choices(d("2026-10-31"), Unit::Month), [On::Date, On::LastWeekday, On::LastDay]);
    }

    #[test]
    fn holidays_by_weekday_position_or_easter() {
        assert_eq!([2024, 2025, 2026, 2027, 2028].map(|year| easter(year).to_string()), ["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16"]);
        let thanksgiving = Rule { on: Some(On::Weekday), ..Rule::new(d("2026-11-26"), Unit::Year, 1) };
        assert_eq!(until(&thanksgiving, "2027-12-31"), ["2026-11-26", "2027-11-25"]);
        assert_eq!(describe(&thanksgiving, DE), "Jährlich am 4. Do im Nov");
        let good_friday = Rule { on: Some(On::Easter), ..Rule::new(d("2026-04-03"), Unit::Year, 1) };
        assert!(on_choices(d("2026-04-03"), Unit::Year).contains(&On::Easter));
        assert_eq!(until(&good_friday, "2028-12-31"), ["2026-04-03", "2027-03-26", "2028-04-14"]);
        assert_eq!(easter_name(-2, DE), "Karfreitag");
        assert_eq!(describe(&good_friday, DE), "Jährlich · Karfreitag");
        assert_eq!(describe(&good_friday, Language::En), "Yearly · Good Friday");
    }

    #[test]
    fn a_moved_rule_keeps_its_pattern() {
        assert_eq!(with_start(&weekly("2026-10-29", &[3]), d("2026-10-30")).weekdays, Some(vec![4]));
        assert_eq!(with_start(&weekly("2026-10-29", &[0, 3]), d("2026-10-30")).weekdays, Some(vec![0, 3]));
        let month_end = Rule { on: Some(On::LastDay), ..Rule::new(d("2026-10-31"), Unit::Month, 1) };
        assert_eq!(with_start(&month_end, d("2026-11-15")).on, Some(On::Date));
        assert_eq!(with_start(&month_end, d("2026-11-27")).on, Some(On::LastWeekday));
        assert!(same(&Rule::new(d("2026-10-29"), Unit::Week, 1), &weekly("2026-10-29", &[3])));
        let messy = Rule { weekdays: Some(vec![3]), on: Some(On::Date), ..Rule::new(d("2026-10-29"), Unit::Day, 2) };
        assert_eq!(clean(&messy), Rule::new(d("2026-10-29"), Unit::Day, 2));
        assert_eq!(series_horizon(d("2026-10-30"), d("2026-10-30")), d("2028-12-31"));
        assert_eq!(series_horizon(d("2026-10-30"), d("2030-05-01")), d("2030-12-31"));
    }

    #[test]
    fn stored_like_the_app_stores_it() {
        let rule = Rule { end: Some(End { count: None, until: Some(d("2026-11-20")) }), pause: Some(Pause { on: 3, off: 1, unit: PauseUnit::Week }), ..weekly("2026-11-02", &[0]) };
        let json = serde_json::to_value(clean(&rule)).unwrap();
        assert_eq!(json, serde_json::json!({ "start": "2026-11-02", "unit": "week", "every": 1, "weekdays": [0], "pause": { "on": 3, "off": 1, "unit": "week" }, "end": { "until": "2026-11-20" } }));
        let back: Rule = serde_json::from_value(serde_json::json!({ "start": "2026-10-30", "unit": "month", "every": 1, "on": "last-weekday" })).unwrap();
        assert_eq!(back.on, Some(On::LastWeekday));
    }
}
