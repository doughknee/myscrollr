package ingestread

import (
	"context"
	_ "embed"
	"encoding/json"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

type ElectionRace struct {
	ID           int        `json:"id"`
	Name         string     `json:"name"`
	State        string     `json:"state"`
	ElectionDate string     `json:"election_date"`
	Office       string     `json:"office"`
	OfficeLabel  string     `json:"office_label"`
	District     string     `json:"district,omitempty"`
	Municipality string     `json:"municipality,omitempty"`
	ResultMode   string     `json:"result_mode"`
	VoteStatus   string     `json:"vote_status"`
	CheckedAt    *time.Time `json:"checked_at"`
	ChangedAt    *time.Time `json:"changed_at"`
}

//go:embed elections_catalog.json
var electionCatalog []byte

var electionRaces []ElectionRace
var electionByID = map[int]ElectionRace{}

var loadElectionDirectory = sync.OnceFunc(func() {
	if err := json.Unmarshal(electionCatalog, &electionRaces); err != nil {
		panic(err)
	}
	for _, race := range electionRaces {
		if race.ID <= 0 || electionByID[race.ID].ID != 0 {
			panic("invalid election catalog ID")
		}
		electionByID[race.ID] = race
	}
	prepareElectionDirectory()
})

func ElectionRaceSupported(id int) bool {
	loadElectionDirectory()
	_, ok := electionByID[id]
	return ok
}

type ElectionCandidate struct {
	ID      int      `json:"id"`
	Name    string   `json:"name"`
	Party   string   `json:"party"`
	Votes   int64    `json:"votes"`
	Percent *float64 `json:"percent"`
	Winner  bool     `json:"winner"`
}

type ElectionResult struct {
	ResultMode   string     `json:"result_mode,omitempty"`
	SnapshotKind string     `json:"snapshot_kind,omitempty"`
	ObservedAt   *time.Time `json:"observed_at,omitempty"`

	ID               int                 `json:"id"`
	Name             string              `json:"name"`
	State            string              `json:"state"`
	ElectionDate     string              `json:"election_date"`
	SourceUpdatedAt  *time.Time          `json:"source_updated_at"`
	PercentReporting *float64            `json:"percent_reporting"`
	Delayed          bool                `json:"delayed"`
	Disputed         bool                `json:"disputed"`
	Candidates       []ElectionCandidate `json:"candidates"`
}

func (r ElectionRace) pendingResult() ElectionResult {
	return ElectionResult{ID: r.ID, Name: r.Name, State: r.State, ElectionDate: r.ElectionDate,
		ResultMode: r.ResultMode, Candidates: []ElectionCandidate{}}
}

func HandleElectionRaces(c *fiber.Ctx) error {
	if !platform.ElectionsBetaEnabled() {
		return c.SendStatus(fiber.StatusNotFound)
	}
	loadElectionDirectory()
	return c.JSON([]ElectionRace{electionByID[platform.LegacyElectionRaceID]})
}

var electionsSource = localSource{dashboard: electionsDashboard}

func electionsDashboard(ctx context.Context, sub string) map[string]interface{} {
	return ElectionDashboardForClient(ctx, sub, true)
}

func ElectionDashboardForClient(ctx context.Context, sub string, national bool) map[string]interface{} {
	if !platform.ElectionsBetaEnabled() {
		return nil
	}
	results, err := followedElectionResults(ctx, sub, national)
	if err != nil {
		log.Printf("[Elections] load followed races: %v", err)
		return nil
	}
	return map[string]interface{}{"elections": results}
}

func followedElectionResults(ctx context.Context, sub string, national bool) ([]ElectionResult, error) {
	loadElectionDirectory()
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	// Read at most the user's 12 follows in configured order. Do not pass a
	// national catalog to PostgreSQL on every dashboard poll. Malformed
	// legacy values cannot cause a lookup or unsafe integer cast.
	rows, err := platform.DBPool.Query(ctx, `
        SELECT f.id::text, res.snapshot, COALESCE(res.failures>0 OR res.verified_until<now(),false),
          COALESCE(res.next_poll_at <> 'infinity'::timestamptz,true)
        FROM user_widgets w CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(w.config->'race_ids')='array' THEN w.config->'race_ids' ELSE '[]'::jsonb END
        ) WITH ORDINALITY f(id,ord)
        LEFT JOIN election_results res ON res.race_id = CASE
            WHEN jsonb_typeof(f.id)='number' AND f.id::text ~ '^[1-9][0-9]{0,9}$' THEN f.id::text::bigint END
        WHERE w.logto_sub=$1 AND w.widget_type='elections' AND w.enabled
        ORDER BY f.ord LIMIT 12`, sub)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ElectionResult, 0)
	for rows.Next() {
		var rawID string
		var data []byte
		var delayed, useDirectory bool
		if err := rows.Scan(&rawID, &data, &delayed, &useDirectory); err != nil {
			return nil, err
		}
		id, err := strconv.Atoi(rawID)
		race, ok := electionByID[id]
		if err != nil || !ok || (!national && id != platform.LegacyElectionRaceID) {
			continue
		}
		result := race.pendingResult()
		if len(data) != 0 {
			if err := json.Unmarshal(data, &result); err != nil {
				return nil, err
			}
			result.SnapshotKind = "detail"
			result.ResultMode = race.ResultMode
		}
		if seed, ok := electionSeeds[id]; national && useDirectory && ok && (len(data) == 0 || detailPredatesObservedChange(result, race, seed)) {
			delayed = delayed || len(data) > 0
			result = race.pendingResult()
			result.Candidates = seed.Candidates
			result.PercentReporting = seed.PercentReporting
			result.ObservedAt = &seed.ObservedAt
			result.SnapshotKind = "directory"
			result.ResultMode = "counts_only"
		}
		if result.ResultMode != "single_seat" && result.SnapshotKind == "detail" {
			// Includes pre-existing snapshots if a race is reclassified.
			for i := range result.Candidates {
				result.Candidates[i].Winner = false
			}
		}
		result.Delayed = delayed
		out = append(out, result)
	}
	return out, rows.Err()
}
