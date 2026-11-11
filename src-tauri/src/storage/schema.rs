//! Connection setup and backward-compatible schema upgrades.
use super::*;

impl Store {
    pub fn open(path: &Path) -> Result<Self> { Self::from_connection(Connection::open(path)?) }
    pub(super) fn from_connection(mut conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")?;
        // WAL needs fewer syncs per save than the rollback journal and keeps reads independent of writes.
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
        let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version > 14 { return Err("Die Datenbank wurde mit einer neueren Version erstellt".into()); }
        if version == 0 {
            let tx = conn.transaction()?;
            tx.execute_batch("CREATE TABLE days (date TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0));
                CREATE TABLE entries (id TEXT PRIMARY KEY, day_date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('task','event','note')), text TEXT NOT NULL, done INTEGER NOT NULL CHECK(done IN (0,1)), position INTEGER NOT NULL, CHECK(kind = 'task' OR done = 0));
                CREATE INDEX entries_day_order ON entries(day_date, position);
                PRAGMA user_version = 1;")?;
            tx.commit()?;
        }
        if version < 2 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1) AND (kind = 'task' OR cancelled = 0) AND (done = 0 OR cancelled = 0)); PRAGMA user_version = 2;")?;
            tx.commit()?;
        }
        if version < 3 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK(priority IN (0,1)); PRAGMA user_version = 3;")?;
            tx.commit()?;
        }
        if version < 4 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN time TEXT CHECK(time IS NULL OR (kind <> 'note' AND time GLOB '[0-2][0-9]:[0-5][0-9]'));
                ALTER TABLE entries ADD COLUMN reminder INTEGER NOT NULL DEFAULT 0 CHECK(reminder IN (0,1) AND (kind <> 'note' OR reminder = 0));
                ALTER TABLE entries ADD COLUMN plan TEXT CHECK(plan IS NULL OR kind <> 'note');
                PRAGMA user_version = 4;")?;
            tx.commit()?;
        }
        if version < 5 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN end_time TEXT CHECK(end_time IS NULL OR (time IS NOT NULL AND end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time > time));
                PRAGMA user_version = 5;")?;
            tx.commit()?;
        }
        if version < 6 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN show_in_journal INTEGER NOT NULL DEFAULT 1 CHECK(show_in_journal IN (0,1));
                ALTER TABLE entries ADD COLUMN calendar_uid TEXT;
                CREATE UNIQUE INDEX entries_calendar_uid ON entries(calendar_uid) WHERE calendar_uid IS NOT NULL;
                PRAGMA user_version = 6;")?;
            tx.commit()?;
        }
        if version < 7 {
            let tx = conn.transaction()?;
            tx.execute_batch("CREATE TABLE series (id TEXT PRIMARY KEY, rule TEXT NOT NULL, horizon TEXT NOT NULL);
                ALTER TABLE entries ADD COLUMN series TEXT REFERENCES series(id) ON DELETE SET NULL;
                CREATE INDEX entries_series ON entries(series, day_date) WHERE series IS NOT NULL;
                PRAGMA user_version = 7;")?;
            tx.commit()?;
        }
        if version < 8 {
            let tx = conn.transaction()?;
            tx.execute_batch("CREATE TABLE reminder_log (id TEXT NOT NULL, due TEXT NOT NULL, snooze TEXT, PRIMARY KEY(id, due));
                CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                PRAGMA user_version = 8;")?;
            tx.commit()?;
        }
        if version < 9 {
            let tx = conn.transaction()?;
            tx.execute_batch("ALTER TABLE entries ADD COLUMN description TEXT NOT NULL DEFAULT ''; PRAGMA user_version = 9;")?;
            tx.commit()?;
        }
        if version < 10 {
            // Appointments may end on the next day: an end of 24:00–47:59 lies that many hours after the day's start
            // ("26:00" is 02:00 the next morning). SQLite changes a CHECK only by building the table anew, so the table is
            // copied under its own definition with just that rule replaced – whatever columns it has by now.
            let old: String = conn.query_row("SELECT sql FROM sqlite_master WHERE type='table' AND name='entries'", [], |r| r.get(0))?;
            let (rule, relaxed) = ("end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time > time", "end_time GLOB '[0-4][0-9]:[0-5][0-9]' AND end_time > time AND end_time < '48:00'");
            if !old.contains(rule) && !old.contains(relaxed) && !old.contains("length(end_time) BETWEEN 5 AND 7") { return Err("Unerwartetes Datenbankschema (entries)".into()); }
            let next = old.replacen("CREATE TABLE entries", "CREATE TABLE entries_next", 1).replace(rule, relaxed);
            let indexes: Vec<String> = conn.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='entries' AND sql IS NOT NULL")?
                .query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            // A table that already has the rule (made new) only needs the version.
            if old.contains(relaxed) || old.contains("length(end_time) BETWEEN 5 AND 7") { conn.execute_batch("PRAGMA user_version = 10;")?; } else {
            conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
            let rebuilt = (|| -> Result<()> {
                let tx = conn.transaction()?;
                tx.execute_batch(&next)?;
                tx.execute_batch("INSERT INTO entries_next SELECT * FROM entries; DROP TABLE entries; ALTER TABLE entries_next RENAME TO entries;")?;
                for index in &indexes { tx.execute_batch(index)?; }
                if tx.prepare("PRAGMA foreign_key_check")?.query([])?.next()?.is_some() { return Err("Fremdschlüssel nach dem Umbau verletzt".into()); }
                tx.execute_batch("PRAGMA user_version = 10;")?;
                tx.commit()?;
                Ok(())
            })();
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;
            rebuilt?;
            }
        }
        if version < 11 {
            // Tags: removing one leaves its entries untagged. (A database set back to an older version keeps what it has.)
            let tx = conn.transaction()?;
            let tagged = tx.prepare("SELECT 1 FROM pragma_table_info('entries') WHERE name='tag'")?.exists([])?;
            tx.execute_batch("CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL);")?;
            if !tagged { tx.execute_batch("ALTER TABLE entries ADD COLUMN tag TEXT REFERENCES tags(id) ON DELETE SET NULL;")?; }
            tx.execute_batch("CREATE INDEX IF NOT EXISTS entries_tag ON entries(tag); PRAGMA user_version = 11;")?;
            tx.commit()?;
        }
        // Longer appointments encode their end as hours since the start day's midnight.
        if version < 12 {
            let old:String=conn.query_row("SELECT sql FROM sqlite_master WHERE name='entries'",[],|r|r.get(0))?;
            let relaxed="end_time GLOB '[0-4][0-9]:[0-5][0-9]' AND end_time > time AND end_time < '48:00'";
            if old.contains(relaxed) {
                let next=old.replacen("CREATE TABLE entries","CREATE TABLE entries_next",1).replacen("CREATE TABLE \"entries\"","CREATE TABLE entries_next",1).replace(relaxed,"length(end_time) BETWEEN 5 AND 7 AND end_time GLOB '[0-9]*:[0-5][0-9]' AND CAST(substr(end_time,1,instr(end_time,':')-1) AS INTEGER)<=8784 AND (CAST(substr(end_time,1,instr(end_time,':')-1) AS INTEGER)*60+CAST(substr(end_time,-2) AS INTEGER))>(CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,-2) AS INTEGER))");
                let indexes:Vec<String>=conn.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='entries' AND sql IS NOT NULL")?.query_map([],|r|r.get(0))?.collect::<rusqlite::Result<_>>()?;
                conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
                let result=(||->Result<()> {let tx=conn.transaction()?;tx.execute_batch(&next)?;tx.execute_batch("INSERT INTO entries_next SELECT * FROM entries; DROP TABLE entries; ALTER TABLE entries_next RENAME TO entries;")?;for index in indexes{tx.execute_batch(&index)?;}tx.commit()?;Ok(())})();
                conn.execute_batch("PRAGMA foreign_keys=ON;")?;result?;
            }
            conn.execute_batch("PRAGMA user_version=12;")?;
        }
        // A reminder may come before its entry (minutes ahead), and an entry may carry an icon (see `valid_icon`).
        if version < 13 {
            let tx = conn.transaction()?;
            let has = |column: &str| -> rusqlite::Result<bool> { tx.prepare("SELECT 1 FROM pragma_table_info('entries') WHERE name=?1")?.exists([column]) };
            if !has("reminder_before")? { tx.execute_batch("ALTER TABLE entries ADD COLUMN reminder_before INTEGER NOT NULL DEFAULT 0 CHECK(reminder_before BETWEEN 0 AND 43200);")?; }
            if !has("icon")? { tx.execute_batch("ALTER TABLE entries ADD COLUMN icon TEXT CHECK(icon IS NULL OR length(icon) BETWEEN 1 AND 64);")?; }
            tx.execute_batch("PRAGMA user_version = 13;")?;
            tx.commit()?;
        }
        // A tag may carry an icon, shown in its place at the entries (see `valid_icon`).
        if version < 14 {
            let tx = conn.transaction()?;
            if !tx.prepare("SELECT 1 FROM pragma_table_info('tags') WHERE name='icon'")?.exists([])? { tx.execute_batch("ALTER TABLE tags ADD COLUMN icon TEXT CHECK(icon IS NULL OR length(icon) BETWEEN 1 AND 64);")?; }
            tx.execute_batch("PRAGMA user_version = 14;")?;
            tx.commit()?;
        }
        // Additive index only: schema version, persisted rows and older app compatibility stay unchanged.
        conn.execute_batch("CREATE INDEX IF NOT EXISTS entries_activity_time ON entries(tag,day_date,time,end_time) WHERE plan IS NULL AND time IS NOT NULL AND end_time IS NOT NULL AND cancelled=0;")?;
        crate::history::install(&conn)?;
        Ok(Self { conn })
    }
}
