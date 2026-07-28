# Motion performance re-audit

Scope: the main app only; ticker animation performance is intentionally
excluded.

Final result: zero main-app animations to score.

No Motion or Motion+ runtime is included in the main-app entry bundle. No CSS
keyframe, transition, layout animation, requestAnimationFrame loop, WAAPI
call, View Transition, animated CSS variable, or `will-change` usage remains
in the main app.
