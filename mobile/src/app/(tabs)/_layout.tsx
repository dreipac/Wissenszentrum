import { NativeTabs } from "expo-router/native-tabs";
import { useStore } from "@/data/store";
import { daysUntil } from "@/lib/tasks";
import { useTheme } from "@/theme/theme";

/**
 * Die vier Hauptbereiche in der Tab-Leiste des Systems: auf iOS 26 ist das die echte Liquid-Glass-Leiste von Apple, auf
 * Android die Material-Leiste. Jeder Bereich hat dahinter einen eigenen Stapel für Detailseiten. Im Web gilt `_layout.web.tsx`.
 */
export default function TabsLayout() {
  const theme = useTheme();
  // Am Tab „Aufgaben“ steht, wie viel heute oder schon überfällig ist
  const due = useStore((s) => s.tasks.filter((t) => !t.done && t.dueDate !== null && daysUntil(t.dueDate) <= 0).length);

  return (
    <NativeTabs tintColor={theme.accent}>
      <NativeTabs.Trigger name="(home)" contentStyle={{ backgroundColor: theme.bg }}>
        <NativeTabs.Trigger.Label>Heute</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "sun.max", selected: "sun.max.fill" }} md="today" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks" contentStyle={{ backgroundColor: theme.bg }}>
        <NativeTabs.Trigger.Label>Aufgaben</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "checkmark.circle", selected: "checkmark.circle.fill" }} md="check_circle" />
        <NativeTabs.Trigger.Badge hidden={due === 0}>{String(due)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calendar" contentStyle={{ backgroundColor: theme.bg }}>
        <NativeTabs.Trigger.Label>Kalender</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "calendar", selected: "calendar" }} md="calendar_month" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notes" contentStyle={{ backgroundColor: theme.bg }}>
        <NativeTabs.Trigger.Label>Notizen</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: "note.text", selected: "note.text" }} md="sticky_note_2" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
