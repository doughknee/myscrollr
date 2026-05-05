# bug-tools — local CLI for the osTicket todo list

Two bash scripts that hit the read-only endpoints exposed by the
`scrollr-reply-api` osTicket plugin (v0.3.0+). Designed to make osTicket
your single source of truth for "stuff to fix" without copy-pasting
through the admin UI.

```
bugs              # list open bug + feature tickets, oldest first
bug 239171        # show full ticket detail with thread
```

Both scripts emit terminal-friendly text. Designed to be pasted into a
chat/AI session at the start of a dev block: "here's what's on the queue,
let's work the list."

## Requirements

- `bash` (macOS or Linux)
- `curl` (preinstalled everywhere)
- `jq` (`brew install jq` on macOS, `apt install jq` on Debian/Ubuntu)
- An osTicket API key bound to your laptop's public IP

## One-time setup

### 1. Create a dedicated API key in osTicket

osTicket admin panel → **Manage → API Keys → Add New API Key**:

- **IP Address**: your laptop's current public IP. Find it with
  `curl -s ipinfo.io/ip`.
- **Permissions**: leave as default (Can Create Tickets is fine; the
  plugin only checks for that flag, not for write privileges, since
  the list/detail endpoints are read-only).
- **Notes**: "TODO list (laptop) — bug-tools CLI" or similar so you
  can identify it later.

Click Add. Copy the generated API key — you'll need it in the next
step.

If your public IP changes (e.g., new ISP, VPN, travel), you'll need
to update the API key's `IP Address` field in osTicket admin to match.
A second key for a second IP works too.

### 2. Add env vars to your shell

In your `~/.zshrc` / `~/.bashrc` / equivalent:

```sh
export OSTICKET_TODO_API_KEY="<the key from step 1>"
export OSTICKET_URL="https://support.myscrollr.com"   # or wherever your osTicket lives
```

Reload your shell or `source` the rc file.

### 3. Install the scripts

The simplest path is to symlink them into a directory already on your
`$PATH`. From the repo root:

```sh
mkdir -p ~/.local/bin
ln -sf "$(pwd)/scripts/bug-tools/bugs" ~/.local/bin/bugs
ln -sf "$(pwd)/scripts/bug-tools/bug"  ~/.local/bin/bug
```

If `~/.local/bin` isn't on your `$PATH` yet, add it:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Symlinking (instead of copying) means script updates from `git pull`
take effect immediately.

### 4. Smoke test

```sh
bugs                  # should print your open bug+feature tickets
bug <some-number>     # should print full thread for that ticket
```

If you get `401 Unauthorized`, your API key isn't bound to your current
IP — check `curl -s ipinfo.io/ip` against what you set in osTicket.

If you get `403 Forbidden`, the API key needs the `Can Create Tickets`
permission flag (the plugin reuses that check; will not actually create
anything).

## Usage

### `bugs` — list open tickets

```sh
bugs                       # open bug+feature tickets, oldest first (default)
bugs all                   # all topics, open status
bugs bug                   # only bug topic, open
bugs feature               # only feature topic, open
bugs bug closed            # closed bug tickets
bugs all all               # everything regardless of status

bugs <topic> <status>      # general form
```

Output is one ticket per line:

```
[239171] HIGH bug      ticker not updating after sleep                       (doni, updated 2026-04-30)
[716831] NORM feature  add weather widget                                    (doni, updated 2026-04-29)
[798828] NORM bug      stocks frozen on Free tier                            (other, updated 2026-04-28)
─── 3 ticket(s) — topic=bug,feature status=open — oldest first ───
```

Priority is the first column after the number (`EMRG`, `HIGH`, `NORM`,
`LOW `). Topic is truncated to 8 chars. Subject is truncated to 60 chars.
Updated date is YYYY-MM-DD, no time.

### `bug <number>` — full ticket detail

```sh
bug 239171
```

Output includes a metadata header (subject, topic, priority, status,
user, dates, URL) and the full thread with HTML stripped:

```
─── Ticket #239171 ───
Subject:  ticker not updating after sleep
Topic:    bug | Priority: high | Status: open (open)
From:     Doni <doni@myscrollr.com>
Assigned: Admin istrator
Created:  2026-04-15T10:23:00Z
Updated:  2026-04-30T14:55:00Z
URL:      https://support.myscrollr.com/scp/tickets.php?id=78

─── Thread (3 entries) ───
[2026-04-15T10:23:00Z] User message by Doni:
After my Mac wakes from sleep, the ticker shows yesterday's prices...

[2026-04-16T09:01:00Z] Agent response by Admin:
Hi! Thanks for the report. Can you confirm what version of the desktop...

[2026-04-30T14:55:00Z] User message by Doni:
Still happening on v1.0.4, here's a screenshot...
```

Designed so you can copy the entire output into a chat/AI session
and have full context for the bug without anyone clicking around in
osTicket admin.

## Resolution flow

When you ship a fix, mark the PR with `[fixes #239171]` (or
`[closes #239171]`) anywhere in the title or body. After the PR
merges, a GitHub Action automatically:

1. Posts a templated agent reply to the user via the existing
   reply endpoint
2. Closes the ticket
3. The Discord thread (if one exists) flips to `🔒 closed`

The user gets an email confirmation; the ticket disappears from your
`bugs` list. Multiple ticket references in one PR work too:

```
fix(ticker): repaint after wake from sleep

[fixes #239171]
[fixes #716832]
```

See `.github/workflows/auto-close-osticket.yml` for the GitHub Action
config and the parsing rules.

## Submitting new tickets

These scripts are read-only. To open a new ticket (when you find a bug
worth tracking), use the osTicket agent panel directly:

`https://support.myscrollr.com/scp/tickets.php?a=open`

Pick **Topic = bug** (or feature, or whatever fits), fill in subject +
description, submit. The ticket will appear in your next `bugs` run.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` | API key is bound to a different IP than your laptop's current public IP. Update in osTicket admin. |
| `403 Forbidden` | API key missing `Can Create Tickets` permission flag. |
| `404 Not Found` on `bug 239171` | Ticket number doesn't exist or was deleted. |
| `bugs` returns "No tickets matching..." | Either you have no open tickets in those topics (good news), or the topic name doesn't match what's in osTicket. Try `bugs all` to see everything. |
| `jq: command not found` | Install jq: `brew install jq` (macOS) or `apt install jq` (Linux). |
| Long subjects truncated mid-word | Expected — `bugs` truncates subject to 60 chars for column layout. Run `bug <number>` for the full text. |

## Updating

The scripts are version-tracked in this repo. After `git pull`, the
symlinks at `~/.local/bin/bugs` + `~/.local/bin/bug` automatically
pick up the latest versions (no reinstall needed).

The plugin endpoints they hit (`api.list.php` etc.) are deployed to
osTicket separately — see `osticket-plugins/scrollr-reply-api/README.md`
for the plugin install instructions.

## Related

- **osTicket plugin source**: `osticket-plugins/scrollr-reply-api/`
- **GitHub Action for auto-close**: `.github/workflows/auto-close-osticket.yml`
- **Existing reply API endpoint** (POST replies via core-api): see plugin's `api.reply.php`
