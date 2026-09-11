package core

import (
	"net"
	"net/netip"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/oschwald/maxminddb-golang/v2"
)

const countryDatabaseMaxAge = 45 * 24 * time.Hour

type countryResolver interface {
	Lookup(netip.Addr) (string, error)
	BuildTime() time.Time
}

type mmdbCountryResolver struct {
	db *maxminddb.Reader
}

func openCountryResolver(path string) (countryResolver, error) {
	db, err := maxminddb.Open(path)
	if err != nil {
		return nil, err
	}
	return &mmdbCountryResolver{db: db}, nil
}

func (r *mmdbCountryResolver) Lookup(ip netip.Addr) (string, error) {
	var record struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
	}
	if err := r.db.Lookup(ip).Decode(&record); err != nil {
		return "", err
	}
	return record.Country.ISOCode, nil
}

func (r *mmdbCountryResolver) BuildTime() time.Time {
	return r.db.Metadata.BuildTime()
}

func (s *Server) analyticsPolicy(c *fiber.Ctx) error {
	policy := "consent-required"
	ip, err := trustedIngressClientIP(c)
	if err == nil && isPublicClientIP(ip) && s.countryResolver != nil {
		builtAt := s.countryResolver.BuildTime()
		now := s.now()
		fresh := !builtAt.IsZero() && !builtAt.After(now.Add(24*time.Hour)) && now.Sub(builtAt) <= countryDatabaseMaxAge
		if fresh {
			country, lookupErr := s.countryResolver.Lookup(ip)
			if lookupErr == nil && strings.EqualFold(country, "US") {
				policy = "default-on"
			}
		}
	}

	c.Set("Cache-Control", "private, no-store")
	c.Set("Vary", "Origin")
	return c.JSON(fiber.Map{"policy": policy})
}

// ingress-nginx overwrites X-Real-IP with its single client address. The
// NetworkPolicy only permits ingress-nginx to reach core-api, and this peer
// check keeps direct/public callers from supplying the header themselves.
func trustedIngressClientIP(c *fiber.Ctx) (netip.Addr, error) {
	peer, ok := netip.AddrFromSlice(c.Context().RemoteIP())
	if !ok || (!peer.IsPrivate() && !peer.IsLoopback() && !peer.IsLinkLocalUnicast()) {
		return netip.Addr{}, &net.AddrError{Err: "untrusted proxy", Addr: peer.String()}
	}
	return netip.ParseAddr(strings.TrimSpace(c.Get("X-Real-IP")))
}

func isPublicClientIP(ip netip.Addr) bool {
	return ip.IsValid() && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast()
}
