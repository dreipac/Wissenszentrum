import { createSeed } from "./seed";
import type { Repository } from "./repository";

/** Beispieldaten im Speicher: nichts wird dauerhaft gespeichert, beim Neustart beginnt alles von vorn. */
export const memoryRepository: Repository = {
  load: async () => createSeed(),
  saveTask: async () => {},
  removeTask: async () => {},
  saveEvent: async () => {},
  removeEvent: async () => {},
  saveNote: async () => {},
  removeNote: async () => {},
};
