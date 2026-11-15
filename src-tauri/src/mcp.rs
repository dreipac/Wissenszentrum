//! Lokaler MCP-Server für den Assistenten.
//!
//! Der Assistent läuft über Claude Code. Claude Code holt sich die Werkzeuge der App (Aufgaben, Termine, Notizen,
//! Dokumentation) über das Model Context Protocol: ein kleiner HTTP-Server auf diesem Rechner, nur über 127.0.0.1 erreichbar
//! und nur mit einem Token, das für jeden Lauf neu gewürfelt wird. Er lebt genau so lange wie eine Antwort des Assistenten.
//!
//! Gesprochen wird der Teil von MCP, den Claude Code braucht: `initialize`, `tools/list`, `tools/call` und `ping`
//! (JSON-RPC über POST, jede Antwort als einfaches JSON).

use serde_json::{json, Value};
use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::Read;
use std::sync::Arc;
use std::thread::JoinHandle;
use tiny_http::{Header, Method, Response, Server};

/// Ergebnis eines Werkzeugaufrufs, wie es an Claude Code zurückgeht.
pub struct ToolResult {
    pub text: String,
    pub is_error: bool,
}

/// Führt ein Werkzeug aus: Name und Eingabe hinein, Ergebnis heraus.
pub type Handler = Arc<dyn Fn(&str, Value) -> ToolResult + Send + Sync>;

/// Name des Servers, wie ihn Claude Code kennt. Die Werkzeuge heißen dort `mcp__wissenszentrum__<name>`.
pub const SERVER_NAME: &str = "wissenszentrum";

/// Eine Zufallszahl aus dem Betriebssystem: `RandomState` wird bei jedem Aufruf mit frischen Schlüsseln des Systems angelegt.
fn random_u64() -> u64 {
    RandomState::new().build_hasher().finish()
}

/// Ein Token für einen Lauf: 192 Bit, hexadezimal.
fn random_token() -> String {
    format!("{:016x}{:016x}{:016x}", random_u64(), random_u64(), random_u64())
}

/// Die Werkzeuge im Format von MCP (`inputSchema` statt `input_schema`).
pub fn mcp_tools(definitions: &Value) -> Vec<Value> {
    definitions
        .as_array()
        .map(|list| {
            list.iter()
                .map(|t| json!({ "name": t["name"], "description": t["description"], "inputSchema": t["input_schema"] }))
                .collect()
        })
        .unwrap_or_default()
}

fn error_reply(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Beantwortet eine Nachricht von Claude Code. Benachrichtigungen (ohne `id`) bekommen keine Antwort.
pub fn respond(message: &Value, tools: &[Value], handler: &Handler) -> Option<Value> {
    let id = message.get("id")?;
    let method = message["method"].as_str().unwrap_or("");
    let params = &message["params"];
    Some(match method {
        "initialize" => {
            // Die Version nehmen, die Claude Code vorschlägt: wir brauchen nichts, was sich zwischen den Fassungen ändert
            let version = params["protocolVersion"].as_str().unwrap_or("2025-03-26");
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") }
                }
            })
        }
        "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
        "tools/list" => json!({ "jsonrpc": "2.0", "id": id, "result": { "tools": tools } }),
        "tools/call" => {
            let Some(name) = params["name"].as_str() else {
                return Some(error_reply(id, -32602, "Der Name des Werkzeugs fehlt."));
            };
            if !tools.iter().any(|t| t["name"] == name) {
                return Some(error_reply(id, -32602, &format!("Das Werkzeug „{name}“ gibt es nicht.")));
            }
            let arguments = if params["arguments"].is_object() { params["arguments"].clone() } else { json!({}) };
            let result = handler(name, arguments);
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "content": [{ "type": "text", "text": result.text }], "isError": result.is_error }
            })
        }
        other => error_reply(id, -32601, &format!("Die Methode „{other}“ kennt dieser Server nicht.")),
    })
}

/// Der laufende Server. Beim Wegwerfen hört er auf.
pub struct McpServer {
    server: Arc<Server>,
    thread: Option<JoinHandle<()>>,
    pub port: u16,
    pub token: String,
}

impl McpServer {
    pub fn start(tools: Vec<Value>, handler: Handler) -> Result<McpServer, String> {
        let server = Server::http("127.0.0.1:0").map_err(|e| format!("Der lokale Server für den Assistenten konnte nicht starten: {e}"))?;
        let port = server.server_addr().to_ip().map(|a| a.port()).ok_or("Der lokale Server für den Assistenten hat keine Adresse.")?;
        let server = Arc::new(server);
        let token = random_token();

        let thread = {
            let server = server.clone();
            let expected = format!("Bearer {token}");
            std::thread::spawn(move || {
                for mut request in server.incoming_requests() {
                    let authorized = request.headers().iter().any(|h| h.field.equiv("Authorization") && h.value.as_str() == expected);
                    let reply = if !authorized {
                        Response::from_string("Nicht erlaubt.").with_status_code(401).boxed()
                    } else if request.url() != "/mcp" {
                        Response::from_string("Unbekannter Pfad.").with_status_code(404).boxed()
                    } else if *request.method() != Method::Post {
                        // Einen Stream vom Server aus (GET) gibt es nicht: die Spezifikation erlaubt dafür 405
                        Response::empty(405).boxed()
                    } else {
                        let mut body = String::new();
                        if request.as_reader().take(20_000_000).read_to_string(&mut body).is_err() {
                            Response::from_string("Der Inhalt war nicht lesbar.").with_status_code(400).boxed()
                        } else {
                            match serde_json::from_str::<Value>(&body) {
                                Err(_) => Response::from_string("Kein gültiges JSON.").with_status_code(400).boxed(),
                                Ok(message) => {
                                    let answer = match &message {
                                        Value::Array(batch) => {
                                            let all: Vec<Value> = batch.iter().filter_map(|m| respond(m, &tools, &handler)).collect();
                                            (!all.is_empty()).then(|| Value::Array(all))
                                        }
                                        single => respond(single, &tools, &handler),
                                    };
                                    match answer {
                                        None => Response::empty(202).boxed(),
                                        Some(value) => {
                                            let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("gültiger Kopf");
                                            Response::from_string(value.to_string()).with_header(header).boxed()
                                        }
                                    }
                                }
                            }
                        }
                    };
                    let _ = request.respond(reply);
                }
            })
        };

        Ok(McpServer { server, thread: Some(thread), port, token })
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}/mcp", self.port)
    }
}

impl Drop for McpServer {
    fn drop(&mut self) {
        self.server.unblock();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;

    fn handler() -> Handler {
        Arc::new(|name, input| {
            if name == "fail" {
                ToolResult { text: "kaputt".into(), is_error: true }
            } else {
                ToolResult { text: format!("{name}:{input}"), is_error: false }
            }
        })
    }

    fn tools() -> Vec<Value> {
        mcp_tools(&json!([
            { "name": "echo", "description": "Gibt zurück", "input_schema": { "type": "object", "properties": {} } },
            { "name": "fail", "description": "Scheitert", "input_schema": { "type": "object" } }
        ]))
    }

    /// Schickt eine rohe HTTP-Anfrage und gibt Statuszeile und Inhalt zurück.
    fn post(server: &McpServer, token: Option<&str>, path: &str, body: &str) -> (String, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
        let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
        write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        let mut text = String::new();
        stream.read_to_string(&mut text).unwrap();
        let (head, payload) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
        (head.lines().next().unwrap_or("").to_string(), payload.to_string())
    }

    #[test]
    fn tools_are_listed_in_the_mcp_format() {
        let list = tools();
        assert_eq!(list[0]["name"], "echo");
        assert!(list[0].get("inputSchema").is_some() && list[0].get("input_schema").is_none());
    }

    #[test]
    fn the_handshake_echoes_the_protocol_version_and_notifications_get_no_reply() {
        let h = handler();
        let init = respond(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } }), &tools(), &h).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert!(init["result"]["capabilities"]["tools"].is_object());
        assert!(respond(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), &tools(), &h).is_none());
        assert_eq!(respond(&json!({ "jsonrpc": "2.0", "id": 2, "method": "ping" }), &tools(), &h).unwrap()["result"], json!({}));
    }

    #[test]
    fn calls_reach_the_handler_and_unknown_things_are_errors() {
        let h = handler();
        let ok = respond(&json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "echo", "arguments": { "a": 1 } } }), &tools(), &h).unwrap();
        assert_eq!(ok["result"]["content"][0]["text"], "echo:{\"a\":1}");
        assert_eq!(ok["result"]["isError"], false);
        let failed = respond(&json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "fail" } }), &tools(), &h).unwrap();
        assert_eq!(failed["result"]["isError"], true);
        let unknown = respond(&json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": { "name": "nope" } }), &tools(), &h).unwrap();
        assert_eq!(unknown["error"]["code"], -32602);
        let method = respond(&json!({ "jsonrpc": "2.0", "id": 6, "method": "prompts/list" }), &tools(), &h).unwrap();
        assert_eq!(method["error"]["code"], -32601);
    }

    #[test]
    fn the_server_needs_the_token_and_answers_over_http() {
        let server = McpServer::start(tools(), handler()).unwrap();
        assert_eq!(server.token.len(), 48);
        let list = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;

        let (status, _) = post(&server, None, "/mcp", list);
        assert!(status.contains("401"), "{status}");
        let (status, _) = post(&server, Some("falsch"), "/mcp", list);
        assert!(status.contains("401"), "{status}");
        let (status, _) = post(&server, Some(&server.token), "/anderswo", list);
        assert!(status.contains("404"), "{status}");

        let (status, body) = post(&server, Some(&server.token), "/mcp", list);
        assert!(status.contains("200"), "{status}");
        let reply: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(reply["result"]["tools"][1]["name"], "fail");

        let (status, body) = post(&server, Some(&server.token), "/mcp", r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        assert!(status.contains("202") && body.is_empty(), "{status} {body}");
        let (status, _) = post(&server, Some(&server.token), "/mcp", "kein json");
        assert!(status.contains("400"), "{status}");
    }

    #[test]
    fn two_runs_get_different_tokens() {
        assert_ne!(random_token(), random_token());
    }
}
