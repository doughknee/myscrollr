package support

import (
	"encoding/json"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/events"
)

// =============================================================================
// Support events on the SSE hub (REL-261)
// =============================================================================
//
// The console has to move on its own — a hold running out and a reply landing
// are things that happen without anybody clicking, and a queue that only
// updates when you reload is a queue you stop trusting. core-api already runs
// an SSE hub for the desktop app, so this is one more topic on it rather than
// a second fan-out or a poll.
//
// The payload deliberately does NOT carry the case. A case is thirty fields
// wide, several of them computed against Linear and GitHub, and a copy of one
// arriving over a socket is a copy that can disagree with the endpoint that
// built it. The event says which ticket moved and what happened to it; the
// page re-reads the queue (and the open case, if it is that one) from the same
// handlers it read them from in the first place. One source of truth.

const (
	supportEventDrafted  = "drafted"
	supportEventDecided  = "decided"
	supportEventSent     = "sent"
	supportEventFailed   = "failed"
	supportEventSkipped  = "skipped"
	supportEventHeld     = "held"
	supportEventLinked   = "linked"
	supportEventUnlinked = "unlinked"
	supportEventAutoSend = "autosend"
)

// supportEvent is what a console connection receives.
//
// Ticket is empty for the one event that is not about a ticket — the pipeline
// being paused or resumed — and the page treats that as "re-read everything".
type supportEvent struct {
	Type        string    `json:"type"`
	Event       string    `json:"event"`
	Ticket      string    `json:"ticket_number,omitempty"`
	Disposition string    `json:"disposition,omitempty"`
	At          time.Time `json:"at"`
}

// publishSupportEvent tells every open console that something moved.
//
// Fire-and-forget on purpose: nothing in the support pipeline may fail because
// a browser did not hear about it. The cost of a lost event is one stale panel
// until the next one, and the page re-reads on focus regardless.
func publishSupportEvent(ticket, event string, disposition ...string) {
	e := supportEvent{Type: "support", Event: event, Ticket: ticket, At: time.Now().UTC()}
	if len(disposition) > 0 {
		e.Disposition = disposition[0]
	}
	payload, err := json.Marshal(e)
	if err != nil {
		return
	}
	events.PublishSupportEvent(payload)
}
