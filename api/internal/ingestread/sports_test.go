package ingestread

// Ported from channels/sports/api/sports_test.go when the sports source
// was folded into core (ADR-0002, REL-15).

import "testing"

func TestFairShareSideSplit(t *testing.T) {
	tests := []struct {
		perLeague, wantUp, wantDown int
	}{
		{60, 30, 30}, // single-league widget at the dashboard limit
		{10, 5, 5},   // six leagues at limit 60
		{5, 3, 2},    // odd share — the extra slot goes to upcoming
		{3, 2, 1},
		{2, 1, 1}, // MinPerLeagueShare floor — both sides stay visible
		{1, 1, 0}, // degenerate: upcoming wins the only slot
	}
	for _, tt := range tests {
		up, down := fairShareSideSplit(tt.perLeague)
		if up != tt.wantUp || down != tt.wantDown {
			t.Errorf("fairShareSideSplit(%d) = (%d, %d), want (%d, %d)",
				tt.perLeague, up, down, tt.wantUp, tt.wantDown)
		}
		if up+down != tt.perLeague {
			t.Errorf("fairShareSideSplit(%d): sides sum to %d, must equal the share",
				tt.perLeague, up+down)
		}
	}
}

func TestExtractFavoriteTeamsFromConfig(t *testing.T) {
	got := extractFavoriteTeamsFromConfig([]byte(`{"favoriteTeams":{"NFL":{"teamId":12,"teamName":"Kansas City Chiefs"}}}`))
	if len(got) != 1 || got["NFL"].TeamName != "Kansas City Chiefs" || got["NFL"].TeamID != 12 {
		t.Fatalf("extractFavoriteTeamsFromConfig = %v", got)
	}
	if extractFavoriteTeamsFromConfig(nil) != nil {
		t.Error("nil config should return nil")
	}
	if extractFavoriteTeamsFromConfig([]byte(`not json`)) != nil {
		t.Error("invalid JSON should return nil")
	}

	names := extractFavoriteTeamNames(got)
	if len(names) != 1 || names[0] != "Kansas City Chiefs" {
		t.Errorf("extractFavoriteTeamNames = %v", names)
	}
	if n := extractFavoriteTeamNames(nil); len(n) != 0 {
		t.Errorf("extractFavoriteTeamNames(nil) = %v, want empty", n)
	}
}
