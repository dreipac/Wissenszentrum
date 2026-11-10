import { router, type Href } from "expo-router";
import { useStore } from "@/data/store";

/** Öffnet einen Bildschirm per Pfad, zum Beispiel "/tasks/3". */
export const open = (href: string) => router.push(href as Href);

/** Wechselt zu einem Tab, zum Beispiel "/tasks". */
export const goTo = (href: string) => router.navigate(href as Href);

/** Legt eine leere Notiz an (optional in einem Ordner) und öffnet sie zum Schreiben. */
export function newNote(folder = "") {
  const id = useStore.getState().createNote(folder);
  open(`/notes/${id}`);
}
