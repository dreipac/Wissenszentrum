//! Dokumentationsseiten aus strukturierten Bausteinen: der Assistent beschreibt Ordner, Seiten und deren Inhalt
//! (Überschriften, Absätze, Listen, Tabellen, Trennlinien), die App prüft das und baut daraus das HTML des Editors.
//! Das Modell schreibt nie selbst HTML; aller Text wird maskiert, es kann also nichts in eine Seite eingeschleust werden.

use crate::docs::{self, DocInput};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// So viele Einträge (Ordner und Seiten) darf ein Vorschlag höchstens anlegen
pub const MAX_NODES: usize = 30;
/// So viele Ebenen darf der vorgeschlagene Baum selbst tief sein
pub const MAX_NEW_DEPTH: usize = 4;
const MAX_BLOCKS: usize = 200;
const MAX_TEXT: usize = 5000;
const MAX_CELL: usize = 500;
const MAX_COLS: usize = 12;
const MAX_ROWS: usize = 100;
const MAX_ITEMS: usize = 50;
const MAX_HEADING: usize = 200;

/// Ein Baustein im Inhalt einer Seite. Text darf **fett**, *kursiv*, `Code` und [Link](https://…) enthalten.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Heading { level: u8, text: String },
    Paragraph { text: String },
    BulletList { items: Vec<String> },
    NumberedList { items: Vec<String> },
    Table { headers: Vec<String>, rows: Vec<Vec<String>> },
    Divider,
    Quote { text: String },
    Code { text: String },
}

/// Ordner oder Seite im Vorschlag. Ordner dienen nur zum Gliedern, Seiten tragen den Inhalt; beide dürfen Unterseiten haben.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocNodeSpec {
    /// "folder" oder "page"
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub blocks: Vec<Block>,
    #[serde(default)]
    pub children: Vec<DocNodeSpec>,
}

/// Was ein Vorschlag anlegen würde, für die Anzeige.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub folders: usize,
    pub pages: usize,
    pub headings: usize,
    pub tables: usize,
    pub dividers: usize,
}

// --- Prüfung -------------------------------------------------------------------------

fn text_ok(what: &str, text: &str, max: usize) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err(format!("{what} ist leer."));
    }
    if text.chars().count() > max {
        return Err(format!("{what} ist zu lang (höchstens {max} Zeichen)."));
    }
    Ok(())
}

fn validate_blocks(page: &str, blocks: &[Block], stats: &mut Stats) -> Result<(), String> {
    if blocks.len() > MAX_BLOCKS {
        return Err(format!("Seite „{page}“ hat zu viele Bausteine (höchstens {MAX_BLOCKS})."));
    }
    // Überschriften bauen aufeinander auf: Ebene 1, darunter 2, darunter 3, keine Ebene wird übersprungen
    let mut level = 0u8;
    for block in blocks {
        match block {
            Block::Heading { level: l, text } => {
                if !(1..=3).contains(l) {
                    return Err(format!("Seite „{page}“: Überschriften gibt es nur in den Ebenen 1 bis 3."));
                }
                text_ok(&format!("Eine Überschrift auf Seite „{page}“"), text, MAX_HEADING)?;
                if *l > level + 1 {
                    return Err(if level == 0 {
                        format!("Seite „{page}“: Die erste Überschrift muss Ebene 1 haben, nicht {l}.")
                    } else {
                        format!("Seite „{page}“: Überschrift „{}“ (Ebene {l}) überspringt eine Ebene. Auf Ebene {level} folgt höchstens Ebene {}.", text.trim(), level + 1)
                    });
                }
                level = *l;
                stats.headings += 1;
            }
            Block::Paragraph { text } => text_ok(&format!("Ein Absatz auf Seite „{page}“"), text, MAX_TEXT)?,
            Block::Quote { text } => text_ok(&format!("Ein Zitat auf Seite „{page}“"), text, MAX_TEXT)?,
            Block::Code { text } => text_ok(&format!("Ein Codeblock auf Seite „{page}“"), text, MAX_TEXT)?,
            Block::BulletList { items } | Block::NumberedList { items } => {
                if items.is_empty() || items.len() > MAX_ITEMS {
                    return Err(format!("Eine Liste auf Seite „{page}“ braucht 1 bis {MAX_ITEMS} Einträge."));
                }
                for item in items {
                    text_ok(&format!("Ein Listeneintrag auf Seite „{page}“"), item, MAX_CELL)?;
                }
            }
            Block::Table { headers, rows } => {
                if headers.is_empty() || headers.len() > MAX_COLS {
                    return Err(format!("Eine Tabelle auf Seite „{page}“ braucht 1 bis {MAX_COLS} Spalten."));
                }
                if rows.is_empty() || rows.len() > MAX_ROWS {
                    return Err(format!("Eine Tabelle auf Seite „{page}“ braucht 1 bis {MAX_ROWS} Zeilen."));
                }
                for header in headers {
                    text_ok(&format!("Eine Spaltenüberschrift der Tabelle auf Seite „{page}“"), header, MAX_CELL)?;
                }
                for (i, row) in rows.iter().enumerate() {
                    if row.len() != headers.len() {
                        return Err(format!("Tabelle auf Seite „{page}“: Zeile {} hat {} statt {} Zellen. Jede Zeile braucht so viele Zellen wie Spalten.", i + 1, row.len(), headers.len()));
                    }
                    if row.iter().any(|c| c.chars().count() > MAX_CELL) {
                        return Err(format!("Tabelle auf Seite „{page}“: Eine Zelle ist zu lang (höchstens {MAX_CELL} Zeichen)."));
                    }
                }
                stats.tables += 1;
            }
            Block::Divider => stats.dividers += 1,
        }
    }
    Ok(())
}

fn validate_node(node: &DocNodeSpec, depth: usize, count: &mut usize, stats: &mut Stats) -> Result<(), String> {
    *count += 1;
    if *count > MAX_NODES {
        return Err(format!("Ein Vorschlag darf höchstens {MAX_NODES} Ordner und Seiten anlegen. Teile ihn auf."));
    }
    if depth > MAX_NEW_DEPTH {
        return Err(format!("Ein Vorschlag darf höchstens {MAX_NEW_DEPTH} Ebenen tief sein."));
    }
    let title = node.title.trim();
    if title.is_empty() {
        return Err("Jeder Ordner und jede Seite braucht einen Titel.".into());
    }
    if title.chars().count() > 200 {
        return Err(format!("Der Titel „{title}“ ist zu lang (höchstens 200 Zeichen)."));
    }
    match node.kind.as_str() {
        "folder" => {
            if !node.blocks.is_empty() {
                return Err(format!("Der Ordner „{title}“ darf keinen Inhalt haben. Lege Inhalte in Seiten ab."));
            }
            stats.folders += 1;
        }
        "page" => {
            validate_blocks(title, &node.blocks, stats)?;
            stats.pages += 1;
        }
        other => return Err(format!("type „{other}“ gibt es nicht. Erlaubt: folder, page.")),
    }
    for child in &node.children {
        validate_node(child, depth + 1, count, stats)?;
    }
    Ok(())
}

/// Prüft den ganzen Baum und zählt, was er anlegen würde.
pub fn validate(nodes: &[DocNodeSpec]) -> Result<Stats, String> {
    if nodes.is_empty() {
        return Err("Es gibt nichts anzulegen: items ist leer.".into());
    }
    let mut stats = Stats::default();
    let mut count = 0;
    for node in nodes {
        validate_node(node, 1, &mut count, &mut stats)?;
    }
    Ok(stats)
}

/// Wie viele Ebenen der Baum selbst hat.
pub fn tree_depth(nodes: &[DocNodeSpec]) -> usize {
    nodes.iter().map(|n| 1 + tree_depth(&n.children)).max().unwrap_or(0)
}

// --- HTML ------------------------------------------------------------------------------

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

fn find(chars: &[char], from: usize, needle: &[char]) -> Option<usize> {
    if from >= chars.len() {
        return None;
    }
    chars[from..].windows(needle.len()).position(|w| w == needle).map(|p| p + from)
}

/// Einfache Auszeichnung im Text zu HTML: **fett**, *kursiv*, `Code`, [Text](https://…); alles andere wird maskiert.
pub fn inline_html(text: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '*' && chars.get(i + 1) == Some(&'*') {
            if let Some(end) = find(&chars, i + 2, &['*', '*']).filter(|e| *e > i + 2) {
                out.push_str(&format!("<strong>{}</strong>", escape(&chars[i + 2..end].iter().collect::<String>())));
                i = end + 2;
                continue;
            }
        }
        if c == '`' {
            if let Some(end) = find(&chars, i + 1, &['`']).filter(|e| *e > i + 1) {
                out.push_str(&format!("<code>{}</code>", escape(&chars[i + 1..end].iter().collect::<String>())));
                i = end + 1;
                continue;
            }
        }
        if c == '*' && chars.get(i + 1).map(|n| *n != ' ' && *n != '*').unwrap_or(false) {
            if let Some(end) = find(&chars, i + 1, &['*']).filter(|e| *e > i + 1) {
                out.push_str(&format!("<em>{}</em>", escape(&chars[i + 1..end].iter().collect::<String>())));
                i = end + 1;
                continue;
            }
        }
        if c == '[' {
            if let Some(close) = find(&chars, i + 1, &[']', '(']) {
                if let Some(end) = find(&chars, close + 2, &[')']) {
                    let label: String = chars[i + 1..close].iter().collect();
                    let url: String = chars[close + 2..end].iter().collect();
                    let url = url.trim();
                    let safe = ["https://", "http://", "mailto:"].iter().any(|p| url.starts_with(p)) && !url.chars().any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>');
                    if safe && !label.trim().is_empty() {
                        out.push_str(&format!("<a href=\"{}\">{}</a>", escape(url), escape(&label)));
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        if c == '\n' {
            out.push_str("<br>");
        } else {
            out.push_str(&escape(&c.to_string()));
        }
        i += 1;
    }
    out
}

fn cell(tag: &str, text: &str) -> String {
    format!("<{tag}><p>{}</p></{tag}>", inline_html(text))
}

fn list(tag: &str, items: &[String]) -> String {
    let rows: String = items.iter().map(|i| format!("<li><p>{}</p></li>", inline_html(i))).collect();
    format!("<{tag}>{rows}</{tag}>")
}

/// HTML eines Bausteins, so wie der Editor es einliest.
pub fn block_html(block: &Block) -> String {
    match block {
        Block::Heading { level, text } => format!("<h{level}>{}</h{level}>", inline_html(text)),
        Block::Paragraph { text } => format!("<p>{}</p>", inline_html(text)),
        Block::BulletList { items } => list("ul", items),
        Block::NumberedList { items } => list("ol", items),
        Block::Table { headers, rows } => {
            let head: String = headers.iter().map(|h| cell("th", h)).collect();
            let body: String = rows.iter().map(|r| format!("<tr>{}</tr>", r.iter().map(|c| cell("td", c)).collect::<String>())).collect();
            format!("<table><tbody><tr>{head}</tr>{body}</tbody></table>")
        }
        Block::Divider => "<hr>".to_string(),
        Block::Quote { text } => format!("<blockquote><p>{}</p></blockquote>", inline_html(text)),
        Block::Code { text } => format!("<pre><code>{}</code></pre>", escape(text.trim_matches('\n'))),
    }
}

/// Reiner Text aus HTML für die Suche: Tags weg, Umbrüche als Zeilenwechsel.
fn plain_of(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    let mut tag = String::new();
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                if tag.starts_with("br") || tag.starts_with("/p") || tag.starts_with("/li") || tag.starts_with("/h") {
                    out.push('\n');
                }
            }
            c if in_tag => tag.push(c),
            c => out.push(c),
        }
    }
    let text = out.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&amp;", "&");
    text.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

/// Inhalt einer Seite als (HTML, reiner Text).
pub fn page_content(blocks: &[Block]) -> (String, String) {
    let html: String = blocks.iter().map(block_html).collect();
    let plain = blocks
        .iter()
        .map(|b| match b {
            Block::Table { headers, rows } => {
                let line = |cells: &[String]| cells.iter().map(|c| plain_of(&inline_html(c))).collect::<Vec<_>>().join(" | ");
                std::iter::once(line(headers)).chain(rows.iter().map(|r| line(r))).collect::<Vec<_>>().join("\n")
            }
            other => plain_of(&block_html(other)),
        })
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    (html, plain)
}

// --- Anlegen ----------------------------------------------------------------------------

fn create_node(conn: &Connection, parent: Option<i64>, node: &DocNodeSpec) -> Result<i64, String> {
    let page = docs::create_page(conn, parent, &node.title, &node.kind)?;
    if node.kind == "page" && !node.blocks.is_empty() {
        let (content, plain) = page_content(&node.blocks);
        docs::update_page(conn, page.id, &DocInput { title: node.title.trim().to_string(), content, plain })?;
    }
    for child in &node.children {
        create_node(conn, Some(page.id), child)?;
    }
    Ok(page.id)
}

/// Legt den ganzen Baum unter `parent` an (ganz oder gar nicht) und liefert die Nummern der obersten Einträge.
pub fn create_tree(conn: &Connection, parent: Option<i64>, nodes: &[DocNodeSpec]) -> Result<Vec<i64>, String> {
    validate(nodes)?;
    if let Some(p) = parent {
        docs::get_page(conn, p).map_err(|_| "Der Zielordner existiert nicht mehr.".to_string())?;
        if docs::depth_of(conn, p)? + tree_depth(nodes) > docs::MAX_DEPTH {
            return Err(format!("Seiten können höchstens {} Ebenen tief verschachtelt werden.", docs::MAX_DEPTH));
        }
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for node in nodes {
        ids.push(create_node(&tx, parent, node)?);
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ids)
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

    fn page(title: &str, blocks: Vec<Block>) -> DocNodeSpec {
        DocNodeSpec { kind: "page".into(), title: title.into(), blocks, children: Vec::new() }
    }

    fn folder(title: &str, children: Vec<DocNodeSpec>) -> DocNodeSpec {
        DocNodeSpec { kind: "folder".into(), title: title.into(), blocks: Vec::new(), children }
    }

    fn h(level: u8, text: &str) -> Block {
        Block::Heading { level, text: text.into() }
    }

    #[test]
    fn inline_formatting_is_converted_and_everything_else_escaped() {
        assert_eq!(inline_html("a **fett** und *schief* mit `x<y`"), "a <strong>fett</strong> und <em>schief</em> mit <code>x&lt;y</code>");
        assert_eq!(inline_html("<script>alert(1)</script> & \"q\""), "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;");
        assert_eq!(inline_html("[Seite](https://example.com/a?b=1)"), "<a href=\"https://example.com/a?b=1\">Seite</a>");
        assert_eq!(inline_html("[Böse](javascript:alert(1))"), "[Böse](javascript:alert(1))", "nur http, https und mailto werden Links");
        assert_eq!(inline_html("2 * 3 = 6 und **offen"), "2 * 3 = 6 und **offen");
        assert_eq!(inline_html("Zeile 1\nZeile 2"), "Zeile 1<br>Zeile 2");
    }

    #[test]
    fn blocks_become_editor_html() {
        let table = Block::Table { headers: vec!["Name".into(), "Wert".into()], rows: vec![vec!["a".into(), "**1**".into()]] };
        assert_eq!(block_html(&table), "<table><tbody><tr><th><p>Name</p></th><th><p>Wert</p></th></tr><tr><td><p>a</p></td><td><p><strong>1</strong></p></td></tr></tbody></table>");
        assert_eq!(block_html(&Block::Divider), "<hr>");
        assert_eq!(block_html(&h(2, "Titel & Co")), "<h2>Titel &amp; Co</h2>");
        assert_eq!(block_html(&Block::BulletList { items: vec!["eins".into(), "zwei".into()] }), "<ul><li><p>eins</p></li><li><p>zwei</p></li></ul>");
        assert_eq!(block_html(&Block::Code { text: "a < b".into() }), "<pre><code>a &lt; b</code></pre>");
    }

    #[test]
    fn plain_text_covers_everything_for_the_search() {
        let (html, plain) = page_content(&[h(1, "Ablauf"), Block::Paragraph { text: "Erst **prüfen**".into() }, Block::Divider, Block::Table { headers: vec!["A".into(), "B".into()], rows: vec![vec!["1".into(), "2".into()]] }]);
        assert!(html.starts_with("<h1>Ablauf</h1><p>Erst <strong>prüfen</strong></p><hr><table>"));
        assert_eq!(plain, "Ablauf\nErst prüfen\nA | B\n1 | 2");
    }

    #[test]
    fn headings_must_not_skip_levels() {
        let ok = validate(&[page("Seite", vec![h(1, "A"), h(2, "B"), h(3, "C"), h(2, "D"), h(1, "E")])]).unwrap();
        assert_eq!((ok.pages, ok.headings), (1, 5));
        assert!(validate(&[page("S", vec![h(2, "Zu tief")])]).unwrap_err().contains("erste Überschrift muss Ebene 1"));
        let skip = validate(&[page("S", vec![h(1, "A"), h(3, "C")])]).unwrap_err();
        assert!(skip.contains("überspringt eine Ebene"), "{skip}");
        assert!(validate(&[page("S", vec![h(4, "x")])]).is_err());
        assert!(validate(&[page("S", vec![h(1, "  ")])]).is_err());
    }

    #[test]
    fn tables_need_matching_rows_and_structure_is_checked() {
        let bad = Block::Table { headers: vec!["A".into(), "B".into()], rows: vec![vec!["1".into()]] };
        assert!(validate(&[page("S", vec![bad])]).unwrap_err().contains("Zeile 1 hat 1 statt 2 Zellen"));
        let empty = Block::Table { headers: vec!["A".into()], rows: vec![] };
        assert!(validate(&[page("S", vec![empty])]).is_err());
        assert!(validate(&[folder("F", vec![]), page("", vec![])]).is_err(), "Titel fehlt");
        let mut with_text = folder("F", vec![]);
        with_text.blocks = vec![Block::Divider];
        assert!(validate(&[with_text]).unwrap_err().contains("keinen Inhalt"));
        let mut odd = page("S", vec![]);
        odd.kind = "ordner".into();
        assert!(validate(&[odd]).is_err());
        assert!(validate(&[]).is_err());
        let many: Vec<DocNodeSpec> = (0..=MAX_NODES).map(|i| page(&format!("S{i}"), vec![])).collect();
        assert!(validate(&many).unwrap_err().contains("höchstens"));
        let deep = folder("1", vec![folder("2", vec![folder("3", vec![folder("4", vec![folder("5", vec![])])])])]);
        assert!(validate(&[deep]).unwrap_err().contains("Ebenen"));
    }

    #[test]
    fn tree_is_created_with_content_and_order() {
        let c = conn();
        let ids = create_tree(
            &c,
            None,
            &[folder(
                "Projekt Alpha",
                vec![
                    page("Überblick", vec![h(1, "Ziel"), Block::Paragraph { text: "Kurz und klar.".into() }, Block::Divider, h(1, "Plan")]),
                    DocNodeSpec { children: vec![page("Detail", vec![])], ..page("Risiken", vec![Block::Table { headers: vec!["Risiko".into(), "Stufe".into()], rows: vec![vec!["Verzug".into(), "hoch".into()]] }]) },
                ],
            )],
        )
        .unwrap();
        assert_eq!(ids.len(), 1);
        let pages = docs::list_pages(&c).unwrap();
        assert_eq!(pages.len(), 4);
        let overview = pages.iter().find(|p| p.title == "Überblick").unwrap();
        assert_eq!(overview.parent_id, Some(ids[0]));
        assert_eq!(overview.content, "<h1>Ziel</h1><p>Kurz und klar.</p><hr><h1>Plan</h1>");
        assert!(overview.plain.contains("Kurz und klar."));
        let risks = pages.iter().find(|p| p.title == "Risiken").unwrap();
        assert!(risks.content.contains("<table>") && risks.plain.contains("Verzug | hoch"));
        assert_eq!(pages.iter().find(|p| p.title == "Detail").unwrap().parent_id, Some(risks.id));
        assert_eq!((overview.position, risks.position), (0, 1), "Reihenfolge wie vorgeschlagen");
    }

    #[test]
    fn nothing_is_created_when_something_fails() {
        let c = conn();
        // Ungültiger Baum wird vorab abgelehnt
        assert!(create_tree(&c, None, &[page("A", vec![]), page("B", vec![h(3, "x")])]).is_err());
        assert_eq!(docs::list_pages(&c).unwrap().len(), 0);
        // Zu tief unter dem Zielordner: nichts entsteht
        let mut parent = None;
        for i in 0..7 {
            parent = Some(docs::create_page(&c, parent, &format!("E{i}"), "folder").unwrap().id);
        }
        let before = docs::list_pages(&c).unwrap().len();
        let err = create_tree(&c, parent, &[folder("X", vec![page("Y", vec![])])]).unwrap_err();
        assert!(err.contains("Ebenen"), "{err}");
        assert_eq!(docs::list_pages(&c).unwrap().len(), before);
        assert!(create_tree(&c, Some(999), &[page("A", vec![])]).is_err(), "unbekannter Zielordner");
    }
}
