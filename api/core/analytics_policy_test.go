package core

import (
	"encoding/json"
	"errors"
	"net"
	"net/netip"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

type stubCountryResolver struct {
	builtAt   time.Time
	countries map[netip.Addr]string
	err       error
}

func (r stubCountryResolver) Lookup(ip netip.Addr) (string, error) {
	return r.countries[ip], r.err
}

func (r stubCountryResolver) BuildTime() time.Time { return r.builtAt }

func TestAnalyticsPolicyDefaultsOnOnlyForFreshUSLookup(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name     string
		resolver countryResolver
		want     string
	}{
		{
			name: "US",
			resolver: stubCountryResolver{
				builtAt:   now.Add(-24 * time.Hour),
				countries: map[netip.Addr]string{netip.MustParseAddr("8.8.8.8"): "US"},
			},
			want: "default-on",
		},
		{
			name: "non-US",
			resolver: stubCountryResolver{
				builtAt:   now.Add(-24 * time.Hour),
				countries: map[netip.Addr]string{netip.MustParseAddr("8.8.8.8"): "CA"},
			},
			want: "consent-required",
		},
		{
			name: "stale database",
			resolver: stubCountryResolver{
				builtAt:   now.Add(-46 * 24 * time.Hour),
				countries: map[netip.Addr]string{netip.MustParseAddr("8.8.8.8"): "US"},
			},
			want: "consent-required",
		},
		{
			name: "lookup failure",
			resolver: stubCountryResolver{
				builtAt: now.Add(-24 * time.Hour),
				err:     errors.New("lookup failed"),
			},
			want: "consent-required",
		},
		{name: "missing database", want: "consent-required"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := NewServer()
			s.countryResolver = tt.resolver
			s.now = func() time.Time { return now }
			resp := runAnalyticsPolicy(t, s, "10.244.0.2", "8.8.8.8", "1.1.1.1")

			var body map[string]string
			if err := json.Unmarshal(resp.Body(), &body); err != nil {
				t.Fatal(err)
			}
			if body["policy"] != tt.want {
				t.Fatalf("policy = %q, want %q", body["policy"], tt.want)
			}
			if len(body) != 1 {
				t.Fatalf("response leaked extra location data: %#v", body)
			}
			if got := string(resp.Header.Peek("Cache-Control")); got != "private, no-store" {
				t.Fatalf("Cache-Control = %q", got)
			}
		})
	}
}

func TestAnalyticsPolicyIgnoresForwardedIPFromUntrustedPeer(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	s := NewServer()
	s.countryResolver = stubCountryResolver{
		builtAt: now,
		countries: map[netip.Addr]string{
			netip.MustParseAddr("8.8.8.8"): "US",
			netip.MustParseAddr("1.1.1.1"): "AU",
		},
	}
	s.now = func() time.Time { return now }
	resp := runAnalyticsPolicy(t, s, "1.1.1.1", "8.8.8.8", "8.8.8.8")

	var body map[string]string
	if err := json.Unmarshal(resp.Body(), &body); err != nil {
		t.Fatal(err)
	}
	if body["policy"] != "consent-required" {
		t.Fatalf("spoofed forwarded IP enabled analytics: %#v", body)
	}
}

func TestAnalyticsPolicyIgnoresForwardedChainAndRequiresIngressRealIP(t *testing.T) {
	now := time.Date(2026, 9, 11, 12, 0, 0, 0, time.UTC)
	s := NewServer()
	s.countryResolver = stubCountryResolver{
		builtAt:   now,
		countries: map[netip.Addr]string{netip.MustParseAddr("8.8.8.8"): "US"},
	}
	s.now = func() time.Time { return now }

	for _, realIP := range []string{"", "not-an-ip", "10.0.0.1"} {
		resp := runAnalyticsPolicy(t, s, "10.244.0.2", realIP, "8.8.8.8, 10.244.0.2")
		var body map[string]string
		if err := json.Unmarshal(resp.Body(), &body); err != nil {
			t.Fatal(err)
		}
		if body["policy"] != "consent-required" {
			t.Fatalf("X-Real-IP %q enabled analytics: %#v", realIP, body)
		}
	}
}

func runAnalyticsPolicy(t *testing.T, s *Server, remoteIP, realIP, forwardedIP string) *fasthttp.Response {
	t.Helper()
	var requestContext fasthttp.RequestCtx
	request := fasthttp.AcquireRequest()
	defer fasthttp.ReleaseRequest(request)
	request.Header.SetMethod(fiber.MethodGet)
	request.Header.Set("X-Real-IP", realIP)
	request.Header.Set("X-Forwarded-For", forwardedIP)
	requestContext.Init(request, &net.TCPAddr{IP: net.ParseIP(remoteIP), Port: 1234}, nil)
	ctx := s.App.AcquireCtx(&requestContext)
	defer s.App.ReleaseCtx(ctx)
	if err := s.analyticsPolicy(ctx); err != nil {
		t.Fatal(err)
	}
	return &requestContext.Response
}
