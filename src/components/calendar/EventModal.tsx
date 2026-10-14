import { useState } from "react";
import { AlignLeft, ArrowRight, Clock, MapPin } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type { EventDraft } from "../../lib/calendar";
import { createEvent, deleteEvent, updateEvent } from "../../lib/api/events";
import "./EventModal.css";

interface EventModalProps {
  draft: EventDraft;
  onClose: () => void;
  /** Wird nach Speichern oder Löschen aufgerufen, damit die Ansicht neu lädt. */
  onChanged: () => void;
}

export function EventModal({ draft, onClose, onChanged }: EventModalProps) {
  const editing = draft.id !== undefined;

  const [title, setTitle] = useState(draft.title ?? "");
  const [allDay, setAllDay] = useState(draft.allDay ?? false);
  const [startDate, setStartDate] = useState(draft.startsAt.slice(0, 10));
  const [startTime, setStartTime] = useState(draft.startsAt.slice(11) || "09:00");
  const [endDate, setEndDate] = useState(draft.endsAt.slice(0, 10));
  const [endTime, setEndTime] = useState(draft.endsAt.slice(11) || "10:00");
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startsAt = `${startDate} ${allDay ? "00:00" : startTime}`;
  const endsAt = `${endDate} ${allDay ? "23:59" : endTime}`;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const save = () => {
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    if (!startDate || !endDate) return setError("Bitte Datum angeben.");
    if (endsAt <= startsAt) return setError("Das Ende muss nach dem Beginn liegen.");
    const input = { title: title.trim(), description, location, startsAt, endsAt, allDay };
    void run(() => (editing ? updateEvent(draft.id!, input) : createEvent(input)));
  };

  const onStartDate = (value: string) => {
    setStartDate(value);
    if (value && endDate < value) setEndDate(value);
  };

  return (
    <Modal
      title={editing ? "Termin bearbeiten" : "Neuer Termin"}
      width={760}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <SecondaryButton className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Löschen
            </SecondaryButton>
          )}
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy} onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <input
        className="ev-title"
        value={title}
        autoFocus
        placeholder="Titel hinzufügen"
        aria-label="Titel"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />

      <div className="ev-row">
        <Clock size={18} className="ev-icon" />
        <div className="ev-row-body">
          <div className="ev-datetime">
            <input type="date" className="field-control" aria-label="Beginn Datum" value={startDate} onChange={(e) => onStartDate(e.target.value)} />
            {!allDay && (
              <input type="time" className="field-control" aria-label="Beginn Uhrzeit" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            )}
            <ArrowRight size={16} className="ev-arrow" />
            {!allDay && (
              <input type="time" className="field-control" aria-label="Ende Uhrzeit" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            )}
            <input type="date" className="field-control" aria-label="Ende Datum" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span className={`check${allDay ? " checked" : ""}`} />
            Ganztägig
          </label>
        </div>
      </div>

      <div className="ev-row">
        <MapPin size={18} className="ev-icon" />
        <div className="ev-row-body">
          <input className="field-control" aria-label="Ort" value={location} placeholder="Ort hinzufügen" onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <div className="ev-row top">
        <AlignLeft size={18} className="ev-icon" />
        <div className="ev-row-body">
          <textarea className="field-control ev-description" aria-label="Beschreibung" value={description} placeholder="Beschreibung hinzufügen" onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && (
        <ConfirmDialog
          title="Termin löschen?"
          message={`„${title.trim() || "Ohne Titel"}“ wird dauerhaft gelöscht.`}
          busy={busy}
          onConfirm={() => void run(() => deleteEvent(draft.id!))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
