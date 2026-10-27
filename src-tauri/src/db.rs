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
    // 6: Pro Aufgabe einstellbar, ob die Zwischenschritte auf der Karte im Board angezeigt werden (0 = nein)
    "ALTER TABLE tasks ADD COLUMN show_subtasks INTEGER NOT NULL DEFAULT 0;",
    // 7: Notizen (content = HTML des Editors, plain = Text für Vorschau/Suche, folder leer = ohne Ordner)
    "CREATE TABLE notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT    NOT NULL DEFAULT '',
        content    TEXT    NOT NULL DEFAULT '',
        plain      TEXT    NOT NULL DEFAULT '',
        folder     TEXT    NOT NULL DEFAULT '',
        pinned     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_notes_updated_at ON notes(updated_at);",
    // 8: Trading – Positionen mit Ausführungen, Guthaben, Edelmetalle, Kurse, Schnappschüsse und Einstellungen
    "CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE cash_movements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        kind        TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
        amount      REAL NOT NULL CHECK (amount > 0),
        note        TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE trades (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol           TEXT NOT NULL,
        name             TEXT NOT NULL,
        asset_class      TEXT NOT NULL CHECK (asset_class IN ('aktie', 'krypto')),
        currency         TEXT NOT NULL DEFAULT 'CHF',
        fx_rate          REAL NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
        status           TEXT NOT NULL CHECK (status IN ('order', 'open', 'closed')),
        stop_loss        REAL,
        target           REAL,
        thesis           TEXT NOT NULL DEFAULT '',
        close_note       TEXT NOT NULL DEFAULT '',
        planned_quantity REAL,
        planned_price    REAL,
        valid_until      TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at        TEXT
    );
    CREATE INDEX idx_trades_status ON trades(status);
    CREATE TABLE trade_executions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id    INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL CHECK (kind IN ('buy', 'sell')),
        quantity    REAL NOT NULL CHECK (quantity > 0),
        price       REAL NOT NULL CHECK (price > 0),
        fee         REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
        executed_at TEXT NOT NULL
    );
    CREATE INDEX idx_trade_executions_trade_id ON trade_executions(trade_id);
    CREATE TABLE metals (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL,
        metal           TEXT NOT NULL CHECK (metal IN ('gold', 'silber', 'platin', 'palladium')),
        quantity        REAL NOT NULL CHECK (quantity > 0),
        unit            TEXT NOT NULL CHECK (unit IN ('g', 'kg', 'oz')),
        cost_chf        REAL,
        spot_chf_per_oz REAL,
        spot_updated_at TEXT,
        note            TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE quotes (
        symbol     TEXT PRIMARY KEY,
        price      REAL NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE portfolio_snapshots (
        day       TEXT PRIMARY KEY,
        value_chf REAL NOT NULL
    );",
    // 9: Strategien als Graph aus Knoten und gerichteten Verbindungen
    "CREATE TABLE strategies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        title      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE strategy_nodes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('company', 'event', 'assumption', 'reaction', 'risk')),
        text        TEXT NOT NULL DEFAULT '',
        symbol      TEXT NOT NULL DEFAULT '',
        x           REAL NOT NULL DEFAULT 0,
        y           REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_strategy_nodes_strategy_id ON strategy_nodes(strategy_id);
    CREATE TABLE strategy_edges (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
        from_node   INTEGER NOT NULL REFERENCES strategy_nodes(id) ON DELETE CASCADE,
        to_node     INTEGER NOT NULL REFERENCES strategy_nodes(id) ON DELETE CASCADE,
        label       TEXT NOT NULL DEFAULT '',
        polarity    TEXT NOT NULL CHECK (polarity IN ('positive', 'negative')),
        UNIQUE (from_node, to_node),
        CHECK (from_node <> to_node)
    );
    CREATE INDEX idx_strategy_edges_strategy_id ON strategy_edges(strategy_id);",
    // 10: Dokumentation als Baum aus Seiten (Wiki)
    "CREATE TABLE doc_pages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id  INTEGER REFERENCES doc_pages(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT '',
        content    TEXT NOT NULL DEFAULT '',
        plain      TEXT NOT NULL DEFAULT '',
        position   INTEGER NOT NULL DEFAULT 0,
        favorite   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_doc_pages_parent_id ON doc_pages(parent_id);",
    // 11: Ordner in der Dokumentation (Einträge sind Seiten oder Ordner)
    "ALTER TABLE doc_pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page' CHECK (kind IN ('page', 'folder'));",
    // 12: Zwischenstände des Gesamtvermögens im Tagesverlauf (Zeit in UTC, Wert in CHF)
    "CREATE TABLE portfolio_samples (
        ts        TEXT PRIMARY KEY,
        value_chf REAL NOT NULL
    );",
    // 13: Farbe der Buckets (Schlüssel aus einer festen Palette, leer = keine Farbe)
    "ALTER TABLE buckets ADD COLUMN color TEXT NOT NULL DEFAULT '';",
    // 14: Beginn von Aufgaben für den Zeitplan (Datum YYYY-MM-DD, leer = nur Fälligkeit)
    "ALTER TABLE tasks ADD COLUMN start_date TEXT;",
    // 15: Bilder der Dokumentation (die Seiten verweisen per ID darauf)
    "CREATE TABLE doc_images (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        mime       TEXT NOT NULL,
        data       BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    // 16: Logbuch zu Positionen (Beobachtungen, Fehler, „besser machen“; optional einer Strategie zugeordnet)
    "CREATE TABLE trade_journal (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id    INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        strategy_id INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('observation', 'mistake', 'improve', 'good')),
        topic       TEXT NOT NULL DEFAULT '',
        text        TEXT NOT NULL,
        next_time   TEXT NOT NULL DEFAULT '',
        price       REAL,
        pnl_pct     REAL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_trade_journal_trade_id ON trade_journal(trade_id);
    CREATE INDEX idx_trade_journal_strategy_id ON trade_journal(strategy_id);",
    // 17: Dateianhänge in Notizen und Dokumentation (Text verweist per data-file-id darauf)
    "CREATE TABLE attachments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
        size       INTEGER NOT NULL,
        data       BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );",
    // 18: Pro Aufgabe einstellbar, ob die Notiz (Beschreibung) auf der Karte im Board steht. Bestehende Aufgaben mit
    // Notiz behalten ihre bisherige Anzeige, neue starten ohne.
    "ALTER TABLE tasks ADD COLUMN show_description INTEGER NOT NULL DEFAULT 0;
    UPDATE tasks SET show_description = 1 WHERE TRIM(description) <> '';",
    // 19: Aufgaben können an einen Termin gehängt werden. `event_offset` ist der Abstand in Tagen (negativ = davor,
    // 0 = am Tag, positiv = danach); das Fälligkeitsdatum leitet sich daraus ab und zieht mit dem Termin mit.
    // Wird der Termin gelöscht, bleibt die Aufgabe mit ihrem letzten Datum bestehen.
    "ALTER TABLE tasks ADD COLUMN event_id INTEGER REFERENCES events(id) ON DELETE SET NULL;
    ALTER TABLE tasks ADD COLUMN event_offset INTEGER;
    CREATE INDEX idx_tasks_event_id ON tasks(event_id);",
    // 20: Projekte des Assistenten: ein fester Kontext (Ordner oder Seite der Dokumentation, Hinweise) für Gespräche.
    // Wird die Seite gelöscht, bleibt das Projekt ohne Zuordnung bestehen.
    "CREATE TABLE assistant_projects (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        doc_id       INTEGER REFERENCES doc_pages(id) ON DELETE SET NULL,
        instructions TEXT NOT NULL DEFAULT '',
        position     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );",
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
    fn migration_11_marks_existing_doc_entries_as_pages() {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &MIGRATIONS[..10] {
            c.execute_batch(sql).unwrap();
        }
        c.pragma_update(None, "user_version", 10i64).unwrap();
        c.execute("INSERT INTO doc_pages (title, content) VALUES ('Alt', '<p>x</p>')", []).unwrap();

        migrate(&c).unwrap();

        let pages = crate::docs::list_pages(&c).unwrap();
        assert_eq!((pages[0].title.as_str(), pages[0].kind.as_str(), pages[0].content.as_str()), ("Alt", "page", "<p>x</p>"));
        assert!(c.execute("INSERT INTO doc_pages (title, kind) VALUES ('X', 'kaputt')", []).is_err(), "ungültige Art wird abgelehnt");
    }

    #[test]
    fn migration_18_keeps_showing_existing_notes_on_cards() {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &MIGRATIONS[..17] {
            c.execute_batch(sql).unwrap();
        }
        c.pragma_update(None, "user_version", 17i64).unwrap();
        c.execute("INSERT INTO tasks (title, description, priority, position) VALUES ('Mit Notiz', 'Wichtig', 'medium', 0)", []).unwrap();
        c.execute("INSERT INTO tasks (title, description, priority, position) VALUES ('Ohne Notiz', '  ', 'medium', 1)", []).unwrap();

        migrate(&c).unwrap();

        let tasks = crate::tasks::list_tasks(&c).unwrap();
        let by_title = |t: &str| tasks.iter().find(|x| x.title == t).unwrap().show_description;
        assert!(by_title("Mit Notiz"), "bisher sichtbare Notizen bleiben sichtbar");
        assert!(!by_title("Ohne Notiz"));
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
    fn migration_6_keeps_tasks_and_hides_subtasks_by_default() {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &MIGRATIONS[..5] {
            c.execute_batch(sql).unwrap();
        }
        c.pragma_update(None, "user_version", 5i64).unwrap();
        c.execute("INSERT INTO tasks (title) VALUES ('Alt')", []).unwrap();
        c.execute("INSERT INTO subtasks (task_id, title) VALUES (1, 'Schritt')", []).unwrap();

        migrate(&c).unwrap();

        let tasks = crate::tasks::list_tasks(&c).unwrap();
        assert_eq!(tasks.len(), 1);
        assert!(!tasks[0].show_subtasks, "bestehende Aufgaben zeigen ihre Zwischenschritte nicht auf der Karte");
        assert_eq!(tasks[0].subtasks.len(), 1);
    }

    #[test]
    fn migration_7_adds_notes_without_touching_existing_data() {
        let c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &MIGRATIONS[..6] {
            c.execute_batch(sql).unwrap();
        }
        c.pragma_update(None, "user_version", 6i64).unwrap();
        c.execute("INSERT INTO tasks (title) VALUES ('Alt')", []).unwrap();

        migrate(&c).unwrap();

        assert_eq!(crate::tasks::list_tasks(&c).unwrap().len(), 1);
        assert!(crate::notes::list_notes(&c).unwrap().is_empty());
    }

    #[test]
    fn migration_8_adds_trading_tables() {
        let c = conn();
        for table in ["settings", "cash_movements", "trades", "trade_executions", "metals", "quotes", "portfolio_snapshots"] {
            let n: i64 = c
                .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "Tabelle {table} fehlt");
        }
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
