import Constants from "expo-constants";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { SectionTitle } from "@/components/ui/Bits";
import { Card, ListGroup, Row } from "@/components/ui/Card";
import { Segmented } from "@/components/ui/Controls";
import { Avatar } from "@/components/ui/Avatar";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import { canSendScreenshot, sendScreenshot } from "@/lib/devScreenshot";
import { usePrefs, type AppearanceChoice } from "@/theme/prefs";
import { space } from "@/theme/theme";

/** Einstellungen als Blatt von unten, erreichbar über das Profilbild auf „Heute“. */
export default function Settings() {
  const profile = useStore((s) => s.profile);
  const appearance = usePrefs((s) => s.appearance);
  const setAppearance = usePrefs((s) => s.setAppearance);
  const version = Constants.expoConfig?.version ?? "0.1.0";

  return (
    <Screen
      variant="bar"
      title="Einstellungen"
      bottomInset
      left={null}
      back={false}
      right={
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Txt tone="accent" style={{ fontWeight: "700" }}>
            Fertig
          </Txt>
        </Pressable>
      }>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg }}>
        <Avatar first={profile.firstName} last={profile.lastName} size={52} />
        <View style={{ flex: 1 }}>
          <Txt variant="headline">
            {profile.firstName} {profile.lastName}
          </Txt>
          <Txt variant="footnote" tone="muted">
            Dein Wissenszentrum auf dem Telefon
          </Txt>
        </View>
      </Card>

      <SectionTitle title="Darstellung" />
      <Segmented
        options={[
          { value: "system" as AppearanceChoice, label: "System" },
          { value: "dark" as AppearanceChoice, label: "Dunkel" },
          { value: "light" as AppearanceChoice, label: "Hell" },
        ]}
        value={appearance}
        onChange={setAppearance}
      />

      <SectionTitle title="Daten" />
      <Card style={{ padding: space.lg, gap: space.xs }}>
        <Txt variant="body">Beispieldaten</Txt>
        <Txt variant="footnote" tone="muted">
          Im Moment zeigt die App Beispieldaten, die nur auf diesem Gerät liegen. Der Abgleich mit dem Desktop kommt später.
        </Txt>
      </Card>

      <SectionTitle title="Über" />
      <ListGroup>
        <Row>
          <Txt style={{ flex: 1 }}>Version</Txt>
          <Txt tone="muted">{version}</Txt>
        </Row>
        <Row>
          <Txt style={{ flex: 1 }}>Bereiche</Txt>
          <Txt tone="muted">Heute, Aufgaben, Kalender, Notizen</Txt>
        </Row>
      </ListGroup>

      {canSendScreenshot() && (
        <>
          <SectionTitle title="Entwicklung" />
          <ListGroup>
            <Row onPress={() => void sendScreenshot("einstellungen")}>
              <Txt style={{ flex: 1 }} tone="accent">
                Bildschirmfoto an den Rechner senden
              </Txt>
            </Row>
          </ListGroup>
          <Txt variant="footnote" tone="faint" style={{ marginTop: space.sm }}>
            Geht auch auf jedem Bildschirm mit langem Drücken auf den Titel.
          </Txt>
        </>
      )}
    </Screen>
  );
}
