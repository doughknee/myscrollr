package main

import "time"

// Prediction represents a single tracked Kalshi market for display.
//
// Pricing is stored as integer cents 0–100 (== implied probability %),
// derived from Kalshi's *_dollars decimal strings. JSON keys mirror the
// `markets` table column names (snake_case). See channels/predictions/CONTRACT.md.
type Prediction struct {
	ID           string     `json:"id"`
	Source       string     `json:"source"`
	Ticker       string     `json:"ticker"`
	EventTicker  string     `json:"event_ticker,omitempty"`
	Category     string     `json:"category,omitempty"`
	Title        string     `json:"title"`
	Subtitle     string     `json:"subtitle,omitempty"`
	YesPrice     int        `json:"yes_price"`
	YesBid       int        `json:"yes_bid,omitempty"`
	YesAsk       int        `json:"yes_ask,omitempty"`
	PrevYesPrice int        `json:"prev_yes_price,omitempty"`
	Volume       int64      `json:"volume,omitempty"`
	OpenInterest int64      `json:"open_interest,omitempty"`
	Status       string     `json:"status,omitempty"`
	Result       string     `json:"result,omitempty"`
	CloseTime    *time.Time `json:"close_time,omitempty"`
	Link         string     `json:"link,omitempty"`
	UpdatedAt    *time.Time `json:"updated_at,omitempty"`
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
