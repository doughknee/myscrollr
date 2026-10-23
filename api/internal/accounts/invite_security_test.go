package accounts

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInviteLookupRequiresUniqueExactEmail(t *testing.T) {
	for _, tc := range []struct {
		body    string
		allowed bool
	}{
		{`[{"id":"wrong","primaryEmail":"firstXlast@example.test"}]`, false},
		{`[{"id":"wrong"}]`, false},
		{`[{"id":"one","primaryEmail":"first_last@example.test"},{"id":"two","primaryEmail":"first_last@example.test"}]`, false},
		{`[{"id":"right","primaryEmail":"FIRST_LAST@example.test","username":"existing"}]`, true},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("mode.primaryEmail") != "exact" {
				t.Error("identity search did not request exact mode")
			}
			w.Write([]byte(tc.body))
		}))
		id, _, err := findUserByEmail(srv.URL, "fixture", "first_last@example.test")
		srv.Close()
		if tc.allowed {
			if err != nil || id != "right" {
				t.Fatalf("exact match failed: %q %v", id, err)
			}
		} else if err == nil || id != "" {
			t.Fatal("mismatched or ambiguous account accepted")
		}
	}
}
