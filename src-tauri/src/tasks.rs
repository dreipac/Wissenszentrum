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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub id: i64,
    pub name: String,
    /// Ziel-Bucket, in den abgehakte Aufgaben automatisch verschoben werden (None = nichts tun)
    pub on_complete_bucket_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketInput {
    pub name: String,
    #[serde(default)]
    pub on_complete_bucket_id: Option<i64>,
}

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
    pub done: bool,
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
    /// Vollständige Liste der Zwischenschritte in gewünschter Reihenfolge; fehlende werden gelöscht.
    #[serde(default)]
    pub subtasks: Vec<SubtaskInput>,
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

const BUCKET_COLUMNS: &str = "id, name, on_complete_bucket_id";

fn row_to_bucket(row: &Row) -> rusqlite::Result<Bucket> {
    Ok(Bucket {
        id: row.get(0)?,
        name: row.get(1)?,
        on_complete_bucket_id: row.get(2)?,
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
        "INSERT INTO buckets (name, on_complete_bucket_id, position)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM buckets))",
        params![name, input.on_complete_bucket_id],
    )
    .map_err(|e| e.to_string())?;
    get_bucket(conn, conn.last_insert_rowid())
}

pub fn update_bucket(conn: &Connection, id: i64, input: &BucketInput) -> Result<Bucket, String> {
    let name = validate_bucket(conn, input, Some(id))?;
    let changed = conn
        .execute(
            "UPDATE buckets SET name = ?1, on_complete_bucket_id = ?2 WHERE id = ?3",
            params![name, input.on_complete_bucket_id, id],
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

const TASK_COLUMNS: &str = "id, bucket_id, title, description, priority, due_date, done";

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        bucket_id: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        priority: row.get(4)?,
        due_date: row.get(5)?,
        done: row.get::<_, i64>(6)? != 0,
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

fn validate_task(conn: &Connection, input: &TaskInput) -> Result<(), String> {
    if input.title.trim().is_empty() {
        return Err("Der Titel darf nicht leer sein.".into());
    }
    if !PRIORITIES.contains(&input.priority.as_str()) {
        return Err(format!("Unbekannte Priorität: {}", input.priority));
    }
    if let Some(d) = &input.due_date {
        if !is_date(d) {
            return Err("Ungültiges Datumsformat (erwartet: YYYY-MM-DD).".into());
        }
    }
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
    conn.execute(
        "INSERT INTO tasks (bucket_id, title, description, priority, due_date, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.bucket_id,
            input.title.trim(),
            input.description,
            input.priority,
            input.due_date,
            position
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
    conn.execute(
        "UPDATE tasks
         SET bucket_id = ?1, title = ?2, description = ?3, priority = ?4, due_date = ?5,
             position = COALESCE(?6, position), updated_at = datetime('now')
         WHERE id = ?7",
        params![
            input.bucket_id,
            input.title.trim(),
            input.description,
            input.priority,
            input.due_date,
            position_sql,
            id
        ],
    )
    .map_err(|e| e.to_string())?;
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
        BucketInput { name: name.into(), on_complete_bucket_id: target }
    }

    fn input(title: &str, bucket: Option<i64>) -> TaskInput {
        TaskInput {
            bucket_id: bucket,
            title: title.into(),
            description: String::new(),
            priority: "medium".into(),
            due_date: None,
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
}
