import { ancestors, pageTitle, type DocPage } from "./docs";

/** Projekt des Assistenten: ein fester Kontext aus der Dokumentation für seine Gespräche. */
export interface Project {
  id: number;
  name: string;
  /** Ordner oder Seite der Dokumentation, die als Kontext gilt (null = keine, oder die Seite wurde gelöscht) */
  docId: number | null;
  /** Hinweise an den Assistenten für dieses Projekt */
  instructions: string;
}

export type ProjectInput = Omit<Project, "id">;

/** Pfad einer Seite für die Anzeige, z. B. „Studium › Studienplanung“. */
export function docPath(pages: DocPage[], id: number | null): string {
  const page = pages.find((p) => p.id === id);
  if (!page) return "";
  return [...ancestors(pages, page.id), page].map(pageTitle).join(" › ");
}
