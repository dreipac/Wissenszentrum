import { StyleSheet, View } from "react-native";
import type { CalendarEvent } from "@/data/types";
import { formatTimeRange } from "@/lib/calendar";
import { parseDateTime, toTimeStr } from "@/lib/dates";
import { space, useTheme } from "@/theme/theme";
import { Meta } from "./ui/Bits";
import { Row } from "./ui/Card";
import { Txt } from "./ui/Txt";

/** Ein Termin in einer Liste: links die Zeit, daneben ein Farbbalken, Titel und Ort. */
export function EventRow({ event, onOpen, withDay }: { event: CalendarEvent; onOpen: () => void; withDay?: string }) {
  const theme = useTheme();
  const start = event.allDay ? "Ganztägig" : toTimeStr(parseDateTime(event.startsAt));
  const end = event.allDay ? "" : toTimeStr(parseDateTime(event.endsAt));
  return (
    <Row onPress={onOpen}>
      <View style={styles.time}>
        <Txt variant="subhead" style={{ fontWeight: "600", fontVariant: ["tabular-nums"] }}>
          {start}
        </Txt>
        {end ? (
          <Txt variant="footnote" tone="faint" style={{ fontVariant: ["tabular-nums"] }}>
            {end}
          </Txt>
        ) : null}
      </View>
      <View style={[styles.bar, { backgroundColor: theme.accent }]} />
      <View style={styles.text}>
        <Txt variant="body" numberOfLines={1}>
          {event.title}
        </Txt>
        {withDay ? <Meta icon="calendar" text={withDay} /> : null}
        {event.location ? <Meta icon="location" text={event.location} /> : null}
        {!event.location && !withDay ? (
          <Txt variant="footnote" tone="faint">
            {formatTimeRange(event)}
          </Txt>
        ) : null}
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  time: { width: 62, gap: 1 },
  bar: { width: 3, alignSelf: "stretch", borderRadius: 2, minHeight: 34 },
  text: { flex: 1, gap: 2, paddingVertical: 2 },
  spacer: { height: space.xs },
});
