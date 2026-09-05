/**
 * The dev command bus: a Vite middleware that lets a script outside the
 * app run code inside a window of the running dev build.
 *
 * Why: the ticker is a native always-on-top window whose marquee never
 * paints in a browser tab, so nothing outside the app could set its state
 * or read what it rendered. The MCP bridge plugin used to do this on the
 * Mac and is compiled out on Windows (COM threading). This is the same
 * idea over plain HTTP on the dev server that is already running, with
 * no Rust, so it works everywhere the dev build does and cannot exist in
 * a release build (Vite middleware only lives in `vite dev`).
 *
 *   POST /__dev/cmd    { window, code, timeout? }  -> waits for the result
 *   GET  /__dev/poll?window=ticker                 -> the window's next command
 *   POST /__dev/result { id, ok, value | error }   -> completes a cmd
 *
 * Both ends long-poll, so a command lands in under a frame and there is
 * no idle traffic. See desktop/src/dev/bus.ts for the window side and
 * scripts/dev/devctl.mjs for the CLI.
 */
import type { Plugin } from "vite";

interface Cmd {
  id: number;
  code: string;
  resolve: (r: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const POLL_MS = 25_000;

export function devBus(): Plugin {
  let nextId = 1;
  const queues = new Map<string, Cmd[]>();
  const waiters = new Map<string, (c: Cmd | null) => void>();
  const pending = new Map<number, Cmd>();

  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };
  const readBody = (req: import("node:http").IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let s = "";
      req.on("data", (c) => (s += c));
      req.on("end", () => {
        try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); }
      });
    });
  const hand = (win: string, cmd: Cmd) => {
    const w = waiters.get(win);
    if (w) { waiters.delete(win); w(cmd); }
    else (queues.get(win) ?? queues.set(win, []).get(win)!).push(cmd);
  };

  return {
    name: "scrollr-dev-bus",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://x");
        if (!url.pathname.startsWith("/__dev/")) return next();

        if (url.pathname === "/__dev/cmd" && req.method === "POST") {
          const b = await readBody(req);
          const win = String(b.window ?? "ticker");
          const code = String(b.code ?? "");
          const timeout = Number(b.timeout) || 8000;
          const id = nextId++;
          const cmd = {
            id, code,
            resolve: (r) => json(res, 200, r),
            timer: setTimeout(() => {
              pending.delete(id);
              const q = queues.get(win);
              if (q) queues.set(win, q.filter((c) => c.id !== id));
              json(res, 200, { ok: false, error: `no answer from the ${win} window in ${timeout}ms (is the dev app running?)` });
            }, timeout),
          } as Cmd;
          pending.set(id, cmd);
          hand(win, cmd);
          return;
        }

        if (url.pathname === "/__dev/poll") {
          const win = url.searchParams.get("window") ?? "ticker";
          const q = queues.get(win);
          const send = (c: Cmd | null) => (c ? json(res, 200, { id: c.id, code: c.code }) : json(res, 204, null));
          if (q?.length) return send(q.shift()!);
          // One waiter per window; a newer poll replaces an older one.
          waiters.get(win)?.(null);
          waiters.set(win, send);
          const t = setTimeout(() => { if (waiters.get(win) === send) { waiters.delete(win); send(null); } }, POLL_MS);
          req.on("close", () => { clearTimeout(t); if (waiters.get(win) === send) waiters.delete(win); });
          return;
        }

        if (url.pathname === "/__dev/result" && req.method === "POST") {
          const b = await readBody(req);
          const cmd = pending.get(Number(b.id));
          if (cmd) {
            pending.delete(cmd.id);
            clearTimeout(cmd.timer);
            cmd.resolve(b.ok ? { ok: true, value: b.value } : { ok: false, error: b.error });
          }
          return json(res, 200, { ok: true });
        }

        json(res, 404, { ok: false, error: "unknown dev endpoint" });
      });
    },
  };
}
