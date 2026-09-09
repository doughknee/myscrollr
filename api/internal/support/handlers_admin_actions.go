package support

import (
	"context"
	"errors"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/admin"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// The staff support console, write half (REL-261)
// =============================================================================
//
// Nine endpoints, all under /admin/support and all behind the same gate as the
// read half (platform.LogtoAuth + admin.RequireAdmin, declared with the
// routes). Each one is a thin shell around the shared verb in actions.go: read
// the inputs, call the function Discord calls, and answer with the case as it
// now stands.
//
// "As it now stands" is the whole contract. A browser that guesses what a
// click did is a browser that can be wrong about whether a reply went to a
// real person, so nothing here returns "ok" — every write re-reads the case
// through HandleAdminCase's own builder and hands back exactly what a reload
// would have shown.
//
// The browser decides nothing. It cannot set a disposition, cannot declare a
// fix proven, and cannot ask for a send that skips a gate: the gates ran in
// decideDisposition before the draft ever reached a queue, and clicking Send
// here is the same escape hatch as clicking Send in Discord — a person taking
// responsibility, which is what those gates were built to require.

// actionRequest is every body these endpoints accept. One struct because the
// fields do not overlap: an edit has a body, an ask has a question, a link has
// a key, and the rest have nothing.
type actionRequest struct {
	Body     string `json:"body"`
	Question string `json:"question"`
	IssueKey string `json:"issue_key"`
	Paused   bool   `json:"paused"`
}

// draftIDFromPath parses :draft, which is the id the queue handed the page.
func draftIDFromPath(c *fiber.Ctx) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Params("draft")), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// respondWithAction answers a write with the updated case.
//
// The ticket number comes from the draft the verb acted on rather than from
// the request, so a response can never describe a different case than the one
// that moved.
func respondWithAction(c *fiber.Ctx, ctx context.Context, draft *SupportDraft, err error, verb string) error {
	if err != nil {
		return actionErrorResponse(c, verb, err)
	}
	return respondWithCase(c, ctx, draft.TicketNumber, verb)
}

// respondWithCase re-reads the case through the read endpoint's own builder.
// A verb that succeeded but whose case cannot be re-read is still a verb that
// succeeded — the reply went out — so this says so rather than reporting the
// action as failed.
func respondWithCase(c *fiber.Ctx, ctx context.Context, ticket, verb string) error {
	detail, err := buildAdminCase(ctx, ticket)
	if err != nil {
		log.Printf("[AdminSupport] %s on ticket %s succeeded but the case could not be re-read: %v", verb, ticket, err)
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"ticket_number": ticket,
			"stale":         true,
			"note":          "The " + verb + " went through, but this case could not be re-read. Reload to see where it stands.",
		})
	}
	return c.JSON(detail)
}

// actionErrorResponse maps a shared verb's error onto a status a page can act
// on. The two that are not failures are the ones worth telling apart: someone
// else got there first (409), and the draft is gone (404). Everything else is
// ours and says so.
func actionErrorResponse(c *fiber.Ctx, verb string, err error) error {
	var linked ErrAlreadyLinked
	switch {
	case errors.Is(err, ErrAlreadyDecided):
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "This draft has already been actioned — reload the case to see what happened to it.",
		})
	case errors.Is(err, ErrDraftNotFound):
		return c.Status(fiber.StatusNotFound).JSON(platform.ErrorResponse{
			Status: "error", Error: "That draft no longer exists.",
		})
	case errors.Is(err, ErrEmptyBody):
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "There is nothing to send.",
		})
	case errors.Is(err, ErrBadIssueKey):
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "That is not a Linear issue key. They look like REL-261.",
		})
	case errors.As(err, &linked):
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{
			Status: "error",
			Error:  "This case is already linked to " + linked.IssueKey + ". Unlink it first if it is wrong.",
		})
	case errors.Is(err, ErrNotLinked):
		return c.Status(fiber.StatusConflict).JSON(platform.ErrorResponse{
			Status: "error", Error: "No issue is linked to this case.",
		})
	}
	log.Printf("[AdminSupport] %s by %s: %v", verb, admin.ActingAdmin(c), err)
	return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
		Status: "error", Error: "Could not " + verb + ": " + truncate(err.Error(), 300),
	})
}

// actionContext is context.Background() for the same reason every other
// handler in this package uses it: Fiber's request context is already
// cancelled by the time a handler under app.Test reaches the database, and a
// send that fails as "context canceled" is a send nobody can debug.
//
// The timeout is generous because a send is two upstream round-trips (osTicket
// and Resend) and the page is waiting on the answer rather than guessing it.
func actionContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 60*time.Second)
}

// HandleAdminSend - POST /admin/support/draft/:draft/send
//
// The one irreversible verb. The confirmation step lives in the browser, which
// is the right place for it: the server cannot tell a confirmed click from an
// unconfirmed one, and a second endpoint pretending otherwise would only be
// ceremony. What the server guarantees is that a second click sends nothing —
// the claim is conditional on the row still being pending.
func HandleAdminSend(c *fiber.Ctx) error {
	draftID, ok := draftIDFromPath(c)
	if !ok {
		return badDraftID(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	draft, err := ActionSend(ctx, draftID)
	log.Printf("[AdminSupport] send draft %d by %s (err=%v)", draftID, admin.ActingAdmin(c), err)
	return respondWithAction(c, ctx, draft, err, "send")
}

// HandleAdminEditAndSend - POST /admin/support/draft/:draft/edit
//
// The body is plain text and has no length limit here. Discord's editor capped
// a reply at 4000 characters because a Discord modal does; nothing about a
// support email does, and a cap that exists only because of the surface it was
// typed into is a cap that silently truncates someone's answer.
func HandleAdminEditAndSend(c *fiber.Ctx) error {
	draftID, ok := draftIDFromPath(c)
	if !ok {
		return badDraftID(c)
	}
	var req actionRequest
	if err := c.BodyParser(&req); err != nil {
		return badBody(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	draft, err := ActionEditAndSend(ctx, draftID, req.Body)
	log.Printf("[AdminSupport] edit+send draft %d by %s (err=%v)", draftID, admin.ActingAdmin(c), err)
	return respondWithAction(c, ctx, draft, err, "send the edit")
}

// HandleAdminAsk - POST /admin/support/draft/:draft/ask
func HandleAdminAsk(c *fiber.Ctx) error {
	draftID, ok := draftIDFromPath(c)
	if !ok {
		return badDraftID(c)
	}
	var req actionRequest
	if err := c.BodyParser(&req); err != nil {
		return badBody(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	draft, err := ActionAsk(ctx, draftID, req.Question)
	log.Printf("[AdminSupport] ask draft %d by %s (err=%v)", draftID, admin.ActingAdmin(c), err)
	return respondWithAction(c, ctx, draft, err, "ask")
}

// HandleAdminSkip - POST /admin/support/draft/:draft/skip
func HandleAdminSkip(c *fiber.Ctx) error {
	draftID, ok := draftIDFromPath(c)
	if !ok {
		return badDraftID(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	draft, err := ActionSkip(ctx, draftID)
	log.Printf("[AdminSupport] skip draft %d by %s (err=%v)", draftID, admin.ActingAdmin(c), err)
	return respondWithAction(c, ctx, draft, err, "skip")
}

// HandleAdminHold - POST /admin/support/draft/:draft/hold
//
// Disarms the countdown and leaves the draft pending. The console also calls
// this when someone opens the editor, which is what Discord does when someone
// opens the modal: typing a reply takes longer than a hold that is nearly up,
// and "I am working on this one" has to actually stop the clock.
func HandleAdminHold(c *fiber.Ctx) error {
	draftID, ok := draftIDFromPath(c)
	if !ok {
		return badDraftID(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	draft, err := ActionHold(ctx, draftID)
	return respondWithAction(c, ctx, draft, err, "hold")
}

// HandleAdminFileAsBug - POST /admin/support/draft/:draft/bug
func HandleAdminFileAsBug(c *fiber.Ctx) error {
	draftID, ok := draftIDFromPath(c)
	if !ok {
		return badDraftID(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	res, err := ActionFileAsBug(ctx, draftID)
	if err != nil {
		return actionErrorResponse(c, "file as bug", err)
	}
	log.Printf("[AdminSupport] filed %s for draft %d by %s", res.IssueKey, draftID, admin.ActingAdmin(c))

	draft, _ := loadSupportDraft(ctx, draftID)
	if draft == nil {
		return actionErrorResponse(c, "file as bug", ErrDraftNotFound)
	}
	detail, err := buildAdminCase(ctx, draft.TicketNumber)
	if err != nil {
		return respondWithCase(c, ctx, draft.TicketNumber, "file as bug")
	}
	// The result rides alongside the case rather than replacing it: the case
	// says the issue is linked, and `filed` says whether this click is what
	// linked it, whether it was already there, and — the one that matters —
	// whether the link failed to save, which is how a duplicate gets filed.
	return c.JSON(fiber.Map{"filed": res, "case": detail})
}

// HandleAdminLinkIssue - POST /admin/support/case/:ticket/link
func HandleAdminLinkIssue(c *fiber.Ctx) error {
	ticket := strings.TrimSpace(c.Params("ticket"))
	var req actionRequest
	if err := c.BodyParser(&req); err != nil {
		return badBody(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	key, err := ActionLinkIssue(ctx, ticket, req.IssueKey)
	if err != nil {
		return actionErrorResponse(c, "link that issue", err)
	}
	log.Printf("[AdminSupport] linked %s to ticket %s by %s", key, ticket, admin.ActingAdmin(c))
	return respondWithCase(c, ctx, ticket, "link")
}

// HandleAdminUnlinkIssue - DELETE /admin/support/case/:ticket/link
func HandleAdminUnlinkIssue(c *fiber.Ctx) error {
	ticket := strings.TrimSpace(c.Params("ticket"))
	ctx, cancel := actionContext()
	defer cancel()
	if err := ActionUnlinkIssue(ctx, ticket); err != nil {
		return actionErrorResponse(c, "unlink that issue", err)
	}
	log.Printf("[AdminSupport] unlinked ticket %s by %s", ticket, admin.ActingAdmin(c))
	return respondWithCase(c, ctx, ticket, "unlink")
}

// HandleAdminAutoSend - POST /admin/support/autosend
//
// The same switch /pause and /resume throw, and it answers with the switch
// position rather than with a case: pausing is not about one ticket.
//
// Resuming here lifts the pause and nothing else. Un-demoting a category that
// earned its way out of autonomy stays a Discord command on purpose — it is a
// judgement about a whole class of tickets, not a button next to one of them.
func HandleAdminAutoSend(c *fiber.Ctx) error {
	var req actionRequest
	if err := c.BodyParser(&req); err != nil {
		return badBody(c)
	}
	ctx, cancel := actionContext()
	defer cancel()
	if err := ActionSetPaused(ctx, req.Paused); err != nil {
		return actionErrorResponse(c, "change the pipeline switch", err)
	}
	log.Printf("[AdminSupport] autosend paused=%t by %s", req.Paused, admin.ActingAdmin(c))
	return c.JSON(autoSendState(ctx))
}

func badDraftID(c *fiber.Ctx) error {
	return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
		Status: "error", Error: "A numeric draft id is required.",
	})
}

func badBody(c *fiber.Ctx) error {
	return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
		Status: "error", Error: "Malformed request body.",
	})
}
