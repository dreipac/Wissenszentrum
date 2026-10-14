// Reine Beispieldaten für das Layout – keine Persistenz.

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
