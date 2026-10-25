mod db;
mod docs;
mod events;
mod files;
mod finnhub;
mod journal;
mod notes;
mod profile;
mod strategies;
mod sync;
mod tasks;
mod trading;

use db::Db;
use events::{Event, EventInput};
use docs::{DocInput, DocPage};
use notes::{Note, NoteInput};
use profile::{LocationInfo, Profile};
use strategies::{EdgeInput, NodeInput, Strategy, StrategyEdge, StrategyNode};
use trading::{MetalInput, NewExecution, NewTrade, Trade, TradeMeta, TradingState};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use sync::{Acted, Plan, SyncConfig};
use std::sync::{Mutex, MutexGuard};
use tasks::{Bucket, BucketInput, Task, TaskInput};
use tauri::{AppHandle, Emitter, Manager, State};

fn lock<'a>(db: &'a State<Db>) -> Result<MutexGuard<'a, Connection>, String> {
    db.0.lock().map_err(|_| "Datenbank ist gesperrt.".to_string())
}

// --- Erster Start -------------------------------------------------------------

/// Pfade und Zustand des Starts: wo die Konfiguration liegt und welche Datenbank gerade offen ist.
struct AppInfo {
    config_file: PathBuf,
    default_dir: PathBuf,
    /// Datei der geöffneten Datenbank, solange das Onboarding noch aussteht: None
    db_file: Mutex<Option<PathBuf>>,
    /// Hinweis, falls die zuletzt verwendete Datenbank nicht geöffnet werden konnte
    problem: Mutex<Option<String>>,
    /// Sicherungen vor dem Überschreiben durch den Abgleich
    backup_dir: PathBuf,
    /// Hinweis auf einen beim Start geladenen Stand, wird einmal angezeigt
    sync_notice: Mutex<Option<SyncNotice>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppState {
    onboarded: bool,
    profile: Option<Profile>,
    /// Vollständiger Pfad der Datenbankdatei
    db_path: Option<String>,
    /// Vorschlag für den Speicherort im Onboarding
    default_dir: String,
    problem: Option<String>,
}

fn app_state_of(db: &State<Db>, info: &State<AppInfo>) -> Result<AppState, String> {
    let file = info.db_file.lock().map_err(|_| "Zustand ist gesperrt.".to_string())?.clone();
    let problem = info.problem.lock().map_err(|_| "Zustand ist gesperrt.".to_string())?.clone();
    let profile = match &file {
        Some(_) => {
            let conn = lock(db)?;
            profile::read_profile(&conn)?
        }
        None => None,
    };
    Ok(AppState {
        onboarded: file.is_some() && profile.is_some(),
        db_path: file.map(|f| f.to_string_lossy().into_owned()),
        profile,
        default_dir: info.default_dir.to_string_lossy().into_owned(),
        problem,
    })
}

#[tauri::command]
fn app_state(db: State<Db>, info: State<AppInfo>) -> Result<AppState, String> {
    app_state_of(&db, &info)
}

#[tauri::command]
fn inspect_location(dir: String) -> LocationInfo {
    profile::inspect_location(&dir)
}

#[tauri::command]
fn inspect_database_file(path: String) -> LocationInfo {
    profile::inspect_file(&path)
}

/// Öffnet eine vorhandene Datenbankdatei und merkt sich ihren Ort.
#[tauri::command]
fn open_existing_database(db: State<Db>, info: State<AppInfo>, path: String, first_name: String, last_name: String) -> Result<AppState, String> {
    let (conn, file, _) = profile::open_existing(&info.config_file, &path, &first_name, &last_name)?;
    {
        let mut guard = lock(&db)?;
        *guard = conn;
    }
    *info.db_file.lock().map_err(|_| "Zustand ist gesperrt.".to_string())? = Some(file);
    *info.problem.lock().map_err(|_| "Zustand ist gesperrt.".to_string())? = None;
    app_state_of(&db, &info)
}

/// Ändert Vor- und Nachname.
#[tauri::command]
fn update_profile(db: State<Db>, first_name: String, last_name: String) -> Result<profile::Profile, String> {
    let conn = lock(&db)?;
    profile::update_profile(&conn, &first_name, &last_name)
}

#[tauri::command]
fn complete_onboarding(db: State<Db>, info: State<AppInfo>, first_name: String, last_name: String, dir: String) -> Result<AppState, String> {
    let (conn, file, _) = profile::onboard(&info.config_file, &dir, &first_name, &last_name)?;
    {
        let mut guard = lock(&db)?;
        *guard = conn;
    }
    *info.db_file.lock().map_err(|_| "Zustand ist gesperrt.".to_string())? = Some(file);
    *info.problem.lock().map_err(|_| "Zustand ist gesperrt.".to_string())? = None;
    app_state_of(&db, &info)
}

// --- Abgleich zwischen Rechnern ---------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncNotice {
    kind: String,
    device_name: String,
    saved_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteInfo {
    device_name: String,
    saved_at: String,
    /// Der Stand im Ordner stammt von diesem Rechner
    this_device: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatus {
    enabled: bool,
    /// off, uptodate, push, pull, conflict, waiting oder error
    state: String,
    sync_dir: Option<String>,
    device_name: Option<String>,
    remote: Option<RemoteInfo>,
    /// Dieser Rechner hat Änderungen, die noch nicht im Ordner liegen
    local_changes: bool,
    /// Dieser Rechner war noch nie mit dem Ordner abgeglichen
    first_time: bool,
    last_synced_at: Option<String>,
    message: Option<String>,
    /// Was gerade passiert ist: pushed, pulled oder adopted
    acted: Option<String>,
    notice: Option<SyncNotice>,
    suggested_dir: Option<String>,
    default_device_name: String,
}

fn load_sync(config_file: &Path) -> Option<SyncConfig> {
    profile::load_config(config_file).sync
}

fn store_sync(config_file: &Path, sync: Option<SyncConfig>) -> Result<(), String> {
    let mut config = profile::load_config(config_file);
    config.sync = sync;
    profile::save_config(config_file, &config)
}

fn acted_name(acted: Option<Acted>) -> Option<String> {
    acted.map(|a| match a {
        Acted::Pushed => "pushed",
        Acted::Pulled => "pulled",
        Acted::Adopted => "adopted",
    }.to_string())
}

/// Stellt den Abgleich-Zustand für die Anzeige zusammen, ohne etwas zu verändern.
fn make_status(info: &AppInfo, conn: &Connection, acted: Option<Acted>, error: Option<String>) -> SyncStatus {
    let notice = info.sync_notice.lock().ok().and_then(|mut n| n.take());
    let mut status = SyncStatus {
        enabled: false,
        state: "off".into(),
        sync_dir: None,
        device_name: None,
        remote: None,
        local_changes: false,
        first_time: false,
        last_synced_at: None,
        message: None,
        acted: acted_name(acted),
        notice,
        suggested_dir: sync::suggested_dir().map(|p| p.to_string_lossy().into_owned()),
        default_device_name: sync::default_device_name(),
    };
    let Some(cfg) = load_sync(&info.config_file) else { return status };
    status.enabled = true;
    status.sync_dir = Some(cfg.sync_dir.clone());
    status.device_name = Some(cfg.device_name.clone());
    status.last_synced_at = cfg.last_synced_at.clone();
    if let Some(message) = error {
        status.state = "error".into();
        status.message = Some(message);
        return status;
    }
    match sync::evaluate(conn, &cfg) {
        Ok(eval) => {
            status.state = match eval.plan {
                Plan::UpToDate | Plan::Adopt => "uptodate",
                Plan::Push => "push",
                Plan::Pull => "pull",
                Plan::Conflict => "conflict",
                Plan::Waiting => "waiting",
            }
            .into();
            status.local_changes = eval.local_changed;
            status.first_time = eval.first_time;
            status.remote = eval.remote.map(|m| RemoteInfo { this_device: m.device_id == cfg.device_id, device_name: m.device_name, saved_at: m.saved_at });
        }
        Err(e) => {
            status.state = "error".into();
            status.message = Some(e);
        }
    }
    status
}

/// Führt die passende Aktion aus (laden nur, wenn `allow_pull`) und speichert den neuen Abgleich-Stand.
fn run_tick(db: &State<Db>, info: &State<AppInfo>, allow_pull: bool) -> Result<SyncStatus, String> {
    let mut guard = lock(db)?;
    let Some(mut cfg) = load_sync(&info.config_file) else { return Ok(make_status(info, &guard, None, None)) };
    let result = sync::tick(&mut guard, &mut cfg, &info.backup_dir, allow_pull);
    match result {
        Ok((_, acted)) => {
            store_sync(&info.config_file, Some(cfg))?;
            Ok(make_status(info, &guard, acted, None))
        }
        Err(e) => Ok(make_status(info, &guard, None, Some(e))),
    }
}

#[tauri::command]
fn sync_status(db: State<Db>, info: State<AppInfo>) -> Result<SyncStatus, String> {
    let guard = lock(&db)?;
    Ok(make_status(&info, &guard, None, None))
}

/// Schaltet den Abgleich mit dem Ordner ein und gleicht, wenn das ohne Rückfrage geht, gleich ab.
#[tauri::command]
fn sync_enable(db: State<Db>, info: State<AppInfo>, dir: String, device_name: String) -> Result<SyncStatus, String> {
    let dir = profile::prepare_location(&dir)?;
    let name = device_name.split_whitespace().collect::<Vec<_>>().join(" ");
    let name = if name.is_empty() { sync::default_device_name() } else { name };
    if name.chars().count() > 60 {
        return Err("Der Gerätename darf höchstens 60 Zeichen lang sein.".into());
    }
    let cfg = SyncConfig {
        sync_dir: dir.to_string_lossy().into_owned(),
        device_id: sync::new_id(),
        device_name: name,
        base_revision: None,
        synced_fingerprint: None,
        last_synced_at: None,
    };
    store_sync(&info.config_file, Some(cfg))?;
    run_tick(&db, &info, false)
}

/// "Jetzt abgleichen": hochladen oder, wenn lokal nichts geändert wurde, den neuen Stand laden.
#[tauri::command]
fn sync_now(db: State<Db>, info: State<AppInfo>) -> Result<SyncStatus, String> {
    run_tick(&db, &info, true)
}

/// Regelmäßig im Hintergrund: lädt nur hoch, lädt nie von selbst, damit nichts unter der Arbeit wegbricht.
#[tauri::command]
fn sync_tick(db: State<Db>, info: State<AppInfo>) -> Result<SyncStatus, String> {
    run_tick(&db, &info, false)
}

/// Konflikt auflösen: "local" überschreibt den Ordner, "remote" überschreibt diesen Rechner.
#[tauri::command]
fn sync_resolve(db: State<Db>, info: State<AppInfo>, choice: String) -> Result<SyncStatus, String> {
    let keep_local = match choice.as_str() {
        "local" => true,
        "remote" => false,
        _ => return Err("Unbekannte Auswahl.".into()),
    };
    let mut guard = lock(&db)?;
    let mut cfg = load_sync(&info.config_file).ok_or("Der Abgleich ist nicht eingeschaltet.")?;
    let acted = sync::resolve(&mut guard, &mut cfg, &info.backup_dir, keep_local)?;
    store_sync(&info.config_file, Some(cfg))?;
    Ok(make_status(&info, &guard, Some(acted), None))
}

/// Beendet den Abgleich auf diesem Rechner. Dateien im Ordner und lokale Daten bleiben unberührt.
#[tauri::command]
fn sync_disable(db: State<Db>, info: State<AppInfo>) -> Result<SyncStatus, String> {
    store_sync(&info.config_file, None)?;
    let guard = lock(&db)?;
    Ok(make_status(&info, &guard, None, None))
}

/// Beim Schließen: ausstehende Änderungen noch in den Ordner schreiben.
fn push_on_exit(app: &AppHandle) {
    let (Some(db), Some(info)) = (app.try_state::<Db>(), app.try_state::<AppInfo>()) else { return };
    let Some(mut cfg) = load_sync(&info.config_file) else { return };
    let Ok(mut conn) = db.0.lock() else { return };
    if sync::tick(&mut conn, &mut cfg, &info.backup_dir, false).is_ok() {
        let _ = store_sync(&info.config_file, Some(cfg));
    }
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

/// Logbuch zu Positionen.
#[tauri::command]
fn list_journal(db: State<Db>) -> Result<Vec<journal::JournalEntry>, String> {
    let conn = lock(&db)?;
    journal::list(&conn)
}

#[tauri::command]
fn add_journal(db: State<Db>, input: journal::JournalInput) -> Result<journal::JournalEntry, String> {
    let conn = lock(&db)?;
    journal::add(&conn, &input)
}

#[tauri::command]
fn update_journal(db: State<Db>, id: i64, input: journal::JournalEdit) -> Result<journal::JournalEntry, String> {
    let conn = lock(&db)?;
    journal::update(&conn, id, &input)
}

#[tauri::command]
fn delete_journal(db: State<Db>, id: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    journal::delete(&conn, id)
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
fn set_task_dates(db: State<Db>, id: i64, start_date: Option<String>, due_date: Option<String>) -> Result<Task, String> {
    let conn = lock(&db)?;
    tasks::set_task_dates(&conn, id, start_date.as_deref(), due_date.as_deref())
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

// --- Dokumentation ---------------------------------------------------------

#[tauri::command]
fn list_doc_pages(db: State<Db>) -> Result<Vec<DocPage>, String> {
    let conn = lock(&db)?;
    docs::list_pages(&conn)
}

/// Nimmt die Bytes eines Bildes als rohen Anfragekörper entgegen (kein JSON, damit große Bilder schnell sind); den Typ nennt der Header `x-mime`.
#[tauri::command]
fn add_doc_image(db: State<Db>, request: tauri::ipc::Request<'_>) -> Result<i64, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Das Bild kam nicht an.".into());
    };
    let mime = request.headers().get("x-mime").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let conn = lock(&db)?;
    docs::add_image(&conn, &mime, bytes)
}

#[tauri::command]
fn get_doc_image(db: State<Db>, id: i64) -> Result<tauri::ipc::Response, String> {
    let conn = lock(&db)?;
    let (_, data) = docs::get_image(&conn, id)?;
    Ok(tauri::ipc::Response::new(data))
}

/// Speichert einen Dateianhang. Rohe Bytes als Körper, Dateiname (prozentkodiert) und Typ stehen in den Kopfzeilen `x-name` und `x-mime`.
#[tauri::command]
fn add_attachment(db: State<Db>, request: tauri::ipc::Request<'_>) -> Result<files::FileInfo, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Die Datei kam nicht an.".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let name = files::percent_decode(&header("x-name"));
    let conn = lock(&db)?;
    files::add(&conn, &name, &header("x-mime"), bytes)
}

/// Schreibt einen Anhang an einen vom Nutzer gewählten Ort („Speichern unter“).
#[tauri::command]
fn save_attachment(db: State<Db>, id: i64, path: String) -> Result<(), String> {
    let (_, data) = {
        let conn = lock(&db)?;
        files::get(&conn, id)?
    };
    std::fs::write(&path, data).map_err(|e| format!("Die Datei konnte nicht gespeichert werden: {e}"))
}

/// Öffnet einen Anhang mit dem Standardprogramm: wird dafür in einen temporären Ordner geschrieben. Programme und Skripte
/// werden nie direkt geöffnet. Die Datei wird beobachtet: speichert man sie im Programm (z. B. in Word), wandert der neue
/// Stand zurück in den Anhang (`flush_attachments`).
#[tauri::command]
fn open_attachment(db: State<Db>, watches: State<files::Watches>, id: i64) -> Result<(), String> {
    let (name, data) = {
        let conn = lock(&db)?;
        files::get(&conn, id)?
    };
    if !files::can_open(&name) {
        return Err("Dieser Dateityp wird aus Sicherheitsgründen nicht direkt geöffnet. Nutze „Speichern unter“.".into());
    }
    // Ist die Datei schon offen, wird dieselbe wieder gezeigt: sie ist gesperrt und könnte ungespeicherte Änderungen tragen
    let path = match watches.open_path(id) {
        Some(path) => path,
        None => {
            let dir = std::env::temp_dir().join("wissenszentrum-dateien");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("{id}-{name}"));
            std::fs::write(&path, data).map_err(|e| format!("Die Datei konnte nicht vorbereitet werden: {e}"))?;
            watches.watch(id, path.clone());
            path
        }
    };
    #[cfg(windows)]
    let result = std::process::Command::new("explorer.exe").arg(&path).spawn();
    #[cfg(not(windows))]
    let result = std::process::Command::new("xdg-open").arg(&path).spawn();
    result.map(|_| ()).map_err(|e| format!("Die Datei konnte nicht geöffnet werden: {e}"))
}

/// Übernimmt Änderungen an geöffneten Anhängen in die Datenbank und meldet sie der Oberfläche
/// (Ereignis `attachment-changed`, damit z. B. die Größe auf der Karte stimmt).
fn flush_attachments(app: &AppHandle, settle: bool) {
    let (Some(db), Some(watches)) = (app.try_state::<Db>(), app.try_state::<files::Watches>()) else { return };
    if watches.is_empty() {
        return;
    }
    let updated = match db.0.lock() {
        Ok(conn) => files::sync_changes(&conn, &watches, settle),
        Err(_) => return,
    };
    for info in updated {
        let _ = app.emit("attachment-changed", info);
    }
}

#[tauri::command]
fn create_doc_page(db: State<Db>, parent_id: Option<i64>, title: String, kind: String) -> Result<DocPage, String> {
    let conn = lock(&db)?;
    docs::create_page(&conn, parent_id, &title, &kind)
}

#[tauri::command]
fn update_doc_page(db: State<Db>, id: i64, input: DocInput) -> Result<DocPage, String> {
    let conn = lock(&db)?;
    docs::update_page(&conn, id, &input)
}

#[tauri::command]
fn set_doc_favorite(db: State<Db>, id: i64, favorite: bool) -> Result<(), String> {
    let conn = lock(&db)?;
    docs::set_favorite(&conn, id, favorite)
}

#[tauri::command]
fn move_doc_page(db: State<Db>, id: i64, parent_id: Option<i64>) -> Result<(), String> {
    let conn = lock(&db)?;
    docs::move_page(&conn, id, parent_id)
}

/// Setzt eine Seite unter einen Elternteil an eine bestimmte Stelle (Ziehen im Baum).
#[tauri::command]
fn place_doc_page(db: State<Db>, id: i64, parent_id: Option<i64>, index: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    docs::place_page(&conn, id, parent_id, index.max(0) as usize)
}

#[tauri::command]
fn shift_doc_page(db: State<Db>, id: i64, delta: i64) -> Result<(), String> {
    let conn = lock(&db)?;
    docs::shift_page(&conn, id, delta)
}

#[tauri::command]
fn delete_doc_page(db: State<Db>, id: i64) -> Result<usize, String> {
    let conn = lock(&db)?;
    docs::delete_page(&conn, id)
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
fn save_sample(db: State<Db>, value_chf: f64) -> Result<(), String> {
    let conn = lock(&db)?;
    trading::save_sample(&conn, value_chf)
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

    // Alle Symbole gleichzeitig abfragen, damit viele Positionen den Takt der Live-Kurse nicht bremsen
    let client = finnhub::client()?;
    let results = futures_util::future::join_all(symbols.into_iter().map(|symbol| {
        let client = client.clone();
        let key = key.clone();
        async move {
            let result = finnhub::quote(&client, &symbol, &key).await;
            (symbol, result)
        }
    }))
    .await;
    let mut fetched = Vec::new();
    let mut failed = Vec::new();
    let mut first_error: Option<String> = None;
    for (symbol, result) in results {
        match result {
            Ok(price) => fetched.push((symbol, price)),
            Err(e) => {
                first_error.get_or_insert(e);
                failed.push(symbol);
            }
        }
    }
    // Schlägt alles mit demselben Grund fehl (ungültiger Key, Limit erreicht, kein Netz), nennt die Meldung ihn
    if fetched.is_empty() && !failed.is_empty() {
        if let Some(e) = first_error.filter(|e| !e.starts_with("Kein Kurs für")) {
            return Err(e);
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

/// Kursverlauf eines Symbols für die Detailansicht (ohne API-Key).
#[tauri::command]
async fn asset_chart(symbol: String, range: String) -> Result<finnhub::AssetChart, String> {
    finnhub::chart(&symbol, &range).await
}

/// Firmendaten eines Symbols; ohne Key oder ohne Treffer leer.
#[tauri::command]
async fn asset_profile(db: State<'_, Db>, symbol: String) -> Result<finnhub::AssetProfile, String> {
    let key = {
        let conn = lock(&db)?;
        trading::get_setting(&conn, "finnhub_api_key")?
    };
    match key.filter(|k| !k.trim().is_empty()) {
        Some(key) => finnhub::profile(&symbol, &key).await,
        None => Ok(finnhub::AssetProfile::default()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            // Mit eingeschaltetem Abgleich erst die letzten Änderungen in den Ordner schreiben, dann schließen
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                // Was in Word gerade gespeichert wurde, soll nicht verloren gehen
                flush_attachments(&app, false);
                let Some(info) = app.try_state::<AppInfo>() else { return };
                if load_sync(&info.config_file).is_none() {
                    return;
                }
                api.prevent_close();
                let window = window.clone();
                std::thread::spawn(move || {
                    push_on_exit(&app);
                    let _ = window.destroy();
                });
            }
        })
        .setup(|app| {
            // Windows: %APPDATA%\com.armin.wissenszentrum\config.json merkt sich den Speicherort der Datenbank
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let config_file = data_dir.join("config.json");
            let configured = profile::read_config(&config_file);
            let default_dir = configured
                .as_ref()
                .and_then(|file| file.parent().map(PathBuf::from))
                .or_else(|| app.path().document_dir().ok().map(|d| d.join("Wissenszentrum")))
                .unwrap_or_else(|| data_dir.clone());

            // Nur mit Konfiguration und gespeichertem Profil gilt das Onboarding als abgeschlossen
            let mut opened: Option<(Connection, PathBuf)> = None;
            let mut problem = None;
            if let Some(file) = configured {
                if !file.is_file() {
                    // Nicht neu anlegen: Laufwerk oder Ordner fehlt vielleicht nur vorübergehend
                    problem = Some(format!("Die Datenbank unter „{}“ wurde nicht gefunden.", file.display()));
                } else {
                    match profile::open_file(&file) {
                        Ok(conn) if matches!(profile::read_profile(&conn), Ok(Some(_))) => opened = Some((conn, file)),
                        Ok(_) => {}
                        Err(e) => problem = Some(format!("Die Datenbank unter „{}“ konnte nicht geöffnet werden. {e}", file.display())),
                    }
                }
            }
            // Beim Start: unterwegs hochgeladene Änderungen anderer Rechner laden, solange hier nichts geändert wurde
            let backup_dir = data_dir.join("sicherungen");
            let mut notice = None;
            if let Some((conn, _)) = opened.as_mut() {
                if let Some(mut cfg) = load_sync(&config_file) {
                    if let Ok((eval, acted)) = sync::tick(conn, &mut cfg, &backup_dir, true) {
                        let _ = store_sync(&config_file, Some(cfg));
                        if let (Some(Acted::Pulled), Some(remote)) = (acted, eval.remote) {
                            notice = Some(SyncNotice { kind: "pulled".into(), device_name: remote.device_name, saved_at: remote.saved_at });
                        }
                    }
                }
            }
            let (conn, db_file) = match opened {
                Some((conn, file)) => (conn, Some(file)),
                None => {
                    // Platzhalter bis zum Onboarding, damit alle Befehle eine Verbindung vorfinden
                    let conn = Connection::open_in_memory()?;
                    db::init(&conn)?;
                    (conn, None)
                }
            };
            app.manage(Db(Mutex::new(conn)));
            app.manage(files::Watches::default());
            // Speichert man einen geöffneten Anhang im Programm, landet der neue Stand nach kurzer Zeit im Anhang
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                flush_attachments(&handle, true);
            });
            app.manage(AppInfo {
                config_file,
                default_dir,
                db_file: Mutex::new(db_file),
                problem: Mutex::new(problem),
                backup_dir,
                sync_notice: Mutex::new(notice),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_state,
            sync_status,
            sync_enable,
            sync_now,
            sync_tick,
            sync_resolve,
            sync_disable,
            inspect_location,
            inspect_database_file,
            open_existing_database,
            complete_onboarding,
            update_profile,
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
            set_task_dates,
            set_task_done,
            list_notes,
            create_note,
            update_note,
            set_note_pinned,
            delete_note,
            purge_empty_notes,
            list_doc_pages,
            add_doc_image,
            get_doc_image,
            add_attachment,
            save_attachment,
            open_attachment,
            create_doc_page,
            update_doc_page,
            set_doc_favorite,
            move_doc_page,
            shift_doc_page,
            place_doc_page,
            delete_doc_page,
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
            save_sample,
            get_api_key,
            save_api_key,
            refresh_quotes,
            asset_chart,
            list_journal,
            add_journal,
            update_journal,
            delete_journal,
            asset_profile,
            search_symbols
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von Wissenszentrum");
}
