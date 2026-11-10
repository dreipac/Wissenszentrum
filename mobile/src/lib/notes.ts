import type { Note } from "@/data/types";

export const noteTitle = (n: Pick<Note, "title">) => n.title.trim() || "Ohne Titel";

/** Erste Zeilen des Textes als kurze Vorschau. */
export function notePreview(n: Pick<Note, "plain">, max = 120): string {
  const text = n.plain.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()} …` : text;
}

/** Ohne Titel und ohne Text. */
export const isEmptyNote = (n: Pick<Note, "title" | "plain">) => !n.title.trim() && !n.plain.trim();

/** Alle Ordner in Reihenfolge des Alphabets, ohne leere. */
export const folderNames = (notes: Note[]) => [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));

/** Notizen nach Suchtext (alle Wörter müssen in Titel oder Text vorkommen). */
export function searchNotes(notes: Note[], query: string): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return notes;
  return notes.filter((n) => {
    const hay = `${n.title} ${n.plain}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
