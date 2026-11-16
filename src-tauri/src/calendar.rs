//! Portable ICS interchange. Storage and the native journal recurrence rules are unchanged.
use chrono::{DateTime, Duration, Local, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use ical::{parser::ical::component::IcalAlarm, property::Property};
use rrule::RRuleSet;
use serde_json::{json, Value};
use std::collections::HashSet;

type Result<T> = std::result::Result<T, String>;
fn value<'a>(props: &'a [Property], name: &str) -> &'a str {
    props
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .and_then(|p| p.value.as_deref())
        .unwrap_or("")
}
fn param<'a>(p: &'a Property, key: &str) -> Option<&'a str> {
    p.params
        .as_ref()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))?
        .1
        .first()
        .map(String::as_str)
}
fn text(s: &str) -> String {
    let mut out = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => out.push('\n'),
                Some(c) => out.push(c),
                None => out.push('\\'),
            }
        } else {
            out.push(c)
        }
    }
    out
}
fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\r', "")
        .replace('\n', "\\n")
        .replace(';', "\\;")
        .replace(',', "\\,")
}
fn raw(p: &Property) -> String {
    let mut s = p.name.clone();
    if let Some(params) = &p.params {
        for (k, v) in params {
            s += &format!(";{}={}", k, v.join(","));
        }
    }
    s + ":" + p.value.as_deref().unwrap_or("")
}
fn date(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|e| e.to_string())
}
fn naive(s: &str) -> Result<NaiveDateTime> {
    if s.len() == 8 {
        NaiveDate::parse_from_str(s, "%Y%m%d")
            .map(|d| d.and_hms_opt(0, 0, 0).unwrap())
            .map_err(|e| e.to_string())
    } else {
        NaiveDateTime::parse_from_str(s.trim_end_matches('Z'), "%Y%m%dT%H%M%S")
            .map_err(|e| e.to_string())
    }
}
fn instant(p: &Property) -> Result<DateTime<Utc>> {
    let s = p.value.as_deref().unwrap_or("");
    let n = naive(s)?;
    if s.ends_with('Z') {
        return Ok(n.and_utc());
    }
    if let Some(tz) = param(p, "TZID").filter(|s| *s != "floating") {
        let zone: chrono_tz::Tz = tz
            .parse()
            .map_err(|_| format!("Ungültige Zeitzone: {tz}"))?;
        return zone
            .from_local_datetime(&n)
            .earliest()
            .map(|v| v.with_timezone(&Utc))
            .ok_or_else(|| format!("Ungültige Uhrzeit in Zeitzone {tz}."));
    }
    Local
        .from_local_datetime(&n)
        .earliest()
        .map(|v| v.with_timezone(&Utc))
        .ok_or_else(|| "Ungültige Uhrzeit".into())
}
fn local(p: &Property, zone: &str) -> Result<NaiveDateTime> {
    let s = p.value.as_deref().unwrap_or("");
    if s.len() == 8 || (!s.ends_with('Z') && param(p, "TZID").is_none()) {
        return naive(s);
    }
    let i = instant(p)?;
    if let Ok(tz) = zone.parse::<chrono_tz::Tz>() {
        Ok(i.with_timezone(&tz).naive_local())
    } else {
        Ok(i.with_timezone(&Local).naive_local())
    }
}
/// Embedded timezone definitions take precedence over the platform database, including Outlook's custom TZIDs.
fn local_calendar(
    p: &Property,
    zone: &str,
    zones: &[ical::parser::ical::component::IcalTimeZone],
) -> Result<NaiveDateTime> {
    let Some(tz) =
        param(p, "TZID").and_then(|id| zones.iter().find(|z| value(&z.properties, "TZID") == id))
    else {
        return local(p, zone);
    };
    let wall = naive(p.value.as_deref().unwrap_or(""))?;
    let mut latest = None;
    let mut initial = None;
    for transition in &tz.transitions {
        let props = &transition.properties;
        let offset = |name: &str| -> Result<i64> {
            let s = value(props, name);
            if (s.len() != 5 && s.len() != 7)
                || !s.is_ascii()
                || !s.starts_with(['+', '-'])
                || !s[1..].bytes().all(|b| b.is_ascii_digit())
            {
                return Err("Ungültiger Zeitzonenoffset".into());
            }
            let h: i64 = s[1..3].parse().map_err(|_| "Ungültiger Zeitzonenoffset")?;
            let m: i64 = s[3..5].parse().map_err(|_| "Ungültiger Zeitzonenoffset")?;
            let seconds = if s.len() == 7 {
                s[5..7]
                    .parse::<i64>()
                    .map_err(|_| "Ungültiger Zeitzonenoffset")?
            } else {
                0
            };
            Ok((h * 3600 + m * 60 + seconds) * if s.starts_with('-') { -1 } else { 1 })
        };
        let first = naive(value(props, "DTSTART"))?;
        if initial.is_none_or(|(d, _)| first < d) {
            initial = Some((first, offset("TZOFFSETFROM")?))
        }
        let dates = if props.iter().any(|p| p.name == "RRULE" || p.name == "RDATE") {
            recurrence(props, &wall.date().to_string(), 20000)?
        } else {
            vec![value(props, "DTSTART").to_string()]
        };
        for d in dates {
            let d = naive(&d)?;
            if d <= wall && latest.is_none_or(|(last, _)| d > last) {
                latest = Some((d, offset("TZOFFSETTO")?))
            }
        }
    }
    let seconds = latest.or(initial).ok_or("Leere Zeitzonendefinition")?.1;
    let mut utc = p.clone();
    utc.params = None;
    utc.value = Some(format!(
        "{}Z",
        (wall - Duration::seconds(seconds)).format("%Y%m%dT%H%M%S")
    ));
    local(&utc, zone)
}
fn component(ics: &str) -> Result<Vec<Property>> {
    let wrapped = if ics.trim_start().starts_with("BEGIN:VCALENDAR") {
        ics.to_owned()
    } else {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{ics}\r\nEND:VCALENDAR")
    };
    let c = ical::IcalParser::new(wrapped.as_bytes())
        .next()
        .ok_or("Ungültiger Kalender")?
        .map_err(|e| e.to_string())?;
    c.events
        .first()
        .map(|e| e.properties.clone())
        .ok_or_else(|| "Kein Ereignis".into())
}
// Evaluate in wall-clock time: this preserves DTSTART's day and hour over DST transitions.
fn recurrence(props: &[Property], to: &str, max: usize) -> Result<Vec<String>> {
    recurrence_range(props, to, max, None)
}
fn recurrence_range(
    props: &[Property],
    to: &str,
    max: usize,
    range: Option<(&str, usize)>,
) -> Result<Vec<String>> {
    let mut lines = Vec::new();
    let start = props
        .iter()
        .find(|p| p.name == "DTSTART")
        .ok_or("Kein DTSTART")?;
    let wall = |p: &Property, s: &str| -> Result<String> {
        let n = if s.len() == 8 {
            naive(s)?
        } else if s.ends_with('Z') && !start.value.as_deref().unwrap_or("").ends_with('Z') {
            let i = naive(s)?.and_utc();
            if let Some(tz) = param(start, "TZID").and_then(|s| s.parse::<chrono_tz::Tz>().ok()) {
                i.with_timezone(&tz).naive_local()
            } else {
                i.with_timezone(&Local).naive_local()
            }
        } else if param(p, "TZID") != param(start, "TZID") && param(p, "TZID").is_some() {
            let mut property = p.clone();
            property.value = Some(s.into());
            let i = instant(&property)?;
            if let Some(tz) = param(start, "TZID").and_then(|s| s.parse::<chrono_tz::Tz>().ok()) {
                i.with_timezone(&tz).naive_local()
            } else {
                i.naive_utc()
            }
        } else {
            naive(s)?
        };
        Ok(format!("{}Z", n.format("%Y%m%dT%H%M%S")))
    };
    for p in props
        .iter()
        .filter(|p| ["DTSTART", "RRULE", "RDATE", "EXDATE"].contains(&p.name.as_str()))
    {
        let mut v = p.value.clone().unwrap_or_default();
        if p.name == "RRULE" {
            let freq = v
                .split(';')
                .find_map(|v| v.strip_prefix("FREQ="))
                .unwrap_or("");
            if !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].contains(&freq) {
                return Err(
                    "Serien mit stündlichen oder kürzeren Abständen werden nicht unterstützt."
                        .into(),
                );
            }
            // rrule requires DATE-TIME values; date-only UNTIL is inclusive.
            v = v
                .split(';')
                .map(|part| {
                    if part.starts_with("UNTIL=") && part.len() == 14 {
                        format!("{part}T235959Z")
                    } else if let Some(s) = part.strip_prefix("UNTIL=") {
                        format!("UNTIL={}", wall(start, s).unwrap_or_else(|_| s.into()))
                    } else {
                        part.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join(";");
        } else {
            v = v
                .split(',')
                .map(|s| wall(p, s))
                .collect::<Result<Vec<_>>>()?
                .join(",");
        }
        lines.push(format!("{}:{}", p.name, v));
    }
    let set: RRuleSet = lines
        .join("\n")
        .parse()
        .map_err(|e| format!("Ungültige Wiederholung: {e}"))?;
    let mut result = Vec::new();
    let mut days = HashSet::new();
    for (index, dt) in set.limit().into_iter().enumerate() {
        if index >= max {
            return Err("Wiederholung zu groß".into());
        }
        let s = dt.format("%Y%m%dT%H%M%S").to_string();
        if dt.format("%Y-%m-%d").to_string().as_str() > to {
            break;
        }
        let day = dt.format("%Y-%m-%d").to_string();
        if range.is_none_or(|(from, _)| day.as_str() >= from) {
            result.push(s);
            days.insert(day);
            if range.is_some_and(|(_, limit)| days.len() >= limit) {
                break;
            }
        }
    }
    Ok(result)
}
#[tauri::command]
pub fn calendar_occurrences(
    ics: String,
    from: String,
    to: String,
    limit: usize,
    until: Option<String>,
) -> Result<Vec<String>> {
    date(&from)?;
    date(&to)?;
    if limit == 0 || from > to {
        return Ok(Vec::new());
    }
    if ics.len() > 3000 {
        return Err("Die Wiederholungsregel enthält zu viele Ausnahmen.".into());
    }
    let props = component(&ics)?;
    let mut out = Vec::new();
    for s in recurrence_range(
        &props,
        until.as_deref().map_or(to.as_str(), |u| u.min(&to)),
        200000,
        Some((&from, limit.min(5000))),
    )? {
        let d = naive(&s)?.date().to_string();
        if d >= from && out.last() != Some(&d) {
            out.push(d)
        }
        if out.len() >= limit.min(5000) {
            break;
        }
    }
    Ok(out)
}
#[tauri::command]
pub fn calendar_with_start(ics: String, start: String) -> Result<String> {
    let day = date(&start)?.format("%Y%m%d").to_string();
    let mut props = component(&ics)?;
    let p = props
        .iter_mut()
        .find(|p| p.name == "DTSTART")
        .ok_or("Kein DTSTART")?;
    let old = p.value.as_deref().ok_or("Kein DTSTART")?;
    naive(old)?;
    p.value = Some(format!("{day}{}", &old[8..]));
    Ok(format!(
        "BEGIN:VEVENT\r\n{}\r\nEND:VEVENT",
        props.iter().map(raw).collect::<Vec<_>>().join("\r\n")
    ))
}
fn lead(props: &[Property], alarms: &[IcalAlarm]) -> i64 {
    if let Ok(n) = value(props, "X-JOURNAL-REMINDER-BEFORE").parse::<f64>() {
        if n > 0. && n.is_finite() {
            return (n.round() as i64).min(43200);
        }
    }
    let trigger = alarms
        .first()
        .map(|a| value(&a.properties, "TRIGGER"))
        .unwrap_or("");
    if !trigger.starts_with('-') {
        return 0;
    }
    (duration(trigger).num_seconds().unsigned_abs() as f64 / 60.)
        .round()
        .min(43200.) as i64
}
fn duration(s: &str) -> Duration {
    let mut n = String::new();
    let mut seconds: i64 = 0;
    for c in s.chars() {
        if c.is_ascii_digit() {
            n.push(c)
        } else {
            let v = if n.is_empty() {
                0
            } else {
                n.parse::<i64>().unwrap_or(31536000).min(31536000)
            };
            n.clear();
            let amount = v * match c {
                'W' => 604800,
                'D' => 86400,
                'H' => 3600,
                'M' => 60,
                'S' => 1,
                _ => 0,
            };
            seconds = seconds.saturating_add(amount).min(9_000_000_000_000);
        }
    }
    Duration::seconds(if s.starts_with('-') {
        -seconds
    } else {
        seconds
    })
}
fn notice(notices: &mut Vec<String>, s: impl Into<String>) {
    let s = s.into();
    if !notices.contains(&s) {
        notices.push(s)
    }
}
fn color(s: &str) -> String {
    if s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit()) {
        if s.len() == 4 {
            return format!(
                "#{}",
                s[1..].chars().flat_map(|c| [c, c]).collect::<String>()
            );
        }
        if s.len() == 7 || s.len() == 9 {
            return s[..7].into();
        }
    }
    match s.to_lowercase().as_str() {
        "red" => "#ff0000",
        "blue" => "#0000ff",
        "green" => "#008000",
        "yellow" => "#ffff00",
        "orange" => "#ffa500",
        "purple" => "#800080",
        "pink" => "#ffc0cb",
        "black" => "#000000",
        "white" => "#ffffff",
        "gray" | "grey" => "#808080",
        "cyan" => "#00ffff",
        "magenta" => "#ff00ff",
        "lime" => "#00ff00",
        "navy" => "#000080",
        "teal" => "#008080",
        "violet" => "#ee82ee",
        _ => "#5599ee",
    }
    .into()
}
#[tauri::command]
pub fn calendar_import(
    content: String,
    year: i32,
    timezone: String,
    labels: Option<Value>,
) -> Result<Value> {
    let untitled = labels
        .as_ref()
        .and_then(|v| v["untitled"].as_str())
        .unwrap_or("Ohne Titel");
    if content.len() > 5_000_000 {
        return Err("Die ICS-Datei ist zu groß (höchstens 5 MB).".into());
    }
    if !(2..=9996).contains(&year) {
        return Err("Ungültiges Jahr".into());
    }
    let mut parser = ical::IcalParser::new(content.trim_start_matches('\u{feff}').as_bytes());
    let calendar = parser
        .next()
        .ok_or("Keine gültige iCalendar-2.0-Datei.")?
        .map_err(|e| e.to_string())?;
    if parser.next().is_some() || value(&calendar.properties, "VERSION") != "2.0" {
        return Err("Keine gültige iCalendar-2.0-Datei.".into());
    }
    let mut events: Vec<_> = calendar
        .events
        .iter()
        .map(|e| (e.properties.clone(), e.alarms.clone(), false))
        .collect();
    events.extend(
        calendar
            .todos
            .iter()
            .map(|e| (e.properties.clone(), e.alarms.clone(), true)),
    );
    if events.is_empty() {
        return Err("Die Datei enthält keine Ereignisse oder Aufgaben.".into());
    }
    let mut entries = Vec::new();
    let mut notices = Vec::new();
    let mut ids = HashSet::new();
    let horizon = format!("{}-12-31", year + 2);
    let from = format!("{}-01-01", year - 1);
    for (original, alarms, todo) in &events {
        let mut props = original.clone();
        let uid = value(&props, "UID").to_owned();
        if uid.is_empty() {
            return Err("Ein Eintrag hat keine UID. Es wurde nichts importiert.".into());
        }
        if !value(&props, "RECURRENCE-ID").is_empty()
            && events
                .iter()
                .any(|(p, _, _)| value(p, "UID") == uid && value(p, "RECURRENCE-ID").is_empty())
        {
            continue;
        }
        if !props.iter().any(|p| p.name == "DTSTART") {
            if let Some(p) = props.iter().find(|p| p.name == "DUE") {
                let mut p = p.clone();
                p.name = "DTSTART".into();
                props.push(p)
            }
        }
        let startprop = props
            .iter()
            .find(|p| p.name == "DTSTART")
            .ok_or("Ein Eintrag hat kein Datum. Es wurde nichts importiert.")?;
        let all_day = startprop.value.as_deref().unwrap_or("").len() == 8;
        let start_naive = naive(startprop.value.as_deref().unwrap_or(""))?;
        let endprop = props.iter().find(|p| p.name == "DTEND");
        let delta = if let Some(p) = endprop {
            naive(p.value.as_deref().unwrap_or(""))? - start_naive
        } else if !value(&props, "DURATION").is_empty() {
            duration(value(&props, "DURATION"))
        } else {
            Duration::days(if all_day { 1 } else { 0 })
        };
        if delta < Duration::zero() {
            return Err("Ein Termin enthält ein ungültiges Datum oder Ende.".into());
        }
        let recurring = props.iter().any(|p| p.name == "RRULE" || p.name == "RDATE");
        let series = uuid::Uuid::new_v4().to_string();
        let mut master: Vec<_> = props
            .iter()
            .filter(|p| ["DTSTART", "RRULE", "RDATE", "EXDATE"].contains(&p.name.as_str()))
            .cloned()
            .collect();
        for (p, _, _) in &events {
            if value(p, "UID") == uid {
                if let Some(r) = p.iter().find(|p| p.name == "RECURRENCE-ID") {
                    let mut r = r.clone();
                    r.name = "EXDATE".into();
                    master.push(r)
                }
            }
        }
        let rule_ics = format!(
            "BEGIN:VEVENT\r\n{}\r\nEND:VEVENT",
            master.iter().map(raw).collect::<Vec<_>>().join("\r\n")
        );
        if recurring && rule_ics.len() > 3000 {
            return Err("Die Wiederholungsregel enthält zu viele Ausnahmen.".into());
        }
        let mut rule = json!({"start":local_calendar(startprop,&timezone,&calendar.timezones)?.date().to_string(),"unit":"day","every":1,"ics":rule_ics,"icsUid":uid});
        for part in value(&props, "RRULE").split(';') {
            if let Some((k, v)) = part.split_once('=') {
                match k {
                    "FREQ" => {
                        rule["unit"] = json!(match v {
                            "WEEKLY" => "week",
                            "MONTHLY" => "month",
                            "YEARLY" => "year",
                            _ => "day",
                        })
                    }
                    "INTERVAL" => rule["every"] = json!(v.parse::<u32>().unwrap_or(1)),
                    "COUNT" => {
                        rule["end"] = json!({"count":v.parse::<u32>().map_err(|e|e.to_string())?})
                    }
                    "UNTIL" => {
                        if rule.get("end").is_none() {
                            rule["end"] = json!({"until":naive(v)?.date().to_string()})
                        }
                    }
                    _ => {}
                }
            }
        }
        let occurrences = if recurring {
            notice(&mut notices,format!("Serientermine von {} bis {} werden als verknüpfte Wiederholung importiert und bei Bedarf fortgesetzt.",year-1,year+2));
            recurrence(&props, &horizon, 20000)?
        } else {
            vec![start_naive.format("%Y%m%dT%H%M%S").to_string()]
        };
        for occurrence in occurrences {
            let exception = events.iter().find(|(p, _, _)| {
                value(p, "UID") == uid
                    && naive(value(p, "RECURRENCE-ID")).ok() == naive(&occurrence).ok()
            });
            let (source, source_alarms) = exception
                .map(|(p, a, _)| (p, a))
                .unwrap_or((&props, alarms));
            let task = *todo || value(source, "X-JOURNAL-KIND") == "task";
            if !task && value(source, "STATUS") == "CANCELLED" {
                notice(
                    &mut notices,
                    "Abgesagte Ereignisse werden nicht importiert.",
                );
                continue;
            }
            let mut sp = startprop.clone();
            let next = naive(&occurrence)?;
            let next_end = next
                .checked_add_signed(delta)
                .ok_or("Ein Termin enthält ein ungültiges Datum oder Ende.")?;
            sp.value = Some(if all_day {
                next.format("%Y%m%d").to_string()
            } else {
                format!(
                    "{}{}",
                    occurrence,
                    if startprop.value.as_deref().unwrap_or("").ends_with('Z') {
                        "Z"
                    } else {
                        ""
                    }
                )
            });
            let mut ep = endprop.unwrap_or(startprop).clone();
            ep.value = Some(if all_day {
                next_end.format("%Y%m%d").to_string()
            } else {
                format!(
                    "{}{}",
                    next_end.format("%Y%m%dT%H%M%S"),
                    if ep.value.as_deref().unwrap_or("").ends_with('Z') {
                        "Z"
                    } else {
                        ""
                    }
                )
            });
            let start = local_calendar(
                exception
                    .and_then(|(p, _, _)| p.iter().find(|p| p.name == "DTSTART"))
                    .unwrap_or(&sp),
                &timezone,
                &calendar.timezones,
            )?;
            let end = local_calendar(
                exception
                    .and_then(|(p, _, _)| p.iter().find(|p| p.name == "DTEND"))
                    .unwrap_or(&ep),
                &timezone,
                &calendar.timezones,
            )?;
            if end < start {
                return Err("Ein Termin enthält ein ungültiges Datum oder Ende.".into());
            }
            let day = start.date().to_string();
            if recurring && (day < from || day > horizon) {
                continue;
            }
            if entries.len() >= 5000 {
                return Err("Zu viele Kalendereinträge (höchstens 5000 pro Import).".into());
            }
            let identity = if recurring {
                format!(
                    "{uid}#{}{}",
                    if all_day {
                        next.date().to_string()
                    } else {
                        next.format("%Y-%m-%dT%H:%M:%S").to_string()
                    },
                    if !all_day && startprop.value.as_deref().unwrap_or("").ends_with('Z') {
                        "Z"
                    } else {
                        ""
                    }
                )
            } else {
                uid.clone()
            };
            if !ids.insert(identity.clone()) {
                return Err("Die Datei enthält doppelte Kalender-UIDs.".into());
            }
            let original = value(source, "X-JOURNAL-TEXT");
            let title = if source.iter().any(|p| p.name == "X-JOURNAL-TEXT") {
                text(original)
            } else {
                let s = text(value(source, "SUMMARY"));
                if s.is_empty() {
                    untitled.into()
                } else {
                    s
                }
            };
            let mut description = text(value(source, "DESCRIPTION"));
            if !original.is_empty()
                && value(source, "X-JOURNAL-DESCRIPTION-VERSION").is_empty()
                && description == title
            {
                description.clear()
            }
            let location = text(value(source, "LOCATION"));
            if !location.is_empty() {
                if !description.is_empty() {
                    description += "\n\n"
                }
                description += &format!("Ort: {location}")
            }
            let offset = (end.date() - start.date()).num_days();
            let span = all_day && offset > 1;
            let time = if all_day && !span {
                Value::Null
            } else {
                json!(start.format("%H:%M").to_string())
            };
            let finish = offset * 1440 + end.hour() as i64 * 60 + end.minute() as i64;
            let endtime =
                if time.is_null() || finish <= start.hour() as i64 * 60 + start.minute() as i64 {
                    Value::Null
                } else {
                    json!(format!("{:02}:{:02}", finish / 60, finish % 60))
                };
            let native = identity
                .strip_suffix("@journal.local")
                .filter(|s| uuid::Uuid::parse_str(s).is_ok())
                .map(str::to_owned)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let priority = value(source, "PRIORITY").parse::<u32>().unwrap_or(0);
            let mut entry = json!({"id":native,"calendarUid":identity,"kind":if task{"task"}else{"event"},"text":title,"description":description,"done":task&&(value(source,"X-JOURNAL-DONE")=="TRUE"||value(source,"STATUS")=="COMPLETED"),"cancelled":task&&(value(source,"X-JOURNAL-CANCELLED")=="TRUE"||value(source,"STATUS")=="CANCELLED"),"priority":(1..=4).contains(&priority),"time":time,"end":endtime,"reminder":value(source,"X-JOURNAL-REMINDER")=="TRUE"||!source_alarms.is_empty(),"showInJournal":value(source,"X-JOURNAL-SHOW-IN-JOURNAL")!="FALSE","plan":null});
            let lead = lead(source, source_alarms);
            if lead > 0 {
                entry["reminderBefore"] = json!(lead)
            }
            let icon = value(source, "X-JOURNAL-ICON");
            if !icon.is_empty()
                && icon.len() <= 64
                && icon
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            {
                entry["icon"] = json!(icon)
            }
            if recurring && exception.is_none() {
                entry["repeat"] = json!({"series":series,"rule":rule,"horizon":horizon})
            }
            if exception.is_some() {
                notice(
                    &mut notices,
                    "Abweichende Serientermine bleiben eigenständige Einträge.",
                )
            }
            if start.second() != 0 || end.second() != 0 {
                notice(&mut notices, "Sekunden werden auf volle Minuten gerundet.")
            }
            let categories = if value(source, "CATEGORIES").is_empty() {
                value(&props, "CATEGORIES")
            } else {
                value(source, "CATEGORIES")
            };
            let name = if categories.is_empty() {
                text(value(&calendar.properties, "X-WR-CALNAME"))
            } else {
                text(categories.split(',').next().unwrap_or(""))
            };
            if categories.split(',').count() > 1 {
                notice(
                    &mut notices,
                    "Bei mehreren Kategorien wird die erste als Tag zugeordnet.",
                )
            }
            let mut item = json!({"date":day,"entry":entry});
            if !name.trim().is_empty() {
                let rawcolor = source
                    .iter()
                    .find(|p| p.name == "CATEGORIES")
                    .and_then(|p| param(p, "COLOR"))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| {
                        [
                            value(source, "COLOR"),
                            value(&props, "COLOR"),
                            value(source, "X-APPLE-CALENDAR-COLOR"),
                            value(&calendar.properties, "COLOR"),
                            value(&calendar.properties, "X-APPLE-CALENDAR-COLOR"),
                            value(&calendar.properties, "X-WR-CALCOLOR"),
                        ]
                        .into_iter()
                        .find(|s| !s.is_empty())
                        .unwrap_or("")
                    });
                item["tag"] = json!({"id":uuid::Uuid::new_v4().to_string(),"name":name.trim().chars().take(40).collect::<String>(),"color":color(rawcolor.trim())})
            }
            entries.push(item);
        }
    }
    if entries.is_empty() {
        return Err("Keine Termine im unterstützten Serienzeitraum gefunden.".into());
    }
    Ok(json!({"entries":entries,"notices":notices}))
}
fn strval<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}
fn fold(lines: Vec<String>) -> String {
    let mut out = String::new();
    for line in lines {
        let mut bytes = 0;
        for c in line.chars() {
            if bytes + c.len_utf8() > 75 {
                out += "\r\n ";
                bytes = 1
            }
            out.push(c);
            bytes += c.len_utf8()
        }
        out += "\r\n"
    }
    out
}
#[tauri::command]
pub fn calendar_export(
    days: Vec<Value>,
    now: String,
    timezone: String,
    untitled: String,
) -> Result<String> {
    let stamp = DateTime::parse_from_rfc3339(&now)
        .map_err(|e| e.to_string())?
        .with_timezone(&Utc)
        .format("%Y%m%dT%H%M%SZ")
        .to_string();
    let mut lines = vec![
        "BEGIN:VCALENDAR".into(),
        "VERSION:2.0".into(),
        "PRODID:-//Journal//Calendar//DE".into(),
        "CALSCALE:GREGORIAN".into(),
    ];
    for day in days {
        let d = date(strval(&day, "date"))?;
        for entry in day["entries"].as_array().ok_or("Keine Einträge")? {
            if strval(entry, "kind") == "note" || entry.get("plan").is_some_and(|v| !v.is_null()) {
                continue;
            }
            let title = strval(entry, "text");
            let desc = strval(entry, "description");
            let decoded = desc
                .strip_prefix("journal-mail:v1\n")
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            let desc = decoded
                .as_ref()
                .and_then(|v| v["text"].as_str())
                .unwrap_or(desc);
            lines.extend([
                "BEGIN:VEVENT".into(),
                format!(
                    "UID:{}",
                    if strval(entry, "calendarUid").is_empty() {
                        format!("{}@journal.local", strval(entry, "id"))
                    } else {
                        strval(entry, "calendarUid").to_string()
                    }
                ),
                format!("DTSTAMP:{stamp}"),
                format!(
                    "SUMMARY:{}",
                    escape(
                        title
                            .lines()
                            .next()
                            .filter(|s| !s.is_empty())
                            .unwrap_or(&untitled)
                    )
                ),
                format!("DESCRIPTION:{}", escape(desc)),
                "X-JOURNAL-DESCRIPTION-VERSION:1".into(),
                format!("X-JOURNAL-TEXT;VALUE=TEXT:{}", escape(title)),
                format!("X-JOURNAL-KIND:{}", strval(entry, "kind")),
            ]);
            for (prop, key) in [
                ("SHOW-IN-JOURNAL", "showInJournal"),
                ("DONE", "done"),
                ("CANCELLED", "cancelled"),
                ("REMINDER", "reminder"),
            ] {
                let b = entry[key].as_bool().unwrap_or(key == "showInJournal");
                lines.push(format!(
                    "X-JOURNAL-{prop}:{}",
                    if b { "TRUE" } else { "FALSE" }
                ))
            }
            if let Some(n) = entry["reminderBefore"].as_u64().filter(|n| *n > 0) {
                lines.push(format!("X-JOURNAL-REMINDER-BEFORE:{n}"))
            }
            if !strval(entry, "icon").is_empty() {
                lines.push(format!("X-JOURNAL-ICON:{}", escape(strval(entry, "icon"))))
            }
            if entry["priority"] == true {
                lines.push("PRIORITY:1".into())
            }
            if entry["cancelled"] == true {
                lines.push("STATUS:CANCELLED".into())
            }
            if strval(entry, "time").is_empty() {
                lines.push(format!("DTSTART;VALUE=DATE:{}", d.format("%Y%m%d")));
                lines.push(format!(
                    "DTEND;VALUE=DATE:{}",
                    (d + Duration::days(1)).format("%Y%m%d")
                ))
            } else {
                for (prop, key) in [("DTSTART", "time"), ("DTEND", "end")] {
                    let s = strval(entry, key);
                    if s.is_empty() {
                        continue;
                    }
                    let (h, m) = s.split_once(':').ok_or("Ungültige Uhrzeit")?;
                    let h: i64 = h.parse().map_err(|_| "Ungültige Uhrzeit")?;
                    let m: i64 = m.parse().map_err(|_| "Ungültige Uhrzeit")?;
                    if !(0..=366 * 24).contains(&h) || !(0..60).contains(&m) {
                        return Err("Ungültige Uhrzeit".into());
                    }
                    let n = d.and_hms_opt(0, 0, 0).unwrap() + Duration::minutes(h * 60 + m);
                    let i = if let Ok(tz) = timezone.parse::<chrono_tz::Tz>() {
                        tz.from_local_datetime(&n)
                            .earliest()
                            .map(|v| v.with_timezone(&Utc))
                    } else {
                        Local
                            .from_local_datetime(&n)
                            .earliest()
                            .map(|v| v.with_timezone(&Utc))
                    }
                    .ok_or("Ungültige Uhrzeit")?;
                    lines.push(format!("{prop}:{}", i.format("%Y%m%dT%H%M%SZ")))
                }
            }
            lines.push("END:VEVENT".into());
        }
    }
    lines.push("END:VCALENDAR".into());
    Ok(fold(lines))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn normalize(v: &mut Value) {
        match v {
            Value::Object(o) => {
                // UUIDs are deliberately fresh; compare the recurrence separately below.
                o.remove("id");
                o.remove("series");
                o.remove("ics");
                for v in o.values_mut() {
                    normalize(v)
                }
            }
            Value::Array(a) => {
                for v in a {
                    normalize(v)
                }
            }
            _ => {}
        }
    }
    #[test]
    fn legacy_export_fixtures() {
        fn unfold(s: &str) -> String {
            s.replace("\r\n ", "")
                .replace("\r\n\t", "")
                .replace("\r\n", "\n")
        }
        let fixtures: Vec<Value> =
            serde_json::from_str(include_str!("../../tests/fixtures/ical-export.json")).unwrap();
        for fixture in fixtures {
            let actual = calendar_export(
                fixture["days"].as_array().unwrap().clone(),
                strval(&fixture, "now").into(),
                "Europe/Berlin".into(),
                "Ohne Titel".into(),
            )
            .unwrap();
            assert_eq!(unfold(&actual), unfold(strval(&fixture, "content")));
        }
    }
    #[test]
    fn provider_fixtures() {
        let fixtures: Vec<Value> =
            serde_json::from_str(include_str!("../../tests/fixtures/ical-special.json")).unwrap();
        for fixture in fixtures {
            let result = calendar_import(
                strval(&fixture, "content").into(),
                2026,
                "Europe/Berlin".into(),
                None,
            )
            .unwrap();
            let schedule: Vec<Value> = result["entries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| json!([item["date"], item["entry"]["time"], item["entry"]["end"]]))
                .collect();
            assert_eq!(json!(schedule), fixture["schedule"], "{}", fixture["name"]);
        }
    }
    #[test]
    fn legacy_import_fixtures() {
        let fixtures: Vec<Value> =
            serde_json::from_str(include_str!("../../tests/fixtures/ical-import.json")).unwrap();
        for (index, f) in fixtures.into_iter().enumerate() {
            let actual = calendar_import(
                strval(&f, "content").into(),
                f["year"].as_i64().unwrap() as i32,
                "Europe/Berlin".into(),
                None,
            );
            if f["error"] == true {
                assert!(actual.is_err(), "fixture {index}");
                continue;
            }
            let mut actual = actual.unwrap_or_else(|e| panic!("fixture {index}: {e}"));
            let mut expected = f["expected"].clone();
            for item in expected["entries"].as_array().unwrap() {
                if let Some(rule) = item["entry"]["repeat"].get("rule") {
                    let dates = calendar_occurrences(
                        strval(rule, "ics").into(),
                        "2025-01-01".into(),
                        "2028-12-31".into(),
                        5000,
                        None,
                    )
                    .unwrap();
                    let current = &actual["entries"][0]["entry"]["repeat"]["rule"];
                    assert_eq!(
                        dates,
                        calendar_occurrences(
                            strval(current, "ics").into(),
                            "2025-01-01".into(),
                            "2028-12-31".into(),
                            5000,
                            None
                        )
                        .unwrap()
                    );
                    break;
                }
            }
            normalize(&mut actual);
            normalize(&mut expected);
            assert_eq!(actual, expected, "fixture {index}");
        }
    }
}
