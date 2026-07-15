//! Signed, READ-ONLY REST client for the user's Kalshi portfolio.
//!
//! Every method here is a GET against the authenticated `/portfolio/*`
//! endpoints. There are deliberately NO order-placing or order-cancelling
//! methods — Scrollr only ever reads the account. See `kalshi/mod.rs`.

use anyhow::{Context, Result};
use reqwest::Client;
use std::time::Duration;

use super::model::{
    Fill, Portfolio, Position, RawBalance, RawFillsResponse, RawOrdersResponse,
    RawPositionsResponse, RestingOrder,
};
use super::sign::Signer;
use super::{KalshiEnv, API_PREFIX};

/// A thin signed REST client bound to one credential + environment.
#[derive(Clone)]
pub struct RestClient {
    base: String,
    signer: Signer,
    http: Client,
}

impl RestClient {
    pub fn new(env: KalshiEnv, signer: Signer) -> Result<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .context("build reqwest client")?;
        Ok(Self {
            base: env.rest_base().to_string(),
            signer,
            http,
        })
    }

    /// GET a signed endpoint and deserialize the JSON body into `T`.
    /// `path` is the API path (with the `/trade-api/v2` prefix); `query` is the
    /// raw query string (without a leading `?`) and is NOT part of the signed
    /// message.
    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str, query: &str) -> Result<T> {
        let (timestamp, signature) = self.signer.sign("GET", path)?;
        let url = if query.is_empty() {
            format!("{}{}", self.base, path)
        } else {
            format!("{}{}?{}", self.base, path, query)
        };

        let resp = self
            .http
            .get(&url)
            .header("KALSHI-ACCESS-KEY", self.signer.key_id())
            .header("KALSHI-ACCESS-TIMESTAMP", timestamp)
            .header("KALSHI-ACCESS-SIGNATURE", signature)
            .send()
            .await
            .with_context(|| format!("GET {path} send"))?;

        let status = resp.status();
        let body = resp.text().await.context("read response body")?;
        if !status.is_success() {
            // NOTE: `body` here is a Kalshi error message, never our secret —
            // safe to surface. We never log the signature or key material.
            anyhow::bail!("GET {path} returned HTTP {status}: {body}");
        }
        serde_json::from_str(&body).with_context(|| format!("parse {path} response"))
    }

    /// `GET /portfolio/balance` → available balance in cents.
    pub async fn balance_cents(&self) -> Result<i64> {
        let raw: RawBalance = self
            .get_json(&format!("{API_PREFIX}/portfolio/balance"), "")
            .await?;
        Ok(raw.cents())
    }

    /// `GET /portfolio/positions` → the user's market positions (normalized),
    /// dropping flat (zero-contract, zero-resting) rows that Kalshi sometimes
    /// returns for previously-held markets.
    ///
    /// `count_filter` accepts only `position`/`total_traded` today —
    /// `resting_order_count` was retired with the fixed-point migration.
    /// `limit=1000` (the max) keeps every realistic account on one page.
    pub async fn positions(&self) -> Result<Vec<Position>> {
        let raw: RawPositionsResponse = self
            .get_json(
                &format!("{API_PREFIX}/portfolio/positions"),
                "count_filter=position&limit=1000",
            )
            .await?;
        Ok(raw
            .market_positions
            .into_iter()
            .map(Position::from)
            .filter(|p| p.position != 0 || p.resting_orders_count != 0)
            .collect())
    }

    /// `GET /portfolio/fills` → recent trade executions (normalized). `limit`
    /// is clamped to Kalshi's 1..=1000 range.
    pub async fn fills(&self, limit: u32) -> Result<Vec<Fill>> {
        let limit = limit.clamp(1, 1000);
        let raw: RawFillsResponse = self
            .get_json(
                &format!("{API_PREFIX}/portfolio/fills"),
                &format!("limit={limit}"),
            )
            .await?;
        Ok(raw.fills.into_iter().map(Fill::from).collect())
    }

    /// `GET /portfolio/orders?status=resting` → the user's open (resting)
    /// orders (normalized). Read-only — we surface them so the user can see
    /// their working orders; Scrollr never creates or cancels them.
    pub async fn resting_orders(&self) -> Result<Vec<RestingOrder>> {
        let raw: RawOrdersResponse = self
            .get_json(
                &format!("{API_PREFIX}/portfolio/orders"),
                "status=resting&limit=200",
            )
            .await?;
        Ok(raw.orders.into_iter().map(RestingOrder::from).collect())
    }

    /// Fetch the full read-only portfolio snapshot in one call. Balance is
    /// required (it doubles as the connection-validity probe); the other three
    /// are best-effort — a failure in any one yields an empty list rather than
    /// failing the whole snapshot, so a transient hiccup on fills doesn't blank
    /// the balance + positions the user came to see.
    pub async fn portfolio(&self) -> Result<Portfolio> {
        let balance_cents = self.balance_cents().await?;
        let positions = self.positions().await.unwrap_or_default();
        let fills = self.fills(50).await.unwrap_or_default();
        let resting_orders = self.resting_orders().await.unwrap_or_default();
        Ok(Portfolio {
            balance_cents,
            positions,
            fills,
            resting_orders,
        })
    }
}
