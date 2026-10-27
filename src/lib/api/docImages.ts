import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./runtime";

// Browser-Preview ohne Tauri: Bilder liegen nur im Speicher.
const preview = new Map<number, Blob>();
let nextPreviewId = 1;

/** Speichert ein Bild in der Datenbank und liefert seine ID. */
export async function addDocImage(blob: Blob, mime: string): Promise<number> {
  if (inTauri) {
    // Rohe Bytes statt JSON: bei großen Bildern deutlich schneller
    return invoke<number>("add_doc_image", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-mime": mime } });
  }
  const id = nextPreviewId++;
  preview.set(id, blob);
  return id;
}

/** Die Bytes eines Bildes (für den Export). */
export async function loadBlob(id: number): Promise<Blob> {
  if (inTauri) return new Blob([await invoke<ArrayBuffer>("get_doc_image", { id })]);
  const blob = preview.get(id);
  if (!blob) throw "Bild nicht gefunden.";
  return blob;
}

const urls = new Map<number, Promise<string>>();

/** Adresse, unter der das Bild angezeigt werden kann (wird je Bild nur einmal geladen). */
export function docImageUrl(id: number): Promise<string> {
  let url = urls.get(id);
  if (!url) {
    url = loadBlob(id).then((blob) => URL.createObjectURL(blob));
    urls.set(id, url);
    url.catch(() => urls.delete(id));
  }
  return url;
}
