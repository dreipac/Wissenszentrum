export type JournalKind = "observation" | "mistake" | "improve" | "good";

export type JournalTopic = "" | "einstieg" | "ausstieg" | "stoploss" | "groesse" | "timing" | "gebuehren" | "gefuehl";

export interface JournalEntry {
  id: number;
  tradeId: number;
  symbol: string;
  tradeName: string;
  kind: JournalKind;
  topic: JournalTopic;
  text: string;
  /** Nur bei „Besser machen“: was beim nächsten Mal anders laufen soll */
  nextTime: string;
  /** Kurs (Positionswährung) und Stand der Position in % beim Schreiben */
  price: number | null;
  pnlPct: number | null;
  strategyId: number | null;
  /** UTC, `YYYY-MM-DD HH:MM:SS` */
  createdAt: string;
}

export interface JournalInput {
  tradeId: number;
  kind: JournalKind;
  topic: JournalTopic;
  text: string;
  nextTime: string;
  price: number | null;
  pnlPct: number | null;
  strategyId: number | null;
}

export type JournalEdit = Pick<JournalInput, "kind" | "topic" | "text" | "nextTime" | "strategyId">;

export const KIND_LABEL: Record<JournalKind, string> = {
  observation: "Beobachtung",
  mistake: "Fehler",
  improve: "Besser machen",
  good: "Lief gut",
};

/** Reihenfolge in der Auswahl */
export const KINDS: JournalKind[] = ["observation", "mistake", "improve", "good"];

export const TOPIC_LABEL: Record<Exclude<JournalTopic, "">, string> = {
  einstieg: "Einstieg",
  ausstieg: "Ausstieg",
  stoploss: "Stop-Loss",
  groesse: "Positionsgröße",
  timing: "Timing",
  gebuehren: "Gebühren",
  gefuehl: "Gefühl",
};

export const TOPICS = Object.keys(TOPIC_LABEL) as Exclude<JournalTopic, "">[];

/** Zeitpunkt eines Eintrags in Millisekunden (gespeichert wird UTC ohne Zeitzone). */
export const entryTime = (e: Pick<JournalEntry, "createdAt">) => Date.parse(`${e.createdAt.replace(" ", "T")}Z`);

/** Regeln für das nächste Mal: „Besser machen“-Einträge einer Strategie; der Satz „Nächstes Mal“ gilt vor der Notiz. */
export const ruleText = (e: Pick<JournalEntry, "nextTime" | "text">) => e.nextTime.trim() || e.text;

/** „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“, sonst Datum. */
export function ago(e: Pick<JournalEntry, "createdAt">, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - entryTime(e)) / 60000));
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  if (d < 14) return `vor ${d} ${d === 1 ? "Tag" : "Tagen"}`;
  return new Date(entryTime(e)).toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" });
}
