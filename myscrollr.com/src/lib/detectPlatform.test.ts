import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectIsIntelMac, detectPlatform } from './detectPlatform'

// Helpers to fake the two browser APIs detectPlatform consults. Node 21+
// ships a global `navigator`, so every test stubs it explicitly rather
// than relying on the bare node environment.
function stubNavigator(value: unknown) {
  vi.stubGlobal('navigator', value)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectPlatform', () => {
  it('returns Linux defaults when navigator is undefined (SSR)', () => {
    stubNavigator(undefined)
    expect(detectPlatform()).toEqual({
      platform: 'linux',
      isMobile: false,
      isIntelMac: false,
      label: 'Linux',
      archLabel: 'x64',
    })
  })

  describe('via userAgentData (Chromium)', () => {
    it.each([
      ['macOS', 'macos', 'macOS', 'Apple Silicon'],
      ['Windows', 'windows', 'Windows', 'x64'],
      ['Linux', 'linux', 'Linux', 'x64'],
    ])(
      'maps uaData platform %s to %s',
      (uaPlatform, expected, label, archLabel) => {
        stubNavigator({
          userAgent: 'Mozilla/5.0',
          userAgentData: { platform: uaPlatform, mobile: false },
        })
        const info = detectPlatform()
        expect(info.platform).toBe(expected)
        expect(info.label).toBe(label)
        expect(info.archLabel).toBe(archLabel)
        expect(info.isMobile).toBe(false)
      },
    )

    it('flags mobile from uaData.mobile even with a desktop UA string', () => {
      stubNavigator({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        userAgentData: { platform: 'Android', mobile: true },
      })
      expect(detectPlatform().isMobile).toBe(true)
    })

    it('falls back to the UA string when uaData.platform is unrecognized', () => {
      stubNavigator({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        userAgentData: { platform: 'Unknown', mobile: false },
      })
      expect(detectPlatform().platform).toBe('macos')
    })
  })

  describe('via UA string (Safari, Firefox)', () => {
    it.each([
      [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
        'macos',
      ],
      [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'windows',
      ],
      ['Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101', 'linux'],
    ])('detects platform from %s', (userAgent, expected) => {
      stubNavigator({ userAgent })
      expect(detectPlatform().platform).toBe(expected)
    })

    it('flags iPhone as mobile', () => {
      stubNavigator({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      })
      const info = detectPlatform()
      expect(info.isMobile).toBe(true)
      // iPhone UA contains "mac os x", so platform resolves to macos —
      // the Download CTA uses isMobile to steer mobile visitors away
      // from the direct-download button regardless.
      expect(info.platform).toBe('macos')
    })

    it('flags Android as mobile', () => {
      stubNavigator({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
      })
      const info = detectPlatform()
      expect(info.isMobile).toBe(true)
      expect(info.platform).toBe('linux')
    })
  })

  it('never reports Intel Mac synchronously (resolved async at click-time)', () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    expect(detectPlatform().isIntelMac).toBe(false)
  })
})

describe('detectIsIntelMac', () => {
  it('returns false when navigator is undefined (SSR)', async () => {
    stubNavigator(undefined)
    await expect(detectIsIntelMac()).resolves.toBe(false)
  })

  it('returns false when userAgentData is unavailable (Safari, Firefox)', async () => {
    stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' })
    await expect(detectIsIntelMac()).resolves.toBe(false)
  })

  it('returns false for non-Mac platforms without querying entropy', async () => {
    const getHighEntropyValues = vi.fn()
    stubNavigator({
      userAgent: 'Mozilla/5.0',
      userAgentData: {
        platform: 'Windows',
        mobile: false,
        getHighEntropyValues,
      },
    })
    await expect(detectIsIntelMac()).resolves.toBe(false)
    expect(getHighEntropyValues).not.toHaveBeenCalled()
  })

  it('returns true for a Mac reporting x86 architecture', async () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0',
      userAgentData: {
        platform: 'macOS',
        mobile: false,
        getHighEntropyValues: vi
          .fn()
          .mockResolvedValue({ architecture: 'x86' }),
      },
    })
    await expect(detectIsIntelMac()).resolves.toBe(true)
  })

  it('returns false for a Mac reporting arm architecture (Apple Silicon)', async () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0',
      userAgentData: {
        platform: 'macOS',
        mobile: false,
        getHighEntropyValues: vi
          .fn()
          .mockResolvedValue({ architecture: 'arm' }),
      },
    })
    await expect(detectIsIntelMac()).resolves.toBe(false)
  })

  it('returns false when the entropy query rejects (never blocks the download)', async () => {
    stubNavigator({
      userAgent: 'Mozilla/5.0',
      userAgentData: {
        platform: 'macOS',
        mobile: false,
        getHighEntropyValues: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })
    await expect(detectIsIntelMac()).resolves.toBe(false)
  })
})
