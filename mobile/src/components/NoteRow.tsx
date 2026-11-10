import { StyleSheet, View } from "react-native";
import type { Note } from "@/data/types";
import { formatUpdated } from "@/lib/dates";
import { noteTitle, notePreview } from "@/lib/notes";
import { useTheme } from "@/theme/theme";
import { Meta } from "./ui/Bits";
import { Row } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { Txt } from "./ui/Txt";

/** Eine Notiz in einer Liste: Titel, zwei Zeilen Vorschau, Ordner und letzte Änderung. */
export function NoteRow({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const theme = useTheme();
  return (
    <Row onPress={onOpen} style={styles.row}>
      <View style={styles.text}>
        <View style={styles.title}>
          <Txt variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
            {noteTitle(note)}
          </Txt>
          {note.pinned && <Icon name="pin" size={13} color={theme.warning} />}
        </View>
        {note.plain ? (
          <Txt variant="subhead" tone="muted" numberOfLines={2}>
            {notePreview(note)}
          </Txt>
        ) : null}
        <View style={styles.meta}>
          <Txt variant="footnote" tone="faint">
            {formatUpdated(note.updatedAt)}
          </Txt>
          {note.folder ? <Meta icon="folder" text={note.folder} tone="faint" /> : null}
        </View>
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-start", paddingVertical: 14 },
  text: { flex: 1, gap: 4 },
  title: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 },
});
