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
}

fn opaque(html: &str, label: &str) -> Fragment {
    let plain = docbuild::plain_of(html);
    let text: String = plain.chars().take(SHOWN_TEXT).collect();
    Fragment { html: html.to_string(), block: None, label: label.to_string(), text, lossy: false }
}

fn parsed(html: &str, block: Block, label: &str, lossy: bool) -> Fragment {
    let text = docbuild::plain_of(html).chars().take(SHOWN_TEXT).collect();
    Fragment { html: html.to_string(), block: Some(block), label: label.to_string(), text, lossy }
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

fn collect_rows(inner: &str, rows: &mut Vec<Vec<(bool, String)>>, lossy: &mut bool) -> Option<()> {
    for part in split_top_level(inner) {
        let tag = read_tag(&part, 0)?;
        match tag.name.as_str() {
            "colgroup" | "!--" => {}
            "tbody" | "thead" | "tfoot" => collect_rows(inner_of(&part), rows, lossy)?,
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
                    let (text, l) = simple_text(inner_of(&cell))?;
                    *lossy |= l;
                    cells.push((ct.name == "th", text));
                }
                rows.push(cells);
            }
            _ => return None,
        }
    }
    Some(())
}

fn parse_table(html: &str) -> Option<(Block, bool)> {
    let mut rows = Vec::new();
    let mut lossy = false;
    collect_rows(inner_of(html), &mut rows, &mut lossy)?;
    let (head, body) = rows.split_first()?;
    if head.is_empty() || !head.iter().all(|(th, _)| *th) || body.is_empty() || body.iter().any(|r| r.len() != head.len()) {
        return None;
    }
    Some((Block::Table { headers: head.iter().map(|(_, t)| t.clone()).collect(), rows: body.iter().map(|r| r.iter().map(|(_, t)| t.clone()).collect()).collect() }, lossy))
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
            Some((block, lossy)) => parsed(html, block, "Tabelle", lossy),
            None => opaque(html, "Tabelle (mit verbundenen Zellen oder ohne Kopfzeile)"),
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
            let mut f = opaque(html, "Datei");
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

    let editable = |i: usize| -> Result<(), String> {
        let f = fragments.get(i).ok_or_else(|| format!("Baustein {i} gibt es nicht. Die Seite hat {n} Bausteine (0 bis {}).", n.saturating_sub(1)))?;
        if f.block.is_none() {
            return Err(format!("Baustein {i} ({}) lässt sich nicht ändern und bleibt unverändert. Füge Neues davor oder danach ein.", f.label));
        }
        Ok(())
    };

    for op in ops {
        match op {
            EditOp::Replace { index, blocks } => {
                editable(*index)?;
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
        } else {
            html.push_str(&f.html);
            lines.push(Line { kind: "same".into(), old: Some(f.into()), new: Vec::new() });
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
        assert_eq!(labels, ["Überschrift", "Absatz", "Aufzählung", "Tabelle", "Datei", "Trennlinie", "Checkliste", "Leerer Absatz", "Absatz"]);
        assert_eq!(f[0].block, Some(Block::Heading { level: 1, text: "Ziel".into() }));
        assert_eq!(f[1].block, Some(para("Das ist **wichtig** und *kurz* mit [Link](https://example.com).")));
        assert_eq!(f[2].block, Some(Block::BulletList { items: vec!["Eins".into(), "Zwei & drei".into()] }));
        assert_eq!(f[3].block, Some(Block::Table { headers: vec!["Phase".into(), "Ende".into()], rows: vec![vec!["Plan".into(), "01.11.".into()]] }));
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
}
