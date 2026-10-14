import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { createBucket, deleteBucket, updateBucket } from "../../lib/api/tasks";
import type { Bucket } from "../../lib/tasks";
import { useTasks } from "../../lib/useTasks";
import "./TaskModal.css";

interface BucketModalProps {
  /** Ohne Angabe wird ein neuer Bucket angelegt, sonst dieser bearbeitet. */
  bucket?: Bucket;
  onClose: () => void;
}

export function BucketModal({ bucket, onClose }: BucketModalProps) {
  const editing = bucket !== undefined;
  const { buckets, tasks } = useTasks();

  const [name, setName] = useState(bucket?.name ?? "");
  const [target, setTarget] = useState<number | null>(bucket?.onCompleteBucketId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Ziel kann jeder andere Bucket sein, nur nicht der Bucket selbst
  const targets = buckets.filter((b) => b.id !== bucket?.id);
  const taskCount = bucket ? tasks.filter((t) => t.bucketId === bucket.id).length : 0;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const save = () => {
    if (!name.trim()) return setError("Bitte gib einen Namen ein.");
    const input = { name, onCompleteBucketId: target };
    void run(() => (editing ? updateBucket(bucket.id, input) : createBucket(input)));
  };

  return (
    <Modal
      title={editing ? "Bucket bearbeiten" : "Neuer Bucket"}
      width={500}
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
            {editing ? "Speichern" : "Bucket erstellen"}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="bucket-name">Name</label>
        <input
          id="bucket-name"
          className="field-control"
          value={name}
          autoFocus
          maxLength={60}
          placeholder="z. B. In Arbeit"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </div>

      <div className="field">
        <label htmlFor="bucket-target">Beim Abhaken verschieben nach</label>
        <select
          id="bucket-target"
          className="field-control bucket-select"
          value={target ?? ""}
          disabled={targets.length === 0}
          onChange={(e) => setTarget(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Nichts tun (Standard)</option>
          {targets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && bucket && (
        <ConfirmDialog
          title="Bucket löschen?"
          message={
            taskCount === 0
              ? `„${bucket.name}“ ist leer und wird entfernt.`
              : taskCount === 1
                ? `„${bucket.name}“ wird entfernt. Die Aufgabe bleibt erhalten und steht danach unter „Ohne Bucket“.`
                : `„${bucket.name}“ wird entfernt. Die ${taskCount} Aufgaben bleiben erhalten und stehen danach unter „Ohne Bucket“.`
          }
          busy={busy}
          onConfirm={() => void run(() => deleteBucket(bucket.id))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
