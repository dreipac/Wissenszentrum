import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { space, useTheme } from "@/theme/theme";
import { IconButton, tap } from "./Controls";
import { Txt } from "./Txt";

/** Eingabefeld im Stil der App (ohne eigenen Rahmen: es sitzt in einer Karte). */
export function Input(props: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textFaint}
      selectionColor={theme.accent}
      cursorColor={theme.accent}
      keyboardAppearance={theme.mode}
      {...props}
      style={[styles.input, { color: theme.text }, props.multiline && styles.multiline, props.style]}
    />
  );
}

/** Zeile mit Beschriftung links und einem Bedienelement rechts. */
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldRow}>
      <Txt variant="body" style={{ flex: 1 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

/** Uhrzeit in Schritten von 30 Minuten: ein Antippen weiter oder zurück, ohne Tastatur. */
export function TimeStepper({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const theme = useTheme();
  const [h, m] = value.split(":").map(Number);
  const step = (delta: number) => {
    const total = (h * 60 + m + delta + 24 * 60) % (24 * 60);
    onChange(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
  };
  return (
    <View style={styles.stepper}>
      <IconButton icon="minus" label="30 Minuten früher" color={theme.textMuted} size={20} onPress={() => step(-30)} />
      <Txt variant="headline" style={{ minWidth: 56, textAlign: "center", fontVariant: ["tabular-nums"] }}>
        {value}
      </Txt>
      <IconButton icon="plus" label="30 Minuten später" color={theme.textMuted} size={20} onPress={() => step(30)} />
    </View>
  );
}

/** Zeile mit Pfeilen zum Wechseln des Tages. */
export function DayStepper({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.stepper}>
      <IconButton icon="chevronLeft" label="Einen Tag zurück" color={theme.textMuted} size={20} onPress={() => (tap(), onPrev())} />
      <Txt variant="headline" style={{ minWidth: 118, textAlign: "center" }}>
        {label}
      </Txt>
      <IconButton icon="chevronRight" label="Einen Tag weiter" color={theme.textMuted} size={20} onPress={() => (tap(), onNext())} />
    </View>
  );
}

const styles = StyleSheet.create({
  input: { fontSize: 17, lineHeight: 22, paddingHorizontal: space.lg, paddingVertical: 14, minHeight: 52 },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, minHeight: 52 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 2 },
});
