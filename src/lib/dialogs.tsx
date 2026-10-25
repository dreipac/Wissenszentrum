import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Circle, Flag, FolderKanban, FolderPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { SettingsModal, type SettingsSection } from "../components/settings/SettingsModal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "../components/ui/ContextMenu";
import { deleteBucket, deleteTask, listBuckets, listTasks, moveTask, updateTask } from "./api/tasks";
import { MOVE_DELAY_MS, toggleTask } from "./taskAnimation";
import { BucketModal } from "../components/tasks/BucketModal";
import { TaskModal } from "../components/tasks/TaskModal";
import { priorities, priorityLabel, taskToInput, type Bucket, type Task } from "./tasks";

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
  /** Kontextmenü einer Aufgabe: bearbeiten, abhaken, Priorität, in anderen Bucket verschieben, löschen */
  openTaskMenu: (task: Task, x: number, y: number) => void;
  /** Kontextmenü auf freier Fläche der Bucket-Ansicht: neuer Bucket, neue Aufgabe */
  openBoardMenu: (x: number, y: number) => void;
}

const DialogsContext = createContext<Dialogs | null>(null);

/** Hält die globalen Dialoge, damit sie aus jeder Ansicht und der Sidebar heraus geöffnet werden können. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [deleting, setDeleting] = useState<{ bucket: Bucket; count: number; error: string | null } | null>(null);
  const [deletingTask, setDeletingTask] = useState<{ task: Task; error: string | null } | null>(null);
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
      openTaskMenu: (task, x, y) =>
        // Die Buckets stehen für „Verschieben nach“ im Menü; schlägt das Laden fehl, fehlt nur dieser Teil
        void listBuckets()
          .catch(() => [] as Bucket[])
          .then((buckets) => {
            const items: ContextMenuItem[] = [
              { label: "Bearbeiten", icon: Pencil, onClick: () => setDialog({ kind: "task", task, bucketId: task.bucketId }) },
              {
                label: task.done ? "Wieder öffnen" : "Als erledigt markieren",
                icon: task.done ? Circle : CheckCircle2,
                onClick: () => toggleTask(task, task.done ? 0 : MOVE_DELAY_MS),
              },
              ...priorities
                .filter((p) => p !== task.priority)
                .map<ContextMenuItem>((p, i) => ({
                  label: `Priorität ${priorityLabel[p].toLowerCase()}`,
                  icon: Flag,
                  divider: i === 0,
                  onClick: () => void updateTask(task.id, taskToInput(task, { priority: p })).catch(() => undefined),
                })),
              ...[null, ...buckets.map((b) => b.id)]
                .filter((id) => id !== task.bucketId)
                .map<ContextMenuItem>((id, i) => ({
                  label: id === null ? "Aus dem Bucket nehmen" : `Nach „${buckets.find((b) => b.id === id)!.name}“ verschieben`,
                  icon: FolderKanban,
                  divider: i === 0,
                  onClick: () => void moveTask(task.id, id, null).catch(() => undefined),
                })),
              { label: "Löschen", icon: Trash2, danger: true, divider: true, onClick: () => setDeletingTask({ task, error: null }) },
            ];
            setMenu({ x, y, items });
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

  const confirmDeleteTask = async () => {
    if (!deletingTask) return;
    setBusy(true);
    try {
      await deleteTask(deletingTask.task.id);
      setDeletingTask(null);
    } catch (e) {
      setDeletingTask({ ...deletingTask, error: String(e) });
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
      {deletingTask && (
        <ConfirmDialog
          title="Aufgabe löschen?"
          message={deletingTask.error ?? `„${deletingTask.task.title}“ wird dauerhaft gelöscht, samt Zwischenschritten.`}
          busy={busy}
          onConfirm={() => void confirmDeleteTask()}
          onCancel={() => setDeletingTask(null)}
        />
      )}
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
