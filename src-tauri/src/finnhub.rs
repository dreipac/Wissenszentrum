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

// --- Kursverlauf und Kennzahlen -------------------------------------------------

const CHART_URL: &str = "https://query1.finance.yahoo.com/v8/finance/chart";
const PROFILE_URL: &str = "https://finnhub.io/api/v1/stock/profile2";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChartPoint {
    /// Zeitpunkt in Millisekunden
    pub t: i64,
    pub v: f64,
}

/// Verlauf eines Symbols samt den Kennzahlen, die der Anbieter mitliefert.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssetChart {
    pub points: Vec<ChartPoint>,
    pub currency: Option<String>,
    pub name: Option<String>,
    pub exchange: Option<String>,
    pub price: Option<f64>,
    pub previous_close: Option<f64>,
    pub day_high: Option<f64>,
    pub day_low: Option<f64>,
    pub year_high: Option<f64>,
    pub year_low: Option<f64>,
    pub volume: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssetProfile {
    pub name: Option<String>,
    pub industry: Option<String>,
    pub country: Option<String>,
    pub exchange: Option<String>,
    /// Börsenwert in Millionen der Handelswährung
    pub market_cap: Option<f64>,
    pub website: Option<String>,
}

/// Zeitraum der Anzeige → Bereich und Kerzenlänge beim Anbieter.
pub fn chart_params(range: &str) -> Result<(&'static str, &'static str), String> {
    Ok(match range {
        "1T" => ("1d", "5m"),
        "5T" => ("5d", "15m"),
        "1M" => ("1mo", "60m"),
        "6M" => ("6mo", "1d"),
        "1J" => ("1y", "1d"),
        "5J" => ("5y", "1wk"),
        other => return Err(format!("Unbekannter Zeitraum: {other}")),
    })
}

/// Finnhub-Symbol → Symbol beim Chart-Anbieter. Krypto wie `BINANCE:BTCUSDT` wird zu `BTC-USD`, Aktienklassen
/// wie `BRK.B` zu `BRK-B`; Börsen-Endungen (`NESN.SW`) bleiben.
pub fn chart_symbol(symbol: &str) -> String {
    let s = symbol.trim().to_uppercase();
    if let Some((_, pair)) = s.split_once(':') {
        if pair.contains('-') {
            return pair.to_string();
        }
        for quote in ["USDT", "USDC", "BUSD", "USD", "EUR", "CHF"] {
            if let Some(base) = pair.strip_suffix(quote) {
                if !base.is_empty() {
                    let quote = if quote == "EUR" || quote == "CHF" { quote } else { "USD" };
                    return format!("{base}-{quote}");
                }
            }
        }
        return pair.to_string();
    }
    match s.rsplit_once('.') {
        Some((head, tail)) if tail.len() == 1 && !head.is_empty() => format!("{head}-{tail}"),
        _ => s,
    }
}

fn number(value: Option<&serde_json::Value>) -> Option<f64> {
    value.and_then(|v| v.as_f64()).filter(|v| v.is_finite())
}

fn text(value: Option<&serde_json::Value>) -> Option<String> {
    value.and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Liest die Antwort des Chart-Anbieters. Lücken (`null`) werden übersprungen.
pub fn parse_chart(body: &serde_json::Value) -> Result<AssetChart, String> {
    if let Some(msg) = text(body.pointer("/chart/error/description")) {
        return Err(msg);
    }
    let result = body.pointer("/chart/result/0").ok_or("Für dieses Symbol gibt es keinen Kursverlauf.")?;
    let meta = result.get("meta");
    let m = |key: &str| number(meta.and_then(|m| m.get(key)));
    let stamps = result.get("timestamp").and_then(|t| t.as_array());
    let closes = result.pointer("/indicators/quote/0/close").and_then(|c| c.as_array());
    let points: Vec<ChartPoint> = match (stamps, closes) {
        (Some(stamps), Some(closes)) => stamps
            .iter()
            .zip(closes)
            .filter_map(|(t, c)| Some(ChartPoint { t: t.as_i64()? * 1000, v: c.as_f64().filter(|v| v.is_finite() && *v > 0.0)? }))
            .collect(),
        _ => vec![],
    };
    if points.is_empty() {
        return Err("Für diesen Zeitraum liegen keine Kurse vor.".into());
    }
    Ok(AssetChart {
        points,
        currency: text(meta.and_then(|m| m.get("currency"))),
        name: text(meta.and_then(|m| m.get("longName"))).or_else(|| text(meta.and_then(|m| m.get("shortName")))),
        exchange: text(meta.and_then(|m| m.get("fullExchangeName"))).or_else(|| text(meta.and_then(|m| m.get("exchangeName")))),
        price: m("regularMarketPrice"),
        previous_close: m("chartPreviousClose").or_else(|| m("previousClose")),
        day_high: m("regularMarketDayHigh"),
        day_low: m("regularMarketDayLow"),
        year_high: m("fiftyTwoWeekHigh"),
        year_low: m("fiftyTwoWeekLow"),
        volume: m("regularMarketVolume"),
    })
}

/// Kursverlauf eines Symbols (ohne API-Key).
pub async fn chart(symbol: &str, range: &str) -> Result<AssetChart, String> {
    let (span, interval) = chart_params(range)?;
    let url = format!("{CHART_URL}/{}", chart_symbol(symbol));
    let resp = client()?
        .get(url)
        .query(&[("range", span), ("interval", interval)])
        // Ohne Browser-Kennung lehnt der Anbieter Anfragen ab
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Wissenszentrum")
        .send()
        .await
        .map_err(|e| format!("Keine Verbindung zum Kursanbieter: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Für dieses Symbol gibt es keinen Kursverlauf.".into());
    }
    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Zu viele Anfragen beim Kursanbieter. Bitte kurz warten.".into());
    }
    if !resp.status().is_success() {
        return Err(format!("Der Kursanbieter antwortet mit Fehler {}.", resp.status()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    parse_chart(&body)
}

/// Firmendaten (Branche, Land, Börsenwert) über Finnhub; nur für Aktien, leer wenn nichts bekannt ist.
pub async fn profile(symbol: &str, api_key: &str) -> Result<AssetProfile, String> {
    let resp = client()?
        .get(PROFILE_URL)
        .query(&[("symbol", symbol.trim()), ("token", api_key)])
        .send()
        .await
        .map_err(|e| format!("Keine Verbindung zu Finnhub: {e}"))?;
    check_status(resp.status())?;
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(AssetProfile {
        name: text(body.get("name")),
        industry: text(body.get("finnhubIndustry")),
        country: text(body.get("country")),
        exchange: text(body.get("exchange")),
        market_cap: number(body.get("marketCapitalization")).filter(|v| *v > 0.0),
        website: text(body.get("weburl")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_symbols_for_the_chart_provider() {
        assert_eq!(chart_symbol("aapl"), "AAPL");
        assert_eq!(chart_symbol("BINANCE:BTCUSDT"), "BTC-USD");
        assert_eq!(chart_symbol("COINBASE:ETH-USD"), "ETH-USD");
        assert_eq!(chart_symbol("BINANCE:SOLEUR"), "SOL-EUR");
        assert_eq!(chart_symbol("BRK.B"), "BRK-B");
        assert_eq!(chart_symbol("NESN.SW"), "NESN.SW");
    }

    #[test]
    fn range_names_map_or_fail() {
        assert_eq!(chart_params("1T").unwrap(), ("1d", "5m"));
        assert_eq!(chart_params("5J").unwrap(), ("5y", "1wk"));
        assert!(chart_params("2W").is_err());
    }

    #[test]
    fn parses_chart_and_skips_gaps() {
        let body = serde_json::json!({
            "chart": { "result": [{
                "meta": { "currency": "USD", "longName": "Apple Inc.", "fullExchangeName": "NasdaqGS", "regularMarketPrice": 190.5,
                          "chartPreviousClose": 188.0, "regularMarketDayHigh": 191.0, "regularMarketDayLow": 187.5,
                          "fiftyTwoWeekHigh": 200.0, "fiftyTwoWeekLow": 150.0, "regularMarketVolume": 1234567 },
                "timestamp": [1700000000, 1700000300, 1700000600],
                "indicators": { "quote": [{ "close": [189.0, null, 190.5] }] }
            }], "error": null }
        });
        let chart = parse_chart(&body).unwrap();
        assert_eq!(chart.points, vec![ChartPoint { t: 1_700_000_000_000, v: 189.0 }, ChartPoint { t: 1_700_000_600_000, v: 190.5 }]);
        assert_eq!(chart.currency.as_deref(), Some("USD"));
        assert_eq!(chart.name.as_deref(), Some("Apple Inc."));
        assert_eq!(chart.year_low, Some(150.0));
        assert_eq!(chart.volume, Some(1_234_567.0));
    }

    #[test]
    fn chart_errors_are_readable() {
        let unknown = serde_json::json!({ "chart": { "result": null, "error": { "code": "Not Found", "description": "No data found, symbol may be delisted" } } });
        assert_eq!(parse_chart(&unknown).unwrap_err(), "No data found, symbol may be delisted");
        let empty = serde_json::json!({ "chart": { "result": [{ "meta": {}, "timestamp": [1], "indicators": { "quote": [{ "close": [null] }] } }], "error": null } });
        assert!(parse_chart(&empty).unwrap_err().contains("keine Kurse"));
        assert!(parse_chart(&serde_json::json!({})).is_err());
    }
}
