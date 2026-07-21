package support

import (
	"testing"
	"time"
)

// TestSupportRateLimit_AllowsFirstSubmission is the baseline: a user
// with no prior submission is allowed through.
func TestSupportRateLimit_AllowsFirstSubmission(t *testing.T) {
	resetSupportRateLimiter()

	if !allowedBySupportRateLimit("user-a") {
		t.Fatal("first submission should be allowed")
	}
}

// TestSupportRateLimit_CheckIsSideEffectFree verifies the key contract:
// `allowedBySupportRateLimit` is read-only. Pre-incident, the check and
// the timestamp-update were fused, meaning a check done on a 429 path
// (before the actual submission) would lock the user out unintentionally.
func TestSupportRateLimit_CheckIsSideEffectFree(t *testing.T) {
	resetSupportRateLimiter()

	// 100 checks in a row should all return true — nothing is being
	// recorded.
	for i := 0; i < 100; i++ {
		if !allowedBySupportRateLimit("user-b") {
			t.Fatalf("check #%d flipped to false — allowedBy... must be read-only", i)
		}
	}
}

// TestSupportRateLimit_BlocksWithinWindow covers the happy path after a
// submission is recorded: subsequent submissions inside the window are
// rejected.
func TestSupportRateLimit_BlocksWithinWindow(t *testing.T) {
	resetSupportRateLimiter()

	if !allowedBySupportRateLimit("user-c") {
		t.Fatal("first check should be allowed")
	}

	recordSupportSubmission("user-c")

	if allowedBySupportRateLimit("user-c") {
		t.Fatal("submission recorded — next check should be blocked")
	}
}

// TestSupportRateLimit_IsolatesUsers is a guard against a classic bug in
// global-map rate limiters: a recorded submission for one user should not
// affect another user.
func TestSupportRateLimit_IsolatesUsers(t *testing.T) {
	resetSupportRateLimiter()

	recordSupportSubmission("user-d")

	if !allowedBySupportRateLimit("user-e") {
		t.Fatal("user-e has no submissions recorded and should be allowed")
	}
	if allowedBySupportRateLimit("user-d") {
		t.Fatal("user-d just submitted and should be blocked")
	}
}

// TestSupportRateLimit_ExpiresAfterWindow proves the cooldown actually
// releases. We temporarily shrink the rate-limit window so the test can
// run in milliseconds rather than a minute.
func TestSupportRateLimit_ExpiresAfterWindow(t *testing.T) {
	resetSupportRateLimiter()

	originalLimit := supportRateLimit
	supportRateLimit = 50 * time.Millisecond
	t.Cleanup(func() { supportRateLimit = originalLimit })

	recordSupportSubmission("user-f")
	if allowedBySupportRateLimit("user-f") {
		t.Fatal("immediately after submission, should still be blocked")
	}

	time.Sleep(75 * time.Millisecond)

	if !allowedBySupportRateLimit("user-f") {
		t.Fatal("after window elapsed, should be allowed again")
	}
}

// resetSupportRateLimiter empties the per-user map. Only used by tests
// to ensure each test case starts from a clean slate.
func resetSupportRateLimiter() {
	supportRateMu.Lock()
	defer supportRateMu.Unlock()
	supportRateMap = make(map[string]time.Time)
}
