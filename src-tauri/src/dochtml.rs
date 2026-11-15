//! Bestehende Seiten der Dokumentation als Bausteine lesen und Änderungen darauf anwenden (für den Assistenten).
//!
//! Der Editor speichert eine Seite als HTML. Hier wird dieses HTML in seine obersten Elemente zerlegt. Was sich als
//! Baustein darstellen lässt (Überschrift, Absatz, einfache Liste, einfache Tabelle, Zitat, Code, Trennlinie), kann der
//! Assistent lesen und ändern. Alles andere (Bilder, Dateien, Checklisten, verschachtelte Listen, Tabellen mit
//! verbundenen Zellen) bleibt unberührt: es wird beim Zusammensetzen unverändert übernommen. Nur neue oder ersetzte
//! Bausteine werden neu gebaut, der Rest der Seite bleibt Zeichen für Zeichen, wie er war.

use crate::docbuild::{self, Block, Stats};
use crate::docs::{self, DocInput, DocPage};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const VOID: [&str; 6] = ["br", "hr", "img", "input", "col", "meta"];
const INLINE: [&str; 13] = ["strong", "b", "em", "i", "code", "a", "br", "u", "s", "del", "mark", "sub", "sup"];
/// So viele Bausteine einer Seite sieht der Assistent
pub const MAX_READ_BLOCKS: usize = 300;
const MAX_NEW_BLOCKS: usize = 100;
const SHOWN_TEXT: usize = 300;

// --- Zerlegen ---------------------------------------------------------------------------

struct Tag {
    name: String,
    closing: bool,
    self_closing: bool,
    /// Alles zwischen Name und \`>\`
    attrs: String,
    /// Position direkt hinter dem \`>\`
    end: usize,
}

fn read_tag(s: &str, at: usize) -> Option<Tag> {
    let bytes = s.as_bytes();
    if bytes.get(at) != Some(&b'<') {
        return None;
    }
    if s[at..].starts_with("<!--") {
        let end = s[at..].find("-->").map(|p| at + p + 3).unwrap_or(s.len());
        return Some(Tag { name: "!--".into(), closing: false, self_closing: true, attrs: String::new(), end });
    }
    let mut i = at + 1;
    let closing = bytes.get(i) == Some(&b'/');
    if closing {
        i += 1;
    }
    let name_start = i;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'-') {
        i += 1;
    }
    if i == name_start {
        return None;
    }
    let name = s[name_start..i].to_ascii_lowercase();
    let attrs_start = i;
    let mut quote: Option<u8> = None;
    while i < bytes.len() {
        let c = bytes[i];
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'"' || c == b'\'' => quote = Some(c),
            None if c == b'>' => break,
            None => {}
        }
        i += 1;
    }
    let attrs = s[attrs_start..i.min(s.len())].to_string();
    let self_closing = attrs.trim_end().ends_with('/') || VOID.contains(&name.as_str());
    Some(Tag { name, closing, self_closing, attrs, end: (i + 1).min(s.len()) })
}

/// Wert eines Attributs im Anfangs-Tag, z. B. \`data-type\`.
fn attr(attrs: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=");
    let mut from = 0;
    while let Some(p) = attrs[from..].find(&needle) {
        let at = from + p;
        let before_ok = at == 0 || attrs.as_bytes()[at - 1].is_ascii_whitespace();
        let rest = &attrs[at + needle.len()..];
        if before_ok {
            if let Some(q) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') {
                let inner = &rest[1..];
                return inner.find(q).map(|e| decode(&inner[..e]));
            }
            return Some(rest.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string());
        }
        from = at + needle.len();
    }
    None
}

fn decode(text: &str) -> String {
    text.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&amp;", "&")
}

/// Zerlegt HTML in seine obersten Elemente (jedes samt Inhalt). Leerraum dazwischen entfällt.
fn split_top_level(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < html.len() {
        let rest = &html[i..];
        let trimmed = rest.trim_start();
        i += rest.len() - trimmed.len();
        if i >= html.len() {
            break;
        }
        if html.as_bytes()[i] != b'<' {
            // Text zwischen den Elementen
            let end = html[i..].find('<').map(|p| i + p).unwrap_or(html.len());
            out.push(html[i..end].to_string());
            i = end;
            continue;
        }
        let Some(tag) = read_tag(html, i) else {
            out.push("<".into());
            i += 1;
            continue;
        };
        if tag.closing {
            i = tag.end;
            continue;
        }
        if tag.self_closing {
            out.push(html[i..tag.end].to_string());
            i = tag.end;
            continue;
        }
        let mut depth = 1;
        let mut j = tag.end;
        while depth > 0 {
            let Some(p) = html[j..].find('<') else {
                j = html.len();
                break;
            };
            let at = j + p;
            match read_tag(html, at) {
                Some(t) => {
                    if !t.self_closing {
                        depth += if t.closing { -1 } else { 1 };
                    }
                    j = t.end;
                }
                None => j = at + 1,
            }
        }
        out.push(html[i..j].to_string());
        i = j;
    }
    out
}

fn inner_of(fragment: &str) -> &str {
    let Some(tag) = read_tag(fragment, 0) else { return "" };
    let start = tag.end;
    let end = fragment.rfind("</").filter(|e| *e >= start).unwrap_or(fragment.len());
    &fragment[start..end]
}

// --- Text ---------------------------------------------------------------------------------

/// Text mit Auszeichnung (**fett**, *kursiv*, \`Code\`, [Link](…)) aus Inline-HTML. Das zweite Ergebnis sagt, ob
/// Formatierung verloren ging, die sich so nicht ausdrücken lässt (unterstrichen, durchgestrichen, Farbe …).
fn inline_text(html: &str) -> (String, bool) {
    let mut out = String::new();
    let mut lossy = false;
    let mut links: Vec<bool> = Vec::new();
    let mut hrefs: Vec<String> = Vec::new();
    let mut i = 0;
    while i < html.len() {
        if html.as_bytes()[i] != b'<' {
            let end = html[i..].find('<').map(|p| i + p).unwrap_or(html.len());
            out.push_str(&decode(&html[i..end]));
            i = end;
            continue;
        }
        let Some(tag) = read_tag(html, i) else {
            out.push('<');
            i += 1;
            continue;
        };
        i = tag.end;
        match (tag.name.as_str(), tag.closing) {
            ("strong" | "b", _) => out.push_str("**"),
            ("em" | "i", _) => out.push('*'),
            ("code", _) => out.push('`'),
            ("br", _) => out.push('\n'),
            ("a", false) => {
                let href = attr(&tag.attrs, "href").filter(|h| ["https://", "http://", "mailto:"].iter().any(|p| h.starts_with(p)));
                links.push(href.is_some());
                if let Some(h) = href {
                    out.push('[');
                    hrefs.push(h);
                }
            }
            ("a", true) => {
                if links.pop().unwrap_or(false) {
                    out.push_str(&format!("]({})", hrefs.pop().unwrap_or_default()));
                }
            }
            ("u" | "s" | "del" | "mark" | "sub" | "sup", false) => lossy = true,
            ("span", false) if attr(&tag.attrs, "style").is_some() => lossy = true,
            _ => {}
        }
    }
    (out.trim().to_string(), lossy)
}

/// Besteht der Inhalt nur aus Text und einfacher Auszeichnung?
fn is_inline(html: &str) -> bool {
    let mut i = 0;
    while let Some(p) = html[i..].find('<') {
        match read_tag(html, i + p) {
            Some(t) => {
                if t.name != "span" && t.name != "!--" && !INLINE.contains(&t.name.as_str()) {
                    return false;
                }
                i = t.end;
            }
            None => i += p + 1,
        }
    }
    true
}

/// Text eines Absatzes, einer Zelle oder eines Listeneintrags: ein einzelnes \`<p>\` oder reiner Text.
fn simple_text(html: &str) -> Option<(String, bool)> {
    let parts = split_top_level(html);
    match parts.as_slice() {
        [] => Some((String::new(), false)),
        [one] if one.starts_with("<p") => {
            let tag = read_tag(one, 0)?;
            if tag.name != "p" {
                return None;
            }
            let inner = inner_of(one);
            is_inline(inner).then(|| inline_text(inner))
        }
        _ if is_inline(html) => Some(inline_text(html)),
        _ => None,
    }
}

// --- Bausteine ------------------------------------------------------------------------------

/// Ein oberstes Element der Seite.
#[derive(Debug, Clone, PartialEq)]
pub struct Fragment {
    /// Das Original-HTML, wird unverändert übernommen, solange der Baustein bleibt
    pub html: String,
    /// Der Baustein, wenn sich das Element als solcher darstellen lässt
    pub block: Option<Block>,
    /// Kurzbezeichnung, z. B. „Absatz“ oder „Bild“
    pub label: String,
    /// Text zur Anzeige (bei nicht änderbaren Elementen die Textfassung, gekürzt)
    pub text: String,
    /// Die Formatierung (unterstrichen, Farbe …) geht beim Ersetzen verloren
    pub lossy: bool,
    /// Eine Tabelle mit Zellen voller Inhalt (Checklisten, Listen, mehrere Absätze): ihre Zellen sind lesbar und bleiben
    /// unberührt, die übrigen Zellen lassen sich einzeln ändern; die ganze Tabelle lässt sich aber nicht ersetzen
    pub rich: bool,
}

fn opaque(html: &str, label: &str) -> Fragment {
    let plain = docbuild::plain_of(html);
    let text: String = plain.chars().take(SHOWN_TEXT).collect();
    Fragment { html: html.to_string(), block: None, label: label.to_string(), text, lossy: false, rich: false }
}

fn parsed(html: &str, block: Block, label: &str, lossy: bool) -> Fragment {
    let text = docbuild::plain_of(html).chars().take(SHOWN_TEXT).collect();
    Fragment { html: html.to_string(), block: Some(block), label: label.to_string(), text, lossy, rich: false }
}

/// Der Text einer Zelle mit viel Inhalt zum Lesen: Checklisten als „[x] Text“ und „[ ] Text“, sonst der reine Text.
fn rich_cell_text(inner: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for part in split_top_level(inner) {
        if let Some(tag) = read_tag(&part, 0) {
            if tag.name == "ul" && attr(&tag.attrs, "data-type").as_deref() == Some("taskList") {
                for li in split_top_level(inner_of(&part)) {
                    let checked = read_tag(&li, 0).and_then(|t| attr(&t.attrs, "data-checked")).as_deref() == Some("true");
                    lines.push(format!("{} {}", if checked { "[x]" } else { "[ ]" }, docbuild::plain_of(&li).replace('\n', " ")));
                }
                continue;
            }
        }
        lines.push(docbuild::plain_of(&part));
    }
    lines.into_iter().filter(|l| !l.trim().is_empty()).collect::<Vec<_>>().join("\n")
}

fn parse_list(html: &str) -> Option<(Vec<String>, bool)> {
    let mut items = Vec::new();
    let mut lossy = false;
    for li in split_top_level(inner_of(html)) {
        if read_tag(&li, 0)?.name != "li" {
            return None;
        }
        let (text, l) = simple_text(inner_of(&li))?;
        lossy |= l;
        items.push(text);
    }
    (!items.is_empty()).then_some((items, lossy))
}

fn collect_rows(inner: &str, rows: &mut Vec<Vec<(bool, String)>>, lossy: &mut bool, rich: &mut bool) -> Option<()> {
    for part in split_top_level(inner) {
        let tag = read_tag(&part, 0)?;
        match tag.name.as_str() {
            "colgroup" | "!--" => {}
            "tbody" | "thead" | "tfoot" => collect_rows(inner_of(&part), rows, lossy, rich)?,
            "tr" => {
                let mut cells = Vec::new();
                for cell in split_top_level(inner_of(&part)) {
                    let ct = read_tag(&cell, 0)?;
                    if ct.name != "td" && ct.name != "th" {
                        return None;
                    }
                    let span = |n: &str| attr(&ct.attrs, n).map(|v| v != "1").unwrap_or(false);
                    if span("colspan") || span("rowspan") {
                        return None;
                    }
                    // Einfacher Text: änderbar. Alles andere (Checkliste, Liste, mehrere Absätze) wird gelesen und bleibt, wie es ist
                    let text = match simple_text(inner_of(&cell)) {
                        Some((text, l)) => {
                            *lossy |= l;
                            text
                        }
                        None => {
                            *rich = true;
                            rich_cell_text(inner_of(&cell))
                        }
                    };
                    cells.push((ct.name == "th", text));
                }
                rows.push(cells);
            }
            _ => return None,
        }
    }
    Some(())
}

/// Eine Tabelle als Baustein, wenn sie einen der beiden üblichen Aufbauten hat: eine Kopfzeile oben (lauter `th`), darunter
/// Zellen mit oder ohne Kopfspalte, oder gar keine Kopfzeile, aber eine Kopfspalte (erste Zelle jeder Zeile `th`, der Rest `td`),
/// wie bei „Frage | …“ und „Antwort | …“. Alles andere (verbundene Zellen, gemischte Zellarten) bleibt unberührt.
fn parse_table(html: &str) -> Option<(Block, bool, bool)> {
    let mut rows = Vec::new();
    let mut lossy = false;
    let mut rich = false;
    collect_rows(inner_of(html), &mut rows, &mut lossy, &mut rich)?;
    let first = rows.first()?;
    let cols = first.len();
    if cols == 0 || rows.iter().any(|r| r.len() != cols) {
        return None;
    }
    let header_row = first.iter().all(|(th, _)| *th);
    let body = &rows[usize::from(header_row)..];
    if body.is_empty() {
        return None;
    }
    let header_column = body.iter().all(|r| r[0].0);
    let others_are_cells = body.iter().all(|r| r[1..].iter().all(|(th, _)| !*th));
    let first_are_cells = body.iter().all(|r| !r[0].0);
    if !others_are_cells || !(header_column || first_are_cells) || (!header_row && !header_column) {
        return None;
    }
    let text_of = |r: &Vec<(bool, String)>| r.iter().map(|(_, t)| t.clone()).collect::<Vec<_>>();
    Some((Block::Table { headers: if header_row { text_of(first) } else { Vec::new() }, rows: body.iter().map(text_of).collect(), header_column }, lossy, rich))
}

// --- Tabellen Zelle für Zelle ändern -------------------------------------------------------

/// Längster Text einer Zelle (Zeichen), wie bei neuen Tabellen
const MAX_CELL_TEXT: usize = 500;
const MAX_TABLE_ROWS: usize = 100;

struct RawCell {
    /// `td` oder `th`
    name: String,
    /// Das Anfangs-Tag samt Attributen (zum Beispiel die Spaltenbreite)
    open: String,
    inner: String,
}

struct RawRow {
    open: String,
    cells: Vec<RawCell>,
}

/// Eine Tabelle, wie sie im HTML steht. Wer nur Text ändert, Zeilen einfügt oder entfernt, lässt alles andere, was die
/// Tabelle ausmacht (Spaltenbreiten, Attribute, Kopfzellen), unverändert.
struct RawTable {
    /// Alles vor der ersten Zeile: `<table …>`, die Spaltenbreiten und `<tbody>`
    head: String,
    rows: Vec<RawRow>,
}

fn open_tag_of(fragment: &str) -> Option<&str> {
    let tag = read_tag(fragment, 0)?;
    Some(&fragment[..tag.end])
}

fn parse_raw_table(html: &str) -> Option<RawTable> {
    let table = read_tag(html, 0).filter(|t| t.name == "table")?;
    let mut head = html[..table.end].to_string();
    let mut rows = Vec::new();
    let mut body_seen = false;
    for part in split_top_level(inner_of(html)) {
        let tag = read_tag(&part, 0)?;
        match tag.name.as_str() {
            "colgroup" if !body_seen => head.push_str(&part),
            "tbody" if !body_seen => {
                body_seen = true;
                head.push_str(open_tag_of(&part)?);
                for tr in split_top_level(inner_of(&part)) {
                    let row_tag = read_tag(&tr, 0).filter(|t| t.name == "tr")?;
                    let mut cells = Vec::new();
                    for cell in split_top_level(inner_of(&tr)) {
                        let ct = read_tag(&cell, 0)?;
                        let span = |n: &str| attr(&ct.attrs, n).map(|v| v != "1").unwrap_or(false);
                        if (ct.name != "td" && ct.name != "th") || span("colspan") || span("rowspan") {
                            return None;
                        }
                        cells.push(RawCell { name: ct.name.clone(), open: cell[..ct.end].to_string(), inner: inner_of(&cell).to_string() });
                    }
                    rows.push(RawRow { open: tr[..row_tag.end].to_string(), cells });
                }
            }
            _ => return None,
        }
    }
    (body_seen && !rows.is_empty()).then_some(RawTable { head, rows })
}

impl RawTable {
    fn render(&self) -> String {
        let mut out = self.head.clone();
        for row in &self.rows {
            out.push_str(&row.open);
            for cell in &row.cells {
                out.push_str(&format!("{}{}</{}>", cell.open, cell.inner, cell.name));
            }
            out.push_str("</tr>");
        }
        out.push_str("</tbody></table>");
        out
    }

    fn cols(&self) -> usize {
        self.rows[0].cells.len()
    }
}

/// Der Inhalt einer Zelle aus dem Text der Anweisung (mit **fett**, *kursiv* …).
fn cell_inner(text: &str) -> Result<String, String> {
    if text.chars().count() > MAX_CELL_TEXT {
        return Err(format!("Ein Zelltext ist zu lang (höchstens {MAX_CELL_TEXT} Zeichen)."));
    }
    Ok(format!("<p>{}</p>", docbuild::inline_html(text)))
}

/// Der Inhalt einer neuen Zelle nach dem Vorbild einer anderen: Wo eine Checkliste steht, entsteht ein unerledigter Eintrag mit
/// dem Text, sonst ein Absatz.
fn cell_like(template: &RawCell, text: &str) -> Result<String, String> {
    let paragraph = cell_inner(text)?;
    if template.inner.contains("data-type=\"taskList\"") {
        let item = if text.trim().is_empty() { "<p></p>".to_string() } else { paragraph };
        return Ok(format!("<ul data-type=\"taskList\"><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label><div>{item}</div></li></ul>"));
    }
    Ok(paragraph)
}

/// Eine Zeile mit dem Aufbau von `template` (Anfangs-Tags, Kopfzellen, Breiten) und neuen Texten.
fn row_like(template: &RawRow, texts: &[String]) -> Result<RawRow, String> {
    if texts.len() != template.cells.len() {
        return Err(format!("Eine Zeile hat {} Zellen, die Tabelle aber {} Spalten. Gib für jede Spalte einen Text an.", texts.len(), template.cells.len()));
    }
    let mut cells = Vec::new();
    for (cell, text) in template.cells.iter().zip(texts) {
        cells.push(RawCell { name: cell.name.clone(), open: cell.open.clone(), inner: cell_like(cell, text)? });
    }
    Ok(RawRow { open: template.open.clone(), cells })
}

/// Wendet Zellen-Änderungen auf eine bestehende Tabelle an. Alle Zeilennummern gelten für die Tabelle, wie sie vorher war.
/// `row` zählt die Zeilen unter der Kopfzeile ab 0, -1 ist die Kopfzeile selbst.
fn edit_table(html: &str, header_row: bool, ops: &[&EditOp]) -> Result<String, String> {
    let mut table = parse_raw_table(html).ok_or("Diese Tabelle lässt sich nicht Zelle für Zelle ändern.")?;
    let start = usize::from(header_row);
    let body_len = table.rows.len() - start.min(table.rows.len());
    let cols = table.cols();
    let mut deleted = vec![false; body_len];
    // Neue Zeilen nach der Zeile i (Index i + 1; 0 = vor der ersten)
    let mut added: Vec<Vec<RawRow>> = (0..=body_len).map(|_| Vec::new()).collect();

    for op in ops {
        match op {
            EditOp::SetCell { row, col, text, .. } => {
                let r = match *row {
                    -1 if header_row => 0,
                    -1 => return Err("Die Tabelle hat keine Kopfzeile. Zeilen zählen ab 0.".into()),
                    r if r >= 0 && (r as usize) < body_len => start + r as usize,
                    r => return Err(format!("Zeile {r} gibt es nicht. Die Tabelle hat {body_len} Zeilen (0 bis {}).", body_len.saturating_sub(1))),
                };
                if *col >= cols {
                    return Err(format!("Spalte {col} gibt es nicht. Die Tabelle hat {cols} Spalten (0 bis {}).", cols - 1));
                }
                if simple_text(&table.rows[r].cells[*col].inner).is_none() {
                    return Err(format!("Die Zelle in Zeile {row}, Spalte {col} enthält eine Checkliste oder Liste und lässt sich nicht ändern. Die anderen Zellen der Tabelle schon."));
                }
                table.rows[r].cells[*col].inner = cell_inner(text)?;
            }
            EditOp::DeleteRow { row, .. } => {
                if *row >= body_len {
                    return Err(format!("Zeile {row} gibt es nicht. Die Tabelle hat {body_len} Zeilen (0 bis {}).", body_len.saturating_sub(1)));
                }
                deleted[*row] = true;
            }
            EditOp::AddRow { after, cells, .. } => {
                if *after < -1 || *after >= body_len as i64 {
                    return Err(format!("Nach Zeile {after} lässt sich nichts einfügen. Erlaubt ist -1 (vor der ersten) bis {} (nach der letzten).", body_len as i64 - 1));
                }
                // Aufbau und Breiten wie die Nachbarzeile
                let template = &table.rows[start + (*after).max(0) as usize];
                added[(*after + 1) as usize].push(row_like(template, cells)?);
            }
            _ => {}
        }
    }

    let mut rows: Vec<RawRow> = Vec::new();
    let mut old = std::mem::take(&mut table.rows).into_iter();
    rows.extend(old.by_ref().take(start));
    rows.extend(added[0].drain(..));
    for (i, row) in old.enumerate() {
        if !deleted[i] {
            rows.push(row);
        }
        rows.extend(added[i + 1].drain(..));
    }
    if rows.len() <= start {
        return Err("Die Tabelle braucht mindestens eine Zeile. Zum Entfernen der ganzen Tabelle nimm delete.".into());
    }
    if rows.len() > MAX_TABLE_ROWS {
        return Err(format!("Eine Tabelle darf höchstens {MAX_TABLE_ROWS} Zeilen haben."));
    }
    table.rows = rows;
    Ok(table.render())
}

/// Eine Kopie der Tabelle mit neuen Texten: Aufbau, Spaltenbreiten und Kopfzellen wie im Vorbild. Hat die Kopie mehr Zeilen
/// als das Vorbild, gilt für die weiteren die letzte Zeile als Muster.
fn copy_table(html: &str, header_row: bool, headers: &[String], rows: &[Vec<String>]) -> Result<String, String> {
    let table = parse_raw_table(html).ok_or("Diese Tabelle lässt sich nicht kopieren.")?;
    let start = usize::from(header_row);
    if header_row && headers.len() != table.cols() {
        return Err(format!("Die Tabelle hat eine Kopfzeile mit {} Zellen: gib headers mit {} Texten an.", table.cols(), table.cols()));
    }
    if !header_row && !headers.is_empty() {
        return Err("Die Tabelle hat keine Kopfzeile: lass headers weg.".into());
    }
    if rows.is_empty() || rows.len() > MAX_TABLE_ROWS {
        return Err(format!("Eine Kopie braucht 1 bis {MAX_TABLE_ROWS} Zeilen."));
    }
    let mut out = RawTable { head: table.head.clone(), rows: Vec::new() };
    if header_row {
        out.rows.push(row_like(&table.rows[0], headers)?);
    }
    let body = &table.rows[start..];
    for (k, texts) in rows.iter().enumerate() {
        out.rows.push(row_like(&body[k.min(body.len() - 1)], texts)?);
    }
    Ok(out.render())
}

/// Erkennt, was ein oberstes Element ist.
fn classify(html: &str) -> Fragment {
    let Some(tag) = read_tag(html, 0) else { return opaque(html, "Text") };
    let inner = || inner_of(html);
    match tag.name.as_str() {
        "h1" | "h2" | "h3" if is_inline(inner()) => {
            let level = tag.name[1..].parse().unwrap_or(1);
            let (text, lossy) = inline_text(inner());
            parsed(html, Block::Heading { level, text }, "Überschrift", lossy)
        }
        "p" => {
            let inner = inner();
            if inner.trim().is_empty() || inner.trim() == "<br>" || inner.trim() == "<br/>" {
                return opaque(html, "Leerer Absatz");
            }
            if !is_inline(inner) {
                return opaque(html, "Absatz mit Bild oder Sonderinhalt");
            }
            let (text, lossy) = inline_text(inner);
            parsed(html, Block::Paragraph { text }, "Absatz", lossy)
        }
        "ul" | "ol" => {
            if attr(&tag.attrs, "data-type").as_deref() == Some("taskList") {
                return opaque(html, "Checkliste");
            }
            match parse_list(html) {
                Some((items, lossy)) if tag.name == "ul" => parsed(html, Block::BulletList { items }, "Aufzählung", lossy),
                Some((items, lossy)) => parsed(html, Block::NumberedList { items }, "Nummerierte Liste", lossy),
                None => opaque(html, "Liste (verschachtelt)"),
            }
        }
        "table" => match parse_table(html) {
            Some((block, lossy, rich)) => {
                let mut f = parsed(html, block, if rich { "Tabelle (mit Checklisten oder Listen in Zellen)" } else { "Tabelle" }, lossy);
                f.rich = rich;
                f
            }
            None => opaque(html, "Tabelle (mit verbundenen Zellen oder anderem Aufbau)"),
        },
        "blockquote" => match simple_text(inner()) {
            Some((text, lossy)) if !text.is_empty() => parsed(html, Block::Quote { text }, "Zitat", lossy),
            _ => opaque(html, "Zitat (mehrteilig)"),
        },
        "pre" => {
            let code = inner_of(inner());
            let text = decode(code.trim_matches('\n'));
            if inner().trim_start().starts_with("<code") && !text.trim().is_empty() {
                parsed(html, Block::Code { text }, "Code", false)
            } else {
                opaque(html, "Code")
            }
        }
        "hr" => parsed(html, Block::Divider, "Trennlinie", false),
        "img" => opaque(html, "Bild"),
        "div" if attr(&tag.attrs, "data-file-id").is_some() => {
            let id = attr(&tag.attrs, "data-file-id").unwrap_or_default();
            let mut f = opaque(html, &format!("Datei (file_id {id})"));
            f.text = attr(&tag.attrs, "data-name").unwrap_or(f.text);
            f
        }
        _ if html.contains("<img") => opaque(html, "Bild"),
        _ => opaque(html, "Sonstiges"),
    }
}

/// Alle obersten Elemente einer Seite als Bausteine.
pub fn read_fragments(html: &str) -> Vec<Fragment> {
    split_top_level(html).iter().map(|f| classify(f)).collect()
}

// --- Änderungen ------------------------------------------------------------------------------

/// Eine Änderung an einer Seite. Alle Nummern beziehen sich auf die Bausteine, wie sie \`get_doc_blocks\` liefert.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum EditOp {
    /// Ersetzt einen Baustein durch einen oder mehrere neue
    Replace { index: usize, blocks: Vec<Block> },
    /// Fügt Bausteine hinter dem Baustein mit dieser Nummer ein (-1 = ganz an den Anfang)
    InsertAfter { index: i64, blocks: Vec<Block> },
    /// Entfernt einen Baustein
    Delete { index: usize },
    /// Hängt Bausteine ans Ende der Seite an
    Append { blocks: Vec<Block> },
    /// Setzt den Text einer Zelle einer bestehenden Tabelle. `row` zählt die Zeilen unter der Kopfzeile ab 0 (-1 = Kopfzeile),
    /// `col` die Spalten ab 0. Aufbau und Spaltenbreiten der Tabelle bleiben.
    SetCell { index: usize, row: i64, col: usize, text: String },
    /// Fügt eine Zeile nach der Zeile `after` ein (-1 = vor der ersten), mit dem Aufbau der Nachbarzeile
    AddRow { index: usize, after: i64, cells: Vec<String> },
    /// Entfernt eine Zeile einer bestehenden Tabelle
    DeleteRow { index: usize, row: usize },
    /// Fügt hinter der Tabelle eine Kopie mit neuem Text ein (Aufbau und Spaltenbreiten wie im Vorbild)
    CopyTable {
        index: usize,
        #[serde(default)]
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
    },
}

/// Ein Baustein, wie er angezeigt wird: entweder als Baustein oder, wenn nicht änderbar, als Bezeichnung mit Text.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Shown {
    pub block: Option<Block>,
    pub label: String,
    pub text: String,
}

impl From<&Fragment> for Shown {
    fn from(f: &Fragment) -> Self {
        Shown { block: f.block.clone(), label: f.label.clone(), text: f.text.clone() }
    }
}

/// Die Seite nach der Änderung, Baustein für Baustein, mit dem, was sich geändert hat.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Line {
    /// "same", "added", "replaced" oder "removed"
    pub kind: String,
    /// Der bisherige Baustein (bei "same", "replaced" und "removed")
    pub old: Option<Shown>,
    /// Die neuen Bausteine (bei "added" und "replaced")
    pub new: Vec<Block>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct EditStats {
    pub added: usize,
    pub replaced: usize,
    pub removed: usize,
}

#[derive(Debug)]
pub struct Plan {
    pub lines: Vec<Line>,
    pub html: String,
    pub stats: EditStats,
}

/// Wendet die Änderungen auf die Bausteine einer Seite an und prüft das Ergebnis.
pub fn apply(page_title: &str, fragments: &[Fragment], ops: &[EditOp]) -> Result<Plan, String> {
    let n = fragments.len();
    let mut replaced: Vec<Option<Vec<Block>>> = vec![None; n];
    let mut removed = vec![false; n];
    let mut after: Vec<Vec<Block>> = vec![Vec::new(); n];
    let mut at_start: Vec<Block> = Vec::new();
    let mut new_count = 0;
    // Tabellen, deren Zellen sich ändern (Nummer des Bausteins → Anweisungen), und Kopien hinter einer Tabelle
    let mut table_ops: Vec<Vec<&EditOp>> = vec![Vec::new(); n];
    let mut copies: Vec<Vec<(String, Block)>> = vec![Vec::new(); n];

    let editable = |i: usize| -> Result<(), String> {
        let f = fragments.get(i).ok_or_else(|| format!("Baustein {i} gibt es nicht. Die Seite hat {n} Bausteine (0 bis {}).", n.saturating_sub(1)))?;
        if f.block.is_none() {
            return Err(format!("Baustein {i} ({}) lässt sich nicht ändern und bleibt unverändert. Füge Neues davor oder danach ein.", f.label));
        }
        Ok(())
    };

    // Tabellen, die sich Zelle für Zelle ändern lassen: Kopfzeile oder Kopfspalte, keine verbundenen Zellen
    let table_of = |i: usize| -> Result<bool, String> {
        let f = fragments.get(i).ok_or_else(|| format!("Baustein {i} gibt es nicht. Die Seite hat {n} Bausteine (0 bis {}).", n.saturating_sub(1)))?;
        match &f.block {
            Some(Block::Table { headers, .. }) => Ok(!headers.is_empty()),
            _ => Err(format!("Baustein {i} ({}) ist keine Tabelle, deren Zellen sich ändern lassen.", f.label)),
        }
    };

    for op in ops {
        match op {
            EditOp::SetCell { index, .. } | EditOp::AddRow { index, .. } | EditOp::DeleteRow { index, .. } => {
                table_of(*index)?;
                table_ops[*index].push(op);
            }
            EditOp::CopyTable { index, headers, rows } => {
                let header_row = table_of(*index)?;
                let html = copy_table(&fragments[*index].html, header_row, headers, rows)?;
                let block = classify(&html).block.ok_or("Die kopierte Tabelle ließ sich nicht lesen.")?;
                new_count += 1;
                copies[*index].push((html, block));
            }
            EditOp::Replace { index, blocks } => {
                editable(*index)?;
                if fragments[*index].rich {
                    return Err(format!("Baustein {index} ist eine Tabelle mit Checklisten oder Listen in Zellen: sie würden beim Ersetzen verloren gehen. Ändere einzelne Zellen mit set_cell, füge Zeilen mit add_row ein."));
                }
                if replaced[*index].is_some() || removed[*index] {
                    return Err(format!("Baustein {index} wird mehrfach geändert. Fasse die Änderungen in einem Eintrag zusammen."));
                }
                if blocks.is_empty() {
                    return Err(format!("Zum Ersetzen von Baustein {index} braucht es mindestens einen neuen Baustein. Zum Entfernen nimm delete."));
                }
                new_count += blocks.len();
                replaced[*index] = Some(blocks.clone());
            }
            EditOp::Delete { index } => {
                editable(*index)?;
                if replaced[*index].is_some() || removed[*index] {
                    return Err(format!("Baustein {index} wird mehrfach geändert."));
                }
                removed[*index] = true;
            }
            EditOp::InsertAfter { index, blocks } => {
                if blocks.is_empty() {
                    return Err("insert_after braucht mindestens einen Baustein.".into());
                }
                new_count += blocks.len();
                match *index {
                    -1 => at_start.extend(blocks.iter().cloned()),
                    i if i >= 0 && (i as usize) < n => after[i as usize].extend(blocks.iter().cloned()),
                    i => return Err(format!("Baustein {i} gibt es nicht. Die Seite hat {n} Bausteine; -1 steht für den Anfang.")),
                }
            }
            EditOp::Append { blocks } => {
                if blocks.is_empty() {
                    return Err("append braucht mindestens einen Baustein.".into());
                }
                new_count += blocks.len();
                match n.checked_sub(1) {
                    Some(last) => after[last].extend(blocks.iter().cloned()),
                    None => at_start.extend(blocks.iter().cloned()),
                }
            }
        }
    }
    if new_count > MAX_NEW_BLOCKS {
        return Err(format!("Eine Änderung darf höchstens {MAX_NEW_BLOCKS} neue Bausteine enthalten. Teile sie auf."));
    }
    // Zellen-Änderungen: pro Tabelle zusammen angewendet; sie gelten für den Stand, den der Assistent gelesen hat
    let mut edited: Vec<Option<String>> = vec![None; n];
    for (i, list) in table_ops.iter().enumerate().filter(|(_, l)| !l.is_empty()) {
        if replaced[i].is_some() || removed[i] {
            return Err(format!("Baustein {i} wird mehrfach geändert. Fasse die Änderungen in einem Eintrag zusammen."));
        }
        let header_row = table_of(i)?;
        edited[i] = Some(edit_table(&fragments[i].html, header_row, list)?);
    }

    // Die Seite danach, mit Kennzeichnung, was neu ist
    let mut lines: Vec<Line> = Vec::new();
    let mut stats = EditStats::default();
    let mut html = String::new();
    fn push_new(blocks: &[Block], html: &mut String, kind: &str, old: Option<Shown>, lines: &mut Vec<Line>) {
        for b in blocks {
            html.push_str(&docbuild::block_html(b));
        }
        lines.push(Line { kind: kind.into(), old, new: blocks.to_vec() });
    }

    if !at_start.is_empty() {
        stats.added += at_start.len();
        push_new(&at_start, &mut html, "added", None, &mut lines);
    }
    for (i, f) in fragments.iter().enumerate() {
        if let Some(new) = &replaced[i] {
            stats.replaced += 1;
            stats.added += new.len();
            stats.removed += 1;
            push_new(new, &mut html, "replaced", Some(f.into()), &mut lines);
        } else if removed[i] {
            stats.removed += 1;
            lines.push(Line { kind: "removed".into(), old: Some(f.into()), new: Vec::new() });
        } else if let Some(raw) = &edited[i] {
            // Eine Tabelle mit geänderten Zellen: das neue HTML kommt unverändert in die Seite, angezeigt wird sie als Baustein
            stats.replaced += 1;
            stats.added += 1;
            stats.removed += 1;
            html.push_str(raw);
            let block = classify(raw).block.unwrap_or(Block::Paragraph { text: "(Tabelle geändert)".into() });
            lines.push(Line { kind: "replaced".into(), old: Some(f.into()), new: vec![block] });
        } else {
            html.push_str(&f.html);
            lines.push(Line { kind: "same".into(), old: Some(f.into()), new: Vec::new() });
        }
        for (raw, block) in &copies[i] {
            stats.added += 1;
            html.push_str(raw);
            lines.push(Line { kind: "added".into(), old: None, new: vec![block.clone()] });
        }
        if !after[i].is_empty() {
            stats.added += after[i].len();
            push_new(&after[i], &mut html, "added", None, &mut lines);
        }
    }
    if stats == EditStats::default() {
        return Err("Es ändert sich nichts. Gib mindestens eine Änderung an.".into());
    }

    // Prüfung: neue Bausteine einzeln, Überschriften im Zusammenhang der ganzen Seite
    let mut before = 0u8;
    let mut scratch = Stats::default();
    for line in &lines {
        match line.kind.as_str() {
            "same" => {
                if let Some(Block::Heading { level, .. }) = line.old.as_ref().and_then(|o| o.block.as_ref()) {
                    before = *level;
                }
            }
            "removed" => {}
            _ => {
                for b in &line.new {
                    docbuild::check_block(page_title, b, &mut scratch)?;
                    if let Block::Heading { level, text } = b {
                        if let Some(e) = docbuild::heading_order_error(page_title, *level, text, before) {
                            return Err(e);
                        }
                        before = *level;
                    }
                }
            }
        }
    }
    Ok(Plan { lines, html, stats })
}

/// Setzt die bestätigte Änderung um. Die Seite darf sich seit dem Vorschlag nicht geändert haben.
/// Trägt bei neuen Datei-Bausteinen der Änderungen Name, Größe und Typ aus den Anhängen ein.
pub fn resolve_op_files(conn: &Connection, ops: &mut [EditOp]) -> Result<(), String> {
    for op in ops {
        match op {
            EditOp::Replace { blocks, .. } | EditOp::InsertAfter { blocks, .. } | EditOp::Append { blocks } => docbuild::resolve_files(conn, blocks)?,
            EditOp::Delete { .. } | EditOp::SetCell { .. } | EditOp::AddRow { .. } | EditOp::DeleteRow { .. } | EditOp::CopyTable { .. } => {}
        }
    }
    Ok(())
}

pub fn apply_to_page(conn: &Connection, id: i64, base_updated_at: &str, new_title: Option<&str>, ops: &[EditOp]) -> Result<DocPage, String> {
    let page = docs::get_page(conn, id)?;
    if page.kind != "page" {
        return Err("Das ist ein Ordner, er hat keinen Inhalt.".into());
    }
    if page.updated_at != base_updated_at {
        return Err("Die Seite wurde seit dem Vorschlag geändert. Lass dir den Vorschlag neu machen.".into());
    }
    let title = match new_title.map(str::trim) {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => page.title.clone(),
    };
    let fragments = read_fragments(&page.content);
    // Der Vorschlag kommt aus dem Frontend zurück: Dateiangaben werden neu aus der Datenbank gelesen
    let mut ops = ops.to_vec();
    resolve_op_files(conn, &mut ops)?;
    let ops = ops.as_slice();
    let plan = match apply(&title, &fragments, ops) {
        Ok(p) => p,
        // Nur der Titel ändert sich
        Err(_) if ops.is_empty() && title != page.title => Plan { lines: Vec::new(), html: page.content.clone(), stats: EditStats::default() },
        Err(e) => return Err(e),
    };
    let plain = docbuild::plain_of(&plan.html);
    docs::update_page(conn, id, &DocInput { title, content: plan.html, plain })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const PAGE: &str = concat!(
        "<h1>Ziel</h1>",
        "<p>Das ist <strong>wichtig</strong> und <em>kurz</em> mit <a href=\"https://example.com\">Link</a>.</p>",
        "<ul><li><p>Eins</p></li><li><p>Zwei &amp; drei</p></li></ul>",
        "<table><colgroup><col></colgroup><tbody><tr><th><p>Phase</p></th><th><p>Ende</p></th></tr><tr><td><p>Plan</p></td><td><p>01.11.</p></td></tr></tbody></table>",
        "<div data-file-id=\"7\" data-name=\"Vertrag.pdf\" data-size=\"10\">Vertrag.pdf</div>",
        "<hr>",
        "<ul data-type=\"taskList\"><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label><div><p>Aufgabe</p></div></li></ul>",
        "<p></p>",
        "<p><u>Unterstrichen</u> und normal</p>",
    );

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        db::init(&c).unwrap();
        c
    }

    fn para(text: &str) -> Block {
        Block::Paragraph { text: text.into() }
    }

    #[test]
    fn page_is_split_into_blocks_and_unknown_elements_stay_opaque() {
        let f = read_fragments(PAGE);
        let labels: Vec<&str> = f.iter().map(|x| x.label.as_str()).collect();
        assert_eq!(labels, ["Überschrift", "Absatz", "Aufzählung", "Tabelle", "Datei (file_id 7)", "Trennlinie", "Checkliste", "Leerer Absatz", "Absatz"]);
        assert_eq!(f[0].block, Some(Block::Heading { level: 1, text: "Ziel".into() }));
        assert_eq!(f[1].block, Some(para("Das ist **wichtig** und *kurz* mit [Link](https://example.com).")));
        assert_eq!(f[2].block, Some(Block::BulletList { items: vec!["Eins".into(), "Zwei & drei".into()] }));
        assert_eq!(f[3].block, Some(Block::Table { header_column: false, headers: vec!["Phase".into(), "Ende".into()], rows: vec![vec!["Plan".into(), "01.11.".into()]] }));
        assert!(f[4].block.is_none() && f[4].text == "Vertrag.pdf");
        assert!(f[8].lossy && !f[1].lossy, "Unterstreichung geht beim Ersetzen verloren");
        // Zusammengesetzt ergibt sich wieder dieselbe Seite
        assert_eq!(f.iter().map(|x| x.html.as_str()).collect::<String>(), PAGE);
    }

    #[test]
    fn complex_tables_and_nested_lists_are_not_editable() {
        let html = "<table><tbody><tr><th colspan=\"2\"><p>A</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table><ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul><table><tbody><tr><td><p>x</p></td></tr></tbody></table>";
        let f = read_fragments(html);
        assert!(f.iter().all(|x| x.block.is_none()), "{:?}", f.iter().map(|x| &x.label).collect::<Vec<_>>());
    }

    #[test]
    fn editing_keeps_everything_else_byte_for_byte() {
        let f = read_fragments(PAGE);
        let plan = apply(
            "Seite",
            &f,
            &[
                EditOp::Replace { index: 1, blocks: vec![para("Neuer Absatz")] },
                EditOp::InsertAfter { index: 0, blocks: vec![Block::Heading { level: 2, text: "Unterpunkt".into() }] },
                EditOp::Append { blocks: vec![Block::Divider, para("Ende")] },
            ],
        )
        .unwrap();
        assert_eq!(plan.stats, EditStats { added: 4, replaced: 1, removed: 1 });
        assert!(plan.html.starts_with("<h1>Ziel</h1><h2>Unterpunkt</h2><p>Neuer Absatz</p><ul>"));
        assert!(plan.html.contains("<div data-file-id=\"7\" data-name=\"Vertrag.pdf\" data-size=\"10\">Vertrag.pdf</div>"), "Datei bleibt");
        assert!(plan.html.contains("<ul data-type=\"taskList\">"), "Checkliste bleibt");
        assert!(plan.html.ends_with("<p><u>Unterstrichen</u> und normal</p><hr><p>Ende</p>"));
        let kinds: Vec<&str> = plan.lines.iter().map(|l| l.kind.as_str()).collect();
        assert_eq!(kinds, ["same", "added", "replaced", "same", "same", "same", "same", "same", "same", "same", "added"]);
        assert_eq!(plan.lines[2].old.as_ref().unwrap().label, "Absatz");
    }

    #[test]
    fn insert_at_start_delete_and_rules() {
        let f = read_fragments(PAGE);
        let plan = apply("S", &f, &[EditOp::InsertAfter { index: -1, blocks: vec![para("Vorwort")] }, EditOp::Delete { index: 5 }]).unwrap();
        assert!(plan.html.starts_with("<p>Vorwort</p><h1>Ziel</h1>"));
        assert!(!plan.html.contains("<hr>"));
        assert_eq!(plan.stats, EditStats { added: 1, replaced: 0, removed: 1 });

        let err = |ops: Vec<EditOp>| apply("S", &f, &ops).unwrap_err();
        assert!(err(vec![EditOp::Replace { index: 4, blocks: vec![para("x")] }]).contains("Datei"), "Dateien lassen sich nicht ersetzen");
        assert!(err(vec![EditOp::Delete { index: 6 }]).contains("Checkliste"));
        assert!(err(vec![EditOp::Delete { index: 99 }]).contains("gibt es nicht"));
        assert!(err(vec![EditOp::Replace { index: 1, blocks: vec![para("a")] }, EditOp::Delete { index: 1 }]).contains("mehrfach"));
        assert!(err(vec![EditOp::Replace { index: 1, blocks: vec![] }]).contains("mindestens"));
        assert!(err(vec![]).contains("ändert sich nichts"));
        assert!(err(vec![EditOp::Append { blocks: vec![para("   ")] }]).contains("leer"));
    }

    #[test]
    fn new_headings_must_fit_the_page() {
        let f = read_fragments("<h1>A</h1><p>t</p>");
        // Nach Ebene 1 darf Ebene 2 folgen, Ebene 3 überspringt eine
        assert!(apply("S", &f, &[EditOp::Append { blocks: vec![Block::Heading { level: 2, text: "B".into() }] }]).is_ok());
        let e = apply("S", &f, &[EditOp::Append { blocks: vec![Block::Heading { level: 3, text: "C".into() }] }]).unwrap_err();
        assert!(e.contains("überspringt"), "{e}");
        // Bestehende Überschriften werden nicht beanstandet
        let odd = read_fragments("<h3>Alt</h3><p>t</p>");
        assert!(apply("S", &odd, &[EditOp::Append { blocks: vec![para("neu")] }]).is_ok());
    }

    #[test]
    fn confirmed_edit_updates_the_page_and_detects_concurrent_changes() {
        let c = conn();
        let page = docs::create_page(&c, None, "Plan", "page").unwrap();
        let page = docs::update_page(&c, page.id, &DocInput { title: "Plan".into(), content: PAGE.into(), plain: "x".into() }).unwrap();

        let ops = vec![EditOp::Replace { index: 0, blocks: vec![Block::Heading { level: 1, text: "Neues Ziel".into() }] }];
        let done = apply_to_page(&c, page.id, &page.updated_at, Some("Plan 2"), &ops).unwrap();
        assert_eq!(done.title, "Plan 2");
        assert!(done.content.starts_with("<h1>Neues Ziel</h1><p>Das ist"), "{}", done.content);
        assert!(done.plain.contains("Neues Ziel") && done.plain.contains("Vertrag.pdf"));

        // Ein zweiter Vorschlag auf dem alten Stand wird abgelehnt
        c.execute("UPDATE doc_pages SET updated_at = '2000-01-01 00:00:00' WHERE id = ?1", [page.id]).unwrap();
        let stale = apply_to_page(&c, page.id, &done.updated_at, None, &ops).unwrap_err();
        assert!(stale.contains("geändert"), "{stale}");
        assert!(apply_to_page(&c, 999, "x", None, &ops).is_err());
        let folder = docs::create_page(&c, None, "Ordner", "folder").unwrap();
        assert!(apply_to_page(&c, folder.id, &folder.updated_at, None, &ops).unwrap_err().contains("Ordner"));
    }

    // --- Tabellen Zelle für Zelle ------------------------------------------------------------

    /// Wie die Frage-und-Antwort-Tabellen der Dokumentation: Kopfspalte (th), feste Spaltenbreiten, fetter Text in der Frage
    const BIZ: &str = concat!(
        "<table style=\"width: 690px;\"><colgroup><col style=\"width: 125px;\"><col style=\"width: 565px;\"></colgroup><tbody>",
        "<tr><th colwidth=\"125\"><p><strong>FRAGE</strong></p></th><td colwidth=\"565\"><p><strong>Wie geht es?</strong></p></td></tr>",
        "<tr><th colwidth=\"125\"><p>ANTWORT</p></th><td colwidth=\"565\"><p>Gut.</p></td></tr>",
        "</tbody></table>",
        "<p>Danach</p>",
    );

    #[test]
    fn a_table_with_a_header_column_is_a_block_and_keeps_its_shape() {
        let f = read_fragments(BIZ);
        assert_eq!(f[0].label, "Tabelle");
        assert_eq!(
            f[0].block,
            Some(Block::Table {
                headers: vec![],
                rows: vec![vec!["**FRAGE**".into(), "**Wie geht es?**".into()], vec!["ANTWORT".into(), "Gut.".into()]],
                header_column: true,
            })
        );
        // Mit Kopfzeile und Kopfspalte zugleich, und nur Kopfzeile wie bisher
        let both = "<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><th><p>x</p></th><td><p>1</p></td></tr></tbody></table>";
        assert!(matches!(&read_fragments(both)[0].block, Some(Block::Table { headers, header_column: true, .. }) if headers.len() == 2));
        assert!(matches!(&read_fragments(PAGE)[3].block, Some(Block::Table { header_column: false, .. })));
        // Gemischte Zellarten bleiben unberührt
        let mixed = "<table><tbody><tr><th><p>A</p></th><td><p>B</p></td></tr><tr><td><p>x</p></td><th><p>y</p></th></tr></tbody></table>";
        assert!(read_fragments(mixed)[0].block.is_none());
    }

    #[test]
    fn a_cell_changes_and_everything_else_of_the_table_stays() {
        let f = read_fragments(BIZ);
        let plan = apply("S", &f, &[EditOp::SetCell { index: 0, row: 1, col: 1, text: "Sehr **gut** & klar.".into() }]).unwrap();
        assert!(plan.html.contains("<td colwidth=\"565\"><p>Sehr <strong>gut</strong> &amp; klar.</p></td>"), "{}", plan.html);
        assert!(plan.html.starts_with("<table style=\"width: 690px;\"><colgroup><col style=\"width: 125px;\"><col style=\"width: 565px;\"></colgroup><tbody>"), "Breiten bleiben");
        assert!(plan.html.contains("<th colwidth=\"125\"><p><strong>FRAGE</strong></p></th><td colwidth=\"565\"><p><strong>Wie geht es?</strong></p></td>"), "andere Zellen bleiben Zeichen für Zeichen");
        assert!(plan.html.ends_with("</tbody></table><p>Danach</p>"));
        assert_eq!(plan.stats, EditStats { added: 1, replaced: 1, removed: 1 });
        assert_eq!(plan.lines[0].kind, "replaced");
        assert!(matches!(&plan.lines[0].new[0], Block::Table { rows, .. } if rows[1][1] == "Sehr **gut** & klar."));
        assert_eq!(plan.lines[1].kind, "same");

        // Zwei Änderungen an derselben Tabelle gehen zusammen, die Kopfzelle der Kopfspalte lässt sich auch ändern
        let both = apply("S", &f, &[EditOp::SetCell { index: 0, row: 0, col: 1, text: "Neue Frage?".into() }, EditOp::SetCell { index: 0, row: 1, col: 0, text: "ANTWORT (kurz)".into() }]).unwrap();
        assert!(both.html.contains("<p>Neue Frage?</p>") && both.html.contains("<th colwidth=\"125\"><p>ANTWORT (kurz)</p></th>"), "{}", both.html);
        assert_eq!(both.stats.replaced, 1, "eine Tabelle, eine Änderung");
    }

    #[test]
    fn rows_are_added_and_removed_with_the_shape_of_their_neighbour() {
        let f = read_fragments(BIZ);
        let added = apply("S", &f, &[EditOp::AddRow { index: 0, after: 1, cells: vec!["HINWEIS".into(), "Mehr dazu".into()] }]).unwrap();
        assert!(added.html.contains("</tr><tr><th colwidth=\"125\"><p>HINWEIS</p></th><td colwidth=\"565\"><p>Mehr dazu</p></td></tr></tbody>"), "{}", added.html);
        let at_start = apply("S", &f, &[EditOp::AddRow { index: 0, after: -1, cells: vec!["A".into(), "B".into()] }]).unwrap();
        assert!(at_start.html.contains("<tbody><tr><th colwidth=\"125\"><p>A</p></th>"), "{}", at_start.html);

        let removed = apply("S", &f, &[EditOp::DeleteRow { index: 0, row: 0 }]).unwrap();
        assert!(!removed.html.contains("FRAGE") && removed.html.contains("ANTWORT"));
        // Löschen und Einfügen in einem Zug beziehen sich auf die Zeilen des Originals
        let both = apply("S", &f, &[EditOp::DeleteRow { index: 0, row: 0 }, EditOp::AddRow { index: 0, after: 0, cells: vec!["NEU".into(), "Zeile".into()] }]).unwrap();
        let (neu, antwort) = (both.html.find("NEU").unwrap(), both.html.find("ANTWORT").unwrap());
        assert!(!both.html.contains("FRAGE") && neu < antwort, "{}", both.html);

        let err = |ops: Vec<EditOp>| apply("S", &f, &ops).unwrap_err();
        assert!(err(vec![EditOp::DeleteRow { index: 0, row: 0 }, EditOp::DeleteRow { index: 0, row: 1 }]).contains("mindestens eine Zeile"));
        assert!(err(vec![EditOp::DeleteRow { index: 0, row: 5 }]).contains("gibt es nicht"));
        assert!(err(vec![EditOp::AddRow { index: 0, after: 7, cells: vec!["a".into(), "b".into()] }]).contains("einfügen"));
        assert!(err(vec![EditOp::AddRow { index: 0, after: 0, cells: vec!["nur eine".into()] }]).contains("Spalten"));
    }

    #[test]
    fn a_table_is_copied_with_new_text_and_the_same_widths() {
        let f = read_fragments(BIZ);
        let rows = vec![vec!["FRAGE".to_string(), "Neue Frage?".to_string()], vec!["ANTWORT".to_string(), "Neue Antwort.".to_string()]];
        let plan = apply("S", &f, &[EditOp::CopyTable { index: 0, headers: vec![], rows }]).unwrap();
        assert_eq!(plan.html.matches("<colgroup>").count(), 2, "die Kopie hat dieselben Spaltenbreiten");
        assert_eq!(plan.html.matches("<th colwidth=\"125\">").count(), 4);
        assert!(plan.html.contains("<p>Neue Frage?</p>") && plan.html.contains("Wie geht es?") && plan.html.ends_with("<p>Danach</p>"));
        let first = plan.html.find("FRAGE").unwrap();
        assert!(plan.html.find("Neue Frage?").unwrap() > first, "die Kopie steht hinter dem Vorbild");
        assert_eq!(plan.stats, EditStats { added: 1, replaced: 0, removed: 0 });
        assert_eq!(plan.lines.iter().map(|l| l.kind.as_str()).collect::<Vec<_>>(), ["same", "added", "same"]);

        // Mehr Zeilen als das Vorbild: die letzte Zeile ist das Muster
        let longer = vec![vec!["F".to_string(), "1".to_string()], vec!["A".to_string(), "2".to_string()], vec!["A".to_string(), "3".to_string()]];
        let plan = apply("S", &f, &[EditOp::CopyTable { index: 0, headers: vec![], rows: longer }]).unwrap();
        assert_eq!(plan.html.matches("<tr>").count(), 5);

        let err = |ops: Vec<EditOp>| apply("S", &f, &ops).unwrap_err();
        assert!(err(vec![EditOp::CopyTable { index: 0, headers: vec!["x".into()], rows: vec![vec!["a".into(), "b".into()]] }]).contains("keine Kopfzeile"));
        assert!(err(vec![EditOp::CopyTable { index: 0, headers: vec![], rows: vec![] }]).contains("1 bis"));
    }

    #[test]
    fn a_header_row_table_changes_its_header_cells_too() {
        let f = read_fragments(PAGE);
        let plan = apply("S", &f, &[EditOp::SetCell { index: 3, row: -1, col: 1, text: "Fertig".into() }, EditOp::SetCell { index: 3, row: 0, col: 1, text: "02.11.".into() }]).unwrap();
        assert!(plan.html.contains("<th><p>Fertig</p></th>") && plan.html.contains("<td><p>02.11.</p></td>") && plan.html.contains("<th><p>Phase</p></th>"), "{}", plan.html);
        let err = |ops: Vec<EditOp>| apply("S", &f, &ops).unwrap_err();
        assert!(err(vec![EditOp::SetCell { index: 3, row: 0, col: 9, text: "x".into() }]).contains("Spalte 9"));
        assert!(err(vec![EditOp::SetCell { index: 3, row: 4, col: 0, text: "x".into() }]).contains("Zeile 4"));
        assert!(err(vec![EditOp::SetCell { index: 1, row: 0, col: 0, text: "x".into() }]).contains("keine Tabelle"), "ein Absatz ist keine Tabelle");
        assert!(err(vec![EditOp::SetCell { index: 3, row: 0, col: 0, text: "x".into() }, EditOp::Delete { index: 3 }]).contains("mehrfach"));
        assert!(err(vec![EditOp::SetCell { index: 3, row: 0, col: 0, text: "x".repeat(MAX_CELL_TEXT + 1) }]).contains("zu lang"));
        let f = read_fragments(BIZ);
        assert!(apply("S", &f, &[EditOp::SetCell { index: 0, row: -1, col: 0, text: "x".into() }]).unwrap_err().contains("keine Kopfzeile"));
    }

    #[test]
    fn the_operations_are_read_from_the_json_the_assistant_sends() {
        let ops: Vec<EditOp> = serde_json::from_value(serde_json::json!([
            { "op": "set_cell", "index": 2, "row": 0, "col": 1, "text": "Neu" },
            { "op": "add_row", "index": 2, "after": -1, "cells": ["a", "b"] },
            { "op": "delete_row", "index": 2, "row": 3 },
            { "op": "copy_table", "index": 2, "rows": [["F", "x"]] },
        ]))
        .unwrap();
        assert_eq!(ops.len(), 4);
        assert!(matches!(&ops[3], EditOp::CopyTable { headers, .. } if headers.is_empty()), "headers sind optional");
    }

    /// Wie die Grobplanung: Kopfzeile, normale Zellen und eine Spalte mit Checklisten (Kreise zum Abhaken)
    const GROB: &str = concat!(
        "<table style=\"width: 757px;\"><colgroup><col style=\"width: 170px;\"><col style=\"width: 108px;\"><col style=\"width: 308px;\"><col style=\"width: 171px;\"></colgroup><tbody>",
        "<tr><th colwidth=\"170\"><p>Phase</p></th><th colwidth=\"108\"><p>Zeitraum</p></th><th colwidth=\"308\"><p>Inhalt</p></th><th colwidth=\"171\"><p>Ergebnis</p></th></tr>",
        "<tr><td colwidth=\"170\"><p>Start</p></td><td colwidth=\"108\"><p>KW 40</p></td><td colwidth=\"308\"><p>Thema wählen</p></td><td colwidth=\"171\"><ul data-type=\"taskList\"><li data-checked=\"true\" data-type=\"taskItem\"><label><input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>Erstellt</p></div></li></ul></td></tr>",
        "<tr><td colwidth=\"170\"><p><strong>Abgabe</strong></p></td><td colwidth=\"108\"><p><strong>18.01.2026</strong></p></td><td colwidth=\"308\"><p><strong>Abgabe</strong></p></td><td colwidth=\"171\"><ul data-type=\"taskList\"><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label><div><p>Abgegeben</p></div></li></ul></td></tr>",
        "</tbody></table><p>Ende</p>",
    );

    #[test]
    fn a_table_with_checklists_in_cells_is_readable_and_stays_locked_against_replacing() {
        let f = read_fragments(GROB);
        assert!(f[0].rich && f[0].label.contains("Checklisten"), "{}", f[0].label);
        match &f[0].block {
            Some(Block::Table { headers, rows, header_column }) => {
                assert_eq!(headers, &["Phase", "Zeitraum", "Inhalt", "Ergebnis"]);
                assert!(!header_column);
                assert_eq!(rows[0], ["Start", "KW 40", "Thema wählen", "[x] Erstellt"], "die Checkliste ist als Text lesbar");
                assert_eq!(rows[1], ["**Abgabe**", "**18.01.2026**", "**Abgabe**", "[ ] Abgegeben"]);
            }
            other => panic!("keine Tabelle: {other:?}"),
        }
        assert!(!read_fragments(PAGE)[3].rich, "eine einfache Tabelle ist nicht reich");

        // Ersetzen würde die Checklisten zerstören
        let err = apply("S", &f, &[EditOp::Replace { index: 0, blocks: vec![Block::Table { headers: vec!["A".into()], rows: vec![vec!["1".into()]], header_column: false }] }]).unwrap_err();
        assert!(err.contains("Checklisten") && err.contains("set_cell"), "{err}");
        // Entfernen der ganzen Tabelle bleibt möglich
        assert!(apply("S", &f, &[EditOp::Delete { index: 0 }]).is_ok());
    }

    #[test]
    fn other_cells_change_while_checklist_cells_stay_exactly_as_they_were() {
        let f = read_fragments(GROB);
        let plan = apply("S", &f, &[EditOp::SetCell { index: 0, row: 1, col: 1, text: "**18.01.2027**".into() }]).unwrap();
        assert!(plan.html.contains("<td colwidth=\"108\"><p><strong>18.01.2027</strong></p></td>"), "{}", plan.html);
        assert!(!plan.html.contains("18.01.2026"));
        // Beide Checklisten sind Zeichen für Zeichen dieselben, ebenso Spaltenbreiten und der Rest der Seite
        for item in ["<ul data-type=\"taskList\"><li data-checked=\"true\" data-type=\"taskItem\"><label><input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>Erstellt</p></div></li></ul>", "<ul data-type=\"taskList\"><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label><div><p>Abgegeben</p></div></li></ul>"] {
            assert!(plan.html.contains(item), "Checkliste geändert: {item}");
        }
        assert!(plan.html.starts_with("<table style=\"width: 757px;\"><colgroup>") && plan.html.ends_with("</tbody></table><p>Ende</p>"));

        // Eine Zelle mit Checkliste selbst lässt sich nicht setzen
        let err = apply("S", &f, &[EditOp::SetCell { index: 0, row: 0, col: 3, text: "Fertig".into() }]).unwrap_err();
        assert!(err.contains("Checkliste") && err.contains("Zeile 0, Spalte 3"), "{err}");
    }

    #[test]
    fn new_rows_and_copies_get_an_open_checklist_item_in_the_checklist_column() {
        let f = read_fragments(GROB);
        let plan = apply("S", &f, &[EditOp::AddRow { index: 0, after: 0, cells: vec!["Nachlese".into(), "KW 5".into(), "Rückblick".into(), "Besprochen".into()] }]).unwrap();
        assert!(
            plan.html.contains("<tr><td colwidth=\"170\"><p>Nachlese</p></td><td colwidth=\"108\"><p>KW 5</p></td><td colwidth=\"308\"><p>Rückblick</p></td><td colwidth=\"171\"><ul data-type=\"taskList\"><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label><div><p>Besprochen</p></div></li></ul></td></tr>"),
            "{}",
            plan.html
        );
        let removed = apply("S", &f, &[EditOp::DeleteRow { index: 0, row: 0 }]).unwrap();
        assert!(!removed.html.contains("Thema wählen") && removed.html.contains("Abgegeben"));

        let copy = apply("S", &f, &[EditOp::CopyTable { index: 0, headers: vec!["Phase".into(), "Zeitraum".into(), "Inhalt".into(), "Ergebnis".into()], rows: vec![vec!["Neu".into(), "KW 9".into(), "Test".into(), "Offen".into()]] }]).unwrap();
        assert_eq!(copy.html.matches("<colgroup>").count(), 2);
        assert!(copy.html.matches("data-checked=\"false\"").count() >= 2, "die Kopie hat einen offenen Eintrag");
    }
}
