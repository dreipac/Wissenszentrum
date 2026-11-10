import { Stack } from "expo-router";
import { useTheme } from "@/theme/theme";

/**
 * Der Stapel hinter jedem Tab: Antippen einer Zeile schiebt den Detailbildschirm darüber, Wischen vom linken Rand geht
 * zurück. Die Kopfzeilen zeichnen die Bildschirme selbst (ScreenHeader), darum hat der Stapel keine eigene Leiste.
 */
export function TabStack() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg }, fullScreenGestureEnabled: true }} />;
}
