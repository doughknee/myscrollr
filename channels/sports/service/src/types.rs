use chrono::{DateTime, Datelike, Utc};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

/// api-sports.io Pro plan: 7,500 requests/day per sport host. The fallback
/// daily quota until a response carries `x-ratelimit-requests-limit`, and the
/// baseline the live-poll cadence is scaled from.
pub const DEFAULT_DAILY_QUOTA: u32 = 7500;

/// Live-poll interval for the effective daily quota, in seconds.
///
/// Pro (7,500/day) polls live games every `max_secs`; a bigger plan earns a
/// proportionally shorter interval, floored at `min_secs`. Ultra (75,000/day)
/// lands on the floor. The idle interval is always `max_secs`.
pub fn live_poll_interval_secs(daily_quota: u32, min_secs: u64, max_secs: u64) -> u64 {
    let pro = u64::from(DEFAULT_DAILY_QUOTA);
    let quota = u64::from(daily_quota).max(1);
    (max_secs * pro / quota).clamp(min_secs.min(max_secs), max_secs)
}

/// One host's effective daily quota as `/health/ready` reports it (REL-222):
/// the number the limiter is actually budgeting from and where it came from.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct HostQuota {
    pub daily_quota: u32,
    pub remaining: u32,
    /// "header" once `x-ratelimit-requests-limit` has been adopted, else "config".
    pub source: &'static str,
}

/// What one api-sports host advertises about the per-minute window, as
/// `/health/ready` reports it (REL-229): the capitalised `X-RateLimit-Limit`
/// / `X-RateLimit-Remaining` pair from its last response, and how often it
/// has answered with the in-band throttle (HTTP 200, `errors.rateLimit`,
/// empty `response` — not a 429).
#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct HostMinute {
    pub limit: Option<u32>,
    pub remaining: Option<u32>,
    pub throttle_events: u32,
}

/// The per-minute budget this process paces itself to. It is ONE bucket for
/// the whole key, not one per host: on 2026-09-07 a fresh pod was throttled
/// on the rugby host after ~10 requests/min to it while the account as a
/// whole was bursting at startup, so api-sports counts the minute across
/// the subscription. The limit is the smallest any host has advertised.
#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
pub struct MinuteBudget {
    pub limit: Option<u32>,
    /// Requests this process sent, to any host, in the last 60 s.
    pub sent_last_minute: u32,
    /// Seconds until the next request may go out; 0 when not backing off.
    pub backoff_secs: u64,
}

/// First in-band throttle backs off this long; each consecutive one doubles
/// it up to [`THROTTLE_BACKOFF_MAX`]. The window is a minute, so a longer
/// wait than that would only leave tokens unused.
pub const THROTTLE_BACKOFF_BASE: Duration = Duration::from_secs(10);
pub const THROTTLE_BACKOFF_MAX: Duration = Duration::from_secs(120);
const MINUTE: Duration = Duration::from_secs(60);

#[derive(Default)]
struct MinuteState {
    hosts: HashMap<String, HostMinute>,
    sent: VecDeque<Instant>,
    blocked_until: Option<Instant>,
    streak: u32,
}

impl MinuteState {
    fn prune(&mut self, now: Instant) {
        while self.sent.front().is_some_and(|t| now.duration_since(*t) >= MINUTE) {
            self.sent.pop_front();
        }
    }

    fn limit(&self) -> Option<u32> {
        self.hosts.values().filter_map(|h| h.limit).min()
    }

    fn block_until(&mut self, until: Instant) {
        self.blocked_until = Some(self.blocked_until.map_or(until, |b| b.max(until)));
    }

    /// How long the next request must wait, or `None` when it may go now.
    fn wait(&mut self, now: Instant) -> Option<Duration> {
        self.prune(now);
        let mut until: Option<Instant> = self.blocked_until.filter(|b| *b > now);
        if let Some(limit) = self.limit()
            && self.sent.len() as u32 >= limit.max(1)
            && let Some(oldest) = self.sent.front()
        {
            let free_at = *oldest + MINUTE;
            until = Some(until.map_or(free_at, |u| u.max(free_at)));
        }
        until.map(|u| u.duration_since(now))
    }

    fn budget(&mut self, now: Instant) -> MinuteBudget {
        self.prune(now);
        MinuteBudget {
            limit: self.limit(),
            sent_last_minute: self.sent.len() as u32,
            backoff_secs: self.blocked_until
                .filter(|b| *b > now)
                .map_or(0, |b| b.duration_since(now).as_secs()),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct SportsHealth {
    pub status: String,
    pub last_poll: Option<DateTime<Utc>>,
    pub leagues_active: u32,
    pub leagues_live: u32,
    pub rate_limits: Option<HashMap<String, u32>>,
    /// Effective daily quota per host; empty until the limiter exists.
    pub quota: BTreeMap<String, HostQuota>,
    /// What live games poll at right now, derived from the effective quota.
    pub live_poll_secs: Option<u64>,
    /// Per host: the per-minute limit upstream advertises and how often it
    /// has throttled us.
    pub minute: BTreeMap<String, HostMinute>,
    /// The one per-minute bucket the process paces itself to.
    pub minute_budget: MinuteBudget,
    /// Polls that came back throttled (in-band `errors.rateLimit` or 429).
    /// They are not counted as polls and never touch a game row.
    pub throttled_polls: u64,
    pub error_count: u64,
    pub last_error: Option<String>,
}

impl Default for SportsHealth {
    fn default() -> Self {
        Self::new()
    }
}

impl SportsHealth {
    pub fn new() -> Self {
        Self {
            status: String::from("starting"),
            last_poll: None,
            leagues_active: 0,
            leagues_live: 0,
            rate_limits: None,
            quota: BTreeMap::new(),
            live_poll_secs: None,
            minute: BTreeMap::new(),
            minute_budget: MinuteBudget::default(),
            throttled_polls: 0,
            error_count: 0,
            last_error: None,
        }
    }

    pub fn record_success(&mut self, leagues_active: u32, leagues_live: u32) {
        self.last_poll = Some(Utc::now());
        self.status = String::from("healthy");
        self.leagues_active = leagues_active;
        self.leagues_live = leagues_live;
    }

    pub fn record_error(&mut self, error: String) {
        self.error_count += 1;
        self.last_error = Some(error);
        self.status = String::from("degraded");
    }

    pub fn set_rate_limits(&mut self, limits: HashMap<String, u32>) {
        self.rate_limits = Some(limits);
    }

    /// Publish the limiter's effective quota and the live cadence it earns.
    pub fn set_quota(&mut self, quota: BTreeMap<String, HostQuota>, live_poll_secs: u64) {
        self.quota = quota;
        self.live_poll_secs = Some(live_poll_secs);
    }

    /// Publish the per-minute picture: what each host advertises and the
    /// bucket the process is pacing itself to.
    pub fn set_minute(&mut self, hosts: BTreeMap<String, HostMinute>, budget: MinuteBudget) {
        self.minute = hosts;
        self.minute_budget = budget;
    }

    /// A poll was refused by the per-minute throttle. Not an error — the
    /// limiter is already backing off — but worth counting.
    pub fn record_throttle(&mut self) {
        self.throttled_polls += 1;
    }

    pub fn get_health(&self) -> Self {
        self.clone()
    }
}

/// Per-sport-host rate limit tracker with per-league fair-share allocation.
///
/// api-sports.io enforces budgets per `sport_api` host (basketball, football,
/// hockey, etc.). Within a host, multiple leagues can share the budget — e.g.
/// the football host serves Premier League, La Liga, MLS, and Champions League.
///
/// To prevent one league (typically Champions League on knockout nights) from
/// starving the others, each in-season league gets a reserved share of
/// `total / N_in_season`. Off-season leagues contribute their share entirely
/// to a per-host shared pool. When a league exhausts its reserved budget, it
/// falls back to the shared pool before being skipped.
pub struct RateLimiter {
    /// Effective daily quota per host: the config value until a response
    /// carries `x-ratelimit-requests-limit`, then whatever upstream last said
    /// (up or down). Buckets are reseeded from it at UTC midnight and whenever
    /// it changes.
    host_limit: HashMap<String, AtomicU32>,
    /// Legacy per-sport bucket — preserved for the health endpoint snapshot.
    /// Updated from `x-ratelimit-requests-remaining` headers as before, but
    /// no longer used for consumption decisions when per-league budgets are
    /// initialized.
    host_remaining: HashMap<String, AtomicU32>,
    /// Per-league reserved buckets, keyed by league name.
    league_reserved: HashMap<String, AtomicU32>,
    /// Map league_name → host so we know which shared pool to fall back to.
    league_to_host: HashMap<String, String>,
    /// Per-host shared pool — fed by off-season leagues' donated shares.
    host_shared: HashMap<String, AtomicU32>,
    /// League names currently inside their off-season window. These leagues
    /// have no reserved budget AND may not borrow from the shared pool — the
    /// pool exists so in-season leagues can use the budget dormant leagues
    /// donated. Refreshed at construction and at each daily reset (the month
    /// can change at UTC midnight).
    offseason_leagues: RwLock<HashSet<String>>,
    /// Hosts whose quota has been adopted from `x-ratelimit-requests-limit`,
    /// so the health snapshot can say header vs config.
    header_seen: RwLock<HashSet<String>>,
    /// The per-minute window (REL-229). Never held across an await.
    minute: Mutex<MinuteState>,
}

impl RateLimiter {
    /// Legacy constructor: one bucket per sport host, no per-league split.
    /// Kept for tests that don't exercise the per-league logic.
    pub fn new(sports: &[String], initial: u32) -> Self {
        let mut host_remaining = HashMap::new();
        for s in sports {
            host_remaining.insert(s.clone(), AtomicU32::new(initial));
        }
        Self {
            host_limit: HashMap::new(),
            host_remaining,
            league_reserved: HashMap::new(),
            league_to_host: HashMap::new(),
            host_shared: HashMap::new(),
            offseason_leagues: RwLock::new(HashSet::new()),
            header_seen: RwLock::new(HashSet::new()),
            minute: Mutex::new(MinuteState::default()),
        }
    }

    /// Build a rate limiter with per-league reserved shares.
    ///
    /// Algorithm:
    ///   - Group leagues by sport_api host.
    ///   - Within each host, total daily budget = `daily_total`.
    ///   - Each league's share = `daily_total / N_leagues_on_host`.
    ///   - In-season leagues get their share as `reserved`.
    ///   - Off-season leagues (current UTC month is in offseason_months) get
    ///     `reserved = 0` and donate their share to the host's shared pool.
    pub fn new_per_league(leagues: &[crate::database::TrackedLeague], daily_total: u32) -> Self {
        let mut league_reserved = HashMap::new();
        let mut league_to_host = HashMap::new();
        let mut host_shared = HashMap::new();
        let mut host_remaining = HashMap::new();
        let mut host_limit = HashMap::new();
        for l in leagues {
            league_reserved.insert(l.name.clone(), AtomicU32::new(0));
            league_to_host.insert(l.name.clone(), l.sport_api.clone());
            host_shared.entry(l.sport_api.clone()).or_insert_with(|| AtomicU32::new(0));
            host_remaining.entry(l.sport_api.clone()).or_insert_with(|| AtomicU32::new(daily_total));
            host_limit.entry(l.sport_api.clone()).or_insert_with(|| AtomicU32::new(daily_total));
        }
        let rl = Self {
            host_limit,
            host_remaining,
            league_reserved,
            league_to_host,
            host_shared,
            offseason_leagues: RwLock::new(HashSet::new()),
            header_seen: RwLock::new(HashSet::new()),
            minute: Mutex::new(MinuteState::default()),
        };
        rl.reset_daily(leagues);
        rl
    }

    /// Refill one host's buckets from `limit`: each league on the host gets
    /// `limit / N`; in-season leagues keep their share as `reserved`,
    /// off-season leagues donate theirs to the host's shared pool.
    fn seed_host(&self, host: &str, limit: u32) {
        let leagues: Vec<&String> = self.league_to_host.iter()
            .filter(|(_, h)| h.as_str() == host)
            .map(|(l, _)| l)
            .collect();
        let share = limit / leagues.len().max(1) as u32;
        let offseason = self.offseason_leagues.read()
            .map(|s| s.clone())
            .unwrap_or_default();
        let mut donated = 0u32;
        for l in leagues {
            let reserved = if offseason.contains(l) { donated += share; 0 } else { share };
            if let Some(slot) = self.league_reserved.get(l) {
                slot.store(reserved, Ordering::Relaxed);
            }
        }
        if let Some(slot) = self.host_shared.get(host) {
            slot.store(donated, Ordering::Relaxed);
        }
        if let Some(slot) = self.host_remaining.get(host) {
            slot.store(limit, Ordering::Relaxed);
        }
    }

    /// Try to consume 1 request for the given league. Returns true if the
    /// caller may proceed, false if the league has exhausted both its
    /// reserved and its host's shared pool.
    ///
    /// Order: reserved → shared pool → fail.
    pub fn try_consume(&self, league_name: &str) -> bool {
        // Try reserved first
        if let Some(reserved) = self.league_reserved.get(league_name) {
            // Atomic decrement-if-positive
            let mut cur = reserved.load(Ordering::Relaxed);
            while cur > 0 {
                match reserved.compare_exchange_weak(cur, cur - 1, Ordering::Relaxed, Ordering::Relaxed) {
                    Ok(_) => return true,
                    Err(actual) => cur = actual,
                }
            }
        }
        // Off-season leagues have no reserved share and may not raid the
        // shared pool — it exists so in-season leagues can borrow the budget
        // dormant leagues donated. Without this check, a dormant league that
        // is still polled drains the very pool it donated (June 2026: three
        // off-season soccer leagues burned the whole football-host quota).
        if self.offseason_leagues.read()
            .map(|s| s.contains(league_name))
            .unwrap_or(false)
        {
            return false;
        }
        // Fall back to shared pool
        let Some(host) = self.league_to_host.get(league_name) else {
            return false;
        };
        let Some(shared) = self.host_shared.get(host) else {
            return false;
        };
        let mut cur = shared.load(Ordering::Relaxed);
        while cur > 0 {
            match shared.compare_exchange_weak(cur, cur - 1, Ordering::Relaxed, Ordering::Relaxed) {
                Ok(_) => return true,
                Err(actual) => cur = actual,
            }
        }
        false
    }

    /// Snapshot of the per-league reserved budget. Used only by tests + logs.
    pub fn reserved(&self, league_name: &str) -> u32 {
        self.league_reserved.get(league_name)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Snapshot of a host's shared pool.
    pub fn shared_remaining(&self, host: &str) -> u32 {
        self.host_shared.get(host)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Reset all per-league reserved + per-host shared pools from each host's
    /// effective daily quota. Called at UTC midnight by the daily reset task
    /// in main.rs.
    pub fn reset_daily(&self, leagues: &[crate::database::TrackedLeague]) {
        // Re-derive the off-season set first — the month may have rolled
        // over, moving leagues into or out of their off-season window.
        let current_month: i32 = Utc::now().month() as i32;
        let offseason: HashSet<String> = leagues.iter()
            .filter(|l| l.is_offseason(current_month))
            .map(|l| l.name.clone())
            .collect();
        if let Ok(mut s) = self.offseason_leagues.write() {
            *s = offseason;
        }
        for (host, limit) in &self.host_limit {
            self.seed_host(host, limit.load(Ordering::Relaxed));
        }
    }

    /// Adopt the plan's daily quota for a host from `x-ratelimit-requests-limit`.
    /// Header truth in both directions: a raise (Pro → Ultra) reseeds the
    /// host's buckets from the new quota, a cut reseeds them smaller. The
    /// caller follows with `update(remaining)`, whose clamp then pulls the
    /// fresh buckets down to what upstream says is actually left today.
    pub fn set_daily_quota(&self, host: &str, limit: u32) {
        let Some(slot) = self.host_limit.get(host) else { return };
        if let Ok(mut seen) = self.header_seen.write() {
            seen.insert(host.to_string());
        }
        let prev = slot.swap(limit, Ordering::Relaxed);
        if prev != limit {
            crate::log::info!("[Rate Budget] {host}: daily quota {prev} → {limit} (x-ratelimit-requests-limit)");
            self.seed_host(host, limit);
        }
    }

    /// Effective daily quota for a host (config until a header has been seen).
    pub fn daily_quota(&self, host: &str) -> u32 {
        self.host_limit.get(host)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(DEFAULT_DAILY_QUOTA)
    }

    /// Plan-wide quota for cadence decisions: the largest any host has
    /// reported. One key, one plan — a host that never gets polled (all its
    /// leagues off-season) never sees a header and would otherwise pin the
    /// cadence at the config fallback.
    pub fn max_daily_quota(&self) -> u32 {
        self.host_limit.values()
            .map(|c| c.load(Ordering::Relaxed))
            .max()
            .unwrap_or(DEFAULT_DAILY_QUOTA)
    }

    /// Hosts known to the limiter, sorted, for startup logging.
    pub fn hosts(&self) -> Vec<String> {
        let mut v: Vec<String> = self.host_limit.keys().cloned().collect();
        v.sort();
        v
    }

    /// Per-host effective quota for `/health/ready`: what is being budgeted
    /// from, what is left, and whether the number came from the plan header
    /// or the config fallback.
    pub fn quota_snapshot(&self) -> BTreeMap<String, HostQuota> {
        let seen = self.header_seen.read().ok();
        self.hosts().into_iter().map(|host| {
            let from_header = seen.as_ref().is_some_and(|s| s.contains(&host));
            let q = HostQuota {
                daily_quota: self.daily_quota(&host),
                remaining: self.remaining(&host),
                source: if from_header { "header" } else { "config" },
            };
            (host, q)
        }).collect()
    }

    // ── Per-minute window (REL-229) ─────────────────────────────────────────

    fn with_minute<T>(&self, f: impl FnOnce(&mut MinuteState, Instant) -> T) -> T {
        let now = Instant::now();
        let mut m = self.minute.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut m, now)
    }

    /// How long the next request has to wait for a per-minute token, or
    /// `None` when it may go out now. Does not record the send.
    pub fn minute_wait(&self) -> Option<Duration> {
        self.with_minute(|m, now| m.wait(now))
    }

    /// Record that a request is going out now.
    pub fn minute_sent(&self) {
        self.with_minute(|m, now| {
            m.prune(now);
            m.sent.push_back(now);
        });
    }

    /// Wait for a per-minute token, then take it. Sleeps outside the lock;
    /// the loop re-checks because a throttle may land meanwhile.
    pub async fn acquire_minute(&self) {
        loop {
            match self.minute_wait() {
                Some(wait) => tokio::time::sleep(wait).await,
                None => {
                    self.minute_sent();
                    return;
                }
            }
        }
    }

    /// Feed the capitalised per-minute pair from one host's response.
    /// `remaining == 0` blocks for a minute: the window edge is not
    /// reported, so a full minute is the only wait guaranteed to cross it.
    pub fn note_minute_headers(&self, host: &str, limit: Option<u32>, remaining: Option<u32>) {
        self.with_minute(|m, now| {
            let h = m.hosts.entry(host.to_string()).or_default();
            if limit.is_some() {
                h.limit = limit;
            }
            if remaining.is_some() {
                h.remaining = remaining;
            }
            if remaining == Some(0) {
                m.block_until(now + MINUTE);
            }
        });
    }

    /// An in-band `errors.rateLimit` (or a 429) came back from `host`.
    /// Backs everything off exponentially from [`THROTTLE_BACKOFF_BASE`],
    /// capped at [`THROTTLE_BACKOFF_MAX`], and returns the backoff applied.
    pub fn note_throttled(&self, host: &str) -> Duration {
        self.with_minute(|m, now| {
            m.hosts.entry(host.to_string()).or_default().throttle_events += 1;
            let backoff = THROTTLE_BACKOFF_BASE
                .checked_mul(1u32 << m.streak.min(10))
                .unwrap_or(THROTTLE_BACKOFF_MAX)
                .min(THROTTLE_BACKOFF_MAX);
            m.streak += 1;
            m.block_until(now + backoff);
            backoff
        })
    }

    /// A response carried data: the throttle streak is over.
    pub fn note_minute_ok(&self) {
        self.with_minute(|m, _| m.streak = 0);
    }

    /// Per-host advertised limits and the shared bucket, for `/health/ready`.
    pub fn minute_snapshot(&self) -> (BTreeMap<String, HostMinute>, MinuteBudget) {
        self.with_minute(|m, now| {
            let mut hosts: BTreeMap<String, HostMinute> = self.hosts().into_iter()
                .map(|h| (h, HostMinute::default()))
                .collect();
            for (host, h) in &m.hosts {
                hosts.insert(host.clone(), h.clone());
            }
            (hosts, m.budget(now))
        })
    }

    // ── Legacy methods (preserved for the health endpoint + standings/teams polls) ──

    pub fn update(&self, sport: &str, remaining: u32) {
        if let Some(counter) = self.host_remaining.get(sport) {
            counter.store(remaining, Ordering::Relaxed);
        }
        self.clamp_to_host_remaining(sport, remaining);
    }

    /// Shrink a host's per-league buckets so they never promise more requests
    /// than upstream says are left.
    ///
    /// The buckets are seeded to a full `daily_total` at construction, but the
    /// api-sports.io counter only rolls at UTC midnight. A pod restart at noon
    /// therefore handed the limiter a fresh 7,500/day while upstream had a few
    /// hundred left — the service would happily blow straight through the
    /// quota (root-cause family of the June 11 soccer outage; #211 fixed the
    /// off-season half of it).
    ///
    /// `x-ratelimit-requests-remaining` is upstream's own count and arrives on
    /// every response, so it is the authoritative number. Every bucket on the
    /// host is scaled by `remaining / sum` (integer floor, so the post-clamp
    /// sum is ≤ remaining), which preserves the fair-share ratios rather than
    /// letting whichever league polls first drain what is left.
    ///
    /// This only ever shrinks. Buckets are refilled solely by `reset_daily`,
    /// so a transiently large header can't inflate the day's budget.
    ///
    /// It also closes a gap that predates restarts: the standings and teams
    /// polls gate on `has_budget` and spend upstream quota without touching
    /// any per-league bucket. Their spend now pulls the live-poll budget down
    /// too, instead of being invisible to it.
    fn clamp_to_host_remaining(&self, host: &str, remaining: u32) {
        // ponytail: not atomic across buckets — a concurrent `try_consume` can
        // slip between the read and the store, so the post-clamp sum can be off
        // by the number of in-flight requests. It only ever shrinks and polls
        // are sequential today; take a lock if that stops being true.
        let leagues: Vec<&String> = self.league_to_host.iter()
            .filter(|(_, h)| h.as_str() == host)
            .map(|(l, _)| l)
            .collect();
        // Legacy constructor has no per-league buckets — nothing to clamp.
        if leagues.is_empty() {
            return;
        }

        let shared = self.host_shared.get(host);
        let sum: u64 = leagues.iter()
            .filter_map(|l| self.league_reserved.get(*l))
            .map(|c| c.load(Ordering::Relaxed) as u64)
            .sum::<u64>()
            + shared.map(|c| c.load(Ordering::Relaxed) as u64).unwrap_or(0);

        // Already within what upstream reports (also covers sum == 0, which
        // would divide by zero below).
        if sum <= remaining as u64 {
            return;
        }

        let scale = |cur: u32| -> u32 { (cur as u64 * remaining as u64 / sum) as u32 };
        for l in &leagues {
            if let Some(c) = self.league_reserved.get(*l) {
                c.store(scale(c.load(Ordering::Relaxed)), Ordering::Relaxed);
            }
        }
        if let Some(c) = shared {
            c.store(scale(c.load(Ordering::Relaxed)), Ordering::Relaxed);
        }
    }

    pub fn remaining(&self, sport: &str) -> u32 {
        self.host_remaining.get(sport)
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0)
    }

    /// Returns true if the given sport host has enough budget for at least
    /// one more request (legacy API used by the standings + teams polls
    /// which don't go through per-league `try_consume`).
    pub fn has_budget(&self, sport: &str) -> bool {
        self.remaining(sport) > 100
    }

    pub fn all_remaining(&self) -> HashMap<String, u32> {
        self.host_remaining.iter()
            .map(|(k, v)| (k.clone(), v.load(Ordering::Relaxed)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_new() {
        let sports = vec!["basketball".to_string(), "football".to_string()];
        let rl = RateLimiter::new(&sports, 100);
        assert_eq!(rl.remaining("basketball"), 100);
        assert_eq!(rl.remaining("football"), 100);
        assert_eq!(rl.remaining("hockey"), 0); // unknown sport
    }

    #[test]
    fn test_rate_limiter_update() {
        let sports = vec!["basketball".to_string()];
        let rl = RateLimiter::new(&sports, 1000);
        rl.update("basketball", 750);
        assert_eq!(rl.remaining("basketball"), 750);
    }

    #[test]
    fn test_rate_limiter_has_budget() {
        let sports = vec!["basketball".to_string()];
        let rl = RateLimiter::new(&sports, 1000);
        assert!(rl.has_budget("basketball")); // 1000 > 100 buffer
        rl.update("basketball", 50);
        assert!(!rl.has_budget("basketball")); // 50 <= 100 buffer
        assert!(!rl.has_budget("unknown_sport")); // 0 <= 100
    }

    #[test]
    fn test_rate_limiter_all_remaining() {
        let sports = vec![
            "basketball".to_string(),
            "football".to_string(),
            "hockey".to_string(),
        ];
        let rl = RateLimiter::new(&sports, 500);
        rl.update("basketball", 400);
        rl.update("football", 300);

        let snapshot = rl.all_remaining();
        assert_eq!(snapshot.get("basketball"), Some(&400));
        assert_eq!(snapshot.get("football"), Some(&300));
        assert_eq!(snapshot.get("hockey"), Some(&500)); // unchanged
    }

    #[test]
    fn test_rate_limiter_concurrent_updates() {
        use std::sync::Arc;

        let sports = vec!["basketball".to_string()];
        let rl = Arc::new(RateLimiter::new(&sports, 1000));
        let rl2 = rl.clone();

        // Simulate concurrent updates by multiple tasks
        for _ in 0..10 {
            let r = rl.clone();
            // AtomicU32 updates are thread-safe
            r.update("basketball", 500);
        }
        assert_eq!(rl2.remaining("basketball"), 500);
    }

    use crate::database::TrackedLeague;

    fn make_league(name: &str, sport_api: &str, offseason: Option<Vec<i32>>) -> TrackedLeague {
        TrackedLeague {
            name: name.to_string(),
            sport_api: sport_api.to_string(),
            api_host: format!("v3.{}.api-sports.io", sport_api),
            league_id: 1,
            category: "Test".to_string(),
            country: None,
            logo_url: None,
            season: None,
            season_format: None,
            offseason_months: offseason,
        }
    }

    #[test]
    fn test_league_budget_reserved_share() {
        // 4 in-season football leagues sharing 7500/day → 1875 each reserved
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
            make_league("MLS", "football", None),
            make_league("Champions League", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 7500);

        // Each in-season league has 1875 reserved
        assert_eq!(rl.reserved("Premier League"), 1875);
        assert_eq!(rl.reserved("Champions League"), 1875);
        // Shared pool is 0 (no off-season leagues contributing)
        assert_eq!(rl.shared_remaining("football"), 0);
    }

    #[test]
    fn test_league_budget_offseason_donates_to_shared_pool() {
        use chrono::Datelike;
        // 3 in-season + 1 off-season (current month) football leagues
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
            make_league("MLS", "football", None),
            make_league("Off Season League", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 7500);

        // 7500 / 4 = 1875 each. Off-season league donates its 1875 to the pool.
        assert_eq!(rl.reserved("Premier League"), 1875);
        assert_eq!(rl.reserved("Off Season League"), 0);
        assert_eq!(rl.shared_remaining("football"), 1875);
    }

    #[test]
    fn test_league_budget_try_consume_uses_reserved_first() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        // 500 reserved each, 0 shared
        for _ in 0..400 {
            assert!(rl.try_consume("Premier League"));
        }
        assert_eq!(rl.reserved("Premier League"), 100);
        assert_eq!(rl.reserved("La Liga"), 500);
    }

    #[test]
    fn test_league_budget_falls_back_to_shared_pool() {
        use chrono::Datelike;
        // 1 in-season + 1 off-season → all of off-season's share goes to pool
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("Off", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        // Premier League reserved = 500, shared pool = 500
        // Exhaust reserved
        for _ in 0..500 {
            assert!(rl.try_consume("Premier League"));
        }
        assert_eq!(rl.reserved("Premier League"), 0);
        // Next 500 come from shared pool
        for _ in 0..500 {
            assert!(rl.try_consume("Premier League"));
        }
        assert_eq!(rl.shared_remaining("football"), 0);
        // Now exhausted
        assert!(!rl.try_consume("Premier League"));
    }

    #[test]
    fn test_offseason_league_cannot_drain_shared_pool() {
        use chrono::Datelike;
        // Regression test for the June 2026 quota exhaustion: an off-season
        // league has reserved=0, and try_consume must NOT let it fall through
        // to the shared pool — that pool exists for in-season leagues.
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("Off", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);

        // Off-season league is denied outright; shared pool untouched.
        assert!(!rl.try_consume("Off"));
        assert_eq!(rl.shared_remaining("football"), 500);

        // In-season league can still spend its reserved share AND borrow
        // the donated share from the pool.
        for _ in 0..1000 {
            assert!(rl.try_consume("Premier League"));
        }
        assert!(!rl.try_consume("Premier League"));
    }

    #[test]
    fn test_league_budget_daily_reset() {
        let leagues = vec![make_league("Premier League", "football", None)];
        let rl = RateLimiter::new_per_league(&leagues, 100);
        // Burn through it
        for _ in 0..100 {
            assert!(rl.try_consume("Premier League"));
        }
        assert!(!rl.try_consume("Premier League"));
        // Reset
        rl.reset_daily(&leagues);
        assert_eq!(rl.reserved("Premier League"), 100);
    }

    // ── Header clamp: the restart-overshoot guard (REL-52) ──────────────────

    #[test]
    fn test_clamp_stops_restart_overshoot() {
        // The actual bug. A pod restarts at noon; the limiter rebuilds with a
        // full day's budget, but upstream has only 400 requests left.
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 7500);
        assert_eq!(rl.reserved("Premier League"), 3750);

        // First response of the new pod carries the authoritative header.
        rl.update("football", 400);

        // Buckets now sum to at most what upstream will actually serve,
        // and the fair-share ratio survives.
        let total = rl.reserved("Premier League")
            + rl.reserved("La Liga")
            + rl.shared_remaining("football");
        assert!(total <= 400, "post-clamp sum {} exceeds upstream 400", total);
        assert_eq!(rl.reserved("Premier League"), 200);
        assert_eq!(rl.reserved("La Liga"), 200);

        // And the limiter actually stops there — pre-fix this ran to 7500.
        let mut served = 0;
        while rl.try_consume("Premier League") || rl.try_consume("La Liga") {
            served += 1;
            assert!(served <= 400, "consumed past the clamped budget");
        }
        assert_eq!(served, 400);
    }

    #[test]
    fn test_clamp_scales_shared_pool_and_never_grows() {
        use chrono::Datelike;
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("Off", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        assert_eq!(rl.reserved("Premier League"), 500);
        assert_eq!(rl.shared_remaining("football"), 500); // donated

        rl.update("football", 100); // sum 1000 → 100, each halved share
        assert_eq!(rl.reserved("Premier League"), 50);
        assert_eq!(rl.shared_remaining("football"), 50);

        // A larger header must not hand back budget the day has already spent.
        rl.update("football", 9000);
        assert_eq!(rl.reserved("Premier League"), 50);
        assert_eq!(rl.shared_remaining("football"), 50);

        // Only the daily reset refills.
        rl.reset_daily(&leagues);
        assert_eq!(rl.reserved("Premier League"), 500);
    }

    #[test]
    fn test_clamp_is_noop_for_legacy_limiter() {
        // The legacy constructor has no per-league buckets; `update` must stay
        // the plain header store the health endpoint expects.
        let rl = RateLimiter::new(&["basketball".to_string()], 1000);
        rl.update("basketball", 42);
        assert_eq!(rl.remaining("basketball"), 42);
        assert_eq!(rl.reserved("basketball"), 0);
    }

    #[test]
    fn test_clamp_to_zero_denies_everything() {
        let leagues = vec![make_league("Premier League", "football", None)];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        rl.update("football", 0);
        assert_eq!(rl.reserved("Premier League"), 0);
        assert!(!rl.try_consume("Premier League"));
    }

    #[test]
    fn test_clamp_leaves_other_hosts_alone() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("NBA", "basketball", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        rl.update("football", 10);
        assert_eq!(rl.reserved("Premier League"), 10);
        assert_eq!(rl.reserved("NBA"), 1000); // untouched
    }

    // ── Effective quota from the plan header (REL-219) ──────────────────────

    #[test]
    fn test_plan_header_pro_to_ultra_and_back() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        // Config fallback until a header has been seen.
        let rl = RateLimiter::new_per_league(&leagues, DEFAULT_DAILY_QUOTA);
        assert_eq!(rl.daily_quota("football"), 7500);
        assert_eq!(rl.reserved("Premier League"), 3750);

        // Pro header: same number, nothing moves.
        rl.set_daily_quota("football", 7500);
        rl.update("football", 7000);
        assert_eq!(rl.daily_quota("football"), 7500);
        assert_eq!(rl.reserved("Premier League"), 3500); // clamped to 7000/2

        // Ultra header: buckets reseeded UP, then clamped to what is left.
        rl.set_daily_quota("football", 75_000);
        rl.update("football", 70_000);
        assert_eq!(rl.daily_quota("football"), 75_000);
        assert_eq!(rl.max_daily_quota(), 75_000);
        assert_eq!(rl.reserved("Premier League"), 35_000);
        assert_eq!(rl.remaining("football"), 70_000);

        // Back to Pro: reseeded DOWN, clamp still applies.
        rl.set_daily_quota("football", 7500);
        rl.update("football", 400);
        assert_eq!(rl.daily_quota("football"), 7500);
        assert_eq!(rl.reserved("Premier League"), 200);

        // Midnight refills from the last header, not the config.
        rl.set_daily_quota("football", 75_000);
        rl.update("football", 10);
        rl.reset_daily(&leagues);
        assert_eq!(rl.reserved("Premier League"), 37_500);
        assert_eq!(rl.remaining("football"), 75_000);

        // Unknown host: ignored, config fallback reported.
        rl.set_daily_quota("hockey", 75_000);
        assert_eq!(rl.daily_quota("hockey"), DEFAULT_DAILY_QUOTA);
    }

    #[test]
    fn test_max_daily_quota_ignores_unpolled_hosts() {
        let leagues = vec![
            make_league("NHL", "hockey", None),
            make_league("Premier League", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 7500);
        assert_eq!(rl.max_daily_quota(), 7500);
        rl.set_daily_quota("football", 75_000);
        assert_eq!(rl.max_daily_quota(), 75_000); // hockey never saw a header
        assert_eq!(rl.hosts(), vec!["football".to_string(), "hockey".to_string()]);
    }

    #[test]
    fn test_quota_snapshot_names_its_source() {
        let leagues = vec![
            make_league("NHL", "hockey", None),
            make_league("Premier League", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 7500);
        let config = HostQuota { daily_quota: 7500, remaining: 7500, source: "config" };
        assert_eq!(rl.quota_snapshot()["football"], config);
        assert_eq!(rl.quota_snapshot()["hockey"], config);

        // Ultra header on football only: it flips to "header", hockey stays config.
        rl.set_daily_quota("football", 75_000);
        rl.update("football", 74_980);
        let snap = rl.quota_snapshot();
        assert_eq!(snap["football"], HostQuota { daily_quota: 75_000, remaining: 74_980, source: "header" });
        assert_eq!(snap["hockey"], config);
        assert_eq!(snap.keys().collect::<Vec<_>>(), vec!["football", "hockey"]); // stable order
    }

    // ── Per-minute window (REL-229) ─────────────────────────────────────────

    #[test]
    fn test_minute_headers_gate_our_own_send_rate_across_hosts() {
        let rl = RateLimiter::new(&["baseball".to_string(), "hockey".to_string()], 1000);
        // Nothing known yet: no per-minute gating, only the daily budget.
        assert_eq!(rl.minute_wait(), None);
        rl.minute_sent();
        rl.note_minute_headers("baseball", Some(300), Some(299));
        rl.note_minute_headers("hockey", Some(3), Some(2));
        rl.minute_sent();
        rl.minute_sent();
        // The bucket is shared and sized by the smallest advertised limit:
        // three sent inside the window against hockey's 3 → wait ≤ 60 s,
        // whichever host the next request is for.
        let wait = rl.minute_wait().expect("must wait at the limit");
        assert!(wait <= MINUTE && wait > Duration::from_secs(55), "wait {wait:?}");
        let (hosts, budget) = rl.minute_snapshot();
        assert_eq!(hosts["baseball"], HostMinute { limit: Some(300), remaining: Some(299), throttle_events: 0 });
        assert_eq!(hosts["hockey"], HostMinute { limit: Some(3), remaining: Some(2), throttle_events: 0 });
        assert_eq!(budget, MinuteBudget { limit: Some(3), sent_last_minute: 3, backoff_secs: 0 });
    }

    #[test]
    fn test_remaining_zero_blocks_for_a_minute() {
        let rl = RateLimiter::new(&["baseball".to_string()], 1000);
        rl.note_minute_headers("baseball", Some(300), Some(0));
        let wait = rl.minute_wait().expect("remaining 0 must block");
        assert!(wait > Duration::from_secs(55) && wait <= MINUTE, "wait {wait:?}");
        assert_eq!(rl.minute_snapshot().1.backoff_secs, 59);
    }

    #[test]
    fn test_throttle_backoff_doubles_and_caps() {
        let rl = RateLimiter::new(&["hockey".to_string()], 1000);
        assert_eq!(rl.note_throttled("hockey"), Duration::from_secs(10));
        assert_eq!(rl.note_throttled("hockey"), Duration::from_secs(20));
        assert_eq!(rl.note_throttled("rugby"), Duration::from_secs(40));
        assert_eq!(rl.note_throttled("hockey"), Duration::from_secs(80));
        assert_eq!(rl.note_throttled("hockey"), THROTTLE_BACKOFF_MAX);
        assert_eq!(rl.note_throttled("hockey"), THROTTLE_BACKOFF_MAX);
        let wait = rl.minute_wait().expect("throttled account must wait");
        assert!(wait > Duration::from_secs(115) && wait <= THROTTLE_BACKOFF_MAX);
        let (hosts, budget) = rl.minute_snapshot();
        assert_eq!(hosts["hockey"].throttle_events, 5);
        assert_eq!(hosts["rugby"].throttle_events, 1);
        assert_eq!(budget.backoff_secs, 119);

        // A real response ends the streak; the next throttle starts small
        // again, but the backoff already in force is not shortened.
        rl.note_minute_ok();
        assert_eq!(rl.note_throttled("hockey"), Duration::from_secs(10));
        assert!(rl.minute_wait().unwrap() > Duration::from_secs(115));
    }

    #[tokio::test]
    async fn test_acquire_minute_returns_immediately_when_free_and_records_the_send() {
        let rl = RateLimiter::new(&["afl".to_string()], 1000);
        rl.note_minute_headers("afl", Some(10), Some(10));
        for _ in 0..10 {
            rl.acquire_minute().await;
        }
        assert_eq!(rl.minute_snapshot().1.sent_last_minute, 10);
        assert!(rl.minute_wait().is_some(), "11th send must wait");
    }

    #[test]
    fn test_live_poll_interval_tracks_quota() {
        assert_eq!(live_poll_interval_secs(7500, 15, 60), 60);   // Pro
        assert_eq!(live_poll_interval_secs(75_000, 15, 60), 15); // Ultra -> floor
        assert_eq!(live_poll_interval_secs(75_000, 20, 60), 20); // floor is config
        assert_eq!(live_poll_interval_secs(15_000, 15, 60), 30); // in between
        assert_eq!(live_poll_interval_secs(3000, 15, 60), 60);   // smaller plan -> ceiling
        assert_eq!(live_poll_interval_secs(0, 15, 60), 60);      // never divide by zero
        assert_eq!(live_poll_interval_secs(75_000, 90, 60), 60); // min > max -> max wins
    }
}
