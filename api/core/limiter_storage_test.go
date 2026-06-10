package core

import (
	"bytes"
	"testing"
	"time"
)

// Tests for the Redis-backed fiber.Storage adapter behind the rate
// limiter (ADR-0001). The contract: counters round-trip with TTL, a
// missing key reads as (nil, nil), and Redis being down fails OPEN —
// never an error that would turn rate limiting into an outage.

func TestRedisLimiterStorage_RoundTripWithTTL(t *testing.T) {
	mr, cleanup := setupMiniRedis(t)
	defer cleanup()

	s := newRedisLimiterStorage("ratelimit:")

	if err := s.Set("1.2.3.4", []byte("counter-state"), 1*time.Minute); err != nil {
		t.Fatalf("Set: %v", err)
	}

	got, err := s.Get("1.2.3.4")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !bytes.Equal(got, []byte("counter-state")) {
		t.Errorf("Get = %q, want %q", got, "counter-state")
	}

	// The entry must expire with its window, or stale counters would
	// throttle clients forever.
	mr.FastForward(2 * time.Minute)
	got, err = s.Get("1.2.3.4")
	if err != nil {
		t.Fatalf("Get after expiry: %v", err)
	}
	if got != nil {
		t.Errorf("Get after expiry = %q, want nil", got)
	}
}

func TestRedisLimiterStorage_MissingKeyIsNilNil(t *testing.T) {
	_, cleanup := setupMiniRedis(t)
	defer cleanup()

	s := newRedisLimiterStorage("ratelimit:")
	got, err := s.Get("never-seen")
	if err != nil {
		t.Fatalf("Get on missing key returned error: %v", err)
	}
	if got != nil {
		t.Errorf("Get on missing key = %q, want nil", got)
	}
}

func TestRedisLimiterStorage_DeleteRemovesEntry(t *testing.T) {
	_, cleanup := setupMiniRedis(t)
	defer cleanup()

	s := newRedisLimiterStorage("ratelimit:")
	_ = s.Set("4.3.2.1", []byte("x"), time.Minute)
	if err := s.Delete("4.3.2.1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if got, _ := s.Get("4.3.2.1"); got != nil {
		t.Errorf("entry survived Delete: %q", got)
	}
}

// TestRedisLimiterStorage_FailsOpenWhenRedisDown is the load-bearing
// test: with Redis unreachable, Get must report "no entry" and Set must
// not surface an error, so the limiter admits requests instead of
// erroring them.
func TestRedisLimiterStorage_FailsOpenWhenRedisDown(t *testing.T) {
	mr, cleanup := setupMiniRedis(t)
	defer cleanup()
	mr.Close() // kill the backend; Rdb now points at a dead address

	s := newRedisLimiterStorage("ratelimit:")

	got, err := s.Get("1.2.3.4")
	if err != nil {
		t.Errorf("Get with Redis down returned error: %v (must fail open)", err)
	}
	if got != nil {
		t.Errorf("Get with Redis down = %q, want nil", got)
	}

	if err := s.Set("1.2.3.4", []byte("x"), time.Minute); err != nil {
		t.Errorf("Set with Redis down returned error: %v (must fail open)", err)
	}
	if err := s.Delete("1.2.3.4"); err != nil {
		t.Errorf("Delete with Redis down returned error: %v (must fail open)", err)
	}
}
