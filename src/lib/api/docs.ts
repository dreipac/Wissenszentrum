import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type { DocNodeSpec, EditOp } from "../docBlocks";
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

/** Legt Ordner und Seiten samt Inhalt in einem Zug an (ganz oder gar nicht) und liefert die Nummern der obersten Einträge. */
export const createDocTree = (parentId: number | null, nodes: DocNodeSpec[]): Promise<number[]> =>
  changed(inTauri ? invoke("create_doc_tree", { parentId, nodes }) : docsStore.createTree(parentId, nodes));

/** Setzt eine bestätigte Änderung des Assistenten um. Die Seite darf sich seit dem Vorschlag nicht geändert haben. */
export const applyDocEdit = (id: number, baseUpdatedAt: string, newTitle: string | null, ops: EditOp[]): Promise<DocPage> =>
  changed(inTauri ? invoke("apply_doc_edit", { id, baseUpdatedAt, newTitle, ops }) : docsStore.applyEdit(id, baseUpdatedAt, newTitle, ops));

export const updateDocPage = (id: number, input: DocInput): Promise<DocPage> =>
  changed(inTauri ? invoke("update_doc_page", { id, input }) : docsStore.update(id, input));

export const setDocFavorite = (id: number, favorite: boolean): Promise<void> =>
  changed(inTauri ? invoke("set_doc_favorite", { id, favorite }) : docsStore.setFavorite(id, favorite));

export const moveDocPage = (id: number, parentId: number | null): Promise<void> =>
  changed(inTauri ? invoke("move_doc_page", { id, parentId }) : docsStore.move(id, parentId));

/** Setzt eine Seite unter einen Elternteil (null = Hauptebene) an die Stelle `index` unter dessen Seiten. */
export const placeDocPage = (id: number, parentId: number | null, index: number): Promise<void> =>
  changed(inTauri ? invoke("place_doc_page", { id, parentId, index }) : docsStore.place(id, parentId, index));

export const shiftDocPage = (id: number, delta: -1 | 1): Promise<void> =>
  changed(inTauri ? invoke("shift_doc_page", { id, delta }) : docsStore.shift(id, delta));

/** Löscht die Seite samt Unterseiten und liefert die Zahl der entfernten Seiten. */
export const deleteDocPage = (id: number): Promise<number> =>
  changed(inTauri ? invoke("delete_doc_page", { id }) : docsStore.remove(id));
