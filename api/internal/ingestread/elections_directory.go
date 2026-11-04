package ingestread

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

//go:embed elections_coverage.json
var coverageJSON []byte

//go:embed elections_seed.json.gz
var electionSeedGzip []byte

type ElectionStateCoverage struct {
	State     string `json:"state"`
	Status    string `json:"status"`
	RaceCount int    `json:"race_count"`
}
type ElectionCoverage struct {
	PreviousCheckedAt *time.Time              `json:"previous_checked_at,omitempty"`
	CheckedAt         time.Time               `json:"checked_at"`
	States            []ElectionStateCoverage `json:"states"`
}
type ElectionSearch struct {
	Races []ElectionRace `json:"races"`
	Total int            `json:"total"`
}
type directorySeed struct {
	ChangeAfter      *time.Time          `json:"change_after,omitempty"`
	Candidates       []ElectionCandidate `json:"candidates"`
	PercentReporting *float64            `json:"percent_reporting"`
	ObservedAt       time.Time           `json:"observed_at"`
}

var electionCoverage ElectionCoverage
var electionSeeds map[int]directorySeed
var electionTerms = map[int]string{}

var stateNames = map[string]string{
	"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
	"CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
	"HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
	"KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
	"MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
	"NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
	"ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
	"RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
	"UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
	"WI": "Wisconsin", "WY": "Wyoming",
}

func evidenceOrder(r ElectionRace) int {
	local := r.Office == "mayor" || r.Office == "city_council"
	switch {
	case local && r.ChangedAt != nil:
		return 0
	case local && r.VoteStatus == "votes_reported":
		return 1
	case r.ChangedAt != nil:
		return 2
	case r.VoteStatus == "votes_reported":
		return 3
	default:
		return 4
	}
}

// Parse and index only when a preview path needs the directory. Ordinary
// production requests never pay the cost of decoding a national election.
func prepareElectionDirectory() {
	if err := json.Unmarshal(coverageJSON, &electionCoverage); err != nil {
		panic(err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(electionSeedGzip))
	if err != nil {
		panic(err)
	}
	defer reader.Close()
	if err := json.NewDecoder(reader).Decode(&electionSeeds); err != nil {
		panic(err)
	}
	for id, seed := range electionSeeds {
		if _, ok := electionByID[id]; !ok || seed.ObservedAt.IsZero() || len(seed.Candidates) == 0 {
			panic("invalid election directory seed")
		}
		for i := range seed.Candidates {
			seed.Candidates[i].Winner = false
		}
	}
	counts := map[string]int{}
	for _, r := range electionRaces {
		counts[r.State]++
		electionTerms[r.ID] = strings.ToLower(strings.Join([]string{r.Name, r.State, stateNames[r.State], r.Municipality, r.District, r.OfficeLabel, strings.ReplaceAll(r.Office, "_", " ")}, " "))
	}
	for i := range electionCoverage.States {
		s := &electionCoverage.States[i]
		s.RaceCount = counts[s.State]
	}
	sort.Slice(electionRaces, func(i, j int) bool {
		a, b := electionRaces[i], electionRaces[j]
		if x, y := evidenceOrder(a), evidenceOrder(b); x != y {
			return x < y
		}
		if a.State != b.State {
			return a.State < b.State
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.ID < b.ID
	})
}

// One observation cannot order a correction: the directory has no provider
// update timestamp. Two observations with changed vote counts establish a
// window. Ignore conflicting detail only when it predates that entire window.
func detailPredatesObservedChange(detail ElectionResult, race ElectionRace, seed directorySeed) bool {
	start := electionCoverage.PreviousCheckedAt
	if race.ChangedAt == nil || start == nil || !race.ChangedAt.After(*start) || seed.ObservedAt.Before(*race.ChangedAt) || detail.SourceUpdatedAt == nil || !detail.SourceUpdatedAt.Before(*start) {
		return false
	}
	if len(detail.Candidates) != len(seed.Candidates) {
		return true
	}
	votes := make(map[int]int64, len(detail.Candidates))
	for _, c := range detail.Candidates {
		votes[c.ID] = c.Votes
	}
	for _, c := range seed.Candidates {
		if v, ok := votes[c.ID]; !ok || v != c.Votes {
			return true
		}
	}
	return false
}

func nationalDirectoryRequested(c *fiber.Ctx) bool {
	return c.Query("preview") == platform.NationalElectionPreview && platform.ElectionsBetaEnabled()
}

func HandleElectionCoverage(c *fiber.Ctx) error {
	if !nationalDirectoryRequested(c) {
		return c.SendStatus(fiber.StatusNotFound)
	}
	loadElectionDirectory()
	c.Set("Cache-Control", "public, max-age=300")
	return c.JSON(electionCoverage)
}

func HandleElectionSearch(c *fiber.Ctx) error {
	if !nationalDirectoryRequested(c) {
		return c.SendStatus(fiber.StatusNotFound)
	}
	loadElectionDirectory()
	c.Set("Cache-Control", "public, max-age=300")
	result := ElectionSearch{Races: []ElectionRace{}}
	if raw := c.Query("ids"); raw != "" {
		ids := strings.Split(raw, ",")
		if len(ids) > 12 {
			return c.SendStatus(fiber.StatusBadRequest)
		}
		for _, item := range ids {
			id, err := strconv.Atoi(item)
			if err != nil || id < 1 {
				return c.SendStatus(fiber.StatusBadRequest)
			}
			if race, ok := electionByID[id]; ok {
				result.Races = append(result.Races, race)
			}
		}
		result.Total = len(result.Races)
		return c.JSON(result)
	}
	limit, err := strconv.Atoi(c.Query("limit", "60"))
	if err != nil || limit < 1 || limit > 100 {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	offset, err := strconv.Atoi(c.Query("offset", "0"))
	if err != nil || offset < 0 {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	state := strings.ToUpper(c.Query("state"))
	office := c.Query("office")
	activity := c.Query("activity")
	if len(c.Query("q")) > 200 || (activity != "" && activity != "votes_reported" && activity != "changed") {
		return c.SendStatus(fiber.StatusBadRequest)
	}
	terms := strings.Fields(strings.ToLower(c.Query("q")))
	for _, race := range electionRaces {
		if state != "" && race.State != state {
			continue
		}
		if office != "" && office != race.Office && !(office == "federal" && (race.Office == "us_house" || race.Office == "us_senate" || race.Office == "us_delegate")) {
			continue
		}
		if activity == "votes_reported" && race.VoteStatus != "votes_reported" || activity == "changed" && race.ChangedAt == nil {
			continue
		}
		match := true
		for _, term := range terms {
			if !strings.Contains(electionTerms[race.ID], term) {
				match = false
				break
			}
		}
		if !match {
			continue
		}
		if result.Total >= offset && len(result.Races) < limit {
			result.Races = append(result.Races, race)
		}
		result.Total++
	}
	return c.JSON(result)
}
