import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable } from "react-native";
import { EventForm } from "@/components/EventForm";
import { tap } from "@/components/ui/Controls";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import type { EventDraft } from "@/data/types";
import { toDateStr } from "@/lib/dates";

/** Neuer Termin als Blatt von unten. Der Tag kommt vom gewählten Tag im Kalender. */
export default function NewEvent() {
  const { day } = useLocalSearchParams<{ day?: string }>();
  const [draft, setDraft] = useState<EventDraft>(() => {
    const d = day ?? toDateStr(new Date());
    return { title: "", description: "", location: "", startsAt: `${d} 09:00`, endsAt: `${d} 10:00`, allDay: false };
  });
  const canSave = draft.title.trim().length > 0;

  const save = () => {
    useStore.getState().createEvent({ ...draft, title: draft.title.trim() });
    tap("success");
    router.back();
  };

  return (
    <Screen
      variant="bar"
      title="Neuer Termin"
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
      <EventForm draft={draft} onChange={setDraft} />
    </Screen>
  );
}
