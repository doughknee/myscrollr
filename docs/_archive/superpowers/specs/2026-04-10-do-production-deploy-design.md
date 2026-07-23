# DigitalOcean Production Deploy Design

**Goal:** Move production frontend and desktop endpoint configuration into GitHub Actions build-time config, and fully automate production deploys/releases for the website, backend workloads, and desktop app.

**Context:** The backend services are already deployed to production on DigitalOcean Kubernetes. Logto and Sequin intentionally remain on Coolify for now. The remaining work is to point desktop production builds at the new production endpoints and remove the need to manually build and push images from a local machine.

## Decisions

1. Keep `deploy.yml` as the production automation path for the website and backend Kubernetes workloads.
2. Keep `desktop-release.yml` as the production automation path for desktop releases.
3. Move production desktop endpoint values out of hardcoded source defaults and into GitHub Actions build-time configuration.
4. Keep backend runtime configuration in Kubernetes configmaps and secrets.
5. Leave Logto and Sequin on Coolify for now and treat them as external production services.

## Recommended Approach

Use the existing split workflow model instead of collapsing everything into one CI pipeline.

### Why this approach

- It matches the repository's current structure and minimizes churn.
- It removes the manual local image build and push loop immediately.
- It keeps desktop release failures isolated from website and backend deploys.
- It makes GitHub Actions the source of truth for production build-time configuration.

## Scope

### In Scope

- Desktop production endpoint configuration via build-time environment variables.
- Website and backend production deploy automation through GitHub Actions.
- Completing the website workflow build arguments required by the current Dockerfile.
- Documenting required GitHub Actions secrets and variables.
- Updating migration and deployment docs so they match the automated production path.

### Out of Scope

- Moving Logto off Coolify.
- Moving Sequin off Coolify.
- Redesigning Kubernetes manifests unless a mismatch blocks the deployment flow.

## Current State

### Already in place

- `k8s/` manifests exist for the website, core API, and channel APIs/services.
- `.github/workflows/deploy.yml` already builds images, pushes to DOCR, and rolls K8s deployments.
- `.github/workflows/desktop-release.yml` already builds and publishes signed desktop release artifacts.

### Remaining gaps

- `desktop/src/config.ts` still hardcodes stale non-production API and auth endpoints plus a fixed Logto app ID.
- `desktop-release.yml` does not yet inject production API/auth/app ID values at build time.
- `deploy.yml` does not yet pass all Stripe price build arguments required by `myscrollr.com/Dockerfile`.

## Design

### 1. Desktop configuration model

`desktop/src/config.ts` should read production build-time values from environment variables rather than embedding production hosts in source.

Required variables:

- `VITE_API_URL`
- `VITE_AUTH_ENDPOINT`
- `VITE_LOGTO_APP_ID`

Canonical format:

- `VITE_AUTH_ENDPOINT` and website `VITE_LOGTO_ENDPOINT` should use `https://auth.myscrollr.com` without a trailing slash.
- Any code that derives nested OIDC URLs should normalize slashes rather than depending on a trailing slash in configuration.

The desktop PKCE redirect URI should remain hardcoded as:

- `http://127.0.0.1:19284/callback`

Reasoning:

- The redirect URI is part of the desktop OAuth flow, not infrastructure routing.
- API base URL, auth endpoint, and Logto app ID vary by environment and should be controlled by the release pipeline.

Local development should still work through `.env` files and local defaults.

Release builds should not rely on embedded production fallbacks. Production desktop builds must fail fast in CI if any of these variables are missing:

- `VITE_API_URL`
- `VITE_AUTH_ENDPOINT`
- `VITE_LOGTO_APP_ID`

The implementation should also update `desktop/.env.example` and related config comments so local development defaults are clearly documented and no stale production hostnames remain in source.

This fail-fast behavior should be enforced in `.github/workflows/desktop-release.yml`, not by breaking the shared local development path.

### 2. Desktop release workflow

`.github/workflows/desktop-release.yml` should remain the release workflow for Linux, macOS, and Windows artifacts.

It should inject production values into the Tauri build environment so all production desktop builds target:

- `https://api.myscrollr.com`
- `https://auth.myscrollr.com`
- the production desktop Logto application ID

Prerequisite before releasing:

- confirm the production Logto desktop application is configured with callback URL `http://127.0.0.1:19284/callback`
- confirm it is allowed to request the API audience `https://api.myscrollr.com`

Recommended GitHub Actions secret or variable names:

- `DESKTOP_VITE_API_URL`
- `DESKTOP_VITE_AUTH_ENDPOINT`
- `DESKTOP_VITE_LOGTO_APP_ID`

Desktop-specific names are preferred even if some values overlap with the website. That keeps ownership and purpose clear.

### 3. Website and backend deploy workflow

`.github/workflows/deploy.yml` should remain the automatic production deploy path for the website and backend Kubernetes workloads.

The workflow should continue to:

- detect changed services
- build changed Docker images
- push them to DigitalOcean Container Registry
- roll only the matching Kubernetes deployments

The workflow also needs to pass all website build arguments expected by `myscrollr.com/Dockerfile`.

For the website workflow, production endpoint values should be treated as intentional workflow-managed constants or Actions configuration, not source defaults. The implementation should make that ownership explicit and keep `deploy.yml` aligned with the documented source of truth.

Required website build arguments:

- `VITE_API_URL`
- `VITE_LOGTO_ENDPOINT`
- `VITE_LOGTO_APP_ID`
- `VITE_LOGTO_RESOURCE`
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `VITE_STRIPE_PRICE_MONTHLY`
- `VITE_STRIPE_PRICE_ANNUAL`
- `VITE_STRIPE_PRICE_PRO_MONTHLY`
- `VITE_STRIPE_PRICE_PRO_ANNUAL`
- `VITE_STRIPE_PRICE_ULTIMATE_MONTHLY`
- `VITE_STRIPE_PRICE_ULTIMATE_ANNUAL`

The implementation must also audit website source-level endpoint and auth fallbacks beyond `myscrollr.com/src/main.tsx`, including any hardcoded API or auth URLs in shared hooks, routes, or bootstrap code. The preferred direction is to remove stale production-style source fallbacks and keep `.env.example` as the local-development reference, ideally through one shared website configuration source.

Without the missing Stripe price IDs, production website builds can succeed while billing routes end up with empty checkout targets.

### 4. Configuration ownership

Split configuration ownership clearly by phase:

- GitHub Actions secrets and variables: production build-time configuration
- Kubernetes secrets and configmaps: backend runtime configuration
- Coolify-hosted Logto and Sequin: external production services consumed by the app stack

This keeps responsibilities clear and reduces configuration drift between code, CI, and runtime.

## Required GitHub Actions Configuration

### Workflow-managed constants or repository configuration

- `VITE_API_URL`
- `VITE_LOGTO_ENDPOINT`
- `VITE_LOGTO_RESOURCE`

These can remain explicit workflow-managed production values as long as the ownership model is documented consistently.

### Existing Actions-provided values already used or expected

- `DIGITALOCEAN_ACCESS_TOKEN`
- `VITE_LOGTO_APP_ID`
- `VITE_STRIPE_PUBLISHABLE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY`

### New website values to add if missing

- `VITE_STRIPE_PRICE_MONTHLY`
- `VITE_STRIPE_PRICE_ANNUAL`
- `VITE_STRIPE_PRICE_PRO_MONTHLY`
- `VITE_STRIPE_PRICE_PRO_ANNUAL`
- `VITE_STRIPE_PRICE_ULTIMATE_MONTHLY`
- `VITE_STRIPE_PRICE_ULTIMATE_ANNUAL`

### New desktop values to add

- `DESKTOP_VITE_API_URL`
- `DESKTOP_VITE_AUTH_ENDPOINT`
- `DESKTOP_VITE_LOGTO_APP_ID`

## Risks

1. Secret name drift between the website and desktop workflows can create silent misconfiguration.
2. Leaving hardcoded production defaults in desktop source can mask missing CI variables.
3. Missing Stripe price IDs in Actions can break production checkout flows even when deploys appear healthy.

## Validation Plan

### Desktop

- Verify `desktop/src/config.ts` reads all intended build-time variables.
- Verify `desktop/.env.example` documents the new configuration shape.
- Run `npm run build` in `desktop/`.

### Website workflow

- Verify `myscrollr.com/Dockerfile` build args match what `deploy.yml` supplies.
- Confirm the website build matrix still works with the additional Stripe variables.
- Confirm the workflow-managed website endpoint values are documented consistently with the chosen ownership model.
- Verify website source-level config and fallbacks are aligned with the selected ownership model, including `myscrollr.com/src/main.tsx`, `myscrollr.com/src/hooks/useScrollrAuth.tsx`, relevant auth or account routes, and `myscrollr.com/.env.example`.

### Deploy flow

- Verify rollout logic still maps workflow service names to the Kubernetes deployment names.
- Confirm changed services continue to deploy independently.

## Implementation Summary

1. Update desktop config to consume env-driven production values.
2. Update desktop workflow to inject production endpoint and Logto values.
3. Update deploy workflow to provide the full website build argument set.
4. Update environment example files and documentation to match the new production deployment model.
5. Update `docs/k8s-migration-runbook.md` so it no longer tells operators to manually build/push images, manually edit desktop production endpoints in source, or rely on an incomplete GitHub Actions configuration list.
6. Replace the runbook Actions configuration section with the final website and desktop Actions values, including the Stripe price IDs and desktop endpoint/app ID variables.
7. Remove or formally retain website source fallbacks across the website app and align `.env.example` with that decision.
