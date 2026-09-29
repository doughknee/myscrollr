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
