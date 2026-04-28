/**
 * Browser-side platform detection for the Download CTA.
 *
 * `navigator.userAgent` is unreliable but ubiquitous; `userAgentData`
 * is reliable but only available in Chromium. We try `userAgentData`
 * first, fall back to the UA string, and degrade to "linux" when both
 * fail to give us a confident answer.
 *
 * The shape we return is rich enough to drive the Download CTA's UX
 * decisions in one go: which platform to default to, whether to warn
 * about Intel Mac, whether the visitor is on mobile.
 */

import type { DesktopPlatform } from './getDownloadInfo'

export interface PlatformInfo {
  /** Best-effort desktop platform. Used for the primary download URL. */
  platform: DesktopPlatform
  /** True when we believe the visitor is on a mobile device (iOS, Android, etc.). */
  isMobile: boolean
  /** True when we have evidence the visitor is on an Intel-based Mac. */
  isIntelMac: boolean
  /** Human-readable label for the detected platform. */
  label: string
  /** Architecture / format hint shown next to the label. */
  archLabel: string
}

/** Type guard for the experimental `navigator.userAgentData` API. */
interface UADataPlatform {
  platform: string
  mobile: boolean
}

interface NavigatorWithUAData extends Navigator {
  userAgentData?: UADataPlatform
}

const MOBILE_UA_PATTERN =
  /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i

/** SSR-safe entrypoint. Returns Linux defaults during server-render so the
 *  hydration mismatch is invisible (the page only uses these values
 *  inside event handlers and effects, not in initial render). */
export function detectPlatform(): PlatformInfo {
  if (typeof navigator === 'undefined') {
    return {
      platform: 'linux',
      isMobile: false,
      isIntelMac: false,
      label: 'Linux',
      archLabel: 'x64',
    }
  }

  const nav = navigator as NavigatorWithUAData
  const ua = nav.userAgent.toLowerCase()
  const uaData = nav.userAgentData

  // Mobile is checked across both APIs because iOS Safari does not
  // expose `userAgentData` and Android Chrome historically lied in
  // its UA string.
  const isMobile = !!uaData?.mobile || MOBILE_UA_PATTERN.test(ua)

  // userAgentData.platform values: "macOS", "Windows", "Linux", "Android",
  // "Chrome OS", or "Unknown". We map the desktop ones; mobile platforms
  // fall through to the UA-string check.
  let platform: DesktopPlatform = 'linux'
  if (uaData?.platform) {
    const p = uaData.platform.toLowerCase()
    if (p.includes('mac')) platform = 'macos'
    else if (p.includes('win')) platform = 'windows'
    else if (p.includes('linux')) platform = 'linux'
    else if (ua.includes('mac')) platform = 'macos'
    else if (ua.includes('win')) platform = 'windows'
  } else {
    if (ua.includes('mac')) platform = 'macos'
    else if (ua.includes('win')) platform = 'windows'
  }

  // Intel Mac heuristic: macOS UA strings on Apple Silicon return
  // "Intel Mac OS X" because Safari masquerades the architecture for
  // backward compat. The truly reliable signal is `userAgentData.platform
  // === "macOS"` plus a follow-up call to `getHighEntropyValues(['architecture'])`,
  // but that's async. As a synchronous best-effort we flag "Intel Mac"
  // only when we are highly confident (UA explicitly says "Intel Mac"
  // AND the visitor is NOT on Apple Silicon-class hardware indicators).
  // Practically, the warning is visible to ALL Mac users, since modern
  // Apple Silicon Macs also self-report as "Intel Mac OS X" in the UA.
  // We instead show the warning only when the user clicks Download and
  // we can confirm Intel via the async path. See `detectIsIntelMac()`.
  const isIntelMac = false // resolved async via detectIsIntelMac() at click-time

  let label = 'Linux'
  let archLabel = 'x64'
  if (platform === 'macos') {
    label = 'macOS'
    archLabel = 'Apple Silicon'
  } else if (platform === 'windows') {
    label = 'Windows'
    archLabel = 'x64'
  }

  return {
    platform,
    isMobile,
    isIntelMac,
    label,
    archLabel,
  }
}

/**
 * Resolve the architecture asynchronously when supported. Returns
 * `'x86'` for Intel Macs, `'arm'` for Apple Silicon, `null` when the
 * API is not available (older browsers, all of Firefox, all of Safari).
 *
 * In the absence of a reliable answer, callers should NOT block the
 * download. The warning is purely informational; users with Intel
 * Macs who proceed will get a working DMG that the OS refuses to run,
 * which is a graceful failure mode they can recover from.
 */
export async function detectIsIntelMac(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false
  const uaData = (navigator as NavigatorWithUAData).userAgentData as
    | (UADataPlatform & {
        getHighEntropyValues?: (
          keys: Array<string>,
        ) => Promise<Record<string, string>>
      })
    | undefined

  if (!uaData?.platform || !uaData.getHighEntropyValues) return false
  if (!uaData.platform.toLowerCase().includes('mac')) return false

  try {
    const values = await uaData.getHighEntropyValues(['architecture'])
    return values.architecture === 'x86'
  } catch {
    return false
  }
}
