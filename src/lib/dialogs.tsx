import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { SettingsModal } from "../components/settings/SettingsModal";
import { BucketModal } from "../components/tasks/BucketModal";
import { TaskModal } from "../components/tasks/TaskModal";
import type { Bucket, Task } from "./tasks";

type Dialog =
  | { kind: "task"; task?: Task; bucketId: number | null }
  | { kind: "bucket"; bucket?: Bucket }
  | { kind: "settings" }
  | null;

interface Dialogs {
  /** Dialog „Neue Aufgabe“, optional mit vorausgewähltem Bucket. */
  openNewTask: (bucketId?: number | null) => void;
  openEditTask: (task: Task) => void;
  openNewBucket: () => void;
  openEditBucket: (bucket: Bucket) => void;
  openSettings: () => void;
}

const DialogsContext = createContext<Dialogs | null>(null);

/** Hält die globalen Dialoge, damit sie aus jeder Ansicht und der Sidebar heraus geöffnet werden können. */
export function DialogsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = useCallback(() => setDialog(null), []);

  const value = useMemo<Dialogs>(
    () => ({
      openNewTask: (bucketId = null) => setDialog({ kind: "task", bucketId }),
      openEditTask: (task) => setDialog({ kind: "task", task, bucketId: task.bucketId }),
      openNewBucket: () => setDialog({ kind: "bucket" }),
      openEditBucket: (bucket) => setDialog({ kind: "bucket", bucket }),
      openSettings: () => setDialog({ kind: "settings" }),
    }),
    [],
  );

  return (
    <DialogsContext.Provider value={value}>
      {children}
      {dialog?.kind === "task" && (
        <TaskModal key={dialog.task?.id ?? "new"} task={dialog.task} bucketId={dialog.bucketId} onClose={close} />
      )}
      {dialog?.kind === "bucket" && <BucketModal key={dialog.bucket?.id ?? "new"} bucket={dialog.bucket} onClose={close} />}
      {dialog?.kind === "settings" && <SettingsModal onClose={close} />}
    </DialogsContext.Provider>
  );
}

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogsContext);
  if (!ctx) throw new Error("useDialogs muss innerhalb von DialogsProvider verwendet werden.");
  return ctx;
}
