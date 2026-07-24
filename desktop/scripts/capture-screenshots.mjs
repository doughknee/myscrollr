#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { parseArgs } from "node:util";

const themeFamilies = [
  "scrollr",
  "catppuccin",
  "dracula",
  "tokyo-night",
  "nord",
  "gruvbox",
  "solarized",
  "rose-pine",
  "one",
  "everforest",
];

const routes = [
  { id: "home", path: "/feed", sidebar: true },
  { id: "catalog", path: "/catalog", sidebar: true },
  { id: "customize-ticker", path: "/customize", sidebar: true },
  { id: "customize-app", path: "/customize?tab=app", sidebar: true },
  { id: "support", path: "/support", sidebar: true },
  { id: "stocks", path: "/widget/finance_stocks", sidebar: true },
  { id: "crypto", path: "/widget/finance_crypto", sidebar: true },
  { id: "predictions", path: "/widget/predictions", sidebar: true },
  { id: "sports-nfl", path: "/widget/sports_nfl", sidebar: true },
  { id: "news-bbc", path: "/widget/news_bbc", sidebar: true },
  { id: "fantasy", path: "/widget/fantasy_yahoo", sidebar: true },
  { id: "clock", path: "/widget/clock", sidebar: true },
  { id: "weather", path: "/widget/weather", sidebar: true },
  { id: "sysmon", path: "/widget/sysmon", sidebar: true },
  { id: "timer", path: "/widget/timer", sidebar: true },
  { id: "uptime", path: "/widget/uptime", sidebar: true },
  { id: "github", path: "/widget/github", sidebar: true },
];

const CHROME_IDS = new Set(["home", "catalog", "customize-ticker", "customize-app", "support"]);
const sourceRoutes = routes.filter((route) => !CHROME_IDS.has(route.id));
const routeById = new Map(routes.map((route) => [route.id, route]));

const sourceAliases = new Map([
  ["finance", "stocks"],
  ["stocks", "stocks"],
  ["crypto", "crypto"],
  ["sports", "sports-nfl"],
  ["fantasy", "fantasy"],
  ["rss", "news-bbc"],
  ["news", "news-bbc"],
  ["predictions", "predictions"],
  ["kalshi", "predictions"],
  ["clock", "clock"],
  ["weather", "weather"],
  ["sysmon", "sysmon"],
  ["system", "sysmon"],
  ["timer", "timer"],
  ["uptime", "uptime"],
  ["github", "github"],
]);

const usage = `Usage:
  node desktop/scripts/capture-screenshots.mjs routes [--sources finance,sports] [--all] [--sidebar expanded|collapsed|both] [--json]
  node desktop/scripts/capture-screenshots.mjs test [--source finance] [--json]
  node desktop/scripts/capture-screenshots.mjs page <route-id|path> [--mode light|dark|both] [--sidebar expanded|collapsed|both] [--json]
  node desktop/scripts/capture-screenshots.mjs themes [--json]
  node desktop/scripts/capture-screenshots.mjs system <light|dark>
  node desktop/scripts/capture-screenshots.mjs crop --input <dir> --output <dir> [--crop 2] [--top 0] [--right 2] [--bottom 34] [--left 2]
`;

const command = process.argv[2];
const args = process.argv.slice(3);
const options = parseOptions(args);

if (!command || ["-h", "--help", "help"].includes(command)) {
  process.stdout.write(usage);
  process.exit(0);
}

if (command === "routes") {
  printMatrix(buildRouteMatrix(options), options.has("json"));
} else if (command === "test") {
  printMatrix(buildTestMatrix(options), options.has("json"));
} else if (command === "page") {
  printMatrix(buildPageMatrix(args[0], options), options.has("json"));
} else if (command === "themes") {
  printMatrix(buildThemeMatrix(options), options.has("json"));
} else if (command === "system") {
  setSystemMode(args[0]);
} else if (command === "crop") {
  cropDirectory(options);
} else {
  process.stderr.write(`Unknown command: ${command}\n\n${usage}`);
  process.exit(1);
}

function buildRouteMatrix(options) {
  const modes = parseModes(options.get("mode") ?? "both");
  const sidebarStates = parseSidebarStates(options.get("sidebar") ?? "expanded");
  const selectedRoutes = options.has("all")
    ? routes
    : buildCurrentSourceRoutes(requireSources(options.get("sources")));

  return modes.flatMap((mode) =>
    sidebarStates.flatMap((sidebar) =>
      selectedRoutes.map((route) => ({
        ...route,
        mode,
        sidebar,
        filename: `${mode}/${sidebar}/${route.id}.png`,
      })),
    ),
  );
}

function buildCurrentSourceRoutes(sources) {
  const wanted = sources.length > 0
    ? new Set(sources)
    : new Set(sourceRoutes.map((route) => route.id));
  return [routeById.get("home"), ...sourceRoutes.filter((route) => wanted.has(route.id))];
}

function buildTestMatrix(options) {
  const source = parseSources(options.get("source"))[0];
  const route = source ? routeById.get(source) : routeById.get("home");
  if (!route) {
    process.stderr.write(`Unknown test source: ${source}\n`);
    process.exit(1);
  }
  return [{
    ...route,
    mode: options.get("mode") === "light" ? "light" : "dark",
    sidebar: options.get("sidebar") === "collapsed" ? "collapsed" : "expanded",
    filename: `test/${route.id}.png`,
  }];
}

function buildPageMatrix(target, options) {
  if (!target) {
    process.stderr.write("page requires a route id or path\n");
    process.exit(1);
  }

  const route = routeById.get(target) ?? routes.find((item) => item.path === target) ?? {
    id: slugifyPath(target),
    path: target,
    sidebar: true,
  };
  const modes = parseModes(options.get("mode") ?? "both");
  const sidebarStates = parseSidebarStates(options.get("sidebar") ?? "expanded");

  return modes.flatMap((mode) =>
    sidebarStates.map((sidebar) => ({
      ...route,
      mode,
      sidebar,
      filename: `${mode}/${sidebar}/${route.id}.png`,
    })),
  );
}

function buildThemeMatrix(options) {
  const modes = parseModes(options.get("mode") ?? "both");
  return modes.flatMap((mode) =>
    themeFamilies.map((family) => ({
      id: `theme-${family}-${mode}`,
      path: "/feed",
      mode,
      themeFamily: family,
      dataTheme: `${family}-${mode}`,
      sidebar: "expanded",
      filename: `themes/${mode}/${family}.png`,
    })),
  );
}

function printMatrix(matrix, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(matrix, null, 2)}\n`);
    return;
  }

  for (const item of matrix) {
    const theme = item.dataTheme ? ` theme=${item.dataTheme}` : "";
    process.stdout.write(`${item.filename}\t${item.path}\tmode=${item.mode}\tsidebar=${item.sidebar}${theme}\n`);
  }
}

function setSystemMode(mode) {
  if (mode !== "light" && mode !== "dark") {
    process.stderr.write("system mode must be 'light' or 'dark'\n");
    process.exit(1);
  }

  if (process.platform !== "darwin") {
    process.stderr.write("system mode switching is only supported on macOS\n");
    process.exit(1);
  }

  const enabled = mode === "dark" ? "true" : "false";
  execFileSync("osascript", [
    "-e",
    `tell application "System Events" to tell appearance preferences to set dark mode to ${enabled}`,
  ], { stdio: "inherit" });
}

function parseOptions(values) {
  const stringOptions = ["mode", "sidebar", "sources", "source", "input", "output", "crop", "top", "right", "bottom", "left"];
  const parsed = parseArgs({
    args: values,
    strict: false,
    options: {
      json: { type: "boolean" },
      all: { type: "boolean" },
      ...Object.fromEntries(stringOptions.map((name) => [name, { type: "string" }])),
    },
  });
  return new Map(Object.entries(parsed.values));
}

function parseModes(value) {
  if (value === "light") return ["light"];
  if (value === "dark") return ["dark"];
  if (value === "both") return ["light", "dark"];
  process.stderr.write("--mode must be light, dark, or both\n");
  process.exit(1);
}

function parseSidebarStates(value) {
  if (value === "expanded") return ["expanded"];
  if (value === "collapsed") return ["collapsed"];
  if (value === "both") return ["expanded", "collapsed"];
  process.stderr.write("--sidebar must be expanded, collapsed, or both\n");
  process.exit(1);
}

function parseSources(value) {
  if (!value || value === true) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => sourceAliases.get(item) ?? item);
}

function requireSources(value) {
  const sources = parseSources(value);
  if (sources.length === 0) {
    process.stderr.write("routes requires --sources <comma-list> unless --all is set\n");
    process.exit(1);
  }
  return sources;
}

function slugifyPath(path) {
  return path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}

function cropDirectory(options) {
  const input = options.get("input");
  const output = options.get("output");
  const crop = Number(options.get("crop") ?? 0);
  const top = Number(options.get("top") ?? crop);
  const right = Number(options.get("right") ?? crop);
  const bottom = Number(options.get("bottom") ?? crop);
  const left = Number(options.get("left") ?? crop);

  if (!input || !output) {
    process.stderr.write("crop requires --input <dir> and --output <dir>\n");
    process.exit(1);
  }

  if (![crop, top, right, bottom, left].every((value) => Number.isInteger(value) && value >= 0)) {
    process.stderr.write("crop values must be non-negative integers\n");
    process.exit(1);
  }

  const files = listImages(input);
  if (files.length === 0) {
    process.stderr.write(`No PNG/JPEG images found in ${input}\n`);
    process.exit(1);
  }

  for (const file of files) {
    const rel = relative(input, file);
    const dest = join(output, rel);
    mkdirSync(dirname(dest), { recursive: true });

    const { width, height } = imageSize(file);
    const nextWidth = width - left - right;
    const nextHeight = height - top - bottom;
    if (nextWidth <= 0 || nextHeight <= 0) {
      throw new Error(`Crop is too large for ${file}`);
    }

    if (hasCommand("magick")) {
      execFileSync("magick", [file, "-crop", `${nextWidth}x${nextHeight}+${left}+${top}`, "+repage", dest], {
        stdio: "ignore",
      });
    } else {
      // Fallback for machines without ImageMagick. sips crops from center,
      // so side-specific crop values are approximated by final dimensions.
      execFileSync("sips", ["-c", String(nextHeight), String(nextWidth), file, "--out", dest], {
        stdio: "ignore",
      });
    }
    process.stdout.write(`${rel} -> ${dest}\n`);
  }
}

function hasCommand(name) {
  try {
    execFileSync("sh", ["-lc", `command -v ${name}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function listImages(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      result.push(...listImages(path));
      continue;
    }
    const ext = extname(path).toLowerCase();
    if ([".png", ".jpg", ".jpeg"].includes(ext)) result.push(path);
  }
  return result;
}

function imageSize(file) {
  const output = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], {
    encoding: "utf8",
  });
  const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Unable to read image size for ${file}`);
  return { width, height };
}
