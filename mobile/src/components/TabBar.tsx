import type { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/data/store";
import { daysUntil } from "@/lib/tasks";
import { space, useTheme } from "@/theme/theme";
import { tap } from "./ui/Controls";
import { Icon, type IconName } from "./ui/Icon";
import { Txt } from "./ui/Txt";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const ITEMS: Record<string, { label: string; icon: IconName }> = {
  "(home)": { label: "Heute", icon: "today" },
  tasks: { label: "Aufgaben", icon: "checkCircle" },
  calendar: { label: "Kalender", icon: "calendar" },
  notes: { label: "Notizen", icon: "note" },
};

/**
 * Die Tab-Leiste unten: fest am Rand, undurchsichtig, mit Beschriftung. Eigene Gestaltung, damit sie auf iOS, Android und
 * im Web gleich aussieht und nichts vom Inhalt überdeckt. Am Tab „Aufgaben“ steht, wie viel heute oder schon überfällig ist.
 */
export function TabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const due = useStore((s) => s.tasks.filter((t) => !t.done && t.dueDate !== null && daysUntil(t.dueDate) <= 0).length);

  return (
    <View style={[styles.bar, { backgroundColor: theme.card, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {state.routes.map((route, index) => {
        const item = ITEMS[route.name];
        if (!item) return null;
        const focused = state.index === index;
        const color = focused ? theme.accent : theme.textFaint;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={item.label}
            onPress={() => {
              tap();
              const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigateToTab(route.key);
            }}
            style={styles.item}>
            <View>
              <Icon name={item.icon} size={25} color={color} />
              {route.name === "tasks" && due > 0 && (
                <View style={[styles.badge, { backgroundColor: theme.negative, borderColor: theme.card }]}>
                  <Txt variant="caption" style={{ color: "#ffffff", fontSize: 10, lineHeight: 13, fontWeight: "700" }}>
                    {due}
                  </Txt>
                </View>
              )}
            </View>
            <Txt variant="caption" style={{ color, fontWeight: focused ? "700" : "500" }}>
              {item.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  item: { flex: 1, alignItems: "center", gap: 3, paddingVertical: 2 },
  badge: { position: "absolute", top: -4, right: -10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2 },
});
