package ingestread

import (
	"encoding/json"
	"fmt"
	"net/netip"
	"net/url"
	"strings"
)

var blockedFeedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("224.0.0.0/3"),
	netip.MustParsePrefix("168.63.129.16/32"), netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func validateFeedURL(raw string) error {
	if len(raw) > 4096 {
		return fmt.Errorf("RSS feed URL is too long")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Opaque != "" {
		return fmt.Errorf("RSS feeds require a public HTTP(S) URL without credentials")
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if ip, err := netip.ParseAddr(host); err == nil {
		if ip.Zone() != "" || ip.Is4In6() || (ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip)) {
			return fmt.Errorf("RSS feed destination must be public")
		}
		for _, network := range blockedFeedNetworks {
			if network.Contains(ip) {
				return fmt.Errorf("RSS feed destination must be public")
			}
		}
		return nil
	}
	if !strings.Contains(host, ".") || !strings.ContainsAny(host, "abcdefghijklmnopqrstuvwxyz") {
		return fmt.Errorf("RSS feed destination must be a public hostname")
	}
	for _, suffix := range []string{"localhost", "local", "internal", "svc", "cluster.local"} {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return fmt.Errorf("RSS feed destination must be public")
		}
	}
	return nil
}

// ValidateRSSConfig rejects unsafe input before storage. The fetcher additionally
// checks resolved socket addresses and redirects at connection time (DNS can change).
func ValidateRSSConfig(config map[string]interface{}) error {
	encoded, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("Invalid RSS feed configuration")
	}
	var parsed struct {
		Feeds []struct {
			URL  string `json:"url"`
			Name string `json:"name"`
		} `json:"feeds"`
	}
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		return fmt.Errorf("Invalid RSS feed configuration")
	}
	if len(parsed.Feeds) > MaxCustomFeeds {
		return fmt.Errorf("A widget can contain up to %d feeds", MaxCustomFeeds)
	}
	for _, feed := range parsed.Feeds {
		if len(feed.Name) > 512 {
			return fmt.Errorf("RSS feed name is too long")
		}
		if err := validateFeedURL(feed.URL); err != nil {
			return err
		}
	}
	return nil
}
