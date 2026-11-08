import { Channel, invoke } from "@tauri-apps/api/core";
import { formatLongDay, toDateTimeStr } from "../dates";
import type { DocNodeSpec, DocStats, EditLine, EditOp, EditStats } from "../docBlocks";
import { previewAnswer, previewPlanned } from "./assistantPreview";
import { inTauri } from "./runtime";

/** Wählbare Betriebsarten. „Auto“ entscheidet pro Nachricht; die Kennungen der Modelle stehen auch im Backend. */
export const ASSISTANT_MODELS = [
  {
    id: "auto",
    label: "Auto",
    hint: "Empfohlen. Haiku beantwortet einfache Fragen günstig, Sonnet übernimmt Aufträge wie Lösen, Schreiben und Seiten aufbauen. Kommt Haiku mit den Werkzeugen nicht zurecht, wiederholt die App die Frage selbst mit Sonnet.",
  },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", hint: "Immer das günstigste Modell, etwa 20-mal günstiger als Sonnet. Reicht für die meisten Fragen." },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Immer Sonnet: genauer bei langen Seiten und Zusammenhängen, dafür deutlich teurer." },
] as const;

export const DEFAULT_ASSISTANT_MODEL: string = ASSISTANT_MODELS[0].id;

export const modelLabel = (id: string) => ASSISTANT_MODELS.find((m) => m.id === id)?.label ?? id;

export interface AssistantStatus {
  /** Ein API-Key ist auf diesem Rechner hinterlegt */
  hasKey: boolean;
  /** Wechselkurs für die Anzeige in Franken */
  usdChf: number;
  /** Kostenlimit je Antwort in Franken, 0 = keines */
  costLimitChf: number;
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

/** Vorschlag, eine bestehende Seite der Dokumentation zu ändern. Übernommen wird er erst nach Bestätigung durch die Person. */
export interface DocEdit {
  pageId: number;
  title: string;
  newTitle: string | null;
  /** Ordner, in dem die Seite liegt */
  path: string;
  /** Stand der Seite beim Vorschlag: ändert sie sich bis zur Bestätigung, wird nichts übernommen */
  baseUpdatedAt: string;
  ops: EditOp[];
  /** Die Seite nach der Änderung, Abschnitt für Abschnitt, mit Kennzeichnung von Neuem und Entfallendem */
  lines: EditLine[];
  stats: EditStats;
}

/** Ein Schritt im Arbeitsplan des Assistenten bei größeren Aufträgen. */
export interface PlanItem {
  title: string;
  status: "pending" | "in_progress" | "done";
}

/** Was der Assistent während der Arbeit meldet: einen erledigten Schritt oder den aktuellen Stand seines Plans. */
type Progress = { kind: "step"; text: string } | { kind: "plan"; items: PlanItem[] };

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
  /** Vorgeschlagene Änderungen an bestehenden Seiten der Dokumentation: noch nicht übernommen */
  docEdits: DocEdit[];
  /** Verbrauch dieser Antwort, alle Runden zusammen */
  usage?: TokenUsage;
  /** Arbeitsplan am Ende, leer bei einfachen Fragen */
  plan?: PlanItem[];
  /** Das Modell, das geantwortet hat */
  model?: string;
}

/** Eine Datei, die die Person an ihre Nachricht gehängt hat. Sie liegt schon als Anhang in der Datenbank; das Backend liest sie über die id. */
export interface ChatFile {
  id: number;
  name: string;
  mime: string;
  size: number;
}

/** Verbrauch des Assistenten seit dem Start der App, nach den Angaben der API zu jeder Antwort. */
export interface TokenUsage {
  requests: number;
  /** Eingabe ohne Zwischenspeicher (voller Preis) */
  inputTokens: number;
  /** In den Zwischenspeicher geschrieben (etwas teurer) */
  cacheWriteTokens: number;
  /** Aus dem Zwischenspeicher gelesen (deutlich günstiger) */
  cacheReadTokens: number;
  outputTokens: number;
  /** Geschätzte Kosten in US-Dollar nach der Preisliste von Anthropic */
  costUsd: number;
}

export interface AssistantUsage extends TokenUsage {
  /** Anteil der Eingabe aus dem Zwischenspeicher (0 bis 1), null ohne Anfragen */
  hitRate: number | null;
  /** Ein Modell hat den Zwischenspeicher abgelehnt */
  cacheOff: boolean;
  /** Ein Modell hat die Aufwandsstufe abgelehnt */
  effortOff: boolean;
}

const NO_USAGE: AssistantUsage = { requests: 0, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0, hitRate: null, cacheOff: false, effortOff: false };

export const assistantUsage = (): Promise<AssistantUsage> => (inTauri ? invoke("assistant_usage") : Promise.resolve(NO_USAGE));

export const resetAssistantUsage = async (): Promise<void> => {
  if (inTauri) await invoke("reset_assistant_usage");
};

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  files?: ChatFile[];
  /** Bei Antworten: welches Modell geantwortet hat (bei „Auto“ bleibt eine Sonnet-Arbeit bei Sonnet) */
  model?: string;
}

/** So viele Dateien darf eine Nachricht tragen (passt zum Backend) */
export const MAX_CHAT_FILES = 5;

/** Ereignis, mit dem die Einstellungen das Panel auffordern, den Zustand neu zu laden. */
export const ASSISTANT_CHANGED_EVENT = "wz-assistant-changed";

const announce = () => window.dispatchEvent(new Event(ASSISTANT_CHANGED_EVENT));

// Im Browser-Preview gibt es kein Backend: Der Zustand liegt im Speicher, Antworten sind feste Beispiele.
let previewModel: string = DEFAULT_ASSISTANT_MODEL;

export const assistantStatus = (): Promise<AssistantStatus> =>
  inTauri ? invoke("assistant_status") : Promise.resolve({ hasKey: true, model: previewModel, usdChf: 0.8, costLimitChf: 1 });

/** Prüft den Key mit einer kostenlosen Abfrage und legt ihn im Windows-Schlüsselspeicher ab (leer = entfernen). */
export async function saveAssistantKey(apiKey: string): Promise<void> {
  if (inTauri) await invoke("save_assistant_key", { apiKey });
  announce();
}

/** Kostenlimit je Antwort in Franken (0 = keines) und Wechselkurs für die Anzeige. */
export async function setAssistantLimits(costLimitChf: number, usdChf: number): Promise<void> {
  if (inTauri) await invoke("set_assistant_limits", { costLimitChf, usdChf });
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
export function askAssistant(history: ChatTurn[], projectId: number | null, onStep: (step: string) => void, onPlan: (items: PlanItem[]) => void = () => {}): Promise<AssistantAnswer> {
  // Beispielwerte nur für die Vorschau im Browser
  if (!inTauri) {
    const last = [...history].reverse().find((m) => m.role === "user")?.text ?? "";
    if (/dossier|plan|struktur/i.test(last)) return previewPlanned(onStep, onPlan);
  }
  if (!inTauri) return previewAnswer(history, onStep).then((answer) => ({ ...answer, model: "claude-haiku-5-5", usage: { requests: 1, inputTokens: 8, cacheWriteTokens: 840, cacheReadTokens: 9329, outputTokens: 142, costUsd: 0.0021 } }));
  const now = new Date();
  const stamp = toDateTimeStr(now);
  const channel = new Channel<Progress>();
  channel.onmessage = (event) => (event.kind === "plan" ? onPlan(event.items) : onStep(event.text));
  return invoke("assistant_ask", {
    history,
    today: stamp.slice(0, 10),
    // Das Datum steht im Systemtext, die Uhrzeit holt sich der Assistent nur bei Bedarf (so bleibt der Zwischenspeicher gültig)
    nowLabel: formatLongDay(now),
    time: stamp.slice(11),
    projectId,
    onStep: channel,
  });
}

/** Bricht die laufende Arbeit ab: nach der laufenden Anfrage kommt, was bis dahin entstanden ist. */
export const cancelAssistant = async (): Promise<void> => {
  if (inTauri) await invoke("assistant_cancel");
};
