package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/singleflight"
)

const signupAnalyticsCacheTTL = 5 * time.Minute

var (
	fetchSignupAnalytics   = accounts.FetchSignupAnalytics
	signupAnalyticsGroup   singleflight.Group
	signupAnalyticsTimeout = 25 * time.Second
)

type cachedAnalyticsResult struct {
	Report accounts.SignupAnalytics
	Hit    bool
}

func HandleGetAnalytics(c *fiber.Ctx) error {
	application := c.Query("application", "website")
	if application != "website" && application != "desktop" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "application must be website or desktop"})
	}
	days, err := strconv.Atoi(c.Query("days", "7"))
	if err != nil || (days != 7 && days != 30) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "days must be 7 or 30"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), signupAnalyticsTimeout)
	defer cancel()
	report, hit, err := cachedSignupAnalytics(ctx, application, days)
	if err != nil {
		log.Print("[Admin] signup analytics unavailable")
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
		return report, true, nil
	}
	if err := ctx.Err(); err != nil {
		return accounts.SignupAnalytics{}, false, err
	}

	result := signupAnalyticsGroup.DoChan(key, func() (any, error) {
		scanCtx, cancel := context.WithTimeout(context.Background(), signupAnalyticsTimeout)
		defer cancel()
		if report, ok := readSignupAnalyticsCache(scanCtx, key); ok {
			return cachedAnalyticsResult{Report: report, Hit: true}, nil
		}
		report, err := fetchSignupAnalytics(scanCtx, application, days, time.Now())
		if err != nil {
			return cachedAnalyticsResult{}, err
		}
		if platform.Rdb != nil {
			if raw, err := json.Marshal(report); err == nil {
				_ = platform.Rdb.Set(scanCtx, key, raw, signupAnalyticsCacheTTL).Err()
			}
		}
		return cachedAnalyticsResult{Report: report}, nil
	})
	select {
	case <-ctx.Done():
		return accounts.SignupAnalytics{}, false, ctx.Err()
	case response := <-result:
		if response.Err != nil {
			return accounts.SignupAnalytics{}, false, response.Err
		}
		value := response.Val.(cachedAnalyticsResult)
		return value.Report, value.Hit, nil
	}
}

func readSignupAnalyticsCache(ctx context.Context, key string) (accounts.SignupAnalytics, bool) {
	if platform.Rdb == nil {
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

const week1ReturnCohortCount = 4

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
	GeneratedAt string              `json:"generated_at"`
	Definition  string              `json:"definition"`
	Cohorts     []Week1ReturnCohort `json:"cohorts"`
}

const week1ReturnDefinition = "Signup = a Logto account with applicationId = Scrollr Desktop, excluding admin_users subs and POSTHOG_EXCLUDED_LOGTO_SUBS. Return = a desktop token exchange (ExchangeTokenBy.RefreshToken or ExchangeTokenBy.AuthorizationCode) that starts a session — at least 3 hours since that account's previous exchange — on UTC day 1 through 7 after the signup day. Reported per Monday-Sunday UTC weekly cohort; a cohort is shown once its day 7 has passed for every member, never before."

// HandleGetWeek1Return - GET /admin/week1-return
func HandleGetWeek1Return(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), signupAnalyticsTimeout)
	defer cancel()
	report, err := loadWeek1Return(ctx, week1ReturnNow())
	if err != nil {
		log.Print("[Admin] week-1 return unavailable")
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Error: "Week-1 return is unavailable."})
	}
	return c.JSON(report)
}

func loadWeek1Return(ctx context.Context, now time.Time) (Week1ReturnReport, error) {
	report := Week1ReturnReport{
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

	weeks := recentCompleteWeeks(now, week1ReturnCohortCount)
	cohorts := make([]Week1ReturnCohort, len(weeks))
	for i, week := range weeks {
		var inWeek []accounts.LogtoAccount
		for _, a := range snap.Accounts {
			if a.ApplicationID != desktopAppID {
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
	if cohort, ok := readWeek1CohortCache(ctx, key); ok {
		return cohort, nil
	}
	result, err, _ := week1ReturnGroup.Do(key, func() (any, error) {
		if cohort, ok := readWeek1CohortCache(ctx, key); ok {
			return cohort, nil
		}
		returned := 0
		for _, a := range signups {
			signupDay := a.CreatedTime().Truncate(24 * time.Hour)
			ok, err := userReturnedWeek1(ctx, a.ID, signupDay)
			if err != nil {
				return nil, fmt.Errorf("check return for %s: %w", a.ID, err)
			}
			if ok {
				returned++
			}
		}
		cohort := Week1ReturnCohort{
			WeekStart: week.Start.Format("2006-01-02"),
			WeekEnd:   week.End.Format("2006-01-02"),
			Mature:    true,
			Signups:   len(signups),
			Returned:  returned,
		}
		if len(signups) > 0 {
			rate := float64(returned) / float64(len(signups)) * 100
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
