# Native Windows rendering sample

Read-only requestAnimationFrame sampling inside the existing development ticker using scripts/dev/devctl.mjs; no preferences, data or input behavior changed. Sample code: results/fill-native-audit.js. Window remained visible, Fill grid, 3440x1440, original swipe motion. Running WebView2 had the app-local DirectComposition workaround. Machine reports AMD Radeon RX 7900 XTX plus integrated Radeon graphics; renderer-device attribution not measured.

60 seconds (1793683358109–1793683418109 UTC epoch milliseconds): 9615 callbacks, median6.1ms, p956.2ms, p9912.2ms, maximum24.2ms, zero deltas>50ms. Reported JS heap25,648,578 to26,609,224 bytes; not GC-controlled and not evidence of a leak or its absence.

Conclusion: no long animation stalls observed during this bounded native sample. Does not establish customer mini-PC performance, long-run memory stability, all input-path behavior or other Windows/GPU combinations. User separately confirmed cursor responsive after keyboard/wheel navigation with the workaround.
