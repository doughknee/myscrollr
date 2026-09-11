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

type ProductAnalyticsResponse struct {
	GeneratedAt         string            `json:"generated_at"`
	CollectionStartedAt *string           `json:"collection_started_at"`
	Days                int               `json:"days"`
	EnrolledAccounts    int               `json:"enrolled_accounts"`
	Activity            ActivitySummary   `json:"activity"`
	Activation          ActivationSummary `json:"activation"`
	Retention           RetentionSummary  `json:"retention"`
	Features            []FeatureUsage    `json:"features"`
	PopulationNote      string            `json:"population_note"`
}

func HandleGetProductAnalytics(c *fiber.Ctx) error {
	days, err := strconv.Atoi(c.Query("days", "7"))
	if err != nil || (days != 7 && days != 30) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "days must be 7 or 30"})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	report, err := loadProductAnalytics(ctx, days, productAnalyticsReportNow())
	if err != nil {
		log.Printf("[Admin] product analytics: %v", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Error: "Product analytics are unavailable."})
	}
	return c.JSON(report)
}

func loadProductAnalytics(ctx context.Context, days int, now time.Time) (ProductAnalyticsResponse, error) {
	today := now.UTC().Truncate(24 * time.Hour)
	start := today.AddDate(0, 0, -(days - 1))
	report := ProductAnalyticsResponse{
		GeneratedAt: now.UTC().Format(time.RFC3339), Days: days,
		PopulationNote: "Opted-in signed-in accounts only. Activity means a native ticker was visible with an enabled widget for 30 continuous seconds; it does not prove attention.",
		Activation:     ActivationSummary{Definition: "First observed successful configured ticker use; not original signup date."},
		Features:       []FeatureUsage{},
	}

	var collectionStart *time.Time
	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(*), min(enrolled_at) FROM product_analytics_enrollments`).
		Scan(&report.EnrolledAccounts, &collectionStart); err != nil {
		return report, err
	}
	if collectionStart != nil {
		formatted := collectionStart.UTC().Format(time.RFC3339)
		report.CollectionStartedAt = &formatted
	}

	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(DISTINCT logto_sub) FILTER (WHERE day = $1),
		       count(DISTINCT logto_sub) FILTER (WHERE day >= $1 - 6),
		       count(DISTINCT logto_sub) FILTER (WHERE day >= $1 - 29)
		  FROM product_activity_daily`, today).
		Scan(&report.Activity.DAU, &report.Activity.WAU, &report.Activity.MAU); err != nil {
		return report, err
	}

	rows, err := platform.DBPool.Query(ctx, `
		SELECT d::date, count(a.logto_sub)
		  FROM generate_series($1::date, $2::date, interval '1 day') d
		  LEFT JOIN product_activity_daily a ON a.day = d::date
		 GROUP BY d ORDER BY d`, start, today)
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
		 WHERE first_active_day BETWEEN $1 AND $2`, start, today).
		Scan(&report.Activation.FirstObserved); err != nil {
		return report, err
	}
	rows, err = platform.DBPool.Query(ctx, `
		SELECT d::date, count(e.logto_sub)
		  FROM generate_series($1::date, $2::date, interval '1 day') d
		  LEFT JOIN product_analytics_enrollments e ON e.first_active_day = d::date
		 GROUP BY d ORDER BY d`, start, today)
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
		           WHERE first_active_day <= $1::date - $2::int`
		if err := platform.DBPool.QueryRow(ctx, query, today, offset).Scan(&metric.Eligible, &metric.Returned); err != nil {
			return report, err
		}
		metric.Available = metric.Eligible > 0
		if metric.Available {
			metric.Rate = float64(metric.Returned) / float64(metric.Eligible)
		} else {
			metric.Note = "No opted-in cohort is old enough to observe this exact return day."
		}
	}

	var active, sports, markets, news, fantasy, predictions, utilities int
	if err := platform.DBPool.QueryRow(ctx, `
		SELECT count(DISTINCT logto_sub),
		       count(DISTINCT logto_sub) FILTER (WHERE sports),
		       count(DISTINCT logto_sub) FILTER (WHERE markets),
		       count(DISTINCT logto_sub) FILTER (WHERE news),
		       count(DISTINCT logto_sub) FILTER (WHERE fantasy),
		       count(DISTINCT logto_sub) FILTER (WHERE predictions),
		       count(DISTINCT logto_sub) FILTER (WHERE utilities)
		  FROM product_activity_daily WHERE day BETWEEN $1 AND $2`, start, today).
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
