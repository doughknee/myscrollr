use chrono::{DateTime, Datelike, Utc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::RwLock;

#[derive(Serialize, Clone)]
pub struct SportsHealth {
    pub status: String,
    pub last_poll: Option<DateTime<Utc>>,
    pub leagues_active: u32,
    pub leagues_live: u32,
    pub rate_limits: Option<HashMap<String, u32>>,
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
    /// Per-host consumption since the last flush to Postgres. This is a
    /// flush buffer, not a budget: `take_consumed` drains it periodically
    /// so the counts survive pod restarts (sports_rate_budget table).
    host_consumed: HashMap<String, AtomicU32>,
}

impl RateLimiter {
    /// Legacy constructor: one bucket per sport host, no per-league split.
    /// Kept for tests that don't exercise the per-league logic.
    pub fn new(sports: &[String], initial: u32) -> Self {
        let mut host_remaining = HashMap::new();
        let mut host_consumed = HashMap::new();
        for s in sports {
            host_remaining.insert(s.clone(), AtomicU32::new(initial));
            host_consumed.insert(s.clone(), AtomicU32::new(0));
        }
        Self {
            host_remaining,
            league_reserved: HashMap::new(),
            league_to_host: HashMap::new(),
            host_shared: HashMap::new(),
            offseason_leagues: RwLock::new(HashSet::new()),
            host_consumed,
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
        Self::new_per_league_seeded(leagues, daily_total, &HashMap::new())
    }

    /// Like [`new_per_league`](Self::new_per_league), but each host's budget
    /// is reduced by `consumed_today[host]` — the request count already spent
    /// today (UTC), persisted in the `sports_rate_budget` table. This is what
    /// `main.rs` uses on startup so a pod restart mid-day resumes from the
    /// quota actually remaining instead of a fresh full quota (the upstream
    /// api-sports.io counter only resets at UTC midnight).
    pub fn new_per_league_seeded(
        leagues: &[crate::database::TrackedLeague],
        daily_total: u32,
        consumed_today: &HashMap<String, u32>,
    ) -> Self {
        use std::collections::HashMap as Map;

        let current_month: i32 = Utc::now().month() as i32;

        // Group leagues by host (== sport_api here; one host per sport_api in practice).
        let mut by_host: Map<String, Vec<&crate::database::TrackedLeague>> = Map::new();
        for l in leagues {
            by_host.entry(l.sport_api.clone()).or_default().push(l);
        }

        let mut league_reserved = HashMap::new();
        let mut league_to_host = HashMap::new();
        let mut host_shared = HashMap::new();
        let mut host_remaining = HashMap::new();
        let mut offseason = HashSet::new();
        let mut host_consumed = HashMap::new();

        for (host, host_leagues) in &by_host {
            // Budget left for the rest of today, not the nominal daily quota.
            let effective_total = daily_total
                .saturating_sub(consumed_today.get(host.as_str()).copied().unwrap_or(0));
            let n = host_leagues.len().max(1) as u32;
            let share = effective_total / n;
            let mut donated = 0u32;
            for l in host_leagues {
                let is_offseason = l.is_offseason(current_month);
                let reserved = if is_offseason { 0 } else { share };
                if is_offseason {
                    donated += share;
                    offseason.insert(l.name.clone());
                }
                league_reserved.insert(l.name.clone(), AtomicU32::new(reserved));
                league_to_host.insert(l.name.clone(), host.clone());
            }
            host_shared.insert(host.clone(), AtomicU32::new(donated));
            host_remaining.insert(host.clone(), AtomicU32::new(effective_total));
            host_consumed.insert(host.clone(), AtomicU32::new(0));
        }

        Self {
            host_remaining,
            league_reserved,
            league_to_host,
            host_shared,
            offseason_leagues: RwLock::new(offseason),
            host_consumed,
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
                    Ok(_) => {
                        if let Some(host) = self.league_to_host.get(league_name) {
                            self.note_consumed(host, 1);
                        }
                        return true;
                    }
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
                Ok(_) => {
                    self.note_consumed(host, 1);
                    return true;
                }
                Err(actual) => cur = actual,
            }
        }
        false
    }

    /// Record `n` requests consumed against a host's flush buffer without
    /// touching the budget buckets. Used by `try_consume` internally, by the
    /// standings/teams polls (which gate on `has_budget` instead of
    /// `try_consume`), and to return deltas after a failed Postgres flush.
    /// Unknown hosts are ignored.
    pub fn note_consumed(&self, host: &str, n: u32) {
        if let Some(counter) = self.host_consumed.get(host) {
            counter.fetch_add(n, Ordering::Relaxed);
        }
    }

    /// Drain the per-host consumption buffer, returning only non-zero
    /// entries. The caller persists these to `sports_rate_budget`; if the
    /// write fails it must hand them back via `note_consumed` so the next
    /// flush retries them.
    pub fn take_consumed(&self) -> HashMap<String, u32> {
        self.host_consumed.iter()
            .filter_map(|(host, counter)| {
                let n = counter.swap(0, Ordering::Relaxed);
                (n > 0).then(|| (host.clone(), n))
            })
            .collect()
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

    /// Reset all per-league reserved + per-host shared pools. Called at UTC
    /// midnight by the daily reset task in main.rs.
    pub fn reset_daily(&self, leagues: &[crate::database::TrackedLeague], daily_total: u32) {
        use std::collections::HashMap as Map;
        let current_month: i32 = Utc::now().month() as i32;

        let mut by_host: Map<String, Vec<&crate::database::TrackedLeague>> = Map::new();
        for l in leagues {
            by_host.entry(l.sport_api.clone()).or_default().push(l);
        }

        let mut offseason = HashSet::new();
        for (host, host_leagues) in &by_host {
            let n = host_leagues.len().max(1) as u32;
            let share = daily_total / n;
            let mut donated = 0u32;
            for l in host_leagues {
                let is_offseason = l.is_offseason(current_month);
                let reserved = if is_offseason { 0 } else { share };
                if is_offseason {
                    donated += share;
                    offseason.insert(l.name.clone());
                }
                if let Some(slot) = self.league_reserved.get(&l.name) {
                    slot.store(reserved, Ordering::Relaxed);
                }
            }
            if let Some(slot) = self.host_shared.get(host) {
                slot.store(donated, Ordering::Relaxed);
            }
            if let Some(slot) = self.host_remaining.get(host) {
                slot.store(daily_total, Ordering::Relaxed);
            }
        }
        // Re-derive the off-season set — the month may have rolled over,
        // moving leagues into or out of their off-season window.
        if let Ok(mut s) = self.offseason_leagues.write() {
            *s = offseason;
        }
    }

    // ── Legacy methods (preserved for the health endpoint + standings/teams polls) ──

    /// Record the upstream `x-ratelimit-requests-remaining` header value for
    /// a host. Besides refreshing the legacy snapshot bucket, this clamps the
    /// per-league budgets: the header is the authoritative count of what's
    /// actually left today, so if it reports less than our local buckets sum
    /// to (restart with lost state, requests not routed through
    /// `try_consume`, another consumer on the same key), the local budgets
    /// are an over-estimate and would let us overshoot the daily quota.
    pub fn update(&self, sport: &str, remaining: u32) {
        if let Some(counter) = self.host_remaining.get(sport) {
            counter.store(remaining, Ordering::Relaxed);
        }
        self.clamp_to_host_remaining(sport, remaining);
    }

    /// Shrink a host's reserved + shared buckets proportionally so their sum
    /// does not exceed `header_remaining`. Never grows budgets — a header
    /// reporting more than the local sum is ignored so the fair-share
    /// allocation (and off-season donations) stays intact.
    ///
    /// The load-sum-then-store sequence is not atomic with respect to
    /// concurrent `try_consume` calls; a racing decrement may be overwritten
    /// by the scaled store. That's acceptable: the error is at most a few
    /// requests and the next response header re-clamps.
    fn clamp_to_host_remaining(&self, host: &str, header_remaining: u32) {
        let shared = self.host_shared.get(host);
        let league_slots: Vec<&AtomicU32> = self.league_to_host.iter()
            .filter(|(_, h)| h.as_str() == host)
            .filter_map(|(name, _)| self.league_reserved.get(name))
            .collect();
        if league_slots.is_empty() && shared.is_none() {
            return;
        }

        let local: u64 = league_slots.iter()
            .map(|s| s.load(Ordering::Relaxed) as u64)
            .sum::<u64>()
            + shared.map(|s| s.load(Ordering::Relaxed) as u64).unwrap_or(0);
        if local == 0 || header_remaining as u64 >= local {
            return;
        }

        // Integer scaling floors each bucket, so the post-clamp sum is
        // guaranteed <= header_remaining.
        let scale = |v: u32| ((v as u64) * (header_remaining as u64) / local) as u32;
        for slot in &league_slots {
            let cur = slot.load(Ordering::Relaxed);
            slot.store(scale(cur), Ordering::Relaxed);
        }
        if let Some(s) = shared {
            let cur = s.load(Ordering::Relaxed);
            s.store(scale(cur), Ordering::Relaxed);
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
        rl.reset_daily(&leagues, 100);
        assert_eq!(rl.reserved("Premier League"), 100);
    }

    // ── Persisted-consumption seeding ────────────────────────────────────

    #[test]
    fn test_seeded_constructor_subtracts_consumed() {
        // 7000 of 7500 already spent today → only 500 left to split across
        // 2 leagues = 250 reserved each. The legacy host bucket is also
        // seeded with the effective remainder, not the nominal quota.
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        let mut consumed = HashMap::new();
        consumed.insert("football".to_string(), 7000u32);
        let rl = RateLimiter::new_per_league_seeded(&leagues, 7500, &consumed);

        assert_eq!(rl.reserved("Premier League"), 250);
        assert_eq!(rl.reserved("La Liga"), 250);
        assert_eq!(rl.remaining("football"), 500);
    }

    #[test]
    fn test_seeded_constructor_empty_map_matches_unseeded() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        let rl = RateLimiter::new_per_league_seeded(&leagues, 7500, &HashMap::new());
        assert_eq!(rl.reserved("Premier League"), 3750);
        assert_eq!(rl.remaining("football"), 7500);
    }

    #[test]
    fn test_seeded_constructor_consumed_exceeds_quota() {
        // More consumed than the quota (e.g. another consumer on the same
        // key) must saturate to zero, not underflow.
        let leagues = vec![make_league("Premier League", "football", None)];
        let mut consumed = HashMap::new();
        consumed.insert("football".to_string(), 9000u32);
        let rl = RateLimiter::new_per_league_seeded(&leagues, 7500, &consumed);

        assert_eq!(rl.reserved("Premier League"), 0);
        assert_eq!(rl.remaining("football"), 0);
        assert!(!rl.try_consume("Premier League"));
    }

    #[test]
    fn test_seeded_constructor_offseason_donates_effective_share() {
        // Off-season donation is computed from the effective (post-consumed)
        // total: 1000 - 500 consumed = 500, split 2 ways → in-season league
        // reserves 250, off-season league donates 250 to the shared pool.
        use chrono::Datelike;
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("Off", "football", Some(vec![current_month])),
        ];
        let mut consumed = HashMap::new();
        consumed.insert("football".to_string(), 500u32);
        let rl = RateLimiter::new_per_league_seeded(&leagues, 1000, &consumed);

        assert_eq!(rl.reserved("Premier League"), 250);
        assert_eq!(rl.reserved("Off"), 0);
        assert_eq!(rl.shared_remaining("football"), 250);
    }

    #[test]
    fn test_seeded_constructor_only_affects_named_host() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("NBA", "basketball", None),
        ];
        let mut consumed = HashMap::new();
        consumed.insert("football".to_string(), 1000u32);
        let rl = RateLimiter::new_per_league_seeded(&leagues, 2000, &consumed);

        assert_eq!(rl.reserved("Premier League"), 1000); // 2000 - 1000
        assert_eq!(rl.reserved("NBA"), 2000); // untouched
    }

    // ── Consumption tracking + flush buffer ──────────────────────────────

    #[test]
    fn test_take_consumed_counts_and_drains() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("NBA", "basketball", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);

        for _ in 0..5 {
            assert!(rl.try_consume("Premier League"));
        }
        assert!(rl.try_consume("NBA"));

        let deltas = rl.take_consumed();
        assert_eq!(deltas.get("football"), Some(&5));
        assert_eq!(deltas.get("basketball"), Some(&1));

        // Draining resets the buffer; a second take with no new consumption
        // returns nothing (so the flush task writes no empty rows).
        assert!(rl.take_consumed().is_empty());
    }

    #[test]
    fn test_take_consumed_counts_shared_pool_consumption() {
        // Reserved exhausted → consumption from the shared pool must still
        // count toward the host's persisted total.
        use chrono::Datelike;
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("Off", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 100);
        // 50 reserved + 50 shared; consume 60 → 10 from the shared pool
        for _ in 0..60 {
            assert!(rl.try_consume("Premier League"));
        }
        assert_eq!(rl.take_consumed().get("football"), Some(&60));
    }

    #[test]
    fn test_note_consumed_adds_back_after_failed_flush() {
        let leagues = vec![make_league("Premier League", "football", None)];
        let rl = RateLimiter::new_per_league(&leagues, 1000);

        for _ in 0..3 {
            assert!(rl.try_consume("Premier League"));
        }
        let deltas = rl.take_consumed();
        assert_eq!(deltas.get("football"), Some(&3));

        // Simulate a failed Postgres flush: hand the deltas back, consume
        // once more, and the next take must report the combined count.
        rl.note_consumed("football", 3);
        assert!(rl.try_consume("Premier League"));
        assert_eq!(rl.take_consumed().get("football"), Some(&4));

        // Unknown hosts are ignored, not panicked on.
        rl.note_consumed("cricket", 7);
        assert!(rl.take_consumed().is_empty());
    }

    #[test]
    fn test_failed_try_consume_does_not_count() {
        let leagues = vec![make_league("Premier League", "football", None)];
        let rl = RateLimiter::new_per_league(&leagues, 2);
        assert!(rl.try_consume("Premier League"));
        assert!(rl.try_consume("Premier League"));
        assert!(!rl.try_consume("Premier League")); // exhausted, no request made
        assert_eq!(rl.take_consumed().get("football"), Some(&2));
    }

    // ── Header clamping ──────────────────────────────────────────────────

    #[test]
    fn test_header_clamp_shrinks_proportionally() {
        // Local budgets believe 1000 remain (500 + 500) but the upstream
        // header says only 500 actually do → halve every bucket.
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        rl.update("football", 500);

        assert_eq!(rl.reserved("Premier League"), 250);
        assert_eq!(rl.reserved("La Liga"), 250);
        assert_eq!(rl.remaining("football"), 500); // legacy bucket still stored
    }

    #[test]
    fn test_header_clamp_scales_shared_pool() {
        use chrono::Datelike;
        let current_month = chrono::Utc::now().month() as i32;
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("Off", "football", Some(vec![current_month])),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        // 500 reserved + 500 shared, header says 250 → quarter both
        rl.update("football", 250);
        assert_eq!(rl.reserved("Premier League"), 125);
        assert_eq!(rl.shared_remaining("football"), 125);
    }

    #[test]
    fn test_header_clamp_never_grows_budgets() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("La Liga", "football", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        for _ in 0..100 {
            assert!(rl.try_consume("Premier League"));
        }
        // Header reports more than the local sum (e.g. another pod hasn't
        // consumed yet) — fair-share allocation must stay intact.
        rl.update("football", 7500);
        assert_eq!(rl.reserved("Premier League"), 400);
        assert_eq!(rl.reserved("La Liga"), 500);
    }

    #[test]
    fn test_header_clamp_to_zero_blocks_consumption() {
        let leagues = vec![make_league("Premier League", "football", None)];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        rl.update("football", 0);
        assert_eq!(rl.reserved("Premier League"), 0);
        assert!(!rl.try_consume("Premier League"));
    }

    #[test]
    fn test_header_clamp_only_affects_named_host() {
        let leagues = vec![
            make_league("Premier League", "football", None),
            make_league("NBA", "basketball", None),
        ];
        let rl = RateLimiter::new_per_league(&leagues, 1000);
        rl.update("football", 100);
        assert_eq!(rl.reserved("Premier League"), 100);
        assert_eq!(rl.reserved("NBA"), 1000);
    }

    #[test]
    fn test_header_clamp_noop_for_legacy_constructor() {
        // The legacy constructor has no per-league buckets; update must
        // keep storing the header value without panicking.
        let sports = vec!["basketball".to_string()];
        let rl = RateLimiter::new(&sports, 1000);
        rl.update("basketball", 50);
        assert_eq!(rl.remaining("basketball"), 50);
    }
}
