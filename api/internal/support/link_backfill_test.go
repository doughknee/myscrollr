package support

import (
	"context"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// The proposal is allowed to be wrong; it is not allowed to be confident. What
// matters is that it ranks the obvious match first and stays quiet when
// nothing overlaps, because a list full of noise is a list that gets
// rubber-stamped.
func TestProposeLinks_RanksTheObviousMatchAndDeclinesTheRest(t *testing.T) {
	issues := []openIssue{
		{Key: "REL-253", Title: "The ticker never scrolls", Description: "The bar renders but the ticker does not scroll."},
		{Key: "REL-254", Title: "GPU undetected on launch", Description: "Hardware acceleration is off."},
		{Key: "REL-255", Title: "Linux AppImage login loop"},
	}

	got := proposeLinks(unlinkedCase{
		TicketNumber: "486932",
		Subject:      "Bug Report: ticker does not scroll",
		Summary:      "ticker never scrolls on launch",
	}, issues, 2)
	if len(got) == 0 || got[0].IssueKey != "REL-253" {
		t.Fatalf("got %+v, want REL-253 first", got)
	}

	// Shared furniture only ("the", "bug", "scrollr") must not propose
	// anything: every ticket shares those with every issue.
	if got := proposeLinks(unlinkedCase{
		TicketNumber: "486933",
		Subject:      "The Scrollr app has a bug",
		Summary:      "a problem with the app",
	}, issues, 2); len(got) != 0 {
		t.Fatalf("got %+v, want nothing from stopwords alone", got)
	}
}

// The whole point of /link is that it proposes. Confirming is what writes, and
// it refuses to overwrite a link that already exists.
func TestLinkConfirm_WritesOnceAndNeverOverwrites(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()

	ticket := "900261"
	if err := upsertSupportCase(ctx, SupportCase{
		TicketNumber: ticket, Subject: "The ticker never scrolls", Status: "open",
	}); err != nil {
		t.Fatal(err)
	}
	if got := caseLinearIssueKey(ctx, ticket); got != "" {
		t.Fatalf("a fresh case starts unlinked, got %q", got)
	}

	if err := setCaseLinearIssueKey(ctx, ticket, "REL-253"); err != nil {
		t.Fatal(err)
	}
	if got := caseLinearIssueKey(ctx, ticket); got != "REL-253" {
		t.Fatalf("got %q, want REL-253", got)
	}

	// A second confirmation on the same case — two people looking at the same
	// /link output — must not repoint it at something else.
	if err := setCaseLinearIssueKey(ctx, ticket, "REL-254"); err != nil {
		t.Fatal(err)
	}
	if got := caseLinearIssueKey(ctx, ticket); got != "REL-253" {
		t.Fatalf("got %q, want the first link to stand", got)
	}
}

// A linked case must drop out of the proposal list, or /link keeps offering
// work that is already done.
func TestUnlinkedCases_ExcludesLinkedAndClosed(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	ctx := context.Background()

	for _, tc := range []struct{ ticket, status, link string }{
		{"900270", "open", ""},
		{"900271", "open", "REL-253"},
		{"900272", "closed", ""},
	} {
		if err := upsertSupportCase(ctx, SupportCase{
			TicketNumber: tc.ticket, Subject: "s", Status: tc.status,
		}); err != nil {
			t.Fatal(err)
		}
		if tc.link != "" {
			if err := setCaseLinearIssueKey(ctx, tc.ticket, tc.link); err != nil {
				t.Fatal(err)
			}
		}
	}

	cases, err := fetchUnlinkedCases(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(cases) != 1 || cases[0].TicketNumber != "900270" {
		t.Fatalf("got %+v, want only the open unlinked case", cases)
	}
}
