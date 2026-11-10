import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { radius, space, useTheme } from "@/theme/theme";

/** Abgerundete Fläche für zusammengehörigen Inhalt. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>{children}</View>;
}

/** Eine Karte aus mehreren Zeilen, getrennt durch feine Linien (wie eine Gruppe in den Einstellungen von iOS). */
export function ListGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>
      {rows.map((row, i) => (
        <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
          {i > 0 && <View style={[styles.separator, { backgroundColor: theme.border }]} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

interface RowProps {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Zeile in einer ListGroup; mit `onPress` antippbar und mit Rückmeldung beim Drücken. */
export function Row({ children, onPress, onLongPress, style }: RowProps) {
  const theme = useTheme();
  if (!onPress && !onLongPress) return <View style={[styles.row, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.cardPressed }, style]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 52 },
});
