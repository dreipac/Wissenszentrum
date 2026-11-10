import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GUTTER, space, useTheme } from "@/theme/theme";
import { tap } from "./Controls";
import { ScreenHeader, type HeaderProps } from "./ScreenHeader";

interface ScreenProps extends HeaderProps {
  children: ReactNode;
  /** Ziehen zum Aktualisieren: später lädt das die Daten neu, jetzt nur die Rückmeldung */
  refreshable?: boolean;
  /** Platz am unteren Rand (zum Beispiel unter der Tab-Leiste braucht es keinen, in einem Blatt schon) */
  bottomInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Rahmen jedes Bildschirms: Hintergrund, Rand zur Statusleiste und Kopfzeile. Mit „large“ scrollt die Kopfzeile mit dem
 * Inhalt, mit „bar“ bleibt die schmale Leiste oben stehen.
 */
export function Screen({ children, refreshable, bottomInset, contentStyle, variant = "large", ...header }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    setRefreshing(true);
    tap("medium");
    setTimeout(() => setRefreshing(false), 700);
  }, []);

  return (
    // Ein Blatt (bottomInset) beginnt unterhalb der Statusleiste: dort braucht es nur einen kleinen Rand für den Griff oben
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: bottomInset ? space.sm : insets.top }}>
      {variant === "bar" && <ScreenHeader variant="bar" {...header} />}
      <ScrollView
        style={{ flex: 1 }}
        // In den Tabs schiebt das System die Inhalte über die Leiste unten; im Blatt (bottomInset) gilt der eigene Rand
        contentInsetAdjustmentBehavior={bottomInset ? "never" : "automatic"}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[{ paddingHorizontal: GUTTER, paddingTop: variant === "large" ? space.lg : space.lg, paddingBottom: (bottomInset ? insets.bottom : 0) + space.xxl }, contentStyle]}
        refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.textMuted} /> : undefined}>
        {variant === "large" && <ScreenHeader variant="large" {...header} />}
        {children}
      </ScrollView>
    </View>
  );
}
