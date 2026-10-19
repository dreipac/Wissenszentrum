//! Abgleich zwischen Rechnern über einen gemeinsamen Ordner (z. B. OneDrive).
//!
//! Jeder Rechner arbeitet mit seiner eigenen lokalen Datenbank. Im Abgleich-Ordner liegt ein einzelner, in sich
//! stimmiger Stand (`wissenszentrum-abgleich.db`) samt Beschreibung (`wissenszentrum-abgleich.json`). OneDrive
//! sieht dadurch nie eine Datenbank, in die gerade geschrieben wird.
//!
//! Ob etwas abzugleichen ist, entscheiden zwei Merkmale, die jeder Rechner für sich speichert:
//! - `base_revision`: welcher Stand aus dem Ordner zuletzt geladen oder dorthin geschrieben wurde
//! - `synced_fingerprint`: Fingerabdruck des Dateninhalts zu diesem Zeitpunkt
//!
//! Ist der Ordner unverändert und lokal etwas anders, wird hochgeladen. Ist der Ordner neuer und lokal nichts
//! anders, wird geladen. Haben beide Seiten Änderungen, gibt es einen Konflikt, den der Mensch entscheidet.
//! Bevor etwas überschrieben wird, entsteht eine Sicherung im lokalen Datenordner.

use crate::{db, trading};
use rusqlite::{backup::Backup, types::ValueRef, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const SNAPSHOT_FILE: &str = "wissenszentrum-abgleich.db";
pub const MANIFEST_FILE: &str = "wissenszentrum-abgleich.json";
const MANIFEST_FORMAT: u32 = 1;
/// Pro Rechner gespeichert und nie in den Abgleich-Ordner geschrieben
const KEY_API: &str = "finnhub_api_key";
/// Zwischenspeicher, die sich von selbst ändern: zählen nicht als Änderung durch den Nutzer
const VOLATILE_TABLES: [&str; 3] = ["quotes", "portfolio_snapshots", "portfolio_samples"];
const KEEP_BACKUPS: usize = 10;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncConfig {
    pub sync_dir: String,
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub base_revision: Option<String>,
    #[serde(default)]
    pub synced_fingerprint: Option<String>,
    #[serde(default)]
    pub last_synced_at: Option<String>,
}

/// Beschreibung des Stands im Abgleich-Ordner.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifest {
    pub app: String,
    pub format: u32,
    pub revision: String,
    pub parent: Option<String>,
    pub device_id: String,
    pub device_name: String,
    /// UTC, `YYYY-MM-DD HH:MM:SS`
    pub saved_at: String,
    pub fingerprint: String,
    pub size_bytes: u64,
    pub db_version: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    /// Nichts zu tun
    UpToDate,
    /// Der Ordner hat denselben Inhalt wie hier; nur den Bezug merken
    Adopt,
    /// Lokal gibt es Änderungen, der Ordner ist unverändert: hochladen
    Push,
    /// Im Ordner liegt ein neuerer Stand, lokal gibt es keine Änderungen: laden
    Pull,
    /// Beide Seiten haben Änderungen (oder es ist der erste Abgleich mit unterschiedlichem Inhalt)
    Conflict,
    /// Der Stand im Ordner ist noch nicht vollständig synchronisiert (OneDrive lädt noch)
    Waiting,
}

#[derive(Debug, Clone)]
pub struct Evaluation {
    pub plan: Plan,
    pub remote: Option<Manifest>,
    pub local_changed: bool,
    /// Erster Abgleich: dieser Rechner hat noch nie mit dem Ordner abgeglichen
    pub first_time: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Acted {
    Pushed,
    Pulled,
    Adopted,
}

// --- Hilfen -----------------------------------------------------------------

/// Zufällige Kennung (Revision, Geräte-ID). Kein Sicherheitsmerkmal, nur eindeutig genug.
pub fn new_id() -> String {
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    hasher.write_u128(nanos);
    hasher.write_u32(std::process::id());
    format!("{:016x}", hasher.finish())
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn now_utc(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT datetime('now')", [], |r| r.get(0)).map_err(db_err)
}

fn stamp(conn: &Connection) -> Result<String, String> {
    conn.query_row("SELECT strftime('%Y%m%d-%H%M%S', 'now')", [], |r| r.get(0)).map_err(db_err)
}

/// FNV-1a, 64 Bit: einfach und auf jedem Rechner gleich.
struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf29ce484222325)
    }
    fn write(&mut self, bytes: &[u8]) {
        for b in bytes {
            self.0 ^= *b as u64;
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }
    fn byte(&mut self, b: u8) {
        self.write(&[b]);
    }
}

/// Fingerabdruck des Dateninhalts. Zwischenspeicher (Kurse, Tagesstände) und der API-Key zählen nicht mit.
pub fn fingerprint(conn: &Connection) -> Result<String, String> {
    let mut hash = Fnv::new();
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(db_err)?;
    let tables: Vec<String> = stmt.query_map([], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    for table in tables.iter().filter(|t| !VOLATILE_TABLES.contains(&t.as_str())) {
        hash.write(table.as_bytes());
        hash.byte(0xFE);
        let sql = if table == "settings" {
            format!("SELECT * FROM settings WHERE key <> '{KEY_API}' ORDER BY rowid")
        } else {
            format!("SELECT * FROM \"{table}\" ORDER BY rowid")
        };
        let mut stmt = conn.prepare(&sql).map_err(db_err)?;
        let columns = stmt.column_count();
        let mut rows = stmt.query([]).map_err(db_err)?;
        while let Some(row) = rows.next().map_err(db_err)? {
            for i in 0..columns {
                match row.get_ref(i).map_err(db_err)? {
                    ValueRef::Null => hash.byte(0),
                    ValueRef::Integer(n) => {
                        hash.byte(1);
                        hash.write(&n.to_le_bytes());
                    }
                    ValueRef::Real(f) => {
                        hash.byte(2);
                        hash.write(&f.to_bits().to_le_bytes());
                    }
                    ValueRef::Text(t) => {
                        hash.byte(3);
                        hash.write(&(t.len() as u64).to_le_bytes());
                        hash.write(t);
                    }
                    ValueRef::Blob(b) => {
                        hash.byte(4);
                        hash.write(&(b.len() as u64).to_le_bytes());
                        hash.write(b);
                    }
                }
            }
            hash.byte(0xFF);
        }
    }
    Ok(format!("{:016x}", hash.0))
}

// --- Ordner lesen und schreiben ----------------------------------------------

enum Remote {
    None,
    Ready(Manifest),
    /// Beschreibung vorhanden, aber die Datenbankdatei fehlt oder ist noch nicht komplett
    Incomplete,
}

fn read_remote(dir: &Path) -> Result<Remote, String> {
    if !dir.is_dir() {
        return Err(format!("Der Abgleich-Ordner „{}“ wurde nicht gefunden.", dir.display()));
    }
    let manifest_path = dir.join(MANIFEST_FILE);
    if !manifest_path.is_file() {
        return Ok(Remote::None);
    }
    let text = std::fs::read_to_string(&manifest_path).map_err(|e| format!("Der Abgleich-Stand konnte nicht gelesen werden: {e}"))?;
    let manifest: Manifest = match serde_json::from_str(&text) {
        Ok(m) => m,
        // Datei wird gerade erst synchronisiert
        Err(_) => return Ok(Remote::Incomplete),
    };
    if manifest.app != "wissenszentrum" || manifest.format > MANIFEST_FORMAT {
        return Err("Der Abgleich-Ordner enthält einen Stand, den diese Version nicht versteht. Bitte aktualisiere die App.".into());
    }
    match std::fs::metadata(dir.join(SNAPSHOT_FILE)) {
        Ok(meta) if meta.len() == manifest.size_bytes => Ok(Remote::Ready(manifest)),
        _ => Ok(Remote::Incomplete),
    }
}

/// Schreibt `bytes` zuerst in eine Zwischendatei und ersetzt dann das Ziel, damit nie eine halbe Datei liegt.
fn replace_file(target: &Path, write: impl FnOnce(&Path) -> Result<(), String>) -> Result<(), String> {
    let tmp = target.with_file_name(format!("{}.tmp", target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    let _ = std::fs::remove_file(&tmp);
    write(&tmp)?;
    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Der Abgleich-Ordner ist gerade nicht beschreibbar (läuft die Synchronisierung noch?): {e}")
    })
}

/// Entfernt die ältesten Sicherungen mit diesem Namensanfang, es bleiben die neuesten `KEEP_BACKUPS`.
fn prune_backups(dir: &Path, prefix: &str) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(prefix) && n.ends_with(".db"))
        .collect();
    names.sort();
    while names.len() > KEEP_BACKUPS {
        let _ = std::fs::remove_file(dir.join(names.remove(0)));
    }
}

fn vacuum_into(conn: &Connection, target: &Path) -> Result<(), String> {
    let _ = std::fs::remove_file(target);
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()]).map_err(db_err)?;
    Ok(())
}

// --- Bewerten ------------------------------------------------------------------

pub fn evaluate(conn: &Connection, cfg: &SyncConfig) -> Result<Evaluation, String> {
    let remote = read_remote(Path::new(&cfg.sync_dir))?;
    let fp = fingerprint(conn)?;
    let local_changed = cfg.synced_fingerprint.as_deref() != Some(fp.as_str());
    let first_time = cfg.base_revision.is_none();
    let (plan, manifest) = match remote {
        Remote::None => (Plan::Push, None),
        Remote::Incomplete => (Plan::Waiting, None),
        Remote::Ready(m) => {
            let plan = if cfg.base_revision.as_deref() == Some(m.revision.as_str()) {
                if local_changed {
                    Plan::Push
                } else {
                    Plan::UpToDate
                }
            } else if m.fingerprint == fp {
                Plan::Adopt
            } else if first_time || local_changed {
                Plan::Conflict
            } else {
                Plan::Pull
            };
            (plan, Some(m))
        }
    };
    Ok(Evaluation { plan, remote: manifest, local_changed, first_time })
}

// --- Handeln -------------------------------------------------------------------

/// Schreibt den lokalen Stand in den Abgleich-Ordner und merkt ihn als abgeglichen.
pub fn push(conn: &Connection, cfg: &mut SyncConfig) -> Result<Manifest, String> {
    let dir = Path::new(&cfg.sync_dir);
    if !dir.is_dir() {
        return Err(format!("Der Abgleich-Ordner „{}“ wurde nicht gefunden.", dir.display()));
    }
    let fp = fingerprint(conn)?;
    let saved_at = now_utc(conn)?;
    let db_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db_err)?;

    replace_file(&dir.join(SNAPSHOT_FILE), |tmp| {
        vacuum_into(conn, tmp)?;
        // Der API-Key bleibt auf diesem Rechner
        let copy = Connection::open(tmp).map_err(db_err)?;
        copy.execute("DELETE FROM settings WHERE key = ?1", [KEY_API]).map_err(db_err)?;
        Ok(())
    })?;
    let size_bytes = std::fs::metadata(dir.join(SNAPSHOT_FILE)).map_err(|e| e.to_string())?.len();

    let manifest = Manifest {
        app: "wissenszentrum".into(),
        format: MANIFEST_FORMAT,
        revision: new_id(),
        parent: cfg.base_revision.clone(),
        device_id: cfg.device_id.clone(),
        device_name: cfg.device_name.clone(),
        saved_at: saved_at.clone(),
        fingerprint: fp.clone(),
        size_bytes,
        db_version,
    };
    // Die Beschreibung kommt zuletzt: Sie zeigt anderen Rechnern, dass der Stand komplett ist
    replace_file(&dir.join(MANIFEST_FILE), |tmp| {
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
        std::fs::write(tmp, json).map_err(|e| e.to_string())
    })?;

    cfg.base_revision = Some(manifest.revision.clone());
    cfg.synced_fingerprint = Some(fp);
    cfg.last_synced_at = Some(saved_at);
    Ok(manifest)
}

/// Lädt den Stand aus dem Ordner in die lokale Datenbank. Davor entsteht eine Sicherung des lokalen Stands.
pub fn pull(conn: &mut Connection, cfg: &mut SyncConfig, backup_dir: &Path, remote: &Manifest) -> Result<(), String> {
    let dir = Path::new(&cfg.sync_dir);
    std::fs::create_dir_all(backup_dir).map_err(|e| format!("Der Sicherungsordner konnte nicht angelegt werden: {e}"))?;

    // Erst lokal prüfen, dann erst etwas verändern
    let tmp = backup_dir.join("abgleich-geladen.tmp.db");
    let _ = std::fs::remove_file(&tmp);
    std::fs::copy(dir.join(SNAPSHOT_FILE), &tmp).map_err(|e| format!("Der Stand im Ordner konnte nicht gelesen werden: {e}"))?;
    let result = restore_from(conn, cfg, backup_dir, &tmp, remote);
    let _ = std::fs::remove_file(&tmp);
    result
}

fn restore_from(conn: &mut Connection, cfg: &mut SyncConfig, backup_dir: &Path, copy: &Path, remote: &Manifest) -> Result<(), String> {
    {
        let src = Connection::open_with_flags(copy, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(db_err)?;
        let check: String = src.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|_| "Der Stand im Ordner ist beschädigt.".to_string())?;
        if check != "ok" {
            return Err("Der Stand im Ordner ist beschädigt.".into());
        }
        let version: i64 = src.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(db_err)?;
        if version as usize > db::MIGRATIONS.len() {
            return Err("Der Stand im Ordner stammt aus einer neueren Version des Wissenszentrums. Bitte aktualisiere zuerst die App.".into());
        }
        if version < 1 {
            return Err("Der Stand im Ordner ist keine Datenbank des Wissenszentrums.".into());
        }

        // Sicherung des lokalen Stands, bevor er überschrieben wird
        let backup = backup_dir.join(format!("sicherung-vor-laden-{}.db", stamp(conn)?));
        vacuum_into(conn, &backup)?;
        prune_backups(backup_dir, "sicherung-vor-laden-");

        let key = trading::get_setting(conn, KEY_API)?;
        {
            let backup = Backup::new(&src, conn).map_err(db_err)?;
            backup.run_to_completion(128, Duration::from_millis(0), None).map_err(db_err)?;
        }
        // Ältere Stände auf das aktuelle Schema bringen und den eigenen API-Key wiederherstellen
        db::init(conn).map_err(db_err)?;
        if let Some(key) = key {
            trading::set_setting(conn, KEY_API, &key)?;
        }
    }
    cfg.base_revision = Some(remote.revision.clone());
    cfg.synced_fingerprint = Some(fingerprint(conn)?);
    cfg.last_synced_at = Some(now_utc(conn)?);
    Ok(())
}

/// Hält fest, dass der Ordner und dieser Rechner denselben Inhalt haben.
pub fn adopt(conn: &Connection, cfg: &mut SyncConfig, remote: &Manifest) -> Result<(), String> {
    cfg.base_revision = Some(remote.revision.clone());
    cfg.synced_fingerprint = Some(fingerprint(conn)?);
    cfg.last_synced_at = Some(now_utc(conn)?);
    Ok(())
}

/// Führt die ungefährliche Aktion aus, die zur Lage passt: hochladen, übernehmen und, wenn erlaubt, laden.
/// Konflikte und Wartezustände bleiben unangetastet.
pub fn tick(conn: &mut Connection, cfg: &mut SyncConfig, backup_dir: &Path, allow_pull: bool) -> Result<(Evaluation, Option<Acted>), String> {
    let eval = evaluate(conn, cfg)?;
    let acted = match (eval.plan, &eval.remote) {
        (Plan::Push, _) => {
            push(conn, cfg)?;
            Some(Acted::Pushed)
        }
        (Plan::Adopt, Some(remote)) => {
            adopt(conn, cfg, remote)?;
            Some(Acted::Adopted)
        }
        (Plan::Pull, Some(remote)) if allow_pull => {
            let remote = remote.clone();
            pull(conn, cfg, backup_dir, &remote)?;
            Some(Acted::Pulled)
        }
        _ => None,
    };
    Ok((eval, acted))
}

/// Löst einen Konflikt auf: `local` überschreibt den Ordner, sonst überschreibt der Ordner diesen Rechner.
/// Der überschriebene Stand wird vorher gesichert.
pub fn resolve(conn: &mut Connection, cfg: &mut SyncConfig, backup_dir: &Path, keep_local: bool) -> Result<Acted, String> {
    let eval = evaluate(conn, cfg)?;
    if eval.plan == Plan::Waiting {
        return Err("Der Stand im Abgleich-Ordner ist noch nicht vollständig synchronisiert. Bitte warte kurz und versuche es erneut.".into());
    }
    if keep_local {
        if eval.remote.is_some() {
            // Den Stand im Ordner vor dem Überschreiben lokal sichern
            std::fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
            let target = backup_dir.join(format!("sicherung-ordner-{}.db", stamp(conn)?));
            std::fs::copy(Path::new(&cfg.sync_dir).join(SNAPSHOT_FILE), &target).map_err(|e| format!("Die Sicherung des Ordner-Stands ist fehlgeschlagen: {e}"))?;
            prune_backups(backup_dir, "sicherung-ordner-");
        }
        push(conn, cfg)?;
        Ok(Acted::Pushed)
    } else {
        let remote = eval.remote.ok_or("Im Abgleich-Ordner liegt noch kein Stand.")?;
        pull(conn, cfg, backup_dir, &remote)?;
        Ok(Acted::Pulled)
    }
}

/// Rechnername für die Anzeige im Abgleich.
pub fn default_device_name() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Dieser Rechner".into())
}

/// Vorschlag für den Abgleich-Ordner: im OneDrive-Ordner, falls vorhanden.
pub fn suggested_dir() -> Option<PathBuf> {
    ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(|var| std::env::var(var).ok())
        .map(PathBuf::from)
        .find(|p| p.is_dir())
        .map(|p| p.join("Wissenszentrum-Abgleich"))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("wz-sync-{name}-{}-{unique}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Ein Rechner: eigene Datenbankdatei, eigene Sicherungen, eigene Abgleich-Einstellungen.
    struct Device {
        conn: Connection,
        cfg: SyncConfig,
        backups: PathBuf,
    }

    fn device(root: &Path, name: &str, shared: &Path) -> Device {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("db.sqlite")).unwrap();
        db::init(&conn).unwrap();
        Device {
            conn,
            cfg: SyncConfig {
                sync_dir: shared.to_string_lossy().into_owned(),
                device_id: new_id(),
                device_name: name.into(),
                base_revision: None,
                synced_fingerprint: None,
                last_synced_at: None,
            },
            backups: dir.join("backups"),
        }
    }

    fn add_bucket(d: &Device, name: &str) {
        d.conn.execute("INSERT INTO buckets (name) VALUES (?1)", [name]).unwrap();
    }

    fn buckets(d: &Device) -> Vec<String> {
        let mut stmt = d.conn.prepare("SELECT name FROM buckets ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    }

    fn plan(d: &Device) -> Plan {
        evaluate(&d.conn, &d.cfg).unwrap().plan
    }

    fn tick_all(d: &mut Device) -> (Plan, Option<Acted>) {
        let (eval, acted) = tick(&mut d.conn, &mut d.cfg, &d.backups, true).unwrap();
        (eval.plan, acted)
    }

    #[test]
    fn fingerprint_tracks_content_but_ignores_caches_and_api_key() {
        let tmp = TempDir::new("fp");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let d = device(&tmp.0, "a", &shared);
        let base = fingerprint(&d.conn).unwrap();
        assert_eq!(base, fingerprint(&d.conn).unwrap(), "stabil");

        d.conn.execute("INSERT INTO quotes (symbol, price, updated_at) VALUES ('BLK', 1.0, 'x')", []).unwrap();
        d.conn.execute("INSERT INTO portfolio_snapshots (day, value_chf) VALUES ('2026-01-01', 5.0)", []).unwrap();
        trading::set_setting(&d.conn, KEY_API, "geheim").unwrap();
        assert_eq!(base, fingerprint(&d.conn).unwrap(), "Kurse, Tagesstände und API-Key zählen nicht");

        add_bucket(&d, "Backlog");
        let changed = fingerprint(&d.conn).unwrap();
        assert_ne!(base, changed);
        d.conn.execute("UPDATE buckets SET name = 'Backlog2'", []).unwrap();
        assert_ne!(changed, fingerprint(&d.conn).unwrap(), "auch Änderungen an Werten");
        d.conn.execute("DELETE FROM buckets", []).unwrap();
        assert_eq!(base, fingerprint(&d.conn).unwrap(), "Löschen führt zurück zum Ausgangsstand");
    }

    #[test]
    fn push_writes_complete_snapshot_without_api_key() {
        let tmp = TempDir::new("push");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let mut a = device(&tmp.0, "a", &shared);
        add_bucket(&a, "Backlog");
        trading::set_setting(&a.conn, KEY_API, "geheim").unwrap();
        assert_eq!(plan(&a), Plan::Push, "ohne Stand im Ordner wird hochgeladen");

        let manifest = push(&a.conn, &mut a.cfg).unwrap();
        assert_eq!(manifest.size_bytes, std::fs::metadata(shared.join(SNAPSHOT_FILE)).unwrap().len());
        assert_eq!(a.cfg.base_revision.as_deref(), Some(manifest.revision.as_str()));
        assert_eq!(plan(&a), Plan::UpToDate);
        assert!(!shared.join(format!("{SNAPSHOT_FILE}.tmp")).exists() && !shared.join(format!("{MANIFEST_FILE}.tmp")).exists());

        let snap = Connection::open(shared.join(SNAPSHOT_FILE)).unwrap();
        assert_eq!(trading::get_setting(&snap, KEY_API).unwrap(), None, "der API-Key verlässt den Rechner nicht");
        let n: i64 = snap.query_row("SELECT COUNT(*) FROM buckets", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        assert_eq!(trading::get_setting(&a.conn, KEY_API).unwrap().as_deref(), Some("geheim"), "lokal bleibt er erhalten");
    }

    #[test]
    fn two_devices_hand_work_back_and_forth() {
        let tmp = TempDir::new("flow");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let mut home = device(&tmp.0, "pc", &shared);
        let mut school = device(&tmp.0, "laptop", &shared);

        // Zuhause arbeiten, hochladen
        add_bucket(&home, "Daheim");
        assert_eq!(tick_all(&mut home), (Plan::Push, Some(Acted::Pushed)));
        assert_eq!(tick_all(&mut home), (Plan::UpToDate, None));

        // Der Laptop ist zum ersten Mal verbunden und hat anderen (hier leeren) Inhalt: Konflikt, Ordner gewinnt
        trading::set_setting(&school.conn, KEY_API, "schul-key").unwrap();
        assert_eq!(plan(&school), Plan::Conflict);
        assert!(evaluate(&school.conn, &school.cfg).unwrap().first_time);
        assert_eq!(tick_all(&mut school), (Plan::Conflict, None), "ein Konflikt wird nie von selbst aufgelöst");
        assert_eq!(resolve(&mut school.conn, &mut school.cfg, &school.backups, false).unwrap(), Acted::Pulled);
        assert_eq!(buckets(&school), ["Daheim"]);
        assert_eq!(trading::get_setting(&school.conn, KEY_API).unwrap().as_deref(), Some("schul-key"), "eigener API-Key bleibt");
        assert_eq!(plan(&school), Plan::UpToDate);
        assert!(std::fs::read_dir(&school.backups).unwrap().count() >= 1, "lokaler Stand wurde vorher gesichert");

        // In der Schule weiterarbeiten, hochladen, zuhause laden
        add_bucket(&school, "Schule");
        assert_eq!(tick_all(&mut school), (Plan::Push, Some(Acted::Pushed)));
        assert_eq!(plan(&home), Plan::Pull);
        let (eval, acted) = tick(&mut home.conn, &mut home.cfg, &home.backups, false).unwrap();
        assert_eq!((eval.plan, acted), (Plan::Pull, None), "während der Arbeit wird nicht von selbst geladen");
        assert_eq!(tick_all(&mut home), (Plan::Pull, Some(Acted::Pulled)));
        assert_eq!(buckets(&home), ["Daheim", "Schule"]);
        assert_eq!(plan(&home), Plan::UpToDate);
        assert_eq!(fingerprint(&home.conn).unwrap(), fingerprint(&school.conn).unwrap());
    }

    #[test]
    fn changes_on_both_sides_are_a_conflict_and_nothing_is_lost() {
        let tmp = TempDir::new("conflict");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let mut a = device(&tmp.0, "a", &shared);
        let mut b = device(&tmp.0, "b", &shared);
        add_bucket(&a, "Start");
        tick_all(&mut a);
        resolve(&mut b.conn, &mut b.cfg, &b.backups, false).unwrap();
        assert_eq!(plan(&b), Plan::UpToDate);

        // Beide ändern, A lädt zuerst hoch
        add_bucket(&a, "von A");
        add_bucket(&b, "von B");
        tick_all(&mut a);
        assert_eq!(plan(&b), Plan::Conflict);

        // B behält den eigenen Stand: der Ordner-Stand wird vorher lokal gesichert
        assert_eq!(resolve(&mut b.conn, &mut b.cfg, &b.backups, true).unwrap(), Acted::Pushed);
        let saved: Vec<String> = std::fs::read_dir(&b.backups).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(saved.iter().any(|n| n.starts_with("sicherung-ordner-")), "{saved:?}");
        assert_eq!(plan(&b), Plan::UpToDate);
        assert_eq!(buckets(&b), ["Start", "von B"]);

        // A sieht jetzt Bs Stand und hat nichts Neues: lädt ihn
        assert_eq!(tick_all(&mut a), (Plan::Pull, Some(Acted::Pulled)));
        assert_eq!(buckets(&a), ["Start", "von B"]);
    }

    #[test]
    fn identical_content_is_adopted_without_conflict() {
        let tmp = TempDir::new("adopt");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let mut a = device(&tmp.0, "a", &shared);
        let mut b = device(&tmp.0, "b", &shared);
        tick_all(&mut a); // leere Datenbank hochladen
        assert_eq!(plan(&b), Plan::Adopt, "beide leer: gleicher Inhalt");
        assert_eq!(tick_all(&mut b), (Plan::Adopt, Some(Acted::Adopted)));
        assert_eq!(plan(&b), Plan::UpToDate);
    }

    #[test]
    fn incomplete_folder_state_waits_instead_of_acting() {
        let tmp = TempDir::new("wait");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let mut a = device(&tmp.0, "a", &shared);
        let b = device(&tmp.0, "b", &shared);
        add_bucket(&a, "X");
        tick_all(&mut a);

        // OneDrive hat die Datenbank noch nicht fertig geladen: Größe passt nicht zur Beschreibung
        let snapshot = shared.join(SNAPSHOT_FILE);
        let bytes = std::fs::read(&snapshot).unwrap();
        std::fs::write(&snapshot, &bytes[..bytes.len() / 2]).unwrap();
        assert_eq!(plan(&b), Plan::Waiting);
        let mut b = b;
        assert!(resolve(&mut b.conn, &mut b.cfg, &b.backups, false).is_err());
        assert_eq!(buckets(&b), Vec::<String>::new(), "nichts wurde verändert");

        // Halb geschriebene Beschreibung ebenso
        std::fs::write(&snapshot, &bytes).unwrap();
        std::fs::write(shared.join(MANIFEST_FILE), "{ \"app\": ").unwrap();
        assert_eq!(plan(&b), Plan::Waiting);
    }

    #[test]
    fn missing_folder_is_an_error_and_foreign_formats_are_refused() {
        let tmp = TempDir::new("err");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let mut a = device(&tmp.0, "a", &shared);
        a.cfg.sync_dir = tmp.0.join("fehlt").to_string_lossy().into_owned();
        assert!(evaluate(&a.conn, &a.cfg).unwrap_err().contains("nicht gefunden"));
        assert!(push(&a.conn, &mut a.cfg).is_err());

        a.cfg.sync_dir = shared.to_string_lossy().into_owned();
        std::fs::write(shared.join(MANIFEST_FILE), "{\"app\":\"anderes\",\"format\":1,\"revision\":\"x\",\"parent\":null,\"device_id\":\"d\",\"device_name\":\"d\",\"saved_at\":\"x\",\"fingerprint\":\"x\",\"size_bytes\":0,\"db_version\":1}").unwrap();
        assert!(evaluate(&a.conn, &a.cfg).is_err());
    }

    #[test]
    fn snapshot_from_a_newer_app_is_refused_and_local_data_survives() {
        let tmp = TempDir::new("newer");
        let shared = tmp.0.join("shared");
        std::fs::create_dir_all(&shared).unwrap();
        let mut a = device(&tmp.0, "a", &shared);
        let mut b = device(&tmp.0, "b", &shared);
        add_bucket(&a, "A");
        tick_all(&mut a);
        add_bucket(&b, "B");

        // Stand im Ordner auf eine neuere Schemaversion setzen und die Größe in der Beschreibung nachziehen
        let snapshot = shared.join(SNAPSHOT_FILE);
        Connection::open(&snapshot).unwrap().pragma_update(None, "user_version", (db::MIGRATIONS.len() + 1) as i64).unwrap();
        let mut manifest: Manifest = serde_json::from_str(&std::fs::read_to_string(shared.join(MANIFEST_FILE)).unwrap()).unwrap();
        manifest.size_bytes = std::fs::metadata(&snapshot).unwrap().len();
        std::fs::write(shared.join(MANIFEST_FILE), serde_json::to_string(&manifest).unwrap()).unwrap();

        let err = resolve(&mut b.conn, &mut b.cfg, &b.backups, false).unwrap_err();
        assert!(err.contains("neueren Version"), "{err}");
        assert_eq!(buckets(&b), ["B"], "lokale Daten sind unverändert");
        assert!(b.cfg.base_revision.is_none(), "kein halber Zustand");
    }

    #[test]
    fn old_backups_are_pruned() {
        let tmp = TempDir::new("prune");
        for i in 0..14 {
            std::fs::write(tmp.0.join(format!("sicherung-vor-laden-2026010{i:02}.db")), "x").unwrap();
        }
        std::fs::write(tmp.0.join("andere-datei.db"), "x").unwrap();
        prune_backups(&tmp.0, "sicherung-vor-laden-");
        let left: Vec<_> = std::fs::read_dir(&tmp.0).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(left.iter().filter(|n| n.starts_with("sicherung-vor-laden-")).count(), KEEP_BACKUPS);
        assert!(left.contains(&"andere-datei.db".to_string()), "fremde Dateien bleiben");
        assert!(left.contains(&"sicherung-vor-laden-202601013.db".to_string()), "die neuesten bleiben");
    }
}
