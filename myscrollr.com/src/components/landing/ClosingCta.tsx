/**
 * Landing CTA — departures-board download rows, one per platform, with
 * the YOURS tag on the visitor's detected OS.
 */

import { useEffect, useState } from 'react'
import type { DesktopPlatform } from '@/lib/getDownloadInfo'
import { getDownloadInfo } from '@/lib/getDownloadInfo'
import { DeparturesRow, TerminalContainer } from '@/components/terminal'
import { detectPlatform } from '@/lib/detectPlatform'

const PLATFORMS: ReadonlyArray<{
  index: string
  label: string
  os: 'mac' | 'windows' | 'linux'
  platform: DesktopPlatform
  meta: string
}> = [
  // prettier-ignore
  { index: '01', label: 'macOS', os: 'mac', platform: 'macos', meta: ['.DMG', getDownloadInfo('macos').size, 'APPLE SILICON'].filter(Boolean).join(' · ') },
  // prettier-ignore
  { index: '02', label: 'Windows', os: 'windows', platform: 'windows', meta: ['SETUP .EXE', getDownloadInfo('windows').size, 'X64'].filter(Boolean).join(' · ') },
  // prettier-ignore
  { index: '03', label: 'Linux', os: 'linux', platform: 'linux', meta: '.APPIMAGE / .DEB / .RPM · X86_64' },
]

export function ClosingCta() {
  // Resolved in an effect for hydration safety; mobile visitors get no
  // YOURS tag (they can't install any of the three).
  const [detected, setDetected] = useState<DesktopPlatform | null>(null)
  useEffect(() => {
    const info = detectPlatform()
    if (!info.isMobile) setDetected(info.platform)
  }, [])

  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <div className="pb-7 pt-[72px]">
          <h2 className="type-display m-0 text-[clamp(44px,6vw,84px)]">
            Put it on
            <br />
            <span className="type-outline">your desktop.</span>
          </h2>
          <p className="m-0 mt-[18px] font-mono text-base-content/60">
            three slots free, forever · nothing between you and the download
          </p>
        </div>
        <div className="pb-[72px]">
          {PLATFORMS.map((p) => (
            <DeparturesRow
              key={p.os}
              index={p.index}
              label={p.label}
              tag={detected === p.platform ? 'YOURS' : undefined}
              meta={
                <span className="font-mono text-xs tracking-[0.06em] text-base-content/40">
                  {p.meta}
                </span>
              }
              action="DOWNLOAD ↓"
              to={`/download/${p.os}`}
            />
          ))}
        </div>
      </TerminalContainer>
    </section>
  )
}
