use super::*;
use serde_json::json;

fn db() -> Store { Store::from_connection(Connection::open_in_memory().unwrap()).unwrap() }
fn item(kind: &str) -> Entry {
    serde_json::from_value(json!({"id":Uuid::new_v4().to_string(),"kind":kind,"text":"Example","done":false,"cancelled":false})).unwrap()
}
fn count_entry_writes(conn: &Connection) {
    conn.execute_batch("CREATE TEMP TABLE entry_write_count(i INTEGER,u INTEGER,d INTEGER); INSERT INTO entry_write_count VALUES(0,0,0);
        CREATE TEMP TRIGGER count_entry_insert AFTER INSERT ON entries BEGIN UPDATE entry_write_count SET i=i+1; END;
        CREATE TEMP TRIGGER count_entry_update AFTER UPDATE ON entries BEGIN UPDATE entry_write_count SET u=u+1; END;
        CREATE TEMP TRIGGER count_entry_delete AFTER DELETE ON entries BEGIN UPDATE entry_write_count SET d=d+1; END;").unwrap();
}
fn writes(conn: &Connection) -> (i64,i64,i64) { conn.query_row("SELECT i,u,d FROM entry_write_count",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap() }

#[test]
fn editing_one_entry_does_not_rewrite_unchanged_entries_or_inflate_undo() {
    let mut db=db(); let mut day=db.load("2026-11-08").unwrap();
    day.entries=(0..128).map(|i| {let mut e=item("task");e.text=format!("Task {i}");e.description="mail body ".repeat(200);e}).collect();
    let mut day=db.save(day).unwrap();let unchanged=day.entries[0].id.clone();
    let before:i64=db.conn.query_row("SELECT rowid FROM entries WHERE id=?1",[&unchanged],|r|r.get(0)).unwrap();
    count_entry_writes(&db.conn);
    day.entries[64].text="Edited text".into(); let saved=db.save(day).unwrap();
    assert_eq!(writes(&db.conn),(0,1,0));
    let after:i64=db.conn.query_row("SELECT rowid FROM entries WHERE id=?1",[&unchanged],|r|r.get(0)).unwrap();
    assert_eq!(before,after);
    let history:i64=db.conn.query_row("SELECT COUNT(*) FROM undo_rows WHERE g=(SELECT cursor FROM undo_state) AND t='entries'",[],|r|r.get(0)).unwrap();
    assert_eq!(history,1);
    assert!(crate::history::step(&mut db,false).unwrap());assert_eq!(db.load(&saved.date).unwrap().entries[64].text,"Task 64");
    assert!(crate::history::step(&mut db,true).unwrap());assert_eq!(db.load(&saved.date).unwrap().entries[64].text,"Edited text");
    println!("Day with 128 entries: one text edit writes 1 entry, captures 1 undo entry row (previously deleted/reinserted all 128).");
}

#[test]
fn targeted_save_keeps_order_deletion_uid_swaps_and_rollback_semantics() {
    let mut db=db(); let mut day=db.load("2026-11-08").unwrap();
    for uid in ["uid-a","uid-b","uid-c"] {let mut e=item("event");e.calendar_uid=Some(uid.into());day.entries.push(e);}
    let mut day=db.save(day).unwrap();
    day.entries.swap(0,1);
    day.entries[0].calendar_uid=Some("uid-a".into());day.entries[1].calendar_uid=Some("uid-b".into());
    day.entries.pop(); let added=item("note"); let added_id=added.id.clone(); day.entries.push(added);
    let saved=db.save(day).unwrap();
    assert_eq!(saved.entries[0].calendar_uid.as_deref(),Some("uid-a"));
    assert_eq!(saved.entries[1].calendar_uid.as_deref(),Some("uid-b"));
    assert_eq!(saved.entries[2].id,added_id);
    let before=db.sync_snapshot().unwrap();
    let mut invalid=saved.clone();invalid.entries[2].calendar_uid=Some("uid-a".into());
    assert!(db.save(invalid).is_err());assert_eq!(db.sync_snapshot().unwrap(),before);
    assert!(db.save(Day {entries:vec![],..saved.clone()}).is_ok());
    assert!(db.load(&saved.date).unwrap().entries.is_empty());
    assert!(db.save(saved).is_err(),"stale revisions are still rejected");
}

#[test]
fn uid_swaps_remain_undoable_and_redoable() {
    let mut db=db();let mut day=db.load("2026-11-08").unwrap();
    for uid in ["uid-a","uid-b"] {let mut e=item("event");e.calendar_uid=Some(uid.into());day.entries.push(e);}
    let mut day=db.save(day).unwrap();day.entries[0].calendar_uid=Some("uid-b".into());day.entries[1].calendar_uid=Some("uid-a".into());
    db.save(day).unwrap();assert!(crate::history::step(&mut db,false).unwrap());
    assert_eq!(db.load("2026-11-08").unwrap().entries[0].calendar_uid.as_deref(),Some("uid-a"));
    assert!(crate::history::step(&mut db,true).unwrap());
    assert_eq!(db.load("2026-11-08").unwrap().entries[0].calendar_uid.as_deref(),Some("uid-b"));
}

#[test]
fn native_activity_totals_match_calendar_projection_without_reading_mail_html() {
    let mut db=db();
    db.conn.execute("INSERT INTO tags VALUES('reading','Reading','#123456',0)",[]).unwrap();
    let mut day=db.load("2026-11-08").unwrap();
    for (kind,start,end,cancelled,done) in [("event",Some("09:00"),Some("10:30"),false,false),("task",Some("10:00"),Some("10:45"),false,true),("task",Some("11:00"),Some("12:00"),true,false),("event",Some("22:00"),Some("50:15"),false,false),("event",None,None,false,false),("event",Some("13:00"),None,false,false)] {
        let mut e=item(kind);e.time=start.map(Into::into);e.end=end.map(Into::into);e.cancelled=cancelled;e.done=done;e.tag=Some("reading".into());e.description="<h1>large mail content</h1>".repeat(2000);day.entries.push(e);
    }
    let mut trace=item("event");trace.tag=Some("reading".into());trace.time=Some("15:00".into());trace.end=Some("16:00".into());
    trace.plan=Some(Plan {via:"date".into(),targets:vec![PlanTarget{date:"2026-11-09".into(),id:Uuid::new_v4().to_string()}],time:None,end:None,reminder:false,repeat:None});day.entries.push(trace);
    db.save(day).unwrap();
    let tags=vec!["reading".to_string(),"missing".to_string(),"reading".to_string()];
    let before=db.sync_snapshot().unwrap();let projection=db.load_range("2026-11-08","2026-11-10").unwrap();
    let totals=db.activity_minutes("2026-11-08","2026-11-10",&tags).unwrap();
    assert_eq!(totals["2026-11-08"]["reading"],90+45+28*60+15);
    assert_eq!(totals.len(),1,"untimed planned copies add no time");
    let minutes=|time:&str|{let (h,m)=time.split_once(':').unwrap();h.parse::<i64>().unwrap()*60+m.parse::<i64>().unwrap()};
    for day in &projection {
        let expected:i64=day.entries.iter().filter(|e|!e.cancelled && e.tag.as_deref()==Some("reading")).filter_map(|e|Some((minutes(e.end.as_deref()?)-minutes(e.time.as_deref()?)).max(0))).sum();
        assert_eq!(totals.get(&day.date).and_then(|m|m.get("reading")).copied().unwrap_or(0),expected);
    }
    assert_eq!(db.sync_snapshot().unwrap(),before,"aggregation is read-only");
    let full=serde_json::to_vec(&projection).unwrap().len();let compact=serde_json::to_vec(&totals).unwrap().len();
    assert!(compact*1000<full);
    println!("Activity fixture IPC payload: full calendar {full} bytes; native totals {compact} bytes.");
    assert!(db.activity_minutes("2026-11-10","2026-11-08",&tags).is_err());
    assert!(db.activity_minutes("2026-11-08","2028-11-08",&tags).is_err());
    assert!(db.activity_minutes("2026-11-08","2026-11-10",&[]).unwrap().is_empty());
}

#[test]
fn reopening_existing_schema_only_adds_indexes_and_keeps_all_content_and_history() {
    let folder=std::env::temp_dir().join(format!("journal-storage-perf-{}",Uuid::new_v4()));std::fs::create_dir(&folder).unwrap();let path=folder.join("journal.sqlite3");
    let mut db=Store::open(&path).unwrap();let mut day=db.load("2026-11-08").unwrap();day.title="Existing title".into();day.entries.push(item("task"));db.save(day).unwrap();db.save_period_data("{\"notes\":{\"day:2026-11-08\":\"Existing note\"}}").unwrap();
    db.conn.execute_batch("DROP INDEX entries_activity_time").unwrap();
    let before=db.sync_snapshot().unwrap();let undo:i64=db.conn.query_row("SELECT COUNT(*) FROM undo_rows",[],|r|r.get(0)).unwrap();drop(db);
    let mut db=Store::open(&path).unwrap();assert_eq!(db.sync_snapshot().unwrap(),before);
    assert_eq!(db.conn.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),12);
    assert_eq!(db.conn.query_row("SELECT COUNT(*) FROM undo_rows",[],|r|r.get::<_,i64>(0)).unwrap(),undo);
    assert!(crate::history::step(&mut db,false).unwrap());assert_eq!(db.period_data().unwrap(),"{}");
    assert!(crate::history::step(&mut db,true).unwrap());assert!(db.period_data().unwrap().contains("Existing note"));
    assert_eq!(db.conn.prepare("PRAGMA quick_check").unwrap().query_row([],|r|r.get::<_,String>(0)).unwrap(),"ok");
    drop(db);std::fs::remove_dir_all(folder).unwrap();
}

// Count real SQLite statements without changing production dependencies or timing-sensitive assertions.
struct QueryCount<'a> { connection: &'a Connection, count: Box<std::sync::atomic::AtomicUsize> }
impl<'a> QueryCount<'a> {
    fn new(connection: &'a Connection) -> Self {
        unsafe extern "C" fn trace(_:u32,context:*mut std::ffi::c_void,_:*mut std::ffi::c_void,_:*mut std::ffi::c_void)->i32 {
            unsafe { &*(context as *const std::sync::atomic::AtomicUsize) }.fetch_add(1,std::sync::atomic::Ordering::Relaxed);0
        }
        let count=Box::new(std::sync::atomic::AtomicUsize::new(0));
        unsafe { assert_eq!(rusqlite::ffi::sqlite3_trace_v2(connection.handle(),rusqlite::ffi::SQLITE_TRACE_STMT as u32,Some(trace),(&*count as *const std::sync::atomic::AtomicUsize).cast_mut().cast()),0); }
        Self {connection,count}
    }
    fn reset(&self) { self.count.store(0,std::sync::atomic::Ordering::Relaxed); }
    fn get(&self)->usize { self.count.load(std::sync::atomic::Ordering::Relaxed) }
}
impl Drop for QueryCount<'_> { fn drop(&mut self) { unsafe { rusqlite::ffi::sqlite3_trace_v2(self.connection.handle(),0,None,std::ptr::null_mut()); } } }

fn read_fixture() -> Store {
    let mut db=db();let start=NaiveDate::from_ymd_opt(2026,11,8).unwrap();let mut target=None;
    for i in 0..20 {
        let date=(start+Duration::days(i)).format("%Y-%m-%d").to_string();let mut day=db.load(&date).unwrap();
        day.title=if i%2==0 {String::new()} else {format!("Title {i}")};day.body="\u{2003}\u{00a0}".into();
        let mut task=item("task");task.text=format!("Needle task {i}");task.description="Rich **details** 🐈".into();task.done=i==2;task.cancelled=i==3;task.priority=i==4;task.show_in_journal=i%2!=0;
        if i==0 {target=Some((date.clone(),task.id.clone()));}
        let mut event=item("event");event.text=format!("Needle event {i}");event.show_in_journal=false;event.time=Some("22:15".into());event.end=Some("50:00".into());event.calendar_uid=Some(format!("fixture-event-{i}"));
        let mut note=item("note");note.text="Unrelated note".into();note.description="unrelated large content ".repeat(1000);note.show_in_journal=i%2!=0;
        day.entries=vec![task,event,note];db.save(day).unwrap();
    }
    let (date,target)=target.unwrap();
    db.conn.execute("INSERT INTO days VALUES('2020-01-01','Origin','',1)",[]).unwrap();
    let planned=json!({"via":"date","targets":[{"date":date,"id":target}],"time":null,"reminder":false}).to_string();
    db.conn.execute("INSERT INTO entries(id,day_date,kind,text,done,position,plan) VALUES(?1,'2020-01-01','event','Trace',0,0,?2)",params![Uuid::new_v4().to_string(),planned]).unwrap();
    db.conn.execute("INSERT INTO days VALUES('2020-01-02','Stale trace','',1)",[]).unwrap();
    let stale=json!({"via":"date","targets":[{"date":"2026-01-01","id":target}],"time":null,"reminder":false}).to_string();
    db.conn.execute("INSERT INTO entries(id,day_date,kind,text,done,position,plan) VALUES(?1,'2020-01-02','event','Stale trace',0,0,?2)",params![Uuid::new_v4().to_string(),stale]).unwrap();
    let series=Uuid::new_v4().to_string();db.conn.execute("INSERT INTO series VALUES(?1,?2,'2027-12-31')",params![series,json!({"start":date,"unit":"week","every":1}).to_string()]).unwrap();
    db.conn.execute("UPDATE entries SET series=?1 WHERE id=?2",params![series,target]).unwrap();
    db
}

// Frozen legacy read paths are the behavior reference for the optimized projections.
fn legacy_export(db:&Store)->Vec<CalendarDay> {
    let dates=db.conn.prepare("SELECT DISTINCT day_date FROM entries WHERE plan IS NULL AND kind<>'note' ORDER BY day_date").unwrap().query_map([],|r|r.get::<_,String>(0)).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    dates.into_iter().map(|date|{let day=db.load(&date).unwrap();CalendarDay{date,has_journal:!day.title.trim().is_empty() || !day.body.trim().is_empty() || day.entries.iter().any(|e|e.show_in_journal),title:day.title,entries:day.entries.into_iter().filter(|e|e.plan.is_none() && e.kind!="note").collect()}}).collect()
}
fn legacy_entry_search(db:&Store,limit:usize)->Vec<SearchHit> {
    let found=db.conn.prepare("SELECT day_date,id FROM entries WHERE plan IS NULL AND (show_in_journal=0 OR kind IN ('task','event') AND show_in_journal=1) AND (text LIKE '%Needle%' OR description LIKE '%Needle%') ORDER BY day_date DESC,position LIMIT ?1").unwrap().query_map([limit.clamp(1,500) as i64],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).unwrap().collect::<rusqlite::Result<Vec<_>>>().unwrap();
    let mut days=HashMap::new();found.into_iter().map(|(date,id)|{let day=days.entry(date.clone()).or_insert_with(||db.load(&date).unwrap());SearchHit{date,title:None,entry:day.entries.iter().find(|e|e.id==id).cloned()}}).collect()
}

#[test]
fn search_loads_only_hits_with_identical_order_origins_and_repeating_details() {
    let db=read_fixture();let before=db.sync_snapshot().unwrap();
    for limit in [0,1,3,200] {
        let old=legacy_entry_search(&db,limit);let new=db.search(&["Needle".into()],&["task".into(),"event".into(),"calendar".into()],&[],limit).unwrap();
        assert_eq!(serde_json::to_value(&new).unwrap(),serde_json::to_value(&old).unwrap());
    }
    let count=QueryCount::new(&db.conn);let _=legacy_entry_search(&db,200);let old_queries=count.get();count.reset();
    let hits=db.search(&["Needle".into()],&["task".into(),"event".into(),"calendar".into()],&[],200).unwrap();let new_queries=count.get();
    assert_eq!(new_queries,2);assert_eq!(old_queries,61);assert_eq!(hits.len(),40);drop(count);
    assert_eq!(db.sync_snapshot().unwrap(),before);
    println!("Search across 20 matching days: SQLite statements {old_queries} -> {new_queries}; results byte-for-byte equivalent after JSON serialization.");
}

#[test]
fn full_export_batches_reads_without_changing_any_exported_field() {
    let db=read_fixture();let before=db.sync_snapshot().unwrap();let count=QueryCount::new(&db.conn);
    let old=legacy_export(&db);let old_queries=count.get();count.reset();let new=db.export_calendar().unwrap();let new_queries=count.get();drop(count);
    assert_eq!(serde_json::to_value(&new).unwrap(),serde_json::to_value(&old).unwrap());
    assert_eq!(old_queries,61);assert_eq!(new_queries,3);assert_eq!(new.len(),20);
    assert!(!new[0].has_journal,"Unicode whitespace remains blank, calendar-only entries stay hidden");
    assert_eq!(new[0].entries[0].origin.as_deref(),Some("2020-01-01"));assert!(new[0].entries[0].repeat.is_some());
    assert_eq!(db.sync_snapshot().unwrap(),before);
    println!("Full export across 20 days: SQLite statements {old_queries} -> {new_queries}; all exported fields preserved.");
}

#[test]
fn unchanged_display_language_does_not_write_again_for_additional_windows() {
    let db=db();
    db.set_interface_language("en").unwrap();
    let before=db.conn.total_changes();
    for _ in 0..50 {db.set_interface_language("en").unwrap();}
    assert_eq!(db.conn.total_changes(),before,"Opening more windows must not rewrite an unchanged preference");
    db.set_interface_language("de").unwrap();
    assert_eq!(db.interface_language().unwrap(),"de");
    assert!(db.conn.total_changes()>before);
}
