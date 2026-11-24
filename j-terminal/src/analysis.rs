//! The analysis (`/Auswertung`): the evaluation of a week, month, quarter or year as the Journal app shows it in its
//! overviews (branch `Windows`: `PeriodNotes.tsx` with `ValueChart.tsx`, `ActivitySummary.tsx`, `ActivityHeatmap.tsx`;
//! the numbers from `periodData.ts`, `periods.ts`, `activityColors.ts` and `activityCalendar.ts`).
//!
//! Everything here is a pure projection of the shared period data and the calendar's activity minutes
//! (`Store::activity_minutes`, the same query the app runs). The chart is laid out in the app's own SVG coordinates
//! (`viewBox 0 0 640 190`, the same paths, ticks and labels), so both programs draw the same graph; the window only
//! scales it. Nothing here writes.
use std::collections::{BTreeMap, BTreeSet, HashMap};
use chrono::{Datelike, NaiveDate};
use crate::board::Period;
use crate::calendar::{parse_color, Rgb};
use crate::day_view::{scale_range, PeriodData};
use crate::texts::{analysis as tx, texts, Language};

/// The app's default colour (`defaultRatingColor`, also its accent).
pub const ACCENT: Rgb = [0x56, 0x9e, 0xff];
/// The chart's SVG width (`ValueChart.tsx`, `viewBox 0 0 640 190`; the labels at y 180 are placed by the view).
pub const VIEW_WIDTH: f64 = 640.0;
const RIGHT: f64 = 14.0;
const TOP: f64 = 14.0;
const BOTTOM: f64 = 158.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode { Week, #[default] Month, Quarter, Year }

impl Mode {
    pub const ALL: [Mode; 4] = [Mode::Week, Mode::Month, Mode::Quarter, Mode::Year];
    pub fn index(self) -> usize { self as usize }
    fn period(self) -> Period { [Period::Week, Period::Month, Period::Quarter, Period::Year][self.index()] }
    /// Quarters and years show months (their averages, their heatmap columns).
    pub fn monthly(self) -> bool { matches!(self, Mode::Quarter | Mode::Year) }
    /// The first and last day (`periodBounds`).
    pub fn bounds(self, date: NaiveDate) -> (NaiveDate, NaiveDate) {
        let period = self.period();
        let start = period.start(date);
        (start, period.step(start, true).pred_opt().unwrap_or(start))
    }
    /// The same place in the period before or after.
    pub fn step(self, date: NaiveDate, forward: bool) -> NaiveDate { self.period().step(date, forward) }
    /// Week → month → quarter → year and round again.
    pub fn cycle(self, forward: bool) -> Mode { Mode::ALL[(self.index() + if forward { 1 } else { 3 }) % 4] }
}

fn at(language: Language) -> usize { usize::from(language == Language::En) }

/// The days from `start` to `end`.
pub fn dates(start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> { start.iter_days().take_while(|day| *day <= end).collect() }

/// "16. Nov." / "16 Nov" (`{ day: 'numeric', month: 'short' }`).
fn day_month(date: NaiveDate, language: Language) -> String {
    let month = tx::MONTHS_WITH_DAY[at(language)][date.month0() as usize];
    match language { Language::De => format!("{}. {month}", date.day()), Language::En => format!("{} {month}", date.day()) }
}

/// "Mo., 7. Sept. 2026" / "Mon, 7 Sept 2026" (`{ weekday, day, month: 'short', year }`).
fn full_date(date: NaiveDate, language: Language) -> String {
    let weekday = tx::WEEKDAYS_IN_DATE[at(language)][date.weekday().num_days_from_monday() as usize];
    format!("{weekday}, {} {}", day_month(date, language), date.year())
}

/// The heading of an overview (`periodTitle`): "16. Nov. – 22. Nov. 2026", "November 2026", "Quartal 4 · 2026", "2026".
pub fn title(date: NaiveDate, mode: Mode, language: Language) -> String {
    let (start, end) = mode.bounds(date);
    match mode {
        Mode::Year => start.year().to_string(),
        Mode::Quarter => format!("{} {} · {}", tx::QUARTER[at(language)], start.month0() / 3 + 1, start.year()),
        Mode::Month => format!("{} {}", texts(language).months[start.month0() as usize], start.year()),
        Mode::Week => format!("{} – {} {}", day_month(start, language), day_month(end, language), end.year()),
    }
}

// ----- Numbers as JavaScript writes them -----

/// `Math.round`: halves go up.
fn js_round(value: f64) -> f64 { (value + 0.5).floor() }
/// `value.toFixed(1)`: from the number's exact decimal expansion, a tie rounding up (away from zero).
fn fixed1(value: f64) -> String {
    if !value.is_finite() { return js_number(value); }
    let exact = format!("{:.80}", value.abs());
    let (whole, fraction) = exact.split_once('.').unwrap_or((&exact, "0"));
    let mut tenths: u128 = whole.parse::<u128>().unwrap_or(0) * 10 + u128::from(fraction.as_bytes()[0] - b'0');
    if fraction.as_bytes().get(1).is_some_and(|digit| *digit >= b'5') { tenths += 1; }
    format!("{}{}.{}", if value < 0.0 { "-" } else { "" }, tenths / 10, tenths % 10)
}
/// `String(value)`.
fn js_number(value: f64) -> String { if value.fract() == 0.0 && value.abs() < 1e15 { format!("{}", value as i64) } else { format!("{value}") } }
/// `ValueChart`'s `format`: whole numbers as they are, else one decimal.
fn format_value(value: f64) -> String { if value.fract() == 0.0 { js_number(value) } else { fixed1(value) } }
/// "45 min", "1 h 30 min", "2 h" (`duration` in `PeriodNotes.tsx` and `ActivitySummary.tsx`).
pub fn duration(minutes: f64) -> String {
    if minutes >= 60.0 {
        let rest = minutes % 60.0;
        let hours = js_number((minutes / 60.0).floor());
        if rest != 0.0 { format!("{hours} h {} min", js_number(rest)) } else { format!("{hours} h") }
    } else {
        format!("{} min", js_number(minutes))
    }
}

// ----- Activities: colours, ranges and levels (activityColors.ts) -----

/// Seven shades of an activity's colour, the lightest first (`activityPalette`).
pub fn palette(color: Rgb) -> [Rgb; 7] {
    [0.64, 0.43, 0.21, 0.0, -0.16, -0.32, -0.48].map(|amount: f64| color.map(|channel| {
        let c = f64::from(channel);
        js_round(if amount >= 0.0 { c + (255.0 - c) * amount } else { c * (1.0 + amount) }).clamp(0.0, 255.0) as u8
    }))
}

/// The minutes the shades run over (`activityRange`): whole minutes in 0–1440, `max` at least six above `min`.
pub fn activity_range(min: Option<f64>, max: Option<f64>) -> (f64, f64) {
    let whole = |value: Option<f64>, fallback: f64| value.filter(|v| v.is_finite()).map_or(fallback, |v| js_round(v).clamp(0.0, 1440.0));
    let (min, max) = (whole(min, 0.0), whole(max, 180.0));
    if max >= min + 6.0 { (min, max) } else { (0.0, 180.0) }
}

/// What a day of an activity holds as shown: typed minutes plus the calendar's.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Record { pub done: bool, pub minutes: Option<f64>, pub text: Option<String> }

fn finite_minutes(record: Option<&Record>) -> f64 { record.and_then(|r| r.minutes).filter(|m| m.is_finite()).map_or(0.0, |m| m.max(0.0)) }

/// 0: nothing done; 1–7: the shade (`activityLevel`).
pub fn level(record: Option<&Record>, track_time: bool, (min, max): (f64, f64)) -> usize {
    let minutes = finite_minutes(record);
    if !record.is_some_and(|r| r.done) && minutes <= 0.0 { return 0; }
    if !track_time { return 1; }
    (((minutes - min) / ((max - min) / 6.0)).floor() + 1.0).clamp(1.0, 7.0) as usize
}

fn valid_color(text: &str) -> Rgb { parse_color(text).unwrap_or(ACCENT) }

/// Black or white on a shade (`ActivityHeatmap`'s lightness test).
fn ink_on(shade: Rgb) -> Rgb {
    let lightness = 0.299 * f64::from(shade[0]) + 0.587 * f64::from(shade[1]) + 0.114 * f64::from(shade[2]);
    if lightness > 145.0 { [0x17, 0x17, 0x17] } else { [0xff, 0xff, 0xff] }
}

/// The calendar's minutes by date and tag (`Store::activity_minutes`).
pub type CalendarMinutes = BTreeMap<String, BTreeMap<String, i64>>;

/// The tags whose calendar time counts for an activity (`useCalendarMinutes`).
pub fn activity_tags(data: &PeriodData) -> Vec<String> {
    let tags: BTreeSet<String> = data.definitions.iter().filter_map(|item| item.calendar_tag_id.clone()).filter(|tag| !tag.is_empty()).collect();
    tags.into_iter().collect()
}

/// The activities' records of the period as shown (`withCalendarMinutes` after `activityMinutesById`).
fn records(data: &PeriodData, calendar: &CalendarMinutes, dates: &[NaiveDate]) -> HashMap<NaiveDate, HashMap<String, Record>> {
    // Shared tags: the last definition wins (a JavaScript Map built in order).
    let by_tag: HashMap<&str, &str> = data.definitions.iter().filter_map(|item| item.calendar_tag_id.as_deref().map(|tag| (tag, item.id.as_str()))).collect();
    let mut result: HashMap<NaiveDate, HashMap<String, Record>> = HashMap::new();
    for date in dates {
        let key = date.to_string();
        let mut items: HashMap<String, Record> = data.days.get(&key).map(|day| day.items.iter()
            .map(|(id, r)| (id.clone(), Record { done: r.done, minutes: r.minutes, text: r.text.clone() })).collect()).unwrap_or_default();
        let mut extra: HashMap<&str, f64> = HashMap::new();
        for (tag, minutes) in calendar.get(&key).into_iter().flatten() {
            if let Some(id) = by_tag.get(tag.as_str()) { if *minutes > 0 { *extra.entry(id).or_default() += *minutes as f64; } }
        }
        for (id, minutes) in extra {
            let record = items.entry(id.to_string()).or_default();
            record.minutes = Some(record.minutes.unwrap_or(0.0) + minutes);
        }
        if !items.is_empty() { result.insert(*date, items); }
    }
    result
}

// ----- The chart (ValueChart.tsx) -----

#[derive(Clone, Debug, PartialEq)]
pub struct Legend { pub key: String, pub label: String, pub stat: String, pub color: Rgb, pub hidden: bool }
#[derive(Clone, Debug, PartialEq)]
pub struct Tick { pub y: f64, pub label: String, pub grid: String }
#[derive(Clone, Debug, PartialEq)]
pub struct Line { pub color: Rgb, pub commands: String }
#[derive(Clone, Debug, PartialEq)]
pub struct Point { pub x: f64, pub y: f64, pub color: Rgb, pub active: bool }
/// A column the mouse can point at: its bucket's first day.
#[derive(Clone, Debug, PartialEq)]
pub struct Column { pub x: f64, pub width: f64, pub date: NaiveDate }
#[derive(Clone, Debug, PartialEq)]
pub struct Label { pub x: f64, pub text: String }

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Chart {
    /// Every line there is; the hidden ones are only listed (they can be turned on again).
    pub legend: Vec<Legend>,
    /// Some line is hidden or there are several to choose from.
    pub filterable: bool,
    /// Where the plot begins (the y labels end before it).
    pub left: f64,
    pub ticks: Vec<Tick>,
    pub lines: Vec<Line>,
    pub points: Vec<Point>,
    pub columns: Vec<Column>,
    pub labels: Vec<Label>,
    /// The dashed guide at the chosen column.
    pub guide: Option<String>,
    /// The chosen column's values, or the hint.
    pub detail: String,
    pub hint: bool,
    /// Every line hidden: the chart says so instead.
    pub empty: bool,
}

struct Series { key: String, label: String, color: Rgb, min: i64, max: i64, values: Vec<Option<f64>> }

/// Days, or with `monthly` the months, with their averages (`ratingBuckets`).
fn buckets(dates: &[NaiveDate], values: &[Option<f64>], monthly: bool) -> Vec<(NaiveDate, Option<f64>)> {
    let mut out: Vec<(NaiveDate, f64, usize)> = Vec::new();
    for (date, value) in dates.iter().zip(values) {
        let same = out.last().is_some_and(|(first, ..)| monthly && first.month() == date.month() && first.year() == date.year());
        if !same { out.push((*date, 0.0, 0)); }
        if let (Some(value), Some(last)) = (value, out.last_mut()) { last.1 += value; last.2 += 1; }
    }
    out.into_iter().map(|(date, sum, count)| (date, (count > 0).then(|| sum / count as f64))).collect()
}

fn dashed(from: (f64, f64), to: (f64, f64), on: f64, off: f64) -> String {
    let length = ((to.0 - from.0).powi(2) + (to.1 - from.1).powi(2)).sqrt();
    if length <= 0.0 { return String::new(); }
    let (dx, dy) = ((to.0 - from.0) / length, (to.1 - from.1) / length);
    let mut out = String::new();
    let mut at = 0.0;
    while at < length {
        let end = (at + on).min(length);
        out.push_str(&format!("M{} {} L{} {} ", fixed1(from.0 + dx * at), fixed1(from.1 + dy * at), fixed1(from.0 + dx * end), fixed1(from.1 + dy * end)));
        at += on + off;
    }
    out.trim_end().to_string()
}

fn chart(data: &PeriodData, dates: &[NaiveDate], mode: Mode, hidden: &BTreeSet<String>, cursor: Option<NaiveDate>, language: Language) -> Chart {
    let l = at(language);
    let monthly = mode.monthly();
    let value_of = |raw: Option<f64>, (min, max): (i64, i64)| raw.filter(|v| v.is_finite()).map(|v| v.clamp(min as f64, max as f64));
    let rating_range = scale_range(data.rating.as_ref().and_then(|r| r.min), data.rating.as_ref().and_then(|r| r.max));
    let mut series = vec![Series {
        key: "rating".into(), label: tx::DAILY_RATING[l].into(),
        color: data.rating.as_ref().map_or(ACCENT, |r| valid_color(&r.color)), min: rating_range.0, max: rating_range.1,
        values: dates.iter().map(|d| value_of(data.days.get(&d.to_string()).and_then(|day| day.rating), rating_range)).collect(),
    }];
    for scale in &data.scales {
        let range = scale_range(scale.min, scale.max);
        let values: Vec<Option<f64>> = dates.iter().map(|d| value_of(data.days.get(&d.to_string()).and_then(|day| day.scales.get(&scale.id).copied()), range)).collect();
        if scale.active == Some(false) && values.iter().all(Option::is_none) { continue; }
        series.push(Series { key: scale.id.clone(), label: if scale.name.is_empty() { tx::UNNAMED[l].into() } else { scale.name.clone() },
            color: valid_color(&scale.color), min: range.0, max: range.1, values });
    }
    let shown: Vec<&Series> = series.iter().filter(|item| !hidden.contains(&item.key)).collect();
    let legend = series.iter().map(|item| {
        let values: Vec<f64> = item.values.iter().flatten().copied().collect();
        let stat = if values.is_empty() { tx::NO_VALUES[l].to_string() } else {
            let average = values.iter().sum::<f64>() / values.len() as f64;
            let days = if values.len() == 1 { tx::ONE_DAY[l].to_string() } else { tx::DAYS_COUNT[l].replace("{0}", &values.len().to_string()) };
            format!("{} · {days}", tx::AVERAGE[l].replace("{0}", &fixed1(average)).replace("{1}", &item.max.to_string()))
        };
        Legend { key: item.key.clone(), label: item.label.clone(), stat, color: item.color, hidden: hidden.contains(&item.key) }
    }).collect();
    // The y axis spans every shown line (`chartRange`; 0–10 without one).
    let (min, max) = if shown.is_empty() { (0, 10) } else { (shown.iter().map(|s| s.min).min().unwrap_or(0), shown.iter().map(|s| s.max).max().unwrap_or(10)) };
    let keys: Vec<NaiveDate> = buckets(dates, &vec![None; dates.len()], monthly).into_iter().map(|(date, _)| date).collect();
    let left = (34.0f64).max(min.to_string().len().max(max.to_string().len()) as f64 * 7.0 + 12.0);
    let step = (VIEW_WIDTH - left - RIGHT) / keys.len().max(1) as f64;
    let x = |index: usize| left + (index as f64 + 0.5) * step;
    let y = |value: f64| BOTTOM - (value - min as f64) / ((max - min).max(1) as f64) * (BOTTOM - TOP);
    let in_bucket = |key: NaiveDate, date: NaiveDate| if monthly { key.year() == date.year() && key.month() == date.month() } else { key == date };
    let active = cursor.and_then(|date| keys.iter().position(|key| in_bucket(*key, date)));
    let label = |key: NaiveDate| if monthly { tx::MONTHS_ALONE[l][key.month0() as usize].to_string() } else { day_month(key, language) };

    let mut ticks: Vec<i64> = Vec::new();
    for value in [min, js_round((min + max) as f64 / 2.0) as i64, max] { if !ticks.contains(&value) { ticks.push(value); } }
    let lines: Vec<(&Series, Vec<Option<f64>>)> = shown.iter().map(|item| (*item, buckets(dates, &item.values, monthly).into_iter().map(|(_, v)| v).collect())).collect();
    let mut chart = Chart {
        legend, filterable: series.len() > 1 || shown.len() < series.len(), left, empty: shown.is_empty(),
        ticks: ticks.iter().map(|value| Tick { y: y(*value as f64), label: value.to_string(), grid: dashed((left, y(*value as f64)), (VIEW_WIDTH - RIGHT, y(*value as f64)), 3.0, 5.0) }).collect(),
        guide: active.map(|index| dashed((x(index), TOP), (x(index), BOTTOM), 2.0, 3.0)),
        ..Chart::default()
    };
    for (item, values) in &lines {
        // The line breaks where a day (or month) has no value; each run of values is a path of its own.
        let mut runs: Vec<Vec<(usize, f64)>> = Vec::new();
        for (index, value) in values.iter().enumerate() {
            match value {
                None => { if runs.last().is_some_and(|run| !run.is_empty()) { runs.push(Vec::new()); } }
                Some(value) => { if runs.is_empty() { runs.push(Vec::new()); } runs.last_mut().unwrap().push((index, *value)); }
            }
        }
        for run in runs.iter().filter(|run| run.len() > 1) {
            let commands = run.iter().enumerate().map(|(i, (index, value))| format!("{}{} {}", if i == 0 { "M" } else { "L" }, fixed1(x(*index)), fixed1(y(*value)))).collect::<Vec<_>>().join(" ");
            chart.lines.push(Line { color: item.color, commands });
        }
        for (index, value) in values.iter().enumerate() {
            if let Some(value) = value { chart.points.push(Point { x: x(index), y: y(*value), color: item.color, active: active == Some(index) }); }
        }
    }
    chart.columns = keys.iter().enumerate().map(|(index, date)| Column { x: left + index as f64 * step, width: step, date: *date }).collect();
    let every = keys.len().div_ceil(7).max(1);
    chart.labels = keys.iter().enumerate().filter(|(index, _)| *index == 0 || *index + 1 == keys.len() || index % every == 0)
        .map(|(index, key)| Label { x: x(index), text: label(*key) }).collect();
    match active {
        Some(index) => {
            let values = lines.iter().map(|(item, values)| format!("{} {}", item.label, values[index].map_or_else(|| "–".into(), format_value))).collect::<Vec<_>>();
            chart.detail = format!("{}: {}", label(keys[index]), if values.is_empty() { tx::NO_LINES[l].to_string() } else { values.join(", ") });
        }
        None => { chart.detail = if monthly { tx::HINT_MONTHLY[l] } else { tx::HINT_DAILY[l] }.into(); chart.hint = true; }
    }
    chart
}

// ----- The activities (ActivitySummary.tsx, ActivityHeatmap.tsx) -----

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CardKind {
    /// A week: one bar per day.
    #[default]
    Bars,
    /// A month: a calendar of its weeks.
    Calendar,
    /// A quarter or year: weeks as columns, weekdays as rows.
    Contributions,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Bar { pub date: NaiveDate, pub value: String, pub fraction: f64, pub label: String, pub active: bool }
/// A day of the heatmap at its place in the grid (0-based column and row, the labels included).
#[derive(Clone, Debug, PartialEq)]
pub struct Cell { pub date: NaiveDate, pub column: usize, pub row: usize, pub level: usize, pub fill: Option<Rgb>, pub text: String, pub ink: Option<Rgb>, pub active: bool }
/// A weekday's or month's label in the grid.
#[derive(Clone, Debug, PartialEq)]
pub struct Head { pub column: usize, pub row: usize, pub text: String }

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Card {
    pub name: String,
    pub color: Rgb,
    /// The time of all days ("3 h 20 min"); none without time tracking.
    pub total: Option<String>,
    /// "12 / 30 Tage".
    pub days: String,
    pub kind: CardKind,
    pub bars: Vec<Bar>,
    pub cells: Vec<Cell>,
    pub heads: Vec<Head>,
    pub columns: usize,
    pub rows: usize,
    /// The chosen day, or the hint (`hint`).
    pub detail: String,
    pub hint: bool,
    pub palette: [Rgb; 7],
    pub track: bool,
    /// Below a week's bars: "Minuten pro Tag" (with time tracking).
    pub unit: String,
}

fn card(definition: &crate::day_view::ActivityDefinition, dates: &[NaiveDate], shown: &HashMap<NaiveDate, HashMap<String, Record>>, mode: Mode, cursor: Option<NaiveDate>, language: Language) -> Card {
    let l = at(language);
    let id = definition.id.as_str();
    let track = definition.track_time != Some(false);
    let color = valid_color(&definition.color);
    let record = |date: &NaiveDate| shown.get(date).and_then(|items| items.get(id));
    let minutes: f64 = dates.iter().map(|d| finite_minutes(record(d))).sum();
    let active_days = dates.iter().filter(|d| record(d).is_some_and(|r| r.done || r.minutes.unwrap_or(0.0) > 0.0)).count();
    let shades = palette(color);
    let range = activity_range(definition.min_minutes, definition.max_minutes);
    let mut out = Card { name: definition.name.clone(), color, total: track.then(|| duration(minutes)), days: format!("{active_days} / {} {}", dates.len(), tx::DAYS[l]),
        palette: shades, track, ..Card::default() };
    let in_range = |date: NaiveDate| dates.first().is_some_and(|first| date >= *first) && dates.last().is_some_and(|last| date <= *last);
    let chosen = cursor.filter(|date| in_range(*date));

    if mode == Mode::Week {
        out.kind = CardKind::Bars;
        let amounts: Vec<(f64, usize)> = dates.iter().map(|d| (record(d).and_then(|r| r.minutes).map_or(0.0, |m| m.max(0.0)), usize::from(record(d).is_some_and(|r| r.done || r.minutes.unwrap_or(0.0) > 0.0)))).collect();
        let most = amounts.iter().map(|(m, days)| if track { *m } else { *days as f64 }).fold(1.0f64, f64::max);
        out.bars = dates.iter().zip(&amounts).map(|(date, (minutes, days))| {
            let amount = if track { *minutes } else { *days as f64 };
            Bar { date: *date, label: tx::WEEKDAYS_ALONE[l][date.weekday().num_days_from_monday() as usize].into(), active: chosen == Some(*date),
                value: if track { if *minutes > 0.0 { js_number(*minutes) } else { "–".into() } } else if *days > 0 { "✓".into() } else { "–".into() },
                fraction: if amount > 0.0 { (amount / most * 100.0).max(8.0) / 100.0 } else { 0.0 } }
        }).collect();
        out.unit = if track { tx::MINUTES_PER_DAY[l].into() } else { String::new() };
        // The app names a bar's day in its tooltip; here the chosen day's line says it.
        if let Some(date) = chosen {
            let r = record(&date);
            let (minutes, days) = (r.and_then(|r| r.minutes).map_or(0.0, |m| m.max(0.0)), usize::from(r.is_some_and(|r| r.done || r.minutes.unwrap_or(0.0) > 0.0)));
            let text = r.and_then(|r| r.text.clone()).filter(|t| !t.is_empty());
            out.detail = format!("{date} · {}{}", if track { duration(minutes) } else { format!("{days} {}", tx::COMPLETED_LOWER[l]) }, text.map(|t| format!(" · {t}")).unwrap_or_default());
        }
        return out;
    }

    let calendar = mode == Mode::Month;
    out.kind = if calendar { CardKind::Calendar } else { CardKind::Contributions };
    let (Some(first), Some(last)) = (dates.first().copied(), dates.last().copied()) else { return out };
    let monday = |date: NaiveDate| date - chrono::Days::new(u64::from(date.weekday().num_days_from_monday()));
    let padded = self::dates(monday(first), monday(last) + chrono::Days::new(6));
    let weeks = padded.len() / 7;
    out.columns = if calendar { 7 } else { weeks + 1 };
    out.rows = if calendar { weeks + 1 } else { 8 };
    for i in 0..7 {
        out.heads.push(Head { column: if calendar { i } else { 0 }, row: if calendar { 0 } else { i + 1 }, text: tx::WEEKDAYS_ALONE[l][i].into() });
    }
    if !calendar {
        for column in 0..weeks {
            let (start, end) = (padded[column * 7], padded[column * 7 + 6]);
            if let Some(marker) = dates.iter().find(|d| **d >= start && **d <= end && (**d == first || d.day() == 1)) {
                out.heads.push(Head { column: column + 1, row: 0, text: tx::MONTHS_ALONE[l][marker.month0() as usize].into() });
            }
        }
    }
    for (index, date) in padded.iter().enumerate() {
        if !in_range(*date) { continue; }
        let level = level(record(date), track, range);
        let fill = (level > 0).then(|| shades[level - 1]);
        out.cells.push(Cell { date: *date, column: if calendar { index % 7 } else { index / 7 + 1 }, row: if calendar { index / 7 + 1 } else { index % 7 + 1 },
            level, fill, text: if calendar { date.day().to_string() } else { String::new() }, ink: fill.map(ink_on), active: chosen == Some(*date) });
    }
    match chosen {
        Some(date) => {
            let r = record(&date);
            let done = level(r, track, range) > 0;
            let what = if done { match r.and_then(|r| r.minutes) { Some(m) if track => format!("{} min", js_number(m)), _ => tx::COMPLETED[l].into() } } else { tx::NO_ACTIVITY[l].into() };
            let text = r.and_then(|r| r.text.clone()).filter(|t| !t.is_empty()).map(|t| format!(" · {t}")).unwrap_or_default();
            out.detail = format!("{} · {what}{text}", full_date(date, language));
        }
        None => { out.detail = tx::PICK_DAY[l].into(); out.hint = true; }
    }
    out
}

// ----- The whole view -----

#[derive(Clone, Debug, Default, PartialEq)]
pub struct View {
    pub mode: Mode,
    pub start: Option<NaiveDate>,
    pub end: Option<NaiveDate>,
    /// "Monatsübersicht".
    pub eyebrow: String,
    /// "November 2026".
    pub heading: String,
    pub chart: Chart,
    pub cards: Vec<Card>,
    /// No activity is defined at all.
    pub no_activities: bool,
}

pub struct Input<'a> {
    pub data: &'a PeriodData,
    pub calendar: &'a CalendarMinutes,
    /// The chart's hidden lines (`rating` or a day value's id).
    pub hidden: &'a BTreeSet<String>,
}

/// The evaluation of the period around `date`. `cursor`: the day the keyboard or the mouse chose (its details show).
pub fn build(input: &Input, date: NaiveDate, mode: Mode, cursor: Option<NaiveDate>, language: Language) -> View {
    let (start, end) = mode.bounds(date);
    let days = dates(start, end);
    let shown = records(input.data, input.calendar, &days);
    let cards = input.data.definitions.iter()
        .filter(|item| item.active != Some(false) || days.iter().any(|d| shown.get(d).is_some_and(|items| items.contains_key(&item.id))))
        .map(|item| card(item, &days, &shown, mode, cursor, language)).collect();
    View { mode, start: Some(start), end: Some(end), eyebrow: tx::EYEBROWS[at(language)][mode.index()].into(), heading: title(date, mode, language),
        chart: chart(input.data, &days, mode, input.hidden, cursor, language), cards, no_activities: input.data.definitions.is_empty() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repeat::d;

    fn data() -> PeriodData {
        PeriodData::parse(&serde_json::json!({
            "definitions": [
                { "id": "run", "name": "Laufen", "color": "#ff9f43", "trackTime": true, "active": true, "calendarTagId": "sport", "minMinutes": 0, "maxMinutes": 60 },
                { "id": "read", "name": "Lesen", "color": "#569eff", "trackTime": false, "active": true },
                { "id": "old", "name": "Alt", "color": "#569eff", "active": false }
            ],
            "scales": [
                { "id": "stress", "name": "Stress", "color": "#e57b7b", "min": 1, "max": 5, "active": true },
                { "id": "gone", "name": "", "color": "#76d982", "min": 0, "max": 10, "active": false }
            ],
            "days": {
                "2026-11-16": { "rating": 6, "scales": { "stress": 2 }, "items": { "run": { "done": true, "minutes": 20, "text": "Park" }, "read": { "done": true } } },
                "2026-11-17": { "rating": 8, "items": {} },
                "2026-11-19": { "rating": 12, "scales": { "stress": 4 }, "items": { "read": { "done": false } } },
                "2026-10-02": { "rating": 4, "scales": { "gone": 3 }, "items": { "old": { "done": true } } }
            },
            "notes": {}
        }).to_string())
    }

    #[test]
    fn periods_titles_and_steps_follow_the_app() {
        let day = d("2026-11-18");
        assert_eq!(Mode::Week.bounds(day), (d("2026-11-16"), d("2026-11-22")));
        assert_eq!(Mode::Month.bounds(day), (d("2026-11-01"), d("2026-11-30")));
        assert_eq!(Mode::Quarter.bounds(day), (d("2026-10-01"), d("2026-12-31")));
        assert_eq!(Mode::Year.bounds(day), (d("2026-01-01"), d("2026-12-31")));
        assert_eq!(title(day, Mode::Week, Language::De), "16. Nov. – 22. Nov. 2026");
        assert_eq!(title(d("2026-09-02"), Mode::Week, Language::En), "31 Aug – 6 Sept 2026");
        assert_eq!(title(day, Mode::Month, Language::De), "November 2026");
        assert_eq!(title(day, Mode::Quarter, Language::De), "Quartal 4 · 2026");
        assert_eq!(title(day, Mode::Quarter, Language::En), "Quarter 4 · 2026");
        assert_eq!(title(day, Mode::Year, Language::De), "2026");
        assert_eq!(Mode::Month.step(d("2026-11-30"), true), d("2026-12-01"));
        assert_eq!(Mode::Month.step(d("2026-12-05"), true), d("2027-01-01"), "November → Dezember → Januar.");
        assert_eq!((Mode::Year.cycle(true), Mode::Week.cycle(false)), (Mode::Week, Mode::Year));
    }

    #[test]
    fn numbers_are_written_as_javascript_writes_them() {
        // As node prints them: (6.25).toFixed(1), (0.35).toFixed(1) …
        assert_eq!([6.25, 0.05, 7.0, -0.25, 0.35, 1.45, 6.625, 9.95].map(fixed1), ["6.3", "0.1", "7.0", "-0.3", "0.3", "1.4", "6.6", "9.9"]);
        assert_eq!((duration(45.0), duration(60.0), duration(95.0)), ("45 min".into(), "1 h".into(), "1 h 35 min".into()));
        assert_eq!(palette([0xff, 0x9f, 0x43])[0], [0xff, 0xdc, 0xbb], "#ffdcbb, as the app's activityPalette gives it.");
        assert_eq!(palette([0x56, 0x9e, 0xff])[6], [0x2d, 0x52, 0x85]);
        assert_eq!(activity_range(Some(10.0), Some(12.0)), (0.0, 180.0), "Fewer than six minutes apart: the default.");
        let record = |minutes| Record { done: false, minutes: Some(minutes), text: None };
        assert_eq!([0.0, 1.0, 10.0, 59.0, 60.0, 500.0].map(|m| level(Some(&record(m)), true, (0.0, 60.0))), [0, 1, 2, 6, 7, 7]);
        assert_eq!(level(Some(&Record { done: true, ..Record::default() }), false, (0.0, 180.0)), 1);
    }

    #[test]
    fn the_chart_matches_the_apps_svg() {
        let data = data();
        let calendar = CalendarMinutes::new();
        let hidden = BTreeSet::new();
        let view = build(&Input { data: &data, calendar: &calendar, hidden: &hidden }, d("2026-11-18"), Mode::Week, None, Language::De);
        let chart = &view.chart;
        assert_eq!(chart.legend.iter().map(|l| (l.label.as_str(), l.stat.as_str())).collect::<Vec<_>>(),
            [("Tagesbewertung", "Ø 8.0 / 10 · 3 Tage"), ("Stress", "Ø 3.0 / 5 · 2 Tage")], "Clamped to the span; an inactive scale without values stays out.");
        assert_eq!(chart.left, 34.0);
        assert_eq!(chart.ticks.iter().map(|t| (t.label.as_str(), t.y)).collect::<Vec<_>>(), [("0", 158.0), ("5", 86.0), ("10", 14.0)]);
        // step = (640 - 34 - 14) / 7; Monday x = 34 + step / 2.
        assert_eq!(chart.lines[0].commands, "M76.3 71.6 L160.9 42.8", "A run of two days; the gap on Wednesday breaks the line.");
        assert_eq!(chart.points.len(), 5);
        assert_eq!(chart.labels.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), ["16. Nov.", "17. Nov.", "18. Nov.", "19. Nov.", "20. Nov.", "21. Nov.", "22. Nov."]);
        assert!(chart.hint && chart.detail.starts_with("Tageswerte"));
        let chosen = build(&Input { data: &data, calendar: &calendar, hidden: &hidden }, d("2026-11-18"), Mode::Week, Some(d("2026-11-19")), Language::De);
        assert_eq!(chosen.chart.detail, "19. Nov.: Tagesbewertung 10, Stress 4");
        assert!(chosen.chart.guide.is_some());
        let hidden = BTreeSet::from(["rating".to_string(), "stress".to_string()]);
        let none = build(&Input { data: &data, calendar: &calendar, hidden: &hidden }, d("2026-11-18"), Mode::Week, Some(d("2026-11-19")), Language::En);
        assert!(none.chart.empty && none.chart.lines.is_empty());
        assert_eq!(none.chart.detail, "19 Nov: no lines");
    }

    #[test]
    fn quarters_and_years_show_monthly_averages() {
        let data = data();
        let (calendar, hidden) = (CalendarMinutes::new(), BTreeSet::new());
        let view = build(&Input { data: &data, calendar: &calendar, hidden: &hidden }, d("2026-11-18"), Mode::Quarter, Some(d("2026-11-03")), Language::De);
        assert_eq!(view.chart.columns.len(), 3);
        assert_eq!(view.chart.labels.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(), ["Okt", "Nov", "Dez"]);
        assert_eq!(view.chart.detail, "Nov: Tagesbewertung 8, Stress 3, Ohne Namen –");
        assert_eq!(view.chart.lines.len(), 1, "October and November in a row (rating); the others are single points.");
    }

    #[test]
    fn activities_add_the_calendar_time_and_lay_out_like_the_app() {
        let data = data();
        let calendar = CalendarMinutes::from([("2026-11-17".to_string(), BTreeMap::from([("sport".to_string(), 45), ("other".to_string(), 30)]))]);
        let hidden = BTreeSet::new();
        let input = Input { data: &data, calendar: &calendar, hidden: &hidden };
        let week = build(&input, d("2026-11-18"), Mode::Week, Some(d("2026-11-17")), Language::De);
        assert_eq!(week.cards.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Laufen", "Lesen"], "Inactive and unused activities stay out.");
        let run = &week.cards[0];
        assert_eq!((run.total.as_deref(), run.days.as_str()), (Some("1 h 5 min"), "2 / 7 Tage"));
        assert_eq!(run.bars.iter().map(|b| b.value.as_str()).collect::<Vec<_>>(), ["20", "45", "–", "–", "–", "–", "–"]);
        assert_eq!(run.bars[1].fraction, 1.0);
        assert!((run.bars[0].fraction - 20.0 / 45.0).abs() < 1e-9);
        assert_eq!(run.detail, "2026-11-17 · 45 min");
        let read = &week.cards[1];
        assert_eq!((read.total.as_deref(), read.bars[0].value.as_str(), read.unit.as_str()), (None, "✓", ""));

        let month = build(&input, d("2026-11-18"), Mode::Month, Some(d("2026-11-16")), Language::De);
        let run = &month.cards[0];
        assert_eq!((run.kind, run.columns, run.rows), (CardKind::Calendar, 7, 7), "November 2026: six weeks from Monday 26 October, under the weekdays.");
        let monday = run.cells.iter().find(|c| c.date == d("2026-11-16")).unwrap();
        assert_eq!((monday.column, monday.row, monday.level, monday.text.as_str()), (0, 4, 3, "16"));
        assert_eq!(run.cells.first().map(|c| (c.column, c.row)), Some((6, 1)), "The 1st is a Sunday.");
        assert_eq!(run.detail, "Mo., 16. Nov. 2026 · 20 min · Park");

        let year = build(&input, d("2026-11-18"), Mode::Year, None, Language::En);
        let run = &year.cards[0];
        assert_eq!((run.kind, run.columns, run.rows, run.cells.len()), (CardKind::Contributions, 54, 8, 365));
        assert_eq!(run.heads.iter().filter(|h| h.row == 0).map(|h| h.text.as_str()).collect::<Vec<_>>(), ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]);
        assert!(run.hint && run.detail == "Select a day for details");
        assert_eq!(year.cards.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Laufen", "Lesen", "Alt"], "An inactive activity with a record in the period is shown.");
    }
}
