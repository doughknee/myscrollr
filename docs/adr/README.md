# Architecture Decision Records

Numbered, append-only records of significant architecture decisions.
New ADRs start as **Proposed**; flip to **Accepted** when the decider
signs off, and **Superseded by ADR-NNNN** if a later record replaces
one.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-sse-multi-replica.md) | Scaling core-api SSE delivery past one replica | Accepted |
| [0002](0002-consolidate-widget-read-apis.md) | Consolidate widget read APIs into core-api; retire dynamic discovery for first-party sources | Accepted |

For the current target architecture and the reasoning behind the
2026-07 unification, see [`../VISION.md`](../VISION.md) (charter) and
[`../ROLLOUT.md`](../ROLLOUT.md) (execution log).
