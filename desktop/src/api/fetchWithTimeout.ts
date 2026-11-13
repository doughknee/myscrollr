/**
 * One deadline for a whole request: headers AND body (RC-7).
 *
 * Shared by `api/client.ts` and the token calls in `auth.ts` (which
 * `client.ts` imports, hence its own module). Uses `@tauri-apps/plugin-http`,
 * which has no timeout of its own.
 */
import { fetch } from "@tauri-apps/plugin-http";

/** Default hard timeout for all outbound requests (ms). */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fetch `url` and run `read` on the response, all under one
 * AbortController-driven timeout. Prevents a hung request (slow backend,
 * dropped connection, a proxy that sends headers and then nothing) from
 * stalling the UI indefinitely: aborting after the headers arrived errors
 * the body stream, so `read` rejects too. Callers may still pass their own
 * `signal`; if both are set, whichever fires first wins.
 */
export async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit,
  read: (response: Response) => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Honor any caller-provided signal by aborting the controller when it fires.
  const callerSignal = options.signal ?? undefined;
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    return await read(await fetch(url, { ...options, signal: controller.signal }));
  } finally {
    clearTimeout(timeoutId);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}
