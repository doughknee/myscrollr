// desktop/src/components/onboarding/curated-picks.ts

export interface StockPick {
  symbol: string;
  name: string;
}

export interface LeaguePick {
  id: string;
  name: string;
  sport: string;
}

export interface FeedPick {
  url: string;
  name: string;
  category: string;
}

export const POPULAR_STOCKS: StockPick[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "META", name: "Meta" },
  { symbol: "JPM", name: "JPMorgan" },
  { symbol: "V", name: "Visa" },
  { symbol: "DIS", name: "Disney" },
];

export const POPULAR_CRYPTO: StockPick[] = [
  { symbol: "BTC/USD", name: "Bitcoin" },
  { symbol: "ETH/USD", name: "Ethereum" },
  { symbol: "SOL/USD", name: "Solana" },
];

export const POPULAR_LEAGUES: LeaguePick[] = [
  { id: "1", name: "NFL", sport: "Football" },
  { id: "2", name: "NBA", sport: "Basketball" },
  { id: "3", name: "MLB", sport: "Baseball" },
  { id: "4", name: "NHL", sport: "Hockey" },
  { id: "253", name: "MLS", sport: "Soccer" },
  { id: "39", name: "Premier League", sport: "Soccer" },
  { id: "140", name: "La Liga", sport: "Soccer" },
  { id: "78", name: "Bundesliga", sport: "Soccer" },
  { id: "135", name: "Serie A", sport: "Soccer" },
  // Note: id "5" (not "2") because Champions League's natural id collides
  // with NBA. These ids are React keys for the picker UI; the actual
  // sport→league mapping happens server-side via channel config.
  { id: "5", name: "Champions League", sport: "Soccer" },
  { id: "61", name: "Ligue 1", sport: "Soccer" },
];

export const RECOMMENDED_FEEDS: FeedPick[] = [
  // Tech
  { url: "https://techcrunch.com/feed/", name: "TechCrunch", category: "Tech" },
  { url: "https://feeds.arstechnica.com/arstechnica/features", name: "Ars Technica", category: "Tech" },
  { url: "https://www.theverge.com/rss/index.xml", name: "The Verge", category: "Tech" },
  // Business
  { url: "https://feeds.bloomberg.com/markets/news.rss", name: "Bloomberg Markets", category: "Business" },
  // News
  // Direct AP feed instead of the rss.app proxy — the proxied URL
  // started returning HTTP 400 ahead of launch. Same content, lower
  // hop count, no third-party dependency.
  { url: "https://feeds.apnews.com/rss/apf-topnews", name: "AP News", category: "News" },
  { url: "https://feeds.bbci.co.uk/news/rss.xml", name: "BBC News", category: "News" },
  { url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", name: "NY Times", category: "News" },
  { url: "https://www.theguardian.com/world/rss", name: "The Guardian", category: "News" },
];
