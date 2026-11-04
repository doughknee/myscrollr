//! A public election-day directory is an observation of candidate counts. It does
//! not establish a race call or provide the per-race source timestamp.
use crate::provider::{Candidate, Race};
use anyhow::{Context, Result, ensure};
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::{Client, StatusCode, header};
use serde::{
    Deserialize, Deserializer,
    de::{Error as _, SeqAccess, Visitor},
};
use serde_json::{Value, json, value::RawValue};
use std::{
    collections::{HashMap, HashSet},
    fmt,
    marker::PhantomData,
    time::Duration,
};

const MAX_BYTES: usize = 48 << 20;
const LIMIT: usize = 50_000;
const MAX_AGE_SECS: i64 = 180;
type Observation = (DateTime<Utc>, HashMap<i32, Value>);

#[derive(Debug)]
struct HttpFailure {
    status: StatusCode,
    delay: Option<Duration>,
}

impl fmt::Display for HttpFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "nationwide civicAPI HTTP {}", self.status)
    }
}
impl std::error::Error for HttpFailure {}

pub fn retry_after(error: &anyhow::Error) -> Option<Duration> {
    error.downcast_ref::<HttpFailure>()?.delay
}

fn retry_delay(value: &str, now: DateTime<Utc>) -> Option<Duration> {
    let value = value.trim();
    if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) {
        return Some(Duration::from_secs(value.parse().ok()?));
    }
    let time = DateTime::parse_from_rfc2822(value).ok()?.to_utc();
    Some((time - now).to_std().unwrap_or_default())
}

fn observed_at(headers: &header::HeaderMap, now: DateTime<Utc>) -> Result<DateTime<Utc>> {
    ensure!(
        headers.get_all(header::DATE).iter().count() == 1,
        "missing or ambiguous HTTP Date"
    );
    let date = DateTime::parse_from_rfc2822(headers[header::DATE].to_str()?)?.to_utc();
    ensure!(date <= now, "future HTTP Date");
    ensure!(
        headers.get_all(header::AGE).iter().count() <= 1,
        "ambiguous HTTP Age"
    );
    let mut stamp = date;
    if let Some(age) = headers.get(header::AGE) {
        let value = age.to_str()?;
        ensure!(
            !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()),
            "invalid HTTP Age"
        );
        let seconds: i64 = value.parse()?;
        ensure!(seconds <= MAX_AGE_SECS, "stale cached directory");
        // Age and apparent age from Date overlap. Adding them would date a
        // correctly cached response twice; choose the older observation.
        let aged = DateTime::from_timestamp(now.timestamp() - seconds, 0)
            .context("invalid cached date")?;
        stamp = stamp.min(aged);
    }
    for warning in headers.get_all(header::WARNING) {
        ensure!(
            !warning
                .to_str()?
                .split(',')
                .map(str::trim_start)
                .any(|w| w.starts_with("110 ") || w.starts_with("111 ")),
            "stale directory warning"
        );
    }
    for control in headers.get_all(header::CACHE_CONTROL) {
        for directive in control.to_str()?.split(',') {
            if let Some((key, value)) = directive.trim().split_once('=') {
                if key.trim().eq_ignore_ascii_case("max-age") {
                    let ttl: u64 = value.trim().trim_matches('"').parse()?;
                    ensure!(
                        (now - stamp).num_seconds() as u64 <= ttl,
                        "directory past HTTP max-age"
                    );
                }
            }
        }
    }
    for name in ["x-cache", "cf-cache-status"] {
        if let Some(v) = headers.get(name) {
            let v = v.to_str()?.to_ascii_uppercase();
            ensure!(
                !v.contains("STALE") && !v.contains("UPDATING"),
                "stale directory cache"
            );
        }
    }
    ensure!(
        now - stamp <= chrono::Duration::seconds(MAX_AGE_SECS),
        "stale directory Date"
    );
    Ok(stamp)
}

// Cap allocations before the decoder can build an enormous Vec from a compact
// array of empty objects. Raw rows borrow slices of the bounded HTTP body.
fn limited<'de, D, T, const MAX: usize>(d: D) -> std::result::Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Bounded<T, const MAX: usize>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>, const MAX: usize> Visitor<'de> for Bounded<T, MAX> {
        type Value = Vec<T>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "an array with at most {MAX} entries")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<Vec<T>, A::Error> {
            let mut rows = Vec::new();
            while let Some(item) = seq.next_element()? {
                if rows.len() == MAX {
                    return Err(A::Error::custom("array exceeds limit"));
                }
                rows.push(item);
            }
            Ok(rows)
        }
    }
    d.deserialize_seq(Bounded::<T, MAX>(PhantomData))
}

#[derive(Deserialize)]
struct Envelope<'a> {
    count: usize,
    offset: usize,
    limit: usize,
    has_more: Option<bool>,
    test_data: Option<bool>,
    #[serde(borrow, deserialize_with = "limited::<_, _, LIMIT>")]
    races: Vec<&'a RawValue>,
}

#[derive(Deserialize)]
struct Identifier {
    id: i32,
}

#[derive(Deserialize)]
struct DirectoryRow {
    country: String,
    province: String,
    election_name: String,
    election_date: DateTime<Utc>,
    municipality: Option<String>,
    test_data: Option<bool>,
    is_disputed: Option<bool>,
    seats: Option<serde::de::IgnoredAny>,
    percent_reporting: Option<f64>,
    #[serde(deserialize_with = "limited::<_, _, 128>")]
    candidates: Vec<Candidate>,
}

fn percent(v: Option<f64>) -> bool {
    v.is_none_or(|n| (0.0..=100.0).contains(&n))
}

fn candidate_label(v: &str) -> bool {
    v.chars().count() <= 160 && !v.chars().any(char::is_control)
}

fn normalized(raw: &RawValue, race: &Race, stamp: DateTime<Utc>) -> Result<Value> {
    let mut row: DirectoryRow = serde_json::from_str(raw.get())?;
    ensure!(
        row.country == "US"
            && row.province == race.state
            && row.election_name == race.name
            && row.election_date.date_naive() == race.election_date
            && row
                .municipality
                .as_deref()
                .zip(race.municipality.as_deref())
                .is_none_or(|(a, b)| a.trim().is_empty()
                    || b.trim().is_empty()
                    || a.trim().eq_ignore_ascii_case(b.trim()))
            && row.test_data != Some(true)
            && row.is_disputed != Some(true)
            && row.seats.is_none(),
        "test, disputed, or mismatched directory race"
    );
    ensure!(
        percent(row.percent_reporting) && (1..=128).contains(&row.candidates.len()),
        "invalid directory race"
    );
    let mut seen = HashSet::new();
    for c in &mut row.candidates {
        ensure!(
            c.id > 0
                && seen.insert(c.id)
                && !c.name.trim().is_empty()
                && candidate_label(&c.name)
                && candidate_label(&c.party)
                && c.votes <= (1 << 53) - 1
                && percent(c.percent),
            "invalid directory candidate"
        );
        c.winner = Some(false);
    }
    Ok(
        json!({"percent_reporting":row.percent_reporting,"candidates":row.candidates,"observed_at":stamp}),
    )
}

fn decode(
    body: &[u8],
    date: NaiveDate,
    wanted: &HashMap<i32, Race>,
    stamp: DateTime<Utc>,
) -> Result<HashMap<i32, Value>> {
    ensure!(body.len() <= MAX_BYTES, "oversized directory");
    // Borrow each row's raw slice, then only allocate candidate vectors for followed IDs.
    let envelope: Envelope<'_> = serde_json::from_slice(body).context("invalid directory JSON")?;
    ensure!(
        envelope.offset == 0
            && envelope.has_more != Some(true)
            && envelope.test_data != Some(true)
            && envelope.limit == LIMIT
            && envelope.count < LIMIT
            && envelope.count == envelope.races.len(),
        "test or truncated directory"
    );
    let mut seen = HashSet::with_capacity(envelope.count);
    let mut out = HashMap::new();
    let mut rejected = 0;
    for raw in envelope.races {
        let Identifier { id } = serde_json::from_str(raw.get())?;
        ensure!(
            id > 0 && seen.insert(id),
            "invalid or duplicate directory ID"
        );
        if let Some(race) = wanted
            .get(&id)
            .filter(|r| r.id == id && r.election_date == date)
        {
            match normalized(raw, race, stamp) {
                Ok(row) => {
                    out.insert(id, row);
                }
                Err(_) => {
                    rejected += 1;
                }
            }
        }
    }
    if rejected > 0 {
        log::warn!("Skipped {rejected} invalid followed rows in civicAPI directory");
    }
    Ok(out)
}

pub async fn fetch(
    client: &Client,
    date: NaiveDate,
    wanted: &HashMap<i32, Race>,
) -> Result<Observation> {
    ensure!(
        wanted.values().any(|r| r.election_date == date),
        "no followed races for date"
    );
    let url = format!(
        "https://civicapi.org/api/v2/race/search?startDate={date}&endDate={date}&limit={LIMIT}"
    );
    let mut response = client
        .get(&url)
        .timeout(Duration::from_secs(65))
        .header(header::ACCEPT, "application/json")
        .send()
        .await?;
    ensure!(
        response.url().as_str() == url,
        "unexpected directory origin or redirect"
    );
    if response.status() != StatusCode::OK {
        let delay = response
            .headers()
            .get(header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| retry_delay(v, Utc::now()));
        return Err(HttpFailure {
            status: response.status(),
            delay,
        }
        .into());
    }
    let mime = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    ensure!(
        mime.split(';')
            .next()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json")),
        "unexpected directory content type"
    );
    let stamp = observed_at(response.headers(), Utc::now())?;
    ensure!(
        response
            .content_length()
            .is_none_or(|n| n <= MAX_BYTES as u64),
        "oversized directory"
    );
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        ensure!(chunk.len() <= MAX_BYTES - body.len(), "oversized directory");
        body.extend_from_slice(&chunk);
    }
    ensure!(
        Utc::now() - stamp <= chrono::Duration::seconds(MAX_AGE_SECS),
        "expired directory during transfer"
    );
    // This search can contain tens of thousands of rows. Keep its JSON scan
    // off the executor handling health requests and individual-race polling.
    let wanted = wanted.clone();
    let rows = tokio::task::spawn_blocking(move || decode(&body, date, &wanted, stamp))
        .await
        .context("directory decoder stopped")??;
    Ok((stamp, rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::ResultMode;

    fn fixture() -> (Race, Value, DateTime<Utc>) {
        let date: NaiveDate = "2026-11-03".parse().unwrap();
        let stamp: DateTime<Utc> = "2026-11-04T03:10:02Z".parse().unwrap();
        let race = Race {
            id: 87476,
            name: "Tennessee Governor".into(),
            state: "TN".into(),
            election_date: date,
            result_mode: ResultMode::SingleSeat,
            municipality: None,
        };
        let raw = json!({"offset":0,"limit":50000,"count":2,"races":[
            {"id":87476,"country":"US","province":"TN","election_name":"Tennessee Governor",
            "election_date":"2026-11-03T05:00:00Z","percent_reporting":71,"candidates":[
            {"candidate_id":42,"name":"Preview A","party":null,"votes":100,"percent":60,"winner":true}]},
            {"id":85,"candidates":[]}]});
        (race, raw, stamp)
    }

    #[test]
    fn only_eligible_followed_rows_survive_without_calls() {
        let (r, mut raw, t) = fixture();
        let date = r.election_date;
        let wanted = HashMap::from([(r.id, r)]);
        let parse = |v: &Value| decode(&serde_json::to_vec(v).unwrap(), date, &wanted, t).unwrap();
        let valid = parse(&raw);
        assert_eq!(valid.len(), 1);
        let row = &valid[&87476];
        assert_eq!(row["observed_at"], "2026-11-04T03:10:02Z");
        assert_eq!(
            row["candidates"][0],
            json!({"id":42,"name":"Preview A","party":"","votes":100,"percent":60.0,"winner":false})
        );
        assert!(row.get("source_updated_at").is_none());
        for (path, value) in [
            ("/races/0/province", json!("NJ")),
            ("/races/0/country", json!("CA")),
            ("/races/0/election_date", json!("2022-11-03T05:00:00Z")),
            ("/races/0/election_name", json!("Not this contest")),
            ("/races/0/percent_reporting", json!(-1)),
            (
                "/races/0/candidates/0/votes",
                json!(9_007_199_254_740_992u64),
            ),
            ("/races/0/candidates/0/name", json!("\n")),
            ("/races/0/candidates/0/percent", json!(101)),
        ] {
            let mut broken = raw.clone();
            *broken.pointer_mut(path).unwrap() = value;
            assert!(parse(&broken).is_empty(), "accepted {path}");
        }
        raw["races"][0]["test_data"] = json!(true);
        assert!(parse(&raw).is_empty());
        raw["races"][0]["test_data"] = json!(false);
        let duplicate = raw["races"][0]["candidates"][0].clone();
        raw["races"][0]["candidates"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(parse(&raw).is_empty());
    }

    #[test]
    fn refuses_partial_envelopes_or_duplicate_ids() {
        let (r, raw, t) = fixture();
        for flag in ["has_more", "test_data"] {
            let mut bad = raw.clone();
            bad[flag] = json!(true);
            assert!(
                decode(
                    &serde_json::to_vec(&bad).unwrap(),
                    r.election_date,
                    &HashMap::new(),
                    t
                )
                .is_err()
            );
        }
        for (path, value) in [
            ("/offset", json!(100)),
            ("/count", json!(1)),
            ("/limit", json!(1)),
            ("/races/1/id", json!(87476)),
        ] {
            let mut bad = raw.clone();
            *bad.pointer_mut(path).unwrap() = value;
            assert!(
                decode(
                    &serde_json::to_vec(&bad).unwrap(),
                    r.election_date,
                    &HashMap::new(),
                    t
                )
                .is_err()
            );
        }
    }

    #[test]
    fn http_time_rejects_stale_future_and_ambiguous_metadata() {
        let now: DateTime<Utc> = "2026-11-04T03:10:10Z".parse().unwrap();
        let headers = |date: &'static str, age: Option<&'static str>| {
            let mut h = header::HeaderMap::new();
            h.insert(header::DATE, header::HeaderValue::from_static(date));
            if let Some(age) = age {
                h.insert(header::AGE, header::HeaderValue::from_static(age));
            }
            h
        };
        let date = "Wed, 04 Nov 2026 03:10:02 GMT";
        assert_eq!(
            observed_at(&headers(date, Some("5")), now)
                .unwrap()
                .timestamp(),
            now.timestamp() - 8
        );
        assert_eq!(
            observed_at(&headers(date, Some("12")), now)
                .unwrap()
                .timestamp(),
            now.timestamp() - 12
        );
        assert!(observed_at(&headers(date, Some("-5")), now).is_err());
        assert!(observed_at(&headers(date, Some("200")), now).is_err());
        assert!(observed_at(&headers("Wed, 04 Nov 2026 03:11:02 GMT", None), now).is_err());
        assert!(observed_at(&headers("Wed, 04 Nov 2026 03:00:02 GMT", None), now).is_err());
        assert!(observed_at(&header::HeaderMap::new(), now).is_err());
        let mut h = headers(date, None);
        h.insert(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("public,max-age=3"),
        );
        assert!(observed_at(&h, now).is_err());
        let mut h = headers(date, None);
        h.insert("x-cache", header::HeaderValue::from_static("STALE"));
        assert!(observed_at(&h, now).is_err());
        let mut h = headers(date, None);
        h.append(header::DATE, header::HeaderValue::from_static(date));
        assert!(observed_at(&h, now).is_err());
        let mut h = headers(date, None);
        h.insert(
            header::WARNING,
            header::HeaderValue::from_static("110 civicapi \"Response is stale\""),
        );
        assert!(observed_at(&h, now).is_err());
    }

    #[test]
    fn retry_after_survives_error_context() {
        let (_, _, now) = fixture();
        assert_eq!(retry_delay("60", now), Some(Duration::from_secs(60)));
        assert_eq!(
            retry_delay("Wed, 04 Nov 2026 03:11:02 GMT", now),
            Some(Duration::from_secs(60))
        );
        assert_eq!(retry_delay("maybe", now), None);
        let err = anyhow::Error::new(HttpFailure {
            status: StatusCode::BAD_GATEWAY,
            delay: Some(Duration::from_secs(60)),
        })
        .context("fetch failed");
        assert_eq!(retry_after(&err), Some(Duration::from_secs(60)));
    }

    #[test]
    fn replay_captured_nationwide_directory_when_available() {
        let Ok(path) = std::env::var("ELECTIONS_TEST_BULK_CAPTURE") else {
            return;
        };
        let (r, _, stamp) = fixture();
        let bytes = std::fs::read(path).unwrap();
        let date = r.election_date;
        let wanted = HashMap::from([(r.id, r)]);
        let out = decode(&bytes, date, &wanted, stamp).unwrap();
        assert_eq!(out.len(), 1);
        let tn = &out[&87476];
        assert_eq!(tn["percent_reporting"], 71.0);
        assert!(
            tn["candidates"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["name"] == "Jerri Green" && c["votes"] == 720945)
        );
    }
}
