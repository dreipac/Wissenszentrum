import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { NoteRow } from "@/components/NoteRow";
import { Empty, SectionTitle } from "@/components/ui/Bits";
import { ListGroup } from "@/components/ui/Card";
import { Chip, IconButton } from "@/components/ui/Controls";
import { Input } from "@/components/ui/Fields";
import { Icon } from "@/components/ui/Icon";
import { Screen } from "@/components/ui/Screen";
import { useStore } from "@/data/store";
import { newNote, open } from "@/lib/nav";
import { folderNames, searchNotes } from "@/lib/notes";
import { GUTTER, radius, space, useTheme } from "@/theme/theme";

/** Filter: alle Notizen, ein Ordner oder ohne Ordner. */
type Filter = "all" | "none" | string;

export default function NotesScreen() {
  const theme = useTheme();
  const notes = useStore((s) => s.notes);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const folders = folderNames(notes);

  const inFolder = notes.filter((n) => (filter === "all" ? true : filter === "none" ? n.folder === "" : n.folder === filter));
  const found = searchNotes(inFolder, query).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const pinned = found.filter((n) => n.pinned);
  const others = found.filter((n) => !n.pinned);
  const folderForNew = filter === "all" || filter === "none" ? "" : filter;

  return (
    <Screen
      refreshable
      title="Notizen"
      subtitle={`${notes.length} ${notes.length === 1 ? "Notiz" : "Notizen"}`}
      right={<IconButton icon="plus" label="Neue Notiz" size={28} onPress={() => newNote(folderForNew)} />}>
      <View style={[styles.search, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Icon name="search" size={17} color={theme.textFaint} />
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Notizen durchsuchen"
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ flex: 1, paddingHorizontal: 0, minHeight: 40, paddingVertical: 8 }}
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        <Chip label="Alle" active={filter === "all"} onPress={() => setFilter("all")} />
        {folders.map((f) => (
          <Chip key={f} label={f} icon="folder" active={filter === f} onPress={() => setFilter(f)} />
        ))}
        <Chip label="Ohne Ordner" active={filter === "none"} onPress={() => setFilter("none")} />
      </ScrollView>

      {found.length === 0 ? (
        <Empty icon="note" title={query ? "Nichts gefunden" : "Keine Notizen"} text={query ? "Versuche ein anderes Wort." : "Tippe auf das Plus, um die erste Notiz zu schreiben."} />
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <SectionTitle title="Angepinnt" />
              <ListGroup>
                {pinned.map((n) => (
                  <NoteRow key={n.id} note={n} onOpen={() => open(`/notes/${n.id}`)} />
                ))}
              </ListGroup>
            </>
          )}
          {others.length > 0 && (
            <>
              <SectionTitle title={pinned.length > 0 ? "Notizen" : `${others.length} ${others.length === 1 ? "Notiz" : "Notizen"}`} />
              <ListGroup>
                {others.map((n) => (
                  <NoteRow key={n.id} note={n} onOpen={() => open(`/notes/${n.id}`)} />
                ))}
              </ListGroup>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, marginBottom: space.md },
  chipScroll: { marginHorizontal: -GUTTER },
  chips: { gap: space.sm, paddingHorizontal: GUTTER },
});
