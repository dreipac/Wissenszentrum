import { modelLabel, type TokenUsage } from "../../lib/api/assistant";
import { formatChf } from "../../lib/cost";

const num = (n: number) => n.toLocaleString("de-CH");

/** Dezente Zeile unter einer Antwort: Modell, geschätzte Kosten und Token (alle Runden zusammen). */
export function UsageLine({ usage, model, usdChf }: { usage: TokenUsage; model?: string; usdChf: number }) {
  if (usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens === 0) return null;
  const parts: string[] = [];
  if (model) parts.push(modelLabel(model));
  if (usage.costUsd > 0) parts.push(`ca. ${formatChf(usage.costUsd, usdChf)}`);
  parts.push(`Eingabe ${num(usage.inputTokens)}`);
  if (usage.cacheReadTokens > 0) parts.push(`Cache gelesen ${num(usage.cacheReadTokens)}`);
  // Nach „Cache gelesen“ genügt „geschrieben“: so passt die Zeile besser in das schmale Panel
  if (usage.cacheWriteTokens > 0) parts.push(`${usage.cacheReadTokens > 0 ? "" : "Cache "}geschrieben ${num(usage.cacheWriteTokens)}`);
  parts.push(`Ausgabe ${num(usage.outputTokens)}`);
  return (
    <p
      className="as-usage"
      title="Modell und Token dieser Antwort. Die Kosten sind eine Schätzung nach der Preisliste von Anthropic. Eingabe: voller Preis. Cache gelesen: günstig aus dem Zwischenspeicher. Cache geschrieben: neu in den Zwischenspeicher gelegt."
    >
      {parts.join(" · ")}
    </p>
  );
}
