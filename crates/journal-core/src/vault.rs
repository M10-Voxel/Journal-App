//! Where the journal's database is. The pointer to the vault folder is device-local: `vault.json` in the app's data
//! folder (`active`; without one the data folder itself is the vault). Choosing and moving vaults is the app's
//! (`src-tauri/src/vault.rs`); other programs only follow the pointer.
use std::{fs, path::{Path, PathBuf}};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

type Result<T> = std::result::Result<T, String>;
pub const DB: &str = "journal.sqlite3";
pub const LOCAL: &str = "journal.local.json";
/// The app's identifier (`tauri.conf.json`); its data folder holds `vault.json`.
pub const IDENTIFIER: &str = "de.journal.local";
/// The newest database version this code knows (see `storage/schema.rs`).
pub const SCHEMA_VERSION: i64 = 14;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending { pub path: PathBuf, pub mode: String }
#[derive(Default, Serialize, Deserialize)]
pub struct Config { pub active: Option<PathBuf>, pub pending: Option<Pending> }

pub fn error(e: impl std::fmt::Display) -> String { format!("Vault: {e}") }
pub fn read_config(global: &Path) -> Result<Config> {
    match fs::read(global.join("vault.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(error(e)),
    }
}
pub fn validate(path: &Path) -> Result<()> {
    let db = Connection::open_with_flags(path.join(DB), OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(error)?;
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(error)?;
    if !(1..=SCHEMA_VERSION).contains(&version) { return Err(error("Kein unterstützter Journal-Vault. Eventuell benötigt er eine neuere App-Version.")); }
    for table in ["days", "entries"] { db.prepare(&format!("SELECT * FROM {table} LIMIT 0")).map_err(error)?; }
    let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(error)?;
    if check != "ok" { return Err(error("Die Datenbankprüfung ist fehlgeschlagen.")); }
    Ok(())
}

/// The app's data folder, as Tauri's `app_local_data_dir` names it: `%LOCALAPPDATA%\de.journal.local` on Windows,
/// `~/Library/Application Support/de.journal.local` on macOS, `$XDG_DATA_HOME` (or `~/.local/share`) on Linux.
pub fn app_data_folder() -> Option<PathBuf> {
    let env = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty()).map(PathBuf::from);
    let base = if cfg!(windows) { env("LOCALAPPDATA") }
        else if cfg!(target_os = "macos") { env("HOME").map(|home| home.join("Library/Application Support")) }
        else { env("XDG_DATA_HOME").or_else(|| env("HOME").map(|home| home.join(".local/share"))) };
    base.map(|base| base.join(IDENTIFIER))
}

/// The vault the app uses now (a choice still pending applies only when the app starts next). Never a different
/// journal: an unreachable custom vault is an error, not a fallback.
pub fn active_vault(global: &Path) -> Result<PathBuf> {
    let config = read_config(global)?;
    match config.active {
        Some(path) => { validate(&path)?; Ok(path) }
        None if global.join(DB).is_file() => Ok(global.to_path_buf()),
        None => Err(error("Noch kein Journal-Vault eingerichtet. Bitte zuerst die Journal-App starten.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp { fn new() -> Self { let p = std::env::temp_dir().join(format!("journal-core-vault-{}", uuid::Uuid::new_v4())); fs::create_dir(&p).unwrap(); Self(p) } }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn follows_the_pointer_and_never_falls_back() {
        let global = Temp::new();
        assert!(active_vault(&global.0).is_err(), "Without a vault there is nothing to open.");
        drop(crate::storage::Store::open(&global.0.join(DB)).unwrap());
        assert_eq!(active_vault(&global.0).unwrap(), global.0, "The legacy vault is the data folder itself.");
        let custom = Temp::new();
        drop(crate::storage::Store::open(&custom.0.join(DB)).unwrap());
        fs::write(global.0.join("vault.json"), serde_json::to_vec(&Config { active: Some(custom.0.clone()), pending: None }).unwrap()).unwrap();
        assert_eq!(active_vault(&global.0).unwrap(), custom.0);
        fs::remove_file(custom.0.join(DB)).unwrap();
        assert!(active_vault(&global.0).is_err(), "An unreachable vault is an error, not the data folder.");
    }
}
