import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { radius, space, useTheme } from "@/theme/theme";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

/** Leichte Rückmeldung am Gerät (auf dem Web ohne Wirkung). */
export const tap = (style: "light" | "medium" | "success" = "light") => {
  if (Platform.OS === "web") return;
  if (style === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else void Haptics.impactAsync(style === "light" ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
};

interface CheckCircleProps {
  done: boolean;
  onToggle: () => void;
  /** Farbe des Rings (zum Beispiel die Farbe des Buckets) */
  color?: string;
  size?: number;
}

/** Runder Haken zum Abhaken: federt beim Antippen und gibt Rückmeldung. */
export function CheckCircle({ done, onToggle, color, size = 26 }: CheckCircleProps) {
  const theme = useTheme();
  const scale = useSharedValue(1);
  const ring = color ?? theme.textFaint;
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Beim Abhaken kurz aufspringen
  useEffect(() => {
    if (done) scale.set(withSequence(withTiming(1.18, { duration: 90 }), withSpring(1, { damping: 8 })));
  }, [done, scale]);

  return (
    <Pressable
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      onPress={() => {
        tap(done ? "light" : "success");
        onToggle();
      }}>
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, borderWidth: 2, alignItems: "center", justifyContent: "center", borderColor: done ? theme.positive : ring, backgroundColor: done ? theme.positive : "transparent" },
          style,
        ]}>
        {done && <Icon name="check" size={size * 0.55} color="#0f1f15" />}
      </Animated.View>
    </Pressable>
  );
}

interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** Farbiger Punkt vor dem Namen (Bucket) */
  dot?: string;
  icon?: IconName;
}

/** Kleine Auswahl-Kapsel, zum Beispiel als Filter über einer Liste. */
export function Chip({ label, active, onPress, dot, icon }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={[styles.chip, { backgroundColor: active ? theme.text : theme.card, borderColor: active ? theme.text : theme.border }]}>
      {dot && <View style={[styles.dot, { backgroundColor: dot }]} />}
      {icon && <Icon name={icon} size={14} color={active ? theme.bg : theme.textMuted} />}
      <Txt variant="subhead" style={{ color: active ? theme.bg : theme.text, fontWeight: "500" }}>
        {label}
      </Txt>
    </Pressable>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** Umschalter mit zwei bis vier Optionen. */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            style={[styles.segment, active && { backgroundColor: theme.selected }]}>
            <Txt variant="subhead" tone={active ? "text" : "muted"} style={{ fontWeight: active ? "600" : "400" }}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Schaltfläche: hell auf dunkel (wie am Desktop), als Zweitaktion mit Rand, oder rot zum Löschen. */
export function Button({ label, onPress, icon, variant = "primary", disabled, style }: ButtonProps) {
  const theme = useTheme();
  const bg = variant === "primary" ? theme.text : "transparent";
  const fg = variant === "primary" ? theme.bg : variant === "danger" ? theme.negative : theme.text;
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        tap("medium");
        onPress();
      }}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: variant === "primary" ? theme.text : theme.borderStrong, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }, style]}>
      {icon && <Icon name={icon} size={18} color={fg} />}
      <Txt variant="headline" style={{ color: fg }}>
        {label}
      </Txt>
    </Pressable>
  );
}

interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
}

/** Symbol zum Antippen (Kopfzeile, Karten). */
export function IconButton({ icon, onPress, label, color, size = 22 }: IconButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      hitSlop={10}
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, padding: 4 }]}>
      <Icon name={icon} size={size} color={color ?? theme.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space.md, height: 34, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 8, height: 8, borderRadius: 4 },
  segmented: { flexDirection: "row", padding: 3, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 2 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", height: 32, borderRadius: radius.sm },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, height: 50, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg },
});
