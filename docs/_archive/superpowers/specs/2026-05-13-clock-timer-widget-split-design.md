# Clock And Timer Widget Split Design

## Goal

Split the current combined Clock widget into two independent desktop widgets: Clock and Timer. The split should follow the same widget ownership model as the rest of the desktop app, while improving the visual design and UI/UX of both widgets.

Clock should feel calm, glanceable, and precise. Timer should feel focused, active, and tactile. They should remain visually consistent with the desktop app through shared surfaces, borders, mono typography, compact/comfort modes, and ticker chip behavior.

## Architecture

Clock remains in `desktop/src/widgets/clock/` and owns only local/world-clock behavior:

- Local time display.
- World clock timezone list.
- Time format.
- Clock ticker settings.
- Clock config panel.

Timer moves into its own `desktop/src/widgets/timer/` module and becomes a first-class widget with:

- Its own `FeedTab` widget manifest.
- Its own `ConfigPanel`.
- Its own widget preferences.
- Its own ticker settings.
- Its own persisted runtime state.

The widget registry should list Timer as a normal peer widget, for example `clock`, `timer`, `weather`, `sysmon`, `uptime`, `github`.

Existing users should not lose settings. Preference loading should migrate existing `clock.pomodoro` into `timer.pomodoro`, and existing `clock.ticker.activeTimer` into `timer.ticker.activeTimer`. Existing timer runtime state should remain readable. If the current runtime state key is already represented by `LS_TIMER_STATE`, keep it and treat it as timer-owned going forward.

## Clock UI

Clock becomes a focused world-time dashboard.

Comfort mode should lead with a stronger local-time card containing the current time, date, local timezone label, UTC offset, and subtle indigo emphasis. World clocks should appear below as clean cards showing city, region or offset, time, and date.

Compact mode should stay dense: one local row followed by timezone rows. The timezone picker remains available in compact mode, but should use the same small bordered search-panel language used by other desktop widgets.

Clock controls:

- `12h` / `24h` toggle stays in the feed header area.
- `+ Add` opens the timezone picker.
- Timezone removal stays per row/card.
- Clock config keeps ticker visibility and timezone inclusion settings.
- Pomodoro and timer settings are removed from Clock config.

Clock visual language:

- Use `widget-clock` indigo as the accent.
- Prefer quiet card entry and hover-border motion.
- Use strong tabular mono time displays.
- Avoid active/tactile timer styling.

## Timer UI

Timer becomes a focused control surface and keeps all current modes: Pomodoro, Countdown, and Stopwatch.

Comfort mode should include:

- A top mode selector for `Pomodoro`, `Countdown`, and `Stopwatch`.
- A dominant central time display.
- Circular progress for Pomodoro and Countdown.
- A simpler count-up display for Stopwatch.
- Clear primary action states: `Start`, `Pause`, `Resume`, or `Reset`.
- Contextual secondary controls: countdown presets/custom input, Pomodoro break buttons, notification permission prompt, and keyboard hints.

Compact mode should fit the widget feed without feeling cramped:

- Keep a tighter mode selector.
- Show one compact status card with running dot, display time, mode label, and primary action.
- Show secondary controls only when relevant and not running, especially countdown presets/custom input.

Timer config:

- Ticker section controls whether active timers appear on the ticker.
- Pomodoro section controls work session, short break, long break, and long-break cadence.
- Clock/timezone settings do not appear in Timer config.

Timer visual language:

- Use `widget-timer` amber as the accent.
- Make active states more tactile than Clock while staying inside the desktop surface/border/text system.
- Avoid noisy animation. Running state may pulse; progress ring should animate stroke only.

## Data And Ticker Behavior

Ticker data should follow normal widget ownership rules.

Clock ticker data:

- Built only when `clock` is enabled on the ticker.
- Uses `clock.ticker.localTime`, `clock.ticker.showTimezones`, and `clock.ticker.excludedTimezones`.
- Emits only clock chips.
- Uses `widget-clock` chip coloring.

Timer ticker data:

- Built only when `timer` is enabled on the ticker.
- Uses `timer.ticker.activeTimer`.
- Emits only one timer chip when a timer is running or paused with elapsed time.
- Uses `widget-timer` chip coloring.

Preference ownership:

- `WidgetPrefs.clock` owns clock config only.
- `WidgetPrefs.timer` owns timer config only.
- Legacy clock-owned timer settings are migrated during preference load.

## Error Handling And Empty States

Clock should show clear empty/search states in the timezone picker:

- No matching cities.
- All preset timezones added.
- Config helper text when timezone ticker display is enabled but no world clocks are available.

Timer should preserve resilient behavior:

- Web Audio failures are ignored safely.
- Notification support and permission prompts remain guarded by feature detection.
- Switching modes with active or banked time still asks for confirmation before reset.
- Invalid custom countdown values should not start or save a timer.

## Verification

Run the desktop build after implementation:

```sh
npm run build
```

Manual verification should confirm:

- Clock and Timer appear as separate widgets in the desktop widget registry and UI.
- Clock feed no longer contains Timer tabs.
- Timer feed works independently with Pomodoro, Countdown, and Stopwatch.
- Clock config contains only clock settings.
- Timer config contains timer ticker and Pomodoro settings.
- Clock ticker chips and Timer ticker chips are independently controlled.
- Existing Pomodoro settings and active timer state are preserved after migration.
