# Final-audit fixes — SCROLLR-426 / 427 / 428

Follow-up on PR532, retaining the prerequisite PR530/531 history. No version bump,
merge, release, live legacy repair, metadata write or activation is performed.

- **426:** all publication uses `--latest=false`. Stable finalization explicitly
  runs the existing signed highest-SemVer legacy reconciler under the release
  artifact lock, also on a published-release retry. Beta never runs that step.
  Selection fixtures cover later finalization of an older Stable; a workflow
  contract check keeps unconditional Latest assignment out of publication.
- **427:** direct announcement and KB entry points fail closed without the
  finalizer's published verification record. They check exact record/manifest
  digests, all recorded asset digests, source/tag and successful trusted main
  build binding. Enabled channels additionally require unchanged non-withdrawn
  registry approval, selected release/tag validation and both exact public feeds.
  Both event and manual paths use this same guard. Backend KB refresh is separate.
- **428:** the primary runbook and prepared packet now use one first-activation
  order: protected bootstrap and draft qualification, explicit enablement, then
  coordinated publication/reconciliation/public verification before follow-ups.

The side-effect guard uses the same trusted-finalizer-record boundary as support
verification. It does not download all installers or repeat Minisign verification;
those remain the finalizer's job. Failures throw before `eligible=true` is written.
Workflow tokens gain read-only Actions permission for build status. Public-byte
checks retain their bounded seven-minute deadline; effect jobs allow twenty minutes.

Local validation: all **51 Node fixtures passed** in a network-disabled Node22
container; Go ops tests and actionlint for changed workflows passed. New negative
cases cover missing/changed proof, changed installers, failed/untrusted build,
moved tag, missing/withdrawn approval, registry failure, public-feed failure and withdrawal during public verification.
No live workflow or OS upgrade was used to test refusal paths.

SCROLLR-429 (progress subscriptions) and SCROLLR-430 (existing website selection)
remain separate backlog work. The original audit reports are a snapshot of the
pre-fix commit; this note records the bounded remediation, not a production launch.
