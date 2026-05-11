// desktop/src/components/support/support-content.ts

// ── FAQ Items ─────────────────────────────────────────────────────

export interface FAQItem {
  question: string;
  answer: string;
}

export const FAQ_ITEMS: FAQItem[] = [
  {
    question: "Is Scrollr free?",
    answer:
      "Yes. The free tier gives you real-time data across all four channels with generous limits and no ads. Upgrade to Uplink for more capacity, or Uplink Ultimate for live streaming data and unlimited everything.",
  },
  {
    question: "Does it affect my computer's performance?",
    answer:
      "Not noticeably. All data flows through a single lightweight connection. The ticker uses minimal CPU and memory. You can check resource usage anytime with the built-in System Monitor widget.",
  },
  {
    question: "Is my data private?",
    answer:
      "Scrollr contains zero analytics, zero tracking pixels, and zero telemetry. Your channel configurations and preferences are stored on your device. The only server-side data is your account profile and subscription status.",
  },
  {
    question: "What platforms are supported?",
    answer:
      "Scrollr runs natively on macOS (Apple Silicon and Intel), Windows (x64), and Linux (x64). Each platform gets a dedicated build optimized for that OS.",
  },
  {
    question: "Do I need an account?",
    answer:
      "You can browse widgets and explore the app without signing in. An account is needed to add channels (Finance, Sports, News, Fantasy) and to sync your setup.",
  },
  {
    question: "What data does Scrollr show?",
    answer:
      "Four channels: live stock and crypto prices (Finance), scores across 20+ leagues (Sports), articles from RSS feeds (News), and Yahoo Fantasy Sports leagues (Fantasy). Plus utility widgets for weather, clocks, system monitoring, uptime, and GitHub Actions.",
  },
  {
    question: "Can I customize the feed?",
    answer:
      "Extensively. Position the ticker at the top or bottom of your screen, adjust rows and density, pin favorite sources to the sidebar, filter and sort within each channel, and toggle individual data points on or off in each channel's Display settings.",
  },
  {
    question: "Is Scrollr open source?",
    answer:
      "Yes. Every line of code is publicly available on GitHub under the GNU AGPL v3.0 license. You can inspect, fork, or contribute.",
  },
  {
    question: "How do I update the app?",
    answer:
      "Scrollr checks for updates automatically on launch. When an update is available, you'll see a notification prompting you to install. Updates are downloaded in the background and applied on next restart.",
  },
  {
    question: "Can I use Scrollr on multiple monitors?",
    answer:
      "Yes. The ticker automatically spans the full width of your primary monitor. You can move it between monitors by changing the ticker position in Settings > Ticker.",
  },
  {
    question: "How does live data work vs. polling?",
    answer:
      "Free and Uplink tiers use polling — the app fetches fresh data at regular intervals (60s for free, 30s for Uplink, 10s for Pro). Uplink Ultimate uses a persistent SSE connection for instant live updates as data changes on the server. You can see your current mode (Live or Polling) in the sidebar footer.",
  },
  {
    question: "What's the difference between Uplink tiers?",
    answer:
      "Free: 5 symbols, 1 feed, 1 league. Uplink: 25 symbols, 25 feeds, 8 leagues, 30s polling. Uplink Pro: 75 symbols, 100 feeds, 20 leagues, 10s polling. Uplink Ultimate: unlimited everything, live streaming via SSE, priority support.",
  },
];

// ── Troubleshooting Articles ──────────────────────────────────────

export interface TroubleshootingArticle {
  title: string;
  symptoms: string[];
  steps: string[];
}

export const TROUBLESHOOTING_ARTICLES: TroubleshootingArticle[] = [
  {
    title: "Sign-in fails or shows \"Sign-in failed\"",
    symptoms: [
      "Browser opens but returns to app with error toast",
      "Browser shows \"authorization successful\" but app shows failure",
    ],
    steps: [
      "Check your internet connection.",
      "Try signing out (Settings > Account) then signing in again.",
      "If the browser shows an error page, close it and retry from the app.",
      "If the problem persists, report a bug from the Contact Us section — diagnostics will help us investigate.",
    ],
  },
  {
    title: "Data not loading / feed shows empty",
    symptoms: [
      "Channel added but shows \"No data right now\"",
      "Ticker shows empty slots where data should be",
    ],
    steps: [
      "Open the channel and click Options > Configure to verify items are added (symbols, leagues, or feeds).",
      "Check that you're signed in (Settings > Account).",
      "Try switching away from and back to the feed tab.",
      "Check your internet connection.",
    ],
  },
  {
    title: "Ticker not visible",
    symptoms: [
      "Ticker bar disappeared from the screen edge",
      "Only the main window shows",
    ],
    steps: [
      "Press Ctrl+T (Cmd+T on macOS) to toggle ticker visibility.",
      "Or go to Settings > General and enable the \"Show Ticker\" toggle.",
      "Right-click the system tray icon and check \"Toggle Ticker\".",
    ],
  },
  {
    title: "Finance prices not updating",
    symptoms: [
      "Stock prices appear frozen or stale",
      "\"Last updated\" time doesn't change",
    ],
    steps: [
      "The finance data service reconnects automatically after brief disconnections. Wait 2-5 minutes.",
      "Check your internet connection.",
      "If persistent, try restarting the app.",
    ],
  },
  {
    title: "Yahoo Fantasy connect fails",
    symptoms: [
      "Clicking \"Connect Yahoo\" opens browser but nothing happens",
      "Returns an error after authorizing",
    ],
    steps: [
      "Yahoo's OAuth can be intermittent. Wait 30 seconds and try again.",
      "Make sure you're authorizing the correct Yahoo account.",
      "If you see \"invalid redirect URI\", this is a known Yahoo issue — retry usually works.",
    ],
  },
  {
    title: "Sports scores appear stale",
    symptoms: [
      "Scores don't match live TV",
      "Yesterday's games still showing as live",
    ],
    steps: [
      "Scores update via polling based on your plan tier. Free: 60s, Uplink: 30s, Pro: 10s, Ultimate: live.",
      "Check your current delivery mode in the sidebar footer (Live vs Polling).",
      "Try switching to a different tab and back.",
    ],
  },
  {
    title: "Can't add channels",
    symptoms: [
      "Clicking \"Add\" in the Catalog shows an error toast",
      "\"Failed to create channel\" message",
    ],
    steps: [
      "Sign out and sign back in to refresh your session.",
      "If the error persists, report a bug from the Contact Us section — diagnostics will help us identify the issue.",
    ],
  },
  {
    title: "RSS feeds show no articles",
    symptoms: [
      "Feed added but shows \"No articles right now\"",
      "Some feeds show data but others don't",
    ],
    steps: [
      "Check the feed's health indicator in Settings — green is healthy, amber is stale, red is failing.",
      "Some feeds may be temporarily down. Try adding a different feed to verify your connection works.",
      "Custom feeds must be valid RSS or Atom URLs.",
    ],
  },
  {
    title: "Subscription not reflecting after purchase",
    symptoms: [
      "Completed checkout but app still shows Free tier limits",
      "Tier says \"free\" after upgrading",
    ],
    steps: [
      "The app checks subscription status every 5 minutes and on window focus. Click away from and back to the app window.",
      "If it persists, sign out and sign back in — the fresh token will include your updated role.",
    ],
  },
  {
    title: "App feels slow or unresponsive",
    symptoms: [
      "UI lag when clicking buttons",
      "High CPU usage from Scrollr",
    ],
    steps: [
      "Try reducing ticker rows in Settings > Ticker.",
      "Reduce the number of tracked symbols, feeds, or leagues.",
      "Check the System Monitor widget for overall CPU/memory usage.",
      "Restart the app if it has been running for a long time.",
    ],
  },
];

// ── Getting Started Steps ─────────────────────────────────────────

export interface GettingStartedStep {
  title: string;
  description: string;
  iconName: string;
}

export const GETTING_STARTED_STEPS: GettingStartedStep[] = [
  {
    title: "Sign In",
    iconName: "LogIn",
    description:
      "Create an account or sign in to sync your channels and settings. Free accounts get full access to all features with generous limits.",
  },
  {
    title: "Add Channels",
    iconName: "LayoutGrid",
    description:
      "Open the Catalog from the sidebar to browse available data sources. Add Finance for stock prices, Sports for live scores, News for RSS feeds, or Fantasy for Yahoo leagues.",
  },
  {
    title: "Configure Your Feeds",
    iconName: "Settings",
    description:
      "Each channel has a Configure view where you pick what to track. Open a channel, click Options in the title bar, then Configure source — add stock symbols, select sports leagues, subscribe to news feeds, or connect your Yahoo account.",
  },
  {
    title: "Customize the Ticker",
    iconName: "Monitor",
    description:
      "The ticker bar runs across your screen showing live data. Adjust its position (top/bottom), size (compact/comfort), and number of rows in Settings > Ticker.",
  },
  {
    title: "Explore Widgets",
    iconName: "Puzzle",
    description:
      "Add utility widgets like Weather, Clock, System Monitor, Uptime Kuma, or GitHub Actions from the Catalog. Widgets appear on your ticker alongside channel data.",
  },
  {
    title: "Upgrade Your Plan",
    iconName: "Zap",
    description:
      "Free accounts have limits on symbols, feeds, and leagues. Upgrade to Uplink for more capacity, or Uplink Ultimate for live streaming data and unlimited everything.",
  },
];

// ── Billing FAQ ───────────────────────────────────────────────────

export const BILLING_FAQ: FAQItem[] = [
  {
    question: "How do I upgrade my plan?",
    answer:
      "Open the Catalog or go to Settings > Account and click \"Upgrade\". You'll be directed to our website to complete checkout with Stripe.",
  },
  {
    question: "How do I cancel my subscription?",
    answer:
      "Go to Settings > Account and click \"Manage Subscription\". Paid subscriptions cancel at the end of the billing period so you keep access until then. Trials cancel immediately.",
  },
  {
    question: "What happens when my trial ends?",
    answer:
      "Your card is charged automatically at the plan rate you selected during checkout. During the trial, you get full Uplink Ultimate access regardless of which plan you chose.",
  },
  {
    question: "Can I change my plan?",
    answer:
      "Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing period.",
  },
  {
    question: "How do I update my payment method?",
    answer:
      "Click \"Manage Subscription\" in Settings > Account to open the Stripe billing portal where you can update your card.",
  },
  {
    question: "I was charged incorrectly",
    answer:
      "Contact us using the Contact form with your account email and a description of the issue. We'll investigate and resolve it promptly.",
  },
];

// ── Search Index ──────────────────────────────────────────────────

export type SearchResultSection =
  | "faq"
  | "troubleshooting"
  | "getting-started"
  | "billing"
  | "guides";

export interface SearchResult {
  section: SearchResultSection;
  sectionLabel: string;
  title: string;
  preview: string;
  index: number;
}

function buildSearchIndex(): Array<{
  text: string;
  result: SearchResult;
}> {
  const entries: Array<{ text: string; result: SearchResult }> = [];

  FAQ_ITEMS.forEach((item, i) => {
    entries.push({
      text: `${item.question} ${item.answer}`.toLowerCase(),
      result: {
        section: "faq",
        sectionLabel: "FAQ",
        title: item.question,
        preview: item.answer.slice(0, 120),
        index: i,
      },
    });
  });

  TROUBLESHOOTING_ARTICLES.forEach((item, i) => {
    entries.push({
      text:
        `${item.title} ${item.symptoms.join(" ")} ${item.steps.join(" ")}`.toLowerCase(),
      result: {
        section: "troubleshooting",
        sectionLabel: "Troubleshooting",
        title: item.title,
        preview: item.symptoms[0] ?? "",
        index: i,
      },
    });
  });

  GETTING_STARTED_STEPS.forEach((item, i) => {
    entries.push({
      text: `${item.title} ${item.description}`.toLowerCase(),
      result: {
        section: "getting-started",
        sectionLabel: "Getting Started",
        title: item.title,
        preview: item.description.slice(0, 120),
        index: i,
      },
    });
  });

  BILLING_FAQ.forEach((item, i) => {
    entries.push({
      text: `${item.question} ${item.answer}`.toLowerCase(),
      result: {
        section: "billing",
        sectionLabel: "Account & Billing",
        title: item.question,
        preview: item.answer.slice(0, 120),
        index: i,
      },
    });
  });

  return entries;
}

const SEARCH_INDEX = buildSearchIndex();

export function searchSupportContent(query: string): SearchResult[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  return SEARCH_INDEX.filter((entry) => entry.text.includes(q)).map(
    (entry) => entry.result,
  );
}
