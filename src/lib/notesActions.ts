import { createNote } from "./api/notes";
import { emptyNote } from "./notes";
import { requestOpenNote } from "./notesNav";
import type { ViewId } from "./navigation";

/** Legt eine leere Notiz an und öffnet sie in der Notizen-Ansicht. */
export async function createAndOpenNote(navigate: (view: ViewId) => void, folder = ""): Promise<void> {
  const note = await createNote(emptyNote(folder));
  requestOpenNote(note.id);
  navigate("notes");
}
