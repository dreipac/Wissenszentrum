import { addDays, startOfDay, toDateStr, toDateTimeStr } from "../dates";
import { listEvents } from "./events";
import { listBuckets, listTasks } from "./tasks";
import type { AssistantAnswer, ChatTurn } from "./assistant";

// Nur für den Browser-Preview (npm run dev ohne Tauri-Fenster): feste Beispielantworten statt einer echten KI.

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const TODAY: AssistantAnswer = {
  steps: ["Aufgaben gelesen", "Termine gelesen"],
  text: "Heute sind zwei Aufgaben fällig und ein Termin steht an.\n\n- **Angebot überarbeiten** ist überfällig\n- **Wochenbericht schreiben** ist heute fällig\n- Um 14:00 Uhr: Abstimmung mit dem Team",
  sources: [],
  proposals: [],
  deletions: [],
  tasks: [],
  choices: [],
  docs: [],
  actions: [],
};

const FALLBACK: AssistantAnswer = {
  steps: ["Daten durchsucht"],
  text: "Das ist die Vorschau im Browser. Im Programm antwortet hier der Assistent mit deinen echten Daten.",
  sources: [],
  proposals: [],
  deletions: [],
  tasks: [],
  choices: [],
  docs: [],
  actions: [],
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
    tasks: [],
    choices: [],
  docs: [],
  actions: [],
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
    tasks: [],
    choices: [],
  docs: [],
  actions: [],
  };
};

const fmt = (dt: string) => `${dt.slice(8, 10)}.${dt.slice(5, 7)}.${dt.slice(0, 4)}`;

/** Vorschläge für Änderungen an Bestehendem, passend zu dem, was die Person schreibt. */
const CHANGE = async (last: string): Promise<AssistantAnswer> => {
  const empty = { sources: [], proposals: [], deletions: [], tasks: [], choices: [], docs: [] };
  const base = { bucket: null, dueDate: null, startsAt: null, endsAt: null, allDay: false, changes: [], input: null };
  const today = startOfDay(new Date());

  if (/verschieb|termin.*änder|ändere.*termin/i.test(last)) {
    const [event] = await listEvents(toDateTimeStr(today), toDateTimeStr(addDays(today, 14)));
    if (!event) return { ...FALLBACK, text: "Ich finde in den nächsten Tagen keinen Termin, den ich ändern könnte." };
    const day = toDateStr(addDays(new Date(`${event.startsAt.slice(0, 10)}T00:00:00`), 1));
    const startsAt = `${day} ${event.startsAt.slice(11)}`;
    const endsAt = `${day} ${event.endsAt.slice(11)}`;
    return {
      ...empty,
      steps: ["Termine gelesen", "Änderung vorgeschlagen"],
      text: `Ich habe „${event.title}“ um einen Tag verschoben. Es ändert sich erst, wenn du bestätigst.`,
      actions: [
        {
          ...base,
          kind: "event_update",
          id: event.id,
          title: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          changes: [
            { label: "Zeit", before: `${fmt(event.startsAt)}, ${event.startsAt.slice(11)} – ${event.endsAt.slice(11)}`, after: `${fmt(startsAt)}, ${startsAt.slice(11)} – ${endsAt.slice(11)}` },
          ],
          input: { title: event.title, description: event.description, location: event.location, startsAt, endsAt, allDay: event.allDay },
        },
      ],
    };
  }

  const [task] = (await listTasks()).filter((t) => !t.done);
  if (!task) return { ...FALLBACK, text: "Es gibt keine offene Aufgabe, die ich ändern könnte." };
  if (/ergänz|notiz|priorität|ändere/i.test(last)) {
    const added = "Rabatt mit dem Kunden klären";
    return {
      ...empty,
      steps: ["Aufgaben gelesen", "Änderung vorgeschlagen"],
      text: `Ich habe zwei Änderungen an „${task.title}“ vorbereitet. Sie gelten erst, wenn du bestätigst.`,
      actions: [
        {
          ...base,
          kind: "task_update",
          id: task.id,
          title: task.title,
          changes: [
            { label: "Priorität", before: "Mittel", after: "Hoch" },
            { label: "Notiz ergänzt", before: null, after: added },
          ],
          input: {
            title: task.title,
            bucketId: task.bucketId,
            priority: "high",
            description: task.description ? `${task.description}\n\n${added}` : added,
            dueDate: task.dueDate,
            startDate: task.startDate,
            showSubtasks: task.showSubtasks,
            showDescription: task.showDescription,
            eventId: task.eventId,
            eventOffset: task.eventOffset,
            subtasks: task.subtasks,
          },
        },
      ],
    };
  }
  const kind = /lösch/i.test(last) ? "task_delete" : "task_done";
  return {
    ...empty,
    steps: ["Aufgaben gelesen", kind === "task_delete" ? "Löschen vorgeschlagen" : "Abhaken vorgeschlagen"],
    text: `Ich habe „${task.title}“ vorbereitet. Es passiert erst, wenn du bestätigst.`,
    actions: [{ ...base, kind, id: task.id, title: task.title, dueDate: task.dueDate }],
  };
};

/** Vorschlag für Ordner und Seiten der Dokumentation, mit Überschriften, Tabelle und Trennlinien. */
const DOCS = (): AssistantAnswer => ({
  steps: ["Dokumentationsstruktur gelesen", "Dokumentation vorgeschlagen"],
  text: "Ich habe einen Ordner mit zwei Seiten vorbereitet. Angelegt wird erst, wenn du bestätigst.",
  sources: [],
  proposals: [],
  deletions: [],
  tasks: [],
  choices: [],
  actions: [],
  docs: [
    {
      parentId: null,
      parentPath: "Hauptebene",
      stats: { folders: 1, pages: 2, headings: 5, tables: 1, dividers: 1 },
      existing: [],
      nodes: [
        {
          type: "folder",
          title: "Projekt Alpha",
          blocks: [],
          children: [
            {
              type: "page",
              title: "Überblick",
              children: [],
              blocks: [
                { type: "heading", level: 1, text: "Ziel" },
                { type: "paragraph", text: "Das Projekt bündelt **alle Unterlagen** an einem Ort." },
                { type: "heading", level: 2, text: "Beteiligte" },
                { type: "bullet_list", items: ["Projektleitung", "Entwicklung", "Fachbereich"] },
                { type: "divider" },
                { type: "heading", level: 1, text: "Zeitplan" },
                { type: "table", headers: ["Phase", "Start", "Ende"], rows: [["Planung", "01.11.", "15.11."], ["Umsetzung", "16.11.", "20.12."]] },
              ],
            },
            {
              type: "page",
              title: "Risiken",
              children: [],
              blocks: [
                { type: "heading", level: 1, text: "Bekannte Risiken" },
                { type: "numbered_list", items: ["Lieferverzug", "Fehlende Freigaben"] },
                { type: "heading", level: 2, text: "Gegenmassnahmen" },
                { type: "paragraph", text: "Wöchentliche Abstimmung, *frühzeitig* eskalieren." },
              ],
            },
          ],
        },
      ],
    },
  ],
});

/** Erst die Bucket-Auswahl, nach der Wahl der Aufgabenvorschlag – wie beim echten Assistenten. */
const CHOOSE = async (): Promise<AssistantAnswer> => {
  const buckets = await listBuckets();
  if (buckets.length === 0) return TASK(null);
  return {
    steps: ["Bucket zur Auswahl"],
    text: "In welchen Bucket soll die Aufgabe?",
    sources: [],
    proposals: [],
    deletions: [],
    tasks: [],
    choices: [{ taskTitle: "Angebot überarbeiten", buckets: buckets.map((b) => ({ id: b.id, name: b.name, color: b.color, openTasks: 0 })) }],
    actions: [],
    docs: [],
  };
};

const TASK = async (bucketName: string | null): Promise<AssistantAnswer> => {
  const buckets = await listBuckets();
  const bucket = buckets.find((b) => b.name === bucketName);
  return {
    steps: ["Aufgabe vorgeschlagen"],
    text: "Das ist mein Vorschlag. Die Aufgabe wird erst angelegt, wenn du ihn bestätigst.",
    sources: [],
    proposals: [],
    deletions: [],
    tasks: [
      {
        title: "Angebot überarbeiten",
        description: "Preise prüfen und Lieferzeit ergänzen.",
        priority: "high",
        dueDate: toDateStr(addDays(startOfDay(new Date()), 3)),
        bucketId: bucket?.id ?? null,
        bucketName: bucket?.name ?? null,
        subtasks: ["Preise prüfen", "Lieferzeit ergänzen"],
      },
    ],
    choices: [],
  docs: [],
  actions: [],
  };
};

export async function previewAnswer(history: ChatTurn[], onStep: (step: string) => void): Promise<AssistantAnswer> {
  const last = history[history.length - 1]?.text ?? "";
  const answer = /(doku|seite|ordner)/i.test(last) && /(anleg|erstell|leg|schreib)/i.test(last)
    ? DOCS()
    : /hake|abhak|erledig|verschieb|ergänz|ändere|aufgabe.*lösch|lösch.*aufgabe/i.test(last)
    ? await CHANGE(last)
    : /^Bucket:/i.test(last)
    ? await TASK(last.replace(/^Bucket:\s*/i, "").trim() || null)
    : /aufgabe.*(anleg|erstell|eintrag|hinzufüg)|neue aufgabe/i.test(last)
    ? await CHOOSE()
    : /lösch|entfern/i.test(last)
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
