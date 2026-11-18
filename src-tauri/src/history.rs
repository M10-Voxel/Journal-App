//! Undo and redo for the windows; the history itself lives in journal-core (`journal_core::history`).
use crate::storage::Store;
use journal_core::history::undo_empty_entry;
use std::sync::Mutex;
use tauri::Emitter;
pub use journal_core::history::{begin, step};

#[tauri::command]
pub async fn history_step(app:tauri::AppHandle,store:tauri::State<'_,Mutex<Store>>,redo:bool,empty_entry:Option<String>)->Result<bool,String>{
 let changed={
  let mut db=store.lock().map_err(|e|e.to_string())?;
  if let Some(id)=empty_entry.filter(|_|!redo) { undo_empty_entry(&mut db,&id) } else { step(&mut db,redo) }
 }.map_err(|e|e.to_string())?;
 if changed {let _=app.emit("history:restored",());}Ok(changed)
}
