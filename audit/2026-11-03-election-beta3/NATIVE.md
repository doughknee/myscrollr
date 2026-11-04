# Windows native election tester

## National race picker

Start **Test National Race Picker.cmd** from this audit folder. Once that local tester is signed in, open **Start Scrollr National Election Tester.cmd** in `%TEMP%\scrollr-election-national-native-beta3`. Keep the national browser tester running while using the native windows. The launcher checks the private core on port 18441 and uses its expiring synthetic account. The native app and browser share race follows.

Hover over a ticker race for the two highest individual candidate totals. Click it for the full candidate table. Under **Find races**, select a state, office or vote activity. **Observed count changes** identifies races with different totals at two checks. **Reported votes** includes races with votes at a single check. Use the native tester’s tray **Quit** to close the app.

The unsigned executable embeds its UI and uses the dedicated app identifier `com.scrollr.electionnationalbeta3test`. Its preferences and WebView2 data are in the tester’s temporary profile, with updater access, autostart writes and legacy credential cleanup disabled. [Local backend setup and browser verification](TESTING.md)

## Tennessee fixture replay

On the prepared Windows machine, open **Start Scrollr Election Tester.cmd** in `%TEMP%\scrollr-election-native-beta3`. The launcher verifies the private core and its synthetic session, then starts the packaged Tauri executable. Use the tester tray icon’s **Quit** command to close both windows.

The ticker should display Tennessee Governor (QA replay). Click the race to open its candidate table. In the first replay phase, Preview A leads by 40 votes, with 40% reporting. The detail shows 120 votes for A and 80 for B, the source time, and a civicAPI attribution link.

This unsigned, machine-local test executable uses the private core on `http://localhost:18439` and the expiring synthetic session in `%TEMP%\scrollr-election-beta3-local\tester.json`. Its dedicated app identifier is `com.scrollr.electionbeta3test`. Its store and WebView2 data live under the tester’s temporary `profile` folder. The tester build disables updater access, autostart writes and legacy credential cleanup. If the private core or session has expired, use the reproducible browser replay in [TESTING.md](TESTING.md).

Verified on Windows using WebView2 with the packaged `http://tauri.localhost` origin. Clicking the visible ticker opened the race in the separate native main window, where both candidate rows, timestamp and attribution rendered. Both tester windows exited after verification.
