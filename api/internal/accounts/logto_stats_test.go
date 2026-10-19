package accounts

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// The three dashboard calls must overlap: wall time ≈ one call, not three.
func TestFetchLogtoStatsRunsConcurrently(t *testing.T) {
	const delay = 300 * time.Millisecond
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		time.Sleep(delay)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/dashboard/users/total":
			w.Write([]byte(`{"totalUserCount":7}`))
		case "/api/dashboard/users/new":
			w.Write([]byte(`{"today":{"count":1,"delta":0},"last7Days":{"count":3,"delta":2}}`))
		default:
			w.Write([]byte(`{"dau":{"count":2,"delta":1},"wau":{"count":4,"delta":1},"mau":{"count":6,"delta":1},"dauCurve":[{"date":"2026-10-19","count":2}]}`))
		}
	}))
	defer srv.Close()

	t.Setenv("LOGTO_ENDPOINT", srv.URL)
	m2mMu.Lock()
	m2mToken, m2mTokenExpiry = "test", time.Now().Add(time.Hour)
	m2mMu.Unlock()
	t.Cleanup(ResetM2MTokenCache)

	start := time.Now()
	s, err := FetchLogtoStats()
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	if s.Total != 7 || s.New7d.Count != 3 || s.MAU.Count != 6 || len(s.DauCurve) != 1 {
		t.Fatalf("wrong stats: %+v", s)
	}
	if hits != 3 {
		t.Fatalf("want 3 calls, got %d", hits)
	}
	if elapsed >= 2*delay {
		t.Fatalf("calls ran serially: %v (one call is %v)", elapsed, delay)
	}
}
