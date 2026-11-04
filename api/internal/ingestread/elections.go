package ingestread

import (
	"context"
	_ "embed"
	"encoding/json"
	"log"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// Only verified single-seat contests enter the beta catalog. A client can choose
// an ID, but cannot supply an upstream URL or cause arbitrary races to be fetched.
type ElectionRace struct {
	ID           int    `json:"id"`
	Name         string `json:"name"`
	State        string `json:"state"`
	ElectionDate string `json:"election_date"`
}

//go:embed elections_catalog.json
var electionCatalog []byte

var electionRaces []ElectionRace

func init() {
	if err := json.Unmarshal(electionCatalog, &electionRaces); err != nil {
		panic(err)
	}
}

func ElectionRaceSupported(id int) bool {
	for _, race := range electionRaces {
		if race.ID == id {
			return true
		}
	}
	return false
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
		Candidates: []ElectionCandidate{}}
}

func HandleElectionRaces(c *fiber.Ctx) error {
	if !platform.ElectionsBetaEnabled() {
		return c.SendStatus(fiber.StatusNotFound)
	}
	return c.JSON(electionRaces)
}

var electionsSource = localSource{dashboard: electionsDashboard}

func electionsDashboard(ctx context.Context, sub string) map[string]interface{} {
	if !platform.ElectionsBetaEnabled() {
		return nil
	}
	results, err := followedElectionResults(ctx, sub)
	if err != nil {
		log.Printf("[Elections] load followed races: %v", err)
		return nil
	}
	return map[string]interface{}{"elections": results}
}

func followedElectionResults(ctx context.Context, sub string) ([]ElectionResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	ids := make([]int, len(electionRaces))
	for i, race := range electionRaces {
		ids[i] = race.ID
	}
	rows, err := platform.DBPool.Query(ctx, `
		SELECT catalog.id, res.snapshot, COALESCE(res.failures > 0 OR res.verified_until < now(), false)
		FROM user_widgets w CROSS JOIN unnest($2::int[]) AS catalog(id)
		LEFT JOIN election_results res ON res.race_id = catalog.id
		WHERE w.logto_sub = $1 AND w.widget_type = 'elections' AND w.enabled
		  AND w.config->'race_ids' @> jsonb_build_array(catalog.id)
		ORDER BY array_position($2::int[], catalog.id)`, sub, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ElectionResult, 0)
	for rows.Next() {
		var id int
		var data []byte
		var delayed bool
		if err := rows.Scan(&id, &data, &delayed); err != nil {
			return nil, err
		}
		var result ElectionResult
		if len(data) != 0 {
			if err := json.Unmarshal(data, &result); err != nil {
				return nil, err
			}
		} else {
			for _, race := range electionRaces {
				if race.ID == id {
					result = race.pendingResult()
					break
				}
			}
		}
		result.Delayed = delayed
		out = append(out, result)
	}
	return out, rows.Err()
}
