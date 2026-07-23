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
            host_remaining,
            league_reserved: HashMap::new(),
            league_to_host: HashMap::new(),
            host_shared: HashMap::new(),
            offseason_leagues: RwLock::new(HashSet::new()),
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
                league_reserved.insert(l.name.clone(), AtomicU32::new(reserved));
                league_to_host.insert(l.name.clone(), host.clone());
            }
            host_shared.insert(host.clone(), AtomicU32::new(donated));
            host_remaining.insert(host.clone(), AtomicU32::new(daily_total));
        }

        Self {
            host_remaining,
            league_reserved,
            league_to_host,
            host_shared,
            offseason_leagues: RwLock::new(offseason),
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
        rl.reset_daily(&leagues, 100);
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
        rl.reset_daily(&leagues, 1000);
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
}
