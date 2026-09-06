// Catalog data — mirrors desktop/src/catalog.snapshot.json (hidden rss_custom omitted).
// iconPath = lucide glyph the renderer registers for the source (used when no logo_url).
const I = {
  trendingUp: "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z",
  rss: "M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 18.5a.5.5 0 1 0 0 1a.5.5 0 1 0 0-1",
  swords: "M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5L18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20M12 6v6l4 2",
  timer: "M10 2h4M12 14v-4M4 13a8 8 0 0 1 8-7 8 8 0 1 1-5.3 14L4 17.6M9 17H4v5",
  cloudSun: "M12 2v2M4.93 4.93l1.41 1.41M20 12h2M19.07 4.93l-1.41 1.41M15.947 12.65a4 4 0 0 0-5.925-4.128M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z",
  activity: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  heartPulse: "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7ZM3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27",
  github: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4M9 18c-4.51 2-5-2-7-2",
};
const H = (d) => `https://icon.horse/icon/${d}`;

// group = sub-shelf within a category (used by the explorations; the app has no such field yet).
export const WIDGETS = [
  { id: "finance_stocks", name: "Stocks", description: "Live stock & ETF prices with a watchlist you control.", category: "finance", group: "Markets", hex: "#16a34a", iconPath: I.trendingUp },
  { id: "finance_crypto", name: "Crypto", description: "Live crypto prices with a watchlist you control.", category: "finance", group: "Markets", hex: "#f7931a", iconPath: I.trendingUp },
  { id: "sports_nfl", name: "NFL", description: "Live NFL scores and game states.", category: "sports", group: "Football", hex: "#013369", logoUrl: H("nfl.com"), iconPath: I.trophy },
  { id: "sports_nba", name: "NBA", description: "Live NBA scores and game states.", category: "sports", group: "Basketball", hex: "#c9082a", logoUrl: H("nba.com"), iconPath: I.trophy },
  { id: "sports_nhl", name: "NHL", description: "Live NHL scores and game states.", category: "sports", group: "Hockey", hex: "#111827", logoUrl: H("nhl.com"), iconPath: I.trophy },
  { id: "sports_mlb", name: "MLB", description: "Live MLB scores and game states.", category: "sports", group: "Baseball", hex: "#002d72", logoUrl: H("mlb.com"), iconPath: I.trophy },
  { id: "sports_f1", name: "F1", description: "Formula 1 race weekends and results.", category: "sports", group: "Motorsport", hex: "#e10600", logoUrl: H("formula1.com"), iconPath: I.trophy },
  { id: "sports_worldcup", name: "World Cup", description: "FIFA World Cup fixtures and scores.", category: "sports", group: "Soccer", hex: "#2e7d46", logoUrl: H("fifa.com"), iconPath: I.trophy },
  { id: "sports_ncaaf", name: "NCAA Football", description: "Live college football scores across the FBS.", category: "sports", group: "Football", hex: "#0b427a", logoUrl: H("ncaa.com"), iconPath: I.trophy },
  { id: "sports_ncaab", name: "NCAA Basketball", description: "Live college basketball scores and the road to March.", category: "sports", group: "Basketball", hex: "#d2691e", logoUrl: H("ncaa.com"), iconPath: I.trophy },
  { id: "sports_premierleague", name: "Premier League", description: "Live scores from England's Premier League.", category: "sports", group: "Soccer", hex: "#37003c", logoUrl: H("premierleague.com"), iconPath: I.trophy },
  { id: "sports_laliga", name: "La Liga", description: "Live scores from Spain's La Liga.", category: "sports", group: "Soccer", hex: "#e2001a", logoUrl: H("laliga.com"), iconPath: I.trophy },
  { id: "sports_mls", name: "MLS", description: "Live Major League Soccer scores.", category: "sports", group: "Soccer", hex: "#001838", logoUrl: H("mlssoccer.com"), iconPath: I.trophy },
  { id: "sports_championsleague", name: "Champions League", description: "Live UEFA Champions League scores.", category: "sports", group: "Soccer", hex: "#0e1e5b", logoUrl: H("uefa.com"), iconPath: I.trophy },
  { id: "sports_ufc", name: "UFC", description: "UFC fight cards and results.", category: "sports", group: "Combat", hex: "#d20a0a", iconPath: I.trophy },
  { id: "sports_afl", name: "AFL", description: "Live Australian Football League scores.", category: "sports", group: "Football", hex: "#003da5", logoUrl: H("afl.com.au"), iconPath: I.trophy },
  { id: "news_bbc", name: "BBC News", description: "World, UK and breaking news from the BBC.", category: "news", group: "World", hex: "#b80000", logoUrl: H("bbc.com"), iconPath: I.rss },
  { id: "news_npr", name: "NPR", description: "US and world news, analysis and reporting from NPR.", category: "news", group: "World", hex: "#4667de", logoUrl: H("npr.org"), iconPath: I.rss },
  { id: "news_guardian", name: "The Guardian", description: "Independent world news, opinion and reporting.", category: "news", group: "World", hex: "#052962", logoUrl: H("theguardian.com"), iconPath: I.rss },
  { id: "news_aljazeera", name: "Al Jazeera", description: "Breaking news from the Middle East and around the world.", category: "news", group: "World", hex: "#e8a33d", logoUrl: H("aljazeera.com"), iconPath: I.rss },
  { id: "news_propublica", name: "ProPublica", description: "Investigative journalism in the public interest.", category: "news", group: "World", hex: "#c8102e", logoUrl: H("propublica.org"), iconPath: I.rss },
  { id: "news_bloomberg", name: "Bloomberg", description: "Global markets, finance and business news.", category: "news", group: "Business", hex: "#1a1a2e", logoUrl: H("bloomberg.com"), iconPath: I.rss },
  { id: "news_cnbc", name: "CNBC", description: "Markets, business and finance headlines.", category: "news", group: "Business", hex: "#005594", logoUrl: H("cnbc.com"), iconPath: I.rss },
  { id: "news_nasa", name: "NASA", description: "Space, science and mission news from NASA.", category: "news", group: "Tech & Science", hex: "#0b3d91", logoUrl: H("nasa.gov"), iconPath: I.rss },
  { id: "news_hackernews", name: "Hacker News", description: "Top stories from the Hacker News front page.", category: "news", group: "Tech & Science", hex: "#ff6600", logoUrl: H("news.ycombinator.com"), iconPath: I.rss },
  { id: "news_theverge", name: "The Verge", description: "Technology, science, art and culture.", category: "news", group: "Tech & Science", hex: "#5200ff", logoUrl: H("theverge.com"), iconPath: I.rss },
  { id: "news_drudge", name: "Drudge Report", description: "The Drudge Report's headline links, as they post.", category: "news", group: "World", hex: "#4b5563", logoUrl: H("drudgereport.com"), logoLight: true, iconPath: I.rss },
  { id: "fantasy_yahoo", name: "Yahoo Fantasy", description: "Your Yahoo Fantasy leagues, matchups, and standings.", category: "fantasy", group: "Fantasy", hex: "#6001d2", logoUrl: H("yahoo.com"), iconPath: I.swords },
  { id: "predictions", name: "Kalshi", description: "Live odds from the Kalshi prediction market.", category: "predictions", group: "Predictions", hex: "#1fc9a0", iconPath: I.trendingUp },
  { id: "clock", name: "Clock", description: "Local time and world clocks", category: "utility", group: "Desk", hex: "#6366f1", iconPath: I.clock },
  { id: "timer", name: "Timer", description: "Pomodoro, countdown, and stopwatch tools", category: "utility", group: "Desk", hex: "#f59e0b", iconPath: I.timer },
  { id: "weather", name: "Weather", description: "Current conditions for your locations", category: "utility", group: "Desk", hex: "#0ea5e9", iconPath: I.cloudSun },
  { id: "sysmon", name: "System Monitor", description: "Live CPU, memory, and GPU stats", category: "utility", group: "Dev", hex: "#06b6d4", iconPath: I.activity },
  { id: "uptime", name: "Uptime", description: "Monitor status from Uptime Kuma", category: "utility", group: "Dev", hex: "#10b981", logoUrl: H("uptime.kuma.pet"), iconPath: I.heartPulse },
  { id: "github", name: "GitHub", description: "CI/Actions status for your repos", category: "utility", group: "Dev", hex: "#f97316", logoUrl: H("github.com"), iconPath: I.github },
];

// Plausible next-year additions, for mockups that need to prove scale (~250 target).
export const FUTURE = [
  { id: "sports_bundesliga", name: "Bundesliga", description: "Live scores from Germany's Bundesliga.", category: "sports", group: "Soccer", hex: "#d3010c", logoUrl: H("bundesliga.com"), iconPath: I.trophy },
  { id: "sports_seriea", name: "Serie A", description: "Live scores from Italy's Serie A.", category: "sports", group: "Soccer", hex: "#024494", logoUrl: H("legaseriea.it"), iconPath: I.trophy },
  { id: "sports_ligue1", name: "Ligue 1", description: "Live scores from France's Ligue 1.", category: "sports", group: "Soccer", hex: "#091c3e", logoUrl: H("ligue1.com"), iconPath: I.trophy },
  { id: "sports_wnba", name: "WNBA", description: "Live WNBA scores and game states.", category: "sports", group: "Basketball", hex: "#fa4d00", logoUrl: H("wnba.com"), iconPath: I.trophy },
  { id: "sports_euroleague", name: "EuroLeague", description: "Live EuroLeague basketball scores.", category: "sports", group: "Basketball", hex: "#f47a20", logoUrl: H("euroleaguebasketball.net"), iconPath: I.trophy },
  { id: "sports_pga", name: "PGA Tour", description: "Leaderboards from every tour stop.", category: "sports", group: "Golf & Tennis", hex: "#003a70", logoUrl: H("pgatour.com"), iconPath: I.trophy },
  { id: "sports_atp", name: "ATP Tour", description: "Live men's tennis scores and draws.", category: "sports", group: "Golf & Tennis", hex: "#1a3c8c", logoUrl: H("atptour.com"), iconPath: I.trophy },
  { id: "sports_wta", name: "WTA", description: "Live women's tennis scores and draws.", category: "sports", group: "Golf & Tennis", hex: "#7b1fa2", logoUrl: H("wtatennis.com"), iconPath: I.trophy },
  { id: "sports_nascar", name: "NASCAR", description: "Race weekends, results and standings.", category: "sports", group: "Motorsport", hex: "#ffd659", logoUrl: H("nascar.com"), iconPath: I.trophy },
  { id: "sports_indycar", name: "IndyCar", description: "IndyCar race weekends and results.", category: "sports", group: "Motorsport", hex: "#c8102e", logoUrl: H("indycar.com"), iconPath: I.trophy },
  { id: "sports_motogp", name: "MotoGP", description: "MotoGP race weekends and results.", category: "sports", group: "Motorsport", hex: "#cc0000", logoUrl: H("motogp.com"), iconPath: I.trophy },
  { id: "sports_ipl", name: "IPL", description: "Live Indian Premier League cricket scores.", category: "sports", group: "Cricket & Rugby", hex: "#19398a", logoUrl: H("iplt20.com"), iconPath: I.trophy },
  { id: "sports_sixnations", name: "Six Nations", description: "Live Six Nations rugby scores.", category: "sports", group: "Cricket & Rugby", hex: "#0a2240", logoUrl: H("sixnationsrugby.com"), iconPath: I.trophy },
  { id: "sports_nrl", name: "NRL", description: "Live National Rugby League scores.", category: "sports", group: "Cricket & Rugby", hex: "#00a651", logoUrl: H("nrl.com"), iconPath: I.trophy },
  { id: "sports_boxing", name: "Boxing", description: "Major fight cards and results.", category: "sports", group: "Combat", hex: "#8b0000", iconPath: I.trophy },
  { id: "sports_pfl", name: "PFL", description: "Professional Fighters League cards and results.", category: "sports", group: "Combat", hex: "#e4002b", logoUrl: H("pflmma.com"), iconPath: I.trophy },
  { id: "sports_ncaabase", name: "NCAA Baseball", description: "Live college baseball scores.", category: "sports", group: "Baseball", hex: "#0b427a", logoUrl: H("ncaa.com"), iconPath: I.trophy },
  { id: "sports_npb", name: "NPB", description: "Live Nippon Professional Baseball scores.", category: "sports", group: "Baseball", hex: "#c8102e", iconPath: I.trophy },
  { id: "sports_khl", name: "KHL", description: "Live Kontinental Hockey League scores.", category: "sports", group: "Hockey", hex: "#1c3f95", iconPath: I.trophy },
  { id: "sports_cfl", name: "CFL", description: "Live Canadian Football League scores.", category: "sports", group: "Football", hex: "#c8102e", logoUrl: H("cfl.ca"), iconPath: I.trophy },
  { id: "news_reuters", name: "Reuters", description: "Wire headlines from Reuters.", category: "news", group: "World", hex: "#ff8000", logoUrl: H("reuters.com"), iconPath: I.rss },
  { id: "news_ap", name: "AP News", description: "Associated Press top stories.", category: "news", group: "World", hex: "#ff322e", logoUrl: H("apnews.com"), iconPath: I.rss },
  { id: "news_ft", name: "Financial Times", description: "Markets and business from the FT.", category: "news", group: "Business", hex: "#fff1e5", logoUrl: H("ft.com"), logoLight: true, iconPath: I.rss },
  { id: "news_wsj", name: "WSJ", description: "Wall Street Journal headlines.", category: "news", group: "Business", hex: "#0274b6", logoUrl: H("wsj.com"), iconPath: I.rss },
  { id: "news_arstechnica", name: "Ars Technica", description: "Technology, science and policy.", category: "news", group: "Tech & Science", hex: "#ff4e00", logoUrl: H("arstechnica.com"), iconPath: I.rss },
  { id: "news_techcrunch", name: "TechCrunch", description: "Startups and technology news.", category: "news", group: "Tech & Science", hex: "#0a9e01", logoUrl: H("techcrunch.com"), iconPath: I.rss },
  { id: "news_nature", name: "Nature", description: "Research highlights from Nature.", category: "news", group: "Tech & Science", hex: "#0b3f6d", logoUrl: H("nature.com"), iconPath: I.rss },
  { id: "news_espn", name: "ESPN", description: "Top sports headlines from ESPN.", category: "news", group: "Sports & Culture", hex: "#d00", logoUrl: H("espn.com"), iconPath: I.rss },
  { id: "news_athletic", name: "The Athletic", description: "In-depth sports journalism.", category: "news", group: "Sports & Culture", hex: "#000", logoUrl: H("theathletic.com"), iconPath: I.rss },
  { id: "news_variety", name: "Variety", description: "Entertainment industry news.", category: "news", group: "Sports & Culture", hex: "#000", logoUrl: H("variety.com"), iconPath: I.rss },
  { id: "news_polygon", name: "Polygon", description: "Games, entertainment and culture.", category: "news", group: "Sports & Culture", hex: "#e30a54", logoUrl: H("polygon.com"), iconPath: I.rss },
  { id: "news_reddit", name: "Reddit", description: "Top posts from any subreddit.", category: "news", group: "Social", hex: "#ff4500", logoUrl: H("reddit.com"), iconPath: I.rss },
  { id: "news_bluesky", name: "Bluesky", description: "Posts from a feed or account you follow.", category: "news", group: "Social", hex: "#0085ff", logoUrl: H("bsky.app"), iconPath: I.rss },
  { id: "news_substack", name: "Substack", description: "New posts from newsletters you read.", category: "news", group: "Social", hex: "#ff6719", logoUrl: H("substack.com"), iconPath: I.rss },
  { id: "news_youtube", name: "YouTube", description: "New uploads from channels you follow.", category: "news", group: "Social", hex: "#ff0000", logoUrl: H("youtube.com"), iconPath: I.rss },
  { id: "finance_forex", name: "Forex", description: "Live currency pairs with a watchlist you control.", category: "finance", group: "Markets", hex: "#0ea5e9", iconPath: I.trendingUp },
  { id: "finance_commodities", name: "Commodities", description: "Gold, oil, gas and more, live.", category: "finance", group: "Markets", hex: "#ca8a04", iconPath: I.trendingUp },
  { id: "finance_indices", name: "Indices", description: "S&P 500, Nasdaq, Dow, FTSE and more.", category: "finance", group: "Markets", hex: "#7c3aed", iconPath: I.trendingUp },
  { id: "finance_earnings", name: "Earnings", description: "This week's earnings calendar.", category: "finance", group: "Calendar", hex: "#0d9488", iconPath: I.trendingUp },
  { id: "finance_econ", name: "Econ Calendar", description: "CPI, jobs, Fed decisions and more.", category: "finance", group: "Calendar", hex: "#475569", iconPath: I.trendingUp },
  { id: "fantasy_espn", name: "ESPN Fantasy", description: "Your ESPN Fantasy leagues and matchups.", category: "fantasy", group: "Fantasy", hex: "#d00", logoUrl: H("espn.com"), iconPath: I.swords },
  { id: "fantasy_sleeper", name: "Sleeper", description: "Your Sleeper leagues and matchups.", category: "fantasy", group: "Fantasy", hex: "#1a1b2e", logoUrl: H("sleeper.com"), iconPath: I.swords },
  { id: "predictions_polymarket", name: "Polymarket", description: "Live odds from Polymarket.", category: "predictions", group: "Predictions", hex: "#2d5bff", logoUrl: H("polymarket.com"), iconPath: I.trendingUp },
  { id: "calendar", name: "Calendar", description: "Your next events from Google or Outlook", category: "utility", group: "Desk", hex: "#2563eb", iconPath: I.clock },
  { id: "pomodoro_team", name: "Focus", description: "Shared focus sessions with your team", category: "utility", group: "Desk", hex: "#db2777", iconPath: I.timer },
  { id: "countdown", name: "Countdown", description: "Days until dates that matter", category: "utility", group: "Desk", hex: "#9333ea", iconPath: I.timer },
  { id: "aqi", name: "Air Quality", description: "AQI and pollen for your locations", category: "utility", group: "Desk", hex: "#65a30d", iconPath: I.cloudSun },
  { id: "transit", name: "Transit", description: "Next departures from your stops", category: "utility", group: "Desk", hex: "#0891b2", iconPath: I.clock },
  { id: "vercel", name: "Vercel", description: "Deployment status for your projects", category: "utility", group: "Dev", hex: "#000", logoUrl: H("vercel.com"), iconPath: I.activity },
  { id: "gitlab", name: "GitLab", description: "Pipeline status for your projects", category: "utility", group: "Dev", hex: "#fc6d26", logoUrl: H("gitlab.com"), iconPath: I.github },
  { id: "sentry", name: "Sentry", description: "New issues in your projects", category: "utility", group: "Dev", hex: "#362d59", logoUrl: H("sentry.io"), iconPath: I.activity },
  { id: "statuspage", name: "Statuspage", description: "Status of the services you depend on", category: "utility", group: "Dev", hex: "#3b82f6", iconPath: I.heartPulse },
  { id: "docker", name: "Docker", description: "Running containers on this machine", category: "utility", group: "Dev", hex: "#2496ed", logoUrl: H("docker.com"), iconPath: I.activity },
  { id: "twitch", name: "Twitch", description: "Who's live among the channels you follow", category: "gaming", group: "Gaming", hex: "#9146ff", logoUrl: H("twitch.tv"), iconPath: I.rss },
  { id: "steam", name: "Steam", description: "Friends online and sales you're watching", category: "gaming", group: "Gaming", hex: "#1b2838", logoUrl: H("steampowered.com"), iconPath: I.rss },
  { id: "esports_lol", name: "LoL Esports", description: "Live League of Legends match scores", category: "gaming", group: "Gaming", hex: "#c89b3c", logoUrl: H("lolesports.com"), iconPath: I.trophy },
  { id: "esports_cs", name: "CS2 Esports", description: "Live Counter-Strike match scores", category: "gaming", group: "Gaming", hex: "#f5a623", iconPath: I.trophy },
];

export const CATEGORIES = [
  { id: "sports", label: "Sports" },
  { id: "finance", label: "Finance" },
  { id: "news", label: "News" },
  { id: "fantasy", label: "Fantasy" },
  { id: "predictions", label: "Predictions" },
  { id: "utility", label: "Utilities" },
];
export const FUTURE_CATEGORIES = [...CATEGORIES, { id: "gaming", label: "Gaming" }];

export const ADDED = ["finance_stocks", "finance_crypto", "sports_mlb", "sports_ncaaf", "sports_premierleague", "sports_ufc", "news_guardian", "news_drudge", "clock", "timer", "weather", "sysmon", "uptime"];
// Sidebar shows utilities first (local registry order), then data widgets in canonical order.
export const SIDEBAR = ["timer", "clock", "weather", "sysmon", "uptime", "finance_stocks", "sports_ncaaf", "sports_mlb", "finance_crypto", "sports_premierleague", "sports_ufc", "news_guardian", "news_drudge"];

export const SPOTLIGHT = [
  { id: "finance_stocks", tagline: "Instant quotes" },
  { id: "predictions", tagline: "Read the room" },
  { id: "clock", tagline: "Always on time" },
];

export const byId = (id) => [...WIDGETS, ...FUTURE].find((w) => w.id === id);
export const decorate = (w, added = ADDED) => ({
  ...w,
  added: added.includes(w.id),
  wash: `${w.hex}26`,
  tileBg: `linear-gradient(135deg, ${w.hex} 0%, ${w.hex}b8 100%)`,
  heroBg: `linear-gradient(135deg, ${w.hex} 0%, ${w.hex}d8 100%)`,
  hasLogo: Boolean(w.logoUrl),
  noLogo: !w.logoUrl,
  logoBg: w.logoLight ? "#ffffff" : "transparent",
  logoPad: w.logoLight ? "2px" : "0",
  textOn: readableTextOn(w.hex),
  categoryLabel: (FUTURE_CATEGORIES.find((c) => c.id === w.category) || {}).label || "Utilities",
});
export function readableTextOn(hex) {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#111827" : "#ffffff";
}
export function groupBy(items, key) {
  const out = [];
  for (const it of items) {
    let g = out.find((x) => x.key === it[key]);
    if (!g) out.push((g = { key: it[key], items: [] }));
    g.items.push(it);
  }
  return out.map((g) => ({ ...g, count: g.items.length }));
}
