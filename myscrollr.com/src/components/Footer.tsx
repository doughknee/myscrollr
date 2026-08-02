import { Link } from '@tanstack/react-router'
import { LATEST_DESKTOP_VERSION } from '@/lib/latestVersion.generated'

/**
 * Terminal-editorial footer (design_handoff_marketing_site/README.md):
 * wordmark left, mono uppercase link rows, `ZERO ADS · ZERO TELEMETRY`
 * right. Keeps the full sitemap (status/architecture/releases/legal
 * docs) that the mockup's minimal footer omitted — existing site wins
 * on navigation/SEO.
 */

const PRIMARY_LINKS: Array<{ label: string; to?: string; href?: string }> = [
  { label: 'DOWNLOAD', to: '/download' },
  { label: 'WIDGETS', to: '/widgets' },
  { label: 'UPLINK', to: '/uplink' },
  { label: 'BUSINESS', to: '/business' },
  { label: 'SUPPORT', to: '/support' },
  { label: 'LEGAL', to: '/legal' },
  { label: 'DISCORD', href: 'https://discord.gg/85b49TcGJa' },
]

const SECONDARY_LINKS: Array<{ label: string; to?: string; href?: string }> = [
  { label: 'STATUS', to: '/status' },
  { label: 'ARCHITECTURE', to: '/architecture' },
  { label: 'RELEASES', to: '/releases' },
  { label: 'TERMS', to: '/legal?doc=terms' },
  { label: 'PRIVACY', to: '/legal?doc=privacy' },
  { label: 'LICENSE', to: '/legal?doc=license' },
  { label: 'GITHUB', href: 'https://github.com/brandon-relentnet/myscrollr' },
]

function FooterLink({
  label,
  to,
  href,
  className,
}: {
  label: string
  to?: string
  href?: string
  className: string
}) {
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {label}
      </a>
    )
  }
  return (
    <Link to={to} className={className}>
      {label}
    </Link>
  )
}

export default function Footer() {
  const year = new Date().getFullYear()
  const linkClass =
    'text-base-content/40 transition-colors hover:text-primary hover:opacity-100'

  return (
    <footer className="border-t border-hairline bg-base-75">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-5 px-5 pb-4 pt-7 sm:px-8">
        <Link
          to="/"
          className="flex items-baseline text-base font-extrabold tracking-[-0.02em] text-base-content hover:text-base-content hover:opacity-100"
        >
          scrollr
          <span className="text-primary">.</span>
        </Link>

        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] tracking-[0.1em]"
        >
          {PRIMARY_LINKS.map((l) => (
            <FooterLink key={l.label} {...l} className={linkClass} />
          ))}
        </nav>

        <div className="font-mono text-[11px] tracking-[0.1em] text-base-content/30">
          ZERO ADS · ZERO TELEMETRY
        </div>
      </div>

      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 border-t border-hairline-minor px-5 py-4 sm:px-8">
        <div className="font-mono text-[10px] tracking-[0.1em] text-base-content/30">
          © {year} SCROLLR · OPEN SOURCE · V{LATEST_DESKTOP_VERSION}
        </div>
        <nav
          aria-label="Secondary"
          className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] tracking-[0.1em]"
        >
          {SECONDARY_LINKS.map((l) => (
            <FooterLink
              key={l.label}
              {...l}
              className="text-base-content/30 transition-colors hover:text-primary hover:opacity-100"
            />
          ))}
        </nav>
      </div>
    </footer>
  )
}
