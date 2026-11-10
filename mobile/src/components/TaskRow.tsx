import { useRef } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useStore } from "@/data/store";
import type { Task } from "@/data/types";
import { bucketOf, eventOf, formatDue, isOverdue, subtaskProgress } from "@/lib/tasks";
import { space, useTheme } from "@/theme/theme";
import { Dot, Meta } from "./ui/Bits";
import { CheckCircle, tap } from "./ui/Controls";
import { Icon } from "./ui/Icon";
import { Txt } from "./ui/Txt";

interface TaskRowProps {
  task: Task;
  onOpen: () => void;
  /** Bucket-Name in der Zeile zeigen (nicht nötig, wenn die Liste schon nach Bucket gefiltert ist) */
  showBucket?: boolean;
}

/** Eine Aufgabe in einer Liste: Haken, Titel und Angaben. Nach rechts wischen = erledigt, nach links = löschen. */
export function TaskRow({ task, onOpen, showBucket = true }: TaskRowProps) {
  const theme = useTheme();
  const swipe = useRef<SwipeableMethods>(null);
  const { toggleTask, deleteTask } = useStore.getState();
  const bucket = useStore((s) => bucketOf(s.buckets, task.bucketId));
  const event = useStore((s) => eventOf(s.events, task.eventId));
  const overdue = isOverdue(task);
  const steps = subtaskProgress(task);
  const accent = bucket && bucket.color ? theme.buckets[bucket.color] : undefined;

  return (
    <ReanimatedSwipeable
      ref={swipe}
      overshootLeft={false}
      overshootRight={false}
      friction={1.6}
      leftThreshold={72}
      rightThreshold={72}
      renderLeftActions={() => (
        <View style={[styles.action, { backgroundColor: theme.positive, alignItems: "flex-start" }]}>
          <Icon name="check" size={22} color="#0f1f15" />
        </View>
      )}
      renderRightActions={() => (
        <View style={[styles.action, { backgroundColor: theme.negative, alignItems: "flex-end" }]}>
          <Icon name="trash" size={22} color="#ffffff" />
        </View>
      )}
      onSwipeableOpen={(direction) => {
        tap("success");
        if (direction === "left") toggleTask(task.id);
        else deleteTask(task.id);
        swipe.current?.close();
      }}>
      <Pressable onPress={onOpen} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.cardPressed : theme.card }]}>
        <CheckCircle done={task.done} color={accent} onToggle={() => toggleTask(task.id)} />
        <View style={styles.text}>
          <Txt variant="body" tone={task.done ? "faint" : "text"} numberOfLines={2} style={task.done ? { textDecorationLine: "line-through" } : undefined}>
            {task.title}
          </Txt>
          <View style={styles.metaRow}>
            {showBucket && bucket && (
              <View style={styles.bucket}>
                {accent && <Dot color={accent} />}
                <Txt variant="footnote" tone="muted">
                  {bucket.name}
                </Txt>
              </View>
            )}
            {task.dueDate && !task.done && <Meta icon="calendar" text={formatDue(task.dueDate)} tone={overdue ? "negative" : "muted"} />}
            {task.priority === "high" && !task.done && <Meta icon="flag" text="Hoch" tone="negative" />}
            {steps.total > 0 && <Meta icon="list" text={`${steps.done}/${steps.total}`} />}
            {event && <Meta icon="link" text={event.title} />}
          </View>
        </View>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  text: { flex: 1, gap: 3 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.md, rowGap: 2 },
  bucket: { flexDirection: "row", alignItems: "center", gap: 5 },
  action: { flex: 1, justifyContent: "center", paddingHorizontal: space.xl },
});
