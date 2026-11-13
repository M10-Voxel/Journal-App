//! Personal supervised relevance classifier. Only explicit user decisions train it.
//! Hashed features avoid retaining a second copy of message bodies.
use super::{err, Candidate, MailState, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const DIM: usize = 1024;
const KEY: &str = "personal-relevance-v1";
const BASE_KEY: &str = "personal-relevance-import-v1";
const FORMAT: &str = "journal-mail-relevance";
const MAX_EXPORT: u64 = 100_000;
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Model { weights: Vec<f64>, accepted: usize, rejected: usize }
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Package { format: String, version: u32, model: Model }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Status { accepted: usize, rejected: usize, ready: bool }
impl Model {
    fn ready(&self) -> bool { self.accepted >= 2 && self.rejected >= 2 && self.accepted + self.rejected >= 6 }
    pub fn score(&self, candidate: &Candidate) -> Option<f64> {
        if !self.ready() || self.weights.len() != DIM { return None; }
        Some(predict(&self.weights, &features(candidate)))
    }
}
pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS mail_feedback(id TEXT PRIMARY KEY, features TEXT NOT NULL, accepted INTEGER NOT NULL CHECK(accepted IN (0,1)), created INTEGER NOT NULL);").map_err(err)
}
fn features(candidate: &Candidate) -> Vec<usize> {
    let mut result = std::collections::BTreeSet::new();
    let context=candidate.evidence.split_once('\n').map(|(_,text)|text).unwrap_or(&candidate.evidence);
    // Dates and times are intentionally omitted so the classifier learns context.
    for (prefix, text) in [("sender",candidate.sender.as_str()),("subject",candidate.subject.as_str()),("context",context)] {
        for token in text.split(|c:char| !c.is_alphabetic()).filter(|t| t.chars().count()>=3).take(120) {
            let hash = format!("{prefix}:{}",token.to_lowercase()).bytes().fold(2166136261u32,|h,b| (h ^ b as u32).wrapping_mul(16777619));
            result.insert(hash as usize % DIM);
        }
    }
    result.into_iter().collect()
}
fn predict(weights: &[f64], features: &[usize]) -> f64 {
    let scale = (features.len().max(1) as f64).sqrt();
    let logit = features.iter().map(|i| weights[*i]).sum::<f64>() / scale;
    1.0 / (1.0 + (-logit.clamp(-30.0,30.0)).exp())
}
pub fn load(db: &Connection) -> Result<Model> {
    use rusqlite::OptionalExtension;
    let data: Option<String> = db.query_row("SELECT value FROM mail_settings WHERE key=?1",[KEY],|r|r.get(0)).optional().map_err(err)?;
    data.map(|s|serde_json::from_str(&s).map_err(err)).unwrap_or_else(||Ok(Model::default()))
}
fn train(db: &Connection) -> Result<()> {
    // Bound disk use and retraining cost. Rebuild from retained examples to avoid
    // repeated delivery or a restart training the same example multiple times.
    db.execute("DELETE FROM mail_feedback WHERE id NOT IN (SELECT id FROM mail_feedback ORDER BY created DESC,rowid DESC LIMIT 1000)",[]).map_err(err)?;
    let mut stmt=db.prepare("SELECT features,accepted FROM mail_feedback ORDER BY created,rowid").map_err(err)?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,bool>(1)?))).map_err(err)?;
    let mut examples=Vec::new();
    use rusqlite::OptionalExtension;
    let base:Option<String>=db.query_row("SELECT value FROM mail_settings WHERE key=?1",[BASE_KEY],|r|r.get(0)).optional().map_err(err)?;
    let mut model:Model=match base {Some(data)=>serde_json::from_str(&data).map_err(err)?,None=>Model {weights:vec![0.0;DIM],..Default::default()}};
    let mut positive=0usize;let mut negative=0usize;
    for row in rows {
        let (data,accepted)=row.map_err(err)?;
        let features:Vec<usize>=serde_json::from_str(&data).map_err(err)?;
        if features.iter().any(|i|*i>=DIM) {return Err("Ungültige Lerndaten".into());}
        if accepted {model.accepted+=1;positive+=1;} else {model.rejected+=1;negative+=1;}
        examples.push((features,accepted));
    }
    for _ in 0..35 {
        for (features,accepted) in &examples {
            let count=if *accepted {positive} else {negative};
            let balance=(examples.len() as f64 / (2*count.max(1)) as f64).min(4.0);
            let gradient=((*accepted as u8 as f64)-predict(&model.weights,features))*0.35*balance;
            let scale=(features.len().max(1) as f64).sqrt();
            for index in features {model.weights[*index]=model.weights[*index]*0.999+gradient/scale;}
        }
    }
    db.execute("INSERT INTO mail_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![KEY,serde_json::to_string(&model).map_err(err)?]).map_err(err)?;
    Ok(())
}
pub fn record(db: &Connection, candidate: &Candidate, accepted: bool) -> Result<()> {
    db.execute("INSERT OR IGNORE INTO mail_feedback(id,features,accepted,created) VALUES(?1,?2,?3,?4)",params![candidate.id,serde_json::to_string(&features(candidate)).map_err(err)?,accepted,super::now()]).map_err(err)?;
    Ok(())
}
pub fn resolve(db: &Connection, ids: &[String], accepted: bool, manual: bool) -> Result<()> {
    use rusqlite::OptionalExtension;
    let mut changed=false;
    for id in ids {
        let data:Option<String>=db.query_row("SELECT data FROM candidates WHERE id=?1 AND state='pending'",[id],|r|r.get(0)).optional().map_err(err)?;
        if let Some(data)=data {
            if manual {record(db,&serde_json::from_str(&data).map_err(err)?,accepted)?;changed=true;}
            db.execute("UPDATE candidates SET state=?2 WHERE id=?1",params![id,if accepted {"accepted"} else {"dismissed"}]).map_err(err)?;
        }
    }
    if changed {train(db)?;}
    Ok(())
}
#[tauri::command]
pub fn mail_learning_status(state:tauri::State<'_,MailState>) -> Result<Status> {
    let db=state.db.lock().map_err(err)?;let model=load(&db)?;
    Ok(Status {accepted:model.accepted,rejected:model.rejected,ready:model.ready()})
}
#[tauri::command]
pub fn mail_learning_reset(app:tauri::AppHandle) -> Result<()> {
    let state=app.state::<MailState>();let mut db=state.db.lock().map_err(err)?;
    let tx=db.transaction().map_err(err)?;
    tx.execute("DELETE FROM mail_feedback",[]).map_err(err)?;
    tx.execute("DELETE FROM mail_settings WHERE key=?1",[KEY]).map_err(err)?;
    tx.execute("DELETE FROM mail_settings WHERE key=?1",[BASE_KEY]).map_err(err)?;
    tx.commit().map_err(err)?;let _=app.emit("mail:changed",());Ok(())
}

fn export_model(db:&Connection) -> Result<String> {
    let model=load(db)?;
    if model.accepted+model.rejected==0 {return Err("Noch kein persönliches Training vorhanden.".into());}
    serde_json::to_string_pretty(&Package {format:FORMAT.into(),version:1,model}).map_err(err)
}
fn parse_package(data:&[u8]) -> Result<Package> {
    if data.len() as u64>MAX_EXPORT {return Err("Trainingsdatei ist zu groß.".into());}
    let package:Package=serde_json::from_slice(data).map_err(|_|"Ungültige Trainingsdatei.".to_string())?;
    let m=&package.model;
    if package.format!=FORMAT || package.version!=1 || m.weights.len()!=DIM || m.weights.iter().any(|w|!w.is_finite() || w.abs()>100.0) || m.accepted>1_000_000 || m.rejected>1_000_000 || m.accepted+m.rejected==0 {
        return Err("Inkompatible oder ungültige Trainingsdatei.".into());
    }
    Ok(package)
}
fn import_model(db:&mut Connection, package:Package, expected:&str) -> Result<()> {
    let tx=db.transaction().map_err(err)?;
    if serde_json::to_string(&load(&tx)?).map_err(err)?!=expected {return Err("Das Training wurde während der Dateiauswahl geändert. Bitte erneut importieren.".into());}
    let data=serde_json::to_string(&package.model).map_err(err)?;
    tx.execute("DELETE FROM mail_feedback",[]).map_err(err)?;
    for key in [KEY,BASE_KEY] {
        tx.execute("INSERT INTO mail_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,data]).map_err(err)?;
    }
    tx.commit().map_err(err)
}
#[tauri::command]
pub async fn mail_learning_export(app:tauri::AppHandle) -> Result<bool> {
    let data={let state=app.state::<MailState>();let db=state.db.lock().map_err(err)?;export_model(&db)?};
    let Some(file)=rfd::AsyncFileDialog::new().set_title(crate::ui_language::text("Persönliches Training exportieren","Export personal training")).set_file_name("Journal-Mail-Training.json").add_filter("Journal Mail Training",&["json"]).save_file().await else {return Ok(false)};
    std::fs::write(file.path(),data).map_err(err)?;Ok(true)
}
#[tauri::command]
pub async fn mail_learning_import(app:tauri::AppHandle) -> Result<bool> {
    let expected={let state=app.state::<MailState>();let db=state.db.lock().map_err(err)?;serde_json::to_string(&load(&db)?).map_err(err)?};
    let Some(file)=rfd::AsyncFileDialog::new().set_title(crate::ui_language::text("Persönliches Training importieren","Import personal training")).add_filter("Journal Mail Training",&["json"]).pick_file().await else {return Ok(false)};
    use std::io::Read;
    let mut data=Vec::new();std::fs::File::open(file.path()).map_err(err)?.take(MAX_EXPORT+1).read_to_end(&mut data).map_err(err)?;
    let package=parse_package(&data)?;
    {let state=app.state::<MailState>();let mut db=state.db.lock().map_err(err)?;import_model(&mut db,package,&expected)?;}
    let _=app.emit("mail:changed",());Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn candidate(id:&str, positive:bool) -> Candidate {
        serde_json::from_value(serde_json::json!({
            "id":id,"accountId":"account","messageKey":id,"sentAt":0,"date":"2026-11-13",
            "subject":if positive {"Besprechung Projektplanung"} else {"Sonderangebot Newsletter"},
            "sender":if positive {"team@arbeit.example"} else {"werbung@shop.example"},
            "evidence":if positive {"Modellvorschlag\nPersönliche Besprechung Projektplanung morgen"} else {"Modellvorschlag\nAngebot Rabatt Aktion Newsletter morgen"},
            "automatic":false,"entry":{"id":id,"kind":"event","text":"Termin","done":false,"cancelled":false}
        })).unwrap()
    }
    fn setup(db:&Connection) {
        db.execute_batch("CREATE TABLE mail_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE candidates(id TEXT PRIMARY KEY,data TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending');").unwrap();
        initialize(db).unwrap();
    }
    fn insert(db:&Connection,c:&Candidate) {
        db.execute("INSERT INTO candidates(id,data) VALUES(?1,?2)",params![c.id,serde_json::to_string(c).unwrap()]).unwrap();
    }
    #[test]
    fn decisions_train_similar_mail_and_survive_reopening() {
        let path=std::env::temp_dir().join(format!("mail-learning-{}.sqlite",uuid::Uuid::new_v4()));
        let db=Connection::open(&path).unwrap();setup(&db);
        assert!(load(&db).unwrap().score(&candidate("unseen",true)).is_none());
        for i in 0..6 {
            let positive=i%2==0;let c=candidate(&format!("sample-{i}"),positive);insert(&db,&c);
            resolve(&db,&[c.id.clone(),c.id.clone()],positive,true).unwrap();
            resolve(&db,&[c.id],positive,true).unwrap(); // duplicate IPC must not retrain
        }
        let model=load(&db).unwrap();assert_eq!((model.accepted,model.rejected),(3,3));
        assert!(model.score(&candidate("future-meeting",true)).unwrap()>0.65);
        assert!(model.score(&candidate("future-advert",false)).unwrap()<0.35);
        drop(db);
        let db=Connection::open(&path).unwrap();let restored=load(&db).unwrap();
        assert_eq!(restored.weights,model.weights);
        drop(db);std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn automatic_imports_and_one_sided_feedback_do_not_enable_personal_filter() {
        let db=Connection::open_in_memory().unwrap();setup(&db);
        let automatic=candidate("automatic",true);insert(&db,&automatic);
        resolve(&db,&[automatic.id],true,false).unwrap();
        assert_eq!(load(&db).unwrap().accepted,0);
        for i in 0..8 {let c=candidate(&format!("yes-{i}"),true);insert(&db,&c);resolve(&db,&[c.id],true,true).unwrap();}
        let model=load(&db).unwrap();assert_eq!(model.accepted,8);
        assert!(model.score(&candidate("next",true)).is_none());
    }
    #[test]
    fn shared_model_preserves_predictions_and_can_continue_learning() {
        let source=Connection::open_in_memory().unwrap();setup(&source);
        for i in 0..6 {let c=candidate(&format!("source-{i}"),i%2==0);insert(&source,&c);resolve(&source,&[c.id],i%2==0,true).unwrap();}
        let exported=export_model(&source).unwrap();
        assert!(!exported.contains("arbeit.example"));assert!(!exported.contains("Projektplanung"));assert!(!exported.contains("source-"));
        let mut target=Connection::open_in_memory().unwrap();setup(&target);
        let expected=serde_json::to_string(&load(&target).unwrap()).unwrap();
        import_model(&mut target,parse_package(exported.as_bytes()).unwrap(),&expected).unwrap();
        let original=load(&source).unwrap();let imported=load(&target).unwrap();
        assert!((original.score(&candidate("test",false)).unwrap()-imported.score(&candidate("test",false)).unwrap()).abs()<1e-12);
        let c=candidate("own-decision",true);insert(&target,&c);resolve(&target,&[c.id],true,true).unwrap();
        let continued=load(&target).unwrap();assert_eq!((continued.accepted,continued.rejected),(4,3));
        assert!(continued.score(&candidate("test",false)).unwrap()<0.35);
        assert!(export_model(&target).is_ok());
        // An outstanding chooser must not overwrite decisions made while it was open.
        assert!(import_model(&mut target,parse_package(exported.as_bytes()).unwrap(),&expected).is_err());
        assert_eq!(load(&target).unwrap().accepted,4);
    }
    #[test]
    fn invalid_shared_models_are_rejected_before_import() {
        let package=Package {format:FORMAT.into(),version:1,model:Model {weights:vec![0.0;DIM],accepted:3,rejected:3}};
        let valid=serde_json::to_value(package).unwrap();
        for invalid in [serde_json::json!({}),{let mut v=valid.clone();v["version"]=serde_json::json!(99);v},
            {let mut v=valid.clone();v["model"]["weights"]=serde_json::json!([0]);v},
            {let mut v=valid.clone();v["model"]["weights"][0]=serde_json::json!(1e100);v},
            {let mut v=valid.clone();v["model"]["accepted"]=serde_json::json!(1_000_001);v}] {
            assert!(parse_package(&serde_json::to_vec(&invalid).unwrap()).is_err());
        }
        assert!(parse_package(&vec![b' ';MAX_EXPORT as usize+1]).is_err());
    }
}
