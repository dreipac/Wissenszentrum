/**
 * Beispieldaten für die Oberfläche. Alle Daten sind relativ zu heute, damit die Bildschirme immer „lebendig“ wirken
 * (etwas ist überfällig, etwas fällig, etwas steht an).
 */
import { addDays, startOfDay, toDateStr, toUtcStr } from "@/lib/dates";
import type { Bucket, CalendarEvent, Note, Snapshot, Subtask, Task } from "./types";

export function createSeed(now = new Date()): Snapshot {
  const today = startOfDay(now);
  const day = (offset: number) => toDateStr(addDays(today, offset));
  /** Lokale Zeit "YYYY-MM-DD HH:MM" am Tag `offset` */
  const at = (offset: number, time: string) => `${day(offset)} ${time}`;
  const ago = (minutes: number) => toUtcStr(new Date(now.getTime() - minutes * 60_000));

  const buckets: Bucket[] = [
    { id: 1, name: "Arbeit", color: "blue" },
    { id: 2, name: "Schule", color: "purple" },
    { id: 3, name: "Privat", color: "green" },
    { id: 4, name: "Einkaufen", color: "amber" },
  ];

  let subtaskId = 1;
  const steps = (...items: [string, boolean?][]): Subtask[] => items.map(([title, done]) => ({ id: subtaskId++, title, done: done ?? false }));

  const tasks: Task[] = [
    { id: 1, bucketId: 2, title: "Dossier Weltgeschehen lösen", description: "Lernziele zuerst lesen, dann die Aufgaben der Reihe nach.", priority: "high", dueDate: day(2), done: false, eventId: null, subtasks: steps(["Lernziele lesen", true], ["Aufgaben 1–5 lösen"], ["Aufgaben 6–10 lösen"], ["Antworten kontrollieren"]) },
    { id: 2, bucketId: 1, title: "Angebot Müller überarbeiten", description: "Preise anpassen und Lieferzeit ergänzen.", priority: "high", dueDate: day(-1), done: false, eventId: null, subtasks: [] },
    { id: 3, bucketId: 1, title: "Rechnung Q4 prüfen", description: "", priority: "high", dueDate: day(0), done: false, eventId: null, subtasks: [] },
    { id: 4, bucketId: 1, title: "Wochenbericht schreiben", description: "", priority: "medium", dueDate: day(0), done: false, eventId: null, subtasks: [] },
    { id: 5, bucketId: 1, title: "Protokoll der Teamsitzung versenden", description: "", priority: "low", dueDate: day(0), done: false, eventId: 1, subtasks: [] },
    { id: 6, bucketId: 1, title: "Präsentation für den Sprint-Review", description: "Drei Folien reichen: Ziel, Ergebnis, nächster Schritt.", priority: "medium", dueDate: day(1), done: false, eventId: 2, subtasks: steps(["Folien entwerfen"], ["Zahlen einsetzen"]) },
    { id: 7, bucketId: 3, title: "Zahnarzttermin bestätigen", description: "", priority: "medium", dueDate: day(1), done: false, eventId: 5, subtasks: [] },
    { id: 8, bucketId: 4, title: "Einkauf fürs Wochenende", description: "", priority: "low", dueDate: day(3), done: false, eventId: null, subtasks: steps(["Milch"], ["Brot", true], ["Gemüse"], ["Kaffee"]) },
    { id: 9, bucketId: 2, title: "Gesprächsfragen fürs BIZ vorbereiten", description: "Drei Fragen zu Lehrstellen, zwei zu Weiterbildung.", priority: "medium", dueDate: day(4), done: false, eventId: 4, subtasks: [] },
    { id: 10, bucketId: 2, title: "Prüfungsstoff zusammenfassen", description: "", priority: "medium", dueDate: day(5), done: false, eventId: 8, subtasks: [] },
    { id: 11, bucketId: 3, title: "Geburtstagsgeschenk für Mama besorgen", description: "", priority: "medium", dueDate: day(7), done: false, eventId: 6, subtasks: [] },
    { id: 12, bucketId: 3, title: "Velo reparieren lassen", description: "Hinterer Reifen verliert Luft.", priority: "low", dueDate: null, done: false, eventId: null, subtasks: [] },
    { id: 13, bucketId: null, title: "Neue Kopfhörer vergleichen", description: "", priority: "low", dueDate: null, done: false, eventId: null, subtasks: [] },
    { id: 14, bucketId: 1, title: "Steuerunterlagen sortieren", description: "", priority: "medium", dueDate: day(-3), done: true, eventId: null, subtasks: [] },
    { id: 15, bucketId: 2, title: "Arbeitsprotokoll abgeben", description: "", priority: "high", dueDate: day(-2), done: true, eventId: null, subtasks: [] },
    { id: 16, bucketId: 3, title: "Backup vom Laptop machen", description: "", priority: "low", dueDate: day(-1), done: true, eventId: null, subtasks: [] },
  ];

  const events: CalendarEvent[] = [
    { id: 1, title: "Teamsitzung", description: "Wochenstart, offene Punkte, Verteilung der Aufgaben.", location: "Büro, Raum 3", startsAt: at(0, "09:30"), endsAt: at(0, "10:30"), allDay: false },
    { id: 10, title: "Yoga", description: "", location: "Studio Mitte", startsAt: at(0, "18:30"), endsAt: at(0, "19:30"), allDay: false },
    { id: 3, title: "Mittagessen mit Nora", description: "", location: "Café Central", startsAt: at(1, "12:15"), endsAt: at(1, "13:30"), allDay: false },
    { id: 2, title: "Sprint-Review", description: "Ergebnisse der letzten zwei Wochen zeigen.", location: "Besprechungsraum 2", startsAt: at(2, "11:00"), endsAt: at(2, "12:00"), allDay: false },
    { id: 5, title: "Zahnarzt", description: "Kontrolle und Reinigung.", location: "Praxis Dr. Keller", startsAt: at(3, "08:00"), endsAt: at(3, "09:00"), allDay: false },
    { id: 7, title: "Kinoabend", description: "", location: "Kino Pathé", startsAt: at(4, "20:00"), endsAt: at(4, "22:30"), allDay: false },
    { id: 4, title: "BIZ-Gespräch", description: "Fragen sind vorbereitet.", location: "Berufsinformationszentrum", startsAt: at(5, "14:00"), endsAt: at(5, "15:00"), allDay: false },
    { id: 6, title: "Geburtstag Mama", description: "", location: "", startsAt: at(8, "00:00"), endsAt: at(9, "00:00"), allDay: true },
    { id: 8, title: "Prüfung Weltgeschehen", description: "Taschenrechner nicht erlaubt.", location: "Schule, Zimmer 204", startsAt: at(9, "08:15"), endsAt: at(9, "09:45"), allDay: false },
    { id: 9, title: "Wochenende in Zürich", description: "", location: "Zürich", startsAt: at(11, "00:00"), endsAt: at(13, "00:00"), allDay: true },
    { id: 11, title: "Elterngespräch", description: "", location: "Schule", startsAt: at(-2, "17:00"), endsAt: at(-2, "17:45"), allDay: false },
  ];

  const note = (id: number, title: string, plain: string, folder: string, pinned: boolean, minutesAgo: number): Note => ({
    id,
    title,
    plain,
    content: plain
      .split("\n")
      .map((line) => `<p>${line}</p>`)
      .join(""),
    folder,
    pinned,
    createdAt: ago(minutesAgo + 60 * 24 * 6),
    updatedAt: ago(minutesAgo),
  });

  const notes: Note[] = [
    note(1, "Lernplan Prüfungswoche", "Montag: Weltgeschehen, Lernziele 1–4\nDienstag: Dossier lösen und kontrollieren\nMittwoch: Zusammenfassung schreiben\nDonnerstag: Fragen aus alten Prüfungen\nFreitag: Ausruhen, kurz wiederholen", "Schule", true, 35),
    note(2, "Ideen für die App", "Widget mit den heutigen Aufgaben.\nErinnerungen vor Terminen.\nAufgaben per Sprache anlegen.\nKalender nach Farben der Buckets einfärben.", "Ideen", true, 190),
    note(3, "Gesprächsfragen BIZ", "Welche Lehrstellen gibt es im Bereich Informatik?\nWie läuft die Bewerbung ab?\nWelche Weiterbildungen sind danach möglich?", "Schule", false, 60 * 26),
    note(4, "Wochenplanung", "Dienstag Angebot Müller fertig, Mittwoch Sprint-Review, Donnerstag Zahnarzt. Am Freitag früher Schluss und Einkauf fürs Wochenende nicht vergessen.", "", false, 60 * 30),
    note(5, "Rezept: Spaghetti Carbonara", "Zutaten für 2 Personen:\n200 g Spaghetti\n100 g Speck\n2 Eier\n50 g Parmesan\nPfeffer\nSpeck knusprig braten, Eier mit Käse verrühren, alles mit der heissen Pasta vermengen.", "Rezepte", false, 60 * 24 * 4),
    note(6, "Sitzungsnotizen Teamsitzung", "Angebot Müller bis Dienstag.\nSprint-Review auf Mittwoch verschoben.\nNeue Aufgabenverteilung ab nächster Woche.", "Arbeit", false, 60 * 24 * 2),
    note(7, "Bücher zum Lesen", "Sapiens\nDas Café am Rande der Welt\nDeep Work\nDer Alchimist", "Ideen", false, 60 * 24 * 9),
    note(8, "Packliste Zürich", "Ladegerät\nKopfhörer\nRegenjacke\nGutscheine für den Zoo\nTicket ausdrucken", "", false, 60 * 24 * 12),
  ];

  return { profile: { firstName: "Armin", lastName: "Durmisi" }, buckets, tasks, events, notes };
}
