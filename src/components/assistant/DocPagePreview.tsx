import type { DocBlock } from "../../lib/docBlocks";
import { inline } from "./Markdown";

/**
 * Inhalt einer Seite so, wie der Editor ihn zeigt: dieselben Elemente (Überschriften, Absätze, Listen mit Absatz im
 * Eintrag, Tabellen mit Absatz in der Zelle), damit die Gestaltung der Dokumentation greift. Alles wird als React-Inhalt
 * ausgegeben, nie als HTML.
 */
export function DocPageBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const Tag = `h${b.level}` as "h1" | "h2" | "h3";
            return <Tag key={i}>{inline(b.text)}</Tag>;
          }
          case "paragraph":
            return <p key={i}>{inline(b.text)}</p>;
          case "quote":
            return (
              <blockquote key={i}>
                <p>{inline(b.text)}</p>
              </blockquote>
            );
          case "code":
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            );
          case "bullet_list":
          case "numbered_list": {
            const Tag = b.type === "bullet_list" ? "ul" : "ol";
            return (
              <Tag key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <p>{inline(item)}</p>
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="tableWrapper">
                <table>
                  <tbody>
                    <tr>
                      {b.headers.map((h, j) => (
                        <th key={j}>
                          <p>{inline(h)}</p>
                        </th>
                      ))}
                    </tr>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c}>
                            <p>{inline(cell)}</p>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "divider":
            return <hr key={i} />;
        }
      })}
    </>
  );
}
