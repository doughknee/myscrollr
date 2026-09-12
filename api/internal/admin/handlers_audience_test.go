package admin

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func withLogtoAccounts(t *testing.T, total int, partial bool, list ...accounts.LogtoAccount) {
	t.Helper()
	prev := listAllLogtoAccounts
	listAllLogtoAccounts = func() ([]accounts.LogtoAccount, int, bool, error) { return list, total, partial, nil }
	if platform.Rdb != nil {
		_ = platform.Rdb.Del(context.Background(), logtoAccountsCacheKey).Err()
	}
	t.Cleanup(func() {
		listAllLogtoAccounts = prev
		if platform.Rdb != nil {
			_ = platform.Rdb.Del(context.Background(), logtoAccountsCacheKey).Err()
		}
	})
}

func TestAudienceCountsRollingWindowsAndExcludesStaff(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	now := time.Date(2026, 9, 11, 22, 0, 0, 0, time.UTC)
	period, _ := ParsePeriod("7d", now)
	ms := func(d time.Duration) int64 { return now.Add(d).UnixMilli() }
	resetAdmins(t, "audience-staff@example.com")
	testsupport.MustExec(t, `UPDATE admin_users SET logto_sub = 'staff-sub' WHERE email = 'audience-staff@example.com'`)
	testsupport.MustExec(t, `DELETE FROM user_preferences`)
	testsupport.MustExec(t, `INSERT INTO user_preferences (logto_sub) VALUES ('a')`)
	t.Setenv("POSTHOG_EXCLUDED_LOGTO_SUBS", "test-sub")

	withLogtoAccounts(t, 6, false,
		accounts.LogtoAccount{ID: "a", CreatedAt: ms(-2 * 24 * time.Hour), LastSignInAt: ms(-time.Hour)},
		accounts.LogtoAccount{ID: "b", CreatedAt: ms(-6*24*time.Hour - 59*time.Minute), LastSignInAt: ms(-10 * 24 * time.Hour)},
		accounts.LogtoAccount{ID: "c", CreatedAt: ms(-7*24*time.Hour - time.Minute)}, // just before the window
		accounts.LogtoAccount{ID: "d", CreatedAt: ms(-20 * 24 * time.Hour)},          // before the previous window
		accounts.LogtoAccount{ID: "staff-sub", CreatedAt: ms(-time.Hour), LastSignInAt: ms(-time.Minute)},
		accounts.LogtoAccount{ID: "test-sub", CreatedAt: ms(-time.Hour)},
	)

	out := loadAudience(context.Background(), period, true, now)
	if !out.Available || out.Total != 4 || out.Excluded != 2 || out.SetUp != 1 {
		t.Fatalf("audience = total %d excluded %d set_up %d available %v", out.Total, out.Excluded, out.SetUp, out.Available)
	}
	if out.New.Value != 2 {
		t.Fatalf("new in 7d = %v, want 2 (a, b; c is a minute too early)", out.New.Value)
	}
	if !out.New.Comparison.Comparable || *out.New.Comparison.Previous != 1 || *out.New.Comparison.Delta != 1 {
		t.Fatalf("new comparison = %+v (want previous window = c)", out.New.Comparison)
	}
	if out.SignedInInPeriod.Value != 1 {
		t.Fatalf("signed in = %v, want 1 (a; staff excluded; b signed in earlier)", out.SignedInInPeriod.Value)
	}
	// a (2 days ago) lands in the sixth daily bucket, b (6 d 59 min ago) in
	// the first; buckets are aligned to the window start, not to midnight.
	if len(out.NewCurve) != 7 || out.NewCurve[5].Value != 1 || out.NewCurve[0].Value != 1 || out.NewCurve[6].Value != 0 {
		t.Fatalf("curve = %+v", out.NewCurve)
	}
	if out.LifetimeRegistrations != 4 || out.Coverage.From == nil {
		t.Fatalf("lifetime = %d coverage %+v", out.LifetimeRegistrations, out.Coverage)
	}

	// Setting off: staff counted, test accounts still out.
	all := loadAudience(context.Background(), period, false, now)
	if all.Total != 5 || all.Excluded != 1 || all.New.Value != 3 {
		t.Fatalf("with staff = total %d excluded %d new %v", all.Total, all.Excluded, all.New.Value)
	}
}

func TestAudienceDegradesVisiblyWhenLogtoIsDown(t *testing.T) {
	if platform.DBPool == nil {
		t.Skip("TEST_DATABASE_URL not set")
	}
	prev := listAllLogtoAccounts
	listAllLogtoAccounts = func() ([]accounts.LogtoAccount, int, bool, error) {
		return nil, 0, false, errors.New("logto unreachable")
	}
	if platform.Rdb != nil {
		_ = platform.Rdb.Del(context.Background(), logtoAccountsCacheKey).Err()
	}
	t.Cleanup(func() { listAllLogtoAccounts = prev })
	now := time.Date(2026, 9, 11, 22, 0, 0, 0, time.UTC)
	period, _ := ParsePeriod("24h", now)
	out := loadAudience(context.Background(), period, true, now)
	if out.Available || out.Total != 0 || out.New.Available || out.Note == "" {
		t.Fatalf("logto down = %+v", out)
	}
}
