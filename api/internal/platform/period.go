package platform

import (
	"errors"
	"fmt"
	"math"
	"time"
)

// The shared time contract (SCROLLR-210, docs/analytics/ADMIN_DASHBOARD.md).
//
// Every historical card on the Overview and Analytics pages reads the same
// selector — 24h, 7d, 30d or lifetime — and every one of them resolves it
// through this file, so "7 days" means the same rolling window on every card:
// [end - 7d, end), where end is one `now` taken once per request. The
// previous period is the equal-length window ending at start. Lifetime has
// no previous period.

// PeriodKey is the selector value as the client sends it.
type PeriodKey string

const (
	Period24h      PeriodKey = "24h"
	Period7d       PeriodKey = "7d"
	Period30d      PeriodKey = "30d"
	PeriodLifetime PeriodKey = "lifetime"
	DefaultPeriod            = Period7d
)

var periodLengths = map[PeriodKey]time.Duration{
	Period24h: 24 * time.Hour,
	Period7d:  7 * 24 * time.Hour,
	Period30d: 30 * 24 * time.Hour,
}

var errBadPeriod = errors.New("period must be one of 24h, 7d, 30d, lifetime")

// Period is one resolved window. Start is zero for lifetime.
type Period struct {
	Key   PeriodKey
	Start time.Time
	End   time.Time
}

// Lifetime reports whether the window has no lower bound.
func (p Period) Lifetime() bool { return p.Key == PeriodLifetime }

// Length is the window length; zero for lifetime.
func (p Period) Length() time.Duration { return periodLengths[p.Key] }

// Previous is the immediately preceding equal-length window. Lifetime has
// none, and the second value says so.
func (p Period) Previous() (Period, bool) {
	if p.Lifetime() {
		return Period{}, false
	}
	return Period{Key: p.Key, Start: p.Start.Add(-p.Length()), End: p.Start}, true
}

// Window is the JSON shape of a period: half-open, RFC3339, UTC.
type Window struct {
	Key   PeriodKey `json:"key"`
	Start *string   `json:"start"`
	End   string    `json:"end"`
}

func (p Period) Window() Window {
	w := Window{Key: p.Key, End: p.End.UTC().Format(time.RFC3339)}
	if !p.Lifetime() {
		s := p.Start.UTC().Format(time.RFC3339)
		w.Start = &s
	}
	return w
}

// ParsePeriod resolves the selector against one cutoff. An empty value is the
// default, anything unknown is an error the handler turns into a 400.
func ParsePeriod(raw string, now time.Time) (Period, error) {
	key := PeriodKey(raw)
	if raw == "" {
		key = DefaultPeriod
	}
	end := now.UTC()
	switch key {
	case Period24h, Period7d, Period30d:
		return Period{Key: key, Start: end.Add(-periodLengths[key]), End: end}, nil
	case PeriodLifetime:
		return Period{Key: key, End: end}, nil
	default:
		return Period{}, errBadPeriod
	}
}

// Metric is a number with a comparison against the previous period and an
// honest availability flag: Available false means the figure is missing,
// never zero.
type Metric struct {
	Value      float64    `json:"value"`
	Available  bool       `json:"available"`
	Note       string     `json:"note,omitempty"`
	Comparison Comparison `json:"comparison"`
}

// Comparison is a figure's change against the previous window. Comparable is
// false when no honest comparison exists: lifetime, a previous window that
// starts before the measurement's coverage, or a zero previous value — a
// percentage against nothing is a claim, not a change.
type Comparison struct {
	Previous   *float64 `json:"previous,omitempty"`
	Delta      *float64 `json:"delta,omitempty"`
	DeltaPct   *float64 `json:"delta_pct,omitempty"`
	Comparable bool     `json:"comparable"`
	Note       string   `json:"note,omitempty"`
}

// Compare builds the comparison for current against previous. coverageFrom
// is when the source started measuring (zero when unknown/unbounded); the
// previous window must lie entirely inside it.
func Compare(current, previous float64, p Period, coverageFrom time.Time) Comparison {
	prev, ok := p.Previous()
	if !ok {
		return Comparison{Note: "Lifetime has no previous period."}
	}
	if !coverageFrom.IsZero() && prev.Start.Before(coverageFrom) {
		return Comparison{Note: fmt.Sprintf("The previous %s starts before measurement began on %s, so there is nothing complete to compare with.", p.Key, coverageFrom.UTC().Format("2 Jan 2006"))}
	}
	c := Comparison{Previous: &previous}
	if previous == 0 {
		// A change against nothing is not a change; the previous value is
		// still reported so the reader can see it was zero.
		if current == 0 {
			c.Note = "Both periods are zero."
		} else {
			c.Note = "The previous period was zero, so there is nothing to compare against."
		}
		return c
	}
	delta := current - previous
	c.Delta = &delta
	c.Comparable = true
	// The sign of the change is the sign of delta; the denominator's sign
	// must not flip it (net earnings can be negative in a window).
	pct := round1(delta / math.Abs(previous) * 100)
	c.DeltaPct = &pct
	return c
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// Bucket is one chart bar. Buckets are aligned to the window start and
// clipped to the window: the last bucket ends at End even when that makes it
// shorter than Step, and Partial says so. Nothing outside [Start, End) is
// ever counted.
type Bucket struct {
	Start   string  `json:"start"`
	End     string  `json:"end"`
	Value   float64 `json:"value"`
	Partial bool    `json:"partial,omitempty"`
}

// BucketStep is the chart resolution for a period. Lifetime is daily up to
// three months of coverage and weekly beyond, so a chart stays readable.
func BucketStep(p Period, coverageFrom time.Time) time.Duration {
	switch p.Key {
	case Period24h:
		return time.Hour
	case Period7d, Period30d:
		return 24 * time.Hour
	}
	if !coverageFrom.IsZero() && p.End.Sub(coverageFrom) > 92*24*time.Hour {
		return 7 * 24 * time.Hour
	}
	return 24 * time.Hour
}

// EffectiveStart is the lower bound a query should use: the period start, or
// for lifetime the coverage start. Zero when neither is known.
func EffectiveStart(p Period, coverageFrom time.Time) time.Time {
	if !p.Lifetime() {
		return p.Start
	}
	return coverageFrom
}

// Buckets lays out empty buckets for the window. Callers fill Value by
// bucket index from their own rows via BucketIndex.
func Buckets(start, end time.Time, step time.Duration) []Bucket {
	if step <= 0 || !end.After(start) {
		return []Bucket{}
	}
	n := int(math.Ceil(float64(end.Sub(start)) / float64(step)))
	out := make([]Bucket, 0, n)
	for i := 0; i < n; i++ {
		bStart := start.Add(time.Duration(i) * step)
		bEnd := bStart.Add(step)
		partial := false
		if bEnd.After(end) {
			bEnd = end
			partial = true
		}
		out = append(out, Bucket{
			Start:   bStart.UTC().Format(time.RFC3339),
			End:     bEnd.UTC().Format(time.RFC3339),
			Partial: partial,
		})
	}
	return out
}

// BucketIndex places an instant in the bucket list; -1 when it is outside
// [start, end).
func BucketIndex(at, start, end time.Time, step time.Duration) int {
	if at.Before(start) || !at.Before(end) || step <= 0 {
		return -1
	}
	return int(at.Sub(start) / step)
}

// Coverage describes how far back a source can honestly report.
type Coverage struct {
	// From is when measurement began, or null when the source is unbounded.
	From *string `json:"from"`
	// Partial is true when the requested window starts before From, so the
	// figure covers less than the whole period.
	Partial bool   `json:"partial"`
	Note    string `json:"note,omitempty"`
}

func CoverageFor(p Period, from time.Time, note string) Coverage {
	c := Coverage{Note: note}
	if from.IsZero() {
		return c
	}
	f := from.UTC().Format(time.RFC3339)
	c.From = &f
	if p.Lifetime() {
		return c
	}
	c.Partial = p.Start.Before(from)
	return c
}
