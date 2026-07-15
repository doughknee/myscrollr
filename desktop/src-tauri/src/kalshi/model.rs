//! Kalshi portfolio payload models (the read-only subset the desktop reads)
//! plus the normalized shapes returned to the webview.
//!
//! Kalshi is mid-migration from bare integer-cent fields (e.g. `balance`,
//! `market_exposure`, `yes_price`) to fixed-point decimal strings
//! (`*_dollars`). We deserialize BOTH and normalize everything to integer
//! cents (the predictions data contract: cents 0–100 == implied %, money in
//! cents) before handing it to the frontend, so the UI never has to know which
//! field shape Kalshi sent.

use serde::{Deserialize, Serialize};

// ── Coercion helpers ─────────────────────────────────────────────

/// Resolve a monetary value to integer cents, preferring the legacy integer
/// field (already cents) and falling back to the `*_dollars` decimal string
/// (dollars → cents). Returns 0 when neither is present/parseable.
fn cents(int_cents: Option<i64>, dollars: &Option<String>) -> i64 {
    if let Some(c) = int_cents {
        return c;
    }
    if let Some(d) = dollars {
        if let Ok(f) = d.trim().parse::<f64>() {
            return (f * 100.0).round() as i64;
        }
    }
    0
}

/// Resolve a contract count, preferring the legacy integer field and falling
/// back to the `*_fp` fixed-point decimal string ("5.00" → 5). Kalshi's 2026
/// API migration removed the integer count fields (`position`, `count`,
/// `remaining_count`) in favor of `*_fp` — parsing only the legacy field made
/// every position deserialize as flat (see ui-review/NOTES.md, A2).
fn count(int_count: Option<i64>, fp: &Option<String>) -> i64 {
    if let Some(c) = int_count {
        return c;
    }
    if let Some(s) = fp {
        if let Ok(f) = s.trim().parse::<f64>() {
            return f.round() as i64;
        }
    }
    0
}

// ── /portfolio/balance ───────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
pub struct RawBalance {
    #[serde(default)]
    pub balance: Option<i64>,
    #[serde(default)]
    pub balance_dollars: Option<String>,
}

impl RawBalance {
    pub fn cents(&self) -> i64 {
        cents(self.balance, &self.balance_dollars)
    }
}

// ── /portfolio/positions ─────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
pub struct RawMarketPosition {
    #[serde(default)]
    pub ticker: String,
    /// Net signed contract count: positive = long YES, negative = long NO.
    /// Legacy integer form — absent since Kalshi's fixed-point migration.
    #[serde(default)]
    pub position: Option<i64>,
    /// Fixed-point replacement ("5.00"); the only form current responses carry.
    #[serde(default)]
    pub position_fp: Option<String>,
    #[serde(default)]
    pub market_exposure: Option<i64>,
    #[serde(default)]
    pub market_exposure_dollars: Option<String>,
    #[serde(default)]
    pub realized_pnl: Option<i64>,
    #[serde(default)]
    pub realized_pnl_dollars: Option<String>,
    #[serde(default)]
    pub total_traded: Option<i64>,
    #[serde(default)]
    pub total_traded_dollars: Option<String>,
    #[serde(default)]
    pub fees_paid: Option<i64>,
    #[serde(default)]
    pub fees_paid_dollars: Option<String>,
    #[serde(default)]
    pub resting_orders_count: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
pub struct RawPositionsResponse {
    #[serde(default)]
    pub market_positions: Vec<RawMarketPosition>,
}

// ── /portfolio/fills ─────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
pub struct RawFill {
    #[serde(default)]
    pub ticker: String,
    /// "yes" | "no" — which side the user traded. Deprecated upstream in
    /// favor of `outcome_side` (removal slated May 2026); we read both.
    #[serde(default)]
    pub side: String,
    /// Current name for the traded side ("yes" | "no").
    #[serde(default)]
    pub outcome_side: Option<String>,
    /// "buy" | "sell".
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub count: Option<i64>,
    #[serde(default)]
    pub count_fp: Option<String>,
    #[serde(default)]
    pub yes_price: Option<i64>,
    #[serde(default)]
    pub yes_price_dollars: Option<String>,
    #[serde(default)]
    pub no_price: Option<i64>,
    #[serde(default)]
    pub no_price_dollars: Option<String>,
    #[serde(default)]
    pub is_taker: Option<bool>,
    #[serde(default)]
    pub created_time: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct RawFillsResponse {
    #[serde(default)]
    pub fills: Vec<RawFill>,
}

// ── /portfolio/orders ────────────────────────────────────────────

#[derive(Debug, Deserialize, Default)]
pub struct RawOrder {
    #[serde(default)]
    pub ticker: String,
    #[serde(default)]
    pub side: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub yes_price: Option<i64>,
    #[serde(default)]
    pub yes_price_dollars: Option<String>,
    #[serde(default)]
    pub no_price: Option<i64>,
    #[serde(default)]
    pub no_price_dollars: Option<String>,
    #[serde(default)]
    pub remaining_count: Option<i64>,
    #[serde(default)]
    pub remaining_count_fp: Option<String>,
    #[serde(default)]
    pub created_time: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct RawOrdersResponse {
    #[serde(default)]
    pub orders: Vec<RawOrder>,
}

// ── Normalized output (serialized to the webview) ────────────────

#[derive(Debug, Serialize, Clone)]
pub struct Position {
    pub ticker: String,
    /// Net signed contract count: positive = YES, negative = NO.
    pub position: i64,
    /// "yes" | "no" | "flat".
    pub side: &'static str,
    /// Absolute number of contracts held.
    pub count: i64,
    /// Current cost basis / exposure on this market, in cents.
    pub exposure_cents: i64,
    pub realized_pnl_cents: i64,
    pub total_traded_cents: i64,
    pub fees_paid_cents: i64,
    pub resting_orders_count: i64,
}

impl From<RawMarketPosition> for Position {
    fn from(r: RawMarketPosition) -> Self {
        let position = count(r.position, &r.position_fp);
        let side = if position > 0 {
            "yes"
        } else if position < 0 {
            "no"
        } else {
            "flat"
        };
        Position {
            ticker: r.ticker,
            position,
            side,
            count: position.abs(),
            exposure_cents: cents(r.market_exposure, &r.market_exposure_dollars),
            realized_pnl_cents: cents(r.realized_pnl, &r.realized_pnl_dollars),
            total_traded_cents: cents(r.total_traded, &r.total_traded_dollars),
            fees_paid_cents: cents(r.fees_paid, &r.fees_paid_dollars),
            resting_orders_count: r.resting_orders_count.unwrap_or(0),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct Fill {
    pub ticker: String,
    pub side: String,
    pub action: String,
    pub count: i64,
    /// Price on the side the user traded, in cents (0–100).
    pub price_cents: i64,
    pub is_taker: bool,
    pub created_time: String,
}

impl From<RawFill> for Fill {
    fn from(r: RawFill) -> Self {
        // `side` is deprecated upstream for `outcome_side`; accept either.
        let side = if r.side.is_empty() {
            r.outcome_side.clone().unwrap_or_default()
        } else {
            r.side.clone()
        };
        // Report the price of the side actually traded so the UI can show the
        // user's execution price directly.
        let price_cents = if side.eq_ignore_ascii_case("no") {
            cents(r.no_price, &r.no_price_dollars)
        } else {
            cents(r.yes_price, &r.yes_price_dollars)
        };
        Fill {
            ticker: r.ticker,
            side,
            action: r.action,
            count: count(r.count, &r.count_fp),
            price_cents,
            is_taker: r.is_taker.unwrap_or(false),
            created_time: r.created_time.unwrap_or_default(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct RestingOrder {
    pub ticker: String,
    pub side: String,
    pub action: String,
    pub price_cents: i64,
    pub remaining_count: i64,
    pub created_time: String,
}

impl From<RawOrder> for RestingOrder {
    fn from(r: RawOrder) -> Self {
        let price_cents = if r.side.eq_ignore_ascii_case("no") {
            cents(r.no_price, &r.no_price_dollars)
        } else {
            cents(r.yes_price, &r.yes_price_dollars)
        };
        RestingOrder {
            ticker: r.ticker,
            side: r.side,
            action: r.action,
            price_cents,
            remaining_count: count(r.remaining_count, &r.remaining_count_fp),
            created_time: r.created_time.unwrap_or_default(),
        }
    }
}

/// The full read-only snapshot returned by the `kalshi_portfolio` command.
#[derive(Debug, Serialize, Clone, Default)]
pub struct Portfolio {
    pub balance_cents: i64,
    pub positions: Vec<Position>,
    pub fills: Vec<Fill>,
    pub resting_orders: Vec<RestingOrder>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cents_prefers_integer_then_dollars() {
        assert_eq!(cents(Some(1234), &Some("99.99".into())), 1234);
        assert_eq!(cents(None, &Some("12.34".into())), 1234);
        assert_eq!(cents(None, &Some("0.62".into())), 62);
        assert_eq!(cents(None, &None), 0);
        assert_eq!(cents(None, &Some("not-a-number".into())), 0);
    }

    #[test]
    fn balance_parses_both_shapes() {
        let legacy: RawBalance = serde_json::from_str(r#"{"balance": 50000}"#).unwrap();
        assert_eq!(legacy.cents(), 50000);
        let fixed: RawBalance = serde_json::from_str(r#"{"balance_dollars":"500.00"}"#).unwrap();
        assert_eq!(fixed.cents(), 50000);
    }

    #[test]
    fn position_side_from_sign() {
        let yes: Position = RawMarketPosition {
            ticker: "T".into(),
            position: Some(10),
            ..Default::default()
        }
        .into();
        assert_eq!(yes.side, "yes");
        assert_eq!(yes.count, 10);

        let no: Position = RawMarketPosition {
            ticker: "T".into(),
            position: Some(-7),
            market_exposure_dollars: Some("3.50".into()),
            ..Default::default()
        }
        .into();
        assert_eq!(no.side, "no");
        assert_eq!(no.count, 7);
        assert_eq!(no.exposure_cents, 350);

        let flat: Position = RawMarketPosition {
            ticker: "T".into(),
            position: Some(0),
            ..Default::default()
        }
        .into();
        assert_eq!(flat.side, "flat");
    }

    /// A2 regression: a CURRENT-shape (2026 fixed-point) GetPositions
    /// response — `position_fp` string, `*_dollars` money, no legacy integer
    /// fields, no `resting_orders_count` — must normalize to a real open
    /// position, not a flat row that the zero-filter drops.
    #[test]
    fn position_parses_current_fixed_point_shape() {
        let raw: RawPositionsResponse = serde_json::from_str(
            r#"{
              "market_positions": [
                {
                  "ticker": "KXWCADVANCE-26JUL15ENGARG-ARG",
                  "position_fp": "15.00",
                  "market_exposure_dollars": "7.0500",
                  "realized_pnl_dollars": "0.000000",
                  "total_traded_dollars": "7.0500",
                  "fees_paid_dollars": "0.070000",
                  "last_updated_ts": "2026-07-14T22:10:03Z"
                },
                {
                  "ticker": "KXFEDHIKE-26DEC31",
                  "position_fp": "-4.00",
                  "market_exposure_dollars": "1.6800",
                  "realized_pnl_dollars": "0.000000",
                  "total_traded_dollars": "1.6800",
                  "fees_paid_dollars": "0.020000"
                }
              ],
              "cursor": ""
            }"#,
        )
        .unwrap();

        let positions: Vec<Position> = raw
            .market_positions
            .into_iter()
            .map(Position::from)
            .filter(|p| p.position != 0 || p.resting_orders_count != 0)
            .collect();

        assert_eq!(positions.len(), 2, "open positions must survive the flat filter");
        assert_eq!(positions[0].side, "yes");
        assert_eq!(positions[0].count, 15);
        assert_eq!(positions[0].exposure_cents, 705);
        assert_eq!(positions[1].side, "no");
        assert_eq!(positions[1].count, 4);
    }

    /// Same migration, fills leg: `count_fp` + `outcome_side` + `*_dollars`
    /// only. The row must keep its count and side.
    #[test]
    fn fill_parses_current_fixed_point_shape() {
        let raw: RawFillsResponse = serde_json::from_str(
            r#"{
              "fills": [
                {
                  "ticker": "KXWCADVANCE-26JUL15ENGARG-ARG",
                  "outcome_side": "yes",
                  "action": "buy",
                  "count_fp": "15.00",
                  "yes_price_dollars": "0.4700",
                  "no_price_dollars": "0.5300",
                  "is_taker": true,
                  "created_time": "2026-07-14T22:10:03Z"
                }
              ]
            }"#,
        )
        .unwrap();
        let fill = Fill::from(raw.fills.into_iter().next().unwrap());
        assert_eq!(fill.side, "yes");
        assert_eq!(fill.count, 15);
        assert_eq!(fill.price_cents, 47);
    }

    /// Orders leg: `remaining_count_fp` fallback.
    #[test]
    fn order_parses_current_fixed_point_shape() {
        let raw: RawOrder = serde_json::from_str(
            r#"{
              "ticker": "T",
              "side": "no",
              "action": "buy",
              "remaining_count_fp": "9.00",
              "no_price_dollars": "0.3800"
            }"#,
        )
        .unwrap();
        let order = RestingOrder::from(raw);
        assert_eq!(order.remaining_count, 9);
        assert_eq!(order.price_cents, 38);
    }

    /// Legacy integer fields, when present, still win (mid-migration safety).
    #[test]
    fn legacy_integer_counts_still_preferred() {
        assert_eq!(count(Some(7), &Some("5.00".into())), 7);
        assert_eq!(count(None, &Some("5.00".into())), 5);
        assert_eq!(count(None, &Some("-4.00".into())), -4);
        assert_eq!(count(None, &Some("garbage".into())), 0);
        assert_eq!(count(None, &None), 0);
    }

    #[test]
    fn fill_reports_traded_side_price() {
        let yes: Fill = RawFill {
            ticker: "T".into(),
            side: "yes".into(),
            action: "buy".into(),
            count: Some(5),
            yes_price: Some(62),
            no_price: Some(38),
            ..Default::default()
        }
        .into();
        assert_eq!(yes.price_cents, 62);

        let no: Fill = RawFill {
            ticker: "T".into(),
            side: "no".into(),
            action: "buy".into(),
            count: Some(5),
            yes_price: Some(62),
            no_price: Some(38),
            ..Default::default()
        }
        .into();
        assert_eq!(no.price_cents, 38);
    }
}
