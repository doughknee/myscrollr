# User Understanding Without Analytics — Intent Doc

> **Status:** PARKED. Not on the roadmap. Intent recorded for future reference.
> **Not a spec.** This is a one-page placeholder so the design intent survives until we actually want to build it. When the trigger conditions below fire, this gets promoted into a full spec.

## Why this exists

The README publicly promises "no analytics, no telemetry, no tracking" (README.md:7, README.md:154). That commitment is good for the product and the kind of user Scrollr attracts. It also leaves a real product-management gap: how do we learn what users actually want without surveilling them?

This doc records the answer we landed on so that future-you (or a future agent session) doesn't have to re-derive it from scratch, and doesn't accidentally reach for an analytics SDK as the obvious solution.

**The answer: build three explicit, opt-in surfaces that get you better signal than analytics would, at zero privacy cost.**

## The three surfaces

### Surface 1: In-app feedback prompts

A dismissible card component in the desktop app (Settings page + onboarding completion) and a minimal variant on the marketing site (post-signup, post-purchase).

- Server-side queue of active prompts. Each prompt has: ID, audience filter, question text, response surface (typeform link or in-app form).
- User clicks "Yes, help out" → routed to the response surface. Clicks "No thanks" → dismissed **locally**, no network call.
- **Silent users send zero data.** Audience filters evaluate from local state. The only data collected is structured qualitative responses from users who actively engage.
- Backend: new `/feedback/prompts` route in Core API + a JSON config file authored manually.

Why this isn't analytics: there is no silent observation. The opt-in is the data collection mechanism.

### Surface 2: Self-hosted roadmap (Fider)

A roadmap/feedback surface that *feels* native and in-house, not a redirect to GitHub.

- **Tool: [Fider](https://fider.io)** — MIT-licensed, Go-based, k8s-deployable. Self-hosted in the Scrollr cluster.
- Deployed under `roadmap.scrollr.relentnet.dev` or similar, in a new `roadmap` namespace alongside `monitoring`.
- Sign-in via Logto OIDC (same pattern as Grafana — see `docs/superpowers/specs/2026-05-13-operational-metrics-design.md` for the OIDC integration template).
- Surface a `/roadmap` page on the marketing site that links to or embeds the Fider instance.

**Why Fider, not GitHub Discussions:** the user's stated preference (this session) is for everything to feel in-house. GitHub redirect breaks that. Fider gives us native-feeling, fully-owned infrastructure for a few dollars of cluster resources.

**Why Fider, not custom-built:** the feature set (post + vote + status + comments + email notifications) is non-trivial to implement well. Fider is mature, MIT-licensed, and fits the existing stack (Go, Postgres). Building this ourselves would be re-inventing a wheel.

### Surface 3: Scrollr Insiders cohort

An explicit opt-in to a research panel.

- New section in `desktop/src/routes/account.tsx` AND `myscrollr.com/account` (per decision Q4): "Join Scrollr Insiders — get early access to features in exchange for occasional feedback (1–2 emails per month, all optional)."
- User clicks → `POST /account/insiders` → boolean stored as a column on the `users` table.
- Schema impact: one boolean (`insider boolean default false`), no new tables.
- A new Core API route `GET /insiders/active-features` returns feature flags the user can toggle, used by desktop to gate "preview" features.
- To run a research session: query `WHERE insider = true`, contact those users **out-of-band** via the email they gave Logto. No new tracking infrastructure.

Why this works: the opt-in is the consent. The user knows exactly what they signed up for. Self-selected, motivated cohort. More valuable than aggregate analytics from the full user base.

## When to promote this to a full spec

Don't build this yet. The trigger conditions for "promote to spec":

1. **You're guessing at three product decisions in a row.** If you can name three specific feature decisions where "I just don't know what users want" was the blocker, that's the signal.
2. **Support volume has tripled.** Lots of "how do I do X?" support tickets means the UX is unclear in ways that direct feedback would surface.
3. **You've shipped a major release that landed flat.** If a launch didn't move whatever metric matters (signups, conversions, retention as observed via Stripe), and you can't tell *why* from existing signals, that's the moment.
4. **A user explicitly asks for a roadmap surface.** This has happened in support before — the next time it does, the friction of "we don't have one" is the trigger.

When any of these fires, this intent doc becomes the starting point for:
- A full design spec at `docs/superpowers/specs/<date>-user-understanding-design.md`
- A full implementation plan at `docs/superpowers/plans/<date>-user-understanding-rollout.md`

## Explicit non-commitments

- **This is not on the roadmap.** It is a parked alternative, recorded against a possible future need.
- **No code changes are pending.** No env vars to add. No dependencies to install. No k8s manifests to commit.
- **The marketing site does not need to mention any of this.** The current "no telemetry" message remains accurate. If/when surfaces 1–3 ship, the Privacy Policy gets a small update describing the opt-in surfaces — but that update happens with the ship, not before.
- **No analytics SDK is being considered.** Not now, not as a fallback if this doesn't work. The trade-off was analyzed and rejected (see the recommendation transcript leading to this doc; short version: the credibility cost of breaking the "no telemetry" promise exceeds any marginal product-decision value).

## Related docs

- `docs/superpowers/plans/2026-05-12-sentry-rollout.md` — error monitoring (separate concern, ships independently).
- `docs/superpowers/specs/2026-05-13-operational-metrics-design.md` — server-side operational metrics (separate concern, ships independently). Establishes the Logto-OIDC-for-internal-services pattern that Fider will reuse if/when promoted.
- `README.md:154` — the public "no telemetry" promise that constrains this whole problem space.
