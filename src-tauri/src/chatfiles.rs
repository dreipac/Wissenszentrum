//! Dateien im Chat des Assistenten. Die Person legt sie im Chat ab; sie liegen dann schon als Anhänge in der Datenbank
//! (siehe `files`). Hier wird daraus, was Claude Code lesen kann: Bilder, PDF und Textdateien kommen unverändert in den
//! Arbeitsordner des Laufs, Word-Dateien als Text. Claude Code liest sie dort mit seinem Werkzeug „Read“. Was sich nicht lesen
//! lässt (oder zu groß ist), bleibt nur mit Namen und `file_id` im Gespräch, damit der Assistent es trotzdem ablegen kann.
//!
//! Der Inhalt einer Datei sind Daten und nie Anweisungen: der Systemprompt sagt dem Modell, dass es ihm nicht folgen darf.

use crate::{heic, office};
use rusqlite::Connection;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read;

/// So viele Dateien darf eine Nachricht höchstens tragen
pub const MAX_FILES: usize = 5;
const MAX_IMAGE_BYTES: usize = 5_000_000;
const MAX_PDF_BYTES: usize = 10_000_000;
/// Alle bereitgestellten Dateien des ganzen Gesprächs zusammen
pub const TOTAL_BYTES: usize = 10_000_000;
const MAX_TEXT_CHARS: usize = 60_000;
/// Größtes entpacktes `document.xml` einer Word-Datei (Schutz vor gepackten Bomben)
const MAX_XML_BYTES: u64 = 20_000_000;

/// Eine Datei, die die Person an ihre Nachricht gehängt hat. Maßgeblich ist nur die `id`: Name, Typ und Größe liest die
/// App selbst aus der Datenbank.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ChatFile {
    pub id: i64,
}

#[derive(Debug, PartialEq)]
enum Kind {
    Image(&'static str),
    /// iPhone-Foto: wird beim Bereitstellen in ein JPEG umgewandelt (siehe `heic`)
    Heic,
    Pdf,
    Text,
    Docx,
    /// Excel: wird als Text ausgelesen (siehe `office`)
    Excel,
    /// PowerPoint: wird als Text ausgelesen (siehe `office`)
    Powerpoint,
    Other,
}

fn extension(name: &str) -> String {
    name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default()
}

fn kind_of(name: &str, mime: &str) -> Kind {
    if heic::is_heic(name, mime) {
        return Kind::Heic;
    }
    match extension(name).as_str() {
        "png" => Kind::Image("image/png"),
        "jpg" | "jpeg" => Kind::Image("image/jpeg"),
        "gif" => Kind::Image("image/gif"),
        "webp" => Kind::Image("image/webp"),
        "pdf" => Kind::Pdf,
        "docx" => Kind::Docx,
        "xlsx" | "xlsm" | "xlsb" | "xls" => Kind::Excel,
        "pptx" | "pptm" | "ppsx" => Kind::Powerpoint,
        "txt" | "md" | "markdown" | "csv" | "tsv" | "json" | "xml" | "html" | "htm" | "log" | "yaml" | "yml" | "ini" | "toml" | "sql" | "rs" | "py" | "ts" | "tsx" | "js" | "jsx" | "css" => Kind::Text,
        // Ohne bekannte Endung entscheidet der Typ. Die Endung geht vor: Windows meldet auch .csv als „application/vnd.ms-excel“.
        _ if mime == "application/pdf" => Kind::Pdf,
        _ if office::is_excel("", mime) => Kind::Excel,
        _ if office::is_powerpoint("", mime) => Kind::Powerpoint,
        _ if mime.starts_with("text/") => Kind::Text,
        _ => Kind::Other,
    }
}

/// Der Text einer Textdatei, in welcher Zeichencodierung sie auch gespeichert ist: mit Marke (BOM) als UTF-8 oder UTF-16
/// (Excel „Unicode-Text“), ohne Marke als UTF-8 und, wenn das nicht aufgeht, als Windows-1252. So speichert Excel unter
/// deutschem Windows eine CSV-Datei („CSV (Trennzeichen-getrennt)“), und Umlaute blieben sonst Fragezeichen.
fn decode_text(data: &[u8]) -> String {
    if let Some((encoding, bom_len)) = encoding_rs::Encoding::for_bom(data) {
        return encoding.decode_without_bom_handling(&data[bom_len..]).0.into_owned();
    }
    match std::str::from_utf8(data) {
        Ok(text) => text.to_string(),
        Err(_) => encoding_rs::WINDOWS_1252.decode_without_bom_handling(data).0.into_owned(),
    }
}

pub fn human_size(bytes: i64) -> String {
    if bytes >= 1_000_000 {
        format!("{:.1} MB", bytes as f64 / 1_000_000.0)
    } else {
        format!("{} KB", (bytes + 999) / 1000)
    }
}

/// Reiner Text aus dem XML einer Word-Datei: Absätze werden Zeilen, Tabulatoren und Umbrüche bleiben erhalten.
fn docx_text(xml: &str) -> String {
    let mut out = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find('<') {
        out.push_str(&decode(&rest[..start]));
        let Some(end) = rest[start..].find('>') else { break };
        let tag = &rest[start + 1..start + end];
        let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
        match (tag.starts_with('/'), name) {
            (true, "w:p") => out.push('\n'),
            // Leerer Absatz, als <w:p/> geschrieben
            (false, "w:p") if tag.ends_with('/') => out.push('\n'),
            (false, "w:tab") => out.push('\t'),
            (false, "w:br") | (false, "w:cr") => out.push('\n'),
            _ => {}
        }
        rest = &rest[start + end + 1..];
    }
    // Leere Zeilen am Rand und Mehrfach-Leerzeilen weg
    let mut text = String::new();
    let mut blank = 0;
    for line in out.lines() {
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        text.push_str(line.trim_end());
        text.push('\n');
    }
    text.trim().to_string()
}

fn decode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(semi) = tail.find(';').filter(|s| *s <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let entity = &tail[1..semi];
        let replaced = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            e if e.starts_with("#x") => u32::from_str_radix(&e[2..], 16).ok().and_then(char::from_u32),
            e if e.starts_with('#') => e[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match replaced {
            Some(c) => {
                out.push(c);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn read_docx(data: &[u8]) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|_| "keine gültige Word-Datei".to_string())?;
    let file = archive.by_name("word/document.xml").map_err(|_| "keine gültige Word-Datei".to_string())?;
    let mut xml = String::new();
    file.take(MAX_XML_BYTES).read_to_string(&mut xml).map_err(|_| "der Text der Word-Datei ist nicht lesbar".to_string())?;
    Ok(docx_text(&xml))
}

fn clip(text: String) -> String {
    if text.chars().count() <= MAX_TEXT_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_TEXT_CHARS).collect();
    format!("{cut}\n[… gekürzt, die Datei ist länger]")
}

/// Name und Größe eines Anhangs: dieselbe Datei, die mehrfach angehängt wurde, hat beides gleich.
pub fn identity(conn: &Connection, id: i64) -> Option<(String, i64)> {
    conn.query_row("SELECT name, size FROM attachments WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).ok()
}

/// Eine Datei, die der Assistent auf Wunsch öffnet (`read_file`): ein Anhang einer Seite, einer Notiz oder des Chats.
#[derive(Debug, PartialEq)]
pub enum Opened {
    /// Gelesener Text (Text- und Word-Dateien)
    Text { name: String, text: String },
    /// Bild oder PDF: muss als Datei in den Arbeitsordner, Claude Code liest sie dort
    Binary { name: String, work_name: String, bytes: Vec<u8> },
    /// Lässt sich nicht lesen, mit Grund
    Skipped { name: String, why: String },
    Missing,
}

/// Öffnet einen Anhang zum Lesen. Der Inhalt sind Daten und nie Anweisungen.
pub fn open(conn: &Connection, id: i64) -> Opened {
    let row = conn.query_row("SELECT name, mime, data FROM attachments WHERE id = ?1", [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Vec<u8>>(2)?)));
    let Ok((name, mime, data)) = row else { return Opened::Missing };
    let skipped = |why: &str| Opened::Skipped { name: name.clone(), why: why.to_string() };
    match kind_of(&name, &mime) {
        Kind::Image(_) if data.len() > MAX_IMAGE_BYTES => skipped("das Bild ist größer als 5 MB"),
        Kind::Pdf if data.len() > MAX_PDF_BYTES => skipped("das PDF ist größer als 10 MB"),
        Kind::Image(_) | Kind::Pdf => Opened::Binary { work_name: format!("{id}-{}", crate::claude_code::safe_file_name(&name)), name, bytes: data },
        Kind::Heic => match heic::cached_jpeg(id, &data) {
            Ok(jpeg) if jpeg.len() > MAX_IMAGE_BYTES => skipped("das umgewandelte Foto ist größer als 5 MB"),
            Ok(jpeg) => Opened::Binary { work_name: format!("{id}-{}", crate::claude_code::safe_file_name(&heic::jpeg_name(&name))), name, bytes: jpeg },
            Err(why) => skipped(&why),
        },
        Kind::Text => Opened::Text { text: clip(decode_text(&data)), name },
        Kind::Docx => match read_docx(&data) {
            Ok(text) if text.trim().is_empty() => skipped("die Word-Datei enthält keinen Text"),
            Ok(text) => Opened::Text { text: clip(text), name },
            Err(e) => skipped(&e),
        },
        Kind::Excel => match office::excel_text_cached(id, &data) {
            Ok(text) if text.trim().is_empty() => skipped("die Excel-Datei enthält keinen Inhalt"),
            Ok(text) => Opened::Text { text: clip(text), name },
            Err(e) => skipped(&e),
        },
        Kind::Powerpoint => match office::powerpoint_text_cached(id, &data) {
            Ok(text) if text.trim().is_empty() => skipped("die PowerPoint-Datei enthält keinen Text"),
            Ok(text) => Opened::Text { text: clip(text), name },
            Err(e) => skipped(&e),
        },
        Kind::Other => skipped("dieser Dateityp wird nicht gelesen (lesbar: Bilder, PDF, Text, Word, Excel, PowerPoint)"),
    }
}

/// Eine Datei des Chats, vorbereitet für einen Lauf.
#[derive(Debug)]
pub struct Prepared {
    /// Die Zeile für die Eingabe: Name, `file_id` und wo die Datei liegt (oder warum nicht)
    pub description: String,
    /// Dateiname im Arbeitsordner und Inhalt, wenn die Datei bereitgestellt wird
    pub file: Option<(String, Vec<u8>)>,
}

/// Bereitet die Dateien einer Nachricht vor. Jede bekommt eine Zeile mit Namen und `file_id` (damit der Assistent sie
/// ablegen kann). `budget` (Bytes) gilt für das ganze Gespräch; wer ihn von der neuesten Nachricht rückwärts weiterreicht, lässt
/// bei Platzmangel die ältesten Dateien zuerst weichen. `same_as` verweist eine Datei, die schon einmal weiter oben im Gespräch
/// steht, auf diese Stelle: sie wird nicht noch einmal bereitgestellt.
pub fn prepare(conn: &Connection, files: &[ChatFile], budget: &mut usize, same_as: &HashMap<i64, i64>) -> Vec<Prepared> {
    let mut out = Vec::new();
    for file in files.iter().take(MAX_FILES) {
        let row = conn.query_row("SELECT name, mime, size, data FROM attachments WHERE id = ?1", [file.id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, Vec<u8>>(3)?))
        });
        let Ok((name, mime, size, data)) = row else {
            out.push(Prepared { description: format!("Angehängte Datei (file_id {}): gibt es nicht mehr.", file.id), file: None });
            continue;
        };
        let head = format!("Angehängte Datei „{name}“ (file_id {}, {mime}, {})", file.id, human_size(size));
        if let Some(first) = same_as.get(&file.id) {
            out.push(Prepared { description: format!("{head}. Dieselbe Datei steht schon weiter oben im Gespräch (file_id {first}), dort ist ihr Inhalt."), file: None });
            continue;
        }
        let work_name = format!("{}-{}", file.id, crate::claude_code::safe_file_name(&name));
        let fits = |len: usize, budget: &usize| len <= *budget;
        let skip = |why: &str| Prepared { description: format!("{head}. Inhalt nicht bereitgestellt: {why}. Ablegen lässt sie sich trotzdem."), file: None };
        let ready = |work: String, kind: &str, bytes: Vec<u8>| Prepared { description: format!("{head}: liegt im Arbeitsordner {kind}als „{work}“. Lies sie mit dem Werkzeug Read."), file: Some((work, bytes)) };

        out.push(match kind_of(&name, &mime) {
            Kind::Image(_) if data.len() > MAX_IMAGE_BYTES => skip("das Bild ist größer als 5 MB"),
            Kind::Pdf if data.len() > MAX_PDF_BYTES => skip("das PDF ist größer als 10 MB"),
            Kind::Image(_) | Kind::Pdf if !fits(data.len(), budget) => skip("alle Dateien im Gespräch zusammen sind zu groß"),
            Kind::Image(_) | Kind::Pdf => {
                *budget -= data.len();
                ready(work_name, "", data)
            }
            Kind::Heic => match heic::cached_jpeg(file.id, &data) {
                Ok(jpeg) if jpeg.len() > MAX_IMAGE_BYTES => skip("das umgewandelte Foto ist größer als 5 MB"),
                Ok(jpeg) if !fits(jpeg.len(), budget) => skip("alle Dateien im Gespräch zusammen sind zu groß"),
                Ok(jpeg) => {
                    *budget -= jpeg.len();
                    let work = format!("{}-{}", file.id, crate::claude_code::safe_file_name(&heic::jpeg_name(&name)));
                    ready(work, "(HEIC-Foto als JPEG umgewandelt) ", jpeg)
                }
                Err(why) => skip(&why),
            },
            Kind::Text => {
                let text = clip(decode_text(&data));
                if !fits(text.len(), budget) {
                    skip("alle Dateien im Gespräch zusammen sind zu groß")
                } else {
                    *budget -= text.len();
                    ready(work_name, "", text.into_bytes())
                }
            }
            Kind::Docx => match read_docx(&data) {
                Ok(text) if text.trim().is_empty() => skip("die Word-Datei enthält keinen Text"),
                Ok(text) => {
                    let text = clip(text);
                    if !fits(text.len(), budget) {
                        skip("alle Dateien im Gespräch zusammen sind zu groß")
                    } else {
                        *budget -= text.len();
                        ready(format!("{work_name}.txt"), "(Word-Datei als Text) ", text.into_bytes())
                    }
                }
                Err(e) => skip(&e),
            },
            Kind::Excel => match office::excel_text_cached(file.id, &data) {
                Ok(text) if text.trim().is_empty() => skip("die Excel-Datei enthält keinen Inhalt"),
                Ok(text) => {
                    let text = clip(text);
                    if !fits(text.len(), budget) {
                        skip("alle Dateien im Gespräch zusammen sind zu groß")
                    } else {
                        *budget -= text.len();
                        ready(format!("{work_name}.txt"), "(Excel-Datei als Text) ", text.into_bytes())
                    }
                }
                Err(e) => skip(&e),
            },
            Kind::Powerpoint => match office::powerpoint_text_cached(file.id, &data) {
                Ok(text) if text.trim().is_empty() => skip("die PowerPoint-Datei enthält keinen Text"),
                Ok(text) => {
                    let text = clip(text);
                    if !fits(text.len(), budget) {
                        skip("alle Dateien im Gespräch zusammen sind zu groß")
                    } else {
                        *budget -= text.len();
                        ready(format!("{work_name}.txt"), "(PowerPoint-Datei als Text) ", text.into_bytes())
                    }
                }
                Err(e) => skip(&e),
            },
            Kind::Other => skip("dieser Dateityp wird nicht gelesen (lesbar: Bilder, PDF, Text, Word, Excel, PowerPoint)"),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::init(&c).unwrap();
        c
    }

    fn add(c: &Connection, name: &str, mime: &str, data: &[u8]) -> i64 {
        crate::files::add(c, name, mime, data).unwrap().id
    }

    fn docx(xml: &str) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(xml.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        buf.into_inner()
    }

    fn descriptions(items: &[Prepared]) -> String {
        items.iter().map(|p| p.description.as_str()).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn kinds_follow_the_extension_first() {
        assert_eq!(kind_of("Foto.JPG", ""), Kind::Image("image/jpeg"));
        assert_eq!(kind_of("Plan.pdf", "application/octet-stream"), Kind::Pdf);
        assert_eq!(kind_of("Brief.docx", ""), Kind::Docx);
        assert_eq!(kind_of("notizen", "text/plain"), Kind::Text);
        assert_eq!(kind_of("Archiv.zip", ""), Kind::Other);
    }

    #[test]
    fn word_text_keeps_paragraphs_and_entities() {
        let xml = "<w:document><w:body><w:p><w:r><w:t>Ziel &amp; Zweck</w:t></w:r></w:p><w:p><w:r><w:t>A</w:t></w:r><w:r><w:tab/><w:t>B</w:t></w:r></w:p><w:p/><w:p/><w:p><w:r><w:t>Ende</w:t></w:r></w:p></w:body></w:document>";
        assert_eq!(docx_text(xml), "Ziel & Zweck\nA\tB\n\nEnde");
        assert_eq!(read_docx(&docx(xml)).unwrap(), "Ziel & Zweck\nA\tB\n\nEnde");
        assert!(read_docx(b"kein zip").is_err());
    }

    #[test]
    fn readable_files_are_provided_and_the_rest_keeps_its_id() {
        let c = conn();
        let text = add(&c, "Notiz.txt", "text/plain", "Hallo Welt".as_bytes());
        let pdf = add(&c, "Plan.pdf", "application/pdf", b"%PDF-1.4 x");
        let png = add(&c, "Bild.png", "image/png", &[137, 80, 78, 71]);
        let word = add(&c, "Brief.docx", "", &docx("<w:document><w:p><w:r><w:t>Guten Tag</w:t></w:r></w:p></w:document>"));
        let zip = add(&c, "Archiv.zip", "", b"PK");
        let files: Vec<ChatFile> = [text, pdf, png, word, zip].iter().map(|id| ChatFile { id: *id }).collect();

        let mut budget = TOTAL_BYTES;
        let items = prepare(&c, &files, &mut budget, &HashMap::new());
        let joined = descriptions(&items);
        assert!(joined.contains(&format!("file_id {text}")) && joined.contains(&format!("{text}-Notiz.txt")), "{joined}");
        assert!(joined.contains(&format!("{pdf}-Plan.pdf")) && joined.contains(&format!("{png}-Bild.png")), "{joined}");
        assert!(joined.contains(&format!("file_id {zip}")) && joined.contains("nicht bereitgestellt"), "{joined}");

        let provided: HashMap<String, Vec<u8>> = items.iter().filter_map(|p| p.file.clone()).collect();
        assert_eq!(provided[&format!("{text}-Notiz.txt")], b"Hallo Welt");
        assert_eq!(provided[&format!("{pdf}-Plan.pdf")], b"%PDF-1.4 x");
        assert_eq!(String::from_utf8_lossy(&provided[&format!("{word}-Brief.docx.txt")]), "Guten Tag", "Word kommt als Text");
        assert_eq!(provided.len(), 4, "die zip-Datei wird nicht bereitgestellt");

        // Ist das Budget des Gesprächs aufgebraucht, bleiben Name und id, aber keine Datei
        let old = prepare(&c, &files, &mut 0, &HashMap::new());
        assert_eq!(old.len(), 5);
        assert!(old.iter().all(|p| p.file.is_none()));
        assert!(descriptions(&old).contains(&format!("file_id {text}")));
    }

    #[test]
    fn oversized_and_missing_files_are_skipped_with_a_reason() {
        let c = conn();
        let big = add(&c, "Gross.png", "image/png", &vec![1u8; MAX_IMAGE_BYTES + 1]);
        let items = prepare(&c, &[ChatFile { id: big }, ChatFile { id: 9999 }], &mut TOTAL_BYTES.clone(), &HashMap::new());
        let joined = descriptions(&items);
        assert!(joined.contains("größer als 5 MB"), "{joined}");
        assert!(joined.contains("gibt es nicht mehr"), "{joined}");
        assert!(items.iter().all(|p| p.file.is_none()));
    }

    #[test]
    fn long_text_is_clipped() {
        let c = conn();
        let id = add(&c, "Lang.txt", "text/plain", "a".repeat(MAX_TEXT_CHARS + 500).as_bytes());
        let items = prepare(&c, &[ChatFile { id }], &mut TOTAL_BYTES.clone(), &HashMap::new());
        let (_, bytes) = items[0].file.clone().unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("gekürzt") && text.chars().count() < MAX_TEXT_CHARS + 300);
    }

    #[test]
    fn the_budget_is_shared_so_older_files_give_way_first() {
        let c = conn();
        let old = add(&c, "Alt.txt", "text/plain", "alter Inhalt".as_bytes());
        let new = add(&c, "Neu.txt", "text/plain", "neuer Inhalt".as_bytes());
        // Platz nur für eine der beiden Dateien; wer von hinten anfängt, behält die neueste
        let mut budget = "neuer Inhalt".len();
        let newest = prepare(&c, &[ChatFile { id: new }], &mut budget, &HashMap::new());
        let oldest = prepare(&c, &[ChatFile { id: old }], &mut budget, &HashMap::new());
        assert!(newest[0].file.is_some());
        assert!(oldest[0].file.is_none() && oldest[0].description.contains(&format!("file_id {old}")), "{}", oldest[0].description);
    }

    #[test]
    fn a_file_is_opened_by_its_id_as_text_or_as_a_file_for_the_work_folder() {
        let c = conn();
        let text = add(&c, "Notiz.txt", "text/plain", "Hallo Welt".as_bytes());
        let word = add(&c, "Brief.docx", "", &docx("<w:document><w:p><w:r><w:t>Guten Tag</w:t></w:r></w:p></w:document>"));
        let pdf = add(&c, "Plan.pdf", "application/pdf", b"%PDF-1.4 x");
        let sheet = add(&c, "Archiv.zip", "", b"PK");
        let big = add(&c, "Gross.png", "image/png", &vec![1u8; MAX_IMAGE_BYTES + 1]);

        assert_eq!(open(&c, text), Opened::Text { name: "Notiz.txt".into(), text: "Hallo Welt".into() });
        assert_eq!(open(&c, word), Opened::Text { name: "Brief.docx".into(), text: "Guten Tag".into() }, "Word kommt als Text");
        assert_eq!(open(&c, pdf), Opened::Binary { name: "Plan.pdf".into(), work_name: format!("{pdf}-Plan.pdf"), bytes: b"%PDF-1.4 x".to_vec() });
        assert!(matches!(open(&c, sheet), Opened::Skipped { why, .. } if why.contains("nicht gelesen")));
        assert!(matches!(open(&c, big), Opened::Skipped { why, .. } if why.contains("5 MB")));
        assert_eq!(open(&c, 9999), Opened::Missing);
    }

    #[test]
    fn the_same_file_attached_twice_is_provided_only_once() {
        let c = conn();
        let first = add(&c, "Plan.txt", "text/plain", "Inhalt".as_bytes());
        let again = add(&c, "Plan.txt", "text/plain", "Inhalt".as_bytes());
        let mut same_as = HashMap::new();
        same_as.insert(again, first);
        let items = prepare(&c, &[ChatFile { id: again }], &mut TOTAL_BYTES.clone(), &same_as);
        assert!(items[0].file.is_none());
        assert!(items[0].description.contains(&format!("file_id {first}")), "{}", items[0].description);
    }

    #[test]
    fn heic_photos_are_converted_to_jpeg_for_the_work_folder() {
        let c = conn();
        let rgb: Vec<u8> = (0..64 * 48).flat_map(|i| [(i % 64 * 4) as u8, (i / 64 * 5) as u8, 120]).collect();
        let heic = heifer::encode_rgb8(64, 48, &rgb, &heifer::EncodeOptions::default()).unwrap();
        let id = add(&c, "IMG_0001.HEIC", "image/heic", &heic);

        let mut budget = TOTAL_BYTES;
        let items = prepare(&c, &[ChatFile { id }], &mut budget, &HashMap::new());
        let (name, bytes) = items[0].file.as_ref().expect("das Foto wird bereitgestellt");
        assert_eq!(name, &format!("{id}-IMG_0001.jpg"));
        assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF], "ein JPEG");
        assert!(items[0].description.contains("HEIC-Foto als JPEG umgewandelt") && items[0].description.contains("IMG_0001.HEIC"), "{}", items[0].description);
        assert_eq!(budget, TOTAL_BYTES - bytes.len(), "das umgewandelte Foto zählt zum Budget");

        match open(&c, id) {
            Opened::Binary { work_name, bytes, .. } => {
                assert_eq!(work_name, format!("{id}-IMG_0001.jpg"));
                assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF]);
            }
            other => panic!("erwartet Binary, bekommen {other:?}"),
        }
        // Die Datei in der Datenbank bleibt das Original
        let stored: Vec<u8> = c.query_row("SELECT data FROM attachments WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        assert_eq!(stored, heic);
    }

    #[test]
    fn a_broken_heic_is_skipped_with_a_reason() {
        let c = conn();
        let id = add(&c, "Kaputt.heic", "", b"kein foto");
        let mut budget = TOTAL_BYTES;
        let items = prepare(&c, &[ChatFile { id }], &mut budget, &HashMap::new());
        assert!(items[0].file.is_none());
        assert!(items[0].description.contains("Inhalt nicht bereitgestellt") && items[0].description.contains("HEIC-Foto"), "{}", items[0].description);
        assert_eq!(budget, TOTAL_BYTES);
        assert!(matches!(open(&c, id), Opened::Skipped { .. }));
    }

    #[test]
    fn excel_and_powerpoint_files_are_provided_and_opened_as_text() {
        use crate::office::tests::{sample_pptx, sample_xlsx};
        assert_eq!(kind_of("Budget.XLSX", ""), Kind::Excel);
        assert_eq!(kind_of("alt.xls", ""), Kind::Excel);
        assert_eq!(kind_of("x", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), Kind::Excel);
        assert_eq!(kind_of("Folien.pptx", ""), Kind::Powerpoint);
        assert_eq!(kind_of("Alt.ppt", "application/vnd.ms-powerpoint"), Kind::Other, "das alte Binärformat bleibt unlesbar");

        let c = conn();
        let xlsx = add(&c, "Budget.XLSX", "", &sample_xlsx());
        let pptx = add(&c, "Praesentation.pptx", "", &sample_pptx());
        let mut budget = TOTAL_BYTES;
        let items = prepare(&c, &[ChatFile { id: xlsx }, ChatFile { id: pptx }], &mut budget, &HashMap::new());

        let (name, bytes) = items[0].file.as_ref().expect("Excel wird bereitgestellt");
        assert_eq!(name, &format!("{xlsx}-Budget.XLSX.txt"));
        let text = String::from_utf8_lossy(bytes);
        assert!(text.contains("Tabelle 1: „Budget“") && text.contains("2: Miete & Strom | 1200.5 | 2026-01-01"), "{text}");
        assert!(items[0].description.contains("(Excel-Datei als Text)"), "{}", items[0].description);

        let (name, bytes) = items[1].file.as_ref().expect("PowerPoint wird bereitgestellt");
        assert_eq!(name, &format!("{pptx}-Praesentation.pptx.txt"));
        assert!(String::from_utf8_lossy(bytes).contains("Folie 1: Projekt & Ziele"));
        assert!(items[1].description.contains("(PowerPoint-Datei als Text)"), "{}", items[1].description);
        assert!(budget < TOTAL_BYTES, "der Text zählt zum Budget");

        // Mit read_file: als Text zurück, nicht als Datei für den Arbeitsordner
        match open(&c, xlsx) {
            Opened::Text { name, text } => assert!(name == "Budget.XLSX" && text.contains("Summe")),
            other => panic!("erwartet Text, bekommen {other:?}"),
        }
        match open(&c, pptx) {
            Opened::Text { text, .. } => assert!(text.contains("Notizen: Hier die Zahlen nennen.")),
            other => panic!("erwartet Text, bekommen {other:?}"),
        }
    }

    #[test]
    fn broken_or_old_office_files_are_skipped_with_a_reason() {
        let c = conn();
        let bad_xlsx = add(&c, "Kaputt.xlsx", "", b"kein excel");
        let bad_pptx = add(&c, "Kaputt.pptx", "", b"keine folien");
        let old_ppt = add(&c, "Alt.ppt", "application/vnd.ms-powerpoint", b"binaer");
        let mut budget = TOTAL_BYTES;
        let items = prepare(&c, &[ChatFile { id: bad_xlsx }, ChatFile { id: bad_pptx }, ChatFile { id: old_ppt }], &mut budget, &HashMap::new());
        assert!(items.iter().all(|i| i.file.is_none()));
        assert!(items[0].description.contains("Excel-Datei") && items[1].description.contains("PowerPoint-Datei"), "{:?}", items);
        assert!(items[2].description.contains("PowerPoint"), "die Meldung nennt, was lesbar ist: {}", items[2].description);
        assert_eq!(budget, TOTAL_BYTES);
        for id in [bad_xlsx, bad_pptx, old_ppt] {
            assert!(matches!(open(&c, id), Opened::Skipped { .. }));
        }
    }

    #[test]
    fn csv_files_are_text_even_when_windows_calls_them_excel() {
        assert_eq!(kind_of("Umsatz.csv", "application/vnd.ms-excel"), Kind::Text, "die Endung geht vor dem Typ");
        assert_eq!(kind_of("Umsatz.CSV", "text/csv"), Kind::Text);
        assert_eq!(kind_of("Tabelle.tsv", ""), Kind::Text);
        assert_eq!(kind_of("Daten", "application/vnd.ms-excel"), Kind::Excel, "ohne Endung entscheidet der Typ");
        assert_eq!(kind_of("Folien", "application/vnd.openxmlformats-officedocument.presentationml.presentation"), Kind::Powerpoint);

        // So speichert Excel unter deutschem Windows: Windows-1252, Semikolon, Zeilenende CRLF
        let c = conn();
        let id = add(&c, "Umsatz.csv", "application/vnd.ms-excel", b"Name;Gr\xf6\xdfe;Preis\r\nM\xfcller;42;1,5\r\n");
        let mut budget = TOTAL_BYTES;
        let items = prepare(&c, &[ChatFile { id }], &mut budget, &HashMap::new());
        let (name, bytes) = items[0].file.as_ref().expect("CSV wird bereitgestellt");
        assert_eq!(name, &format!("{id}-Umsatz.csv"));
        assert_eq!(String::from_utf8_lossy(bytes), "Name;Größe;Preis\r\nMüller;42;1,5\r\n", "Umlaute bleiben erhalten");
        match open(&c, id) {
            Opened::Text { text, .. } => assert!(text.contains("Müller;42;1,5")),
            other => panic!("erwartet Text, bekommen {other:?}"),
        }
    }

    #[test]
    fn text_files_are_decoded_by_their_byte_order_mark_or_as_utf8_or_windows_1252() {
        assert_eq!(decode_text("Größe".as_bytes()), "Größe");
        assert_eq!(decode_text(b"\xEF\xBB\xBFName;Gr\xC3\xB6\xC3\x9Fe"), "Name;Größe", "UTF-8 mit Marke: die Marke verschwindet");
        // UTF-16 mit Marke (Excel „Unicode-Text“)
        let mut utf16 = vec![0xFF, 0xFE];
        for unit in "Größe\t1".encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_text(&utf16), "Größe\t1");
        assert_eq!(decode_text(b"Gr\xf6\xdfe \x80 \x96"), "Größe € –", "Windows-1252 mit Euro und Gedankenstrich");
        assert_eq!(decode_text(b""), "");
    }
}
