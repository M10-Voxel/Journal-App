//! The database as one JSON snapshot (Drive sync), and applying one back after checking it against what was read.
use serde_json::{json, Value};
use crate::storage::Store;
type Result<T> = std::result::Result<T,String>;

// JavaScript serializes whole-valued floats as integers. Settings may still contain
// 1.0 (e.g. folder order), so compare JSON by value across the IPC round trip.
pub fn same_sync_value(a:&Value,b:&Value)->bool {
    match (a,b) {
        (Value::Number(a),Value::Number(b)) => a==b || match (a.as_f64(),b.as_f64()) {
            (Some(a),Some(b)) => a.abs()<=9_007_199_254_740_991.0 && b.abs()<=9_007_199_254_740_991.0 && a==b,
            _=>false,
        },
        (Value::Array(a),Value::Array(b))=>a.len()==b.len()&&a.iter().zip(b).all(|(a,b)|same_sync_value(a,b)),
        (Value::Object(a),Value::Object(b))=>a.len()==b.len()&&a.iter().all(|(key,a)|b.get(key).is_some_and(|b|same_sync_value(a,b))),
        _=>a==b,
    }
}
const TABLES: &[(&str,&str)] = &[("tags","id"),("series","id"),("days","date"),("entries","id")];
/// Entry columns newer than the snapshot format, with the value an older snapshot's entries get.
fn later_column(col: &str) -> Option<Value> { match col { "reminder_before" | "time_grid" => Some(json!(0)), "icon" => Some(Value::Null), _ => None } }
impl Store {
    pub fn sync_snapshot(&self) -> Result<Value> {
        let mut tables=serde_json::Map::new();
        for (table,key) in TABLES {
            let mut stmt=self.conn.prepare(&format!("SELECT * FROM {table} ORDER BY {key}")).map_err(|e|e.to_string())?;
            let columns:Vec<String>=stmt.column_names().iter().map(|s|s.to_string()).collect();
            let mut rows=stmt.query([]).map_err(|e|e.to_string())?;let mut records=serde_json::Map::new();
            while let Some(row)=rows.next().map_err(|e|e.to_string())? {
                let mut record=serde_json::Map::new();
                for (i,name) in columns.iter().enumerate(){let value=match row.get_ref(i).map_err(|e|e.to_string())? {rusqlite::types::ValueRef::Null=>Value::Null,rusqlite::types::ValueRef::Integer(n)=>json!(n),rusqlite::types::ValueRef::Text(t)=>json!(String::from_utf8_lossy(t)),_=>return Err("Nicht unterstützter Datentyp".into())};record.insert(name.clone(),if name=="revision"{json!(1)}else{value});}
                records.insert(record[*key].as_str().ok_or("Datensatz ohne ID")?.to_string(),Value::Object(record));
            } tables.insert(table.to_string(),Value::Object(records));
        }
        let mut settings=serde_json::Map::new();
        let mut stmt=self.conn.prepare("SELECT key,value FROM settings WHERE key='period-data' OR key LIKE 'board:card:%' OR key LIKE 'board:folder:%'").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?;
        for row in rows {let (key,value)=row.map_err(|e|e.to_string())?;settings.insert(key,serde_json::from_str::<Value>(&value).map_err(|e|e.to_string())?);}
        Ok(json!({"schema":12,"tables":tables,"settings":settings}))
    }
    pub fn sync_apply(&mut self,expected:Value,snapshot:Value) -> Result<()> { self.sync_import(expected,snapshot,true) }
    /// With `commit` false it only checks that the snapshot would apply; nothing is written.
    pub fn sync_import(&mut self,expected:Value,snapshot:Value,commit:bool) -> Result<()> {
        // The Store stays locked for the import: this checked snapshot is also the backup.
        let backup=self.sync_snapshot()?;
        if !same_sync_value(&backup,&expected){return Err("Lokale Daten wurden während der Synchronisierung geändert. Erneut versuchen.".into())}
        drop(expected);
        if ![json!(11),json!(12)].contains(&snapshot["schema"]) || !snapshot["tables"].is_object(){return Err("Inkompatibler Cloud-Stand".into())}
        let revisions:std::collections::HashMap<String,i64>={let mut s=self.conn.prepare("SELECT date,revision FROM days").map_err(|e|e.to_string())?;let rows=s.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;rows.collect::<std::result::Result<_,_>>().map_err(|e|e.to_string())?};
        let tx=self.conn.transaction().map_err(|e|e.to_string())?;crate::history::begin(&tx).map_err(|e|e.to_string())?;
        tx.execute_batch("PRAGMA defer_foreign_keys=ON; DELETE FROM entries; DELETE FROM days; DELETE FROM series; DELETE FROM tags;").map_err(|e|e.to_string())?;
        for (table,key) in TABLES {
            let columns:Vec<String>={let stmt=tx.prepare(&format!("SELECT * FROM {table} LIMIT 0")).map_err(|e|e.to_string())?;stmt.column_names().iter().map(|v|v.to_string()).collect()};
            let records=snapshot["tables"][*table].as_object().ok_or("Tabelle fehlt")?;
            let sql=format!("INSERT INTO {table} ({}) VALUES ({})",columns.join(","),vec!["?";columns.len()].join(","));
            let mut insert=tx.prepare(&sql).map_err(|e|e.to_string())?;
            let revision=if *table=="days" {columns.iter().position(|c|c=="revision")} else {None};
            for (id,record) in records {
                if *table=="days" {chrono::NaiveDate::parse_from_str(id,"%Y-%m-%d").map_err(|_|"Ungültiges Datum im Cloud-Stand")?;} else {uuid::Uuid::parse_str(id).map_err(|_|"Ungültige ID im Cloud-Stand")?;}
                // Columns added after schema 12 (reminder lead time, icon) may be missing in a snapshot of an older version: they get their default.
                // A tag's icon (schema 14) as well.
                let later=|col:&str|(*table=="entries" && later_column(col).is_some()) || (*table=="tags" && col=="icon");
                let present=columns.iter().filter(|col|record.get(col.as_str()).is_some()).count();
                if record[*key].as_str()!=Some(id.as_str()) || record.as_object().map(|v|v.len())!=Some(present) || columns.iter().any(|col|record.get(col.as_str()).is_none() && !later(col)){return Err("Ungültiger Cloud-Datensatz".into())}
                let fallback=|col:&str|if *table=="entries" {later_column(col)} else if *table=="tags" && col=="icon" {Some(Value::Null)} else {None};
                let mut values=Vec::new();for col in &columns {let missing=record.get(col).is_none();let default=if missing {fallback(col).ok_or("Spalte fehlt")?} else {Value::Null};let v=if missing {&default} else {record.get(col).ok_or("Spalte fehlt")?};values.push(match v {Value::Null=>rusqlite::types::Value::Null,Value::String(s)=>rusqlite::types::Value::Text(s.clone()),Value::Number(n)=>rusqlite::types::Value::Integer(n.as_i64().ok_or("Ungültige Zahl")?),_=>return Err("Ungültiger Wert".into())});}
                if let Some(i)=revision {values[i]=rusqlite::types::Value::Integer(revisions.get(id).copied().unwrap_or(0)+1);}
                insert.execute(rusqlite::params_from_iter(values)).map_err(|e|e.to_string())?;
            }
        }
        if snapshot["schema"]==json!(12) {
            let settings=snapshot["settings"].as_object().ok_or("Zusatzdaten fehlen")?;
            tx.execute("DELETE FROM settings WHERE key='period-data' OR key LIKE 'board:card:%' OR key LIKE 'board:folder:%'",[]).map_err(|e|e.to_string())?;
            let mut insert=tx.prepare("INSERT INTO settings(key,value) VALUES(?1,?2)").map_err(|e|e.to_string())?;
            for (key,value) in settings {
                if key!="period-data" && !key.starts_with("board:card:") && !key.starts_with("board:folder:"){return Err("Ungültige Sync-Einstellung".into())}
                if !value.is_object(){return Err("Ungültige Zusatzdaten".into())}
                insert.execute(rusqlite::params![key,value.to_string()]).map_err(|e|e.to_string())?;
            }
        }
        drop(snapshot);
        tx.execute("INSERT INTO settings(key,value) VALUES('sync-local-backup',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[backup.to_string()]).map_err(|e|e.to_string())?;
        if tx.prepare("PRAGMA foreign_key_check").map_err(|e|e.to_string())?.exists([]).map_err(|e|e.to_string())? {return Err("Der Cloud-Stand enthält ungültige Verknüpfungen. Es wurde nichts übernommen.".into())}
        if commit {tx.commit().map_err(|e|e.to_string())} else {Ok(())}
    }
}
