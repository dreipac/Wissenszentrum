import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Platform, View } from "react-native";
import { EventForm } from "@/components/EventForm";
import { TaskRow } from "@/components/TaskRow";
import { SectionTitle } from "@/components/ui/Bits";
import { ListGroup } from "@/components/ui/Card";
import { Button } from "@/components/ui/Controls";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import type { EventDraft } from "@/data/types";
import { open } from "@/lib/nav";

/** Termin ansehen und ändern. Änderungen gelten sofort. */
export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const event = useStore((s) => s.events.find((e) => e.id === Number(id)));
  const linked = useStore((s) => s.tasks.filter((t) => t.eventId === Number(id)));
  const { updateEvent, deleteEvent } = useStore.getState();
  const [draft, setDraft] = useState<EventDraft | null>(() =>
    event ? { title: event.title, description: event.description, location: event.location, startsAt: event.startsAt, endsAt: event.endsAt, allDay: event.allDay } : null,
  );

  if (!event || !draft) {
    return (
      <Screen variant="bar" title="Termin">
        <Txt tone="muted">Diesen Termin gibt es nicht mehr.</Txt>
      </Screen>
    );
  }

  const change = (next: EventDraft) => {
    setDraft(next);
    if (next.title.trim()) updateEvent(event.id, { ...next, title: next.title.trim() });
  };

  const remove = () => {
    const doDelete = () => {
      deleteEvent(event.id);
      router.back();
    };
    if (Platform.OS === "web") return doDelete();
    Alert.alert("Termin löschen?", linked.length ? "Aufgaben an diesem Termin bleiben bestehen." : "Das lässt sich nicht rückgängig machen.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: doDelete },
    ]);
  };

  return (
    <Screen variant="bar" title="Termin">
      <EventForm draft={draft} onChange={change} />
      {linked.length > 0 && (
        <View>
          <SectionTitle title="Aufgaben an diesem Termin" />
          <ListGroup>
            {linked.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={() => open(`/tasks/${t.id}`)} />
            ))}
          </ListGroup>
        </View>
      )}
      <View style={{ marginTop: 24 }}>
        <Button label="Löschen" icon="trash" variant="danger" onPress={remove} />
      </View>
    </Screen>
  );
}
