mod db;
mod events;
mod tasks;

use db::Db;
use events::{Event, EventInput};
use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};
use tasks::{Bucket, BucketInput, Task, TaskInput};
use tauri::{Manager, State};

fn lock<'a>(db: &'a State<Db>) -> Result<MutexGuard<'a, Connection>, String> {
    db.0.lock().map_err(|_| "Datenbank ist gesperrt.".to_string())
}

// --- Kalender ---------------------------------------------------------------

#[tauri::command]
fn list_events(db: State<Db>, from: String, to: String) -> Result<Vec<Event>, String> {
    let conn = lock(&db)?;
    events::list_events(&conn, &from, &to)
}

#[tauri::command]
fn create_event(db: State<Db>, input: EventInput) -> Result<Event, String> {
    let conn = lock(&db)?;
    events::create_event(&conn, &input)
}

#[tauri::command]
fn update_event(db: State<Db>, id: i64, input: EventInput) -> Result<Event, String> {
    let conn = lock(&db)?;
    events::update_event(&conn, id, &input)
}

#[tauri::command]
fn delete_event(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    events::delete_event(&conn, id)
}

// --- Aufgaben ---------------------------------------------------------------

#[tauri::command]
fn list_buckets(db: State<Db>) -> Result<Vec<Bucket>, String> {
    let conn = lock(&db)?;
    tasks::list_buckets(&conn)
}

#[tauri::command]
fn create_bucket(db: State<Db>, input: BucketInput) -> Result<Bucket, String> {
    let conn = lock(&db)?;
    tasks::create_bucket(&conn, &input)
}

#[tauri::command]
fn update_bucket(db: State<Db>, id: i64, input: BucketInput) -> Result<Bucket, String> {
    let conn = lock(&db)?;
    tasks::update_bucket(&conn, id, &input)
}

#[tauri::command]
fn reorder_buckets(db: State<Db>, ids: Vec<i64>) -> Result<(), String> {
    let conn = lock(&db)?;
    tasks::reorder_buckets(&conn, &ids)
}

#[tauri::command]
fn delete_bucket(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    tasks::delete_bucket(&conn, id)
}

#[tauri::command]
fn list_tasks(db: State<Db>) -> Result<Vec<Task>, String> {
    let conn = lock(&db)?;
    tasks::list_tasks(&conn)
}

#[tauri::command]
fn create_task(db: State<Db>, input: TaskInput) -> Result<Task, String> {
    let conn = lock(&db)?;
    tasks::create_task(&conn, &input)
}

#[tauri::command]
fn update_task(db: State<Db>, id: i64, input: TaskInput) -> Result<Task, String> {
    let conn = lock(&db)?;
    tasks::update_task(&conn, id, &input)
}

#[tauri::command]
fn delete_task(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    tasks::delete_task(&conn, id)
}

#[tauri::command]
fn move_task(db: State<Db>, id: i64, bucket_id: Option<i64>, before_task_id: Option<i64>) -> Result<Task, String> {
    let conn = lock(&db)?;
    tasks::move_task(&conn, id, bucket_id, before_task_id)
}

#[tauri::command]
fn set_task_done(db: State<Db>, id: i64, done: bool) -> Result<Task, String> {
    let conn = lock(&db)?;
    tasks::set_task_done(&conn, id, done)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Windows: %APPDATA%\com.armin.wissenszentrum\wissenszentrum.db
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = Connection::open(dir.join("wissenszentrum.db"))?;
            db::init(&conn)?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_events,
            create_event,
            update_event,
            delete_event,
            list_buckets,
            create_bucket,
            update_bucket,
            reorder_buckets,
            delete_bucket,
            list_tasks,
            create_task,
            update_task,
            delete_task,
            move_task,
            set_task_done
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Wissenszentrum");
}
