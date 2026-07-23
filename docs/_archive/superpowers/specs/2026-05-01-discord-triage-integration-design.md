# Discord-thread support triage integration — design

**Status:** approved (m1727), executing
**Owner:** Scrollr core
**Last updated:** 2026-05-01

## Decisions locked

| # | Question | Choice |
|---|---|---|
| 1 | Email kill / keep / both | **Both** (toggleable later via env) |
| 2 | Channels | **Single channel** for all support threads |
| 3 | Thread lifecycle on close | **Auto-archive** when ticket closes |
| 4 | Privacy | Channel is team-only (user-confirmed) |
| 5 | Slash commands | **Yes** — include `/inbox` + `/ticket <number>` |
| 6 | Edit UX | **Discord modal** (text-area, pre-filled draft) |
| 7 | Error handling | **Fail-open** — Discord errors don't block ticket creation; email is the safety net |
| 8 | Rate limits | Acceptable at current volume |

## Why this exists

The user's stated workflow lives in Discord more than email. Today the AI triage pipeline notifies the partner (Phil / Doni / etc.) via an HTML email with three buttons: Send, Edit, Skip. Email is async, easy to miss on mobile, and doesn't support multi-team-member collaboration well. Discord threads do.

## Architectural insight: no separate bot service required

Discord supports two patterns:

1. **Gateway bots** — long-running websocket connection, event-driven. Required for things like `MESSAGE_CREATE` events, voice, presence.
2. **HTTP-only bots** — outbound REST + inbound interaction webhooks. No persistent connection.

For this use case (post threads, post messages, handle button + modal interactions, slash commands), HTTP-only is sufficient. Discord POSTs button clicks and modal submits to a webhook URL we host. We respond inline. No daemon, no gateway, no separate service.

**All Discord logic lives in core-api.** No new K8s deployment.

## Endpoint contract

### Outbound (core-api → Discord REST API)

Authenticated via `Authorization: Bot <DISCORD_BOT_TOKEN>` header.

- `POST /api/v10/channels/{channel_id}/threads` — create a public thread for a new ticket
- `POST /api/v10/channels/{thread_id}/messages` — post initial message + buttons, post reply messages, post confirmations
- `PATCH /api/v10/channels/{thread_id}` — archive thread on ticket close
- `POST /api/v10/applications/{application_id}/guilds/{guild_id}/commands` — register slash commands (one-time on startup)

### Inbound (Discord → core-api)

Single endpoint: `POST /webhooks/discord/interactions`

All Discord interaction types funnel through here:
- `PING` (Discord verification handshake) — respond `{"type": 1}`
- `APPLICATION_COMMAND` — slash commands (`/inbox`, `/ticket <number>`)
- `MESSAGE_COMPONENT` — button clicks (Send/Edit/Skip)
- `MODAL_SUBMIT` — partner submitting an edited reply

Authenticated via Ed25519 signature verification using `DISCORD_PUBLIC_KEY`. Discord signs every request with `X-Signature-Ed25519` + `X-Signature-Timestamp` headers.

## Data model

New table `support_ticket_threads` mapping ticket numbers to their Discord threads:

```sql
CREATE TABLE support_ticket_threads (
    ticket_number      TEXT PRIMARY KEY,
    discord_thread_id  TEXT NOT NULL,
    channel_id         TEXT NOT NULL,
    archived           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX support_ticket_threads_thread_id_idx
    ON support_ticket_threads(discord_thread_id);
```

Why a separate table instead of a column on `support_drafts`: a single ticket has many drafts (initial + each user reply), but ONE Discord thread. Keying by ticket_number cleanly expresses 1:1 ticket-to-thread.

## Flow walkthrough

### A. New ticket arrives

1. User submits via `/support/ticket` → osTicket creates ticket → core-api triages → `support_drafts` row created (unchanged from today)
2. `notifyPartnerAfterDraft` fires:
   - **Always** sends partner-notification email (today's behavior, retained as fallback)
   - **Additionally** calls Discord:
     - `POST /api/v10/channels/{channel_id}/threads` — create thread named `[#{ticket_number}] {subject_preview}`
     - `POST /api/v10/channels/{thread_id}/messages` — post initial message with content blocks + 3 buttons
     - `INSERT INTO support_ticket_threads` mapping ticket number to thread ID
3. If Discord call fails: log warning, continue (email already sent, fail-open)

### Initial Discord message structure

```
**Ticket #239171** — bug · normal · medium confidence

> What the user wrote:
> [user's message body, quoted]

**AI summary:** Stocks not updating after sleep

**Drafted reply:**
[AI's drafted reply body]

[ Send ✅ ]   [ Edit ✏️ ]   [ Skip ⏭️ ]
```

Buttons carry the draft ID in their `custom_id`:
- `support_send:{draft_id}`
- `support_edit:{draft_id}`
- `support_skip:{draft_id}`

### B. Partner clicks "Send"

1. Discord POSTs `MESSAGE_COMPONENT` interaction to `/webhooks/discord/interactions`
2. core-api verifies Ed25519 signature
3. Parses `custom_id`, extracts action = `send`, draft_id
4. Calls existing `doSendApprovedReply(ctx, draft_id)` — which hits the osTicket plugin, sends user reply, optionally closes ticket
5. Responds to Discord interaction with type 4 (`CHANNEL_MESSAGE_WITH_SOURCE`): "✅ Sent to user"
6. If close-ticket flag: archive the Discord thread via `PATCH /channels/{thread_id}` with `archived: true`

### C. Partner clicks "Edit"

1. Discord POSTs `MESSAGE_COMPONENT` interaction (action = edit)
2. core-api responds with type 9 (`MODAL`): a modal with one text-area input pre-filled with the AI's draft
3. Partner edits, clicks Submit → Discord POSTs `MODAL_SUBMIT` interaction
4. core-api verifies signature, extracts edited body + draft_id from modal `custom_id`
5. Calls existing edit-then-send path — `markDraftSent(ctx, draft_id, edited_body)` then `doSendApprovedReply`
6. Confirmation in thread: "✏️ Edited and sent"

### D. Partner clicks "Skip"

1. Discord POSTs interaction (action = skip)
2. core-api calls `markDraftSkipped(ctx, draft_id)`
3. Confirmation in thread: "⏭️ Skipped"
4. Optionally archive the thread (skipping is effectively closing)

### E. User replies via email

1. osTicket fetches inbound email → plugin's `notify.message.php` fires signal → POSTs to `/webhooks/osticket/thread-message`
2. core-api creates new `support_draft` (existing flow, unchanged)
3. core-api looks up `support_ticket_threads` for this ticket_number
4. If thread exists: post a new message in that thread with the user's reply + new approval buttons
5. If thread doesn't exist (e.g., the original was archived): create a new thread, persist the mapping
6. Email also gets sent (fallback)

### F. Slash commands

- `/inbox` — list 5 most recent pending drafts (status = pending). Posts in the channel with thread links.
- `/ticket <number>` — fetch latest draft for that ticket and post it in the current channel/thread with action buttons.

Slash commands are registered once at core-api startup via the `POST /applications/{app_id}/guilds/{guild_id}/commands` endpoint (idempotent — Discord upserts by command name).

## Configuration

### New env vars (in `scrollr-secrets`)

| Name | Type | Required | Purpose |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | secret | yes | Outbound REST auth |
| `DISCORD_PUBLIC_KEY` | secret | yes | Inbound interaction signature verification |
| `DISCORD_APPLICATION_ID` | secret | yes | Slash command registration |
| `DISCORD_GUILD_ID` | secret | yes | Server (guild) ID |
| `DISCORD_SUPPORT_CHANNEL_ID` | secret | yes | Channel where threads get created |
| `SUPPORT_NOTIFY` | env | optional | `discord`, `email`, or `both` (default `both` per Q1) |

Discord public key + bot token are sensitive and go in K8s secret. Other IDs are technically not secret but kept consistent with the secrets pattern.

### Discord application setup (one-time, manual)

User does this in the Discord developer portal:
1. New application → Bot → copy bot token, application ID, public key
2. OAuth2 → URL Generator:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `View Channels`, `Send Messages`, `Embed Links`, `Create Public Threads`, `Send Messages in Threads`, `Manage Threads`, `Read Message History`, `Use Application Commands`
3. Use the generated URL to install in the support server
4. In Discord application settings, set "Interactions Endpoint URL" → `https://api.myscrollr.com/webhooks/discord/interactions`
5. Discord will verify the URL via a PING interaction; core-api must respond correctly

## Failure modes & fail-open contract

| Scenario | Behavior |
|---|---|
| Discord REST 5xx on thread creation | Log error, continue. Email partner notification still goes out. |
| Discord REST 5xx on reply posting | Same — log + continue, email backup. |
| Ed25519 signature verification fails on inbound | Reject with 401. Discord retries automatically up to 3x. |
| Bot token revoked / invalid | All outbound REST calls fail; logs flood; email path is unaffected. Detect via 401 from Discord, log loudly, ops should rotate token. |
| Thread archived before partner can act | Buttons in archived threads are still actionable. Discord auto-restores the thread on user activity. |
| Partner deletes a draft message | No-op for core-api. Action buttons still work via the JWT-signed `custom_id`. |

## Slash command schemas

```json
[
  {
    "name": "inbox",
    "description": "Show pending support drafts (most recent 5)",
    "type": 1
  },
  {
    "name": "ticket",
    "description": "Show the latest draft for a ticket number",
    "type": 1,
    "options": [
      {
        "name": "number",
        "description": "osTicket ticket number (e.g. 239171)",
        "type": 3,
        "required": true
      }
    ]
  }
]
```

Registered via guild-scoped command endpoint so they appear instantly (vs. global which has 1-hour cache).

## Out of scope for v1

These are easy follow-ups but explicitly NOT in the initial PR:

- Per-category channel routing (#support-bugs vs #support-billing) — single channel per Q2
- Reaction-based actions (👍 = send, ✏️ = edit, ❌ = skip) — buttons are clearer
- Voice notification of new ticket — not requested
- Web dashboard for partner — Discord IS the dashboard
- Bot mentions / @ai-bot prompts to draft a custom reply — interesting but later

## Verification plan

After deploy, end-to-end test:

1. Submit a fresh test ticket → thread appears in #support-tickets within seconds
2. Initial message contains user body + AI summary + drafted reply + 3 buttons
3. Click Send → user receives email reply (osTicket plugin path) → thread shows "✅ Sent"
4. Submit another ticket → click Edit → modal opens with pre-filled draft → edit → Submit → user receives EDITED reply → thread shows "✏️ Edited and sent"
5. Submit another → click Skip → thread shows "⏭️ Skipped" → no email sent to user
6. User replies to one of the sent tickets → new message + buttons appear in same thread
7. Run `/inbox` → bot lists pending drafts
8. Run `/ticket 239171` → bot posts that ticket's draft with action buttons

## Migration & rollout

- Backend deploys with `SUPPORT_NOTIFY=both` by default. Email path is unchanged. Discord notifications are additional.
- Once partner is confident Discord is working, can flip to `SUPPORT_NOTIFY=discord` to suppress redundant emails.
- Rolling back is just unsetting the Discord secrets — code paths fail-open and email path takes over.
