# Contributing to Scrollr

For people building with an AI assistant (Claude Code). Scrollr is one product with several hosts, so the first job is finding the part you extend, not starting a new app.

## 1. Set up (pick one)

- **Full stack** (needs Docker Desktop, Node 22+, make): `make setup && make up && make seed`
- **Frontend only** (no Docker, no keys): `make setup DEV_API=remote`, then `cd desktop && npm run web`

Details and Windows traps: `docs/LOCAL_SETUP.md`.

## 2. Workflow

1. **Anything bigger than a bug fix starts as a Linear issue** whose brief is agreed first. Ask for one before you build.
2. **Work on a branch in this repo** (not a fork) and open a **draft PR on day one**, so others can see and steer early.
3. **Let your AI read `AGENTS.md`** (Claude Code does it automatically), then ask it: *"What already exists that does this?"* before it writes code.
4. **Use the repo skills** in `.claude/skills/`. Claude picks them up from what you ask:
   - `scrollr-new-surface`: the ticker somewhere new (overlay, TV, kiosk, embed)
   - `scrollr-new-widget`: a new widget or data source
   - `scrollr-ticker-change`: any chip, page cell or ticker layout change
   - `scrollr-admin-page`: an admin console page or tile
5. Fill in the PR template: which existing part you extend, what changed, how you verified it.

## 3. If the repo-shape check fails

`scripts/ci/check-repo-shape.sh` fails a PR that adds a top-level folder or a new `package.json`, `go.mod` or `Cargo.toml` that `AGENTS.md` does not name. That usually means a new app was started where an adapter on the existing code would do. Read "Before building anything new" in `AGENTS.md`, move the work onto the existing path, and only if nothing fits, explain why in the PR and ask before adding the entry.

`scripts/ci/check-doc-paths.sh` fails if a path named in these docs or skills stops existing; fix the doc when you move code.

Code style, tests and architecture rules: `AGENTS.md`.
