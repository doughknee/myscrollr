//! Signed REST client for Kalshi market-data reads.

use anyhow::{Context, Result};
use reqwest::Client;
use std::time::Duration;

use super::model::{EventsResponse, MarketsResponse};
use super::sign::Signer;
use super::API_PREFIX;

/// A thin signed REST client. Each call signs the path-without-query and
/// attaches the three `KALSHI-ACCESS-*` headers.
#[derive(Clone)]
pub struct RestClient {
    base: String,
    signer: Signer,
    http: Client,
}

impl RestClient {
    pub fn new(base: impl Into<String>, signer: Signer) -> Result<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .context("build reqwest client")?;
        Ok(Self {
            base: base.into(),
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
            anyhow::bail!("GET {path} returned HTTP {status}: {body}");
        }
        serde_json::from_str(&body).with_context(|| format!("parse {path} response"))
    }

    /// `GET /markets` with a raw query (e.g. "limit=100&status=open&cursor=…").
    pub async fn get_markets(&self, query: &str) -> Result<MarketsResponse> {
        self.get_json(&format!("{API_PREFIX}/markets"), query).await
    }

    /// `GET /events` (optionally `with_nested_markets=true`).
    pub async fn get_events(&self, query: &str) -> Result<EventsResponse> {
        self.get_json(&format!("{API_PREFIX}/events"), query).await
    }
}
