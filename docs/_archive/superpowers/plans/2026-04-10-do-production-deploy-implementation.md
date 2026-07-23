# DigitalOcean Production Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the production deployment migration by making desktop builds use CI-provided production endpoints, completing website deploy workflow build args, and removing stale source-level endpoint fallbacks and manual deployment docs.

**Architecture:** Keep the existing split production automation model. `deploy.yml` remains responsible for website and backend image builds plus Kubernetes rollout, while `desktop-release.yml` remains responsible for signed desktop releases. Production build-time config is injected from GitHub Actions, backend runtime config stays in Kubernetes, and Logto/Sequin continue running on Coolify.

**Tech Stack:** GitHub Actions, Docker, DigitalOcean Container Registry, Kubernetes, Tauri v2, React 19, Vite 7, Go, Tailwind v4

---

## File Map

- Modify: `.github/workflows/deploy.yml`
  Responsibility: build/push website and backend images, inject website build args, roll changed K8s deployments.
- Modify: `.github/workflows/desktop-release.yml`
  Responsibility: build and publish desktop releases with CI-provided production config and fail-fast checks.
- Modify: `desktop/src/config.ts`
  Responsibility: centralize desktop API/auth/app ID configuration and keep the localhost callback fixed.
- Modify: `desktop/.env.example`
  Responsibility: document local desktop env vars and remove stale non-production values.
- Modify: `myscrollr.com/src/main.tsx`
  Responsibility: website Logto bootstrap configuration.
- Modify: `myscrollr.com/src/hooks/useScrollrAuth.tsx`
  Responsibility: website API resource fallback handling for token requests.
- Modify: `myscrollr.com/src/routes/account.tsx`
  Responsibility: website account/security link generation.
- Modify: `myscrollr.com/.env.example`
  Responsibility: document canonical website env var values and formatting.
- Modify: `docs/k8s-migration-runbook.md`
  Responsibility: operator instructions for the production deployment path and required GitHub Actions config.
- Reference: `myscrollr.com/Dockerfile`
  Responsibility: source of truth for website build-time arguments that `deploy.yml` must supply.
- Reference: `docs/superpowers/specs/2026-04-10-do-production-deploy-design.md`
  Responsibility: approved design and constraints for this plan.

### Task 1: Desktop Build-Time Production Config

**Files:**
- Modify: `desktop/src/config.ts`
- Modify: `desktop/.env.example`
- Modify: `.github/workflows/desktop-release.yml`

- [ ] **Step 1: Add a failing verification check for missing desktop release vars**

Add a release-only check step in `.github/workflows/desktop-release.yml` before the Tauri build that exits non-zero when any of these are empty. Map the desktop-specific secret names into the check step explicitly:

```bash
test -n "$DESKTOP_VITE_API_URL"
test -n "$DESKTOP_VITE_AUTH_ENDPOINT"
test -n "$DESKTOP_VITE_LOGTO_APP_ID"
```

- [ ] **Step 2: Inspect the current workflow for the missing guard**

Read `.github/workflows/desktop-release.yml` and verify the current workflow only passes the existing release env values and has no equivalent fail-fast guard for the desktop config vars.

Expected: no existing step guards `VITE_API_URL`, `VITE_AUTH_ENDPOINT`, or `VITE_LOGTO_APP_ID` in desktop release builds.

- [ ] **Step 3: Update desktop config to read env-driven values**

Make `desktop/src/config.ts` read these compile-time values from `import.meta.env`:

```ts
const DEFAULT_API = 'http://localhost:8080'
const DEFAULT_AUTH_ENDPOINT = ''
const DEFAULT_LOGTO_APP_ID = ''

export const API_BASE = import.meta.env.VITE_API_URL ?? DEFAULT_API
export const AUTH_ENDPOINT =
  import.meta.env.VITE_AUTH_ENDPOINT ?? DEFAULT_AUTH_ENDPOINT
export const LOGTO_APP_ID =
  import.meta.env.VITE_LOGTO_APP_ID ?? DEFAULT_LOGTO_APP_ID
```

Keep `REDIRECT_URI` unchanged as `http://127.0.0.1:19284/callback`.

Do not invent a local auth port. If the repo already has a real local Logto/auth endpoint for desktop development, document that exact value; otherwise keep the local fallback empty and require `.env` for auth-specific local runs.

- [ ] **Step 4: Update the desktop env example**

Document the new local-development env shape in `desktop/.env.example`:

```env
VITE_API_URL=http://localhost:8080
VITE_AUTH_ENDPOINT=your_local_auth_endpoint
VITE_LOGTO_APP_ID=your_local_or_dev_logto_app_id
```

If the repo already defines a real local auth endpoint, replace `your_local_auth_endpoint` with that exact value.

- [ ] **Step 5: Inject desktop production values in the release workflow**

Pass the GitHub Actions values into the Tauri build step environment:

```yaml
env:
  DESKTOP_VITE_API_URL: ${{ secrets.DESKTOP_VITE_API_URL }}
  DESKTOP_VITE_AUTH_ENDPOINT: ${{ secrets.DESKTOP_VITE_AUTH_ENDPOINT }}
  DESKTOP_VITE_LOGTO_APP_ID: ${{ secrets.DESKTOP_VITE_LOGTO_APP_ID }}
run: |
  test -n "$DESKTOP_VITE_API_URL"
  test -n "$DESKTOP_VITE_AUTH_ENDPOINT"
  test -n "$DESKTOP_VITE_LOGTO_APP_ID"
```

Then map them into the build step as Vite variables:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  VITE_API_URL: ${{ secrets.DESKTOP_VITE_API_URL }}
  VITE_AUTH_ENDPOINT: ${{ secrets.DESKTOP_VITE_AUTH_ENDPOINT }}
  VITE_LOGTO_APP_ID: ${{ secrets.DESKTOP_VITE_LOGTO_APP_ID }}
```

Keep names consistent with the approved spec unless repository conventions force a different choice.

- [ ] **Step 6: Verify the production Logto prerequisites are documented inline**

Add a short workflow comment near the env injection or fail-fast step noting the release depends on a Logto desktop app configured for:

```text
callback: http://127.0.0.1:19284/callback
resource: https://api.myscrollr.com
```

- [ ] **Step 7: Run the desktop build**

Run: `npm run build`

Workdir: `/Users/doni/code/myscrollr/desktop`

Expected: build succeeds with the updated config shape.

- [ ] **Step 8: Commit the desktop configuration change**

```bash
git add desktop/src/config.ts desktop/.env.example .github/workflows/desktop-release.yml
git commit -m "chore(desktop): inject production auth config from CI"
```

### Task 2: Website Workflow Build Args And Source Fallback Cleanup

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `myscrollr.com/src/main.tsx`
- Modify: `myscrollr.com/src/hooks/useScrollrAuth.tsx`
- Modify: `myscrollr.com/src/routes/account.tsx`
- Modify: `myscrollr.com/.env.example`

- [ ] **Step 1: Write down the missing website build args from the Dockerfile**

Use the current `myscrollr.com/Dockerfile` as the source of truth for expected build args and confirm these Stripe price IDs are currently absent from `.github/workflows/deploy.yml`:

```text
VITE_STRIPE_PRICE_MONTHLY
VITE_STRIPE_PRICE_ANNUAL
VITE_STRIPE_PRICE_PRO_MONTHLY
VITE_STRIPE_PRICE_PRO_ANNUAL
VITE_STRIPE_PRICE_ULTIMATE_MONTHLY
VITE_STRIPE_PRICE_ULTIMATE_ANNUAL
```

Expected: the workflow currently passes publishable key and Logto values but not the full price ID set.

- [ ] **Step 2: Add the missing website workflow build args**

Update the website matrix entry in `.github/workflows/deploy.yml` so `build-args` includes the full production list:

```yaml
VITE_API_URL=https://api.myscrollr.com
VITE_LOGTO_ENDPOINT=https://auth.myscrollr.com
VITE_LOGTO_APP_ID=${{ secrets.VITE_LOGTO_APP_ID }}
VITE_LOGTO_RESOURCE=https://api.myscrollr.com
VITE_STRIPE_PUBLISHABLE_KEY=${{ secrets.VITE_STRIPE_PUBLISHABLE_KEY }}
VITE_STRIPE_PRICE_MONTHLY=${{ secrets.VITE_STRIPE_PRICE_MONTHLY }}
VITE_STRIPE_PRICE_ANNUAL=${{ secrets.VITE_STRIPE_PRICE_ANNUAL }}
VITE_STRIPE_PRICE_PRO_MONTHLY=${{ secrets.VITE_STRIPE_PRICE_PRO_MONTHLY }}
VITE_STRIPE_PRICE_PRO_ANNUAL=${{ secrets.VITE_STRIPE_PRICE_PRO_ANNUAL }}
VITE_STRIPE_PRICE_ULTIMATE_MONTHLY=${{ secrets.VITE_STRIPE_PRICE_ULTIMATE_MONTHLY }}
VITE_STRIPE_PRICE_ULTIMATE_ANNUAL=${{ secrets.VITE_STRIPE_PRICE_ULTIMATE_ANNUAL }}
```

- [ ] **Step 3: Normalize website Logto endpoint formatting**

Choose `https://auth.myscrollr.com` without a trailing slash as the canonical value in source comments, env examples, and workflow config.

- [ ] **Step 4: Remove stale website source fallbacks**

Update website source-level config so stale production-like defaults are removed or centralized. At minimum cover:

```text
myscrollr.com/src/main.tsx
myscrollr.com/src/hooks/useScrollrAuth.tsx
myscrollr.com/src/routes/account.tsx
```

Preferred shape:

- keep env-driven values as the primary path
- avoid embedding old `relentnet.dev` values in source
- keep edits within the existing files unless a clearly named shared config file is genuinely the smaller change

- [ ] **Step 5: Update the website env example**

Rewrite `myscrollr.com/.env.example` so it documents the canonical current values and formatting for local setup without preserving stale `relentnet.dev` production examples.

- [ ] **Step 6: Run the website build**

Run: `npm run build`

Workdir: `/Users/doni/code/myscrollr/myscrollr.com`

Expected: build succeeds and any env usage is compatible with the updated source/config layout.

- [ ] **Step 7: Commit the website and deploy workflow change**

```bash
git add .github/workflows/deploy.yml myscrollr.com/src/main.tsx myscrollr.com/src/hooks/useScrollrAuth.tsx myscrollr.com/src/routes/account.tsx myscrollr.com/.env.example
git commit -m "chore(deploy): automate production website configuration"
```

### Task 3: Runbook And Operator Documentation Cleanup

**Files:**
- Modify: `docs/k8s-migration-runbook.md`

- [ ] **Step 1: Remove obsolete manual build and push instructions**

Replace the runbook section that tells operators to build and push images locally with the GitHub Actions-driven production path.

Update the narrative so operators understand:

```text
pushes to main trigger automated build/push/deploy for website and backend changes
desktop changes trigger the desktop release workflow
workflow_dispatch remains available for manual reruns if desired
```

- [ ] **Step 2: Remove manual desktop source-edit instructions**

Replace any runbook step that says to edit `desktop/src/config.ts` for production with the release-workflow-based configuration model.

- [ ] **Step 3: Replace the GitHub Actions secret list with the final set**

Ensure the runbook lists the full required GitHub Actions values:

```text
DIGITALOCEAN_ACCESS_TOKEN
VITE_LOGTO_APP_ID
VITE_STRIPE_PUBLISHABLE_KEY
VITE_STRIPE_PRICE_MONTHLY
VITE_STRIPE_PRICE_ANNUAL
VITE_STRIPE_PRICE_PRO_MONTHLY
VITE_STRIPE_PRICE_PRO_ANNUAL
VITE_STRIPE_PRICE_ULTIMATE_MONTHLY
VITE_STRIPE_PRICE_ULTIMATE_ANNUAL
DESKTOP_VITE_API_URL
DESKTOP_VITE_AUTH_ENDPOINT
DESKTOP_VITE_LOGTO_APP_ID
TAURI_SIGNING_PRIVATE_KEY
```

Add any additional currently-required values already present in the repo if they are needed for the documented workflows.

- [ ] **Step 4: Verify the runbook still matches the chosen deployment boundaries**

Confirm the document still explicitly states that Logto and Sequin remain on Coolify while the rest of the production stack runs through DO + GitHub Actions.

- [ ] **Step 5: Document final configuration ownership in the runbook**

Ensure the runbook clearly assigns ownership for each config class:

```text
GitHub Actions workflow-managed constants/config:
- VITE_API_URL
- VITE_LOGTO_ENDPOINT
- VITE_LOGTO_RESOURCE

GitHub Actions secrets/variables:
- production website secrets
- production desktop endpoint/app ID secrets
- signing and DigitalOcean credentials

Kubernetes configmaps/secrets:
- backend runtime configuration

Coolify:
- Logto and Sequin as external production services
```

- [ ] **Step 6: Proofread the runbook for one-path consistency**

Search the updated runbook for outdated instructions such as:

```text
manual docker build
docker push from local machine
edit desktop/src/config.ts for production
incomplete Actions config list
```

Expected: only the automated GitHub-driven path remains.

- [ ] **Step 7: Commit the documentation cleanup**

```bash
git add docs/k8s-migration-runbook.md
git commit -m "docs(deploy): update production rollout instructions"
```

### Task 4: End-To-End Verification

**Files:**
- Verify only: `.github/workflows/deploy.yml`
- Verify only: `.github/workflows/desktop-release.yml`
- Verify only: `desktop/src/config.ts`
- Verify only: `myscrollr.com/src/main.tsx`
- Verify only: `myscrollr.com/src/hooks/useScrollrAuth.tsx`
- Verify only: `myscrollr.com/src/routes/account.tsx`
- Verify only: `docs/k8s-migration-runbook.md`

- [ ] **Step 1: Re-run desktop build after all edits**

Run: `npm run build`

Workdir: `/Users/doni/code/myscrollr/desktop`

Expected: PASS

- [ ] **Step 2: Re-run website build after all edits**

Run: `npm run build`

Workdir: `/Users/doni/code/myscrollr/myscrollr.com`

Expected: PASS

- [ ] **Step 3: Inspect workflow consistency**

Verify by reading the final workflows that:

- desktop release env names match `desktop/src/config.ts`
- website build args match `myscrollr.com/Dockerfile`
- deploy service names still match K8s deployment names

- [ ] **Step 4: Check final scope only if work is uncommitted**

Run: `git diff --stat`

Workdir: `/Users/doni/code/myscrollr`

Expected: only the planned files changed.

If task-level commits were already created and the working tree is clean, skip this step and verify scope with:

```bash
git diff --stat main...HEAD
```

- [ ] **Step 5: Final commit**

If you chose to batch the work instead of committing task-by-task:

```bash
git add .github/workflows/deploy.yml .github/workflows/desktop-release.yml desktop/src/config.ts desktop/.env.example myscrollr.com/src/main.tsx myscrollr.com/src/hooks/useScrollrAuth.tsx myscrollr.com/src/routes/account.tsx myscrollr.com/.env.example docs/k8s-migration-runbook.md
git commit -m "chore(deploy): automate production rollout configuration"
```

If task-level commits were already created, skip this step.
