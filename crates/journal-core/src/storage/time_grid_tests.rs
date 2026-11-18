use super::*;
use serde_json::json;

fn range() -> Entry {
    serde_json::from_value(json!({"id":Uuid::new_v4().to_string(),"kind":"event","text":"Projekt",
        "done":false,"cancelled":false,"time":"14:00","end":"64:00","timeGrid":true})).unwrap()
}

#[test]
fn grid_origin_round_trips_through_save_history_export_and_sync() {
    let mut db = Store::from_connection(Connection::open_in_memory().unwrap()).unwrap();
    let mut day = db.load("2026-11-18").unwrap();
    day.entries.push(range());
    let mut saved = db.save(day).unwrap();
    assert!(saved.entries[0].time_grid);
    assert!(db.load_range("2026-11-18", "2026-11-20").unwrap()[0].entries[0].time_grid);
    assert!(db.export_calendar().unwrap()[0].entries[0].time_grid);
    let snapshot = db.sync_snapshot().unwrap();
    let mut other = Store::from_connection(Connection::open_in_memory().unwrap()).unwrap();
    other.sync_apply(other.sync_snapshot().unwrap(), snapshot.clone()).unwrap();
    assert!(other.load("2026-11-18").unwrap().entries[0].time_grid);
    let id = saved.entries[0].id.clone();
    other.move_calendar_entry(&id,"2026-11-18","2026-11-21",Some("15:00".into()),Some("65:00".into())).unwrap();
    assert!(other.load("2026-11-21").unwrap().entries[0].time_grid);
    other.move_calendar_entry(&id,"2026-11-21","2026-11-22",None,None).unwrap();
    assert!(!other.load("2026-11-22").unwrap().entries[0].time_grid,"Moving to the whole-day band clears the hour-grid origin.");
    saved.entries[0].time_grid = false;
    db.save(saved).unwrap();
    assert!(crate::history::step(&mut db, false).unwrap());
    assert!(db.load("2026-11-18").unwrap().entries[0].time_grid);
    assert!(crate::history::step(&mut db, true).unwrap());
    assert!(!db.load("2026-11-18").unwrap().entries[0].time_grid);
    let mut legacy = snapshot;
    for entry in legacy["tables"]["entries"].as_object_mut().unwrap().values_mut() { entry.as_object_mut().unwrap().remove("time_grid"); }
    other.sync_apply(other.sync_snapshot().unwrap(), legacy).unwrap();
    assert!(!other.load("2026-11-18").unwrap().entries[0].time_grid);
}

#[test]
fn planned_copies_and_series_extensions_keep_the_grid_origin() {
    let mut db = Store::from_connection(Connection::open_in_memory().unwrap()).unwrap();
    let mut day = db.load("2026-11-18").unwrap();
    let mut entry = range();
    let series = Uuid::new_v4().to_string();
    entry.repeat = Some(Repeat { series: series.clone(), rule: Some(json!({"start":"2026-11-18","unit":"day","interval":1})), horizon:"2026-11-19".into(), dates:vec!["2026-11-19".into()] });
    day.entries.push(entry);
    db.save(day).unwrap();
    assert!(db.load("2026-11-19").unwrap().entries[0].time_grid);
    db.extend_series(&[SeriesExtension { series, from:"2026-11-19".into(), to:"2026-11-20".into(), dates:vec!["2026-11-20".into()] }]).unwrap();
    assert!(db.load("2026-11-20").unwrap().entries[0].time_grid);
    let mut copy = range();
    copy.repeat = None;
    copy.plan = Some(Plan { via:"date".into(), targets:vec![PlanTarget { date:"2026-12-01".into(), id:Uuid::new_v4().to_string() }], time:copy.time.clone(), end:copy.end.clone(), reminder:false, repeat:None });
    let mut day = db.load("2026-11-21").unwrap(); day.entries.push(copy); db.save(day).unwrap();
    assert!(db.load("2026-12-01").unwrap().entries[0].time_grid);
}

#[test]
fn schema_14_entries_and_their_old_history_migrate_to_the_traditional_display() {
    let path = std::env::temp_dir().join(format!("grid-migration-{}.sqlite3", Uuid::new_v4()));
    {
        let mut db = Store::open(&path).unwrap();
        let mut day = db.load("2026-11-18").unwrap();
        let mut entry = range(); entry.time_grid = false; day.entries.push(entry);
        db.save(day).unwrap();
    }
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("ALTER TABLE entries DROP COLUMN time_grid; PRAGMA user_version=14;
            UPDATE undo_rows SET b=json_remove(b,'$.time_grid'),a=json_remove(a,'$.time_grid') WHERE t='entries';").unwrap();
    }
    {
        let mut db = Store::open(&path).unwrap();
        assert!(!db.load("2026-11-18").unwrap().entries[0].time_grid);
        assert!(crate::history::step(&mut db, false).unwrap());
        assert!(db.load("2026-11-18").unwrap().entries.is_empty());
        assert!(crate::history::step(&mut db, true).unwrap());
        assert!(!db.load("2026-11-18").unwrap().entries[0].time_grid);
        assert_eq!(db.conn.pragma_query_value(None,"user_version",|r|r.get::<_,i64>(0)).unwrap(),15);
    }
    for suffix in ["", "-wal", "-shm"] { let _ = std::fs::remove_file(format!("{}{suffix}", path.display())); }
}
