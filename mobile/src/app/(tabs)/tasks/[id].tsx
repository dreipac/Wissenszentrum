import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { TaskForm } from "@/components/TaskForm";
import { SectionTitle } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Controls";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import type { TaskDraft } from "@/data/types";
import { goTo } from "@/lib/nav";
import { eventOf } from "@/lib/tasks";

/** Aufgabe ansehen und ändern. Änderungen gelten sofort. */
export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = useStore((s) => s.tasks.find((t) => t.id === Number(id)));
  const event = useStore((s) => eventOf(s.events, task?.eventId ?? null));
  const { updateTask, deleteTask, toggleTask } = useStore.getState();
  // Beim Öffnen den Stand der Aufgabe als Entwurf übernehmen
  const [draft, setDraft] = useState<TaskDraft | null>(() =>
    task ? { bucketId: task.bucketId, title: task.title, description: task.description, priority: task.priority, dueDate: task.dueDate, eventId: task.eventId, subtasks: task.subtasks } : null,
  );

  if (!task || !draft) {
    return (
      <Screen variant="bar" title="Aufgabe">
        <Txt tone="muted">Diese Aufgabe gibt es nicht mehr.</Txt>
      </Screen>
    );
  }

  const change = (next: TaskDraft) => {
    setDraft(next);
    // Ohne Titel wird nicht gespeichert
    if (next.title.trim()) updateTask(task.id, { ...next, title: next.title.trim() });
  };

  const remove = () => {
    const doDelete = () => {
      deleteTask(task.id);
      router.back();
    };
    if (Platform.OS === "web") return doDelete();
    Alert.alert("Aufgabe löschen?", "Das lässt sich nicht rückgängig machen.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: doDelete },
    ]);
  };

  return (
    <Screen variant="bar" title="Aufgabe">
      <TaskForm draft={draft} onChange={change} />
      {event && (
        <View>
          <SectionTitle title="Termin" />
          <Button label={event.title} icon="calendar" variant="secondary" onPress={() => goTo(`/calendar/${event.id}`)} />
        </View>
      )}
      <View style={{ gap: 12, marginTop: 24 }}>
        <Button
          label={task.done ? "Wieder öffnen" : "Als erledigt markieren"}
          icon="check"
          onPress={() => {
            toggleTask(task.id);
            router.back();
          }}
        />
        <Button label="Löschen" icon="trash" variant="danger" onPress={remove} />
      </View>
    </Screen>
  );
}
