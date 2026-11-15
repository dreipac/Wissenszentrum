//! Gespeicherte Chats des Assistenten.
//!
//! Die Chats liegen in einer eigenen Datei im lokalen Datenordner dieses Rechners (`assistent-chats.db`), nicht in der
//! Datenbank mit Aufgaben und Dokumentation. So geraten sie nie in den Abgleich zwischen Rechnern: der kopiert die ganze
//! Datenbank, und jede Antwort des Assistenten hätte sonst Konflikte ausgelöst oder Chats des anderen Rechners überschrieben.
//!
//! Ein Chat gehört zu einem Projekt (`project_id`) oder zu keinem. Das Projekt selbst liegt in der Hauptdatenbank; wird es
//! gelöscht, bleibt der Chat bestehen und gilt als Chat ohne Projekt (die Oberfläche prüft das).
//! Die Nachrichten speichert die Oberfläche als Ganzes (`payload`, JSON: Text, Dateien, Karten mit ihrem Stand); `text`
//! daneben dient der Suche und dem Titel. Die Nachrichten eines Chats sind über `seq` geordnet und werden bei Änderungen
//! (zum Beispiel wenn eine Karte bestätigt wird) überschrieben.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

pub struct ChatDb(pub Mutex<Connection>);

pub const FILE_NAME: &str = "assistent-chats.db";

const MAX_TITLE: usize = 120;
/// So lang darf der aus der ersten Frage abgeleitete Titel höchstens sein
const AUTO_TITLE: usize = 60;
const MAX_PAYLOAD_BYTES: usize = 8_000_000;
const MAX_HITS: usize = 40;

const MIGRATIONS: &[&str] = &[
    // 1: Chats und ihre Nachrichten
    "CREATE TABLE chats (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        title      TEXT NOT NULL DEFAULT '',
        pinned     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_chats_project_id ON chats(project_id);
    CREATE INDEX idx_chats_updated_at ON chats(updated_at);
    CREATE TABLE messages (
        chat_id    INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        seq        INTEGER NOT NULL,
        role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text       TEXT NOT NULL DEFAULT '',
        payload    TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (chat_id, seq)
    );",
];

/// Öffnet die Chat-Datenbank und führt offene Migrationen aus.
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", true)?;
    // WAL ist bei In-Memory-Datenbanken nicht verfügbar; Fehler dort ignorieren
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInfo {
    pub id: i64,
    pub project_id: Option<i64>,
    pub title: String,
    pub pinned: bool,
    /// UTC, `YYYY-MM-DD HH:MM:SS`
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    /// Anfang der letzten Nachricht, für die Liste
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StoredMessage {
    pub seq: i64,
    pub role: String,
    /// Die ganze Nachricht als JSON, wie die Oberfläche sie gespeichert hat
    pub payload: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatHit {
    pub chat_id: i64,
    pub title: String,
    pub snippet: String,
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn lock<'a>(db: &'a State<'_, ChatDb>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    db.0.lock().map_err(|_| "Die Chat-Datenbank ist gesperrt.".to_string())
}

fn clean_title(title: &str) -> Result<String, String> {
    let title: String = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err("Der Titel darf nicht leer sein.".into());
    }
    if title.chars().count() > MAX_TITLE {
        return Err(format!("Der Titel darf höchstens {MAX_TITLE} Zeichen lang sein."));
    }
    Ok(title)
}

/// Titel aus der ersten Frage: die erste Zeile, gekürzt.
fn title_from(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let line: String = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= AUTO_TITLE {
        return line;
    }
    let cut: String = line.chars().take(AUTO_TITLE).collect();
    format!("{}…", cut.trim_end())
}

const INFO_COLUMNS: &str = "c.id, c.project_id, c.title, c.pinned, c.created_at, c.updated_at,
    (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id),
    COALESCE((SELECT substr(m.text, 1, 160) FROM messages m WHERE m.chat_id = c.id ORDER BY m.seq DESC LIMIT 1), '')";

fn row_to_info(r: &rusqlite::Row) -> rusqlite::Result<ChatInfo> {
    Ok(ChatInfo {
        id: r.get(0)?,
        project_id: r.get(1)?,
        title: r.get(2)?,
        pinned: r.get::<_, i64>(3)? != 0,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
        message_count: r.get(6)?,
        preview: r.get(7)?,
    })
}

pub fn get_info(conn: &Connection, id: i64) -> Result<ChatInfo, String> {
    conn.query_row(&format!("SELECT {INFO_COLUMNS} FROM chats c WHERE c.id = ?1"), params![id], row_to_info)
        .map_err(|_| "Chat nicht gefunden.".to_string())
}

/// Alle Chats: angeheftete zuerst, danach die zuletzt benutzten.
pub fn list(conn: &Connection) -> Result<Vec<ChatInfo>, String> {
    let sql = format!("SELECT {INFO_COLUMNS} FROM chats c ORDER BY c.pinned DESC, c.updated_at DESC, c.id DESC");
    let mut stmt = conn.prepare(&sql).map_err(db_err)?;
    let rows = stmt.query_map([], row_to_info).map_err(db_err)?;
    rows.collect::<Result<_, _>>().map_err(db_err)
}

/// Legt einen Chat an. Ohne Titel entsteht er aus der ersten Frage.
pub fn create(conn: &Connection, project_id: Option<i64>, title: &str) -> Result<ChatInfo, String> {
    let title = if title.trim().is_empty() { String::new() } else { clean_title(title)? };
    conn.execute("INSERT INTO chats (project_id, title) VALUES (?1, ?2)", params![project_id, title]).map_err(db_err)?;
    get_info(conn, conn.last_insert_rowid())
}

fn changed(n: usize) -> Result<(), String> {
    if n == 0 {
        Err("Chat nicht gefunden.".into())
    } else {
        Ok(())
    }
}

pub fn rename(conn: &Connection, id: i64, title: &str) -> Result<(), String> {
    let title = clean_title(title)?;
    changed(conn.execute("UPDATE chats SET title = ?1 WHERE id = ?2", params![title, id]).map_err(db_err)?)
}

/// Anheften ändert nicht, wann der Chat zuletzt benutzt wurde.
pub fn set_pinned(conn: &Connection, id: i64, pinned: bool) -> Result<(), String> {
    changed(conn.execute("UPDATE chats SET pinned = ?1 WHERE id = ?2", params![pinned as i64, id]).map_err(db_err)?)
}

/// Verschiebt den Chat in ein Projekt (None = Chat ohne Projekt).
pub fn move_to(conn: &Connection, id: i64, project_id: Option<i64>) -> Result<(), String> {
    changed(conn.execute("UPDATE chats SET project_id = ?1 WHERE id = ?2", params![project_id, id]).map_err(db_err)?)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), String> {
    changed(conn.execute("DELETE FROM chats WHERE id = ?1", params![id]).map_err(db_err)?)
}

pub fn messages(conn: &Connection, chat_id: i64) -> Result<Vec<StoredMessage>, String> {
    get_info(conn, chat_id)?;
    let mut stmt = conn.prepare("SELECT seq, role, payload FROM messages WHERE chat_id = ?1 ORDER BY seq").map_err(db_err)?;
    let rows = stmt.query_map(params![chat_id], |r| Ok(StoredMessage { seq: r.get(0)?, role: r.get(1)?, payload: r.get(2)? })).map_err(db_err)?;
    rows.collect::<Result<_, _>>().map_err(db_err)
}

/// Speichert eine Nachricht oder überschreibt sie (gleiche `seq`). Die erste Frage eines Chats ohne Titel wird sein Titel.
pub fn save_message(conn: &Connection, chat_id: i64, seq: i64, role: &str, text: &str, payload: &str) -> Result<(), String> {
    if role != "user" && role != "assistant" {
        return Err("Unbekannte Rolle.".into());
    }
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("Die Nachricht ist zu groß zum Speichern.".into());
    }
    let info = get_info(conn, chat_id)?;
    conn.execute(
        "INSERT INTO messages (chat_id, seq, role, text, payload) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(chat_id, seq) DO UPDATE SET role = excluded.role, text = excluded.text, payload = excluded.payload",
        params![chat_id, seq, role, text, payload],
    )
    .map_err(db_err)?;
    let title = if info.title.is_empty() && role == "user" { title_from(text) } else { info.title };
    conn.execute("UPDATE chats SET title = ?1, updated_at = datetime('now') WHERE id = ?2", params![title, chat_id]).map_err(db_err)?;
    Ok(())
}

/// Entfernt die Nachrichten ab `seq` (zum Beispiel beim Neustellen einer Antwort).
pub fn delete_from(conn: &Connection, chat_id: i64, seq: i64) -> Result<(), String> {
    conn.execute("DELETE FROM messages WHERE chat_id = ?1 AND seq >= ?2", params![chat_id, seq]).map_err(db_err)?;
    Ok(())
}

fn fold(s: &str) -> String {
    s.to_lowercase()
}

/// Ein Stück Text um die Fundstelle herum.
fn snippet_around(text: &str, needle: &str) -> String {
    let flat: Vec<char> = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    let lower: Vec<char> = fold(&flat.iter().collect::<String>()).chars().collect();
    let n: Vec<char> = needle.chars().collect();
    let at = if n.is_empty() || lower.len() != flat.len() { None } else { (0..lower.len().saturating_sub(n.len() - 1)).find(|&i| lower[i..i + n.len()] == n[..]) };
    let from = at.map(|a| a.saturating_sub(40)).unwrap_or(0);
    let to = (from + 120).min(flat.len());
    let body: String = flat[from..to].iter().collect();
    format!("{}{}{}", if from > 0 { "…" } else { "" }, body, if to < flat.len() { "…" } else { "" })
}

/// Sucht in Titeln und Nachrichten aller Chats. Groß- und Kleinschreibung ist egal, alle Wörter müssen vorkommen.
pub fn search(conn: &Connection, query: &str) -> Result<Vec<ChatHit>, String> {
    let terms: Vec<String> = fold(query).split_whitespace().map(str::to_string).collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let matches_all = |text: &str| {
        let t = fold(text);
        terms.iter().all(|w| t.contains(w.as_str()))
    };
    let mut hits: Vec<ChatHit> = Vec::new();
    let mut stmt = conn
        .prepare("SELECT c.id, c.title, COALESCE(GROUP_CONCAT(m.text, ' '), '') FROM chats c LEFT JOIN messages m ON m.chat_id = c.id GROUP BY c.id ORDER BY c.pinned DESC, c.updated_at DESC, c.id DESC")
        .map_err(db_err)?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(db_err)?;
    for row in rows {
        let (chat_id, title, body) = row.map_err(db_err)?;
        if matches_all(&format!("{title} {body}")) {
            let snippet = if matches_all(&body) { snippet_around(&body, &terms[0]) } else { String::new() };
            hits.push(ChatHit { chat_id, title, snippet });
            if hits.len() >= MAX_HITS {
                break;
            }
        }
    }
    Ok(hits)
}

/// Wie viele Chats es gibt (für Tests und Hinweise).
pub fn count(conn: &Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM chats", [], |r| r.get(0)).optional().map_err(db_err).map(|c| c.unwrap_or(0))
}

// --- Befehle ------------------------------------------------------------------------------------

#[tauri::command]
pub fn list_chats(db: State<ChatDb>) -> Result<Vec<ChatInfo>, String> {
    let conn = lock(&db)?;
    list(&conn)
}

#[tauri::command]
pub fn create_chat(db: State<ChatDb>, project_id: Option<i64>, title: String) -> Result<ChatInfo, String> {
    let conn = lock(&db)?;
    create(&conn, project_id, &title)
}

#[tauri::command]
pub fn rename_chat(db: State<ChatDb>, id: i64, title: String) -> Result<(), String> {
    let conn = lock(&db)?;
    rename(&conn, id, &title)
}

#[tauri::command]
pub fn pin_chat(db: State<ChatDb>, id: i64, pinned: bool) -> Result<(), String> {
    let conn = lock(&db)?;
    set_pinned(&conn, id, pinned)
}

#[tauri::command]
pub fn move_chat(db: State<ChatDb>, id: i64, project_id: Option<i64>) -> Result<(), String> {
    let conn = lock(&db)?;
    move_to(&conn, id, project_id)
}

#[tauri::command]
pub fn delete_chat(db: State<ChatDb>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    delete(&conn, id)
}

#[tauri::command]
pub fn load_chat(db: State<ChatDb>, id: i64) -> Result<Vec<StoredMessage>, String> {
    let conn = lock(&db)?;
    messages(&conn, id)
}

#[tauri::command]
pub fn save_chat_message(db: State<ChatDb>, chat_id: i64, seq: i64, role: String, text: String, payload: String) -> Result<(), String> {
    let conn = lock(&db)?;
    save_message(&conn, chat_id, seq, &role, &text, &payload)
}

#[tauri::command]
pub fn delete_chat_messages_from(db: State<ChatDb>, chat_id: i64, seq: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    delete_from(&conn, chat_id, seq)
}

#[tauri::command]
pub fn search_chats(db: State<ChatDb>, query: String) -> Result<Vec<ChatHit>, String> {
    let conn = lock(&db)?;
    search(&conn, &query)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        c
    }

    #[test]
    fn the_first_question_becomes_the_title_and_the_chat_counts_its_messages() {
        let c = conn();
        let chat = create(&c, None, "").unwrap();
        assert_eq!((chat.title.as_str(), chat.message_count, chat.preview.as_str()), ("", 0, ""));

        save_message(&c, chat.id, 1, "user", "  Was steht heute an?\nNoch eine Zeile", "{}").unwrap();
        save_message(&c, chat.id, 2, "assistant", "Heute ist ein Termin.", "{}").unwrap();
        let info = get_info(&c, chat.id).unwrap();
        assert_eq!(info.title, "Was steht heute an?");
        assert_eq!((info.message_count, info.preview.as_str()), (2, "Heute ist ein Termin."));

        // Eine spätere Frage ändert den Titel nicht, ein eigener Titel bleibt
        save_message(&c, chat.id, 3, "user", "Ganz etwas anderes", "{}").unwrap();
        assert_eq!(get_info(&c, chat.id).unwrap().title, "Was steht heute an?");
        let named = create(&c, Some(4), "  Mein   Projektchat ").unwrap();
        assert_eq!((named.title.as_str(), named.project_id), ("Mein Projektchat", Some(4)));
        save_message(&c, named.id, 1, "user", "Frage", "{}").unwrap();
        assert_eq!(get_info(&c, named.id).unwrap().title, "Mein Projektchat");

        let long = "Wort ".repeat(30);
        let chat = create(&c, None, "").unwrap();
        save_message(&c, chat.id, 1, "user", &long, "{}").unwrap();
        let title = get_info(&c, chat.id).unwrap().title;
        assert!(title.ends_with('…') && title.chars().count() <= AUTO_TITLE + 1, "{title}");
    }

    #[test]
    fn a_message_is_overwritten_by_its_number_and_comes_back_in_order() {
        let c = conn();
        let chat = create(&c, None, "").unwrap();
        save_message(&c, chat.id, 2, "assistant", "zweite", r#"{"a":2}"#).unwrap();
        save_message(&c, chat.id, 1, "user", "erste", r#"{"a":1}"#).unwrap();
        save_message(&c, chat.id, 2, "assistant", "zweite, neu", r#"{"a":22}"#).unwrap();
        let list = messages(&c, chat.id).unwrap();
        assert_eq!(list.iter().map(|m| (m.seq, m.role.as_str(), m.payload.as_str())).collect::<Vec<_>>(), [(1, "user", r#"{"a":1}"#), (2, "assistant", r#"{"a":22}"#)]);
        assert_eq!(get_info(&c, chat.id).unwrap().message_count, 2);

        delete_from(&c, chat.id, 2).unwrap();
        assert_eq!(messages(&c, chat.id).unwrap().len(), 1);

        assert!(save_message(&c, 999, 1, "user", "x", "{}").is_err(), "unbekannter Chat");
        assert!(save_message(&c, chat.id, 5, "system", "x", "{}").is_err(), "unbekannte Rolle");
        assert!(save_message(&c, chat.id, 5, "user", "x", &"x".repeat(MAX_PAYLOAD_BYTES + 1)).is_err(), "zu groß");
        assert!(messages(&c, 999).is_err());
    }

    #[test]
    fn the_list_puts_pinned_chats_first_then_the_most_recent() {
        let c = conn();
        let a = create(&c, None, "Alt").unwrap();
        let b = create(&c, None, "Neu").unwrap();
        let p = create(&c, None, "Angeheftet").unwrap();
        c.execute("UPDATE chats SET updated_at = '2026-01-01 10:00:00' WHERE id = ?1", [a.id]).unwrap();
        c.execute("UPDATE chats SET updated_at = '2026-02-01 10:00:00' WHERE id = ?1", [b.id]).unwrap();
        c.execute("UPDATE chats SET updated_at = '2025-01-01 10:00:00' WHERE id = ?1", [p.id]).unwrap();
        set_pinned(&c, p.id, true).unwrap();
        let titles: Vec<String> = list(&c).unwrap().into_iter().map(|i| i.title).collect();
        assert_eq!(titles, ["Angeheftet", "Neu", "Alt"]);
        assert_eq!(get_info(&c, p.id).unwrap().updated_at, "2025-01-01 10:00:00", "Anheften zählt nicht als Benutzung");

        // Eine neue Nachricht holt den Chat nach vorn
        save_message(&c, a.id, 1, "user", "Hallo", "{}").unwrap();
        let titles: Vec<String> = list(&c).unwrap().into_iter().map(|i| i.title).collect();
        assert_eq!(titles, ["Angeheftet", "Alt", "Neu"]);
    }

    #[test]
    fn chats_are_renamed_moved_and_deleted_with_their_messages() {
        let c = conn();
        let chat = create(&c, None, "Eins").unwrap();
        save_message(&c, chat.id, 1, "user", "Hallo", "{}").unwrap();
        rename(&c, chat.id, "  Zwei  ").unwrap();
        assert_eq!(get_info(&c, chat.id).unwrap().title, "Zwei");
        assert!(rename(&c, chat.id, "   ").is_err() && rename(&c, 999, "x").is_err());
        assert!(rename(&c, chat.id, &"x".repeat(MAX_TITLE + 1)).is_err());

        move_to(&c, chat.id, Some(7)).unwrap();
        assert_eq!(get_info(&c, chat.id).unwrap().project_id, Some(7));
        move_to(&c, chat.id, None).unwrap();
        assert_eq!(get_info(&c, chat.id).unwrap().project_id, None);

        delete(&c, chat.id).unwrap();
        assert_eq!(count(&c).unwrap(), 0);
        let rest: i64 = c.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0)).unwrap();
        assert_eq!(rest, 0, "die Nachrichten gehen mit dem Chat");
        assert!(delete(&c, chat.id).is_err());
    }

    #[test]
    fn the_search_finds_titles_and_messages_ignoring_case_and_umlauts() {
        let c = conn();
        let a = create(&c, None, "Dossier Weltgeschehen").unwrap();
        save_message(&c, a.id, 1, "user", "Wie ist die Lage in der Schweiz?", "{}").unwrap();
        save_message(&c, a.id, 2, "assistant", "Die Neutralität der Schweiz ist ein Grundsatz.", "{}").unwrap();
        let b = create(&c, None, "").unwrap();
        save_message(&c, b.id, 1, "user", "Übersicht über meine Aufgaben", "{}").unwrap();

        let ids = |q: &str| search(&c, q).unwrap().into_iter().map(|h| h.chat_id).collect::<Vec<_>>();
        assert_eq!(ids("neutralität"), [a.id], "Text einer Antwort");
        assert_eq!(ids("WELTGESCHEHEN"), [a.id], "Titel, Großschreibung egal");
        assert_eq!(ids("übersicht"), [b.id], "Umlaute werden mit gefunden");
        assert_eq!(ids("schweiz lage"), [a.id], "alle Wörter müssen vorkommen");
        assert!(ids("schweiz aufgaben").is_empty());
        assert!(ids("   ").is_empty());
        let hit = &search(&c, "neutralität").unwrap()[0];
        assert!(hit.snippet.contains("Neutralität"), "{}", hit.snippet);
    }
}
