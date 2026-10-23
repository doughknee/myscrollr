package accounts

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"golang.org/x/sync/singleflight"
)

func TestAccountAccessSuspensionSharedCacheAndRecovery(t *testing.T) {
	mr, cleanup := testsupport.MiniRedis(t)
	defer cleanup()
	var state, hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		switch state.Load() {
		case 2:
			w.WriteHeader(503)
		case 3:
			w.WriteHeader(404)
		case 4:
			fmt.Fprint(w, `{"id":"test-user"}`)
		default:
			fmt.Fprintf(w, `{"id":"test-user","isSuspended":%t}`, state.Load() == 1)
		}
	}))
	defer srv.Close()
	t.Setenv("LOGTO_ENDPOINT", srv.URL)
	m2mMu.Lock()
	m2mToken, m2mTokenExpiry = "test", time.Now().Add(time.Hour)
	m2mMu.Unlock()
	t.Cleanup(ResetM2MTokenCache)
	if err := CheckAccountAccess("test-user"); err != nil {
		t.Fatal(err)
	}
	state.Store(1)
	// A different replica has no shared in-process group, but sees the same Redis TTL.
	accountAccessGroup = singleflight.Group{}
	if err := CheckAccountAccess("test-user"); err != nil {
		t.Fatal(err)
	}
	if hits.Load() != 1 {
		t.Fatal("cache miss on second replica")
	}
	mr.FastForward(accountAccessTTL)
	if err := CheckAccountAccess("test-user"); !errors.Is(err, platform.ErrAccountBlocked) {
		t.Fatalf("suspended: %v", err)
	}
	state.Store(0)
	mr.FastForward(accountAccessTTL)
	if err := CheckAccountAccess("test-user"); err != nil {
		t.Fatalf("reactivated: %v", err)
	}
	state.Store(2)
	mr.FastForward(accountAccessTTL)
	if err := CheckAccountAccess("test-user"); !errors.Is(err, platform.ErrAccountCheckUnavailable) {
		t.Fatalf("outage must fail closed: %v", err)
	}
	state.Store(0)
	if err := CheckAccountAccess("test-user"); err != nil {
		t.Fatalf("outage was cached: %v", err)
	}
	state.Store(3)
	mr.FastForward(accountAccessTTL)
	if err := CheckAccountAccess("test-user"); !errors.Is(err, platform.ErrAccountBlocked) {
		t.Fatalf("deleted: %v", err)
	}
	state.Store(4)
	mr.FastForward(accountAccessTTL)
	if err := CheckAccountAccess("test-user"); !errors.Is(err, platform.ErrAccountCheckUnavailable) {
		t.Fatalf("missing suspension status must fail closed: %v", err)
	}
	previousRedis := platform.Rdb
	platform.Rdb = nil
	defer func() { platform.Rdb = previousRedis }()
	state.Store(0)
	if err := CheckAccountAccess("test-user"); err != nil {
		t.Fatalf("fresh authority check without Redis: %v", err)
	}
	state.Store(1)
	if err := CheckAccountAccess("test-user"); !errors.Is(err, platform.ErrAccountBlocked) {
		t.Fatalf("suspension without Redis: %v", err)
	}
}
