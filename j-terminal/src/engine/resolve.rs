//! From what the line says to what is saved (docs/plan.md, 1.3): which kind, on which day, as one continuous entry
//! over several days (▬) or as a repetition (┆). When that is not clear, both choices come, the likelier first.
use chrono::NaiveDate;
use super::parse::{format_time, Draft, Kind, Mode};
use crate::repeat::{self, End, Rule, Unit};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub kind: Kind,
    pub text: String,
    /// The day the entry lives on (a series' first occurrence, a span's first day).
    pub day: NaiveDate,
    pub time: Option<String>,
    /// May pass midnight ("26:00") and, for a continuous span, many days ("120:00").
    pub end: Option<String>,
    pub tag: Option<String>,
    pub repeat: Option<Rule>,
    /// Further single days ("19.11., 26.11."), each an entry of its own.
    pub copies: Vec<NaiveDate>,
    pub additional: Vec<Outcome>,
    /// Set when days are involved: ▬ continuous, ┆ repeated.
    pub mode: Option<Mode>,
    /// The last day of a continuous span.
    pub last: Option<NaiveDate>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Problem {
    NoText,
    /// `\Name` that is no tag.
    UnknownTag(String),
    /// Notes have no time and do not repeat (as in the app).
    NoteWithTime,
    NoteRepeats,
    /// A repetition without any day in its span.
    NoDays,
    Unclear(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resolved {
    /// One choice, or two (▬ and ┆) when the line leaves it open; the likelier first.
    pub choices: Vec<Outcome>,
    pub problem: Option<Problem>,
}

fn hours(minutes: u32) -> String { format!("{:02}:{:02}", minutes / 60, minutes % 60) }

pub fn resolve(draft: &Draft, today: NaiveDate) -> Resolved {
    let times = |time: Option<u32>, end: Option<u32>| -> (Option<String>, Option<String>) {
        match (time, end) {
            (Some(time), Some(end)) => (Some(format_time(time)), Some(hours(if end <= time { end + 24 * 60 } else { end }))),
            (Some(time), None) => (Some(format_time(time)), None),
            _ => (None, None),
        }
    };
    let (time, end) = times(draft.time, draft.end);
    let base = Outcome {
        kind: draft.kind.unwrap_or(if draft.time.is_some() || draft.mode == Some(Mode::Continuous) { Kind::Event } else { Kind::Task }),
        text: draft.text.clone(),
        day: today,
        time: time.clone(),
        end: end.clone(),
        tag: draft.tag.clone(),
        repeat: None,
        copies: Vec::new(),
        additional: Vec::new(),
        mode: None,
        last: None,
    };

    let mut choices = Vec::new();
    if let Some((first, last)) = draft.span.filter(|(first, last)| first != last) {
        let continuous = || {
            let days = repeat::days_between(first, last) as u32;
            let start = draft.time.unwrap_or(0);
            let finish = match draft.end { Some(end) => days * 1440 + end, None => (days + 1) * 1440 };
            Outcome {
                kind: match draft.kind { Some(Kind::Task) => Kind::Task, _ => Kind::Event },
                day: first,
                time: Some(format_time(start)),
                end: Some(hours(finish.max(start + 1))),
                mode: Some(Mode::Continuous),
                last: Some(last),
                ..base.clone()
            }
        };
        let repeated = || {
            let rule = match &draft.repeat {
                Some(rule) => repeat::with_start(rule, first),
                None => Rule::new(first, Unit::Day, 1),
            };
            let rule = Rule { end: Some(End { count: None, until: Some(last) }), ..rule };
            let day = repeat::occurrences(&rule, first, last, 1).first().copied().unwrap_or(first);
            let rule = Rule { start: day, ..rule };
            Outcome { kind: draft.kind.unwrap_or(Kind::Task), day, repeat: Some(repeat::clean(&rule)), mode: Some(Mode::Repeated), ..base.clone() }
        };
        let mode = draft.mode.or(draft.repeat.as_ref().map(|_| Mode::Repeated)).or(match draft.kind {
            Some(Kind::Task) => Some(Mode::Repeated),
            Some(_) => Some(Mode::Continuous),
            None => None,
        });
        match mode {
            Some(Mode::Continuous) => choices.push(continuous()),
            Some(Mode::Repeated) => choices.push(repeated()),
            // Open: with a time each day ("Mo–Fr 9–17") a repetition is likelier, otherwise one span ("Urlaub Mo–Fr").
            None if draft.time.is_some() => { choices.push(repeated()); choices.push(continuous()); }
            None => { choices.push(continuous()); choices.push(repeated()); }
        }
    } else if let Some(rule) = &draft.repeat {
        let start = draft.span.map(|span| span.0).or(draft.dates.first().copied());
        let rule = match start { Some(start) if start > rule.start => repeat::with_start(rule, start), _ => rule.clone() };
        let day = repeat::occurrences(&rule, rule.start, repeat::shift(rule.start, 3 * 366), 1).first().copied().unwrap_or(rule.start);
        let rule = repeat::clean(&Rule { start: day, ..rule });
        choices.push(Outcome { day, repeat: Some(rule), mode: Some(Mode::Repeated), ..base.clone() });
    } else if draft.dates.len() > 1 && draft.weekdays {
        // "Sport Mo, Mi, Fr": an enumeration of weekdays is a weekly repetition.
        let mut days: Vec<u8> = draft.dates.iter().map(|day| repeat::weekday_of(*day)).collect();
        days.sort_unstable();
        days.dedup();
        let first = *draft.dates.iter().min().unwrap();
        let rule = repeat::clean(&Rule { weekdays: Some(days), ..Rule::new(first, Unit::Week, 1) });
        choices.push(Outcome { day: first, repeat: Some(rule), mode: Some(Mode::Repeated), ..base.clone() });
    } else if draft.dates.len() > 1 {
        let mut days = draft.dates.clone();
        days.sort_unstable();
        days.dedup();
        choices.push(Outcome { day: days[0], copies: days[1..].to_vec(), ..base.clone() });
    } else {
        let day = draft.dates.first().copied().or(draft.span.map(|span| span.0)).unwrap_or(today);
        if draft.mode == Some(Mode::Continuous) && draft.time.is_none() {
            choices.push(Outcome { day, time: Some("00:00".into()), end: Some("24:00".into()), mode: Some(Mode::Continuous), last: Some(day), ..base.clone() });
        } else { choices.push(Outcome { day, ..base.clone() }); }
    }

    // Disjoint calendar ranges are independent continuous entries (or bounded daily series).
    // Never bridge a removed day with an end time spanning across that gap.
    if draft.spans.len() > 1 || !draft.spans.is_empty() && !draft.dates.is_empty() {
        let mut pieces = draft.spans.clone();
        pieces.extend(draft.dates.iter().map(|day| (*day, *day)));
        pieces.sort_unstable();
        let mut merged: Vec<(NaiveDate, NaiveDate)> = Vec::new();
        for (first, last) in pieces {
            if let Some(previous) = merged.last_mut().filter(|previous| first <= repeat::shift(previous.1, 1)) { previous.1 = previous.1.max(last); }
            else { merged.push((first, last)); }
        }
        for choice in &mut choices {
            let mode = choice.mode;
            let mut parts = Vec::new();
            for (first, last) in &merged {
                let mut part = draft.clone();
                part.spans.clear(); part.dates.clear(); part.weekdays = false;
                part.span = Some((*first, *last)); part.mode = mode;
                if first == last { part.dates.push(*first); }
                let mut resolved = resolve(&part, today).choices.remove(0);
                if first == last && mode == Some(Mode::Continuous) && draft.kind.is_none() { resolved.kind = Kind::Event; }
                parts.push(resolved);
            }
            if !parts.is_empty() { let mut first = parts.remove(0); first.additional = parts; *choice = first; }
        }
    }

    let first = &choices[0];
    let problem = if !draft.unclear.is_empty() { Some(Problem::Unclear(draft.unclear.join(" "))) }
        else if draft.text.trim().is_empty() { Some(Problem::NoText) }
        else if let Some(word) = &draft.tag_word { Some(Problem::UnknownTag(word.clone())) }
        else if first.kind == Kind::Note && first.repeat.is_some() { Some(Problem::NoteRepeats) }
        else if first.kind == Kind::Note && first.time.is_some() { Some(Problem::NoteWithTime) }
        else if first.repeat.as_ref().is_some_and(|rule| repeat::occurrences(rule, rule.start, rule.start, 1).is_empty()) { Some(Problem::NoDays) }
        else { None };
    Resolved { choices, problem }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::parse::{parse, TagName};
    use crate::repeat::d;

    fn today() -> NaiveDate { d("2026-11-18") }
    fn resolved(line: &str) -> Resolved { resolve(&parse(line, today(), &[TagName { id: "t1".into(), name: "Gesundheit".into() }]), today()) }
    fn first(line: &str) -> Outcome { resolved(line).choices.remove(0) }

    #[test]
    fn plain_entries() {
        let task = first("Einkaufen");
        assert_eq!((task.kind, task.day, task.text.as_str()), (Kind::Task, today(), "Einkaufen"));
        let event = first("Zahnarzt Do 14 \\Gesundheit");
        assert_eq!((event.kind, event.day, event.time.as_deref(), event.tag.as_deref()), (Kind::Event, d("2026-11-19"), Some("14:00"), Some("t1")));
        assert_eq!(first("Aufgabe Bericht Do 9").kind, Kind::Task, "A kind given stays.");
        assert_eq!(first("Party Sa 22–2").end.as_deref(), Some("26:00"), "Past midnight.");
    }

    #[test]
    fn spans_continuous_repeated_or_both() {
        // Nothing says which: both, one span first.
        let open = resolved("Urlaub Mo–Fr");
        assert_eq!(open.choices.iter().map(|c| c.mode).collect::<Vec<_>>(), [Some(Mode::Continuous), Some(Mode::Repeated)]);
        let span = &open.choices[0];
        assert_eq!((span.kind, span.day, span.time.as_deref(), span.end.as_deref(), span.last), (Kind::Event, d("2026-11-23"), Some("00:00"), Some("120:00"), Some(d("2026-11-27"))));
        let daily = &open.choices[1];
        assert_eq!((daily.kind, daily.repeat.as_ref().map(|r| (r.unit, r.end))), (Kind::Task, Some((Unit::Day, Some(End { count: None, until: Some(d("2026-11-27")) })))));
        // With a time each day a repetition is likelier.
        assert_eq!(resolved("Kurs Mo–Fr 9–12").choices[0].mode, Some(Mode::Repeated));
        // A task repeats, an appointment spans, a hint to repeat repeats, a sign decides.
        assert_eq!(resolved("Aufgabe Lernen Mo–Fr").choices.len(), 1);
        assert_eq!(first("Aufgabe Lernen Mo–Fr").mode, Some(Mode::Repeated));
        assert_eq!(first("Termin Messe Mo–Mi").mode, Some(Mode::Continuous));
        assert_eq!(first("Lernen Mo–Fr täglich").mode, Some(Mode::Repeated));
        assert_eq!(first("Urlaub ┆ Mo–Fr").mode, Some(Mode::Repeated));
    }

    #[test]
    fn a_continuous_span_with_times() {
        let messe = first("Termin Messe Mo–Mi 9–17");
        assert_eq!((messe.time.as_deref(), messe.end.as_deref()), (Some("09:00"), Some("65:00")), "Two days and 17 hours after Monday's midnight.");
    }

    #[test]
    fn repetitions_and_enumerations() {
        let sport = first("Sport Mo, Mi, Fr 18:00");
        let rule = sport.repeat.unwrap();
        assert_eq!((rule.weekdays, sport.day, sport.mode), (Some(vec![0, 2, 4]), today(), Some(Mode::Repeated)));
        let weekly = first("Sport jeden Mo");
        assert_eq!(weekly.day, d("2026-11-23"), "The entry lives on the first occurrence.");
        let courses = first("Kurs 26.11., 19.11.");
        assert_eq!((courses.day, courses.copies), (d("2026-11-19"), vec![d("2026-11-26")]));
        let from_date = first("Yoga jeden Do ab 3.12.");
        assert_eq!(from_date.day, d("2026-12-03"));
    }

    #[test]
    fn problems() {
        assert_eq!(resolved("morgen 14").problem, Some(Problem::NoText));
        assert_eq!(resolved("Arzt \\Gesund").problem, Some(Problem::UnknownTag("Gesund".into())));
        assert_eq!(resolved("Notiz Idee 14:00").problem, Some(Problem::NoteWithTime));
        assert_eq!(resolved("Notiz Idee täglich").problem, Some(Problem::NoteRepeats));
        assert_eq!(resolved("Einkaufen morgen").problem, None);
    }
}
