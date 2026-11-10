import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useStore } from "@/data/store";
import type { Priority, TaskDraft } from "@/data/types";
import { addDays, startOfDay, toDateStr } from "@/lib/dates";
import { PRIORITIES, formatDue, priorityLabel } from "@/lib/tasks";
import { space, useTheme } from "@/theme/theme";
import { SectionTitle } from "./ui/Bits";
import { ListGroup, Row } from "./ui/Card";
import { Chip, CheckCircle, Segmented } from "./ui/Controls";
import { Input } from "./ui/Fields";
import { Icon } from "./ui/Icon";
import { Txt } from "./ui/Txt";

interface TaskFormProps {
  draft: TaskDraft;
  onChange: (draft: TaskDraft) => void;
}

const inDays = (n: number) => toDateStr(addDays(startOfDay(new Date()), n));

const DUE_CHOICES: { label: string; value: string | null }[] = [
  { label: "Heute", value: inDays(0) },
  { label: "Morgen", value: inDays(1) },
  { label: "In 3 Tagen", value: inDays(3) },
  { label: "Nächste Woche", value: inDays(7) },
  { label: "Kein Datum", value: null },
];

/** Alle Angaben einer Aufgabe. Wird für „Neue Aufgabe“ und zum Bearbeiten verwendet. */
export function TaskForm({ draft, onChange }: TaskFormProps) {
  const theme = useTheme();
  const buckets = useStore((s) => s.buckets);
  const [newStep, setNewStep] = useState("");
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => onChange({ ...draft, [key]: value });

  const addStep = () => {
    const title = newStep.trim();
    if (!title) return;
    // Neue Zwischenschritte haben die Nummer 0, der Store vergibt echte Nummern beim Speichern
    set("subtasks", [...draft.subtasks, { id: 0, title, done: false }]);
    setNewStep("");
  };

  return (
    <View>
      <ListGroup>
        <Input value={draft.title} onChangeText={(v) => set("title", v)} placeholder="Titel" returnKeyType="done" autoFocus={draft.title === ""} />
        <Input value={draft.description} onChangeText={(v) => set("description", v)} placeholder="Notiz" multiline />
      </ListGroup>

      <SectionTitle title="Bucket" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="Ohne" active={draft.bucketId === null} onPress={() => set("bucketId", null)} />
        {buckets.map((b) => (
          <Chip key={b.id} label={b.name} dot={b.color ? theme.buckets[b.color] : undefined} active={draft.bucketId === b.id} onPress={() => set("bucketId", b.id)} />
        ))}
      </ScrollView>

      <SectionTitle title="Priorität" />
      <Segmented<Priority> value={draft.priority} onChange={(v) => set("priority", v)} options={PRIORITIES.map((p) => ({ value: p, label: priorityLabel[p] }))} />

      <SectionTitle title={draft.dueDate ? `Fällig: ${formatDue(draft.dueDate)}` : "Fällig"} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {DUE_CHOICES.map((c) => (
          <Chip key={c.label} label={c.label} active={draft.dueDate === c.value} onPress={() => set("dueDate", c.value)} />
        ))}
      </ScrollView>

      <SectionTitle title="Zwischenschritte" />
      <ListGroup>
        {draft.subtasks.map((st, i) => (
          <Row key={`${st.id}-${i}`}>
            <CheckCircle size={22} done={st.done} onToggle={() => set("subtasks", draft.subtasks.map((s, j) => (j === i ? { ...s, done: !s.done } : s)))} />
            <Txt variant="body" tone={st.done ? "faint" : "text"} style={[{ flex: 1 }, st.done && { textDecorationLine: "line-through" }]}>
              {st.title}
            </Txt>
            <Pressable hitSlop={10} accessibilityLabel="Zwischenschritt entfernen" onPress={() => set("subtasks", draft.subtasks.filter((_, j) => j !== i))}>
              <Icon name="close" size={16} color={theme.textFaint} />
            </Pressable>
          </Row>
        ))}
        <View style={styles.addStep}>
          <Icon name="plus" size={18} color={theme.textFaint} />
          <Input value={newStep} onChangeText={setNewStep} placeholder="Schritt hinzufügen" returnKeyType="done" onSubmitEditing={addStep} blurOnSubmit={false} style={{ flex: 1, paddingHorizontal: 0 }} />
        </View>
      </ListGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { gap: space.sm, paddingRight: space.lg },
  addStep: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg },
});
