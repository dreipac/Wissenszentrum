import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import { inTauri } from "./runtime";

/** Ein gespeicherter Chat des Assistenten. Die Chats liegen nur auf diesem Rechner (nie im Abgleich). */
export interface ChatInfo {
  id: number;
  /** Projekt des Chats; null = Chat ohne Projekt (auch wenn das Projekt inzwischen gelöscht wurde) */
  projectId: number | null;
  title: string;
  pinned: boolean;
  /** UTC, `YYYY-MM-DD HH:MM:SS` */
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Anfang der letzten Nachricht */
  preview: string;
}

/** Eine gespeicherte Nachricht: `payload` ist die ganze Nachricht der Oberfläche als JSON. */
export interface StoredMessage {
  seq: number;
  role: "user" | "assistant";
  payload: string;
}

export interface ChatHit {
  chatId: number;
  title: string;
  snippet: string;
}

// Browser-Preview ohne Tauri: dieselben Regeln wie im Backend, aber nur im Speicher.
interface PreviewChat extends ChatInfo {
  messages: { seq: number; role: "user" | "assistant"; text: string; payload: string }[];
}
let previewChats: PreviewChat[] = [];
let nextId = 1;
const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const infoOf = (c: PreviewChat): ChatInfo => {
  const last = c.messages[c.messages.length - 1];
  return { id: c.id, projectId: c.projectId, title: c.title, pinned: c.pinned, createdAt: c.createdAt, updatedAt: c.updatedAt, messageCount: c.messages.length, preview: last ? last.text.slice(0, 160) : "" };
};
const findChat = (id: number) => {
  const chat = previewChats.find((c) => c.id === id);
  if (!chat) throw "Chat nicht gefunden.";
  return chat;
};
const cleanTitle = (title: string) => {
  const t = title.split(/\s+/).filter(Boolean).join(" ");
  if (!t) throw "Der Titel darf nicht leer sein.";
  if (t.length > 120) throw "Der Titel darf höchstens 120 Zeichen lang sein.";
  return t;
};
const titleFrom = (text: string) => {
  const line = (text.split("\n").map((l) => l.trim()).find(Boolean) ?? "").split(/\s+/).join(" ");
  return line.length <= 60 ? line : `${line.slice(0, 60).trimEnd()}…`;
};

const preview = {
  async list(): Promise<ChatInfo[]> {
    return [...previewChats]
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .map(infoOf);
  },
  async create(projectId: number | null, title: string): Promise<ChatInfo> {
    const now = utcNow();
    const chat: PreviewChat = { id: nextId++, projectId, title: title.trim() ? cleanTitle(title) : "", pinned: false, createdAt: now, updatedAt: now, messageCount: 0, preview: "", messages: [] };
    previewChats.push(chat);
    return infoOf(chat);
  },
  async rename(id: number, title: string) {
    findChat(id).title = cleanTitle(title);
  },
  async pin(id: number, pinned: boolean) {
    findChat(id).pinned = pinned;
  },
  async move(id: number, projectId: number | null) {
    findChat(id).projectId = projectId;
  },
  async remove(id: number) {
    findChat(id);
    previewChats = previewChats.filter((c) => c.id !== id);
  },
  async load(id: number): Promise<StoredMessage[]> {
    return [...findChat(id).messages].sort((a, b) => a.seq - b.seq).map((m) => ({ seq: m.seq, role: m.role, payload: m.payload }));
  },
  async save(chatId: number, seq: number, role: "user" | "assistant", text: string, payload: string) {
    const chat = findChat(chatId);
    const existing = chat.messages.find((m) => m.seq === seq);
    if (existing) Object.assign(existing, { role, text, payload });
    else chat.messages.push({ seq, role, text, payload });
    if (!chat.title && role === "user") chat.title = titleFrom(text);
    chat.updatedAt = utcNow();
  },
  async deleteFrom(chatId: number, seq: number) {
    const chat = findChat(chatId);
    chat.messages = chat.messages.filter((m) => m.seq < seq);
  },
  async search(query: string): Promise<ChatHit[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return previewChats
      .filter((c) => {
        const text = `${c.title} ${c.messages.map((m) => m.text).join(" ")}`.toLowerCase();
        return terms.every((t) => text.includes(t));
      })
      .slice(0, 40)
      .map((c) => ({ chatId: c.id, title: c.title, snippet: c.messages.find((m) => m.text.toLowerCase().includes(terms[0]))?.text.slice(0, 120) ?? "" }));
  },
};

async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("chats");
  return value;
}

export const listChats = (): Promise<ChatInfo[]> => (inTauri ? invoke("list_chats") : preview.list());

export const createChat = (projectId: number | null, title = ""): Promise<ChatInfo> =>
  changed(inTauri ? invoke("create_chat", { projectId, title }) : preview.create(projectId, title));

export const renameChat = (id: number, title: string): Promise<void> => changed(inTauri ? invoke("rename_chat", { id, title }) : preview.rename(id, title));

export const pinChat = (id: number, pinned: boolean): Promise<void> => changed(inTauri ? invoke("pin_chat", { id, pinned }) : preview.pin(id, pinned));

export const moveChat = (id: number, projectId: number | null): Promise<void> => changed(inTauri ? invoke("move_chat", { id, projectId }) : preview.move(id, projectId));

export const deleteChat = (id: number): Promise<void> => changed(inTauri ? invoke("delete_chat", { id }) : preview.remove(id));

export const loadChat = (id: number): Promise<StoredMessage[]> => (inTauri ? invoke("load_chat", { id }) : preview.load(id));

/** Speichert eine Nachricht oder überschreibt sie (gleiche Nummer). Die Liste lädt neu, weil sich Titel und Reihenfolge ändern können. */
export const saveChatMessage = (chatId: number, seq: number, role: "user" | "assistant", text: string, payload: string): Promise<void> =>
  changed(inTauri ? invoke("save_chat_message", { chatId, seq, role, text, payload }) : preview.save(chatId, seq, role, text, payload));

export const deleteChatMessagesFrom = (chatId: number, seq: number): Promise<void> =>
  changed(inTauri ? invoke("delete_chat_messages_from", { chatId, seq }) : preview.deleteFrom(chatId, seq));

export const searchChats = (query: string): Promise<ChatHit[]> => (inTauri ? invoke("search_chats", { query }) : preview.search(query));
