import { CalendarDays, CalendarCheck, Flag, FolderKanban, ListChecks, ListPlus, ListX } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import type { TaskProposal } from "../../lib/api/assistant";
import { formatLongDay, parseDateTime } from "../../lib/dates";
import { priorityLabel, type Priority } from "../../lib/tasks";

/** Wie weit ein Aufgabenvorschlag ist: offen, wird gerade angelegt, angelegt oder verworfen. */
export type TaskProposalStatus = "open" | "creating" | "created" | "dismissed";

export interface TaskProposalItem {
  key: number;
  data: TaskProposal;
  status: TaskProposalStatus;
  error?: string;
}

interface TaskProposalCardProps {
  item: TaskProposalItem;
  /** Farbe des Buckets (Farbschlüssel) für den Punkt vor dem Namen */
  bucketColor: string;
  onCreate: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onShow: () => void;
}

/**
 * Aufgabenvorschlag des Assistenten als Karte im Chat. Angelegt wird erst nach „Anlegen“; „Bearbeiten“ öffnet den
 * üblichen Aufgaben-Dialog mit den vorgeschlagenen Angaben.
 */
export function TaskProposalCard({ item, bucketColor, onCreate, onEdit, onDismiss, onShow }: TaskProposalCardProps) {
  const { data, status, error } = item;
  const done = status === "created" || status === "dismissed";
  const priority = data.priority as Priority;

  return (
    <article className={`as-proposal as-task ${status}`} aria-label={`Aufgabenvorschlag: ${data.title}`}>
      <header className="as-prop-head">
        {status === "created" ? <CalendarCheck size={14} /> : status === "dismissed" ? <ListX size={14} /> : <ListPlus size={14} />}
        <span>{status === "created" ? "Angelegt" : status === "dismissed" ? "Verworfen" : "Aufgabenvorschlag"}</span>
      </header>

      <h3 className="as-prop-title">{data.title}</h3>

      <ul className="as-prop-rows">
        <li>
          <FolderKanban size={13} />
          <span className="as-prop-bucket">
            {data.bucketName ? (
              <>
                {bucketColor && <i className="as-dot" style={{ backgroundColor: `var(--bucket-${bucketColor})` }} />}
                {data.bucketName}
              </>
            ) : (
              <span className="as-prop-muted">Ohne Bucket</span>
            )}
          </span>
        </li>
        <li>
          <Flag size={13} />
          <span className="as-prop-bucket">
            <span className={`priority ${priority}`} />
            {priorityLabel[priority] ?? data.priority}
          </span>
        </li>
        {data.dueDate && (
          <li>
            <CalendarDays size={13} />
            <span>Fällig {formatLongDay(parseDateTime(`${data.dueDate} 00:00`))}</span>
          </li>
        )}
        {data.subtasks.length > 0 && !done && (
          <li>
            <ListChecks size={13} />
            <ul className="as-prop-steps">
              {data.subtasks.map((s, i) => (
                <li key={`${i}-${s}`}>{s}</li>
              ))}
            </ul>
          </li>
        )}
        {data.description && !done && (
          <li>
            <span className="as-prop-gap" />
            <span className="as-prop-desc">{data.description}</span>
          </li>
        )}
      </ul>

      {error && <p className="as-prop-error">{error}</p>}

      {!done && (
        <div className="as-prop-actions">
          <Button className="sm" disabled={status === "creating"} onClick={onCreate}>
            {status === "creating" ? "Lege an …" : "Anlegen"}
          </Button>
          <SecondaryButton className="sm" disabled={status === "creating"} onClick={onEdit}>
            Bearbeiten
          </SecondaryButton>
          <button type="button" className="as-prop-dismiss" disabled={status === "creating"} onClick={onDismiss}>
            Verwerfen
          </button>
        </div>
      )}

      {status === "created" && (
        <button type="button" className="as-prop-link" onClick={onShow}>
          In den Aufgaben zeigen
        </button>
      )}
    </article>
  );
}
