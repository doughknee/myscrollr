package events

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// CDCRecord represents a single Change Data Capture record from Sequin.
type CDCRecord struct {
	Action   string                 `json:"action"`
	Record   map[string]interface{} `json:"record"`
	Changes  map[string]interface{} `json:"changes"`
	Metadata struct {
		TableSchema string `json:"table_schema"`
		TableName   string `json:"table_name"`
	} `json:"metadata"`
}

// HandleSequinWebhook processes incoming CDC events from Sequin.
func HandleSequinWebhook(c *fiber.Ctx) error {
	// Verify webhook secret (mandatory)
	secret := os.Getenv("SEQUIN_WEBHOOK_SECRET")
	if secret == "" {
		log.Println("[Sequin] SEQUIN_WEBHOOK_SECRET not set — rejecting request")
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Webhook authentication not configured",
		})
	}
	auth := c.Get("Authorization")
	if auth != "Bearer "+secret {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Invalid webhook secret",
		})
	}

	records, err := parseCDCRecords(c.Body())
	if err != nil {
		log.Printf("[Sequin] Failed to parse CDC records: %v", err)
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "Invalid CDC payload",
		})
	}

	ctx := context.Background()
	for _, rec := range records {
		routeCDCRecord(ctx, rec)
	}

	return c.JSON(fiber.Map{"status": "ok", "processed": len(records)})
}

func parseCDCRecords(body []byte) ([]CDCRecord, error) {
	// Try batched format: {"data": [...]}
	var batched struct {
		Data []CDCRecord `json:"data"`
	}
	if err := json.Unmarshal(body, &batched); err == nil && len(batched.Data) > 0 {
		return batched.Data, nil
	}

	// Try single record
	var single CDCRecord
	if err := json.Unmarshal(body, &single); err == nil && single.Metadata.TableName != "" {
		return []CDCRecord{single}, nil
	}

	return nil, fmt.Errorf("unrecognized CDC payload format")
}

// routeCDCRecord publishes a CDC event to the appropriate topic channel.
// The Hub's listenToTopics goroutine receives the message and fans out
// to all subscribed clients in-memory.
func routeCDCRecord(ctx context.Context, rec CDCRecord) {
	table := rec.Metadata.TableName

	// Build the SSE payload envelope
	envelope := map[string]interface{}{
		"data": []map[string]interface{}{
			{
				"action":   rec.Action,
				"record":   rec.Record,
				"changes":  rec.Changes,
				"metadata": rec.Metadata,
			},
		},
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		log.Printf("[Sequin] Failed to marshal payload for table %s: %v", table, err)
		return
	}

	// Determine the topic channel based on the table and record content
	topic := topicForRecord(table, rec.Record)
	if topic == "" {
		return
	}

	// Single PUBLISH to the topic channel -- Hub handles fan-out in memory
	PublishToTopic(topic, payload)
}

// topicForRecord maps a CDC table + record to the correct topic channel.
// This replaces the HTTP call to channel APIs and the per-user PUBLISH loop.
func topicForRecord(table string, record map[string]interface{}) string {
	switch table {
	// Core-owned tables: route to specific user
	case "user_preferences", "user_channels":
		sub, ok := record["logto_sub"].(string)
		if !ok || sub == "" {
			return ""
		}
		return platform.TopicPrefixCore + sub

	// Finance: route by symbol
	case "trades":
		symbol, ok := record["symbol"].(string)
		if !ok || symbol == "" {
			return ""
		}
		return platform.TopicPrefixFinance + symbol

	// Sports: route by league
	case "games":
		league, ok := record["league"].(string)
		if !ok || league == "" {
			return ""
		}
		return platform.TopicPrefixSports + league

	// RSS: route by feed URL (hashed)
	case "rss_items":
		feedURL, ok := record["feed_url"].(string)
		if !ok || feedURL == "" {
			return ""
		}
		return TopicForRSSFeed(feedURL)

	// Fantasy: route by league key (all 4 tables have league_key)
	case "yahoo_leagues", "yahoo_standings", "yahoo_matchups", "yahoo_rosters":
		leagueKey, ok := record["league_key"].(string)
		if !ok || leagueKey == "" {
			return ""
		}
		return platform.TopicPrefixFantasy + leagueKey

	// Predictions: v1 channel-wide broadcast — every market update goes to
	// the single "all" topic that every predictions subscriber listens on.
	case "markets":
		return platform.TopicPrefixPredictions + "all"

	default:
		return ""
	}
}
