import { Channel, invoke } from "@tauri-apps/api/core";
import { formatLongDay, toDateTimeStr } from "../dates";
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

export interface AssistantAnswer {
  text: string;
  /** Was der Assistent nachgeschlagen hat */
  steps: string[];
  /** Gelesene Seiten und Notizen */
  sources: AssistantSource[];
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
