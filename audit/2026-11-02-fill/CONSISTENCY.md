# Fill consistency audit

Read-only review of PR #529 against origin/main, scoped to Fill, shared renderers, host adapters, preference sanitation and native placement. Inventory, consistency lens and CHIP_SPEC reviewed. No source, native-window, preference, Linear or commit actions. SCROLLR-400/401 activeHover/PagedBar and EmptyBar/App work is in flight under the root agent; those known problems are excluded below. Locations describe the reviewed working tree and may shift during those edits.

## Findings

### C1 — P1: Grouped utilities can permanently skip configured items

- **Locations:** `desktop/src/components/pages/EdgeZone.tsx:213`, `:273-284`; Fill callers at `PagedBar.tsx:753` and `:829`.
- **Evidence:** Fill selects utility groups with `(tick * slots + i) % edge.utilities.length`, then selects each utility's item with `tick % u.items.length`. Both levels use the same global tick. Docked shows each utility on every tick, so it does not suffer this aliasing.
- **Repro:** Four active utilities, two visible utility slots, and a Clock with two zones. Clock at utility index 0 appears on even ticks only and always selects item 0. A deterministic Node enumeration of ticks 0–11 produced clock visits at 0,2,4,6,8,10, all with `clockZone:0`. The second zone never appears, regardless of how long the screen runs. The same issue affects multiple weather cities/metrics/monitors whenever periods share a factor. A Pages strip with 1440 logical pixels gives two slots from its 25% utility budget; narrower grid headers can also group utilities.
- **Impact:** Fill silently hides configured information forever while docked presents it. Prerelease fix.
- **Suggested fix:** Advance the item cursor by that utility's own number of appearances, independent of group selection. Extract a pure scheduling helper and assert full item coverage across utility counts, available slot counts and item counts with common factors.
- **Confidence:** Confirmed arithmetic; no native/browser interaction performed.
- **Test location and candidate rule:** Add pure cases beside the existing `desktop/src/components/pages/EdgeZone.test.tsx` coverage (or a small scheduler test imported there). With `visible = min(utilityCount, max(1, requestedSlots))`, flatten each displayed position as `k = tick * visible + offset`, choose utility `k mod utilityCount`, and use `floor(k / utilityCount)` as its item tick. In the all-visible case `visible = utilityCount`, that yields exactly the existing `tick` for every utility. With four utilities/two slots, Clock receives item ticks 0,1,2,3 across its successive appearances. Current turn ticks are nonnegative; if exposing a generic helper, normalize the utility modulo for negative ticks as Slot already does for item indices. Cover 4/2/2 and 5/2/3, one slot, all visible, and excess requested slots.

### C2 — P2: Grid backward paging enters from the wrong side

- **Locations:** `desktop/src/components/pages/PagedBar.tsx:758-761` compared with `:796-800`; swipe variants around `:713-721`.
- **Evidence:** Strip passes `custom={cur.back}` to the entering `motion.div`. Grid only passes it to `AnimatePresence`. The installed Motion resolver uses the element's `props.custom` for ordinary variants and presence-context `custom` specifically for exit (`motion-dom/dist/es/render/utils/resolve-variants.mjs` and `animation/interfaces/visual-element-variant.mjs`). Therefore a backward grid entry gets undefined/false and starts at `x:100%`, while its exiting page receives true and leaves toward `x:100%`.
- **Repro:** Grid with at least two pages, reduced motion off: go forward then press Left or Previous page. The incoming page comes from the right instead of the left; strip follows the existing backward swipe contract.
- **Suggested fix:** Pass `custom={cur.back}` to the grid page element too, and cover the incoming/outgoing transform signs in the grid paging browser case. Preserve the existing swipe animation.
- **Confidence:** Confirmed source and installed resolver behavior; visual repro not run.

### C3 — P2: Utility-only pins reserve a blank grid footer

- **Locations:** `desktop/src/components/pages/PagedBar.tsx:443-446`, `:770-771`; `desktop/src/components/pages/EdgeZone.tsx:146-148`.
- **Evidence:** Footer reservation is based on every saved `onEdge` pin. `buildEdge` deliberately excludes utility pins because those utilities already occupy the header, and excludes pins whose widget is off the ticker. A pinned Clock alone therefore reserves 64 logical pixels of footer with no footer cell. This is distinct from the intentional reservation for a data pin whose payload is temporarily missing.
- **Repro:** Save a Clock pin (including an existing migrated utility pin), show a normal data widget in Fill grid, and keep no data pins. The Clock appears in the header, but a blank footer remains. At logical height 400, this changes available row count from two to one (`floor((400-48)/160)=2`, versus `floor((400-48-64)/160)=1`).
- **Suggested fix:** Derive local placement/reservation from eligible footer pin subjects: active data widgets with an edge-cell implementation. Preserve their reservation even if their current data is absent. Exclude utility/header-only and inactive widget pins before budgeting.
- **Confidence:** Confirmed control flow and geometry; browser repro not run.

## Scope and cleanup ranking

No P0 found. No copied ticker/data renderer was introduced; grid and strip share their cells/selectors, and grid's Pages override plus strip's saved scroll mode match CHIP_SPEC. Device-local display sanitation defaults malformed reading sizes to 100 consistently with the native adapter. Token-count, dependency-hygiene and unrelated dead-code sweeps were intentionally excluded by the feature scope; no cosmetic findings are inflated into defects.

Highest value per effort (three actionable findings, rather than padding to ten):

1. C1: fix utility/item scheduling; configured information is otherwise unreachable.
2. C2: forward the grid page's existing direction prop; restores the established animation with a small change.
3. C3: share footer-placement eligibility with pin budgeting; removes empty space and unnecessary pagination.

Native platform parity, mixed DPI, hotplug and sleep/wake remain the inventory's unverified release gates; this source audit does not establish runtime success.
