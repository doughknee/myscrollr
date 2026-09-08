package support

import _ "embed"

// kb.generated.md is the product reference passed to the AI triage prompt
// on every ticket. It is GENERATED — `make kb` at the repo root, source in
// api/cmd/kbgen — from the design docs, the settings copy the app renders,
// the widget catalog, the roadmap, the last eight GitHub releases and the
// hand-curated docs/support/POLICIES.md. Every section carries a
// provenance line. CI regenerates and diffs it, so editing this file by
// hand only fails the build; edit the source it names instead.
//
//go:embed kb/kb.generated.md
var knowledgeBase string

// supportKnowledgeBase returns the knowledge base sent verbatim on every
// triage call. Claude treats what it says as ground truth and may repeat
// it to users, which is why it is generated rather than remembered.
func supportKnowledgeBase() string {
	return knowledgeBase
}
