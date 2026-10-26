import { addDays, startOfDay, toDateStr, toDateTimeStr } from "../dates";
import { listEvents } from "./events";
import type { AssistantAnswer, ChatTurn } from "./assistant";

// Nur für den Browser-Preview (npm run dev ohne Tauri-Fenster): feste Beispielantworten statt einer echten KI.

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const TODAY: AssistantAnswer = {
  steps: ["Aufgaben gelesen", "Termine gelesen"],
  text: "Heute sind zwei Aufgaben fällig und ein Termin steht an.\n\n- **Angebot überarbeiten** ist überfällig\n- **Wochenbericht schreiben** ist heute fällig\n- Um 14:00 Uhr: Abstimmung mit dem Team",
  sources: [],
  proposals: [],
  deletions: [],
};

const FALLBACK: AssistantAnswer = {
  steps: ["Daten durchsucht"],
  text: "Das ist die Vorschau im Browser. Im Programm antwortet hier der Assistent mit deinen echten Daten.",
  sources: [],
  proposals: [],
  deletions: [],
};

const PROPOSE = (): AssistantAnswer => {
  const day = toDateStr(addDays(startOfDay(new Date()), 1));
  return {
    steps: ["Termine gelesen", "Termin vorgeschlagen"],
    text: "Ich habe dir einen Termin für morgen vorbereitet. Er wird erst eingetragen, wenn du ihn bestätigst.",
    sources: [],
    proposals: [
      {
        title: "Abstimmung mit dem Team",
        description: "Stand der Dokumentation und offene Aufgaben durchgehen.",
        location: "Besprechungsraum 2",
        startsAt: `${day} 10:00`,
        endsAt: `${day} 11:00`,
        allDay: false,
        conflicts: ["Team-Meeting (09:30–10:30)"],
      },
    ],
    deletions: [],
  };
};

/** Löschvorschlag für den nächsten Termin, den es in der Vorschau gibt. */
const DELETE = async (): Promise<AssistantAnswer> => {
  const today = startOfDay(new Date());
  const [event] = await listEvents(toDateTimeStr(today), toDateTimeStr(addDays(today, 14)));
  if (!event) return { ...FALLBACK, text: "Ich finde in den nächsten Tagen keinen Termin, den ich löschen könnte." };
  return {
    steps: ["Termine gelesen", "Löschen vorgeschlagen"],
    text: `Ich habe „${event.title}“ zum Löschen vorbereitet. Gelöscht wird er erst, wenn du bestätigst.`,
    sources: [],
    proposals: [],
    deletions: [
      {
        id: event.id,
        title: event.title,
        location: event.location,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        linkedTasks: event.prepTotal + event.followTotal,
      },
    ],
  };
};

export async function previewAnswer(history: ChatTurn[], onStep: (step: string) => void): Promise<AssistantAnswer> {
  const last = history[history.length - 1]?.text ?? "";
  const answer = /lösch|entfern/i.test(last)
    ? await DELETE()
    : /trag|eintrag|termin.*(anlegen|erstell)/i.test(last)
      ? PROPOSE()
      : /heute|fällig|überfällig/i.test(last)
        ? TODAY
        : FALLBACK;
  for (const step of answer.steps) {
    await wait(450);
    onStep(step);
  }
  await wait(500);
  return answer;
}
