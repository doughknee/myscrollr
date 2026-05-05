# Scrollr Reply API plugin for osTicket

A small osTicket plugin that does three things:

**1. REST endpoint for posting agent replies** — fixes osTicket's missing reply API, used by the Scrollr core API to deliver AI-drafted replies into existing tickets:

```
POST /api/tickets/{number}/reply.json
Headers: X-API-Key: <existing osTicket API key>
Body:
  {
    "reply_html":   "<p>Hi! Thanks for the report...</p>",
    "staff_id":     1,
    "signal_alert": true
  }
```

**2. Outbound webhook on user follow-ups** — listens for osTicket's `threadentry.created` signal, filters to user messages on existing tickets (skipping the initial ticket creation), and POSTs to the Scrollr core API so it can run AI triage on the reply and notify the partner. Closes the conversation loop so users get continuous AI-assisted support instead of dead-ending after one round.

```
POST <SCROLLR_WEBHOOK_URL>     # default: https://api.myscrollr.com/webhooks/osticket/thread-message
Headers: X-Scrollr-Webhook-Secret: <SCROLLR_WEBHOOK_SECRET>
Body:
  {
    "event":            "thread.message",
    "ticket_number":    "239171",
    "ticket_id":        78,
    "thread_entry_id":  95,
    "user_email":       "user@example.com",
    "user_name":        "User",
    "subject":          "App crashes on startup",
    "message_html":     "...the user's reply body...",
    "created":          "2026-05-01 04:48:00"
  }
```

**3. Read-only ticket listing + detail endpoints** (v0.3.0+) — fills the gap where osTicket has no documented HTTP API to LIST or READ existing tickets. Used by the local `bugs`/`bug` CLI tools in `scripts/bug-tools/` for a developer todo-list view of osTicket without leaving the terminal.

```
GET /api/tickets.json
  ?status=open|closed|all       (default: open)
  ?topic=bug,feature             (default: bug,feature; comma-separated; "all" = no filter)
  ?limit=50                      (default: 50, max: 100)
  ?since=2026-04-01T00:00:00Z    (optional ISO-8601, filters by lastupdate)
  ?assigned_to=<staff_id>        (optional)

GET /api/tickets/{number}.json
```

Both authenticated with the same X-API-Key header used by the reply endpoint. Subjects, priorities, statuses, full thread bodies (HTML stripped to plain text) — everything you'd see in osTicket's admin UI but as JSON. See `scripts/bug-tools/` in this repo for the canonical consumer.

## Why this exists

osTicket's documented HTTP API supports ticket *creation* only — there is no built-in REST endpoint to post a reply, change status, or add a note to an existing ticket. The agent web UI is the only first-class reply path.

This is a problem when you have an upstream service (e.g. an AI triage layer) that needs to drive osTicket programmatically. The well-known workarounds all have failure modes:

| Workaround | Failure mode |
|---|---|
| Email a reply BCC'd to osTicket from the agent's address | osTicket sees `From: <staff>` and creates a NOTE (type='N'), not a Reply (type='R'); also fails to thread when the agent isn't a Collaborator |
| `POST /api/tickets.email` with crafted MIME | Threads correctly but produces messages, not agent replies; cannot trigger outbound user notification |
| Direct MySQL `INSERT INTO ost_thread_entry` | Display-only — bypasses the mailer entirely, no outbound email; schema may drift on upgrade |
| Add `ai-bot@` as Collaborator on every ticket | Per docs, collaborator messages do not trigger user notifications |

This plugin sidesteps all of them by calling `Ticket::postReply()` — the same internal method the agent web UI invokes when an agent clicks "Submit Reply" on the ticket page. That gives us:

- A real `type='R'` thread entry attributed to the configured staff agent
- The standard outbound user-notification email through `Dept::getReplyEmail()`
- All the side-effects the agent UI gets (status update, `isanswered=1`, `lastupdate`, `Signal::send('thread.response.posted', ...)` for other plugins listening)

## Compatibility

Tested target: **osTicket v1.17.x**.

`Ticket::postReply()` has been the canonical reply method since at least 1.14 and is heavily exercised by the agent UI on every reply, which makes it stable across upgrades. As long as that method's signature stays put, this plugin keeps working.

If your osTicket is on 1.16 or earlier, you should still be fine — but verify the call signature in `include/class.ticket.php` before deploying. (Search for `function postReply` and confirm it takes `($vars, &$errors, $alert=true)`.)

## Installation

Two deployment paths. **Pick whichever is easier given how your osTicket container is built.**

### Option A — kubectl-exec copy (no image rebuild)

Use this if you don't control the osTicket Dockerfile or want a fast hot-deploy.

```sh
# Copy the plugin into the running osTicket pod
kubectl cp osticket-plugins/scrollr-reply-api \
  <namespace>/<osticket-pod>:/var/www/html/include/plugins/scrollr-reply-api

# Or if you already have a shell open in the pod:
#   docker cp / cp -r the directory into /var/www/html/include/plugins/

# Verify the directory is in place
kubectl exec -n <namespace> <osticket-pod> -- ls -la /var/www/html/include/plugins/scrollr-reply-api
```

This survives until the next pod restart. **It does NOT survive a re-deploy** — the plugin will need to be copied again. If your osTicket image is rebuilt frequently, use Option B instead.

### Option B — Dockerfile bake (survives rebuilds)

Use this if you control the osTicket Dockerfile.

Add to your osTicket Dockerfile:

```dockerfile
# Bake the Scrollr Reply API plugin into the image
COPY ./osticket-plugins/scrollr-reply-api /var/www/html/include/plugins/scrollr-reply-api
RUN chown -R www-data:www-data /var/www/html/include/plugins/scrollr-reply-api
```

Adjust the `COPY` source path to wherever you stage the plugin during the build. If you maintain osTicket in a separate repo, you can either:

- Submodule this repo's `osticket-plugins/scrollr-reply-api` directory, or
- Copy the four files (`plugin.php`, `class.ScrollrReplyPlugin.php`, `api.reply.php`, `README.md`) into your osTicket repo at `include/plugins/scrollr-reply-api/`.

### After install (both paths)

1. Open the osTicket admin panel: **Admin Panel → Manage → Plugins**.
2. You should see "Scrollr Reply API" in the list. Click it.
3. Click **Enable** (or Install + Enable if it shows as not-yet-installed).
4. Confirm the plugin status shows as Active.
5. **Create at least one Plugin Instance** — this is critical and easy to miss. osTicket's `PluginManager::bootstrap()` only fires `Plugin::bootstrap()` for plugins with at least one ENABLED instance. A plugin can be installed and active in the database (`ost_plugin.isactive=1`) but if there are no enabled rows in `ost_plugin_instance`, the plugin's URL hooks never register.
   - On the plugin's page, look for **Instances** or **Add a New Instance**.
   - Create one with any name (e.g. "default"). The plugin has no per-instance config, so the form is effectively empty.
   - Toggle the instance to **Enabled** and save.
6. Restart the osTicket container/PHP-FPM so OPcache reloads the plugin classes.

The endpoint is now live at `https://<osticket-host>/api/tickets/{number}/reply.json`.

**Quick database verification** (skip if installing via admin UI worked first try):

```sql
SELECT id, name, install_path, isactive FROM ost_plugin
  WHERE install_path LIKE '%scrollr-reply-api%';
-- Expect: 1 row with isactive=1

SELECT id, plugin_id, flags, name FROM ost_plugin_instance
  WHERE plugin_id = (SELECT id FROM ost_plugin WHERE install_path LIKE '%scrollr-reply-api%');
-- Expect: at least 1 row with flags=1 (FLAG_ENABLED)
```

If the second query returns 0 rows, no instance exists — bootstrap won't run. Add one via the admin UI, or directly:

```sql
INSERT INTO ost_plugin_instance (plugin_id, flags, name, notes, created, updated)
VALUES (<plugin_id>, 1, 'default', '', NOW(), NOW());
```

Then restart the osTicket container.

### Verifying the install

Run a smoke test against a real ticket. Pick a ticket number from your osTicket admin, then:

```sh
curl -X POST 'https://<osticket-host>/api/tickets/<ticket-number>/reply.json' \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: <existing API key>' \
  -d '{
    "reply_html": "<p>Test reply from the Scrollr Reply API plugin. You can ignore this.</p>",
    "staff_id": 1,
    "signal_alert": false
  }'
```

Set `signal_alert: false` for the smoke test so you don't email the actual ticket owner. Expected response:

```json
{
  "status": "ok",
  "ticket_number": "239171",
  "ticket_id": 1247,
  "entry_id": 45822,
  "alert_sent": false,
  "staff_id": 1,
  "staff_name": "Support"
}
```

Then confirm in the agent UI:

- Open the ticket
- The thread should now show a new "Response" entry from the Support agent with the body you posted
- Status should still be Open (or whatever it was)
- `lastupdate` on the ticket should reflect the timestamp of the call

If everything looks right, run a second test with `"signal_alert": true` to verify the outbound user-notification email actually sends.

## Reply-loop webhook configuration (NEW)

The plugin also fires an outbound webhook to the Scrollr core API when users reply to support emails, so AI triage runs on follow-up messages too. Two env vars on the **osTicket container** control it:

| Env var | Required? | Default | Purpose |
|---|---|---|---|
| `SCROLLR_WEBHOOK_SECRET` | **Yes** | (none — webhook silently no-ops if unset) | Shared secret used to authenticate webhook requests to the Scrollr core API. Must match `SCROLLR_WEBHOOK_SECRET` on the core API side. |
| `SCROLLR_WEBHOOK_URL` | No | `https://api.myscrollr.com/webhooks/osticket/thread-message` | Override only if your core API is on a different host. |

### Setting the env vars on Coolify

In Coolify dashboard → osTicket service → **Environment Variables**:

```
SCROLLR_WEBHOOK_SECRET=<paste the same secret you set on core API>
```

Save → Coolify recreates the container with the new env. The plugin reads via `getenv()` on every signal fire, so the change takes effect on the first user message after the restart.

### Generating the shared secret

```sh
openssl rand -base64 48
```

Set the SAME value in both:
1. Coolify → osTicket service → Environment Variables → `SCROLLR_WEBHOOK_SECRET`
2. Kubernetes secret on the core API side (`kubectl patch secret scrollr-secrets ...` or via your secrets management process)

### Verifying the webhook fires

After installing/updating the plugin, send yourself a test ticket via the desktop app, get the AI reply, then reply to that AI reply email from your inbox. Within ~1 minute (osTicket cron interval permitting — see CRON_INTERVAL note below), the webhook fires and you should see a new partner-notification email arrive with a fresh AI draft for the follow-up.

If nothing fires, check osTicket System Logs (Admin Panel → System Logs) for `scrollr-reply-api` warnings — that's where the plugin records webhook delivery failures.

### CRON_INTERVAL gotcha

osTicket's IMAP polling runs via cron. The default `CRON_INTERVAL` in the `tiredofit/osticket` image is **10 minutes**, which means user replies via email take up to 10 minutes to land in osTicket regardless of what you set the IMAP polling interval to in osTicket admin.

Reduce by setting in your Coolify compose env:

```yaml
- 'CRON_INTERVAL=${CRON_INTERVAL:-1}'   # 1 minute
```

After this change, user replies arrive in osTicket within ~1 minute, and the plugin's reply-loop webhook fires immediately upon thread entry creation (no further delay).

## Request fields reference

```jsonc
{
  "reply_html":   "<p>...</p>",          // required, HTML body of the reply
  "staff_id":     1,                     // optional, the staff agent posting
  "staff_email":  "support@example.com", // optional, alternative to staff_id
  "signal_alert": true,                  // optional, default true — triggers outbound notification
  "claim":        false,                 // optional, default false — assigns ticket to staff
  "title":        "Re: subject"          // optional, override the email subject
}
```

**Auth fields**: One of `staff_id` or `staff_email` should resolve to a real osTicket staff agent. If neither is provided, the plugin falls back to the ticket's currently-assigned staff agent. If the ticket has no assignee and no staff is provided in the request, the call returns a 400.

**`signal_alert`**: When `true` (default), the user notification email goes out. When `false`, the thread entry is created but no email is sent — useful for smoke tests, dry runs, or in-app-only reply logging.

**`claim`**: When `true`, the staff agent is assigned to the ticket BEFORE the reply is posted. Mimics osTicket's "claim on response" agent-UI behavior. Default `false`.

## Auth model

This plugin reuses the `X-API-Key` header that osTicket already validates for `/api/tickets.json`. No new key, no new auth surface. The same IP-binding on the API key applies — if your existing tickets-create call works, this one will too from the same source IP.

The plugin checks `canCreateTickets()` on the API key. The reasoning: a key that can create tickets is already trusted enough to post agent replies. If you want a separate flag, add a new column to `ost_api_key` (e.g. `can_post_replies`) and update the check in `api.reply.php::reply()`.

## Logs and debugging

The plugin uses osTicket's global `$ost->logWarning()` for non-fatal issues. Errors return as standard osTicket API error envelopes (4xx/5xx + `{ "error": "..." }`).

For deeper debugging:

- **Agent UI**: a successful call shows up immediately in the ticket thread.
- **Database**: `ost_thread_entry` should have a new row with `type='R'`, the configured `staff_id`, and `source='API'`.
- **osTicket admin → System Logs**: if the call hits an internal exception (DB failure, mailer failure), it'll log there.

## Source code in this repo

```
osticket-plugins/scrollr-reply-api/
├── plugin.php                       # Manifest (osTicket-discoverable)
├── class.ScrollrReplyPlugin.php     # Plugin subclass; hooks Signal::connect('api', ...)
├── config.php                       # Stub PluginConfig (required by osTicket bootstrap chain)
├── api.reply.php                    # ScrollrReplyController; wraps Ticket::postReply()
└── README.md                        # This file
```

The implementation is ~200 lines of PHP across four files. No external dependencies beyond osTicket itself.

## Future work

- A separate `can_post_replies` permission on `ost_api_key` if/when we have multiple integrations with different trust levels.
- Optional `attachment_urls` field that fetches files and attaches them to the reply.
- Webhook-style outbound: emit a Scrollr-side webhook when the user replies via the user portal, so the upstream AI triage can react to user follow-ups without polling osTicket. (Use `Signal::connect('thread.message.posted', ...)` for that.)

## License

Same as the parent project (Scrollr) — AGPL-3.0.
