package ops

// releasePage is the whole page: inline CSS and script, no build step.
// {{VERSION}} is replaced with the release version (OPS_RELEASE_TAG without
// "desktop-v"). The script reads the key back out of the page's own URL.
const releasePage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Scrollr {{VERSION}}</title>
<style>
  body { margin: 0; font: 18px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background: #f6f7f8; color: #16181b; }
  main { max-width: 560px; margin: 0 auto; padding: 48px 16px; }
  h1 { font-size: 32px; margin: 0 0 8px; }
  p { margin: 0 0 32px; color: #444a52; }
  button { display: block; width: 100%; height: 64px; border: 0; border-radius: 12px; background: #16a34a; color: #fff; font: inherit; font-size: 24px; font-weight: 700; cursor: pointer; }
  button:hover:not(:disabled) { background: #15803d; }
  button:disabled { background: #9ca3af; cursor: default; }
  #line { margin-top: 20px; min-height: 1.5em; font-weight: 600; }
  #line.ok { color: #15803d; }
  #line.bad { color: #b91c1c; }
  #line.muted { color: #6b7280; font-weight: 400; }
  #line a { color: inherit; }
  @media (prefers-color-scheme: dark) {
    body { background: #111315; color: #e8eaed; }
    p { color: #a8adb4; }
    #line.ok { color: #4ade80; }
    #line.bad { color: #f87171; }
  }
</style>
</head>
<body>
<main>
  <h1>Scrollr {{VERSION}}</h1>
  <p>Once the Apple agreement is accepted, press the button. It rebuilds macOS, publishes the release, announces it, and updates the site. About 25 minutes.</p>
  <button id="go" disabled>I did it</button>
  <div id="line" class="muted" role="status" aria-live="polite">Checking…</div>
</main>
<script>
(function () {
  var q = "?key=" + encodeURIComponent(new URLSearchParams(location.search).get("key") || "");
  var btn = document.getElementById("go");
  var line = document.getElementById("line");
  var since = null;     // set when this page dispatched a run
  var watching = false; // this page has seen the run going
  var timer = null;

  function show(text, cls, url) {
    line.className = cls || "";
    line.textContent = text;
    if (url) {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noreferrer";
      a.textContent = "See the run";
      line.appendChild(document.createTextNode(" "));
      line.appendChild(a);
    }
  }
  function later() { clearTimeout(timer); timer = setTimeout(poll, 15000); }

  function poll() {
    fetch("/ops/release/status" + q, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (s) {
        if (since && (s.status === "none" || new Date(s.created_at) < since)) {
          btn.disabled = true; show("Starting…"); return later();
        }
        if (s.status !== "none" && s.status !== "completed") {
          watching = true; btn.disabled = true; show(s.label || "Starting…"); return later();
        }
        if (s.status === "completed" && s.conclusion === "success") {
          btn.disabled = true; return show("Done — {{VERSION}} is out.", "ok");
        }
        btn.disabled = false;
        if (s.status === "completed" && (watching || since)) {
          since = null; watching = false;
          return show("Something failed — nothing was published. Tell Brandon.", "bad", s.url);
        }
        if (s.status === "completed") {
          return show("The last try did not finish, so nothing was published.", "muted", s.url);
        }
        show("", "muted");
      })
      .catch(function () {
        show("Can't reach the server. Retrying…", "muted");
        later();
      });
  }

  btn.addEventListener("click", function () {
    btn.disabled = true;
    show("Starting…");
    fetch("/ops/release/finish" + q, { method: "POST" })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) { since = new Date(d.since); later(); });
        }
        if (r.status === 409) { watching = true; return poll(); }
        if (r.status === 429) { since = new Date(Date.now() - 75000); return later(); }
        throw new Error(r.status);
      })
      .catch(function () {
        btn.disabled = false;
        show("Couldn't start it. Wait a minute and press again.", "bad");
      });
  });

  poll();
})();
</script>
</body>
</html>
`
