import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type { JournalEdit, JournalEntry, JournalInput } from "../journal";
import { inTauri } from "./runtime";
import { tradingPreview } from "./tradingPreview";

/** Nach jeder Änderung laden alle Trading-Ansichten (und die Strategien) neu. */
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("trading");
  return value;
}

export const listJournal = (): Promise<JournalEntry[]> => (inTauri ? invoke("list_journal") : preview.list());

export const addJournal = (input: JournalInput): Promise<JournalEntry> => changed(inTauri ? invoke("add_journal", { input }) : preview.add(input));

export const updateJournal = (id: number, input: JournalEdit): Promise<JournalEntry> => changed(inTauri ? invoke("update_journal", { id, input }) : preview.update(id, input));

export const deleteJournal = (id: number): Promise<void> => changed(inTauri ? invoke("delete_journal", { id }) : preview.remove(id));

// Browser-Preview ohne Tauri: In-Memory, nur zum Ansehen der Oberfläche
let entries: JournalEntry[] = [];
let nextId = 1;
const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const preview = {
  async list(): Promise<JournalEntry[]> {
    return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  },
  async add(input: JournalInput): Promise<JournalEntry> {
    if (!input.text.trim()) throw "Bitte schreibe etwas in die Notiz.";
    const trade = (await tradingPreview.state()).trades.find((t) => t.id === input.tradeId);
    if (!trade) throw "Position nicht gefunden.";
    const entry: JournalEntry = {
      id: nextId++,
      tradeId: trade.id,
      symbol: trade.symbol,
      tradeName: trade.name,
      kind: input.kind,
      topic: input.topic,
      text: input.text.trim(),
      nextTime: input.nextTime.trim(),
      price: input.price,
      pnlPct: input.pnlPct,
      strategyId: input.strategyId,
      createdAt: utcNow(),
    };
    entries.push(entry);
    return entry;
  },
  async update(id: number, input: JournalEdit): Promise<JournalEntry> {
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw "Eintrag nicht gefunden.";
    if (!input.text.trim()) throw "Bitte schreibe etwas in die Notiz.";
    Object.assign(entry, { ...input, text: input.text.trim(), nextTime: input.nextTime.trim() });
    return entry;
  },
  async remove(id: number): Promise<void> {
    entries = entries.filter((e) => e.id !== id);
  },
};
