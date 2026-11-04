use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Duration, NaiveDate, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration as StdDuration};

pub const BODY_LIMIT: usize = 4 << 20;
const CATALOG: &str = include_str!("../../../../api/internal/ingestread/elections_catalog.json");
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Race {
    pub id: i32,
    pub name: String,
    pub state: String,
    pub election_date: NaiveDate,
}

pub fn catalog() -> Result<Vec<Race>> {
    let races: Vec<Race> = serde_json::from_str(CATALOG)?;
    let mut seen = HashSet::new();
    ensure!(
        !races.is_empty() && races.iter().all(|r| r.id > 0 && seen.insert(r.id)),
        "invalid curated catalog"
    );
    Ok(races)
}

#[derive(Deserialize)]
struct ProviderRace {
    election_name: String,
    country: String,
    province: String,
    election_date: DateTime<Utc>,
    test_data: bool,
    is_disputed: bool,
    last_updated: DateTime<Utc>,
    percent_reporting: Option<f64>,
    candidates: Vec<Candidate>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Candidate {
    #[serde(rename(deserialize = "candidate_id"))]
    pub id: i32,
    pub name: String,
    #[serde(default, deserialize_with = "party_label")]
    pub party: String,
    pub votes: u64,
    pub percent: Option<f64>,
    pub winner: bool,
}

// A nonpartisan candidate can have no party label.
fn party_label<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Serialize)]
pub struct Snapshot {
    #[serde(flatten)]
    pub race: Race,
    pub disputed: bool,
    pub source_updated_at: DateTime<Utc>,
    pub percent_reporting: Option<f64>,
    pub candidates: Vec<Candidate>,
}

fn valid_percent(p: Option<f64>) -> bool {
    p.is_none_or(|n| (0.0..=100.0).contains(&n))
}
fn valid_label(s: &str) -> bool {
    s.chars().count() <= 160 && !s.chars().any(char::is_control)
}

pub fn decode(body: &[u8], race: &Race, now: DateTime<Utc>) -> Result<Snapshot> {
    ensure!(body.len() <= BODY_LIMIT, "oversized response");
    let p: ProviderRace = serde_json::from_slice(body).context("invalid provider response")?;
    ensure!(
        !p.test_data
            && p.country == "US"
            && p.province == race.state
            && p.election_name == race.name
            && p.election_date.date_naive() == race.election_date,
        "test or mismatched race"
    );
    ensure!(
        p.last_updated <= now + Duration::minutes(2)
            && valid_percent(p.percent_reporting)
            && (1..=128).contains(&p.candidates.len()),
        "incomplete race"
    );
    let mut seen = HashSet::new();
    for c in &p.candidates {
        ensure!(
            c.id > 0
                && seen.insert(c.id)
                && !c.name.trim().is_empty()
                && valid_label(&c.name)
                && valid_label(&c.party)
                && c.votes <= MAX_SAFE_INTEGER
                && valid_percent(c.percent),
            "invalid candidate"
        );
    }
    ensure!(
        p.candidates.iter().filter(|c| c.winner).count() <= 1,
        "ambiguous race call"
    );
    // Round down to PostgreSQL timestamptz precision so unchanged snapshots remain identical.
    let updated = DateTime::from_timestamp_micros(p.last_updated.timestamp_micros())
        .context("invalid source time")?;
    Ok(Snapshot {
        race: race.clone(),
        source_updated_at: updated,
        percent_reporting: p.percent_reporting,
        candidates: p.candidates,
        disputed: p.is_disputed,
    })
}

pub fn client() -> Result<Client> {
    Ok(Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(StdDuration::from_secs(12))
        .user_agent("Scrollr/1 (+https://myscrollr.com)")
        .build()?)
}

pub async fn fetch(client: &Client, race: &Race) -> Result<Snapshot> {
    let mut res = client
        .get(format!("https://civicapi.org/api/v2/race/{}", race.id))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await?;
    ensure!(
        res.status() == reqwest::StatusCode::OK,
        "civicAPI HTTP {}",
        res.status()
    );
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await? {
        ensure!(chunk.len() <= BODY_LIMIT - body.len(), "oversized response");
        body.extend_from_slice(&chunk);
    }
    decode(&body, race, Utc::now())
}

pub fn interval(race: &Race, now: DateTime<Utc>) -> i32 {
    let since = now.date_naive() - race.election_date;
    match since.num_days() {
        ..=-2 => 6 * 3600,
        -1..=2 => 30,
        3..=13 => 15 * 60,
        _ => 24 * 3600,
    }
}
