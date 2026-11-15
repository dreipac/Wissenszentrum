import { modelLabel, type TokenUsage } from "../../lib/api/assistant";

const num = (n: number) => n.toLocaleString("de-CH");

/** Dezente Zeile unter einer Antwort: Modell und Token (alle Runden zusammen). */
export function UsageLine({ usage, model }: { usage: TokenUsage; model?: string }) {
  if (usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens === 0) return null;
  const parts: string[] = [];
  if (model) parts.push(modelLabel(model));
  parts.push(`Eingabe ${num(usage.inputTokens)}`);
  if (usage.cacheReadTokens > 0) parts.push(`Cache gelesen ${num(usage.cacheReadTokens)}`);
  // Nach „Cache gelesen“ genügt „geschrieben“: so passt die Zeile besser in das schmale Panel
  if (usage.cacheWriteTokens > 0) parts.push(`${usage.cacheReadTokens > 0 ? "" : "Cache "}geschrieben ${num(usage.cacheWriteTokens)}`);
  parts.push(`Ausgabe ${num(usage.outputTokens)}`);
  return (
    <p className="as-usage" title="Modell und Token dieser Antwort, so wie Claude Code sie meldet. Es entstehen keine Kosten über eine API: Claude Code läuft über dein Konto. Cache: Teile der Eingabe, die Claude Code wiederverwenden konnte.">
      {parts.join(" · ")}
    </p>
  );
}
