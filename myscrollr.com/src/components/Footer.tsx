import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { ArrowUpRight, Github, Mail } from 'lucide-react'
import ScrollrSVG from '@/components/ScrollrSVG'

declare const __APP_VERSION__: string

const isExternalHref = (href: string) =>
  href.startsWith('http') ||
  href.startsWith('mailto:') ||
  href.startsWith('tel:')

export default function Footer() {
  const year = new Date().getFullYear()

  const links = {
    product: [
      { label: 'Channels', href: '/channels' },
      { label: 'Download', href: '/download' },
      { label: 'Uplink', href: '/uplink' },
    ],
    resources: [
      { label: 'Status', href: '/status' },
      { label: 'Architecture', href: '/architecture' },
      { label: 'Channels', href: '/channels' },
    ],
    company: [
      { label: 'Terms', href: '/legal?doc=terms' },
      { label: 'Privacy', href: '/legal?doc=privacy' },
      { label: 'Legal', href: '/legal' },
      { label: 'License', href: '/legal?doc=license' },
      { label: 'Support', href: '/support' },
    ],
    social: [
      {
        icon: Github,
        href: 'https://github.com/brandon-relentnet/myscrollr',
        label: 'GitHub',
      },
      {
        icon: Mail,
        href: '/support',
        label: 'Contact support',
      },
    ],
  }

  return (
    <footer className="relative bg-base-200/30 border-t border-base-300/50 overflow-hidden">
      {/* Background Grid */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(var(--grid-dot-primary) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-dot-primary) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Accent Glow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      <div className="container relative z-10 px-5 py-16 lg:py-20">
        {/* Main Footer Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 mb-16">
          {/* Brand Column */}
          <div className="lg:col-span-4 space-y-6">
            <div className="flex items-center gap-4">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="relative flex items-center justify-center rounded-lg border border-base-300/50 bg-base-200/50 p-2.5"
              >
                <ScrollrSVG className="size-10" />
                <span className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
              </motion.div>
              <div className="flex flex-col">
                <span className="font-bold text-2xl tracking-tight font-display">
                  Scrollr
                </span>
                <span className="text-[10px] text-primary/40">
                  v{__APP_VERSION__}
                </span>
              </div>
            </div>

            <p className="text-sm text-base-content/60 leading-relaxed max-w-sm pb-2">
              Live scores, prices, and headlines on your desktop. The ticker
              that's always there when you need it.
            </p>

            {/* Status Indicators */}
            <div className="flex flex-wrap gap-2">
              <StatusBadge status="online" />
              <StatusBadge status="live" />
            </div>
          </div>

          {/* Links Columns */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-8 lg:gap-12">
            {/* Product */}
            <div className="space-y-5">
              <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-primary/80">
                Product
              </h4>
              <ul className="space-y-3">
                {links.product.map((link) => (
                  <li key={link.label}>
                    {isExternalHref(link.href) ? (
                      <motion.a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        whileHover={{ x: 2 }}
                        className="flex items-center gap-2 text-sm text-base-content/50 hover:text-primary transition-colors group cursor-pointer"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </motion.a>
                    ) : (
                      <Link
                        to={link.href}
                        className="flex items-center gap-2 text-sm text-base-content/50 hover:text-primary transition-colors group"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Resources */}
            <div className="space-y-5">
              <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-primary/80">
                Resources
              </h4>
              <ul className="space-y-3">
                {links.resources.map((link) => (
                  <li key={link.label}>
                    {isExternalHref(link.href) ? (
                      <motion.a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        whileHover={{ x: 2 }}
                        className="flex items-center gap-2 text-sm text-base-content/50 hover:text-primary transition-colors group cursor-pointer"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </motion.a>
                    ) : (
                      <Link
                        to={link.href}
                        className="flex items-center gap-2 text-sm text-base-content/50 hover:text-primary transition-colors group"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div className="space-y-5">
              <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-primary/80">
                Company
              </h4>
              <ul className="space-y-3">
                {links.company.map((link) => (
                  <li key={link.label}>
                    {isExternalHref(link.href) ? (
                      <motion.a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        whileHover={{ x: 2 }}
                        className="flex items-center gap-2 text-sm text-base-content/50 hover:text-primary transition-colors group cursor-pointer"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </motion.a>
                    ) : (
                      <Link
                        to={link.href}
                        className="flex items-center gap-2 text-sm text-base-content/50 hover:text-primary transition-colors group"
                      >
                        {link.label}
                        <ArrowUpRight
                          size={12}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6 pt-8 border-t border-base-300/30">
          {/* Copyright */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-base-content/40">
              © {year} Scrollr
            </span>
            <span className="hidden sm:inline text-xs text-base-content/20">
              ·
            </span>
            <span className="flex items-center gap-2 text-xs text-base-content/40">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              Open Source
            </span>
          </div>

          {/* Social Links */}
          <div className="flex items-center gap-4">
            {links.social.map((social) => {
              const external = isExternalHref(social.href)
              const className =
                'flex items-center justify-center w-10 h-10 rounded-lg bg-base-200/50 border border-base-300/30 text-base-content/40 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-pointer'
              const hover = {
                scale: 1.1,
                y: -2,
                transition: { type: 'tween' as const, duration: 0.2 },
              }
              const Icon = social.icon

              if (external) {
                return (
                  <motion.a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    whileHover={hover}
                    whileTap={{ scale: 0.95 }}
                    className={className}
                    aria-label={social.label}
                  >
                    <Icon size={16} />
                  </motion.a>
                )
              }

              return (
                <Link
                  key={social.label}
                  to={social.href}
                  className={className}
                  aria-label={social.label}
                >
                  <Icon size={16} />
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </footer>
  )
}

function StatusBadge({ status }: { status: 'online' | 'live' }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/5 border border-primary/10">
      <span className="relative flex h-1.5 w-1.5">
        {status === 'live' && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
        )}
        <span
          className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
            status === 'online' ? 'bg-success' : 'bg-primary'
          }`}
        />
      </span>
      <span className="text-[10px] text-base-content/50">
        {status === 'online' ? 'Online' : 'Live Data'}
      </span>
    </div>
  )
}
