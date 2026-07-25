# Fantasy service — Yahoo integration

The one remaining separate backend service (ADR-0002 folded the other four
ingesters into core). It stays separate because it owns a stateful Yahoo OAuth
session and a sync loop; core proxies to it rather than absorbing it.

Go + Fiber, port `8084`. Run it with the rest of the stack — see
[`LOCAL_SETUP.md`](../../docs/LOCAL_SETUP.md); the short version is
`cd channels/fantasy/api && go run .` with `channels/fantasy/.env` loaded. It needs
`YAHOO_CLIENT_ID` / `YAHOO_CLIENT_SECRET`, and its `ENCRYPTION_KEY` must match
core's.

> Route table below is transcribed by hand from `channels/fantasy/api/main.go`.
> If they disagree, the code wins.

## Routes

### Public

| Method | Path | Notes |
|---|---|---|
| GET | `/yahoo/start` | Begins the OAuth redirect to Yahoo. **Not** a token refresh — every other route refreshes an expired access token on its own. Reached only via core, which validates the session and sets `X-User-Sub` before proxying: dropping that requirement previously let an attacker bind their Yahoo credentials to any Logto sub via `?logto_sub=victim`. |
| GET | `/yahoo/callback` | Called by Yahoo's servers. Identity comes from the CSRF state cookie issued during `/yahoo/start`. |
| GET | `/yahoo/health` | Health probe. |

### Protected — core gateway sets `X-User-Sub`

| Method | Path | Purpose |
|---|---|---|
| GET | `/users/me/yahoo-status` | Whether the user has a live Yahoo connection. |
| GET | `/users/me/yahoo-summary` | Condensed view for the account page. |
| GET | `/users/me/yahoo-leagues` | The user's imported leagues. |
| POST | `/users/me/yahoo-leagues/discover` | Ask Yahoo what leagues the user has. |
| POST | `/users/me/yahoo-leagues/import` | Import one discovered league. |
| DELETE | `/users/me/yahoo` | Disconnect Yahoo and drop stored tokens. |

### Internal — called by core directly, not proxied

| Method | Path | Purpose |
|---|---|---|
| POST | `/internal/cdc` | CDC delivery from core. |
| GET | `/internal/dashboard` | Dashboard slice for the fantasy widget. |
| GET | `/internal/health` | Internal readiness. |

## Response shapes

Not duplicated here — they drift. The wire types are generated from the Go
structs into `desktop/src/types/api.generated.ts` and
`myscrollr.com/src/types/api.generated.ts`, and a Go test pins both to the
source (VISION §4.6). Read those, or the handlers in `channels/fantasy/api/`.
