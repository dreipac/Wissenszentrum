import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type { DocInput, DocKind, DocPage } from "../docs";
import { docsStore } from "./docsPreview";
import { inTauri } from "./runtime";

export const listDocPages = (): Promise<DocPage[]> => (inTauri ? invoke("list_doc_pages") : docsStore.list());

/** Nach jeder Änderung werden alle Dokumentations-Ansichten benachrichtigt. */
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("docs");
  return value;
}

export const createDocPage = (parentId: number | null, title: string, kind: DocKind): Promise<DocPage> =>
  changed(inTauri ? invoke("create_doc_page", { parentId, title, kind }) : docsStore.create(parentId, title, kind));

export const updateDocPage = (id: number, input: DocInput): Promise<DocPage> =>
  changed(inTauri ? invoke("update_doc_page", { id, input }) : docsStore.update(id, input));

export const setDocFavorite = (id: number, favorite: boolean): Promise<void> =>
  changed(inTauri ? invoke("set_doc_favorite", { id, favorite }) : docsStore.setFavorite(id, favorite));

export const moveDocPage = (id: number, parentId: number | null): Promise<void> =>
  changed(inTauri ? invoke("move_doc_page", { id, parentId }) : docsStore.move(id, parentId));

export const shiftDocPage = (id: number, delta: -1 | 1): Promise<void> =>
  changed(inTauri ? invoke("shift_doc_page", { id, delta }) : docsStore.shift(id, delta));

/** Löscht die Seite samt Unterseiten und liefert die Zahl der entfernten Seiten. */
export const deleteDocPage = (id: number): Promise<number> =>
  changed(inTauri ? invoke("delete_doc_page", { id }) : docsStore.remove(id));
