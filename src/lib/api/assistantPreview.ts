import type { AssistantAnswer, ChatTurn } from "./assistant";

// Nur für den Browser-Preview (npm run dev ohne Tauri-Fenster): feste Beispielantworten statt einer echten KI.

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const TODAY: AssistantAnswer = {
  steps: ["Aufgaben gelesen", "Termine gelesen"],
  text: "Heute sind zwei Aufgaben fällig und ein Termin steht an.\n\n- **Angebot überarbeiten** ist überfällig\n- **Wochenbericht schreiben** ist heute fällig\n- Um 14:00 Uhr: Abstimmung mit dem Team",
  sources: [],
};

const FALLBACK: AssistantAnswer = {
  steps: ["Daten durchsucht"],
  text: "Das ist die Vorschau im Browser. Im Programm antwortet hier der Assistent mit deinen echten Daten.",
  sources: [],
};

export async function previewAnswer(history: ChatTurn[], onStep: (step: string) => void): Promise<AssistantAnswer> {
  const last = history[history.length - 1]?.text ?? "";
  const answer = /heute|fällig|überfällig/i.test(last) ? TODAY : FALLBACK;
  for (const step of answer.steps) {
    await wait(450);
    onStep(step);
  }
  await wait(500);
  return answer;
}
