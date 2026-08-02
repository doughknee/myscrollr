/**
 * Direct-download URL resolution for the Scrollr desktop app.
 *
 * Tauri-built asset filenames embed the version number, so a static URL
 * cannot be hardcoded into source. The version comes from
 * `latestVersion.generated.ts`, written at build time by
 * `scripts/fetch-latest-version.mjs` (which queries the GitHub API
 * server-side, where there is no CORS or rate-limit issue).
 *
 * Why not fetch at runtime: the Tauri auto-updater manifest at
 * `releases/latest/download/latest.json` redirects through GitHub to
 * an Azure Blob URL that does NOT return any Access-Control-Allow-Origin
 * header. The browser blocks JavaScript from reading the response,
 * so a runtime fetch always rejects with a CORS error and the click
 * fell through to the releases-page fallback. Build-time resolution
 * is the simplest correct path.
 *
 * Browser navigation (`window.location.href = url`) is not subject to
 * CORS — the browser follows the redirect chain, downloads the
 * binary, and the user gets a save dialog. This is what we want.
 *
 * Trade-off: the marketing site needs to rebuild after each desktop
 * release for the latest version to be served. The deploy workflow
 * rebuilds on every push to main, so this happens within ~5 minutes
 * of any commit (including the desktop version-bump commits themselves
 * which touch tracked files). During the brief gap, downloads point
 * at the still-existing previous release, which keeps working
 * because we don't unlist old releases.
 */

import {
  DESKTOP_ASSET_SIZES,
  LATEST_DESKTOP_VERSION,
} from './latestVersion.generated'

const REPO_URL = 'https://github.com/brandon-relentnet/myscrollr'
export const FALLBACK_RELEASES_URL = `${REPO_URL}/releases/latest`

export type DesktopPlatform = 'macos' | 'windows' | 'linux'
export type LinuxFormat = 'appimage' | 'deb' | 'rpm'

const MACOS_ASSET = (v: string) => `Scrollr_${v}_aarch64.dmg`
const WINDOWS_ASSET = (v: string) => `Scrollr_${v}_x64-setup.exe`
const LINUX_ASSET: Record<LinuxFormat, (version: string) => string> = {
  appimage: (v) => `Scrollr_${v}_amd64.AppImage`,
  deb: (v) => `Scrollr_${v}_amd64.deb`,
  rpm: (v) => `Scrollr-${v}-1.x86_64.rpm`,
}

const LINUX_DEFAULT: LinuxFormat = 'appimage'

export interface DownloadInfo {
  /** Version string, e.g. `"1.0.3"`. */
  version: string
  /** Asset filename, e.g. `"Scrollr_1.0.3_aarch64.dmg"`. */
  filename: string
  /** Direct download URL. */
  url: string
  /** Human asset size, e.g. `"6.7 MB"`. Undefined when the build
   *  resolved the version without the GitHub API (env/fallback). */
  size?: string
}

/** Format a release asset's size from the build-time snapshot. */
export function assetSize(filename: string): string | undefined {
  const bytes = DESKTOP_ASSET_SIZES[filename]
  if (!bytes) return undefined
  const mb = bytes / 1_048_576
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`
}

/**
 * Resolve the direct download URL for the given platform. Synchronous
 * because the version is baked in at build time.
 */
export function getDownloadInfo(
  platform: DesktopPlatform,
  linuxFormat: LinuxFormat = LINUX_DEFAULT,
): DownloadInfo {
  const version = LATEST_DESKTOP_VERSION
  let filename: string
  switch (platform) {
    case 'macos':
      filename = MACOS_ASSET(version)
      break
    case 'windows':
      filename = WINDOWS_ASSET(version)
      break
    case 'linux':
      filename = LINUX_ASSET[linuxFormat](version)
      break
  }
  return {
    version,
    filename,
    url: `${REPO_URL}/releases/download/desktop-v${version}/${filename}`,
    size: assetSize(filename),
  }
}

/**
 * Trigger a download for the given platform. Synchronous - the click
 * handler immediately navigates the browser to the asset URL, which
 * starts the download. Browsers require the navigation to happen
 * inside the user-gesture handler, so this MUST be invoked directly
 * from a click event listener.
 */
export function triggerDownload(
  platform: DesktopPlatform,
  linuxFormat: LinuxFormat = LINUX_DEFAULT,
): DownloadInfo {
  const info = getDownloadInfo(platform, linuxFormat)
  // `window.location.href = url` triggers a same-tab navigation that
  // the browser recognizes as a download because the URL serves
  // content with `Content-Disposition: attachment`. Using location
  // assignment (rather than `window.open`) avoids a flash of a new
  // tab the user has to close.
  window.location.href = info.url
  return info
}
