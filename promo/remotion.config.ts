import path from "node:path";
import { NormalModuleReplacementPlugin } from "webpack";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

/**
 * The point of this project: promo video is rendered from the REAL
 * chip components, not recreations. Two things have to be true for that
 * to work, and both are configured here.
 *
 * 1. Tailwind, because the chips are styled entirely in it and would
 *    otherwise render as unstyled text.
 * 2. An alias for @tauri-apps/plugin-store, because the chips' import
 *    chain reaches it (chips -> preferences -> lib/store) even though
 *    no render path calls it. See stubs/tauri-store.ts.
 * 3. Replacements for the two registry modules that build themselves
 *    with Vite's `import.meta.glob`. Webpack cannot execute that — the
 *    bundle dies on load with "{}.glob is not a function" before a frame
 *    renders. See stubs/.
 *
 *    These use NormalModuleReplacementPlugin rather than resolve.alias,
 *    and that is not a style choice: webpack aliases DO NOT APPLY TO
 *    RELATIVE REQUESTS, and both modules are imported relatively from
 *    inside desktop/src. Four increasingly specific alias attempts
 *    failed silently before that turned up.
 */
Config.overrideWebpackConfig((currentConfig) => {
  const withTailwind = enableTailwind(currentConfig);

  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      alias: {
        ...withTailwind.resolve?.alias,
        "@tauri-apps/plugin-store": path.resolve(
          process.cwd(),
          "stubs/tauri-store.ts",
        ),
      },
    },
    plugins: [
      ...(withTailwind.plugins ?? []),
      new NormalModuleReplacementPlugin(
        /datawidgets[\/]registry$/,
        path.resolve(process.cwd(), "stubs/datawidget-registry.ts"),
      ),
      new NormalModuleReplacementPlugin(
        /widgets[\/]registry$/,
        path.resolve(process.cwd(), "stubs/widget-registry.ts"),
      ),
    ],
  };
});

// 2560x1440 60p per the storyboard. Set on the compositions rather than
// here so a vertical cut can differ without touching global config.
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
