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
      'Yes. The free tier gives you real-time data across all four channels with generous limits and no ads. Upgrade to Uplink for more capacity, or Uplink Ultimate for live streaming data and unlimited everything.',
  },
  {
    question: "Does it affect my computer's performance?",
    answer:
      'Not noticeably. All data flows through a single lightweight connection. The ticker uses minimal CPU and memory. You can check resource usage anytime with the built-in System Monitor widget.',
  },
  {
    question: 'Is my data private?',
    answer:
      'Scrollr contains zero analytics, zero tracking pixels, and zero telemetry. Your channel configurations and preferences are stored on your device. The only server-side data is your account profile and subscription status.',
  },
  {
    question: 'What platforms are supported?',
    answer:
      'Scrollr runs natively on macOS (Apple Silicon), Windows (x64), and Linux (x64). Each platform gets a dedicated build optimized for that OS.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'You can browse widgets and explore the desktop app without signing in. An account is needed to add channels (Finance, Sports, News, Fantasy) and to sync your setup across devices.',
  },
  {
    question: 'What data does Scrollr show?',
    answer:
      'Four channels: live stock and crypto prices (Finance), scores across 20+ leagues (Sports), articles from RSS feeds (News), and Yahoo Fantasy Sports leagues (Fantasy). Plus utility widgets for weather, clocks, system monitoring, uptime, and GitHub Actions.',
  },
  {
    question: 'Can I customize the feed?',
    answer:
      "Extensively. Position the ticker at the top or bottom of your screen, adjust rows and density, pin favorite sources to the sidebar, filter and sort within each channel, and toggle individual data points on or off in each channel's Display settings.",
  },
  {
    question: 'Is Scrollr open source?',
    answer:
      'Yes. Every line of code is publicly available on GitHub under the GNU AGPL v3.0 license. You can inspect, fork, or contribute.',
  },
  {
    question: 'How do I update the app?',
    answer:
      "Scrollr checks for updates automatically on launch. When an update is available, you'll see a notification prompting you to install. Updates are downloaded in the background and applied on next restart.",
  },
  {
    question: 'How does live data work vs. polling?',
    answer:
      'Free and Uplink tiers use polling — the app fetches fresh data at regular intervals (60s for free, 30s for Uplink, 10s for Pro). Uplink Ultimate uses a persistent SSE connection for instant live updates as data changes on the server.',
  },
]

// ── Troubleshooting Articles ──────────────────────────────────────

export interface TroubleshootingArticle {
  title: string
  symptoms: Array<string>
  steps: Array<string>
}

export const TROUBLESHOOTING_ARTICLES: Array<TroubleshootingArticle> = [
  {
    title: 'Sign-in fails or shows "Sign-in failed"',
    symptoms: [
      'Browser opens but returns to the desktop app with an error toast',
      'Browser shows "authorization successful" but the app still shows failure',
    ],
    steps: [
      'Check your internet connection.',
      'In the desktop app, sign out (Settings > Account) then sign in again.',
      'If the browser shows an error page, close it and retry from the app.',
      'If the problem persists, send us a note from the contact form below.',
    ],
  },
  {
    title: 'Data not loading / feed shows empty',
    symptoms: [
      'Channel added but shows "No data right now"',
      'Ticker shows empty slots where data should be',
    ],
    steps: [
      "Open the channel's Settings tab and verify items are configured (symbols, leagues, or feeds).",
      "Check that you're signed in (Settings > Account).",
      'Try switching away from and back to the feed tab.',
      'Check your internet connection.',
    ],
  },
  {
    title: 'Ticker not visible',
    symptoms: [
      'Ticker bar disappeared from the screen edge',
      'Only the main window shows',
    ],
    steps: [
      'Press Ctrl+T (Cmd+T on macOS) to toggle ticker visibility.',
      'Or go to Settings > General and enable the "Show Ticker" toggle.',
      'Right-click the system tray icon and check "Toggle Ticker".',
    ],
  },
  {
    title: 'Finance prices not updating',
    symptoms: [
      'Stock prices appear frozen or stale',
      '"Last updated" time doesn\'t change',
    ],
    steps: [
      'The finance data service reconnects automatically after brief disconnections. Wait 2-5 minutes.',
      'Check your internet connection.',
      'If persistent, try restarting the app.',
    ],
  },
  {
    title: 'Yahoo Fantasy connect fails',
    symptoms: [
      'Clicking "Connect Yahoo" opens browser but nothing happens',
      'Returns an error after authorizing',
    ],
    steps: [
      "Yahoo's OAuth can be intermittent. Wait 30 seconds and try again.",
      "Make sure you're authorizing the correct Yahoo account.",
      'If you see "invalid redirect URI", this is a known Yahoo issue — retry usually works.',
    ],
  },
  {
    title: 'Subscription not reflecting after purchase',
    symptoms: [
      'Completed checkout but app still shows Free tier limits',
      'Tier says "free" after upgrading',
    ],
    steps: [
      'The app checks subscription status every 5 minutes and on window focus. Click away from and back to the app window.',
      'If it persists, sign out and sign back in — the fresh token will include your updated role.',
    ],
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
      'Each channel has a Settings tab where you pick what to track. Add stock symbols, select sports leagues, subscribe to news feeds, or connect your Yahoo account.',
  },
  {
    title: 'Customize the Ticker',
    description:
      'The ticker bar runs across your screen showing live data. Adjust its position (top/bottom), size (compact/comfort), and number of rows in Settings > Ticker.',
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
