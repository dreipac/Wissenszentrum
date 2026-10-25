import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { inTauri } from "./runtime";

/** Größte erlaubte Datei (passt zur Grenze im Backend) */
export const MAX_ATTACHMENT_BYTES = 25_000_000;

export interface Attachment {
  id: number;
  name: string;
  mime: string;
  size: number;
}

// Browser-Preview ohne Tauri: Dateien liegen nur im Speicher.
const preview = new Map<number, File>();
let nextPreviewId = 1;

/** Speichert eine Datei in der Datenbank. */
export async function addAttachment(file: File): Promise<Attachment> {
  if (file.size === 0) throw "Die Datei ist leer.";
  if (file.size > MAX_ATTACHMENT_BYTES) throw "Die Datei ist zu groß (höchstens 25 MB).";
  const mime = file.type || "application/octet-stream";
  if (inTauri) {
    // Rohe Bytes; der Name wandert prozentkodiert in der Kopfzeile (Kopfzeilen sind nur ASCII)
    return invoke<Attachment>("add_attachment", new Uint8Array(await file.arrayBuffer()), {
      headers: { "x-name": encodeURIComponent(file.name), "x-mime": mime },
    });
  }
  const id = nextPreviewId++;
  preview.set(id, file);
  return { id, name: file.name, mime, size: file.size };
}

/** Öffnet die Datei mit dem Standardprogramm. */
export async function openAttachment(id: number): Promise<void> {
  if (inTauri) return invoke("open_attachment", { id });
  const file = preview.get(id);
  if (!file) throw "Datei nicht gefunden.";
  window.open(URL.createObjectURL(file), "_blank");
}

/**
 * Meldet, wenn ein Anhang nach dem Bearbeiten im anderen Programm (z. B. Word) neu in die Datenbank übernommen wurde.
 * Gibt die Funktion zum Abmelden zurück.
 */
export function onAttachmentChanged(handler: (info: Attachment) => void): () => void {
  if (!inTauri) return () => {};
  const unlisten = listen<Attachment>("attachment-changed", (e) => handler(e.payload));
  return () => void unlisten.then((off) => off());
}

/** „Speichern unter“: fragt nach dem Ort und schreibt die Datei dorthin; false, wenn abgebrochen. */
export async function saveAttachmentAs(id: number, name: string): Promise<boolean> {
  if (inTauri) {
    const path = await save({ defaultPath: name, title: "Datei speichern unter" });
    if (!path) return false;
    await invoke("save_attachment", { id, path });
    return true;
  }
  const file = preview.get(id);
  if (!file) throw "Datei nicht gefunden.";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  return true;
}
