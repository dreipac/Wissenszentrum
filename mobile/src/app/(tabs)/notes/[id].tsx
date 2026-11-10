import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Alert, Platform, StyleSheet, View } from "react-native";
import { Meta } from "@/components/ui/Bits";
import { IconButton } from "@/components/ui/Controls";
import { Input } from "@/components/ui/Fields";
import { Screen } from "@/components/ui/Screen";
import { Txt } from "@/components/ui/Txt";
import { useStore } from "@/data/store";
import { formatUpdated } from "@/lib/dates";
import { isEmptyNote } from "@/lib/notes";
import { space, useTheme } from "@/theme/theme";

/** Notiz lesen und schreiben. Alles wird beim Tippen gespeichert; eine leere Notiz verschwindet beim Verlassen. */
export default function NoteDetail() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const note = useStore((s) => s.notes.find((n) => n.id === Number(id)));
  const { updateNote, toggleNotePin, deleteNote } = useStore.getState();

  // Eine Notiz ohne Titel und Text wird nicht aufgehoben (wie am Desktop)
  useEffect(
    () => () => {
      const current = useStore.getState().notes.find((n) => n.id === Number(id));
      if (current && isEmptyNote(current)) useStore.getState().deleteNote(current.id);
    },
    [id],
  );

  if (!note) {
    return (
      <Screen variant="bar" title="Notiz">
        <Txt tone="muted">Diese Notiz gibt es nicht mehr.</Txt>
      </Screen>
    );
  }

  const remove = () => {
    const doDelete = () => {
      deleteNote(note.id);
      router.back();
    };
    if (Platform.OS === "web") return doDelete();
    Alert.alert("Notiz löschen?", "Das lässt sich nicht rückgängig machen.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: doDelete },
    ]);
  };

  return (
    <Screen
      variant="bar"
      title="Notiz"
      right={
        <View style={styles.right}>
          <IconButton icon={note.pinned ? "pin" : "pinOff"} label={note.pinned ? "Nicht mehr anpinnen" : "Anpinnen"} color={note.pinned ? theme.warning : theme.accent} onPress={() => toggleNotePin(note.id)} />
          <IconButton icon="trash" label="Notiz löschen" color={theme.negative} onPress={remove} />
        </View>
      }>
      <Input
        value={note.title}
        onChangeText={(v) => updateNote(note.id, { title: v })}
        placeholder="Titel"
        multiline
        scrollEnabled={false}
        style={[styles.title, { color: theme.text }]}
        autoFocus={isEmptyNote(note)}
      />
      <View style={styles.meta}>
        <Txt variant="footnote" tone="faint">
          {formatUpdated(note.updatedAt)}
        </Txt>
        {note.folder ? <Meta icon="folder" text={note.folder} tone="faint" /> : null}
      </View>
      <Input value={note.plain} onChangeText={(v) => updateNote(note.id, { plain: v })} placeholder="Schreib etwas …" multiline scrollEnabled={false} style={styles.body} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700", paddingHorizontal: 0, minHeight: 0 },
  body: { fontSize: 17, lineHeight: 25, paddingHorizontal: 0, minHeight: 320, marginTop: space.sm },
  meta: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
  right: { flexDirection: "row", alignItems: "center", gap: space.lg },
});
