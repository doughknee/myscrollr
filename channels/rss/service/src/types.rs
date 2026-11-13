use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct RssHealth {
    pub status: String,
    pub last_poll: Option<DateTime<Utc>>,
    pub feeds_polled: u64,
    pub items_ingested: u64,
    pub error_count: u64,
    pub last_error: Option<String>,
    /// Feeds that failed in the current cycle (`error_count` is cumulative).
    #[serde(skip)]
    pub cycle_failures: u64,
}

impl Default for RssHealth {
    fn default() -> Self {
        Self::new()
    }
}

impl RssHealth {
    pub fn new() -> Self {
        Self {
            // Start in "starting" so the informational payload agrees with
            // readiness (which always starts as `Starting` regardless).
            // `record_success` flips this to "healthy" after the first
            // successful poll.
            status: String::from("starting"),
            last_poll: None,
            feeds_polled: 0,
            items_ingested: 0,
            error_count: 0,
            last_error: None,
            cycle_failures: 0,
        }
    }

    pub fn record_success(&mut self, items: u64) {
        self.last_poll = Some(Utc::now());
        self.feeds_polled += 1;
        self.items_ingested += items;
        self.status = String::from("healthy");
    }

    pub fn record_error(&mut self, error: String) {
        self.error_count += 1;
        self.cycle_failures += 1;
        self.last_error = Some(error);
        self.status = String::from("degraded");
    }

    /// Reset per-cycle counters at the start of each poll cycle.
    pub fn reset_cycle(&mut self) {
        self.feeds_polled = 0;
        self.items_ingested = 0;
        self.cycle_failures = 0;
    }

    pub fn get_health(&self) -> Self {
        self.clone()
    }
}
