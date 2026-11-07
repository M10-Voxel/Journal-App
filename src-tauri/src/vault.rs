//! The pointer to a vault is device-local. Data never gets moved out of the old vault.
//! Changes take effect on restart, after every window and background writer has stopped.
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, sync::Mutex};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::Manager;

type Result<T> = std::result::Result<T, String>;
type Preferences = BTreeMap<String, String>;
const DB: &str = "journal.sqlite3";
const LOCAL: &str = "journal.local.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pending { path: PathBuf, mode: String }
#[derive(Default, Serialize, Deserialize)]
struct Config { active: Option<PathBuf>, pending: Option<Pending> }
pub struct Vault { pub path: PathBuf, global: PathBuf, error: Option<String>, operation: Mutex<()> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { path: String, legacy: bool, preferences: Option<Preferences>, error: Option<String> }
#[derive(Serialize)]
pub struct Choice { path: String }

fn error(e: impl std::fmt::Display) -> String { format!("Vault: {e}") }
fn read_config(global: &Path) -> Result<Config> {
    match fs::read(global.join("vault.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(error),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(error(e)),
    }
}
// rename-over-existing is atomic on Windows and Unix. A failed write keeps the old pointer.
fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(value).map_err(error)?;
    let result = (|| { use std::io::Write; let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temp).map_err(error)?;
        file.write_all(&bytes).map_err(error)?; file.sync_all().map_err(error)?; drop(file); fs::rename(&temp, path).map_err(error) })();
    if result.is_err() { let _ = fs::remove_file(temp); }
    result
}
fn empty(path: &Path) -> Result<()> {
    if fs::read_dir(path).map_err(error)?.next().is_some() { return Err(error("Für einen neuen Vault bitte einen leeren Ordner auswählen.")); }
    Ok(())
}
fn validate(path: &Path) -> Result<()> {
    let db = Connection::open_with_flags(path.join(DB), OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(error)?;
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(error)?;
    if !(1..=12).contains(&version) { return Err(error("Kein unterstützter Journal-Vault. Eventuell benötigt er eine neuere App-Version.")); }
    for table in ["days", "entries"] { db.prepare(&format!("SELECT * FROM {table} LIMIT 0")).map_err(error)?; }
    let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(error)?;
    if check != "ok" { return Err(error("Die Datenbankprüfung ist fehlgeschlagen.")); }
    Ok(())
}
fn backup(source: &Path, target: &Path) -> Result<()> {
    let conn = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(error)?;
    conn.busy_timeout(std::time::Duration::from_secs(10)).map_err(error)?;
    // Includes committed WAL pages; copying the .sqlite file alone would lose them.
    conn.backup("main", target, None).map_err(error)
}
fn copy_images(source: &Path, target: &Path) -> Result<()> {
    if !source.exists() { return Ok(()); }
    fs::create_dir(target).map_err(error)?;
    for entry in fs::read_dir(source).map_err(error)? {
        let entry = entry.map_err(error)?;
        if entry.file_type().map_err(error)?.is_file() && entry.path().extension().is_some_and(|x| x == "avif") {
            fs::copy(entry.path(), target.join(entry.file_name())).map_err(error)?;
        }
    }
    Ok(())
}
fn initialize(source: &Path, target: &Path, mode: &str) -> Result<()> {
    if mode == "open" { return validate(target); }
    empty(target)?;
    // A private staging directory prevents an incomplete copy from becoming a valid vault.
    let stage = target.join(format!(".journal-import-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&stage).map_err(error)?;
    let result = (|| {
        if mode == "copy" {
            backup(&source.join(DB), &stage.join(DB))?;
            if source.join("mail.sqlite3").is_file() { backup(&source.join("mail.sqlite3"), &stage.join("mail.sqlite3"))?; }
            copy_images(&source.join("board-images"), &stage.join("board-images"))?;
            if source.join(LOCAL).is_file() { fs::copy(source.join(LOCAL), stage.join(LOCAL)).map_err(error)?; }
        } else if mode == "empty" {
            drop(crate::storage::Store::open(&stage.join(DB)).map_err(error)?);
        } else { return Err(error("Unbekannter Vault-Modus")); }
        validate(&stage)?;
        for name in ["mail.sqlite3", "board-images", LOCAL, DB] {
            if stage.join(name).exists() { fs::rename(stage.join(name), target.join(name)).map_err(error)?; }
        }
        Ok(())
    })();
    // Only our unique staging directory is removed, never the selected folder or old vault.
    let _ = fs::remove_dir_all(&stage);
    result
}
impl Vault {
    pub fn load_or_choose(global: PathBuf) -> Result<Self> {
        match Self::load(global.clone()) {
            Ok(vault) => Ok(vault),
            Err(reason) => {
                // Recovery stays explicit: never silently fall back to a different journal.
                let answer = rfd::MessageDialog::new().set_title("Journal-Vault nicht erreichbar")
                    .set_description(format!("{reason}\n\nLaufwerk verbinden und Journal erneut öffnen. Oder jetzt einen anderen vorhandenen Vault auswählen?"))
                    .set_buttons(rfd::MessageButtons::YesNo).set_level(rfd::MessageLevel::Error).show();
                if answer != rfd::MessageDialogResult::Yes { return Err(reason); }
                let path = rfd::FileDialog::new().set_title("Vorhandenen Journal-Vault öffnen").pick_folder().ok_or(reason)?;
                let path = fs::canonicalize(path).map_err(error)?;
                validate(&path)?;
                write_json(&global.join("vault.json"), &Config { active: Some(path), pending: None })?;
                Self::load(global)
            }
        }
    }
    pub fn load(global: PathBuf) -> Result<Self> {
        fs::create_dir_all(&global).map_err(error)?;
        let mut config = read_config(&global)?;
        let mut path = config.active.clone().unwrap_or_else(|| global.clone());
        let mut failure = None;
        if let Some(pending) = config.pending.take() {
            match initialize(&path, &pending.path, &pending.mode) {
                Ok(()) => { path = pending.path; config.active = Some(path.clone()); }
                Err(e) => failure = Some(e),
            }
            write_json(&global.join("vault.json"), &config)?;
        }
        // An unavailable custom disk must never silently create an empty journal elsewhere.
        if config.active.is_some() { validate(&path)?; }
        Ok(Self { path, global, error: failure, operation: Mutex::new(()) })
    }
    fn status(&self) -> Result<Status> {
        let preferences = match fs::read(self.path.join(LOCAL)) {
            Ok(bytes) => Some(serde_json::from_slice(&bytes).map_err(error)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(error(e)),
        };
        Ok(Status { path: self.path.to_string_lossy().into_owned(), legacy: self.path == self.global, preferences, error: self.error.clone() })
    }
}
pub fn directory(app: &tauri::AppHandle) -> PathBuf { app.state::<Vault>().path.clone() }
#[tauri::command]
pub async fn vault_status(vault: tauri::State<'_, Vault>) -> Result<Status> { vault.status() }
#[tauri::command]
pub async fn vault_save_preferences(preferences: Preferences, vault: tauri::State<'_, Vault>) -> Result<()> {
    let _guard = vault.operation.lock().map_err(error)?;
    if preferences.iter().any(|(k, v)| !k.starts_with("journal.") || v.len() > 32_000_000) { return Err(error("Ungültige lokale Vault-Einstellungen")); }
    write_json(&vault.path.join(LOCAL), &preferences)
}
#[tauri::command]
pub async fn vault_choose(mode: String) -> Result<Option<Choice>> {
    if !["open", "copy", "empty"].contains(&mode.as_str()) { return Err(error("Unbekannter Vault-Modus")); }
    let Some(folder) = rfd::AsyncFileDialog::new().set_title("Journal-Vault auswählen").pick_folder().await else { return Ok(None); };
    let path = fs::canonicalize(folder.path()).map_err(error)?;
    if mode == "open" { validate(&path)?; } else { empty(&path)?; }
    Ok(Some(Choice { path: path.to_string_lossy().into_owned() }))
}
#[tauri::command]
pub async fn vault_activate(app: tauri::AppHandle, path: String, mode: String, vault: tauri::State<'_, Vault>) -> Result<()> {
    let _guard = vault.operation.lock().map_err(error)?;
    if !["open", "copy", "empty"].contains(&mode.as_str()) { return Err(error("Unbekannter Vault-Modus")); }
    let path = fs::canonicalize(path).map_err(error)?;
    let current = fs::canonicalize(&vault.path).map_err(error)?;
    if path == current || path.starts_with(&current) { return Err(error("Bitte einen anderen Ordner außerhalb des aktuellen Vaults auswählen.")); }
    if mode == "open" { validate(&path)?; } else { empty(&path)?; }
    write_json(&vault.global.join("vault.json"), &Config { active: Some(vault.path.clone()), pending: Some(Pending { path, mode }) })?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp { fn new() -> Self { let p = std::env::temp_dir().join(format!("journal-vault-{}", uuid::Uuid::new_v4())); fs::create_dir(&p).unwrap(); Self(p) } }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    #[test]
    fn copies_wal_data_assets_mail_and_local_preferences_without_modifying_source() {
        let source = Temp::new(); let target = Temp::new();
        let store = crate::storage::Store::open(&source.0.join(DB)).unwrap();
        store.conn.execute("INSERT INTO settings VALUES('test','retained')", []).unwrap();
        let mail = Connection::open(source.0.join("mail.sqlite3")).unwrap(); mail.execute("CREATE TABLE test(value TEXT)", []).unwrap();
        mail.execute("INSERT INTO test VALUES('mail')", []).unwrap();
        fs::create_dir(source.0.join("board-images")).unwrap(); fs::write(source.0.join("board-images/photo.avif"), b"image").unwrap();
        write_json(&source.0.join(LOCAL), &serde_json::json!({"journal.activityTimers.v1":"timers"})).unwrap();
        initialize(&source.0, &target.0, "copy").unwrap();
        let copied = crate::storage::Store::open(&target.0.join(DB)).unwrap();
        assert_eq!(copied.conn.query_row("SELECT value FROM settings WHERE key='test'", [], |r| r.get::<_, String>(0)).unwrap(), "retained");
        assert_eq!(fs::read(target.0.join("board-images/photo.avif")).unwrap(), b"image");
        assert!(target.0.join(LOCAL).is_file()); assert!(target.0.join("mail.sqlite3").is_file()); assert!(source.0.join(DB).is_file());
    }
    #[test]
    fn rejects_overwriting_an_existing_folder_and_falls_back_after_failed_switch() {
        let global = Temp::new(); let target = Temp::new();
        drop(crate::storage::Store::open(&global.0.join(DB)).unwrap());
        fs::write(target.0.join("important.txt"), "keep").unwrap();
        write_json(&global.0.join("vault.json"), &Config { active: None, pending: Some(Pending { path: target.0.clone(), mode: "copy".into() }) }).unwrap();
        let vault = Vault::load(global.0.clone()).unwrap();
        assert_eq!(vault.path, global.0); assert!(vault.error.is_some());
        assert_eq!(fs::read_to_string(target.0.join("important.txt")).unwrap(), "keep"); assert!(!target.0.join(DB).exists());
    }
    #[test]
    fn switches_between_independent_vaults_and_refuses_missing_custom_storage() {
        let global = Temp::new(); let second = Temp::new();
        drop(crate::storage::Store::open(&global.0.join(DB)).unwrap());
        write_json(&global.0.join("vault.json"), &Config { active: None, pending: Some(Pending { path: second.0.clone(), mode: "empty".into() }) }).unwrap();
        assert_eq!(Vault::load(global.0.clone()).unwrap().path, second.0);
        write_json(&global.0.join("vault.json"), &Config { active: Some(second.0.join("missing")), pending: None }).unwrap();
        assert!(Vault::load(global.0.clone()).is_err());
    }
}
