// Nur für das Browser-Preview ohne Tauri: einfacher In-Memory-Speicher mit Demo-Terminen.
// In der echten App wird dieser Code nie benutzt.
import type { CalendarEvent, EventInput } from "../calendar";
import type { Note, NoteInput } from "../notes";
import type { Bucket, BucketInput, Subtask, SubtaskInput, Task, TaskInput } from "../tasks";
import { addDays, startOfDay, startOfWeek, toDateStr } from "../dates";

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

export const browserStore = {
  async list(from: string, to: string) {
    return events.filter((e) => e.startsAt < to && e.endsAt > from).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  },
  async create(input: EventInput) {
    const e = { ...input, id: nextId++ };
    events.push(e);
    return e;
  },
  async update(id: number, input: EventInput) {
    const i = events.findIndex((e) => e.id === id);
    if (i < 0) throw "Termin nicht gefunden.";
    events[i] = { ...input, id };
    return events[i];
  },
  async remove(id: number) {
    const i = events.findIndex((e) => e.id === id);
    if (i < 0) throw "Termin nicht gefunden.";
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

function checkTask(input: TaskInput) {
  if (!input.title.trim()) throw "Der Titel darf nicht leer sein.";
  if (input.bucketId !== null && !buckets.some((b) => b.id === input.bucketId)) {
    throw "Der gewählte Bucket existiert nicht mehr.";
  }
}

export const tasksStore = {
  async listBuckets() {
    return buckets.map((b) => ({ ...b }));
  },
  async listTasks() {
    return sortedTasks().map((t) => ({ ...t }));
  },
  async createBucket(input: BucketInput) {
    const bucket = { id: nextBucketId++, name: checkBucket(input, null), onCompleteBucketId: input.onCompleteBucketId };
    buckets.push(bucket);
    return { ...bucket };
  },
  async updateBucket(id: number, input: BucketInput) {
    const bucket = buckets.find((b) => b.id === id);
    if (!bucket) throw "Bucket nicht gefunden.";
    bucket.name = checkBucket(input, id);
    bucket.onCompleteBucketId = input.onCompleteBucketId;
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
    const task: Task = { ...rest, title: input.title.trim(), id: nextTaskId++, done: false, subtasks: toSubtasks(subtasks) };
    tasks.push(task);
    return { ...task };
  },
  async updateTask(id: number, input: TaskInput) {
    checkTask(input);
    const task = tasks.find((t) => t.id === id);
    if (!task) throw "Aufgabe nicht gefunden.";
    const { subtasks, ...rest } = input;
    const steps = toSubtasks(subtasks);
    Object.assign(task, rest, { title: input.title.trim(), subtasks: steps });
    return { ...task };
  },
  async deleteTask(id: number) {
    if (!tasks.some((t) => t.id === id)) throw "Aufgabe nicht gefunden.";
    tasks = tasks.filter((t) => t.id !== id);
  },
  async moveTask(id: number, bucketId: number | null, beforeTaskId: number | null) {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw "Aufgabe nicht gefunden.";
    if (bucketId !== null && !buckets.some((b) => b.id === bucketId)) throw "Der Ziel-Bucket existiert nicht mehr.";
    if (beforeTaskId === id && task.bucketId === bucketId) return { ...task };
    tasks = tasks.filter((t) => t.id !== id);
    task.bucketId = bucketId;
    const at = beforeTaskId === null || beforeTaskId === id ? -1 : tasks.findIndex((t) => t.id === beforeTaskId);
    if (at === -1) tasks.push(task);
    else tasks.splice(at, 0, task);
    return { ...task };
  },
  async setSubtaskDone(id: number, done: boolean) {
    const task = tasks.find((t) => t.subtasks.some((s) => s.id === id));
    if (!task) throw "Zwischenschritt nicht gefunden.";
    task.subtasks = task.subtasks.map((s) => (s.id === id ? { ...s, done } : s));
    return { ...task };
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
    return { ...task };
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
