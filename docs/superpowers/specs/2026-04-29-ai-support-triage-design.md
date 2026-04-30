# AI Support Triage — L2 Approval Flow

**Date:** 2026-04-29
**Status:** Approved, executing
**Goal:** AI auto-categorizes, summarizes, dupe-detects, and drafts replies for incoming support tickets. Partner approves via one-click email links. Replies thread back into osTicket via standard email threading.

## Decisions locked

| Decision | Choice |
|---|---|
| Automation level | L2 — AI drafts every reply, partner approves via email Send/Edit/Skip |
| AI model | Claude Haiku (cheap + fast; ~$0.001 per ticket) |
| Approval surface | Email (no Slack, no custom UI) |
| Override behavior | High-confidence AI categorization overrides user's pick; low-confidence keeps user's pick |
| AI tone | Warm, direct, low on corporate-speak (matches Scrollr invite-email voice) |
| Threading method | `In-Reply-To` + `References` headers (Path A) |
| Message-ID capture | Resend webhook on outbound `email.sent` events |
| osTicket inbound recognition | BCC to `support@myscrollr.com` with proper References chain |

## Architecture

### Flow on ticket creation

1. User submits Contact Us → Scrollr API receives
2. Scrollr API calls Claude Haiku with: ticket text, last 50 ticket summaries (Redis sliding window), and FAQ content
3. Claude returns structured JSON: `{category, channel?, priority, summary, duplicate_of?, draft_reply, confidence}`
4. Scrollr API applies triage to OSTicket payload:
   - Override category if `confidence == "high"`
   - Set priority field
   - Prepend summary to body
   - Append duplicate hint to body if applicable
5. Scrollr API forwards to osTicket. osTicket creates ticket, returns ticket number.
6. Scrollr API stores `support_drafts` row: `{ticket_number, user_email, original_subject, draft_body, status: 'pending'}`
7. Scrollr API sends partner notification email via Resend with three JWT-signed URLs: Send / Edit / Skip
8. osTicket sends auto-response to user via Resend → Resend webhook fires → Scrollr captures Message-ID, stores in `osticket_message_ids`

### Flow on partner approval

1. Partner clicks Send / Edit / Skip URL in their email
2. Handler verifies JWT (signed, 24h TTL, single-use)
3. **Send**: Backend looks up Message-ID for ticket, sends email FROM `support@myscrollr.com` TO user via Resend with:
   - `In-Reply-To: <osticket-original-msg-id>`
   - `References: <osticket-original-msg-id>`
   - BCC to `support@myscrollr.com` so osTicket sees it via inbound piping → threads into ticket via `In-Reply-To`
   - Body: AI draft (or partner's edited version)
4. **Edit**: Returns small HTML page with draft pre-filled in textarea; partner edits, submits → falls into Send path with edited body
5. **Skip**: Marks draft as skipped; no email sent. Ticket stays open in osTicket for partner to handle manually.

### Flow on user reply

1. User clicks Reply on the AI's email (or any subsequent email)
2. Their email client sets:
   - `In-Reply-To: <our-ai-reply-id>` (the most recent message they're replying to)
   - `References: <osticket-original-id> <our-ai-reply-id>` (full chain)
3. Email arrives at `support@myscrollr.com`
4. osTicket sees References, walks the chain, finds the osTicket-known original Message-ID → threads correctly into the original ticket
5. Triggers a new auto-response cycle if configured; loops back to AI triage if a new draft is needed

## Components

### New files

| File | Purpose |
|---|---|
| `api/core/ai_triage.go` | Anthropic API client + prompt + response parsing |
| `api/core/handlers_resend_webhook.go` | Receives Resend `email.sent` webhook events; parses ticket # from subject; stores Message-ID |
| `api/core/handlers_support_approval.go` | JWT-signed URL handlers: Send / Edit / Skip |
| `api/core/support_drafts.go` | DB-backed draft state + Message-ID storage + outbound reply send via Resend |
| `api/migrations/000007_support_drafts.up.sql` | New tables |
| `api/migrations/000007_support_drafts.down.sql` | Rollback |

### Modified files

| File | Change |
|---|---|
| `api/core/support.go` | Hook AI triage into authenticated path; create draft after osTicket success; send partner notification |
| `api/core/handlers_support_public.go` | Same hook for anonymous path |
| `api/core/redis.go` | Sliding window helpers for recent ticket summaries |
| `api/core/server.go` | Register `/webhooks/resend`, `/support/approve`, `/support/edit`, `/support/skip`, `/support/edit/submit` routes |
| `k8s/configmap-core.yaml` | New env vars: `SUPPORT_AGENT_EMAIL`, `APPROVAL_BASE_URL`, `RESEND_WEBHOOK_SECRET`, `OSTICKET_BCC_EMAIL`, `AI_TRIAGE_ENABLED` |

### Database schema

```sql
CREATE TABLE support_drafts (
  id BIGSERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  original_subject TEXT NOT NULL,
  draft_body_html TEXT NOT NULL,
  ai_summary TEXT,
  ai_category TEXT,
  ai_priority TEXT,
  ai_channel TEXT,
  ai_duplicate_of TEXT,
  ai_confidence TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','edited','skipped','sent','failed')),
  edited_body_html TEXT,
  decided_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_support_drafts_status ON support_drafts(status);
CREATE INDEX idx_support_drafts_ticket ON support_drafts(ticket_number);

CREATE TABLE osticket_message_ids (
  id BIGSERIAL PRIMARY KEY,
  ticket_number TEXT NOT NULL,
  message_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('outbound_osticket','outbound_ai','inbound_user')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id)
);
CREATE INDEX idx_osticket_msgids_ticket ON osticket_message_ids(ticket_number);
```

### Anthropic prompt structure (high-level)

```
SYSTEM: You are a support triage assistant for Scrollr (a desktop ticker app).
Categorize incoming tickets and draft warm, direct replies grounded in our FAQ.

TASK:
1. Pick category: bug, feature, feedback, billing, account, channel
2. Pick priority: low, normal, high, emergency  (use signals: "lost data" → high; "can't log in" → high; "feature request" → low; etc.)
3. If category=channel, identify channel: finance, sports, rss, fantasy
4. Generate a one-line summary (10 words max)
5. Check for duplicates against the recent tickets list
6. Draft a reply matching this voice:
   - Warm, direct, lowercase first letter is ok
   - Lead with acknowledgment, then action
   - Reference FAQ if relevant; never make up fix steps
   - 2-4 short paragraphs max
   - Sign off "— the scrollr team"
7. Output confidence: high (clear), medium (some ambiguity), low (need human)

RECENT TICKETS:
{json array of last 50 summaries with ticket #s}

FAQ:
{markdown of curated FAQ articles}

USER TICKET:
Email: {email}
Category (user-picked): {category}
Subject: {subject}
Body: {body}

OUTPUT exactly this JSON shape (no markdown fences):
{
  "category": "...",
  "channel": "..." | null,
  "priority": "...",
  "summary": "...",
  "duplicate_of": "ticket-number" | null,
  "draft_reply_html": "<p>...</p>",
  "confidence": "high" | "medium" | "low"
}
```

## Approval URL design

Each draft generates 3 signed URLs:

```
https://api.myscrollr.com/support/approve?token=<jwt>
https://api.myscrollr.com/support/edit?token=<jwt>
https://api.myscrollr.com/support/skip?token=<jwt>
```

JWT claims: `{draft_id, action, exp: now+24h, jti: unique}`. Backed by HMAC with a new secret `SUPPORT_APPROVAL_HMAC_SECRET`. Single-use enforced via `decided_at IS NULL` check.

## Security model

| Threat | Mitigation |
|---|---|
| Approval URL leaked via forwarded email | JWT 24h TTL + single-use enforcement |
| Replay attack on approval URL | Single-use enforcement (checks `decided_at IS NULL`) |
| Resend webhook spoofed | Verify Svix-style signature with `RESEND_WEBHOOK_SECRET` |
| AI generates abusive/wrong reply | Partner approval gate (L2 default); confidence threshold for category override |
| AI hallucinates fix steps | Prompt grounded in FAQ content; "if not in FAQ, escalate" instruction |
| User's ticket text leaks to Anthropic | Documented in privacy policy update; attachments NOT sent |

## Out of scope (deferred)

- L3 auto-send (high-confidence direct send without partner approval) — can be added later by setting `auto_send_threshold` env var
- Slack notifications instead of email — possible follow-up
- AI assistance during partner reply composition — requires UI surface, not in this PR
- Fine-tuning a model on Scrollr's tickets — not needed at current volume
- Translation for non-English tickets — possible follow-up

## Acceptance criteria

- All Go modules: `go vet` clean, `go test` clean
- Migration applies cleanly
- New endpoints registered
- Local dry-run: trigger a fake ticket via curl, see AI triage hit, see draft email arrive, click Send, verify outbound email composed correctly with In-Reply-To set
- K8s deploy succeeds
- Production smoke: real ticket → AI triage applied → partner notification arrives → click Send → user receives reply → osTicket threads correctly

## Manual partner steps after merge

1. Add Resend webhook endpoint pointing at `https://api.myscrollr.com/webhooks/resend` (in Resend dashboard → Webhooks). Subscribe to `email.sent` event. Capture signing secret.
2. Add `RESEND_WEBHOOK_SECRET` and `ANTHROPIC_API_KEY` to K8s secrets.
3. Verify osTicket's outbound subject format includes the ticket number in a way the webhook handler can parse (default osTicket format is fine, but worth testing once after deploy).
4. Set `SUPPORT_AGENT_EMAIL` env var to partner's email.
