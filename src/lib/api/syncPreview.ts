import type { SyncState, SyncStatus } from "../sync";

// Browser-Preview ohne Tauri: nur zum Ansehen der Oberfläche. Der Zustand liegt im localStorage und lässt sich dort
// für Tests von Hand setzen, z. B. state: "conflict" oder "pull".

const KEY = "wz-preview-sync";

interface Saved {
  enabled: boolean;
  dir: string;
  device: string;
  state: SyncState;
  lastSyncedAt: string | null;
}

const read = (): Saved => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    /* nur Vorschau */
  }
  return { enabled: false, dir: "", device: "", state: "off", lastSyncedAt: null };
};

const write = (s: Saved) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* nur Vorschau */
  }
};

const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const toStatus = (s: Saved, acted: SyncStatus["acted"] = null): SyncStatus => ({
  enabled: s.enabled,
  state: s.enabled ? s.state : "off",
  syncDir: s.enabled ? s.dir : null,
  deviceName: s.enabled ? s.device : null,
  remote: s.enabled && s.state !== "uptodate" ? { deviceName: "Schul-Laptop", savedAt: utcNow(), thisDevice: false } : s.enabled ? { deviceName: s.device, savedAt: s.lastSyncedAt ?? utcNow(), thisDevice: true } : null,
  localChanges: s.state === "conflict" || s.state === "push",
  firstTime: false,
  lastSyncedAt: s.lastSyncedAt,
  message: s.state === "error" ? "Der Abgleich-Ordner wurde nicht gefunden." : null,
  acted,
  notice: null,
  suggestedDir: "C:\\Users\\Preview\\OneDrive\\Wissenszentrum-Abgleich",
  defaultDeviceName: "PC-ZUHAUSE",
});

export const syncPreview = {
  async status() {
    return toStatus(read());
  },
  async enable(dir: string, device: string) {
    if (!dir.trim()) throw "Bitte wähle einen Abgleich-Ordner.";
    const s: Saved = { enabled: true, dir: dir.trim(), device: device.trim() || "PC-ZUHAUSE", state: "uptodate", lastSyncedAt: utcNow() };
    write(s);
    return toStatus(s, "pushed");
  },
  async now() {
    const s = read();
    if (s.state === "conflict") return toStatus(s);
    const acted = s.state === "pull" ? "pulled" : "pushed";
    const next = { ...s, state: "uptodate" as const, lastSyncedAt: utcNow() };
    write(next);
    return toStatus(next, acted);
  },
  async resolve(choice: "local" | "remote") {
    const next = { ...read(), state: "uptodate" as const, lastSyncedAt: utcNow() };
    write(next);
    return toStatus(next, choice === "local" ? "pushed" : "pulled");
  },
  async disable() {
    const next = { ...read(), enabled: false, state: "off" as const };
    write(next);
    return toStatus(next);
  },
};
