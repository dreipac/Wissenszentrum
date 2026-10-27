//! Dateianhänge in Notizen und Dokumentation: Die Bytes liegen als BLOB in der Datenbank, der Text verweist per
//! `data-file-id` darauf (wie bei den Bildern). Ein Anhang wird beim Einfügen gespeichert; Anhänge, auf die keine Seite
//! und keine Notiz mehr verweist, räumt `gc` nach einem Tag Schonfrist auf.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

pub const MAX_FILE_BYTES: usize = 25_000_000;
const MAX_NAME: usize = 180;

/// Dateitypen, die nie direkt geöffnet werden (sie könnten Programme ausführen); „Speichern unter“ geht immer.
const BLOCKED: [&str; 27] = [
    "exe", "bat", "cmd", "com", "msi", "msp", "scr", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "jar", "lnk", "reg", "dll", "cpl", "pif", "appx", "msix", "gadget", "sh", "url",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub id: i64,
    pub name: String,
    pub mime: String,
    pub size: i64,
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// Macht aus einem Dateinamen einen sicheren Namen ohne Pfad und ohne Zeichen, die Windows nicht mag.
pub fn clean_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let mut name: String = base.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    name = name.trim().trim_matches('.').trim().to_string();
    if name.chars().count() > MAX_NAME {
        // Endung behalten, wenn der Name gekürzt werden muss
        let ext = name.rsplit_once('.').map(|(_, e)| e.to_string()).filter(|e| e.chars().count() <= 10);
        let keep = MAX_NAME - ext.as_ref().map(|e| e.chars().count() + 1).unwrap_or(0);
        let stem: String = name.chars().take(keep).collect();
        name = match ext {
            Some(e) => format!("{stem}.{e}"),
            None => stem,
        };
    }
    if name.is_empty() {
        "Datei".into()
    } else {
        name
    }
}

/// Löst `%XX`-Folgen auf (der Name wird als Kopfzeile übertragen und dafür prozentkodiert).
pub fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(v) = text.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn add(conn: &Connection, name: &str, mime: &str, data: &[u8]) -> Result<FileInfo, String> {
    if data.is_empty() {
        return Err("Die Datei ist leer.".into());
    }
    if data.len() > MAX_FILE_BYTES {
        return Err("Die Datei ist zu groß (höchstens 25 MB).".into());
    }
    let name = clean_name(name);
    let mime = mime.trim();
    let mime = if mime.is_empty() || mime.len() > 100 { "application/octet-stream" } else { mime };
    conn.execute("INSERT INTO attachments (name, mime, size, data) VALUES (?1, ?2, ?3, ?4)", params![name, mime, data.len() as i64, data]).map_err(db_err)?;
    let id = conn.last_insert_rowid();
    // Gelegentlich aufräumen, damit verworfene Anhänge nicht liegen bleiben
    let _ = gc(conn);
    Ok(FileInfo { id, name, mime: mime.to_string(), size: data.len() as i64 })
}

/// Name und Bytes eines Anhangs.
pub fn get(conn: &Connection, id: i64) -> Result<(String, Vec<u8>), String> {
    conn.query_row("SELECT name, data FROM attachments WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|_| "Datei nicht gefunden.".to_string())
}

/// Ersetzt den Inhalt eines Anhangs, z. B. nachdem er in Word bearbeitet wurde. Name und Typ bleiben.
pub fn update_data(conn: &Connection, id: i64, data: &[u8]) -> Result<FileInfo, String> {
    if data.is_empty() {
        return Err("Die Datei ist leer.".into());
    }
    if data.len() > MAX_FILE_BYTES {
        return Err("Die Datei ist zu groß (höchstens 25 MB).".into());
    }
    let changed = conn.execute("UPDATE attachments SET data = ?1, size = ?2 WHERE id = ?3", params![data, data.len() as i64, id]).map_err(db_err)?;
    if changed == 0 {
        return Err("Datei nicht gefunden.".into());
    }
    conn.query_row("SELECT id, name, mime, size FROM attachments WHERE id = ?1", params![id], |r| {
        Ok(FileInfo { id: r.get(0)?, name: r.get(1)?, mime: r.get(2)?, size: r.get(3)? })
    })
    .map_err(db_err)
}

/// Eine geöffnete Datei im temporären Ordner, die auf Änderungen beobachtet wird.
pub struct Watch {
    path: PathBuf,
    /// Änderungszeit der Datei, deren Inhalt zuletzt in die Datenbank übernommen wurde
    synced: Option<SystemTime>,
    /// Neuere Änderungszeit, die einmal beobachtet wurde; erst wenn sie stabil bleibt (Word schreibt noch), wird gelesen
    seen: Option<SystemTime>,
    /// Wie oft die Datei hintereinander fehlte: Word ersetzt sie beim Speichern kurz durch eine neue
    missing: u8,
}

/// So viele Durchgänge in Folge darf die Datei fehlen, bevor sie nicht mehr beobachtet wird.
const MISSING_LIMIT: u8 = 4;

/// Alle Anhänge, die gerade zum Bearbeiten geöffnet sind (Anhang-ID → Datei).
#[derive(Default)]
pub struct Watches(pub Mutex<HashMap<i64, Watch>>);

impl Watches {
    pub fn is_empty(&self) -> bool {
        self.0.lock().map(|m| m.is_empty()).unwrap_or(true)
    }

    /// Beobachtet die Datei ab ihrem jetzigen Stand; spätere Änderungen wandern in den Anhang zurück.
    pub fn watch(&self, id: i64, path: PathBuf) {
        let synced = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        if let Ok(mut map) = self.0.lock() {
            map.insert(id, Watch { path, synced, seen: None, missing: 0 });
        }
    }

    /// Die Datei eines Anhangs, die schon geöffnet ist und noch existiert.
    pub fn open_path(&self, id: i64) -> Option<PathBuf> {
        let map = self.0.lock().ok()?;
        map.get(&id).map(|w| w.path.clone()).filter(|p| p.is_file())
    }
}

/// Übernimmt Änderungen an geöffneten Dateien in die Anhänge. Mit `settle` muss sich die Änderungszeit zwischen zwei
/// Aufrufen gleich geblieben sein (das Programm schreibt nicht mehr); beim Beenden gilt sie sofort. Liefert die
/// aktualisierten Anhänge.
pub fn sync_changes(conn: &Connection, watches: &Watches, settle: bool) -> Vec<FileInfo> {
    let mut updated = Vec::new();
    let Ok(mut map) = watches.0.lock() else { return updated };
    let mut gone = Vec::new();
    for (&id, watch) in map.iter_mut() {
        let Ok(modified) = std::fs::metadata(&watch.path).and_then(|m| m.modified()) else {
            watch.missing += 1;
            if watch.missing >= MISSING_LIMIT {
                gone.push(id);
            }
            continue;
        };
        watch.missing = 0;
        if Some(modified) == watch.synced {
            watch.seen = None;
            continue;
        }
        if settle && watch.seen != Some(modified) {
            watch.seen = Some(modified);
            continue;
        }
        // Gesperrt oder halb geschrieben: beim nächsten Durchgang noch einmal versuchen
        let Ok(bytes) = std::fs::read(&watch.path) else { continue };
        match update_data(conn, id, &bytes) {
            Ok(info) => {
                watch.synced = Some(modified);
                watch.seen = None;
                updated.push(info);
            }
            // Der Anhang gehört nicht mehr dazu (aufgeräumt): nicht weiter beobachten
            Err(e) if e == "Datei nicht gefunden." => gone.push(id),
            Err(_) => {}
        }
    }
    for id in gone {
        map.remove(&id);
    }
    updated
}

/// Schreibt einen Export (Word-Datei) an den Ort, den die Person im Speichern-Dialog gewählt hat. Nur `.docx` in einem
/// vorhandenen Ordner; eine bestehende Datei wird überschrieben (das hat der Dialog schon abgefragt).
pub fn write_export(path: &str, data: &[u8]) -> Result<(), String> {
    let target = std::path::Path::new(path);
    let is_docx = target.extension().map(|e| e.eq_ignore_ascii_case("docx")).unwrap_or(false);
    if !is_docx {
        return Err("Es kann nur eine Word-Datei (.docx) gespeichert werden.".into());
    }
    if target.is_dir() {
        return Err("Der gewählte Ort ist ein Ordner.".into());
    }
    if !target.parent().map(|p| p.as_os_str().is_empty() || p.is_dir()).unwrap_or(false) {
        return Err("Der gewählte Ordner existiert nicht.".into());
    }
    if data.is_empty() {
        return Err("Die Datei ist leer.".into());
    }
    std::fs::write(target, data).map_err(|e| format!("Die Datei konnte nicht gespeichert werden: {e}"))
}

/// Darf diese Datei direkt geöffnet werden? Programme und Skripte nicht.
pub fn can_open(name: &str) -> bool {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
    !BLOCKED.contains(&ext.as_str())
}

/// IDs aller Anhänge, auf die ein Text verweist (`data-file-id="7"`).
fn referenced_ids(content: &str) -> Vec<i64> {
    const MARK: &str = "data-file-id=\"";
    let mut ids = Vec::new();
    let mut rest = content;
    while let Some(at) = rest.find(MARK) {
        rest = &rest[at + MARK.len()..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(id) = digits.parse() {
            ids.push(id);
        }
    }
    ids
}

/// Entfernt Anhänge, die keine Seite und keine Notiz mehr verwendet (ein Tag Schonfrist, damit „Rückgängig“ greift).
pub fn gc(conn: &Connection) -> Result<usize, String> {
    let mut used: HashSet<i64> = HashSet::new();
    for table in ["doc_pages", "notes"] {
        let mut stmt = conn.prepare(&format!("SELECT content FROM {table} WHERE content LIKE '%data-file-id%'")).map_err(db_err)?;
        let contents: Vec<String> = stmt.query_map([], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
        used.extend(contents.iter().flat_map(|c| referenced_ids(c)));
    }
    let mut stmt = conn.prepare("SELECT id FROM attachments WHERE created_at < datetime('now', '-1 day')").map_err(db_err)?;
    let old: Vec<i64> = stmt.query_map([], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    let mut removed = 0;
    for id in old.into_iter().filter(|id| !used.contains(id)) {
        removed += conn.execute("DELETE FROM attachments WHERE id = ?1", params![id]).map_err(db_err)?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::init(&c).unwrap();
        c
    }

    #[test]
    fn names_are_cleaned() {
        assert_eq!(clean_name("C:\\Users\\x\\Plan.pdf"), "Plan.pdf");
        assert_eq!(clean_name("../../geheim.txt"), "geheim.txt");
        assert_eq!(clean_name("a:b*c?.docx"), "a_b_c_.docx");
        assert_eq!(clean_name("   "), "Datei");
        assert_eq!(clean_name("..."), "Datei");
        let long = format!("{}.pdf", "x".repeat(300));
        let cleaned = clean_name(&long);
        assert!(cleaned.chars().count() <= MAX_NAME && cleaned.ends_with(".pdf"));
    }

    #[test]
    fn percent_encoding_is_decoded() {
        assert_eq!(percent_decode("Gr%C3%BCne%20Liste.pdf"), "Grüne Liste.pdf");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
    }

    #[test]
    fn files_are_stored_and_validated() {
        let c = conn();
        let info = add(&c, "Plan 2026.pdf", "application/pdf", b"%PDF-1.4 test").unwrap();
        assert_eq!((info.name.as_str(), info.size), ("Plan 2026.pdf", 13));
        let (name, data) = get(&c, info.id).unwrap();
        assert_eq!((name.as_str(), data.as_slice()), ("Plan 2026.pdf", &b"%PDF-1.4 test"[..]));
        assert!(add(&c, "leer.txt", "text/plain", b"").is_err());
        assert!(add(&c, "gross.bin", "", &vec![0u8; MAX_FILE_BYTES + 1]).is_err());
        assert!(get(&c, 999).is_err());
        assert_eq!(add(&c, "x.bin", "", b"1").unwrap().mime, "application/octet-stream");
    }

    #[test]
    fn dangerous_types_are_not_opened_directly() {
        assert!(can_open("Plan.pdf") && can_open("Tabelle.XLSX") && can_open("ohne-endung"));
        assert!(!can_open("setup.exe") && !can_open("SKRIPT.PS1") && !can_open("a.b.bat") && !can_open("link.url"));
    }

    #[test]
    fn unused_files_are_collected_but_used_ones_stay() {
        let c = conn();
        let in_page = add(&c, "a.pdf", "application/pdf", b"a").unwrap().id;
        let in_note = add(&c, "b.pdf", "application/pdf", b"b").unwrap().id;
        let unused = add(&c, "c.pdf", "application/pdf", b"c").unwrap().id;
        let fresh = add(&c, "d.pdf", "application/pdf", b"d").unwrap().id;
        c.execute("INSERT INTO doc_pages (title, content) VALUES ('S', ?1)", params![format!("<div data-file-id=\"{in_page}\" data-name=\"a.pdf\"></div>")]).unwrap();
        c.execute("INSERT INTO notes (title, content) VALUES ('N', ?1)", params![format!("<div data-file-id=\"{in_note}\"></div>")]).unwrap();
        c.execute("UPDATE attachments SET created_at = datetime('now', '-2 days') WHERE id <> ?1", params![fresh]).unwrap();
        assert_eq!(gc(&c).unwrap(), 1, "nur die alte, unverwendete Datei");
        assert!(get(&c, in_page).is_ok() && get(&c, in_note).is_ok() && get(&c, fresh).is_ok());
        assert!(get(&c, unused).is_err());
    }

    #[test]
    fn update_replaces_content_and_size() {
        let c = conn();
        let id = add(&c, "Brief.docx", "application/vnd.openxmlformats", b"alt").unwrap().id;
        let info = update_data(&c, id, b"neuer, laengerer Inhalt").unwrap();
        assert_eq!((info.name.as_str(), info.size), ("Brief.docx", 23));
        assert_eq!(get(&c, id).unwrap().1, b"neuer, laengerer Inhalt");
        assert!(update_data(&c, id, b"").is_err());
        assert!(update_data(&c, 999, b"x").is_err());
    }

    #[test]
    fn edits_in_the_opened_file_flow_back_into_the_attachment() {
        let c = conn();
        let id = add(&c, "Brief.docx", "", b"version 1").unwrap().id;
        let dir = std::env::temp_dir().join(format!("wz-test-{}-{id}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("Brief.docx");
        std::fs::write(&path, b"version 1").unwrap();

        let watches = Watches::default();
        watches.watch(id, path.clone());
        assert!(sync_changes(&c, &watches, true).is_empty(), "unverändert: nichts zu tun");

        // Die Änderungszeit kann bei schnellen Schreibvorgängen gleich bleiben: sicher in die Zukunft setzen
        std::fs::write(&path, b"version 2 aus Word").unwrap();
        let later = SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(later).unwrap();

        assert!(sync_changes(&c, &watches, true).is_empty(), "erst abwarten, ob noch geschrieben wird");
        assert_eq!(get(&c, id).unwrap().1, b"version 1");
        let done = sync_changes(&c, &watches, true);
        assert_eq!(done.len(), 1);
        assert_eq!(get(&c, id).unwrap().1, b"version 2 aus Word");
        assert!(sync_changes(&c, &watches, true).is_empty(), "nicht noch einmal übernehmen");

        // Beim Beenden gilt jede Änderung sofort
        std::fs::write(&path, b"version 3").unwrap();
        std::fs::File::options().write(true).open(&path).unwrap().set_modified(later + std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(sync_changes(&c, &watches, false).len(), 1);
        assert_eq!(get(&c, id).unwrap().1, b"version 3");

        // Eine gelöschte Datei wird nicht weiter beobachtet
        std::fs::remove_dir_all(&dir).unwrap();
        for _ in 0..MISSING_LIMIT - 1 {
            assert!(sync_changes(&c, &watches, true).is_empty());
            assert!(!watches.is_empty(), "kurz fehlende Datei (Speichern in Word) bleibt unter Beobachtung");
        }
        assert!(sync_changes(&c, &watches, true).is_empty());
        assert!(watches.is_empty());
    }

    #[test]
    fn exports_are_written_only_as_docx_into_existing_folders() {
        let dir = std::env::temp_dir().join(format!("wz-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("Seite.DOCX");
        write_export(ok.to_str().unwrap(), b"PK-test").unwrap();
        assert_eq!(std::fs::read(&ok).unwrap(), b"PK-test");
        write_export(ok.to_str().unwrap(), b"neu").unwrap();
        assert_eq!(std::fs::read(&ok).unwrap(), b"neu", "überschreibt");

        assert!(write_export(dir.join("x.exe").to_str().unwrap(), b"x").is_err(), "nur .docx");
        assert!(write_export(dir.join("x").to_str().unwrap(), b"x").is_err());
        assert!(write_export(dir.join("fehlt").join("x.docx").to_str().unwrap(), b"x").is_err(), "Ordner muss existieren");
        assert!(write_export(ok.to_str().unwrap(), b"").is_err(), "leer");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
