//! Read projections; these queries never rewrite persisted journal content.
use super::*;

const ORIGINS_SQL: &str = "SELECT json_extract(t.value, '$.id'), e.day_date FROM entries e, json_each(e.plan, '$.targets') t WHERE json_extract(t.value, '$.date') = ?1";
const ENTRY_COLUMNS: &str = "e.id,e.kind,e.text,e.done,e.cancelled,e.priority,e.time,e.reminder,e.plan,e.end_time,e.show_in_journal,e.calendar_uid,e.series,s.rule,s.horizon,e.description,e.tag,e.reminder_before,e.icon";
type EntryRow = (Entry, Option<String>, (Option<String>, Option<String>, Option<String>));

fn entry_row(r: &rusqlite::Row<'_>, at: usize) -> rusqlite::Result<EntryRow> {
    Ok((Entry { id:r.get(at)?,kind:r.get(at+1)?,text:r.get(at+2)?,done:r.get(at+3)?,cancelled:r.get(at+4)?,priority:r.get(at+5)?,time:r.get(at+6)?,reminder:r.get(at+7)?,end:r.get(at+9)?,show_in_journal:r.get(at+10)?,calendar_uid:r.get(at+11)?,description:r.get(at+15)?,tag:r.get(at+16)?,reminder_before:r.get(at+17)?,icon:r.get(at+18)?,plan:None,origin:None,repeat:None },r.get(at+8)?,(r.get(at+12)?,r.get(at+13)?,r.get(at+14)?)))
}
fn finish_entry((mut entry, plan, series): EntryRow) -> Result<Entry> {
    entry.plan=plan.map(|value|serde_json::from_str(&value)).transpose()?;
    entry.repeat=repeat_of(series)?;
    Ok(entry)
}

fn validate_range(from: &str, to: &str) -> Result<()> {
    validate_date(from)?; validate_date(to)?;
    if from > to || NaiveDate::parse_from_str(to, "%Y-%m-%d")?.signed_duration_since(NaiveDate::parse_from_str(from, "%Y-%m-%d")?).num_days() > 400 { return Err("Ungültiger Zeitraum".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activity_read_uses_partial_index() {
        let db=Store::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        let mut minutes=db.conn.prepare(&format!("EXPLAIN QUERY PLAN {}",activity_minutes_query(1))).unwrap();
        let minutes=minutes.query_map(["2026-11-08","2026-11-09","reading"],|r|r.get::<_,String>(3)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap().join("; ");
        println!("Activity query plan: {minutes}");
        assert!(minutes.contains("entries_activity_time"),"{minutes}");
    }
}

fn activity_minutes_query(tags: usize) -> String {
    format!("SELECT day_date, tag, SUM(MAX(0,
        CAST(substr(end_time,1,instr(end_time,':')-1) AS INTEGER)*60 + CAST(substr(end_time,-2) AS INTEGER)
        - CAST(substr(time,1,instr(time,':')-1) AS INTEGER)*60 - CAST(substr(time,-2) AS INTEGER))) AS minutes
        FROM entries WHERE plan IS NULL AND time IS NOT NULL AND end_time IS NOT NULL AND cancelled=0
        AND day_date BETWEEN ?1 AND ?2 AND tag IN ({}) GROUP BY day_date, tag HAVING minutes>0", vec!["?"; tags].join(","))
}

impl Store {
    /// Sum activity-tagged time without loading titles, descriptions or mail HTML into any WebView.
    pub fn activity_minutes(&self, from: &str, to: &str, tags: &[String]) -> Result<ActivityMinutes> {
        validate_range(from, to)?;
        if tags.len() > 200 { return Err("Zu viele Aktivitäts-Tags".into()); }
        let mut result = ActivityMinutes::new();
        if tags.is_empty() { return Ok(result); }
        let sql = activity_minutes_query(tags.len());
        let mut statement = self.conn.prepare_cached(&sql)?;
        let values = std::iter::once(from).chain(std::iter::once(to)).chain(tags.iter().map(String::as_str));
        let rows = statement.query_map(rusqlite::params_from_iter(values), |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?, r.get::<_,i64>(2)?)))?;
        for row in rows { let (date, tag, minutes) = row?; result.entry(date).or_default().insert(tag, minutes); }
        Ok(result)
    }
    /// Export every task and event, including calendar-only entries, without the UI's range limit.
    pub fn export_calendar(&self) -> Result<Vec<CalendarDay>> {
        // Keep Rust's Unicode whitespace semantics for has_journal; discard each body immediately.
        let mut metadata=self.conn.prepare_cached("SELECT d.date,d.title,d.body,EXISTS(SELECT 1 FROM entries WHERE day_date=d.date AND show_in_journal=1)
            FROM days d WHERE EXISTS(SELECT 1 FROM entries WHERE day_date=d.date AND plan IS NULL AND kind<>'note') ORDER BY d.date")?;
        let mut days=metadata.query_map([],|r|{
            let title:String=r.get(1)?;let body:String=r.get(2)?;
            let has_journal=!title.trim().is_empty() || !body.trim().is_empty() || r.get::<_,bool>(3)?;
            Ok(CalendarDay{date:r.get(0)?,title,has_journal,entries:vec![]})
        })?.collect::<rusqlite::Result<Vec<_>>>()?;
        let mut statement=self.conn.prepare_cached(&format!("SELECT e.day_date,{ENTRY_COLUMNS} FROM entries e LEFT JOIN series s ON s.id=e.series
            WHERE e.plan IS NULL AND e.kind<>'note' ORDER BY e.day_date,e.position"))?;
        let mut entries=Vec::new();
        for row in statement.query_map([],|r|Ok((r.get::<_,String>(0)?,entry_row(r,1)?)))? {
            let (date,entry)=row?;entries.push((date,finish_entry(entry)?));
        }
        self.fill_origins(&mut entries)?;
        let by_date:HashMap<String,usize>=days.iter().enumerate().map(|(index,day)|(day.date.clone(),index)).collect();
        for (date,entry) in entries { if let Some(&index)=by_date.get(&date) { days[index].entries.push(entry); } }
        Ok(days)
    }

    /// One origin lookup for an arbitrary result set, preserving the day check and the legacy last-row precedence.
    fn fill_origins(&self, entries: &mut [(String,Entry)]) -> Result<()> {
        if entries.is_empty() { return Ok(()); }
        let wanted:HashMap<&str,&str>=entries.iter().map(|(date,entry)|(entry.id.as_str(),date.as_str())).collect();
        let ids=serde_json::to_string(&entries.iter().map(|(_,entry)|entry.id.as_str()).collect::<Vec<_>>())?;
        let mut statement=self.conn.prepare_cached("SELECT json_extract(t.value,'$.id'),json_extract(t.value,'$.date'),e.day_date
            FROM entries e,json_each(e.plan,'$.targets') t WHERE json_extract(t.value,'$.id') IN (SELECT value FROM json_each(?1)) ORDER BY e.rowid")?;
        let rows=statement.query_map([ids],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))?;
        let mut origins=HashMap::new();
        for row in rows { let (id,date,origin)=row?;if wanted.get(id.as_str()).copied()==Some(date.as_str()){origins.insert(id,origin);} }
        for (_,entry) in entries {entry.origin=origins.remove(&entry.id);}
        Ok(())
    }
    /// The search over every day (see src/search.ts): entries whose text or description holds all `words` (case and
    /// accents aside, as SQLite's LIKE does for ASCII; the app checks the rest), and day titles. Traces are left out.
    /// `kinds` are task, event, note and `calendar` (calendar-only entries); `tags` limit to entries with one of them.
    pub fn search(&self, words: &[String], kinds: &[String], tags: &[String], limit: usize) -> Result<Vec<SearchHit>> {
        let limit = limit.clamp(1, 500) as i64;
        let like = |word: &String| format!("%{}%", word.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        let mut hits = Vec::new();
        let want_titles = kinds.is_empty() || kinds.iter().any(|kind| kind == "title");
        let entry_kinds: Vec<&String> = kinds.iter().filter(|kind| kind.as_str() != "title").collect();
        if kinds.is_empty() || !entry_kinds.is_empty() {
            let mut sql = format!("SELECT e.day_date,{ENTRY_COLUMNS} FROM entries e LEFT JOIN series s ON s.id=e.series WHERE e.plan IS NULL");
            let mut values: Vec<String> = Vec::new();
            for word in words { sql += " AND (text LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')"; values.push(like(word)); values.push(like(word)); }
            if !entry_kinds.is_empty() {
                let mut parts = Vec::new();
                for kind in &entry_kinds {
                    match kind.as_str() {
                        "calendar" => parts.push("show_in_journal = 0".to_string()),
                        "task" | "event" | "note" => { parts.push("(kind = ? AND show_in_journal = 1)".to_string()); values.push(kind.to_string()); }
                        _ => {}
                    }
                }
                if parts.is_empty() { sql += " AND 0"; } else { sql += &format!(" AND ({})", parts.join(" OR ")); }
            }
            if !tags.is_empty() { sql += &format!(" AND tag IN ({})", vec!["?"; tags.len()].join(",")); values.extend(tags.iter().cloned()); }
            sql += " ORDER BY day_date DESC, position LIMIT ?";
            let mut stmt = self.conn.prepare_cached(&sql)?;
            let mut params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|value| value as &dyn rusqlite::ToSql).collect();
            params.push(&limit);
            let mut found=Vec::new();
            for row in stmt.query_map(params.as_slice(), |r| Ok((r.get::<_,String>(0)?,entry_row(r,1)?)))? {
                let (date,entry)=row?;found.push((date,finish_entry(entry)?));
            }
            self.fill_origins(&mut found)?;
            hits.extend(found.into_iter().map(|(date,entry)|SearchHit{date,title:None,entry:Some(entry)}));
        }
        if want_titles && tags.is_empty() {
            let mut sql = String::from("SELECT date, title FROM days WHERE title <> ''");
            let mut values: Vec<String> = Vec::new();
            for word in words { sql += " AND title LIKE ? ESCAPE '\\'"; values.push(like(word)); }
            sql += " ORDER BY date DESC LIMIT ?";
            let mut stmt = self.conn.prepare_cached(&sql)?;
            let mut params: Vec<&dyn rusqlite::ToSql> = values.iter().map(|value| value as &dyn rusqlite::ToSql).collect();
            params.push(&limit);
            for row in stmt.query_map(params.as_slice(), |r| Ok(SearchHit { date: r.get(0)?, title: Some(r.get(1)?), entry: None }))? { hits.push(row?); }
        }
        Ok(hits)
    }
    pub fn load(&self, date: &str) -> Result<Day> {
        validate_date(date)?;
        let mut day = self.conn.query_row("SELECT title, body, revision FROM days WHERE date = ?1", [date], |r| Ok(Day { date: date.into(), title: r.get(0)?, body: r.get(1)?, revision: r.get(2)?, entries: vec![], touched: vec![], keep_alone: vec![] })).optional()?.unwrap_or(Day { date: date.into(), title: String::new(), body: String::new(), revision: 0, entries: vec![], touched: vec![], keep_alone: vec![] });
        let mut stmt = self.conn.prepare_cached(&format!("SELECT {ENTRY_COLUMNS}
            FROM entries e LEFT JOIN series s ON s.id = e.series WHERE e.day_date = ?1 ORDER BY e.position"))?;
        let rows = stmt.query_map([date], |r| entry_row(r,0))?;
        let mut origins = self.conn.prepare_cached(ORIGINS_SQL)?;
        let origins = origins.query_map([date], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()?;
        for row in rows {
            let mut entry = finish_entry(row?)?;
            entry.origin = origins.get(&entry.id).cloned();
            day.entries.push(entry);
        }
        Ok(day)
    }
    /// Every day from `from` to `to` (inclusive) that has a title or entries, in date order.
    pub fn load_range(&self, from: &str, to: &str) -> Result<Vec<CalendarDay>> {
        validate_range(from, to)?;
        let mut days: Vec<CalendarDay> = Vec::new();
        let mut titles = self.conn.prepare_cached("SELECT date, title, (trim(title)<>'' OR trim(body)<>'' OR EXISTS(SELECT 1 FROM entries WHERE day_date=date AND show_in_journal=1)) FROM days WHERE date BETWEEN ?1 AND ?2 AND (title <> '' OR trim(body)<>'' OR EXISTS (SELECT 1 FROM entries WHERE day_date = date)) ORDER BY date")?;
        for row in titles.query_map([from, to], |r| Ok(CalendarDay { date: r.get(0)?, title: r.get(1)?, has_journal: r.get(2)?, entries: vec![] }))? { days.push(row?); }
        let mut stmt = self.conn.prepare_cached(&format!("SELECT e.day_date,{ENTRY_COLUMNS}
            FROM entries e LEFT JOIN series s ON s.id = e.series WHERE e.day_date BETWEEN ?1 AND ?2 AND e.plan IS NULL ORDER BY e.day_date, e.position"))?;
        let rows = stmt.query_map([from, to], |r| Ok((r.get::<_,String>(0)?,entry_row(r,1)?)))?;
        let mut index = 0;
        for row in rows {
            let (date, entry) = row?;
            let entry = finish_entry(entry)?;
            while days[index].date != date { index += 1; }
            days[index].entries.push(entry);
        }
        Ok(days)
    }
}
