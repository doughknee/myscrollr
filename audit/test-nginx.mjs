import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dockerfile = readFileSync(
  resolve(root, "myscrollr.com/Dockerfile"),
  "utf8",
);
const blocks = [
  ...dockerfile.matchAll(/printf '([\s\S]*?)' > (\/etc\/nginx\/[^\s]+)/g),
];

function decode(block) {
  return block
    .replaceAll(`'"'"'`, "'")
    .replace(/\\n\\\r?\n/g, "\n")
    .replaceAll("\\n", "\n");
}

const configs = Object.fromEntries(
  blocks.map(([, body, path]) => [path, decode(body)]),
);
const main = configs["/etc/nginx/conf.d/default.conf"];
const headers = configs["/etc/nginx/security-headers.conf"];
if (!main || !headers) throw new Error("Could not extract nginx configuration");

const name = `scrollr-seo-${process.pid}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  docker(
    "create",
    "--name",
    name,
    "-e",
    `MAIN_CONFIG=${Buffer.from(main).toString("base64")}`,
    "-e",
    `HEADERS_CONFIG=${Buffer.from(headers).toString("base64")}`,
    "nginx:alpine",
    "sh",
    "-c",
    'echo "$MAIN_CONFIG" | base64 -d > /etc/nginx/conf.d/default.conf && echo "$HEADERS_CONFIG" | base64 -d > /etc/nginx/security-headers.conf && nginx -g "daemon off;"',
  );
  docker(
    "cp",
    `${resolve(root, "myscrollr.com/dist/client")}/.`,
    `${name}:/usr/share/nginx/html`,
  );
  docker("start", name);

  let ready = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      docker("exec", name, "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/");
      ready = true;
      break;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  if (!ready) {
    const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
    throw new Error(
      `${docker("inspect", "-f", "{{json .State}}", name)}\n${logs.stdout}${logs.stderr}`,
    );
  }

  const cases = [
    ["/sports", 200, null, null],
    ["/sports/?probe=seo", 301, "/sports?probe=seo", null],
    ["/sports/index.html?probe=seo", 301, "/sports?probe=seo", null],
    ["/channels?probe=seo", 301, "/widgets?probe=seo", null],
    ["/index.html?probe=seo", 301, "/?probe=seo", null],
    ["/channels/index.html?probe=seo", 301, "/widgets?probe=seo", null],
    ["/account", 200, null, "noindex, nofollow"],
    ["/admin/support", 200, null, "noindex, nofollow"],
    ["/u/example", 200, null, "noindex, nofollow"],
    ["/not-a-real-route", 404, null, null],
    ["/Sports", 404, null, null],
    ["/tss-spa-shell", 404, null, null],
  ];

  for (const [path, status, location, robots] of cases) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        name,
        "sh",
        "-c",
        `printf 'GET ${path} HTTP/1.1\r\nHost: myscrollr.com\r\nConnection: close\r\n\r\n' | nc 127.0.0.1 3000`,
      ],
      { encoding: "utf8" },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const actualStatus = Number(output.match(/HTTP\/1\.1 (\d+)/)?.[1] ?? 200);
    const actualLocation = output.match(/^\s*Location:\s*(.+)$/im)?.[1]?.trim() ?? null;
    const actualRobots = output.match(/^\s*X-Robots-Tag:\s*(.+)$/im)?.[1]?.trim() ?? null;
    if (
      actualStatus !== status ||
      actualLocation !== location ||
      actualRobots !== robots
    ) {
      throw new Error(
        `${path}: status=${actualStatus}, location=${actualLocation}, x-robots-tag=${actualRobots}\n${output}`,
      );
    }
    console.log(`✓ ${path}: ${status}`);
  }
} finally {
  try {
    docker("rm", "-f", name);
  } catch {
    // Container may have exited after a syntax error.
  }
}
