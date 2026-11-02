// Ein Befehl für ein Release: prüft, hebt die Version an, ergänzt den Changelog, committet, setzt den Tag und pusht.
// Den Rest (Installer bauen, Update signieren, Entwurf anlegen) übernimmt GitHub Actions, siehe docs/RELEASE.md.
//
//   npm run release patch            nächste Patch-Version (1.4.0 -> 1.4.1)
//   npm run release minor            nächste Minor-Version (1.4.0 -> 1.5.0)
//   npm run release major            nächste Major-Version (1.4.0 -> 2.0.0)
//   npm run release 1.5.0            genau diese Version
//
// Optionen (nach „--“, z. B. npm run release -- minor --dry-run):
//   --dry-run       zeigt nur, was passieren würde, und ändert nichts
//   --yes           ohne Rückfrage
//   --skip-checks   Build und Backend-Tests überspringen (die CI testet vor dem Bauen trotzdem)

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const target = args.find((a) => !a.startsWith("--"));
const dry = flags.has("--dry-run");

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function abort(message) {
  console.error(`\nAbbruch: ${message}`);
  process.exit(1);
}

/** Ein Hindernis: bricht ab, im Trockenlauf wird es nur gemeldet, damit man alles auf einmal sieht. */
let blocked = false;
function problem(message) {
  if (!dry) abort(message);
  blocked = true;
  console.log(`  ✗ Würde abbrechen: ${message}`);
}

function run(label, command) {
  console.log(`\n→ ${label}`);
  // Als eine Zeile mit Shell, damit unter Windows auch npm.cmd gefunden wird
  const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
  if (result.status !== 0) abort(`${label} ist fehlgeschlagen. Es wurde nichts committet und nichts gepusht.`);
}

const readText = (name) => fs.readFileSync(path.join(root, name), "utf8");

if (!target || target.startsWith("-")) {
  console.error("Aufruf: npm run release <patch | minor | major | x.y.z> [-- --dry-run]");
  process.exit(1);
}

// --- Version bestimmen -------------------------------------------------------------

const current = JSON.parse(readText("package.json")).version;
const core = (v) => v.split("-")[0].split(".").map(Number);
const isGreater = (a, b) => {
  const [x, y] = [core(a), core(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

function nextVersion() {
  const [major, minor, patch] = core(current);
  if (target === "patch") return `${major}.${minor}.${patch + 1}`;
  if (target === "minor") return `${major}.${minor + 1}.0`;
  if (target === "major") return `${major + 1}.0.0`;
  const v = target.replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) abort(`„${target}“ ist keine gültige Version (erwartet patch, minor, major oder z. B. 1.5.0).`);
  return v;
}

const version = nextVersion();
const tag = `v${version}`;

console.log(`Release ${current} → ${version}${dry ? "  (Trockenlauf, es wird nichts verändert)" : ""}\n`);
console.log("Voraussetzungen:");

if (!isGreater(version, current)) problem(`Die neue Version ${version} muss höher sein als die aktuelle ${current}.`);

// --- Git-Zustand prüfen ------------------------------------------------------------

const branch = git("branch", "--show-current");
if (branch !== "main") problem(`Du bist auf „${branch}“. Ein Release kommt von „main“ (git switch main).`);
else console.log("  ✓ Branch main");

if (git("status", "--porcelain")) problem("Es gibt uncommittete Änderungen. Erst committen oder zurücklegen.");
else console.log("  ✓ Keine uncommitteten Änderungen");

try {
  git("fetch", "origin", "--tags", "--quiet");
  const behind = Number(git("rev-list", "--count", "HEAD..origin/main"));
  const ahead = Number(git("rev-list", "--count", "origin/main..HEAD"));
  if (behind > 0) problem(`main liegt ${behind} Commit(s) hinter GitHub. Erst „git pull“.`);
  else console.log(`  ✓ Auf dem Stand von GitHub${ahead ? ` (${ahead} lokale Commit(s) werden mitgepusht)` : ""}`);
} catch {
  problem("GitHub ist nicht erreichbar oder „origin“ fehlt.");
}

if (git("tag", "--list", tag) || git("ls-remote", "--tags", "origin", tag)) problem(`Den Tag ${tag} gibt es schon.`);
else console.log(`  ✓ Tag ${tag} ist frei`);

// --- Changelog ---------------------------------------------------------------------

let previousTag = "";
try {
  previousTag = git("describe", "--tags", "--abbrev=0", "--match", "v*");
} catch {
  /* noch kein Release */
}

const commits = git("log", ...(previousTag ? [`${previousTag}..HEAD`] : []), "--no-merges", "--format=%s")
  .split("\n")
  .map((s) => s.trim())
  .filter((s) => s && !/^Version \d/.test(s));
const uniqueCommits = [...new Set(commits)];

const changelog = readText("CHANGELOG.md").replace(/\r\n/g, "\n");
const hasEntry = new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m").test(changelog);
const now = new Date();
const date = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
const entry = `## ${version} (${date})\n\n${uniqueCommits.map((s) => `- ${s}`).join("\n")}\n\n`;

if (hasEntry) console.log(`  ✓ Der Changelog hat schon einen Eintrag für ${version}`);
else if (uniqueCommits.length === 0) problem(`Seit ${previousTag || "dem Anfang"} gibt es keine neuen Commits für einen Changelog-Eintrag.`);
else console.log(`  ✓ Changelog-Eintrag wird aus ${uniqueCommits.length} Commit-Titel(n) seit ${previousTag || "dem Anfang"} erzeugt`);

// --- Plan zeigen -------------------------------------------------------------------

console.log("\nDas passiert:");
if (!flags.has("--skip-checks")) console.log("  1. Prüfen: Frontend bauen (tsc + vite) und Backend-Tests");
console.log(`  2. Version ${version} in package.json, package-lock.json, Cargo.toml und Cargo.lock setzen`);
if (!hasEntry) console.log("  3. Changelog-Eintrag ergänzen:\n\n" + entry.trimEnd().replace(/^(?=.)/gm, "       ") + "\n");
else console.log("  3. Changelog bleibt, wie er ist");
console.log(`  4. Committen („Version ${version}“), Tag ${tag} setzen`);
console.log(`  5. main und ${tag} nach GitHub pushen. Das startet den Bau auf GitHub; das Release erscheint dort als Entwurf.`);

if (dry) {
  console.log(blocked ? "\nTrockenlauf beendet. Es gibt Hindernisse (siehe oben), es wurde nichts verändert." : "\nTrockenlauf beendet. Es wurde nichts verändert.");
  process.exit(blocked ? 1 : 0);
}

if (!flags.has("--yes")) {
  if (!process.stdin.isTTY) abort("Keine Eingabe möglich. Mit „--yes“ ohne Rückfrage starten.");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\nRelease ${tag} jetzt veröffentlichen? (j/N) `)).trim().toLowerCase();
  rl.close();
  if (answer !== "j" && answer !== "ja") abort("Nicht bestätigt, es wurde nichts verändert.");
}

// --- Ausführen ---------------------------------------------------------------------

if (!flags.has("--skip-checks")) {
  run("Frontend bauen", "npm run build");
  run("Backend testen", "cargo test --manifest-path src-tauri/Cargo.toml --lib");
}

run(`Version ${version} setzen`, `node scripts/version.mjs set ${version}`);

if (!hasEntry) {
  const raw = readText("CHANGELOG.md");
  const crlf = raw.includes("\r\n");
  const head = "# Änderungen\n\n";
  const text = changelog.startsWith(head) ? head + entry + changelog.slice(head.length) : entry + changelog;
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), crlf ? text.replace(/\n/g, "\r\n") : text);
}

const files = ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "CHANGELOG.md"];
try {
  git("add", ...files);
  git("commit", "-m", `Version ${version}`);
  git("tag", "-a", tag, "-m", `Version ${version}`);
} catch (error) {
  abort(`Committen oder Taggen ist fehlgeschlagen: ${error.stderr || error.message}`);
}

console.log(`\n→ Pushe main und ${tag}`);
const push = spawnSync("git", ["push", "--atomic", "origin", "main", tag], { cwd: root, stdio: "inherit" });
if (push.status !== 0) {
  abort(
    `Der Push ist fehlgeschlagen. Commit und Tag existieren lokal. Nochmal versuchen: git push --atomic origin main ${tag}\n` +
      `Zurücknehmen: git tag -d ${tag} && git reset --hard HEAD~1`,
  );
}

const repo = git("remote", "get-url", "origin").replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
console.log(`\nFertig: ${tag} ist gepusht.`);
console.log(`  Bau verfolgen:  ${repo}/actions`);
console.log(`  Entwurf prüfen: ${repo}/releases  (installieren, ausprobieren, dann „Publish release“)`);
