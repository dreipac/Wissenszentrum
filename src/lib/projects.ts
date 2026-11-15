import { ancestors, pageTitle, type DocPage } from "./docs";

/** Eine Datei, die ein Projekt als festen Kontext trägt. Sie liegt als Anhang in der Datenbank. */
export interface ProjectFile {
  fileId: number;
  name: string;
  mime: string;
  size: number;
}

/** Projekt des Assistenten: ein fester Kontext aus der Dokumentation für seine Gespräche. */
export interface Project {
  id: number;
  name: string;
  /** Ordner oder Seite der Dokumentation, die als Kontext gilt (null = keine, oder die Seite wurde gelöscht) */
  docId: number | null;
  /** Hinweise an den Assistenten für dieses Projekt */
  instructions: string;
  /** Feste Unterlagen: Dateien, die der Assistent in jedem Chat des Projekts kennt und bei Bedarf liest */
  files: ProjectFile[];
}

/** Angaben zum Anlegen und Ändern; die Dateien werden einzeln hinzugefügt und entfernt. */
export type ProjectInput = Omit<Project, "id" | "files">;

/** So viele Dateien kann ein Projekt tragen (passt zum Backend). */
export const MAX_PROJECT_FILES = 20;

/** Pfad einer Seite für die Anzeige, z. B. „Studium › Studienplanung“. */
export function docPath(pages: DocPage[], id: number | null): string {
  const page = pages.find((p) => p.id === id);
  if (!page) return "";
  return [...ancestors(pages, page.id), page].map(pageTitle).join(" › ");
}
