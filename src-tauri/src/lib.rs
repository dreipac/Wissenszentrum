mod db;
mod events;
mod finnhub;
mod notes;
mod strategies;
mod tasks;
mod trading;

use db::Db;
use events::{Event, EventInput};
use notes::{Note, NoteInput};
use strategies::{EdgeInput, NodeInput, Strategy, StrategyEdge, StrategyNode};
use trading::{MetalInput, NewExecution, NewTrade, Trade, TradeMeta, TradingState};
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
fn set_subtask_done(db: State<Db>, id: i64, done: bool) -> Result<Task, String> {
    let conn = lock(&db)?;
    tasks::set_subtask_done(&conn, id, done)
}

#[tauri::command]
fn set_task_done(db: State<Db>, id: i64, done: bool) -> Result<Task, String> {
    let conn = lock(&db)?;
    tasks::set_task_done(&conn, id, done)
}

// --- Notizen ----------------------------------------------------------------

#[tauri::command]
fn list_notes(db: State<Db>) -> Result<Vec<Note>, String> {
    let conn = lock(&db)?;
    notes::list_notes(&conn)
}

#[tauri::command]
fn create_note(db: State<Db>, input: NoteInput) -> Result<Note, String> {
    let conn = lock(&db)?;
    notes::create_note(&conn, &input)
}

#[tauri::command]
fn update_note(db: State<Db>, id: i64, input: NoteInput) -> Result<Note, String> {
    let conn = lock(&db)?;
    notes::update_note(&conn, id, &input)
}

#[tauri::command]
fn set_note_pinned(db: State<Db>, id: i64, pinned: bool) -> Result<Note, String> {
    let conn = lock(&db)?;
    notes::set_note_pinned(&conn, id, pinned)
}

#[tauri::command]
fn delete_note(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    notes::delete_note(&conn, id)
}

#[tauri::command]
fn purge_empty_notes(db: State<Db>, except_id: Option<i64>) -> Result<usize, String> {
    let conn = lock(&db)?;
    notes::purge_empty_notes(&conn, except_id)
}

// --- Strategien -------------------------------------------------------------

#[tauri::command]
fn list_strategies(db: State<Db>) -> Result<Vec<Strategy>, String> {
    let conn = lock(&db)?;
    strategies::list_strategies(&conn)
}

#[tauri::command]
fn create_strategy(db: State<Db>, title: String) -> Result<i64, String> {
    let conn = lock(&db)?;
    strategies::create_strategy(&conn, &title)
}

#[tauri::command]
fn rename_strategy(db: State<Db>, id: i64, title: String) -> Result<(), String> {
    let conn = lock(&db)?;
    strategies::rename_strategy(&conn, id, &title)
}

#[tauri::command]
fn delete_strategy(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    strategies::delete_strategy(&conn, id)
}

#[tauri::command]
fn create_strategy_node(db: State<Db>, strategy_id: i64, input: NodeInput) -> Result<StrategyNode, String> {
    let conn = lock(&db)?;
    strategies::create_node(&conn, strategy_id, &input)
}

#[tauri::command]
fn update_strategy_node(db: State<Db>, id: i64, input: NodeInput) -> Result<(), String> {
    let conn = lock(&db)?;
    strategies::update_node(&conn, id, &input)
}

#[tauri::command]
fn move_strategy_node(db: State<Db>, id: i64, x: f64, y: f64) -> Result<(), String> {
    let conn = lock(&db)?;
    strategies::move_node(&conn, id, x, y)
}

#[tauri::command]
fn delete_strategy_node(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    strategies::delete_node(&conn, id)
}

#[tauri::command]
fn create_strategy_edge(db: State<Db>, strategy_id: i64, input: EdgeInput) -> Result<StrategyEdge, String> {
    let conn = lock(&db)?;
    strategies::create_edge(&conn, strategy_id, &input)
}

#[tauri::command]
fn update_strategy_edge(db: State<Db>, id: i64, label: String, polarity: String) -> Result<(), String> {
    let conn = lock(&db)?;
    strategies::update_edge(&conn, id, &label, &polarity)
}

#[tauri::command]
fn delete_strategy_edge(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    strategies::delete_edge(&conn, id)
}

// --- Trading ----------------------------------------------------------------

#[tauri::command]
fn trading_state(db: State<Db>) -> Result<TradingState, String> {
    let conn = lock(&db)?;
    trading::state(&conn)
}

#[tauri::command]
fn create_trade(db: State<Db>, input: NewTrade) -> Result<Trade, String> {
    let conn = lock(&db)?;
    trading::create_trade(&conn, &input)
}

#[tauri::command]
fn execute_order(db: State<Db>, id: i64, input: NewExecution) -> Result<Trade, String> {
    let conn = lock(&db)?;
    trading::execute_order(&conn, id, &input)
}

#[tauri::command]
fn add_execution(db: State<Db>, id: i64, input: NewExecution) -> Result<Trade, String> {
    let conn = lock(&db)?;
    trading::add_execution(&conn, id, &input)
}

#[tauri::command]
fn update_trade(db: State<Db>, id: i64, input: TradeMeta) -> Result<Trade, String> {
    let conn = lock(&db)?;
    trading::update_trade(&conn, id, &input)
}

#[tauri::command]
fn delete_trade(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::delete_trade(&conn, id)
}

#[tauri::command]
fn add_cash_movement(db: State<Db>, kind: String, amount: f64, note: String, occurred_at: String) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::add_cash_movement(&conn, &kind, amount, &note, &occurred_at)
}

#[tauri::command]
fn delete_cash_movement(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::delete_cash_movement(&conn, id)
}

#[tauri::command]
fn create_metal(db: State<Db>, input: MetalInput) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::create_metal(&conn, &input)
}

#[tauri::command]
fn update_metal(db: State<Db>, id: i64, input: MetalInput) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::update_metal(&conn, id, &input)
}

#[tauri::command]
fn delete_metal(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::delete_metal(&conn, id)
}

#[tauri::command]
fn set_quote(db: State<Db>, symbol: String, price: f64) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::set_quote(&conn, &symbol, price)
}

#[tauri::command]
fn save_snapshot(db: State<Db>, day: String, value_chf: f64) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::save_snapshot(&conn, &day, value_chf)
}

#[tauri::command]
fn get_api_key(db: State<Db>) -> Result<String, String> {
    let conn = lock(&db)?;
    Ok(trading::get_setting(&conn, "finnhub_api_key")?.unwrap_or_default())
}

/// Speichert den Finnhub-Key, nachdem er mit einer Testabfrage geprüft wurde (leer = Key entfernen).
#[tauri::command]
async fn save_api_key(db: State<'_, Db>, api_key: String) -> Result<(), String> {
    let key = api_key.trim().to_string();
    if !key.is_empty() {
        finnhub::test_key(&key).await?;
    }
    let conn = lock(&db)?;
    trading::set_setting(&conn, "finnhub_api_key", &key)
}

/// Holt aktuelle Kurse aller offenen Positionen und Orders und speichert sie.
#[tauri::command]
async fn refresh_quotes(db: State<'_, Db>) -> Result<finnhub::RefreshResult, String> {
    // Datenbank nicht über await-Punkte hinweg sperren
    let (key, symbols) = {
        let conn = lock(&db)?;
        (trading::get_setting(&conn, "finnhub_api_key")?, trading::tracked_symbols(&conn)?)
    };
    let key = key
        .filter(|k| !k.trim().is_empty())
        .ok_or("Kein Finnhub-API-Key hinterlegt. Trage ihn unter Einstellungen ein.")?;

    let client = finnhub::client()?;
    let mut fetched = Vec::new();
    let mut failed = Vec::new();
    for symbol in symbols {
        match finnhub::quote(&client, &symbol, &key).await {
            Ok(price) => fetched.push((symbol, price)),
            Err(_) => failed.push(symbol),
        }
    }

    let conn = lock(&db)?;
    for (symbol, price) in &fetched {
        trading::set_quote(&conn, symbol, *price)?;
    }
    Ok(finnhub::RefreshResult { updated: fetched.len(), failed })
}

#[tauri::command]
async fn search_symbols(db: State<'_, Db>, query: String) -> Result<Vec<finnhub::SymbolMatch>, String> {
    let key = {
        let conn = lock(&db)?;
        trading::get_setting(&conn, "finnhub_api_key")?
    };
    match key.filter(|k| !k.trim().is_empty()) {
        Some(key) => finnhub::search(&query, &key).await,
        None => Ok(vec![]),
    }
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
            set_subtask_done,
            set_task_done,
            list_notes,
            create_note,
            update_note,
            set_note_pinned,
            delete_note,
            purge_empty_notes,
            list_strategies,
            create_strategy,
            rename_strategy,
            delete_strategy,
            create_strategy_node,
            update_strategy_node,
            move_strategy_node,
            delete_strategy_node,
            create_strategy_edge,
            update_strategy_edge,
            delete_strategy_edge,
            trading_state,
            create_trade,
            execute_order,
            add_execution,
            update_trade,
            delete_trade,
            add_cash_movement,
            delete_cash_movement,
            create_metal,
            update_metal,
            delete_metal,
            set_quote,
            save_snapshot,
            get_api_key,
            save_api_key,
            refresh_quotes,
            search_symbols
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Wissenszentrum");
}
