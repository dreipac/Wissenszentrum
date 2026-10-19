//! Trading: Positionen mit Ausführungen, Orders, Guthaben, Edelmetalle, Kurse und Einstellungen.
//!
//! Grundidee:
//! * Eine Position (`trades`) besteht aus Ausführungen (`trade_executions`): Kauf, Nachkauf, (Teil-)Verkauf.
//!   Menge, Durchschnittspreis und realisierter Gewinn werden daraus berechnet (Durchschnittskosten-Methode).
//! * Das Guthaben ergibt sich aus Einzahlungen/Auszahlungen und den Geldflüssen aller Ausführungen.
//! * Alle Preise einer Position stehen in deren Währung; `fx_rate` rechnet 1 Einheit in CHF um (von Hand gepflegt).
//! * Zeitangaben der Nutzer sind lokale Zeit `YYYY-MM-DD HH:MM`; `created_at`-Spalten der Datenbank sind UTC.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const ASSET_CLASSES: &[&str] = &["aktie", "krypto"];
const METALS: &[&str] = &["gold", "silber", "platin", "palladium"];
const UNITS: &[&str] = &["g", "kg", "oz"];
const EPS: f64 = 1e-9;
/// Toleranz bei Geldvergleichen (Rundung)
const MONEY_EPS: f64 = 0.005;

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    pub id: i64,
    pub trade_id: i64,
    /// "buy" | "sell"
    pub kind: String,
    pub quantity: f64,
    pub price: f64,
    pub fee: f64,
    pub executed_at: String,
    /// Realisierter Gewinn dieser Ausführung in CHF (nur bei Verkäufen, sonst 0)
    pub realized_chf: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub id: i64,
    pub symbol: String,
    pub name: String,
    pub asset_class: String,
    pub currency: String,
    pub fx_rate: f64,
    /// "order" | "open" | "closed"
    pub status: String,
    pub stop_loss: Option<f64>,
    pub target: Option<f64>,
    pub thesis: String,
    pub close_note: String,
    pub planned_quantity: Option<f64>,
    pub planned_price: Option<f64>,
    pub valid_until: Option<String>,
    pub created_at: String,
    pub closed_at: Option<String>,
    pub executions: Vec<Execution>,
    // Abgeleitet aus den Ausführungen:
    /// Aktuell gehaltene Menge
    pub quantity: f64,
    /// Durchschnittlicher Einstiegspreis ohne Gebühren (in Positionswährung)
    pub avg_price: f64,
    /// Gebundenes Kapital der offenen Menge in CHF (inkl. Gebühren)
    pub cost_chf: f64,
    /// Summe der realisierten Gewinne/Verluste in CHF
    pub realized_chf: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashMovement {
    pub id: i64,
    /// "deposit" | "withdrawal"
    pub kind: String,
    pub amount: f64,
    pub note: String,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metal {
    pub id: i64,
    pub name: String,
    pub metal: String,
    pub quantity: f64,
    pub unit: String,
    /// Gesamter Kaufpreis in CHF (optional)
    pub cost_chf: Option<f64>,
    /// Spotpreis in CHF je Feinunze (Troy Ounce), von Hand
    pub spot_chf_per_oz: Option<f64>,
    pub spot_updated_at: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub symbol: String,
    pub price: f64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub day: String,
    pub value_chf: f64,
}

/// Zwischenstand des Gesamtvermögens (Zeit in UTC, `YYYY-MM-DD HH:MM:SS`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub ts: String,
    pub value_chf: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingState {
    pub trades: Vec<Trade>,
    pub movements: Vec<CashMovement>,
    pub cash_chf: f64,
    pub metals: Vec<Metal>,
    pub quotes: Vec<Quote>,
    pub snapshots: Vec<Snapshot>,
    /// Zwischenstände der letzten Tage für den Tagesverlauf
    pub samples: Vec<Sample>,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTrade {
    /// "position" (bereits gekauft) | "order" (geplant)
    pub kind: String,
    pub symbol: String,
    #[serde(default)]
    pub name: String,
    pub asset_class: String,
    pub currency: String,
    pub fx_rate: f64,
    pub quantity: f64,
    pub price: f64,
    #[serde(default)]
    pub fee: f64,
    /// Zeitpunkt des Kaufs (nur bei Positionen)
    #[serde(default)]
    pub executed_at: String,
    #[serde(default)]
    pub stop_loss: Option<f64>,
    #[serde(default)]
    pub target: Option<f64>,
    #[serde(default)]
    pub thesis: String,
    /// Gültigkeit der Order als Datum `YYYY-MM-DD` (leer = bis auf Widerruf)
    #[serde(default)]
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewExecution {
    /// "buy" | "sell" (bei der Ausführung einer Order immer Kauf)
    #[serde(default)]
    pub kind: String,
    pub quantity: f64,
    pub price: f64,
    #[serde(default)]
    pub fee: f64,
    pub executed_at: String,
    /// Optional neuer Wechselkurs (z. B. beim Ausführen einer Order)
    #[serde(default)]
    pub fx_rate: Option<f64>,
    /// Notiz beim vollständigen Schliessen
    #[serde(default)]
    pub close_note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeMeta {
    pub name: String,
    #[serde(default)]
    pub stop_loss: Option<f64>,
    #[serde(default)]
    pub target: Option<f64>,
    #[serde(default)]
    pub thesis: String,
    pub fx_rate: f64,
    #[serde(default)]
    pub valid_until: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetalInput {
    pub name: String,
    pub metal: String,
    pub quantity: f64,
    pub unit: String,
    #[serde(default)]
    pub cost_chf: Option<f64>,
    #[serde(default)]
    pub spot_chf_per_oz: Option<f64>,
    #[serde(default)]
    pub note: String,
}

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

fn is_datetime(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 16
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b' '
        && b[13] == b':'
        && b.iter().enumerate().all(|(i, c)| matches!(i, 4 | 7 | 10 | 13) || c.is_ascii_digit())
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| matches!(i, 4 | 7) || c.is_ascii_digit())
}

fn positive(value: f64, what: &str) -> Result<(), String> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(format!("{what} muss größer als 0 sein."))
    }
}

fn optional_positive(value: Option<f64>, what: &str) -> Result<(), String> {
    match value {
        Some(v) => positive(v, what),
        None => Ok(()),
    }
}

fn check_currency(currency: &str, fx_rate: f64) -> Result<(String, f64), String> {
    let currency = currency.trim().to_uppercase();
    if currency.len() < 3 || currency.len() > 5 || !currency.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err("Ungültige Währung (z. B. CHF, USD, EUR).".into());
    }
    if currency == "CHF" {
        return Ok((currency, 1.0));
    }
    positive(fx_rate, "Der Wechselkurs")?;
    Ok((currency, fx_rate))
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/// Gleicht die Ausführungen chronologisch ab und leitet Menge, Durchschnittspreis und Gewinn ab.
fn derive(trade: &mut Trade) {
    let (mut qty, mut avg_price, mut avg_cost, mut realized) = (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64);
    for e in trade.executions.iter_mut() {
        if e.kind == "buy" {
            let new_qty = qty + e.quantity;
            avg_price = (avg_price * qty + e.price * e.quantity) / new_qty;
            avg_cost = (avg_cost * qty + e.price * e.quantity + e.fee) / new_qty;
            qty = new_qty;
            e.realized_chf = 0.0;
        } else {
            let gain = ((e.price * e.quantity - e.fee) - avg_cost * e.quantity) * trade.fx_rate;
            e.realized_chf = gain;
            realized += gain;
            qty -= e.quantity;
            if qty < EPS {
                qty = 0.0;
            }
        }
    }
    trade.quantity = qty;
    trade.avg_price = avg_price;
    trade.cost_chf = qty * avg_cost * trade.fx_rate;
    trade.realized_chf = realized;
}

const TRADE_COLUMNS: &str = "id, symbol, name, asset_class, currency, fx_rate, status, stop_loss, target, thesis, close_note, \
                             planned_quantity, planned_price, valid_until, created_at, closed_at";

fn load_trades(conn: &Connection, only: Option<i64>) -> Result<Vec<Trade>, String> {
    let sql = format!("SELECT {TRADE_COLUMNS} FROM trades WHERE (?1 IS NULL OR id = ?1) ORDER BY id DESC");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![only], |r| {
            Ok(Trade {
                id: r.get(0)?,
                symbol: r.get(1)?,
                name: r.get(2)?,
                asset_class: r.get(3)?,
                currency: r.get(4)?,
                fx_rate: r.get(5)?,
                status: r.get(6)?,
                stop_loss: r.get(7)?,
                target: r.get(8)?,
                thesis: r.get(9)?,
                close_note: r.get(10)?,
                planned_quantity: r.get(11)?,
                planned_price: r.get(12)?,
                valid_until: r.get(13)?,
                created_at: r.get(14)?,
                closed_at: r.get(15)?,
                executions: Vec::new(),
                quantity: 0.0,
                avg_price: 0.0,
                cost_chf: 0.0,
                realized_chf: 0.0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut trades: Vec<Trade> = rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, trade_id, kind, quantity, price, fee, executed_at FROM trade_executions
             WHERE (?1 IS NULL OR trade_id = ?1) ORDER BY executed_at, id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![only], |r| {
            Ok(Execution {
                id: r.get(0)?,
                trade_id: r.get(1)?,
                kind: r.get(2)?,
                quantity: r.get(3)?,
                price: r.get(4)?,
                fee: r.get(5)?,
                executed_at: r.get(6)?,
                realized_chf: 0.0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut by_trade: HashMap<i64, Vec<Execution>> = HashMap::new();
    for row in rows {
        let e = row.map_err(|e| e.to_string())?;
        by_trade.entry(e.trade_id).or_default().push(e);
    }
    for t in trades.iter_mut() {
        t.executions = by_trade.remove(&t.id).unwrap_or_default();
        derive(t);
    }
    Ok(trades)
}

pub fn get_trade(conn: &Connection, id: i64) -> Result<Trade, String> {
    load_trades(conn, Some(id))?.into_iter().next().ok_or_else(|| "Position nicht gefunden.".to_string())
}

/// Verfügbares Guthaben in CHF.
pub fn cash_chf(conn: &Connection) -> Result<f64, String> {
    let movements: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE kind WHEN 'deposit' THEN amount ELSE -amount END), 0) FROM cash_movements",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let trades: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE e.kind WHEN 'buy' THEN -(e.quantity * e.price + e.fee)
                                              ELSE (e.quantity * e.price - e.fee) END * t.fx_rate), 0)
             FROM trade_executions e JOIN trades t ON t.id = e.trade_id",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(movements + trades)
}

pub fn state(conn: &Connection) -> Result<TradingState, String> {
    let mut stmt = conn
        .prepare("SELECT id, kind, amount, note, occurred_at FROM cash_movements ORDER BY occurred_at DESC, id DESC")
        .map_err(|e| e.to_string())?;
    let movements = stmt
        .query_map([], |r| {
            Ok(CashMovement { id: r.get(0)?, kind: r.get(1)?, amount: r.get(2)?, note: r.get(3)?, occurred_at: r.get(4)? })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT symbol, price, updated_at FROM quotes ORDER BY symbol")
        .map_err(|e| e.to_string())?;
    let quotes = stmt
        .query_map([], |r| Ok(Quote { symbol: r.get(0)?, price: r.get(1)?, updated_at: r.get(2)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT day, value_chf FROM portfolio_snapshots ORDER BY day")
        .map_err(|e| e.to_string())?;
    let snapshots = stmt
        .query_map([], |r| Ok(Snapshot { day: r.get(0)?, value_chf: r.get(1)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare("SELECT ts, value_chf FROM portfolio_samples ORDER BY ts").map_err(|e| e.to_string())?;
    let samples = stmt
        .query_map([], |r| Ok(Sample { ts: r.get(0)?, value_chf: r.get(1)? }))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(TradingState {
        trades: load_trades(conn, None)?,
        movements,
        cash_chf: cash_chf(conn)?,
        metals: list_metals(conn)?,
        quotes,
        snapshots,
        samples,
        has_api_key: get_setting(conn, "finnhub_api_key")?.map(|k| !k.trim().is_empty()).unwrap_or(false),
    })
}

// ---------------------------------------------------------------------------
// Positionen und Orders
// ---------------------------------------------------------------------------

fn ensure_cash(conn: &Connection, cost_chf: f64) -> Result<(), String> {
    let cash = cash_chf(conn)?;
    if cost_chf > cash + MONEY_EPS {
        return Err(format!(
            "Das Guthaben reicht nicht: benötigt {cost_chf:.2} CHF, verfügbar {cash:.2} CHF. Lade zuerst Guthaben auf."
        ));
    }
    Ok(())
}

fn insert_execution(conn: &Connection, trade_id: i64, kind: &str, e: &NewExecution) -> Result<(), String> {
    conn.execute(
        "INSERT INTO trade_executions (trade_id, kind, quantity, price, fee, executed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![trade_id, kind, e.quantity, e.price, e.fee, e.executed_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn check_execution(e: &NewExecution) -> Result<(), String> {
    positive(e.quantity, "Die Menge")?;
    positive(e.price, "Der Preis")?;
    if !e.fee.is_finite() || e.fee < 0.0 {
        return Err("Die Gebühr darf nicht negativ sein.".into());
    }
    if !is_datetime(&e.executed_at) {
        return Err("Ungültiger Zeitpunkt (erwartet: YYYY-MM-DD HH:MM).".into());
    }
    Ok(())
}

pub fn create_trade(conn: &Connection, input: &NewTrade) -> Result<Trade, String> {
    let symbol = input.symbol.trim().to_uppercase();
    if symbol.is_empty() {
        return Err("Das Symbol darf nicht leer sein.".into());
    }
    if !ASSET_CLASSES.contains(&input.asset_class.as_str()) {
        return Err(format!("Unbekannte Anlageklasse: {}", input.asset_class));
    }
    let (currency, fx) = check_currency(&input.currency, input.fx_rate)?;
    positive(input.quantity, "Die Menge")?;
    positive(input.price, "Der Preis")?;
    if !input.fee.is_finite() || input.fee < 0.0 {
        return Err("Die Gebühr darf nicht negativ sein.".into());
    }
    optional_positive(input.stop_loss, "Der Stop-Loss")?;
    optional_positive(input.target, "Das Ziel")?;
    let name = if input.name.trim().is_empty() { symbol.clone() } else { input.name.trim().to_string() };

    match input.kind.as_str() {
        "position" => {
            let exec = NewExecution {
                kind: "buy".into(),
                quantity: input.quantity,
                price: input.price,
                fee: input.fee,
                executed_at: input.executed_at.clone(),
                fx_rate: None,
                close_note: String::new(),
            };
            check_execution(&exec)?;
            ensure_cash(conn, (input.quantity * input.price + input.fee) * fx)?;
            conn.execute(
                "INSERT INTO trades (symbol, name, asset_class, currency, fx_rate, status, stop_loss, target, thesis)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7, ?8)",
                params![symbol, name, input.asset_class, currency, fx, input.stop_loss, input.target, input.thesis],
            )
            .map_err(|e| e.to_string())?;
            let id = conn.last_insert_rowid();
            insert_execution(conn, id, "buy", &exec)?;
            get_trade(conn, id)
        }
        "order" => {
            let valid_until = input.valid_until.clone().filter(|v| !v.trim().is_empty());
            if let Some(v) = &valid_until {
                if !is_date(v) {
                    return Err("Ungültiges Datum bei „Gültig bis“.".into());
                }
            }
            conn.execute(
                "INSERT INTO trades (symbol, name, asset_class, currency, fx_rate, status, stop_loss, target, thesis,
                                     planned_quantity, planned_price, valid_until)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'order', ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    symbol, name, input.asset_class, currency, fx, input.stop_loss, input.target, input.thesis,
                    input.quantity, input.price, valid_until
                ],
            )
            .map_err(|e| e.to_string())?;
            get_trade(conn, conn.last_insert_rowid())
        }
        other => Err(format!("Unbekannte Art: {other}")),
    }
}

/// Führt eine Order aus: sie wird zur offenen Position mit einem Kauf.
pub fn execute_order(conn: &Connection, id: i64, input: &NewExecution) -> Result<Trade, String> {
    let trade = get_trade(conn, id)?;
    if trade.status != "order" {
        return Err("Nur Orders können ausgeführt werden.".into());
    }
    check_execution(input)?;
    let fx = match input.fx_rate {
        Some(rate) if trade.currency != "CHF" => {
            positive(rate, "Der Wechselkurs")?;
            rate
        }
        _ => trade.fx_rate,
    };
    ensure_cash(conn, (input.quantity * input.price + input.fee) * fx)?;
    insert_execution(conn, id, "buy", input)?;
    conn.execute("UPDATE trades SET status = 'open', fx_rate = ?1 WHERE id = ?2", params![fx, id])
        .map_err(|e| e.to_string())?;
    get_trade(conn, id)
}

/// Nachkauf oder (Teil-)Verkauf einer offenen Position. Ist nichts mehr übrig, wird sie geschlossen.
pub fn add_execution(conn: &Connection, id: i64, input: &NewExecution) -> Result<Trade, String> {
    let trade = get_trade(conn, id)?;
    if trade.status != "open" {
        return Err("Nur offene Positionen können angepasst werden.".into());
    }
    check_execution(input)?;
    match input.kind.as_str() {
        "buy" => {
            ensure_cash(conn, (input.quantity * input.price + input.fee) * trade.fx_rate)?;
            insert_execution(conn, id, "buy", input)?;
        }
        "sell" => {
            if input.quantity > trade.quantity + EPS {
                return Err(format!("Du hältst nur {} Stück, kannst also nicht {} verkaufen.", trade.quantity, input.quantity));
            }
            insert_execution(conn, id, "sell", input)?;
            if trade.quantity - input.quantity < EPS {
                conn.execute(
                    "UPDATE trades SET status = 'closed', closed_at = ?1, close_note = ?2 WHERE id = ?3",
                    params![input.executed_at, input.close_note.trim(), id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        other => return Err(format!("Unbekannte Art: {other}")),
    }
    get_trade(conn, id)
}

pub fn update_trade(conn: &Connection, id: i64, input: &TradeMeta) -> Result<Trade, String> {
    let trade = get_trade(conn, id)?;
    optional_positive(input.stop_loss, "Der Stop-Loss")?;
    optional_positive(input.target, "Das Ziel")?;
    let fx = if trade.currency == "CHF" {
        1.0
    } else {
        positive(input.fx_rate, "Der Wechselkurs")?;
        input.fx_rate
    };
    let valid_until = input.valid_until.clone().filter(|v| !v.trim().is_empty());
    if let Some(v) = &valid_until {
        if !is_date(v) {
            return Err("Ungültiges Datum bei „Gültig bis“.".into());
        }
    }
    let name = if input.name.trim().is_empty() { trade.symbol.clone() } else { input.name.trim().to_string() };
    conn.execute(
        "UPDATE trades SET name = ?1, stop_loss = ?2, target = ?3, thesis = ?4, fx_rate = ?5,
                           valid_until = CASE status WHEN 'order' THEN ?6 ELSE valid_until END
         WHERE id = ?7",
        params![name, input.stop_loss, input.target, input.thesis, fx, valid_until, id],
    )
    .map_err(|e| e.to_string())?;
    get_trade(conn, id)
}

/// Löscht Position oder Order samt Ausführungen. Das Guthaben passt sich entsprechend an.
pub fn delete_trade(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn.execute("DELETE FROM trades WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Position nicht gefunden.".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Guthaben
// ---------------------------------------------------------------------------

pub fn add_cash_movement(conn: &Connection, kind: &str, amount: f64, note: &str, occurred_at: &str) -> Result<(), String> {
    if kind != "deposit" && kind != "withdrawal" {
        return Err(format!("Unbekannte Art: {kind}"));
    }
    positive(amount, "Der Betrag")?;
    if !is_datetime(occurred_at) {
        return Err("Ungültiger Zeitpunkt (erwartet: YYYY-MM-DD HH:MM).".into());
    }
    if kind == "withdrawal" {
        ensure_cash(conn, amount)?;
    }
    conn.execute(
        "INSERT INTO cash_movements (kind, amount, note, occurred_at) VALUES (?1, ?2, ?3, ?4)",
        params![kind, amount, note.trim(), occurred_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Löscht eine Kapitalbewegung, solange das Guthaben dadurch nicht negativ wird.
pub fn delete_cash_movement(conn: &Connection, id: i64) -> Result<(), String> {
    let (kind, amount): (String, f64) = conn
        .query_row("SELECT kind, amount FROM cash_movements WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "Kapitalbewegung nicht gefunden.".to_string())?;
    if kind == "deposit" && cash_chf(conn)? - amount < -MONEY_EPS {
        return Err("Nicht möglich: Das Guthaben würde dadurch negativ.".into());
    }
    conn.execute("DELETE FROM cash_movements WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Edelmetalle
// ---------------------------------------------------------------------------

pub fn list_metals(conn: &Connection) -> Result<Vec<Metal>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, metal, quantity, unit, cost_chf, spot_chf_per_oz, spot_updated_at, note FROM metals ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Metal {
                id: r.get(0)?,
                name: r.get(1)?,
                metal: r.get(2)?,
                quantity: r.get(3)?,
                unit: r.get(4)?,
                cost_chf: r.get(5)?,
                spot_chf_per_oz: r.get(6)?,
                spot_updated_at: r.get(7)?,
                note: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

fn check_metal(input: &MetalInput) -> Result<String, String> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Die Bezeichnung darf nicht leer sein.".into());
    }
    if !METALS.contains(&input.metal.as_str()) {
        return Err(format!("Unbekanntes Metall: {}", input.metal));
    }
    if !UNITS.contains(&input.unit.as_str()) {
        return Err(format!("Unbekannte Einheit: {}", input.unit));
    }
    positive(input.quantity, "Die Menge")?;
    if let Some(c) = input.cost_chf {
        if !c.is_finite() || c < 0.0 {
            return Err("Der Kaufpreis darf nicht negativ sein.".into());
        }
    }
    optional_positive(input.spot_chf_per_oz, "Der Spotpreis")?;
    Ok(name.to_string())
}

pub fn create_metal(conn: &Connection, input: &MetalInput) -> Result<(), String> {
    let name = check_metal(input)?;
    conn.execute(
        "INSERT INTO metals (name, metal, quantity, unit, cost_chf, spot_chf_per_oz, spot_updated_at, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, CASE WHEN ?6 IS NULL THEN NULL ELSE datetime('now') END, ?7)",
        params![name, input.metal, input.quantity, input.unit, input.cost_chf, input.spot_chf_per_oz, input.note.trim()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_metal(conn: &Connection, id: i64, input: &MetalInput) -> Result<(), String> {
    let name = check_metal(input)?;
    let changed = conn
        .execute(
            "UPDATE metals SET name = ?1, metal = ?2, quantity = ?3, unit = ?4, cost_chf = ?5,
                 spot_updated_at = CASE WHEN spot_chf_per_oz IS NOT ?6 THEN
                     (CASE WHEN ?6 IS NULL THEN NULL ELSE datetime('now') END) ELSE spot_updated_at END,
                 spot_chf_per_oz = ?6, note = ?7
             WHERE id = ?8",
            params![name, input.metal, input.quantity, input.unit, input.cost_chf, input.spot_chf_per_oz, input.note.trim(), id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Edelmetall nicht gefunden.".into());
    }
    Ok(())
}

pub fn delete_metal(conn: &Connection, id: i64) -> Result<(), String> {
    let changed = conn.execute("DELETE FROM metals WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Edelmetall nicht gefunden.".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Kurse, Schnappschüsse, Einstellungen
// ---------------------------------------------------------------------------

/// Symbole, für die Kurse gebraucht werden (offene Positionen und Orders).
pub fn tracked_symbols(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT symbol FROM trades WHERE status IN ('open', 'order') ORDER BY symbol")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

pub fn set_quote(conn: &Connection, symbol: &str, price: f64) -> Result<(), String> {
    let symbol = symbol.trim().to_uppercase();
    if symbol.is_empty() {
        return Err("Das Symbol darf nicht leer sein.".into());
    }
    positive(price, "Der Kurs")?;
    conn.execute(
        "INSERT INTO quotes (symbol, price, updated_at) VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at",
        params![symbol, price],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hält den Gesamtwert eines Tages (`YYYY-MM-DD`) fest; mehrfaches Speichern am selben Tag überschreibt.
pub fn save_snapshot(conn: &Connection, day: &str, value_chf: f64) -> Result<(), String> {
    if !is_date(day) {
        return Err("Ungültiges Datum.".into());
    }
    if !value_chf.is_finite() {
        return Err("Ungültiger Wert.".into());
    }
    conn.execute(
        "INSERT INTO portfolio_snapshots (day, value_chf) VALUES (?1, ?2)
         ON CONFLICT(day) DO UPDATE SET value_chf = excluded.value_chf",
        params![day, value_chf],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mindestabstand zwischen zwei Zwischenständen, solange sich der Wert nicht ändert
const SAMPLE_IDLE_SECS: i64 = 600;
/// Mindestabstand zwischen zwei Zwischenständen bei geänderten Werten
const SAMPLE_MIN_SECS: i64 = 30;
/// So lange bleiben Zwischenstände erhalten; ältere Tage deckt der Tagesstand ab
const SAMPLE_KEEP_DAYS: i64 = 8;

/// Hält den Gesamtwert für den Tagesverlauf fest. Unveränderte Werte werden nur selten wiederholt, damit die
/// Tabelle klein bleibt; Zwischenstände älter als ein Tag werden auf einen je zehn Minuten ausgedünnt.
pub fn save_sample(conn: &Connection, value_chf: f64) -> Result<(), String> {
    if !value_chf.is_finite() {
        return Err("Ungültiger Wert.".into());
    }
    let value_chf = (value_chf * 100.0).round() / 100.0;
    let last: Option<(f64, i64)> = conn
        .query_row(
            "SELECT value_chf, CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', ts) AS INTEGER)
             FROM portfolio_samples ORDER BY ts DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((value, age)) = last {
        let unchanged = (value - value_chf).abs() < 0.005;
        if (unchanged && age < SAMPLE_IDLE_SECS) || age < SAMPLE_MIN_SECS {
            return Ok(());
        }
    }
    conn.execute(
        "INSERT INTO portfolio_samples (ts, value_chf) VALUES (datetime('now'), ?1)
         ON CONFLICT(ts) DO UPDATE SET value_chf = excluded.value_chf",
        params![value_chf],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM portfolio_samples WHERE ts < datetime('now', ?1)", params![format!("-{SAMPLE_KEEP_DAYS} days")])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM portfolio_samples
         WHERE ts < datetime('now', '-1 day')
           AND rowid NOT IN (
               SELECT MIN(rowid) FROM portfolio_samples WHERE ts < datetime('now', '-1 day') GROUP BY substr(ts, 1, 15)
           )",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        db::init(&c).unwrap();
        c
    }

    fn deposit(c: &Connection, amount: f64) {
        add_cash_movement(c, "deposit", amount, "", "2026-01-01 09:00").unwrap();
    }

    fn position(symbol: &str, qty: f64, price: f64) -> NewTrade {
        NewTrade {
            kind: "position".into(),
            symbol: symbol.into(),
            name: String::new(),
            asset_class: "aktie".into(),
            currency: "CHF".into(),
            fx_rate: 1.0,
            quantity: qty,
            price,
            fee: 0.0,
            executed_at: "2026-02-01 10:00".into(),
            stop_loss: None,
            target: None,
            thesis: String::new(),
            valid_until: None,
        }
    }

    fn exec(kind: &str, qty: f64, price: f64, at: &str) -> NewExecution {
        NewExecution { kind: kind.into(), quantity: qty, price, fee: 0.0, executed_at: at.into(), fx_rate: None, close_note: String::new() }
    }

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-6, "{a} != {b}");
    }

    #[test]
    fn cash_follows_deposits_and_trades() {
        let c = conn();
        deposit(&c, 10_000.0);
        let mut p = position("nesn", 10.0, 90.0);
        p.fee = 5.0;
        let t = create_trade(&c, &p).unwrap();
        assert_eq!(t.symbol, "NESN", "Symbol wird groß geschrieben");
        assert_eq!(t.name, "NESN", "Ohne Namen gilt das Symbol");
        approx(cash_chf(&c).unwrap(), 10_000.0 - 905.0);
        approx(t.quantity, 10.0);
        approx(t.avg_price, 90.0);
        approx(t.cost_chf, 905.0);
    }

    #[test]
    fn position_needs_enough_cash() {
        let c = conn();
        deposit(&c, 500.0);
        let err = create_trade(&c, &position("A", 10.0, 90.0)).unwrap_err();
        assert!(err.contains("Guthaben reicht nicht"), "{err}");
        assert!(load_trades(&c, None).unwrap().is_empty(), "Nichts wird angelegt");
    }

    #[test]
    fn average_price_after_adding_and_partial_sell() {
        let c = conn();
        deposit(&c, 100_000.0);
        let t = create_trade(&c, &position("A", 10.0, 100.0)).unwrap();
        // Nachkauf: 10 Stück zu 120 -> Durchschnitt 110
        let t = add_execution(&c, t.id, &exec("buy", 10.0, 120.0, "2026-02-02 10:00")).unwrap();
        approx(t.quantity, 20.0);
        approx(t.avg_price, 110.0);
        // Teilverkauf: 5 Stück zu 130 -> Gewinn (130-110)*5 = 100
        let t = add_execution(&c, t.id, &exec("sell", 5.0, 130.0, "2026-02-03 10:00")).unwrap();
        approx(t.quantity, 15.0);
        approx(t.avg_price, 110.0);
        approx(t.realized_chf, 100.0);
        assert_eq!(t.status, "open");
        // Rest verkaufen schliesst die Position
        let mut last = exec("sell", 15.0, 100.0, "2026-02-04 10:00");
        last.close_note = "  Ziel nicht erreicht ".into();
        let t = add_execution(&c, t.id, &last).unwrap();
        assert_eq!(t.status, "closed");
        assert_eq!(t.close_note, "Ziel nicht erreicht");
        assert_eq!(t.closed_at.as_deref(), Some("2026-02-04 10:00"));
        approx(t.realized_chf, 100.0 + (100.0 - 110.0) * 15.0);
        approx(t.quantity, 0.0);
        approx(t.avg_price, 110.0); // Einstieg bleibt sichtbar
    }

    #[test]
    fn fees_reduce_realized_gain() {
        let c = conn();
        deposit(&c, 10_000.0);
        let mut p = position("A", 10.0, 100.0);
        p.fee = 10.0; // Einstand je Stück 101
        let t = create_trade(&c, &p).unwrap();
        let mut sell = exec("sell", 10.0, 110.0, "2026-02-03 10:00");
        sell.fee = 10.0;
        let t = add_execution(&c, t.id, &sell).unwrap();
        // Erlös 1100 - 10 Gebühr = 1090, Einstand 1010 -> 80
        approx(t.realized_chf, 80.0);
        // Guthaben: 10000 - 1010 + 1090
        approx(cash_chf(&c).unwrap(), 10_080.0);
    }

    #[test]
    fn foreign_currency_uses_fx_rate() {
        let c = conn();
        deposit(&c, 10_000.0);
        let mut p = position("BLK", 2.0, 800.0);
        p.currency = "usd".into();
        p.fx_rate = 0.9;
        let t = create_trade(&c, &p).unwrap();
        assert_eq!(t.currency, "USD");
        approx(t.cost_chf, 1440.0);
        approx(cash_chf(&c).unwrap(), 8560.0);
        // Verkauf zu 900 USD: Gewinn (900-800)*2*0.9 = 180 CHF
        let t = add_execution(&c, t.id, &exec("sell", 2.0, 900.0, "2026-02-05 10:00")).unwrap();
        approx(t.realized_chf, 180.0);
        approx(cash_chf(&c).unwrap(), 10_180.0);
        // Fremdwährung ohne Kurs ist ungültig, CHF erzwingt 1
        let mut bad = position("X", 1.0, 1.0);
        bad.currency = "EUR".into();
        bad.fx_rate = 0.0;
        assert!(create_trade(&c, &bad).is_err());
        let mut chf = position("Y", 1.0, 10.0);
        chf.fx_rate = 5.0;
        assert_eq!(create_trade(&c, &chf).unwrap().fx_rate, 1.0);
    }

    #[test]
    fn sell_more_than_held_is_rejected() {
        let c = conn();
        deposit(&c, 10_000.0);
        let t = create_trade(&c, &position("A", 5.0, 10.0)).unwrap();
        assert!(add_execution(&c, t.id, &exec("sell", 6.0, 10.0, "2026-02-03 10:00")).is_err());
        assert!(add_execution(&c, t.id, &exec("hold", 1.0, 10.0, "2026-02-03 10:00")).is_err());
        assert_eq!(get_trade(&c, t.id).unwrap().executions.len(), 1);
    }

    #[test]
    fn closed_positions_cannot_be_changed() {
        let c = conn();
        deposit(&c, 10_000.0);
        let t = create_trade(&c, &position("A", 5.0, 10.0)).unwrap();
        add_execution(&c, t.id, &exec("sell", 5.0, 12.0, "2026-02-03 10:00")).unwrap();
        assert!(add_execution(&c, t.id, &exec("buy", 1.0, 10.0, "2026-02-04 10:00")).is_err());
    }

    #[test]
    fn order_does_not_touch_cash_until_executed() {
        let c = conn();
        deposit(&c, 5_000.0);
        let mut o = position("MSFT", 10.0, 400.0);
        o.kind = "order".into();
        o.valid_until = Some("2026-10-30".into());
        let t = create_trade(&c, &o).unwrap();
        assert_eq!(t.status, "order");
        approx(t.planned_price.unwrap(), 400.0);
        approx(cash_chf(&c).unwrap(), 5_000.0);

        let mut e = exec("buy", 10.0, 398.5, "2026-10-14 09:30");
        e.fee = 4.0;
        let t = execute_order(&c, t.id, &e).unwrap();
        assert_eq!(t.status, "open");
        approx(t.avg_price, 398.5);
        approx(cash_chf(&c).unwrap(), 5_000.0 - 3_989.0);
        // Eine ausgeführte Order lässt sich nicht erneut ausführen
        assert!(execute_order(&c, t.id, &e).is_err());
    }

    #[test]
    fn execute_order_needs_cash_and_can_set_fx() {
        let c = conn();
        deposit(&c, 100.0);
        let mut o = position("BLK", 1.0, 800.0);
        o.kind = "order".into();
        o.currency = "USD".into();
        o.fx_rate = 0.9;
        let t = create_trade(&c, &o).unwrap();
        assert!(execute_order(&c, t.id, &exec("buy", 1.0, 800.0, "2026-10-14 09:30")).is_err());
        deposit(&c, 2_000.0);
        let mut e = exec("buy", 1.0, 800.0, "2026-10-14 09:30");
        e.fx_rate = Some(0.85);
        let t = execute_order(&c, t.id, &e).unwrap();
        approx(t.fx_rate, 0.85);
        approx(cash_chf(&c).unwrap(), 2_100.0 - 680.0);
    }

    #[test]
    fn update_meta_and_delete() {
        let c = conn();
        deposit(&c, 1_000.0);
        let t = create_trade(&c, &position("A", 1.0, 100.0)).unwrap();
        let meta = TradeMeta {
            name: " Alpha AG ".into(),
            stop_loss: Some(90.0),
            target: Some(130.0),
            thesis: "Wachstum".into(),
            fx_rate: 1.0,
            valid_until: None,
        };
        let u = update_trade(&c, t.id, &meta).unwrap();
        assert_eq!(u.name, "Alpha AG");
        assert_eq!(u.stop_loss, Some(90.0));
        assert_eq!(u.thesis, "Wachstum");
        assert!(update_trade(&c, 999, &meta).is_err());
        let mut bad = meta.clone();
        bad.target = Some(-1.0);
        assert!(update_trade(&c, t.id, &bad).is_err());

        delete_trade(&c, t.id).unwrap();
        approx(cash_chf(&c).unwrap(), 1_000.0); // Geld ist wieder da
        assert!(delete_trade(&c, t.id).is_err());
        let left: i64 = c.query_row("SELECT COUNT(*) FROM trade_executions", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0, "Ausführungen werden mitgelöscht");
    }

    #[test]
    fn validates_trade_input() {
        let c = conn();
        deposit(&c, 10_000.0);
        let mut p = position(" ", 1.0, 1.0);
        assert!(create_trade(&c, &p).is_err(), "Symbol leer");
        p = position("A", 0.0, 1.0);
        assert!(create_trade(&c, &p).is_err(), "Menge 0");
        p = position("A", 1.0, -1.0);
        assert!(create_trade(&c, &p).is_err(), "Preis negativ");
        p = position("A", 1.0, 1.0);
        p.fee = -1.0;
        assert!(create_trade(&c, &p).is_err(), "Gebühr negativ");
        p = position("A", 1.0, 1.0);
        p.executed_at = "heute".into();
        assert!(create_trade(&c, &p).is_err(), "Zeitpunkt");
        p = position("A", 1.0, 1.0);
        p.asset_class = "edelmetall".into();
        assert!(create_trade(&c, &p).is_err(), "Klasse");
        p = position("A", 1.0, 1.0);
        p.kind = "swap".into();
        assert!(create_trade(&c, &p).is_err(), "Art");
    }

    #[test]
    fn cash_movements_are_validated() {
        let c = conn();
        assert!(add_cash_movement(&c, "withdrawal", 10.0, "", "2026-01-01 09:00").is_err(), "Auszahlung ohne Guthaben");
        deposit(&c, 1_000.0);
        add_cash_movement(&c, "withdrawal", 400.0, " Miete ", "2026-01-02 09:00").unwrap();
        approx(cash_chf(&c).unwrap(), 600.0);
        assert!(add_cash_movement(&c, "withdrawal", 700.0, "", "2026-01-03 09:00").is_err());
        assert!(add_cash_movement(&c, "deposit", 0.0, "", "2026-01-03 09:00").is_err());
        assert!(add_cash_movement(&c, "gift", 5.0, "", "2026-01-03 09:00").is_err());
        assert!(add_cash_movement(&c, "deposit", 5.0, "", "01.01.2026").is_err());

        let s = state(&c).unwrap();
        assert_eq!(s.movements.len(), 2);
        assert_eq!(s.movements[0].note, "Miete", "Neueste zuerst, Notiz getrimmt");
        // Die Einzahlung zu löschen ginge nur, wenn das Guthaben positiv bliebe
        let dep = s.movements.iter().find(|m| m.kind == "deposit").unwrap().id;
        assert!(delete_cash_movement(&c, dep).is_err());
        let wd = s.movements.iter().find(|m| m.kind == "withdrawal").unwrap().id;
        delete_cash_movement(&c, wd).unwrap();
        approx(cash_chf(&c).unwrap(), 1_000.0);
        delete_cash_movement(&c, dep).unwrap();
        assert!(delete_cash_movement(&c, dep).is_err());
    }

    fn metal(name: &str) -> MetalInput {
        MetalInput {
            name: name.into(),
            metal: "gold".into(),
            quantity: 100.0,
            unit: "g".into(),
            cost_chf: Some(6_500.0),
            spot_chf_per_oz: Some(2_175.0),
            note: String::new(),
        }
    }

    #[test]
    fn metals_crud_and_spot_timestamp() {
        let c = conn();
        create_metal(&c, &metal("Gold Barren")).unwrap();
        let m = list_metals(&c).unwrap().remove(0);
        assert_eq!(m.unit, "g");
        assert!(m.spot_updated_at.is_some());

        // Spotpreis unverändert -> Zeitstempel bleibt
        c.execute("UPDATE metals SET spot_updated_at = '2026-01-01 00:00:00'", []).unwrap();
        let mut same = metal("Gold Barren 100 g");
        update_metal(&c, m.id, &same).unwrap();
        let after = list_metals(&c).unwrap().remove(0);
        assert_eq!(after.name, "Gold Barren 100 g");
        assert_eq!(after.spot_updated_at.as_deref(), Some("2026-01-01 00:00:00"));
        // Neuer Spotpreis -> neuer Zeitstempel
        same.spot_chf_per_oz = Some(2_200.0);
        update_metal(&c, m.id, &same).unwrap();
        assert_ne!(list_metals(&c).unwrap()[0].spot_updated_at.as_deref(), Some("2026-01-01 00:00:00"));

        let mut bad = metal("x");
        bad.metal = "kupfer".into();
        assert!(create_metal(&c, &bad).is_err());
        bad = metal("x");
        bad.unit = "lb".into();
        assert!(create_metal(&c, &bad).is_err());
        bad = metal("  ");
        assert!(create_metal(&c, &bad).is_err());
        bad = metal("x");
        bad.quantity = 0.0;
        assert!(create_metal(&c, &bad).is_err());

        delete_metal(&c, m.id).unwrap();
        assert!(delete_metal(&c, m.id).is_err());
        assert!(update_metal(&c, m.id, &same).is_err());
    }

    #[test]
    fn quotes_snapshots_and_settings() {
        let c = conn();
        deposit(&c, 10_000.0);
        create_trade(&c, &position("blk", 1.0, 100.0)).unwrap();
        let mut o = position("NVDA", 1.0, 100.0);
        o.kind = "order".into();
        create_trade(&c, &o).unwrap();
        let closed = create_trade(&c, &position("OLD", 1.0, 10.0)).unwrap();
        add_execution(&c, closed.id, &exec("sell", 1.0, 11.0, "2026-02-03 10:00")).unwrap();
        assert_eq!(tracked_symbols(&c).unwrap(), ["BLK", "NVDA"], "Nur offene Positionen und Orders");

        set_quote(&c, "blk", 871.3).unwrap();
        set_quote(&c, "BLK", 880.0).unwrap();
        let s = state(&c).unwrap();
        assert_eq!(s.quotes.len(), 1);
        approx(s.quotes[0].price, 880.0);
        assert!(set_quote(&c, "BLK", 0.0).is_err());

        save_snapshot(&c, "2026-10-14", 51_000.0).unwrap();
        save_snapshot(&c, "2026-10-14", 51_500.0).unwrap();
        save_snapshot(&c, "2026-10-15", 51_700.0).unwrap();
        let s = state(&c).unwrap();
        assert_eq!(s.snapshots.len(), 2);
        approx(s.snapshots[0].value_chf, 51_500.0);
        assert!(save_snapshot(&c, "14.10.2026", 1.0).is_err());

        assert!(!s.has_api_key);
        set_setting(&c, "finnhub_api_key", "  ").unwrap();
        assert!(!state(&c).unwrap().has_api_key, "Leerer Key zählt nicht");
        set_setting(&c, "finnhub_api_key", "abc").unwrap();
        assert!(state(&c).unwrap().has_api_key);
        assert_eq!(get_setting(&c, "finnhub_api_key").unwrap().as_deref(), Some("abc"));
        assert_eq!(get_setting(&c, "nope").unwrap(), None);
    }

    #[test]
    fn samples_are_deduplicated_thinned_and_pruned() {
        let c = conn();
        save_sample(&c, 1000.0).unwrap();
        // Gleicher Wert und Änderung innerhalb von 30 Sekunden: nichts Neues
        save_sample(&c, 1000.0).unwrap();
        save_sample(&c, 1010.0).unwrap();
        let count = |c: &Connection| c.query_row("SELECT COUNT(*) FROM portfolio_samples", [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count(&c), 1, "zu kurz nach dem letzten Stand");
        assert!(save_sample(&c, f64::NAN).is_err());

        // Älter gemacht: eine Änderung wird gespeichert, ein unveränderter Wert noch nicht
        c.execute("UPDATE portfolio_samples SET ts = datetime('now', '-1 minute')", []).unwrap();
        save_sample(&c, 1000.004).unwrap();
        assert_eq!(count(&c), 1, "unverändert (auf Rappen gerundet) und jünger als 10 Minuten");
        save_sample(&c, 1012.4).unwrap();
        assert_eq!(count(&c), 2);
        let last: f64 = c.query_row("SELECT value_chf FROM portfolio_samples ORDER BY ts DESC LIMIT 1", [], |r| r.get(0)).unwrap();
        approx(last, 1012.4);

        // Unverändert, aber lange her: wieder ein Eintrag
        c.execute("DELETE FROM portfolio_samples", []).unwrap();
        c.execute("INSERT INTO portfolio_samples (ts, value_chf) VALUES (datetime('now', '-11 minutes'), 5.0)", []).unwrap();
        save_sample(&c, 5.0).unwrap();
        assert_eq!(count(&c), 2);

        // Aufräumen: zu alte Einträge fallen weg, ältere als ein Tag werden auf einen je zehn Minuten ausgedünnt
        c.execute("DELETE FROM portfolio_samples", []).unwrap();
        c.execute("INSERT INTO portfolio_samples (ts, value_chf) VALUES (datetime('now', '-9 days'), 1.0)", []).unwrap();
        for minutes in [3 * 1440, 3 * 1440 + 1, 3 * 1440 + 2, 3 * 1440 + 30] {
            c.execute("INSERT INTO portfolio_samples (ts, value_chf) VALUES (datetime('now', ?1), 2.0)", [format!("-{minutes} minutes")]).unwrap();
        }
        c.execute("INSERT INTO portfolio_samples (ts, value_chf) VALUES (datetime('now', '-2 hours'), 3.0)", []).unwrap();
        save_sample(&c, 4.0).unwrap();
        let rows: Vec<f64> = c.prepare("SELECT value_chf FROM portfolio_samples ORDER BY ts").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert!(!rows.contains(&1.0), "älter als acht Tage ist weg");
        assert!(rows.contains(&3.0) && rows.contains(&4.0), "heutige Einträge bleiben vollständig");
        let thinned = rows.iter().filter(|v| **v == 2.0).count();
        assert!(thinned <= 3 && thinned >= 2, "drei Tage alte Einträge werden je zehn Minuten zusammengefasst, war {thinned}");
    }

    #[test]
    fn state_includes_samples() {
        let c = conn();
        c.execute("INSERT INTO portfolio_samples (ts, value_chf) VALUES ('2026-10-14 08:00:00', 100.0), ('2026-10-14 09:00:00', 110.0)", []).unwrap();
        let s = state(&c).unwrap();
        assert_eq!(s.samples.len(), 2);
        approx(s.samples[1].value_chf, 110.0);
    }
}
