//! Erster Start: Profil (Vor- und Nachname) und Speicherort der Datenbank.
//!
//! Der Speicherort muss bekannt sein, bevor die Datenbank geöffnet wird. Er steht deshalb in einer kleinen
//! `config.json` im App-Datenordner. Der Name liegt in der Datenbank selbst (Tabelle `settings`), damit er
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

#[derive(Debug, Serialize, Deserialize)]
struct Config {
    /// Ordner, in dem `wissenszentrum.db` liegt
    db_dir: String,
}

/// Was die Datenbank an einem Ort enthält (für den Hinweis im Onboarding).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationInfo {
    pub db_path: String,
    /// Dort liegt bereits eine Datei `wissenszentrum.db`
    pub exists: bool,
    /// Die vorhandene Datei ist eine gültige Datenbank dieser App
    pub valid: bool,
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

fn write_profile(conn: &Connection, profile: &Profile) -> Result<(), String> {
    trading::set_setting(conn, KEY_FIRST, &profile.first_name)?;
    trading::set_setting(conn, KEY_LAST, &profile.last_name)
}

// --- Konfiguration ------------------------------------------------------------

pub fn read_config(config_file: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(config_file).ok()?;
    let config: Config = serde_json::from_str(&text).ok()?;
    let dir = config.db_dir.trim();
    (!dir.is_empty()).then(|| PathBuf::from(dir))
}

pub fn write_config(config_file: &Path, db_dir: &Path) -> Result<(), String> {
    if let Some(parent) = config_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Konfiguration konnte nicht gespeichert werden: {e}"))?;
    }
    let config = Config { db_dir: db_dir.to_string_lossy().into_owned() };
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_file, json).map_err(|e| format!("Konfiguration konnte nicht gespeichert werden: {e}"))
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
    let file = db_file(Path::new(dir.trim()));
    let db_path = file.to_string_lossy().into_owned();
    if !file.is_file() {
        return LocationInfo { db_path, exists: false, valid: false, profile: None };
    }
    let conn = Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_ONLY);
    let (valid, profile) = match conn {
        Ok(conn) => match read_profile(&conn) {
            Ok(profile) => (true, profile),
            // Ohne Tabelle `settings` ist es entweder eine ältere App-Datenbank oder eine fremde Datei
            Err(_) => (conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0)).is_ok(), None),
        },
        Err(_) => (false, None),
    };
    LocationInfo { db_path, exists: true, valid, profile }
}

/// Öffnet (oder legt an) die Datenbank im Ordner und migriert sie auf den aktuellen Stand.
pub fn open_database(dir: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_file(dir)).map_err(|e| format!("Die Datenbank konnte nicht geöffnet werden: {e}"))?;
    db::init(&conn).map_err(|e| format!("Die Datenbank konnte nicht eingerichtet werden: {e}"))?;
    Ok(conn)
}

/// Schließt das Onboarding ab: prüft Eingaben, öffnet die Datenbank am Ort und speichert das Profil darin.
/// Die Konfiguration wird erst danach geschrieben, damit ein Fehler keinen halben Zustand hinterlässt.
pub fn onboard(config_file: &Path, dir: &str, first_name: &str, last_name: &str) -> Result<(Connection, PathBuf, Profile), String> {
    let profile = Profile { first_name: clean_name(first_name, "Vornamen")?, last_name: clean_name(last_name, "Nachnamen")? };
    let dir = prepare_location(dir)?;
    let conn = open_database(&dir)?;
    write_profile(&conn, &profile)?;
    write_config(config_file, &dir)?;
    Ok((conn, dir, profile))
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
        write_config(&cfg, Path::new("C:\\Daten\\Wissen")).unwrap();
        assert_eq!(read_config(&cfg), Some(PathBuf::from("C:\\Daten\\Wissen")));
        std::fs::write(&cfg, "kaputt").unwrap();
        assert_eq!(read_config(&cfg), None, "ungültige Konfiguration zählt als nicht vorhanden");
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
        assert_eq!(path, dir);
        assert!(db_file(&dir).is_file());
        assert_eq!(read_profile(&conn).unwrap(), Some(profile.clone()));
        assert_eq!(read_config(&cfg), Some(dir.clone()));
        drop(conn);

        // Später wieder öffnen: Profil ist in der Datenbank gespeichert
        let reopened = open_database(&dir).unwrap();
        assert_eq!(read_profile(&reopened).unwrap(), Some(profile));
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
}
