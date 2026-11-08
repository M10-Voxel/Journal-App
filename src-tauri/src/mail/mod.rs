pub(crate) mod oauth;
pub(crate) mod secrets;
mod transport;
pub mod ml;

use std::{collections::HashSet, path::Path, sync::{Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use crate::storage::Entry;

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_MESSAGE: usize = 8 * 1024 * 1024;
fn default_folder() -> String { "INBOX".into() }
fn default_days() -> u32 { 14 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String, pub provider: String, pub label: String, pub email: String, pub protocol: String,
    #[serde(default)] pub host: String, #[serde(default)] pub port: u16, #[serde(default)] pub security: String,
    #[serde(default)] pub username: String, #[serde(default = "default_folder")] pub folder: String,
    pub enabled: bool, #[serde(default)] pub auto_import: bool,
    #[serde(default)] pub senders: String, #[serde(default)] pub subject_filter: String,
    #[serde(default = "default_days")] pub days: u32, #[serde(default)] pub client_id: String,
    #[serde(default)] pub tenant: String,
    #[serde(default)] pub last_sync: Option<i64>, #[serde(default)] pub error: Option<String>,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secret {
    #[serde(default)] pub password: String, #[serde(default)] pub client_secret: String,
    #[serde(default)] pub access_token: String, #[serde(default)] pub refresh_token: String,
    #[serde(default)] pub expires: i64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub key: String, pub subject: String, pub sender: String, pub sent_at: i64,
    pub text: String, pub html: String, pub calendars: Vec<String>,
    #[serde(default)] pub notice: String,
}
impl Message {
    fn skipped(key: String, notice: &str) -> Self { Self { key, subject:String::new(),sender:String::new(),sent_at:now(),text:String::new(),html:String::new(),calendars:vec![],notice:notice.into() } }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pending { pub account: Account, pub message: Message }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String, pub account_id: String, pub message_key: String,
    pub subject: String, pub sender: String, pub sent_at: i64,
    pub date: String, pub entry: Entry, pub evidence: String, pub automatic: bool,
}
pub struct MailState { db: Mutex<Connection>, operation: Mutex<()>, cancel: AtomicBool }
fn err(error: impl std::fmt::Display) -> String { format!("Mail-Speicher: {error}") }
fn now() -> i64 { chrono::Utc::now().timestamp() }

impl MailState {
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path).map_err(err)?;
        db.busy_timeout(Duration::from_secs(5)).map_err(err)?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, config TEXT NOT NULL, secret BLOB NOT NULL);
          CREATE TABLE IF NOT EXISTS messages(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            key TEXT NOT NULL, body TEXT, notice TEXT, created INTEGER NOT NULL, PRIMARY KEY(account_id,key));
          CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            data TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', created INTEGER NOT NULL);").map_err(err)?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS mail_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);").map_err(err)?;
        db.execute_batch("CREATE INDEX IF NOT EXISTS mail_candidate_source ON candidates(account_id,json_extract(data,'$.messageKey'));").map_err(err)?;
        Ok(Self { db: Mutex::new(db), operation: Mutex::new(()), cancel: AtomicBool::new(false) })
    }
    fn accounts(&self) -> Result<Vec<Account>> {
        let db = self.db.lock().map_err(err)?;
        let mut statement = db.prepare("SELECT config FROM accounts ORDER BY rowid").map_err(err)?;
        let rows = statement.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err)).collect()
    }
    fn secret(&self, id: &str) -> Result<Secret> {
        let db = self.db.lock().map_err(err)?;
        let blob: Option<Vec<u8>> = db.query_row("SELECT secret FROM accounts WHERE id=?1", [id], |r| r.get(0)).optional().map_err(err)?;
        match blob { Some(blob) => serde_json::from_slice(&secrets::protect(&blob, false)?).map_err(err), None => Ok(Secret::default()) }
    }
    fn persist(&self, account: &Account, secret: &Secret) -> Result<()> {
        let protected = secrets::protect(&serde_json::to_vec(secret).map_err(err)?, true)?;
        self.db.lock().map_err(err)?.execute("INSERT INTO accounts(id,config,secret) VALUES(?1,?2,?3)
          ON CONFLICT(id) DO UPDATE SET config=excluded.config,secret=excluded.secret", params![account.id, serde_json::to_string(account).map_err(err)?, protected]).map_err(err)?;
        Ok(())
    }
}

// The Drive snapshot contains account configuration only. Windows-bound secrets and
// per-device status never leave this machine.
fn sync_accounts(state: &MailState) -> Result<serde_json::Value> {
    let mut result = serde_json::Map::new();
    for mut account in state.accounts()? {
        account.last_sync = None; account.error = None;
        result.insert(account.id.clone(), serde_json::to_value(account).map_err(err)?);
    }
    Ok(serde_json::Value::Object(result))
}

#[tauri::command]
pub fn mail_drive_snapshot(state: tauri::State<'_, MailState>) -> Result<serde_json::Value> {
    sync_accounts(&state)
}

fn validate_drive_accounts(state: &MailState, expected: &serde_json::Value, accounts: &serde_json::Value) -> Result<Vec<Account>> {
    if &sync_accounts(state)? != expected { return Err("Mailkonten wurden während der Synchronisierung geändert. Erneut versuchen.".into()); }
    let records = accounts.as_object().ok_or("Ungültige Mailkonten")?;
    let mut parsed = Vec::new();
    for (id, value) in records {
        let mut account: Account = serde_json::from_value(value.clone()).map_err(err)?;
        if account.id != *id { return Err("Ungültige Mailkonto-ID".into()); }
        validate(&mut account)?;
        parsed.push(account);
    }
    Ok(parsed)
}

#[tauri::command]
pub fn mail_drive_validate(state: tauri::State<'_, MailState>, expected: serde_json::Value, accounts: serde_json::Value) -> Result<()> {
    let _guard = state.operation.try_lock().map_err(|_| "Bitte den laufenden Mailabruf abwarten")?;
    validate_drive_accounts(&state, &expected, &accounts).map(|_| ())
}

#[tauri::command]
pub fn mail_drive_apply(app: tauri::AppHandle, expected: serde_json::Value, accounts: serde_json::Value) -> Result<()> {
    let state = app.state::<MailState>();
    apply_drive_accounts(&state, expected, accounts)?;
    let _ = app.emit("mail:changed", ());
    Ok(())
}

fn apply_drive_accounts(state: &MailState, expected: serde_json::Value, accounts: serde_json::Value) -> Result<()> {
    let _guard = state.operation.try_lock().map_err(|_| "Bitte den laufenden Mailabruf abwarten")?;
    let parsed = validate_drive_accounts(state, &expected, &accounts)?;
    let records = accounts.as_object().ok_or("Ungültige Mailkonten")?;
    let empty_secret = secrets::protect(&serde_json::to_vec(&Secret::default()).map_err(err)?, true)?;
    let mut db = state.db.lock().map_err(err)?;
    let tx = db.transaction().map_err(err)?;
    let existing: Vec<(String, String)> = {
        let mut q = tx.prepare("SELECT id,config FROM accounts").map_err(err)?;
        let rows = q.query_map([], |r| Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        rows.collect::<std::result::Result<_,_>>().map_err(err)?
    };
    for (id, _) in &existing { if !records.contains_key(id) { tx.execute("DELETE FROM accounts WHERE id=?1", [id]).map_err(err)?; } }
    for mut account in parsed {
        if let Some((_,config)) = existing.iter().find(|(id,_)| *id == account.id) {
            let old: Account = serde_json::from_str(config).map_err(err)?;
            account.last_sync = old.last_sync; account.error = old.error;
            if old.email != account.email || old.protocol != account.protocol || old.host != account.host || old.port != account.port || old.security != account.security || old.username != account.username || old.client_id != account.client_id || old.tenant != account.tenant {
                account.last_sync = None; account.error = Some("Bitte dieses Konto auf diesem Gerät anmelden.".into());
                tx.execute("UPDATE accounts SET config=?2,secret=?3 WHERE id=?1", params![account.id,serde_json::to_string(&account).map_err(err)?,&empty_secret]).map_err(err)?;
            } else {
                tx.execute("UPDATE accounts SET config=?2 WHERE id=?1", params![account.id,serde_json::to_string(&account).map_err(err)?]).map_err(err)?;
            }
        } else {
            account.last_sync = None; account.error = Some("Bitte dieses Konto auf diesem Gerät anmelden.".into());
            tx.execute("INSERT INTO accounts(id,config,secret) VALUES(?1,?2,?3)", params![account.id,serde_json::to_string(&account).map_err(err)?,&empty_secret]).map_err(err)?;
        }
    }
    tx.commit().map_err(err)?;
    Ok(())
}
fn validate(account: &mut Account) -> Result<()> {
    if uuid::Uuid::parse_str(&account.id).is_err() { return Err("Ungültige Konto-ID".into()); }
    account.email = account.email.trim().to_string(); account.username = account.username.trim().to_string();
    account.host = account.host.trim().to_string(); account.label = account.label.trim().to_string();
    if !account.email.contains('@') || account.email.len() > 254 || account.email.chars().any(char::is_control) { return Err("Bitte eine gültige E-Mail-Adresse angeben".into()); }
    if account.label.is_empty() { account.label = account.email.clone(); }
    if account.label.len() > 120 || account.senders.len() > 2000 || account.subject_filter.len() > 500 { return Err("Kontoeinstellungen sind zu lang".into()); }
    if !matches!(account.protocol.as_str(), "imap" | "pop3" | "gmail" | "microsoft") { return Err("Nicht unterstützte Verbindung".into()); }
    if matches!(account.protocol.as_str(), "imap" | "pop3") {
        if account.host.is_empty() || account.host.len() > 253 || account.host.chars().any(|c| c.is_whitespace() || c.is_control() || "/\\@".contains(c)) || (account.host.contains(':') && account.host.parse::<std::net::IpAddr>().is_err()) || account.port == 0 { return Err("Bitte Mailserver und Port prüfen".into()); }
        if account.username.is_empty() { account.username = account.email.clone(); }
        if account.username.len() > 512 || account.username.chars().any(char::is_control) { return Err("Ungültiger Benutzername".into()); }
        if !matches!(account.security.as_str(), "tls" | "starttls" | "bridge") { return Err("TLS oder STARTTLS ist erforderlich".into()); }
        if account.security == "bridge" && !(account.provider == "proton" && matches!(account.host.as_str(), "127.0.0.1" | "localhost" | "::1") && account.protocol == "imap") { return Err("Die Bridge-Ausnahme gilt nur für Proton auf diesem Gerät".into()); }
        if account.folder.is_empty() || account.folder.len() > 300 || account.folder.chars().any(char::is_control) { return Err("Ungültiger Postfachordner".into()); }
    } else {
        account.client_id = account.client_id.trim().to_string();
        if account.client_id.is_empty() || account.client_id.len() > 512 || account.client_id.chars().any(char::is_control) { return Err("Für die Browseranmeldung fehlt die OAuth-Client-ID. Die Einrichtung ist unter „Anmeldung konfigurieren“ beschrieben.".into()); }
        if account.tenant.is_empty() { account.tenant = "common".into(); }
        if account.protocol == "microsoft" && !matches!(account.tenant.as_str(), "common" | "consumers" | "organizations") && uuid::Uuid::parse_str(&account.tenant).is_err() { return Err("Ungültige Microsoft-Verzeichnis-ID".into()); }
    }
    account.days = account.days.clamp(1, 90);
    Ok(())
}
fn matches_filter(account: &Account, message: &Message) -> bool {
    let sender = message.sender.to_lowercase();
    let addresses: Vec<_> = account.senders.split([',', ';', '\n']).map(str::trim).filter(|s| !s.is_empty()).collect();
    let sender_ok = addresses.is_empty() || addresses.iter().any(|value| {
        let value = value.to_lowercase();
        // Match actual parsed addresses, never a sender display name.
        mailparse::addrparse(&message.sender).map(|list| list.iter().any(|address| match address {
            mailparse::MailAddr::Single(single) => if value.starts_with('@') { single.addr.to_lowercase().ends_with(&value) } else { single.addr.eq_ignore_ascii_case(&value) },
            _ => false,
        })).unwrap_or(sender == value)
    });
    sender_ok && (account.subject_filter.trim().is_empty() || message.subject.to_lowercase().contains(&account.subject_filter.trim().to_lowercase()))
}
fn sync_one(app: &tauri::AppHandle, mut account: Account) -> Result<()> {
    validate(&mut account)?;
    let state = app.state::<MailState>();
    let result: Result<()> = (|| {
        let mut secret = state.secret(&account.id)?;
        if (matches!(account.protocol.as_str(), "gmail" | "microsoft") && secret.refresh_token.is_empty()) || (matches!(account.protocol.as_str(), "imap" | "pop3") && secret.password.is_empty()) { return Err("Bitte dieses Konto auf diesem Gerät anmelden.".into()); }
        if matches!(account.protocol.as_str(), "gmail" | "microsoft") { oauth::refresh(&account, &mut secret)?; state.persist(&account, &secret)?; }
        let known: HashSet<String> = {
            let db = state.db.lock().map_err(err)?;
            let mut query = db.prepare("SELECT key FROM messages WHERE account_id=?1").map_err(err)?;
            let rows = query.query_map([&account.id], |r| r.get::<_, String>(0)).map_err(err)?;
            rows.collect::<std::result::Result<_, _>>().map_err(err)?
        };
        let messages = transport::fetch(&account, &secret, &known)?;
        let mut db = state.db.lock().map_err(err)?;
        let tx = db.transaction().map_err(err)?;
        for message in messages {
            let body = if !message.notice.is_empty() || matches_filter(&account, &message) { Some(serde_json::to_string(&message).map_err(err)?) } else { None };
            tx.execute("INSERT OR IGNORE INTO messages(account_id,key,body,created) VALUES(?1,?2,?3,?4)", params![account.id,message.key,body,now()]).map_err(err)?;
        }
        account.last_sync = Some(now()); account.error = None;
        tx.execute("UPDATE accounts SET config=?2 WHERE id=?1", params![account.id,serde_json::to_string(&account).map_err(err)?]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(())
    })();
    if let Err(reason) = &result {
        account.error = Some(reason.clone());
        state.db.lock().map_err(err)?.execute("UPDATE accounts SET config=?2 WHERE id=?1", params![account.id,serde_json::to_string(&account).map_err(err)?]).map_err(err)?;
    }
    let _ = app.emit("mail:changed", ());
    result
}
pub fn start(app: tauri::AppHandle) {
    if let Err(error) = ml::resume(&app) { eprintln!("Mail recognition upgrade: {error}"); }
    // Release the inference process promptly, independently of the five-minute mail poll.
    let cleanup_app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        ml::release_idle(&cleanup_app);
    });
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        loop {
            let state = app.state::<MailState>();
            if let Ok(_guard) = state.operation.try_lock() {
                if let Ok(accounts) = state.accounts() { for account in accounts.into_iter().filter(|a| a.enabled) { let _ = sync_one(&app, account); } }
            }
            std::thread::sleep(Duration::from_secs(300));
        }
    });
}
#[tauri::command]
pub fn mail_accounts(state: tauri::State<'_, MailState>) -> Result<Vec<Account>> { state.accounts() }
#[tauri::command]
pub async fn mail_save(app: tauri::AppHandle, mut account: Account, password: Option<String>, client_secret: Option<String>, authorize: bool) -> Result<Account> {
    tauri::async_runtime::spawn_blocking(move || {
        validate(&mut account)?;
        let state = app.state::<MailState>();
        let _guard = state.operation.try_lock().map_err(|_| "Ein Mailabruf oder eine Anmeldung läuft bereits")?;
        let mut secret = state.secret(&account.id)?;
        if let Some(value) = password.filter(|s| !s.is_empty()) { secret.password = value; }
        if let Some(value) = client_secret.filter(|s| !s.is_empty()) { secret.client_secret = value; }
        if matches!(account.protocol.as_str(), "gmail" | "microsoft") {
            if authorize || secret.refresh_token.is_empty() {
                state.cancel.store(false, Ordering::SeqCst);
                oauth::authorize(&account, &mut secret, &state.cancel)?;
            } else { oauth::refresh(&account, &mut secret)?; }
        } else if secret.password.is_empty() { return Err("Bitte Passwort oder App-Passwort angeben".into()); }
        transport::test(&account, &secret)?;
        account.error = None;
        state.persist(&account, &secret)?;
        let _ = app.emit("mail:changed", ());
        Ok(account)
    }).await.map_err(err)?
}
#[tauri::command]
pub fn mail_cancel(state: tauri::State<'_, MailState>) { state.cancel.store(true, Ordering::SeqCst); }
#[tauri::command]
pub fn mail_enabled(app: tauri::AppHandle, id: String, enabled: bool) -> Result<()> {
    let state = app.state::<MailState>();
    let _guard = state.operation.try_lock().map_err(|_| "Bitte den laufenden Mailabruf abwarten")?;
    let mut account = state.accounts()?.into_iter().find(|a| a.id == id).ok_or("Konto nicht gefunden")?;
    account.enabled = enabled;
    state.db.lock().map_err(err)?.execute("UPDATE accounts SET config=?2 WHERE id=?1", params![id,serde_json::to_string(&account).map_err(err)?]).map_err(err)?;
    let _ = app.emit("mail:changed", ()); Ok(())
}
impl MailState {
    fn set_auto_import(&self, id: &str, enabled: bool) -> Result<()> {
        let _guard = self.operation.try_lock().map_err(|_| "Bitte den laufenden Mailabruf abwarten")?;
        // Update just this flag. Preserve credentials and concurrent account/polling state.
        let changed = self.db.lock().map_err(err)?.execute(
            "UPDATE accounts SET config=json_set(config,'$.autoImport',json(?2)) WHERE id=?1",
            params![id, if enabled { "true" } else { "false" }],
        ).map_err(err)?;
        if changed == 0 { return Err("Konto nicht gefunden".into()); }
        Ok(())
    }
}
#[tauri::command]
pub fn mail_auto_import(app: tauri::AppHandle, id: String, enabled: bool) -> Result<()> {
    app.state::<MailState>().set_auto_import(&id, enabled)?;
    let _ = app.emit("mail:changed", ());
    Ok(())
}
#[tauri::command]
pub fn mail_notices(state: tauri::State<'_, MailState>) -> Result<Vec<String>> {
    let db = state.db.lock().map_err(err)?;
    let mut query = db.prepare("SELECT notice FROM messages WHERE notice IS NOT NULL AND notice<>'' ORDER BY created DESC LIMIT 10").map_err(err)?;
    let rows = query.query_map([], |r| r.get(0)).map_err(err)?;
    rows.collect::<std::result::Result<_, _>>().map_err(err)
}
#[tauri::command]
pub fn mail_help(provider: String) -> Result<()> {
    let url = match provider.as_str() {
        "gmail" => "https://developers.google.com/identity/protocols/oauth2/native-app",
        "microsoft" => "https://learn.microsoft.com/en-us/graph/auth-register-app-v2",
        "icloud" => "https://support.apple.com/de-de/102525",
        "gmx" => "https://hilfe.gmx.net/pop-imap/imap/serverdaten.html",
        "webde" => "https://hilfe.web.de/pop-imap/imap/imap-serverdaten.html",
        "proton" => "https://proton.me/support/protonmail-bridge-clients",
        _ => return Err("Keine Anbieterhilfe hinterlegt".into()),
    };
    oauth::open_browser(url)
}
#[tauri::command]
pub async fn mail_sync(app: tauri::AppHandle, id: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MailState>();
        let _guard = state.operation.try_lock().map_err(|_| "Ein Mailabruf oder eine Anmeldung läuft bereits")?;
        let account = state.accounts()?.into_iter().find(|a| a.id == id).ok_or("Konto nicht gefunden")?;
        sync_one(&app, account)
    }).await.map_err(err)?
}
#[tauri::command]
pub fn mail_remove(app: tauri::AppHandle, id: String) -> Result<()> {
    let state = app.state::<MailState>();
    let _guard = state.operation.try_lock().map_err(|_| "Bitte den laufenden Mailabruf abwarten")?;
    state.db.lock().map_err(err)?.execute("DELETE FROM accounts WHERE id=?1", [id]).map_err(err)?;
    let _ = app.emit("mail:changed", ()); Ok(())
}
#[tauri::command]
pub fn mail_pending(state: tauri::State<'_, MailState>) -> Result<Vec<Pending>> {
    let accounts = state.accounts()?;
    let db = state.db.lock().map_err(err)?;
    let mut query = db.prepare("SELECT account_id,body FROM messages WHERE body IS NOT NULL ORDER BY CASE WHEN json_array_length(body,'$.calendars')>0 OR instr(body,'application/ld+json')>0 THEN 0 ELSE 1 END,created LIMIT 50").map_err(err)?;
    let rows = query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(err)?;
    let mut pending = Vec::new();
    for row in rows { let (id, body) = row.map_err(err)?; if let Some(account) = accounts.iter().find(|a| a.id == id) { pending.push(Pending { account: account.clone(), message: serde_json::from_str(&body).map_err(err)? }); } }
    Ok(pending)
}
#[tauri::command]
pub fn mail_stage(app: tauri::AppHandle, account_id: String, message_key: String, candidates: Vec<Candidate>, notice: String) -> Result<()> {
    if candidates.len() > 500 || notice.len() > 2000 { return Err("Zu viele Terminvorschläge".into()); }
    let state = app.state::<MailState>();
    let mut db = state.db.lock().map_err(err)?;
    let tx = db.transaction().map_err(err)?;
    let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND key=?2 AND body IS NOT NULL)", params![account_id,message_key], |r| r.get(0)).map_err(err)?;
    if !exists { return Ok(()); } // A repeated IPC delivery must not resurrect dismissed suggestions.
    for candidate in candidates {
        if candidate.account_id != account_id || candidate.message_key != message_key || uuid::Uuid::parse_str(&candidate.id).is_err() || candidate.entry.text.len() > 8000 || candidate.evidence.len() > 16000 { return Err("Ungültiger Mailvorschlag".into()); }
        tx.execute("INSERT OR IGNORE INTO candidates(id,account_id,data,created) VALUES(?1,?2,?3,?4)", params![candidate.id,account_id,serde_json::to_string(&candidate).map_err(err)?,now()]).map_err(err)?;
    }
    // Full mail bodies are discarded after extraction; only proposal evidence and message identity remain.
    tx.execute("UPDATE messages SET body=NULL,notice=?3 WHERE account_id=?1 AND key=?2", params![account_id,message_key,notice]).map_err(err)?;
    tx.commit().map_err(err)?;
    let _ = app.emit("mail:changed", ()); Ok(())
}
#[tauri::command]
pub fn mail_candidates(state: tauri::State<'_, MailState>) -> Result<Vec<Candidate>> {
    let db = state.db.lock().map_err(err)?;
    let mut query = db.prepare("SELECT data FROM candidates WHERE state='pending' ORDER BY created DESC LIMIT 500").map_err(err)?;
    let rows = query.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err)).collect()
}
#[tauri::command]
pub fn mail_resolve(app: tauri::AppHandle, ids: Vec<String>, accepted: bool) -> Result<()> {
    if ids.len() > 500 { return Err("Zu viele Vorschläge".into()); }
    let state = app.state::<MailState>();
    let mut db = state.db.lock().map_err(err)?;
    let tx = db.transaction().map_err(err)?;
    for id in ids { tx.execute("UPDATE candidates SET state=?2 WHERE id=?1 AND state='pending'", params![id,if accepted { "accepted" } else { "dismissed" }]).map_err(err)?; }
    tx.commit().map_err(err)?; let _ = app.emit("mail:changed", ()); Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn account() -> Account { serde_json::from_value(serde_json::json!({"id":uuid::Uuid::new_v4().to_string(),"provider":"custom","label":"Test","email":"test@example.org","protocol":"imap","host":"imap.example.org","port":993,"security":"tls","username":"","enabled":true})).unwrap() }
    #[test]
    fn auto_import_defaults_off_and_updates_only_the_chosen_account_without_touching_secrets() {
        let state = MailState::open(Path::new(":memory:")).unwrap();
        let first = account(); let second = account();
        assert!(!first.auto_import);
        for a in [&first, &second] {
            state.db.lock().unwrap().execute("INSERT INTO accounts VALUES(?1,?2,?3)", params![a.id,serde_json::to_string(a).unwrap(),b"untouched-secret".to_vec()]).unwrap();
        }
        state.set_auto_import(&first.id, true).unwrap();
        let accounts = state.accounts().unwrap();
        assert!(accounts.iter().find(|a|a.id == first.id).unwrap().auto_import);
        assert!(!accounts.iter().find(|a|a.id == second.id).unwrap().auto_import);
        assert_eq!(sync_accounts(&state).unwrap()[&first.id]["autoImport"], true);
        let secret: Vec<u8> = state.db.lock().unwrap().query_row("SELECT secret FROM accounts WHERE id=?1", [&first.id], |r|r.get(0)).unwrap();
        assert_eq!(secret,b"untouched-secret");
        state.set_auto_import(&first.id, false).unwrap();
        assert!(!state.accounts().unwrap().iter().find(|a|a.id == first.id).unwrap().auto_import);
        assert!(state.set_auto_import("missing",true).is_err());
    }
    #[cfg(windows)]
    #[test] fn drive_accounts_preserve_local_secrets_and_require_new_login() {
        let path=std::env::temp_dir().join(format!("journal-mail-sync-{}.sqlite",uuid::Uuid::new_v4()));
        let state=MailState::open(&path).unwrap();
        let mut a=account(); validate(&mut a).unwrap();
        state.persist(&a,&Secret { password:"local-password".into(), ..Default::default() }).unwrap();
        let before=sync_accounts(&state).unwrap();
        assert!(!before.to_string().contains("local-password"));
        let mut b=account(); validate(&mut b).unwrap();
        let mut next=before.clone(); next[&b.id]=serde_json::to_value(&b).unwrap();
        apply_drive_accounts(&state,before.clone(),next.clone()).unwrap();
        assert_eq!(state.secret(&a.id).unwrap().password,"local-password");
        assert!(state.secret(&b.id).unwrap().password.is_empty());
        assert!(state.accounts().unwrap().iter().find(|x| x.id==b.id).unwrap().error.is_some());
        assert!(apply_drive_accounts(&state,before,next.clone()).is_err());
        next[&a.id]["host"]=serde_json::json!("new.example.org");
        let expected=sync_accounts(&state).unwrap();
        apply_drive_accounts(&state,expected,next).unwrap();
        assert!(state.secret(&a.id).unwrap().password.is_empty());
        drop(state); let _=std::fs::remove_file(path);
    }
    #[test] fn rejects_remote_insecure_bridge_and_protocol_injection() {
        let mut a = account(); assert!(validate(&mut a).is_ok());
        a.security = "bridge".into(); assert!(validate(&mut a).is_err());
        a.provider = "proton".into(); a.host = "127.0.0.1".into(); assert!(validate(&mut a).is_ok());
        a.username = "name\r\nLOGOUT".into(); assert!(validate(&mut a).is_err());
    }
    #[test] fn filters_real_addresses_instead_of_display_names() {
        let mut a = account(); a.senders = "@carrier.example".into();
        let mut m = Message { key:"1".into(),subject:"Zustellung".into(),sender:"DHL <notify@carrier.example>".into(),sent_at:0,text:String::new(),html:String::new(),calendars:vec![],notice:String::new() };
        assert!(matches_filter(&a, &m)); m.sender = "notify@carrier.example <attacker@other.example>".into(); assert!(!matches_filter(&a, &m));
    }
}
