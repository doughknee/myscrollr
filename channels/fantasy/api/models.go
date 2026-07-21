package main

import (
	"encoding/json"
	"encoding/xml"
)

// =============================================================================
// Yahoo Fantasy XML Types — Parsed from Yahoo API responses
//
// Yahoo returns XML with a top-level <fantasy_content> wrapper.  Each endpoint
// nests data differently.  These structs mirror the XML structure so
// encoding/xml can unmarshal directly.
//
// Field names use xml tags matching Yahoo's element names.  Optional/nullable
// fields use pointer types since Yahoo may omit them.
// =============================================================================

// ---------------------------------------------------------------------------
// Top-level wrapper (shared by all endpoints)
// ---------------------------------------------------------------------------

// FantasyContent is the root XML element for every Yahoo Fantasy API response.
type FantasyContent struct {
	XMLName xml.Name     `xml:"fantasy_content" json:"-"`
	Users   *XMLUsers    `xml:"users,omitempty" json:"users,omitempty"`
	League  *XMLLeague   `xml:"league,omitempty" json:"league,omitempty"`
	Team    *XMLTeamFull `xml:"team,omitempty" json:"team,omitempty"`
}

// ---------------------------------------------------------------------------
// Users / GUID resolution  (GET .../users;use_login=1)
// ---------------------------------------------------------------------------

type XMLUsers struct {
	User []XMLUser `xml:"user" json:"user"`
}

type XMLUser struct {
	Guid  string       `xml:"guid" json:"guid"`
	Games *XMLUserGame `xml:"games,omitempty" json:"games,omitempty"`
}

// ---------------------------------------------------------------------------
// Leagues  (GET .../users;use_login=1/games;game_keys={id}/leagues)
// ---------------------------------------------------------------------------

type XMLUserGame struct {
	Game []XMLGame `xml:"game" json:"game"`
}

type XMLGame struct {
	GameKey string     `xml:"game_key" json:"game_key"`
	Leagues XMLLeagues `xml:"leagues" json:"leagues"`
}

type XMLLeagues struct {
	League []XMLLeague `xml:"league" json:"league"`
}

type XMLLeague struct {
	LeagueKey   string  `xml:"league_key" json:"league_key"`
	LeagueID    string  `xml:"league_id" json:"league_id"`
	Name        string  `xml:"name" json:"name"`
	URL         string  `xml:"url" json:"url"`
	LogoURL     string  `xml:"logo_url" json:"logo_url"`
	DraftStatus string  `xml:"draft_status" json:"draft_status"`
	NumTeams    string  `xml:"num_teams" json:"num_teams"`
	ScoringType string  `xml:"scoring_type" json:"scoring_type"`
	LeagueType  string  `xml:"league_type" json:"league_type"`
	CurrentWeek *string `xml:"current_week" json:"current_week"`
	StartWeek   *string `xml:"start_week" json:"start_week"`
	EndWeek     *string `xml:"end_week" json:"end_week"`
	IsFinished  *string `xml:"is_finished" json:"is_finished"`
	Season      string  `xml:"season" json:"season"`

	// Nested resources (populated by standings/teams endpoints)
	Standings  *XMLStandings      `xml:"standings,omitempty" json:"standings,omitempty"`
	Scoreboard *XMLScoreboard     `xml:"scoreboard,omitempty" json:"scoreboard,omitempty"`
	Teams      *XMLTeams          `xml:"teams,omitempty" json:"teams,omitempty"`
	Settings   *XMLLeagueSettings `xml:"settings,omitempty" json:"settings,omitempty"`
}

// ---------------------------------------------------------------------------
// Standings  (GET .../league/{id}/standings)
// ---------------------------------------------------------------------------

type XMLStandings struct {
	Teams XMLTeams `xml:"teams" json:"teams"`
}

type XMLTeams struct {
	Team []XMLTeamStanding `xml:"team" json:"team"`
}

type XMLTeamStanding struct {
	TeamKey           string        `xml:"team_key" json:"team_key"`
	TeamID            string        `xml:"team_id" json:"team_id"`
	Name              string        `xml:"name" json:"name"`
	URL               string        `xml:"url" json:"url"`
	TeamLogos         *XMLTeamLogos `xml:"team_logos,omitempty" json:"team_logos,omitempty"`
	TeamLogo          string        `xml:"team_logo" json:"team_logo"`
	Managers          *XMLManagers  `xml:"managers,omitempty" json:"managers,omitempty"`
	ClinchPlayoffs    *string       `xml:"clinched_playoffs,omitempty" json:"clinched_playoffs,omitempty"`
	WaiverPriority    *string       `xml:"waiver_priority,omitempty" json:"waiver_priority,omitempty"`
	TeamStandingsData *XMLTeamStats `xml:"team_standings,omitempty" json:"team_standings,omitempty"`
}

type XMLTeamLogos struct {
	TeamLogo []XMLTeamLogoEntry `xml:"team_logo" json:"team_logo"`
}

type XMLTeamLogoEntry struct {
	Size string `xml:"size" json:"size"`
	URL  string `xml:"url" json:"url"`
}

type XMLManagers struct {
	Manager []XMLManager `xml:"manager" json:"manager"`
}

type XMLManager struct {
	ManagerID string `xml:"manager_id" json:"manager_id"`
	Nickname  string `xml:"nickname" json:"nickname"`
	Guid      string `xml:"guid" json:"guid"`
}

type XMLTeamStats struct {
	Rank          *string     `xml:"rank" json:"rank"`
	PlayoffSeed   *string     `xml:"playoff_seed" json:"playoff_seed"`
	OutcomeTotals *XMLOutcome `xml:"outcome_totals" json:"outcome_totals"`
	Streak        *XMLStreak  `xml:"streak" json:"streak"`
	GamesBack     *string     `xml:"games_back" json:"games_back"`
	PointsFor     *string     `xml:"points_for" json:"points_for"`
	PointsAgainst *string     `xml:"points_against" json:"points_against"`
}

type XMLOutcome struct {
	Wins       string `xml:"wins" json:"wins"`
	Losses     string `xml:"losses" json:"losses"`
	Ties       string `xml:"ties" json:"ties"`
	Percentage string `xml:"percentage" json:"percentage"`
}

type XMLStreak struct {
	Type  string `xml:"type" json:"type"`
	Value string `xml:"value" json:"value"`
}

// ---------------------------------------------------------------------------
// Scoreboard / Matchups  (GET .../league/{id}/scoreboard;week={n})
// ---------------------------------------------------------------------------

type XMLScoreboard struct {
	Week     string      `xml:"week" json:"week"`
	Matchups XMLMatchups `xml:"matchups" json:"matchups"`
}

type XMLMatchups struct {
	Matchup []XMLMatchup `xml:"matchup" json:"matchup"`
}

type XMLMatchup struct {
	Week          string          `xml:"week" json:"week"`
	WeekStart     string          `xml:"week_start" json:"week_start"`
	WeekEnd       string          `xml:"week_end" json:"week_end"`
	Status        string          `xml:"status" json:"status"`
	IsPlayoffs    string          `xml:"is_playoffs" json:"is_playoffs"`
	IsConsolation string          `xml:"is_consolation" json:"is_consolation"`
	IsTied        string          `xml:"is_tied" json:"is_tied"`
	WinnerTeamKey string          `xml:"winner_team_key" json:"winner_team_key"`
	Teams         XMLMatchupTeams `xml:"teams" json:"teams"`
}

type XMLMatchupTeams struct {
	Team []XMLMatchupTeam `xml:"team" json:"team"`
}

type XMLMatchupTeam struct {
	TeamKey             string         `xml:"team_key" json:"team_key"`
	TeamID              string         `xml:"team_id" json:"team_id"`
	Name                string         `xml:"name" json:"name"`
	TeamLogos           *XMLTeamLogos  `xml:"team_logos,omitempty" json:"team_logos,omitempty"`
	TeamLogo            string         `xml:"team_logo" json:"team_logo"`
	Managers            *XMLManagers   `xml:"managers,omitempty" json:"managers,omitempty"`
	TeamPoints          *XMLTeamPoints `xml:"team_points,omitempty" json:"team_points,omitempty"`
	TeamProjectedPoints *XMLTeamPoints `xml:"team_projected_points,omitempty" json:"team_projected_points,omitempty"`
}

type XMLTeamPoints struct {
	CoverageType string `xml:"coverage_type" json:"coverage_type"`
	Week         string `xml:"week" json:"week"`
	Total        string `xml:"total" json:"total"`
}

// ---------------------------------------------------------------------------
// Roster / Players  (GET .../team/{id}/roster;)
// ---------------------------------------------------------------------------

type XMLTeamFull struct {
	TeamKey string     `xml:"team_key" json:"team_key"`
	TeamID  string     `xml:"team_id" json:"team_id"`
	Name    string     `xml:"name" json:"name"`
	Roster  *XMLRoster `xml:"roster,omitempty" json:"roster,omitempty"`
}

type XMLRoster struct {
	CoverageType string     `xml:"coverage_type" json:"coverage_type"`
	Week         string     `xml:"week" json:"week"`
	Players      XMLPlayers `xml:"players" json:"players"`
}

type XMLPlayers struct {
	Player []XMLPlayer `xml:"player" json:"player"`
}

type XMLPlayer struct {
	PlayerKey             string               `xml:"player_key" json:"player_key"`
	PlayerID              string               `xml:"player_id" json:"player_id"`
	Name                  XMLPlayerName        `xml:"name" json:"name"`
	EditorialTeamAbbr     string               `xml:"editorial_team_abbr" json:"editorial_team_abbr"`
	EditorialTeamFullName string               `xml:"editorial_team_full_name" json:"editorial_team_full_name"`
	DisplayPosition       string               `xml:"display_position" json:"display_position"`
	ImageURL              string               `xml:"image_url" json:"image_url"`
	PositionType          string               `xml:"position_type" json:"position_type"`
	Status                string               `xml:"status" json:"status"`
	StatusFull            string               `xml:"status_full" json:"status_full"`
	InjuryNote            string               `xml:"injury_note" json:"injury_note"`
	SelectedPosition      *XMLSelectedPosition `xml:"selected_position,omitempty" json:"selected_position,omitempty"`
	EligiblePositions     *XMLEligiblePos      `xml:"eligible_positions,omitempty" json:"eligible_positions,omitempty"`
	PlayerPoints          *XMLPlayerPoints     `xml:"player_points,omitempty" json:"player_points,omitempty"`
	PlayerStats           *XMLPlayerStats      `xml:"player_stats,omitempty" json:"player_stats,omitempty"`
}

type XMLPlayerName struct {
	Full  string `xml:"full" json:"full"`
	First string `xml:"first" json:"first"`
	Last  string `xml:"last" json:"last"`
}

type XMLSelectedPosition struct {
	CoverageType string `xml:"coverage_type" json:"coverage_type"`
	Week         string `xml:"week" json:"week"`
	Position     string `xml:"position" json:"position"`
}

type XMLEligiblePos struct {
	Position []string `xml:"position" json:"position"`
}

type XMLPlayerPoints struct {
	CoverageType string `xml:"coverage_type" json:"coverage_type"`
	Week         string `xml:"week" json:"week"`
	Total        string `xml:"total" json:"total"`
}

// XMLPlayerStats captures per-category stat values. Present in category
// leagues (e.g. MLB head-to-head cats) where <player_points> is absent.
type XMLPlayerStats struct {
	CoverageType string   `xml:"coverage_type" json:"coverage_type"`
	Week         string   `xml:"week" json:"week"`
	Stats        XMLStats `xml:"stats" json:"stats"`
}

type XMLStats struct {
	Stat []XMLStat `xml:"stat" json:"stat"`
}

type XMLStat struct {
	StatID string `xml:"stat_id" json:"stat_id"`
	Value  string `xml:"value" json:"value"`
}

// XMLLeagueSettings mirrors <league_settings> from the league/settings endpoint.
// We only need the stat_categories + stat_modifiers to compute synthetic points.
type XMLLeagueSettings struct {
	StatCategories XMLStatCategories `xml:"stat_categories" json:"stat_categories"`
	StatModifiers  XMLStatModifiers  `xml:"stat_modifiers" json:"stat_modifiers"`
}

type XMLStatCategories struct {
	Stats XMLStatDefs `xml:"stats" json:"stats"`
}

type XMLStatDefs struct {
	Stat []XMLStatDef `xml:"stat" json:"stat"`
}

type XMLStatDef struct {
	StatID            string `xml:"stat_id" json:"stat_id"`
	Enabled           string `xml:"enabled" json:"enabled"`
	Name              string `xml:"name" json:"name"`
	DisplayName       string `xml:"display_name" json:"display_name"`
	SortOrder         string `xml:"sort_order" json:"sort_order"`
	PositionType      string `xml:"position_type" json:"position_type"`
	IsOnlyDisplayStat string `xml:"is_only_display_stat" json:"is_only_display_stat"`
}

// StatCatalogEntry is the trimmed, JSON-serializable stat definition we
// persist per league and ship to the frontend. Mirrors Yahoo's
// <stat_categories><stat> element but only the fields the UI actually
// needs for labelling and ordering.
type StatCatalogEntry struct {
	StatID       string `json:"stat_id"`
	DisplayName  string `json:"display_name"`
	Name         string `json:"name,omitempty"`
	PositionType string `json:"position_type"`
	SortOrder    int    `json:"sort_order"`
	DisplayOnly  bool   `json:"display_only"`
}

// LeagueStatCatalog is the full per-league stats definition (labels +
// scoring modifiers) returned by GetLeagueStatCatalog. Shipped with each
// LeagueResponse so the frontend can render stat labels authoritatively.
type LeagueStatCatalog struct {
	Stats []StatCatalogEntry `json:"stats"`
	// Modifiers is stat_id → point multiplier for points leagues. Empty
	// map (not nil) for categories-only leagues.
	Modifiers map[string]float64 `json:"modifiers"`
}

type XMLStatModifiers struct {
	Stats XMLStatModifierList `xml:"stats" json:"stats"`
}

type XMLStatModifierList struct {
	Stat []XMLStatModifier `xml:"stat" json:"stat"`
}

type XMLStatModifier struct {
	StatID string `xml:"stat_id" json:"stat_id"`
	Value  string `xml:"value" json:"value"`
}

// =============================================================================
// API Response Types — Postgres-backed
// =============================================================================

// YahooStatusResponse returns whether user has Yahoo connected.
type YahooStatusResponse struct {
	Connected bool `json:"connected"`
	Synced    bool `json:"synced"`
}

// LeagueResponse is a single league with all associated data.
type LeagueResponse struct {
	LeagueKey        string          `json:"league_key"`
	Name             string          `json:"name"`
	GameCode         string          `json:"game_code"`
	Season           string          `json:"season"`
	TeamKey          *string         `json:"team_key"`
	TeamName         *string         `json:"team_name"`
	Data             json.RawMessage `json:"data"`
	Standings        json.RawMessage `json:"standings,omitempty"`
	Matchups         json.RawMessage `json:"matchups,omitempty"`
	PreviousMatchups json.RawMessage `json:"previous_matchups,omitempty"`
	Rosters          json.RawMessage `json:"rosters,omitempty"`
}

// MyLeaguesResponse is the response for GET /users/me/yahoo-leagues.
type MyLeaguesResponse struct {
	Leagues []LeagueResponse `json:"leagues"`
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
