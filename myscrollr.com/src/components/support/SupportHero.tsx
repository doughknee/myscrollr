import { motion } from 'motion/react'
import { LifeBuoy } from 'lucide-react'
import { ProductScreenshot } from '@/components/ProductScreenshot'

const EASE = [0.22, 1, 0.36, 1] as const

interface QuickLink {
  href: string
  label: string
}

const QUICK_LINKS: Array<QuickLink> = [
  { href: '#getting-started', label: 'Getting Started' },
  { href: '#faq', label: 'FAQ' },
  { href: '#troubleshooting', label: 'Troubleshooting' },
  { href: '#billing', label: 'Account & Billing' },
  { href: '#contact', label: 'Contact' },
]

export function SupportHero() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      {/* Background grid + glow — same vocabulary the rest of the site uses */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `
            linear-gradient(var(--grid-dot-primary) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-dot-primary) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
      <div className="pointer-events-none absolute top-1/2 left-1/2 h-96 w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 text-primary"
        >
          <LifeBuoy size={22} />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.05 }}
          className="text-4xl font-bold tracking-tight text-base-content sm:text-5xl"
        >
          How can we <span className="text-gradient-primary">help</span>?
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.1 }}
          className="mx-auto mt-6 max-w-2xl text-lg text-base-content/60"
        >
          Find answers, troubleshoot issues, or send us a note. Most questions
          are answered below — we usually reply to direct messages within 1-2
          business days.
        </motion.p>

        {/* Quick links — anchor jump targets to the sections below. */}
        <motion.nav
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE, delay: 0.15 }}
          aria-label="Support topics"
          className="mt-10 flex flex-wrap items-center justify-center gap-2"
        >
          {QUICK_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full border border-base-300/50 bg-base-200/40 px-4 py-1.5 text-sm font-medium text-base-content/70 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
            >
              {link.label}
            </a>
          ))}
        </motion.nav>

        {/* In-app Support tab preview — reinforces that the same help
            content shown below exists inside the desktop app, so users
            don't have to context-switch to the website every time. */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.25 }}
          className="relative mx-auto mt-14 max-w-3xl"
        >
          <div
            aria-hidden="true"
            className="absolute -inset-6 rounded-[2rem] bg-primary/5 blur-3xl pointer-events-none"
          />
          <div className="relative overflow-hidden rounded-2xl border border-base-300/40 bg-base-200/40 backdrop-blur-sm shadow-lg">
            <ProductScreenshot
              basename="support/home"
              alt="The Scrollr in-app Support tab, with the same Getting Started, FAQ, Troubleshooting, Billing, and Contact sections shown on this page."
              priority
              pictureClassName="block w-full"
              imgClassName="block h-full w-full object-cover object-top"
            />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
