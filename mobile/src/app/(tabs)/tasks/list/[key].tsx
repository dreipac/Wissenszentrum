import { useLocalSearchParams } from "expo-router";
import { Fragment } from "react";
import { TaskRow } from "@/components/TaskRow";
import { Empty, SectionTitle } from "@/components/ui/Bits";
import { ListGroup, Row } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import { open } from "@/lib/nav";
import { listTitle, tasksFor } from "@/lib/taskLists";
import { groupOpenTasks } from "@/lib/tasks";
import { useTheme } from "@/theme/theme";

/** Eine Liste von Aufgaben: nach Fälligkeit gruppiert (erledigte in einem Block). Unten legt eine Zeile eine neue an. */
export default function TaskList() {
  const theme = useTheme();
  const { key } = useLocalSearchParams<{ key: string }>();
  const tasks = useStore((s) => s.tasks);
  const buckets = useStore((s) => s.buckets);

  const list = tasksFor(key, tasks);
  const groups = key === "done" ? [] : groupOpenTasks(list);
  const title = listTitle(key, buckets);
  // Neue Aufgaben in einer Bucket-Liste gehören gleich in diesen Bucket
  const bucketId = key.startsWith("bucket-") && key !== "bucket-none" ? key.replace("bucket-", "") : "";
  const canAdd = key !== "done";

  return (
    <Screen
      back
      backLabel="Aufgaben"
      title={title}
      subtitle={list.length === 1 ? "1 Aufgabe" : `${list.length} Aufgaben`}>
      {list.length === 0 ? (
        <Empty icon={key === "done" ? "check" : "checkCircle"} title={key === "done" ? "Noch nichts erledigt" : "Nichts offen"} text={key === "done" ? undefined : "In dieser Liste ist nichts zu tun."} />
      ) : key === "done" ? (
        <ListGroup>
          {list.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={() => open(`/tasks/${t.id}`)} />
          ))}
        </ListGroup>
      ) : (
        groups.map((g) => (
          <Fragment key={g.key}>
            <SectionTitle title={g.title} />
            <ListGroup>
              {g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} showBucket={!key.startsWith("bucket-")} onOpen={() => open(`/tasks/${t.id}`)} />
              ))}
            </ListGroup>
          </Fragment>
        ))
      )}

      {canAdd && (
        <ListGroup style={{ marginTop: 20 }}>
          <Row onPress={() => open(`/new-task${bucketId ? `?bucket=${bucketId}` : ""}`)}>
            <Icon name="plus" size={20} color={theme.accent} />
            <Txt variant="body" tone="accent" style={{ fontWeight: "600" }}>
              Neue Aufgabe
            </Txt>
          </Row>
        </ListGroup>
      )}
    </Screen>
  );
}
