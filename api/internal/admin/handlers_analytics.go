package admin

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/singleflight"
)

const (
	signupAnalyticsCacheTTL = 5 * time.Minute
	// A timed-out scan is remembered briefly so a reload does not pay the
	// whole budget again, and short enough that recovery shows quickly.
	signupAnalyticsUnavailableTTL = 30 * time.Second
	signupAnalyticsRetainedTTL    = 24 * time.Hour
)

var (
	fetchSignupAnalytics   = accounts.FetchSignupAnalytics
	signupAnalyticsGroup   singleflight.Group
	signupAnalyticsTimeout = 25 * time.Second
	signupInteractiveWait  = 750 * time.Millisecond
	signupLocalCache       sync.Map
)

type signupLocalSnapshot struct {
	report  accounts.SignupAnalytics
	expires time.Time
}

type cachedAnalyticsResult struct {
	Report accounts.SignupAnalytics
	Hit    bool
}

func HandleGetAnalytics(c *fiber.Ctx) error {
	// The scan may outlive this request; Fiber query strings alias its buffer.
	application := strings.Clone(c.Query("application", "website"))
	if application != "website" && application != "desktop" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "application must be website or desktop"})
	}
	days, err := strconv.Atoi(c.Query("days", "7"))
	if err != nil || (days != 7 && days != 30) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "days must be 7 or 30"})
	}

	// UserContext, not c.Context(): the latter is cancelled under app.Test.
	ctx, cancel := context.WithTimeout(c.UserContext(), signupInteractiveWait)
	defer cancel()
	report, hit, err := cachedSignupAnalytics(ctx, application, days)
	if err != nil {
		log.Printf("[Admin] signup analytics unavailable: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Error: "Signup analytics are unavailable."})
	}
	if hit {
		c.Set("X-Cache", "HIT")
	} else {
		c.Set("X-Cache", "MISS")
	}
	return c.JSON(report)
}

func cachedSignupAnalytics(ctx context.Context, application string, days int) (accounts.SignupAnalytics, bool, error) {
	key := "scrollr:admin:signup_analytics:" + application + ":" + strconv.Itoa(days)
	if report, ok := readSignupAnalyticsCache(ctx, key); ok {
		if !report.Available {
			if retained, found := readSignupAnalyticsCache(ctx, key+":retained"); found && retained.Available {
				retained.Stale = true
				return retained, true, nil
			}
		}
		return report, true, nil
	}
	if err := ctx.Err(); err != nil {
		return accounts.SignupAnalytics{}, false, err
	}

	if report, ok := readSignupAnalyticsCache(ctx, key+":retained"); ok && report.Available {
		refreshSignupAnalytics(application, days, false)
		report.Stale, report.Refreshing = true, true
		return report, true, nil
	}
	result := refreshSignupAnalytics(application, days, false)

	select {
	case <-ctx.Done():
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			report := signupUnavailable(application, days)
			if signupInteractiveWait < signupAnalyticsTimeout {
				report.Reason = "Preparing signup diagnostics in the background. This view updates automatically."
				report.Refreshing = true
			}
			return report, false, nil
		}
		return accounts.SignupAnalytics{}, false, ctx.Err()
	case response := <-result:
		if response.Err != nil {
			return accounts.SignupAnalytics{}, false, response.Err
		}
		value := response.Val.(cachedAnalyticsResult)
		return value.Report, value.Hit, nil
	}
}

func refreshSignupAnalytics(application string, days int, force bool) <-chan singleflight.Result {
	key := "scrollr:admin:signup_analytics:" + application + ":" + strconv.Itoa(days)
	return signupAnalyticsGroup.DoChan(key, func() (any, error) {
		scanCtx, cancel := context.WithTimeout(context.Background(), signupAnalyticsTimeout)
		defer cancel()
		if report, ok := readSignupAnalyticsCache(scanCtx, key); ok && !force {
			return cachedAnalyticsResult{Report: report, Hit: true}, nil
		}
		report, err := fetchSignupAnalytics(scanCtx, application, days, time.Now())
		ttl := signupAnalyticsCacheTTL
		if errors.Is(err, context.DeadlineExceeded) {
			report, err, ttl = signupUnavailable(application, days), nil, signupAnalyticsUnavailableTTL
		}
		if err != nil {
			storeSignupAnalyticsCache(key, signupUnavailable(application, days), signupAnalyticsUnavailableTTL)
			return cachedAnalyticsResult{}, err
		}
		storeSignupAnalyticsCache(key, report, ttl)
		if report.Available {
			storeSignupAnalyticsCache(key+":retained", report, signupAnalyticsRetainedTTL)
		}
		return cachedAnalyticsResult{Report: report}, nil
	})
}

// signupUnavailable is the honest answer to a scan that ran out of budget.
func signupUnavailable(application string, days int) accounts.SignupAnalytics {
	return accounts.SignupAnalytics{
		Available:   false,
		Reason:      "Logto did not answer in time. Try again in a minute.",
		Application: application,
		WindowDays:  days,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

// Without Redis, retain the eight possible app/window snapshots locally so a
// completed background read is still available to the next poll.
func storeSignupAnalyticsCache(key string, report accounts.SignupAnalytics, ttl time.Duration) {
	if platform.Rdb == nil {
		signupLocalCache.Store(key, signupLocalSnapshot{report, time.Now().Add(ttl)})
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if raw, err := json.Marshal(report); err == nil {
		_ = platform.Rdb.Set(ctx, key, raw, ttl).Err()
	}
}

func readSignupAnalyticsCache(ctx context.Context, key string) (accounts.SignupAnalytics, bool) {
	if platform.Rdb == nil {
		if value, ok := signupLocalCache.Load(key); ok {
			snapshot := value.(signupLocalSnapshot)
			if time.Now().Before(snapshot.expires) {
				return snapshot.report, true
			}
			signupLocalCache.Delete(key)
		}
		return accounts.SignupAnalytics{}, false
	}
	raw, err := platform.Rdb.Get(ctx, key).Bytes()
	if err != nil {
		return accounts.SignupAnalytics{}, false
	}
	var report accounts.SignupAnalytics
	if json.Unmarshal(raw, &report) != nil {
		return accounts.SignupAnalytics{}, false
	}
	return report, true
}

// =============================================================================
// Week-1 return of new desktop signups — the News + first run exit metric
// (SCROLLR-247).
//
// Signup = a Logto account with applicationId = Scrollr Desktop, minus staff
// (admin_users) and POSTHOG_EXCLUDED_LOGTO_SUBS, exactly like every other
// registered-user figure on this dashboard — never gated behind the display
// "exclude staff" setting, since the exit metric has to mean the same thing
// every time it's read. Return = accounts.UserReturnedWeek1, one Logto audit
// scan per cohort member.
//
// Cohorts are fixed Monday-Sunday UTC calendar weeks so a cohort's identity
// (its cache key) never shifts under it. A cohort is mature once day 7 has
// passed for its last possible member (the week's Sunday), i.e. once today
// is on or after weekEnd+8. A matured cohort's numbers never change again,
// so they are cached in Redis with no expiry; an immature cohort is never
// cached and never queries Logto for returns — only its (already known)
// signup count is shown.
// =============================================================================

const (
	week1ReturnCohortCount = 4
	week1ReturnConcurrency = 8
)

var (
	userReturnedWeek1 = accounts.UserReturnedWeek1
	week1ReturnGroup  singleflight.Group
	week1ReturnNow    = time.Now
)

// Week1ReturnCohort is one weekly cohort's row on the Analytics page.
type Week1ReturnCohort struct {
	WeekStart string   `json:"week_start"` // UTC date, Monday
	WeekEnd   string   `json:"week_end"`   // UTC date, Sunday
	Mature    bool     `json:"mature"`
	Signups   int      `json:"signups"`
	Returned  int      `json:"returned,omitempty"`
	RatePct   *float64 `json:"rate_pct,omitempty"`
}

type Week1ReturnReport struct {
	Population  platform.AnalyticsPopulation `json:"population"`
	GeneratedAt string                       `json:"generated_at"`
	Definition  string                       `json:"definition"`
	Cohorts     []Week1ReturnCohort          `json:"cohorts"`
}

const week1ReturnDefinition = "Signup = a Logto account with applicationId = Scrollr Desktop, excluding admin_users subs and POSTHOG_EXCLUDED_LOGTO_SUBS. Return = a desktop token exchange (ExchangeTokenBy.RefreshToken or ExchangeTokenBy.AuthorizationCode) that starts a session — at least 3 hours since that account's previous exchange — on UTC day 1 through 7 after the signup day. Reported per Monday-Sunday UTC weekly cohort; a cohort is shown once its day 7 has passed for every member, never before."

// HandleGetWeek1Return - GET /admin/week1-return
func HandleGetWeek1Return(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), signupAnalyticsTimeout)
	defer cancel()
	ctx, err := platform.WithAnalyticsPopulation(ctx, c.Query("os"), c.Query("version"), c.Query("plan"))
	if err != nil {
		return c.Status(400).JSON(platform.ErrorResponse{Error: err.Error()})
	}
	report, err := loadWeek1Return(ctx, week1ReturnNow())
	if err != nil {
		log.Printf("[Admin] week-1 return unavailable: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Error: "Week-1 return is unavailable."})
	}
	return c.JSON(report)
}

func loadWeek1Return(ctx context.Context, now time.Time) (Week1ReturnReport, error) {
	population := platform.PopulationFromContext(ctx)
	report := Week1ReturnReport{
		Population:  population,
		GeneratedAt: now.UTC().Format(time.RFC3339),
		Definition:  week1ReturnDefinition,
	}
	_, desktopAppID := accounts.SignupApplicationIDs()
	if desktopAppID == "" {
		return report, fmt.Errorf("desktop analytics application is not configured")
	}
	snap, err := cachedLogtoAccounts(ctx)
	if err != nil {
		return report, err
	}
	excluded := excludedSubs(ctx, true)
	var matches map[string]bool
	if population.Active() {
		ids := make([]string, 0, len(snap.Accounts))
		for _, a := range snap.Accounts {
			ids = append(ids, a.ID)
		}
		matches, err = population.MatchAccounts(ctx, ids)
		if err != nil {
			return report, err
		}
		report.Definition += " " + platform.AnalyticsPopulationNote
	}

	weeks := recentCompleteWeeks(now, week1ReturnCohortCount)
	cohorts := make([]Week1ReturnCohort, len(weeks))
	for i, week := range weeks {
		var inWeek []accounts.LogtoAccount
		for _, a := range snap.Accounts {
			if a.ApplicationID != desktopAppID || (population.Active() && !matches[a.ID]) {
				continue
			}
			if _, skip := excluded[a.ID]; skip || isTestActor(a.ID) {
				continue
			}
			t := a.CreatedTime()
			if t.Before(week.Start) || !t.Before(week.End.AddDate(0, 0, 1)) {
				continue
			}
			inWeek = append(inWeek, a)
		}
		mature := !now.UTC().Truncate(24 * time.Hour).Before(week.End.AddDate(0, 0, 8))
		if !mature {
			cohorts[i] = Week1ReturnCohort{
				WeekStart: week.Start.Format("2006-01-02"),
				WeekEnd:   week.End.Format("2006-01-02"),
				Mature:    false,
				Signups:   len(inWeek),
			}
			continue
		}
		cohort, err := matureWeek1Cohort(ctx, week, inWeek)
		if err != nil {
			return report, err
		}
		cohorts[i] = cohort
	}
	report.Cohorts = cohorts
	return report, nil
}

// cohortWeek is one Monday-Sunday UTC week, both bounds at 00:00 UTC (End is
// the start of the week's last day, not the exclusive upper bound).
type cohortWeek struct {
	Start time.Time
	End   time.Time
}

// recentCompleteWeeks returns the n most recently ENDED Monday-Sunday UTC
// weeks, oldest first. The week containing "now" is never included — it is
// still accumulating signups and cannot be a stable cohort.
func recentCompleteWeeks(now time.Time, n int) []cohortWeek {
	today := now.UTC().Truncate(24 * time.Hour)
	offset := (int(today.Weekday()) + 6) % 7 // days since the most recent Monday
	thisWeekStart := today.AddDate(0, 0, -offset)

	weeks := make([]cohortWeek, n)
	end := thisWeekStart
	for i := n - 1; i >= 0; i-- {
		start := end.AddDate(0, 0, -7)
		weeks[i] = cohortWeek{Start: start, End: start.AddDate(0, 0, 6)}
		end = start
	}
	return weeks
}

// matureWeek1Cohort computes (or reads the permanent cache for) one matured
// cohort's return count. singleflight collapses concurrent first-computations
// (e.g. two admins opening the page the moment a cohort matures) into one
// Logto scan.
func matureWeek1Cohort(ctx context.Context, week cohortWeek, signups []accounts.LogtoAccount) (Week1ReturnCohort, error) {
	key := week1ReturnCacheKey(week.Start)
	if platform.PopulationFromContext(ctx).Active() {
		ids := make([]string, 0, len(signups))
		for _, a := range signups {
			ids = append(ids, a.ID)
		}
		sort.Strings(ids)
		key += fmt.Sprintf(":population:%x", sha256.Sum256([]byte(strings.Join(ids, "\x00"))))
	}
	if cohort, ok := readWeek1CohortCache(ctx, key); ok {
		return cohort, nil
	}
	result, err, _ := week1ReturnGroup.Do(key, func() (any, error) {
		if cohort, ok := readWeek1CohortCache(ctx, key); ok {
			return cohort, nil
		}
		// One Logto audit scan per member is slow (~140 members across the
		// cohorts, several pages each), so scan in parallel and remember each
		// member's answer: a request that still times out keeps its progress
		// and the next one finishes the rest.
		var returned atomic.Int64
		g, gctx := errgroup.WithContext(ctx)
		g.SetLimit(week1ReturnConcurrency)
		for _, a := range signups {
			g.Go(func() error {
				ok, err := memberReturnedWeek1(gctx, a)
				if err != nil {
					return fmt.Errorf("check return for %s: %w", a.ID, err)
				}
				if ok {
					returned.Add(1)
				}
				return nil
			})
		}
		if err := g.Wait(); err != nil {
			return nil, err
		}
		cohort := Week1ReturnCohort{
			WeekStart: week.Start.Format("2006-01-02"),
			WeekEnd:   week.End.Format("2006-01-02"),
			Mature:    true,
			Signups:   len(signups),
			Returned:  int(returned.Load()),
		}
		if len(signups) > 0 {
			rate := float64(returned.Load()) / float64(len(signups)) * 100
			cohort.RatePct = &rate
		}
		if platform.Rdb != nil {
			if raw, err := json.Marshal(cohort); err == nil {
				// No TTL: a matured cohort's members and their day-7 window
				// are fixed forever, so the number never changes.
				_ = platform.Rdb.Set(ctx, key, raw, 0).Err()
			}
		}
		return cohort, nil
	})
	if err != nil {
		return Week1ReturnCohort{}, err
	}
	return result.(Week1ReturnCohort), nil
}

func week1ReturnCacheKey(weekStart time.Time) string {
	return "scrollr:admin:week1_return:cohort:v1:" + weekStart.Format("2006-01-02")
}

func readWeek1CohortCache(ctx context.Context, key string) (Week1ReturnCohort, bool) {
	if platform.Rdb == nil {
		return Week1ReturnCohort{}, false
	}
	raw, err := platform.Rdb.Get(ctx, key).Bytes()
	if err != nil {
		return Week1ReturnCohort{}, false
	}
	var cohort Week1ReturnCohort
	if json.Unmarshal(raw, &cohort) != nil {
		return Week1ReturnCohort{}, false
	}
	return cohort, true
}

// memberReturnedWeek1 answers for one account of a matured cohort, reading and
// writing a permanent per-account cache (a matured member's day-7 window is
// fixed forever, like the cohort's own cache).
func memberReturnedWeek1(ctx context.Context, a accounts.LogtoAccount) (bool, error) {
	key := "scrollr:admin:week1_return:member:v1:" + a.ID
	if platform.Rdb != nil {
		if v, err := platform.Rdb.Get(ctx, key).Result(); err == nil {
			return v == "1", nil
		}
	}
	ok, err := userReturnedWeek1(ctx, a.ID, a.CreatedTime().Truncate(24*time.Hour))
	if err != nil {
		return false, err
	}
	if platform.Rdb != nil {
		v := "0"
		if ok {
			v = "1"
		}
		// Not the group ctx: a sibling's failure cancels it, and a finished
		// answer must still be kept.
		_ = platform.Rdb.Set(context.WithoutCancel(ctx), key, v, 0).Err()
	}
	return ok, nil
}
