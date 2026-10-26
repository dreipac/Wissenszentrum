import { AlertTriangle, ArrowRight, CalendarDays, CalendarClock, CheckCircle2, FolderKanban, PenLine, RotateCcw, Trash2, type LucideIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import type { AssistantAction } from "../../lib/api/assistant";
import { formatLongDay, parseDateTime } from "../../lib/dates";

/** Wie weit ein Vorschlag ist: offen, wird gerade ausgeführt, ausgeführt oder verworfen. */
export type ActionStatus = "open" | "working" | "done" | "dismissed";

export interface ActionItem {
  key: number;
  data: AssistantAction;
  status: ActionStatus;
  error?: string;
}

interface KindInfo {
  icon: LucideIcon;
  /** Kopfzeile, solange offen, und danach */
  open: string;
  done: string;
  confirm: string;
  working: string;
  dismiss: string;
  danger?: boolean;
}

const KINDS: Record<AssistantAction["kind"], KindInfo> = {
  task_done: { icon: CheckCircle2, open: "Aufgabe abhaken", done: "Aufgabe abgehakt", confirm: "Abhaken", working: "Hake ab …", dismiss: "Verwerfen" },
  task_reopen: { icon: RotateCcw, open: "Aufgabe wieder öffnen", done: "Aufgabe wieder geöffnet", confirm: "Wieder öffnen", working: "Öffne …", dismiss: "Verwerfen" },
  task_delete: { icon: Trash2, open: "Aufgabe löschen", done: "Aufgabe gelöscht", confirm: "Aufgabe löschen", working: "Lösche …", dismiss: "Behalten", danger: true },
  task_update: { icon: PenLine, open: "Aufgabe ändern", done: "Aufgabe geändert", confirm: "Übernehmen", working: "Übernehme …", dismiss: "Verwerfen" },
  event_update: { icon: CalendarClock, open: "Termin ändern", done: "Termin geändert", confirm: "Übernehmen", working: "Übernehme …", dismiss: "Verwerfen" },
};

interface ActionCardProps {
  item: ActionItem;
  onConfirm: () => void;
  onDismiss: () => void;
  onShow: () => void;
}

/**
 * Vorschlag des Assistenten, etwas Bestehendes zu ändern, abzuhaken oder zu löschen, als Karte im Chat.
 * Änderungen zeigen je Feld, was bisher galt und was gelten soll. Ausgeführt wird erst nach der Bestätigung.
 */
export function ActionCard({ item, onConfirm, onDismiss, onShow }: ActionCardProps) {
  const { data, status, error } = item;
  const info = KINDS[data.kind];
  const Icon = info.icon;
  const done = status === "done" || status === "dismissed";
  const isDelete = data.kind === "task_delete";
  const isUpdate = data.kind === "task_update" || data.kind === "event_update";

  return (
    <article className={`as-proposal as-action ${info.danger ? "as-danger " : ""}${status}`} aria-label={`${info.open}: ${data.title}`}>
      <header className="as-prop-head">
        <Icon size={14} />
        <span>{status === "done" ? info.done : status === "dismissed" ? `${info.open} – abgelehnt` : info.open}</span>
      </header>

      <h3 className="as-prop-title">{data.title}</h3>

      {!isUpdate && (data.bucket || data.dueDate) && (
        <ul className="as-prop-rows">
          {data.bucket && (
            <li>
              <FolderKanban size={13} />
              <span>{data.bucket}</span>
            </li>
          )}
          {data.dueDate && (
            <li>
              <CalendarDays size={13} />
              <span>Fällig {formatLongDay(parseDateTime(`${data.dueDate} 00:00`))}</span>
            </li>
          )}
        </ul>
      )}

      {isUpdate && data.changes.length > 0 && (
        <ul className="as-changes">
          {data.changes.map((c) => (
            <li key={c.label}>
              <span className="as-change-label">{c.label}</span>
              <span className="as-change-values">
                {c.before && <s className="as-before">{c.before}</s>}
                {c.before && c.after && <ArrowRight size={11} className="as-arrow" />}
                {c.after ? <span className="as-after">{c.after}</span> : <span className="as-removed">entfällt</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isDelete && data.changes.length > 0 && !done && (
        <p className="as-prop-warn">
          <AlertTriangle size={13} />
          <span>{data.changes.map((c) => `${c.label}: ${c.before ?? ""}`).join(" · ")}</span>
        </p>
      )}

      {error && <p className="as-prop-error">{error}</p>}

      {!done && (
        <div className="as-prop-actions">
          {info.danger ? (
            <SecondaryButton className="danger sm" disabled={status === "working"} onClick={onConfirm}>
              {status === "working" ? info.working : info.confirm}
            </SecondaryButton>
          ) : (
            <Button className="sm" disabled={status === "working"} onClick={onConfirm}>
              {status === "working" ? info.working : info.confirm}
            </Button>
          )}
          <button type="button" className="as-prop-dismiss" disabled={status === "working"} onClick={onDismiss}>
            {info.dismiss}
          </button>
        </div>
      )}

      {status === "done" && !isDelete && (
        <button type="button" className="as-prop-link" onClick={onShow}>
          {data.kind === "event_update" ? "Im Kalender zeigen" : "In den Aufgaben zeigen"}
        </button>
      )}
    </article>
  );
}
