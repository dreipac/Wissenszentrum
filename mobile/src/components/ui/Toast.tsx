import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { radius, space, useTheme } from "@/theme/theme";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

type Tone = "ok" | "error" | "info";

interface ToastState {
  message: string | null;
  tone: Tone;
  /** Zählt mit, damit dieselbe Meldung zweimal hintereinander wieder erscheint */
  id: number;
  show: (message: string, tone?: Tone) => void;
  hide: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: "info",
  id: 0,
  show: (message, tone = "info") => set((s) => ({ message, tone, id: s.id + 1 })),
  hide: () => set({ message: null }),
}));

/** Kurze Meldung oben, die von selbst verschwindet. Gehört einmal in das Wurzel-Layout. */
export function Toast() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { message, tone, id, hide } = useToast();

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(hide, 1800);
    return () => clearTimeout(timer);
  }, [message, id, hide]);

  if (!message) return null;
  const color = tone === "ok" ? theme.positive : tone === "error" ? theme.negative : theme.accent;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + space.sm }]}>
      <View style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.borderStrong }]}>
        <Icon name={tone === "error" ? "close" : "check"} size={15} color={color} />
        <Txt variant="subhead" style={{ fontWeight: "600" }}>
          {message}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 50 },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: space.lg, paddingVertical: 10, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
});
