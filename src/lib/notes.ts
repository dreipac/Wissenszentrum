export interface Note {
  id: number;
  title: string;
  /** HTML des Editors */
  content: string;
  /** Inhalt als reiner Text (Vorschau, Suche) */
  plain: string;
  /** Leer = ohne Ordner */
  folder: string;
  pinned: boolean;
  /** UTC, Format "YYYY-MM-DD HH:MM:SS" */
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title: string;
  content: string;
  plain: string;
  folder: string;
}

export const emptyNote = (folder = ""): NoteInput => ({ title: "", content: "", plain: "", folder });

/** Ohne Titel und ohne Text. */
export const isEmptyNote = (n: Pick<Note, "title" | "plain">) => !n.title.trim() && !n.plain.trim();

export const noteTitle = (n: Pick<Note, "title">) => n.title.trim() || "Ohne Titel";

/** Erste Zeilen des Textes als einzeilige Vorschau. */
export const notePreview = (n: Pick<Note, "plain">, max = 140) => {
  const text = n.plain.replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max).trimEnd() + " …" : text;
};

/** SQLite liefert UTC ohne Zeitzone; hier in lokale Zeit umrechnen. */
const parseUtc = (s: string) => new Date(s.replace(" ", "T") + "Z");

const two = (n: number) => String(n).padStart(2, "0");

/** „Gerade eben“, „Vor 10 Min.“, „Heute, 09:12“, „Gestern“, „12. Okt“ oder „12.10.2025“. */
export function formatNoteTime(updatedAt: string, now = new Date()): string {
  const d = parseUtc(updatedAt);
  const minutes = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return "Gerade eben";
  if (minutes < 60) return `Vor ${minutes} Min.`;

  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days === 0) return `Heute, ${two(d.getHours())}:${two(d.getMinutes())}`;
  if (days === 1) return "Gestern";
  const short = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" }).format(d).replace(".", "");
  return d.getFullYear() === now.getFullYear() ? short : `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
}
