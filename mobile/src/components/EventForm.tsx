import { Switch, View } from "react-native";
import type { EventDraft } from "@/data/types";
import { addDays, formatLongDay, parseDateTime, startOfDay, toDateStr, toDateTimeStr, toTimeStr } from "@/lib/dates";
import { useTheme } from "@/theme/theme";
import { SectionTitle } from "./ui/Bits";
import { ListGroup } from "./ui/Card";
import { DayStepper, FieldRow, Input, TimeStepper } from "./ui/Fields";

interface EventFormProps {
  draft: EventDraft;
  onChange: (draft: EventDraft) => void;
}

/** Verschiebt Beginn und Ende um `days` Tage. */
const shiftDays = (draft: EventDraft, days: number): EventDraft => {
  const move = (s: string) => toDateTimeStr(addDays(parseDateTime(s), days));
  return { ...draft, startsAt: move(draft.startsAt), endsAt: move(draft.endsAt) };
};

/** Setzt die Uhrzeit von Beginn oder Ende; das Ende bleibt mindestens 30 Minuten nach dem Beginn. */
function withTime(draft: EventDraft, which: "startsAt" | "endsAt", time: string): EventDraft {
  const day = draft.startsAt.slice(0, 10);
  const next = { ...draft, [which]: `${which === "startsAt" ? day : draft.endsAt.slice(0, 10)} ${time}` };
  const start = parseDateTime(next.startsAt);
  const end = parseDateTime(next.endsAt);
  if (end.getTime() <= start.getTime()) next.endsAt = toDateTimeStr(new Date(start.getTime() + 30 * 60_000));
  return next;
}

/** Alle Angaben eines Termins. Wird für „Neuer Termin“ und zum Bearbeiten verwendet. */
export function EventForm({ draft, onChange }: EventFormProps) {
  const theme = useTheme();
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => onChange({ ...draft, [key]: value });
  const start = parseDateTime(draft.startsAt);

  const toggleAllDay = (allDay: boolean) => {
    const day = toDateStr(start);
    if (allDay) onChange({ ...draft, allDay, startsAt: `${day} 00:00`, endsAt: `${toDateStr(addDays(startOfDay(start), 1))} 00:00` });
    else onChange({ ...draft, allDay, startsAt: `${day} 09:00`, endsAt: `${day} 10:00` });
  };

  return (
    <View>
      <ListGroup>
        <Input value={draft.title} onChangeText={(v) => set("title", v)} placeholder="Titel" returnKeyType="done" autoFocus={draft.title === ""} />
        <Input value={draft.location} onChangeText={(v) => set("location", v)} placeholder="Ort" />
      </ListGroup>

      <SectionTitle title="Zeit" />
      <ListGroup>
        <FieldRow label="Ganztägig">
          <Switch value={draft.allDay} onValueChange={toggleAllDay} trackColor={{ true: theme.accent }} />
        </FieldRow>
        <FieldRow label="Tag">
          <DayStepper label={formatLongDay(start).replace(/^\w+, /, (m) => m)} onPrev={() => onChange(shiftDays(draft, -1))} onNext={() => onChange(shiftDays(draft, 1))} />
        </FieldRow>
        {!draft.allDay && (
          <FieldRow label="Beginn">
            <TimeStepper value={toTimeStr(start)} onChange={(t) => onChange(withTime(draft, "startsAt", t))} />
          </FieldRow>
        )}
        {!draft.allDay && (
          <FieldRow label="Ende">
            <TimeStepper value={toTimeStr(parseDateTime(draft.endsAt))} onChange={(t) => onChange(withTime(draft, "endsAt", t))} />
          </FieldRow>
        )}
      </ListGroup>

      <SectionTitle title="Beschreibung" />
      <ListGroup>
        <Input value={draft.description} onChangeText={(v) => set("description", v)} placeholder="Notiz zum Termin" multiline />
      </ListGroup>
    </View>
  );
}
