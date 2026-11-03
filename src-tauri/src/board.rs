use crate::storage::Store;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use rusqlite::OptionalExtension;
use std::{io::Read, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
type Result<T> = std::result::Result<T, String>;

#[tauri::command]
pub fn board_list(store:tauri::State<'_,Mutex<Store>>) -> Result<Vec<Value>> {
    let db=store.lock().map_err(|e|e.to_string())?;
    let mut stmt=db.conn.prepare("SELECT value FROM settings WHERE key LIKE 'board:card:%'").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
    rows.map(|r|serde_json::from_str(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect()
}
#[tauri::command]
pub fn board_patch(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,id:String,patch:Value,source:String) -> Result<Value> {
    uuid::Uuid::parse_str(&id).map_err(|_|"Ungültige Karte")?;
    let value={
        let db=store.lock().map_err(|e|e.to_string())?;
        save_card(&db,&id,&patch)?
    };
    let _=app.emit("board:changed",json!({"card":value,"source":source}));Ok(value)
}
fn save_card(db:&Store,id:&str,patch:&Value)->Result<Value>{
        let tx=db.conn.unchecked_transaction().map_err(|e|e.to_string())?;
        crate::history::begin(&tx).map_err(|e|e.to_string())?;
        let key=format!("board:card:{id}");
        let previous:Option<String>=db.conn.query_row("SELECT value FROM settings WHERE key=?1",[&key],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        let mut value:Value=previous.map(|s|serde_json::from_str(&s)).transpose().map_err(|e|e.to_string())?.unwrap_or(json!({"id":id}));
        for (key,v) in patch.as_object().ok_or("Ungültige Karte")? { if key!="id" {value[key]=v.clone();} }
        if !matches!(value["kind"].as_str(),Some("note"|"image"|"link")) || !value["dates"].is_array() {return Err("Ungültige Karte".into())}
        let text=value.to_string();if text.len()>200_000 {return Err("Diese Notiz ist zu groß".into())}
        db.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,text]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(value)
}
fn asset_path(app:&tauri::AppHandle,id:&str)->Result<std::path::PathBuf>{
    uuid::Uuid::parse_str(id).map_err(|_|"Ungültiges Bild")?;
    Ok(app.path().app_local_data_dir().map_err(|e|e.to_string())?.join("board-images").join(format!("{id}.avif")))
}
#[tauri::command]
pub fn board_image_save(app:tauri::AppHandle,id:String,data:String)->Result<()> {
    if data.len()>28_000_000{return Err("Bild ist zu groß".into())}
    let bytes=STANDARD.decode(data).map_err(|_|"Ungültige Bilddaten")?;
    if bytes.len()<16 || &bytes[4..8]!=b"ftyp" || !bytes[8..32.min(bytes.len())].windows(4).any(|s|s==b"avif"||s==b"avis") {return Err("AVIF-Bild erwartet".into())}
    let p=asset_path(&app,&id)?;std::fs::create_dir_all(p.parent().unwrap()).map_err(|e|e.to_string())?;
    std::fs::write(p,bytes).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn board_image_load(app:tauri::AppHandle,id:String)->Result<String>{
    Ok(format!("data:image/avif;base64,{}",STANDARD.encode(std::fs::read(asset_path(&app,&id)?).map_err(|e|e.to_string())?)))
}
fn link_url(input:&str)->Result<url::Url>{let u=url::Url::parse(input).map_err(|_|"Ungültiger Link")?;if u.scheme()!="https"||u.host_str().is_none()||!u.username().is_empty()||u.password().is_some(){return Err("Bitte einen HTTPS-Link eingeben".into())}Ok(u)}
#[tauri::command]
pub async fn board_link_preview(url:String)->Result<String>{
    let url=link_url(&url)?;
    tauri::async_runtime::spawn_blocking(move||{
        let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(12)).redirect(reqwest::redirect::Policy::limited(4)).build().map_err(|e|e.to_string())?;
        let response=client.get(url).header("User-Agent","Journal/0.1 LinkPreview").send().map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
        if response.url().scheme()!="https"{return Err("Unsichere Weiterleitung".into())}
        let mut body=String::new();response.take(1_000_000).read_to_string(&mut body).map_err(|e|e.to_string())?;Ok(body)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn board_open_link(url:String)->Result<()>{crate::mail::oauth::open_browser(link_url(&url)?.as_str())}
#[tauri::command]
pub async fn board_detach(app:tauri::AppHandle,id:String)->Result<()> {
    uuid::Uuid::parse_str(&id).map_err(|_|"Ungültige Notiz")?;
    let label=format!("board-{id}");
    if let Some(w)=app.get_webview_window(&label){let _=w.unminimize();return w.set_focus().map_err(|e|e.to_string())}
    tauri::WebviewWindowBuilder::new(&app,label,tauri::WebviewUrl::App("index.html".into()))
        .title("Journal · Notiz").inner_size(420.,400.).min_inner_size(280.,200.).decorations(false).always_on_top(true)
        .additional_browser_args(&crate::browser_args()).build().map(|_|()).map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn cards_survive_restart_and_partial_edits_keep_their_links(){
        let path=std::env::temp_dir().join(format!("journal-board-{}.sqlite",uuid::Uuid::new_v4()));
        let id=uuid::Uuid::new_v4().to_string();
        let db=Store::open(&path).unwrap();
        save_card(&db,&id,&json!({"kind":"note","title":"Zettel","text":"**Markdown**","dates":["2026-11-02"],"order":1})).unwrap();
        save_card(&db,&id,&json!({"text":"Neuer Inhalt"})).unwrap();drop(db);
        let db=Store::open(&path).unwrap();
        let card=save_card(&db,&id,&json!({"title":"Neuer Titel","dates":["2026-11-02","2026-11-03"]})).unwrap();
        assert_eq!(card["text"],"Neuer Inhalt");assert_eq!(card["dates"].as_array().unwrap().len(),2);
        assert!(save_card(&db,&id,&json!({"kind":"invalid"})).is_err());
        assert_eq!(save_card(&db,&id,&json!({})).unwrap()["kind"],"note");
        drop(db);std::fs::remove_file(path).unwrap();
    }
}
