//! Logbuch zu Positionen: Beobachtungen, Fehler und „besser machen“-Notizen, die während einer Position entstehen.
//! Jeder Eintrag merkt sich Kurs und Stand der Position im Moment des Schreibens. „Besser machen“-Einträge lassen
//! sich einer Strategie zuordnen und werden dort zu Regeln für das nächste Mal.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const KINDS: [&str; 4] = ["observation", "mistake", "improve", "good"];
const TOPICS: [&str; 7] = ["einstieg", "ausstieg", "stoploss", "groesse", "timing", "gebuehren", "gefuehl"];
const MAX_TEXT: usize = 2000;
const MAX_NEXT: usize = 500;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: i64,
    pub trade_id: i64,
    /// Symbol und Name der Position, damit Übersichten ohne weiteres Laden auskommen
    pub symbol: String,
    pub trade_name: String,
    pub kind: String,
    pub topic: String,
    pub text: String,
    pub next_time: String,
    /// Kurs (Positionswährung) und Gewinn/Verlust der Position in % beim Schreiben
    pub price: Option<f64>,
    pub pnl_pct: Option<f64>,
    pub strategy_id: Option<i64>,
    /// UTC, `YYYY-MM-DD HH:MM:SS`
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalInput {
    pub trade_id: i64,
    pub kind: String,
    pub topic: String,
    pub text: String,
    pub next_time: String,
    pub price: Option<f64>,
    pub pnl_pct: Option<f64>,
    pub strategy_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEdit {
    pub kind: String,
    pub topic: String,
    pub text: String,
    pub next_time: String,
    pub strategy_id: Option<i64>,
}

struct Clean {
    kind: String,
    topic: String,
    text: String,
    next_time: String,
}

fn clean(kind: &str, topic: &str, text: &str, next_time: &str) -> Result<Clean, String> {
    if !KINDS.contains(&kind) {
        return Err(format!("Unbekannte Art: {kind}"));
    }
    let topic = topic.trim();
    if !topic.is_empty() && !TOPICS.contains(&topic) {
        return Err(format!("Unbekanntes Thema: {topic}"));
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("Bitte schreibe etwas in die Notiz.".into());
    }
    if text.chars().count() > MAX_TEXT {
        return Err(format!("Die Notiz darf höchstens {MAX_TEXT} Zeichen lang sein."));
    }
    let next_time = next_time.trim();
    if next_time.chars().count() > MAX_NEXT {
        return Err(format!("„Nächstes Mal“ darf höchstens {MAX_NEXT} Zeichen lang sein."));
    }
    Ok(Clean { kind: kind.to_string(), topic: topic.to_string(), text: text.to_string(), next_time: next_time.to_string() })
}

const SELECT: &str = "SELECT j.id, j.trade_id, t.symbol, t.name, j.kind, j.topic, j.text, j.next_time, j.price, j.pnl_pct, j.strategy_id, j.created_at
                      FROM trade_journal j JOIN trades t ON t.id = j.trade_id";

fn map(row: &rusqlite::Row) -> rusqlite::Result<JournalEntry> {
    Ok(JournalEntry {
        id: row.get(0)?,
        trade_id: row.get(1)?,
        symbol: row.get(2)?,
        trade_name: row.get(3)?,
        kind: row.get(4)?,
        topic: row.get(5)?,
        text: row.get(6)?,
        next_time: row.get(7)?,
        price: row.get(8)?,
        pnl_pct: row.get(9)?,
        strategy_id: row.get(10)?,
        created_at: row.get(11)?,
    })
}

/// Alle Einträge, neueste zuerst.
pub fn list(conn: &Connection) -> Result<Vec<JournalEntry>, String> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY j.created_at DESC, j.id DESC")).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn get(conn: &Connection, id: i64) -> Result<JournalEntry, String> {
    conn.query_row(&format!("{SELECT} WHERE j.id = ?1"), params![id], map)
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Eintrag nicht gefunden.".to_string())
}

fn check_strategy(conn: &Connection, strategy_id: Option<i64>) -> Result<(), String> {
    if let Some(id) = strategy_id {
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM strategies WHERE id = ?1)", params![id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !exists {
            return Err("Strategie nicht gefunden.".into());
        }
    }
    Ok(())
}

pub fn add(conn: &Connection, input: &JournalInput) -> Result<JournalEntry, String> {
    let c = clean(&input.kind, &input.topic, &input.text, &input.next_time)?;
    let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM trades WHERE id = ?1)", params![input.trade_id], |r| r.get(0)).map_err(|e| e.to_string())?;
    if !exists {
        return Err("Position nicht gefunden.".into());
    }
    check_strategy(conn, input.strategy_id)?;
    let price = input.price.filter(|v| v.is_finite());
    let pnl = input.pnl_pct.filter(|v| v.is_finite());
    conn.execute(
        "INSERT INTO trade_journal (trade_id, strategy_id, kind, topic, text, next_time, price, pnl_pct) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![input.trade_id, input.strategy_id, c.kind, c.topic, c.text, c.next_time, price, pnl],
    )
    .map_err(|e| e.to_string())?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, edit: &JournalEdit) -> Result<JournalEntry, String> {
    let c = clean(&edit.kind, &edit.topic, &edit.text, &edit.next_time)?;
    check_strategy(conn, edit.strategy_id)?;
    let changed = conn
        .execute(
            "UPDATE trade_journal SET kind = ?1, topic = ?2, text = ?3, next_time = ?4, strategy_id = ?5 WHERE id = ?6",
            params![c.kind, c.topic, c.text, c.next_time, edit.strategy_id, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Eintrag nicht gefunden.".into());
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn.execute("DELETE FROM trade_journal WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Eintrag nicht gefunden.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn_with_trade() -> (Connection, i64) {
        let c = Connection::open_in_memory().unwrap();
        crate::db::init(&c).unwrap();
        c.execute("INSERT INTO trades (symbol, name, asset_class, status) VALUES ('ALM', 'Almonty', 'aktie', 'open')", []).unwrap();
        let id = c.last_insert_rowid();
        (c, id)
    }

    fn input(trade_id: i64, kind: &str, text: &str) -> JournalInput {
        JournalInput { trade_id, kind: kind.into(), topic: "stoploss".into(), text: text.into(), next_time: " Stop sofort setzen ".into(), price: Some(9.66), pnl_pct: Some(-28.5), strategy_id: None }
    }

    #[test]
    fn adds_lists_updates_and_deletes() {
        let (c, trade) = conn_with_trade();
        let e = add(&c, &input(trade, "improve", "  Stop-Loss zu spät gesetzt ")).unwrap();
        assert_eq!(e.text, "Stop-Loss zu spät gesetzt");
        assert_eq!(e.next_time, "Stop sofort setzen");
        assert_eq!((e.symbol.as_str(), e.price, e.pnl_pct), ("ALM", Some(9.66), Some(-28.5)));
        add(&c, &input(trade, "observation", "Kurs bricht ein")).unwrap();
        assert_eq!(list(&c).unwrap().len(), 2);

        let edited = update(&c, e.id, &JournalEdit { kind: "mistake".into(), topic: "".into(), text: "Anders".into(), next_time: "".into(), strategy_id: None }).unwrap();
        assert_eq!((edited.kind.as_str(), edited.topic.as_str(), edited.text.as_str()), ("mistake", "", "Anders"));
        delete(&c, e.id).unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
        assert!(delete(&c, e.id).is_err());
    }

    #[test]
    fn validates_input() {
        let (c, trade) = conn_with_trade();
        assert!(add(&c, &input(trade, "wild", "x")).is_err());
        assert!(add(&c, &input(trade, "good", "   ")).is_err());
        assert!(add(&c, &input(trade, "good", &"x".repeat(MAX_TEXT + 1))).is_err());
        assert!(add(&c, &JournalInput { topic: "unbekannt".into(), ..input(trade, "good", "x") }).is_err());
        assert!(add(&c, &input(trade + 99, "good", "x")).unwrap_err().contains("Position"));
        assert!(add(&c, &JournalInput { strategy_id: Some(42), ..input(trade, "good", "x") }).unwrap_err().contains("Strategie"));
    }

    #[test]
    fn entries_follow_their_trade_and_strategy() {
        let (c, trade) = conn_with_trade();
        c.execute("INSERT INTO strategies (title) VALUES ('Momentum')", []).unwrap();
        let strategy = c.last_insert_rowid();
        let e = add(&c, &JournalInput { strategy_id: Some(strategy), ..input(trade, "improve", "Regel") }).unwrap();
        assert_eq!(e.strategy_id, Some(strategy));
        // Strategie gelöscht: der Eintrag bleibt, nur die Zuordnung fällt weg
        c.execute("DELETE FROM strategies WHERE id = ?1", params![strategy]).unwrap();
        assert_eq!(list(&c).unwrap()[0].strategy_id, None);
        // Position gelöscht: ihr Logbuch verschwindet mit
        c.execute("DELETE FROM trades WHERE id = ?1", params![trade]).unwrap();
        assert!(list(&c).unwrap().is_empty());
    }
}
