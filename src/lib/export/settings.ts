/**
 * Einstellungen des Word-Exports. Die Voreinstellung ergibt genau die Datei, die der Export schon vorher gebaut hat.
 * Dieselben Einstellungen gehen in die Vorschau und in die Datei: beide entstehen aus einem Aufruf von `buildDocx`.
 */

export type Level = "tight" | "normal" | "wide";

export interface ExportSettings {
  /** Der Titel der Seite über dem Text */
  showTitle: boolean;
  /** Die Zeile „Exportiert aus dem Wissenszentrum am …“ unter dem Titel */
  showNote: boolean;
  /** Die Trennlinie unter dem Kopf (Titel und Vermerk) */
  showHeaderRule: boolean;
  /** Trennlinien, die in der Seite selbst stehen */
  contentRules: boolean;
  /** „Seite 1 von 3“ in der Fußzeile */
  pageNumbers: boolean;
  /** Jede Unterseite beginnt auf einer neuen Seite */
  chapterBreaks: boolean;
  font: string;
  /** Schriftgröße des Textes in Punkt */
  fontPt: number;
  lineSpacing: Level;
  /** Breite der Tabellen in Prozent der Satzbreite */
  tableWidthPct: number;
  tableCellPadding: Level;
  /** Linien zwischen den Zellen */
  tableBorders: boolean;
  margins: Level;
  landscape: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  showTitle: true,
  showNote: true,
  showHeaderRule: true,
  contentRules: true,
  pageNumbers: true,
  chapterBreaks: true,
  font: "Calibri",
  fontPt: 11,
  lineSpacing: "normal",
  tableWidthPct: 100,
  tableCellPadding: "normal",
  tableBorders: true,
  margins: "normal",
  landscape: false,
};

/** Schriften, die Word auf den meisten Rechnern hat. Wer sie nicht hat, sieht eine Ersatzschrift. */
export const EXPORT_FONTS = ["Calibri", "Arial", "Segoe UI", "Verdana", "Times New Roman", "Georgia", "Cambria", "Garamond"] as const;

export const FONT_SIZES = [10, 11, 12] as const;
export const TABLE_WIDTH_MIN = 40;
export const TABLE_WIDTH_MAX = 100;

/** Zeilenabstand als Wert für Word (240 = einfach) */
export const LINE_TWIPS: Record<Level, number> = { tight: 240, normal: 276, wide: 360 };

/** Innenabstand der Tabellenzellen in Twips (oben/unten, links/rechts) */
export const CELL_PADDING: Record<Level, { v: number; h: number }> = { tight: { v: 30, h: 80 }, normal: { v: 70, h: 110 }, wide: { v: 130, h: 170 } };

/** Seitenränder in Twips (1 cm = 567) */
export const MARGIN_TWIPS: Record<Level, number> = { tight: 850, normal: 1417, wide: 1700 };

const PAGE_W = 11906;
const PAGE_H = 16838;

export interface PageMetrics {
  /** Hochformat; Word dreht bei Querformat selbst */
  portraitW: number;
  portraitH: number;
  margin: number;
  /** Breite des Textes zwischen den Rändern, in der gewählten Ausrichtung */
  contentTwips: number;
}

export function pageMetrics(settings: ExportSettings): PageMetrics {
  const margin = MARGIN_TWIPS[settings.margins];
  const width = settings.landscape ? PAGE_H : PAGE_W;
  return { portraitW: PAGE_W, portraitH: PAGE_H, margin, contentTwips: width - 2 * margin };
}

const KEY = "wz-export-settings";
const levels: Level[] = ["tight", "normal", "wide"];

/** Ein gespeicherter Wert, der nicht passt, fällt auf die Voreinstellung zurück. */
export function sanitize(raw: unknown): ExportSettings {
  const d = DEFAULT_EXPORT_SETTINGS;
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (key: keyof ExportSettings) => (typeof r[key] === "boolean" ? (r[key] as boolean) : (d[key] as boolean));
  const level = (key: keyof ExportSettings) => (levels.includes(r[key] as Level) ? (r[key] as Level) : (d[key] as Level));
  const width = Number(r.tableWidthPct);
  return {
    showTitle: bool("showTitle"),
    showNote: bool("showNote"),
    showHeaderRule: bool("showHeaderRule"),
    contentRules: bool("contentRules"),
    pageNumbers: bool("pageNumbers"),
    chapterBreaks: bool("chapterBreaks"),
    font: (EXPORT_FONTS as readonly string[]).includes(r.font as string) ? (r.font as string) : d.font,
    fontPt: (FONT_SIZES as readonly number[]).includes(r.fontPt as number) ? (r.fontPt as number) : d.fontPt,
    lineSpacing: level("lineSpacing"),
    tableWidthPct: Number.isFinite(width) ? Math.min(TABLE_WIDTH_MAX, Math.max(TABLE_WIDTH_MIN, Math.round(width))) : d.tableWidthPct,
    tableCellPadding: level("tableCellPadding"),
    tableBorders: bool("tableBorders"),
    margins: level("margins"),
    landscape: bool("landscape"),
  };
}

export function loadExportSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
}

export function saveExportSettings(settings: ExportSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* Merken ist nur Komfort */
  }
}
