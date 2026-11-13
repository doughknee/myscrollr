package platform

import "testing"

func TestCompareVersions(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
	}{
		{"1.6.1", "1.6.2", -1},
		{"1.6.2", "1.6.2", 0},
		{"1.10.0", "1.9.0", 1},
		{"1.6", "1.6.0", 0},
		{"v1.7.3", "1.7.3", 0},
		{"1.8.0-beta.2", "1.8.0", -1},
		{"1.8.0", "1.8.0-beta.2", 1},
		{"1.8.0-beta.2", "1.7.3", 1},
		{"1.8.0-beta.2", "1.8.0-beta.10", -1},
		{"1.8.0-beta.1", "1.8.0-beta.2", -1},
		{"1.8.0-beta", "1.8.0-beta.1", -1},
		{"1.8.0-alpha.1", "1.8.0-beta.1", -1},
		{"1.8.0-1", "1.8.0-beta", -1},
		{"1.8.0+build5", "1.8.0", 0},
		{"", "1.6.2", -1},
		{"junk", "1.6.2", -1},
		{"1.6.2", "junk", 1},
		{"junk", "", 0},
	} {
		if got := CompareVersions(c.a, c.b); got != c.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestIsPrerelease(t *testing.T) {
	if !IsPrerelease("1.8.0-beta.2") || IsPrerelease("1.7.3") || IsPrerelease("junk-x") {
		t.Error("IsPrerelease wrong")
	}
}
