import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { radius, space, useTheme } from "@/theme/theme";
import { Icon, type IconName } from "./Icon";
import { Txt, toneColor, type Tone } from "./Txt";

/** Farbiger Punkt, zum Beispiel für einen Bucket. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

/** Kleine Angabe mit Symbol in einer Zeile (Fälligkeit, Zwischenschritte, Termin). */
export function Meta({ icon, text, tone = "muted" }: { icon?: IconName; text: string; tone?: Tone }) {
  const theme = useTheme();
  const color = toneColor(theme, tone);
  return (
    <View style={styles.meta}>
      {icon && <Icon name={icon} size={13} color={color} />}
      <Txt variant="footnote" tone={tone}>
        {text}
      </Txt>
    </View>
  );
}

/** Überschrift über einer Gruppe: klein, in Großbuchstaben, mit Platz für eine Aktion rechts. */
export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Txt variant="label" tone="muted">
        {title}
      </Txt>
      {right}
    </View>
  );
}

/** Hinweis, wenn eine Liste leer ist. */
export function Empty({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Icon name={icon} size={26} color={theme.textFaint} />
      </View>
      <Txt variant="headline">{title}</Txt>
      {text ? (
        <Txt variant="subhead" tone="muted" style={{ textAlign: "center" }}>
          {text}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  sectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.xs, marginTop: space.xl, marginBottom: space.sm },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: space.xxl * 1.5, paddingHorizontal: space.xl },
  emptyIcon: { width: 60, height: 60, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
});
