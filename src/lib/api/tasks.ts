import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type { Bucket, BucketInput, Task, TaskInput } from "../tasks";
import { tasksStore } from "./browserStore";
import { inTauri } from "./runtime";

export const listBuckets = (): Promise<Bucket[]> => (inTauri ? invoke("list_buckets") : tasksStore.listBuckets());

export const listTasks = (): Promise<Task[]> => (inTauri ? invoke("list_tasks") : tasksStore.listTasks());

/** Nach jeder Änderung werden alle Aufgaben-Ansichten benachrichtigt. */
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("tasks");
  return value;
}

export const createBucket = (input: BucketInput): Promise<Bucket> =>
  changed(inTauri ? invoke("create_bucket", { input }) : tasksStore.createBucket(input));

export const updateBucket = (id: number, input: BucketInput): Promise<Bucket> =>
  changed(inTauri ? invoke("update_bucket", { id, input }) : tasksStore.updateBucket(id, input));

/** Neue Reihenfolge der Buckets (alle IDs, von links nach rechts). */
export const reorderBuckets = (ids: number[]): Promise<void> =>
  changed(inTauri ? invoke("reorder_buckets", { ids }) : tasksStore.reorderBuckets(ids));

/** Löscht den Bucket; seine Aufgaben bleiben erhalten und stehen danach ohne Bucket da. */
export const deleteBucket = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_bucket", { id }) : tasksStore.deleteBucket(id));

export const createTask = (input: TaskInput): Promise<Task> =>
  changed(inTauri ? invoke("create_task", { input }) : tasksStore.createTask(input));

export const updateTask = (id: number, input: TaskInput): Promise<Task> =>
  changed(inTauri ? invoke("update_task", { id, input }) : tasksStore.updateTask(id, input));

export const deleteTask = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_task", { id }) : tasksStore.deleteTask(id));

/** Drag & Drop: Aufgabe in einen Bucket (null = ohne Bucket) direkt vor eine andere Aufgabe legen (null = ans Ende). */
export const moveTask = (id: number, bucketId: number | null, beforeTaskId: number | null): Promise<Task> =>
  changed(
    inTauri ? invoke("move_task", { id, bucketId, beforeTaskId }) : tasksStore.moveTask(id, bucketId, beforeTaskId),
  );

/** Hakt ab/öffnet wieder. Beim Abhaken kann die Bucket-Regel die Aufgabe automatisch verschieben. */
export const setTaskDone = (id: number, done: boolean): Promise<Task> =>
  changed(inTauri ? invoke("set_task_done", { id, done }) : tasksStore.setDone(id, done));
