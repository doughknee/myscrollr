package support

import (
	"testing"
	"time"
)

func TestThreadMessageTimeAcceptsPluginAndExportFormats(t *testing.T) {
	want := time.Date(2026, 10, 8, 9, 47, 2, 0, time.UTC)
	for _, value := range []string{"2026-10-08 09:47:02", "2026-10-08T09:47:02Z", "2026-10-08T04:47:02-05:00"} {
		if got := parseThreadMessageTime(value); !got.Equal(want) {
			t.Errorf("%q = %v; want %v", value, got, want)
		}
	}
	for _, value := range []string{"", "yesterday", "2026-13-08 09:47:02"} {
		if !parseThreadMessageTime(value).IsZero() {
			t.Errorf("accepted invalid timestamp %q", value)
		}
	}
}
