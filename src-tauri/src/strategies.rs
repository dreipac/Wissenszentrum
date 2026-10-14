//! Strategien: Graph aus Knoten (Unternehmen, Ereignisse, Annahmen …) und gerichteten Verbindungen.
//!
//! Eine Verbindung hat eine Beschriftung ("führt zu") und eine Polarität: `positive` verstärkt,
//! `negative` schwächt oder bremst. Knoten tragen ihre Position auf der Zeichenfläche (px).
//! `updated_at` ist UTC im Format `YYYY-MM-DD HH:MM:SS` und ändert sich bei jeder Änderung am Graphen.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

const MAX_TITLE: usize = 120;
const MAX_TEXT: usize = 5_000;
const MAX_SYMBOL: usize = 30;
const MAX_LABEL: usize = 60;
const MAX_COORD: f64 = 100_000.0;

const KINDS: [&str; 5] = ["company", "event", "assumption", "reaction", "risk"];
const POLARITIES: [&str; 2] = ["positive", "negative"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyNode {
    pub id: i64,
    pub title: String,
    pub kind: String,
    pub text: String,
    /// Verknüpftes Handelssymbol, leer = keines
    pub symbol: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyEdge {
    pub id: i64,
    pub from: i64,
    pub to: i64,
    pub label: String,
    pub polarity: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Strategy {
    pub id: i64,
    pub title: String,
    pub updated_at: String,
    pub nodes: Vec<StrategyNode>,
    pub edges: Vec<StrategyEdge>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    pub title: String,
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub symbol: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    pub from: i64,
    pub to: i64,
    #[serde(default)]
    pub label: String,
    pub polarity: String,
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn clean_title(title: &str, what: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err(format!("Bitte gib {what} ein."));
    }
    if title.chars().count() > MAX_TITLE {
        return Err(format!("Der Titel darf höchstens {MAX_TITLE} Zeichen lang sein."));
    }
    Ok(title.to_string())
}

fn clamp_coord(v: f64) -> Result<f64, String> {
    if !v.is_finite() {
        return Err("Ungültige Position.".into());
    }
    Ok(v.clamp(0.0, MAX_COORD).round())
}

/// Prüft einen Knoten und liefert (Titel, Text, Symbol in Großbuchstaben, x, y).
fn validate_node(input: &NodeInput) -> Result<(String, String, String, f64, f64), String> {
    let title = clean_title(&input.title, "einen Titel")?;
    if !KINDS.contains(&input.kind.as_str()) {
        return Err("Unbekannte Art des Knotens.".into());
    }
    if input.text.chars().count() > MAX_TEXT {
        return Err(format!("Der Text darf höchstens {MAX_TEXT} Zeichen lang sein."));
    }
    let symbol = input.symbol.trim().to_uppercase();
    if symbol.chars().count() > MAX_SYMBOL {
        return Err(format!("Das Symbol darf höchstens {MAX_SYMBOL} Zeichen lang sein."));
    }
    Ok((title, input.text.trim().to_string(), symbol, clamp_coord(input.x)?, clamp_coord(input.y)?))
}

fn validate_edge_fields(label: &str, polarity: &str) -> Result<String, String> {
    if !POLARITIES.contains(&polarity) {
        return Err("Unbekannte Wirkung der Verbindung.".into());
    }
    let label = label.trim();
    if label.chars().count() > MAX_LABEL {
        return Err(format!("Die Beschriftung darf höchstens {MAX_LABEL} Zeichen lang sein."));
    }
    Ok(label.to_string())
}

fn touch(conn: &Connection, strategy_id: i64) -> Result<(), String> {
    conn.execute("UPDATE strategies SET updated_at = datetime('now') WHERE id = ?1", params![strategy_id])
        .map_err(db_err)?;
    Ok(())
}

fn strategy_of_node(conn: &Connection, node_id: i64) -> Result<i64, String> {
    conn.query_row("SELECT strategy_id FROM strategy_nodes WHERE id = ?1", params![node_id], |r| r.get(0))
        .map_err(|_| "Knoten nicht gefunden.".to_string())
}

fn strategy_of_edge(conn: &Connection, edge_id: i64) -> Result<i64, String> {
    conn.query_row("SELECT strategy_id FROM strategy_edges WHERE id = ?1", params![edge_id], |r| r.get(0))
        .map_err(|_| "Verbindung nicht gefunden.".to_string())
}

/// Alle Strategien samt Knoten und Verbindungen, zuletzt bearbeitete zuerst.
pub fn list_strategies(conn: &Connection) -> Result<Vec<Strategy>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, updated_at FROM strategies ORDER BY updated_at DESC, id DESC")
        .map_err(db_err)?;
    let mut strategies: Vec<Strategy> = stmt
        .query_map([], |r| {
            Ok(Strategy { id: r.get(0)?, title: r.get(1)?, updated_at: r.get(2)?, nodes: vec![], edges: vec![] })
        })
        .map_err(db_err)?
        .collect::<Result<_, _>>()
        .map_err(db_err)?;

    let mut stmt = conn
        .prepare("SELECT id, strategy_id, title, kind, text, symbol, x, y FROM strategy_nodes ORDER BY id")
        .map_err(db_err)?;
    let nodes = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(1)?,
                StrategyNode { id: r.get(0)?, title: r.get(2)?, kind: r.get(3)?, text: r.get(4)?, symbol: r.get(5)?, x: r.get(6)?, y: r.get(7)? },
            ))
        })
        .map_err(db_err)?;
    for node in nodes {
        let (strategy_id, node) = node.map_err(db_err)?;
        if let Some(s) = strategies.iter_mut().find(|s| s.id == strategy_id) {
            s.nodes.push(node);
        }
    }

    let mut stmt = conn
        .prepare("SELECT id, strategy_id, from_node, to_node, label, polarity FROM strategy_edges ORDER BY id")
        .map_err(db_err)?;
    let edges = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(1)?,
                StrategyEdge { id: r.get(0)?, from: r.get(2)?, to: r.get(3)?, label: r.get(4)?, polarity: r.get(5)? },
            ))
        })
        .map_err(db_err)?;
    for edge in edges {
        let (strategy_id, edge) = edge.map_err(db_err)?;
        if let Some(s) = strategies.iter_mut().find(|s| s.id == strategy_id) {
            s.edges.push(edge);
        }
    }
    Ok(strategies)
}

pub fn create_strategy(conn: &Connection, title: &str) -> Result<i64, String> {
    let title = clean_title(title, "einen Namen")?;
    conn.execute("INSERT INTO strategies (title) VALUES (?1)", params![title]).map_err(db_err)?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_strategy(conn: &Connection, id: i64, title: &str) -> Result<(), String> {
    let title = clean_title(title, "einen Namen")?;
    let changed = conn
        .execute("UPDATE strategies SET title = ?1, updated_at = datetime('now') WHERE id = ?2", params![title, id])
        .map_err(db_err)?;
    if changed == 0 {
        return Err("Strategie nicht gefunden.".into());
    }
    Ok(())
}

pub fn delete_strategy(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn.execute("DELETE FROM strategies WHERE id = ?1", params![id]).map_err(db_err)?;
    if changed == 0 {
        return Err("Strategie nicht gefunden.".into());
    }
    Ok(())
}

pub fn create_node(conn: &Connection, strategy_id: i64, input: &NodeInput) -> Result<StrategyNode, String> {
    let (title, text, symbol, x, y) = validate_node(input)?;
    conn.query_row("SELECT id FROM strategies WHERE id = ?1", params![strategy_id], |r| r.get::<_, i64>(0))
        .map_err(|_| "Strategie nicht gefunden.".to_string())?;
    conn.execute(
        "INSERT INTO strategy_nodes (strategy_id, title, kind, text, symbol, x, y) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![strategy_id, title, input.kind, text, symbol, x, y],
    )
    .map_err(db_err)?;
    touch(conn, strategy_id)?;
    Ok(StrategyNode { id: conn.last_insert_rowid(), title, kind: input.kind.clone(), text, symbol, x, y })
}

/// Ändert Titel, Art, Text und Symbol; die Position bleibt (siehe `move_node`).
pub fn update_node(conn: &Connection, id: i64, input: &NodeInput) -> Result<(), String> {
    let (title, text, symbol, _, _) = validate_node(input)?;
    let strategy_id = strategy_of_node(conn, id)?;
    conn.execute(
        "UPDATE strategy_nodes SET title = ?1, kind = ?2, text = ?3, symbol = ?4 WHERE id = ?5",
        params![title, input.kind, text, symbol, id],
    )
    .map_err(db_err)?;
    touch(conn, strategy_id)
}

pub fn move_node(conn: &Connection, id: i64, x: f64, y: f64) -> Result<(), String> {
    let (x, y) = (clamp_coord(x)?, clamp_coord(y)?);
    let strategy_id = strategy_of_node(conn, id)?;
    conn.execute("UPDATE strategy_nodes SET x = ?1, y = ?2 WHERE id = ?3", params![x, y, id]).map_err(db_err)?;
    touch(conn, strategy_id)
}

/// Löscht den Knoten samt aller Verbindungen, die an ihm hängen.
pub fn delete_node(conn: &Connection, id: i64) -> Result<(), String> {
    let strategy_id = strategy_of_node(conn, id)?;
    conn.execute("DELETE FROM strategy_nodes WHERE id = ?1", params![id]).map_err(db_err)?;
    touch(conn, strategy_id)
}

pub fn create_edge(conn: &Connection, strategy_id: i64, input: &EdgeInput) -> Result<StrategyEdge, String> {
    let label = validate_edge_fields(&input.label, &input.polarity)?;
    if input.from == input.to {
        return Err("Ein Knoten kann nicht mit sich selbst verbunden werden.".into());
    }
    // Beide Knoten müssen zu dieser Strategie gehören
    for node in [input.from, input.to] {
        if strategy_of_node(conn, node)? != strategy_id {
            return Err("Die Knoten gehören nicht zu dieser Strategie.".into());
        }
    }
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM strategy_edges WHERE from_node = ?1 AND to_node = ?2",
            params![input.from, input.to],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    if exists > 0 {
        return Err("Diese Verbindung gibt es bereits.".into());
    }
    conn.execute(
        "INSERT INTO strategy_edges (strategy_id, from_node, to_node, label, polarity) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![strategy_id, input.from, input.to, label, input.polarity],
    )
    .map_err(db_err)?;
    touch(conn, strategy_id)?;
    Ok(StrategyEdge { id: conn.last_insert_rowid(), from: input.from, to: input.to, label, polarity: input.polarity.clone() })
}

pub fn update_edge(conn: &Connection, id: i64, label: &str, polarity: &str) -> Result<(), String> {
    let label = validate_edge_fields(label, polarity)?;
    let strategy_id = strategy_of_edge(conn, id)?;
    conn.execute("UPDATE strategy_edges SET label = ?1, polarity = ?2 WHERE id = ?3", params![label, polarity, id])
        .map_err(db_err)?;
    touch(conn, strategy_id)
}

pub fn delete_edge(conn: &Connection, id: i64) -> Result<(), String> {
    let strategy_id = strategy_of_edge(conn, id)?;
    conn.execute("DELETE FROM strategy_edges WHERE id = ?1", params![id]).map_err(db_err)?;
    touch(conn, strategy_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        db::init(&c).unwrap();
        c
    }

    fn node(title: &str, kind: &str) -> NodeInput {
        NodeInput { title: title.into(), kind: kind.into(), text: String::new(), symbol: String::new(), x: 10.0, y: 20.0 }
    }

    fn edge(from: i64, to: i64) -> EdgeInput {
        EdgeInput { from, to, label: "führt zu".into(), polarity: "positive".into() }
    }

    #[test]
    fn creates_and_lists_a_strategy_with_graph() {
        let c = conn();
        let s = create_strategy(&c, "  BlackRock  ").unwrap();
        let a = create_node(&c, s, &NodeInput { symbol: " blk ".into(), ..node("BlackRock", "company") }).unwrap();
        let b = create_node(&c, s, &node("ETF-Zuflüsse", "reaction")).unwrap();
        assert_eq!(a.symbol, "BLK", "Symbole werden groß gespeichert");
        create_edge(&c, s, &edge(a.id, b.id)).unwrap();

        let list = list_strategies(&c).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "BlackRock");
        assert_eq!(list[0].nodes.len(), 2);
        assert_eq!(list[0].edges.len(), 1);
        assert_eq!((list[0].edges[0].from, list[0].edges[0].to), (a.id, b.id));
    }

    #[test]
    fn rejects_invalid_input() {
        let c = conn();
        assert!(create_strategy(&c, "   ").is_err());
        let s = create_strategy(&c, "S").unwrap();
        assert!(create_node(&c, s, &node("", "company")).is_err());
        assert!(create_node(&c, s, &node("X", "unbekannt")).is_err());
        assert!(create_node(&c, 999, &node("X", "company")).is_err(), "unbekannte Strategie");
        assert!(create_node(&c, s, &NodeInput { x: f64::NAN, ..node("X", "company") }).is_err());
        assert!(create_node(&c, s, &NodeInput { text: "x".repeat(MAX_TEXT + 1), ..node("X", "company") }).is_err());
    }

    #[test]
    fn positions_are_clamped_and_rounded() {
        let c = conn();
        let s = create_strategy(&c, "S").unwrap();
        let n = create_node(&c, s, &NodeInput { x: -50.0, y: 12.6, ..node("X", "event") }).unwrap();
        assert_eq!((n.x, n.y), (0.0, 13.0));
        move_node(&c, n.id, 300.4, 1e9).unwrap();
        let moved = &list_strategies(&c).unwrap()[0].nodes[0];
        assert_eq!((moved.x, moved.y), (300.0, MAX_COORD));
        assert!(move_node(&c, 999, 1.0, 1.0).is_err());
    }

    #[test]
    fn update_node_keeps_position() {
        let c = conn();
        let s = create_strategy(&c, "S").unwrap();
        let n = create_node(&c, s, &node("Alt", "event")).unwrap();
        update_node(&c, n.id, &NodeInput { x: 999.0, y: 999.0, text: "Neu".into(), ..node("Neu", "risk") }).unwrap();
        let got = &list_strategies(&c).unwrap()[0].nodes[0];
        assert_eq!((got.title.as_str(), got.kind.as_str(), got.text.as_str()), ("Neu", "risk", "Neu"));
        assert_eq!((got.x, got.y), (10.0, 20.0));
    }

    #[test]
    fn edge_rules() {
        let c = conn();
        let s1 = create_strategy(&c, "S1").unwrap();
        let s2 = create_strategy(&c, "S2").unwrap();
        let a = create_node(&c, s1, &node("A", "event")).unwrap();
        let b = create_node(&c, s1, &node("B", "event")).unwrap();
        let other = create_node(&c, s2, &node("C", "event")).unwrap();

        assert!(create_edge(&c, s1, &edge(a.id, a.id)).is_err(), "keine Schleife auf sich selbst");
        assert!(create_edge(&c, s1, &edge(a.id, other.id)).is_err(), "nicht über Strategien hinweg");
        assert!(create_edge(&c, s1, &EdgeInput { polarity: "x".into(), ..edge(a.id, b.id) }).is_err());
        let e = create_edge(&c, s1, &edge(a.id, b.id)).unwrap();
        assert!(create_edge(&c, s1, &edge(a.id, b.id)).is_err(), "keine doppelte Verbindung");
        assert!(create_edge(&c, s1, &edge(b.id, a.id)).is_ok(), "Gegenrichtung ist erlaubt");

        update_edge(&c, e.id, "bremst", "negative").unwrap();
        let got = list_strategies(&c).unwrap().into_iter().find(|s| s.id == s1).unwrap();
        let updated = got.edges.iter().find(|x| x.id == e.id).unwrap();
        assert_eq!((updated.label.as_str(), updated.polarity.as_str()), ("bremst", "negative"));
        assert!(update_edge(&c, e.id, "x", "kaputt").is_err());

        delete_edge(&c, e.id).unwrap();
        assert!(delete_edge(&c, e.id).is_err());
    }

    #[test]
    fn deleting_a_node_removes_its_edges_only() {
        let c = conn();
        let s = create_strategy(&c, "S").unwrap();
        let a = create_node(&c, s, &node("A", "event")).unwrap();
        let b = create_node(&c, s, &node("B", "event")).unwrap();
        let d = create_node(&c, s, &node("D", "event")).unwrap();
        create_edge(&c, s, &edge(a.id, b.id)).unwrap();
        create_edge(&c, s, &edge(b.id, d.id)).unwrap();
        create_edge(&c, s, &edge(a.id, d.id)).unwrap();

        delete_node(&c, b.id).unwrap();
        let got = &list_strategies(&c).unwrap()[0];
        assert_eq!(got.nodes.len(), 2);
        assert_eq!(got.edges.len(), 1);
        assert_eq!((got.edges[0].from, got.edges[0].to), (a.id, d.id));
    }

    #[test]
    fn deleting_a_strategy_removes_everything() {
        let c = conn();
        let s = create_strategy(&c, "S").unwrap();
        let a = create_node(&c, s, &node("A", "event")).unwrap();
        let b = create_node(&c, s, &node("B", "event")).unwrap();
        create_edge(&c, s, &edge(a.id, b.id)).unwrap();
        rename_strategy(&c, s, "Neu").unwrap();
        assert_eq!(list_strategies(&c).unwrap()[0].title, "Neu");

        delete_strategy(&c, s).unwrap();
        assert!(list_strategies(&c).unwrap().is_empty());
        let nodes: i64 = c.query_row("SELECT COUNT(*) FROM strategy_nodes", [], |r| r.get(0)).unwrap();
        let edges: i64 = c.query_row("SELECT COUNT(*) FROM strategy_edges", [], |r| r.get(0)).unwrap();
        assert_eq!((nodes, edges), (0, 0));
        assert!(delete_strategy(&c, s).is_err());
        assert!(rename_strategy(&c, s, "X").is_err());
    }
}
