package platform

import (
	"context"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Request counters, and nothing else (REL-271).
//
// Every desktop install calls this API several times an hour and its user
// agent says which build and which OS it is. We used to throw that away on
// every request, which is why "is REL-253 still happening on 1.5.x?" had to
// be asked of users by email. This keeps the answer.
//
// ⚠️ THE LINE, and it is the reason this file is short: nothing about what a
// user WATCHES may leave their machine. No symbols, no teams, no feed URLs,
// no widget contents, no query strings, no user id, no IP. The only four
// dimensions below are app version, platform, route pattern and status class,
// and `usageKey` is deliberately the whole vocabulary — a field that does not
// exist cannot be filled in later by accident. TestUsageStoresNothingPersonal
// asserts it.
//
// Aggregate, never accumulate: requests fold into an in-memory map keyed by
// day and those four dimensions, and a timer upserts the counters. There is
// no per-request row written anywhere, so there is nothing to leak and
// nothing to purge beyond a yearly prune.

// usageKey is one counter's identity — and the complete list of everything
// this subsystem is allowed to know about a request.
type usageKey struct {
	Day         time.Time // UTC midnight
	AppVersion  string
	Platform    string
	Endpoint    string // registered route pattern, never the request path
	StatusClass string
}

var (
	usageMu     sync.Mutex
	usageCounts = make(map[usageKey]int64)
)

// usageMaxKeys caps the in-memory map. Route patterns and status classes are
// finite, but `app_version` comes off a header, and a caller sending a fresh
// well-formed version string on every request would otherwise grow this map
// (and the table) without limit. Past the cap we drop rather than grow: a
// slightly short count beats an unbounded one.
const usageMaxKeys = 20000

// usageRetention is how long daily aggregates are kept. A year is enough to
// answer "did anyone ever update off that build" and short enough that the
// table stays trivially small.
const usageRetention = 365 * 24 * time.Hour

// clientUARe is BOTH the parser and the cardinality guard, which is why it is
// this strict. It matches only the user agent the desktop app sends —
// `Scrollr/1.6.1 (windows)` — with a bounded version shape and a closed set
// of platforms. Anything else (a browser, curl, a probe, a hostile string)
// falls through to "unknown", so no caller can mint new dimension values.
var clientUARe = regexp.MustCompile(`^Scrollr/(\d{1,3}(?:\.\d{1,4}){0,3}(?:-[A-Za-z0-9.]{1,16})?) \((windows|macos|linux)\)`)

// ParseClientUA extracts the app version and platform from a Scrollr desktop
// user agent. Both are "unknown" for anything it does not recognise — which
// is the honest answer for a browser hitting the same API, and the canary
// that tells us if the desktop header ever stops arriving.
//
// ⚠️ The results are CLONED, and they have to be. Fiber's c.Get hands back a
// string pointing straight into fasthttp's request buffer, which is pooled and
// reused by the next request on that worker; FindStringSubmatch then returns
// substrings of it. Keeping one as a map key means the key's bytes change
// under the map once the buffer is recycled — traffic silently reattributed to
// whatever build happened to come next, which is worse than no data at all.
func ParseClientUA(ua string) (version, platform string) {
	m := clientUARe.FindStringSubmatch(ua)
	if m == nil {
		return "unknown", "unknown"
	}
	return strings.Clone(m[1]), strings.Clone(m[2])
}

// RecordUsage is the Fiber middleware. It runs the request, then folds one
// count into memory. No I/O on the request path.
func RecordUsage(c *fiber.Ctx) error {
	err := c.Next()

	status := c.Response().StatusCode()
	// c.Next() returning an error means an error handler will still set the
	// status, so read the class from the error where Fiber gives us one.
	if e, ok := err.(*fiber.Error); ok && e != nil {
		status = e.Code
	}

	version, plat := ParseClientUA(c.Get(fiber.HeaderUserAgent))

	// The REGISTERED PATTERN, not c.Path(). "/users/:username" is a bounded
	// dimension; "/users/alice" is a username in a metrics table.
	endpoint := "/"
	if r := c.Route(); r != nil && r.Path != "" {
		endpoint = r.Path
	}

	countUsage(usageKey{
		Day:         time.Now().UTC().Truncate(24 * time.Hour),
		AppVersion:  version,
		Platform:    plat,
		Endpoint:    endpoint,
		StatusClass: strconv.Itoa(status/100) + "xx",
	})

	return err
}

func countUsage(k usageKey) {
	usageMu.Lock()
	defer usageMu.Unlock()
	if _, seen := usageCounts[k]; !seen && len(usageCounts) >= usageMaxKeys {
		return
	}
	usageCounts[k]++
}

// FlushUsage writes the pending counters and empties the buffer. Exported so
// tests can force the write without waiting on the ticker.
func FlushUsage(ctx context.Context) {
	usageMu.Lock()
	pending := usageCounts
	usageCounts = make(map[usageKey]int64, len(pending))
	usageMu.Unlock()

	if len(pending) == 0 || DBPool == nil {
		return
	}

	batch := &pgx.Batch{}
	for k, n := range pending {
		batch.Queue(
			`INSERT INTO api_usage_daily (day, app_version, platform, endpoint, status_class, requests)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (day, app_version, platform, endpoint, status_class)
			 DO UPDATE SET requests = api_usage_daily.requests + EXCLUDED.requests`,
			k.Day, k.AppVersion, k.Platform, k.Endpoint, k.StatusClass, n)
	}

	res := DBPool.SendBatch(ctx, batch)
	defer res.Close()
	for range pending {
		if _, err := res.Exec(); err != nil {
			log.Printf("[Usage] flush: %v", err)
			return
		}
	}
}

// pruneUsage drops aggregates past the retention window.
func pruneUsage(ctx context.Context) {
	if DBPool == nil {
		return
	}
	cutoff := time.Now().UTC().Add(-usageRetention)
	tag, err := DBPool.Exec(ctx, `DELETE FROM api_usage_daily WHERE day < $1`, cutoff)
	if err != nil {
		log.Printf("[Usage] prune: %v", err)
		return
	}
	if n := tag.RowsAffected(); n > 0 {
		log.Printf("[Usage] pruned %d aggregate rows older than %d days", n, int(usageRetention.Hours()/24))
	}
}

// StartUsageFlusher writes the counters every minute for the lifetime of ctx,
// prunes once a day, and flushes once more on the way out so a rolling deploy
// does not drop the last minute.
//
// Every replica flushes its own buffer into the same rows; the upsert adds,
// so the counts are the fleet's, not one pod's. No leader election needed —
// unlike the janitors, this is commutative.
func StartUsageFlusher(ctx context.Context) {
	go func() {
		flush := time.NewTicker(time.Minute)
		prune := time.NewTicker(24 * time.Hour)
		defer flush.Stop()
		defer prune.Stop()
		pruneUsage(ctx)
		for {
			select {
			case <-ctx.Done():
				// ctx is already cancelled, so the final write needs its own.
				final, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				FlushUsage(final)
				cancel()
				return
			case <-flush.C:
				FlushUsage(ctx)
			case <-prune.C:
				pruneUsage(ctx)
			}
		}
	}()
	log.Println("[Usage] request counters started (1m flush, 365d retention)")
}
