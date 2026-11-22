//! Board cards retain unknown fields, including extensions written by newer clients.
use crate::{history, storage::Store};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::Value;

pub const SCOPES_FILE: &str = "board-scopes.json";

pub fn cards(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare("SELECT value FROM settings WHERE key >= 'board:card:' AND key < 'board:card;' ORDER BY key")
        .map_err(err)?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Field-level optimistic edits. Missing records represent creation or deletion.
/// A conflict rolls back every card and the undo entry.
pub fn edit(store: &mut Store, changes: &[(Value, Value)]) -> Result<(), String> {
    if changes.iter().all(|(before, after)| before == after) {
        return Ok(());
    }
    let tx = store
        .conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(err)?;
    history::begin(&tx).map_err(err)?;
    for (before, after) in changes.iter().filter(|(a, b)| a != b) {
        let id = after["id"].as_str().or(before["id"].as_str()).ok_or("id")?;
        uuid::Uuid::parse_str(id).map_err(err)?;
        let key = format!("board:card:{id}");
        let raw: Option<String> = tx
            .query_row("SELECT value FROM settings WHERE key=?1", [&key], |row| row.get(0))
            .optional()
            .map_err(err)?;
        let current = raw.map(|s| serde_json::from_str(&s)).transpose().map_err(err)?;
        let merged = merge(
            (!before.is_null()).then_some(before),
            (!after.is_null()).then_some(after),
            current.as_ref(),
        )?;
        if let Some(mut card) = merged {
            if !before.is_null()
                && ["text", "title", "ink"]
                    .iter()
                    .any(|field| before[*field] != after[*field])
            {
                card["updatedAt"] = Value::from(chrono::Utc::now().timestamp_millis());
            }
            if card["id"] != id
                || !matches!(card["kind"].as_str(), Some("note" | "image" | "link"))
                || !card["dates"].is_array()
            {
                return Err("invalid card".into());
            }
            let json = card.to_string();
            if json.len() > 2_000_000 {
                return Err("card > 2 MB".into());
            }
            tx.execute(
                "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [&key, &json],
            )
            .map_err(err)?;
        } else {
            tx.execute("DELETE FROM settings WHERE key=?1", [&key]).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}

fn merge(before: Option<&Value>, after: Option<&Value>, current: Option<&Value>) -> Result<Option<Value>, String> {
    if before == after {
        return Ok(current.cloned());
    }
    if current == before || current == after {
        return Ok(after.cloned());
    }
    if let (Some(Value::Object(old)), Some(Value::Object(new)), Some(Value::Object(now))) = (before, after, current) {
        let mut result = now.clone();
        for key in old.keys().chain(new.keys().filter(|key| !old.contains_key(*key))) {
            match merge(old.get(key), new.get(key), now.get(key))? {
                Some(value) => {
                    result.insert(key.clone(), value);
                }
                None => {
                    result.remove(key);
                }
            }
        }
        return Ok(Some(Value::Object(result)));
    }
    Err("conflict".into())
}
