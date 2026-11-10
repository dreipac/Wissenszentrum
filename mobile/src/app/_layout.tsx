import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Toast } from "@/components/ui/Toast";
import { useStore } from "@/data/store";
import { useTheme } from "@/theme/theme";

// Der Startbildschirm bleibt stehen, bis die Daten geladen sind
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const theme = useTheme();
  const ready = useStore((s) => s.ready);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const base = theme.mode === "dark" ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: theme.bg, card: theme.bg, text: theme.text, border: theme.border, primary: theme.accent } };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="new-task" options={{ presentation: "modal" }} />
          <Stack.Screen name="new-event" options={{ presentation: "modal" }} />
          <Stack.Screen name="settings" options={{ presentation: "modal" }} />
        </Stack>
        <Toast />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
