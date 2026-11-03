# Stable baseline preparation

SCROLLR-433. User selected a maintenance Stable 1.7.3 so Fill remains beta-only.
Publication, Latest repair, live feed activation and tester contact are not authorized.

## Source and review

- The desktop at pre-Fill commit `c39da84e` is identical to the published desktop-v1.7.2 source (`git diff desktop-v1.7.2 c39da84e -- desktop` is empty).
- Start the maintenance line there and backport PR530-534 plus reviewed qualification tooling. Do not backport PR529.
- Exact maintenance branch `release/desktop-1.7`; allow final Stable 1.7.3+ only in 1.7.x. Retain exact source/run/proof checks.
- Protect maintenance with PR requirement, repo-shape check, no force pushes or deletion. Main protection is unchanged.
- Use a separate worktree for backport conflict resolution. Review the actual source diff, consistent package versions and absent Fill implementation before building.

## Qualification and activation packet

- First finish the private native updater transport rehearsal using the existing signed Beta cohort. Windows local test covers valid signature/download and expected rejection causes; CI repeats on all three targets. Test runtime only, no installed-app transition claim.
- Build 1.7.3 as a signed draft with all three native package smoke checks and finalizer verification.
- Test real package upgrades and native updater installs in disposable CI installations, preserving app data. Keep Windows user's ahead-of-Stable Beta installation intact; no downgrade onto their profile.
- Record actual completed transitions separately from simulated current-version/native-download tests. Human cursor/sleep/wake/reconnect checks remain with Doni; Mac/Linux hardware is unavailable by agreement.
- Reuse `audit/2026-11-03-feed-qualification/metadata-ruleset.request.json` and `bootstrap-tree.request.json`; do not apply them or enable the activation switch during this preparation.
- Activation review must name the exact Stable draft/source/run, Beta draft/source/run, verified signatures/hashes, completed transition matrix and remaining gates. Initial live feeds must select approved Stable; Beta becomes eligible only after a separately approved publication.
