import { Channel, invoke } from "@tauri-apps/api/core";
import { formatLongDay, toDateTimeStr } from "../dates";
import type { DocNodeSpec, DocStats } from "../docBlocks";
import { previewAnswer } from "./assistantPreview";
import { inTauri } from "./runtime";

/** Wählbare Modelle, in der Reihenfolge von günstig nach gründlich. Die Kennungen stehen auch im Backend. */
export const ASSISTANT_MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Am günstigsten und schnell. Reicht für die meisten Fragen." },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Ausgewogen. Genauer bei langen Seiten und Zusammenhängen." },
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Am gründlichsten, etwa doppelt so teuer wie Sonnet." },
] as const;

export const DEFAULT_ASSISTANT_MODEL: string = ASSISTANT_MODELS[0].id;

export const modelLabel = (id: string) => ASSISTANT_MODELS.find((m) => m.id === id)?.label ?? id;

export interface AssistantStatus {
  /** Ein API-Key ist auf diesem Rechner hinterlegt */
  hasKey: boolean;
  model: string;
}

export interface AssistantSource {
  kind: "doc" | "note";
  id: number;
  title: string;
}

/** Termin, den der Assistent vorschlägt. Eingetragen wird er erst nach Bestätigung durch die Person. */
export interface EventProposal {
  title: string;
  description: string;
  location: string;
  /** YYYY-MM-DD HH:MM */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Bestehende Termine, die sich mit dem Vorschlag überschneiden */
  conflicts: string[];
}

/** Termin, dessen Löschen der Assistent vorschlägt. Gelöscht wird er erst nach Bestätigung durch die Person. */
export interface EventDeletion {
  id: number;
  title: string;
  location: string;
  /** YYYY-MM-DD HH:MM */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /** Aufgaben, die an dem Termin hängen (sie bleiben beim Löschen bestehen) */
  linkedTasks: number;
}

/** Aufgabe, die der Assistent vorschlägt. Angelegt wird sie erst nach Bestätigung durch die Person. */
export interface TaskProposal {
  title: string;
  description: string;
  /** "high", "medium" oder "low" */
  priority: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  bucketId: number | null;
  bucketName: string | null;
  subtasks: string[];
}

export interface BucketOption {
  id: number;
  name: string;
  /** Farbschlüssel, leer = keine Farbe */
  color: string;
  openTasks: number;
}

/** Auswahl des Buckets für eine neue Aufgabe: die Person klickt einen Bucket in der Karte an. */
export interface BucketChoice {
  taskTitle: string;
  buckets: BucketOption[];
}

/** Eine Zeile einer vorgeschlagenen Änderung: was bisher galt und was gelten soll. */
export interface ActionChange {
  label: string;
  before: string | null;
  after: string | null;
}

/** Vorschlag, etwas Bestehendes zu ändern, abzuhaken oder zu löschen. Ausgeführt wird er erst nach Bestätigung. */
export interface AssistantAction {
  kind: "task_done" | "task_reopen" | "task_delete" | "task_update" | "event_update";
  id: number;
  title: string;
  bucket: string | null;
  dueDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  changes: ActionChange[];
  /** Bei Änderungen der vollständige neue Stand zum Speichern (TaskInput bzw. EventInput) */
  input: unknown;
}

/** Vorschlag für neue Ordner und Seiten der Dokumentation. Angelegt wird er erst nach Bestätigung durch die Person. */
export interface DocProposal {
  /** Zielordner oder -seite, null = Hauptebene */
  parentId: number | null;
  /** Pfad des Ziels zur Anzeige */
  parentPath: string;
  nodes: DocNodeSpec[];
  stats: DocStats;
  /** Oberste Einträge, deren Titel es dort schon gibt */
  existing: string[];
}

export interface AssistantAnswer {
  text: string;
  /** Was der Assistent nachgeschlagen hat */
  steps: string[];
  /** Gelesene Seiten und Notizen */
  sources: AssistantSource[];
  /** Vorgeschlagene Termine: noch nicht eingetragen */
  proposals: EventProposal[];
  /** Termine, deren Löschen vorgeschlagen wird: noch nicht gelöscht */
  deletions: EventDeletion[];
  /** Vorgeschlagene Aufgaben: noch nicht angelegt */
  tasks: TaskProposal[];
  /** Bucket-Auswahl, bevor eine Aufgabe vorgeschlagen wird */
  choices: BucketChoice[];
  /** Vorgeschlagene Änderungen an Bestehendem: noch nicht ausgeführt */
  actions: AssistantAction[];
  /** Vorgeschlagene Ordner und Seiten für die Dokumentation: noch nicht angelegt */
  docs: DocProposal[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** Ereignis, mit dem die Einstellungen das Panel auffordern, den Zustand neu zu laden. */
export const ASSISTANT_CHANGED_EVENT = "wz-assistant-changed";

const announce = () => window.dispatchEvent(new Event(ASSISTANT_CHANGED_EVENT));

// Im Browser-Preview gibt es kein Backend: Der Zustand liegt im Speicher, Antworten sind feste Beispiele.
let previewModel: string = DEFAULT_ASSISTANT_MODEL;

export const assistantStatus = (): Promise<AssistantStatus> =>
  inTauri ? invoke("assistant_status") : Promise.resolve({ hasKey: true, model: previewModel });

/** Prüft den Key mit einer kostenlosen Abfrage und legt ihn im Windows-Schlüsselspeicher ab (leer = entfernen). */
export async function saveAssistantKey(apiKey: string): Promise<void> {
  if (inTauri) await invoke("save_assistant_key", { apiKey });
  announce();
}

export async function setAssistantModel(model: string): Promise<void> {
  if (inTauri) await invoke("set_assistant_model", { model });
  else previewModel = model;
  announce();
}

/**
 * Stellt dem Assistenten die Frage (mit dem bisherigen Verlauf). `onStep` meldet laufend, was er gerade nachschlägt.
 * Die Antwort kommt als Ganzes, wenn er fertig ist.
 */
export function askAssistant(history: ChatTurn[], onStep: (step: string) => void): Promise<AssistantAnswer> {
  if (!inTauri) return previewAnswer(history, onStep);
  const now = new Date();
  const stamp = toDateTimeStr(now);
  const channel = new Channel<string>();
  channel.onmessage = onStep;
  return invoke("assistant_ask", {
    history,
    today: stamp.slice(0, 10),
    nowLabel: `${formatLongDay(now)}, ${stamp.slice(11)} Uhr`,
    onStep: channel,
  });
}
