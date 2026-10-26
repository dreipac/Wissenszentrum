//! Aufgaben und Buckets.
//!
//! Ein Bucket ist eine optionale Gruppierung: Aufgaben ohne Bucket sind erlaubt.
//! Ein Bucket kann eine Regel haben: Wird eine Aufgabe in ihm abgehakt, wandert sie
//! automatisch in einen anderen Bucket (`on_complete_bucket_id`).

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const PRIORITIES: &[&str] = &["high", "medium", "low"];
const MAX_BUCKET_NAME: usize = 60;
const MAX_SUBTASKS: usize = 100;
/// Größter erlaubter Abstand einer Aufgabe zu ihrem Termin in Tagen (davor wie danach)
const MAX_EVENT_OFFSET: i64 = 365;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub id: i64,
    pub name: String,
    /// Ziel-Bucket, in den abgehakte Aufgaben automatisch verschoben werden (None = nichts tun)
    pub on_complete_bucket_id: Option<i64>,
    /// Farbschlüssel aus `BUCKET_COLORS`, leer = keine Farbe
    pub color: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketInput {
    pub name: String,
    #[serde(default)]
    pub on_complete_bucket_id: Option<i64>,
    #[serde(default)]
    pub color: String,
}

/// Erlaubte Farben der Buckets; die Darstellung legt das Frontend fest.
const BUCKET_COLORS: [&str; 8] = ["blue", "green", "amber", "red", "purple", "pink", "teal", "gray"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: i64,
    pub title: String,
    pub done: bool,
}

/// Zwischenschritt beim Speichern: mit `id` wird ein bestehender aktualisiert, ohne `id` ein neuer angelegt.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskInput {
    #[serde(default)]
    pub id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub bucket_id: Option<i64>,
    pub title: String,
    pub description: String,
    pub priority: String,
    /// Fälligkeitsdatum als `YYYY-MM-DD`
    pub due_date: Option<String>,
    /// Beginn als `YYYY-MM-DD`; zusammen mit der Fälligkeit ergibt das den Balken im Zeitplan
    pub start_date: Option<String>,
    pub done: bool,
    /// Zwischenschritte auch auf der Karte im Board anzeigen
    pub show_subtasks: bool,
    /// Notiz (Beschreibung) auch auf der Karte im Board anzeigen
    pub show_description: bool,
    /// Termin, an dem die Aufgabe hängt; das Fälligkeitsdatum richtet sich dann nach ihm
    pub event_id: Option<i64>,
    /// Abstand zum Termin in Tagen: negativ = davor, 0 = am Tag, positiv = danach (nach dem Ende des Termins)
    pub event_offset: Option<i64>,
    /// Titel und Beginn des Termins (Format YYYY-MM-DD HH:MM) zur Anzeige auf der Karte
    pub event_title: Option<String>,
    pub event_starts_at: Option<String>,
    pub event_ends_at: Option<String>,
    pub subtasks: Vec<Subtask>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    #[serde(default)]
    pub bucket_id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub priority: String,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub show_subtasks: bool,
    #[serde(default)]
    pub show_description: bool,
    #[serde(default)]
    pub event_id: Option<i64>,
    #[serde(default)]
    pub event_offset: Option<i64>,
    /// Vollständige Liste der Zwischenschritte in gewünschter Reihenfolge; fehlende werden gelöscht.
    #[serde(default)]
    pub subtasks: Vec<SubtaskInput>,
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

const BUCKET_COLUMNS: &str = "id, name, on_complete_bucket_id, color";

fn row_to_bucket(row: &Row) -> rusqlite::Result<Bucket> {
    Ok(Bucket {
        id: row.get(0)?,
        name: row.get(1)?,
        on_complete_bucket_id: row.get(2)?,
        color: row.get(3)?,
    })
}

pub fn list_buckets(conn: &Connection) -> Result<Vec<Bucket>, String> {
    let sql = format!("SELECT {BUCKET_COLUMNS} FROM buckets ORDER BY position, id");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_bucket).map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn get_bucket(conn: &Connection, id: i64) -> Result<Bucket, String> {
    conn.query_row(
        &format!("SELECT {BUCKET_COLUMNS} FROM buckets WHERE id = ?1"),
        params![id],
        row_to_bucket,
    )
    .map_err(|e| e.to_string())
}

/// Prüft Name und Ziel-Bucket. `own_id` ist beim Bearbeiten die ID des Buckets selbst.
fn validate_bucket(conn: &Connection, input: &BucketInput, own_id: Option<i64>) -> Result<String, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Der Name darf nicht leer sein.".into());
    }
    if !input.color.is_empty() && !BUCKET_COLORS.contains(&input.color.as_str()) {
        return Err("Unbekannte Farbe.".into());
    }
    if name.chars().count() > MAX_BUCKET_NAME {
        return Err(format!("Der Name darf höchstens {MAX_BUCKET_NAME} Zeichen lang sein."));
    }
    let duplicate: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM buckets WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2)",
            params![name, own_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if duplicate {
        return Err(format!("Einen Bucket „{name}“ gibt es bereits."));
    }
    if let Some(target) = input.on_complete_bucket_id {
        if Some(target) == own_id {
            return Err("Ein Bucket kann nicht in sich selbst verschieben.".into());
        }
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM buckets WHERE id = ?1)", params![target], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err("Der Ziel-Bucket existiert nicht mehr.".into());
        }
    }
    Ok(name.to_string())
}

pub fn create_bucket(conn: &Connection, input: &BucketInput) -> Result<Bucket, String> {
    let name = validate_bucket(conn, input, None)?;
    conn.execute(
        "INSERT INTO buckets (name, on_complete_bucket_id, color, position)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position), -1) + 1 FROM buckets))",
        params![name, input.on_complete_bucket_id, input.color],
    )
    .map_err(|e| e.to_string())?;
    get_bucket(conn, conn.last_insert_rowid())
}

pub fn update_bucket(conn: &Connection, id: i64, input: &BucketInput) -> Result<Bucket, String> {
    let name = validate_bucket(conn, input, Some(id))?;
    let changed = conn
        .execute(
            "UPDATE buckets SET name = ?1, on_complete_bucket_id = ?2, color = ?3 WHERE id = ?4",
            params![name, input.on_complete_bucket_id, input.color, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Bucket nicht gefunden.".into());
    }
    get_bucket(conn, id)
}

/// Legt die Reihenfolge der Buckets fest. `ids` muss genau alle vorhandenen Buckets enthalten.
pub fn reorder_buckets(conn: &Connection, ids: &[i64]) -> Result<(), String> {
    let mut existing: Vec<i64> = list_buckets(conn)?.into_iter().map(|b| b.id).collect();
    let mut wanted = ids.to_vec();
    existing.sort_unstable();
    wanted.sort_unstable();
    if existing != wanted {
        return Err("Die Bucket-Liste ist nicht mehr aktuell. Bitte neu laden.".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (position, id) in ids.iter().enumerate() {
        tx.execute("UPDATE buckets SET position = ?1 WHERE id = ?2", params![position as i64, id])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// Löscht den Bucket. Seine Aufgaben bleiben erhalten (danach ohne Bucket);
/// Regeln anderer Buckets, die auf ihn zeigten, werden zurückgesetzt.
pub fn delete_bucket(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM buckets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Bucket nicht gefunden.".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Aufgaben
// ---------------------------------------------------------------------------

const TASK_COLUMNS: &str = "id, bucket_id, title, description, priority, due_date, done, show_subtasks, start_date, show_description,
    event_id, event_offset,
    (SELECT title FROM events WHERE events.id = tasks.event_id),
    (SELECT starts_at FROM events WHERE events.id = tasks.event_id),
    (SELECT ends_at FROM events WHERE events.id = tasks.event_id)";

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        bucket_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        priority: row.get(4)?,
        due_date: row.get(5)?,
        done: row.get::<_, i64>(6)? != 0,
        show_subtasks: row.get::<_, i64>(7)? != 0,
        start_date: row.get(8)?,
        show_description: row.get::<_, i64>(9)? != 0,
        event_id: row.get(10)?,
        event_offset: row.get(11)?,
        event_title: row.get(12)?,
        event_starts_at: row.get(13)?,
        event_ends_at: row.get(14)?,
        subtasks: Vec::new(),
    })
}

/// Hängt die Zwischenschritte an die Aufgaben (eine Abfrage für alle). `only` schränkt auf eine Aufgabe ein.
fn attach_subtasks(conn: &Connection, tasks: &mut [Task], only: Option<i64>) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, task_id, title, done FROM subtasks
             WHERE (?1 IS NULL OR task_id = ?1) ORDER BY position, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![only], |r| {
            Ok((
                r.get::<_, i64>(1)?,
                Subtask { id: r.get(0)?, title: r.get(2)?, done: r.get::<_, i64>(3)? != 0 },
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut by_task: HashMap<i64, Vec<Subtask>> = HashMap::new();
    for row in rows {
        let (task_id, subtask) = row.map_err(|e| e.to_string())?;
        by_task.entry(task_id).or_default().push(subtask);
    }
    for task in tasks.iter_mut() {
        if let Some(list) = by_task.remove(&task.id) {
            task.subtasks = list;
        }
    }
    Ok(())
}

fn validate_subtasks(input: &[SubtaskInput]) -> Result<(), String> {
    if input.len() > MAX_SUBTASKS {
        return Err(format!("Höchstens {MAX_SUBTASKS} Zwischenschritte pro Aufgabe."));
    }
    if input.iter().any(|s| s.title.trim().is_empty()) {
        return Err("Ein Zwischenschritt darf nicht leer sein.".into());
    }
    Ok(())
}

/// Gleicht die Zwischenschritte einer Aufgabe mit der übergebenen Liste ab (löschen, ändern, anlegen, ordnen).
fn sync_subtasks(conn: &Connection, task_id: i64, input: &[SubtaskInput]) -> Result<(), String> {
    let existing: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM subtasks WHERE task_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![task_id], |r| r.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    if input.iter().filter_map(|s| s.id).any(|id| !existing.contains(&id)) {
        return Err("Ein Zwischenschritt gehört nicht zu dieser Aufgabe.".into());
    }

    let keep: Vec<i64> = input.iter().filter_map(|s| s.id).collect();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for id in existing.iter().filter(|id| !keep.contains(id)) {
        tx.execute("DELETE FROM subtasks WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    }
    for (position, s) in input.iter().enumerate() {
        let title = s.title.trim();
        match s.id {
            Some(id) => tx.execute(
                "UPDATE subtasks SET title = ?1, done = ?2, position = ?3 WHERE id = ?4",
                params![title, s.done as i64, position as i64, id],
            ),
            None => tx.execute(
                "INSERT INTO subtasks (task_id, title, done, position) VALUES (?1, ?2, ?3, ?4)",
                params![task_id, title, s.done as i64, position as i64],
            ),
        }
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| matches!(i, 4 | 7) || c.is_ascii_digit())
}

/// Prüft Beginn und Fälligkeit: gültige Daten, Beginn nur zusammen mit Fälligkeit, Beginn nicht nach der Fälligkeit.
fn validate_dates(start: Option<&str>, due: Option<&str>) -> Result<(), String> {
    for d in [start, due].into_iter().flatten() {
        if !is_date(d) {
            return Err("Ungültiges Datumsformat (erwartet: YYYY-MM-DD).".into());
        }
    }
    match (start, due) {
        (Some(_), None) => Err("Ein Beginn braucht auch ein Fälligkeitsdatum.".into()),
        // Das Format YYYY-MM-DD lässt sich als Text vergleichen
        (Some(s), Some(d)) if s > d => Err("Der Beginn darf nicht nach dem Fälligkeitsdatum liegen.".into()),
        _ => Ok(()),
    }
}

/// Fälligkeitsdatum einer Aufgabe, die `offset` Tage vom Termin entfernt liegt. Davor und am Tag zählt der Beginn des
/// Termins, danach sein Ende (bei mehrtägigen Terminen also der letzte Tag).
fn event_task_date(conn: &Connection, event_id: i64, offset: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT date(substr(CASE WHEN ?2 > 0 THEN ends_at ELSE starts_at END, 1, 10), printf('%+d days', ?2))
         FROM events WHERE id = ?1",
        params![event_id, offset],
        |r| r.get(0),
    )
    .map_err(|_| "Der gewählte Termin existiert nicht mehr.".to_string())
}

/// Prüft den Terminbezug der Eingabe und liefert das Fälligkeitsdatum, das tatsächlich gilt: bei einem Termin das
/// berechnete, sonst das eingegebene.
fn effective_due(conn: &Connection, input: &TaskInput) -> Result<Option<String>, String> {
    let Some(event_id) = input.event_id else {
        return Ok(input.due_date.clone());
    };
    let offset = input.event_offset.ok_or("Bitte gib an, wie viele Tage vor oder nach dem Termin die Aufgabe liegt.")?;
    if offset.abs() > MAX_EVENT_OFFSET {
        return Err(format!("Der Abstand zum Termin darf höchstens {MAX_EVENT_OFFSET} Tage betragen."));
    }
    event_task_date(conn, event_id, offset).map(Some)
}

/// Zieht die Fälligkeit aller Aufgaben eines Termins nach, nachdem er verschoben wurde. Ein Beginn behält seine Dauer.
pub fn recompute_event_tasks(conn: &Connection, event_id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks
         SET start_date = CASE
               WHEN start_date IS NOT NULL AND due_date IS NOT NULL
               THEN date(
                 date(substr((SELECT CASE WHEN event_offset > 0 THEN ends_at ELSE starts_at END FROM events WHERE id = ?1), 1, 10),
                      printf('%+d days', event_offset)),
                 printf('%+d days', -CAST(ROUND(julianday(due_date) - julianday(start_date)) AS INTEGER)))
               ELSE start_date END,
             due_date = date(substr((SELECT CASE WHEN event_offset > 0 THEN ends_at ELSE starts_at END FROM events WHERE id = ?1), 1, 10),
                             printf('%+d days', event_offset)),
             updated_at = datetime('now')
         WHERE event_id = ?1 AND event_offset IS NOT NULL",
        params![event_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Löst alle Aufgaben von einem Termin; sie behalten ihr bisheriges Datum.
pub fn unlink_event_tasks(conn: &Connection, event_id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET event_id = NULL, event_offset = NULL, updated_at = datetime('now') WHERE event_id = ?1",
        params![event_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn validate_task(conn: &Connection, input: &TaskInput) -> Result<(), String> {
    if input.title.trim().is_empty() {
        return Err("Der Titel darf nicht leer sein.".into());
    }
    if !PRIORITIES.contains(&input.priority.as_str()) {
        return Err(format!("Unbekannte Priorität: {}", input.priority));
    }
    let due = effective_due(conn, input)?;
    validate_dates(input.start_date.as_deref(), due.as_deref())?;
    validate_subtasks(&input.subtasks)?;
    if let Some(id) = input.bucket_id {
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM buckets WHERE id = ?1)", params![id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err("Der gewählte Bucket existiert nicht mehr.".into());
        }
    }
    Ok(())
}

/// Nächste freie Position am Ende eines Buckets (`None` = „ohne Bucket“).
fn next_position(conn: &Connection, bucket_id: Option<i64>) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM tasks WHERE bucket_id IS ?1",
        params![bucket_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Offene Aufgaben zuerst, erledigte am Ende; innerhalb davon in Reihenfolge des Anlegens.
pub fn list_tasks(conn: &Connection) -> Result<Vec<Task>, String> {
    let sql = format!("SELECT {TASK_COLUMNS} FROM tasks ORDER BY done, position, id");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_task).map_err(|e| e.to_string())?;
    let mut tasks: Vec<Task> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    attach_subtasks(conn, &mut tasks, None)?;
    Ok(tasks)
}

pub fn get_task(conn: &Connection, id: i64) -> Result<Task, String> {
    let task = conn
        .query_row(
            &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"),
            params![id],
            row_to_task,
        )
        .map_err(|e| e.to_string())?;
    let mut tasks = vec![task];
    attach_subtasks(conn, &mut tasks, Some(id))?;
    Ok(tasks.remove(0))
}

pub fn create_task(conn: &Connection, input: &TaskInput) -> Result<Task, String> {
    validate_task(conn, input)?;
    if input.subtasks.iter().any(|s| s.id.is_some()) {
        return Err("Neue Aufgaben können keine bestehenden Zwischenschritte enthalten.".into());
    }
    let position = next_position(conn, input.bucket_id)?;
    let due = effective_due(conn, input)?;
    let event_offset = input.event_id.and(input.event_offset);
    conn.execute(
        "INSERT INTO tasks (bucket_id, title, description, priority, due_date, position, show_subtasks, start_date, show_description,
                            event_id, event_offset)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            input.bucket_id,
            input.title.trim(),
            input.description,
            input.priority,
            due,
            position,
            input.show_subtasks as i64,
            input.start_date,
            input.show_description as i64,
            input.event_id,
            event_offset
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    sync_subtasks(conn, id, &input.subtasks)?;
    get_task(conn, id)
}

pub fn update_task(conn: &Connection, id: i64, input: &TaskInput) -> Result<Task, String> {
    validate_task(conn, input)?;
    let current = get_task(conn, id).map_err(|_| "Aufgabe nicht gefunden.".to_string())?;
    sync_subtasks(conn, id, &input.subtasks)?;
    // Beim Wechsel des Buckets ans Ende des neuen Buckets stellen
    let position_sql = if current.bucket_id != input.bucket_id {
        Some(next_position(conn, input.bucket_id)?)
    } else {
        None
    };
    let due = effective_due(conn, input)?;
    let event_offset = input.event_id.and(input.event_offset);
    conn.execute(
        "UPDATE tasks
         SET bucket_id = ?1, title = ?2, description = ?3, priority = ?4, due_date = ?5,
             position = COALESCE(?6, position), show_subtasks = ?8, start_date = ?9, show_description = ?10,
             event_id = ?11, event_offset = ?12, updated_at = datetime('now')
         WHERE id = ?7",
        params![
            input.bucket_id,
            input.title.trim(),
            input.description,
            input.priority,
            due,
            position_sql,
            id,
            input.show_subtasks as i64,
            input.start_date,
            input.show_description as i64,
            input.event_id,
            event_offset
        ],
    )
    .map_err(|e| e.to_string())?;
    get_task(conn, id)
}

/// Ändert nur Beginn und Fälligkeit (Verschieben und Ziehen im Zeitplan).
///
/// Hängt die Aufgabe an einem Termin, ändert sich ihr Abstand zu ihm mit; ohne Fälligkeit wird sie vom Termin gelöst.
pub fn set_task_dates(conn: &Connection, id: i64, start: Option<&str>, due: Option<&str>) -> Result<Task, String> {
    validate_dates(start, due)?;
    let current = get_task(conn, id).map_err(|_| "Aufgabe nicht gefunden.".to_string())?;
    if let Some(event_id) = current.event_id {
        match due {
            Some(due) => {
                let (from_start, from_end): (i64, i64) = conn
                    .query_row(
                        "SELECT CAST(ROUND(julianday(?1) - julianday(substr(starts_at, 1, 10))) AS INTEGER),
                                CAST(ROUND(julianday(?1) - julianday(substr(ends_at, 1, 10))) AS INTEGER)
                         FROM events WHERE id = ?2",
                        params![due, event_id],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .map_err(|e| e.to_string())?;
                // Nach dem Ende zählt ab dem Ende, sonst ab dem Beginn (Tage mitten in einem mehrtägigen Termin: am Tag)
                let offset = if from_end > 0 { from_end } else { from_start.min(0) };
                conn.execute("UPDATE tasks SET event_offset = ?1 WHERE id = ?2", params![offset.clamp(-MAX_EVENT_OFFSET, MAX_EVENT_OFFSET), id])
                    .map_err(|e| e.to_string())?;
            }
            None => {
                conn.execute("UPDATE tasks SET event_id = NULL, event_offset = NULL WHERE id = ?1", params![id])
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    let changed = conn
        .execute(
            "UPDATE tasks SET start_date = ?1, due_date = ?2, updated_at = datetime('now') WHERE id = ?3",
            params![start, due, id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Aufgabe nicht gefunden.".into());
    }
    get_task(conn, id)
}

pub fn delete_task(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn
        .execute("DELETE FROM tasks WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Aufgabe nicht gefunden.".into());
    }
    Ok(())
}

/// Hakt einen einzelnen Zwischenschritt ab (z. B. direkt auf der Karte) und liefert die ganze Aufgabe zurück.
pub fn set_subtask_done(conn: &Connection, id: i64, done: bool) -> Result<Task, String> {
    let task_id: i64 = conn
        .query_row("SELECT task_id FROM subtasks WHERE id = ?1", params![id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("Zwischenschritt nicht gefunden.")?;
    conn.execute("UPDATE subtasks SET done = ?1 WHERE id = ?2", params![done as i64, id])
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?1", params![task_id])
        .map_err(|e| e.to_string())?;
    get_task(conn, task_id)
}

/// Verschiebt eine Aufgabe in einen Bucket (`None` = ohne Bucket) und stellt sie direkt vor
/// `before_task_id`; ohne Angabe ans Ende. Dient Drag & Drop im Board. Die Bucket-Regel
/// „beim Abhaken verschieben“ ist hier nicht beteiligt.
pub fn move_task(
    conn: &Connection,
    id: i64,
    bucket_id: Option<i64>,
    before_task_id: Option<i64>,
) -> Result<Task, String> {
    let task = get_task(conn, id).map_err(|_| "Aufgabe nicht gefunden.".to_string())?;
    if let Some(b) = bucket_id {
        get_bucket(conn, b).map_err(|_| "Der Ziel-Bucket existiert nicht mehr.".to_string())?;
    }
    // Vor sich selbst im selben Bucket ablegen = Position bleibt
    if before_task_id == Some(id) && task.bucket_id == bucket_id {
        return Ok(task);
    }

    // Reihenfolge im Ziel-Bucket ohne die verschobene Aufgabe
    let mut ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT id FROM tasks WHERE bucket_id IS ?1 AND id != ?2 ORDER BY position, id")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![bucket_id, id], |r| r.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
    };
    let index = match before_task_id.filter(|b| *b != id) {
        Some(before) => ids
            .iter()
            .position(|x| *x == before)
            .ok_or("Die Zielposition liegt nicht in diesem Bucket.")?,
        None => ids.len(),
    };
    ids.insert(index, id);

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (position, task_id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE tasks SET bucket_id = ?1, position = ?2 WHERE id = ?3",
            params![bucket_id, position as i64, task_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_task(conn, id)
}

/// Hakt eine Aufgabe ab oder öffnet sie wieder. Beim Abhaken verschiebt die Regel des
/// Buckets die Aufgabe automatisch in den Ziel-Bucket. Beim Wiedereröffnen passiert nichts.
pub fn set_task_done(conn: &Connection, id: i64, done: bool) -> Result<Task, String> {
    let task = get_task(conn, id).map_err(|_| "Aufgabe nicht gefunden.".to_string())?;

    let mut bucket_id = task.bucket_id;
    let mut position: Option<i64> = None;
    if done && !task.done {
        let target: Option<i64> = match task.bucket_id {
            Some(b) => conn
                .query_row("SELECT on_complete_bucket_id FROM buckets WHERE id = ?1", params![b], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?
                .flatten(),
            None => None,
        };
        if let Some(target) = target {
            bucket_id = Some(target);
            position = Some(next_position(conn, Some(target))?);
        }
    }

    conn.execute(
        "UPDATE tasks
         SET done = ?1,
             bucket_id = ?2,
             position = COALESCE(?3, position),
             completed_at = CASE WHEN ?1 = 1 THEN datetime('now') ELSE NULL END,
             updated_at = datetime('now')
         WHERE id = ?4",
        params![done as i64, bucket_id, position, id],
    )
    .map_err(|e| e.to_string())?;
    get_task(conn, id)
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

    fn bucket(name: &str, target: Option<i64>) -> BucketInput {
        BucketInput { name: name.into(), on_complete_bucket_id: target, color: String::new() }
    }

    fn input(title: &str, bucket: Option<i64>) -> TaskInput {
        TaskInput {
            bucket_id: bucket,
            title: title.into(),
            description: String::new(),
            priority: "medium".into(),
            due_date: None,
            start_date: None,
            show_subtasks: false,
            show_description: false,
            event_id: None,
            event_offset: None,
            subtasks: Vec::new(),
        }
    }

    fn step(id: Option<i64>, title: &str, done: bool) -> SubtaskInput {
        SubtaskInput { id, title: title.into(), done }
    }

    fn step_titles(t: &Task) -> Vec<String> {
        t.subtasks.iter().map(|s| s.title.clone()).collect()
    }

    #[test]
    fn buckets_are_listed_in_creation_order() {
        let c = conn();
        create_bucket(&c, &bucket("Backlog", None)).unwrap();
        create_bucket(&c, &bucket("  In Arbeit  ", None)).unwrap();
        let names: Vec<_> = list_buckets(&c).unwrap().into_iter().map(|b| b.name).collect();
        assert_eq!(names, ["Backlog", "In Arbeit"]);
    }

    #[test]
    fn rejects_invalid_buckets() {
        let c = conn();
        assert!(create_bucket(&c, &bucket("   ", None)).is_err());
        assert!(create_bucket(&c, &bucket(&"x".repeat(61), None)).is_err());
        create_bucket(&c, &bucket("Backlog", None)).unwrap();
        assert!(
            create_bucket(&c, &bucket("backlog", None)).is_err(),
            "Namen sind ohne Groß-/Kleinschreibung eindeutig"
        );
        assert!(create_bucket(&c, &bucket("Neu", Some(999))).is_err(), "unbekannter Ziel-Bucket");
    }

    #[test]
    fn rename_bucket_and_keep_own_name() {
        let c = conn();
        let a = create_bucket(&c, &bucket("Backlog", None)).unwrap();
        create_bucket(&c, &bucket("Erledigt", None)).unwrap();

        // Gleicher Name wie vorher ist beim Bearbeiten erlaubt, auch in anderer Schreibweise
        let renamed = update_bucket(&c, a.id, &bucket("BACKLOG", None)).unwrap();
        assert_eq!(renamed.name, "BACKLOG");
        // Aber nicht der Name eines anderen Buckets
        assert!(update_bucket(&c, a.id, &bucket("erledigt", None)).is_err());
        assert!(update_bucket(&c, 999, &bucket("X", None)).is_err());
    }

    #[test]
    fn bucket_cannot_target_itself() {
        let c = conn();
        let a = create_bucket(&c, &bucket("A", None)).unwrap();
        assert!(update_bucket(&c, a.id, &bucket("A", Some(a.id))).is_err());
    }

    #[test]
    fn tasks_with_and_without_bucket() {
        let c = conn();
        let b = create_bucket(&c, &bucket("Backlog", None)).unwrap();
        let loose = create_task(&c, &input("Ohne Bucket", None)).unwrap();
        let in_bucket = create_task(&c, &input("Im Bucket", Some(b.id))).unwrap();
        assert_eq!(loose.bucket_id, None);
        assert_eq!(in_bucket.bucket_id, Some(b.id));
        assert!(!in_bucket.done);
        assert_eq!(list_tasks(&c).unwrap().len(), 2);
    }

    #[test]
    fn stores_priority_and_due_date() {
        let c = conn();
        let mut i = input("Bericht", None);
        i.priority = "high".into();
        i.due_date = Some("2026-10-20".into());
        i.description = "Q3".into();
        let t = create_task(&c, &i).unwrap();
        assert_eq!(t.priority, "high");
        assert_eq!(t.due_date.as_deref(), Some("2026-10-20"));
        assert_eq!(t.description, "Q3");
    }

    #[test]
    fn rejects_invalid_tasks() {
        let c = conn();
        assert!(create_task(&c, &input("  ", None)).is_err());
        assert!(create_task(&c, &input("x", Some(999))).is_err(), "unbekannter Bucket");
        let mut bad = input("x", None);
        bad.priority = "urgent".into();
        assert!(create_task(&c, &bad).is_err());
        let mut bad = input("x", None);
        bad.due_date = Some("20.10.2026".into());
        assert!(create_task(&c, &bad).is_err());
    }

    #[test]
    fn update_and_delete_task() {
        let c = conn();
        let a = create_bucket(&c, &bucket("A", None)).unwrap();
        let b = create_bucket(&c, &bucket("B", None)).unwrap();
        create_task(&c, &input("Schon in B", Some(b.id))).unwrap();
        let t = create_task(&c, &input("Alt", Some(a.id))).unwrap();

        let mut changed = input("Neu", Some(b.id));
        changed.priority = "low".into();
        changed.due_date = Some("2026-11-01".into());
        let updated = update_task(&c, t.id, &changed).unwrap();
        assert_eq!(updated.title, "Neu");
        assert_eq!(updated.bucket_id, Some(b.id));
        assert_eq!(updated.priority, "low");

        // Nach dem Wechsel steht die Aufgabe hinter der bestehenden in B
        let in_b: Vec<_> = list_tasks(&c)
            .unwrap()
            .into_iter()
            .filter(|t| t.bucket_id == Some(b.id))
            .map(|t| t.title)
            .collect();
        assert_eq!(in_b, ["Schon in B", "Neu"]);

        assert!(update_task(&c, 999, &changed).is_err());
        assert!(update_task(&c, t.id, &input("  ", None)).is_err());

        delete_task(&c, t.id).unwrap();
        assert!(get_task(&c, t.id).is_err());
        assert!(delete_task(&c, t.id).is_err());
    }

    #[test]
    fn done_tasks_sort_last_and_can_be_reopened() {
        let c = conn();
        let a = create_task(&c, &input("A", None)).unwrap();
        create_task(&c, &input("B", None)).unwrap();

        let done = set_task_done(&c, a.id, true).unwrap();
        assert!(done.done);
        let titles: Vec<_> = list_tasks(&c).unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(titles, ["B", "A"]);

        set_task_done(&c, a.id, false).unwrap();
        let titles: Vec<_> = list_tasks(&c).unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(titles, ["A", "B"]);
        assert!(set_task_done(&c, 999, true).is_err());
    }

    #[test]
    fn completing_moves_task_to_target_bucket() {
        let c = conn();
        let done_bucket = create_bucket(&c, &bucket("Erledigt", None)).unwrap();
        let todo = create_bucket(&c, &bucket("In Arbeit", Some(done_bucket.id))).unwrap();
        assert_eq!(todo.on_complete_bucket_id, Some(done_bucket.id));
        let t = create_task(&c, &input("Bericht", Some(todo.id))).unwrap();

        let moved = set_task_done(&c, t.id, true).unwrap();
        assert!(moved.done);
        assert_eq!(moved.bucket_id, Some(done_bucket.id));

        // Wiedereröffnen verschiebt nicht zurück
        let reopened = set_task_done(&c, t.id, false).unwrap();
        assert!(!reopened.done);
        assert_eq!(reopened.bucket_id, Some(done_bucket.id));
    }

    #[test]
    fn without_rule_nothing_moves() {
        let c = conn();
        let b = create_bucket(&c, &bucket("Backlog", None)).unwrap();
        let t = create_task(&c, &input("A", Some(b.id))).unwrap();
        let done = set_task_done(&c, t.id, true).unwrap();
        assert_eq!(done.bucket_id, Some(b.id));
        // Aufgabe ohne Bucket hat keine Regel
        let loose = create_task(&c, &input("Lose", None)).unwrap();
        assert_eq!(set_task_done(&c, loose.id, true).unwrap().bucket_id, None);
    }

    #[test]
    fn already_done_task_is_not_moved_again() {
        let c = conn();
        let target = create_bucket(&c, &bucket("Ziel", None)).unwrap();
        let src = create_bucket(&c, &bucket("Quelle", Some(target.id))).unwrap();
        let t = create_task(&c, &input("A", Some(src.id))).unwrap();
        set_task_done(&c, t.id, true).unwrap();
        // Zurück in die Quelle verschieben, dann erneut "abhaken" (bereits erledigt): keine Verschiebung
        let mut back = input("A", Some(src.id));
        back.priority = "medium".into();
        update_task(&c, t.id, &back).unwrap();
        let again = set_task_done(&c, t.id, true).unwrap();
        assert_eq!(again.bucket_id, Some(src.id));
    }

    fn titles_in(c: &Connection, bucket: Option<i64>) -> Vec<String> {
        list_tasks(c).unwrap().into_iter().filter(|t| t.bucket_id == bucket).map(|t| t.title).collect()
    }

    #[test]
    fn move_task_reorders_within_bucket() {
        let c = conn();
        let b = create_bucket(&c, &bucket("B", None)).unwrap();
        let t1 = create_task(&c, &input("1", Some(b.id))).unwrap();
        let t2 = create_task(&c, &input("2", Some(b.id))).unwrap();
        let t3 = create_task(&c, &input("3", Some(b.id))).unwrap();

        move_task(&c, t3.id, Some(b.id), Some(t1.id)).unwrap();
        assert_eq!(titles_in(&c, Some(b.id)), ["3", "1", "2"]);

        // Ohne Zielposition ans Ende
        move_task(&c, t3.id, Some(b.id), None).unwrap();
        assert_eq!(titles_in(&c, Some(b.id)), ["1", "2", "3"]);

        // Vor sich selbst legen ändert nichts
        move_task(&c, t2.id, Some(b.id), Some(t2.id)).unwrap();
        assert_eq!(titles_in(&c, Some(b.id)), ["1", "2", "3"]);
    }

    #[test]
    fn move_task_between_buckets_and_to_none() {
        let c = conn();
        let a = create_bucket(&c, &bucket("A", None)).unwrap();
        let b = create_bucket(&c, &bucket("B", None)).unwrap();
        let a1 = create_task(&c, &input("a1", Some(a.id))).unwrap();
        let b1 = create_task(&c, &input("b1", Some(b.id))).unwrap();
        let b2 = create_task(&c, &input("b2", Some(b.id))).unwrap();

        let moved = move_task(&c, a1.id, Some(b.id), Some(b2.id)).unwrap();
        assert_eq!(moved.bucket_id, Some(b.id));
        assert_eq!(titles_in(&c, Some(b.id)), ["b1", "a1", "b2"]);
        assert!(titles_in(&c, Some(a.id)).is_empty());

        let loose = move_task(&c, b1.id, None, None).unwrap();
        assert_eq!(loose.bucket_id, None);
        assert_eq!(titles_in(&c, None), ["b1"]);
    }

    #[test]
    fn move_task_rejects_invalid_targets() {
        let c = conn();
        let a = create_bucket(&c, &bucket("A", None)).unwrap();
        let b = create_bucket(&c, &bucket("B", None)).unwrap();
        let in_a = create_task(&c, &input("a", Some(a.id))).unwrap();
        let in_b = create_task(&c, &input("b", Some(b.id))).unwrap();
        assert!(move_task(&c, 999, Some(a.id), None).is_err(), "unbekannte Aufgabe");
        assert!(move_task(&c, in_a.id, Some(999), None).is_err(), "unbekannter Bucket");
        assert!(move_task(&c, in_a.id, Some(b.id), Some(in_a.id + 100)).is_err(), "Zielposition fehlt");
        // before-Aufgabe liegt in einem anderen Bucket als das Ziel
        assert!(move_task(&c, in_a.id, Some(a.id), Some(in_b.id)).is_err());
    }

    #[test]
    fn moving_does_not_trigger_completion_rule() {
        let c = conn();
        let target = create_bucket(&c, &bucket("Erledigt", None)).unwrap();
        let src = create_bucket(&c, &bucket("Offen", Some(target.id))).unwrap();
        let other = create_bucket(&c, &bucket("Andere", None)).unwrap();
        let t = create_task(&c, &input("A", Some(other.id))).unwrap();
        set_task_done(&c, t.id, true).unwrap();
        let moved = move_task(&c, t.id, Some(src.id), None).unwrap();
        assert_eq!(moved.bucket_id, Some(src.id), "Verschieben per Hand bleibt, wo es hingelegt wurde");
    }

    #[test]
    fn reorder_buckets_sets_order() {
        let c = conn();
        let a = create_bucket(&c, &bucket("A", None)).unwrap();
        let b = create_bucket(&c, &bucket("B", None)).unwrap();
        let d = create_bucket(&c, &bucket("C", None)).unwrap();

        reorder_buckets(&c, &[d.id, a.id, b.id]).unwrap();
        let names: Vec<_> = list_buckets(&c).unwrap().into_iter().map(|b| b.name).collect();
        assert_eq!(names, ["C", "A", "B"]);

        assert!(reorder_buckets(&c, &[a.id, b.id]).is_err(), "unvollständig");
        assert!(reorder_buckets(&c, &[a.id, a.id, b.id]).is_err(), "doppelt");
        assert!(reorder_buckets(&c, &[a.id, b.id, 999]).is_err(), "unbekannt");
    }

    #[test]
    fn task_is_created_with_subtasks_in_order() {
        let c = conn();
        let mut i = input("Umzug", None);
        i.subtasks = vec![step(None, "Kartons besorgen", false), step(None, "Packen", true), step(None, "Transporter", false)];
        let t = create_task(&c, &i).unwrap();
        assert_eq!(step_titles(&t), ["Kartons besorgen", "Packen", "Transporter"]);
        assert_eq!(t.subtasks.iter().map(|s| s.done).collect::<Vec<_>>(), [false, true, false]);

        // list_tasks liefert die Zwischenschritte ebenfalls mit, je Aufgabe getrennt
        create_task(&c, &input("Ohne", None)).unwrap();
        let all = list_tasks(&c).unwrap();
        assert_eq!(all.iter().find(|t| t.title == "Umzug").unwrap().subtasks.len(), 3);
        assert!(all.iter().find(|t| t.title == "Ohne").unwrap().subtasks.is_empty());
    }

    #[test]
    fn update_syncs_subtasks() {
        let c = conn();
        let mut i = input("Umzug", None);
        i.subtasks = vec![step(None, "A", false), step(None, "B", false), step(None, "C", false)];
        let t = create_task(&c, &i).unwrap();
        let (a, b, cc) = (t.subtasks[0].id, t.subtasks[1].id, t.subtasks[2].id);

        // A abhaken und umbenennen, B löschen, C vor A, D neu
        let mut u = input("Umzug", None);
        u.subtasks = vec![step(Some(cc), "C", false), step(Some(a), "A2", true), step(None, "D", false)];
        let updated = update_task(&c, t.id, &u).unwrap();
        assert_eq!(step_titles(&updated), ["C", "A2", "D"]);
        assert_eq!(updated.subtasks[1].id, a, "bestehende Zwischenschritte behalten ihre ID");
        assert!(updated.subtasks[1].done);
        assert!(updated.subtasks.iter().all(|s| s.id != b), "B ist gelöscht");

        // Leere Liste entfernt alle
        let cleared = update_task(&c, t.id, &input("Umzug", None)).unwrap();
        assert!(cleared.subtasks.is_empty());
    }

    #[test]
    fn rejects_invalid_subtasks() {
        let c = conn();
        let mut empty = input("x", None);
        empty.subtasks = vec![step(None, "  ", false)];
        assert!(create_task(&c, &empty).is_err());

        let mut too_many = input("x", None);
        too_many.subtasks = (0..=MAX_SUBTASKS).map(|n| step(None, &format!("s{n}"), false)).collect();
        assert!(create_task(&c, &too_many).is_err());

        let mut with_id = input("x", None);
        with_id.subtasks = vec![step(Some(1), "fremd", false)];
        assert!(create_task(&c, &with_id).is_err());
        assert!(list_tasks(&c).unwrap().is_empty(), "fehlgeschlagene Aufgabe wird nicht angelegt");

        // Zwischenschritt einer anderen Aufgabe darf nicht übernommen werden
        let mut other = input("Andere", None);
        other.subtasks = vec![step(None, "gehört anderer", false)];
        let other = create_task(&c, &other).unwrap();
        let mine = create_task(&c, &input("Meine", None)).unwrap();
        let mut steal = input("Meine", None);
        steal.subtasks = vec![step(Some(other.subtasks[0].id), "geklaut", false)];
        assert!(update_task(&c, mine.id, &steal).is_err());
        assert_eq!(get_task(&c, other.id).unwrap().subtasks[0].title, "gehört anderer");
    }

    #[test]
    fn show_subtasks_flag_is_stored_and_updated() {
        let c = conn();
        let mut i = input("Umzug", None);
        i.show_subtasks = true;
        i.subtasks = vec![step(None, "A", false)];
        let t = create_task(&c, &i).unwrap();
        assert!(t.show_subtasks);
        assert!(!create_task(&c, &input("Andere", None)).unwrap().show_subtasks, "Standard: aus");

        let mut off = input("Umzug", None);
        off.subtasks = vec![step(Some(t.subtasks[0].id), "A", false)];
        let updated = update_task(&c, t.id, &off).unwrap();
        assert!(!updated.show_subtasks);
        assert!(list_tasks(&c).unwrap().iter().all(|t| !t.show_subtasks));
    }

    #[test]
    fn set_subtask_done_toggles_single_step() {
        let c = conn();
        let mut i = input("Umzug", None);
        i.subtasks = vec![step(None, "A", false), step(None, "B", false)];
        let t = create_task(&c, &i).unwrap();
        let (a, b) = (t.subtasks[0].id, t.subtasks[1].id);

        let after = set_subtask_done(&c, b, true).unwrap();
        assert_eq!(after.id, t.id, "liefert die zugehörige Aufgabe");
        assert_eq!(after.subtasks.iter().map(|s| s.done).collect::<Vec<_>>(), [false, true]);
        assert!(!after.done, "die Aufgabe selbst bleibt offen");

        let reopened = set_subtask_done(&c, b, false).unwrap();
        assert!(reopened.subtasks.iter().all(|s| !s.done));
        assert!(set_subtask_done(&c, a + 999, true).is_err());
    }

    #[test]
    fn deleting_task_removes_its_subtasks() {
        let c = conn();
        let mut i = input("Umzug", None);
        i.subtasks = vec![step(None, "A", false)];
        let t = create_task(&c, &i).unwrap();
        delete_task(&c, t.id).unwrap();
        let left: i64 = c.query_row("SELECT COUNT(*) FROM subtasks", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn done_and_move_keep_subtasks() {
        let c = conn();
        let b = create_bucket(&c, &bucket("B", None)).unwrap();
        let mut i = input("Umzug", None);
        i.subtasks = vec![step(None, "A", true), step(None, "B", false)];
        let t = create_task(&c, &i).unwrap();
        assert_eq!(set_task_done(&c, t.id, true).unwrap().subtasks.len(), 2);
        assert_eq!(move_task(&c, t.id, Some(b.id), None).unwrap().subtasks.len(), 2);
    }

    #[test]
    fn deleting_bucket_keeps_tasks_and_clears_rules() {
        let c = conn();
        let target = create_bucket(&c, &bucket("Erledigt", None)).unwrap();
        let src = create_bucket(&c, &bucket("In Arbeit", Some(target.id))).unwrap();
        let t = create_task(&c, &input("A", Some(target.id))).unwrap();

        delete_bucket(&c, target.id).unwrap();

        // Aufgabe bleibt, nun ohne Bucket
        assert_eq!(get_task(&c, t.id).unwrap().bucket_id, None);
        // Regel der Quelle zeigt nicht mehr ins Leere
        assert_eq!(get_bucket(&c, src.id).unwrap().on_complete_bucket_id, None);
        assert!(delete_bucket(&c, target.id).is_err());
    }

    #[test]
    fn bucket_colors_are_validated_stored_and_default_to_none() {
        let c = conn();
        let plain = create_bucket(&c, &bucket("Ohne", None)).unwrap();
        assert_eq!(plain.color, "", "ohne Angabe keine Farbe");

        let blue = create_bucket(&c, &BucketInput { color: "blue".into(), ..bucket("Blau", None) }).unwrap();
        assert_eq!(blue.color, "blue");
        assert!(create_bucket(&c, &BucketInput { color: "#ff0000".into(), ..bucket("Falsch", None) }).is_err(), "nur Farben der Palette");

        let changed = update_bucket(&c, blue.id, &BucketInput { color: "teal".into(), ..bucket("Blau", None) }).unwrap();
        assert_eq!(changed.color, "teal");
        let cleared = update_bucket(&c, blue.id, &bucket("Blau", None)).unwrap();
        assert_eq!(cleared.color, "", "Farbe lässt sich wieder entfernen");
        assert!(update_bucket(&c, blue.id, &BucketInput { color: "x".into(), ..bucket("Blau", None) }).is_err());
    }

    #[test]
    fn start_date_is_validated_and_stored() {
        let c = conn();
        let mut i = input("Projekt", None);
        i.start_date = Some("2026-10-10".into());
        assert!(create_task(&c, &i).unwrap_err().contains("Fälligkeitsdatum"), "Beginn ohne Fälligkeit");
        i.due_date = Some("2026-10-05".into());
        assert!(create_task(&c, &i).unwrap_err().contains("nicht nach"), "Beginn nach Fälligkeit");
        i.due_date = Some("2026-10-20".into());
        i.start_date = Some("10.10.2026".into());
        assert!(create_task(&c, &i).is_err(), "falsches Format");

        i.start_date = Some("2026-10-10".into());
        let t = create_task(&c, &i).unwrap();
        assert_eq!((t.start_date.as_deref(), t.due_date.as_deref()), (Some("2026-10-10"), Some("2026-10-20")));
        assert_eq!(list_tasks(&c).unwrap()[0].start_date.as_deref(), Some("2026-10-10"));

        // gleicher Tag ist erlaubt (eintägig)
        i.start_date = Some("2026-10-20".into());
        assert!(update_task(&c, t.id, &i).is_ok());
    }

    #[test]
    fn set_task_dates_moves_and_clears() {
        let c = conn();
        let mut i = input("Aufgabe", None);
        i.due_date = Some("2026-10-20".into());
        let t = create_task(&c, &i).unwrap();

        let moved = set_task_dates(&c, t.id, Some("2026-10-18"), Some("2026-10-22")).unwrap();
        assert_eq!((moved.start_date.as_deref(), moved.due_date.as_deref()), (Some("2026-10-18"), Some("2026-10-22")));
        let single = set_task_dates(&c, t.id, None, Some("2026-10-25")).unwrap();
        assert_eq!((single.start_date, single.due_date.as_deref()), (None, Some("2026-10-25")));
        let none = set_task_dates(&c, t.id, None, None).unwrap();
        assert_eq!((none.start_date, none.due_date), (None, None));

        assert!(set_task_dates(&c, t.id, Some("2026-10-30"), Some("2026-10-20")).is_err());
        assert!(set_task_dates(&c, t.id, Some("2026-10-30"), None).is_err());
        assert!(set_task_dates(&c, 999, None, Some("2026-10-20")).is_err());
    }

    #[test]
    fn show_description_flag_is_stored_and_updated() {
        let c = conn();
        let mut i = input("Plan", None);
        i.description = "Wichtige Notiz".into();
        i.show_description = true;
        let t = create_task(&c, &i).unwrap();
        assert!(t.show_description);
        assert!(!create_task(&c, &input("Andere", None)).unwrap().show_description, "Standard: aus");
        let mut off = input("Plan", None);
        off.description = "Wichtige Notiz".into();
        let updated = update_task(&c, t.id, &off).unwrap();
        assert!(!updated.show_description);
        assert_eq!(updated.description, "Wichtige Notiz", "die Notiz bleibt, nur die Anzeige ist aus");
    }

    fn event(c: &Connection, title: &str, start: &str, end: &str) -> i64 {
        crate::events::create_event(
            c,
            &crate::events::EventInput {
                title: title.into(),
                description: String::new(),
                location: String::new(),
                starts_at: start.into(),
                ends_at: end.into(),
                all_day: false,
            },
        )
        .unwrap()
        .id
    }

    fn linked(title: &str, event_id: i64, offset: i64) -> TaskInput {
        let mut i = input(title, None);
        i.event_id = Some(event_id);
        i.event_offset = Some(offset);
        i
    }

    #[test]
    fn task_on_event_gets_its_date_from_the_event() {
        let c = conn();
        let e = event(&c, "Prüfung", "2026-10-20 09:00", "2026-10-20 11:00");
        let before = create_task(&c, &linked("Lernen", e, -2)).unwrap();
        assert_eq!(before.due_date.as_deref(), Some("2026-10-18"));
        assert_eq!((before.event_id, before.event_offset), (Some(e), Some(-2)));
        assert_eq!(before.event_title.as_deref(), Some("Prüfung"));
        assert_eq!(before.event_starts_at.as_deref(), Some("2026-10-20 09:00"));
        assert_eq!(create_task(&c, &linked("Anreise", e, 0)).unwrap().due_date.as_deref(), Some("2026-10-20"));
        assert_eq!(create_task(&c, &linked("Protokoll", e, 1)).unwrap().due_date.as_deref(), Some("2026-10-21"));
        // Ein eingegebenes Datum zählt nicht, solange die Aufgabe am Termin hängt
        let mut with_due = linked("Mit Datum", e, -1);
        with_due.due_date = Some("2030-01-01".into());
        assert_eq!(create_task(&c, &with_due).unwrap().due_date.as_deref(), Some("2026-10-19"));
    }

    #[test]
    fn after_a_multi_day_event_counts_from_its_end() {
        let c = conn();
        let e = event(&c, "Reise", "2026-10-20 08:00", "2026-10-23 18:00");
        assert_eq!(create_task(&c, &linked("Packen", e, -1)).unwrap().due_date.as_deref(), Some("2026-10-19"));
        assert_eq!(create_task(&c, &linked("Bericht", e, 2)).unwrap().due_date.as_deref(), Some("2026-10-25"));
    }

    #[test]
    fn moving_the_event_moves_its_tasks_and_keeps_the_duration() {
        let c = conn();
        let e = event(&c, "Prüfung", "2026-10-20 09:00", "2026-10-20 11:00");
        let mut with_start = linked("Lernen", e, -3);
        with_start.start_date = Some("2026-10-15".into());
        let t = create_task(&c, &with_start).unwrap();
        assert_eq!((t.start_date.as_deref(), t.due_date.as_deref()), (Some("2026-10-15"), Some("2026-10-17")));
        let loose = create_task(&c, &input("Frei", None)).unwrap();

        crate::events::update_event(
            &c,
            e,
            &crate::events::EventInput {
                title: "Prüfung".into(),
                description: String::new(),
                location: String::new(),
                starts_at: "2026-10-27 09:00".into(),
                ends_at: "2026-10-27 11:00".into(),
                all_day: false,
            },
        )
        .unwrap();

        let moved = get_task(&c, t.id).unwrap();
        assert_eq!((moved.start_date.as_deref(), moved.due_date.as_deref()), (Some("2026-10-22"), Some("2026-10-24")));
        assert_eq!(moved.event_offset, Some(-3));
        assert_eq!(get_task(&c, loose.id).unwrap().due_date, None, "Aufgaben ohne Termin bleiben unberührt");
    }

    #[test]
    fn deleting_the_event_keeps_its_tasks_with_their_last_date() {
        let c = conn();
        let e = event(&c, "Prüfung", "2026-10-20 09:00", "2026-10-20 11:00");
        let t = create_task(&c, &linked("Lernen", e, -2)).unwrap();
        crate::events::delete_event(&c, e).unwrap();
        let kept = get_task(&c, t.id).unwrap();
        assert_eq!((kept.event_id, kept.event_offset, kept.event_title), (None, None, None));
        assert_eq!(kept.due_date.as_deref(), Some("2026-10-18"));
    }

    #[test]
    fn rejects_invalid_event_links() {
        let c = conn();
        let e = event(&c, "Prüfung", "2026-10-20 09:00", "2026-10-20 11:00");
        assert!(create_task(&c, &linked("x", e + 99, 0)).is_err(), "unbekannter Termin");
        assert!(create_task(&c, &linked("x", e, 400)).is_err(), "Abstand zu groß");
        let mut no_offset = input("x", None);
        no_offset.event_id = Some(e);
        assert!(create_task(&c, &no_offset).is_err(), "ohne Abstand");
    }

    #[test]
    fn unlinking_in_update_keeps_the_date_and_drops_the_offset() {
        let c = conn();
        let e = event(&c, "Prüfung", "2026-10-20 09:00", "2026-10-20 11:00");
        let t = create_task(&c, &linked("Lernen", e, -2)).unwrap();
        let mut plain = input("Lernen", None);
        plain.due_date = t.due_date.clone();
        plain.event_offset = Some(5);
        let u = update_task(&c, t.id, &plain).unwrap();
        assert_eq!((u.event_id, u.event_offset), (None, None));
        assert_eq!(u.due_date.as_deref(), Some("2026-10-18"));
    }

    #[test]
    fn dragging_a_linked_task_changes_its_offset() {
        let c = conn();
        let e = event(&c, "Prüfung", "2026-10-20 09:00", "2026-10-20 11:00");
        let t = create_task(&c, &linked("Lernen", e, -2)).unwrap();
        let moved = set_task_dates(&c, t.id, None, Some("2026-10-14")).unwrap();
        assert_eq!((moved.event_offset, moved.due_date.as_deref()), (Some(-6), Some("2026-10-14")));
        let after = set_task_dates(&c, t.id, None, Some("2026-10-22")).unwrap();
        assert_eq!(after.event_offset, Some(2));
        let cleared = set_task_dates(&c, t.id, None, None).unwrap();
        assert_eq!((cleared.event_id, cleared.event_offset), (None, None), "ohne Datum hängt sie nicht mehr am Termin");
    }
}
