package support

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// A failed digest that posted nothing releases the day's lock and asks for a
// retry; a posted (or partly posted) digest keeps it, so no replica posts the
// day twice.
func TestDigestLockReleasedOnlyWhenNothingPosted(t *testing.T) {
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	loc := time.UTC
	key := "support:digest:" + time.Now().In(loc).Format("2006-01-02")
	ctx := context.Background()

	cases := []struct {
		name      string
		err       error
		wantRetry bool
		wantLock  bool
	}{
		{"failed before posting", errors.New("discord down"), true, false},
		{"partly posted", fmt.Errorf("post digest: %w: %w", errDigestPartlyPosted, errors.New("429")), false, true},
		{"posted", nil, false, true},
	}
	for _, tc := range cases {
		mr.Del(key)
		retry := digestOnce(ctx, loc, func(context.Context, *time.Location) error { return tc.err })
		if retry != tc.wantRetry || mr.Exists(key) != tc.wantLock {
			t.Errorf("%s: retry=%v lock=%v, want retry=%v lock=%v", tc.name, retry, mr.Exists(key), tc.wantRetry, tc.wantLock)
		}
	}

	// The day's lock already taken: another replica owns it, nothing runs.
	ran := false
	if digestOnce(ctx, loc, func(context.Context, *time.Location) error { ran = true; return nil }) || ran {
		t.Fatal("ran while another replica held the lock")
	}
}
