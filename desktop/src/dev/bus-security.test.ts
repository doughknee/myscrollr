// @vitest-environment node
import { createServer, request } from "node:http";
import { once } from "node:events";
import { expect, it } from "vitest";
import { devBus } from "../../scripts/dev-bus";
import type { ViteDevServer } from "vite";

it("blocks foreign origins and rebinding hosts while local CLI and app requests work", async () => {
  let middleware: any;
  const plugin = devBus();
  (plugin.configureServer as Function)({ middlewares: { use: (fn: any) => { middleware = fn; } } } as unknown as ViteDevServer);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode=404;res.end(); }); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as {port:number}).port;
  const base = `http://127.0.0.1:${port}`;
  const send = (path: string, method: string, headers: Record<string,string>={}, body="") => new Promise<{status:number, data:any}>((resolve,reject) => {
    const req=request(`${base}${path}`, {method,headers},res=>{
      let text="";res.on("data",chunk=>text+=chunk);res.on("end",()=>resolve({status:res.statusCode!,data:text ? JSON.parse(text) : null}));
    });req.on("error",reject);req.end(body);
  });
  try {
    const badHeaders: Record<string,string>[] = [
      { Origin: "https://attacker.test", "Content-Type": "application/json" },
      { Host: `attacker.test:${port}`, "Content-Type": "application/json" },
      { Origin: "null", "Content-Type": "application/json" },
      { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
    ];
    for (const headers of badHeaders) {
      const response = await send('/__dev/cmd', 'POST', headers, '{}');
      expect(response.status).toBe(403);
    }
    expect((await send('/__dev/cmd','POST',{"Content-Type":"text/plain"},'{}')).status).toBe(415);
    // Observe command enqueue before polling so the fixture does not depend on request ordering.
    let queued!:()=>void; const ready=new Promise<void>(resolve=>queued=resolve);
    const original=middleware;middleware=async (...args:any[])=>{await original(...args);if(args[0].url==='/__dev/cmd')queued();};
    const command=send('/__dev/cmd','POST',{"Content-Type":"application/json"},JSON.stringify({window:"main",code:"1+1",timeout:2000}));
    await ready;
    const job=(await send('/__dev/poll?window=main','GET',{Origin:base})).data;expect(job.code).toBe("1+1");
    await send('/__dev/result','POST',{Origin:base,"Content-Type":"application/json"},JSON.stringify({id:job.id,ok:true,value:2}));
    expect((await command).data).toEqual({ok:true,value:2});
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
