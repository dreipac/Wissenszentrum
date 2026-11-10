import { Pressable, StyleSheet, View } from "react-native";
import type { CalendarEvent } from "@/data/types";
import { eventsOnDay } from "@/lib/calendar";
import { WEEKDAY_LABELS, addMonths, formatMonthYear, isSameDay, isSameMonth, monthGrid } from "@/lib/dates";
import { radius, space, useTheme } from "@/theme/theme";
import { Card } from "./ui/Card";
import { IconButton, tap } from "./ui/Controls";
import { Txt } from "./ui/Txt";

interface MonthGridProps {
  /** Ein Tag im angezeigten Monat */
  month: Date;
  selected: Date;
  events: CalendarEvent[];
  onSelect: (day: Date) => void;
  onMonthChange: (month: Date) => void;
}

/** Monatsansicht: Tage mit Terminen haben Punkte, der gewählte Tag ist gefüllt, heute ist farbig. */
export function MonthGrid({ month, selected, events, onSelect, onMonthChange }: MonthGridProps) {
  const theme = useTheme();
  const today = new Date();
  const days = monthGrid(month);
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Txt variant="headline">{formatMonthYear(month)}</Txt>
        <View style={styles.nav}>
          <IconButton icon="chevronLeft" label="Voriger Monat" onPress={() => onMonthChange(addMonths(month, -1))} />
          <IconButton icon="chevronRight" label="Nächster Monat" onPress={() => onMonthChange(addMonths(month, 1))} />
        </View>
      </View>
      <View style={styles.week}>
        {WEEKDAY_LABELS.map((label) => (
          <View key={label} style={styles.cell}>
            <Txt variant="caption" tone="faint" style={{ fontWeight: "600" }}>
              {label}
            </Txt>
          </View>
        ))}
      </View>
      {weeks.map((week) => (
        <View key={week[0].toISOString()} style={styles.week}>
          {week.map((day) => {
            const inMonth = isSameMonth(day, month);
            const isSelected = isSameDay(day, selected);
            const isToday = isSameDay(day, today);
            const count = eventsOnDay(events, day).length;
            return (
              <Pressable
                key={day.toISOString()}
                style={styles.cell}
                accessibilityLabel={`${day.getDate()}. ${formatMonthYear(day)}${count ? `, ${count} Termine` : ""}`}
                onPress={() => {
                  tap();
                  onSelect(day);
                }}>
                <View style={[styles.number, isSelected && { backgroundColor: isToday ? theme.accent : theme.text }]}>
                  <Txt
                    variant="body"
                    style={{
                      fontVariant: ["tabular-nums"],
                      fontWeight: isToday || isSelected ? "700" : "400",
                      color: isSelected ? (isToday ? theme.onAccent : theme.bg) : isToday ? theme.accent : inMonth ? theme.text : theme.textFaint,
                    }}>
                    {day.getDate()}
                  </Txt>
                </View>
                <View style={styles.dots}>
                  {Array.from({ length: Math.min(count, 3) }, (_, i) => (
                    <View key={i} style={[styles.dot, { backgroundColor: inMonth ? theme.accent : theme.textFaint }]} />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: space.sm, paddingTop: space.md, paddingBottom: space.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.sm, paddingBottom: space.sm },
  nav: { flexDirection: "row", gap: space.sm },
  week: { flexDirection: "row" },
  cell: { flex: 1, alignItems: "center", paddingVertical: 2 },
  number: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  dots: { flexDirection: "row", gap: 3, height: 6, marginTop: 1 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
