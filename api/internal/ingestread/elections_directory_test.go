package ingestread

import (
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

func TestNationalPickerSearchAndStateCoverage(t *testing.T) {
	t.Setenv("ELECTIONS_BETA_ENABLED", "true")
	app := fiber.New()
	app.Get("/search", HandleElectionSearch)
	app.Get("/coverage", HandleElectionCoverage)
	app.Get("/races", HandleElectionRaces)
	get := func(path string, target any, want int) {
		t.Helper()
		resp, err := app.Test(httptest.NewRequest("GET", path, nil), 10000)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("%s returned %d", path, resp.StatusCode)
		}
		if target != nil {
			if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
				t.Fatal(err)
			}
		}
	}
	cap := "?preview=" + platform.NationalElectionPreview
	var coverage ElectionCoverage
	get("/coverage"+cap, &coverage, 200)
	states := map[string]bool{}
	count := 0
	for _, st := range coverage.States {
		if states[st.State] || stateNames[st.State] == "" {
			t.Fatalf("invalid/duplicate state %q", st.State)
		}
		states[st.State] = true
		count += st.RaceCount
	}
	if len(states) != 51 || count != len(electionRaces) || coverage.CheckedAt.IsZero() {
		t.Fatalf("incomplete coverage: %d states %d rows", len(states), count)
	}
	var page, next ElectionSearch
	get("/search"+cap+"&limit=1&office=city_council&activity=votes_reported", &page, 200)
	get("/search"+cap+"&limit=1&offset=1&office=city_council&activity=votes_reported", &next, 200)
	if len(page.Races) != 1 || len(next.Races) != 1 || page.Total != next.Total || page.Total < 2 || page.Races[0].ID == next.Races[0].ID {
		t.Fatal("invalid pagination")
	}
	selected := page.Races[0]
	get("/search"+cap+"&ids="+strconv.Itoa(selected.ID)+",87476", &next, 200)
	if len(next.Races) != 2 || next.Races[0].ID != selected.ID || next.Races[1].ID != 87476 {
		t.Fatal(next)
	}
	get("/search"+cap+"&state=TN&office=federal&q=tennessee", &page, 200)
	if len(page.Races) == 0 {
		t.Fatal("missing Tennessee federal races")
	}
	for _, r := range page.Races {
		if r.State != "TN" || (r.Office != "us_house" && r.Office != "us_senate") {
			t.Fatal(r)
		}
	}
	get("/search"+cap+"&state=DC&office=federal", &page, 200)
	if page.Total != 1 || page.Races[0].Office != "us_delegate" || page.Races[0].District != "DC-AL" {
		t.Fatal("missing nonvoting DC delegate", page)
	}
	get("/search"+cap+"&limit=1000", nil, 400)
	get("/search?preview=elections", nil, 404)
	var original []ElectionRace
	get("/races", &original, 200)
	if len(original) != 1 || original[0].ID != 87476 {
		t.Fatal("legacy renderer received national races")
	}
	t.Setenv("ELECTIONS_BETA_ENABLED", "false")
	get("/search"+cap, nil, 404)
}

func TestDirectoryOnlySupersedesProvablyOlderConflictingDetail(t *testing.T) {
	loadElectionDirectory()
	before := electionCoverage.PreviousCheckedAt.Add(-time.Minute)
	after := electionCoverage.CheckedAt
	current := after.Add(time.Minute)
	seed := directorySeed{ObservedAt: after, Candidates: []ElectionCandidate{{ID: 2, Votes: 5}, {ID: 1, Votes: 10}}}
	race := ElectionRace{ChangedAt: &after}
	detail := ElectionResult{SourceUpdatedAt: &before, Candidates: []ElectionCandidate{{ID: 1, Votes: 9}, {ID: 2, Votes: 5}}}
	if !detailPredatesObservedChange(detail, race, seed) {
		t.Fatal("accepted stale conflicting detail")
	}
	detail.Candidates[0].Votes = 10
	if detailPredatesObservedChange(detail, race, seed) {
		t.Fatal("discarded matching counts with a different sort order")
	}
	detail.Candidates[0].Votes = 8
	detail.SourceUpdatedAt = &current
	if detailPredatesObservedChange(detail, race, seed) {
		t.Fatal("discarded a newer downward correction")
	}
	race.ChangedAt = nil
	detail.SourceUpdatedAt = &before
	if detailPredatesObservedChange(detail, race, seed) {
		t.Fatal("a single directory reading cannot order differing tallies")
	}
}
