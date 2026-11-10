import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/theme/theme";
import { tap } from "./Controls";
import { Txt } from "./Txt";

/** Gibt es Liquid Glass auf diesem Gerät (iOS 26 und neuer)? Sonst gilt die einfache Fläche. */
const hasGlass = Platform.OS === "ios" && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

/**
 * Runder Knopf mit den Initialen, oben rechts als Zugang zu den Einstellungen. Auf iOS 26 ist es echtes Liquid Glass
 * (tönt in der Akzentfarbe und reagiert beim Drücken wie die Knöpfe von Apple), sonst eine gefüllte Fläche.
 */
export function Avatar({ first, last, size = 38, onPress }: { first: string; last: string; size?: number; onPress?: () => void }) {
  const theme = useTheme();
  const initials = `${first.trim()[0] ?? ""}${last.trim()[0] ?? ""}`.toUpperCase() || "?";
  const shape = { width: size, height: size, borderRadius: size / 2 };
  const label = (
    <Txt variant="footnote" style={{ color: hasGlass ? theme.text : theme.onAccent, fontWeight: "700", fontSize: size * 0.34 }}>
      {initials}
    </Txt>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Einstellungen"
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [shape, !hasGlass && { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 }]}>
      {hasGlass ? (
        <GlassView glassEffectStyle="regular" tintColor={theme.accent} isInteractive colorScheme={theme.mode} style={[shape, styles.center]}>
          {label}
        </GlassView>
      ) : (
        <>{label}</>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({ center: { alignItems: "center", justifyContent: "center" } });
