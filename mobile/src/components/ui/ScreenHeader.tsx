import { router, usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { canSendScreenshot, sendScreenshot } from "@/lib/devScreenshot";
import { GUTTER, space, useTheme } from "@/theme/theme";
import { tap } from "./Controls";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

export interface HeaderProps {
  title: string;
  /** Kleine Zeile über dem Titel (zum Beispiel das Datum) */
  eyebrow?: string;
  subtitle?: string;
  /** Aktionen rechts, zum Beispiel ein Plus */
  right?: ReactNode;
  /** Mit Zurück-Pfeil; ohne Angabe nur bei der schmalen Leiste */
  back?: boolean;
  /** Eigene Aktion links statt des Zurück-Pfeils (zum Beispiel „Abbrechen“ in einem Blatt) */
  left?: ReactNode;
  backLabel?: string;
  /** "large": großer Titel (Hauptbereiche und Listen). "bar": schmale Leiste mit Titel in der Mitte (Details und Formulare). */
  variant?: "large" | "bar";
}

/** Zurück-Knopf: Pfeil und Beschriftung in der Akzentfarbe. */
function BackButton({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel="Zurück"
      hitSlop={12}
      onPress={() => {
        tap();
        if (router.canGoBack()) router.back();
      }}
      style={({ pressed }) => [styles.back, { opacity: pressed ? 0.5 : 1 }]}>
      <Icon name="chevronLeft" size={20} color={theme.accent} />
      <Txt variant="body" tone="accent">
        {label}
      </Txt>
    </Pressable>
  );
}

/**
 * Kopfzeile eines Bildschirms. Eigene Gestaltung statt der Titelleiste des Systems: sie sieht auf iOS, Android und im
 * Web gleich aus und lässt sich frei gestalten. Langes Drücken auf den Titel schickt (nur in der Entwicklung) ein
 * Bildschirmfoto an den Rechner.
 */
export function ScreenHeader({ title, eyebrow, subtitle, right, left, back, backLabel = "Zurück", variant = "large" }: HeaderProps) {
  const theme = useTheme();
  const pathname = usePathname();
  const shot = canSendScreenshot() ? () => void sendScreenshot(pathname) : undefined;

  if (variant === "bar") {
    return (
      <View style={[styles.bar, { borderBottomColor: theme.border }]}>
        <View style={styles.barSide}>{left ?? (back !== false ? <BackButton label={backLabel} /> : null)}</View>
        <Pressable onLongPress={shot} delayLongPress={700} style={styles.barTitle}>
          <Txt variant="headline" numberOfLines={1}>
            {title}
          </Txt>
        </Pressable>
        <View style={[styles.barSide, { alignItems: "flex-end" }]}>{right}</View>
      </View>
    );
  }

  return (
    <View style={styles.large}>
      {back ? <BackButton label={backLabel} /> : null}
      <View style={styles.largeRow}>
        <Pressable onLongPress={shot} delayLongPress={700} style={styles.largeText}>
          {eyebrow ? (
            <Txt variant="label" tone="muted" style={{ marginBottom: 2 }}>
              {eyebrow}
            </Txt>
          ) : null}
          <Txt variant="largeTitle">{title}</Txt>
          {subtitle ? (
            <Txt variant="subhead" tone="muted" style={{ marginTop: 2 }}>
              {subtitle}
            </Txt>
          ) : null}
        </Pressable>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  large: { gap: space.sm, marginBottom: space.lg },
  largeRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  largeText: { flex: 1 },
  right: { flexDirection: "row", alignItems: "center", gap: space.lg, paddingTop: 6 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", marginLeft: -6 },
  bar: { flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: GUTTER, borderBottomWidth: StyleSheet.hairlineWidth },
  barSide: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-start" },
  barTitle: { flex: 2, alignItems: "center" },
});
