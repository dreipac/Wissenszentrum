import type { Editor } from "@tiptap/react";
import { addAttachment } from "./api/attachments";

/**
 * Speichert Dateien als Anhänge und fügt sie als Karten in den Text ein: an der Stelle `pos` (z. B. wo sie abgelegt
 * wurden) oder am Cursor. Liefert die erste Fehlermeldung oder null.
 */
export async function attachFiles(editor: Editor, files: File[], pos?: number): Promise<string | null> {
  let error: string | null = null;
  let at = pos;
  for (const file of files) {
    try {
      const info = await addAttachment(file);
      const node = { type: "fileAttachment", attrs: { fileId: info.id, name: info.name, size: info.size, mime: info.mime } };
      if (at !== undefined) {
        editor.chain().focus().insertContentAt(at, node).run();
        // Mehrere Dateien nacheinander: jede hinter die vorige
        at += 1;
      } else {
        editor.chain().focus().insertContent(node).run();
      }
    } catch (e) {
      error ??= `${file.name}: ${String(e)}`;
    }
  }
  return error;
}

/** Alle Dateien einer Dateiliste (Zwischenablage, Drag & Drop), die keine Bilder sind. */
export const otherFiles = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((f) => !f.type.startsWith("image/"));
