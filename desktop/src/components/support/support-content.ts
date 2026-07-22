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
      "Yes. The free tier streams real-time data to 3 widgets at once, with no ads and no cap on what goes inside each one. Paid plans add widget slots and ticker rows — they do not unlock data, widgets, or live streaming.",
  },
  {
    question: "Does it affect my computer's performance?",
    answer:
      "Not noticeably. All data flows through a single lightweight connection. The ticker uses minimal CPU and memory. You can check resource usage anytime with the built-in System Monitor widget.",
  },
  {
    question: "Is my data private?",
    answer:
      "Scrollr contains zero analytics, zero tracking pixels, and zero telemetry. Your widget configurations and preferences are stored on your device. The only server-side data is your account profile and subscription status.",
  },
  {
    question: "What platforms are supported?",
    answer:
      "Scrollr runs natively on macOS (Apple Silicon and Intel), Windows (x64), and Linux (x64). Each platform gets a dedicated build optimized for that OS.",
  },
  {
    question: "Do I need an account?",
    answer:
      "You can browse widgets and explore the app without signing in. An account is needed to add widgets (Finance, Sports, News, Fantasy) and to sync your setup.",
  },
  {
    question: "What data does Scrollr show?",
    answer:
      "Widgets showing live stock and crypto prices (Finance), scores across 14 leagues (Sports), articles from RSS feeds (News), and Yahoo Fantasy Sports leagues (Fantasy). Plus utility widgets for weather, clocks, system monitoring, uptime, and GitHub Actions.",
  },
  {
    question: "Can I customize the feed?",
    answer:
      "Extensively. Move the ticker to the top or bottom of the screen by right-clicking it (or using the up/down chevron in the hover toolbar). In Customize > Ticker you can lay out which widgets appear on which ticker rows. And every widget's settings live right in its top bar — filter, sort, and pick what to track from the controls on the widget's own page.",
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
      "Yes. The ticker spans the full width of whichever monitor the Scrollr window is currently on. To move it to a different monitor, drag the main window onto that monitor — the ticker follows. There's no monitor selector inside Customize; the ticker uses your OS's active-monitor placement.",
  },
  {
    question: "How does live data work vs. polling?",
    answer:
      "Every plan gets the same persistent SSE connection, so updates arrive the instant data changes on the server. Polling is the fallback for when that connection drops, and it is faster on paid plans: 60s on Free, 30s on Uplink, 10s on Uplink Pro (Ultimate polls at 30s because SSE carries it). The current mode shows in the title bar next to the Pin button — a green dot means Live, a normal dot means Polling.",
  },
  {
    question: "What's the difference between Uplink tiers?",
    answer:
      "Plans differ by how many widgets run at once, and how many ticker rows you get. Free: 3 widgets, 1 row. Uplink: 6 widgets, 2 rows. Uplink Pro: 12 widgets, 3 rows. Uplink Ultimate: unlimited widgets, 3 rows with per-row speed and direction. Every plan gets every widget and unlimited items inside each one.",
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
      "Try signing out (avatar chip in the sidebar footer > Account) then signing in again.",
      "If the browser shows an error page, close it and retry from the app.",
      "If the problem persists, report a bug from the Contact Us section — diagnostics will help us investigate.",
    ],
  },
  {
    title: "Data not loading / feed shows empty",
    symptoms: [
      "Widget added but shows \"No data right now\"",
      "Ticker shows empty slots where data should be",
    ],
    steps: [
      "Open the widget and check its top bar to verify items are added (symbols, leagues, or feeds).",
      "Check that you're signed in (avatar chip in the sidebar footer > Account).",
      "Try switching away from and back to the widget's page.",
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
      "Or go to Customize > Ticker and turn on \"Enable ticker\".",
      "Or click the Ticker toggle in the title bar (next to the Pin button).",
      "Or right-click the system tray icon and choose \"Toggle Ticker\".",
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
      "Scores stream live over SSE on every plan. If that connection drops the app falls back to polling, which is plan-based: 60s on Free, 30s on Uplink, 10s on Uplink Pro.",
      "Check your current delivery mode in the title bar (next to the Pin button) — green dot is Live, normal dot is Polling.",
      "Try switching to a different widget and back.",
    ],
  },
  {
    title: "Can't add widgets",
    symptoms: [
      "Clicking \"Add\" in the Catalog shows an error toast",
      "An error message appears instead of the new widget",
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
      "Open the News widget and switch to the Feeds view. Each tracked feed has a colored health dot — green is healthy, amber is stale, red is failing.",
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
      "Try reducing ticker rows in Customize > Ticker.",
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
      "Create an account or sign in to sync your widgets and settings. Free accounts get full access to all features with generous limits.",
  },
  {
    title: "Add Widgets",
    iconName: "LayoutGrid",
    description:
      "Click \"+ Add widget\" in the sidebar (or open the Catalog) to browse available widgets. Add Finance for stock prices, Sports for live scores, News for RSS feeds, or Fantasy for Yahoo leagues.",
  },
  {
    title: "Configure Your Widgets",
    iconName: "Settings",
    description:
      "Every setting lives in the widget's own top bar. Open a widget and use the controls there — type in Finance's search box to add stock symbols, pick a favorite team in Sports, choose feeds and categories in News, or connect your Yahoo account from Fantasy's Account pill.",
  },
  {
    title: "Customize the Ticker",
    iconName: "Monitor",
    description:
      "The ticker bar runs across your screen showing live data. Open Customize > Ticker (or press Ctrl+,) to lay out which widgets appear on which ticker rows. To move the ticker to the top or bottom of the screen, right-click it or use the up/down chevron in the hover toolbar.",
  },
  {
    title: "Explore Widgets",
    iconName: "Puzzle",
    description:
      "Add utility widgets like Weather, Clock, System Monitor, Uptime Kuma, or GitHub Actions from the Catalog. They appear on your ticker alongside your other widgets.",
  },
  {
    title: "Upgrade Your Plan",
    iconName: "Zap",
    description:
      "Free accounts run 3 widgets at once. There is no limit on symbols, feeds or leagues inside a widget. Upgrade for more widget slots and ticker rows.",
  },
];

// ── Billing FAQ ───────────────────────────────────────────────────

export const BILLING_FAQ: FAQItem[] = [
  {
    question: "How do I upgrade my plan?",
    answer:
      "Open the Catalog or go to your Account page (avatar chip in the sidebar footer) and click \"Upgrade\". You'll be directed to our website to complete checkout with Stripe.",
  },
  {
    question: "How do I cancel my subscription?",
    answer:
      "Go to your Account page (avatar chip in the sidebar footer) and click \"Manage Subscription\". Paid subscriptions cancel at the end of the billing period so you keep access until then. Trials cancel immediately.",
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
      "Click \"Manage Subscription\" on your Account page (avatar chip in the sidebar footer) to open the Stripe billing portal where you can update your card.",
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
