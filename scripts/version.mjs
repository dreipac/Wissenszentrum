// Eine Version für alles: package.json ist die Quelle (tauri.conf.json liest sie von dort).
// Dieses Skript hält package-lock.json, Cargo.toml und Cargo.lock im Gleichschritt.
//
//   node scripts/version.mjs                 zeigt die Version und prüft, ob alle Dateien übereinstimmen
//   node scripts/version.mjs --tag v1.4.0    prüft zusätzlich, ob der Git-Tag zur Version passt (für CI)
//   node scripts/version.mjs set 1.4.0       setzt die Version überall

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (name) => path.join(root, name);
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Liest eine Datei, bearbeitet den Text (immer mit LF) und schreibt mit den ursprünglichen Zeilenenden zurück. */
function rewrite(name, change) {
  const raw = fs.readFileSync(file(name), "utf8");
  const crlf = raw.includes("\r\n");
  const next = change(raw.replace(/\r\n/g, "\n"));
  fs.writeFileSync(file(name), crlf ? next.replace(/\n/g, "\r\n") : next);
}

const readJson = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));

function versions() {
  const cargoToml = fs.readFileSync(file("src-tauri/Cargo.toml"), "utf8").match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1];
  const cargoLock = fs.readFileSync(file("src-tauri/Cargo.lock"), "utf8").match(/name = "wissenszentrum"\r?\nversion = "([^"]+)"/)?.[1];
  const lock = readJson("package-lock.json");
  const conf = readJson("src-tauri/tauri.conf.json");
  return {
    "package.json": readJson("package.json").version,
    "package-lock.json": lock.version,
    "package-lock.json (packages)": lock.packages?.[""]?.version,
    "src-tauri/Cargo.toml": cargoToml,
    "src-tauri/Cargo.lock": cargoLock,
    // Steht dort ein Pfad statt einer Zahl, gilt die Version aus package.json
    "src-tauri/tauri.conf.json": /^\d/.test(conf.version) ? conf.version : undefined,
  };
}

function setVersion(version) {
  if (!SEMVER.test(version)) {
    console.error(`„${version}“ ist keine gültige Version (erwartet z. B. 1.4.0).`);
    process.exit(1);
  }
  rewrite("package.json", (t) => t.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
  rewrite("package-lock.json", (t) => {
    // Nur die beiden Einträge des Projekts selbst, nicht die Versionen der Abhängigkeiten
    let n = 0;
    return t.replace(/("version":\s*")[^"]+(")/g, (m, a, b) => (n++ < 2 ? `${a}${version}${b}` : m));
  });
  rewrite("src-tauri/Cargo.toml", (t) => t.replace(/(^\[package\][^[]*?^version\s*=\s*")[^"]+(")/ms, `$1${version}$2`));
  rewrite("src-tauri/Cargo.lock", (t) => t.replace(/(name = "wissenszentrum"\nversion = ")[^"]+(")/, `$1${version}$2`));
  console.log(`Version auf ${version} gesetzt.`);
}

const [, , cmd, arg] = process.argv;

if (cmd === "set") {
  if (!arg) {
    console.error("Aufruf: node scripts/version.mjs set 1.4.0");
    process.exit(1);
  }
  setVersion(arg.replace(/^v/, ""));
}

const found = versions();
const expected = found["package.json"];
let ok = true;
for (const [name, value] of Object.entries(found)) {
  if (value === undefined) continue;
  const same = value === expected;
  if (!same) ok = false;
  console.log(`${same ? "ok " : "FEHLER"}  ${name.padEnd(30)} ${value}`);
}

if (cmd === "--tag") {
  const tag = (arg ?? "").replace(/^refs\/tags\//, "");
  if (tag !== `v${expected}`) {
    console.error(`FEHLER  Tag „${tag}“ passt nicht zur Version ${expected} (erwartet v${expected}).`);
    ok = false;
  }
}

if (!ok) {
  console.error("\nDie Versionen stimmen nicht überein. Mit „node scripts/version.mjs set <version>“ angleichen.");
  process.exit(1);
}
console.log(`\nVersion ${expected}`);
