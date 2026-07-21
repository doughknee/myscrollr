package platform

import (
	"bytes"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// Tests for the Redis-backed fiber.Storage adapter behind the rate
// limiter (ADR-0001). The contract: counters round-trip with TTL, a
// missing key reads as (nil, nil), and Redis being down fails OPEN —
// never an error that would turn rate limiting into an outage.

// miniRedis is platform's own copy of the testsupport helper: platform is
// the leaf package, so importing testsupport (which imports platform)
// would be an import cycle in the test binary.
func miniRedis(t *testing.T) (*miniredis.Miniredis, func()) {
	t.Helper()

	mr := miniredis.RunT(t)
	previousRdb := Rdb
	Rdb = redis.NewClient(&redis.Options{Addr: mr.Addr()})

	return mr, func() {
		_ = Rdb.Close()
		Rdb = previousRdb
	}
}

func TestRedisLimiterStorage_RoundTripWithTTL(t *testing.T) {
	mr, cleanup := miniRedis(t)
	defer cleanup()

	s := NewRedisLimiterStorage("ratelimit:")

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
	_, cleanup := miniRedis(t)
	defer cleanup()

	s := NewRedisLimiterStorage("ratelimit:")
	got, err := s.Get("never-seen")
	if err != nil {
		t.Fatalf("Get on missing key returned error: %v", err)
	}
	if got != nil {
		t.Errorf("Get on missing key = %q, want nil", got)
	}
}

func TestRedisLimiterStorage_DeleteRemovesEntry(t *testing.T) {
	_, cleanup := miniRedis(t)
	defer cleanup()

	s := NewRedisLimiterStorage("ratelimit:")
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
	mr, cleanup := miniRedis(t)
	defer cleanup()
	mr.Close() // kill the backend; Rdb now points at a dead address

	s := NewRedisLimiterStorage("ratelimit:")

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
