package admin

import (
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// The shared time contract lives in platform (the leaf package) so the
// support package can report against the same windows without importing the
// console. These aliases keep the admin handlers readable.

type (
	Period     = platform.Period
	PeriodKey  = platform.PeriodKey
	Window     = platform.Window
	Comparison = platform.Comparison
	Bucket     = platform.Bucket
	Coverage   = platform.Coverage
	Metric     = platform.Metric
)

const (
	Period24h      = platform.Period24h
	Period7d       = platform.Period7d
	Period30d      = platform.Period30d
	PeriodLifetime = platform.PeriodLifetime
)

func ParsePeriod(raw string, now time.Time) (Period, error) { return platform.ParsePeriod(raw, now) }

var (
	Compare        = platform.Compare
	Buckets        = platform.Buckets
	BucketIndex    = platform.BucketIndex
	BucketStep     = platform.BucketStep
	EffectiveStart = platform.EffectiveStart
	CoverageFor    = platform.CoverageFor
)
