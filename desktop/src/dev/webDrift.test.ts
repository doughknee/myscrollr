import adapter from "./web.ts?raw";

// Drift guard for web mode (SCROLLR-251): every Tauri command the app
// invokes and every Tauri plugin it imports must be known to src/dev/web.ts,
// or web mode silently loses that behaviour. A grep on purpose: no build step.
const raw = import.meta.glob<string>(
  ["../**/*.{ts,tsx}", "!../**/*.test.{ts,tsx}", "!../dev/**"],
  { query: "?raw", import: "default", eager: true },
);
const sources = Object.entries(raw).map(([f, text]) => ({ f: f.replace("../", ""), text }));

function collect(re: RegExp): Map<string, string> {
  const found = new Map<string, string>();
  for (const { f, text } of sources) {
    for (const m of text.matchAll(re)) if (!found.has(m[1])) found.set(m[1], f);
  }
  return found;
}

describe("web mode drift guard", () => {
  it("handles every command the app invokes", () => {
    const commands = collect(/\binvoke(?:<[^(]*?>)?\(\s*["'`]([\w:|]+)["'`]/g);
    expect(commands.size).toBeGreaterThan(10); // the grep itself still works
    const missing = [...commands]
      .filter(([cmd]) => !adapter.includes(`"${cmd}"`))
      .map(([cmd, f]) => `${cmd} (invoked in src/${f})`);
    expect(missing, "add these to the switch or the noop set in src/dev/web.ts").toEqual([]);
  });

  it("handles every @tauri-apps/plugin-* the app imports", () => {
    const plugins = collect(/["']@tauri-apps\/plugin-([a-z-]+)["']/g);
    expect(plugins.size).toBeGreaterThan(3);
    const missing = [...plugins]
      .filter(([name]) => !adapter.includes(`plugin:${name}|`) && !new RegExp(`plugin:\\([^)]*\\b${name}\\b`).test(adapter))
      .map(([name, f]) => `plugin-${name} (imported in src/${f})`);
    expect(missing, "add a `plugin:<name>|…` case or extend the no-op regex in src/dev/web.ts").toEqual([]);
  });
});
