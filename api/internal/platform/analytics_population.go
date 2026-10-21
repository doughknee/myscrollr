package platform

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// AnalyticsPopulation selects accounts, not the device on which a payment or
// signup happened. OS and version must occur together on a retained session.
// Keeping membership independent of the report window makes comparisons honest.
type AnalyticsPopulation struct {
	OS      string `json:"os"`
	Version string `json:"version"`
	Plan    string `json:"plan"`
}

const AnalyticsPopulationNote = "OS and version select accounts observed on that desktop combination in the last 90 days. Plan is current, not the plan at signup or payment. Accounts without matching evidence are excluded; multi-device accounts can belong to more than one population."

type analyticsPopulationKey struct{}

func WithAnalyticsPopulation(ctx context.Context, os, version, plan string) (context.Context, error) {
	if len(os) > 16 || len(version) > 32 || len(plan) > 32 {
		return ctx, fmt.Errorf("invalid OS, version or plan filter")
	}
	return context.WithValue(ctx, analyticsPopulationKey{}, AnalyticsPopulation{os, version, plan}), nil
}

func PopulationFromContext(ctx context.Context) AnalyticsPopulation {
	p, _ := ctx.Value(analyticsPopulationKey{}).(AnalyticsPopulation)
	return p
}

func (p AnalyticsPopulation) Active() bool { return p.OS != "" || p.Version != "" || p.Plan != "" }

// Predicate accepts only a source-code SQL identifier. Values always use
// parameters, appended after the caller's existing arguments.
func (p AnalyticsPopulation) Predicate(sub string, args *[]any) string {
	return p.PredicateAt(sub, args, time.Now().UTC())
}

func (p AnalyticsPopulation) PredicateAt(sub string, args *[]any, now time.Time) string {
	bind := func(value any) string {
		*args = append(*args, value)
		return fmt.Sprintf("$%d", len(*args))
	}
	clauses := []string{"true"}
	if p.OS != "" || p.Version != "" {
		session := "p.logto_sub = " + sub + " AND p.hour >= " + bind(now.AddDate(0, 0, -90)) + " AND p.hour < " + bind(now)
		if p.OS != "" {
			session += " AND p.os = " + bind(p.OS)
		}
		if p.Version != "" {
			session += " AND p.app_version = " + bind(p.Version)
		}
		clauses = append(clauses, "EXISTS (SELECT 1 FROM presence_session_hourly p WHERE "+session+")")
	}
	if p.Plan != "" {
		clauses = append(clauses, "coalesce((SELECT CASE WHEN ps.lifetime THEN 'lifetime' ELSE ps.plan END FROM stripe_customers ps WHERE ps.logto_sub = "+sub+"), 'free') = "+bind(p.Plan))
	}
	return strings.Join(clauses, " AND ")
}

func (p AnalyticsPopulation) MatchAccounts(ctx context.Context, ids []string) (map[string]bool, error) {
	if DBPool == nil {
		return nil, fmt.Errorf("account population database unavailable")
	}
	args := []any{ids}
	where := p.Predicate("a.sub", &args)
	rows, err := DBPool.Query(ctx, "SELECT a.sub FROM unnest($1::text[]) AS a(sub) WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	matches := make(map[string]bool)
	for rows.Next() {
		var sub string
		if err := rows.Scan(&sub); err != nil {
			return nil, err
		}
		matches[sub] = true
	}
	return matches, rows.Err()
}
