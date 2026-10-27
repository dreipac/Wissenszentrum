//! Projekte des Assistenten: ein Projekt gibt dem Gespräch einen festen Kontext. Es verweist auf einen Ordner oder eine
//! Seite der Dokumentation und kann Hinweise für den Assistenten enthalten. Mit einem aktiven Projekt weiß der Assistent,
//! wo Neues hingehört und was „die Doku“ ist, ohne dass man es jedes Mal sagen muss.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

const MAX_NAME: usize = 80;
const MAX_INSTRUCTIONS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    /// Ordner oder Seite der Dokumentation als Kontext (None = keiner, oder die Seite wurde gelöscht)
    pub doc_id: Option<i64>,
    /// Hinweise der Person an den Assistenten für dieses Projekt
    pub instructions: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    #[serde(default)]
    pub doc_id: Option<i64>,
    #[serde(default)]
    pub instructions: String,
}

const COLUMNS: &str = "id, name, doc_id, instructions";

fn row_to_project(row: &Row) -> rusqlite::Result<Project> {
    Ok(Project { id: row.get(0)?, name: row.get(1)?, doc_id: row.get(2)?, instructions: row.get(3)? })
}

fn validate(conn: &Connection, input: &ProjectInput, own_id: Option<i64>) -> Result<(), String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Der Name darf nicht leer sein.".into());
    }
    if name.chars().count() > MAX_NAME {
        return Err(format!("Der Name darf höchstens {MAX_NAME} Zeichen lang sein."));
    }
    if input.instructions.chars().count() > MAX_INSTRUCTIONS {
        return Err(format!("Die Hinweise dürfen höchstens {MAX_INSTRUCTIONS} Zeichen lang sein."));
    }
    let duplicate: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM assistant_projects WHERE LOWER(name) = LOWER(?1) AND id IS NOT ?2)",
            params![name, own_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if duplicate {
        return Err(format!("Ein Projekt „{name}“ gibt es bereits."));
    }
    if let Some(doc) = input.doc_id {
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM doc_pages WHERE id = ?1)", params![doc], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !exists {
            return Err("Der gewählte Ordner oder die Seite der Dokumentation existiert nicht mehr.".into());
        }
    }
    Ok(())
}

pub fn list(conn: &Connection) -> Result<Vec<Project>, String> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM assistant_projects ORDER BY position, id")).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_project).map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn get(conn: &Connection, id: i64) -> Result<Project, String> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM assistant_projects WHERE id = ?1"), params![id], row_to_project).map_err(|_| "Projekt nicht gefunden.".to_string())
}

pub fn create(conn: &Connection, input: &ProjectInput) -> Result<Project, String> {
    validate(conn, input, None)?;
    let position: i64 = conn.query_row("SELECT COALESCE(MAX(position) + 1, 0) FROM assistant_projects", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO assistant_projects (name, doc_id, instructions, position) VALUES (?1, ?2, ?3, ?4)",
        params![input.name.trim(), input.doc_id, input.instructions.trim(), position],
    )
    .map_err(|e| e.to_string())?;
    get(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, input: &ProjectInput) -> Result<Project, String> {
    get(conn, id)?;
    validate(conn, input, Some(id))?;
    conn.execute(
        "UPDATE assistant_projects SET name = ?1, doc_id = ?2, instructions = ?3 WHERE id = ?4",
        params![input.name.trim(), input.doc_id, input.instructions.trim(), id],
    )
    .map_err(|e| e.to_string())?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn.execute("DELETE FROM assistant_projects WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Projekt nicht gefunden.".into());
    }
    Ok(())
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

    fn input(name: &str, doc: Option<i64>) -> ProjectInput {
        ProjectInput { name: name.into(), doc_id: doc, instructions: String::new() }
    }

    #[test]
    fn projects_are_created_listed_updated_and_deleted() {
        let c = conn();
        c.execute("INSERT INTO doc_pages (title, kind) VALUES ('Studienplanung', 'folder')", []).unwrap();
        let a = create(&c, &ProjectInput { instructions: "  Immer in Du-Form schreiben.  ".into(), ..input(" Studium ", Some(1)) }).unwrap();
        let b = create(&c, &input("Privat", None)).unwrap();
        assert_eq!((a.name.as_str(), a.doc_id, a.instructions.as_str()), ("Studium", Some(1), "Immer in Du-Form schreiben."));
        assert_eq!(list(&c).unwrap().iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["Studium", "Privat"], "in Reihenfolge des Anlegens");

        let u = update(&c, b.id, &ProjectInput { instructions: "Kurz halten".into(), ..input("Privat 2", Some(1)) }).unwrap();
        assert_eq!((u.name.as_str(), u.doc_id), ("Privat 2", Some(1)));
        delete(&c, a.id).unwrap();
        assert_eq!(list(&c).unwrap().len(), 1);
        assert!(delete(&c, a.id).is_err() && get(&c, a.id).is_err() && update(&c, a.id, &input("x", None)).is_err());
    }

    #[test]
    fn rejects_invalid_projects() {
        let c = conn();
        create(&c, &input("Studium", None)).unwrap();
        assert!(create(&c, &input("  ", None)).is_err());
        assert!(create(&c, &input(&"x".repeat(81), None)).is_err());
        assert!(create(&c, &input("studium", None)).unwrap_err().contains("gibt es bereits"), "Groß- und Kleinschreibung egal");
        assert!(create(&c, &input("Neu", Some(99))).unwrap_err().contains("existiert nicht"));
        assert!(create(&c, &ProjectInput { instructions: "x".repeat(2001), ..input("Lang", None) }).is_err());
        // Das eigene Projekt darf seinen Namen behalten
        let own = create(&c, &input("Eigen", None)).unwrap();
        assert!(update(&c, own.id, &input("Eigen", None)).is_ok());
    }

    #[test]
    fn deleting_the_page_keeps_the_project_without_context() {
        let c = conn();
        c.execute("INSERT INTO doc_pages (title, kind) VALUES ('Ordner', 'folder')", []).unwrap();
        let p = create(&c, &input("Mit Ordner", Some(1))).unwrap();
        c.execute("DELETE FROM doc_pages WHERE id = 1", []).unwrap();
        assert_eq!(get(&c, p.id).unwrap().doc_id, None);
    }
}
