import { create } from "zustand";
import { toUtcStr } from "@/lib/dates";
import { memoryRepository } from "./memoryRepository";
import type { Repository } from "./repository";
import type { Bucket, CalendarEvent, EventDraft, Note, Profile, Task, TaskDraft } from "./types";

/** Hier wird später die Datenbank eingesetzt (Phase 4). */
const repo: Repository = memoryRepository;

interface State {
  ready: boolean;
  profile: Profile;
  buckets: Bucket[];
  tasks: Task[];
  events: CalendarEvent[];
  notes: Note[];

  init: () => Promise<void>;

  toggleTask: (id: number) => void;
  toggleSubtask: (taskId: number, subtaskId: number) => void;
  createTask: (draft: TaskDraft) => number;
  updateTask: (id: number, patch: Partial<Task>) => void;
  deleteTask: (id: number) => void;

  createEvent: (draft: EventDraft) => number;
  updateEvent: (id: number, patch: Partial<CalendarEvent>) => void;
  deleteEvent: (id: number) => void;

  /** Legt eine leere Notiz an und liefert ihre Nummer. */
  createNote: (folder?: string) => number;
  updateNote: (id: number, patch: Partial<Pick<Note, "title" | "plain" | "folder">>) => void;
  toggleNotePin: (id: number) => void;
  deleteNote: (id: number) => void;
}

const nextId = (items: { id: number }[]) => items.reduce((max, i) => Math.max(max, i.id), 0) + 1;

/** Absätze als einfaches HTML (am Desktop sind Notizen HTML; ein Editor mit Formatierung folgt später). */
const toHtml = (plain: string) =>
  plain
    .split("\n")
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("");

export const useStore = create<State>((set, get) => ({
  ready: false,
  profile: { firstName: "", lastName: "" },
  buckets: [],
  tasks: [],
  events: [],
  notes: [],

  init: async () => {
    const snapshot = await repo.load();
    set({ ...snapshot, ready: true });
  },

  toggleTask: (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const next = { ...task, done: !task.done };
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }));
    void repo.saveTask(next);
  },

  toggleSubtask: (taskId, subtaskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const next = { ...task, subtasks: task.subtasks.map((st) => (st.id === subtaskId ? { ...st, done: !st.done } : st)) };
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? next : t)) }));
    void repo.saveTask(next);
  },

  createTask: (draft) => {
    const id = nextId(get().tasks);
    // Zwischenschritte brauchen eigene Nummern (fortlaufend über alle Aufgaben)
    let sub = get().tasks.flatMap((t) => t.subtasks).reduce((max, st) => Math.max(max, st.id), 0);
    const task: Task = { ...draft, id, done: false, subtasks: draft.subtasks.map((st) => ({ ...st, id: st.id > 0 ? st.id : ++sub })) };
    set((s) => ({ tasks: [task, ...s.tasks] }));
    void repo.saveTask(task);
    return id;
  },

  updateTask: (id, patch) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    let sub = get().tasks.flatMap((t) => t.subtasks).reduce((max, st) => Math.max(max, st.id), 0);
    const next: Task = { ...task, ...patch, id };
    next.subtasks = next.subtasks.map((st) => (st.id > 0 ? st : { ...st, id: ++sub }));
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }));
    void repo.saveTask(next);
  },

  deleteTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    void repo.removeTask(id);
  },

  createEvent: (draft) => {
    const id = nextId(get().events);
    const event: CalendarEvent = { ...draft, id };
    set((s) => ({ events: [...s.events, event] }));
    void repo.saveEvent(event);
    return id;
  },

  updateEvent: (id, patch) => {
    const event = get().events.find((e) => e.id === id);
    if (!event) return;
    const next = { ...event, ...patch, id };
    set((s) => ({ events: s.events.map((e) => (e.id === id ? next : e)) }));
    void repo.saveEvent(next);
  },

  deleteEvent: (id) => {
    // Aufgaben an dem Termin bleiben bestehen (wie am Desktop)
    set((s) => ({ events: s.events.filter((e) => e.id !== id), tasks: s.tasks.map((t) => (t.eventId === id ? { ...t, eventId: null } : t)) }));
    void repo.removeEvent(id);
  },

  createNote: (folder = "") => {
    const id = nextId(get().notes);
    const now = toUtcStr(new Date());
    const note: Note = { id, title: "", content: "", plain: "", folder, pinned: false, createdAt: now, updatedAt: now };
    set((s) => ({ notes: [note, ...s.notes] }));
    void repo.saveNote(note);
    return id;
  },

  updateNote: (id, patch) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    const next: Note = { ...note, ...patch, updatedAt: toUtcStr(new Date()) };
    if (patch.plain !== undefined) next.content = toHtml(patch.plain);
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? next : n)) }));
    void repo.saveNote(next);
  },

  toggleNotePin: (id) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    const next = { ...note, pinned: !note.pinned };
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? next : n)) }));
    void repo.saveNote(next);
  },

  deleteNote: (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    void repo.removeNote(id);
  },
}));
