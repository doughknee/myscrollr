package main

import "time"

// Prediction represents a single tracked Kalshi market for display.
//
// Pricing is stored as integer cents 0–100 (== implied probability %),
// derived from Kalshi's *_dollars decimal strings. JSON keys mirror the
// `markets` table column names (snake_case). See channels/predictions/CONTRACT.md.
type Prediction struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Ticker      string `json:"ticker"`
	EventTicker string `json:"event_ticker,omitempty"`
	// EventTitle is the event's human question ("More tech layoffs in
	// 2026 than in 2025?") — the market's own Title is just its leg
	// ("Yes", "Atlanta"). EventRank orders legs within an event
	// (1 = most liquid / is_primary, 2 = second outcome). v1.1.4.
	EventTitle   string     `json:"event_title,omitempty"`
	EventRank    int        `json:"event_rank,omitempty"`
	Category     string     `json:"category,omitempty"`
	Title        string     `json:"title"`
	Subtitle     string     `json:"subtitle,omitempty"`
	YesPrice     int   `json:"yes_price"`
	YesBid       int   `json:"yes_bid,omitempty"`
	YesAsk       int   `json:"yes_ask,omitempty"`
	PrevYesPrice int   `json:"prev_yes_price,omitempty"`
	Volume       int64 `json:"volume,omitempty"`
	// Volume24h is the trailing-24h contract volume (refreshed by the
	// catalog sweep). Drives the desktop's "Trending" sort — all-time
	// Volume never shrinks, so it can't rank liveliness. v1.1.5.
	Volume24h    int64 `json:"volume_24h,omitempty"`
	OpenInterest int64 `json:"open_interest,omitempty"`
	// InSweep is false once the market drops out of the curated sweep
	// selection (settled / delisted / out-ranked). Such rows only appear
	// in the payload while recently resolved ("Resolved today"); clients
	// must not render them as live markets. No omitempty — false is the
	// meaningful value. v1.1.5.
	InSweep bool   `json:"in_sweep"`
	Status  string `json:"status,omitempty"`
	Result  string `json:"result,omitempty"`
	// SettledAt is when the market transitioned into a resolved state
	// (stamped once by the ingestion service). Drives "Resolved today";
	// updated_at is unusable for that — any write refreshes it. v1.1.5.
	SettledAt *time.Time `json:"settled_at,omitempty"`
	CloseTime *time.Time `json:"close_time,omitempty"`
	Link      string     `json:"link,omitempty"`
	UpdatedAt *time.Time `json:"updated_at,omitempty"`
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

// TrackedMarket represents a market entry from the catalog.
type TrackedMarket struct {
	Ticker   string `json:"ticker"`
	Title    string `json:"title"`
	Category string `json:"category"`
}

// ErrorResponse represents a standard API error.
type ErrorResponse struct {
	Status string `json:"status"`
	Error  string `json:"error"`
}
