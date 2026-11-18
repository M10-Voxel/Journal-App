//! The journal's data, shared by the Journal app (`src-tauri`) and J-TerminaL (branch `J-TerminaL`): the SQLite store
//! with its schema and migrations, the undo history every write records into, the Drive snapshot, and where the vault
//! is. Nothing here knows about windows or Tauri; several programs may open the same database at once (WAL).
pub mod history;
pub mod storage;
pub mod sync;
pub mod vault;
pub mod watch;
