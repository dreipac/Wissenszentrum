// Nur für das Browser-Preview ohne Tauri: einfacher In-Memory-Speicher mit Demo-Terminen.
// In der echten App wird dieser Code nie benutzt.
import type { CalendarEvent, EventInput } from "../calendar";
import type { Note, NoteInput } from "../notes";
import type { Bucket, BucketInput, Subtask, SubtaskInput, Task, TaskInput } from "../tasks";
import { addDays, startOfDay, startOfWeek, toDateStr } from "../dates";
import { eventTaskDate, MAX_EVENT_OFFSET } from "../tasks";

let nextId = 1;
const events: CalendarEvent[] = [];

function seed() {
  const monday = startOfWeek(new Date());
  const add = (
    offset: number,
    from: string,
    to: string,
    title: string,
    allDay = false,
  ) => {
    const d = toDateStr(addDays(startOfDay(monday), offset));
    events.push({
      id: nextId++,
      title,
      description: "",
      location: "",
      startsAt: `${d} ${allDay ? "00:00" : from}`,
      endsAt: `${d} ${allDay ? "23:59" : to}`,
      allDay,
      prepTotal: 0,
      prepDone: 0,
      followTotal: 0,
      followDone: 0,
    });
  };
  add(0, "09:30", "10:30", "Team-Meeting");
  add(1, "14:00", "15:30", "Kundentermin");
  add(2, "10:00", "11:30", "Präsentation Kunde");
  add(2, "10:30", "12:00", "Workshop Dokumentation");
  add(2, "15:30", "16:30", "Zahnarzt");
  add(3, "", "", "Wartungsvertrag Frist", true);
  add(4, "11:00", "12:00", "Sprint-Review");
  add(5, "10:00", "12:00", "Einkaufen");
}
seed();

/** Termin mit dem aktuellen Stand seiner Aufgaben (wie im Backend: Vorbereitung bis zum Tag selbst, dann Nachbereitung). */
function withCounts(e: CalendarEvent): CalendarEvent {
  const mine = tasks.filter((t) => t.eventId === e.id);
  const prep = mine.filter((t) => (t.eventOffset ?? 0) <= 0);
  const follow = mine.filter((t) => (t.eventOffset ?? 0) > 0);
  return {
    ...e,
    prepTotal: prep.length,
    prepDone: prep.filter((t) => t.done).length,
    followTotal: follow.length,
    followDone: follow.filter((t) => t.done).length,
  };
}

export const browserStore = {
  async list(from: string, to: string) {
    return events
      .filter((e) => e.startsAt < to && e.endsAt > from)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(withCounts);
  },
  async create(input: EventInput) {
    const e = { ...input, id: nextId++, prepTotal: 0, prepDone: 0, followTotal: 0, followDone: 0 };
    events.push(e);
    return withCounts(e);
  },
  async update(id: number, input: EventInput) {
    const i = events.findIndex((e) => e.id === id);
    if (i < 0) throw "Termin nicht gefunden.";
    events[i] = { ...events[i], ...input, id };
    // Aufgaben am Termin ziehen mit und behalten ihre Dauer
    for (const t of tasks.filter((x) => x.eventId === id && x.eventOffset !== null)) {
      const due = eventTaskDate(events[i].startsAt, events[i].endsAt, t.eventOffset!);
      if (t.startDate && t.dueDate) {
        const span = Math.round((Date.parse(t.dueDate) - Date.parse(t.startDate)) / 86_400_000);
        t.startDate = toDateStr(addDays(new Date(`${due}T00:00:00`), -span));
      }
      t.dueDate = due;
    }
    return withCounts(events[i]);
  },
  async remove(id: number) {
    const i = events.findIndex((e) => e.id === id);
    if (i < 0) throw "Termin nicht gefunden.";
    tasks.forEach((t) => {
      if (t.eventId === id) {
        t.eventId = null;
        t.eventOffset = null;
      }
    });
    events.splice(i, 1);
  },
};

// --- Aufgaben & Buckets (nur Browser-Preview) -------------------------------

let buckets: Bucket[] = [];
let tasks: Task[] = [];
let nextBucketId = 1;
let nextTaskId = 1;
let nextSubtaskId = 1;

function toSubtasks(list: SubtaskInput[]): Subtask[] {
  if (list.some((s) => !s.title.trim())) throw "Ein Zwischenschritt darf nicht leer sein.";
  return list.map((s) => ({ id: s.id ?? nextSubtaskId++, title: s.title.trim(), done: s.done }));
}

const sortedTasks = () => [...tasks].sort((a, b) => Number(a.done) - Number(b.done));

function checkBucket(input: BucketInput, ownId: number | null): string {
  const name = input.name.trim();
  if (!name) throw "Der Name darf nicht leer sein.";
  if (buckets.some((b) => b.id !== ownId && b.name.toLowerCase() === name.toLowerCase())) {
    throw `Einen Bucket „${name}“ gibt es bereits.`;
  }
  if (input.onCompleteBucketId !== null) {
    if (input.onCompleteBucketId === ownId) throw "Ein Bucket kann nicht in sich selbst verschieben.";
    if (!buckets.some((b) => b.id === input.onCompleteBucketId)) throw "Der Ziel-Bucket existiert nicht mehr.";
  }
  return name;
}

function checkDates(start: string | null, due: string | null) {
  if (start !== null && due === null) throw "Ein Beginn braucht auch ein Fälligkeitsdatum.";
  if (start !== null && due !== null && start > due) throw "Der Beginn darf nicht nach dem Fälligkeitsdatum liegen.";
}

/** Aufgabe mit den aktuellen Angaben ihres Termins. */
function view(t: Task): Task {
  const e = t.eventId === null ? undefined : events.find((x) => x.id === t.eventId);
  return { ...t, eventTitle: e?.title ?? null, eventStartsAt: e?.startsAt ?? null, eventEndsAt: e?.endsAt ?? null };
}

/** Prüft den Terminbezug und liefert das Fälligkeitsdatum, das gilt: bei einem Termin das berechnete. */
function effectiveDue(input: TaskInput): string | null {
  if (input.eventId === null) return input.dueDate;
  const e = events.find((x) => x.id === input.eventId);
  if (!e) throw "Der gewählte Termin existiert nicht mehr.";
  if (input.eventOffset === null) throw "Bitte gib an, wie viele Tage vor oder nach dem Termin die Aufgabe liegt.";
  if (Math.abs(input.eventOffset) > MAX_EVENT_OFFSET) throw `Der Abstand zum Termin darf höchstens ${MAX_EVENT_OFFSET} Tage betragen.`;
  return eventTaskDate(e.startsAt, e.endsAt, input.eventOffset);
}

function checkTask(input: TaskInput) {
  if (!input.title.trim()) throw "Der Titel darf nicht leer sein.";
  checkDates(input.startDate, effectiveDue(input));
  if (input.bucketId !== null && !buckets.some((b) => b.id === input.bucketId)) {
    throw "Der gewählte Bucket existiert nicht mehr.";
  }
}

export const tasksStore = {
  async listBuckets() {
    return buckets.map((b) => ({ ...b }));
  },
  async listTasks() {
    return sortedTasks().map(view);
  },
  async createBucket(input: BucketInput) {
    const bucket: Bucket = { id: nextBucketId++, name: checkBucket(input, null), onCompleteBucketId: input.onCompleteBucketId, color: input.color };
    buckets.push(bucket);
    return { ...bucket };
  },
  async updateBucket(id: number, input: BucketInput) {
    const bucket = buckets.find((b) => b.id === id);
    if (!bucket) throw "Bucket nicht gefunden.";
    bucket.name = checkBucket(input, id);
    bucket.onCompleteBucketId = input.onCompleteBucketId;
    bucket.color = input.color;
    return { ...bucket };
  },
  async reorderBuckets(ids: number[]) {
    const sameSet = ids.length === buckets.length && buckets.every((b) => ids.includes(b.id));
    if (!sameSet) throw "Die Bucket-Liste ist nicht mehr aktuell. Bitte neu laden.";
    buckets = ids.map((id) => buckets.find((b) => b.id === id)!);
  },
  async deleteBucket(id: number) {
    if (!buckets.some((b) => b.id === id)) throw "Bucket nicht gefunden.";
    buckets = buckets.filter((b) => b.id !== id);
    buckets.forEach((b) => b.onCompleteBucketId === id && (b.onCompleteBucketId = null));
    tasks.forEach((t) => t.bucketId === id && (t.bucketId = null));
  },
  async createTask(input: TaskInput) {
    checkTask(input);
    const { subtasks, ...rest } = input;
    const task: Task = {
      ...rest,
      title: input.title.trim(),
      dueDate: effectiveDue(input),
      eventOffset: input.eventId === null ? null : input.eventOffset,
      id: nextTaskId++,
      done: false,
      eventTitle: null,
      eventStartsAt: null,
      eventEndsAt: null,
      subtasks: toSubtasks(subtasks),
    };
    tasks.push(task);
    return view(task);
  },
  async updateTask(id: number, input: TaskInput) {
    checkTask(input);
    const task = tasks.find((t) => t.id === id);
    if (!task) throw "Aufgabe nicht gefunden.";
    const { subtasks, ...rest } = input;
    const steps = toSubtasks(subtasks);
    Object.assign(task, rest, {
      title: input.title.trim(),
      dueDate: effectiveDue(input),
      eventOffset: input.eventId === null ? null : input.eventOffset,
      subtasks: steps,
    });
    return view(task);
  },
  async deleteTask(id: number) {
    if (!tasks.some((t) => t.id === id)) throw "Aufgabe nicht gefunden.";
    tasks = tasks.filter((t) => t.id !== id);
  },
  async moveTask(id: number, bucketId: number | null, beforeTaskId: number | null) {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw "Aufgabe nicht gefunden.";
    if (bucketId !== null && !buckets.some((b) => b.id === bucketId)) throw "Der Ziel-Bucket existiert nicht mehr.";
    if (beforeTaskId === id && task.bucketId === bucketId) return view(task);
    tasks = tasks.filter((t) => t.id !== id);
    task.bucketId = bucketId;
    const at = beforeTaskId === null || beforeTaskId === id ? -1 : tasks.findIndex((t) => t.id === beforeTaskId);
    if (at === -1) tasks.push(task);
    else tasks.splice(at, 0, task);
    return view(task);
  },
  async setDates(id: number, startDate: string | null, dueDate: string | null) {
    checkDates(startDate, dueDate);
    const task = tasks.find((t) => t.id === id);
    if (!task) throw "Aufgabe nicht gefunden.";
    // Hängt die Aufgabe an einem Termin, ändert sich ihr Abstand zu ihm; ohne Fälligkeit wird sie gelöst
    const e = task.eventId === null ? undefined : events.find((x) => x.id === task.eventId);
    if (e && dueDate) {
      const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b.slice(0, 10))) / 86_400_000);
      const fromEnd = days(dueDate, e.endsAt);
      task.eventOffset = Math.max(-MAX_EVENT_OFFSET, Math.min(MAX_EVENT_OFFSET, fromEnd > 0 ? fromEnd : Math.min(days(dueDate, e.startsAt), 0)));
    } else if (e) {
      task.eventId = null;
      task.eventOffset = null;
    }
    task.startDate = startDate;
    task.dueDate = dueDate;
    return view(task);
  },
  async setSubtaskDone(id: number, done: boolean) {
    const task = tasks.find((t) => t.subtasks.some((s) => s.id === id));
    if (!task) throw "Zwischenschritt nicht gefunden.";
    task.subtasks = task.subtasks.map((s) => (s.id === id ? { ...s, done } : s));
    return view(task);
  },
  async setDone(id: number, done: boolean) {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw "Aufgabe nicht gefunden.";
    // Wie im Backend: Beim Abhaken greift die Regel des Buckets, beim Wiedereröffnen passiert nichts
    if (done && !task.done) {
      const target = buckets.find((b) => b.id === task.bucketId)?.onCompleteBucketId ?? null;
      if (target !== null) task.bucketId = target;
    }
    task.done = done;
    return view(task);
  },
};

// --- Notizen (nur Browser-Preview) -------------------------------------------

let notes: Note[] = [];
let nextNoteId = 1;
const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const sortedNotes = () =>
  [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id,
  );

export const notesStore = {
  async list() {
    return sortedNotes().map((n) => ({ ...n }));
  },
  async create(input: NoteInput) {
    const now = utcNow();
    const note: Note = { ...input, title: input.title.trim(), folder: input.folder.trim(), id: nextNoteId++, pinned: false, createdAt: now, updatedAt: now };
    notes.push(note);
    return { ...note };
  },
  async update(id: number, input: NoteInput) {
    const note = notes.find((n) => n.id === id);
    if (!note) throw "Notiz nicht gefunden.";
    Object.assign(note, input, { title: input.title.trim(), folder: input.folder.trim(), updatedAt: utcNow() });
    return { ...note };
  },
  async setPinned(id: number, pinned: boolean) {
    const note = notes.find((n) => n.id === id);
    if (!note) throw "Notiz nicht gefunden.";
    note.pinned = pinned;
    return { ...note };
  },
  async remove(id: number) {
    if (!notes.some((n) => n.id === id)) throw "Notiz nicht gefunden.";
    notes = notes.filter((n) => n.id !== id);
  },
  async purge(exceptId: number | null) {
    const before = notes.length;
    notes = notes.filter((n) => n.pinned || n.id === exceptId || n.title.trim() || n.plain.trim());
    return before - notes.length;
  },
};
