//! Dokumentation: ein Wiki aus verschachtelten Seiten für Bleibendes (Notizen sind dagegen kurzlebig).
//!
//! Einträge sind Seiten (`page`, mit Text) oder Ordner (`folder`, nur zum Ordnen). Jede Seite hat einen Titel und Inhalt (`content` = HTML des Editors, `plain` = derselbe Inhalt als reiner Text
//! für die Suche). Seiten bilden einen Baum über `parent_id`; die Reihenfolge unter demselben Elternteil steht in
//! `position`. Das Löschen einer Seite löscht ihre Unterseiten mit.
//! `created_at`/`updated_at` sind UTC im Format `YYYY-MM-DD HH:MM:SS`.

use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

const MAX_TITLE: usize = 200;
const MAX_BODY_BYTES: usize = 2_000_000;
pub const MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocPage {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub title: String,
    pub content: String,
    pub plain: String,
    pub position: i64,
    pub favorite: bool,
    pub created_at: String,
    pub updated_at: String,
    /// `page` oder `folder`
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocInput {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub plain: String,
}

const COLUMNS: &str = "id, parent_id, title, content, plain, position, favorite, created_at, updated_at, kind";
const KINDS: [&str; 2] = ["page", "folder"];

fn row_to_page(row: &Row) -> rusqlite::Result<DocPage> {
    Ok(DocPage {
        id: row.get(0)?,
        parent_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        plain: row.get(4)?,
        position: row.get(5)?,
        favorite: row.get::<_, i64>(6)? != 0,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        kind: row.get(9)?,
    })
}

fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn clean_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.chars().count() > MAX_TITLE {
        return Err(format!("Der Titel darf höchstens {MAX_TITLE} Zeichen lang sein."));
    }
    Ok(title.to_string())
}

pub fn get_page(conn: &Connection, id: i64) -> Result<DocPage, String> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM doc_pages WHERE id = ?1"), params![id], row_to_page)
        .map_err(|_| "Seite nicht gefunden.".to_string())
}

/// Alle Seiten, sortiert nach Elternteil und Reihenfolge (die Anzeige baut daraus den Baum).
pub fn list_pages(conn: &Connection) -> Result<Vec<DocPage>, String> {
    let sql = format!("SELECT {COLUMNS} FROM doc_pages ORDER BY COALESCE(parent_id, 0), position, id");
    let mut stmt = conn.prepare(&sql).map_err(db_err)?;
    let rows = stmt.query_map([], row_to_page).map_err(db_err)?;
    rows.collect::<Result<_, _>>().map_err(db_err)
}

fn parent_of(conn: &Connection, id: i64) -> Result<Option<i64>, String> {
    conn.query_row("SELECT parent_id FROM doc_pages WHERE id = ?1", params![id], |r| r.get(0))
        .map_err(|_| "Seite nicht gefunden.".to_string())
}

/// Anzahl der Ebenen von der Wurzel bis zur Seite (Hauptebene = 1).
pub fn depth_of(conn: &Connection, id: i64) -> Result<usize, String> {
    let mut depth = 1;
    let mut current = parent_of(conn, id)?;
    while let Some(parent) = current {
        depth += 1;
        if depth > MAX_DEPTH + 1 {
            break;
        }
        current = parent_of(conn, parent)?;
    }
    Ok(depth)
}

/// Höhe des Teilbaums unter einer Seite (die Seite selbst = 1).
fn height_of(conn: &Connection, id: i64) -> Result<usize, String> {
    let mut stmt = conn.prepare("SELECT id FROM doc_pages WHERE parent_id = ?1").map_err(db_err)?;
    let children: Vec<i64> = stmt.query_map(params![id], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    let mut tallest = 0;
    for child in children {
        tallest = tallest.max(height_of(conn, child)?);
    }
    Ok(tallest + 1)
}

fn next_position(conn: &Connection, parent_id: Option<i64>) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM doc_pages WHERE parent_id IS ?1",
        params![parent_id],
        |r| r.get(0),
    )
    .map_err(db_err)
}

pub fn create_page(conn: &Connection, parent_id: Option<i64>, title: &str, kind: &str) -> Result<DocPage, String> {
    let title = clean_title(title)?;
    if !KINDS.contains(&kind) {
        return Err("Unbekannte Art des Eintrags.".into());
    }
    if let Some(parent) = parent_id {
        if depth_of(conn, parent)? >= MAX_DEPTH {
            return Err(format!("Seiten können höchstens {MAX_DEPTH} Ebenen tief verschachtelt werden."));
        }
    }
    let position = next_position(conn, parent_id)?;
    conn.execute(
        "INSERT INTO doc_pages (parent_id, title, position, kind) VALUES (?1, ?2, ?3, ?4)",
        params![parent_id, title, position, kind],
    )
        .map_err(db_err)?;
    get_page(conn, conn.last_insert_rowid())
}

pub fn update_page(conn: &Connection, id: i64, input: &DocInput) -> Result<DocPage, String> {
    let title = clean_title(&input.title)?;
    if input.content.len() > MAX_BODY_BYTES || input.plain.len() > MAX_BODY_BYTES {
        return Err("Die Seite ist zu lang.".into());
    }
    let changed = conn
        .execute(
            "UPDATE doc_pages SET title = ?1, content = ?2, plain = ?3, updated_at = datetime('now') WHERE id = ?4",
            params![title, input.content, input.plain, id],
        )
        .map_err(db_err)?;
    if changed == 0 {
        return Err("Seite nicht gefunden.".into());
    }
    get_page(conn, id)
}

/// Favorit ändert nicht den Zeitpunkt der letzten Bearbeitung.
pub fn set_favorite(conn: &Connection, id: i64, favorite: bool) -> Result<(), String> {
    let changed = conn
        .execute("UPDATE doc_pages SET favorite = ?1 WHERE id = ?2", params![favorite as i64, id])
        .map_err(db_err)?;
    if changed == 0 {
        return Err("Seite nicht gefunden.".into());
    }
    Ok(())
}

/// Hängt die Seite ans Ende unter einen anderen Elternteil (None = Hauptebene).
/// Darf die Seite unter diesen Elternteil? Nicht in sich selbst oder einen eigenen Nachfolger, nicht tiefer als erlaubt.
fn check_move(conn: &Connection, id: i64, new_parent: Option<i64>) -> Result<(), String> {
    if let Some(target) = new_parent {
        let mut cursor = Some(target);
        while let Some(node) = cursor {
            if node == id {
                return Err("Eine Seite kann nicht unter sich selbst oder ihren Unterseiten liegen.".into());
            }
            cursor = parent_of(conn, node)?;
        }
        if depth_of(conn, target)? + height_of(conn, id)? > MAX_DEPTH {
            return Err(format!("Seiten können höchstens {MAX_DEPTH} Ebenen tief verschachtelt werden."));
        }
    }
    Ok(())
}

/// Setzt die Seite unter `new_parent` an die Stelle `index` (0 = erste; zu große Werte = ans Ende). Funktioniert auch
/// innerhalb desselben Elternteils, dann ändert sich nur die Reihenfolge. Das ist die Grundlage fürs Ziehen im Baum.
pub fn place_page(conn: &Connection, id: i64, new_parent: Option<i64>, index: usize) -> Result<(), String> {
    let current = parent_of(conn, id)?;
    if current != new_parent {
        check_move(conn, id, new_parent)?;
    }
    let mut stmt = conn
        .prepare("SELECT id FROM doc_pages WHERE parent_id IS ?1 AND id <> ?2 ORDER BY position, id")
        .map_err(db_err)?;
    let mut ids: Vec<i64> = stmt.query_map(params![new_parent, id], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    ids.insert(index.min(ids.len()), id);
    conn.execute("UPDATE doc_pages SET parent_id = ?1 WHERE id = ?2", params![new_parent, id]).map_err(db_err)?;
    for (position, sibling) in ids.iter().enumerate() {
        conn.execute("UPDATE doc_pages SET position = ?1 WHERE id = ?2", params![position as i64, sibling]).map_err(db_err)?;
    }
    if current != new_parent {
        renumber(conn, current)?;
    }
    Ok(())
}

pub fn move_page(conn: &Connection, id: i64, new_parent: Option<i64>) -> Result<(), String> {
    let current = parent_of(conn, id)?;
    if current == new_parent {
        return Ok(());
    }
    check_move(conn, id, new_parent)?;
    let position = next_position(conn, new_parent)?;
    conn.execute("UPDATE doc_pages SET parent_id = ?1, position = ?2 WHERE id = ?3", params![new_parent, position, id])
        .map_err(db_err)?;
    renumber(conn, current)
}

/// Verschiebt die Seite um einen Platz nach oben (-1) oder unten (+1) unter demselben Elternteil.
pub fn shift_page(conn: &Connection, id: i64, delta: i64) -> Result<(), String> {
    let parent = parent_of(conn, id)?;
    let mut stmt = conn
        .prepare("SELECT id FROM doc_pages WHERE parent_id IS ?1 ORDER BY position, id")
        .map_err(db_err)?;
    let mut ids: Vec<i64> = stmt.query_map(params![parent], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    let index = ids.iter().position(|&x| x == id).ok_or("Seite nicht gefunden.")?;
    let target = index as i64 + delta.signum();
    if target < 0 || target >= ids.len() as i64 {
        return Ok(());
    }
    ids.swap(index, target as usize);
    for (position, sibling) in ids.iter().enumerate() {
        conn.execute("UPDATE doc_pages SET position = ?1 WHERE id = ?2", params![position as i64, sibling]).map_err(db_err)?;
    }
    Ok(())
}

/// Nummeriert die Geschwister unter einem Elternteil lückenlos neu.
fn renumber(conn: &Connection, parent: Option<i64>) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id FROM doc_pages WHERE parent_id IS ?1 ORDER BY position, id")
        .map_err(db_err)?;
    let ids: Vec<i64> = stmt.query_map(params![parent], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    for (position, id) in ids.iter().enumerate() {
        conn.execute("UPDATE doc_pages SET position = ?1 WHERE id = ?2", params![position as i64, id]).map_err(db_err)?;
    }
    Ok(())
}

const MAX_IMAGE_BYTES: usize = 12_000_000;
const IMAGE_MIMES: [&str; 5] = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

/// Speichert ein Bild und liefert seine ID. Die Seiten verweisen im Text per `data-image-id` darauf.
pub fn add_image(conn: &Connection, mime: &str, data: &[u8]) -> Result<i64, String> {
    if !IMAGE_MIMES.contains(&mime) {
        return Err("Dieses Bildformat wird nicht unterstützt (erlaubt: PNG, JPEG, WebP, GIF, AVIF).".into());
    }
    if data.is_empty() {
        return Err("Das Bild ist leer.".into());
    }
    if data.len() > MAX_IMAGE_BYTES {
        return Err("Das Bild ist zu groß (höchstens 12 MB).".into());
    }
    conn.execute("INSERT INTO doc_images (mime, data) VALUES (?1, ?2)", params![mime, data]).map_err(db_err)?;
    let id = conn.last_insert_rowid();
    // Gelegentlich aufräumen, damit verworfene Bilder nicht liegen bleiben
    let _ = gc_images(conn);
    Ok(id)
}

pub fn get_image(conn: &Connection, id: i64) -> Result<(String, Vec<u8>), String> {
    conn.query_row("SELECT mime, data FROM doc_images WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "Bild nicht gefunden.".to_string())
}

/// IDs aller Bilder, auf die der Text einer Seite verweist (`data-image-id="12"`).
fn referenced_image_ids(content: &str) -> Vec<i64> {
    const MARK: &str = "data-image-id=\"";
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

/// Entfernt Bilder, die keine Seite mehr verwendet. Ein Tag Schonfrist, damit „Rückgängig“ ein Bild zurückholen kann.
/// Liefert die Zahl der gelöschten Bilder.
pub fn gc_images(conn: &Connection) -> Result<usize, String> {
    let mut stmt = conn.prepare("SELECT content FROM doc_pages WHERE content LIKE '%data-image-id%'").map_err(db_err)?;
    let contents: Vec<String> = stmt.query_map([], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    let used: std::collections::HashSet<i64> = contents.iter().flat_map(|c| referenced_image_ids(c)).collect();

    let mut stmt = conn.prepare("SELECT id FROM doc_images WHERE created_at < datetime('now', '-1 day')").map_err(db_err)?;
    let old: Vec<i64> = stmt.query_map([], |r| r.get(0)).map_err(db_err)?.collect::<Result<_, _>>().map_err(db_err)?;
    let mut removed = 0;
    for id in old.into_iter().filter(|id| !used.contains(id)) {
        removed += conn.execute("DELETE FROM doc_images WHERE id = ?1", params![id]).map_err(db_err)?;
    }
    Ok(removed)
}

/// Löscht die Seite samt allen Unterseiten und liefert zurück, wie viele Seiten entfernt wurden.
pub fn delete_page(conn: &Connection, id: i64) -> Result<usize, String> {
    let parent = parent_of(conn, id)?;
    let before: i64 = conn.query_row("SELECT COUNT(*) FROM doc_pages", [], |r| r.get(0)).map_err(db_err)?;
    conn.execute("DELETE FROM doc_pages WHERE id = ?1", params![id]).map_err(db_err)?;
    let after: i64 = conn.query_row("SELECT COUNT(*) FROM doc_pages", [], |r| r.get(0)).map_err(db_err)?;
    renumber(conn, parent)?;
    let _ = gc_images(conn);
    let _ = crate::files::gc(conn);
    Ok((before - after) as usize)
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

    fn input(title: &str, content: &str) -> DocInput {
        DocInput { title: title.into(), content: format!("<p>{content}</p>"), plain: content.into() }
    }

    fn titles(c: &Connection, parent: Option<i64>) -> Vec<String> {
        list_pages(c).unwrap().into_iter().filter(|p| p.parent_id == parent).map(|p| p.title).collect()
    }

    #[test]
    fn creates_pages_in_order_under_parents() {
        let c = conn();
        let a = create_page(&c, None, " IT ", "page").unwrap();
        let b = create_page(&c, None, "Projekte", "page").unwrap();
        let child = create_page(&c, Some(a.id), "Netzwerk", "page").unwrap();
        assert_eq!(a.title, "IT", "Titel werden getrimmt");
        assert_eq!((a.position, b.position, child.position), (0, 1, 0));
        assert_eq!(titles(&c, None), ["IT", "Projekte"]);
        assert_eq!(titles(&c, Some(a.id)), ["Netzwerk"]);
        assert!(create_page(&c, Some(999), "X", "page").is_err(), "unbekannte Elternseite");
        assert!(create_page(&c, None, &"x".repeat(MAX_TITLE + 1), "page").is_err());
        assert!(create_page(&c, None, "", "page").is_ok(), "leerer Titel ist erlaubt (Anzeige: Unbenannt)");
    }

    #[test]
    fn folders_hold_pages_and_reject_unknown_kinds() {
        let c = conn();
        let folder = create_page(&c, None, "Powershell", "folder").unwrap();
        assert_eq!(folder.kind, "folder");
        let page = create_page(&c, Some(folder.id), "Test", "page").unwrap();
        let sub = create_page(&c, Some(folder.id), "Unterordner", "folder").unwrap();
        assert_eq!((page.kind.as_str(), page.position, sub.position), ("page", 0, 1));
        assert!(create_page(&c, None, "X", "datei").is_err());
        assert_eq!(delete_page(&c, folder.id).unwrap(), 3, "Ordner löschen entfernt den Inhalt mit");
    }

    #[test]
    fn update_changes_content_and_validates() {
        let c = conn();
        let p = create_page(&c, None, "A", "page").unwrap();
        let u = update_page(&c, p.id, &input("Neu", "Hallo Welt")).unwrap();
        assert_eq!((u.title.as_str(), u.plain.as_str()), ("Neu", "Hallo Welt"));
        assert!(update_page(&c, 999, &input("x", "y")).is_err());
        let too_long = DocInput { title: "x".into(), content: "x".repeat(MAX_BODY_BYTES + 1), plain: String::new() };
        assert!(update_page(&c, p.id, &too_long).is_err());
    }

    #[test]
    fn favorite_toggles_without_touching_update_time() {
        let c = conn();
        let p = create_page(&c, None, "A", "page").unwrap();
        c.execute("UPDATE doc_pages SET updated_at = '2020-01-01 00:00:00' WHERE id = ?1", params![p.id]).unwrap();
        set_favorite(&c, p.id, true).unwrap();
        let got = get_page(&c, p.id).unwrap();
        assert!(got.favorite);
        assert_eq!(got.updated_at, "2020-01-01 00:00:00");
        set_favorite(&c, p.id, false).unwrap();
        assert!(!get_page(&c, p.id).unwrap().favorite);
        assert!(set_favorite(&c, 999, true).is_err());
    }

    #[test]
    fn shift_swaps_neighbours_and_stops_at_edges() {
        let c = conn();
        let a = create_page(&c, None, "A", "page").unwrap();
        let _b = create_page(&c, None, "B", "page").unwrap();
        let d = create_page(&c, None, "C", "page").unwrap();
        shift_page(&c, d.id, -1).unwrap();
        assert_eq!(titles(&c, None), ["A", "C", "B"]);
        shift_page(&c, a.id, -1).unwrap();
        assert_eq!(titles(&c, None), ["A", "C", "B"], "ganz oben passiert nichts");
        shift_page(&c, a.id, 1).unwrap();
        assert_eq!(titles(&c, None), ["C", "A", "B"]);
        shift_page(&c, d.id, 5).unwrap();
        assert_eq!(titles(&c, None), ["A", "C", "B"], "Schrittweite wird auf einen Platz begrenzt");
    }

    #[test]
    fn move_appends_and_rejects_cycles() {
        let c = conn();
        let a = create_page(&c, None, "A", "page").unwrap();
        let b = create_page(&c, Some(a.id), "B", "page").unwrap();
        let d = create_page(&c, Some(b.id), "C", "page").unwrap();
        let e = create_page(&c, None, "E", "page").unwrap();

        assert!(move_page(&c, a.id, Some(a.id)).is_err(), "nicht unter sich selbst");
        assert!(move_page(&c, a.id, Some(d.id)).is_err(), "nicht unter eine Unterseite");
        assert!(move_page(&c, 999, None).is_err());

        move_page(&c, d.id, Some(e.id)).unwrap();
        assert_eq!(titles(&c, Some(e.id)), ["C"]);
        assert!(titles(&c, Some(b.id)).is_empty());

        move_page(&c, b.id, None).unwrap();
        assert_eq!(titles(&c, None), ["A", "E", "B"], "ans Ende der Hauptebene");
        let positions: Vec<i64> = list_pages(&c).unwrap().into_iter().filter(|p| p.parent_id.is_none()).map(|p| p.position).collect();
        assert_eq!(positions, [0, 1, 2]);
    }

    #[test]
    fn nesting_depth_is_limited() {
        let c = conn();
        let mut parent = create_page(&c, None, "0", "page").unwrap();
        for level in 1..MAX_DEPTH {
            parent = create_page(&c, Some(parent.id), &level.to_string(), "page").unwrap();
        }
        assert!(create_page(&c, Some(parent.id), "zu tief", "page").is_err());

        // Ein Teilbaum darf auch durch Verschieben nicht zu tief werden
        let root = create_page(&c, None, "Wurzel", "page").unwrap();
        let _sub = create_page(&c, Some(root.id), "Unterseite", "page").unwrap();
        assert!(move_page(&c, root.id, Some(parent.id)).is_err());
    }

    #[test]
    fn delete_removes_subtree_and_renumbers() {
        let c = conn();
        let a = create_page(&c, None, "A", "page").unwrap();
        let b = create_page(&c, None, "B", "page").unwrap();
        let _d = create_page(&c, None, "C", "page").unwrap();
        let sub = create_page(&c, Some(b.id), "B1", "page").unwrap();
        create_page(&c, Some(sub.id), "B1a", "page").unwrap();

        assert_eq!(delete_page(&c, b.id).unwrap(), 3);
        assert_eq!(titles(&c, None), ["A", "C"]);
        let positions: Vec<i64> = list_pages(&c).unwrap().into_iter().map(|p| p.position).collect();
        assert_eq!(positions, [0, 1]);
        assert!(delete_page(&c, b.id).is_err());
        assert_eq!(delete_page(&c, a.id).unwrap(), 1);
    }

    #[test]
    fn images_are_stored_validated_and_collected() {
        let c = conn();
        let png = [0x89, b'P', b'N', b'G', 1, 2, 3];
        let id = add_image(&c, "image/png", &png).unwrap();
        let (mime, data) = get_image(&c, id).unwrap();
        assert_eq!((mime.as_str(), data.as_slice()), ("image/png", &png[..]));

        assert!(add_image(&c, "image/svg+xml", b"<svg/>").is_err(), "SVG kann Skripte enthalten und wird nicht angenommen");
        assert!(add_image(&c, "text/html", b"x").is_err());
        assert!(add_image(&c, "image/png", &[]).is_err());
        assert!(add_image(&c, "image/png", &vec![0u8; MAX_IMAGE_BYTES + 1]).is_err());
        assert!(get_image(&c, 999).is_err());

        // Verwendet und unverwendet, beide alt: nur das unverwendete wird entfernt
        let used = add_image(&c, "image/png", &png).unwrap();
        let unused = add_image(&c, "image/png", &png).unwrap();
        let page = create_page(&c, None, "Seite", "page").unwrap();
        update_page(&c, page.id, &DocInput { title: "Seite".into(), content: format!("<p>x</p><img data-image-id=\"{used}\" data-width=\"300\">"), plain: "x".into() }).unwrap();
        c.execute("UPDATE doc_images SET created_at = datetime('now', '-2 days')", []).unwrap();
        c.execute("UPDATE doc_images SET created_at = datetime('now') WHERE id = ?1", params![id]).unwrap();
        assert_eq!(gc_images(&c).unwrap(), 1, "nur das alte, unverwendete Bild");
        assert!(get_image(&c, used).is_ok());
        assert!(get_image(&c, unused).is_err());
        assert!(get_image(&c, id).is_ok(), "frische Bilder haben Schonfrist");

        // Seite löschen: das Bild wird frei, bleibt aber wegen der Schonfrist zunächst erhalten, wenn es jung ist
        delete_page(&c, page.id).unwrap();
        assert!(get_image(&c, used).is_err(), "altes Bild ohne Verweis wird beim Löschen der Seite aufgeräumt");
    }

    #[test]
    fn image_references_are_found_in_html() {
        let html = r#"<p>a</p><img data-image-id="3" src=""><table><td><img data-width="1" data-image-id="12"></td></table><img data-image-id="x">"#;
        assert_eq!(referenced_image_ids(html), [3, 12]);
        assert!(referenced_image_ids("<p>nichts</p>").is_empty());
    }

    #[test]
    fn place_reorders_and_moves_to_exact_positions() {
        let c = conn();
        let a = create_page(&c, None, "A", "folder").unwrap();
        let b = create_page(&c, None, "B", "page").unwrap();
        let d = create_page(&c, None, "D", "page").unwrap();
        let in_a = create_page(&c, Some(a.id), "In A", "page").unwrap();
        let titles = |parent: Option<i64>| -> Vec<String> {
            let mut pages: Vec<DocPage> = list_pages(&c).unwrap().into_iter().filter(|p| p.parent_id == parent).collect();
            pages.sort_by_key(|p| (p.position, p.id));
            pages.into_iter().map(|p| p.title).collect()
        };
        assert_eq!(titles(None), ["A", "B", "D"]);

        // Innerhalb derselben Ebene: D ganz nach vorn
        place_page(&c, d.id, None, 0).unwrap();
        assert_eq!(titles(None), ["D", "A", "B"]);
        // In einen Ordner, an die erste Stelle; die Hauptebene rückt lückenlos nach
        place_page(&c, b.id, Some(a.id), 0).unwrap();
        assert_eq!(titles(Some(a.id)), ["B", "In A"]);
        assert_eq!(titles(None), ["D", "A"]);
        let positions: Vec<i64> = list_pages(&c).unwrap().into_iter().filter(|p| p.parent_id.is_none()).map(|p| p.position).collect();
        assert!(positions.contains(&0) && positions.contains(&1) && positions.len() == 2);
        // Zu großer Index = ans Ende, und wieder hinaus auf die Hauptebene
        place_page(&c, in_a.id, None, 99).unwrap();
        assert_eq!(titles(None), ["D", "A", "In A"]);

        // Unter sich selbst oder einen Nachfolger geht nicht
        assert!(place_page(&c, a.id, Some(b.id), 0).is_err());
        assert!(place_page(&c, a.id, Some(a.id), 0).is_err());
        assert!(place_page(&c, 999, None, 0).is_err());
    }
}
