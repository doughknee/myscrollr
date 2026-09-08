package support

import (
	"testing"
	"time"
)

// =============================================================================
// The auto-send gate
// =============================================================================
//
// This is the one piece of the queue that can talk to a user with nobody
// watching, so the gate gets a test per way it can be wrong. The rule that
// matters most is the last one: bug, billing and account never auto-send,
// no matter how the environment is configured.

// eligibleDraft is a draft that clears every condition. Each test breaks
// exactly one thing so a failure names the condition that regressed.
func eligibleDraft() *SupportDraft {
	return &SupportDraft{
		ID:            1,
		TicketNumber:  "239171",
		Status:        "pending",
		DraftBodyHTML: "<p>Thanks for the suggestion — logged it.</p>",
		AICategory:    "feature",
		AIConfidence:  "high",
	}
}

// autosendOn switches the feature on for one test and restores the
// environment afterwards.
func autosendOn(t *testing.T) {
	t.Helper()
	t.Setenv("SUPPORT_AUTOSEND", "on")
}

func TestAutosendAllowed_EligibleDraft(t *testing.T) {
	autosendOn(t)
	if !autosendAllowed(eligibleDraft()) {
		t.Fatal("a high-confidence feature draft should auto-send when the feature is on")
	}
}

func TestAutosendAllowed_OffByDefault(t *testing.T) {
	t.Setenv("SUPPORT_AUTOSEND", "")
	if autosendAllowed(eligibleDraft()) {
		t.Fatal("auto-send must be off unless SUPPORT_AUTOSEND is explicitly on")
	}
	t.Setenv("SUPPORT_AUTOSEND", "true") // not "on"
	if autosendAllowed(eligibleDraft()) {
		t.Fatal(`only the exact value "on" enables auto-send`)
	}
}

// TestAutosendAllowed_NeverForBugsBillingOrAccount is the rule the ticket
// states outright. Configuration cannot override it: the categories are on
// the allow-list here and must STILL be refused.
func TestAutosendAllowed_NeverForBugsBillingOrAccount(t *testing.T) {
	autosendOn(t)
	t.Setenv("SUPPORT_AUTOSEND_CATEGORIES", "feature,feedback,bug,billing,account")

	for _, category := range []string{"bug", "billing", "account", "Bug", "BILLING"} {
		d := eligibleDraft()
		d.AICategory = category
		if autosendAllowed(d) {
			t.Errorf("category %q auto-sent — it must never, whatever the config says", category)
		}
	}
}

func TestAutosendAllowed_OnlyAllowListedCategories(t *testing.T) {
	autosendOn(t)
	d := eligibleDraft()
	d.AICategory = "widget"
	if autosendAllowed(d) {
		t.Error("a category outside SUPPORT_AUTOSEND_CATEGORIES auto-sent")
	}

	t.Setenv("SUPPORT_AUTOSEND_CATEGORIES", "widget")
	if !autosendAllowed(d) {
		t.Error("a category explicitly allow-listed did not auto-send")
	}
}

func TestAutosendAllowed_RequiresHighConfidence(t *testing.T) {
	autosendOn(t)
	for _, confidence := range []string{"medium", "low", ""} {
		d := eligibleDraft()
		d.AIConfidence = confidence
		if autosendAllowed(d) {
			t.Errorf("confidence %q auto-sent; only high may", confidence)
		}
	}
}

// A draft that is still waiting on the user is, by definition, an
// incomplete answer — sending it unattended is the worst case.
func TestAutosendAllowed_RefusesWhenTriageNeedsMoreFromTheUser(t *testing.T) {
	autosendOn(t)
	d := eligibleDraft()
	d.AskUserFor = "which version they're on"
	if autosendAllowed(d) {
		t.Error("a draft with ask_user_for set auto-sent")
	}
}

// Skip / Edit / Ask all work by moving the draft off 'pending'; the timer
// re-checks at fire time, so this one assertion covers all three cancels.
func TestAutosendAllowed_RefusesOnceDecided(t *testing.T) {
	autosendOn(t)
	for _, status := range []string{"skipped", "edited", "asked", "approved", "sent", "failed"} {
		d := eligibleDraft()
		d.Status = status
		if autosendAllowed(d) {
			t.Errorf("status %q auto-sent; only a pending draft may", status)
		}
	}
}

func TestAutosendAllowed_RefusesEmptyBody(t *testing.T) {
	autosendOn(t)
	d := eligibleDraft()
	d.DraftBodyHTML = ""
	if autosendAllowed(d) {
		t.Error("an empty draft body auto-sent")
	}
	if autosendAllowed(nil) {
		t.Error("a nil draft auto-sent")
	}
}

func TestAutosendDelay(t *testing.T) {
	t.Setenv("SUPPORT_AUTOSEND_DELAY", "")
	if got := autosendDelay(); got != 30*time.Minute {
		t.Errorf("default delay = %s, want 30m", got)
	}
	t.Setenv("SUPPORT_AUTOSEND_DELAY", "5m")
	if got := autosendDelay(); got != 5*time.Minute {
		t.Errorf("delay = %s, want 5m", got)
	}
	// A typo must not become "send immediately".
	t.Setenv("SUPPORT_AUTOSEND_DELAY", "30 minutes")
	if got := autosendDelay(); got != 30*time.Minute {
		t.Errorf("unparseable delay = %s, want the 30m default", got)
	}
	t.Setenv("SUPPORT_AUTOSEND_DELAY", "-5m")
	if got := autosendDelay(); got != 30*time.Minute {
		t.Errorf("negative delay = %s, want the 30m default", got)
	}
}
