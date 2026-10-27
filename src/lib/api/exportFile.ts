import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { inTauri } from "./runtime";

/** Dateiname ohne Zeichen, die Windows nicht mag. */
export const safeFileName = (title: string, fallback = "Dokumentation") => {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80);
  return name || fallback;
};

const DOCX_FILTER = [{ name: "Word-Dokument", extensions: ["docx"] }];

/**
 * Fragt, wo die Word-Datei hin soll, baut sie erst danach und schreibt sie. Liefert den Ort oder null, wenn die Person
 * abgebrochen hat. Im Browser-Preview ohne Tauri wird die Datei heruntergeladen.
 */
export async function saveDocx(fileName: string, build: () => Promise<Uint8Array>): Promise<string | null> {
  if (inTauri) {
    const path = await save({ defaultPath: `${fileName}.docx`, title: "Als Word-Dokument speichern", filters: DOCX_FILTER });
    if (!path) return null;
    const bytes = await build();
    // Rohe Bytes; der Ort wandert prozentkodiert in der Kopfzeile (Kopfzeilen sind nur ASCII)
    await invoke("write_export_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
    return path;
  }
  const bytes = await build();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName}.docx`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return `${fileName}.docx`;
}
