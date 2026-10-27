/**
 * Bausteine für Dokumentationsseiten, die der Assistent vorschlägt. Das Backend prüft sie und baut daraus das HTML
 * des Editors; hier stehen nur die Typen und eine einfache Umwandlung für den Browser-Preview.
 */

export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph" | "quote" | "code"; text: string }
  | { type: "bullet_list" | "numbered_list"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "divider" };

/** Ordner oder Seite eines Vorschlags; Ordner gliedern nur, Seiten tragen den Inhalt, beide dürfen Unterseiten haben. */
export interface DocNodeSpec {
  type: "folder" | "page";
  title: string;
  blocks: DocBlock[];
  children: DocNodeSpec[];
}

export interface DocStats {
  folders: number;
  pages: number;
  headings: number;
  tables: number;
  dividers: number;
}

/** Eine Änderung an einer bestehenden Seite; die Nummern beziehen sich auf die Bausteine, wie der Assistent sie gelesen hat. */
export type EditOp =
  | { op: "replace"; index: number; blocks: DocBlock[] }
  | { op: "insert_after"; index: number; blocks: DocBlock[] }
  | { op: "delete"; index: number }
  | { op: "append"; blocks: DocBlock[] };

/** Ein bestehender Baustein: als Baustein, oder – wenn er sich nicht darstellen lässt (Bild, Datei …) – mit Bezeichnung und Text. */
export interface ShownBlock {
  block: DocBlock | null;
  label: string;
  text: string;
}

/** Ein Abschnitt der Seite nach der Änderung: unverändert, neu, ersetzt oder entfernt. */
export interface EditLine {
  kind: "same" | "added" | "replaced" | "removed";
  old: ShownBlock | null;
  new: DocBlock[];
}

export interface EditStats {
  added: number;
  replaced: number;
  removed: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Nur für den Browser-Preview: einfache Umwandlung ohne die Auszeichnung im Text. Im Programm baut das Backend das HTML. */
export function blocksToHtml(blocks: DocBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
        case "paragraph":
          return `<p>${esc(b.text)}</p>`;
        case "quote":
          return `<blockquote><p>${esc(b.text)}</p></blockquote>`;
        case "code":
          return `<pre><code>${esc(b.text)}</code></pre>`;
        case "bullet_list":
        case "numbered_list": {
          const tag = b.type === "bullet_list" ? "ul" : "ol";
          return `<${tag}>${b.items.map((i) => `<li><p>${esc(i)}</p></li>`).join("")}</${tag}>`;
        }
        case "table":
          return `<table><tbody><tr>${b.headers.map((h) => `<th><p>${esc(h)}</p></th>`).join("")}</tr>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td><p>${esc(c)}</p></td>`).join("")}</tr>`)
            .join("")}</tbody></table>`;
        case "divider":
          return "<hr>";
      }
    })
    .join("");
}

/** Reiner Text eines Bausteins für die Suche (Preview). */
export function blocksToPlain(blocks: DocBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case "divider":
          return "";
        case "table":
          return [b.headers.join(" | "), ...b.rows.map((r) => r.join(" | "))].join("\n");
        case "bullet_list":
        case "numbered_list":
          return b.items.join("\n");
        default:
          return b.text;
      }
    })
    .filter(Boolean)
    .join("\n");
}
