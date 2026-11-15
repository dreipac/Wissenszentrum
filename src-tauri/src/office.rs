//! Excel- und PowerPoint-Dateien als Text für den Assistenten (Word macht `chatfiles`).
//!
//! Excel (`.xlsx`, `.xlsm`, `.xlsb`, `.xls`) liest `calamine`: pro Tabelle eine Überschrift und dann jede nicht leere Zeile als
//! `Zeilennummer: Zelle | Zelle | …`. Datumszellen kommen als Datum, nicht als Seriennummer. Formeln zeigen ihren letzten Wert.
//! PowerPoint (`.pptx`) liest die App selbst aus dem XML: Folien in der Reihenfolge der Präsentation mit Titel, Text, Tabellen
//! und Sprechernotizen. Bilder, Diagramme und SmartArt kommen nicht vor; alte `.xls`-Dateien gehen, alte `.ppt` nicht.
//!
//! Die Dateien kommen von außen. Deshalb läuft das Auslesen wie bei den Fotos abgesichert: in einem eigenen Thread mit
//! Zeitlimit, ein Fehler wird zur Meldung, und gepackte Dateien (ein ZIP-Archiv) mit absurd großem Inhalt werden vorher
//! abgelehnt. Der Inhalt sind Daten und nie Anweisungen.

use calamine::{Data, DataType, ExcelDateTime, Reader};
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader as XmlReader, XmlVersion};
use std::io::{Cursor, Read};
use std::panic::AssertUnwindSafe;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

/// Alles, was ein Archiv entpackt zusammen groß sein darf (Schutz vor gepackten Bomben)
const MAX_UNPACKED_BYTES: u64 = 300_000_000;
/// Größtes einzelnes XML in einer PowerPoint-Datei
const MAX_XML_BYTES: u64 = 20_000_000;
const MAX_SHEETS: usize = 30;
const MAX_ROWS: usize = 2_000;
const MAX_COLS: usize = 60;
const MAX_SLIDES: usize = 300;
/// Ab dieser Länge hört das Auslesen auf; `chatfiles` kürzt danach auf das Maß für den Assistenten
const MAX_OUTPUT_BYTES: usize = 400_000;
const TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_ENTRIES: usize = 8;

/// Endungen, die als Excel-Datei gelten
pub fn is_excel(ext: &str, mime: &str) -> bool {
    matches!(ext, "xlsx" | "xlsm" | "xlsb" | "xls") || mime.contains("spreadsheetml.sheet") || mime == "application/vnd.ms-excel"
}

/// Endungen, die als PowerPoint-Datei gelten (das alte binäre `.ppt` gehört nicht dazu)
pub fn is_powerpoint(ext: &str, mime: &str) -> bool {
    matches!(ext, "pptx" | "pptm" | "ppsx") || mime.contains("presentationml.presentation") || mime.contains("presentationml.slideshow")
}

// --- Absicherung ------------------------------------------------------------------------------

/// Führt das Auslesen in einem eigenen Thread aus, mit Zeitlimit; eine Panik wird zur Meldung.
fn guarded(what: &str, job: impl FnOnce() -> Result<String, String> + Send + 'static) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    let spawned = std::thread::Builder::new().name("office".into()).stack_size(16 * 1024 * 1024).spawn(move || {
        let _ = tx.send(std::panic::catch_unwind(AssertUnwindSafe(job)));
    });
    if spawned.is_err() {
        return Err(format!("die {what} lässt sich gerade nicht lesen"));
    }
    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            log::error!("Office: das Auslesen einer {what} ist abgebrochen (Panik); die Datei wird übersprungen");
            Err(format!("die {what} ist beschädigt oder wird nicht unterstützt"))
        }
        Err(_) => Err(format!("das Lesen der {what} hat zu lange gedauert")),
    }
}

/// Lehnt ein Archiv ab, dessen Inhalt entpackt zu groß wäre. Andere Dateien (zum Beispiel altes `.xls`) prüft das nicht.
fn zip_guard(data: &[u8]) -> Result<(), String> {
    if !data.starts_with(b"PK") {
        return Ok(());
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(data)).map_err(|_| "die Datei ist kein gültiges Archiv".to_string())?;
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        total = total.saturating_add(archive.by_index_raw(i).map_err(|_| "die Datei ist kein gültiges Archiv".to_string())?.size());
        if total > MAX_UNPACKED_BYTES {
            return Err("die Datei ist entpackt zu groß".into());
        }
    }
    Ok(())
}

type CacheEntry = (i64, usize, Arc<String>);
static CACHE: Mutex<Vec<CacheEntry>> = Mutex::new(Vec::new());

/// Ein schon ausgelesener Anhang (gleiche Datei, gleiche Größe) kommt aus dem Speicher: jede Folgefrage im Chat liest die
/// Dateien sonst jedes Mal neu.
fn cached(id: i64, data: &[u8], read: impl FnOnce(&[u8]) -> Result<String, String>) -> Result<String, String> {
    if let Ok(cache) = CACHE.lock() {
        if let Some((_, _, text)) = cache.iter().find(|(i, len, _)| *i == id && *len == data.len()) {
            return Ok(text.as_ref().clone());
        }
    }
    let text = read(data)?;
    if let Ok(mut cache) = CACHE.lock() {
        cache.retain(|(i, _, _)| *i != id);
        if cache.len() >= CACHE_ENTRIES {
            cache.remove(0);
        }
        cache.push((id, data.len(), Arc::new(text.clone())));
    }
    Ok(text)
}

/// Der Text einer Excel-Datei (mit dem Anhang `id` als Schlüssel für den Zwischenspeicher).
pub fn excel_text_cached(id: i64, data: &[u8]) -> Result<String, String> {
    cached(id, data, excel_text)
}

/// Der Text einer PowerPoint-Datei (mit dem Anhang `id` als Schlüssel für den Zwischenspeicher).
pub fn powerpoint_text_cached(id: i64, data: &[u8]) -> Result<String, String> {
    cached(id, data, powerpoint_text)
}

pub fn excel_text(data: &[u8]) -> Result<String, String> {
    zip_guard(data)?;
    let owned = data.to_vec();
    guarded("Excel-Datei", move || excel_inner(&owned))
}

pub fn powerpoint_text(data: &[u8]) -> Result<String, String> {
    zip_guard(data)?;
    let owned = data.to_vec();
    guarded("PowerPoint-Datei", move || pptx_inner(&owned))
}

// --- Excel ------------------------------------------------------------------------------------

/// Spaltenbuchstaben (0 = A, 26 = AA)
fn col_letters(mut col: u32) -> String {
    let mut out = Vec::new();
    loop {
        out.push(b'A' + (col % 26) as u8);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Eine Zahl ohne Rechenrauschen (0,1+0,2 soll 0,3 sein) und ohne unnötige Nachkommastellen.
fn number(value: f64) -> String {
    if !value.is_finite() {
        return value.to_string();
    }
    let rounded = (value * 1e10).round() / 1e10;
    if rounded.fract() == 0.0 && rounded.abs() < 1e15 {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded}")
    }
}

fn date_text(value: &ExcelDateTime) -> String {
    if value.is_duration() {
        let minutes = (value.as_f64() * 1440.0).round() as i64;
        return format!("{}:{:02}", minutes / 60, minutes % 60);
    }
    let Some(moment) = value.as_datetime() else { return number(value.as_f64()) };
    let text = moment.to_string(); // 2026-01-01 14:30:00
    if value.as_f64() < 1.0 && text.len() >= 16 {
        return text[11..16].to_string(); // nur eine Uhrzeit
    }
    match text.strip_suffix(" 00:00:00") {
        Some(date) => date.to_string(),
        None => text.strip_suffix(":00").unwrap_or(&text).to_string(),
    }
}

fn cell_text(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.replace('\r', "").replace('\n', " ⏎ "),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => number(*f),
        Data::Bool(b) => if *b { "wahr" } else { "falsch" }.into(),
        Data::DateTime(d) => date_text(d),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => e.to_string(),
    }
}

fn excel_inner(data: &[u8]) -> Result<String, String> {
    let mut book = calamine::open_workbook_auto_from_rs(Cursor::new(data)).map_err(|_| "keine gültige Excel-Datei (oder passwortgeschützt)".to_string())?;
    let names = book.sheet_names();
    let mut out = String::new();
    for (index, name) in names.iter().take(MAX_SHEETS).enumerate() {
        if out.len() > MAX_OUTPUT_BYTES {
            out.push_str("\n[… weitere Tabellen nicht gelesen, die Datei ist sehr groß]\n");
            break;
        }
        let range = match book.worksheet_range(name) {
            Ok(range) => range,
            Err(_) => {
                out.push_str(&format!("Tabelle {}: „{name}“ (nicht lesbar)\n\n", index + 1));
                continue;
            }
        };
        let Some((first_row, first_col)) = range.start() else {
            out.push_str(&format!("Tabelle {}: „{name}“ (leer)\n\n", index + 1));
            continue;
        };
        let (rows, cols) = range.get_size();
        out.push_str(&format!("Tabelle {}: „{name}“ ({rows} Zeilen, {cols} Spalten)\n", index + 1));
        if first_col > 0 || first_row > 0 {
            out.push_str(&format!("(Der Inhalt beginnt bei Zelle {}{}.)\n", col_letters(first_col), first_row + 1));
        }
        let mut shown = 0;
        for (offset, row) in range.rows().enumerate() {
            if shown >= MAX_ROWS || out.len() > MAX_OUTPUT_BYTES {
                out.push_str(&format!("[… {} weitere Zeilen nicht gezeigt]\n", rows.saturating_sub(offset)));
                break;
            }
            let mut cells: Vec<String> = row.iter().take(MAX_COLS).map(cell_text).collect();
            while cells.last().is_some_and(|c| c.is_empty()) {
                cells.pop();
            }
            if cells.is_empty() {
                continue;
            }
            shown += 1;
            out.push_str(&format!("{}: {}\n", first_row as usize + offset + 1, cells.join(" | ")));
        }
        if cols > MAX_COLS {
            out.push_str(&format!("[… nur die ersten {MAX_COLS} Spalten gezeigt]\n"));
        }
        out.push('\n');
    }
    if names.len() > MAX_SHEETS {
        out.push_str(&format!("[… {} weitere Tabellen nicht gelesen]\n", names.len() - MAX_SHEETS));
    }
    Ok(out)
}

// --- PowerPoint -------------------------------------------------------------------------------

type Zip<'a> = zip::ZipArchive<Cursor<&'a [u8]>>;

/// Ein Teil des Archivs als Text (höchstens 20 MB)
fn part(zip: &mut Zip, name: &str) -> Option<String> {
    let file = zip.by_name(name).ok()?;
    let mut text = String::new();
    file.take(MAX_XML_BYTES).read_to_string(&mut text).ok()?;
    Some(text)
}

fn attr(start: &BytesStart, wanted: &str) -> Option<String> {
    start.attributes().flatten().find(|a| a.key.local_name().as_ref() == wanted).and_then(|a| a.normalized_value(XmlVersion::Implicit1_0).ok()).map(|v| v.into_owned())
}

struct Rel {
    id: String,
    kind: String,
    target: String,
}

fn relationships(xml: &str) -> Vec<Rel> {
    let mut reader = XmlReader::from_str(xml);
    let mut rels = Vec::new();
    while let Ok(event) = reader.read_event() {
        match event {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "Relationship" => {
                rels.push(Rel { id: attr(&e, "Id").unwrap_or_default(), kind: attr(&e, "Type").unwrap_or_default(), target: attr(&e, "Target").unwrap_or_default() });
            }
            Event::Eof => break,
            _ => {}
        }
    }
    rels
}

/// Die Beziehungs-IDs der Folien in der Reihenfolge der Präsentation (`<p:sldId r:id="…"/>`)
fn slide_rids(xml: &str) -> Vec<String> {
    let mut reader = XmlReader::from_str(xml);
    let mut ids = Vec::new();
    while let Ok(event) = reader.read_event() {
        match event {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == "sldId" => {
                // Das Attribut mit Namensraum (r:id) ist die Beziehung, das ohne (id) die Nummer der Folie
                if let Some(a) = e.attributes().flatten().find(|a| a.key.local_name().as_ref() == "id" && a.key.as_ref().contains(':')) {
                    if let Ok(v) = a.normalized_value(XmlVersion::Implicit1_0) {
                        ids.push(v.into_owned());
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    ids
}

/// Ein Ziel einer Beziehung als Pfad im Archiv; `base` ist der Ordner der Datei, die die Beziehung nennt.
fn resolve(base: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_string();
    }
    let mut parts: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    for segment in target.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn push_reference(text: &mut String, reference: &quick_xml::events::BytesRef) {
    match reference.as_ref() {
        "lt" => text.push('<'),
        "gt" => text.push('>'),
        "amp" => text.push('&'),
        "quot" => text.push('"'),
        "apos" => text.push('\''),
        _ => {
            if let Ok(Some(c)) = reference.resolve_char_ref() {
                text.push(c);
            }
        }
    }
}

#[derive(Default, Debug, PartialEq)]
struct SlideText {
    title: String,
    lines: Vec<String>,
}

/// Der Text einer Folie (oder ihrer Notizseite): Titel, Absätze und Tabellenzeilen (`Zelle | Zelle`). Bei Notizen zählt nur der
/// Textkasten der Notizen, bei Folien nicht Foliennummer, Datum und Fußzeile.
fn slide_text(xml: &str, notes: bool) -> SlideText {
    let mut reader = XmlReader::from_str(xml);
    let mut out = SlideText::default();
    let (mut in_shape, mut in_text, mut in_cell) = (false, false, false);
    let mut placeholder = String::new();
    let mut paragraph = String::new();
    let mut shape_lines: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut row: Vec<String> = Vec::new();

    while let Ok(event) = reader.read_event() {
        match event {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                "sp" => {
                    in_shape = true;
                    placeholder.clear();
                    shape_lines.clear();
                }
                "ph" if in_shape => placeholder = attr(&e, "type").unwrap_or_else(|| "body".into()),
                "p" => paragraph.clear(),
                "t" => in_text = true,
                "br" => paragraph.push(' '),
                "tc" => {
                    in_cell = true;
                    cell.clear();
                }
                "tr" => row.clear(),
                _ => {}
            },
            Event::End(e) => match e.local_name().as_ref() {
                "t" => in_text = false,
                "p" => {
                    let text = paragraph.split_whitespace().collect::<Vec<_>>().join(" ");
                    paragraph.clear();
                    if !text.is_empty() {
                        if in_cell {
                            if !cell.is_empty() {
                                cell.push(' ');
                            }
                            cell.push_str(&text);
                        } else if in_shape {
                            shape_lines.push(text);
                        }
                    }
                }
                "tc" => {
                    in_cell = false;
                    row.push(std::mem::take(&mut cell));
                }
                "tr" => {
                    if row.iter().any(|c| !c.is_empty()) {
                        out.lines.push(row.join(" | "));
                    }
                    row.clear();
                }
                "sp" => {
                    in_shape = false;
                    let kind = placeholder.as_str();
                    let wanted = if notes { kind == "body" } else { !matches!(kind, "sldNum" | "ftr" | "dt" | "hdr" | "sldImg") };
                    if wanted && matches!(kind, "title" | "ctrTitle") && !notes {
                        out.title = shape_lines.join(" ");
                    } else if wanted {
                        out.lines.append(&mut shape_lines);
                    }
                    shape_lines.clear();
                }
                _ => {}
            },
            Event::Text(t) if in_text => paragraph.push_str(&t.xml10_content()),
            Event::GeneralRef(r) if in_text => push_reference(&mut paragraph, &r),
            Event::Eof => break,
            _ => {}
        }
    }
    out
}

fn pptx_inner(data: &[u8]) -> Result<String, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(data)).map_err(|_| "keine gültige PowerPoint-Datei (oder passwortgeschützt)".to_string())?;
    let presentation = part(&mut zip, "ppt/presentation.xml").ok_or_else(|| "keine gültige PowerPoint-Datei".to_string())?;
    let rels = part(&mut zip, "ppt/_rels/presentation.xml.rels").map(|x| relationships(&x)).unwrap_or_default();

    // Folien in der Reihenfolge der Präsentation; gelingt das nicht, nach der Nummer im Dateinamen
    let mut paths: Vec<String> = slide_rids(&presentation).iter().filter_map(|id| rels.iter().find(|r| &r.id == id)).map(|r| resolve("ppt", &r.target)).collect();
    if paths.is_empty() {
        let mut numbered: Vec<(u32, String)> = zip
            .file_names()
            .filter_map(|n| n.ok())
            .filter_map(|n| n.strip_prefix("ppt/slides/slide").and_then(|rest| rest.strip_suffix(".xml")).and_then(|num| num.parse().ok()).map(|num| (num, n.to_string())))
            .collect();
        numbered.sort();
        paths = numbered.into_iter().map(|(_, n)| n).collect();
    }
    if paths.is_empty() {
        return Err("die PowerPoint-Datei enthält keine Folien".into());
    }

    let mut out = String::new();
    for (index, path) in paths.iter().take(MAX_SLIDES).enumerate() {
        if out.len() > MAX_OUTPUT_BYTES {
            out.push_str("[… weitere Folien nicht gelesen, die Datei ist sehr groß]\n");
            break;
        }
        let Some(xml) = part(&mut zip, path) else {
            out.push_str(&format!("Folie {}: nicht lesbar\n\n", index + 1));
            continue;
        };
        let slide = slide_text(&xml, false);
        out.push_str(&format!("Folie {}{}\n", index + 1, if slide.title.is_empty() { String::new() } else { format!(": {}", slide.title) }));
        for line in &slide.lines {
            out.push_str(line);
            out.push('\n');
        }
        // Sprechernotizen: die Notizseite steht in den Beziehungen der Folie
        let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
        if let Some(slide_rels) = part(&mut zip, &format!("{dir}/_rels/{file}.rels")) {
            if let Some(notes_path) = relationships(&slide_rels).iter().find(|r| r.kind.ends_with("/notesSlide")).map(|r| resolve(dir, &r.target)) {
                if let Some(notes_xml) = part(&mut zip, &notes_path) {
                    let notes = slide_text(&notes_xml, true);
                    if !notes.lines.is_empty() {
                        out.push_str(&format!("Notizen: {}\n", notes.lines.join(" ")));
                    }
                }
            }
        }
        out.push('\n');
    }
    if paths.len() > MAX_SLIDES {
        out.push_str(&format!("[… {} weitere Folien nicht gelesen]\n", paths.len() - MAX_SLIDES));
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in parts {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    const XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#;

    pub(crate) fn sample_xlsx() -> Vec<u8> {
        let workbook = format!(
            r#"{XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Leer" sheetId="2" r:id="rId2"/></sheets></workbook>"#
        );
        let rels = format!(
            r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#
        );
        let strings = format!(r#"{XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>Posten</t></si><si><t>Betrag</t></si><si><t>Datum</t></si><si><t>Miete &amp; Strom</t></si></sst>"#);
        let styles = format!(r#"{XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>"#);
        let sheet = format!(
            r#"{XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>1200.5</v></c><c r="C2" s="1"><v>46023</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Summe</t></is></c><c r="B4"><f>SUM(B2:B3)</f><v>1200.5</v></c><c r="D4" t="b"><v>1</v></c><c r="E4" t="e"><v>#DIV/0!</v></c></row></sheetData></worksheet>"#
        );
        let empty = format!(r#"{XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>"#);
        let package = format!(r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#);
        zip_of(&[("_rels/.rels", &package), ("xl/workbook.xml", &workbook), ("xl/_rels/workbook.xml.rels", &rels), ("xl/sharedStrings.xml", &strings), ("xl/styles.xml", &styles), ("xl/worksheets/sheet1.xml", &sheet), ("xl/worksheets/sheet2.xml", &empty)])
    }

    #[test]
    fn excel_sheets_become_text_with_row_numbers_dates_formulas_and_errors() {
        let text = excel_text(&sample_xlsx()).unwrap();
        assert!(text.contains("Tabelle 1: „Budget“"), "{text}");
        assert!(text.contains("1: Posten | Betrag | Datum"), "{text}");
        assert!(text.contains("2: Miete & Strom | 1200.5 | 2026-01-01"), "Datum statt Seriennummer: {text}");
        assert!(!text.contains("\n3:"), "leere Zeilen fehlen: {text}");
        assert!(text.contains("4: Summe | 1200.5 |  | wahr | #DIV/0!"), "leere Zelle bleibt als Lücke: {text}");
        assert!(text.contains("Tabelle 2: „Leer“ (leer)"), "{text}");
    }

    #[test]
    fn numbers_and_columns_are_formatted_plainly() {
        assert_eq!(number(3.0), "3");
        assert_eq!(number(0.1 + 0.2), "0.3");
        assert_eq!(number(-12.5), "-12.5");
        assert_eq!(col_letters(0), "A");
        assert_eq!(col_letters(25), "Z");
        assert_eq!(col_letters(26), "AA");
        assert_eq!(col_letters(701), "ZZ");
        assert_eq!(cell_text(&Data::String("a\r\nb".into())), "a ⏎ b");
        assert_eq!(cell_text(&Data::Bool(false)), "falsch");
    }

    pub(crate) fn sample_pptx() -> Vec<u8> {
        let ns = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
        // Die erste Folie der Präsentation ist slide2.xml
        let presentation = format!(r#"{XML}<p:presentation {ns}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>"#);
        let rels = format!(
            r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>"#
        );
        let slide2 = format!(
            r#"{XML}<p:sld {ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Projekt &amp; Ziele</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Erstens: </a:t></a:r><a:r><a:t>Zeit</a:t></a:r></a:p><a:p><a:r><a:t>Zweitens: Kosten</a:t></a:r><a:br/><a:r><a:t>und Qualität</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Phase</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Dauer</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Planung</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>2 Wochen</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>"#
        );
        let slide2_rels = format!(r#"{XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/></Relationships>"#);
        let notes = format!(
            r#"{XML}<p:notes {ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Hier die Zahlen nennen.</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>2</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>"#
        );
        let slide1 = format!(r#"{XML}<p:sld {ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Zum Schluss</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#);
        zip_of(&[
            ("ppt/presentation.xml", &presentation),
            ("ppt/_rels/presentation.xml.rels", &rels),
            ("ppt/slides/slide1.xml", &slide1),
            ("ppt/slides/slide2.xml", &slide2),
            ("ppt/slides/_rels/slide2.xml.rels", &slide2_rels),
            ("ppt/notesSlides/notesSlide2.xml", &notes),
        ])
    }

    #[test]
    fn powerpoint_slides_follow_the_presentation_order_with_titles_tables_and_notes() {
        let text = powerpoint_text(&sample_pptx()).unwrap();
        let first = text.find("Folie 1: Projekt & Ziele").expect(&text);
        let second = text.find("Folie 2: Zum Schluss").expect(&text);
        assert!(first < second, "Reihenfolge laut Präsentation, nicht nach Dateinamen: {text}");
        assert!(text.contains("Erstens: Zeit"), "Textstücke eines Absatzes gehören zusammen: {text}");
        assert!(text.contains("Zweitens: Kosten und Qualität"), "Zeilenumbruch wird zum Leerzeichen: {text}");
        assert!(text.contains("Phase | Dauer") && text.contains("Planung | 2 Wochen"), "Tabellenzeilen: {text}");
        assert!(text.contains("Notizen: Hier die Zahlen nennen."), "{text}");
        assert!(!text.contains("\n7\n") && !text.contains("Notizen: 2"), "Foliennummern fehlen: {text}");
    }

    #[test]
    fn a_presentation_without_order_falls_back_to_file_names() {
        let ns = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
        let slide = |t: &str| format!(r#"{XML}<p:sld {ns}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>"#);
        let bytes = zip_of(&[("ppt/presentation.xml", "<p:presentation/>"), ("ppt/slides/slide10.xml", &slide("Zehn")), ("ppt/slides/slide2.xml", &slide("Zwei"))]);
        let text = powerpoint_text(&bytes).unwrap();
        assert!(text.find("Zwei").unwrap() < text.find("Zehn").unwrap(), "numerisch sortiert: {text}");
    }

    #[test]
    fn relationship_targets_are_resolved_inside_the_archive() {
        assert_eq!(resolve("ppt", "slides/slide1.xml"), "ppt/slides/slide1.xml");
        assert_eq!(resolve("ppt/slides", "../notesSlides/notesSlide1.xml"), "ppt/notesSlides/notesSlide1.xml");
        assert_eq!(resolve("ppt/slides", "/ppt/media/a.png"), "ppt/media/a.png");
        assert_eq!(resolve("ppt", "./slides/../slides/s.xml"), "ppt/slides/s.xml");
    }

    #[test]
    fn broken_and_hostile_files_give_a_message_and_never_a_panic() {
        assert!(excel_text(b"das ist keine tabelle").unwrap_err().contains("Excel-Datei"));
        assert!(powerpoint_text(b"das ist keine praesentation").unwrap_err().contains("PowerPoint-Datei"));
        assert!(powerpoint_text(&zip_of(&[("ppt/presentation.xml", "<p:presentation")])).is_err());
        assert!(excel_text(&zip_of(&[("xl/workbook.xml", "<workbook")])).is_err());
        assert!(powerpoint_text(&[]).is_err());

        // Verfälschte Bytes dürfen nicht abstürzen
        let mut damaged = sample_xlsx();
        for (i, b) in damaged.iter_mut().enumerate().skip(30).step_by(11) {
            *b = b.wrapping_add(i as u8 | 1);
        }
        let _ = excel_text(&damaged);
    }

    #[test]
    fn archives_that_unpack_to_something_huge_are_refused() {
        // Eine kleine Datei, die entpackt weit über der Grenze liegt (Nullen packen sich fast auf nichts)
        let big = "0".repeat(MAX_UNPACKED_BYTES as usize / 2 + 1);
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for name in ["a.xml", "b.xml"] {
            writer.start_file(name, zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)).unwrap();
            writer.write_all(big.as_bytes()).unwrap();
        }
        let bytes = writer.finish().unwrap().into_inner();
        assert!(bytes.len() < 5_000_000, "gepackt klein: {}", bytes.len());
        assert!(zip_guard(&bytes).unwrap_err().contains("entpackt zu groß"));
        assert!(excel_text(&bytes).is_err());
    }

    #[test]
    fn extensions_and_types_decide_what_counts_as_office() {
        assert!(is_excel("xlsx", "") && is_excel("xls", "") && is_excel("", "application/vnd.ms-excel"));
        assert!(is_powerpoint("pptx", "") && is_powerpoint("", "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
        assert!(!is_powerpoint("ppt", ""), "das alte Binärformat geht nicht");
        assert!(!is_excel("docx", ""));
    }

    #[test]
    fn a_read_file_is_served_from_the_cache() {
        let bytes = sample_xlsx();
        let first = excel_text_cached(9101, &bytes).unwrap();
        // Gleiche Größe, anderer Inhalt: aus dem Speicher
        let mut other = bytes.clone();
        other[20] ^= 0xFF;
        assert_eq!(excel_text_cached(9101, &other).unwrap(), first);
    }
}
