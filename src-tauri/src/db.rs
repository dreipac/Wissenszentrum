//! SQLite-Anbindung: Verbindung und Migrationen.
//!
//! Das Schema wird über `PRAGMA user_version` versioniert. Neue Tabellen oder
//! Änderungen kommen als neuer Eintrag ans Ende von `MIGRATIONS` – bestehende
//! Einträge nie ändern.

use rusqlite::Connection;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

pub(crate) const MIGRATIONS: &[&str] = &[
    // 1: Kalender-Termine
    "CREATE TABLE events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        location    TEXT    NOT NULL DEFAULT '',
        category    TEXT    NOT NULL DEFAULT 'work',
        starts_at   TEXT    NOT NULL,
        ends_at     TEXT    NOT NULL,
        all_day     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        CHECK (ends_at >= starts_at)
    );
    CREATE INDEX idx_events_starts_at ON events(starts_at);",
    // 2: Kalender-Kategorien entfernt (es gibt nur noch einen Kalender)
    "ALTER TABLE events DROP COLUMN category;",
    // 3: Aufgaben und Buckets (Bucket ist optional; wird ein Bucket gelöscht, bleiben die Aufgaben ohne Bucket erhalten)
    "CREATE TABLE buckets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE tasks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        bucket_id    INTEGER REFERENCES buckets(id) ON DELETE SET NULL,
        title        TEXT    NOT NULL,
        description  TEXT    NOT NULL DEFAULT '',
        priority     TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
        due_date     TEXT,
        done         INTEGER NOT NULL DEFAULT 0,
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
    );
    CREATE INDEX idx_tasks_bucket_id ON tasks(bucket_id);",
    // 4: Bucket-Regel – beim Abhaken einer Aufgabe automatisch in einen anderen Bucket verschieben (NULL = nichts tun)
    "ALTER TABLE buckets ADD COLUMN on_complete_bucket_id INTEGER REFERENCES buckets(id) ON DELETE SET NULL;",
    // 5: Zwischenschritte einer Aufgabe (werden mit der Aufgabe gelöscht)
    "CREATE TABLE subtasks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title    TEXT    NOT NULL,
        done     INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_subtasks_task_id ON subtasks(task_id);",
];

/// Öffnet die Verbindung vor, setzt Pragmas und führt offene Migrationen aus.
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.pragma_update(None, "foreign_keys", true)?;
    // WAL ist bei In-Memory-Datenbanken nicht verfügbar; Fehler dort ignorieren.
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    migrate(conn)
}

pub(crate) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{create_event, list_events, EventInput};

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init(&c).unwrap();
        c
    }

    #[test]
    fn migrations_are_idempotent() {
        let c = conn();
        migrate(&c).unwrap();
        let v: usize = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, MIGRATIONS.len());
    }

    #[test]
    fn migration_4_keeps_buckets_and_tasks() {
        // Stand von Migration 3 mit Daten, dann auf aktuell migrieren
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &MIGRATIONS[..3] {
            c.execute_batch(sql).unwrap();
        }
        c.pragma_update(None, "user_version", 3i64).unwrap();
        c.execute("INSERT INTO buckets (name) VALUES ('Backlog')", []).unwrap();
        c.execute("INSERT INTO tasks (bucket_id, title) VALUES (1, 'Alt')", []).unwrap();

        migrate(&c).unwrap();

        let buckets = crate::tasks::list_buckets(&c).unwrap();
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].on_complete_bucket_id, None, "bestehende Buckets haben keine Regel");
        let tasks = crate::tasks::list_tasks(&c).unwrap();
        assert_eq!(tasks[0].title, "Alt");
    }

    #[test]
    fn migration_5_keeps_tasks_and_adds_subtasks() {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &MIGRATIONS[..4] {
            c.execute_batch(sql).unwrap();
        }
        c.pragma_update(None, "user_version", 4i64).unwrap();
        c.execute("INSERT INTO tasks (title) VALUES ('Alt')", []).unwrap();

        migrate(&c).unwrap();

        let tasks = crate::tasks::list_tasks(&c).unwrap();
        assert_eq!(tasks.len(), 1);
        assert!(tasks[0].subtasks.is_empty());
    }

    #[test]
    fn migration_2_keeps_existing_events() {
        // Datenbank im Stand von Migration 1 (mit Kategorie) anlegen, dann auf aktuell migrieren
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(MIGRATIONS[0]).unwrap();
        c.pragma_update(None, "user_version", 1i64).unwrap();
        c.execute(
            "INSERT INTO events (title, category, starts_at, ends_at) VALUES ('Alt', 'clients', '2026-10-14 09:00', '2026-10-14 10:00')",
            [],
        )
        .unwrap();

        migrate(&c).unwrap();

        let got = list_events(&c, "2026-10-14 00:00", "2026-10-15 00:00").unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "Alt");

        // Neue Termine funktionieren auch nach der Migration
        let input = EventInput {
            title: "Neu".into(),
            description: String::new(),
            location: String::new(),
            starts_at: "2026-10-15 09:00".into(),
            ends_at: "2026-10-15 10:00".into(),
            all_day: false,
        };
        create_event(&c, &input).unwrap();
    }
}
