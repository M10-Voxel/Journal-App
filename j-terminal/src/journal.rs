//! Opening the journal the Journal app uses: follow `vault.json` in the app's data folder to the vault and open its
//! `journal.sqlite3` through `journal-core` (WAL, so both programs may use it at once).
//! On first use J-TerminaL creates a shared local journal and never falls back from a configured vault, and it leaves a database alone that is newer
//! than its `journal-core` (it would not understand what it writes).
use std::path::{Path, PathBuf};
use journal_core::{storage::Store, vault};
use rusqlite::{Connection, OpenFlags};

#[derive(Debug, PartialEq, Eq)]
pub enum Problem {
    /// The app has not made a journal yet.
    NoVault,
    /// `vault.json` names a folder without a journal (a drive not plugged in, a moved folder).
    Unreachable(PathBuf),
    /// Written by a newer app: J-TerminaL needs an update.
    TooNew,
    Failed(String),
}

pub struct Journal {
    /// The folder the journal lies in (shown by later stages).
    #[allow(dead_code)]
    pub vault: PathBuf,
    pub store: Store,
}

/// The journal of the app whose data folder is `data` (`vault::app_data_folder()` outside of tests).
pub fn open(data: &Path) -> Result<Journal, Problem> {
    let config = vault::read_config(data).map_err(Problem::Failed)?;
    let vault = match config.active {
        Some(path) => path,
        None if data.join(vault::DB).is_file() => data.to_path_buf(),
        None if config.pending.is_none() => {
            std::fs::create_dir_all(data).map_err(|e| Problem::Failed(e.to_string()))?;
            let store = Store::open(&data.join(vault::DB)).map_err(|e| Problem::Failed(e.to_string()))?;
            return Ok(Journal { vault: data.to_owned(), store });
        }
        None => return Err(Problem::NoVault),
    };
    let db = vault.join(vault::DB);
    if !db.is_file() { return Err(Problem::Unreachable(vault)); }
    if read_version(&db).map_err(Problem::Failed)? > vault::SCHEMA_VERSION { return Err(Problem::TooNew); }
    let store = Store::open(&db).map_err(|e| Problem::Failed(e.to_string()))?;
    Ok(Journal { vault, store })
}

/// The schema version, read through a read-only connection (`Store::open` would migrate the database). Not from the
/// file's header: in WAL mode a newer version may still be in the log only.
fn read_version(db: &Path) -> Result<i64, String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| e.to_string())?;
    conn.pragma_query_value(None, "user_version", |row| row.get(0)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("j-terminal-test-{}-{}", std::process::id(), next()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn next() -> u64 {
        static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }
    fn make_journal(folder: &Path) { drop(Store::open(&folder.join(vault::DB)).unwrap()); }
    fn point_to(data: &Path, vault: &Path) {
        fs::write(data.join("vault.json"), format!("{{\"active\":{}}}", serde_json_string(vault))).unwrap();
    }
    fn serde_json_string(path: &Path) -> String { format!("{:?}", path.to_str().unwrap()) }

    #[test]
    fn standalone_first_start_creates_a_persistent_shared_journal() {
        let data = Temp::new();
        let folder = data.0.join("first");
        open(&folder).unwrap().store.set_interface_language("en").unwrap();
        assert_eq!(open(&folder).unwrap().store.interface_language().unwrap(), "en");
        assert_eq!(vault::active_vault(&folder).unwrap(), folder);
    }

    #[test]
    fn the_data_folder_itself_is_the_old_vault() {
        let data = Temp::new();
        make_journal(&data.0);
        assert_eq!(open(&data.0).unwrap().vault, data.0);
    }

    #[test]
    fn follows_vault_json_and_never_falls_back() {
        let data = Temp::new();
        let custom = Temp::new();
        make_journal(&data.0);
        make_journal(&custom.0);
        point_to(&data.0, &custom.0);
        assert_eq!(open(&data.0).unwrap().vault, custom.0);
        fs::remove_file(custom.0.join(vault::DB)).unwrap();
        assert_eq!(open(&data.0).err(), Some(Problem::Unreachable(custom.0.clone())));
        assert!(!custom.0.join(vault::DB).exists(), "An unreachable journal is not made anew.");
    }

    #[test]
    fn leaves_a_newer_journal_alone() {
        let data = Temp::new();
        make_journal(&data.0);
        let db = data.0.join(vault::DB);
        let newer = vault::SCHEMA_VERSION + 1;
        Store::open(&db).unwrap().conn.pragma_update(None, "user_version", newer).unwrap();
        assert_eq!(open(&data.0).err(), Some(Problem::TooNew));
        assert_eq!(read_version(&db).unwrap(), newer, "The version stays untouched.");
    }

    #[test]
    fn reads_the_version_without_writing() {
        let data = Temp::new();
        make_journal(&data.0);
        let db = data.0.join(vault::DB);
        let version: i64 = Store::open(&db).unwrap().conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(read_version(&db).unwrap(), version);
        let other = data.0.join("other.sqlite3");
        fs::write(&other, b"not a database, but long enough to have a header of a hundred bytes ..............................").unwrap();
        assert!(read_version(&other).is_err());
    }

    #[test]
    fn the_journal_is_usable() {
        let data = Temp::new();
        make_journal(&data.0);
        let journal = open(&data.0).unwrap();
        assert_eq!(journal.store.interface_language().unwrap(), "de");
        journal.store.set_interface_language("en").unwrap();
        assert_eq!(open(&data.0).unwrap().store.interface_language().unwrap(), "en");
    }
}
