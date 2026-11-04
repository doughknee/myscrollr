# Windows native election tester

On the prepared Windows machine, open **Start Scrollr Election Tester.cmd** in `%TEMP%\scrollr-election-native-beta3`. The launcher verifies the private core and its synthetic session, then starts the packaged Tauri executable. Use the tester tray icon’s **Quit** command to close both windows.

The ticker should display Tennessee Governor (QA replay). Click the race to open its candidate table. In the first replay phase, Preview A leads by 40 votes, with 40% reporting. The detail shows 120 votes for A and 80 for B, the source time, and a civicAPI attribution link.

This unsigned, machine-local test executable uses the private core on `http://localhost:18439` and the expiring synthetic session in `%TEMP%\scrollr-election-beta3-local\tester.json`. Its dedicated app identifier is `com.scrollr.electionbeta3test`. Its store and WebView2 data live under the tester’s temporary `profile` folder. The tester build disables updater access, autostart writes and legacy credential cleanup. If the private core or session has expired, use the reproducible browser replay in [TESTING.md](TESTING.md).

Verified on Windows using WebView2 with the packaged `http://tauri.localhost` origin. Clicking the visible ticker opened the race in the separate native main window, where both candidate rows, timestamp and attribution rendered. Both tester windows exited after verification.
