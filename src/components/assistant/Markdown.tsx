import type { ReactNode } from "react";

/**
 * Zeigt die Antworten des Assistenten: Absätze, Listen (- oder 1.), **fett**, `Code` und Überschriften als fette Zeile.
 * Alles wird als normaler React-Inhalt ausgegeben, nie als HTML, die Antwort kann also nichts in die Seite einschleusen.
 */

type Block = { type: "p"; text: string } | { type: "h"; text: string } | { type: "ul" | "ol"; items: string[] };

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  let key = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    out.push(token.startsWith("**") ? <strong key={key++}>{token.slice(2, -2)}</strong> : <code key={key++}>{token.slice(1, -1)}</code>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);

    if (!line.trim()) {
      flushParagraph();
    } else if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? "ul" : "ol";
      if (list && list.type !== type) flushList();
      list = list ?? { type, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h", text: heading[1] });
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="as-md">
      {parseBlocks(text).map((block, i) => {
        if (block.type === "p") return <p key={i}>{inline(block.text)}</p>;
        if (block.type === "h") return <p key={i} className="as-h">{inline(block.text)}</p>;
        const Tag = block.type;
        return (
          <Tag key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
