---
name: scrollr-new-surface
description: Use when asked to show the Scrollr ticker somewhere new - an OBS or vMix overlay, a stream or broadcast graphic, a TV, a kiosk, a browser source, or another embed of the ticker. Routes to the existing host-adapter pattern instead of building a new app.
---

# Put the ticker somewhere new

Scrollr is one ticker in `desktop/src` with a small adapter per host. A new surface is a new adapter, never a new app, server or copy of ticker code.

## Step 1: read before proposing code

Read these and explain to the user how they work before proposing anything:

- `desktop/embed.html` and `desktop/src/embed/boot.ts`: the website live bar. Public feed, no sign-in.
- `desktop/src/dev/web.ts` and `desktop/web.html`: web mode. Signed-in, real user data.
- `desktop/vite.config.ts`: the `embed` mode that builds one html entry into its own folder.
- `AGENTS.md`, section "Before building anything new".

## Step 2: decide with the user, before any code

Does this surface show a **signed-in user's** widgets (model on `desktop/src/dev/web.ts`) or a **curated public** feed with no login (model on `desktop/src/embed/boot.ts`)? An overlay on a stream is usually curated. Ask if it is not clear.

## Step 3: recipe

1. A new html entry beside `desktop/embed.html` and a `desktop/src/<host>/boot.ts` that mounts the shared ticker. Copy the shape of the adapter you chose, not the ticker code.
2. A vite mode in `desktop/vite.config.ts`, modelled on the `embed` mode.
3. Display needs (transparent background, fixed size, no chrome, speed) become ticker options in the shared code, so every host gets them.
4. A server, if any, only serves the build and holds auth. No data code in it: every source is already served by core (`api/CHANNELS.md`).
5. Packaging and docs last, after it works in a browser.

Verify in a browser (`cd desktop && npm run web`, see `docs/LOCAL_SETUP.md`), not only in the Tauri app.

## Do not

- Create a new top-level folder, `package.json`, `go.mod` or `Cargo.toml`. CI (`scripts/ci/check-repo-shape.sh`) fails the PR.
- Touch chips or pages here. That is the `scrollr-ticker-change` skill.
