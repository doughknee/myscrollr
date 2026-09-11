# Windows Artifact Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticode-sign and timestamp every Windows application and installer produced by Tauri before updater signatures are created, with a non-publishing path that proves the result.

**Architecture:** Keep ordinary local builds unchanged. A Windows-only Tauri config invokes one PowerShell command that reads Azure credentials from process environment, runs Microsoft's signed `ArtifactSigning` module, and rejects invalid, untrusted, or untimestamped output. The existing release workflow opts into that config only for Windows, verifies before release upload, and exposes a read-only branch-dispatch job that uploads test artifacts without touching GitHub Releases.

**Tech Stack:** Tauri 2, PowerShell 7, GitHub Actions, Azure Artifact Signing, Microsoft ArtifactSigning PowerShell module 0.1.8

**Spec:** Linear SCROLLR-25 current issue brief

## Global Constraints

- Preserve the published-release preflight and all macOS/Linux signing behavior.
- Keep all six Azure values in GitHub Actions secrets and process environment only.
- Do not bump the desktop version or create, publish, or overwrite a GitHub Release.
- Require SHA-256 Authenticode and RFC3161 timestamping through `http://timestamp.acs.microsoft.com`.
- Fail Windows builds when configuration, signing, trust validation, timestamp validation, or updater verification fails.

---

### Task 1: Signing command and behavior checks

**Files:**
- Create: `desktop/src-tauri/tauri.windows-signing.conf.json`
- Create: `desktop/scripts/sign-windows.ps1`
- Create: `desktop/scripts/sign-windows.tests.ps1`
- Create: `desktop/scripts/testdata/fake-artifact-signing.ps1`

**Interfaces:**
- Consumes: the six `AZURE_*` process environment variables and one Tauri `%1` file path.
- Produces: a signed file whose `Get-AuthenticodeSignature` status is `Valid` and whose timestamp certificate is present.

- [ ] **Step 1: Write the failing PowerShell checks**

Cover missing environment values, a signed input path containing spaces passed as one argument, child exit-code propagation, and rejection of an untimestamped or unsigned file.

- [ ] **Step 2: Run the checks to verify RED**

Run: `pwsh -NoProfile -File desktop/scripts/sign-windows.tests.ps1`

Expected: FAIL because `desktop/scripts/sign-windows.ps1` does not exist.

- [ ] **Step 3: Implement the minimum signing command and Tauri override**

The command validates Windows and required environment, invokes Microsoft's signed module with SHA256 plus the Microsoft RFC3161 server, then validates trust and timestamp. The override contains only `bundle.windows.signCommand`.

- [ ] **Step 4: Run the checks to verify GREEN**

Run: `pwsh -NoProfile -File desktop/scripts/sign-windows.tests.ps1`

Expected: PASS with all focused checks successful.

### Task 2: Release wiring and non-publishing verification

**Files:**
- Modify: `.github/workflows/desktop-release.yml`

**Interfaces:**
- Consumes: the Windows Tauri override, six Azure repository secrets, and existing `TAURI_SIGNING_PRIVATE_KEY`.
- Produces: Windows Actions artifacts containing signed application/installer bytes and matching Tauri updater `.sig` files, without GitHub Release mutation.

- [ ] **Step 1: Add workflow validation checks before workflow edits**

Extend `desktop/scripts/sign-windows.tests.ps1` to assert Windows-only config usage, the pinned CLI install, all six secret mappings, read-only branch-test permissions, signed EXE plus NSIS/MSI verification, updater verification, and artifact upload.

- [ ] **Step 2: Run the checks to verify RED**

Run: `pwsh -NoProfile -File desktop/scripts/sign-windows.tests.ps1`

Expected: FAIL because the workflows are not wired.

- [ ] **Step 3: Wire release and test workflows**

Install and validate Microsoft's signed `ArtifactSigning` module 0.1.8, pass the override only on Windows, map secrets to environment, validate actual bundle signatures, and verify updater signatures over exact installer bytes before upload/release handling.

- [ ] **Step 4: Run local validation and desktop checks**

Run: `pwsh -NoProfile -File desktop/scripts/sign-windows.tests.ps1`, `npm test`, and `npm run build` from `desktop/`.

- [ ] **Step 5: Configure secrets and run the non-publishing workflow**

Set the six allowlisted repository secrets from the approved local env file via stdin, dispatch the existing desktop release workflow with `platform=windows` from the issue branch, download its artifact, and independently verify Authenticode trust, publisher, timestamp, and Tauri updater signatures.

- [ ] **Step 6: Commit, review, and open the PR**

Commit only the plan, helper, tests, config, and workflows. Obtain independent final-revision review, resolve important findings, push the issue branch, open a PR to `main`, and leave SCROLLR-25 In Review with sanitized evidence.
