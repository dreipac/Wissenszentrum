// Reine Beispieldaten für das Layout – keine Persistenz.

export interface Note {
  id: string;
  title: string;
  preview: string;
  folder: string;
  updated: string;
  pinned?: boolean;
}

export const notes: Note[] = [
  { id: "n1", title: "Projektidee: Wissenszentrum", preview: "Zentrale Stelle für Aufgaben, Notizen, Kalender und Dokumentation …", folder: "Ideen", updated: "Vor 10 Min.", pinned: true },
  { id: "n2", title: "Meeting-Notizen 14.10.", preview: "Teilnehmer: Armin, Marco, Sandra. Themen: Roadmap Q4, Budget …", folder: "Meetings", updated: "Heute, 09:12" },
  { id: "n3", title: "Server-Zugänge & Hinweise", preview: "Alle Zugänge liegen im Passwortmanager. Wichtig: VPN vorher aktivieren …", folder: "IT", updated: "Gestern" },
  { id: "n4", title: "Lernplan Rust & Tauri", preview: "Woche 1: Grundlagen Ownership. Woche 2: Tauri Commands und State …", folder: "Lernen", updated: "Gestern" },
  { id: "n5", title: "Einkaufsliste Büro", preview: "Kaffee, Notizblöcke, HDMI-Kabel, Whiteboard-Marker …", folder: "Privat", updated: "12. Okt" },
  { id: "n6", title: "Ideen für Dashboard-Widgets", preview: "Wetter, offene Aufgaben, nächste Termine, Schnellnotiz …", folder: "Ideen", updated: "10. Okt" },
  { id: "n7", title: "Kundenfeedback Oktober", preview: "Positiv: Reaktionszeit. Verbesserbar: Dokumentation der Schnittstellen …", folder: "Meetings", updated: "8. Okt" },
];

export interface DocNode {
  id: string;
  title: string;
  children?: DocNode[];
}

export const docTree: DocNode[] = [
  {
    id: "d1",
    title: "Unternehmen",
    children: [
      { id: "d1a", title: "Organisation & Rollen" },
      { id: "d1b", title: "Prozesse" },
      { id: "d1c", title: "Richtlinien" },
    ],
  },
  {
    id: "d2",
    title: "IT-Infrastruktur",
    children: [
      { id: "d2a", title: "Netzwerk-Übersicht" },
      { id: "d2b", title: "Server & Dienste" },
      { id: "d2c", title: "Backup & Wiederherstellung" },
    ],
  },
  {
    id: "d3",
    title: "Projekte",
    children: [
      { id: "d3a", title: "Wissenszentrum" },
      { id: "d3b", title: "Website-Relaunch" },
    ],
  },
  { id: "d4", title: "Vorlagen" },
  { id: "d5", title: "Onboarding" },
];
