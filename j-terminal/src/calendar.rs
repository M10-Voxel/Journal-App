//! The calendar beside the form, without a window (docs/plan.md, "Kalender"): the "weave". Days lie one under the
//! other, endless in both directions; inside each day the time runs left to right over the 24 hours, which can be
//! zoomed and moved. Entries are pieces of time at their place, overlapping ones in rows of their own. Entries without
//! a time stand beside the date (as dots while the day is closed), entries over several days are coloured lanes at the
//! side. A day opens with a click. This module only computes where things go; `ui/calendar.slint` draws them,
//! `form.rs` feeds it and handles the mouse.
use std::collections::BTreeSet;
use chrono::{Datelike, NaiveDate, Weekday};
use journal_core::storage::Entry;
use crate::repeat;
use crate::texts::{texts, Language};

/// Sizes in logical pixels (from the theme, `ui/theme.slint`), with the zoom applied.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metrics {
    pub width: f32, pub height: f32, pub pad: f32,
    /// The sticky header with the month and the hours.
    pub head_h: f32,
    pub lanes: usize, pub lane_w: f32,
    /// The side beside the lanes: the date and the entries without a time.
    pub label_w: f32,
    /// The date at the start of the day column (the dots of closed days stay right of it).
    pub date_w: f32,
    /// A closed day.
    pub day_h: f32,
    /// The thinnest piece of time in a closed day with many rows.
    pub thin_h: f32,
    /// A row of an opened day.
    pub row_h: f32,
    pub month_h: f32,
    /// The date's line at the top of a day.
    pub date_h: f32,
    /// An entry without a time in an opened day.
    pub chip_h: f32,
    /// Its dot while the day is closed.
    pub dot: f32,
    /// A point in time: caption width and the exact time marker's stroke, independent of the hour zoom.
    pub point_w: f32,
    pub point_line_w: f32,
    /// How many times the 24 hours are wider than the room they have, and the minute at the left edge.
    pub zoom: f32,
    pub pan: f32,
}
impl Default for Metrics {
    fn default() -> Self {
        Metrics { width: 900.0, height: 600.0, pad: 6.0, head_h: 22.0, lanes: 3, lane_w: 20.0, label_w: 150.0, date_w: 50.0, day_h: 30.0, thin_h: 5.0, row_h: 36.0, month_h: 24.0, date_h: 20.0, chip_h: 18.0, dot: 12.0, point_w: 140.0, point_line_w: 4.0, zoom: 1.0, pan: 0.0 }
    }
}
impl Metrics {
    /// Where the side ends and the 24 hours begin.
    pub fn time_x(&self) -> f32 { self.pad + self.lanes as f32 * self.lane_w + self.label_w }
    pub fn time_w(&self) -> f32 { (self.width - self.time_x() - self.pad).max(1.0) }
    /// Pixels per minute.
    fn scale(&self) -> f32 { self.time_w() * self.zoom / 1440.0 }
    /// The minutes that fit in view.
    pub fn span(&self) -> f32 { 1440.0 / self.zoom }
    pub fn x_of(&self, minutes: f32) -> f32 { self.time_x() + (minutes - self.pan) * self.scale() }
    pub fn minute_at(&self, x: f32) -> u32 { (self.pan + (x - self.time_x()) / self.scale()).clamp(0.0, 1440.0) as u32 }
    /// `pan` kept so that the 24 hours fill the view.
    pub fn clamp_pan(&self, pan: f32) -> f32 { pan.clamp(0.0, (1440.0 - self.span()).max(0.0)) }
}

pub type Rgb = [u8; 3];

/// One entry as the calendar draws it: the days it covers and when it starts and ends.
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub entry_id: Option<String>,
    pub first: NaiveDate,
    pub last: NaiveDate,
    /// Minutes since midnight of `first`.
    pub start: Option<u32>,
    /// Minutes since midnight of `last` (1440 at most).
    pub end: Option<u32>,
    pub title: String,
    pub icon: String,
    pub time_grid: bool,
    pub color: Option<Rgb>,
    /// The entry being made in the form.
    pub fresh: bool,
    pub done: bool,
    /// Marked important: its edge in the calendar's yellow.
    pub priority: bool,
}

fn minutes(text: &str) -> Option<u32> {
    let (hours, minutes) = text.split_once(':')?;
    Some(hours.parse::<u32>().ok()? * 60 + minutes.parse::<u32>().ok()?)
}

/// `#rrggbb`.
pub fn parse_color(text: &str) -> Option<Rgb> {
    let hex = text.strip_prefix('#')?;
    if hex.len() != 6 { return None; }
    Some([u8::from_str_radix(&hex[0..2], 16).ok()?, u8::from_str_radix(&hex[2..4], 16).ok()?, u8::from_str_radix(&hex[4..6], 16).ok()?])
}

/// A tag's colour, turned a little away from `mark` (the yellow of important entries) when the two would look the
/// same: the hue moves 30° off, so an important entry's edge still stands out from its neighbours.
pub fn apart(color: Rgb, mark: Rgb) -> Rgb {
    let hex = |[r, g, b]: Rgb| format!("#{r:02x}{g:02x}{b:02x}");
    let (hue, saturation, value) = crate::tag_edit::hsv_of(&hex(color));
    let (mark_hue, mark_saturation, mark_value) = crate::tag_edit::hsv_of(&hex(mark));
    let turn = (hue - mark_hue + 540.0).rem_euclid(360.0) - 180.0;
    let near = turn.abs() < 22.0 && saturation > 0.35 && (saturation - mark_saturation).abs() < 0.4 && (value - mark_value).abs() < 0.35;
    if !near { return color; }
    let away = if turn >= 0.0 { 30.0 - turn } else { -30.0 - turn };
    parse_color(&crate::tag_edit::hex_of(hue + away, saturation, value)).unwrap_or(color)
}

/// Times marked with the mouse snap to quarter hours (as `snapMinutes` in the app).
pub const SNAP: u32 = 15;

impl Item {
    /// The app stores an end as the hours since midnight of the first day (`120:00` is five days later, `24:00` the
    /// midnight that ends the day without touching the next one).
    pub fn new(date: NaiveDate, time: Option<&str>, end: Option<&str>, title: &str, color: Option<Rgb>, fresh: bool, done: bool) -> Item {
        let start = time.and_then(minutes);
        let (last, end) = match (start, end.and_then(minutes)) {
            (Some(_), Some(total)) => {
                let (mut days, mut rest) = (total / 1440, total % 1440);
                if rest == 0 && days > 0 { days -= 1; rest = 1440; }
                (repeat::shift(date, days as i64), Some(rest))
            }
            _ => (date, None),
        };
        Item { entry_id: None, first: date, last, start, end, title: title.to_string(), icon: String::new(), time_grid: false, color, fresh, done, priority: false }
    }

    pub fn from_entry(date: NaiveDate, entry: &Entry, color: Option<Rgb>) -> Item {
        let mut item = Item::new(date, entry.time.as_deref(), entry.end.as_deref(), &entry.text, color, false, entry.done || entry.cancelled);
        item.entry_id = Some(entry.id.clone());
        item.icon = entry.icon.clone().unwrap_or_default();
        item.time_grid = entry.time_grid;
        item.priority = entry.priority;
        item
    }

    fn covers(&self, day: NaiveDate) -> bool { self.first <= day && day <= self.last }
    pub fn multiday(&self) -> bool { self.last > self.first }
    pub fn point(&self) -> bool { self.start.is_some() && self.end.is_none() }
    /// A single day without a time: it stands beside the date, not in the 24 hours.
    fn all_day(&self) -> bool { !self.multiday() && self.start.is_none() }

    /// Hour-grid ranges continue on every covered day. Traditional multiday entries keep their lane and opening piece.
    fn span_on(&self, day: NaiveDate) -> Option<(u32, u32)> {
        if !self.covers(day) || self.all_day() { return None; }
        let start = self.start?;
        if self.multiday() {
            if !self.time_grid { return (day == self.first && start > 0).then_some((start, 1440)); }
            let from = if day == self.first { start } else { 0 };
            let to = if day == self.last { self.end? } else { 1440 };
            return (to > from).then_some((from, to));
        }
        Some(match self.end {
            Some(end) => (start.min(1440 - SNAP), end.max(start + SNAP).min(1440)),
            None => (start, start),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BandKind { Day, Month }

#[derive(Clone, Debug, PartialEq)]
pub struct Band {
    pub y: f32, pub h: f32,
    pub kind: BandKind,
    pub date: NaiveDate,
    pub label: String,
    /// `KW 47` on a Monday.
    pub week: String,
    /// A new week starts with this day: the line above it is the week's line.
    pub week_start: bool,
    /// Every other month is tinted.
    pub tint: bool,
    pub weekend: bool, pub today: bool, pub selected: bool, pub cursor: bool, pub open: bool,
}

/// A piece of time in a day.
#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    pub x: f32, pub y: f32, pub w: f32, pub h: f32,
    pub item: usize,
    pub title: String,
    pub icon: String,
    pub time: String,
    pub color: Option<Rgb>,
    pub fresh: bool, pub done: bool, pub priority: bool,
    /// It goes on beyond the left edge of what is shown (no coloured edge there).
    pub cut: bool,
    pub point: bool,
    /// Attach the point's caption to the top of its marker, away from an overlapping row below.
    pub caption_at_top: bool,
    /// Position of the point's exact time marker relative to the caption's left edge.
    pub marker: f32,
    /// 0 no text, 1 the title, 2 title and time.
    pub text: u8,
}

/// An entry without a time beside the date: a line with its title in an opened day, a dot in a closed one.
#[derive(Clone, Debug, PartialEq)]
pub struct Chip {
    pub x: f32, pub y: f32, pub w: f32, pub h: f32,
    pub item: usize,
    pub title: String,
    pub icon: String,
    pub color: Option<Rgb>,
    pub fresh: bool, pub done: bool, pub priority: bool,
    pub dot: bool,
}

/// An entry over several days in its lane at the side.
#[derive(Clone, Debug, PartialEq)]
pub struct Lane {
    pub x: f32, pub y: f32, pub w: f32, pub h: f32,
    pub item: usize,
    pub title: String,
    pub icon: String,
    pub color: Option<Rgb>,
    pub fresh: bool, pub done: bool, pub priority: bool,
}

/// A mark of the hours in the header and as a line through the days.
#[derive(Clone, Debug, PartialEq)]
pub struct Tick { pub x: f32, pub label: String, pub strong: bool }

#[derive(Clone, Debug, PartialEq)]
pub struct Row { pub y: f32, pub h: f32, pub date: NaiveDate }

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Layout {
    pub bands: Vec<Band>,
    pub blocks: Vec<Block>,
    pub chips: Vec<Chip>,
    pub lanes: Vec<Lane>,
    pub ticks: Vec<Tick>,
    pub rows: Vec<Row>,
    /// The month of the top row, for the sticky header.
    pub title: String,
    /// The time now in today's row: x, y, height.
    pub now: Option<(f32, f32, f32)>,
    /// The keyboard's place: in the hours a quarter or an hour wide (x, y, w, h); on the side the whole side of the day.
    pub caret: Option<(f32, f32, f32, f32)>,
    /// The keyboard is on the side of the days (whole days), not in the hours.
    pub caret_side: bool,
    pub first: Option<NaiveDate>,
    pub last: Option<NaiveDate>,
}

pub struct Input<'a> {
    pub today: NaiveDate,
    pub now: u32,
    /// The day at the top and how far it is scrolled out of view.
    pub top: NaiveDate,
    pub offset: f32,
    pub items: &'a [Item],
    /// Opened days.
    pub open: &'a BTreeSet<NaiveDate>,
    /// The day the cursor is on while the calendar has the keyboard.
    pub cursor: Option<NaiveDate>,
    /// In the 24 hours: the minute the cursor is at (otherwise it is on the side of the day).
    pub caret: Option<u32>,
    /// The days chosen with the keyboard.
    pub selected: &'a BTreeSet<NaiveDate>,
    pub language: Language,
}

fn day_label(day: NaiveDate, language: Language) -> String {
    format!("{} {}.", repeat::weekday_short(language)[repeat::weekday_of(day) as usize], day.day())
}

fn hours(minutes: u32) -> String { format!("{:02}:{:02}", minutes / 60, minutes % 60) }

struct Packed {
    item: usize,
    from: u32,
    to: u32,
    row: usize,
    caption_at_top: bool,
}

/// The pieces of one day, each in the first row it fits into. And the number of rows.
fn pack(items: &[Item], day: NaiveDate, m: &Metrics) -> (Vec<Packed>, usize) {
    let mut pieces: Vec<_> = items.iter().enumerate().filter_map(|(index, item)| {
        let (from, to) = item.span_on(day)?;
        let (left, right) = if item.point() {
            let (x, w, _) = point_bounds(m, from)?;
            (x, x + w)
        } else { (m.x_of(from as f32), m.x_of(to as f32)) };
        Some((index, from, to, left, right))
    }).collect();
    pieces.sort_by(|a, b| a.3.total_cmp(&b.3).then(b.4.total_cmp(&a.4)).then(a.0.cmp(&b.0)));
    // Right edge and last placed piece in each row; only these can overlap the next piece.
    let mut ends: Vec<(f32, usize)> = Vec::new();
    let mut placed: Vec<Packed> = Vec::new();
    for (index, from, to, left, right) in pieces {
        let row = ends.iter().position(|(end, _)| *end <= left).unwrap_or(ends.len());
        let mut caption_at_top = false;
        for (other_row, &(end, previous)) in ends.iter().enumerate() {
            if end <= left { continue; }
            // Move an upper point's caption away from the overlapping piece below it.
            // Separate rows keep full-height time markers out of other captions.
            if other_row < row && items[placed[previous].item].point() { placed[previous].caption_at_top = true; }
            if other_row > row && items[index].point() { caption_at_top = true; }
        }
        let next = (right, placed.len());
        if row == ends.len() { ends.push(next); } else { ends[row] = next; }
        placed.push(Packed { item: index, from, to, row, caption_at_top });
    }
    (placed, ends.len())
}

/// The caption may turn to the left near midnight; the marker always stays at the actual minute.
fn point_bounds(m: &Metrics, minute: u32) -> Option<(f32, f32, f32)> {
    let marker = m.x_of(minute as f32);
    let (left, right) = (m.time_x(), m.time_x() + m.time_w());
    if marker < left || marker > right { return None; }
    let width = m.point_w.min(m.time_w());
    let x = (marker - m.point_line_w / 2.0).clamp(left, (right - width).max(left));
    Some((x, width, marker - x))
}

fn all_day_of(items: &[Item], day: NaiveDate) -> Vec<usize> {
    items.iter().enumerate().filter(|(_, item)| item.all_day() && item.first == day).map(|(index, _)| index).collect()
}

/// How tall a day is: closed it fits its rows into the normal height (thinner pieces when there are many), opened every
/// row gets room for a title and a time, and the side lists the entries without a time. A month's first day carries
/// the month's heading.
pub fn day_height(input: &Input, m: &Metrics, day: NaiveDate) -> f32 {
    let rows = pack(input.items, day, m).1 as f32;
    let body = if input.open.contains(&day) {
        let chips = all_day_of(input.items, day).len() as f32;
        m.day_h.max(rows * m.row_h + 4.0).max(m.date_h + chips * m.chip_h + 4.0)
    } else { m.day_h.max(rows * m.thin_h + 8.0) };
    body + if day.day() == 1 { m.month_h } else { 0.0 }
}

/// Scrolling by `delta` pixels (positive: later days come up).
pub fn scroll(input: &Input, m: &Metrics, delta: f32) -> (NaiveDate, f32) {
    let (mut top, mut offset) = (input.top, input.offset + delta);
    let mut guard = 0;
    while offset < 0.0 && guard < 2000 { top = repeat::shift(top, -1); offset += day_height(input, m, top); guard += 1; }
    while offset >= day_height(input, m, top) && guard < 2000 { offset -= day_height(input, m, top); top = repeat::shift(top, 1); guard += 1; }
    (top, offset)
}

/// The marks of the hours: as many as fit, every 3 hours when all 24 are shown, down to every quarter hour.
fn ticks(m: &Metrics) -> Vec<Tick> {
    let step = [15u32, 30, 60, 120, 180, 360].into_iter().find(|step| *step as f32 * m.scale() >= 60.0).unwrap_or(360);
    let first = (m.pan as u32).div_ceil(step) * step;
    (0..).map(|n| first + n * step).take_while(|minute| *minute as f32 <= m.pan + m.span() && *minute <= 1440)
        .filter(|minute| *minute > 0 && *minute < 1440 || m.zoom > 1.0)
        .map(|minute| Tick { x: m.x_of(minute as f32), label: hours(minute), strong: minute % 360 == 0 }).collect()
}

pub fn layout(input: &Input, m: &Metrics) -> Layout {
    let t = texts(input.language);
    let mut out = Layout { title: format!("{} {}", t.months[input.top.month0() as usize], input.top.year()), ticks: ticks(m), ..Layout::default() };
    let (left, right) = (m.time_x(), m.time_x() + m.time_w());
    let label_x = m.pad + m.lanes as f32 * m.lane_w;
    let mut day = input.top;
    let mut y = m.head_h - input.offset;
    while y < m.height && out.rows.len() < 300 {
        if day.day() == 1 {
            out.bands.push(Band { y, h: m.month_h, kind: BandKind::Month, date: day, label: format!("{} {}", t.months[day.month0() as usize], day.year()), week: String::new(), week_start: false, tint: day.month() % 2 == 0, weekend: false, today: false, selected: false, cursor: false, open: false });
            y += m.month_h;
        }
        let open = input.open.contains(&day);
        let (pieces, rows) = pack(input.items, day, m);
        let h = day_height(input, m, day) - if day.day() == 1 { m.month_h } else { 0.0 };
        out.bands.push(Band {
            y, h, kind: BandKind::Day, date: day, label: day_label(day, input.language),
            week: if day.weekday() == Weekday::Mon { format!("{} {}", t.week_short, day.iso_week().week()) } else { String::new() },
            week_start: day.weekday() == Weekday::Mon, tint: day.month() % 2 == 0, weekend: matches!(day.weekday(), Weekday::Sat | Weekday::Sun),
            today: day == input.today, selected: input.selected.contains(&day), cursor: input.cursor == Some(day), open,
        });
        out.rows.push(Row { y, h, date: day });
        let row_h = if open { m.row_h } else { ((h - 8.0) / rows.max(1) as f32).max(m.thin_h) };
        for Packed { item: index, from, to, row, caption_at_top } in pieces {
            let item = &input.items[index];
            let (a, b) = (m.x_of(from as f32), m.x_of(to as f32));
            // Only what lies in the hours shown.
            let (x, x2, marker) = if item.point() {
                let Some((x, w, marker)) = point_bounds(m, from) else { continue };
                (x, x + w, marker)
            } else { (a.max(left), b.min(right), 0.0) };
            if x2 - x < 1.0 { continue; }
            let w = (x2 - x).max(3.0);
            let bh = if open { m.row_h - 4.0 } else { row_h - if rows > 1 { 1.0 } else { 0.0 } };
            let text = if item.point() && w >= 28.0 && bh >= 12.0 { 1 } else if open && w >= 28.0 && bh >= 26.0 { 2 } else if (open || rows == 1) && w >= 28.0 && bh >= 12.0 { 1 } else { 0 };
            let time = match (item.start, item.multiday()) {
                (None, _) => String::new(),
                (Some(_), true) => format!("{}–{}", hours(from), hours(to)),
                (Some(start), false) => match item.end { Some(end) => format!("{}–{}", hours(start), hours(end)), None => hours(start) },
            };
            out.blocks.push(Block { x, y: y + 4.0 + row as f32 * row_h, w, h: bh.max(2.0), item: index, title: item.title.clone(), icon: item.icon.clone(), time, color: item.color, fresh: item.fresh, done: item.done, priority: item.priority, cut: !item.point() && a < left, point: item.point(), caption_at_top, marker, text });
        }
        // Entries without a time: listed under the date when the day is open, dots beside it when closed.
        let chips = all_day_of(input.items, day);
        for (n, index) in chips.iter().enumerate() {
            let item = &input.items[*index];
            let chip = if open {
                Chip { x: label_x, y: y + m.date_h + n as f32 * m.chip_h, w: m.label_w - m.pad, h: m.chip_h - 2.0, item: *index, title: item.title.clone(), icon: item.icon.clone(), color: item.color, fresh: item.fresh, done: item.done, priority: item.priority, dot: false }
            } else {
                // Right of the date only: a narrow column shows fewer dots (or none) rather than covering it.
                let room = ((m.label_w * 0.45).min(m.label_w - m.date_w - m.pad) / (m.dot + 3.0)).floor().max(0.0) as usize;
                if n >= room { break; }
                Chip { x: left - m.pad - (n as f32 + 1.0) * (m.dot + 3.0), y: y + (m.date_h - m.dot) / 2.0, w: m.dot, h: m.dot, item: *index, title: String::new(), icon: item.icon.clone(), color: item.color, fresh: item.fresh, done: item.done, priority: item.priority, dot: true }
            };
            out.chips.push(chip);
        }
        if input.cursor == Some(day) {
            match input.caret {
                Some(minute) => {
                    let width = if minute % 60 == 0 { 60.0 } else { SNAP as f32 };
                    let (a, b) = (m.x_of(minute as f32).max(left), m.x_of(minute as f32 + width).min(right));
                    if b > a { out.caret = Some((a, y + 1.0, b - a, h - 2.0)); }
                }
                None => { out.caret = Some((m.pad, y + 1.0, left - m.pad - 2.0, h - 2.0)); out.caret_side = true; }
            }
        }
        if day == input.today {
            let x = m.x_of(input.now as f32);
            if x >= left && x <= right { out.now = Some((x, y, h)); }
        }
        y += h;
        day = repeat::shift(day, 1);
    }
    out.first = out.rows.first().map(|row| row.date);
    out.last = out.rows.last().map(|row| row.date);

    // Entries over several days: their lane down through all their days.
    let (Some(first), Some(last)) = (out.first, out.last) else { return out };
    let mut spans: Vec<(usize, &Item)> = input.items.iter().enumerate().filter(|(_, item)| item.multiday() && !item.time_grid).collect();
    spans.sort_by_key(|(index, item)| (item.first, std::cmp::Reverse(item.last), *index));
    let mut lane_end: Vec<NaiveDate> = Vec::new();
    for (index, item) in spans {
        let lane = match lane_end.iter().position(|end| *end < item.first) { Some(free) => { lane_end[free] = item.last; free } None => { lane_end.push(item.last); lane_end.len() - 1 } };
        if item.last < first || item.first > last || lane >= m.lanes { continue; }
        let top = out.rows.iter().find(|row| row.date == item.first).map_or(m.head_h, |row| row.y + 3.0);
        let bottom = out.rows.iter().find(|row| row.date == item.last).map_or(m.height, |row| row.y + row.h - 3.0);
        out.lanes.push(Lane { x: m.pad + lane as f32 * m.lane_w, y: top, w: m.lane_w - 3.0, h: (bottom - top).max(4.0), item: index, title: item.title.clone(), icon: item.icon.clone(), color: item.color, fresh: item.fresh, done: item.done, priority: item.priority });
    }
    out
}

/// What is under the mouse.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spot {
    /// An entry (its piece of time, its line or dot beside the date, or its lane), in the day under the mouse.
    Item(usize, NaiveDate),
    /// The side of a day, left of the 24 hours.
    Side(NaiveDate),
    /// A moment in the 24 hours of a day (minutes since its midnight).
    Time(NaiveDate, u32),
    Nothing,
}

pub fn spot(layout: &Layout, m: &Metrics, x: f32, y: f32) -> Spot {
    if y < m.head_h { return Spot::Nothing; }
    let Some(row) = layout.rows.iter().find(|row| y >= row.y && y < row.y + row.h) else { return Spot::Nothing };
    let inside = |bx: f32, by: f32, bw: f32, bh: f32| x >= bx && x <= bx + bw && y >= by && y <= by + bh;
    if let Some(b) = layout.blocks.iter().find(|b| inside(b.x, b.y, b.w, b.h)) { return Spot::Item(b.item, row.date); }
    if let Some(c) = layout.chips.iter().find(|c| inside(c.x - 1.0, c.y - 1.0, c.w + 2.0, c.h + 2.0)) { return Spot::Item(c.item, row.date); }
    if let Some(l) = layout.lanes.iter().find(|l| inside(l.x, l.y, l.w, l.h)) { return Spot::Item(l.item, row.date); }
    if x < m.time_x() { return Spot::Side(row.date); }
    Spot::Time(row.date, m.minute_at(x))
}

/// The day a `y` lies in, also beyond the first or last row (for dragging past the edge).
pub fn day_at(layout: &Layout, y: f32) -> Option<NaiveDate> {
    let row = layout.rows.iter().find(|row| y >= row.y && y < row.y + row.h)
        .or_else(|| if y < layout.rows.first()?.y { layout.rows.first() } else { layout.rows.last() })?;
    Some(row.date)
}

/// A range marked with the mouse in the 24 hours, from one moment to another (either way round, over days as well):
/// quarter hours, at least one (as `snapRange` in the app).
pub fn marked(a: (NaiveDate, u32), b: (NaiveDate, u32)) -> ((NaiveDate, u32), (NaiveDate, u32)) {
    let snap = |(day, minute): (NaiveDate, u32)| (day, (minute / SNAP * SNAP).min(1440 - SNAP));
    let (a, b) = (snap(a), snap(b));
    let (from, to) = if a <= b { (a, b) } else { (b, a) };
    (from, (to.0, to.1 + SNAP))
}

/// Zooming the 24 hours by `factor` around the minute under `x`; the zoom stays between showing all 24 hours and an
/// hour and a half. Returns the new zoom and the minute at the left edge.
pub fn zoom_hours(m: &Metrics, x: f32, factor: f32) -> (f32, f32) {
    let minute = m.pan + (x - m.time_x()).clamp(0.0, m.time_w()) / m.scale();
    let zoom = (m.zoom * factor).clamp(1.0, 16.0);
    let zoomed = Metrics { zoom, ..*m };
    (zoom, zoomed.clamp_pan(minute - (x - m.time_x()).clamp(0.0, m.time_w()) / zoomed.scale()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repeat::d;

    fn today() -> NaiveDate { d("2026-11-18") }
    fn input<'a>(items: &'a [Item], open: &'a BTreeSet<NaiveDate>, none: &'a BTreeSet<NaiveDate>) -> Input<'a> {
        Input { today: today(), now: 13 * 60, top: d("2026-11-16"), offset: 0.0, items, open, cursor: None, caret: None, selected: none, language: Language::De }
    }
    fn show_with(items: &[Item], open: &[&str], m: &Metrics) -> Layout {
        let open: BTreeSet<NaiveDate> = open.iter().map(|day| d(day)).collect();
        let none = BTreeSet::new();
        layout(&input(items, &open, &none), m)
    }
    fn show(items: &[Item], open: &[&str]) -> Layout { show_with(items, open, &Metrics::default()) }
    #[test]
    fn tag_colours_keep_away_from_the_important_yellow() {
        let mark = [0xff, 0xc2, 0x1a];
        // The same yellow, or nearly: turned 30° off, so it reads as another colour.
        let (hue, _, _) = crate::tag_edit::hsv_of("#ffc21a");
        for near in [[0xff, 0xc2, 0x1a], [0xf5, 0xb8, 0x20], [0xff, 0xd0, 0x30]] {
            let moved = apart(near, mark);
            assert_ne!(moved, near);
            let (h, _, _) = crate::tag_edit::hsv_of(&format!("#{:02x}{:02x}{:02x}", moved[0], moved[1], moved[2]));
            let gap = ((h - hue + 540.0) % 360.0 - 180.0).abs();
            assert!(gap >= 25.0, "{near:?} -> {moved:?}: {gap}");
        }
        // Other colours, and greys, stay as they are.
        for other in [[0x56, 0x9e, 0xff], [0xff, 0x5f, 0x57], [0x8a, 0x8a, 0x8a], [0x4c, 0xaf, 0x50]] { assert_eq!(apart(other, mark), other); }
    }

    fn item(date: &str, time: Option<&str>, end: Option<&str>) -> Item { Item::new(d(date), time, end, "x", None, false, false) }
    fn row<'a>(layout: &'a Layout, day: &str) -> &'a Row { layout.rows.iter().find(|row| row.date == d(day)).unwrap() }

    #[test]
    fn an_end_counts_hours_from_the_first_midnight() {
        let long = item("2026-11-23", Some("00:00"), Some("120:00"));
        assert_eq!((long.last, long.end), (d("2026-11-27"), Some(1440)), "Five days: the end midnight belongs to the fifth.");
        let late = item("2026-11-23", Some("22:00"), Some("26:30"));
        assert_eq!((late.last, late.end), (d("2026-11-24"), Some(150)));
        assert_eq!(item("2026-11-23", Some("09:00"), Some("10:00")).last, d("2026-11-23"));
    }

    #[test]
    fn every_day_shows_all_24_hours_and_a_piece_sits_at_its_time() {
        let layout = show(&[item("2026-11-19", Some("12:00"), Some("18:00"))], &[]);
        let m = Metrics::default();
        let block = &layout.blocks[0];
        assert!((block.x - (m.time_x() + m.time_w() / 2.0)).abs() < 0.01, "Noon is the middle.");
        assert!((block.w - m.time_w() / 4.0).abs() < 0.01, "Six hours are a quarter.");
        let row = row(&layout, "2026-11-19");
        assert!(block.y >= row.y && block.y + block.h <= row.y + row.h);
        assert_eq!(block.text, 1, "A closed day with one row still shows the title.");
        assert_eq!(layout.ticks.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(), ["03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
    }

    #[test]
    fn icons_remain_attached_to_chips_time_blocks_and_multiday_lanes() {
        let mut all_day = item("2026-11-19", None, None);
        all_day.icon = "book-open".into();
        let mut timed = item("2026-11-19", Some("09:00"), Some("12:00"));
        timed.icon = "briefcase".into();
        let mut long = item("2026-11-20", Some("10:00"), Some("58:00"));
        long.icon = "plane".into();
        let items = [all_day, timed, long];
        for open in [vec![], vec!["2026-11-19"]] {
            let layout = show(&items, &open);
            assert_eq!(layout.chips[0].icon, "book-open");
            assert!(layout.blocks.iter().any(|block| block.icon == "briefcase"));
            assert_eq!(layout.lanes[0].icon, "plane");
            let chip = &layout.chips[0];
            assert_eq!(spot(&layout, &Metrics::default(), chip.x + 1.0, chip.y + 1.0), Spot::Item(0, d("2026-11-19")), "The icon keeps the same mouse target.");
        }
    }

    #[test]
    fn entries_without_time_stand_beside_the_date_not_in_the_hours() {
        let items = [item("2026-11-19", None, None), item("2026-11-19", None, None), item("2026-11-19", Some("23:30"), None)];
        let closed = show(&items, &[]);
        assert_eq!(closed.blocks.len(), 1, "Only the one with a time is in the hours.");
        assert!(closed.blocks[0].point, "No end means an exact point, not an assumed duration.");
        assert_eq!(closed.blocks[0].w, Metrics::default().point_w);
        assert!((closed.blocks[0].x + closed.blocks[0].marker - Metrics::default().x_of(23.5 * 60.0)).abs() < 0.01);
        assert_eq!(closed.chips.iter().filter(|c| c.dot).count(), 2, "Closed: a dot each beside the date.");
        assert!(closed.chips.iter().all(|c| c.x + c.w <= Metrics::default().time_x()));
        let opened = show(&items, &["2026-11-19"]);
        assert!(opened.chips.iter().all(|c| !c.dot && c.title == "x" && c.x + c.w <= Metrics::default().time_x()), "Opened: lines with their titles under the date.");
        assert!(row(&opened, "2026-11-19").h >= Metrics::default().date_h + 2.0 * Metrics::default().chip_h);
        // A narrow day column (no calendar weeks): the dots never cover the date, and as narrow as the date there are none.
        for (label_w, dots) in [(90.0, 2), (71.0, 1), (50.0, 0)] {
            let m = Metrics { label_w, ..Metrics::default() };
            let narrow = show_with(&items, &[], &m);
            let shown: Vec<_> = narrow.chips.iter().filter(|c| c.dot).collect();
            assert_eq!(shown.len(), dots, "{label_w}");
            assert!(shown.iter().all(|c| c.x >= m.pad + m.lanes as f32 * m.lane_w + m.date_w), "{label_w}");
        }
    }

    #[test]
    fn overlapping_entries_get_rows_and_an_opened_day_shows_title_and_time() {
        let items = [item("2026-11-19", Some("10:00"), Some("11:00")), item("2026-11-19", Some("10:30"), Some("12:00")), item("2026-11-19", Some("11:00"), Some("12:00"))];
        let closed = show(&items, &[]);
        let ys: BTreeSet<i32> = closed.blocks.iter().map(|b| b.y as i32).collect();
        assert_eq!(ys.len(), 2, "Two rows: the third fits after the first.");
        assert!(closed.blocks.iter().all(|b| b.text == 0), "Several rows in a closed day are thin.");
        let opened = show(&items, &["2026-11-19"]);
        assert!(row(&opened, "2026-11-19").h > row(&closed, "2026-11-19").h);
        assert!(opened.blocks.iter().all(|b| b.text == 2));
        assert_eq!(opened.blocks[0].time, "10:00–11:00");
    }

    #[test]
    fn hour_grid_ranges_cover_every_day_and_keep_exclusive_midnight_ends() {
        let mut timed = item("2026-11-18", Some("14:00"), Some("64:00"));
        timed.time_grid = true;
        let layout = show(&[timed.clone()], &[]);
        assert!(layout.lanes.is_empty());
        assert_eq!(layout.blocks.iter().map(|block| block.time.as_str()).collect::<Vec<_>>(), ["14:00–24:00", "00:00–24:00", "00:00–16:00"]);
        assert!((layout.blocks[1].w - Metrics::default().time_w()).abs() < 0.01);
        timed.time_grid = false;
        assert_eq!(show(&[timed.clone()], &[]).lanes.len(), 1, "The same times entered through the form keep their traditional lane.");
        timed.time_grid = true;
        timed.last = d("2026-11-19"); timed.end = Some(1440);
        assert_eq!(show(&[timed], &[]).blocks.len(), 2, "Midnight does not occupy the following day.");
    }

    #[test]
    fn point_markers_stay_exact_when_zoomed_and_captions_do_not_overlap_or_leave_the_hours() {
        let m = Metrics::default();
        let items = [item("2026-11-19", Some("14:00"), None), item("2026-11-19", Some("14:05"), None), item("2026-11-19", Some("23:59"), None)];
        for metrics in [m, Metrics { zoom: 4.0, pan: 12.0 * 60.0, ..m }] {
            let layout = show_with(&items, &["2026-11-19"], &metrics);
            let first = layout.blocks.iter().find(|b| b.item == 0).unwrap();
            let second = layout.blocks.iter().find(|b| b.item == 1).unwrap();
            assert!((first.x + first.marker - metrics.x_of(840.0)).abs() < 0.01);
            assert_ne!(first.y, second.y, "Captions occupy rows, without assigning a fake time duration.");
            assert!(first.caption_at_top && !second.caption_at_top, "Overlapping points put their captions at the outer edges of their rows.");
            for block in &layout.blocks { assert!(block.point && block.x >= metrics.time_x() && block.x + block.w <= metrics.time_x() + metrics.time_w() + 0.01); }
            if let Some(late) = layout.blocks.iter().find(|b| b.item == 2) { assert!(!late.caption_at_top, "A separate point keeps its caption at the bottom."); }
        }
    }

    #[test]
    fn point_captions_avoid_intervals_below_even_when_an_upper_row_is_reused() {
        let day = "2026-11-19";
        let point = || item(day, Some("10:00"), None);
        let cases = [
            (vec![point(), item(day, Some("10:01"), Some("12:00"))], true),
            (vec![item(day, Some("08:00"), Some("12:00")), point()], false),
            (vec![item(day, Some("08:00"), Some("09:00")), item(day, Some("08:30"), Some("16:00")), point()], true),
            (vec![point(), item(day, Some("18:00"), Some("19:00"))], false),
        ];
        for (mut items, expected_top) in cases {
            // Placement follows visible overlap, independently of the storage/input order.
            for _ in 0..2 {
                for open in [vec![], vec![day]] {
                    let layout = show(&items, &open);
                    let block = layout.blocks.iter().find(|b| b.point).unwrap();
                    assert_eq!(block.caption_at_top, expected_top, "Items: {items:?}");
                    assert!(layout.blocks.iter().filter(|other| !other.point).all(|other| !other.caption_at_top));
                }
                items.reverse();
            }
        }
    }

    #[test]
    fn a_long_entry_runs_down_its_lane_and_only_its_first_day_has_a_piece_of_time() {
        let layout = show(&[item("2026-11-23", Some("14:00"), Some("98:00"))], &[]);
        assert_eq!(layout.lanes.len(), 1);
        let lane = &layout.lanes[0];
        let (start, end) = (row(&layout, "2026-11-23"), row(&layout, "2026-11-27"));
        assert!(lane.y <= start.y + start.h && lane.y + lane.h >= end.y);
        assert_eq!(layout.blocks.iter().map(|b| b.time.as_str()).collect::<Vec<_>>(), ["14:00–24:00"], "Not on its last day.");
        assert!(show(&[item("2026-11-23", Some("00:00"), Some("120:00"))], &[]).blocks.is_empty(), "Whole days are only the lane.");
        assert!(show(&[item("2026-11-23", None, None)], &[]).lanes.is_empty());
    }

    #[test]
    fn overlapping_long_entries_take_their_own_lanes() {
        let layout = show(&[item("2026-11-23", Some("00:00"), Some("72:00")), item("2026-11-24", Some("00:00"), Some("72:00")), item("2026-12-02", Some("00:00"), Some("48:00"))], &[]);
        let xs: Vec<i32> = layout.lanes.iter().map(|l| l.x as i32).collect();
        assert_eq!(xs.len(), 3);
        assert_ne!(xs[0], xs[1]);
        assert_eq!(xs[2], xs[0], "A later one takes the free lane again.");
    }

    #[test]
    fn weeks_start_with_their_own_line_and_months_with_a_heading() {
        let layout = show(&[], &[]);
        let mondays: Vec<&Band> = layout.bands.iter().filter(|b| b.week_start).collect();
        assert!(mondays.iter().all(|b| b.date.weekday() == Weekday::Mon) && mondays.len() >= 2);
        assert_eq!(mondays[0].week, "KW 47");
        let month = layout.bands.iter().find(|b| b.kind == BandKind::Month).unwrap();
        assert_eq!((month.label.as_str(), month.date), ("Dezember 2026", d("2026-12-01")));
        assert_eq!(layout.title, "November 2026");
    }

    #[test]
    fn it_scrolls_endlessly_both_ways() {
        let open = BTreeSet::new();
        let none = BTreeSet::new();
        let m = Metrics::default();
        let mut state = input(&[], &open, &none);
        for _ in 0..2000 { let (top, offset) = scroll(&state, &m, 300.0); state.top = top; state.offset = offset; }
        assert!(state.top > d("2028-01-01"), "{}", state.top);
        for _ in 0..4000 { let (top, offset) = scroll(&state, &m, -300.0); state.top = top; state.offset = offset; }
        assert!(state.top < d("2025-01-01"), "{}", state.top);
        let (top, offset) = scroll(&input(&[], &open, &none), &m, m.day_h + 1.0);
        assert_eq!((top, offset), (d("2026-11-17"), 1.0));
    }

    #[test]
    fn the_hours_zoom_around_the_mouse_and_move_sideways() {
        let m = Metrics::default();
        let noon = m.x_of(720.0);
        let (zoom, pan) = zoom_hours(&m, noon, 4.0);
        let zoomed = Metrics { zoom, pan, ..m };
        assert_eq!(zoom, 4.0);
        assert!((zoomed.x_of(720.0) - noon).abs() < 0.5, "Noon stays under the mouse.");
        let layout = show_with(&[item("2026-11-19", Some("08:00"), Some("13:00"))], &[], &zoomed);
        let block = &layout.blocks[0];
        assert!(block.cut && (block.x - zoomed.time_x()).abs() < 0.01, "Cut off at the left edge of what is shown.");
        assert!(layout.ticks.windows(2).all(|pair| pair[1].x - pair[0].x >= 60.0) && layout.ticks.len() >= 3);
        assert_eq!(zoomed.clamp_pan(-30.0), 0.0);
        assert_eq!(zoomed.clamp_pan(5000.0), 1080.0, "The last six hours at the right edge.");
        assert_eq!(zoom_hours(&m, noon, 0.5).0, 1.0, "Never less than all 24 hours.");
        let hidden = show_with(&[item("2026-11-19", Some("01:00"), Some("02:00"))], &[], &zoomed);
        assert!(hidden.blocks.is_empty(), "Out of view, nothing is drawn.");
    }

    #[test]
    fn the_mouse_finds_entries_sides_and_moments() {
        let layout = show(&[item("2026-11-19", Some("12:00"), Some("18:00")), item("2026-11-19", None, None)], &[]);
        let m = Metrics::default();
        let row = row(&layout, "2026-11-19");
        let block = &layout.blocks[0];
        assert_eq!(spot(&layout, &m, block.x + 2.0, block.y + 2.0), Spot::Item(0, d("2026-11-19")));
        let dot = &layout.chips[0];
        assert_eq!(spot(&layout, &m, dot.x + 1.0, dot.y + 1.0), Spot::Item(1, d("2026-11-19")));
        assert_eq!(spot(&layout, &m, 20.0, row.y + 2.0), Spot::Side(d("2026-11-19")));
        assert_eq!(spot(&layout, &m, m.time_x() + m.time_w() * 0.25, row.y + 1.0), Spot::Time(d("2026-11-19"), 360));
        assert_eq!(spot(&layout, &m, 300.0, 3.0), Spot::Nothing, "The header is no day.");
    }

    #[test]
    fn the_keyboard_shows_on_the_side_or_in_the_hours() {
        let open = BTreeSet::new();
        let none = BTreeSet::new();
        let m = Metrics::default();
        let mut state = input(&[], &open, &none);
        state.cursor = Some(d("2026-11-19"));
        let side = layout(&state, &m);
        assert!(side.caret_side && side.caret.unwrap().0 < m.time_x());
        state.caret = Some(14 * 60);
        let hours = layout(&state, &m);
        let (x, _, w, _) = hours.caret.unwrap();
        assert!(!hours.caret_side && (x - m.x_of(840.0)).abs() < 0.01 && (w - m.time_w() / 24.0).abs() < 0.01, "An hour wide at 14:00.");
    }

    #[test]
    fn a_marked_range_snaps_to_quarter_hours_in_either_direction_and_over_days() {
        assert_eq!(marked((d("2026-11-19"), 14 * 60 + 7), (d("2026-11-19"), 14 * 60 + 7)), ((d("2026-11-19"), 840), (d("2026-11-19"), 855)), "A click is one quarter.");
        assert_eq!(marked((d("2026-11-19"), 16 * 60 + 20), (d("2026-11-19"), 14 * 60 + 50)), ((d("2026-11-19"), 885), (d("2026-11-19"), 990)));
        assert_eq!(marked((d("2026-11-20"), 120), (d("2026-11-19"), 22 * 60)), ((d("2026-11-19"), 1320), (d("2026-11-20"), 135)));
        assert_eq!(marked((d("2026-11-19"), 1440), (d("2026-11-19"), 1440)).1, (d("2026-11-19"), 1440), "The last quarter ends at midnight.");
    }
}
