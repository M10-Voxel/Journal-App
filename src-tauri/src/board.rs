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
    card_list(&db)
}
fn card_list(db:&Store)->Result<Vec<Value>> {
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
        let value=write_card(db,id,patch)?;
        tx.commit().map_err(|e|e.to_string())?;
        Ok(value)
}
fn write_card(db:&Store,id:&str,patch:&Value)->Result<Value>{
        uuid::Uuid::parse_str(id).map_err(|_|"Ungültige Karte")?;
        let key=format!("board:card:{id}");
        let previous:Option<String>=db.conn.query_row("SELECT value FROM settings WHERE key=?1",[&key],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
        let mut value:Value=previous.map(|s|serde_json::from_str(&s)).transpose().map_err(|e|e.to_string())?.unwrap_or(json!({"id":id}));
        for (key,v) in patch.as_object().ok_or("Ungültige Karte")? { if key!="id" {value[key]=v.clone();} }
        if !matches!(value["kind"].as_str(),Some("note"|"image"|"link")) || !value["dates"].is_array() {return Err("Ungültige Karte".into())}
        let text=value.to_string();if text.len()>200_000 {return Err("Diese Notiz ist zu groß".into())}
        db.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[key,text]).map_err(|e|e.to_string())?;
        Ok(value)
}
/// A thread has two ends: save both in one transaction and one undo step.
#[tauri::command]
pub fn board_patch_many(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,patches:Value,source:String)->Result<()> {
    let (cards,_)={let db=store.lock().map_err(|e|e.to_string())?;update_cards(&db,&patches,&[])?};
    for card in cards {let _=app.emit("board:changed",json!({"card":card,"source":source}));}Ok(())
}
/// Deleting a note, its private attachments and the threads is one undoable operation.
#[tauri::command]
pub fn board_remove(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,id:String,source:String) -> Result<()> {
    let (cards,removed)={let db=store.lock().map_err(|e|e.to_string())?;remove_card(&db,&id)?};
    for card in cards {let _=app.emit("board:changed",json!({"card":card,"source":source}));}
    for id in removed {let _=app.emit("board:removed",json!({"id":id,"source":source}));}Ok(())
}
fn remove_card(db:&Store,id:&str)->Result<(Vec<Value>,Vec<String>)>{update_cards(db,&json!({}),&[id.to_string()])}
fn update_cards(db:&Store,patches:&Value,remove:&[String])->Result<(Vec<Value>,Vec<String>)>{
    let tx=db.conn.unchecked_transaction().map_err(|e|e.to_string())?;
    crate::history::begin(&tx).map_err(|e|e.to_string())?;
    let mut changed=std::collections::BTreeMap::new();
    for (id,patch) in patches.as_object().ok_or("Ungültige Karten")? {changed.insert(id.clone(),write_card(db,id,patch)?);}
    if remove.is_empty(){tx.commit().map_err(|e|e.to_string())?;return Ok((changed.into_values().collect(),vec![]))}
    let cards=card_list(db)?;
    let mut removed=remove.to_vec();
    for id in remove {
        uuid::Uuid::parse_str(id).map_err(|_|"Ungültige Karte")?;
        if let Some(note)=cards.iter().find(|c|c["id"]==id.as_str()&&c["kind"]=="note") {
            for attachment in &cards {
                if attachment["kind"]=="note"||attachment["notebook"]!=true||!attachment["dates"].as_array().is_some_and(|d|d.is_empty()){continue}
                let linked=note["links"].as_array().is_some_and(|links|links.contains(&attachment["id"]));
                let private=attachment["links"].as_array().is_none_or(|links|links.iter().all(|link|link==id.as_str()||remove.iter().any(|r|link==r.as_str())));
                if linked&&private {if let Some(id)=attachment["id"].as_str(){removed.push(id.to_string());}}
            }
        }
    }
    removed.sort();removed.dedup();
    for mut card in cards {
        let id=card["id"].as_str().ok_or("Ungültige Karte")?.to_string();
        if removed.contains(&id){changed.remove(&id);continue}
        if let Some(links)=card["links"].as_array() {
            let kept:Vec<Value>=links.iter().filter(|link|!removed.iter().any(|id|**link==id.as_str())).cloned().collect();
            if kept.len()!=links.len(){card["links"]=json!(kept);changed.insert(id.clone(),write_card(db,&id,&card)?);}
        }
    }
    for id in &removed {db.conn.execute("DELETE FROM settings WHERE key=?1",[format!("board:card:{id}")]).map_err(|e|e.to_string())?;}
    tx.commit().map_err(|e|e.to_string())?;Ok((changed.into_values().collect(),removed))
}

// The notebook's folders: `board:folder:{id}` = { id, name, parent, order }. A note names its folder in `folder`.
fn folder_list(db:&Store)->Result<Vec<Value>>{
    let mut stmt=db.conn.prepare("SELECT value FROM settings WHERE key LIKE 'board:folder:%'").map_err(|e|e.to_string())?;
    let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
    rows.map(|r|serde_json::from_str(&r.map_err(|e|e.to_string())?).map_err(|e|e.to_string())).collect()
}
#[tauri::command]
pub fn board_folders(store:tauri::State<'_,Mutex<Store>>) -> Result<Vec<Value>> { let db=store.lock().map_err(|e|e.to_string())?; folder_list(&db) }
#[tauri::command]
pub fn board_folder_save(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,folder:Value) -> Result<Value> {
    let value={ let db=store.lock().map_err(|e|e.to_string())?; save_folder(&db,&folder)? };
    let _=app.emit("board:folders",());Ok(value)
}
fn save_folder(db:&Store,folder:&Value)->Result<Value>{
    let id=folder["id"].as_str().ok_or("Ungültiger Ordner")?;uuid::Uuid::parse_str(id).map_err(|_|"Ungültiger Ordner")?;
    let name=folder["name"].as_str().ok_or("Ungültiger Ordner")?.trim();
    if name.is_empty()||name.chars().count()>120 {return Err("Bitte einen Ordnernamen eingeben".into())}
    let parent=match &folder["parent"] {Value::Null=>None,Value::String(p)=>{uuid::Uuid::parse_str(p).map_err(|_|"Ungültiger Ordner")?;Some(p.clone())},_=>return Err("Ungültiger Ordner".into())};
    // A folder cannot lie inside itself (directly or further down).
    let folders=folder_list(db)?;
    let mut at=parent.clone();let mut steps=0;
    while let Some(p)=at {
        if p==id||steps>1000 {return Err("Ein Ordner kann nicht in sich selbst liegen".into())}
        steps+=1;at=folders.iter().find(|f|f["id"]==p.as_str()).and_then(|f|f["parent"].as_str().map(String::from));
    }
    let value=json!({"id":id,"name":name,"parent":parent,"order":folder["order"].as_f64().unwrap_or(0.)});
    let tx=db.conn.unchecked_transaction().map_err(|e|e.to_string())?;
    crate::history::begin(&tx).map_err(|e|e.to_string())?;
    db.conn.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[format!("board:folder:{id}"),value.to_string()]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;Ok(value)
}
/// Removes a folder; its subfolders and notes move up into its parent (or out of every folder).
#[tauri::command]
pub fn board_folder_remove(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,id:String) -> Result<()> {
    let cards={ let db=store.lock().map_err(|e|e.to_string())?; remove_folder(&db,&id)? };
    for card in cards {let _=app.emit("board:changed",json!({"card":card,"source":"backend"}));}
    let _=app.emit("board:folders",());Ok(())
}
/// Returns the cards that moved up.
fn remove_folder(db:&Store,id:&str)->Result<Vec<Value>>{
    uuid::Uuid::parse_str(id).map_err(|_|"Ungültiger Ordner")?;
    let key=format!("board:folder:{id}");
    let own:Option<String>=db.conn.query_row("SELECT value FROM settings WHERE key=?1",[&key],|r|r.get(0)).optional().map_err(|e|e.to_string())?;
    let Some(own)=own else {return Ok(vec![])};
    let parent=serde_json::from_str::<Value>(&own).map_err(|e|e.to_string())?["parent"].clone();
    let tx=db.conn.unchecked_transaction().map_err(|e|e.to_string())?;
    crate::history::begin(&tx).map_err(|e|e.to_string())?;
    let write=|key:String,value:&Value|db.conn.execute("UPDATE settings SET value=?2 WHERE key=?1",[key,value.to_string()]).map_err(|e|e.to_string());
    for mut child in folder_list(db)?.into_iter().filter(|f|f["parent"]==id) {
        child["parent"]=parent.clone();
        let child_key=format!("board:folder:{}",child["id"].as_str().unwrap_or_default());write(child_key,&child)?;
    }
    let cards:Vec<(String,String)>={
        let mut stmt=db.conn.prepare("SELECT key,value FROM settings WHERE key LIKE 'board:card:%'").map_err(|e|e.to_string())?;
        let rows=stmt.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?;
        rows.collect::<std::result::Result<_,_>>().map_err(|e|e.to_string())?
    };
    let mut moved=Vec::new();
    for (card_key,text) in cards {
        let mut card:Value=serde_json::from_str(&text).map_err(|e|e.to_string())?;
        if card["folder"]==id {card["folder"]=parent.clone();write(card_key,&card)?;moved.push(card);}
    }
    db.conn.execute("DELETE FROM settings WHERE key=?1",[&key]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;Ok(moved)
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
    #[test] fn threads_and_note_deletion_are_atomic_and_undo_restores_private_attachments(){
        let path=std::env::temp_dir().join(format!("journal-notebook-undo-{}.sqlite",uuid::Uuid::new_v4()));
        let mut db=Store::open(&path).unwrap();
        let state=|db:&Store|{let mut cards=card_list(db).unwrap();cards.sort_by_key(|c|c["id"].as_str().unwrap().to_string());cards};
        let (note,page,image,shared)=(uuid::Uuid::new_v4().to_string(),uuid::Uuid::new_v4().to_string(),uuid::Uuid::new_v4().to_string(),uuid::Uuid::new_v4().to_string());
        for (id,kind) in [(&note,"note"),(&page,"note"),(&image,"image"),(&shared,"link")] {
            save_card(&db,id,&json!({"kind":kind,"title":id,"text":"","dates":[],"notebook":true,"links":[]})).unwrap();
        }
        let patches=json!({&note:{"links":[page,image,shared]},&page:{"links":[note,shared]},&image:{"links":[note]},&shared:{"links":[note,page]}});
        update_cards(&db,&patches,&[]).unwrap();
        let tied=state(&db);
        crate::history::step(&mut db,false).unwrap();
        assert!(state(&db).iter().all(|c|c["links"]==json!([])));
        crate::history::step(&mut db,true).unwrap();assert_eq!(state(&db),tied);
        // A failed batch must not leave a one-ended thread behind.
        assert!(update_cards(&db,&json!({&note:{"links":[]},"invalid":{}}),&[]).is_err());
        assert_eq!(state(&db),tied);
        let (_,removed)=remove_card(&db,&note).unwrap();
        assert!(removed.contains(&note)&&removed.contains(&image)&&removed.len()==2);
        let kept=state(&db);assert_eq!(kept.len(),2);
        assert!(kept.iter().all(|c|!c["links"].as_array().unwrap().contains(&json!(note))));
        crate::history::step(&mut db,false).unwrap();assert_eq!(state(&db),tied);
        crate::history::step(&mut db,true).unwrap();assert_eq!(state(&db),kept);
        drop(db);std::fs::remove_file(path).unwrap();
    }
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
    #[test] fn folders_move_their_contents_up_when_removed_and_notes_keep_links_and_folder(){
        let path=std::env::temp_dir().join(format!("journal-folders-{}.sqlite",uuid::Uuid::new_v4()));
        let id=||uuid::Uuid::new_v4().to_string();
        let (top,middle,inner,note,other)=(id(),id(),id(),id(),id());
        let db=Store::open(&path).unwrap();
        save_folder(&db,&json!({"id":top,"name":"Projekte","parent":null,"order":1})).unwrap();
        save_folder(&db,&json!({"id":middle,"name":"Garten","parent":top,"order":1})).unwrap();
        save_folder(&db,&json!({"id":inner,"name":"Beete","parent":middle,"order":1})).unwrap();
        // No folder inside itself, nor inside one of its own subfolders; a name is needed.
        assert!(save_folder(&db,&json!({"id":top,"name":"Projekte","parent":inner})).is_err());
        assert!(save_folder(&db,&json!({"id":top,"name":"  ","parent":null})).is_err());
        save_card(&db,&note,&json!({"kind":"note","title":"Saat","text":"","dates":[],"order":1,"folder":middle,"links":[other],"created":"2026-11-04","notebook":true})).unwrap();
        save_card(&db,&other,&json!({"kind":"note","title":"Zweite Seite","text":"","dates":["2026-11-04"],"order":2,"links":[note]})).unwrap();
        // Partial edits keep the notebook's fields.
        let card=save_card(&db,&note,&json!({"text":"Tomaten"})).unwrap();
        assert_eq!(card["folder"],middle.as_str());assert_eq!(card["links"],json!([other]));assert_eq!(card["notebook"],true);
        drop(db);
        let db=Store::open(&path).unwrap();
        let moved=remove_folder(&db,&middle).unwrap();
        assert_eq!(moved.len(),1);assert_eq!(moved[0]["folder"],top.as_str());
        let folders=folder_list(&db).unwrap();
        assert_eq!(folders.len(),2);
        assert_eq!(folders.iter().find(|f|f["id"]==inner.as_str()).unwrap()["parent"],top.as_str());
        let stored:String=db.conn.query_row("SELECT value FROM settings WHERE key=?1",[format!("board:card:{note}")],|r|r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap()["folder"],top.as_str());
        // Removing the top folder moves everything out of every folder.
        remove_folder(&db,&top).unwrap();
        assert_eq!(folder_list(&db).unwrap()[0]["parent"],Value::Null);
        remove_card(&db,&other).unwrap();
        assert_eq!(db.conn.query_row("SELECT COUNT(*) FROM settings WHERE key LIKE 'board:card:%'",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(db);std::fs::remove_file(path).unwrap();
    }
}
