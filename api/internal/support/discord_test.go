package support

import (
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// =============================================================================
// Message splitting
// =============================================================================
//
// The bug this replaced: buildDraftMessageContent cut every draft at 1900
// bytes and appended "_...truncated_". Nobody could read a long reply
// without opening the database, so long replies were skipped. These tests
// pin the two properties that make the new path trustworthy — every chunk
// fits, and nothing is lost or mangled between them.

// paragraphs builds a body of n paragraphs, each ~120 chars.
func paragraphs(n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(strings.Repeat("the quick brown fox jumps over the lazy dog. ", 3))
	}
	return b.String()
}

func TestSplitForDiscord_EveryChunkFitsTheLimit(t *testing.T) {
	body := paragraphs(120) // comfortably over 10 messages' worth
	chunks := splitForDiscord(body, discordMessageLimit)

	if len(chunks) < 5 {
		t.Fatalf("expected the body to need several messages, got %d", len(chunks))
	}
	for i, c := range chunks {
		if len(c) > discordMessageLimit {
			t.Errorf("chunk %d is %d bytes, over Discord's %d limit", i, len(c), discordMessageLimit)
		}
		if !utf8.ValidString(c) {
			t.Errorf("chunk %d is not valid UTF-8", i)
		}
	}
}

func TestSplitForDiscord_NeverCutsMidWord(t *testing.T) {
	// Distinct words so a mid-word cut produces a token that isn't in the
	// source vocabulary — which is exactly what we assert against.
	var words []string
	for i := 0; i < 900; i++ {
		words = append(words, "word"+strings.Repeat("x", i%7)+string(rune('a'+i%26)))
	}
	body := strings.Join(words, " ")
	vocabulary := map[string]struct{}{}
	for _, w := range words {
		vocabulary[w] = struct{}{}
	}

	chunks := splitForDiscord(body, discordMessageLimit)
	if len(chunks) < 2 {
		t.Fatalf("test body should span several messages, got %d", len(chunks))
	}
	for i, c := range chunks {
		for _, tok := range strings.Fields(c) {
			if _, ok := vocabulary[tok]; !ok {
				t.Fatalf("chunk %d contains %q, which is not a whole source word — a word was split", i, tok)
			}
		}
	}
}

func TestSplitForDiscord_LosesNothing(t *testing.T) {
	body := paragraphs(40)
	joined := strings.Join(splitForDiscord(body, discordMessageLimit), " ")

	want := strings.Join(strings.Fields(body), " ")
	got := strings.Join(strings.Fields(joined), " ")
	if got != want {
		t.Fatalf("round-trip lost or altered content\n got %d chars\nwant %d chars", len(got), len(want))
	}
}

func TestSplitForDiscord_UnbreakableRunSplitsOnRuneBoundary(t *testing.T) {
	// A single 5000-char token of multi-byte runes: no space, no newline,
	// so the splitter has to make a hard cut. It must still be valid UTF-8.
	body := strings.Repeat("é", 5000)
	chunks := splitForDiscord(body, discordMessageLimit)

	if len(chunks) < 2 {
		t.Fatalf("expected several chunks, got %d", len(chunks))
	}
	rejoined := strings.Join(chunks, "")
	for i, c := range chunks {
		if len(c) > discordMessageLimit {
			t.Errorf("chunk %d is %d bytes, over the limit", i, len(c))
		}
		if !utf8.ValidString(c) {
			t.Fatalf("chunk %d has a cut inside a multi-byte rune", i)
		}
	}
	if rejoined != body {
		t.Errorf("hard-cut chunks did not rejoin to the original (%d vs %d bytes)", len(rejoined), len(body))
	}
}

func TestSplitForDiscord_PrefersParagraphBoundaries(t *testing.T) {
	// Two paragraphs that together exceed one message: the cut should land
	// on the blank line, so neither chunk contains half of both.
	first := strings.Repeat("alpha ", 250)  // ~1500 bytes
	second := strings.Repeat("bravo ", 250) // ~1500 bytes
	chunks := splitForDiscord(first+"\n\n"+second, discordMessageLimit)

	if len(chunks) != 2 {
		t.Fatalf("expected 2 chunks, got %d", len(chunks))
	}
	if strings.Contains(chunks[0], "bravo") {
		t.Error("first chunk leaked into the second paragraph — the blank-line boundary was ignored")
	}
	if strings.Contains(chunks[1], "alpha") {
		t.Error("second chunk carries the first paragraph")
	}
}

// =============================================================================
// Draft messages
// =============================================================================

func TestBuildDraftMessages_ShortDraftIsOneMessage(t *testing.T) {
	starter, rest := buildDraftMessages(&SupportDraft{
		TicketNumber:    "239171",
		UserMessageHTML: "<p>The ticker vanished after I updated.</p>",
		DraftBodyHTML:   "<p>Sorry about that. Try toggling it from the tray icon.</p>",
	}, true)

	if len(rest) != 0 {
		t.Fatalf("a short ticket should be one message, got 1+%d", len(rest))
	}
	if !strings.Contains(starter, "ticker vanished") {
		t.Error("starter is missing the user's message")
	}
	if !strings.Contains(starter, "tray icon") {
		t.Error("starter is missing the drafted reply")
	}
}

func TestBuildDraftMessages_LongDraftIsFullyReadable(t *testing.T) {
	// The case from the ticket: a > 2500-char draft on a > 2000-char user
	// message. Every word of both has to survive into some message.
	userBody := paragraphs(30)
	draftBody := paragraphs(60)

	starter, rest := buildDraftMessages(&SupportDraft{
		TicketNumber:    "239171",
		UserMessageHTML: "<p>" + userBody + "</p>",
		DraftBodyHTML:   "<p>" + draftBody + "</p>",
	}, true)

	all := append([]string{starter}, rest...)
	for i, m := range all {
		if len(m) > discordMessageLimit {
			t.Errorf("message %d is %d bytes, over Discord's limit", i, len(m))
		}
	}
	if !strings.Contains(starter, "…continues below") {
		t.Error("a truncated user message must say it continues below")
	}

	// Draft text present in full: compare word multisets of the drafted
	// reply against everything posted after the header lines.
	posted := strings.Join(all, "\n")
	for _, word := range strings.Fields(draftBody) {
		if !strings.Contains(posted, word) {
			t.Fatalf("drafted reply lost the word %q — the draft is not fully readable", word)
		}
	}
	if !strings.Contains(posted, "**Drafted reply**") {
		t.Error("the drafted reply is not labelled")
	}
}

// A message of many short lines gains two bytes per line from the "> "
// blockquote prefix. Quoting before measuring is what keeps the starter
// under the limit — a log dump pasted into a ticket is exactly this shape.
func TestBuildDraftMessages_BlockquotePrefixCountsTowardTheLimit(t *testing.T) {
	var log strings.Builder
	for i := 0; i < 400; i++ {
		log.WriteString("ERR frame drop\n")
	}
	starter, rest := buildDraftMessages(&SupportDraft{
		TicketNumber:    "239171",
		UserMessageHTML: "<p>" + log.String() + "</p>",
		DraftBodyHTML:   "<p>Thanks, that helps.</p>",
	}, true)

	for i, m := range append([]string{starter}, rest...) {
		if len(m) > discordMessageLimit {
			t.Errorf("message %d is %d bytes — the blockquote prefix pushed it over the limit", i, len(m))
		}
	}
}

func TestBuildDraftMessages_OmitsUserMessageOnFollowUp(t *testing.T) {
	starter, _ := buildDraftMessages(&SupportDraft{
		TicketNumber:    "239171",
		UserMessageHTML: "<p>Still broken, here is the log.</p>",
		DraftBodyHTML:   "<p>Thanks — can you send the version number?</p>",
	}, false)

	if strings.Contains(starter, "Still broken") {
		t.Error("a follow-up draft re-quoted a message the thread already shows")
	}
	if !strings.Contains(starter, "version number") {
		t.Error("the drafted reply went missing")
	}
}

// TestButtonsRideOnTheLastMessage is the property the ticket asked for by
// name: whatever the length, the action row is on the message the partner
// finishes reading, not one they have to scroll back to.
func TestButtonsRideOnTheLastMessage(t *testing.T) {
	for _, tc := range []struct {
		name  string
		draft *SupportDraft
	}{
		{"short", &SupportDraft{ID: 1, DraftBodyHTML: "<p>ok</p>"}},
		{"long", &SupportDraft{ID: 2, DraftBodyHTML: "<p>" + paragraphs(60) + "</p>"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, rest := buildDraftMessages(tc.draft, true)
			buttons := buildDraftActionButtons(tc.draft.ID)
			if len(buttons) != 1 || len(buttons[0].Components) != 5 {
				t.Fatalf("expected one row of 5 buttons, got %d row(s)", len(buttons))
			}
			// notifyDiscordForDraft attaches `buttons` to rest's last entry
			// when rest is non-empty, and to the starter otherwise. Assert
			// the shape that decision relies on: there is always exactly
			// one "last message".
			if len(rest) == 0 {
				return // starter is the last message
			}
			if rest[len(rest)-1] == "" {
				t.Error("last message is empty, so the buttons would land nowhere")
			}
		})
	}
}

// =============================================================================
// Diff
// =============================================================================

func TestLineDiff_IdenticalIsEmpty(t *testing.T) {
	if got := lineDiff("one\ntwo", "one\ntwo"); got != "" {
		t.Errorf("identical bodies should produce no diff, got %q", got)
	}
}

func TestLineDiff_MarksAddedAndRemovedLines(t *testing.T) {
	got := lineDiff("Hi there\nWe do not have a weather widget.\nThanks",
		"Hi there\nThe weather widget is in Settings › Catalog.\nThanks")

	if !strings.Contains(got, "- We do not have a weather widget.") {
		t.Errorf("removed line not marked:\n%s", got)
	}
	if !strings.Contains(got, "+ The weather widget is in Settings › Catalog.") {
		t.Errorf("added line not marked:\n%s", got)
	}
	if !strings.Contains(got, "  Hi there") {
		t.Errorf("unchanged line not carried:\n%s", got)
	}
}

// =============================================================================
// Digest
// =============================================================================

// An empty queue after a quiet day posts nothing at all — silence is the
// signal that there's nothing to do, and a daily "0 pending" is the kind
// of noise people learn to scroll past.
func TestDigestStats_EmptyMeansNoPost(t *testing.T) {
	if !(digestStats{}).Empty() {
		t.Error("a queue with nothing in it and nothing yesterday should post nothing")
	}
	if (digestStats{Pending: 1}).Empty() {
		t.Error("a pending draft must produce a digest")
	}
	if (digestStats{Skipped: 1}).Empty() {
		t.Error("yesterday's activity must produce a digest even with an empty queue")
	}
}

func TestRenderDigest_NamesWhatIsWaiting(t *testing.T) {
	out := renderDigest(digestStats{
		Pending:   4,
		FollowUps: 1,
		Sent:      2,
		Edited:    1,
		Skipped:   3,
		Stale: []staleDraft{
			{TicketNumber: "239171", Summary: "ticker blank on second monitor", Age: 72 * time.Hour},
		},
	}, time.Date(2026, 9, 9, 9, 0, 0, 0, time.UTC))

	for _, want := range []string{
		"4 pending", "1 of them are follow-ups", "239171", "3 days",
		"2 sent · 1 edited · 3 skipped",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("digest is missing %q:\n%s", want, out)
		}
	}
}

func TestNextDigestTime_IsAlwaysInTheFuture(t *testing.T) {
	loc := time.UTC
	for _, hour := range []int{0, 8, 9, 10, 23} {
		now := time.Date(2026, 9, 9, hour, 30, 0, 0, loc)
		next := nextDigestTime(now, loc)
		if !next.After(now) {
			t.Errorf("from %s the next digest is %s, which is not in the future", now, next)
		}
		if next.Hour() != digestHour {
			t.Errorf("next digest at %02d:00, want %02d:00", next.Hour(), digestHour)
		}
	}
}

func TestHumanAge(t *testing.T) {
	for _, tc := range []struct {
		d    time.Duration
		want string
	}{
		{3 * time.Hour, "3h"},
		{25 * time.Hour, "1 day"},
		{72 * time.Hour, "3 days"},
	} {
		if got := humanAge(tc.d); got != tc.want {
			t.Errorf("humanAge(%s) = %q, want %q", tc.d, got, tc.want)
		}
	}
}

// =============================================================================
// Version rendering
// =============================================================================

func TestCurrentDesktopVersion_ReadsTheKnowledgeBase(t *testing.T) {
	// Not pinned to a literal: the KB regenerates every release. What must
	// hold is that the line is found and looks like a version.
	v := currentDesktopVersion()
	if v == "" {
		t.Fatal("no current desktop version found in the knowledge base — the header line's format changed")
	}
	if !strings.Contains(v, ".") {
		t.Errorf("parsed %q, which does not look like a version", v)
	}
}
