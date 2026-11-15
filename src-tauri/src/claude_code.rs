//! Claude Code als Antwortgeber des Assistenten.
//!
//! Die App startet das auf diesem Rechner installierte Claude Code unsichtbar im Druckmodus (`claude -p`) und liest dessen
//! Ereignisstrom (`stream-json`). Die Werkzeuge der App bekommt es über den lokalen MCP-Server (siehe `mcp`). Angemeldet ist
//! Claude Code mit dem Konto der Person: die App kennt weder Zugangsdaten noch einen API-Schlüssel und entfernt sicherheitshalber
//! `ANTHROPIC_API_KEY` aus der Umgebung des Laufs, damit nichts über die API abgerechnet wird.
//!
//! Der Lauf ist eng eingegrenzt: eigener Ordner, keine eingebauten Werkzeuge außer „Read“ (nur wenn Dateien im Chat liegen,
//! und nur in diesem Ordner), nur die MCP-Werkzeuge der App, keine Einstellungen, Erweiterungen oder Befehle der Person,
//! keine Sitzung auf der Platte.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

/// So lange darf ein Lauf höchstens dauern
const MAX_RUN: Duration = Duration::from_secs(15 * 60);
/// Wie oft nachgeschaut wird, ob die Person „Stopp“ gedrückt hat
const TICK: Duration = Duration::from_millis(250);

/// Token-Zahlen eines Laufs (so wie Claude Code sie meldet)
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Tokens {
    pub input: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub output: u64,
}

/// Was ein Lauf geliefert hat
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunReport {
    /// Der Text der Antwort
    pub text: String,
    pub tokens: Tokens,
    /// Der Lauf wurde auf Wunsch (Stopp) beendet
    pub stopped: bool,
}

/// Was für einen Lauf gebraucht wird
pub struct RunSpec<'a> {
    /// Der Ordner des Laufs: der Aufrufer legt ihn an, weil der Assistent schon vor dem Start Dateien hineinlegen will
    pub dir: &'a RunDir,
    pub program: &'a Path,
    /// Kennung des Modells („claude-haiku-5-5“); Claude Code nimmt auch Kurznamen
    pub model: &'a str,
    pub system_prompt: &'a str,
    /// Die Eingabe: das Gespräch und die neue Nachricht
    pub prompt: &'a str,
    /// Dateien aus dem Chat, die im Arbeitsordner liegen sollen: (Dateiname, Inhalt)
    pub files: &'a [(String, Vec<u8>)],
    /// Adresse und Token des lokalen MCP-Servers; ohne Angabe läuft Claude Code ganz ohne Werkzeuge
    pub mcp: Option<(&'a str, &'a str)>,
    pub max_turns: u32,
}

// --- Finden ------------------------------------------------------------------------------

#[cfg(windows)]
const NAMES: [&str; 3] = ["claude.exe", "claude.cmd", "claude"];
#[cfg(not(windows))]
const NAMES: [&str; 1] = ["claude"];

/// Wo Claude Code liegen kann, wenn es nicht im Suchpfad steht (die Orte der Installationsprogramme).
fn usual_places() -> Vec<PathBuf> {
    let mut places = Vec::new();
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from);
    if let Some(home) = &home {
        for name in NAMES {
            places.push(home.join(".local").join("bin").join(name));
            places.push(home.join(".claude").join("local").join(name));
        }
    }
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        for name in NAMES {
            places.push(appdata.join("npm").join(name));
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        for name in NAMES {
            places.push(local.join("Programs").join("claude").join(name));
        }
    }
    places
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default()
}

/// Das Claude Code, das die Desktop-App von Claude mitbringt: `<Daten>Claude-Data<Paket>claude-code<Version><Kennung>claude.exe`.
/// Der Pfad ändert sich mit jedem Update der App, deshalb wird er bei jeder Suche neu gelesen. Das neueste zuerst.
fn desktop_app_builds(local_app_data: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(Vec<u64>, PathBuf)> = Vec::new();
    for package in subdirs(&local_app_data.join("Claude-Data")) {
        for version in subdirs(&package.join("claude-code")) {
            let key: Vec<u64> = version.file_name().and_then(|n| n.to_str()).unwrap_or("").split('.').map(|part| part.parse().unwrap_or(0)).collect();
            for build in subdirs(&version) {
                let exe = build.join(NAMES[0]);
                if exe.is_file() {
                    found.push((key.clone(), exe));
                }
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Sucht Claude Code: erst den Pfad aus den Einstellungen, dann den Suchpfad, dann die üblichen Orte, zuletzt das der Desktop-App.
pub fn find(configured: Option<&str>) -> Option<PathBuf> {
    if let Some(path) = configured.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(path);
        return path.is_file().then_some(path);
    }
    let in_path = std::env::var_os("PATH").into_iter().flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>()).flat_map(|dir| NAMES.map(|n| dir.join(n)));
    let desktop = std::env::var_os("LOCALAPPDATA").map(|local| desktop_app_builds(Path::new(&local))).unwrap_or_default();
    in_path.chain(usual_places()).chain(desktop).find(|p| p.is_file())
}

// --- Prozess starten ---------------------------------------------------------------------

fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    // Nichts über die API abrechnen lassen und Claude Code nicht mitten im Lauf aktualisieren
    cmd.env_remove("ANTHROPIC_API_KEY").env_remove("ANTHROPIC_AUTH_TOKEN").env("DISABLE_AUTOUPDATER", "1");
    // Kein Konsolenfenster aufblitzen lassen
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd.kill_on_drop(true);
    cmd
}

/// Die Version von Claude Code („2.1.300 (Claude Code)“ → „2.1.300“); `Err` mit Grund, wenn es sich nicht starten lässt.
pub async fn version(program: &Path) -> Result<String, String> {
    let mut cmd = command(program);
    cmd.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let output = tokio::time::timeout(Duration::from_secs(20), cmd.output())
        .await
        .map_err(|_| "Claude Code hat nicht geantwortet (nach 20 Sekunden abgebrochen).".to_string())?
        .map_err(|e| format!("Claude Code konnte nicht gestartet werden: {e}"))?;
    if !output.status.success() {
        return Err(format!("Claude Code meldet einen Fehler: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    match text.split_whitespace().next() {
        Some(v) => Ok(v.to_string()),
        None => Err("Claude Code hat keine Version genannt.".to_string()),
    }
}

/// Die Parameter des Laufs. Pfade stehen nur hier, damit sich die Zusammenstellung prüfen lässt.
fn build_args(spec: &RunSpec, config_dir: &Path) -> Vec<String> {
    // Erlaubt sind die Werkzeuge der App und das Lesen im Arbeitsordner. Ein nacktes „Read“ würde das Lesen überall erlauben.
    let allowed = ["mcp__wissenszentrum", "mcp__wissenszentrum__*", "Read(./**)"];
    [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        // Text und Werkzeugstarts schon während der Arbeit melden, nicht erst am Ende
        "--include-partial-messages",
        "--model",
        spec.model,
        "--system-prompt-file",
        &config_dir.join("system.txt").to_string_lossy(),
        "--mcp-config",
        &config_dir.join("mcp.json").to_string_lossy(),
        "--strict-mcp-config",
        // Eingebaute Werkzeuge: nur Read, für Dateien, die im Arbeitsordner liegen (aus dem Chat oder von read_file)
        "--tools",
        "Read",
        "--allowedTools",
        &allowed.join(","),
        // Was nicht erlaubt ist, wird abgelehnt statt nachgefragt: es kann niemand antworten
        "--permission-mode",
        "dontAsk",
        "--max-turns",
        &spec.max_turns.to_string(),
        "--no-session-persistence",
        "--disable-slash-commands",
        // Nur Einstellungen des (leeren) Arbeitsordners: nichts aus der Konfiguration der Person
        "--setting-sources",
        "project",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Schreibt Dateinamen so um, dass sie im Arbeitsordner gefahrlos liegen (keine Pfade, keine Sonderzeichen).
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect();
    let trimmed = cleaned.trim_matches('.').to_string();
    if trimmed.is_empty() {
        "datei".into()
    } else {
        trimmed.chars().take(80).collect()
    }
}


fn rand_part() -> u128 {
    use std::hash::{BuildHasher, Hasher};
    let state = std::collections::hash_map::RandomState::new();
    let a = state.build_hasher().finish() as u128;
    let b = state.build_hasher().finish() as u128;
    (a << 64) | b
}

/// Der Ordner eines Laufs: darin `arbeit` (Arbeitsordner von Claude Code, mit den Dateien) und `konfig` (Systemtext, MCP).
/// Er wird beim Wegwerfen gelöscht, auch wenn der Lauf scheitert.
pub struct RunDir(PathBuf);

impl RunDir {
    pub fn create() -> Result<RunDir, String> {
        let nonce = format!("{:x}-{:x}", std::process::id(), rand_part());
        let dir = std::env::temp_dir().join("wissenszentrum-assistent").join(nonce);
        std::fs::create_dir_all(dir.join("arbeit")).and_then(|_| std::fs::create_dir_all(dir.join("konfig"))).map_err(|e| format!("Der Arbeitsordner für den Assistenten konnte nicht angelegt werden: {e}"))?;
        Ok(RunDir(dir))
    }

    /// Der Arbeitsordner: hier liest Claude Code Dateien
    pub fn work(&self) -> PathBuf {
        self.0.join("arbeit")
    }

    fn config(&self) -> PathBuf {
        self.0.join("konfig")
    }
}

impl Drop for RunDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

// --- Ereignisstrom lesen ----------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum Event {
    /// Das Ende des Laufs mit Antworttext, Fehlerkennzeichen und Verbrauch
    Result { text: String, is_error: bool, tokens: Tokens },
    /// Ein Stück Text, das Claude Code gerade schreibt (gestreamt). Steht danach ein Werkzeugaufruf, war es eine Arbeitsnotiz,
    /// sonst gehört es zur Antwort.
    Text(String),
    /// Claude Code beginnt einen Werkzeugaufruf (Name des Werkzeugs)
    ToolStart(String),
    /// Alles andere (Start, Zwischenstände): für die App ohne Belang, die Ergebnisse der Werkzeuge meldet der MCP-Server selbst
    Other,
}

pub fn parse_line(line: &str) -> Event {
    let Ok(value) = serde_json::from_str::<Value>(line) else { return Event::Other };
    // Gestreamte Teile (`--include-partial-messages`): Text der Hauptarbeit, nicht von Unteragenten
    if value["type"] == "stream_event" {
        if !value["parent_tool_use_id"].is_null() {
            return Event::Other;
        }
        let event = &value["event"];
        return match event["type"].as_str() {
            Some("content_block_delta") if event["delta"]["type"] == "text_delta" => match event["delta"]["text"].as_str() {
                Some(text) if !text.is_empty() => Event::Text(text.to_string()),
                _ => Event::Other,
            },
            Some("content_block_start") if event["content_block"]["type"] == "tool_use" => Event::ToolStart(event["content_block"]["name"].as_str().unwrap_or("").to_string()),
            _ => Event::Other,
        };
    }
    if value["type"] != "result" {
        return Event::Other;
    }
    let n = |key: &str| value["usage"][key].as_u64().unwrap_or(0);
    Event::Result {
        text: value["result"].as_str().unwrap_or("").to_string(),
        is_error: value["is_error"].as_bool().unwrap_or(false) || value["subtype"].as_str().is_some_and(|s| s.starts_with("error")),
        tokens: Tokens { input: n("input_tokens"), cache_write: n("cache_creation_input_tokens"), cache_read: n("cache_read_input_tokens"), output: n("output_tokens") },
    }
}

/// Eine Fehlermeldung von Claude Code auf Deutsch, mit dem, was die Person tun kann. `program` ist das Claude Code, das lief:
/// Es liegt nicht unbedingt im Suchpfad, deshalb steht sein voller Pfad in der Anleitung zur Anmeldung.
pub fn explain_failure(raw: &str, program: &Path) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("/login") || lower.contains("not logged in") || lower.contains("invalid api key") || lower.contains("authentication") || lower.contains("oauth") {
        format!(
            "Claude Code ist für diese App nicht angemeldet. Die Anmeldung der Desktop-App gilt nur dort. Öffne PowerShell, gib & \"{}\" ein (mit dem & am Anfang), und melde dich im Programm mit /login an. Danach geht es hier weiter.",
            program.display()
        )
    } else if lower.contains("usage limit") || lower.contains("limit reached") || lower.contains("rate limit") || lower.contains("rate_limit") {
        format!("Das Nutzungslimit deines Claude-Kontos ist erreicht. Versuche es später noch einmal. Meldung von Claude Code: {}", raw.trim())
    } else if lower.contains("overloaded") || lower.contains("529") {
        "Die Server von Anthropic sind gerade überlastet. Versuche es gleich noch einmal.".into()
    } else if raw.trim().is_empty() {
        "Claude Code hat keine Antwort geliefert. Versuche es noch einmal.".into()
    } else {
        format!("Claude Code meldet: {}", raw.trim())
    }
}

/// Führt einen Lauf aus. `should_stop` wird laufend gefragt: ist es wahr, wird Claude Code beendet und `stopped` gesetzt.
pub async fn run(spec: &RunSpec<'_>, should_stop: &(dyn Fn() -> bool + Send + Sync), on_event: &(dyn Fn(Event) + Send + Sync)) -> Result<RunReport, String> {
    let (work, config) = (spec.dir.work(), spec.dir.config());

    for (name, data) in spec.files {
        std::fs::write(work.join(name), data).map_err(|e| format!("Eine Datei aus dem Chat konnte nicht bereitgestellt werden: {e}"))?;
    }
    std::fs::write(config.join("system.txt"), spec.system_prompt).map_err(|e| format!("Der Systemtext konnte nicht geschrieben werden: {e}"))?;
    let servers = match spec.mcp {
        Some((url, token)) => serde_json::json!({ "mcpServers": { crate::mcp::SERVER_NAME: { "type": "http", "url": url, "headers": { "Authorization": format!("Bearer {token}") } } } }),
        None => serde_json::json!({ "mcpServers": {} }),
    };
    std::fs::write(config.join("mcp.json"), servers.to_string()).map_err(|e| format!("Die MCP-Einstellung konnte nicht geschrieben werden: {e}"))?;

    let mut cmd = command(spec.program);
    cmd.args(build_args(spec, &config)).current_dir(&work).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Claude Code konnte nicht gestartet werden: {e}"))?;

    // Die Eingabe geht über die Standardeingabe: so gibt es keine Grenze der Befehlszeile und keine Probleme mit Sonderzeichen
    if let Some(mut stdin) = child.stdin.take() {
        let prompt = spec.prompt.as_bytes().to_vec();
        tokio::spawn(async move {
            let _ = stdin.write_all(&prompt).await;
            let _ = stdin.shutdown().await;
        });
    }
    let stderr_task = child.stderr.take().map(|mut err| {
        tokio::spawn(async move {
            let mut text = String::new();
            let _ = (&mut err).take(20_000).read_to_string(&mut text).await;
            text
        })
    });
    let stdout = child.stdout.take().ok_or("Claude Code hat keinen Ausgang geliefert.")?;
    let mut lines = BufReader::new(stdout).lines();

    let started = Instant::now();
    let mut result: Option<(String, bool, Tokens)> = None;
    let mut stopped = false;
    loop {
        if should_stop() {
            stopped = true;
            break;
        }
        if started.elapsed() > MAX_RUN {
            let _ = child.start_kill();
            return Err("Der Assistent hat zu lange gebraucht und wurde beendet. Stelle die Frage enger.".into());
        }
        match tokio::time::timeout(TICK, lines.next_line()).await {
            Err(_) => continue,
            Ok(Ok(Some(line))) => {
                match parse_line(&line) {
                    Event::Result { text, is_error, tokens } => result = Some((text, is_error, tokens)),
                    Event::Other => {}
                    live => on_event(live),
                }
            }
            Ok(_) => break,
        }
    }

    if stopped {
        let _ = child.start_kill();
        let _ = child.wait().await;
        return Ok(RunReport { text: String::new(), tokens: result.map(|r| r.2).unwrap_or_default(), stopped: true });
    }
    let status = child.wait().await.map_err(|e| format!("Claude Code ließ sich nicht abschließen: {e}"))?;
    let stderr = match stderr_task {
        Some(task) => task.await.unwrap_or_default(),
        None => String::new(),
    };
    match result {
        Some((text, true, _)) => Err(explain_failure(&text, spec.program)),
        Some((text, false, tokens)) => Ok(RunReport { text, tokens, stopped: false }),
        None if !status.success() => Err(explain_failure(&stderr, spec.program)),
        None => Err("Claude Code hat keine Antwort geliefert. Versuche es noch einmal.".into()),
    }
}

/// Prüft die Verbindung mit einer winzigen Frage ohne Werkzeuge: Claude Code startet, ist angemeldet und antwortet.
pub async fn test(program: &Path) -> Result<String, String> {
    let dir = RunDir::create()?;
    let spec = RunSpec {
        dir: &dir,
        program,
        model: "claude-haiku-5-5",
        system_prompt: "Du antwortest auf Deutsch, sehr kurz.",
        prompt: "Antworte nur mit dem Wort OK.",
        files: &[],
        mcp: None,
        max_turns: 1,
    };
    let report = run(&spec, &|| false, &|_| {}).await?;
    Ok(report.text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_result_event_matters_and_carries_the_tokens() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"result":"Fertig","session_id":"s","usage":{"input_tokens":3,"output_tokens":4,"cache_creation_input_tokens":5,"cache_read_input_tokens":6}}"#;
        assert_eq!(parse_line(line), Event::Result { text: "Fertig".into(), is_error: false, tokens: Tokens { input: 3, cache_write: 5, cache_read: 6, output: 4 } });
        assert_eq!(parse_line(r#"{"type":"assistant","message":{}}"#), Event::Other);
        assert_eq!(parse_line("kein json"), Event::Other);
        assert!(matches!(parse_line(r#"{"type":"result","subtype":"error_max_turns","result":""}"#), Event::Result { is_error: true, .. }));
    }

    #[test]
    fn streamed_text_and_tool_starts_are_picked_out_of_the_event_stream() {
        let delta = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ich schaue zuerst"}},"parent_tool_use_id":null}"#;
        assert_eq!(parse_line(delta), Event::Text("Ich schaue zuerst".into()));
        let start = r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t","name":"mcp__wissenszentrum__list_tasks","input":{}}},"parent_tool_use_id":null}"#;
        assert_eq!(parse_line(start), Event::ToolStart("mcp__wissenszentrum__list_tasks".into()));
        // Gedankenblöcke kommen leer an, Eingabe-Stücke und Unteragenten gehören nicht dazu
        assert_eq!(parse_line(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}}"#), Event::Other);
        assert_eq!(parse_line(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"a\""}}}"#), Event::Other);
        assert_eq!(parse_line(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x"}},"parent_tool_use_id":"abc"}"#), Event::Other);
        assert_eq!(parse_line(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}}"#), Event::Other);
    }

    #[test]
    fn failures_are_explained_with_what_to_do() {
        let program = Path::new("C:/Claude/claude.exe");
        let login = explain_failure("Invalid API key · Please run /login", program);
        assert!(login.contains("/login") && login.contains("claude.exe"), "der volle Pfad steht in der Anleitung: {login}");
        assert!(explain_failure("Not logged in", program).contains("nicht angemeldet"));
        assert!(explain_failure("Claude AI usage limit reached|1760000000", program).contains("Nutzungslimit"));
        assert!(explain_failure("Overloaded", program).contains("überlastet"));
        assert!(explain_failure("", program).contains("keine Antwort"));
        assert_eq!(explain_failure("Etwas anderes", program), "Claude Code meldet: Etwas anderes");
    }

    #[test]
    fn file_names_are_made_safe() {
        let cleaned = safe_file_name("../../Geheim ö.pdf");
        assert_eq!(cleaned, "_.._Geheim_ö.pdf");
        assert!(!cleaned.contains('/') && !cleaned.contains('\\'));
        assert_eq!(safe_file_name("..."), "datei");
        assert_eq!(safe_file_name(""), "datei");
        assert_eq!(safe_file_name(&"a".repeat(200)).chars().count(), 80);
    }

    #[test]
    fn the_command_line_is_narrow() {
        let none: [(String, Vec<u8>); 0] = [];
        let dir = RunDir::create().unwrap();
        let spec = RunSpec { dir: &dir, program: Path::new("claude"), model: "claude-haiku-5-5", system_prompt: "S", prompt: "P", files: &none, mcp: Some(("http://127.0.0.1:1/mcp", "t")), max_turns: 40 };
        let args = build_args(&spec, Path::new("C:/x/konfig"));
        let after = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].clone());
        assert_eq!(after("--tools").as_deref(), Some("Read"), "als eingebautes Werkzeug nur das Lesen");
        assert_eq!(after("--permission-mode").as_deref(), Some("dontAsk"));
        assert_eq!(after("--model").as_deref(), Some("claude-haiku-5-5"));
        assert_eq!(after("--max-turns").as_deref(), Some("40"));
        assert!(args.contains(&"--strict-mcp-config".to_string()) && args.contains(&"--no-session-persistence".to_string()));
        let allowed = after("--allowedTools").unwrap();
        assert!(allowed.contains("Read(./**)") && !allowed.split(',').any(|r| r == "Read"), "Lesen nur im Arbeitsordner, nie überall: {allowed}");
        assert!(args.contains(&"--include-partial-messages".to_string()), "Text wird schon während der Arbeit gemeldet");

        let files = [("1-a.pdf".to_string(), vec![1u8])];
        let with_files = RunSpec { files: &files, ..spec };
        let args = build_args(&with_files, Path::new("C:/x/konfig"));
        let after = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].clone());
        assert_eq!(after("--tools").as_deref(), Some("Read"));
        assert!(after("--allowedTools").unwrap().contains("Read(./**)"));
    }

    #[test]
    fn the_newest_build_of_the_desktop_app_comes_first() {
        let local = std::env::temp_dir().join(format!("wz-desktop-test-{}", std::process::id()));
        let _cleanup = RunDir(local.clone());
        for (version, build) in [("2.1.9", "aaa"), ("2.1.321", "bbb"), ("2.1.100", "ccc")] {
            let dir = local.join("Claude-Data").join("claude_pkg").join("claude-code").join(version).join(build);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(NAMES[0]), b"x").unwrap();
        }
        // Ein Ordner ohne Programm zählt nicht
        std::fs::create_dir_all(local.join("Claude-Data").join("claude_pkg").join("claude-code").join("9.9.9").join("leer")).unwrap();
        let builds = desktop_app_builds(&local);
        let versions: Vec<String> = builds.iter().map(|p| p.parent().unwrap().parent().unwrap().file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(versions, ["2.1.321", "2.1.100", "2.1.9"], "Versionen werden als Zahlen verglichen, nicht als Text");
        assert!(desktop_app_builds(&local.join("gibt-es-nicht")).is_empty());
    }

    #[test]
    fn a_configured_path_must_exist() {
        assert!(find(Some("C:/gibt/es/nicht/claude.exe")).is_none());
        let file = std::env::temp_dir().join(format!("wz-claude-test-{}.exe", std::process::id()));
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(find(Some(&file.to_string_lossy())), Some(file.clone()));
        let _ = std::fs::remove_file(file);
    }

    /// Ein Stück Windows-Skript statt Claude Code: gibt zwei Ereignisse aus und beendet sich.
    #[cfg(windows)]
    fn fake_claude(name: &str, body: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{name}-{}.cmd", std::process::id()));
        std::fs::write(&path, format!("@echo off\r\n{body}\r\n")).unwrap();
        path
    }

    #[cfg(windows)]
    #[test]
    fn a_run_reads_the_result_and_cleans_up() {
        let program = fake_claude(
            "wz-fake-ok",
            "echo {\"type\":\"system\",\"subtype\":\"init\"}\r\necho {\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"Heute ist alles ruhig.\",\"usage\":{\"input_tokens\":7,\"output_tokens\":9,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":11}}",
        );
        let files = [("5-notiz.txt".to_string(), b"Inhalt".to_vec())];
        let dir = RunDir::create().unwrap();
        let spec = RunSpec { dir: &dir, program: &program, model: "claude-haiku-5-5", system_prompt: "S", prompt: "Was steht an?", files: &files, mcp: Some(("http://127.0.0.1:9/mcp", "t")), max_turns: 5 };
        let report = tauri::async_runtime::block_on(run(&spec, &|| false, &|_| {})).unwrap();
        assert_eq!(report.text, "Heute ist alles ruhig.");
        assert_eq!(report.tokens, Tokens { input: 7, cache_write: 0, cache_read: 11, output: 9 });
        assert!(!report.stopped);
        let _ = std::fs::remove_file(program);
    }

    #[cfg(windows)]
    #[test]
    fn a_failed_run_says_why_and_stop_ends_it() {
        let program = fake_claude("wz-fake-login", "echo {\"type\":\"result\",\"subtype\":\"success\",\"is_error\":true,\"result\":\"Invalid API key - Please run /login\"}");
        let dir = RunDir::create().unwrap();
        let spec = RunSpec { dir: &dir, program: &program, model: "m", system_prompt: "S", prompt: "P", files: &[], mcp: None, max_turns: 1 };
        let err = tauri::async_runtime::block_on(run(&spec, &|| false, &|_| {})).unwrap_err();
        assert!(err.contains("nicht angemeldet"), "{err}");
        let _ = std::fs::remove_file(program);

        // Ein Lauf, der nie fertig wird: „Stopp“ beendet ihn
        let slow = fake_claude("wz-fake-slow", "ping -n 30 127.0.0.1 > nul");
        let spec = RunSpec { dir: &dir, program: &slow, model: "m", system_prompt: "S", prompt: "P", files: &[], mcp: None, max_turns: 1 };
        let started = Instant::now();
        let report = tauri::async_runtime::block_on(run(&spec, &|| started.elapsed() > Duration::from_millis(600), &|_| {})).unwrap();
        assert!(report.stopped);
        assert!(started.elapsed() < Duration::from_secs(10));
        let _ = std::fs::remove_file(slow);
    }

    #[cfg(windows)]
    #[test]
    fn a_run_passes_on_streamed_text_and_tool_starts_while_it_works() {
        let program = fake_claude(
            "wz-fake-stream",
            "echo {\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Ich schaue zuerst\"}}}
echo {\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"name\":\"list_tasks\"}}}
echo {\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Fertig.\"}}}
echo {\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"Fertig.\",\"usage\":{}}",
        );
        let dir = RunDir::create().unwrap();
        let spec = RunSpec { dir: &dir, program: &program, model: "m", system_prompt: "S", prompt: "P", files: &[], mcp: None, max_turns: 1 };
        let seen = std::sync::Mutex::new(Vec::<Event>::new());
        let report = tauri::async_runtime::block_on(run(&spec, &|| false, &|e| seen.lock().unwrap().push(e))).unwrap();
        assert_eq!(report.text, "Fertig.");
        assert_eq!(*seen.lock().unwrap(), [Event::Text("Ich schaue zuerst".into()), Event::ToolStart("list_tasks".into()), Event::Text("Fertig.".into())], "in der Reihenfolge, in der sie kamen");
        let _ = std::fs::remove_file(program);
    }
}
