//! The repetition's options (docs/input.md, "Wiederholung"): labelled lines of choices — the rhythm, every n units,
//! the days, start, end, pause, months. Inside, the keyboard moves in all directions: `↑`/`↓` between the lines,
//! `←`/`→` in a line. Lines that are one choice of several (rhythm, unit, pattern, end, pause) take the choice the
//! cursor moves to; days and months are switched with Space or digits; numbers are typed, dates move with
//! Shift+arrows or the date picker. Every confirmed change is visible in the calendar.
use chrono::NaiveDate;
use crate::repeat::{self, End, On, Pause, PauseUnit, Rule, Unit};
use crate::texts::{form_texts, Language};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slot { Presets, Every, Unit, Days, Pattern, Start, End, Count, Until, Pause, PauseOn, PauseOff, Months }

impl Slot {
    const ALL: [Slot; 13] = [Slot::Presets, Slot::Every, Slot::Unit, Slot::Days, Slot::Pattern, Slot::Start, Slot::End, Slot::Count, Slot::Until, Slot::Pause, Slot::PauseOn, Slot::PauseOff, Slot::Months];
    fn code(self) -> i32 { Slot::ALL.iter().position(|s| *s == self).unwrap() as i32 }
    fn from_code(code: i32) -> Option<Slot> { Slot::ALL.get(code as usize).copied() }
}

/// How a choice is used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PartKind {
    /// One of several: moving onto it chooses it.
    Radio,
    /// Switched on and off (a weekday, a month).
    Toggle,
    /// A number, typed or moved with Shift+arrows.
    Number,
    /// A date, moved with Shift+arrows (a day, Shift+↑/↓ a week).
    Date,
}

/// A key inside the options.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act { Left, Right, Up, Down, ShiftLeft, ShiftRight, ShiftUp, ShiftDown, Toggle, Digit(u8), Delete }

const UNITS: [Unit; 4] = [Unit::Day, Unit::Week, Unit::Month, Unit::Year];
const PRESETS: usize = 6;

/// Daily, on workdays, weekly, every two weeks, monthly, yearly.
fn preset(index: usize, start: NaiveDate) -> Option<Rule> {
    let weekly = |every| Rule { weekdays: Some(vec![repeat::weekday_of(start)]), ..Rule::new(start, Unit::Week, every) };
    match index {
        1 => Some(Rule::new(start, Unit::Day, 1)),
        2 => Some(Rule { weekdays: Some(vec![0, 1, 2, 3, 4]), ..Rule::new(start, Unit::Week, 1) }),
        3 => Some(weekly(1)),
        4 => Some(weekly(2)),
        5 => Some(Rule { on: Some(On::Date), ..Rule::new(start, Unit::Month, 1) }),
        6 => Some(Rule { on: Some(On::Date), ..Rule::new(start, Unit::Year, 1) }),
        _ => None,
    }
}

/// Which ready-made rhythm a rule is (its start and end aside).
fn preset_of(rule: &Rule) -> Option<usize> {
    let plain = |rule: &Rule| repeat::clean(&Rule { end: None, ..rule.clone() });
    (1..=PRESETS).find(|index| preset(*index, rule.start).is_some_and(|made| plain(&made) == plain(rule)))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DateField { Start, Until }

impl DateField {
    fn from_part(part: &Part) -> Option<Self> {
        match Slot::from_code(part.slot) {
            Some(Slot::Start) => Some(Self::Start),
            Some(Slot::Until) => Some(Self::Until),
            _ => None,
        }
    }

    pub fn date(self, rule: &Rule) -> NaiveDate {
        match self {
            Self::Start => rule.start,
            Self::Until => rule.end.and_then(|end| end.until).unwrap_or_else(|| repeat::shift(rule.start, 30)),
        }
    }

    pub fn apply(self, rule: &mut Rule, date: NaiveDate) {
        match self {
            Self::Start => *rule = repeat::with_start(rule, date),
            Self::Until => rule.end = Some(End { count: None, until: Some(date.max(rule.start)) }),
        }
    }
}

/// The rule as text the field understands (`repeat::text`), with its absolute start and its end.
pub fn expression(rule: &Rule, language: Language) -> String {
    let t = crate::texts::texts(language);
    let mut plain = rule.clone();
    let end = plain.end.take();
    let mut text = repeat::describe(&plain, language).replace(" · ", " ");
    text += &format!(" {} {}", t.kw_start, rule.start.format("%d.%m.%Y"));
    match end {
        Some(End { count: Some(count), .. }) => text += &format!(" {count} {}", if language == Language::En { "times" } else { "mal" }),
        Some(End { until: Some(until), .. }) => text += &format!(" {} {}", t.until_day, until.format("%d.%m.%Y")),
        _ => {}
    }
    text
}

fn set_unit(rule: &mut Rule, unit: Unit) {
    if rule.unit != unit { rule.every = 1; }
    rule.unit = unit;
    match unit {
        Unit::Week => {
            if rule.weekdays.as_ref().is_none_or(|days| days.is_empty()) { rule.weekdays = Some(vec![repeat::weekday_of(rule.start)]); }
            if let Some(pause) = &mut rule.pause { pause.unit = PauseUnit::Week; }
        }
        Unit::Month | Unit::Year => {
            if !repeat::on_choices(rule.start, unit).contains(&rule.on.unwrap_or(On::Date)) { rule.on = Some(On::Date); }
            rule.pause = None;
            if unit == Unit::Year { rule.months = None; }
        }
        Unit::Day => if let Some(pause) = &mut rule.pause { pause.unit = PauseUnit::Day; },
    }
}

/// A weekly rule starts on its first chosen weekday from `base` on (in a month it may repeat in).
fn fit_start(rule: &mut Rule, base: NaiveDate) {
    if rule.unit != Unit::Week { return; }
    let days = rule.weekdays.clone().unwrap_or_else(|| vec![repeat::weekday_of(base)]);
    if let Some(day) = (0..400).map(|n| repeat::shift(base, n)).find(|day| days.contains(&repeat::weekday_of(*day)) && repeat::in_months(rule, *day)) {
        rule.start = day;
    }
}

/// One choice in a line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Part {
    pub text: String,
    pub kind: PartKind,
    /// Chosen (the rhythm in use, a chosen weekday).
    pub selected: bool,
    /// The keyboard is here.
    pub focused: bool,
    /// For a click: which slot and which value in it.
    pub slot: i32,
    pub value: i32,
    /// A word after the choice ("an", "Wochen aus").
    pub after: String,
}

/// A labelled line of choices.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Line { pub label: String, pub icon: &'static str, pub parts: Vec<Part> }

/// Where the keyboard is in the options.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Editor {
    pub line: usize,
    pub col: usize,
    /// Digits typed into a number so far, and where.
    typed: Option<(Slot, u32)>,
}

fn part(text: impl Into<String>, kind: PartKind, slot: Slot, value: usize, selected: bool) -> Part {
    Part { text: text.into(), kind, selected, focused: false, slot: slot.code(), value: value as i32, after: String::new() }
}

/// The lines for a rule, without the keyboard's place.
fn lines(rule: Option<&Rule>, language: Language) -> Vec<Line> {
    let ft = form_texts(language);
    let current = rule.and_then(preset_of);
    let rhythm = ft.repeat_presets.iter().enumerate().map(|(i, name)| {
        part(*name, PartKind::Radio, Slot::Presets, i + 1, current == Some(i + 1))
    }).collect();
    let mut out = vec![Line { label: ft.rp_rhythm.into(), icon: "repeat", parts: rhythm }];
    let Some(rule) = rule else { return out };
    // The unit and the number are lines of their own: on the way to the number no unit is chosen by passing it.
    out.push(Line { label: ft.rp_unit.into(), icon: "calendar-fold", parts: UNITS.iter().enumerate().map(|(i, unit)| part(repeat::unit_names(*unit, language)[0], PartKind::Radio, Slot::Unit, i, *unit == rule.unit)).collect() });
    let mut every = part(rule.every.to_string(), PartKind::Number, Slot::Every, 0, false);
    every.after = repeat::unit_names(rule.unit, language)[usize::from(rule.every != 1)].to_string();
    out.push(Line { label: ft.rp_every.into(), icon: "hash", parts: vec![every] });
    match rule.unit {
        Unit::Week => {
            let days = rule.weekdays.clone().unwrap_or_else(|| vec![repeat::weekday_of(rule.start)]);
            out.push(Line { label: ft.rp_on_label.into(), icon: "calendar-days", parts: repeat::weekday_short(language).iter().enumerate().map(|(i, name)| part(*name, PartKind::Toggle, Slot::Days, i, days.contains(&(i as u8)))).collect() });
        }
        Unit::Month | Unit::Year => {
            let on = rule.on.unwrap_or(On::Date);
            out.push(Line { label: ft.rp_on_label.into(), icon: "calendar-days", parts: repeat::on_choices(rule.start, rule.unit).iter().enumerate().map(|(i, choice)| part(repeat::on_label(rule, *choice, language), PartKind::Radio, Slot::Pattern, i, *choice == on)).collect() });
        }
        Unit::Day => {}
    }
    let start = format!("{} {}", repeat::weekday_short(language)[repeat::weekday_of(rule.start) as usize], rule.start.format("%d.%m.%Y"));
    out.push(Line { label: ft.rp_from.into(), icon: "calendar-arrow-up", parts: vec![part(start, PartKind::Date, Slot::Start, 0, true)] });
    let mode = match rule.end { Some(End { count: Some(_), .. }) => 1, Some(End { until: Some(_), .. }) => 2, _ => 0 };
    let count = rule.end.and_then(|end| end.count).unwrap_or(10);
    let until = DateField::Until.date(rule);
    let mut times = part(count.to_string(), PartKind::Number, Slot::Count, 1, mode == 1);
    times.after = ft.rp_times.into();
    out.push(Line { label: ft.rp_until.into(), icon: "flag", parts: vec![
        part(ft.rp_never, PartKind::Radio, Slot::End, 0, mode == 0), times, part(until.format("%d.%m.%Y").to_string(), PartKind::Date, Slot::Until, 2, mode == 2),
    ] });
    if matches!(rule.unit, Unit::Day | Unit::Week) {
        let unit = repeat::unit_names(if rule.unit == Unit::Week { Unit::Week } else { Unit::Day }, language);
        let mut parts = vec![part(if rule.pause.is_some() { ft.rp_on_word } else { ft.rp_off_word }, PartKind::Toggle, Slot::Pause, 0, rule.pause.is_some())];
        if let Some(p) = rule.pause {
            let mut on = part(p.on.to_string(), PartKind::Number, Slot::PauseOn, 0, false);
            on.after = format!("{} {},", unit[usize::from(p.on != 1)], ft.rp_on_word);
            let mut off = part(p.off.to_string(), PartKind::Number, Slot::PauseOff, 0, false);
            off.after = format!("{} {}", unit[usize::from(p.off != 1)], ft.rp_off_word);
            parts.extend([on, off]);
        }
        out.push(Line { label: ft.rp_pause.into(), icon: "pause", parts });
    }
    if rule.unit != Unit::Year {
        let months = rule.months.clone().unwrap_or_default();
        let names = repeat::month_short(language);
        for half in 0..2 {
            out.push(Line { label: if half == 0 { ft.rp_only_in.into() } else { String::new() }, icon: if half == 0 { "calendar-range" } else { "" },
                parts: (half * 6..half * 6 + 6).map(|i| part(names[i], PartKind::Toggle, Slot::Months, i, months.contains(&(i as u8 + 1)))).collect() });
        }
    }
    out
}

impl Editor {
    /// Into the options: the rhythm in use has the keyboard.
    pub fn enter(&mut self, rule: Option<&Rule>) {
        *self = Editor { col: rule.and_then(preset_of).unwrap_or(1) - 1, ..Editor::default() };
    }

    pub fn view(&self, rule: Option<&Rule>, language: Language) -> Vec<Line> {
        let mut lines = lines(rule, language);
        let line = self.line.min(lines.len() - 1);
        let col = self.col.min(lines[line].parts.len() - 1);
        lines[line].parts[col].focused = true;
        lines
    }

    fn focused(&self, rule: Option<&Rule>) -> Part {
        let lines = lines(rule, Language::De);
        let line = self.line.min(lines.len() - 1);
        lines[line].parts[self.col.min(lines[line].parts.len() - 1)].clone()
    }

    pub fn date_field(&self, rule: Option<&Rule>) -> Option<DateField> {
        DateField::from_part(&self.focused(rule))
    }

    /// A key in the options; the rule changes at once.
    pub fn act(&mut self, rule: &mut Option<Rule>, base: NaiveDate, act: Act) {
        let count = lines(rule.as_ref(), Language::De).len();
        self.line = self.line.min(count - 1);
        match act {
            Act::Up | Act::Down => {
                let next = (self.line as i32 + if act == Act::Down { 1 } else { -1 }).clamp(0, count as i32 - 1) as usize;
                if next != self.line {
                    self.line = next;
                    self.typed = None;
                    // In a line of one choice the keyboard lands on the chosen one.
                    let parts = &lines(rule.as_ref(), Language::De)[next].parts;
                    self.col = parts.iter().position(|p| p.kind != PartKind::Toggle && p.selected)
                        .unwrap_or(self.col.min(parts.len() - 1));
                }
            }
            Act::Left | Act::Right => {
                let parts = lines(rule.as_ref(), Language::De)[self.line].parts.clone();
                if rule.is_none() && act == Act::Right {
                    self.choose(rule, base, &parts[self.col]);
                    return;
                }
                let next = (self.col as i32 + if act == Act::Right { 1 } else { -1 }).clamp(0, parts.len() as i32 - 1) as usize;
                if next != self.col {
                    self.col = next;
                    self.typed = None;
                    // A choice of one of several is taken by moving onto it (the end's count and date are such choices too).
                    let end_mode = matches!(Slot::from_code(parts[next].slot), Some(Slot::End | Slot::Count | Slot::Until));
                    if parts[next].kind == PartKind::Radio || end_mode { self.choose(rule, base, &parts[next]); }
                }
            }
            Act::Toggle => { let focused = self.focused(rule.as_ref()); self.choose(rule, base, &focused); }
            Act::ShiftLeft | Act::ShiftRight | Act::ShiftUp | Act::ShiftDown => {
                let step: i64 = match act { Act::ShiftLeft => -1, Act::ShiftRight => 1, Act::ShiftUp => 7, _ => -7 };
                let focused = self.focused(rule.as_ref());
                let Some(r) = rule.as_mut() else { return };
                match Slot::from_code(focused.slot) {
                    Some(Slot::Start | Slot::Until) => {
                        let field = DateField::from_part(&focused).unwrap();
                        field.apply(r, repeat::shift(field.date(r), step));
                    }
                    Some(slot @ (Slot::Every | Slot::Count | Slot::PauseOn | Slot::PauseOff)) => {
                        let step = step.signum() as i32;
                        self.set_number(r, slot, |value| (value as i32 + step).max(1) as u32);
                    }
                    _ => {}
                }
            }
            Act::Digit(digit) => {
                let focused = self.focused(rule.as_ref());
                if self.line == 0 && (1..=PRESETS).contains(&(digit as usize)) {
                    self.col = digit as usize - 1;
                    let choice = self.focused(rule.as_ref());
                    self.choose(rule, base, &choice);
                    return;
                }
                let Some(r) = rule.as_mut() else { return };
                match Slot::from_code(focused.slot) {
                    Some(slot @ (Slot::Every | Slot::Count | Slot::PauseOn | Slot::PauseOff)) => {
                        let typed = match self.typed { Some((at, value)) if at == slot => value * 10 + digit as u32, _ => digit as u32 };
                        let typed = if typed > 999 { digit as u32 } else { typed };
                        self.typed = Some((slot, typed));
                        self.set_number(r, slot, |_| typed.max(1));
                    }
                    Some(Slot::Days) if (1..=7).contains(&digit) => { self.col = digit as usize - 1; let p = lines(rule.as_ref(), Language::De)[self.line].parts[self.col].clone(); self.choose(rule, base, &p); }
                    _ => {}
                }
            }
            Act::Delete => {
                let focused = self.focused(rule.as_ref());
                match Slot::from_code(focused.slot) {
                    Some(Slot::Presets) => { *rule = None; self.line = 0; self.col = 0; }
                    Some(Slot::End | Slot::Count | Slot::Until) => if let Some(r) = rule { r.end = None; },
                    Some(Slot::Pause | Slot::PauseOn | Slot::PauseOff) => if let Some(r) = rule { r.pause = None; },
                    Some(Slot::Months) => if let Some(r) = rule { r.months = None; },
                    Some(Slot::Start) => if let Some(r) = rule { *r = repeat::with_start(r, base); },
                    _ => {}
                }
            }
        }
    }

    fn set_number(&mut self, rule: &mut Rule, slot: Slot, change: impl Fn(u32) -> u32) {
        match slot {
            Slot::Every => rule.every = change(rule.every).min(99),
            Slot::Count => rule.end = Some(End { count: Some(change(rule.end.and_then(|end| end.count).unwrap_or(10)).min(999)), until: None }),
            Slot::PauseOn | Slot::PauseOff => {
                let unit = if rule.unit == Unit::Week { PauseUnit::Week } else { PauseUnit::Day };
                let pause = rule.pause.get_or_insert(Pause { on: 3, off: 1, unit });
                if slot == Slot::PauseOn { pause.on = change(pause.on).min(99); } else { pause.off = change(pause.off).min(99); }
            }
            _ => {}
        }
    }

    /// A click: the keyboard goes there and the choice is taken.
    pub fn click(&mut self, rule: &mut Option<Rule>, base: NaiveDate, slot: i32, value: i32) -> Option<DateField> {
        let all = lines(rule.as_ref(), Language::De);
        for (l, line) in all.iter().enumerate() {
            if let Some(c) = line.parts.iter().position(|p| p.slot == slot && p.value == value) {
                self.line = l; self.col = c; self.typed = None;
                let p = line.parts[c].clone();
                if let Some(date) = DateField::from_part(&p) { return Some(date); }
                self.choose(rule, base, &p);
                return None;
            }
        }
        None
    }

    /// Taking a choice: a rhythm, a unit, a pattern, an end; switching a day, a month, the pause.
    fn choose(&mut self, rule: &mut Option<Rule>, base: NaiveDate, part: &Part) {
        let start = rule.as_ref().map_or(base, |rule| rule.start);
        let value = part.value.max(0) as usize;
        let Some(slot) = Slot::from_code(part.slot) else { return };
        if slot == Slot::Presets {
            let end = rule.as_ref().and_then(|rule| rule.end);
            *rule = preset(value, start).map(|mut made| { made.end = end; fit_start(&mut made, start.min(base)); made });
            return;
        }
        let Some(r) = rule.as_mut() else { return };
        match slot {
            Slot::Unit => { set_unit(r, UNITS[value.min(3)]); fit_start(r, base); }
            Slot::Days => {
                let mut days = r.weekdays.clone().unwrap_or_else(|| vec![repeat::weekday_of(r.start)]);
                let day = value as u8;
                if days.contains(&day) { if days.len() > 1 { days.retain(|d| *d != day); } } else { days.push(day); days.sort_unstable(); }
                r.weekdays = Some(days);
                fit_start(r, base);
            }
            Slot::Pattern => { let choices = repeat::on_choices(r.start, r.unit); r.on = choices.get(value).copied().or(Some(On::Date)); }
            Slot::End => r.end = None,
            Slot::Count => r.end = Some(End { count: Some(r.end.and_then(|end| end.count).unwrap_or(10)), until: None }),
            Slot::Until => r.end = Some(End { count: None, until: Some(r.end.and_then(|end| end.until).unwrap_or_else(|| repeat::shift(r.start, 30))) }),
            Slot::Pause => {
                let unit = if r.unit == Unit::Week { PauseUnit::Week } else { PauseUnit::Day };
                r.pause = if r.pause.is_some() { None } else { Some(Pause { on: 3, off: 1, unit }) };
            }
            Slot::Months => {
                let month = value as u8 + 1;
                let mut months = r.months.clone().unwrap_or_default();
                if months.contains(&month) { months.retain(|m| *m != month); } else { months.push(month); months.sort_unstable(); }
                r.months = (!months.is_empty() && months.len() < 12).then_some(months);
                fit_start(r, base);
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repeat::d;

    fn base() -> NaiveDate { d("2026-11-18") } // A Wednesday.

    #[test]
    fn the_ready_made_rhythms_are_recognised_again() {
        for index in 1..=PRESETS {
            let rule = preset(index, base()).unwrap();
            assert_eq!(preset_of(&rule), Some(index), "{index}");
        }
        assert_eq!(preset_of(&Rule::new(base(), Unit::Day, 3)), None);
    }

    #[test]
    fn moving_along_the_rhythms_takes_them_at_once() {
        let (mut editor, mut rule) = (Editor::default(), None);
        editor.enter(rule.as_ref());
        editor.act(&mut rule, base(), Act::Right);
        assert_eq!(rule.as_ref().map(|r| r.unit), Some(Unit::Day));
        assert_eq!(editor.view(rule.as_ref(), Language::De)[0].parts.iter().map(|p| p.text.as_str()).collect::<Vec<_>>(), ["D", "M-F", "W", "2W", "M", "Y"]);
        editor.act(&mut rule, base(), Act::Right);
        assert_eq!(rule.as_ref().unwrap().weekdays, Some(vec![0, 1, 2, 3, 4]));
        editor.act(&mut rule, base(), Act::Left);
        editor.act(&mut rule, base(), Act::Left);
        assert_eq!(rule.as_ref().map(|r| r.unit), Some(Unit::Day));
        editor.act(&mut rule, base(), Act::Delete);
        assert!(rule.is_none(), "Reset the rhythm.");
    }

    #[test]
    fn up_and_down_go_between_the_lines_and_land_on_the_choice() {
        let mut rule = preset(3, base());
        let mut editor = Editor::default();
        editor.enter(rule.as_ref());
        let labels: Vec<String> = editor.view(rule.as_ref(), Language::De).into_iter().map(|line| line.label).collect();
        assert_eq!(labels, ["Rhythmus", "Einheit", "Alle", "Am", "Ab", "Bis", "Pause", "Nur in", ""]);
        editor.act(&mut rule, base(), Act::Down);
        assert_eq!((editor.line, editor.col), (1, 1), "On Woche, the unit in use.");
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        editor.act(&mut rule, base(), Act::Down);
        assert_eq!(editor.line, 8, "It stops at the last line.");
    }

    #[test]
    fn days_numbers_units_and_the_end_are_set_in_their_lines() {
        let mut rule = preset(3, base());
        let mut editor = Editor::default();
        editor.enter(rule.as_ref());
        editor.act(&mut rule, base(), Act::Down); // unit
        editor.act(&mut rule, base(), Act::Down); // every
        editor.act(&mut rule, base(), Act::Digit(2));
        assert_eq!(rule.as_ref().unwrap().every, 2, "The number is typed.");
        editor.act(&mut rule, base(), Act::ShiftUp);
        assert_eq!(rule.as_ref().unwrap().every, 3, "Shift+↑ counts up.");
        editor.act(&mut rule, base(), Act::Down); // days
        editor.act(&mut rule, base(), Act::Digit(1));
        editor.act(&mut rule, base(), Act::Digit(4));
        assert_eq!(rule.as_ref().unwrap().weekdays, Some(vec![0, 2, 3]), "Monday and Thursday joined Wednesday.");
        editor.act(&mut rule, base(), Act::Toggle);
        assert_eq!(rule.as_ref().unwrap().weekdays, Some(vec![0, 2]), "Space switches the day under the cursor (Thursday).");
        editor.act(&mut rule, base(), Act::Down); // start
        editor.act(&mut rule, base(), Act::ShiftRight);
        editor.act(&mut rule, base(), Act::Down); // end
        editor.act(&mut rule, base(), Act::Right);
        assert_eq!(rule.as_ref().unwrap().end, Some(End { count: Some(10), until: None }), "Moving onto the count chooses it.");
        editor.act(&mut rule, base(), Act::Digit(5));
        assert_eq!(rule.as_ref().unwrap().end.unwrap().count, Some(5));
        editor.act(&mut rule, base(), Act::Right);
        assert!(rule.as_ref().unwrap().end.unwrap().until.is_some());
        editor.act(&mut rule, base(), Act::Delete);
        assert!(rule.as_ref().unwrap().end.is_none());
    }

    #[test]
    fn pauses_and_months_are_lines_of_their_own() {
        let mut rule = preset(1, base());
        let mut editor = Editor::default();
        editor.click(&mut rule, base(), Slot::Pause.code(), 0);
        assert_eq!(rule.as_ref().unwrap().pause.map(|p| (p.on, p.off)), Some((3, 1)));
        editor.act(&mut rule, base(), Act::Right);
        editor.act(&mut rule, base(), Act::Digit(4));
        assert_eq!(rule.as_ref().unwrap().pause.unwrap().on, 4);
        editor.click(&mut rule, base(), Slot::Months.code(), 0);
        editor.click(&mut rule, base(), Slot::Months.code(), 6);
        assert_eq!(rule.as_ref().unwrap().months, Some(vec![1, 7]));
        editor.act(&mut rule, base(), Act::Delete);
        assert_eq!(rule.as_ref().unwrap().months, None);
    }

    #[test]
    fn the_view_marks_the_keyboard_and_the_choices() {
        let rule = preset(3, base());
        let mut editor = Editor::default();
        editor.enter(rule.as_ref());
        let lines = editor.view(rule.as_ref(), Language::De);
        assert!(lines[0].parts[2].selected && lines[0].parts[2].focused, "Weekly is in use and focused.");
        assert_eq!(lines[1].parts.iter().map(|p| p.text.as_str()).collect::<Vec<_>>(), ["Tag", "Woche", "Monat", "Jahr"]);
        assert_eq!((lines[2].parts[0].text.as_str(), lines[2].parts[0].after.as_str()), ("1", "Woche"));
        assert!(lines[3].parts.iter().any(|p| p.text == "Mi" && p.selected));
        assert!(lines[5].parts[0].selected, "Ends never.");
        assert_eq!(editor.view(None, Language::De).len(), 1, "Only the rhythms when no rule is active.");
        assert!(lines.iter().all(|line| line.icon.is_empty() || crate::icons::exists(line.icon)));
        assert!(expression(rule.as_ref().unwrap(), Language::De).contains("ab 18.11.2026"));
    }
}
