# Test Election Results on Windows

With Docker Desktop running, Node 22+ and Microsoft Edge installed, double-click **Test Election Results.cmd**. Or run this in PowerShell from the beta.3 checkout:

```powershell
node audit/2026-11-03-election-beta3/tester.mjs --fresh
```

This opens the desktop app's web mode with its ticker and main window, already signed in as a synthetic Free user. The prepared beta checkout already has its licensed Motion+ desktop packages. A clean checkout also needs the normal project Motion+ developer access for the desktop preweb bootstrap. The first run installs missing desktop dependencies, pulls containers and compiles core. Subsequent runs reuse the build caches and the tester's database. Keep the terminal and Edge window open during the test.

1. Click **+** in the sidebar to open the **Catalog**. Search for **Election Results** and click **Add Election Results**. Adding it opens the race picker and uses one account slot.
2. Search for **Tennessee** and follow **Tennessee Governor**. The fictional snapshot identifies itself as **QA replay**. It starts with Preview A at 120 votes and Preview B at 80.
3. In a second terminal, switch to a correction:

   ```powershell
   node audit/2026-11-03-election-beta3/tester.mjs --phase=correction
   ```

   Preview B now leads with 140 votes. Leave the ticker open for up to one 30-second fallback refresh. This SQL replay deliberately sends no push, exercising recovery from a missed event.
4. Try `--phase=delayed`, `--phase=disputed`, `--phase=called` or `--phase=waiting`. Restore the original snapshot with `--phase=first`. Unfollow the race and verify that its ticker entry disappears. Remove the widget to release its slot.

**Live provider check.** Close the replay window, then run the same command with `--live` instead of `--fresh`. This resets the fixture and builds the dedicated Rust ingester in the isolated stack. Follow the race to request a shared upstream snapshot. If civicAPI is unavailable, the widget can show waiting or delayed results. Your race follows survive switching modes. Closing the tester window stops its live worker. The QA replay uses fictional candidates for repeatable visual tests.

**Automated browser verification.** Close the private tester, then run `node audit/2026-11-03-election-beta3/tester.mjs --fresh --verify`. It exercises the real desktop UI on a separate synthetic account. It verifies follow/unfollow, both ticker layouts, corrections, delayed results, a call and recovery after a missed notification. The fixture results are shared only inside the disposable test database.

**Existing preview.** Omit `--fresh` to use the already-running local review stack on ports 18439/19439 while its synthetic session is valid. The launcher verifies the session through core and the desktop proxy. If that stack is unavailable it starts the isolated replay on ports 18440/19440 instead. Replay phase commands target only the isolated replay database.

**Runtime.** The fresh stack runs under the Compose project `scrollr-election-tester`. Only core and Vite bind to host loopback. Postgres, Redis and the mock JWKS service stay on its private network. Core validates an expiring, locally signed JWT and the isolated Redis has an active-account fixture for that synthetic subject. The account's follows persist in the local Postgres volume. Browser settings live in a temporary Edge profile. This exercises web-mode app behavior. Native window placement, installation, signing and update recovery require an installed candidate.

**Shutdown.** Close the app and stop its private containers with `node audit/2026-11-03-election-beta3/tester.mjs --stop`. The database and Go caches are retained. `--logs` prints the private core log. `--check --fresh` runs a headless startup check that waits for the signed-in dashboard response.
