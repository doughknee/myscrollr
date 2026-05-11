package main

import "time"

// Game represents a sports game from the api-sports.io ingestion service.
type Game struct {
	ID             int       `json:"id"`
	League         string    `json:"league"`
	Sport          string    `json:"sport"`
	ExternalGameID string    `json:"external_game_id"`
	Link           string    `json:"link"`
	HomeTeamName   string    `json:"home_team_name"`
	HomeTeamLogo   string    `json:"home_team_logo"`
	HomeTeamScore  string    `json:"home_team_score"`
	HomeTeamCode   string    `json:"home_team_code"`
	AwayTeamName   string    `json:"away_team_name"`
	AwayTeamLogo   string    `json:"away_team_logo"`
	AwayTeamScore  string    `json:"away_team_score"`
	AwayTeamCode   string    `json:"away_team_code"`
	StartTime      time.Time `json:"start_time"`
	ShortDetail    string    `json:"short_detail"`
	State          string    `json:"state"`
	StatusShort    string    `json:"status_short,omitempty"`
	StatusLong     string    `json:"status_long,omitempty"`
	Timer          string    `json:"timer,omitempty"`
	Venue          string    `json:"venue,omitempty"`
	Season         string    `json:"season,omitempty"`
}

// TrackedLeague represents a league entry from the catalog, enriched with
// current game activity counts and polling-health for the dashboard league browser.
type TrackedLeague struct {
	Name              string     `json:"name"`
	SportAPI          string     `json:"sport_api"`
	Category          string     `json:"category"`
	Country           string     `json:"country"`
	LogoURL           string     `json:"logo_url"`
	GameCount         int        `json:"game_count"`
	LiveCount         int        `json:"live_count"`
	NextGame          *time.Time `json:"next_game,omitempty"`
	IsOffseason       bool       `json:"is_offseason"`
	LastPolledAt      *time.Time `json:"last_polled_at,omitempty"`
	LastPollSuccessAt *time.Time `json:"last_poll_success_at,omitempty"`
	PollingHealthy    bool       `json:"polling_healthy"`
	OffseasonMonths   []int32    `json:"-"` // internal, not serialized
}

// LeagueMeta is the per-league summary attached to dashboard + public
// sports responses. Lets the desktop empty-state component explain WHY a
// league has no games right now (off-season, next game soon, polling
// stale, or genuinely nothing scheduled).
type LeagueMeta struct {
	Name           string     `json:"name"`
	IsOffseason    bool       `json:"is_offseason"`
	NextGame       *time.Time `json:"next_game,omitempty"`
	PollingHealthy bool       `json:"polling_healthy"`
}

// SportsResponse is the new shape returned by /sports, /sports/public,
// and /internal/dashboard. Game array stays under "sports" for backwards
// compatibility; per-league context lives under "meta".
type SportsResponse struct {
	Sports []Game     `json:"sports"`
	Meta   SportsMeta `json:"meta"`
}

// SportsMeta wraps per-league context.
type SportsMeta struct {
	Leagues []LeagueMeta `json:"leagues"`
}

// CDCRecord represents a Change Data Capture record from Sequin.
type CDCRecord struct {
	Action   string                 `json:"action"`
	Record   map[string]interface{} `json:"record"`
	Changes  map[string]interface{} `json:"changes"`
	Metadata struct {
		TableSchema string `json:"table_schema"`
		TableName   string `json:"table_name"`
	} `json:"metadata"`
}

// ErrorResponse represents a standard API error.
type ErrorResponse struct {
	Status string `json:"status"`
	Error  string `json:"error"`
}

// Standing represents a league standing entry.
type Standing struct {
	League        string `json:"league"`
	TeamName      string `json:"team_name"`
	TeamCode      string `json:"team_code"`
	TeamLogo      string `json:"team_logo"`
	Rank          int    `json:"rank"`
	Wins          int    `json:"wins"`
	Losses        int    `json:"losses"`
	Draws         int    `json:"draws"`
	Points        int    `json:"points"`
	GamesPlayed   int    `json:"games_played"`
	GoalDiff      int    `json:"goal_diff"`
	Description   string `json:"description,omitempty"`
	Form          string `json:"form,omitempty"`
	GroupName     string `json:"group_name,omitempty"`
	SportAPI      string `json:"sport_api,omitempty"`
	Pct           string `json:"pct,omitempty"`
	GamesBehind   string `json:"games_behind,omitempty"`
	OTL           int    `json:"otl,omitempty"`
	GoalsFor      int    `json:"goals_for,omitempty"`
	GoalsAgainst  int    `json:"goals_against,omitempty"`
	PointsFor     int    `json:"points_for,omitempty"`
	PointsAgainst int    `json:"points_against,omitempty"`
	Streak        string `json:"streak,omitempty"`
}

// TeamInfo represents a team entry from the teams table.
type TeamInfo struct {
	League     string `json:"league"`
	ExternalID int    `json:"external_id"`
	Name       string `json:"name"`
	Code       string `json:"code"`
	Logo       string `json:"logo"`
	Country    string `json:"country,omitempty"`
}

// FavoriteTeam represents a user's favorite team for a specific league.
type FavoriteTeam struct {
	TeamID   int    `json:"teamId"`
	TeamName string `json:"teamName"`
}
