// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps JavaScript and Rust Tauri major/minor versions aligned for release builds", () => {
  const npm = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  const cargo = readFileSync(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
  const rust = new Map([...cargo.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)]
    .map((match) => [match[1], match[2]]));
  for (const name of Object.keys(npm.packages[""].dependencies)) {
    if (name !== "@tauri-apps/api" && !name.startsWith("@tauri-apps/plugin-")) continue;
    const jsVersion = npm.packages[`node_modules/${name}`].version;
    const rustVersion = rust.get(name === "@tauri-apps/api" ? "tauri" : name.replace("@tauri-apps/", "tauri-"));
    expect(rustVersion, `${name} Rust companion missing`).toBeDefined();
    expect(jsVersion.split(".").slice(0, 2).join("."), name)
      .toBe(rustVersion!.split(".").slice(0, 2).join("."));
  }
});
