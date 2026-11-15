import { useCallback, useEffect, useState } from "react";
import { listChats, type ChatInfo } from "./api/chats";
import { onChange } from "./changes";

/** Alle gespeicherten Chats des Assistenten (angeheftete zuerst, dann die zuletzt benutzten). Lädt bei Änderungen automatisch neu. */
export function useChats() {
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setChats(await listChats());
    } catch {
      setChats([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("chats", () => void load());
  }, [load]);

  return { chats, loaded, reload: load };
}
