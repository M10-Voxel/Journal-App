//! Transaction-scoped row deltas for user content. History stays local and survives restarts.
//! Call `begin` inside the write transaction. The first actual row change starts the group,
//! so reminder polling and other no-op writes neither consume steps nor invalidate redo.
//! Credentials, sync bookkeeping and external image bytes are deliberately excluded.
use rusqlite::{Connection,params};
use serde_json::Value;
use crate::storage::Store;
use std::sync::Mutex;
use tauri::Emitter;
pub fn install(c:&Connection)->rusqlite::Result<()> {
 c.execute_batch("CREATE TABLE IF NOT EXISTS undo_groups(id INTEGER PRIMARY KEY AUTOINCREMENT); CREATE TABLE IF NOT EXISTS undo_state(id INTEGER PRIMARY KEY,cursor INTEGER NOT NULL,replaying INTEGER NOT NULL); INSERT OR IGNORE INTO undo_state VALUES(1,0,0); CREATE TABLE IF NOT EXISTS undo_rows(g INTEGER,t TEXT,k TEXT,b TEXT,a TEXT,PRIMARY KEY(g,t,k));")?;
 c.execute_batch("CREATE TEMP TABLE IF NOT EXISTS undo_action(started INTEGER NOT NULL); DELETE FROM undo_action; INSERT INTO undo_action VALUES(0);")?;
 for (table,key) in [("days","date"),("entries","id"),("tags","id"),("series","id"),("settings","key")] {
  let s=c.prepare(&format!("SELECT * FROM {table} LIMIT 0"))?;
  let columns=s.column_names().iter().map(|s|s.to_string()).collect::<Vec<_>>();drop(s);
  let row=|prefix:&str|format!("json_object({})",columns.iter().map(|col|format!("'{col}',{prefix}.{col}")).collect::<Vec<_>>().join(","));
  for (event,old,new,prefix) in [("INSERT","NULL".to_string(),row("NEW"),"NEW"),("UPDATE",row("OLD"),row("NEW"),"NEW"),("DELETE",row("OLD"),"NULL".to_string(),"OLD")] {
   let unchanged=if event=="UPDATE" {format!(" AND {old} IS NOT {new}")}else{String::new()};
   let filter=if table=="settings" {format!(" AND ({prefix}.key='period-data' OR {prefix}.key LIKE 'board:card:%' OR {prefix}.key LIKE 'board:folder:%')")}else{String::new()};
   c.execute_batch(&format!("DROP TRIGGER IF EXISTS temp.undo_{table}_{event}; CREATE TEMP TRIGGER undo_{table}_{event} AFTER {event} ON {table} WHEN (SELECT replaying=0 FROM undo_state WHERE id=1){filter}{unchanged} BEGIN DELETE FROM undo_rows WHERE g>(SELECT cursor FROM undo_state) AND (SELECT started=0 FROM undo_action); DELETE FROM undo_groups WHERE id>(SELECT cursor FROM undo_state) AND (SELECT started=0 FROM undo_action); INSERT INTO undo_groups SELECT NULL WHERE (SELECT started=0 FROM undo_action); UPDATE undo_state SET cursor=last_insert_rowid() WHERE (SELECT started=0 FROM undo_action); DELETE FROM undo_rows WHERE (SELECT started=0 FROM undo_action) AND g IN (SELECT id FROM undo_groups ORDER BY id DESC LIMIT -1 OFFSET 100); DELETE FROM undo_groups WHERE (SELECT started=0 FROM undo_action) AND id NOT IN (SELECT id FROM undo_groups ORDER BY id DESC LIMIT 100); UPDATE undo_action SET started=1; INSERT INTO undo_rows(g,t,k,b,a) VALUES((SELECT cursor FROM undo_state WHERE id=1),'{table}',{prefix}.{key},{old},{new}) ON CONFLICT(g,t,k) DO UPDATE SET a=excluded.a; END;"))?;
  }
 }
 Ok(())
}
pub fn begin(c:&Connection)->rusqlite::Result<()> {
 c.execute_batch("UPDATE undo_action SET started=0;")
}
#[tauri::command]
pub fn history_step(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,redo:bool,empty_entry:Option<String>)->Result<bool,String>{
 let changed={
  let mut db=store.lock().map_err(|e|e.to_string())?;
  if let Some(id)=empty_entry.filter(|_|!redo) { undo_empty_entry(&mut db,&id) } else { step(&mut db,redo) }
 }.map_err(|e|e.to_string())?;
 if changed {let _=app.emit("history:restored",());}Ok(changed)
}
/// Empty editor undo removes only this entry, never unrelated changes in other windows.
/// Record the inverse as an already-undone group so Ctrl+Y restores the same entry ID.
fn undo_empty_entry(store: &mut Store, id: &str) -> rusqlite::Result<bool> {
 use rusqlite::OptionalExtension;
 let tx = store.conn.transaction()?;
 let date: Option<String> = tx.query_row(
  "SELECT day_date FROM entries WHERE id=?1 AND text='' AND plan IS NULL", [id], |r| r.get(0)
 ).optional()?;
 let Some(date) = date else { return Ok(false) };
 begin(&tx)?;
 tx.execute("DELETE FROM entries WHERE id=?1", [id])?;
 tx.execute("UPDATE days SET revision=revision+1 WHERE date=?1", [&date])?;
 tx.execute_batch("UPDATE undo_rows SET b=a,a=b WHERE g=(SELECT cursor FROM undo_state);
  UPDATE undo_state SET cursor=COALESCE((SELECT MAX(id) FROM undo_groups WHERE id<undo_state.cursor),0);")?;
 tx.commit()?;
 Ok(true)
}

pub(crate) fn step(store:&mut Store,redo:bool)->rusqlite::Result<bool>{
 use rusqlite::OptionalExtension;
 let tx=store.conn.transaction()?;
 let sql=if redo{"SELECT MIN(g) FROM undo_rows WHERE g>(SELECT cursor FROM undo_state) AND b IS NOT a"}else{"SELECT MAX(g) FROM undo_rows WHERE g<=(SELECT cursor FROM undo_state) AND b IS NOT a"};
 let group:Option<i64>=tx.query_row(sql,[],|r|r.get(0))?;let Some(group)=group else{return Ok(false)};
 let mut rows={let mut s=tx.prepare("SELECT t,k,b,a FROM undo_rows WHERE g=?1 AND b IS NOT a")?;let r=s.query_map([group],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?)))?;r.collect::<rusqlite::Result<Vec<_>>>()?};
 rows.sort_by_key(|(table,_,b,a)| {
  let rank=match table.as_str(){"days"|"tags"|"series"=>0,_=>1};
  if (if redo{a}else{b}).is_none(){(0,1-rank)}else{(1,rank)}
 });
 tx.execute_batch("UPDATE undo_state SET replaying=1; PRAGMA defer_foreign_keys=ON;")?;
 // Uniqueness cannot be deferred like foreign keys. Free only changing UIDs before replaying
 // the group, so swaps and a delete/recreate using the same UID work in either direction.
 tx.execute("UPDATE entries SET calendar_uid=NULL WHERE calendar_uid IS NOT NULL
  AND id IN (SELECT k FROM undo_rows WHERE g=?1 AND t='entries' AND b IS NOT a)
  AND calendar_uid IS NOT (SELECT json_extract(CASE WHEN ?2 THEN a ELSE b END,'$.calendar_uid')
    FROM undo_rows WHERE g=?1 AND t='entries' AND k=entries.id)",params![group,redo])?;
 for (table,key,b,a) in &rows {
  let pk=if table=="days"{"date"}else if table=="settings"{"key"}else{"id"};
  let target=if redo{a}else{b};
  if let Some(raw)=target {
   let value:Value=serde_json::from_str(raw).map_err(|e|rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
   let mut object=value.as_object().ok_or(rusqlite::Error::InvalidQuery)?.clone();
   if table=="days" {
    let current:Option<i64>=tx.query_row("SELECT revision FROM days WHERE date=?1",[key],|r|r.get(0)).optional()?;
    let recorded=[b,a].into_iter().flatten().filter_map(|r|serde_json::from_str::<Value>(r).ok()?.get("revision")?.as_i64()).max().unwrap_or(0);
    object.insert("revision".into(),Value::from(current.unwrap_or(0).max(recorded)+1));
   }
   let columns=object.keys().cloned().collect::<Vec<_>>();
   let values=columns.iter().map(|k|match &object[k]{Value::String(s)=>rusqlite::types::Value::Text(s.clone()),Value::Number(n)=>rusqlite::types::Value::Integer(n.as_i64().unwrap()),_=>rusqlite::types::Value::Null}).collect::<Vec<_>>();
   tx.execute(&format!("INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT({pk}) DO UPDATE SET {}",columns.join(","),vec!["?";columns.len()].join(","),columns.iter().filter(|c|c.as_str()!=pk).map(|c|format!("{c}=excluded.{c}")).collect::<Vec<_>>().join(",")),rusqlite::params_from_iter(values))?;
  }else{tx.execute(&format!("DELETE FROM {table} WHERE {pk}=?1"),[key])?;}
 }
 let cursor=if redo{group}else{tx.query_row("SELECT MAX(id) FROM undo_groups WHERE id<?1",[group],|r|r.get::<_,Option<i64>>(0)).optional()?.flatten().unwrap_or(0)};
 tx.execute("UPDATE undo_state SET replaying=0,cursor=?1",params![cursor])?;tx.commit()?;Ok(true)
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn undo_redo_and_new_branch(){
  let path=std::env::temp_dir().join(format!("undo-{}.db",uuid::Uuid::new_v4()));let mut db=Store::open(&path).unwrap();
  db.save_period_data("{\"rating\":1}").unwrap();db.save_period_data("{\"rating\":2}").unwrap();
  assert!(step(&mut db,false).unwrap());assert_eq!(db.period_data().unwrap(),"{\"rating\":1}");
  assert!(step(&mut db,true).unwrap());assert_eq!(db.period_data().unwrap(),"{\"rating\":2}");
  step(&mut db,false).unwrap();db.save_period_data("{\"rating\":1}").unwrap();assert!(step(&mut db,true).unwrap());step(&mut db,false).unwrap();db.save_period_data("{\"rating\":3}").unwrap();assert!(!step(&mut db,true).unwrap());
  drop(db);std::fs::remove_file(path).unwrap();
 }
 #[test]fn grouped_delete_restores_child_rows_and_rollback_keeps_history(){
  let path=std::env::temp_dir().join(format!("undo-{}.db",uuid::Uuid::new_v4()));let mut db=Store::open(&path).unwrap();
  {let tx=db.conn.transaction().unwrap();begin(&tx).unwrap();tx.execute_batch("INSERT INTO days VALUES('2026-11-03','Title','Body',1); INSERT INTO entries(id,day_date,kind,text,done,position) VALUES('child','2026-11-03','task','Child',0,0);").unwrap();tx.commit().unwrap();}
  {let tx=db.conn.transaction().unwrap();begin(&tx).unwrap();tx.execute_batch("DELETE FROM days WHERE date='2026-11-03';").unwrap();tx.commit().unwrap();}
  step(&mut db,false).unwrap();assert_eq!(db.load("2026-11-03").unwrap().title,"Title");assert_eq!(db.load("2026-11-03").unwrap().entries.len(),1);
  {let tx=db.conn.transaction().unwrap();begin(&tx).unwrap();tx.execute_batch("UPDATE days SET title='lost'").unwrap();}
  step(&mut db,true).unwrap();assert_eq!(db.conn.query_row("SELECT COUNT(*) FROM days",[],|r|r.get::<_,i64>(0)).unwrap(),0);
  drop(db);std::fs::remove_file(path).unwrap();
 }
 #[test]
 fn tag_cascade_board_and_restart() {
  let path=std::env::temp_dir().join(format!("undo-{}.db",uuid::Uuid::new_v4()));
  let mut db=Store::open(&path).unwrap();
  {let tx=db.conn.transaction().unwrap();begin(&tx).unwrap();
   tx.execute_batch("INSERT INTO days VALUES('2026-11-03','Title','Body',1);
    INSERT INTO tags(id,name,color,position) VALUES('tag','Work','#aaff00',0);
    INSERT INTO entries(id,day_date,kind,text,done,position,tag) VALUES('entry','2026-11-03','task','Task',0,0,'tag');
    INSERT INTO settings VALUES('board:card:test','{\"title\":\"Note\"}');").unwrap();tx.commit().unwrap();}
  {let tx=db.conn.transaction().unwrap();begin(&tx).unwrap();tx.execute_batch("DELETE FROM tags; DELETE FROM settings WHERE key='board:card:test';").unwrap();tx.commit().unwrap();}
  drop(db); db=Store::open(&path).unwrap();
  assert!(step(&mut db,false).unwrap());
  assert_eq!(db.conn.query_row("SELECT tag FROM entries WHERE id='entry'",[],|r|r.get::<_,String>(0)).unwrap(),"tag");
  assert_eq!(db.conn.query_row("SELECT COUNT(*) FROM settings WHERE key='board:card:test'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
  assert!(step(&mut db,true).unwrap());
  assert_eq!(db.conn.query_row("SELECT tag FROM entries WHERE id='entry'",[],|r|r.get::<_,Option<String>>(0)).unwrap(),None);
  drop(db);std::fs::remove_file(path).unwrap();
 }
 #[test]
 fn history_is_bounded_and_polling_preserves_redo() {
  let path=std::env::temp_dir().join(format!("undo-{}.db",uuid::Uuid::new_v4()));let mut db=Store::open(&path).unwrap();
  for i in 0..110 { db.save_period_data(&format!("{{\"rating\":{i}}}")).unwrap(); }
  assert_eq!(db.conn.query_row("SELECT COUNT(*) FROM undo_groups",[],|r|r.get::<_,i64>(0)).unwrap(),100);
  assert!(step(&mut db,false).unwrap());
  db.due_reminders(chrono::NaiveDate::from_ymd_opt(2026,11,3).unwrap().and_hms_opt(10,0,0).unwrap()).unwrap();
  assert!(step(&mut db,true).unwrap());
  drop(db);std::fs::remove_file(path).unwrap();
 }

 #[test]
 fn empty_editor_undo_is_targeted_and_redo_restores_it() {
  let path=std::env::temp_dir().join(format!("undo-{}.db",uuid::Uuid::new_v4()));let mut db=Store::open(&path).unwrap();
  {let tx=db.conn.transaction().unwrap();begin(&tx).unwrap();
   tx.execute_batch("INSERT INTO days VALUES('2026-11-03','','',1);
   INSERT INTO entries(id,day_date,kind,text,done,position) VALUES('empty','2026-11-03','task','',0,0);
   INSERT INTO entries(id,day_date,kind,text,done,position) VALUES('other','2026-11-03','task','Keep',0,1);").unwrap();tx.commit().unwrap();}
  db.save_period_data("{\"rating\":4}").unwrap();
  assert!(!undo_empty_entry(&mut db,"other").unwrap());
  assert!(undo_empty_entry(&mut db,"empty").unwrap());
  assert_eq!(db.load("2026-11-03").unwrap().entries.len(),1);
  assert_eq!(db.period_data().unwrap(),"{\"rating\":4}");
  assert!(step(&mut db,true).unwrap());
  assert_eq!(db.load("2026-11-03").unwrap().entries.len(),2);
  assert!(step(&mut db,false).unwrap());
  assert_eq!(db.load("2026-11-03").unwrap().entries.len(),1);
  drop(db);std::fs::remove_file(path).unwrap();
 }

}
