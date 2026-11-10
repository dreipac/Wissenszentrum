import Constants from "expo-constants";
import { Platform } from "react-native";
import { captureScreen } from "react-native-view-shot";
import { tap } from "@/components/ui/Controls";
import { useToast } from "@/components/ui/Toast";

/** Adresse des Entwicklungsservers (der, von dem die App gerade geladen wurde). */
function serverUrl(): string | null {
  const host = Constants.expoConfig?.hostUri;
  if (!host) return null;
  // Über einen Tunnel ist es eine https-Adresse ohne Port, im WLAN http mit Port
  return `${/\.exp\.direct|ngrok/.test(host) ? "https" : "http"}://${host}/dev-screenshot`;
}

/** Gibt es die Funktion hier? Nur in der Entwicklung und auf dem Telefon, nicht im Web und nicht in der fertigen App. */
export const canSendScreenshot = () => __DEV__ && Platform.OS !== "web" && serverUrl() !== null;

/**
 * Nur in der Entwicklung: nimmt den Bildschirm auf und schickt ihn an den Entwicklungsserver auf dem Rechner
 * (Ordner mobile/.screenshots), damit sich ohne Umweg zeigen lässt, wie die App auf dem Telefon aussieht.
 * Ausgelöst wird es durch langes Drücken auf den Titel eines Bildschirms oder in den Einstellungen.
 */
export async function sendScreenshot(name: string): Promise<void> {
  const url = serverUrl();
  if (!canSendScreenshot() || !url) return;
  const toast = useToast.getState().show;
  tap("medium");
  try {
    const data = await captureScreen({ format: "jpg", quality: 0.92, result: "base64" });
    const slug = name === "/" ? "heute" : name.replace(/^\//, "").replace(/\//g, "-") || "bildschirm";
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: slug, data }) });
    toast(response.ok ? "Bildschirmfoto gesendet" : "Senden fehlgeschlagen", response.ok ? "ok" : "error");
  } catch {
    toast("Senden fehlgeschlagen", "error");
  }
}
