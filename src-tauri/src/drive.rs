use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, sync::{Mutex, atomic::AtomicBool}, time::Duration};
use tauri::Manager;
use crate::{mail::{Account, Secret, oauth, secrets}, storage::Store};
type Result<T> = std::result::Result<T,String>;
// JavaScript serializes whole-valued floats as integers. Settings may still contain
// 1.0 (e.g. folder order), so compare JSON by value across the IPC round trip.
fn same_sync_value(a:&Value,b:&Value)->bool {
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
static OPERATION: Mutex<()> = Mutex::new(());
static CANCEL: AtomicBool = AtomicBool::new(false);
#[derive(Default, Serialize, Deserialize)]
struct Credentials { client: String, secret: Secret }
fn path(app: &tauri::AppHandle) -> Result<PathBuf> { Ok(app.path().app_data_dir().map_err(|e|e.to_string())?.join("drive.credentials")) }
fn load(app: &tauri::AppHandle) -> Result<Credentials> {
    let p=path(app)?; if !p.exists() {return Ok(Credentials::default())}
    serde_json::from_slice(&secrets::protect(&std::fs::read(p).map_err(|e|e.to_string())?,false)?).map_err(|e|e.to_string())
}
fn persist(app: &tauri::AppHandle, c: &Credentials) -> Result<()> {
    persist_at(&path(app)?, c)
}
fn persist_at(p: &Path, c: &Credentials) -> Result<()> {
    let parent = p.parent().ok_or("Ungültiger Speicherpfad für Google-Drive-Zugangsdaten")?;
    std::fs::create_dir_all(parent).map_err(|e|format!("Google-Drive-Speicherordner konnte nicht angelegt werden: {e}"))?;
    let bytes=secrets::protect(&serde_json::to_vec(c).map_err(|e|e.to_string())?,true)?;
    let temporary=p.with_extension("tmp");
    std::fs::write(&temporary,bytes).map_err(|e|format!("Google-Drive-Zugangsdaten konnten nicht gespeichert werden: {e}"))?;
    std::fs::rename(&temporary,p).map_err(|e|format!("Google-Drive-Zugangsdaten konnten nicht übernommen werden: {e}"))
}
fn account(client: &str) -> Result<Account> {
    serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"provider":"Google Drive","label":"Drive","email":"","protocol":"drive","enabled":true,"clientId":client})).map_err(|e|e.to_string())
}
#[tauri::command]
pub async fn drive_status(app: tauri::AppHandle) -> Result<Value> { let c=load(&app)?; Ok(json!({"connected":!c.secret.refresh_token.is_empty(),"clientId":c.client})) }
#[tauri::command]
pub async fn drive_connect(app: tauri::AppHandle, client_id: String, client_secret: String) -> Result<()> {
    let _guard=OPERATION.try_lock().map_err(|_|"Google Drive arbeitet bereits")?;
    if !client_id.ends_with(".apps.googleusercontent.com") {return Err("Eine Google OAuth-Client-ID für Desktop-Apps eingeben".into())}
    CANCEL.store(false,std::sync::atomic::Ordering::SeqCst);
    let mut c=Credentials {client:client_id,secret:Secret {client_secret,..Default::default()}};
    oauth::authorize(&account(&c.client)?,&mut c.secret,&CANCEL)?; persist(&app,&c)
}
#[tauri::command]
pub fn drive_cancel() { CANCEL.store(true,std::sync::atomic::Ordering::SeqCst); }
#[tauri::command]
pub async fn drive_disconnect(app: tauri::AppHandle) -> Result<()> {
    let _guard=OPERATION.try_lock().map_err(|_|"Google Drive arbeitet bereits")?;
    let p=path(&app)?; if p.exists(){std::fs::remove_file(p).map_err(|e|e.to_string())?;} Ok(())
}
fn client() -> Result<reqwest::blocking::Client> { reqwest::blocking::Client::builder().timeout(Duration::from_secs(60)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string()) }
fn checked(r: reqwest::blocking::Response) -> Result<reqwest::blocking::Response> {
    if r.status().is_success() {return Ok(r)}
    let status=r.status().as_u16();
    // Only parse Google's structured error fields, never expose headers or tokens.
    let mut body=String::new();
    let _=std::io::Read::read_to_string(&mut std::io::Read::take(r,65_536),&mut body);
    Err(drive_error(status,&body))
}
fn drive_error(status:u16,body:&str) -> String {
    if status==412 {return "Der Cloud-Stand hat sich geändert. Bitte erneut synchronisieren.".into()}
    let value:Value=serde_json::from_str(body).unwrap_or(Value::Null);
    let error=&value["error"];
    let reasons:Vec<&str>=error["errors"].as_array().into_iter().flatten()
        .chain(error["details"].as_array().into_iter().flatten())
        .filter_map(|item|item["reason"].as_str()).collect();
    let has=|codes:&[&str]|reasons.iter().any(|reason|codes.contains(reason));
    let hint=if has(&["accessNotConfigured","SERVICE_DISABLED","API_DISABLED"]) {
        "Die Google Drive API ist im Projekt deiner Client-ID deaktiviert oder noch nicht aktiviert. In Google Cloud im richtigen Projekt unter APIs & Dienste → Bibliothek → Google Drive API aktivieren. Danach kurz warten und erneut synchronisieren."
    } else if has(&["insufficientPermissions","ACCESS_TOKEN_SCOPE_INSUFFICIENT"]) {
        "Die Drive-Berechtigung fehlt. In Journal die Verbindung trennen und erneut mit Google Drive verbinden; dabei den Zugriff auf die App-Daten erlauben."
    } else if has(&["storageQuotaExceeded"]) {
        "Dein Google-Speicher ist voll. Speicherplatz freigeben und erneut synchronisieren."
    } else if has(&["domainPolicy","ORG_RESTRICTION_VIOLATION"]) {
        "Eine Richtlinie deines Google-Workspace-Kontos blockiert den Zugriff. Die Freigabe muss durch die Kontoverwaltung erfolgen."
    } else if has(&["rateLimitExceeded","userRateLimitExceeded","dailyLimitExceeded","RATE_LIMIT_EXCEEDED"]) || status==429 {
        "Das Google-Anfragelimit ist erreicht. Später erneut versuchen und gegebenenfalls die Drive-API-Kontingente im Google-Projekt prüfen."
    } else if has(&["insufficientFilePermissions","appNotAuthorizedToFile"]) {
        "Dieses Google-Konto oder dieser OAuth-Client hat keinen Zugriff auf die Cloud-Datei. Dasselbe Google-Konto und dieselbe Client-ID wie beim ursprünglichen Abgleich verwenden."
    } else if status==401 {
        "Die Anmeldung ist abgelaufen oder ungültig. In Journal die Verbindung trennen und erneut anmelden."
    } else {
        "Drive-Zugriff fehlgeschlagen. Prüfe im Projekt deiner Client-ID, ob die Google Drive API aktiviert ist; andernfalls die Verbindung trennen und erneut anmelden."
    };
    // Preserve a bounded provider diagnosis for unknown errors without dumping the response.
    let code=reasons.first().copied().or_else(||error["status"].as_str()).unwrap_or("");
    let code:String=code.chars().filter(|c|c.is_ascii_alphanumeric()||*c=='_').take(100).collect();
    let mut message=format!("Google Drive: HTTP {status}{}. {hint}",if code.is_empty(){String::new()}else{format!(" ({code})")});
    if !has(&["accessNotConfigured","SERVICE_DISABLED","API_DISABLED","insufficientPermissions","ACCESS_TOKEN_SCOPE_INSUFFICIENT","storageQuotaExceeded","domainPolicy","ORG_RESTRICTION_VIOLATION","rateLimitExceeded","userRateLimitExceeded","dailyLimitExceeded","RATE_LIMIT_EXCEEDED","insufficientFilePermissions","appNotAuthorizedToFile"]) && status!=401 && status!=429 {
        if let Some(detail)=error["message"].as_str() {
            let detail:String=detail.chars().filter(|c|!c.is_control()).take(600).collect();
            if !detail.is_empty(){message.push_str(&format!(" Google: {detail}"));}
        }
    }
    message
}
fn token(app:&tauri::AppHandle) -> Result<String> {let mut c=load(app)?; oauth::refresh(&account(&c.client)?,&mut c.secret)?;persist(app,&c)?;Ok(c.secret.access_token)}
// The media download does not reliably return an ETag. Drive v2 exposes the
// file resource's ETag explicitly; use that same API for conditional updates.
fn cloud_etag(http:&reqwest::blocking::Client,token:&str,id:&str,base:&str)->Result<String>{
    let metadata:Value=checked(http.get(format!("{base}/drive/v2/files/{id}")).bearer_auth(token).query(&[("fields","etag")]).send().map_err(|_|"Dateiversion konnte nicht gelesen werden")?)?.json().map_err(|_|"Ungültige Dateimetadaten")?;
    let etag=metadata["etag"].as_str().filter(|s|s.starts_with('"')&&s.ends_with('"')&&s.len()>2).ok_or("Google liefert keine gültige Dateiversion; bitte erneut versuchen")?;
    Ok(etag.to_string())
}
fn read_cloud_file(http:&reqwest::blocking::Client,token:&str,id:&str,base:&str)->Result<(String,String)>{
    use std::io::Read;
    let before=cloud_etag(http,token,id,base)?;
    let response=checked(http.get(format!("{base}/drive/v3/files/{id}")).bearer_auth(token).query(&[("alt","media")]).send().map_err(|_|"Download fehlgeschlagen")?)?;
    if response.content_length().unwrap_or(0)>250_000_000{return Err("Cloud-Datei zu groß".into())}
    let mut data=String::new();response.take(250_000_001).read_to_string(&mut data).map_err(|_|"Download fehlgeschlagen")?;
    if data.len()>250_000_000{return Err("Cloud-Datei zu groß".into())}
    if before!=cloud_etag(http,token,id,base)?{return Err("Der Cloud-Stand hat sich während des Downloads geändert. Bitte erneut synchronisieren.".into())}
    Ok((data,before))
}
fn update_cloud_file(http:&reqwest::blocking::Client,token:&str,id:&str,etag:&str,data:String,base:&str)->Result<()>{
    checked(http.put(format!("{base}/upload/drive/v2/files/{id}?uploadType=media"))
        .bearer_auth(token).header("If-Match",etag).header("Content-Type","application/json").body(data)
        .send().map_err(|_|"Upload fehlgeschlagen")?)?;Ok(())
}
#[tauri::command]
pub async fn drive_read(app:tauri::AppHandle, vault:String) -> Result<Value> {
    let _guard=OPERATION.try_lock().map_err(|_|"Google Drive arbeitet bereits")?;
    if vault.len()!=64 || !vault.chars().all(|c|c.is_ascii_hexdigit()){return Err("Ungültiger Tresor".into())}
    let t=token(&app)?;let http=client()?;let name=format!("journal-{vault}.json");
    let list:Value=checked(http.get("https://www.googleapis.com/drive/v3/files").bearer_auth(&t).query(&[("spaces","appDataFolder"),("q",&format!("name='{name}' and trashed=false")),("fields","files(id),nextPageToken"),("pageSize","100")]).send().map_err(|_|"Google Drive ist nicht erreichbar")?)?.json().map_err(|_|"Ungültige Drive-Antwort")?;
    let files=list["files"].as_array().ok_or("Ungültige Dateiliste")?;
    if files.len()>1 || !list["nextPageToken"].is_null(){return Err("Mehrere Cloud-Stände mit derselben Tresor-ID gefunden. Es wurde nichts überschrieben.".into())}
    let Some(file)=files.first() else{return Ok(json!({"id":null,"data":null,"etag":null}))};
    let id=file["id"].as_str().ok_or("Datei-ID fehlt")?;
    let (data,etag)=read_cloud_file(&http,&t,id,"https://www.googleapis.com")?;
    Ok(json!({"id":id,"etag":etag,"data":data}))
}
#[tauri::command]
pub async fn drive_write(app:tauri::AppHandle,vault:String,id:Option<String>,etag:Option<String>,data:String) -> Result<()> {
    let _guard=OPERATION.try_lock().map_err(|_|"Google Drive arbeitet bereits")?;
    if vault.len()!=64 || !vault.chars().all(|c|c.is_ascii_hexdigit()) || data.len()>250_000_000 {return Err("Ungültige Synchronisierungsdaten".into())}
    let _:Value=serde_json::from_str(&data).map_err(|_|"Ungültige Verschlüsselungshülle")?;
    let http=client()?;let t=token(&app)?;
    if let Some(id)=id {
        if !id.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'||c=='-'){return Err("Ungültige Datei-ID".into())}
        update_cloud_file(&http,&t,&id,&etag.ok_or("Versionsschutz fehlt")?,data,"https://www.googleapis.com")?;
    } else {
        let boundary=uuid::Uuid::new_v4().simple().to_string();
        let metadata=json!({"name":format!("journal-{vault}.json"),"parents":["appDataFolder"]});
        let body=format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n{data}\r\n--{boundary}--\r\n");
        checked(http.post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart").bearer_auth(t).header("Content-Type",format!("multipart/related; boundary={boundary}")).body(body).send().map_err(|_|"Upload fehlgeschlagen")?)?;
    } Ok(())
}

const TABLES: &[(&str,&str)] = &[("tags","id"),("series","id"),("days","date"),("entries","id")];
/// Entry columns newer than the snapshot format, with the value an older snapshot's entries get.
fn later_column(col: &str) -> Option<Value> { match col { "reminder_before" => Some(json!(0)), "icon" => Some(Value::Null), _ => None } }
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
    fn sync_import(&mut self,expected:Value,snapshot:Value,commit:bool) -> Result<()> {
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
#[tauri::command]
pub async fn drive_snapshot(store:tauri::State<'_,Mutex<Store>>) -> Result<Value>{store.lock().map_err(|e|e.to_string())?.sync_snapshot()}
#[tauri::command]
pub async fn drive_apply(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,expected:Value,snapshot:Value)->Result<()>{
    use tauri::Emitter;
    let mut dates:Vec<String>=expected["tables"]["days"].as_object().into_iter().flat_map(|v|v.keys().cloned()).collect();
    dates.extend(snapshot["tables"]["days"].as_object().into_iter().flat_map(|v|v.keys().cloned()));
    let tags={let mut db=store.lock().map_err(|e|e.to_string())?;db.sync_apply(expected,snapshot)?;db.tags().map_err(|e|e.to_string())?};
    let _=app.emit("journal:changed",dates);let _=app.emit("journal:tags",tags);let _=app.emit("board:reset",());Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cloud_server(steps:Vec<(&'static str,u16,String)>)->(String,std::thread::JoinHandle<()>) {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base=format!("http://{}",listener.local_addr().unwrap());
        let thread=std::thread::spawn(move||{
            for (expected,status,body) in steps {
                let (mut socket,_)=listener.accept().unwrap();socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request=Vec::new();let mut block=[0;4096];
                loop {let n=socket.read(&mut block).unwrap();assert!(n>0);request.extend_from_slice(&block[..n]);if let Some(end)=request.windows(4).position(|s|s==b"\r\n\r\n") {
                    let headers=String::from_utf8_lossy(&request[..end]);
                    let length:usize=headers.lines().find_map(|line|line.to_ascii_lowercase().strip_prefix("content-length:").map(|s|s.trim().parse().unwrap())).unwrap_or(0);
                    if request.len()>=end+4+length {break}
                }}
                let request=String::from_utf8(request).unwrap();assert!(request.starts_with(expected),"Unexpected request: {}",request.lines().next().unwrap());
                if expected.starts_with("PUT") {assert!(request.to_ascii_lowercase().contains("if-match: \"v1\""));assert!(request.ends_with("{\"encrypted\":true}"));}
                // Deliberately omit the ETag response header, as Google's media endpoint does.
                write!(socket,"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        });(base,thread)
    }
    fn cloud_client()->reqwest::blocking::Client {reqwest::blocking::Client::builder().no_proxy().timeout(Duration::from_secs(5)).build().unwrap()}
    #[test] fn media_without_etag_uses_metadata_and_conditional_upload(){
        let metadata=json!({"etag":"\"v1\""}).to_string();
        let (base,server)=cloud_server(vec![
            ("GET /drive/v2/files/file?fields=etag ",200,metadata.clone()),
            ("GET /drive/v3/files/file?alt=media ",200,"{\"cipher\":\"test\"}".into()),
            ("GET /drive/v2/files/file?fields=etag ",200,metadata),
            ("PUT /upload/drive/v2/files/file?uploadType=media ",200,"{}".into())]);
        let http=cloud_client();let (data,etag)=read_cloud_file(&http,"test","file",&base).unwrap();
        assert_eq!(data,"{\"cipher\":\"test\"}");assert_eq!(etag,"\"v1\"");
        update_cloud_file(&http,"test","file",&etag,"{\"encrypted\":true}".into(),&base).unwrap();server.join().unwrap();
    }
    #[test] fn changed_download_and_stale_upload_are_rejected(){
        let (base,server)=cloud_server(vec![
            ("GET /drive/v2/files/file",200,json!({"etag":"\"v1\""}).to_string()),
            ("GET /drive/v3/files/file",200,"{}".into()),
            ("GET /drive/v2/files/file",200,json!({"etag":"\"v2\""}).to_string()),
            ("PUT /upload/drive/v2/files/file",412,"{}".into())]);
        let http=cloud_client();assert!(read_cloud_file(&http,"test","file",&base).unwrap_err().contains("während des Downloads"));
        assert!(update_cloud_file(&http,"test","file","\"v1\"","{\"encrypted\":true}".into(),&base).unwrap_err().contains("Cloud-Stand hat sich geändert"));server.join().unwrap();
    }
    #[test] fn missing_metadata_version_still_fails_safely(){
        let (base,server)=cloud_server(vec![("GET /drive/v2/files/file",200,"{}".into())]);
        assert!(read_cloud_file(&cloud_client(),"test","file",&base).unwrap_err().contains("keine gültige Dateiversion"));server.join().unwrap();
    }
    #[test] fn google_errors_explain_disabled_api_missing_scope_and_quota() {
        for reason in ["accessNotConfigured","SERVICE_DISABLED"] {
            let body=if reason=="accessNotConfigured" {json!({"error":{"errors":[{"reason":reason}]}})}else{json!({"error":{"details":[{"reason":reason}]}})};
            let message=drive_error(403,&body.to_string());
            assert!(message.contains(reason));
            assert!(message.contains("Google Drive API"));
            assert!(message.contains("aktivieren"));
        }
        let scope=drive_error(403,&json!({"error":{"details":[{"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}]}}).to_string());
        assert!(scope.contains("Verbindung trennen"));
        let quota=drive_error(403,&json!({"error":{"errors":[{"reason":"storageQuotaExceeded"}]}}).to_string());
        assert!(quota.contains("Speicher ist voll"));
        let fallback=drive_error(403,&json!({"error":{"status":"PERMISSION_DENIED","message":"A provider diagnosis"},"access_token":"never-display"}).to_string());
        assert!(fallback.contains("PERMISSION_DENIED"));
        assert!(fallback.contains("A provider diagnosis"));
        assert!(!fallback.contains("never-display"));
        assert!(drive_error(403,"not json").contains("HTTP 403"));
        assert!(drive_error(412,"").contains("Cloud-Stand hat sich geändert"));
    }
    #[test] fn http_error_responses_are_parsed_by_the_transport() {
        use std::io::{Read,Write};
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address=listener.local_addr().unwrap();
        let server=std::thread::spawn(move||{
            let (mut socket,_)=listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request=[0;8192];socket.read(&mut request).unwrap();
            let body=r#"{"error":{"details":[{"reason":"SERVICE_DISABLED"}]}}"#;
            write!(socket,"HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        });
        let response=reqwest::blocking::Client::builder().no_proxy().timeout(Duration::from_secs(5)).build().unwrap().get(format!("http://{address}")).send().unwrap();
        let message=checked(response).unwrap_err();
        server.join().unwrap();
        assert!(message.contains("SERVICE_DISABLED"));
        assert!(message.contains("aktivieren"));
    }
    #[cfg(windows)]
    #[test] fn credentials_create_missing_directory_and_can_be_updated() {
        let root=std::env::temp_dir().join(format!("journal-drive-credentials-{}",uuid::Uuid::new_v4()));
        let p=root.join("app-data").join("drive.credentials");
        assert!(!root.exists());
        let mut credentials=Credentials {client:"test.apps.googleusercontent.com".into(),secret:Secret {refresh_token:"test-token".into(),..Default::default()}};
        persist_at(&p,&credentials).unwrap();
        credentials.secret.refresh_token="updated-test-token".into();
        persist_at(&p,&credentials).unwrap();
        let bytes=std::fs::read(&p).unwrap();
        let restored:Credentials=serde_json::from_slice(&secrets::protect(&bytes,false).unwrap()).unwrap();
        assert_eq!(restored.client,credentials.client);
        assert_eq!(restored.secret.refresh_token,"updated-test-token");
        assert!(!p.with_extension("tmp").exists());
        std::fs::remove_file(&p).unwrap();
        std::fs::remove_dir(p.parent().unwrap()).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test] fn ipc_integer_float_round_trip_does_not_look_like_a_local_edit(){
        let path=std::env::temp_dir().join(format!("journal-sync-numbers-{}.sqlite",uuid::Uuid::new_v4()));
        let mut db=Store::open(&path).unwrap();
        db.conn.execute("INSERT INTO settings(key,value) VALUES('board:folder:test',?1)",[r#"{"id":"test","order":1.0,"parent":null}"#]).unwrap();
        let mut expected=db.sync_snapshot().unwrap();expected["settings"]["board:folder:test"]["order"]=json!(1);
        db.sync_import(expected.clone(),expected.clone(),false).unwrap();
        db.conn.execute("UPDATE settings SET value=?1 WHERE key='board:folder:test'",[r#"{"id":"test","order":2.0,"parent":null}"#]).unwrap();
        assert!(db.sync_apply(expected.clone(),expected).unwrap_err().contains("Lokale Daten"));
        assert!(!same_sync_value(&json!(9007199254740993u64),&json!(9007199254740992u64)));
        assert!(!same_sync_value(&json!(1.5),&json!(1)));
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test] fn snapshots_round_trip_and_stale_or_invalid_imports_do_not_replace_local_data(){
        let p=std::env::temp_dir().join(format!("journal-drive-{}.sqlite",uuid::Uuid::new_v4()));
        let mut db=Store::open(&p).unwrap();
        db.conn.execute("INSERT INTO days(date,title,body,revision) VALUES('2026-11-02','Privat','Notiz',7)",[]).unwrap();
        let id=uuid::Uuid::new_v4().to_string();
        let mail = "journal-mail:v1\n{\"html\":\"<h1>Grüße 👋</h1>\",\"text\":\"Hallo\",\"subject\":\"Termin\",\"sender\":\"test@example.org\"}";
        db.conn.execute("INSERT INTO entries(id,day_date,kind,text,done,position,description) VALUES(?1,'2026-11-02','event','Arbeit',0,0,?2)",rusqlite::params![&id,mail]).unwrap();
        let before=db.sync_snapshot().unwrap();let mut next=before.clone();next["tables"]["days"]["2026-11-02"]["title"]=json!("Neu");
        next["settings"]["period-data"]=json!({"days":{"2026-11-02":{"rating":8}},"definitions":[]});
        next["settings"]["board:folder:test"]=json!({"id":"test","name":"Projekte","parent":null,"order":1});
        next["settings"]["board:card:test"]=json!({"text":"Pinnwand","dates":["2026-11-02"],"folder":"test","links":["attachment"],"notebook":true,"created":"2026-11-02"});
        let mut invalid=next.clone();invalid["tables"]["entries"][&id]["day_date"]=json!("2099-01-01");
        assert!(db.sync_apply(before.clone(),invalid).is_err());assert_eq!(db.sync_snapshot().unwrap(),before);
        db.sync_apply(before.clone(),next.clone()).unwrap();assert_eq!(db.load("2026-11-02").unwrap().revision,8);
        assert_eq!(db.sync_snapshot().unwrap(),next);assert!(db.sync_apply(before,next.clone()).is_err());assert_eq!(db.sync_snapshot().unwrap(),next);
        assert_eq!(db.load("2026-11-02").unwrap().entries[0].description,mail);
        // A snapshot of an older version has no lead time or icon on its entries: they get their defaults.
        let mut older=db.sync_snapshot().unwrap();let current=older.clone();
        for record in older["tables"]["entries"].as_object_mut().unwrap().values_mut(){let record=record.as_object_mut().unwrap();record.remove("reminder_before");record.remove("icon");}
        db.sync_apply(current,older).unwrap();
        let entry=&db.load("2026-11-02").unwrap().entries[0];assert_eq!((entry.reminder_before,entry.icon.clone()),(0,None));
        // Other columns may not be missing.
        let mut broken=db.sync_snapshot().unwrap();let now=broken.clone();
        broken["tables"]["entries"].as_object_mut().unwrap().values_mut().next().unwrap().as_object_mut().unwrap().remove("text");
        assert!(db.sync_apply(now,broken).is_err());
        assert!(db.period_data().unwrap().contains("rating"));
        drop(db);let _=std::fs::remove_file(p);
    }

    #[test] fn bulk_import_keeps_validation_backup_rollback_and_history() {
        use rusqlite::OptionalExtension;
        let path=std::env::temp_dir().join(format!("journal-drive-bulk-{}.sqlite",uuid::Uuid::new_v4()));
        let mut db=Store::open(&path).unwrap();
        for day in 1..=4 {
            let date=format!("2026-11-{day:02}");
            db.conn.execute("INSERT INTO days VALUES(?1,'Before','Journal body',7)",[&date]).unwrap();
            for i in 0..80 {
                db.conn.execute("INSERT INTO entries(id,day_date,kind,text,done,position,calendar_uid,description) VALUES(?1,?2,'event',?3,0,?4,?5,?6)",rusqlite::params![uuid::Uuid::new_v4().to_string(),date,format!("Event {i}"),i,format!("uid-{day}-{i}"),"Mail HTML 😸 ".repeat(100)]).unwrap();
            }
        }
        let before=db.sync_snapshot().unwrap();let mut next=before.clone();
        next["tables"]["days"]["2026-11-02"]["title"]=json!("After");
        for record in next["tables"]["entries"].as_object_mut().unwrap().values_mut() {record["text"]=json!("Changed event");}
        for i in 0..50 {next["settings"][format!("board:card:{i}")]=json!({"text":format!("Note {i}"),"dates":["2026-11-02"],"notebook":true});}
        next["settings"]["period-data"]=json!({"days":{"2026-11-02":{"rating":9}}});

        db.sync_import(before.clone(),next.clone(),false).unwrap();
        assert_eq!(db.sync_snapshot().unwrap(),before);
        assert_eq!(db.load("2026-11-02").unwrap().revision,7);
        assert!(db.conn.query_row("SELECT value FROM settings WHERE key='sync-local-backup'",[],|r|r.get::<_,String>(0)).optional().unwrap().is_none());

        let mut invalid=next.clone();
        invalid["tables"]["entries"].as_object_mut().unwrap().values_mut().last().unwrap().as_object_mut().unwrap().remove("description");
        assert!(db.sync_apply(before.clone(),invalid).is_err());
        assert_eq!(db.sync_snapshot().unwrap(),before);

        db.sync_apply(before.clone(),next.clone()).unwrap();
        assert_eq!(db.sync_snapshot().unwrap(),next);
        assert_eq!(db.load("2026-11-02").unwrap().revision,8);
        let backup:String=db.conn.query_row("SELECT value FROM settings WHERE key='sync-local-backup'",[],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&backup).unwrap(),before);
        assert!(db.sync_apply(before.clone(),next.clone()).is_err());
        assert_eq!(db.sync_snapshot().unwrap(),next);

        assert!(crate::history::step(&mut db,false).unwrap());
        assert_eq!(db.sync_snapshot().unwrap(),before);
        assert!(crate::history::step(&mut db,true).unwrap());
        assert_eq!(db.sync_snapshot().unwrap(),next);
        drop(db);std::fs::remove_file(path).unwrap();
    }
}

#[tauri::command]
pub async fn drive_validate(store:tauri::State<'_,Mutex<Store>>,expected:Value,snapshot:Value)->Result<()>{store.lock().map_err(|e|e.to_string())?.sync_import(expected,snapshot,false)}
#[tauri::command]
pub async fn drive_restore(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>)->Result<()>{
    use tauri::Emitter;
    let dates={let mut db=store.lock().map_err(|e|e.to_string())?;
    let backup:String=db.conn.query_row("SELECT value FROM settings WHERE key='sync-local-backup'",[],|r|r.get(0)).map_err(|_|"Noch kein lokaler Sync-Sicherungsstand vorhanden")?;
    let expected=db.sync_snapshot()?;let snapshot:Value=serde_json::from_str(&backup).map_err(|e|e.to_string())?;
    let mut dates:Vec<String>=expected["tables"]["days"].as_object().into_iter().flat_map(|v|v.keys().cloned()).collect();dates.extend(snapshot["tables"]["days"].as_object().into_iter().flat_map(|v|v.keys().cloned()));
    db.sync_apply(expected,snapshot)?;dates};let _=app.emit("journal:changed",dates);let _=app.emit("board:reset",());Ok(())
}

#[tauri::command]
pub async fn drive_help()->Result<()>{oauth::open_browser("https://console.cloud.google.com/apis/credentials")}
