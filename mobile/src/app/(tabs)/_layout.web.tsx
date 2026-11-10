import { Tabs } from "expo-router";
import { TabBar } from "@/components/TabBar";
import { useTheme } from "@/theme/theme";

/** Im Web gibt es keine Tab-Leiste des Systems: dort sitzt die eigene Leiste (siehe TabBar). */
export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.bg } }}>
      <Tabs.Screen name="(home)" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="calendar" />
      <Tabs.Screen name="notes" />
    </Tabs>
  );
}
