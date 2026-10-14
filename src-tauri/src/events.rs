//! Kalender-Termine.
//!
//! Zeitangaben sind lokale Zeit im Format `YYYY-MM-DD HH:MM` und damit
//! lexikographisch sortier- und vergleichbar.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub location: String,
    pub starts_at: String,
    pub ends_at: String,
    pub all_day: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub location: String,
    pub starts_at: String,
    pub ends_at: String,
    #[serde(default)]
    pub all_day: bool,
}

const EVENT_COLUMNS: &str = "id, title, description, location, starts_at, ends_at, all_day";

fn row_to_event(row: &Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        location: row.get(3)?,
        starts_at: row.get(4)?,
        ends_at: row.get(5)?,
        all_day: row.get::<_, i64>(6)? != 0,
    })
}

fn is_datetime(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 16
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b' '
        && b[13] == b':'
        && b.iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7 | 10 | 13) || c.is_ascii_digit())
}

fn validate(input: &EventInput) -> Result<(), String> {
    if input.title.trim().is_empty() {
        return Err("Der Titel darf nicht leer sein.".into());
    }
    if !is_datetime(&input.starts_at) || !is_datetime(&input.ends_at) {
        return Err("Ungültiges Datumsformat (erwartet: YYYY-MM-DD HH:MM).".into());
    }
    if input.ends_at < input.starts_at {
        return Err("Das Ende muss nach dem Beginn liegen.".into());
    }
    Ok(())
}

/// Alle Termine, die den Zeitraum `[from, to)` überlappen.
pub fn list_events(conn: &Connection, from: &str, to: &str) -> Result<Vec<Event>, String> {
    let sql = format!(
        "SELECT {EVENT_COLUMNS} FROM events
         WHERE starts_at < ?2 AND ends_at > ?1
         ORDER BY starts_at, id"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from, to], row_to_event)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn get_event(conn: &Connection, id: i64) -> Result<Event, String> {
    conn.query_row(
        &format!("SELECT {EVENT_COLUMNS} FROM events WHERE id = ?1"),
        params![id],
        row_to_event,
    )
    .map_err(|e| e.to_string())
}

pub fn create_event(conn: &Connection, input: &EventInput) -> Result<Event, String> {
    validate(input)?;
    conn.execute(
        "INSERT INTO events (title, description, location, starts_at, ends_at, all_day)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.title.trim(),
            input.description,
            input.location,
            input.starts_at,
            input.ends_at,
            input.all_day as i64
        ],
    )
    .map_err(|e| e.to_string())?;
    get_event(conn, conn.last_insert_rowid())
}

pub fn update_event(conn: &Connection, id: i64, input: &EventInput) -> Result<Event, String> {
    validate(input)?;
    let changed = conn
        .execute(
            "UPDATE events
             SET title = ?1, description = ?2, location = ?3,
                 starts_at = ?4, ends_at = ?5, all_day = ?6, updated_at = datetime('now')
             WHERE id = ?7",
            params![
                input.title.trim(),
                input.description,
                input.location,
                input.starts_at,
                input.ends_at,
                input.all_day as i64,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Termin nicht gefunden.".into());
    }
    get_event(conn, id)
}

pub fn delete_event(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM events WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Termin nicht gefunden.".into());
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

    fn input(title: &str, start: &str, end: &str) -> EventInput {
        EventInput {
            title: title.into(),
            description: String::new(),
            location: String::new(),
            starts_at: start.into(),
            ends_at: end.into(),
            all_day: false,
        }
    }
    #[test]
    fn crud_roundtrip() {
        let c = conn();
        let e = create_event(&c, &input("Meeting", "2026-10-14 09:00", "2026-10-14 10:00")).unwrap();
        assert_eq!(e.title, "Meeting");

        let updated = update_event(&c, e.id, &input("Meeting 2", "2026-10-14 11:00", "2026-10-14 12:00")).unwrap();
        assert_eq!(updated.title, "Meeting 2");
        assert_eq!(updated.starts_at, "2026-10-14 11:00");

        delete_event(&c, e.id).unwrap();
        assert!(get_event(&c, e.id).is_err());
        assert!(delete_event(&c, e.id).is_err());
    }

    #[test]
    fn list_returns_only_overlapping_events() {
        let c = conn();
        create_event(&c, &input("davor", "2026-10-13 09:00", "2026-10-13 10:00")).unwrap();
        create_event(&c, &input("im Bereich", "2026-10-14 09:00", "2026-10-14 10:00")).unwrap();
        create_event(&c, &input("über Mitternacht", "2026-10-14 23:00", "2026-10-15 01:00")).unwrap();
        create_event(&c, &input("danach", "2026-10-16 00:00", "2026-10-16 01:00")).unwrap();

        let got = list_events(&c, "2026-10-14 00:00", "2026-10-16 00:00").unwrap();
        let titles: Vec<_> = got.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, ["im Bereich", "über Mitternacht"]);

        // Termin, der vor dem Bereich beginnt, aber hineinragt
        let got = list_events(&c, "2026-10-15 00:00", "2026-10-15 12:00").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "über Mitternacht");
    }

    #[test]
    fn rejects_invalid_input() {
        let c = conn();
        assert!(create_event(&c, &input("  ", "2026-10-14 09:00", "2026-10-14 10:00")).is_err());
        assert!(create_event(&c, &input("x", "2026-10-14 10:00", "2026-10-14 09:00")).is_err());
        assert!(create_event(&c, &input("x", "14.10.2026", "14.10.2026")).is_err());
    }

}
