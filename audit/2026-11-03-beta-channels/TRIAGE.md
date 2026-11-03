# Beta channels audit triage

Read-only reviews covered new native/feed boundaries and shared updater recovery paths. Scope is the current implementation, not unrelated repository security debt.

- R1 partial preference write: resolved by rollback of the shared/native store, with adapter-level tests for disk-save failure after memory mutation and explicit rollback failure reporting.
- R2 disappearing install error: resolved by recording the failed operation in controller state and retaining actionable toast errors. The follow-up explicit retry is covered too; automatic startup failures remain quiet. Hook tests include React StrictMode.
- Security review: no new actionable finding in the scoped implementation. Branch protection/writer access, public raw-host/cache behavior and actual signed upgrades remain explicit activation/qualification gates.

No unresolved scoped P0/P1 remains after fixes and verification. The existing optional signed-version enforcement is a future qualification/hardening consideration; existing signatures plus approved manifest/build proof checks are retained. Nothing has been published.
