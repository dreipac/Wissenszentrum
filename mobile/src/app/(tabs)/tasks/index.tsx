import { Pressable, StyleSheet, View } from "react-native";
import { SectionTitle } from "@/components/ui/Bits";
import { Row, ListGroup } from "@/components/ui/Card";
import { IconButton, tap } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import { bucketKey, tasksFor } from "@/lib/taskLists";
import { open } from "@/lib/nav";
import { radius, space, useTheme } from "@/theme/theme";

/** Eine Kachel: farbiges Symbol, Anzahl und Name der Liste. Antippen öffnet die Liste. */
function Tile({ icon, color, count, label, onPress }: { icon: IconName; color: string; count: number; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? theme.cardPressed : theme.card, borderColor: theme.border }]}>
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: color }]}>
          <Icon name={icon} size={18} color="#ffffff" />
        </View>
        <Txt variant="title" style={{ fontVariant: ["tabular-nums"] }}>
          {count}
        </Txt>
      </View>
      <Txt variant="headline" tone="muted">
        {label}
      </Txt>
    </Pressable>
  );
}

export default function TasksScreen() {
  const theme = useTheme();
  const tasks = useStore((s) => s.tasks);
  const buckets = useStore((s) => s.buckets);
  const count = (key: string) => tasksFor(key, tasks).length;

  return (
    <Screen refreshable title="Aufgaben" right={<IconButton icon="plus" label="Neue Aufgabe" size={26} onPress={() => open("/new-task")} />}>
      <View style={styles.grid}>
        <Tile icon="today" color={theme.buckets.blue} count={count("today")} label="Heute" onPress={() => open("/tasks/list/today")} />
        <Tile icon="calendar" color={theme.buckets.red} count={count("planned")} label="Geplant" onPress={() => open("/tasks/list/planned")} />
        <Tile icon="tray" color={theme.buckets.gray} count={count("all")} label="Alle" onPress={() => open("/tasks/list/all")} />
        <Tile icon="check" color={theme.buckets.green} count={count("done")} label="Erledigt" onPress={() => open("/tasks/list/done")} />
      </View>

      <SectionTitle title="Buckets" />
      <ListGroup>
        {buckets.map((b) => (
          <Row key={b.id} onPress={() => open(`/tasks/list/${bucketKey(b.id)}`)}>
            <View style={[styles.bucketIcon, { backgroundColor: b.color ? theme.buckets[b.color] : theme.buckets.gray }]}>
              <Icon name="list" size={16} color="#ffffff" />
            </View>
            <Txt variant="body" style={{ flex: 1 }}>
              {b.name}
            </Txt>
            <Txt variant="body" tone="faint" style={{ fontVariant: ["tabular-nums"] }}>
              {count(bucketKey(b.id))}
            </Txt>
            <Icon name="chevronRight" size={16} color={theme.textFaint} />
          </Row>
        ))}
        <Row onPress={() => open("/tasks/list/bucket-none")}>
          <View style={[styles.bucketIcon, { backgroundColor: theme.buckets.gray }]}>
            <Icon name="tray" size={16} color="#ffffff" />
          </View>
          <Txt variant="body" style={{ flex: 1 }}>
            Ohne Bucket
          </Txt>
          <Txt variant="body" tone="faint" style={{ fontVariant: ["tabular-nums"] }}>
            {count("bucket-none")}
          </Txt>
          <Icon name="chevronRight" size={16} color={theme.textFaint} />
        </Row>
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: { width: "48%", flexGrow: 1, gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  tileTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  bucketIcon: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
});
