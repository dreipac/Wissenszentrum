import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { SettingsModal, type SettingsSection } from "../components/settings/SettingsModal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "../components/ui/ContextMenu";
import { deleteBucket, listTasks } from "./api/tasks";
import { BucketModal } from "../components/tasks/BucketModal";
import { TaskModal } from "../components/tasks/TaskModal";
import type { Bucket, Task } from "./tasks";

type Dialog =
  | { kind: "task"; task?: Task; bucketId: number | null }
  | { kind: "bucket"; bucket?: Bucket }
  | { kind: "settings"; section?: SettingsSection }
  | null;

interface Dialogs {
  /** Dialog „Neue Aufgabe“, optional mit vorausgewähltem Bucket. */
  openNewTask: (bucketId?: number | null) => void;
  openEditTask: (task: Task) => void;
  openNewBucket: () => void;
  openEditBucket: (bucket: Bucket) => void;
  /** Öffnet die Einstellungen, optional direkt in einem Bereich */
  openSettings: (section?: SettingsSection) => void;
  /** Kontextmenü eines Buckets an der Mausposition: Aufgabe hinzufügen, bearbeiten, löschen */
  openBucketMenu: (bucket: Bucket, x: number, y: number) => void;
  /** Kontextmenü auf freier Fläche der Bucket-Ansicht: neuer Bucket, neue Aufgabe */
  openBoardMenu: (x: number, y: number) => void;
}

const DialogsContext = createContext<Dialogs | null>(null);

/** Hält die globalen Dialoge, damit sie aus jeder Ansicht und der Sidebar heraus geöffnet werden können. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [deleting, setDeleting] = useState<{ bucket: Bucket; count: number; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setDialog(null), []);

  const value = useMemo<Dialogs>(
    () => ({
      openNewTask: (bucketId = null) => setDialog({ kind: "task", bucketId }),
      openEditTask: (task) => setDialog({ kind: "task", task, bucketId: task.bucketId }),
      openNewBucket: () => setDialog({ kind: "bucket" }),
      openEditBucket: (bucket) => setDialog({ kind: "bucket", bucket }),
      openSettings: (section) => setDialog({ kind: "settings", section }),
      openBucketMenu: (bucket, x, y) =>
        setMenu({
          x,
          y,
          items: [
            { label: "Aufgabe hinzufügen", icon: Plus, onClick: () => setDialog({ kind: "task", bucketId: bucket.id }) },
            { label: "Bearbeiten", icon: Pencil, onClick: () => setDialog({ kind: "bucket", bucket }) },
            {
              label: "Löschen",
              icon: Trash2,
              // Die Zahl der betroffenen Aufgaben steht in der Rückfrage
              onClick: () =>
                void listTasks()
                  .then((all) => all.filter((t) => t.bucketId === bucket.id).length)
                  .catch(() => 0)
                  .then((count) => setDeleting({ bucket, count, error: null })),
            },
          ],
        }),
      openBoardMenu: (x, y) =>
        setMenu({
          x,
          y,
          items: [
            { label: "Neuer Bucket", icon: FolderPlus, onClick: () => setDialog({ kind: "bucket" }) },
            { label: "Neue Aufgabe", icon: Plus, onClick: () => setDialog({ kind: "task", bucketId: null }) },
          ],
        }),
    }),
    [],
  );

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteBucket(deleting.bucket.id);
      setDeleting(null);
    } catch (e) {
      setDeleting({ ...deleting, error: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogsContext.Provider value={value}>
      {children}
      {dialog?.kind === "task" && (
        <TaskModal key={dialog.task?.id ?? "new"} task={dialog.task} bucketId={dialog.bucketId} onClose={close} />
      )}
      {dialog?.kind === "bucket" && <BucketModal key={dialog.bucket?.id ?? "new"} bucket={dialog.bucket} onClose={close} />}
      {dialog?.kind === "settings" && <SettingsModal initial={dialog.section} onClose={close} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Bucket löschen?"
          message={
            deleting.error ??
            (deleting.count === 0
              ? `„${deleting.bucket.name}“ ist leer und wird entfernt.`
              : deleting.count === 1
                ? `„${deleting.bucket.name}“ wird entfernt. Die Aufgabe bleibt erhalten und steht danach unter „Ohne Bucket“.`
                : `„${deleting.bucket.name}“ wird entfernt. Die ${deleting.count} Aufgaben bleiben erhalten und stehen danach unter „Ohne Bucket“.`)
          }
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useDialogs muss innerhalb von DialogsProvider verwendet werden.");
  return ctx;
}
