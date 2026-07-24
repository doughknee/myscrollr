# Documentation index

Every doc in the repo, what it's for, and which ones win when they disagree.

## The order of authority

When two sources conflict, trust them in this order:

1. **The code.** Always. Every doc below can go stale; the code cannot.
2. **`AGENTS.md`** — conventions, commands, ports, per-language rules.
3. **`docs/VISION.md`** and **`docs/adr/`** — architecture and the decisions behind it.
4. Everything else.

If you find a doc that contradicts the code, fix the doc in the same PR that
made it wrong. That is how this list stays true.

## Start here

| Doc | What it's for |
|---|---|
| [`README.md`](../README.md) | What Scrollr is, how the pieces fit, quick start. |
| [`AGENTS.md`](../AGENTS.md) | The one-page cheatsheet — commands, ports, conventions, per-language style. **Authoritative for how to work in this repo.** |
| [`LOCAL_SETUP.md`](./LOCAL_SETUP.md) | Local full-stack topology: what runs where, on which port, with which env. **Source of truth for local dev** — the README quick start is the short version. |
| [`CONTRIBUTING.md`](../.github/CONTRIBUTING.md) | Repo layout, what gets merged, how to send a PR. |

## Architecture

| Doc | What it's for |
|---|---|
| [`VISION.md`](./VISION.md) | **The charter.** What Scrollr is, the widget/slot model, and the ten locked decisions behind the current architecture. Start here for *why*. Still live — §6 non-negotiables and the §4.4 rename carve-outs both bind. |
| [`adr/`](./adr/) | Numbered architecture decision records. Immutable once accepted: ADR-0001 (SSE across replicas), ADR-0002 (widget read APIs consolidated into core). |
| [`ROLLOUT.md`](./ROLLOUT.md) | **Completed record, not a plan.** How the v1.1.10 unification was executed, phase by phase, including where the plan's premises turned out wrong. Nothing in it is outstanding work. |
| [`api/CHANNELS.md`](../api/CHANNELS.md) | The widget/source model and how to add a widget. |

## Planning

| Doc | What it's for |
|---|---|
| [`ROADMAP.md`](./ROADMAP.md) | Forward-looking product plan. Detailed per-release sections stop at v1.1.6; from v1.1.7 on, the summary table is the record and [GitHub Releases](https://github.com/doughknee/myscrollr/releases) carries the user-facing notes. |

## Operations

| Doc | What it's for |
|---|---|
| [`cdc-runbook.md`](./cdc-runbook.md) | CDC/Sequin pipeline: how it works, how it breaks, how to fix it under pressure. |
| [`scripts/smoke/README.md`](../scripts/smoke/README.md) | Production-readiness smoke tests, run post-rollout by `deploy.yml`. |
| [`myscrollr.com/DEPLOY.md`](../myscrollr.com/DEPLOY.md) | Marketing site build pipeline and SPA-fallback hosting notes. |

## Per-component

| Doc | What it's for |
|---|---|
| [`channels/fantasy/YAHOO_API.md`](../channels/fantasy/YAHOO_API.md) | The one remaining separate service — Yahoo OAuth routes and why it stays separate. |
| [`channels/predictions/CONTRACT.md`](../channels/predictions/CONTRACT.md) | The predictions/Kalshi service's data contract with core. |
| [`channels/predictions/LOCAL_DEV.md`](../channels/predictions/LOCAL_DEV.md) | Running the Kalshi demo locally, including the no-auth bridge behind `VITE_DEMO=1`. |
| [`desktop/src-tauri/CSP_NOTES.md`](../desktop/src-tauri/CSP_NOTES.md) | Why the desktop CSP is shaped the way it is. |
| [`desktop/src-tauri/dmg/README.md`](../desktop/src-tauri/dmg/README.md) | Regenerating the macOS DMG background art. |
| [`desktop/screenshots/README.md`](../desktop/screenshots/README.md) | The desktop screenshot set and how it's captured. |
| [`myscrollr.com/README.md`](../myscrollr.com/README.md) | Marketing site overview. |
| [`myscrollr.com/SCREENSHOTS.md`](../myscrollr.com/SCREENSHOTS.md) | Product imagery pipeline for the site. |
| [`myscrollr.com/docs/DESIGN.md`](../myscrollr.com/docs/DESIGN.md) | The marketing site's design system — type, color, spacing, motion. |

## Support tooling

| Doc | What it's for |
|---|---|
| [`scripts/bug-tools/README.md`](../scripts/bug-tools/README.md) | osTicket bug triage helpers. |
| [`scripts/osticket-plugin/README.md`](../scripts/osticket-plugin/README.md) | The osTicket reply-API plugin — source for what runs on support.myscrollr.com. Installed by hand, not by CI. |

## Policy

Community-health files live in `.github/`, which GitHub treats identically to
the repo root — the sidebar links, Community Standards checklist, and the
contributing prompt on PR creation all still work.

| Doc | What it's for |
|---|---|
| [`SECURITY.md`](../.github/SECURITY.md) | Vulnerability reporting. |
| [`CODE_OF_CONDUCT.md`](../.github/CODE_OF_CONDUCT.md) | Community rules. |

---

## What isn't here

**Shipped-release notes** live in [GitHub Releases](https://github.com/doughknee/myscrollr/releases),
not in a changelog file. **Per-issue history and rationale** live in Linear.
**Design specs** used to live in `docs/_archive/superpowers/` — 65 files from a
retired workflow, deleted in REL-69. Recoverable from git history if a decision's
backstory is ever genuinely needed.
