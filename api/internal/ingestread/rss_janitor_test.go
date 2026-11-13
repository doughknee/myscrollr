package ingestread

import "testing"

func TestJanitorSystemicFailure(t *testing.T) {
	cases := []struct {
		name        string
		dead, total int
		skip        bool
	}{
		{"healthy catalog, three dead", 3, 140, false},
		{"one in five dead", 28, 140, false},
		{"everything stale", 140, 140, true},
		{"just over half", 71, 140, true},
		{"exactly half", 70, 140, false},
		{"empty catalog", 0, 0, false},
		{"tiny catalog all dead", 4, 4, false},
		{"five of five dead", 5, 5, false},
		{"six of six dead", 6, 6, true},
	}
	for _, c := range cases {
		if got := janitorSystemicFailure(c.dead, c.total); got != c.skip {
			t.Errorf("%s: janitorSystemicFailure(%d,%d)=%v, want %v", c.name, c.dead, c.total, got, c.skip)
		}
	}
}
