import type { ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useTheme, type Theme } from "@/theme/theme";

const variants = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.3 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: "600" },
  body: { fontSize: 17, lineHeight: 22 },
  subhead: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  caption: { fontSize: 12, lineHeight: 16 },
  /** Kleine Überschrift über einer Gruppe, wie in den Einstellungen von iOS */
  label: { fontSize: 13, lineHeight: 18, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
} as const satisfies Record<string, TextStyle>;

export type Variant = keyof typeof variants;
export type Tone = "text" | "muted" | "faint" | "accent" | "positive" | "negative" | "warning" | "onAccent";

export const toneColor = (theme: Theme, tone: Tone): string =>
  ({ text: theme.text, muted: theme.textMuted, faint: theme.textFaint, accent: theme.accent, positive: theme.positive, negative: theme.negative, warning: theme.warning, onAccent: theme.onAccent })[tone];

interface TxtProps {
  variant?: Variant;
  tone?: Tone;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
}

/** Text in den Schriftgrößen und Farben der App. */
export function Txt({ variant = "body", tone = "text", numberOfLines, style, children }: TxtProps) {
  const theme = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[variants[variant], { color: toneColor(theme, tone) }, style]}>
      {children}
    </Text>
  );
}
