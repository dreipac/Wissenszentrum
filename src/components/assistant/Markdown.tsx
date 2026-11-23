import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Zeigt die Antworten des Assistenten: Absätze, Listen (- oder 1.), **fett**, *kursiv*, `Code`, Überschriften als fette
 * Zeile, Zitate, Trennlinien, Tabellen und Codeblöcke (```). Alles wird als normaler React-Inhalt ausgegeben, nie als
 * HTML, die Antwort kann also nichts in die Seite einschleusen.
 */

type Align = "left" | "center" | "right" | undefined;

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "code"; lang: string; text: string }
  | { type: "table"; head: string[]; align: Align[]; rows: string[][] };

/** Auszeichnung im Text: **fett**, *kursiv* und `Code`. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|`[^`\n]+`)/g;
  let last = 0;
  let key = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    out.push(
      token.startsWith("**") ? (
        <strong key={key++}>{token.slice(2, -2)}</strong>
      ) : token.startsWith("*") ? (
        <em key={key++}>{token.slice(1, -1)}</em>
      ) : (
        <code key={key++}>{token.slice(1, -1)}</code>
      ),
    );
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Zerlegt eine Tabellenzeile an den senkrechten Strichen; ein Strich in `Code` oder als \| gehört zur Zelle. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cell += c;
    } else if (c === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

const SEPARATOR_CELL = /^:?-+:?$/;

/** Die zweite Zeile einer Tabelle (|---|:---:|): ergibt die Ausrichtung der Spalten, sonst null. */
function separatorAligns(line: string, columns: number): Align[] | null {
  if (!line.includes("-")) return null;
  const cells = splitRow(line);
  if (cells.length !== columns || !cells.every((c) => SEPARATOR_CELL.test(c))) return null;
  return cells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : undefined));
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: "quote", text: quote.join("\n") });
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // Codeblock: bis zur schließenden Zeile; während die Antwort noch ankommt, reicht er bis zum Ende des Textes
    const fence = /^\s*(`{3,})\s*([\w+#.-]*)[^`]*$/.exec(line);
    if (fence) {
      flushAll();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !new RegExp("^\\s*`{" + fence[1].length + ",}\\s*$").test(lines[j])) {
        body.push(lines[j].replace(/\s+$/, ""));
        j++;
      }
      blocks.push({ type: "code", lang: fence[2], text: body.join("\n") });
      i = j;
      continue;
    }

    // Tabelle: eine Kopfzeile mit Strichen und darunter die Trennzeile
    if (line.includes("|") && i + 1 < lines.length) {
      const head = splitRow(line);
      const align = separatorAligns(lines[i + 1], head.length);
      if (head.length > 1 && align) {
        flushAll();
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
          const cells = splitRow(lines[j]);
          while (cells.length < head.length) cells.push("");
          rows.push(cells.slice(0, head.length));
          j++;
        }
        blocks.push({ type: "table", head, align, rows });
        i = j - 1;
        continue;
      }
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const quoted = /^\s*>\s?(.*)$/.exec(line);

    if (!line.trim()) {
      flushAll();
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      blocks.push({ type: "hr" });
    } else if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const type = bullet ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      list = list ?? { type, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (heading) {
      flushAll();
      blocks.push({ type: "h", text: heading[1] });
    } else if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
    } else {
      flushList();
      flushQuote();
      paragraph.push(line.trim());
    }
  }
  flushAll();
  return blocks;
}

/** Der Codeblock als Karte: oben die Sprache und „Kopieren“, darunter der Code mit waagrechtem Scrollen. */
function CodeCard({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Kopieren ist nur Komfort */
    }
  };

  return (
    <figure className="as-code">
      <figcaption>
        <span>{lang}</span>
        <button type="button" onClick={() => void copy()} aria-label="Code kopieren">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </figure>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="as-md">
      {parseBlocks(text).map((block, i) => {
        switch (block.type) {
          case "p":
            return <p key={i}>{inline(block.text)}</p>;
          case "h":
            return (
              <p key={i} className="as-h">
                {inline(block.text)}
              </p>
            );
          case "quote":
            return <blockquote key={i}>{inline(block.text)}</blockquote>;
          case "hr":
            return <hr key={i} />;
          case "code":
            return <CodeCard key={i} lang={block.lang} text={block.text} />;
          case "table":
            return (
              <div key={i} className="as-table">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, c) => (
                        <th key={c} style={{ textAlign: block.align[c] }}>
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} style={{ textAlign: block.align[c] }}>
                            {inline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default: {
            const Tag = block.type;
            return (
              <Tag key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
