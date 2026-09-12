package platform

import (
	"testing"
	"time"
)

func TestParsePeriodIsRollingAndHalfOpen(t *testing.T) {
	now := time.Date(2026, 9, 11, 22, 17, 45, 0, time.UTC)
	cases := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour, "": 7 * 24 * time.Hour}
	for raw, length := range cases {
		p, err := ParsePeriod(raw, now)
		if err != nil {
			t.Fatalf("%q: %v", raw, err)
		}
		if !p.End.Equal(now) || !p.Start.Equal(now.Add(-length)) {
			t.Fatalf("%q: window = [%s, %s), want [%s, %s)", raw, p.Start, p.End, now.Add(-length), now)
		}
		prev, ok := p.Previous()
		if !ok || !prev.End.Equal(p.Start) || !prev.Start.Equal(p.Start.Add(-length)) {
			t.Fatalf("%q: previous = %+v", raw, prev)
		}
	}
	// 24h is the last 24 hours, not today since midnight.
	p, _ := ParsePeriod("24h", now)
	if p.Start.Hour() != 22 || p.Start.Day() != 10 {
		t.Fatalf("24h start = %s, want 2026-09-10T22:17:45Z", p.Start)
	}
	life, err := ParsePeriod("lifetime", now)
	if err != nil || !life.Lifetime() || !life.Start.IsZero() {
		t.Fatalf("lifetime = %+v err=%v", life, err)
	}
	if _, ok := life.Previous(); ok {
		t.Fatal("lifetime must not have a previous period")
	}
	if _, err := ParsePeriod("14d", now); err == nil {
		t.Fatal("unknown period accepted")
	}
}

func TestCompareRefusesDishonestPercentages(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	p, _ := ParsePeriod("7d", now)

	c := Compare(12, 8, p, time.Time{})
	if !c.Comparable || *c.Delta != 4 || *c.DeltaPct != 50 {
		t.Fatalf("plain comparison = %+v", c)
	}

	// Zero previous: delta yes, percentage no.
	// A previous window of zero is not a denominator; the previous value is
	// still reported, the delta is not a comparison.
	c = Compare(3, 0, p, time.Time{})
	if c.Comparable || c.DeltaPct != nil || c.Delta != nil || *c.Previous != 0 || c.Note == "" {
		t.Fatalf("zero previous: %+v", c)
	}
	// A negative previous window keeps the sign of the change.
	c = Compare(940, -935, p, time.Time{})
	if !c.Comparable || *c.Delta != 1875 || *c.DeltaPct != 200.5 {
		t.Fatalf("negative previous: %+v", c)
	}
	c = Compare(3, 1, p, time.Time{})
	if !c.Comparable || *c.Delta != 2 || *c.DeltaPct != 200 || c.Note != "" {
		t.Fatalf("zero denominator = %+v", c)
	}

	// Previous window starts before coverage began: not comparable at all.
	c = Compare(3, 1, p, now.Add(-10*24*time.Hour))
	if c.Comparable || c.Delta != nil || c.Previous != nil {
		t.Fatalf("incomplete history = %+v", c)
	}
	// Coverage exactly at the previous start is complete.
	c = Compare(3, 1, p, now.Add(-14*24*time.Hour))
	if !c.Comparable {
		t.Fatalf("complete history = %+v", c)
	}

	life, _ := ParsePeriod("lifetime", now)
	if c := Compare(3, 1, life, time.Time{}); c.Comparable || c.Previous != nil {
		t.Fatalf("lifetime comparison = %+v", c)
	}
}

func TestBucketsNeverExpandTheWindow(t *testing.T) {
	start := time.Date(2026, 9, 4, 22, 17, 45, 0, time.UTC)
	end := start.Add(7 * 24 * time.Hour)
	b := Buckets(start, end, 24*time.Hour)
	if len(b) != 7 || b[0].Start != "2026-09-04T22:17:45Z" || b[6].End != "2026-09-11T22:17:45Z" || b[6].Partial {
		t.Fatalf("aligned daily buckets = %+v", b)
	}
	// A window that is not a multiple of the step ends with a short bucket.
	b = Buckets(start, start.Add(30*time.Hour), 24*time.Hour)
	if len(b) != 2 || !b[1].Partial || b[1].End != "2026-09-06T04:17:45Z" {
		t.Fatalf("clipped buckets = %+v", b)
	}
	if got := BucketIndex(start.Add(-time.Second), start, end, 24*time.Hour); got != -1 {
		t.Fatalf("before start → %d, want -1", got)
	}
	if got := BucketIndex(end, start, end, 24*time.Hour); got != -1 {
		t.Fatalf("at end → %d, want -1 (half-open)", got)
	}
	if got := BucketIndex(start.Add(24*time.Hour-time.Nanosecond), start, end, 24*time.Hour); got != 0 {
		t.Fatalf("last instant of day one → %d, want 0", got)
	}
	if got := BucketIndex(start.Add(6*24*time.Hour+5*time.Hour), start, end, 24*time.Hour); got != 6 {
		t.Fatalf("day seven → %d, want 6", got)
	}
	if len(Buckets(start, start, time.Hour)) != 0 {
		t.Fatal("empty window must have no buckets")
	}
}

func TestCoverageMarksPartialWindows(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	p, _ := ParsePeriod("30d", now)
	began := now.Add(-3 * 24 * time.Hour)
	c := CoverageFor(p, began, "presence")
	if !c.Partial || c.From == nil {
		t.Fatalf("30d over 3 days of history = %+v", c)
	}
	p7, _ := ParsePeriod("7d", now)
	if c := CoverageFor(p7, now.Add(-8*24*time.Hour), ""); c.Partial {
		t.Fatalf("7d inside 8 days of history = %+v", c)
	}
	if c := CoverageFor(p7, time.Time{}, ""); c.From != nil || c.Partial {
		t.Fatalf("unbounded source = %+v", c)
	}
	life, _ := ParsePeriod("lifetime", now)
	if c := CoverageFor(life, began, ""); c.Partial {
		t.Fatalf("lifetime is never partial, it is bounded by From: %+v", c)
	}
	if BucketStep(life, now.Add(-100*24*time.Hour)) != 7*24*time.Hour || BucketStep(life, began) != 24*time.Hour {
		t.Fatal("lifetime step should be weekly past three months, daily below")
	}
}
