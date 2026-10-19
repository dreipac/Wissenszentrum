//! Notizen: schnelle, kurzlebige Einträge mit Titel, Text und optionalem Ordner.
//!
//! `content` ist das HTML des Editors, `plain` derselbe Inhalt als reiner Text
//! (für Vorschau, Suche und die Erkennung leerer Notizen).
//! `created_at`/`updated_at` sind UTC im Format `YYYY-MM-DD HH:MM:SS`.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

const MAX_TITLE: usize = 200;
const MAX_FOLDER: usize = 40;
const MAX_BODY_BYTES: usize = 500_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub plain: String,
    /// Leer = ohne Ordner
    pub folder: String,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub plain: String,
    #[serde(default)]
    pub folder: String,
}

const NOTE_COLUMNS: &str = "id, title, content, plain, folder, pinned, created_at, updated_at";

fn row_to_note(row: &Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        plain: row.get(3)?,
        folder: row.get(4)?,
        pinned: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

/// Prüft die Eingabe und liefert Titel und Ordner bereinigt zurück.
fn validate(input: &NoteInput) -> Result<(String, String), String> {
    let title = input.title.trim();
    let folder = input.folder.trim();
    if title.chars().count() > MAX_TITLE {
        return Err(format!("Der Titel darf höchstens {MAX_TITLE} Zeichen lang sein."));
    }
    if folder.chars().count() > MAX_FOLDER {
        return Err(format!("Der Ordnername darf höchstens {MAX_FOLDER} Zeichen lang sein."));
    }
    if input.content.len() > MAX_BODY_BYTES || input.plain.len() > MAX_BODY_BYTES {
        return Err("Die Notiz ist zu lang.".into());
    }
    Ok((title.to_string(), folder.to_string()))
}

/// Angepinnte zuerst, dann zuletzt bearbeitete.
pub fn list_notes(conn: &Connection) -> Result<Vec<Note>, String> {
    let sql = format!("SELECT {NOTE_COLUMNS} FROM notes ORDER BY pinned DESC, updated_at DESC, id DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_note).map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn get_note(conn: &Connection, id: i64) -> Result<Note, String> {
    conn.query_row(&format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1"), params![id], row_to_note)
        .map_err(|_| "Notiz nicht gefunden.".to_string())
}

pub fn create_note(conn: &Connection, input: &NoteInput) -> Result<Note, String> {
    let (title, folder) = validate(input)?;
    conn.execute(
        "INSERT INTO notes (title, content, plain, folder) VALUES (?1, ?2, ?3, ?4)",
        params![title, input.content, input.plain, folder],
    )
    .map_err(|e| e.to_string())?;
    get_note(conn, conn.last_insert_rowid())
}

pub fn update_note(conn: &Connection, id: i64, input: &NoteInput) -> Result<Note, String> {
    let (title, folder) = validate(input)?;
    let changed = conn
        .execute(
            "UPDATE notes
             SET title = ?1, content = ?2, plain = ?3, folder = ?4, updated_at = datetime('now')
             WHERE id = ?5",
            params![title, input.content, input.plain, folder, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Notiz nicht gefunden.".into());
    }
    get_note(conn, id)
}

/// Anpinnen ändert nicht den Zeitpunkt der letzten Bearbeitung.
pub fn set_note_pinned(conn: &Connection, id: i64, pinned: bool) -> Result<Note, String> {
    let changed = conn
        .execute("UPDATE notes SET pinned = ?1 WHERE id = ?2", params![pinned as i64, id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Notiz nicht gefunden.".into());
    }
    get_note(conn, id)
}

pub fn delete_note(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Notiz nicht gefunden.".into());
    }
    let _ = crate::files::gc(conn);
    Ok(())
}

/// Entfernt Notizen ohne Titel und ohne Text (z. B. „Neue Notiz“ angeklickt, nichts geschrieben).
/// Angepinnte und die Notiz `except_id` bleiben erhalten. Liefert die Anzahl der gelöschten Notizen.
pub fn purge_empty_notes(conn: &Connection, except_id: Option<i64>) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM notes
         WHERE pinned = 0
           AND trim(title, ' ' || char(9, 10, 13)) = ''
           AND trim(plain, ' ' || char(9, 10, 13)) = ''
           AND id IS NOT ?1",
        params![except_id],
    )
    .map_err(|e| e.to_string())
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

    fn input(title: &str, plain: &str) -> NoteInput {
        NoteInput {
            title: title.into(),
            content: format!("<p>{plain}</p>"),
            plain: plain.into(),
            folder: String::new(),
        }
    }

    #[test]
    fn create_update_get_roundtrip() {
        let c = conn();
        let n = create_note(&c, &input("  Idee ", "Text")).unwrap();
        assert_eq!(n.title, "Idee", "Titel wird getrimmt");
        assert!(!n.pinned);
        assert_eq!(n.folder, "");

        let mut upd = input("Idee 2", "Neuer Text");
        upd.folder = "  Ideen ".into();
        let u = update_note(&c, n.id, &upd).unwrap();
        assert_eq!(u.title, "Idee 2");
        assert_eq!(u.plain, "Neuer Text");
        assert_eq!(u.content, "<p>Neuer Text</p>");
        assert_eq!(u.folder, "Ideen");
        assert!(update_note(&c, 999, &upd).is_err());
    }

    #[test]
    fn order_is_pinned_first_then_recent() {
        let c = conn();
        let a = create_note(&c, &input("A", "")).unwrap();
        let b = create_note(&c, &input("B", "")).unwrap();
        let d = create_note(&c, &input("C", "")).unwrap();
        // Zeitpunkte gezielt setzen: A ist am aktuellsten, C am ältesten
        c.execute("UPDATE notes SET updated_at = '2026-10-14 12:00:00' WHERE id = ?1", params![a.id]).unwrap();
        c.execute("UPDATE notes SET updated_at = '2026-10-13 12:00:00' WHERE id = ?1", params![b.id]).unwrap();
        c.execute("UPDATE notes SET updated_at = '2026-10-12 12:00:00' WHERE id = ?1", params![d.id]).unwrap();
        let titles = |c: &Connection| list_notes(c).unwrap().into_iter().map(|n| n.title).collect::<Vec<_>>();
        assert_eq!(titles(&c), ["A", "B", "C"]);

        set_note_pinned(&c, d.id, true).unwrap();
        assert_eq!(titles(&c), ["C", "A", "B"], "Angepinnte stehen oben");

        // Anpinnen verändert die Bearbeitungszeit nicht
        assert_eq!(get_note(&c, d.id).unwrap().updated_at, "2026-10-12 12:00:00");
        assert!(set_note_pinned(&c, 999, true).is_err());
    }

    #[test]
    fn editing_moves_note_to_top() {
        let c = conn();
        let a = create_note(&c, &input("A", "")).unwrap();
        create_note(&c, &input("B", "")).unwrap();
        c.execute("UPDATE notes SET updated_at = '2020-01-01 00:00:00'", []).unwrap();
        update_note(&c, a.id, &input("A", "neu")).unwrap();
        assert_eq!(list_notes(&c).unwrap()[0].title, "A");
    }

    #[test]
    fn delete_note_works_once() {
        let c = conn();
        let n = create_note(&c, &input("A", "")).unwrap();
        delete_note(&c, n.id).unwrap();
        assert!(get_note(&c, n.id).is_err());
        assert!(delete_note(&c, n.id).is_err());
    }

    #[test]
    fn rejects_too_long_input() {
        let c = conn();
        assert!(create_note(&c, &input(&"x".repeat(MAX_TITLE + 1), "")).is_err());
        let mut long_folder = input("A", "");
        long_folder.folder = "x".repeat(MAX_FOLDER + 1);
        assert!(create_note(&c, &long_folder).is_err());
        let mut huge = input("A", "");
        huge.plain = "x".repeat(MAX_BODY_BYTES + 1);
        assert!(create_note(&c, &huge).is_err());
    }

    #[test]
    fn purge_removes_only_empty_unpinned_notes() {
        let c = conn();
        let empty = create_note(&c, &input("", "")).unwrap();
        let blank = create_note(&c, &input("  ", " \n ")).unwrap();
        let keep_title = create_note(&c, &input("Titel", "")).unwrap();
        let keep_text = create_note(&c, &input("", "Text")).unwrap();
        let pinned_empty = create_note(&c, &input("", "")).unwrap();
        set_note_pinned(&c, pinned_empty.id, true).unwrap();
        let current = create_note(&c, &input("", "")).unwrap();

        let removed = purge_empty_notes(&c, Some(current.id)).unwrap();
        assert_eq!(removed, 2, "leer und nur Leerzeichen werden entfernt");
        assert!(get_note(&c, empty.id).is_err());
        assert!(get_note(&c, blank.id).is_err());
        for id in [keep_title.id, keep_text.id, pinned_empty.id, current.id] {
            assert!(get_note(&c, id).is_ok());
        }
        // Ohne Ausnahme verschwindet auch die aktuelle leere Notiz
        assert_eq!(purge_empty_notes(&c, None).unwrap(), 1);
    }
}
