import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_RELEASES_URL, getDownloadInfo } from './getDownloadInfo'

// latestVersion.generated.ts is written at build time by
// scripts/fetch-latest-version.mjs and is gitignored — mock it so tests
// run without a build step (and without hitting the GitHub API).
// vi.mock is hoisted above the imports by Vitest, so order is safe.
vi.mock('./latestVersion.generated', () => ({
  LATEST_DESKTOP_VERSION: '1.2.3',
}))

const RELEASE_BASE =
  'https://github.com/brandon-relentnet/myscrollr/releases/download/desktop-v1.2.3'

describe('getDownloadInfo', () => {
  it('resolves the macOS DMG (Apple Silicon naming)', () => {
    expect(getDownloadInfo('macos')).toEqual({
      version: '1.2.3',
      filename: 'Scrollr_1.2.3_aarch64.dmg',
      url: `${RELEASE_BASE}/Scrollr_1.2.3_aarch64.dmg`,
    })
  })

  it('resolves the Windows setup exe', () => {
    expect(getDownloadInfo('windows')).toEqual({
      version: '1.2.3',
      filename: 'Scrollr_1.2.3_x64-setup.exe',
      url: `${RELEASE_BASE}/Scrollr_1.2.3_x64-setup.exe`,
    })
  })

  it('defaults Linux to AppImage', () => {
    expect(getDownloadInfo('linux').filename).toBe(
      'Scrollr_1.2.3_amd64.AppImage',
    )
  })

  it.each([
    ['appimage', 'Scrollr_1.2.3_amd64.AppImage'],
    ['deb', 'Scrollr_1.2.3_amd64.deb'],
    // RPM uses dashes and a release suffix — Tauri's rpm naming, not a typo.
    ['rpm', 'Scrollr-1.2.3-1.x86_64.rpm'],
  ] as const)('resolves the Linux %s asset name', (format, filename) => {
    const info = getDownloadInfo('linux', format)
    expect(info.filename).toBe(filename)
    expect(info.url).toBe(`${RELEASE_BASE}/${filename}`)
  })

  it('pins the release tag format to desktop-v<version>', () => {
    // The desktop-release workflow publishes tags as desktop-v*; if either
    // side changes its tag scheme, every download link 404s.
    expect(getDownloadInfo('macos').url).toContain(
      '/releases/download/desktop-v1.2.3/',
    )
  })

  it('keeps the releases-page fallback pointed at the repo', () => {
    expect(FALLBACK_RELEASES_URL).toBe(
      'https://github.com/brandon-relentnet/myscrollr/releases/latest',
    )
  })
})
