// ── Updater pub_date normalization ──────────────────────────────
//
// The auto-updater's "same-version suppression" works by comparing the
// remote build's pub_date against a value we cached on a previous run.
// String-equality on the raw values is unreliable because the dates
// flow through two different formatters before we see them:
//
//   1. The server's `latest.json` emits ISO 8601 with a `Z` suffix
//      (e.g. "2026-05-12T19:13:36.586Z") — tauri-action's default.
//   2. Tauri's Rust updater plugin parses that and re-serializes via
//      `time::OffsetDateTime::format(Rfc3339)`, which writes the
//      offset as `+00:00` (e.g. "2026-05-12T19:13:36.586+00:00").
//
// Both are valid RFC 3339, they refer to the same instant, but
// `"...Z" !== "...+00:00"` as strings. Without normalization the
// suppression check always falls through and the user sees an
// "Update available" toast on every launch.
//
// `normalizeUpdateDate` collapses any RFC 3339 / ISO 8601 string into
// the JS canonical form (`Date.prototype.toISOString` — always `Z`,
// always milliseconds). It returns `null` on unparseable input so the
// caller can decide how to handle the missing-pub_date edge case
// (currently: stay silent rather than toast forever).
//
// Keep this in sync with the seed/compare logic in
// `hooks/useStartupUpdateCheck.ts` and `components/settings/GeneralSettings.tsx`.

export function normalizeUpdateDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}
