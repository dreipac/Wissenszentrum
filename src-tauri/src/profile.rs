//! Erster Start: Profil (Vor- und Nachname) und Speicherort der Datenbank.
//!
//! Der Speicherort muss bekannt sein, bevor die Datenbank geöffnet wird. Er steht deshalb als Dateipfad in einer
//! kleinen `config.json` im App-Datenordner (ältere Konfigurationen nannten nur den Ordner). Der Name liegt in der Datenbank selbst (Tabelle `settings`), damit er
//! beim Verschieben oder Sichern der Datenbank mitwandert.

use crate::{db, trading};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const DB_FILE: &str = "wissenszentrum.db";
const MAX_NAME: usize = 60;
const KEY_FIRST: &str = "profile_first_name";
const KEY_LAST: &str = "profile_last_name";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub first_name: String,
    pub last_name: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Vollständiger Pfad der Datenbankdatei
    #[serde(default)]
    pub db_path: Option<String>,
    /// Älteres Format: Ordner, in dem `wissenszentrum.db` liegt
    #[serde(default)]
    pub db_dir: Option<String>,
    /// Abgleich mit einem anderen Rechner. Gehört zu genau dieser Datenbank und diesem Rechner.
    #[serde(default)]
    pub sync: Option<crate::sync::SyncConfig>,
}

impl Config {
    /// Pfad der Datenbankdatei (auch im älteren Ordner-Format).
    fn db_file(&self) -> Option<PathBuf> {
        let path = self.db_path.as_deref().map(str::trim).filter(|p| !p.is_empty());
        if let Some(path) = path {
            return Some(PathBuf::from(path));
        }
        let dir = self.db_dir.as_deref().map(str::trim).filter(|d| !d.is_empty())?;
        Some(db_file(Path::new(dir)))
    }
}

/// Was eine Datenbankdatei enthält (für den Hinweis im Onboarding).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationInfo {
    pub db_path: String,
    /// Die Datei existiert
    pub exists: bool,
    /// Die Datei ist eine gültige Datenbank dieser App, die sich öffnen lässt
    pub valid: bool,
    /// Gültig, wurde aber mit einer älteren Version erstellt und wird beim Öffnen aktualisiert
    pub needs_update: bool,
    /// Stammt aus einer neueren Version der App als dieser
    pub newer: bool,
    pub profile: Option<Profile>,
}

pub fn db_file(dir: &Path) -> PathBuf {
    dir.join(DB_FILE)
}

/// Prüft einen Namen und liefert ihn bereinigt zurück (Leerraum außen entfernt, innen zusammengefasst).
pub fn clean_name(value: &str, label: &str) -> Result<String, String> {
    let name = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(format!("Bitte gib deinen {label} ein."));
    }
    if name.chars().count() > MAX_NAME {
        return Err(format!("Der {label} darf höchstens {MAX_NAME} Zeichen lang sein."));
    }
    Ok(name)
}

pub fn read_profile(conn: &Connection) -> Result<Option<Profile>, String> {
    let first = trading::get_setting(conn, KEY_FIRST)?;
    let last = trading::get_setting(conn, KEY_LAST)?;
    Ok(match (first, last) {
        (Some(first_name), Some(last_name)) if !first_name.is_empty() => Some(Profile { first_name, last_name }),
        _ => None,
    })
}

/// Ändert Vor- und Nachname (geprüft und bereinigt) und liefert das gespeicherte Profil zurück.
pub fn update_profile(conn: &Connection, first_name: &str, last_name: &str) -> Result<Profile, String> {
    let profile = Profile { first_name: clean_name(first_name, "Vornamen")?, last_name: clean_name(last_name, "Nachnamen")? };
    write_profile(conn, &profile)?;
    Ok(profile)
}

fn write_profile(conn: &Connection, profile: &Profile) -> Result<(), String> {
    trading::set_setting(conn, KEY_FIRST, &profile.first_name)?;
    trading::set_setting(conn, KEY_LAST, &profile.last_name)
}

// --- Konfiguration ------------------------------------------------------------

/// Liest die Konfiguration; fehlt sie oder ist sie unlesbar, gilt die leere Konfiguration.
pub fn load_config(config_file: &Path) -> Config {
    std::fs::read_to_string(config_file).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save_config(config_file: &Path, config: &Config) -> Result<(), String> {
    if let Some(parent) = config_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Konfiguration konnte nicht gespeichert werden: {e}"))?;
    }
    let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_file, json).map_err(|e| format!("Konfiguration konnte nicht gespeichert werden: {e}"))
}

/// Pfad der Datenbankdatei aus der Konfiguration (auch im älteren Ordner-Format).
pub fn read_config(config_file: &Path) -> Option<PathBuf> {
    load_config(config_file).db_file()
}

/// Merkt sich die Datenbankdatei. Wechselt sie, gilt der bisherige Abgleich nicht mehr und wird verworfen.
pub fn write_config(config_file: &Path, db_path: &Path) -> Result<(), String> {
    let mut config = load_config(config_file);
    if config.db_file().as_deref() != Some(db_path) {
        config.sync = None;
    }
    config.db_path = Some(db_path.to_string_lossy().into_owned());
    config.db_dir = None;
    save_config(config_file, &config)
}

// --- Speicherort --------------------------------------------------------------

/// Legt den Ordner bei Bedarf an und prüft, dass dort geschrieben werden kann.
pub fn prepare_location(dir: &str) -> Result<PathBuf, String> {
    let dir = dir.trim();
    if dir.is_empty() {
        return Err("Bitte wähle einen Speicherort.".into());
    }
    let path = PathBuf::from(dir);
    if path.exists() && !path.is_dir() {
        return Err("Der gewählte Pfad ist kein Ordner.".into());
    }
    std::fs::create_dir_all(&path).map_err(|e| format!("Der Ordner konnte nicht angelegt werden: {e}"))?;
    let probe = path.join(".schreibtest");
    std::fs::write(&probe, b"").map_err(|_| "In diesem Ordner darf nicht geschrieben werden. Bitte wähle einen anderen.".to_string())?;
    let _ = std::fs::remove_file(&probe);
    Ok(path)
}

/// Schaut nach, ob am Ort schon eine Datenbank liegt, ohne etwas zu verändern.
pub fn inspect_location(dir: &str) -> LocationInfo {
    inspect_file(&db_file(Path::new(dir.trim())).to_string_lossy())
}

/// Prüft eine Datenbankdatei, ohne etwas zu verändern: Ist es eine Datenbank dieser App, welche Version, wessen Profil?
pub fn inspect_file(path: &str) -> LocationInfo {
    let file = PathBuf::from(path.trim());
    let db_path = file.to_string_lossy().into_owned();
    let none = |exists: bool| LocationInfo { db_path: db_path.clone(), exists, valid: false, needs_update: false, newer: false, profile: None };
    if !file.is_file() {
        return none(false);
    }
    let Ok(conn) = Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return none(true);
    };
    // Keine SQLite-Datei: schon diese Abfrage schlägt fehl
    let Ok(version) = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)) else {
        return none(true);
    };
    let latest = db::MIGRATIONS.len() as i64;
    // Version 0 = leer oder fremde Datenbank ohne Schema dieser App
    let valid = (1..=latest).contains(&version);
    let profile = if valid { read_profile(&conn).ok().flatten() } else { None };
    LocationInfo { db_path, exists: true, valid, needs_update: valid && version < latest, newer: version > latest, profile }
}

/// Öffnet (oder legt an) die Datenbankdatei und migriert sie auf den aktuellen Stand.
pub fn open_file(file: &Path) -> Result<Connection, String> {
    let conn = Connection::open(file).map_err(|e| format!("Die Datenbank konnte nicht geöffnet werden: {e}"))?;
    db::init(&conn).map_err(|e| format!("Die Datenbank konnte nicht eingerichtet werden: {e}"))?;
    Ok(conn)
}

/// Legt vor dem Aktualisieren einer älteren Datenbank eine Sicherungskopie neben der Datei an
/// (`name.vor-update-v5.db`). Eine schon vorhandene Sicherung bleibt unangetastet.
fn backup_before_update(file: &Path, version: i64) -> Result<PathBuf, String> {
    let stem = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "datenbank".into());
    let ext = file.extension().map(|e| e.to_string_lossy().into_owned()).unwrap_or_else(|| "db".into());
    let target = file.with_file_name(format!("{stem}.vor-update-v{version}.{ext}"));
    if target.exists() {
        return Ok(target);
    }
    let conn = Connection::open_with_flags(file, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    // VACUUM INTO schreibt einen in sich stimmigen Stand, auch wenn die Datenbank im WAL-Modus lief
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().as_ref()])
        .map_err(|e| format!("Die Sicherung vor dem Aktualisieren konnte nicht angelegt werden: {e}"))?;
    Ok(target)
}

/// Schließt das Onboarding ab: prüft Eingaben, öffnet die Datenbank am Ort und speichert das Profil darin.
/// Die Konfiguration wird erst danach geschrieben, damit ein Fehler keinen halben Zustand hinterlässt.
pub fn onboard(config_file: &Path, dir: &str, first_name: &str, last_name: &str) -> Result<(Connection, PathBuf, Profile), String> {
    let profile = Profile { first_name: clean_name(first_name, "Vornamen")?, last_name: clean_name(last_name, "Nachnamen")? };
    let dir = prepare_location(dir)?;
    let file = db_file(&dir);
    let conn = open_file(&file)?;
    write_profile(&conn, &profile)?;
    write_config(config_file, &file)?;
    Ok((conn, file, profile))
}

/// Übernimmt eine vorhandene Datenbankdatei (beliebiger Name und Ort). Gehört ihr schon ein Profil, genügt das;
/// sonst müssen Vor- und Nachname angegeben werden. Ältere Datenbanken werden nach einer Sicherung aktualisiert.
pub fn open_existing(config_file: &Path, path: &str, first_name: &str, last_name: &str) -> Result<(Connection, PathBuf, Profile), String> {
    let file = PathBuf::from(path.trim());
    if path.trim().is_empty() || !file.is_file() {
        return Err("Die Datei wurde nicht gefunden.".into());
    }
    let info = inspect_file(path);
    if info.newer {
        return Err("Diese Datenbank stammt aus einer neueren Version des Wissenszentrums. Bitte aktualisiere zuerst die App.".into());
    }
    if !info.valid {
        return Err("Das ist keine Datenbank des Wissenszentrums.".into());
    }
    // Namen prüfen, bevor etwas an der Datei verändert wird
    let new_profile = if !first_name.trim().is_empty() || !last_name.trim().is_empty() {
        Some(Profile { first_name: clean_name(first_name, "Vornamen")?, last_name: clean_name(last_name, "Nachnamen")? })
    } else {
        None
    };
    if new_profile.is_none() && info.profile.is_none() {
        return Err("In dieser Datenbank ist noch kein Name hinterlegt. Bitte gib deinen Namen ein.".into());
    }
    if info.needs_update {
        let version = Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .and_then(|c| c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)))
            .map_err(|e| e.to_string())?;
        backup_before_update(&file, version)?;
    }
    let conn = open_file(&file)?;
    let profile = match new_profile {
        Some(profile) => {
            write_profile(&conn, &profile)?;
            profile
        }
        None => read_profile(&conn)?.ok_or("In dieser Datenbank ist noch kein Name hinterlegt.")?,
    };
    write_config(config_file, &file)?;
    Ok((conn, file, profile))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Eindeutiger Ordner unter dem Temp-Verzeichnis, wird am Ende wieder entfernt.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = std::env::temp_dir().join(format!("wz-test-{name}-{}-{unique}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            TempDir(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn names_are_trimmed_and_validated() {
        assert_eq!(clean_name("  Armin   Maria ", "Vornamen").unwrap(), "Armin Maria");
        assert!(clean_name("   ", "Vornamen").unwrap_err().contains("Vornamen"));
        assert!(clean_name(&"x".repeat(MAX_NAME + 1), "Nachnamen").is_err());
        assert!(clean_name(&"x".repeat(MAX_NAME), "Nachnamen").is_ok());
    }

    #[test]
    fn location_is_created_and_checked() {
        let tmp = TempDir::new("loc");
        let nested = tmp.0.join("a").join("b");
        let path = prepare_location(nested.to_str().unwrap()).unwrap();
        assert!(path.is_dir());
        assert!(!path.join(".schreibtest").exists(), "Testdatei wird wieder entfernt");
        assert!(prepare_location("  ").is_err());

        let file = tmp.0.join("datei.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(prepare_location(file.to_str().unwrap()).unwrap_err().contains("kein Ordner"));
    }

    #[test]
    fn config_roundtrip_and_garbage() {
        let tmp = TempDir::new("cfg");
        let cfg = tmp.0.join("sub").join("config.json");
        assert_eq!(read_config(&cfg), None);
        write_config(&cfg, Path::new("C:\\Daten\\mein-wissen.db")).unwrap();
        assert_eq!(read_config(&cfg), Some(PathBuf::from("C:\\Daten\\mein-wissen.db")), "beliebiger Dateiname bleibt erhalten");
        std::fs::write(&cfg, "kaputt").unwrap();
        assert_eq!(read_config(&cfg), None, "ungültige Konfiguration zählt als nicht vorhanden");
        std::fs::write(&cfg, "{\"db_path\": \"  \"}").unwrap();
        assert_eq!(read_config(&cfg), None);
        // Älteres Format mit Ordner
        std::fs::write(&cfg, "{\"db_dir\": \"C:\\\\Alt\"}").unwrap();
        assert_eq!(read_config(&cfg), Some(db_file(Path::new("C:\\Alt"))));
        std::fs::write(&cfg, "{\"db_dir\": \"  \"}").unwrap();
        assert_eq!(read_config(&cfg), None);
    }

    #[test]
    fn onboarding_creates_database_profile_and_config() {
        let tmp = TempDir::new("onb");
        let dir = tmp.0.join("Daten");
        let cfg = tmp.0.join("config.json");

        let (conn, path, profile) = onboard(&cfg, dir.to_str().unwrap(), " Armin ", "Durmisi").unwrap();
        assert_eq!(profile, Profile { first_name: "Armin".into(), last_name: "Durmisi".into() });
        assert_eq!(path, db_file(&dir));
        assert!(db_file(&dir).is_file());
        assert_eq!(read_profile(&conn).unwrap(), Some(profile.clone()));
        assert_eq!(read_config(&cfg), Some(db_file(&dir)));
        drop(conn);

        // Später wieder öffnen: Profil ist in der Datenbank gespeichert
        let reopened = open_file(&db_file(&dir)).unwrap();
        assert_eq!(read_profile(&reopened).unwrap(), Some(profile));
    }

    #[test]
    fn profile_can_be_renamed() {
        let tmp = TempDir::new("rename");
        let cfg = tmp.0.join("config.json");
        let (conn, _, _) = onboard(&cfg, tmp.0.join("D").to_str().unwrap(), "Armin", "Durmisi").unwrap();
        let renamed = update_profile(&conn, "  Armin  Ali ", "Durmisi").unwrap();
        assert_eq!(renamed.first_name, "Armin Ali");
        assert_eq!(read_profile(&conn).unwrap(), Some(renamed));
        assert!(update_profile(&conn, " ", "X").is_err());
        assert_eq!(read_profile(&conn).unwrap().unwrap().first_name, "Armin Ali");
    }

    #[test]
    fn failed_onboarding_writes_no_config() {
        let tmp = TempDir::new("fail");
        let cfg = tmp.0.join("config.json");
        assert!(onboard(&cfg, tmp.0.to_str().unwrap(), "", "Durmisi").is_err());
        assert!(onboard(&cfg, tmp.0.to_str().unwrap(), "Armin", " ").is_err());
        assert!(onboard(&cfg, "", "Armin", "Durmisi").is_err());
        assert!(!cfg.exists());
    }

    #[test]
    fn existing_database_is_reused() {
        let tmp = TempDir::new("reuse");
        let cfg = tmp.0.join("config.json");
        let dir = tmp.0.join("Daten");
        let (conn, _, _) = onboard(&cfg, dir.to_str().unwrap(), "Armin", "Durmisi").unwrap();
        conn.execute("INSERT INTO buckets (name) VALUES ('Backlog')", []).unwrap();
        drop(conn);

        let info = inspect_location(dir.to_str().unwrap());
        assert!(info.exists && info.valid);
        assert_eq!(info.profile.as_ref().map(|p| p.last_name.as_str()), Some("Durmisi"));

        // Zweites Onboarding am selben Ort übernimmt die Daten und aktualisiert den Namen
        let (conn, _, profile) = onboard(&cfg, dir.to_str().unwrap(), "Maria", "Muster").unwrap();
        assert_eq!(profile.first_name, "Maria");
        let buckets: i64 = conn.query_row("SELECT COUNT(*) FROM buckets", [], |r| r.get(0)).unwrap();
        assert_eq!(buckets, 1);
    }

    #[test]
    fn inspect_location_handles_missing_and_foreign_files() {
        let tmp = TempDir::new("inspect");
        let info = inspect_location(tmp.0.to_str().unwrap());
        assert!(!info.exists && !info.valid && info.profile.is_none());
        assert!(info.db_path.ends_with(DB_FILE));

        std::fs::write(db_file(&tmp.0), "das ist keine datenbank").unwrap();
        let info = inspect_location(tmp.0.to_str().unwrap());
        assert!(info.exists);
        assert!(!info.valid, "fremde Datei wird nicht als gültig gemeldet");
    }

    /// Legt eine App-Datenbank mit beliebigem Dateinamen an (ohne Onboarding) und liefert den Dateipfad.
    fn make_db(dir: &Path, name: &str, with_profile: bool) -> PathBuf {
        let file = dir.join(name);
        let conn = open_file(&file).unwrap();
        if with_profile {
            write_profile(&conn, &Profile { first_name: "Armin".into(), last_name: "Durmisi".into() }).unwrap();
        }
        conn.execute("INSERT INTO buckets (name) VALUES ('Backlog')", []).unwrap();
        file
    }

    #[test]
    fn opens_existing_database_with_profile_and_any_file_name() {
        let tmp = TempDir::new("open1");
        let cfg = tmp.0.join("config.json");
        let file = make_db(&tmp.0, "mein-wissen.sqlite", true);

        let info = inspect_file(file.to_str().unwrap());
        assert!(info.exists && info.valid && !info.needs_update && !info.newer);
        assert_eq!(info.profile.as_ref().map(|p| p.first_name.as_str()), Some("Armin"));

        let (conn, path, profile) = open_existing(&cfg, file.to_str().unwrap(), "", "").unwrap();
        assert_eq!((path.clone(), profile.last_name.as_str()), (file.clone(), "Durmisi"));
        let buckets: i64 = conn.query_row("SELECT COUNT(*) FROM buckets", [], |r| r.get(0)).unwrap();
        assert_eq!(buckets, 1, "die Daten bleiben erhalten");
        assert_eq!(read_config(&cfg), Some(file), "der gewählte Dateipfad wird gemerkt");
    }

    #[test]
    fn existing_database_without_profile_needs_a_name() {
        let tmp = TempDir::new("open2");
        let cfg = tmp.0.join("config.json");
        let file = make_db(&tmp.0, "alt.db", false);
        assert!(inspect_file(file.to_str().unwrap()).profile.is_none());

        let err = open_existing(&cfg, file.to_str().unwrap(), "", "").unwrap_err();
        assert!(err.contains("Namen"));
        assert!(open_existing(&cfg, file.to_str().unwrap(), "Armin", " ").is_err(), "beide Namen sind nötig");
        assert!(!cfg.exists(), "bei Fehlern entsteht keine Konfiguration");

        let (conn, _, profile) = open_existing(&cfg, file.to_str().unwrap(), " Armin ", "Durmisi").unwrap();
        assert_eq!(profile.first_name, "Armin");
        assert_eq!(read_profile(&conn).unwrap(), Some(profile), "der Name wird in der Datenbank gespeichert");
        assert!(cfg.exists());
    }

    #[test]
    fn rejects_missing_foreign_and_newer_databases() {
        let tmp = TempDir::new("open3");
        let cfg = tmp.0.join("config.json");

        assert!(open_existing(&cfg, tmp.0.join("fehlt.db").to_str().unwrap(), "A", "B").unwrap_err().contains("nicht gefunden"));
        assert!(open_existing(&cfg, "  ", "A", "B").is_err());

        let text = tmp.0.join("text.db");
        std::fs::write(&text, "keine datenbank").unwrap();
        assert!(open_existing(&cfg, text.to_str().unwrap(), "A", "B").unwrap_err().contains("keine Datenbank"));

        // Fremde SQLite-Datei ohne Schema dieser App (user_version 0)
        let foreign = tmp.0.join("fremd.db");
        let c = Connection::open(&foreign).unwrap();
        c.execute("CREATE TABLE kunden (id INTEGER)", []).unwrap();
        drop(c);
        let info = inspect_file(foreign.to_str().unwrap());
        assert!(info.exists && !info.valid && !info.newer);
        assert!(open_existing(&cfg, foreign.to_str().unwrap(), "A", "B").unwrap_err().contains("keine Datenbank"));

        // Neuere Version der App
        let newer = make_db(&tmp.0, "neu.db", true);
        let c = Connection::open(&newer).unwrap();
        c.pragma_update(None, "user_version", (db::MIGRATIONS.len() + 1) as i64).unwrap();
        drop(c);
        let info = inspect_file(newer.to_str().unwrap());
        assert!(info.newer && !info.valid);
        assert!(open_existing(&cfg, newer.to_str().unwrap(), "", "").unwrap_err().contains("neueren Version"));
        assert!(!cfg.exists());
    }

    #[test]
    fn older_database_is_backed_up_and_updated() {
        let tmp = TempDir::new("open4");
        let cfg = tmp.0.join("config.json");
        let file = tmp.0.join("alt.db");
        // Datenbank im Stand von Migration 5, ohne Profil-Tabelle (kommt mit Migration 8)
        let c = Connection::open(&file).unwrap();
        c.pragma_update(None, "foreign_keys", true).unwrap();
        for sql in &db::MIGRATIONS[..5] {
            c.execute_batch(sql).unwrap();
        }
        c.pragma_update(None, "user_version", 5i64).unwrap();
        c.execute("INSERT INTO tasks (title) VALUES ('Alt')", []).unwrap();
        drop(c);

        let info = inspect_file(file.to_str().unwrap());
        assert!(info.valid && info.needs_update && info.profile.is_none());

        let (conn, _, profile) = open_existing(&cfg, file.to_str().unwrap(), "Armin", "Durmisi").unwrap();
        assert_eq!(profile.first_name, "Armin");
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version as usize, db::MIGRATIONS.len(), "auf den neuesten Stand gebracht");
        let tasks: i64 = conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(tasks, 1, "Daten bleiben erhalten");

        // Die Sicherung hat den alten Stand
        let backup = tmp.0.join("alt.vor-update-v5.db");
        assert!(backup.is_file());
        let old = Connection::open(&backup).unwrap();
        let old_version: i64 = old.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(old_version, 5);
        let old_tasks: i64 = old.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(old_tasks, 1);
    }
}
