import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { EventRow } from "@/components/EventRow";
import { MonthGrid } from "@/components/MonthGrid";
import { Empty, SectionTitle } from "@/components/ui/Bits";
import { ListGroup } from "@/components/ui/Card";
import { IconButton, tap } from "@/components/ui/Controls";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import { eventsOnDay } from "@/lib/calendar";
import { formatLongDay, isSameDay, startOfDay, toDateStr } from "@/lib/dates";
import { open } from "@/lib/nav";
import { space } from "@/theme/theme";

export default function CalendarScreen() {
  const events = useStore((s) => s.events);
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const dayEvents = eventsOnDay(events, selected);
  const isToday = isSameDay(selected, new Date());

  const goToday = () => {
    tap();
    const today = startOfDay(new Date());
    setSelected(today);
    setMonth(today);
  };

  return (
    <Screen
      refreshable
      title="Kalender"
      right={
        <View style={styles.right}>
          {!isToday && (
            <Pressable onPress={goToday} hitSlop={10}>
              <Txt tone="accent" style={{ fontWeight: "600" }}>
                Heute
              </Txt>
            </Pressable>
          )}
          <IconButton icon="plus" label="Neuer Termin" size={26} onPress={() => open(`/new-event?day=${toDateStr(selected)}`)} />
        </View>
      }>
      <MonthGrid
        month={month}
        selected={selected}
        events={events}
        onSelect={(day) => {
          setSelected(day);
          // Ein Tag aus dem Nachbarmonat wechselt auch die Monatsansicht
          if (day.getMonth() !== month.getMonth()) setMonth(day);
        }}
        onMonthChange={setMonth}
      />

      <SectionTitle title={formatLongDay(selected)} />
      {dayEvents.length > 0 ? (
        <ListGroup>
          {dayEvents.map((e) => (
            <EventRow key={e.id} event={e} onOpen={() => open(`/calendar/${e.id}`)} />
          ))}
        </ListGroup>
      ) : (
        <Empty icon="calendar" title="Keine Termine" text="An diesem Tag ist nichts eingetragen. Tippe auf das Plus, um einen Termin anzulegen." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  right: { flexDirection: "row", alignItems: "center", gap: space.lg },
});
