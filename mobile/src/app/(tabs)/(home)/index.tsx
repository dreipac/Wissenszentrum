import { Pressable, StyleSheet, View } from "react-native";
import { EventRow } from "@/components/EventRow";
import { NoteRow } from "@/components/NoteRow";
import { TaskRow } from "@/components/TaskRow";
import { Avatar } from "@/components/ui/Avatar";
import { Empty, SectionTitle } from "@/components/ui/Bits";
import { Card, ListGroup } from "@/components/ui/Card";
import { IconButton, tap } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import { dayName, formatTimeRange, relativeStart, upcomingEvents } from "@/lib/calendar";
import { daysBetween, formatLongDay, parseDateTime } from "@/lib/dates";
import { goTo, newNote, open } from "@/lib/nav";
import { byImportance, isOverdue } from "@/lib/tasks";
import { space, useTheme } from "@/theme/theme";

const greeting = (now: Date) => {
  const h = now.getHours();
  return h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
};

function Stat({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <View style={styles.stat}>
      <Txt variant="title" tone={alert && value > 0 ? "negative" : "text"} style={{ fontVariant: ["tabular-nums"] }}>
        {value}
      </Txt>
      <Txt variant="footnote" tone="muted" numberOfLines={2} style={{ textAlign: "center" }}>
        {label}
      </Txt>
    </View>
  );
}

function SeeAll({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10}>
      <Txt variant="footnote" tone="accent" style={{ fontWeight: "600" }}>
        Alle
      </Txt>
    </Pressable>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const now = new Date();
  const profile = useStore((s) => s.profile);
  const tasks = useStore((s) => s.tasks);
  const events = useStore((s) => s.events);
  const notes = useStore((s) => s.notes);

  const openTasks = tasks.filter((t) => !t.done);
  const overdue = openTasks.filter((t) => isOverdue(t, now));
  const dueToday = openTasks.filter((t) => t.dueDate !== null && daysBetween(now, parseDateTime(`${t.dueDate} 00:00`)) === 0);
  const important = openTasks.filter((t) => overdue.includes(t) || dueToday.includes(t) || t.priority === "high").sort(byImportance).slice(0, 5);
  const upcoming = upcomingEvents(events, now, 7);
  const nextUp = upcoming[0];
  const later = upcoming.slice(1, 5);
  const recent = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);

  return (
    <Screen
      refreshable
      eyebrow={formatLongDay(now).toUpperCase()}
      title={`${greeting(now)}, ${profile.firstName}`}
      right={<Avatar first={profile.firstName} last={profile.lastName} onPress={() => open("/settings")} />}>
      <Card style={styles.summary}>
        <Stat value={openTasks.length} label="Offen" />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Stat value={dueToday.length + overdue.length} label="Heute fällig" alert />
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Stat value={upcoming.length} label="Termine in 7 Tagen" />
      </Card>

      {overdue.length > 0 && (
        <Pressable
          onPress={() => {
            tap();
            open("/tasks/list/overdue");
          }}
          style={[styles.banner, { backgroundColor: theme.negative + "22", borderColor: theme.negative + "55" }]}>
          <Icon name="flag" size={16} color={theme.negative} />
          <Txt variant="subhead" tone="negative" style={{ flex: 1, fontWeight: "600" }}>
            {overdue.length === 1 ? "1 Aufgabe ist überfällig" : `${overdue.length} Aufgaben sind überfällig`}
          </Txt>
          <Icon name="chevronRight" size={16} color={theme.negative} />
        </Pressable>
      )}

      {nextUp && (
        <>
          <SectionTitle title="Als Nächstes" />
          <Pressable
            onPress={() => {
              tap();
              open(`/calendar/${nextUp.id}`);
            }}
            style={({ pressed }) => [styles.next, { backgroundColor: pressed ? theme.cardPressed : theme.card, borderColor: theme.border }]}>
            <View style={[styles.nextBar, { backgroundColor: theme.accent }]} />
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="footnote" tone="accent" style={{ fontWeight: "700" }}>
                {relativeStart(nextUp, now).toUpperCase()}
              </Txt>
              <Txt variant="title" numberOfLines={2}>
                {nextUp.title}
              </Txt>
              <Txt variant="subhead" tone="muted">
                {dayName(parseDateTime(nextUp.startsAt), now)} · {formatTimeRange(nextUp)}
                {nextUp.location ? ` · ${nextUp.location}` : ""}
              </Txt>
            </View>
            <Icon name="chevronRight" size={18} color={theme.textFaint} />
          </Pressable>
        </>
      )}

      <SectionTitle
        title="Wichtig & fällig"
        right={
          <View style={styles.sectionActions}>
            <SeeAll onPress={() => goTo("/tasks")} />
            <IconButton icon="plus" label="Neue Aufgabe" size={20} onPress={() => open("/new-task")} />
          </View>
        }
      />
      {important.length > 0 ? (
        <ListGroup>
          {important.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={() => open(`/tasks/${t.id}`)} />
          ))}
        </ListGroup>
      ) : (
        <Card>
          <Empty icon="checkCircle" title="Nichts Dringendes" text="Heute ist nichts fällig und nichts mit hoher Priorität offen." />
        </Card>
      )}

      {later.length > 0 && (
        <>
          <SectionTitle title="Weitere Termine" right={<SeeAll onPress={() => goTo("/calendar")} />} />
          <ListGroup>
            {later.map((e) => (
              <EventRow key={e.id} event={e} withDay={dayName(parseDateTime(e.startsAt), now)} onOpen={() => open(`/calendar/${e.id}`)} />
            ))}
          </ListGroup>
        </>
      )}

      <SectionTitle
        title="Zuletzt bearbeitet"
        right={
          <View style={styles.sectionActions}>
            <SeeAll onPress={() => goTo("/notes")} />
            <IconButton icon="plus" label="Neue Notiz" size={20} onPress={() => newNote()} />
          </View>
        }
      />
      <ListGroup>
        {recent.map((n) => (
          <NoteRow key={n.id} note={n} onOpen={() => open(`/notes/${n.id}`)} />
        ))}
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "stretch", paddingVertical: space.lg },
  stat: { flex: 1, alignItems: "center", gap: 2, paddingHorizontal: space.sm },
  divider: { width: StyleSheet.hairlineWidth },
  banner: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.md, paddingHorizontal: space.lg, paddingVertical: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  next: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  nextBar: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  sectionActions: { flexDirection: "row", alignItems: "center", gap: space.md },
});
