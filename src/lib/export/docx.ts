import type * as Docx from "docx";

/**
 * Export einer Seite der Dokumentation als Word-Datei (.docx).
 *
 * Der Editor speichert eine Seite als HTML. Hier wird es im Browser-Dokument zerlegt und Element für Element in
 * Word-Bausteine übersetzt: Überschriften werden echte Word-Überschriften (Navigationsbereich, Inhaltsverzeichnis),
 * Listen echte Nummerierungen, Tabellen echte Tabellen (mit verbundenen Zellen, Spaltenbreiten und Kopfzeile) und Bilder
 * eingebettete Bilder, auch in Tabellenzellen. Die Bibliothek wird erst beim Export geladen.
 */

type D = typeof Docx;
type Block = Docx.Paragraph | Docx.Table;
type Inline = Docx.TextRun | Docx.ExternalHyperlink | Docx.ImageRun;

/** Ein Abschnitt des Dokuments: eine Seite (oder ein Ordner) mit ihrem HTML. */
export interface ExportSection {
  title: string;
  html: string;
  /** 0 = Hauptseite (wird zum Titel), 1 und mehr = Unterseite (wird zur Überschrift dieser Ebene) */
  level: number;
}

export interface ExportOptions {
  /** Holt die Bytes eines Bildes der Dokumentation */
  loadImage: (id: number) => Promise<Blob>;
  /** Für den Vermerk „Exportiert am …“ */
  now?: Date;
}

// A4 mit 2,5 cm Rand: 16 cm Satzbreite
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1417;
const CONTENT_TWIPS = PAGE_W - 2 * MARGIN;
const TWIPS_PER_PX = 15;
const CONTENT_PX = Math.round(CONTENT_TWIPS / TWIPS_PER_PX);
const MAX_IMAGE_H_PX = 800;

const FONT = "Calibri";
const MONO = "Consolas";
const INK = "1D1D1B";
const MUTED = "6A6A64";
const LINE = "D3D3CC";
const SURFACE = "F3F3F1";

interface Prepared {
  data: Uint8Array;
  type: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
}

interface Ctx {
  d: D;
  images: Map<number, Prepared | null>;
  /** Verschiebt die Überschriften (Unterseiten liegen eine Ebene tiefer) */
  levelOffset: number;
  /** Größte Breite für Bilder in Pixel (in Tabellen die der Zelle) */
  maxWidthPx: number;
  /** Text standardmäßig fett (Kopfzellen) */
  bold: boolean;
  /** Zähler und Einstellungen für nummerierte Listen: jede Liste beginnt wieder bei 1 */
  numbering: Docx.INumberingOptions["config"][number][];
  ordered: { count: number };
}

interface Fmt {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  underline?: boolean;
  code?: boolean;
  sizePx?: number;
  color?: string;
  highlight?: boolean;
  sup?: boolean;
  sub?: boolean;
}

// --- Hilfen --------------------------------------------------------------------------------

const clean = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** "rgb(12, 34, 56)" oder "#aabbcc" als "AABBCC"; sonst nichts. */
function hexOf(css: string | undefined): string | undefined {
  if (!css) return undefined;
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) return hex[1].toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css.trim());
  if (!rgb) return undefined;
  return [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const px = (value: string | undefined): number | null => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : null;
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 1 })} MB`;
}

// --- Bilder --------------------------------------------------------------------------------

/** Bringt ein Bild in ein Format, das Word kennt (PNG, JPEG, GIF, BMP), und misst es. */
async function prepareImage(blob: Blob): Promise<Prepared | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const known: Record<string, Prepared["type"]> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/bmp": "bmp" };
    const type = known[blob.type];
    if (type) return { data: new Uint8Array(await blob.arrayBuffer()), type, width: bitmap.width, height: bitmap.height };
    // WebP und andere: über eine Zeichenfläche als PNG umwandeln
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;
    return { data: new Uint8Array(await png.arrayBuffer()), type: "png", width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

/** Größe im Dokument: die gespeicherte Breite, höchstens so breit wie der Platz und so hoch wie eine Seite. */
function fit(image: Prepared, wantedPx: number | null, maxWidthPx: number): { width: number; height: number } {
  let width = Math.min(wantedPx ?? image.width, maxWidthPx);
  let height = Math.round((width * image.height) / image.width);
  if (height > MAX_IMAGE_H_PX) {
    height = MAX_IMAGE_H_PX;
    width = Math.round((height * image.width) / image.height);
  }
  return { width: Math.max(width, 8), height: Math.max(height, 8) };
}

// --- Text ----------------------------------------------------------------------------------

function textRun(ctx: Ctx, text: string, fmt: Fmt): Docx.TextRun {
  const { d } = ctx;
  return new d.TextRun({
    text: clean(text),
    bold: fmt.bold || ctx.bold || undefined,
    italics: fmt.italics || undefined,
    strike: fmt.strike || undefined,
    underline: fmt.underline ? {} : undefined,
    font: fmt.code ? MONO : undefined,
    size: fmt.code ? 19 : fmt.sizePx ? Math.round((fmt.sizePx * 22) / 15) : undefined,
    color: fmt.color,
    highlight: fmt.highlight ? "yellow" : undefined,
    superScript: fmt.sup || undefined,
    subScript: fmt.sub || undefined,
    shading: fmt.code ? { type: d.ShadingType.CLEAR, fill: SURFACE, color: "auto" } : undefined,
  });
}

/** Läufe eines Elements: Text mit seiner Auszeichnung, Links, Umbrüche, Bilder. */
function inline(ctx: Ctx, node: Node, fmt: Fmt, out: Inline[]): void {
  const { d } = ctx;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/[\r\n\t]+/g, " ");
    if (text) out.push(textRun(ctx, text, fmt));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  const tag = el.tagName;
  if (tag === "BR") {
    out.push(new d.TextRun({ break: 1 }));
    return;
  }
  if (tag === "IMG") {
    const run = imageRun(ctx, el);
    if (run) out.push(run);
    return;
  }

  const next: Fmt = { ...fmt };
  if (tag === "STRONG" || tag === "B") next.bold = true;
  if (tag === "EM" || tag === "I") next.italics = true;
  if (tag === "S" || tag === "DEL" || tag === "STRIKE") next.strike = true;
  if (tag === "U") next.underline = true;
  if (tag === "CODE") next.code = true;
  if (tag === "MARK") next.highlight = true;
  if (tag === "SUP") next.sup = true;
  if (tag === "SUB") next.sub = true;
  if (tag === "SPAN") {
    const size = px(el.style.fontSize);
    if (size) next.sizePx = size;
    const color = hexOf(el.style.color);
    if (color) next.color = color;
    if (el.style.fontWeight === "bold" || Number(el.style.fontWeight) >= 600) next.bold = true;
    if (el.style.fontStyle === "italic") next.italics = true;
    if (el.style.textDecorationLine?.includes("underline")) next.underline = true;
  }

  if (tag === "A" && /^(https?:|mailto:)/i.test(el.getAttribute("href") ?? "")) {
    const children: Inline[] = [];
    el.childNodes.forEach((c) => inline(ctx, c, { ...next, underline: true, color: "2F5BEA" }, children));
    out.push(new d.ExternalHyperlink({ link: el.getAttribute("href") ?? "", children: children as Docx.TextRun[] }));
    return;
  }
  el.childNodes.forEach((c) => inline(ctx, c, next, out));
}

function imageRun(ctx: Ctx, el: Element, maxWidthPx = ctx.maxWidthPx): Docx.ImageRun | null {
  const id = Number(el.getAttribute("data-image-id"));
  const image = ctx.images.get(id);
  if (!image) return null;
  const wanted = el.getAttribute("data-width") ? Number(el.getAttribute("data-width")) : null;
  const size = fit(image, wanted, maxWidthPx);
  return new ctx.d.ImageRun({ type: image.type, data: image.data, transformation: size, altText: { name: "Bild", description: "Bild aus der Dokumentation", title: "" } });
}

/** Absatz aus dem Inhalt eines Elements. */
function paragraphOf(ctx: Ctx, el: Element, options: Docx.IParagraphOptions = {}): Docx.Paragraph {
  const runs: Inline[] = [];
  el.childNodes.forEach((c) => inline(ctx, c, {}, runs));
  return new ctx.d.Paragraph({ ...options, children: runs });
}

// --- Listen --------------------------------------------------------------------------------

const BULLETS = ["•", "◦", "▪", "•", "◦", "▪"];
const ORDERED_FORMATS = ["decimal", "lowerLetter", "lowerRoman", "decimal", "lowerLetter", "lowerRoman"] as const;
const INDENT = 360;

function levelIndent(level: number) {
  return { left: INDENT * (level + 1) + 120, hanging: 300 };
}

function newOrderedList(ctx: Ctx): string {
  const { d } = ctx;
  const reference = `ordered-${++ctx.ordered.count}`;
  ctx.numbering.push({
    reference,
    levels: ORDERED_FORMATS.map((format, level) => ({
      level,
      format: format === "decimal" ? d.LevelFormat.DECIMAL : format === "lowerLetter" ? d.LevelFormat.LOWER_LETTER : d.LevelFormat.LOWER_ROMAN,
      text: `%${level + 1}.`,
      alignment: d.AlignmentType.LEFT,
      style: { paragraph: { indent: levelIndent(level) } },
    })),
  });
  return reference;
}

/** Einträge einer Liste, auch verschachtelt. */
function list(ctx: Ctx, el: Element, level: number, out: Block[]): void {
  const { d } = ctx;
  const isTask = el.getAttribute("data-type") === "taskList";
  const ordered = el.tagName === "OL";
  const reference = ordered ? newOrderedList(ctx) : "bullets";
  const cap = Math.min(level, 5);

  for (const li of Array.from(el.children).filter((c) => c.tagName === "LI")) {
    // Checklisten: Kästchen und Inhalt stehen in <label> und <div>
    const body = isTask ? (Array.from(li.children).find((c) => c.tagName === "DIV") ?? li) : li;
    const checked = li.getAttribute("data-checked") === "true";
    let first = true;

    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((child as Element).tagName)) {
        list(ctx, child as Element, level + 1, out);
        continue;
      }
      const el2 = child.nodeType === Node.ELEMENT_NODE ? (child as Element) : null;
      if (el2 && (el2.tagName === "LABEL" || el2.tagName === "INPUT")) continue;
      if (el2 && el2.tagName === "P") {
        const runs: Inline[] = [];
        if (isTask && first) runs.push(new d.TextRun({ text: checked ? "☑  " : "☐  ", font: "Segoe UI Symbol" }));
        el2.childNodes.forEach((c) => inline(ctx, c, {}, runs));
        out.push(
          new d.Paragraph({
            children: runs,
            numbering: !isTask && first ? { reference, level: cap } : undefined,
            indent: isTask || !first ? { left: levelIndent(cap).left, hanging: isTask && first ? 300 : 0 } : undefined,
            spacing: { after: 60 },
          }),
        );
        first = false;
        continue;
      }
      if (el2) {
        // Weiterer Inhalt im Eintrag (Bild, Tabelle, Zitat …): eingerückt, ohne Aufzählungszeichen
        out.push(...blocks(ctx, wrap(el2)));
      }
    }
  }
}

/** Packt ein Element in einen Behälter, damit `blocks` es wie ein Kind behandelt. */
function wrap(el: Element): Element {
  const holder = document.createElement("div");
  holder.append(el.cloneNode(true));
  return holder;
}

// --- Tabellen ------------------------------------------------------------------------------

interface Cell {
  el: HTMLTableCellElement;
  col: number;
  colSpan: number;
  rowSpan: number;
}

function table(ctx: Ctx, el: HTMLTableElement): Docx.Table | null {
  const { d } = ctx;
  const rows = Array.from(el.rows);
  if (rows.length === 0) return null;

  // Raster: welche Zelle liegt in welcher Spalte (Zeilen- und Spaltenverbindungen berücksichtigt)
  const placed: Cell[][] = [];
  const occupied: number[] = [];
  let columns = 0;
  for (const tr of rows) {
    const before = occupied.slice();
    const line: Cell[] = [];
    let col = 0;
    for (const el2 of Array.from(tr.cells)) {
      while ((occupied[col] ?? 0) > 0) col++;
      const colSpan = Math.max(1, el2.colSpan || 1);
      const rowSpan = Math.max(1, el2.rowSpan || 1);
      line.push({ el: el2, col, colSpan, rowSpan });
      for (let c = 0; c < colSpan; c++) occupied[col + c] = rowSpan - 1;
      col += colSpan;
    }
    columns = Math.max(columns, col, occupied.length);
    for (let i = 0; i < occupied.length; i++) if ((before[i] ?? 0) > 0) occupied[i] = before[i] - 1;
    placed.push(line);
  }

  // Spaltenbreiten in Pixel: aus der Spaltenliste, sonst aus den Zellen; Unbekanntes bekommt einen gleichen Anteil
  const widths: (number | null)[] = Array.from({ length: columns }, () => null);
  Array.from(el.querySelectorAll(":scope > colgroup > col")).forEach((c, i) => {
    const w = px((c as HTMLElement).style.width);
    if (w && i < columns) widths[i] = w;
  });
  for (const line of placed) {
    for (const cell of line) {
      const spans = (cell.el.getAttribute("data-colwidth") ?? "").split(",").map((v) => px(v));
      spans.forEach((w, i) => {
        if (w && cell.col + i < columns && widths[cell.col + i] === null) widths[cell.col + i] = w;
      });
    }
  }
  const known = widths.filter((w): w is number => w !== null);
  const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const raw = widths.map((w) => w ?? fallback);
  // Die Tabelle füllt die Satzbreite, wie in der App
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  const twips = raw.map((w) => Math.max(400, Math.round((w / total) * CONTENT_TWIPS)));
  twips[twips.length - 1] += CONTENT_TWIPS - twips.reduce((a, b) => a + b, 0);

  const border = { style: d.BorderStyle.SINGLE, size: 4, color: LINE };
  const firstIsHeader = placed[0]?.length > 0 && placed[0].every((c) => c.el.tagName === "TH");

  const tableRows = placed.map((line, r) => {
    const trEl = rows[r];
    const height = px(trEl.style.height);
    const cells = line.map(({ el: cell, col, colSpan, rowSpan }) => {
      const widthTwips = twips.slice(col, col + colSpan).reduce((a, b) => a + b, 0);
      const cellCtx: Ctx = { ...ctx, maxWidthPx: Math.max(40, Math.round(widthTwips / TWIPS_PER_PX) - 14), bold: ctx.bold || cell.tagName === "TH" };
      const content = blocks(cellCtx, cell);
      // Eine Zelle endet in Word immer mit einem Absatz
      if (content.length === 0 || !(content[content.length - 1] instanceof d.Paragraph)) content.push(new d.Paragraph({ children: [] }));
      const background = hexOf(cell.style.backgroundColor) ?? (cell.tagName === "TH" ? SURFACE : undefined);
      return new d.TableCell({
        children: content,
        columnSpan: colSpan > 1 ? colSpan : undefined,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
        width: { size: widthTwips, type: d.WidthType.DXA },
        shading: background ? { type: d.ShadingType.CLEAR, fill: background, color: "auto" } : undefined,
        margins: { top: 70, bottom: 70, left: 110, right: 110 },
      });
    });
    return new d.TableRow({
      children: cells,
      tableHeader: r === 0 && firstIsHeader ? true : undefined,
      cantSplit: true,
      height: height ? { value: Math.round(height * TWIPS_PER_PX), rule: d.HeightRule.ATLEAST } : undefined,
    });
  });

  return new d.Table({
    rows: tableRows,
    width: { size: CONTENT_TWIPS, type: d.WidthType.DXA },
    columnWidths: twips,
    layout: d.TableLayoutType.FIXED,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
  });
}

// --- Blöcke --------------------------------------------------------------------------------

function blocks(ctx: Ctx, parent: Element): Block[] {
  const { d } = ctx;
  const out: Block[] = [];

  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? "").trim()) {
        const runs: Inline[] = [];
        inline(ctx, node, {}, runs);
        out.push(new d.Paragraph({ children: runs }));
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;

    switch (el.tagName) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const level = Math.min(Number(el.tagName[1]) + ctx.levelOffset, 6);
        const heading = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6][level - 1];
        out.push(paragraphOf({ ...ctx, bold: false }, el, { heading }));
        break;
      }
      case "P": {
        const hasContent = (el.textContent ?? "").trim() !== "" || el.querySelector("img, br") !== null;
        out.push(paragraphOf(ctx, el, hasContent ? {} : { spacing: { after: 0 } }));
        break;
      }
      case "UL":
      case "OL":
        list(ctx, el, 0, out);
        break;
      case "TABLE": {
        const t = table(ctx, el as HTMLTableElement);
        if (t) {
          out.push(t);
          // Nach einer Tabelle braucht Word einen Absatz, sonst kleben Tabelle und Folgendes zusammen
          out.push(new d.Paragraph({ children: [], spacing: { after: 80 } }));
        }
        break;
      }
      case "BLOCKQUOTE": {
        // Absätze im Zitat bekommen den seitlichen Strich, anderer Inhalt (Bild, Tabelle) bleibt, wie er ist
        for (const child of Array.from(el.children)) {
          if (child.tagName === "P") {
            out.push(
              paragraphOf(ctx, child, {
                indent: { left: 480 },
                border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: "B9B9B0", space: 10 } },
                spacing: { before: 60, after: 60 },
              }),
            );
          } else {
            out.push(...blocks(ctx, wrap(child)));
          }
        }
        break;
      }
      case "PRE": {
        const lines = clean(el.textContent ?? "").replace(/\n+$/, "").split("\n");
        lines.forEach((line, i) =>
          out.push(
            new d.Paragraph({
              children: [new d.TextRun({ text: line || " ", font: MONO, size: 19 })],
              shading: { type: d.ShadingType.CLEAR, fill: SURFACE, color: "auto" },
              spacing: { before: i === 0 ? 100 : 0, after: i === lines.length - 1 ? 140 : 0, line: 252 },
              indent: { left: 120, right: 120 },
            }),
          ),
        );
        break;
      }
      case "HR":
        out.push(new d.Paragraph({ children: [], border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "C8C8C0", space: 1 } }, spacing: { before: 200, after: 200 } }));
        break;
      case "IMG": {
        const run = imageRun(ctx, el);
        const align = el.getAttribute("data-align");
        out.push(
          new d.Paragraph({
            children: run ? [run] : [new d.TextRun({ text: "[Bild nicht verfügbar]", italics: true, color: MUTED })],
            alignment: align === "center" ? d.AlignmentType.CENTER : align === "right" ? d.AlignmentType.RIGHT : d.AlignmentType.LEFT,
            spacing: { before: 80, after: 120 },
            keepNext: false,
          }),
        );
        break;
      }
      case "DIV": {
        if (el.hasAttribute("data-file-id")) {
          const name = el.getAttribute("data-name") || el.textContent || "Datei";
          const size = Number(el.getAttribute("data-size"));
          out.push(
            new d.Paragraph({
              children: [
                new d.TextRun({ text: "Anhang  ", bold: true, color: MUTED, size: 18 }),
                new d.TextRun({ text: name }),
                ...(size > 0 ? [new d.TextRun({ text: `   ${formatBytes(size)}`, color: MUTED, size: 18 })] : []),
              ],
              shading: { type: d.ShadingType.CLEAR, fill: SURFACE, color: "auto" },
              border: { left: { style: d.BorderStyle.SINGLE, size: 18, color: "B9B9B0", space: 6 } },
              spacing: { before: 80, after: 120 },
              indent: { left: 120 },
            }),
          );
        } else {
          out.push(...blocks(ctx, el));
        }
        break;
      }
      default:
        // Unbekanntes Element: als Absatz mit seinem Text
        if ((el.textContent ?? "").trim()) out.push(paragraphOf(ctx, el));
    }
  }
  return out;
}

// --- Dokument ------------------------------------------------------------------------------

/** Alle Bilder aller Abschnitte laden und aufbereiten (je Bild einmal). */
async function loadImages(sections: ExportSection[], loadImage: ExportOptions["loadImage"]): Promise<Map<number, Prepared | null>> {
  const ids = new Set<number>();
  for (const s of sections) {
    const doc = new DOMParser().parseFromString(s.html, "text/html");
    doc.querySelectorAll("img[data-image-id]").forEach((img) => ids.add(Number(img.getAttribute("data-image-id"))));
  }
  const map = new Map<number, Prepared | null>();
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        map.set(id, await prepareImage(await loadImage(id)));
      } catch {
        map.set(id, null);
      }
    }),
  );
  return map;
}

/** Baut die Word-Datei und liefert ihre Bytes. */
export async function buildDocx(sections: ExportSection[], options: ExportOptions): Promise<Uint8Array> {
  if (sections.length === 0) throw "Es gibt nichts zu exportieren.";
  const d = await import("docx");
  const images = await loadImages(sections, options.loadImage);
  const numbering: Ctx["numbering"] = [
    {
      reference: "bullets",
      levels: BULLETS.map((text, level) => ({
        level,
        format: d.LevelFormat.BULLET,
        text,
        alignment: d.AlignmentType.LEFT,
        style: { paragraph: { indent: levelIndent(level) }, run: { font: "Calibri" } },
      })),
    },
  ];
  const ordered = { count: 0 };
  const children: Block[] = [];
  const now = options.now ?? new Date();

  sections.forEach((section, index) => {
    const ctx: Ctx = { d, images, levelOffset: section.level, maxWidthPx: CONTENT_PX, bold: false, numbering, ordered };
    const title = section.title.trim() || "Ohne Titel";

    if (section.level === 0) {
      children.push(new d.Paragraph({ text: title, heading: d.HeadingLevel.TITLE }));
      children.push(
        new d.Paragraph({
          children: [new d.TextRun({ text: `Exportiert aus dem Wissenszentrum am ${now.toLocaleDateString("de-CH")}`, color: MUTED, size: 18 })],
          border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: LINE, space: 6 } },
          spacing: { after: 240 },
        }),
      );
    } else {
      const heading = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3][Math.min(section.level, 3) - 1];
      children.push(new d.Paragraph({ text: title, heading, pageBreakBefore: section.level === 1 && index > 0 }));
    }

    const doc = new DOMParser().parseFromString(section.html, "text/html");
    children.push(...blocks(ctx, doc.body));
  });

  const file = new d.Document({
    creator: "Wissenszentrum",
    title: sections[0].title.trim() || "Dokumentation",
    description: "Export aus dem Wissenszentrum",
    numbering: { config: numbering },
    styles: {
      default: {
        document: { run: { font: FONT, size: 22, color: INK }, paragraph: { spacing: { line: 276, after: 120 } } },
        title: { run: { font: FONT, size: 52, bold: true, color: INK }, paragraph: { spacing: { before: 0, after: 100 } } },
        heading1: { run: { font: FONT, size: 36, bold: true, color: INK }, paragraph: { spacing: { before: 400, after: 140 }, keepNext: true } },
        heading2: { run: { font: FONT, size: 28, bold: true, color: INK }, paragraph: { spacing: { before: 320, after: 120 }, keepNext: true } },
        heading3: { run: { font: FONT, size: 24, bold: true, color: "3A3A36" }, paragraph: { spacing: { before: 260, after: 100 }, keepNext: true } },
        heading4: { run: { font: FONT, size: 22, bold: true, color: "3A3A36" }, paragraph: { spacing: { before: 220, after: 80 }, keepNext: true } },
        heading5: { run: { font: FONT, size: 22, bold: true, italics: true, color: MUTED }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
        heading6: { run: { font: FONT, size: 22, italics: true, color: MUTED }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
        hyperlink: { run: { color: "2F5BEA", underline: {} } },
      },
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } },
        footers: {
          default: new d.Footer({
            children: [
              new d.Paragraph({
                alignment: d.AlignmentType.RIGHT,
                children: [new d.TextRun({ children: ["Seite ", d.PageNumber.CURRENT, " von ", d.PageNumber.TOTAL_PAGES], size: 18, color: "8A8A84" })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await d.Packer.toBlob(file);
  return new Uint8Array(await blob.arrayBuffer());
}

