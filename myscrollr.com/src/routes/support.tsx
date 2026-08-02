import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { seo } from '@/lib/seo'
import { breadcrumbs, faqPage, organization } from '@/lib/structured-data'
import { FAQ_ITEMS } from '@/components/support/support-content'
import { SupportFAQ } from '@/components/support/SupportFAQ'
import { SupportTroubleshooting } from '@/components/support/SupportTroubleshooting'
import { SupportContactForm } from '@/components/support/SupportContactForm'
import {
  PageHeader,
  SectionRow,
  TerminalContainer,
} from '@/components/terminal'
import { EASE } from '@/lib/animations'

export const Route = createFileRoute('/support')({
  head: () =>
    seo({
      title: 'Scrollr Support: FAQs, Troubleshooting, Contact',
      description:
        'Get help with Scrollr. FAQs, troubleshooting articles, billing help, and a direct contact form. Real humans, no chatbots.',
      path: '/support',
      jsonLd: [
        organization,
        faqPage(FAQ_ITEMS),
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Support', path: '/support' },
        ]),
      ],
    }),
  component: SupportPage,
})

const ESCALATION_CHANNELS = [
  {
    tag: 'FASTEST',
    title: 'Discord',
    body: 'The community and the maintainers, usually within the hour. Best for setup questions and quick bugs.',
    href: 'https://discord.gg/85b49TcGJa',
  },
  {
    tag: 'BILLING & ACCOUNTS',
    title: 'Open a ticket',
    body: 'Anything involving payments, receipts, or your account. Tracked properly, answered by a human.',
    href: '#contact',
  },
  {
    tag: 'BUGS & REQUESTS',
    title: 'GitHub issues',
    body: "Found a real bug or want a widget that doesn't exist? File it where the code lives.",
    href: 'https://github.com/brandon-relentnet/myscrollr/issues',
  },
]

function SupportPage() {
  return (
    <main>
      <PageHeader
        eyebrowLeft="SUPPORT ／ HELP DESK"
        eyebrowRight="ANSWERED BY THE PEOPLE WHO WROTE THE CODE"
        line1="STUCK?"
        line2="PROBABLY NOT FOR LONG."
        sub="Most answers are a scroll away. For the rest: Discord for fast eyes, a ticket for anything billing."
        actions={
          <div className="flex flex-wrap gap-3">
            <a
              href="https://discord.gg/85b49TcGJa"
              rel="noopener noreferrer"
              className="rounded-[4px] bg-primary px-[26px] py-3.5 text-[15px] font-bold text-[#101018] transition-colors hover:bg-[#6ee7b7]"
            >
              Ask on Discord
            </a>
            <a
              href="#contact"
              className="rounded-[4px] border border-hairline px-[26px] py-3.5 text-[15px] font-semibold text-base-content transition-colors hover:border-primary"
            >
              Open a ticket
            </a>
          </div>
        }
      />

      <SupportFAQ />
      <SupportTroubleshooting />

      {/* SEC 03 ／ STILL STUCK — three-channel escalation grid */}
      <section className="border-b border-hairline">
        <TerminalContainer>
          <SectionRow tag="SEC 03 ／ STILL STUCK" />
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="grid grid-cols-1 md:grid-cols-3"
          >
            {ESCALATION_CHANNELS.map((c) => (
              <a
                key={c.tag}
                href={c.href}
                rel="noopener noreferrer"
                className="block border-b border-hairline-minor px-1 py-10 text-base-content transition-colors duration-150 hover:bg-primary/5 md:border-b-0 md:border-r md:px-8 md:pb-12 md:last:border-r-0"
              >
                <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
                  {c.tag}
                </div>
                <div className="mb-2.5 text-[19px] font-bold uppercase tracking-[0.02em]">
                  {c.title}
                </div>
                <div className="max-w-[320px] text-[14.5px] leading-[1.65] text-base-content/60 [text-wrap:pretty]">
                  {c.body}
                </div>
              </a>
            ))}
          </motion.div>
        </TerminalContainer>
      </section>

      {/* Contact form is auth-aware (pre-fills name/email from claims).
          Wrapped in ClientOnly so the rest of /support prerenders. */}
      <ClientOnly>
        <SupportContactForm />
      </ClientOnly>
    </main>
  )
}
