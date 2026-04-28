/**
 * Direct-download URL resolution for the Scrollr desktop app.
 *
 * Tauri-built asset filenames embed the version number, so a static URL
 * cannot be hardcoded. The Tauri auto-updater manifest at
 * `releases/latest/download/latest.json` has a STABLE filename that
 * GitHub redirects to the latest release, and the JSON contains the
 * current version string. We use that to construct a per-platform
 * download URL on demand.
 *
 * The fetch is memoized at module scope so multiple Download buttons
 * on the same page share a single network request. The Promise is
 * cached forever within the page lifetime; if the user keeps the tab
 * open across a release boundary they may briefly download the
 * previous version, which is acceptable.
 *
 * Errors fall through to the caller, which can fall back to opening
 * the GitHub releases page in a new tab.
 */

const REPO_URL = 'https://github.com/brandon-relentnet/myscrollr'
const LATEST_JSON_URL = `${REPO_URL}/releases/latest/download/latest.json`
export const FALLBACK_RELEASES_URL = `${REPO_URL}/releases/latest`

export type DesktopPlatform = 'macos' | 'windows' | 'linux'
export type LinuxFormat = 'appimage' | 'deb' | 'rpm'

/**
 * Platform-specific asset filename patterns. The version placeholder is
 * filled with the value returned by `latest.json`.
 *
 * macOS ships only an Apple Silicon (aarch64) build today. Intel Mac
 * users get the same DMG with an in-page warning that it will not run.
 * Adding an x86_64 macOS target later means adding a second entry here
 * + extending the platform discriminator.
 */
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
}

interface LatestManifest {
  version: string
}

let cachedFetch: Promise<LatestManifest> | null = null

function fetchLatestManifest(signal?: AbortSignal): Promise<LatestManifest> {
  if (cachedFetch) return cachedFetch
  cachedFetch = fetch(LATEST_JSON_URL, { signal })
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(
          `latest.json fetch failed: ${res.status} ${res.statusText}`,
        )
      }
      const data = (await res.json()) as Partial<LatestManifest>
      if (typeof data.version !== 'string' || data.version.length === 0) {
        throw new Error('latest.json missing version field')
      }
      return { version: data.version }
    })
    .catch((err) => {
      // Reset the cache on failure so a retry attempt can re-fetch
      // rather than serving the cached rejection forever.
      cachedFetch = null
      throw err
    })
  return cachedFetch
}

/**
 * Resolve the direct download URL for the given platform.
 *
 * @param platform   `'macos' | 'windows' | 'linux'`
 * @param linuxFormat For Linux only: `'appimage' | 'deb' | 'rpm'`. Ignored
 *                    for other platforms. Defaults to `'appimage'`.
 * @param signal     Optional AbortSignal for caller-side cancellation.
 *
 * @throws when the manifest fetch fails, the response is malformed, or
 *         the AbortSignal fires.
 */
export async function getDownloadInfo(
  platform: DesktopPlatform,
  linuxFormat: LinuxFormat = LINUX_DEFAULT,
  signal?: AbortSignal,
): Promise<DownloadInfo> {
  const manifest = await fetchLatestManifest(signal)
  let filename: string
  switch (platform) {
    case 'macos':
      filename = MACOS_ASSET(manifest.version)
      break
    case 'windows':
      filename = WINDOWS_ASSET(manifest.version)
      break
    case 'linux':
      filename = LINUX_ASSET[linuxFormat](manifest.version)
      break
  }
  return {
    version: manifest.version,
    filename,
    url: `${REPO_URL}/releases/download/desktop-v${manifest.version}/${filename}`,
  }
}

/**
 * Trigger a download for the given platform. Resolves once the
 * navigation has been initiated; rejects if the manifest fetch fails
 * (caller should fall back to opening the releases page).
 *
 * Implements a 3 second timeout per session policy: if the manifest
 * fetch hasn't completed in that window, we abort and let the caller
 * use the fallback URL instead. Browsers require the navigation to
 * happen synchronously inside the user-gesture handler, so the caller
 * is responsible for ensuring this function is invoked inside a click
 * event listener.
 */
export const DOWNLOAD_TIMEOUT_MS = 3000

export async function triggerDownload(
  platform: DesktopPlatform,
  linuxFormat: LinuxFormat = LINUX_DEFAULT,
): Promise<DownloadInfo> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const info = await getDownloadInfo(platform, linuxFormat, controller.signal)
    // `window.location.href = url` triggers a same-tab navigation that
    // the browser recognizes as a download because the URL serves a
    // binary content-disposition. We avoid `window.open` so the user
    // doesn't see a flash of a new tab they have to close.
    window.location.href = info.url
    return info
  } finally {
    clearTimeout(timer)
  }
}
