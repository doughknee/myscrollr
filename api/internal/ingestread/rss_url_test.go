package ingestread

import "testing"

func TestRSSFeedURLSafety(t *testing.T) {
	for _, raw := range []string{
		"file:///etc/passwd", "ftp://example.com/feed", "http://127.0.0.1/", "http://127.1/",
		"http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://[::1]/",
		"http://[::ffff:127.0.0.1]/", "http://[64:ff9b::a9fe:a9fe]/", "http://169.254.169.254/",
		"http://100.100.100.200/", "http://10.0.0.1/", "http://172.16.0.1/", "http://192.168.1.1/",
		"http://168.63.129.16/", "http://core-api:8080/health", "http://LOCALHOST./",
		"http://metadata.google.internal/", "http://kubernetes.default.svc/", "http://user:pass@example.com/",
		"http://[2001:db8::1]/", "http://[2002:7f00:1::]/", "http://[3fff::1]/", "http://224.0.0.1/",
	} {
		if validateFeedURL(raw) == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	for _, raw := range []string{"https://feeds.npr.org/1001/rss.xml", "https://example.com./feed", "http://8.8.8.8/feed", "https://[2606:4700:4700::1111]/rss"} {
		if err := validateFeedURL(raw); err != nil {
			t.Errorf("rejected %q: %v", raw, err)
		}
	}
}

func TestRSSConfigRejectsUnsafeAndMalformedFeeds(t *testing.T) {
	for _, config := range []map[string]interface{}{
		{"feeds": "bad"}, {"feeds": []interface{}{42}},
		{"feeds": []interface{}{map[string]interface{}{"url": "http://127.0.0.1/"}}},
		{"feeds": []interface{}{map[string]interface{}{"url": ""}}},
	} {
		if ValidateRSSConfig(config) == nil {
			t.Errorf("accepted malformed or unsafe feeds: %v", config)
		}
	}
	for _, config := range []map[string]interface{}{nil, {}, {"feeds": []interface{}{}}, {"feeds": []map[string]string{{"url": "https://feeds.npr.org/1001/rss.xml"}}}} {
		if err := ValidateRSSConfig(config); err != nil {
			t.Errorf("rejected valid config: %v", err)
		}
	}
}
