//! Writes by other programs on the same database (J-TerminaL): once a second the store is asked whether another
//! connection committed (`Store::external_changes`, one cheap query while nothing happens). What changed reaches the
//! windows as the events they already know from writes made here, plus `journal:external` for the journal's own day.
use std::{sync::Mutex, time::Duration};
use journal_core::storage::Store;
use tauri::{AppHandle, Emitter, Manager};

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let Some(mut watch) = app.state::<Mutex<Store>>().lock().ok().and_then(|store| store.watch().ok()) else { return; };
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let found = app.state::<Mutex<Store>>().lock().ok().and_then(|store| {
                let changes = store.external_changes(&mut watch).ok().flatten()?;
                let tags = if changes.tags { store.tags().ok() } else { None };
                Some((changes, tags))
            });
            let Some((changes, tags)) = found else { continue; };
            // A step through the history elsewhere: every window reads everything again, as after an undo here.
            if changes.restored { let _ = app.emit("history:restored", ()); continue; }
            if !changes.dates.is_empty() {
                let _ = app.emit("journal:changed", &changes.dates);
                let _ = app.emit_to("main", "journal:external", &changes.dates);
            }
            if let Some(tags) = tags { let _ = app.emit("journal:tags", tags); }
            if changes.period { let _ = app.emit("period:changed", ()); }
            if changes.board { let _ = app.emit("board:reset", ()); }
        }
    });
}
