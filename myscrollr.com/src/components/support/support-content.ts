// myscrollr.com/src/components/support/support-content.ts
//
// Support content for the marketing /support page. Mirrors the
// desktop's support-content.ts but with copy adjusted for visitors who
// may not yet have the app installed (e.g. "in the desktop app, open
// the Catalog" rather than "open the Catalog from the sidebar").

// ── FAQ Items ─────────────────────────────────────────────────────

export interface FAQItem {
  question: string
  answer: string
}

export const FAQ_ITEMS: Array<FAQItem> = [
  {
    question: 'Is Scrollr free?',
    answer:
      'Yes. Three widgets at once, forever, no account. Uplink plans add more concurrent widgets from $6.67/mo.',
  },
  {
    question: "Does it affect my computer's performance?",
    answer:
      "No. It's a small native app (Tauri, not Electron) that idles quietly and sips memory.",
  },
  {
    question: 'Is my data private?',
    answer:
      'Scrollr ships zero telemetry: no analytics, no tracking. Enforced by tests that block deploys; the source is public.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'Not to use the free tier. An account only exists to sync an Uplink subscription across machines.',
  },
  {
    question: 'What platforms are supported?',
    answer:
      'macOS (Apple Silicon), Windows (x64), and Linux (AppImage, .deb, .rpm). Multi-monitor aware on all three.',
  },
  {
    question: 'Can I customize the bar?',
    answer:
      'Twenty palettes, top or bottom of any monitor, speed and density controls, and per-widget settings.',
  },
  {
    question: 'How do I update the app?',
    answer:
      'Scrollr checks GitHub Releases and updates in place. New widgets need no update at all. They ship server-side.',
  },
  {
    question: 'How does live data work?',
    answer:
      'Game scores, prices, and odds stream over a realtime connection; feeds refresh on a fast poll. No refresh button anywhere.',
  },
]

// ── Troubleshooting Articles ──────────────────────────────────────

export interface TroubleshootingArticle {
  title: string
  body: string
}

export const TROUBLESHOOTING_ARTICLES: Array<TroubleshootingArticle> = [
  {
    title: 'Sign-in fails or shows "Sign-in failed"',
    body: 'Sign in happens in your browser and hands back to the app. If it stalls: make sure a default browser is set, then retry from Settings → Account. Corporate VPNs that block auth.myscrollr.com are the usual culprit.',
  },
  {
    title: 'Data not loading / bar shows empty',
    body: 'Check Settings → Connection. A red dot means the stream is down. Scrollr reconnects automatically with backoff. If only one widget is empty, its league or market may simply have nothing live right now.',
  },
  {
    title: 'Ticker not visible',
    body: 'It may be on another monitor or behind a fullscreen app. Use Settings → Position to re-pin it, or toggle "always on top" off and on. On macOS, grant Screen Recording permission if the bar vanishes over fullscreen video.',
  },
  {
    title: 'Finance prices not updating',
    body: "Quotes pause outside market hours. That's the market, not the app. Crypto streams around the clock; if BTC is frozen too, check Settings → Connection.",
  },
  {
    title: 'Yahoo Fantasy connect fails',
    body: "Reconnect from the widget's settings. Yahoo tokens expire roughly monthly. Make sure you complete the Yahoo consent screen in the browser it opens.",
  },
  {
    title: 'Subscription not reflecting after purchase',
    body: "Sign out and back in to refresh entitlements. Stripe webhooks land within a minute; if it's been longer, open a ticket with your receipt and we'll sort it same-day.",
  },
]

// ── Getting Started Steps ─────────────────────────────────────────

export interface GettingStartedStep {
  title: string
  description: string
}

export const GETTING_STARTED_STEPS: Array<GettingStartedStep> = [
  {
    title: 'Download & Install',
    description:
      'Pick your platform on the Download page and run the installer. macOS, Windows, and Linux are all supported.',
  },
  {
    title: 'Sign In',
    description:
      'Create a free account or sign in to sync your channels and settings. Free accounts get full access to all features with generous limits.',
  },
  {
    title: 'Add Channels',
    description:
      'In the desktop app, open the Catalog from the sidebar to browse available data sources. Add Finance for stock prices, Sports for live scores, News for RSS feeds, or Fantasy for Yahoo leagues.',
  },
  {
    title: 'Configure Your Feeds',
    description:
      'Each channel has a Configure view where you pick what to track. Open a channel, click Options in the title bar, then Configure source: add stock symbols, select sports leagues, subscribe to news feeds, or connect your Yahoo account.',
  },
  {
    title: 'Customize the Ticker',
    description:
      'The ticker bar runs across your screen showing live data. Open Settings > Ticker to change the detail level (Compact / Detailed), add ticker rows, and adjust speed. To move the ticker to the top or bottom of the screen, right-click it or use the up/down chevron in the hover toolbar.',
  },
]

// ── Billing FAQ ───────────────────────────────────────────────────

export const BILLING_FAQ: Array<FAQItem> = [
  {
    question: 'How do I upgrade my plan?',
    answer:
      'Open the Catalog or go to Settings > Account in the desktop app and click "Upgrade". You\'ll be directed to our website to complete checkout with Stripe.',
  },
  {
    question: 'How do I cancel my subscription?',
    answer:
      'Go to Settings > Account in the desktop app and click "Manage Subscription". Paid subscriptions cancel at the end of the billing period so you keep access until then. Trials cancel immediately.',
  },
  {
    question: 'What happens when my trial ends?',
    answer:
      'Your card is charged automatically at the plan rate you selected during checkout. During the trial, you get full Uplink Ultimate access regardless of which plan you chose.',
  },
  {
    question: 'Can I change my plan?',
    answer:
      'Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing period.',
  },
  {
    question: 'How do I update my payment method?',
    answer:
      'Click "Manage Subscription" in Settings > Account to open the Stripe billing portal where you can update your card.',
  },
  {
    question: 'I was charged incorrectly',
    answer:
      "Use the contact form below with your account email and a description of the issue. We'll investigate and resolve it promptly.",
  },
]
