package admin

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

var productAnalyticsReportNow = time.Now

type ActivitySummary struct {
	DAU   int          `json:"dau"`
	WAU   int          `json:"wau"`
	MAU   int          `json:"mau"`
	Curve []DailyCount `json:"curve"`
}

type ActivationSummary struct {
	FirstObserved int          `json:"first_observed"`
	Curve         []DailyCount `json:"curve"`
	Definition    string       `json:"definition"`
}

type RetentionMetric struct {
	Day       int     `json:"day"`
	Eligible  int     `json:"eligible"`
	Returned  int     `json:"returned"`
	Rate      float64 `json:"rate"`
	Available bool    `json:"available"`
	Note      string  `json:"note,omitempty"`
}

type RetentionSummary struct {
	D1  RetentionMetric `json:"d1"`
	D7  RetentionMetric `json:"d7"`
	D30 RetentionMetric `json:"d30"`
}

type FeatureUsage struct {
	Category string  `json:"category"`
	Accounts int     `json:"accounts"`
	Share    float64 `json:"share"`
}

// ProductAnalyticsResponse is the legacy first-party series: one fact per
// account and UTC day once a visible ticker with an enabled widget had been
// shown for 30 continuous seconds. It predates presence (SCROLLR-210) and is
// reported as its own, separately labelled measurement.
type ProductAnalyticsResponse struct {
	GeneratedAt         string            `json:"generated_at"`
	CollectionStartedAt *string           `json:"collection_started_at"`
	Days                int               `json:"days"`
	StaffExcluded       bool              `json:"staff_excluded"`
	EnrolledAccounts    int               `json:"enrolled_accounts"`
	Activity            ActivitySummary   `json:"activity"`
	Activation          ActivationSummary `json:"activation"`
	Retention           RetentionSummary  `json:"retention"`
	Features            []FeatureUsage    `json:"features"`
	PopulationNote      string            `json:"population_note"`
	RecentPresence      int               `json:"recent_presence"`
	RecentPresenceNote  string            `json:"recent_presence_note"`
}

func HandleGetProductAnalytics(c *fiber.Ctx) error {
	days, err := strconv.Atoi(c.Query("days", "7"))
	if err != nil || (days != 7 && days != 30) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "days must be 7 or 30"})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	report, err := loadProductAnalytics(ctx, days, productAnalyticsReportNow(), ExcludeStaff(ctx))
	if err != nil {
		log.Printf("[Admin] product analytics: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Error: "Product analytics are unavailable."})
	}
	return c.JSON(report)
}

// loadProductAnalytics reads the legacy daily facts. excludeStaff hides
// accounts whose enrollment row is flagged internal (SCROLLR-210): staff were
// never enrolled before that change, so older history has none either way.
func loadProductAnalytics(ctx context.Context, days int, now time.Time, excludeStaff bool) (ProductAnalyticsResponse, error) {
	today := now.UTC().Truncate(24 * time.Hour)
	start := today.AddDate(0, 0, -(days - 1))
	report := ProductAnalyticsResponse{
		GeneratedAt: now.UTC().Format(time.RFC3339), Days: days, StaffExcluded: excludeStaff,
		PopulationNote:     "Signed-in accounts with usage analytics enabled. Activity means a native ticker was visible with an enabled widget for 30 continuous seconds; it does not prove attention.",
		Activation:         ActivationSummary{Definition: "First observed successful configured ticker use; not original signup date."},
		Features:           []FeatureUsage{},
		RecentPresenceNote: "Customer accounts with analytics enabled, seen by the desktop app in the last 15 minutes; presence does not prove attention.",
	}
	if platform.Rdb != nil {
		cutoff := now.UTC().Add(-15 * time.Minute).Unix()
		_ = platform.Rdb.ZRemRangeByScore(ctx, "posthog:recent-presence", "-inf", strconv.FormatInt(cutoff, 10)).Err()
		if count, err := platform.Rdb.ZCount(ctx, "posthog:recent-presence", strconv.FormatInt(cutoff, 10), "+inf").Result(); err == nil {
			report.RecentPresence = int(count)
		}
	}

	// $1 is the staff switch on every query below: NOT $1 keeps everyone,
	// otherwise only rows whose enrollment is not internal.
	var collectionStart *time.Time
	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*), min(enrolled_at) FROM product_analytics_enrollments
		 WHERE NOT $1 OR internal = false`, excludeStaff).
		Scan(&report.EnrolledAccounts, &collectionStart); err != nil {
		return report, err
	}
	if collectionStart != nil {
		formatted := collectionStart.UTC().Format(time.RFC3339)
		report.CollectionStartedAt = &formatted
	}

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(DISTINCT a.logto_sub) FILTER (WHERE a.day = $2),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.day >= $2 - 6),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.day >= $2 - 29)
		  FROM product_activity_daily a
		  JOIN product_analytics_enrollments e ON e.logto_sub = a.logto_sub
		 WHERE NOT $1 OR e.internal = false`, excludeStaff, today).
		Scan(&report.Activity.DAU, &report.Activity.WAU, &report.Activity.MAU); err != nil {
		return report, err
	}

	rows, err := platform.DBPool.Query(ctx, `
		SELECT d::date, count(a.logto_sub)
		  FROM generate_series($2::date, $3::date, interval '1 day') d
		  LEFT JOIN product_activity_daily a ON a.day = d::date
		  LEFT JOIN product_analytics_enrollments e ON e.logto_sub = a.logto_sub
		 WHERE a.logto_sub IS NULL OR NOT $1 OR e.internal = false
		 GROUP BY d ORDER BY d`, excludeStaff, start, today)
	if err != nil {
		return report, err
	}
	for rows.Next() {
		var day time.Time
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			rows.Close()
			return report, err
		}
		report.Activity.Curve = append(report.Activity.Curve, DailyCount{Day: day.Format("2006-01-02"), Count: count})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return report, err
	}
	rows.Close()

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*) FROM product_analytics_enrollments
		 WHERE first_active_day BETWEEN $2 AND $3 AND (NOT $1 OR internal = false)`, excludeStaff, start, today).
		Scan(&report.Activation.FirstObserved); err != nil {
		return report, err
	}
	rows, err = platform.DBPool.Query(ctx, `
		SELECT d::date, count(e.logto_sub)
		  FROM generate_series($2::date, $3::date, interval '1 day') d
		  LEFT JOIN product_analytics_enrollments e
		    ON e.first_active_day = d::date AND (NOT $1 OR e.internal = false)
		 GROUP BY d ORDER BY d`, excludeStaff, start, today)
	if err != nil {
		return report, err
	}
	for rows.Next() {
		var day time.Time
		var count int
		if err := rows.Scan(&day, &count); err != nil {
			rows.Close()
			return report, err
		}
		report.Activation.Curve = append(report.Activation.Curve, DailyCount{Day: day.Format("2006-01-02"), Count: count})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return report, err
	}
	rows.Close()

	retention := []*RetentionMetric{&report.Retention.D1, &report.Retention.D7, &report.Retention.D30}
	columns := []string{"retained_d1", "retained_d7", "retained_d30"}
	for i, offset := range []int{1, 7, 30} {
		metric := retention[i]
		metric.Day = offset
		query := `SELECT count(*), count(*) FILTER (WHERE ` + columns[i] + ` IS TRUE)
		            FROM product_analytics_enrollments
		           WHERE first_active_day <= $2::date - $3::int AND (NOT $1 OR internal = false)`
		if err := platform.DBPool.QueryRow(ctx, query, excludeStaff, today, offset).Scan(&metric.Eligible, &metric.Returned); err != nil {
			return report, err
		}
		metric.Available = metric.Eligible > 0
		if metric.Available {
			metric.Rate = float64(metric.Returned) / float64(metric.Eligible)
		} else {
			metric.Note = "No measured cohort is old enough to observe this exact return day."
		}
	}

	var active, sports, markets, news, fantasy, predictions, utilities int
	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(DISTINCT a.logto_sub),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.sports),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.markets),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.news),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.fantasy),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.predictions),
		       count(DISTINCT a.logto_sub) FILTER (WHERE a.utilities)
		  FROM product_activity_daily a
		  JOIN product_analytics_enrollments e ON e.logto_sub = a.logto_sub
		 WHERE a.day BETWEEN $2 AND $3 AND (NOT $1 OR e.internal = false)`, excludeStaff, start, today).
		Scan(&active, &sports, &markets, &news, &fantasy, &predictions, &utilities); err != nil {
		return report, err
	}
	for i, category := range []string{"sports", "markets", "news", "fantasy", "predictions", "utilities"} {
		count := []int{sports, markets, news, fantasy, predictions, utilities}[i]
		share := 0.0
		if active > 0 {
			share = float64(count) / float64(active)
		}
		report.Features = append(report.Features, FeatureUsage{Category: category, Accounts: count, Share: share})
	}
	return report, nil
}
