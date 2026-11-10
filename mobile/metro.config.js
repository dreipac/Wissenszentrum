// Metro-Konfiguration (Entwicklungsserver der App).
//
// Zusatz nur für die Entwicklung: Die Entwickler-Taste in der App (src/components/dev/DevScreenshotButton.tsx) schickt ein
// Bildschirmfoto vom Telefon an /dev-screenshot. Der Server legt es im Ordner .screenshots ab, damit man (oder ein
// Assistent) sehen kann, wie die App auf dem Gerät aussieht. Den Server gibt es nur, solange `expo start` läuft; in der
// fertigen App ist davon nichts enthalten.

const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

const DIR = path.join(__dirname, ".screenshots");
const MAX_BYTES = 20 * 1024 * 1024;
/** So viele Bildschirmfotos bleiben liegen, ältere werden gelöscht */
const KEEP = 30;

/** Erkennt PNG und JPEG an den ersten Bytes; alles andere wird abgelehnt. */
const extensionOf = (buf) => (buf[0] === 0x89 && buf[1] === 0x50 ? "png" : buf[0] === 0xff && buf[1] === 0xd8 ? "jpg" : null);

function prune() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => !f.startsWith("latest."))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(DIR, old), { force: true });
}

function receive(req, res) {
  const chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BYTES) {
      res.statusCode = 413;
      res.end("Zu gross");
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const image = Buffer.from(String(body.data ?? ""), "base64");
      const ext = extensionOf(image);
      if (!ext) {
        res.statusCode = 400;
        res.end("Kein Bild");
        return;
      }
      const name = String(body.name ?? "bildschirm").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "bildschirm";
      fs.mkdirSync(DIR, { recursive: true });
      const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-${name}.${ext}`;
      fs.writeFileSync(path.join(DIR, file), image);
      // Das neueste Bild hat immer denselben Namen, egal welches Format
      for (const other of ["png", "jpg"]) fs.rmSync(path.join(DIR, `latest.${other}`), { force: true });
      fs.writeFileSync(path.join(DIR, `latest.${ext}`), image);
      prune();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ file }));
    } catch {
      res.statusCode = 400;
      res.end("Fehler");
    }
  });
}

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if ((req.url ?? "").split("?")[0] !== "/dev-screenshot") return middleware(req, res, next);
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    receive(req, res);
  },
};

module.exports = config;
