# SCROLLR-409: header pins

Follow-up to the baseline audit and the user's screenshot of unused header/footer space. This supersedes the footer placement described in the baseline reports; CHIP_SPEC P.16 is the current contract.

Fill grid keeps one 48px logical header row. Its existing widget band is followed by compact shared pin cells and utilities; the old footer is removed and the main grid reaches the bottom. Pin cells grow into spare header width. Original slide/wipe variants and the Windows cursor workaround are unchanged.

The pure gridHeaderPlan in edgeRule.ts supplies both the renderer and context-menu admission. It reserves the band, utility slots and borders in the same logical coordinate system. Only eligible active data pins consume the pin budget. Fractional zoom measurements are preserved to prevent rounding from clipping the final utility at large reading sizes.

## Risks covered and deliberate limits

- Short screens: no second header row or footer; header height does not grow with pin count. Main cells keep their existing minimums.
- Narrow/portrait or larger reading size: saved overflow pins return to normal pages and restore when width returns. The design does not shrink pinned text below the existing compact renderer or drop saved selections. A narrower header can therefore show fewer persistent pins.
- Utilities: clock/weather/other items still cycle fairly when grouped; at least one slot remains when any utility has data.
- Missing data: eligible saved pins reserve their header slots, so later payloads cannot resize neighbouring pins. No fabricated value is shown.
- Admission: warning names the header and only recommends removing one specific pin if doing so creates enough room. Multiple removals and insufficient room even with no pins have separate messages.
- Shared hosts: Docked and strip retain their width policy. Pin eligibility and existing cells remain shared; no copied ticker or new host.
- Sparse data may still leave ordinary grid cells unused; entries are not duplicated to fill them. The dedicated blank lower-left footer region is gone.

## Verification

Production build, 1,042 Vitest tests and all 55 focused browser cases passed. Header bounds were checked at 3440x1440, 1920x360, 800x480, 720x1280 and 1080x1920 at 100/150%; unit geometry also covers 125%. Coverage includes resize overflow/restoration, missing pin data, context-menu refusal/admission, content reaching the bottom, and existing animation, hover, cell and Escape behavior. The late-data fixture initially omitted its symbol from the widget scope; corrected fixture configuration passed the regression without an app change.

Fixture screenshots in local ignored states/header-*.png were visually inspected in light and dark themes. The user's dev app remains on5174; audit preview/test server is5196. This is browser/layout verification, not a new physical monitor, sleep/wake or mini-PC performance certification.

## Portrait and short-card refinement (SCROLLR-409 / SCROLLR-410)

User review found that portrait still reserved an unusable pin area and sports cells centered a compact scoreboard inside the taller grid row. Utilities now reclaim unused pin capacity after saved pins are placed. When none fit, clock and weather share the full area after the band. Admission still reserves the minimum utility allocation, so opportunistically showing extra utilities cannot incorrectly refuse the next pin; missing-data pins still reserve their slots.

The shared Fill sports cell uses two equal-height team rows with 32px crests and reserved scores, 18px names, and always-reserved team records. A fixed status row anchors game phase and clock below them. Type is bounded rather than scaled with arbitrary card height. Docked cells, source selection, header height, slide/wipe motion and the Windows renderer workaround are unchanged.

Verification: production build and 1,043 Vitest tests passed. All 60 focused browser cases passed across the main and follow-up runs. The initial main run had one hover-to-Fill test interrupted by a Vite HMR invalidation while a source comment was edited; the page navigated and lost the test's injected IPC override. Its isolated rerun passed without a product change. New checks cover portrait utilities closing the pin gap, stable vertical sports reservations across pre/live/final states, and non-overlapping row/status geometry at 1920x240 and 1920x360 with 100/150% reading sizes. Existing pin admission, late-data reservations, resize restoration, keyboard direction, hover and Escape checks passed.

Actual shared renderer screenshots were inspected at 1920x360, 1920x1080 and 1080x1920 in dark mode and 1920x240 in light mode. Sparse datasets can still leave whole grid cells empty; records are shown only when supplied. These remain fixture/browser checks, not new native hardware certification.
