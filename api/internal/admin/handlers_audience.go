package admin

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/singleflight"
)

// Registered users (SCROLLR-210).
//
// Logto is the system of record for accounts; user_preferences is how many
// ever set the app up and is kept as a secondary figure. Staff and test
// accounts come out of every count while the exclusion setting is on.

const (
	logtoAccountsCacheKey = "scrollr:admin:logto_accounts"
	logtoAccountsCacheTTL = 5 * time.Minute
)

var (
	listAllLogtoAccounts = accounts.ListAllLogtoAccounts
	logtoAccountsGroup   singleflight.Group
	audienceNow          = time.Now
)

type logtoAccountsSnapshot struct {
	Accounts  []accounts.LogtoAccount `json:"accounts"`
	Total     int                     `json:"total"`
	Partial   bool                    `json:"partial"`
	FetchedAt time.Time               `json:"fetched_at"`
}

type AudienceResponse struct {
	GeneratedAt   string  `json:"generated_at"`
	Period        Window  `json:"period"`
	Previous      *Window `json:"previous"`
	StaffExcluded bool    `json:"staff_excluded"`
	Available     bool    `json:"available"`
	Note          string  `json:"note,omitempty"`
	Source        string  `json:"source"`

	// Total is current registered accounts (minus excluded staff/test
	// accounts when the setting is on). Excluded says how many came out.
	Total    int `json:"total"`
	Excluded int `json:"excluded"`
	// SetUp is accounts with a saved preference row: how many got far
	// enough into the app to configure anything.
	SetUp int `json:"set_up"`

	New       Metric   `json:"new"`
	NewCurve  []Bucket `json:"new_curve"`
	CurveStep string   `json:"curve_step"`
	// SignedInInPeriod is accounts whose last sign-in falls in the window:
	// authentication activity, which is not app usage.
	SignedInInPeriod Metric `json:"signed_in_in_period"`

	// Lifetime registrations are only the accounts that still exist. Purged
	// accounts are known locally since deletion tracking began; anything
	// deleted before that is unknown.
	LifetimeRegistrations int      `json:"lifetime_registrations"`
	KnownPurged           int      `json:"known_purged"`
	Coverage              Coverage `json:"coverage"`
	Definition            string   `json:"definition"`
}

// HandleGetAudience - GET /admin/audience?period=
func HandleGetAudience(c *fiber.Ctx) error {
	now := audienceNow().UTC()
	period, err := ParsePeriod(c.Query("period"), now)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: err.Error()})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	return c.JSON(loadAudience(ctx, period, ExcludeStaff(ctx), now))
}

func loadAudience(ctx context.Context, period Period, excludeStaff bool, now time.Time) AudienceResponse {
	out := AudienceResponse{
		GeneratedAt: now.Format(time.RFC3339), Period: period.Window(), StaffExcluded: excludeStaff, Source: "logto",
		NewCurve:   []Bucket{},
		Definition: "Total is every registered account in Logto right now. New is accounts created in the selected window. Signed in is accounts whose most recent sign-in falls in the window; it is authentication, not app use.",
	}
	if prev, ok := period.Previous(); ok {
		w := prev.Window()
		out.Previous = &w
	}
	excluded := excludedSubs(ctx, excludeStaff)
	if platform.DBPool != nil {
		// Set-up accounts are counted under the same exclusion as the total,
		// or "never set up" (total − set up) would subtract staff who use
		// the app from a total that no longer contains them.
		rows, err := platform.DBPool.Query(ctx, `SELECT logto_sub FROM user_preferences`)
		if err != nil {
			log.Printf("[Admin] audience set-up count: %v", err)
		} else {
			for rows.Next() {
				var sub string
				if rows.Scan(&sub) != nil {
					continue
				}
				if _, skip := excluded[sub]; skip || isTestActor(sub) {
					continue
				}
				out.SetUp++
			}
			rows.Close()
		}
		if err := platform.DBPool.QueryRow(ctx, `SELECT count(*) FROM user_deletion_requests WHERE status = 'purged'`).Scan(&out.KnownPurged); err != nil {
			log.Printf("[Admin] audience purged count: %v", err)
		}
	}
	snap, err := cachedLogtoAccounts(ctx)
	if err != nil {
		log.Printf("[Admin] audience logto: %v", err)
		out.Note = "Logto is unreachable, so registered-account figures are not available right now."
		out.New = Metric{Note: out.Note}
		out.SignedInInPeriod = Metric{Note: out.Note}
		return out
	}

	// Test accounts come out regardless of the setting; staff only while it
	// is on.
	var counted []accounts.LogtoAccount
	for _, a := range snap.Accounts {
		if _, skip := excluded[a.ID]; skip || isTestActor(a.ID) {
			out.Excluded++
			continue
		}
		counted = append(counted, a)
	}
	out.Total = snap.Total - out.Excluded
	out.LifetimeRegistrations = out.Total
	out.Available = true

	// Logto keeps only accounts that still exist, so its earliest createdAt
	// is where retained history begins.
	var earliest time.Time
	for _, a := range counted {
		if t := a.CreatedTime(); earliest.IsZero() || t.Before(earliest) {
			earliest = t
		}
	}
	out.Coverage = CoverageFor(period, earliest, "Only accounts that still exist are counted; deleted accounts are not in Logto. Purged accounts are known locally since deletion tracking began.")
	if snap.Partial {
		out.Coverage.Partial = true
		out.Coverage.Note += " The account walk stopped early, so window counts cover the first 5,000 accounts only."
	}

	countIn := func(w Period, at func(accounts.LogtoAccount) time.Time) float64 {
		n := 0
		for _, a := range counted {
			t := at(a)
			if t.IsZero() {
				continue
			}
			if w.Lifetime() {
				if t.Before(w.End) {
					n++
				}
				continue
			}
			if !t.Before(w.Start) && t.Before(w.End) {
				n++
			}
		}
		return float64(n)
	}
	created := func(a accounts.LogtoAccount) time.Time { return a.CreatedTime() }
	signedIn := func(a accounts.LogtoAccount) time.Time {
		if a.LastSignInAt <= 0 {
			return time.Time{}
		}
		return time.UnixMilli(a.LastSignInAt).UTC()
	}
	newNow := countIn(period, created)
	signedNow := countIn(period, signedIn)
	var newPrev float64
	if prev, ok := period.Previous(); ok {
		newPrev = countIn(prev, created)
	}
	// createdAt never changes, so the previous window's new-account count is
	// exact history as far as retained accounts go; coverage is not a limit.
	out.New = Metric{Value: newNow, Available: true, Comparison: Compare(newNow, newPrev, period, time.Time{})}
	// lastSignInAt is overwritten by every sign-in: an account that signed
	// in last week and again yesterday has left the previous window, so a
	// "previous" count taken today is always too low and a delta against it
	// would only ever point up. Snapshot, no comparison.
	out.SignedInInPeriod = Metric{Value: signedNow, Available: true,
		Note:       "Last sign-in only: an account that signed in twice in the window is one, and one that signed in last month and again yesterday counts here, not there.",
		Comparison: Comparison{Note: "Last sign-in is the account's current state; the previous window's count cannot be reconstructed, so there is no comparison."}}

	start := EffectiveStart(period, earliest)
	step := BucketStep(period, earliest)
	out.CurveStep = step.String()
	if !start.IsZero() {
		out.NewCurve = Buckets(start, period.End, step)
		for _, a := range counted {
			if i := BucketIndex(a.CreatedTime(), start, period.End, step); i >= 0 {
				out.NewCurve[i].Value++
			}
		}
	}
	return out
}

// excludedSubs is the set of account ids the exclusion setting removes:
// pinned admin subs and the configured test list. Unpinned admin rows (an
// email that has never signed in) cannot be matched to a Logto id here and
// are not excluded; they have no account activity to exclude.
func excludedSubs(ctx context.Context, excludeStaff bool) map[string]struct{} {
	out := map[string]struct{}{}
	if !excludeStaff || platform.DBPool == nil {
		return out
	}
	rows, err := platform.DBPool.Query(ctx, `SELECT logto_sub FROM admin_users WHERE logto_sub IS NOT NULL`)
	if err != nil {
		log.Printf("[Admin] excluded subs: %v", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var sub string
		if rows.Scan(&sub) == nil {
			out[sub] = struct{}{}
		}
	}
	return out
}

// cachedLogtoAccounts reads the account walk through Redis (5 minutes) and
// coalesces concurrent cold reads, so opening the Overview and the Growth tab
// together costs one walk, not two.
func cachedLogtoAccounts(ctx context.Context) (logtoAccountsSnapshot, error) {
	if platform.Rdb != nil {
		if raw, err := platform.Rdb.Get(ctx, logtoAccountsCacheKey).Bytes(); err == nil {
			var snap logtoAccountsSnapshot
			if json.Unmarshal(raw, &snap) == nil {
				return snap, nil
			}
		}
	}
	result := logtoAccountsGroup.DoChan(logtoAccountsCacheKey, func() (any, error) {
		list, total, partial, err := listAllLogtoAccounts()
		if err != nil {
			return nil, err
		}
		snap := logtoAccountsSnapshot{Accounts: list, Total: total, Partial: partial, FetchedAt: time.Now().UTC()}
		if snap.Accounts == nil {
			snap.Accounts = []accounts.LogtoAccount{}
		}
		if platform.Rdb != nil {
			if raw, err := json.Marshal(snap); err == nil {
				_ = platform.Rdb.Set(context.Background(), logtoAccountsCacheKey, raw, logtoAccountsCacheTTL).Err()
			}
		}
		return snap, nil
	})
	select {
	case <-ctx.Done():
		return logtoAccountsSnapshot{}, ctx.Err()
	case r := <-result:
		if r.Err != nil {
			return logtoAccountsSnapshot{}, r.Err
		}
		return r.Val.(logtoAccountsSnapshot), nil
	}
}

// isTestActor is exported through accounts so both exclusion lists agree.
func isTestActor(sub string) bool { return accounts.IsExcludedActor(sub) }
