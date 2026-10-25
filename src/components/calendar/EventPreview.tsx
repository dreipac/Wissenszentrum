import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlignLeft, Clock, MapPin } from "lucide-react";
import { SecondaryButton } from "../ui/SecondaryButton";
import { formatTimeRange, type CalendarEvent } from "../../lib/calendar";
import { formatLongDay, parseDateTime } from "../../lib/dates";
import { useTasks } from "../../lib/useTasks";
import { EventLinkedTasks } from "./EventLinkedTasks";

const WIDTH = 288;
const GAP = 12; // Abstand zum Termin (Platz für den Pfeil)
const MARGIN = 12; // Mindestabstand zum Fensterrand

export interface PreviewTarget {
  event: CalendarEvent;
  rect: DOMRect;
}

interface EventPreviewProps {
  target: PreviewTarget;
  onClose: () => void;
  onEdit: (e: CalendarEvent) => void;
}

/**
 * Kleine Vorschau-Blase rechts (bzw. links, wenn kein Platz ist) neben einem Termin.
 * Sie hat keinen Hintergrund-Layer und blockiert nichts: ein Klick außerhalb schließt sie
 * und geht trotzdem an das Element darunter durch.
 */
export function EventPreview({ target, onClose, onEdit }: EventPreviewProps) {
  const { event, rect } = target;
  const ref = useRef<HTMLDivElement>(null);
  const { tasks } = useTasks();
  // Die Aufgaben laden nach und machen die Blase höher: Position danach neu bestimmen
  const linkedCount = tasks.filter((t) => t.eventId === event.id).length;
  const [pos, setPos] = useState<{ left: number; top: number; side: "left" | "right"; arrowY: number } | null>(null);

  // Position erst nach dem Messen der Höhe festlegen (verhindert Springen)
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const fitsRight = rect.right + GAP + WIDTH + MARGIN <= window.innerWidth;
    const side = fitsRight ? "right" : "left";
    const left = fitsRight ? rect.right + GAP : Math.max(MARGIN, rect.left - GAP - WIDTH);
    const top = Math.min(Math.max(rect.top, MARGIN), Math.max(MARGIN, window.innerHeight - height - MARGIN));
    const anchorY = rect.top + Math.min(rect.height, 56) / 2;
    const arrowY = Math.min(Math.max(anchorY - top, 18), Math.max(18, height - 18));
    setPos({ left, top, side, arrowY });
  }, [rect, event.id, linkedCount]);

  useEffect(() => {
    // Capture-Phase: Die Termin-Elemente stoppen die Weitergabe von mousedown selbst.
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (ref.current?.contains(el)) return;
      // Erneuter Klick auf denselben Termin (z. B. Beginn eines Doppelklicks) lässt die Blase stehen
      if (el.closest(`[data-event-id="${event.id}"]`)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Scrollen verschiebt den Termin unter der Blase weg
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [event.id, onClose]);

  const start = parseDateTime(event.startsAt);
  const sameDay = event.startsAt.slice(0, 10) === event.endsAt.slice(0, 10);
  const dateLine = sameDay ? formatLongDay(start) : `${formatLongDay(start)} – ${formatLongDay(parseDateTime(event.endsAt))}`;

  return (
    <div
      ref={ref}
      className={`event-preview ${pos?.side ?? "right"}`}
      style={
        {
          width: WIDTH,
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          visibility: pos ? "visible" : "hidden",
          "--arrow-y": `${pos?.arrowY ?? 20}px`,
        } as React.CSSProperties
      }
      role="dialog"
      aria-label={`Vorschau: ${event.title}`}
    >
      <span className="event-preview-arrow" />
      <div className="event-preview-head">
        <span className="event-preview-bar" />
        <h3 className="event-preview-title">{event.title}</h3>
      </div>

      <div className="event-preview-rows">
        <div className="event-preview-row">
          <Clock size={14} />
          <span>
            {dateLine}
            <br />
            <span className="muted">{formatTimeRange(event)}</span>
          </span>
        </div>
        {event.location && (
          <div className="event-preview-row">
            <MapPin size={14} />
            <span>{event.location}</span>
          </div>
        )}
        {event.description && (
          <div className="event-preview-row">
            <AlignLeft size={14} />
            <span className="event-preview-desc">{event.description}</span>
          </div>
        )}
        <EventLinkedTasks event={event} tasks={tasks} rowClass="event-preview-row" />
      </div>

      <div className="event-preview-foot">
        <span className="event-preview-hint">Doppelklick zum Bearbeiten</span>
        <SecondaryButton className="sm" onClick={() => onEdit(event)}>
          Bearbeiten
        </SecondaryButton>
      </div>
    </div>
  );
}
