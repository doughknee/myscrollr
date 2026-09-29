package widgets

import (
	"encoding/json"
	"testing"
)

func TestConfigOrDefault(t *testing.T) {
	want := `{"feeds":[{"name":"NPR News","url":"https://feeds.npr.org/1001/rss.xml"}]}`
	for name, in := range map[string]map[string]interface{}{"nil": nil, "empty": {}} {
		stored, _ := json.Marshal(configOrDefault("news_npr", in))
		if string(stored) != want {
			t.Errorf("%s config stored %s, want %s", name, stored, want)
		}
	}
	own := map[string]interface{}{"feeds": []interface{}{}}
	if got := configOrDefault("news_npr", own); len(got) != 1 {
		t.Errorf("caller's config must be kept, got %v", got)
	}
	if got := configOrDefault("no_such_widget", nil); got == nil || len(got) != 0 {
		t.Errorf("no default = %v, want empty non-nil map", got)
	}
}

// SCROLLR-259: adding Stocks/Crypto with no config must not leave an empty
// widget. Symbols are already tracked in prod, so this costs no quota.
func TestConfigOrDefaultStarterWatchlists(t *testing.T) {
	for id, want := range map[string]string{
		"finance_stocks": `{"asset_class":"stock","symbols":["AAPL","MSFT","NVDA","AMZN","TSLA"]}`,
		"finance_crypto": `{"asset_class":"crypto","symbols":["BTC/USD","ETH/USD"]}`,
	} {
		stored, _ := json.Marshal(configOrDefault(id, map[string]interface{}{}))
		if string(stored) != want {
			t.Errorf("%s stored %s, want %s", id, stored, want)
		}
	}
}
