import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable } from "react-native";
import { TaskForm } from "@/components/TaskForm";
import { tap } from "@/components/ui/Controls";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import type { TaskDraft } from "@/data/types";
import { addDays, startOfDay, toDateStr } from "@/lib/dates";

/** Neue Aufgabe als Blatt von unten: erst mit „Sichern“ wird sie angelegt. Aus einer Bucket-Liste kommt der Bucket vor. */
export default function NewTask() {
  const { bucket } = useLocalSearchParams<{ bucket?: string }>();
  const [draft, setDraft] = useState<TaskDraft>(() => ({
    bucketId: bucket ? Number(bucket) : null,
    title: "",
    description: "",
    priority: "medium",
    dueDate: toDateStr(addDays(startOfDay(new Date()), 0)),
    eventId: null,
    subtasks: [],
  }));
  const canSave = draft.title.trim().length > 0;

  const save = () => {
    useStore.getState().createTask({ ...draft, title: draft.title.trim() });
    tap("success");
    router.back();
  };

  return (
    <Screen
      variant="bar"
      title="Neue Aufgabe"
      bottomInset
      left={
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Txt tone="accent">Abbrechen</Txt>
        </Pressable>
      }
      right={
        <Pressable onPress={save} disabled={!canSave} hitSlop={10} style={{ opacity: canSave ? 1 : 0.4 }}>
          <Txt tone="accent" style={{ fontWeight: "700" }}>
            Sichern
          </Txt>
        </Pressable>
      }>
      <TaskForm draft={draft} onChange={setDraft} />
    </Screen>
  );
}
