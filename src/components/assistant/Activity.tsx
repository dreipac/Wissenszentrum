import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { PlanItem } from "../../lib/api/assistant";
import { Markdown } from "./Markdown";
import { PlanList } from "./PlanList";
import "./Activity.css";

/** Ein Eintrag im Arbeitsverlauf: eine Notiz des Assistenten („Ich schaue zuerst …“) oder ein erledigter Schritt. */
export interface FeedItem {
  kind: "thought" | "step";
  text: string;
}

function Feed({ items, live }: { items: FeedItem[]; live?: boolean }) {
  return (
    <ol className="act-feed">
      {items.map((item, i) => (
        <li key={i} className={`act-item ${item.kind}${live && i === items.length - 1 ? " latest" : ""}`}>
          {item.kind === "step" && <Check size={12} className="act-check" />}
          <span>{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Sekunden seit dem Einblenden. */
function useElapsed(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds;
}

const clock = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`);

interface ActivityProps {
  feed: FeedItem[];
  plan: PlanItem[];
  /** Die Antwort, die gerade geschrieben wird */
  text: string;
}

/**
 * Anzeige, solange der Assistent arbeitet: oben eine Zeile mit Animation und Dauer, darunter seine Gedanken und Schritte
 * in der Reihenfolge, in der sie geschehen, dann der Plan und die Antwort, sobald sie zu entstehen beginnt.
 */
export function Activity({ feed, plan, text }: ActivityProps) {
  const seconds = useElapsed();
  const label = text ? "Schreibt die Antwort" : plan.length > 0 ? "Arbeitet am Plan" : feed.length > 0 ? "Arbeitet" : "Denkt nach";
  return (
    <div className="act" role="status" aria-live="polite">
      <div className="act-head">
        <span className="act-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="act-label">{label} …</span>
        <span className="act-time">{clock(seconds)}</span>
      </div>
      {feed.length > 0 && <Feed items={feed} live />}
      {plan.length > 0 && <PlanList items={plan} />}
      {text.trim() && (
        <div className="act-answer">
          <Markdown text={text} />
          <span className="act-caret" aria-hidden />
        </div>
      )}
    </div>
  );
}

/** Der Arbeitsverlauf einer fertigen Antwort: zugeklappt, auf Wunsch mit allen Gedanken und Schritten. */
export function WorkLog({ feed, steps }: { feed?: FeedItem[]; steps?: string[] }) {
  const [open, setOpen] = useState(false);
  // Ältere Antworten kennen nur die Schritte
  const items: FeedItem[] = feed && feed.length > 0 ? feed : (steps ?? []).map((text) => ({ kind: "step", text }));
  if (items.length === 0) return null;
  const thoughts = items.filter((i) => i.kind === "thought").length;
  const stepCount = items.length - thoughts;
  const summary = [stepCount > 0 ? `${stepCount} ${stepCount === 1 ? "Schritt" : "Schritte"}` : "", thoughts > 0 ? `${thoughts} ${thoughts === 1 ? "Gedanke" : "Gedanken"}` : ""].filter(Boolean).join(" · ");
  return (
    <div className={`act-log${open ? " open" : ""}`}>
      <button type="button" className="act-log-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={13} />
        <span>Arbeitsverlauf</span>
        <span className="act-log-count">{summary}</span>
      </button>
      {open && <Feed items={items} />}
    </div>
  );
}
