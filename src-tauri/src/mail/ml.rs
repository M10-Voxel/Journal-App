//! Local, task-specific inference in a separate process. No model or runtime is loaded by the journal process.
use super::{err, MailState, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf}, process::{Child, ChildStdin, Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, mpsc, Mutex}, time::{Duration, Instant}};
use tauri::{Emitter, Manager};

const MANIFEST: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tools/mail-ml-probe/assets-manifest.json"));
#[derive(Deserialize)] struct File { name: String, size: u64, sha256: String }
#[derive(Deserialize)] struct Runtime { url: String, size: u64, sha256: String, files: Vec<File> }
#[derive(Deserialize)] struct Manifest { repository: String, revision: String, files: Vec<File>, runtime: Runtime }
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status { installed: bool, enabled: bool, installing: bool, downloaded: u64, total: u64, error: String }
pub struct MlState { worker: Mutex<Option<Worker>>, progress: Mutex<Status>, installing: AtomicBool }
impl Default for MlState { fn default() -> Self { Self { worker:Mutex::new(None),progress:Mutex::new(Status::default()),installing:AtomicBool::new(false) } } }
#[derive(Clone, Serialize, Deserialize)]
pub struct Mention { text: String, field: String, score: f32, start: usize, end: usize }
#[derive(Clone, Serialize, Deserialize)]
pub struct Classification { label: String, score: f32 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis { text: String, mentions: Vec<Mention>, classifications: Vec<Classification>, milliseconds: u128 }
fn manifest() -> Manifest { serde_json::from_str(MANIFEST).expect("compiled model manifest") }
fn root(app: &tauri::AppHandle) -> Result<PathBuf> { app.path().app_local_data_dir().map(|dir| dir.join("mail-ml")).map_err(err) }
fn fingerprint() -> String { format!("{:x}", Sha256::digest(MANIFEST.as_bytes())) }
fn complete(root: &Path) -> bool {
    let manifest = manifest();
    fs::read_to_string(root.join("ready")).ok().as_deref() == Some(fingerprint().as_str())
        && manifest.files.iter().all(|file| fs::metadata(root.join(&file.name)).is_ok_and(|metadata| metadata.len() == file.size))
        && manifest.runtime.files.iter().all(|file| fs::metadata(root.join("runtime").join(&file.name)).is_ok_and(|metadata| metadata.len() == file.size))
}
fn enabled(app: &tauri::AppHandle) -> bool {
    let state = app.state::<MailState>();
    state.db.lock().ok().is_some_and(|db| db.query_row("SELECT value FROM mail_settings WHERE key='ml_enabled'", [], |row| row.get::<_, String>(0)).is_ok_and(|value| value == "1"))
}
fn emit(app: &tauri::AppHandle) { let _ = app.emit("mail:ml", ()); }
#[tauri::command]
pub fn mail_ml_status(app: tauri::AppHandle) -> Result<Status> {
    let state = app.state::<MlState>();
    let mut status = state.progress.lock().map_err(err)?.clone();
    status.installed = complete(&root(&app)?); status.enabled = enabled(&app);
    status.installing = state.installing.load(Ordering::SeqCst);
    Ok(status)
}
fn configure(app: &tauri::AppHandle, value: bool) -> Result<()> {
    if value && !complete(&root(app)?) { return Err("Bitte das lokale Mailmodell zuerst einrichten".into()); }
    {
        let state=app.state::<MailState>(); let mut db=state.db.lock().map_err(err)?;
        let tx=db.transaction().map_err(err)?;
        tx.execute("INSERT INTO mail_settings(key,value) VALUES('ml_enabled',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [if value { "1" } else { "0" }]).map_err(err)?;
        if value { update_recognition_revision(&tx)?; }
        tx.commit().map_err(err)?;
    }
    if !value { app.state::<MlState>().worker.lock().map_err(err)?.take(); }
    emit(app); let _ = app.emit("mail:changed", ()); Ok(())
}
fn requeue_unrecognized(db: &rusqlite::Connection) -> Result<()> {
    // Previously accepted or dismissed suggestions stay resolved. Only old non-results are fetched again.
    db.execute("DELETE FROM messages WHERE body IS NULL AND NOT EXISTS (SELECT 1 FROM candidates WHERE candidates.account_id=messages.account_id AND json_extract(candidates.data,'$.messageKey')=messages.key)",[]).map_err(err)?;
    Ok(())
}
fn update_recognition_revision(db: &rusqlite::Connection) -> Result<bool> {
    let revision = format!("sentences-v2-{}-{:x}", fingerprint(), Sha256::digest(include_bytes!("../../../src/mailContextModel.json")));
    if db.query_row("SELECT value FROM mail_settings WHERE key='ml_revision'",[],|row|row.get::<_,String>(0)).ok().as_deref()==Some(revision.as_str()) { return Ok(false); }
    requeue_unrecognized(db)?;
    db.execute("INSERT INTO mail_settings(key,value) VALUES('ml_revision',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[revision]).map_err(err)?;
    Ok(true)
}
pub fn resume(app: &tauri::AppHandle) -> Result<()> {
    // A recognition upgrade needs no model download. Retry old non-results once, not accepted entries.
    if enabled(app) && complete(&root(app)?) { configure(app,true)?; }
    Ok(())
}
#[tauri::command]
pub async fn mail_ml_enabled(app: tauri::AppHandle, value: bool) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || configure(&app, value)).await.map_err(err)?
}
fn valid(path: &Path, file: &File) -> Result<bool> {
    if !fs::metadata(path).is_ok_and(|metadata| metadata.len() == file.size) { return Ok(false); }
    let mut source = fs::File::open(path).map_err(err)?;
    let mut digest = Sha256::new(); let mut buffer = [0; 1024 * 128];
    loop { let count = source.read(&mut buffer).map_err(err)?; if count == 0 { break; } digest.update(&buffer[..count]); }
    Ok(format!("{:x}",digest.finalize()) == file.sha256)
}
fn obtain(app: &tauri::AppHandle, destination: &Path, file: &File, url: &str, local: Option<&Path>) -> Result<()> {
    if valid(destination, file)? { advance(app, file.size); return Ok(()); }
    fs::create_dir_all(destination.parent().ok_or("Ungültiger Modellpfad")?).map_err(err)?;
    let temporary = destination.with_extension("download");
    if let Some(local) = local {
        if !valid(local, file)? { return Err(format!("Modelldatei fehlt oder hat eine falsche Prüfsumme: {}", file.name)); }
        fs::copy(local, &temporary).map_err(err)?; advance(app, file.size);
    } else {
        // Redirects are needed for the pinned Hugging Face content-delivery URL, never for mail text.
        let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(1800)).redirect(reqwest::redirect::Policy::limited(8)).build().map_err(err)?;
        let mut response = client.get(url).send().map_err(|_| "Modelldownload fehlgeschlagen. Internetverbindung prüfen.")?;
        if !response.status().is_success() { return Err(format!("Modellserver meldet HTTP {}", response.status().as_u16())); }
        let mut output = fs::File::create(&temporary).map_err(err)?;
        let mut total = 0; let mut buffer = [0; 1024 * 128]; let mut reported = Instant::now();
        loop {
            let count = response.read(&mut buffer).map_err(|_| "Modelldownload wurde unterbrochen")?; if count == 0 { break; }
            total += count as u64; if total > file.size { return Err("Modelldownload ist größer als erwartet".into()); }
            output.write_all(&buffer[..count]).map_err(err)?;
            { app.state::<MlState>().progress.lock().map_err(err)?.downloaded += count as u64; }
            if reported.elapsed() > Duration::from_millis(350) { emit(app); reported = Instant::now(); }
        }
        output.sync_all().map_err(err)?;
    }
    if !valid(&temporary, file)? { return Err(format!("Prüfsumme stimmt nicht: {}", file.name)); }
    if destination.exists() { fs::remove_file(destination).map_err(err)?; }
    fs::rename(temporary, destination).map_err(err)?; emit(app); Ok(())
}
fn advance(app: &tauri::AppHandle, bytes: u64) { if let Ok(mut progress) = app.state::<MlState>().progress.lock() { progress.downloaded += bytes; } emit(app); }
fn install(app: &tauri::AppHandle, local: Option<&Path>) -> Result<()> {
    let destination = root(app)?; let manifest = manifest();
    fs::create_dir_all(&destination).map_err(err)?;
    app.state::<MlState>().worker.lock().map_err(err)?.take();
    if destination.join("ready").exists() { fs::remove_file(destination.join("ready")).map_err(err)?; }
    { let state = app.state::<MlState>(); let mut progress = state.progress.lock().map_err(err)?; *progress = Status { installing:true,total:manifest.files.iter().map(|file| file.size).sum::<u64>() + manifest.runtime.size,..Status::default() }; }
    emit(app);
    for file in &manifest.files {
        let url = format!("https://huggingface.co/{}/resolve/{}/{}", manifest.repository, manifest.revision, file.name);
        obtain(app, &destination.join(&file.name), file, &url, local.map(|root| root.join(&file.name)).as_deref())?;
    }
    let package = File { name:"microsoft.ml.onnxruntime.1.23.2.nupkg".into(),size:manifest.runtime.size,sha256:manifest.runtime.sha256.clone() };
    obtain(app, &destination.join(&package.name), &package, &manifest.runtime.url, local.map(|root| root.join(&package.name)).as_deref())?;
    let mut archive = zip::ZipArchive::new(fs::File::open(destination.join(&package.name)).map_err(err)?).map_err(err)?;
    fs::create_dir_all(destination.join("runtime")).map_err(err)?;
    for file in &manifest.runtime.files {
        let path = destination.join("runtime").join(&file.name);
        if valid(&path, file)? { continue; }
        let mut archived = archive.by_name(&format!("runtimes/win-x64/native/{}",file.name)).map_err(err)?;
        if archived.size() != file.size { return Err("Unerwartete Größe der Modelllaufzeit".into()); }
        let mut output = fs::File::create(&path).map_err(err)?;
        std::io::copy(&mut archived, &mut output).map_err(err)?; drop(output);
        if !valid(&path, file)? { return Err("Prüfsumme der Modelllaufzeit stimmt nicht".into()); }
    }
    for (name, content) in [
        ("MODEL-LICENSE.txt", include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tools/mail-ml-probe/licenses/Apache-2.0.txt"))),
        ("ONNX-Runtime-LICENSE.txt", include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tools/mail-ml-probe/licenses/ONNX-Runtime-LICENSE"))),
        ("ONNX-Runtime-ThirdPartyNotices.txt", include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../tools/mail-ml-probe/licenses/ONNX-Runtime-ThirdPartyNotices.txt"))),
        ("MODEL-NOTICE.txt", "GLiNER2.5 multilingual by Fastino. ONNX export by Jugaad.\nModel: https://huggingface.co/fastino/gliner2.5-multi-v1\nExport: https://huggingface.co/jugaadsrl/gliner2.5-multi-v1-onnx\nPinned revision: 3de2c11f55853b7919f985a59bfc8df27b5ec991\nUsed locally for Journal mail date/event extraction.\n"),
    ] { fs::write(destination.join(name), content).map_err(err)?; }
    fs::write(destination.join("ready"), fingerprint()).map_err(err)?;
    configure(app, true)?;
    Ok(())
}
#[tauri::command]
pub async fn mail_ml_install(app: tauri::AppHandle, from_folder: bool) -> Result<()> {
    let state = app.state::<MlState>();
    if state.installing.swap(true, Ordering::SeqCst) { return Err("Die Modelleinrichtung läuft bereits".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let local = if from_folder { rfd::FileDialog::new().set_title(crate::ui_language::text("Verifizierten Mailmodell-Ordner auswählen", "Select verified mail model folder")).pick_folder() } else { None };
        let result = if from_folder && local.is_none() { Ok(()) } else { install(&app, local.as_deref()) };
        let state = app.state::<MlState>(); state.installing.store(false,Ordering::SeqCst);
        if let Ok(mut progress) = state.progress.lock() { progress.installing=false; progress.error=result.as_ref().err().cloned().unwrap_or_default(); }
        emit(&app); let _ = app.emit("mail:changed", ()); result
    }).await.map_err(err)?
}
struct Worker { child: Child, input: ChildStdin, output: mpsc::Receiver<Result<serde_json::Value>>, used: Instant }
impl Drop for Worker { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
impl Worker {
    fn spawn(root: &Path) -> Result<Self> {
        let mut command = Command::new(std::env::current_exe().map_err(err)?);
        command.arg("--mail-ml-worker").arg(root).env("GLINER2_DEVICE","cpu").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let mut child = command.spawn().map_err(|_| "Lokale Mailauswertung konnte nicht gestartet werden")?;
        let input = child.stdin.take().ok_or("ML-Eingabe fehlt")?; let output = child.stdout.take().ok_or("ML-Ausgabe fehlt")?;
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = Vec::new();
                match reader.by_ref().take(1_000_001).read_until(b'\n', &mut line) {
                    Ok(0) => { let _=sender.send(Err("Lokales Mailmodell wurde beendet".into())); break; }
                    Ok(_) if line.len() <= 1_000_000 && line.ends_with(b"\n") => { if sender.send(serde_json::from_slice(&line).map_err(|_| "Ungültige Modellantwort".into())).is_err() { break; } }
                    _ => { let _=sender.send(Err("Ungültige oder zu große Modellantwort".into())); break; }
                }
            }
        });
        let worker = Self { child,input,output:receiver,used:Instant::now() };
        let ready = worker.output.recv_timeout(Duration::from_secs(120)).map_err(|_| "Lokales Modell konnte nicht rechtzeitig geladen werden")??;
        if ready["ready"] != true { return Err("Lokales Mailmodell konnte nicht geladen werden".into()); } Ok(worker)
    }
    fn analyze(&mut self, text: String) -> Result<Analysis> {
        serde_json::to_writer(&mut self.input, &serde_json::json!({"text":text})).map_err(err)?;
        self.input.write_all(b"\n").map_err(err)?; self.input.flush().map_err(err)?;
        let response = self.output.recv_timeout(Duration::from_secs(120)).map_err(|_| "Mailauswertung hat zu lange gedauert")??;
        self.used=Instant::now(); serde_json::from_value(response).map_err(|_| "Mailmodell konnte diesen Inhalt nicht auswerten".into())
    }
}
#[tauri::command]
pub async fn mail_ml_analyze(app: tauri::AppHandle, text: String) -> Result<Analysis> {
    if text.len() > 100_000 { return Err("Mailabschnitt ist für die lokale Auswertung zu groß".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&app)?;
        if !complete(&root) || !enabled(&app) { return Err("Für die kontextbezogene Mailauswertung bitte unter Einstellungen → E-Mail-Konten das lokale Modell einrichten und aktivieren. Die Nachricht bleibt bis dahin zur Auswertung gespeichert.".into()); }
        let state = app.state::<MlState>(); let mut worker = state.worker.lock().map_err(err)?;
        if worker.is_none() { *worker=Some(Worker::spawn(&root)?); }
        let result=worker.as_mut().ok_or("Mailmodell nicht verfügbar")?.analyze(text);
        if result.is_err() { worker.take(); } result
    }).await.map_err(err)?
}
pub fn release_idle(app: &tauri::AppHandle) {
    if let Ok(mut worker) = app.state::<MlState>().worker.try_lock() { if worker.as_ref().is_some_and(|worker| worker.used.elapsed() > Duration::from_secs(60)) { worker.take(); } }
}

/// Called before Tauri initialisation. This process has no journal database, windows, account tokens or network client.
pub fn worker(root: &Path) -> Result<()> {
    use gliner25_rs::{BoundaryConfig, BoundaryEngine, ExecutionMode, SchemaTask};
    let runtime = root.join("runtime/onnxruntime.dll");
    let specification = manifest();
    for file in &specification.runtime.files { if !valid(&root.join("runtime").join(&file.name),file)? { return Err("Modelllaufzeit hat eine falsche Prüfsumme".into()); } }
    ort::init_from(runtime).map_err(err)?.with_name("journal-mail-only").with_telemetry(false).commit();
    let mut engine=BoundaryEngine::new(BoundaryConfig::new(root.join("fp32_25")).with_execution(ExecutionMode::Standard)).map_err(err)?;
    let tasks=[SchemaTask::Entities(vec!["event".into(),"date".into(),"time".into(),"location".into()]),
        SchemaTask::classification("event_status",vec!["a future appointment, invitation or announced delivery".into(),"a cancelled appointment or delivery".into(),"a past event or retrospective statement".into(),"a hypothetical event or unrelated information".into()])];
    println!("{}",serde_json::json!({"ready":true})); let _=std::io::stdout().flush();
    let mut reader=BufReader::new(std::io::stdin().lock());
    loop {
        let mut line=Vec::new();
        let count=reader.by_ref().take(150_001).read_until(b'\n',&mut line).map_err(err)?;
        if count==0 { break; } if count>150_000 || !line.ends_with(b"\n") { return Err("Modellanfrage ist zu groß".into()); }
        let request:serde_json::Value=serde_json::from_slice(&line).map_err(err)?;
        let text=request["text"].as_str().ok_or("Mailtext fehlt")?; if text.len()>100_000 { return Err("Mailtext ist zu groß".into()); }
        let start=Instant::now();
        let output=engine.extract_long(text,&tasks).map_err(err)?;
        let mentions=output.mentions.iter().filter(|mention| mention.char_start<=mention.char_end && text.is_char_boundary(mention.char_start) && text.is_char_boundary(mention.char_end)).map(|mention| Mention { text:mention.text.clone(),field:mention.field.clone(),score:mention.score,start:text[..mention.char_start].encode_utf16().count(),end:text[..mention.char_end].encode_utf16().count() }).collect();
        let analysis=Analysis { text:text.into(),mentions,classifications:output.classifications.into_iter().map(|classification| Classification { label:classification.label,score:classification.score }).collect(),milliseconds:start.elapsed().as_millis() };
        println!("{}",serde_json::to_string(&analysis).map_err(err)?); let _=std::io::stdout().flush();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test] fn sentence_recognition_upgrade_is_idempotent() {
        let state=super::super::MailState::open(std::path::Path::new(":memory:")).unwrap();
        let db=state.db.lock().unwrap();
        db.execute("INSERT INTO accounts(id,config,secret) VALUES('account','{}',X'00')",[]).unwrap();
        db.execute("INSERT INTO messages(account_id,key,body,created) VALUES('account','retry',NULL,0)",[]).unwrap();
        assert!(super::update_recognition_revision(&db).unwrap());
        db.execute("INSERT INTO messages(account_id,key,body,created) VALUES('account','new-non-result',NULL,0)",[]).unwrap();
        assert!(!super::update_recognition_revision(&db).unwrap());
        assert_eq!(db.query_row("SELECT count(*) FROM messages",[],|r|r.get::<_,i64>(0)).unwrap(),1);
    }
    #[test] fn model_upgrade_rechecks_non_results_without_reviving_ignored_or_accepted_suggestions() {
        let state=super::super::MailState::open(std::path::Path::new(":memory:")).unwrap();
        let db=state.db.lock().unwrap();
        db.execute("INSERT INTO accounts(id,config,secret) VALUES('account','{}',X'00')",[]).unwrap();
        for key in ["missed","ignored","accepted","queued"] { db.execute("INSERT INTO messages(account_id,key,body,created) VALUES('account',?1,?2,0)",rusqlite::params![key,if key=="queued"{Some("pending body")}else{None}]).unwrap(); }
        for key in ["ignored","accepted"] { db.execute("INSERT INTO candidates(id,account_id,data,state,created) VALUES(?1,'account',?2,?1,0)",rusqlite::params![key,serde_json::json!({"messageKey":key}).to_string()]).unwrap(); }
        super::requeue_unrecognized(&db).unwrap();
        let mut query=db.prepare("SELECT key FROM messages ORDER BY key").unwrap();
        let keys:Vec<String>=query.query_map([],|row|row.get(0)).unwrap().collect::<std::result::Result<_,_>>().unwrap();
        assert_eq!(keys,["accepted","ignored","queued"]);
    }
    #[test] fn model_manifest_is_pinned_and_paths_stay_local() {
        let manifest=super::manifest(); assert_eq!(manifest.revision.len(),40);
        for file in &manifest.files { assert!(file.name.starts_with("fp32_25/")); assert!(!file.name.contains("..")); assert_eq!(file.sha256.len(),64); }
        for file in &manifest.runtime.files { assert!(!file.name.contains(['/', '\\'])); assert_eq!(file.sha256.len(),64); }
        assert!(manifest.files.iter().map(|file|file.size).sum::<u64>()<1_300_000_000);
    }
}
