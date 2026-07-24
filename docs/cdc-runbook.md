# CDC (Sequin) Runbook

Operational guide for the change-data-capture pipeline that feeds real-time
dashboard updates from Postgres to the core API's SSE endpoint.

## Architecture

```
Postgres (DO Managed, scrollr-db)
  └── publication: sequin_pub (10 routed tables)
  └── replication slot: sequin_slot (logical, pgoutput)
        │
        │  WAL replication stream
        ▼
Sequin (self-hosted on scrollr-infra Coolify, sequin.myscrollr.com)
  └── reads slot, forwards to:
        │
        │  HTTP POST /webhooks/sequin with SEQUIN_WEBHOOK_SECRET
        ▼
core-api (k8s, scrollr/core-api — ANY replica receives the webhook)
  └── `handlers_webhook.go::HandleSequinWebhook`
  └── publishes to Redis topic PubSub: cdc:finance:*, cdc:sports:*, etc.
        │
        ▼
Redis pub/sub ──▶ EVERY core-api replica PSUBSCRIBEs the cdc:* patterns
  └── each replica fans out in-process to its own SSE connections
  └── channel-config changes broadcast `sse:ctl:resubscribe` so the
      replica holding the user's stream refreshes (ADR-0001)
        │
        ▼
Desktop client via SSE (`/events/dashboard`)
```

If Sequin stops consuming the slot, Postgres retains WAL indefinitely
because `max_slot_wal_keep_size = -1`. This has caused two billing
incidents on DO auto-scale already. See the "Failure modes" section.

## Fallback when CDC is down

The desktop client polls `/dashboard` via TanStack Query on a
tier-based interval (10-60s). This is the *canonical* source of truth;
CDC is an optimization for lower latency. **CDC being down is not a
user-visible outage** — it just means updates are delayed by up to
one polling interval.

Confirmed this was true for the ~20 hours between 2026-04-22 and
2026-04-23 when Sequin was in a broken replay loop; nobody noticed.

## Failure modes

### Mode 1: Sequin container stopped or crashed

**Symptoms:**
- `sequin.myscrollr.com` returns `503: no available server`
- Postgres: `SELECT * FROM pg_replication_slots WHERE slot_name = 'sequin_slot'` shows `active = false`
- `wal_retained` on the slot grows by ~1-2 GB/day
- Core API receives zero `/webhooks/sequin` requests

**Why it auto-scaled the DB on 2026-04-22:** after Sequin stopped
(exact cause unknown, Coolify was restarted at some point), the slot
accumulated 90 GB of WAL over ~3 weeks, triggering DO's 80%-full
auto-scale. DO won't shrink the volume after scaling.

### Mode 2: Sequin running but can't decode a WAL record

**Symptoms:**
- Sequin container is up, `/health` returns 200
- Sequin logs: `[SlotProducer] Replication disconnected: Postgrex.Error ... publication "sequin_pub" does not exist ... in the truncate callback, associated LSN X/XXXXXX`
- Sequin reconnects every ~10 seconds, fails immediately, never advances `confirmed_flush_lsn`
- Slot stays `active = false` (Sequin disconnects after each failed decode)
- WAL grows unbounded

**Actual incident on 2026-04-23:** the sports service used to run a
`TRUNCATE games` on startup as part of the ESPN→api-sports.io
migration. That TRUNCATE got written to WAL with the publication's
state at that moment. Sequin couldn't decode it ("publication does
not exist" from pgoutput's TRUNCATE callback — this error fires when
the publication OID in the WAL record doesn't match the current
publication OID, typically after a publication drop-and-recreate
cycle). **The ESPN truncate code was removed in PR #106**, so this
specific cause won't recur — but other TRUNCATEs can reproduce the
problem if someone runs one while reconfiguring the publication.

## Recovery: drop + recreate the slot

When Sequin is wedged, the cleanest fix is to drop the replication
slot so Postgres frees the retained WAL, then have Sequin create a
fresh slot starting from `current_wal_lsn`. Historical events between
`restart_lsn` and `current_wal_lsn` are lost; this is acceptable
because they were already unreachable (Sequin couldn't process them)
and the polling fallback is the source of truth anyway.

### Step 1 — Stop the bleeding (drop the slot)

Run via an in-cluster psql pod so the private DB is reachable:

```sh
kubectl -n scrollr get secret scrollr-secrets \
  -o jsonpath='{.data.DATABASE_URL}' | base64 -d > /tmp/db_url

kubectl -n scrollr run pg-drop --rm -i --restart=Never \
  --image=postgres:16-alpine \
  --env="PGURL=$(cat /tmp/db_url)" \
  --command -- sh -c 'psql "$PGURL" -c "SELECT pg_drop_replication_slot('"'"'sequin_slot'"'"');"'

rm -f /tmp/db_url
```

Postgres frees the retained WAL on the next checkpoint (within ~5
minutes). Verify:

```sql
SELECT slot_name, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS wal_retained
FROM pg_replication_slots;
-- Should show only pghoard_local with single-digit MB.
```

**Note:** DO will not shrink the volume after this. You'll stop
accumulating bills for new auto-scales but the already-allocated
storage stays. To shrink, you'd need to fork or restore to a smaller
cluster — DigitalOcean's fork/restore flow, then repoint `DATABASE_URL` in
the `scrollr-secrets` Secret and restart the affected deployments. (This
pointed at a `k8s-migration-runbook.md` that has never existed in the repo.)

### Step 2 — Recreate the Sequin connector

Sequin's admin UI at `https://sequin.myscrollr.com` (or whichever
domain it's currently reachable on):

1. Log in with admin credentials.
2. Navigate to **Databases** → find the `scrollr_db` connector.
3. Delete the existing database connector. This also removes
   Sequin's internal record of the now-dropped replication slot.
4. Click **Connect new database** and fill in:
   - Host: `private-scrollr-db-do-user-35353936-0.e.db.ondigitalocean.com`
   - Port: `25060`
   - Database: `defaultdb`
   - User: `doadmin` (or create a dedicated read-only replication user)
   - Password: from the DATABASE_URL secret
   - SSL mode: `require`
   - Publication name: `sequin_pub` (already exists, Sequin will reuse it)
   - Slot name: `sequin_slot` (Sequin will create a fresh one)
5. Under **Sinks**, recreate the webhook sink pointing at
   `https://api.myscrollr.com/webhooks/sequin`.
6. Copy the `SEQUIN_WEBHOOK_SECRET` value from `scrollr-secrets` (or
   rotate it — update both Sequin and the secret if you do).

Sequin will create a new slot starting at the current WAL position
and begin forwarding events immediately.

### Step 3 — Verify CDC is flowing

From a laptop with kubectl access:

```sh
kubectl -n scrollr logs -f deploy/core-api | grep -i sequin
```

You should see `[Sequin] ...` log lines within a few minutes of any
write to a table in `sequin_pub`. Quick way to force a write:

```sh
# Cause a finance trade write (trade updates fire every few seconds)
# OR touch a tracked_feeds row
kubectl -n scrollr run pg-touch --rm -i --restart=Never \
  --image=postgres:16-alpine \
  --env="PGURL=$(kubectl -n scrollr get secret scrollr-secrets \
         -o jsonpath='{.data.DATABASE_URL}' | base64 -d)" \
  --command -- sh -c 'psql "$PGURL" -c "UPDATE tracked_feeds SET last_success_at = NOW() WHERE url = (SELECT url FROM tracked_feeds LIMIT 1);"'
```

Watch core-api logs — you should see the corresponding
`[Sequin] ...` webhook delivery within 1-2 seconds.

## Which tables should the Sequin sink forward?

The `sequin_pub` publication should cover exactly the tables below — **only these 10 produce CDC events that core-api actually routes to an SSE topic**.
The rest are silently dropped in `api/internal/events/handlers_webhook.go`'s
`topicForRecord` function (`default: return ""`).

The sink in Sequin should forward only these 10 tables,
which keeps webhook volume low without losing functionality:

| Table | Topic produced | Purpose |
|---|---|---|
| `trades` | `cdc:finance:{SYMBOL}` | Live price updates |
| `games` | `cdc:sports:{LEAGUE}` | Live scores |
| `rss_items` | `cdc:rss:{feed_url_fnv_hash}` | New RSS items |
| `yahoo_leagues` | `cdc:fantasy:{league_key}` | Fantasy league updates |
| `yahoo_standings` | `cdc:fantasy:{league_key}` | Fantasy standings |
| `yahoo_matchups` | `cdc:fantasy:{league_key}` | Fantasy matchup scores |
| `yahoo_rosters` | `cdc:fantasy:{league_key}` | Fantasy roster moves |
| `user_preferences` | `cdc:core:user:{logto_sub}` | Cross-device pref sync |
| `user_widgets` | `cdc:core:user:{logto_sub}` | Widget enable/disable sync |
| `markets` | `cdc:predictions:all` | Prediction-market updates |

### Why not forward everything?

1. **No user-visible effect.** Routing decisions in `topicForRecord`
   silently drop non-matching tables. Forwarding them burns webhook
   volume and core-api CPU for zero benefit.
2. **Billing/admin tables are noisy.** `stripe_webhook_events`,
   `_sqlx_migrations`, `schema_migrations*` would spam the sink
   without ever producing a topic payload.
3. **Polling already covers config data.** `tracked_symbols`,
   `tracked_leagues`, `tracked_feeds`, `teams`, `standings`,
   `yahoo_users`, `yahoo_user_leagues`, `user_deletion_requests`,
   `stripe_customers` all change rarely and are served by the normal
   GET paths.

### Why keep them in the publication?

Adding a table to `sequin_pub` is cheap — Postgres still decodes the
changes into WAL stream regardless. Keeping all 23 tables in the
publication means: if you later want CDC for a new purpose (say, a
real-time billing notification on `stripe_customers`), you only need
to add the table to the sink filter and update `topicForRecord` — no
Postgres publication change required.

### Adding a new routed table

When you want a new table to stream via CDC:

1. Add a case to `topicForRecord` in
   `api/internal/events/handlers_webhook.go` and define a topic prefix constant
   in `api/internal/platform/constants.go` if needed.
2. Add the table to the Sequin sink's table-filter list.
3. Verify via `kubectl logs deploy/core-api | grep '[Sequin]'` after
   triggering a write to the table.

## Adding a new table to CDC

The `sequin_pub` publication explicitly lists every table it covers
(we can't use `FOR ALL TABLES` on DO managed Postgres — superuser-only).
When you add a new table via migrations and want Sequin to stream
its changes:

```sql
ALTER PUBLICATION sequin_pub ADD TABLE public.new_table_name;
```

Run this via the in-cluster psql pod pattern (same as the recovery
steps above). No Sequin restart required — it picks up the new table
at the next publication refresh (within ~30 seconds).

If you forget, CDC just silently doesn't fire for the new table —
harmless but surprising. Consider adding an assertion in your
integration tests that every public table appears in the publication.

## Replica identity

Sequin populates the `changes` field in its webhook payload from the
"old row" values of UPDATE/DELETE events. Postgres only logs those old
values to WAL when the table's `REPLICA IDENTITY` is set to `FULL`
(otherwise only the primary key is logged).

**Current state**, verified against production 2026-07-21:

| Table | Replica identity |
|---|---|
| `markets` | `FULL` |
| everything else, published or not | default |

An earlier version of this table claimed `user_widgets`,
`user_preferences` and the four `yahoo_*` tables were `FULL`. They were,
set 2026-04-23 to silence a Sequin health-check warning. The 2026-07-21
database reset cleared them, **and nothing broke** — which is the useful
data point.

**Nothing needs `FULL`.** It exists so logical decoding can populate
Sequin's `changes` field, and no consumer reads that field: the desktop
(`desktop/src/hooks/useDashboardCDC.ts`) reads `cdc.record` and
`cdc.action` only. `FULL` makes Postgres log the entire old row on every
UPDATE/DELETE — on `trades` that is ~40 writes/second of WAL whose output
is discarded.

So if Sequin's health check flags a table, the default answer is **accept
the warning**. Only set it if you have a concrete reader for `changes`:

```sql
ALTER TABLE public.<table> REPLICA IDENTITY FULL;
```

Migration `000004` dropped `FULL` from `standings` and `teams`, which are
not in `sequin_pub` at all — they were paying the WAL cost with no
possible decoder. (`yahoo_standings` is published; plain `standings` is
the sports-side table. Easy to confuse.)

## Publication settings

The current `sequin_pub` is created with:

```sql
CREATE PUBLICATION sequin_pub FOR TABLE <explicit list>
  WITH (publish_via_partition_root = true);
```

`publish_via_partition_root = true` is a forward-looking default —
we don't have partitioned tables today, but if we add any later
(e.g. time-series partitioning on `rss_items`), Sequin will stream
changes via the root table instead of the individual leaf
partitions, which is almost always what downstream consumers want.

Sequin's health check explicitly requires this setting and will
report the publication as unhealthy without it.

### Mode 3: dropped tables silently empty the publication

**This is the nastiest failure mode in this document, because every
health signal stays green while CDC is completely dead.**

`sequin_pub` is `FOR TABLE <explicit list>`, not `FOR ALL TABLES`.
Postgres removes a table from a publication when the table is dropped —
so anything that recreates the schema empties the publication:

- `DROP SCHEMA public CASCADE` (the database-reset runbook)
- a migration that drops and recreates a routed table
- restoring into a fresh database

What it looks like afterwards, and why it fools you:

| Signal | Reads as |
|---|---|
| Sequin's replication slot | `active = true`, small lag — it *is* consuming WAL |
| Sequin's console | connected, healthy |
| core-api logs | silent (the CDC path only logs on error) |
| Every API endpoint | 200 |
| Actual CDC delivery | **zero events, forever** |

Confirm it in one query:

```sql
SELECT count(*), string_agg(tablename, ', ' ORDER BY tablename)
FROM pg_publication_tables WHERE pubname = 'sequin_pub';
```

`0 tables` means this happened. Updating the table selection in Sequin's
UI will *not* fix it — the gap is in Postgres, one layer below.

Fix by re-adding the routed tables (the 10 from the table above):

```sql
ALTER PUBLICATION sequin_pub ADD TABLE
  user_widgets, user_preferences, trades, games, rss_items, markets,
  yahoo_leagues, yahoo_standings, yahoo_matchups, yahoo_rosters;
```

Then verify events actually flow — don't trust the slot:

```sh
# subscribe for 30s; finance alone should produce dozens during market hours
kubectl -n scrollr run cdcwatch --rm -i --restart=Never --image=redis:7-alpine -- \
  redis-cli -u "$REDIS_URL" psubscribe 'cdc:*'
```

**Add this to any database-reset checklist.** A reset that verifies the
schema came back is not finished: replication is separate state, and it
does not come back with it. Observed 2026-07-21, when the unification
reset dropped CDC for the ~40 minutes it took to notice.

Replica identity survives a reset if the recreated tables declare it, but
check anyway — see [Replica identity](#replica-identity).

## Prevention: bounding WAL growth

DO's managed Postgres defaults `max_slot_wal_keep_size` to `-1` (no
limit). This means any stale slot holds WAL indefinitely — this has
already caused two billing incidents (see "Failure modes"). To cap
the damage a future Sequin outage can do:

1. **Set the cap.** DO control panel → `scrollr-db` cluster →
   **Settings** → **Advanced Configuration** → **Edit** → set
   `max_slot_wal_keep_size` to `10240` (the panel takes MB → 10 GB).

   `doctl databases configuration update` is known-broken for this
   (tested June 2026 against doctl's bundled godo: the API returns
   `422 the mask must be set with which fields are being updated`).
   If you want a CLI path, PATCH the API directly — it accepts the
   single-key body fine:

   ```sh
   doctl databases list   # get the cluster UUID
   curl -X PATCH "https://api.digitalocean.com/v2/databases/<db-uuid>/config" \
     -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"config": {"max_slot_wal_keep_size": 10240}}'
   # expect HTTP 200 with empty body
   ```

2. **Verify it took effect** — read the config back:

   ```sh
   curl -s "https://api.digitalocean.com/v2/databases/<db-uuid>/config" \
     -H "Authorization: Bearer $DIGITALOCEAN_TOKEN" | \
     jq .config.max_slot_wal_keep_size   # want: 10240, not absent/-1
   ```

   or via psql against the cluster:

   ```sql
   SHOW max_slot_wal_keep_size;   -- want: 10GB, not -1
   ```

3. With this set, Postgres will forcibly break any slot whose
   `restart_lsn` falls more than 10 GB behind current WAL. Sequin
   will then see a `wal_removed` error on reconnect — which is loud,
   obvious, and fixable via slot recreate (see "Recovery"). Way
   better than silent billing.

Sizing: trades (~40 writes/sec) dominate WAL volume; 10 GB is many
hours of slot-stall headroom, and both 2026-04 incidents blew well
past it before detection — so the cap binds long before auto-scale
billing does. This is managed-cluster config — it cannot be set via
the regular DATABASE_URL path or from this repo.

**Status: applied 2026-06-10** to `scrollr-db`
(8ab18589-09fb-4a7a-aaca-03f2dc5d56a2) via the direct API PATCH
above; readback confirmed `10240`. If the cluster is ever rebuilt or
migrated, re-apply and re-verify.

## Related

- PR #106 — removed the ESPN `TRUNCATE games` on startup, the code
  path that likely wrote the poisoned WAL record behind the 2026-04-23
  incident.
- `api/internal/events/handlers_webhook.go` — the webhook receiver.
- `api/internal/platform/constants.go` — CDC topic prefixes.
