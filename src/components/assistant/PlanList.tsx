import { Check, Circle, LoaderCircle } from "lucide-react";
import type { PlanItem } from "../../lib/api/assistant";

/** Arbeitsplan des Assistenten: wie eine Aufgabenliste, die sich beim Abarbeiten live abhakt. */
export function PlanList({ items }: { items: PlanItem[] }) {
  const done = items.filter((i) => i.status === "done").length;
  return (
    <div className="as-plan" aria-label="Arbeitsplan">
      <div className="as-plan-head">
        <span className="as-label">Plan</span>
        <span className="as-plan-count">
          {done} von {items.length}
        </span>
      </div>
      <ul>
        {items.map((item, i) => (
          <li key={i} className={item.status}>
            {item.status === "done" ? <Check size={13} /> : item.status === "in_progress" ? <LoaderCircle size={13} className="as-spin" /> : <Circle size={13} />}
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
