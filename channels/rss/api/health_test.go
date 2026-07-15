package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestBuildReadyURL verifies that every input shape we'd reasonably get
// from `INTERNAL_RSS_URL` produces the canonical /health/ready path.
// Guards against the previous bug where `buildHealthURL` produced `/health`
// and a follower typo turned it into `/healthy` without anyone noticing.
func TestBuildReadyURL(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"http://rss-service:3004", "http://rss-service:3004/health/ready"},
		{"http://rss-service:3004/", "http://rss-service:3004/health/ready"},
		{"http://rss-service:3004/health", "http://rss-service:3004/health/ready"},
		{"http://rss-service:3004/health/", "http://rss-service:3004/health/ready"},
		{"http://rss-service:3004/health/ready", "http://rss-service:3004/health/ready"},
		{"http://rss-service:3004/health/ready/", "http://rss-service:3004/health/ready"},
	}
	for _, tc := range cases {
		if got := buildReadyURL(tc.in); got != tc.want {
			t.Errorf("buildReadyURL(%q) = %q; want %q", tc.in, got, tc.want)
		}
	}
}

// TestProbeIngestion_ForwardsStatusCode covers the critical invariant
// enforced by handleInternalHealth: whatever HTTP status code the Rust
// service's /health/ready returns, we need to propagate it so the k8s
// readiness probe on the Go API can tell when ingestion is broken.
func TestProbeIngestion_ForwardsStatusCode(t *testing.T) {
	cases := []int{200, 503, 500}
	for _, want := range cases {
		want := want
		t.Run(http.StatusText(want), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/health/ready" {
					t.Errorf("unexpected path: %q", r.URL.Path)
				}
				w.WriteHeader(want)
			}))
			defer srv.Close()

			got, err := probeIngestion(context.Background(), srv.URL)
			if err != nil {
				t.Fatalf("probeIngestion: unexpected error: %v", err)
			}
			if got != want {
				t.Errorf("probeIngestion: got %d, want %d", got, want)
			}
		})
	}
}

// TestProbeIngestion_NetworkErrorReturnsError verifies we surface a
// connection-level failure (Rust service down entirely) as an error, so
// handleInternalHealth can mark the pod degraded.
func TestProbeIngestion_NetworkErrorReturnsError(t *testing.T) {
	// Bind to :0 and immediately close — any client request will see
	// ECONNREFUSED.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := srv.URL
	srv.Close()

	_, err := probeIngestion(context.Background(), url)
	if err == nil {
		t.Fatalf("probeIngestion: expected network error, got nil")
	}
}

// TestProbeIngestion_EmptyURLIsNoOp confirms the "no INTERNAL_*_URL
// configured" case doesn't error — returns (0, nil) so the caller can
// skip the ingestion branch entirely.
func TestProbeIngestion_EmptyURLIsNoOp(t *testing.T) {
	code, err := probeIngestion(context.Background(), "")
	if err != nil {
		t.Fatalf("probeIngestion(''): unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("probeIngestion(''): got %d, want 0", code)
	}
}
