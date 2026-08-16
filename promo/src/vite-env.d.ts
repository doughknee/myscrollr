/**
 * The desktop app is a Vite project and uses `import.meta.env` and
 * `import.meta.glob`. Importing its components here drags those into the
 * typecheck, and this project is bundled by Remotion's webpack, which has
 * no Vite types.
 *
 * Declaring them is enough for tsc. Whether webpack can EXECUTE
 * `import.meta.glob` is a separate question, and the answer is no — see
 * remotion.config.ts for how that module is handled.
 */
interface ImportMeta {
  env: Record<string, string | boolean | undefined>;
  glob: (pattern: string, opts?: unknown) => Record<string, unknown>;
}
