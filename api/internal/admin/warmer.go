package admin

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// Scheduled cache warmer (SCROLLR-335). Read-triggered refresh cannot help a
// visit that comes hours after the last one, so a leader-elected loop keeps the
// expensive reports warm: the Logto account walk, stats and week-1 report every
// 4 minutes (their TTL is 5), and the website report for each warm period every
// 10 (TTL 15; PostHog's HogQL rate limit is documented as low as 120/hour and
// one cycle is ~21 queries). generated_at on every entry stays the real read time.
//
// Only one replica runs a job per period: each job takes a Redis lease that
// outlives most of the period, so both replicas ticking in step yield one run.
// ADMIN_WARMER=off stops it without a deploy.

const (
	warmerLogtoEvery   = 4 * time.Minute
	warmerWebsiteEvery = 10 * time.Minute
	warmerLockPrefix   = "scrollr:admin:warmer:"
)

type warmJob struct {
	name  string
	every time.Duration
	run   func(ctx context.Context) error
}

func warmerEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ADMIN_WARMER"))) {
	case "off", "0", "false", "disabled":
		return false
	}
	return true
}

// StartCacheWarmer runs the jobs until ctx is cancelled. No-op when the kill
// switch is set or Redis is absent (no lock, no shared cache to warm).
func StartCacheWarmer(ctx context.Context) {
	if !warmerEnabled() || platform.Rdb == nil {
		return
	}
	for _, j := range defaultWarmJobs() {
		go runWarmJob(ctx, j)
	}
}

func defaultWarmJobs() []warmJob {
	return []warmJob{
		{"logto", warmerLogtoEvery, refreshLogtoNow},
		{"signup", warmerLogtoEvery, refreshSignupNow},
		{"website", warmerWebsiteEvery, refreshWebsiteNow},
	}
}

func runWarmJob(ctx context.Context, j warmJob) {
	t := time.NewTicker(j.every)
	defer t.Stop()
	for {
		warmOnce(ctx, j)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// warmOnce takes the job's lease and runs it if this replica won.
func warmOnce(ctx context.Context, j warmJob) {
	if !warmerEnabled() {
		return
	}
	// The lease is deliberately never released: it is what spaces the runs.
	ok, err := platform.Rdb.SetNX(ctx, warmerLockPrefix+j.name, 1, j.every*9/10).Result()
	if err != nil || !ok {
		return
	}
	if err := j.run(ctx); err != nil {
		log.Printf("[Admin] cache warmer %s: %v", j.name, err)
	}
}

// refreshLogtoNow re-reads the account walk first (the week-1 report reads it
// back from cache), then the dashboard stats and the week-1 report.
func refreshLogtoNow(ctx context.Context) error {
	var first error
	keep := func(err error) {
		if err != nil && first == nil {
			first = err
		}
	}
	_, err := fetchAndStoreLogtoAccounts()
	keep(err)
	_, err = fetchAndStoreLogtoStats()
	keep(err)
	if err == nil && first == nil {
		_, err = loadWeek1Return(ctx, week1ReturnNow())
		keep(err)
	}
	return first
}

// refreshWebsiteNow refreshes each warm period one after another; each report
// already runs its own queries concurrently within PostHog's cap.
func refreshWebsiteNow(ctx context.Context) error {
	var first error
	for _, k := range websiteWarmKeys {
		now := websiteNow().UTC()
		period, err := ParsePeriod(string(k), now)
		if err != nil {
			continue
		}
		if out := fetchAndStoreWebsite(period, now); !out.Available && first == nil {
			first = &warmErr{string(k), out.Note}
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return first
}

type warmErr struct{ key, note string }

func (e *warmErr) Error() string { return "website " + e.key + ": " + e.note }

// Warm the four small aggregate responses separately from account/cohort scans.
// Serial scans keep the existing per-scan Logto concurrency ceiling.
func refreshSignupNow(ctx context.Context) error {
	var first error
	for _, app := range []string{"desktop", "website"} {
		for _, days := range []int{7, 30} {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case result := <-refreshSignupAnalytics(app, days, true):
				if result.Err != nil && first == nil {
					first = result.Err
				}
			}
		}
	}
	return first
}
