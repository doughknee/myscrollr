# Superpowers (historical archive)

> ⚠️ **Archived, not maintained. Do not treat as current state.**
> These are dated design docs, frozen at merge time and never updated since.
> Most are weeks-to-months stale. For how the system works *now*, read the
> code plus `AGENTS.md`, `docs/VISION.md`, and `docs/adr/`. Use this folder
> only for backstory on *why* a past decision was made — and verify anything
> load-bearing against the code before relying on it.

Every non-trivial feature in Scrollr shipped with a dated design document. This
folder is the archive — written *before* the code, kept *after* the merge.

## Layout

- **`specs/`** — design briefs. The "what and why" that drove a feature.
  Captures the problem, the chosen approach, alternatives considered, and the
  user-facing surface. Roughly one spec per feature, dated by the day work
  began.
- **`plans/`** — implementation plans. The "how" that translates a spec into
  an ordered list of edits. Tracks file-by-file responsibilities, ordering
  constraints, and test strategy. Usually paired 1-to-1 with a spec.

## What these are for

Backstory only: the problem a feature was solving and the alternatives weighed
at the time. They are *not* a description of current behavior — where an
archived doc and the code disagree, the code wins, every time.

Anything in `handoffs/` is local rolling session state and is intentionally
gitignored.

## Convention

- Filenames are `YYYY-MM-DD-short-slug.md`.
- A spec lands first; its plan follows with the same slug.
- The merge commit that ships the feature references the plan.
- Once shipped, documents are not edited — follow-up work gets a new spec
  rather than rewriting history.
