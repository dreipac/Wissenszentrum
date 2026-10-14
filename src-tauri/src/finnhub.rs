//! Kurse und Symbolsuche über die Finnhub-API (API-Key des Nutzers).

use serde::Serialize;
use std::time::Duration;

const QUOTE_URL: &str = "https://finnhub.io/api/v1/quote";
const SEARCH_URL: &str = "https://finnhub.io/api/v1/search";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolMatch {
    pub symbol: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub updated: usize,
    pub failed: Vec<String>,
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

fn check_status(status: reqwest::StatusCode) -> Result<(), String> {
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("Ungültiger API-Key.".into());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Zu viele Anfragen bei Finnhub. Bitte kurz warten.".into());
    }
    if !status.is_success() {
        return Err(format!("Finnhub antwortet mit Fehler {status}."));
    }
    Ok(())
}

/// Letzter Kurs eines Symbols.
pub async fn quote(client: &reqwest::Client, symbol: &str, api_key: &str) -> Result<f64, String> {
    let resp = client
        .get(QUOTE_URL)
        .query(&[("symbol", symbol), ("token", api_key)])
        .send()
        .await
        .map_err(|e| format!("Keine Verbindung zu Finnhub: {e}"))?;
    check_status(resp.status())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let price = body.get("c").and_then(|v| v.as_f64()).unwrap_or(0.0);
    if price <= 0.0 {
        return Err(format!("Kein Kurs für {symbol} gefunden."));
    }
    Ok(price)
}

pub async fn search(query: &str, api_key: &str) -> Result<Vec<SymbolMatch>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let resp = client()?
        .get(SEARCH_URL)
        .query(&[("q", query.trim()), ("token", api_key)])
        .send()
        .await
        .map_err(|e| format!("Keine Verbindung zu Finnhub: {e}"))?;
    check_status(resp.status())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let matches = body
        .get("result")
        .and_then(|r| r.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(SymbolMatch {
                        symbol: item.get("symbol")?.as_str()?.to_string(),
                        description: item.get("description").and_then(|d| d.as_str()).unwrap_or("").to_string(),
                    })
                })
                .take(8)
                .collect()
        })
        .unwrap_or_default();
    Ok(matches)
}

/// Prüft den Key mit einer Testabfrage.
pub async fn test_key(api_key: &str) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("Der API-Key darf nicht leer sein.".into());
    }
    quote(&client()?, "AAPL", api_key.trim()).await.map(|_| ())
}
