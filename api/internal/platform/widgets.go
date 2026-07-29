package platform

import "strings"

// The widget catalog — the single authority for what widgets exist
// (VISION §4.2). Clients fetch this via GET /catalog and render generically;
// they supply renderers keyed on Source, nothing else. Adding a widget that
// reuses an existing renderer (another sports league, another news feed) is
// a change to this file alone — no client release.
//
// The widget is the user's atom; Source is invisible plumbing (VISION §4.1).
// It says which ingester/CDC topic feeds a widget and which renderer draws
// it — it is never a user-facing grouping. Category is the cosmetic filter
// tag the Library groups by, and is deliberately independent of Source:
// "Custom RSS" is category "news" but source "rss", and a finance-sourced
// widget could be categorised anywhere without changing a line of routing.
//
// Sports leagues and finance asset classes stay matched by source PREFIX as
// well (see widgetSourcePrefixes), so a widget id this catalog does not
// enumerate still routes correctly rather than 404ing.

// WidgetDef is one catalog entry. Every widget costs exactly one slot, so
// there is no per-widget price — RequiredTier gates availability only, and
// is "free" for everything today (slots are the one lever, VISION §6).
type WidgetDef struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`

	// Source is the backing ingester / CDC topic and the renderer key.
	// Empty for utilities. Never shown to the user.
	//
	// Source alone says whether a widget is data-backed: a data widget has
	// one, a utility does not. There used to be a separate `kind` field
	// carrying the same fact, which meant two things to keep in sync and
	// three names for one distinction (kind, source, and the "utility"
	// category). Ask `Source == ""` instead — see IsUtilityWidgetType.
	Source string `json:"source,omitempty"`

	// Category is a cosmetic catalog filter tag with no behavioral effect.
	Category string `json:"category"`

	// Color is the widget's own brand accent, so widgets sharing a renderer
	// still look like themselves.
	Color string `json:"color"`

	// LogoURL is the brand mark shown on catalog cards, falling back to the
	// client's per-source icon. LogoLight renders it on a light tile, for
	// transparent or dark marks that would vanish on a dark card.
	LogoURL   string `json:"logo_url,omitempty"`
	LogoLight bool   `json:"logo_light,omitempty"`

	// DefaultConfig is POSTed as the widget's config on add, so the backend
	// subscribes to the right league / asset class / feed.
	DefaultConfig map[string]any `json:"default_config,omitempty"`

	// RequiredTier gates availability. "free" everywhere today.
	RequiredTier string `json:"required_tier"`

	// About and Usage are the info-page copy. Server-owned so a wording fix
	// does not need a desktop release.
	About string   `json:"about,omitempty"`
	Usage []string `json:"usage,omitempty"`

	// Order is the canonical display position, assigned from this file's
	// declaration order at init.
	Order int `json:"order"`
}

// Shared usage recipes — most widgets in a family follow the same steps, so
// they are named once and reused. A per-widget Usage overrides these.
var (
	usageTeamSport = []string{
		"Live scores and game state update automatically.",
		"Set a favorite team from the top bar to keep it front and center.",
		"Pin it on game days so scores stay on screen.",
	}
	usageNews = []string{
		"Headlines refresh automatically as new stories publish.",
		"Open any headline from the feed to read the full story.",
		"Pin it to keep the latest news in view.",
	}
)

// catalog is the full widget catalog in canonical display order.
//
// League strings in DefaultConfig.leagues MUST match
// channels/sports/service/configs/leagues.json exactly — they become the CDC
// topic (config.leagues → cdc:sports:{LEAGUE}). Feed URLs likewise come from
// channels/rss/service/configs/feeds.json.
var catalog = []WidgetDef{
	// ── Finance — the finance source split by asset class ──────────────
	{
		ID: "finance_stocks", Name: "Stocks", Category: "finance", Source: "finance",
		Color: "#16a34a",
		Description:   "Live stock & ETF prices with a watchlist you control.",
		DefaultConfig: map[string]any{"symbols": []string{}, "asset_class": "stock"},
		About:         "Real-time stock and ETF prices for the tickers you follow. Your watchlist streams live as the market moves — no brokerage app open, no tab to babysit.",
		Usage: []string{
			"Open Watchlist, then search the full stock catalog to add or remove symbols.",
			"Quotes stream in real time during market hours.",
			"Pin it to keep your watchlist always visible.",
		},
	},
	{
		ID: "finance_crypto", Name: "Crypto", Category: "finance", Source: "finance",
		Color: "#f7931a",
		Description:   "Live crypto prices with a watchlist you control.",
		DefaultConfig: map[string]any{"symbols": []string{}, "asset_class": "crypto"},
		About:         "Live crypto prices for the coins you track, streamed around the clock. From BTC and ETH to the long tail, your picks update the moment the market does.",
		Usage: []string{
			"Open Watchlist, then search the full crypto catalog to add or remove coins.",
			"Prices stream 24/7 — crypto never closes.",
			"Pin it so every big move catches your eye.",
		},
	},

	// ── Sports — one widget per league ─────────────────────────────────
	{
		ID: "sports_nfl", Name: "NFL", Category: "sports", Source: "sports",
		Color: "#013369", LogoURL: "https://icon.horse/icon/nfl.com",
		Description:   "Live NFL scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"NFL"}}, Usage: usageTeamSport,
		About: "Live NFL scores, quarters, and game clock for every matchup on the slate. Follow the whole week or zero in on your team.",
	},
	{
		ID: "sports_nba", Name: "NBA", Category: "sports", Source: "sports",
		Color: "#c9082a", LogoURL: "https://icon.horse/icon/nba.com",
		Description:   "Live NBA scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"NBA"}}, Usage: usageTeamSport,
		About: "Live NBA scores and game state across the association — every quarter, every buzzer-beater, as it happens.",
	},
	{
		ID: "sports_nhl", Name: "NHL", Category: "sports", Source: "sports",
		Color: "#111827", LogoURL: "https://icon.horse/icon/nhl.com",
		Description:   "Live NHL scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"NHL"}}, Usage: usageTeamSport,
		About: "Live NHL scores and period-by-period game state for every game on the ice.",
	},
	{
		ID: "sports_mlb", Name: "MLB", Category: "sports", Source: "sports",
		Color: "#002d72", LogoURL: "https://icon.horse/icon/mlb.com",
		Description:   "Live MLB scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"MLB"}}, Usage: usageTeamSport,
		About: "Live MLB scores, innings, and game state across the league, all season long.",
	},
	{
		ID: "sports_f1", Name: "F1", Category: "sports", Source: "sports",
		Color: "#e10600", LogoURL: "https://icon.horse/icon/formula1.com",
		Description:   "Formula 1 race weekends and results.",
		DefaultConfig: map[string]any{"leagues": []string{"Formula 1"}},
		About:         "Formula 1 race weekends — practice, qualifying, and the Grand Prix result the moment the checkered flag drops.",
		Usage: []string{
			"Practice, qualifying, and race results update through the weekend.",
			"See the podium the second the race ends.",
			"Pin it during a Grand Prix to follow every session.",
		},
	},
	{
		ID: "sports_worldcup", Name: "World Cup", Category: "sports", Source: "sports",
		Color: "#2e7d46", LogoURL: "https://icon.horse/icon/fifa.com",
		Description:   "FIFA World Cup fixtures and scores.",
		DefaultConfig: map[string]any{"leagues": []string{"FIFA World Cup"}},
		About:         "Every FIFA World Cup fixture and live score, through the group stage and into the knockouts.",
		Usage: []string{
			"Live scores through the group stage and knockout rounds.",
			"Every fixture on the calendar, updated automatically.",
			"Pin it during the tournament so you never miss a goal.",
		},
	},
	{
		ID: "sports_ncaaf", Name: "NCAA Football", Category: "sports", Source: "sports",
		Color: "#0b427a", LogoURL: "https://icon.horse/icon/ncaa.com",
		Description:   "Live college football scores across the FBS.",
		DefaultConfig: map[string]any{"leagues": []string{"NCAA Football"}}, Usage: usageTeamSport,
		About: "Live college football scores across the FBS — Saturday slates, rivalry week, and bowl season.",
	},
	{
		ID: "sports_ncaab", Name: "NCAA Basketball", Category: "sports", Source: "sports",
		Color: "#d2691e", LogoURL: "https://icon.horse/icon/ncaa.com",
		Description:   "Live college basketball scores and the road to March.",
		DefaultConfig: map[string]any{"leagues": []string{"NCAA Basketball"}}, Usage: usageTeamSport,
		About: "Live college basketball scores through conference play and all the way into March Madness.",
	},
	{
		ID: "sports_premierleague", Name: "Premier League", Category: "sports", Source: "sports",
		Color: "#37003c", LogoURL: "https://icon.horse/icon/premierleague.com",
		Description:   "Live scores from England's Premier League.",
		DefaultConfig: map[string]any{"leagues": []string{"Premier League"}}, Usage: usageTeamSport,
		About: "Live scores from England's Premier League — all 20 clubs, every matchweek.",
	},
	{
		ID: "sports_laliga", Name: "La Liga", Category: "sports", Source: "sports",
		Color: "#e2001a", LogoURL: "https://icon.horse/icon/laliga.com",
		Description:   "Live scores from Spain's La Liga.",
		DefaultConfig: map[string]any{"leagues": []string{"La Liga"}}, Usage: usageTeamSport,
		About: "Live scores from Spain's La Liga, from the title race to the relegation scrap.",
	},
	{
		ID: "sports_mls", Name: "MLS", Category: "sports", Source: "sports",
		Color: "#001838", LogoURL: "https://icon.horse/icon/mlssoccer.com",
		Description:   "Live Major League Soccer scores.",
		DefaultConfig: map[string]any{"leagues": []string{"MLS"}}, Usage: usageTeamSport,
		About: "Live Major League Soccer scores across the Eastern and Western conferences.",
	},
	{
		ID: "sports_championsleague", Name: "Champions League", Category: "sports", Source: "sports",
		Color: "#0e1e5b", LogoURL: "https://icon.horse/icon/uefa.com",
		Description:   "Live UEFA Champions League scores.",
		DefaultConfig: map[string]any{"leagues": []string{"Champions League"}}, Usage: usageTeamSport,
		About: "Live UEFA Champions League scores through the league phase and into the knockout rounds.",
	},
	{
		// icon.horse returns a blank image for ufc.com, so this is pinned to
		// DuckDuckGo's icon CDN, which serves the real opaque wordmark.
		ID: "sports_ufc", Name: "UFC", Category: "sports", Source: "sports",
		Color: "#d20a0a", LogoLight: true,
		LogoURL:       "https://icons.duckduckgo.com/ip3/ufc.com.ico",
		Description:   "UFC fight cards and results.",
		DefaultConfig: map[string]any{"leagues": []string{"UFC"}},
		About:         "UFC fight cards and results — main card and prelims, bout by bout on event nights.",
		Usage: []string{
			"Fight results update bout by bout on event nights.",
			"Follow the main card and prelims in one place.",
			"Pin it during an event to catch every finish.",
		},
	},
	{
		ID: "sports_afl", Name: "AFL", Category: "sports", Source: "sports",
		Color: "#003da5", LogoURL: "https://icon.horse/icon/afl.com.au",
		Description:   "Live Australian Football League scores.",
		DefaultConfig: map[string]any{"leagues": []string{"AFL"}}, Usage: usageTeamSport,
		About: "Live Australian Football League scores across the home-and-away season and finals.",
	},

	// ── News — curated feeds, each its own widget over the rss source ───
	{
		ID: "news_bbc", Name: "BBC News", Category: "news", Source: "rss",
		Color: "#b80000", LogoURL: "https://icon.horse/icon/bbc.com",
		Description: "World, UK and breaking news from the BBC.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "BBC News", "url": "https://feeds.bbci.co.uk/news/rss.xml"},
		}},
		Usage: usageNews,
		About: "Headlines from the BBC — world, UK, and breaking news from one of the most-read newsrooms on the planet.",
	},
	{
		ID: "news_npr", Name: "NPR", Category: "news", Source: "rss",
		Color: "#4667de", LogoURL: "https://icon.horse/icon/npr.org",
		Description: "US and world news, analysis and reporting from NPR.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "NPR News", "url": "https://feeds.npr.org/1001/rss.xml"},
		}},
		Usage: usageNews,
		About: "News, analysis, and reporting from NPR, spanning US and world coverage.",
	},
	{
		ID: "news_guardian", Name: "The Guardian", Category: "news", Source: "rss",
		Color: "#052962", LogoURL: "https://icon.horse/icon/theguardian.com",
		Description: "Independent world news, opinion and reporting.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "The Guardian", "url": "https://www.theguardian.com/world/rss"},
		}},
		Usage: usageNews,
		About: "Independent world news, opinion, and reporting from The Guardian.",
	},
	{
		ID: "news_aljazeera", Name: "Al Jazeera", Category: "news", Source: "rss",
		Color: "#e8a33d", LogoURL: "https://icon.horse/icon/aljazeera.com",
		Description: "Breaking news from the Middle East and around the world.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml"},
		}},
		Usage: usageNews,
		About: "Breaking news from Al Jazeera, with deep coverage of the Middle East and the Global South.",
	},
	{
		ID: "news_propublica", Name: "ProPublica", Category: "news", Source: "rss",
		Color: "#c8102e", LogoURL: "https://icon.horse/icon/propublica.org",
		Description: "Investigative journalism in the public interest.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "ProPublica", "url": "https://feeds.propublica.org/propublica/main"},
		}},
		Usage: usageNews,
		About: "Investigative journalism in the public interest from the nonprofit newsroom ProPublica.",
	},
	{
		ID: "news_bloomberg", Name: "Bloomberg", Category: "news", Source: "rss",
		Color: "#1a1a2e", LogoURL: "https://icon.horse/icon/bloomberg.com",
		Description: "Global markets, finance and business news.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "Bloomberg Markets", "url": "https://feeds.bloomberg.com/markets/news.rss"},
		}},
		Usage: usageNews,
		About: "Markets, finance, and business news from Bloomberg.",
	},
	{
		ID: "news_cnbc", Name: "CNBC", Category: "news", Source: "rss",
		Color: "#005594", LogoURL: "https://icon.horse/icon/cnbc.com",
		Description: "Markets, business and finance headlines.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "CNBC Top News", "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"},
		}},
		Usage: usageNews,
		About: "Markets, business, and finance headlines from CNBC.",
	},
	{
		ID: "news_nasa", Name: "NASA", Category: "news", Source: "rss",
		Color: "#0b3d91", LogoURL: "https://icon.horse/icon/nasa.gov",
		Description: "Space, science and mission news from NASA.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "NASA Breaking News", "url": "https://www.nasa.gov/news-release/feed/"},
		}},
		Usage: usageNews,
		About: "Space, science, and mission news straight from NASA.",
	},
	{
		ID: "news_hackernews", Name: "Hacker News", Category: "news", Source: "rss",
		Color: "#ff6600", LogoURL: "https://icon.horse/icon/news.ycombinator.com",
		Description: "Top stories from the Hacker News front page.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "Hacker News", "url": "https://hnrss.org/frontpage"},
		}},
		Usage: usageNews,
		About: "Top stories from the Hacker News front page — tech, startups, and programming.",
	},
	{
		ID: "news_theverge", Name: "The Verge", Category: "news", Source: "rss",
		Color: "#5200ff", LogoURL: "https://icon.horse/icon/theverge.com",
		Description: "Technology, science, art and culture.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "The Verge", "url": "https://www.theverge.com/rss/index.xml"},
		}},
		Usage: usageNews,
		About: "Technology, science, art, and culture from The Verge.",
	},
	{
		ID: "rss_custom", Name: "Custom RSS", Category: "news", Source: "rss",
		Color: "#ee802f",
		Description:   "Follow any RSS or Atom feed by pasting its URL.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{}},
		About:         "Bring your own feeds. Paste any RSS or Atom URL and Scrollr streams its latest items alongside everything else.",
		Usage: []string{
			"Paste any RSS or Atom feed URL in the Feeds view.",
			"Add as many feeds as you like — they merge into one stream.",
			"Perfect for niche blogs, newsletters, or subreddits with a feed.",
		},
	},

	// ── Fantasy, Predictions ───────────────────────────────────────────
	{
		// The tier gate was retired in v1.1.2 — the slot is the only lever.
		ID: "fantasy_yahoo", Name: "Yahoo Fantasy", Category: "fantasy", Source: "fantasy",
		Color: "#6001d2", LogoURL: "https://icon.horse/icon/yahoo.com",
		Description: "Your Yahoo Fantasy leagues, matchups, and standings.",
		About:       "Your Yahoo Fantasy leagues in the ticker — live scoring, matchups, and standings without ever opening the app.",
		Usage: []string{
			"Connect your Yahoo account from the top bar.",
			"Leagues, matchups, and standings sync automatically.",
			"Live scoring updates while your players are on the field.",
		},
	},
	{
		// icon.horse returns a blank image for kalshi.com; pinned like UFC.
		ID: "predictions", Name: "Kalshi", Category: "predictions", Source: "predictions",
		Color: "#1fc9a0",
		LogoURL:     "https://icons.duckduckgo.com/ip3/kalshi.com.ico",
		Description: "Live odds from the Kalshi prediction market.",
		About:       "Live odds from Kalshi, the regulated US prediction market — a real-time read on elections, economic prints, and the events in the news.",
		Usage: []string{
			"Live market odds update as money moves.",
			"Follow the events and questions you care about.",
			"Display-only — Scrollr shows the market, it never places a trade.",
		},
	},

	// ── Utilities — local-only, no data source, but still cost a slot ───
	{
		ID: "clock", Name: "Clock", Category: "utility", Color: "#6366f1",
		Description: "Local time and world clocks",
	},
	{
		ID: "timer", Name: "Timer", Category: "utility", Color: "#f59e0b",
		Description: "Pomodoro, countdown, and stopwatch tools",
	},
	{
		ID: "weather", Name: "Weather", Category: "utility", Color: "#0ea5e9",
		Description: "Current conditions for your locations",
	},
	{
		ID: "sysmon", Name: "System Monitor", Category: "utility", Color: "#06b6d4",
		Description: "Live CPU, memory, and GPU stats",
	},
	{
		ID: "uptime", Name: "Uptime", Category: "utility", Color: "#10b981",
		Description: "Monitor status from Uptime Kuma",
		LogoURL:     "https://icon.horse/icon/uptime.kuma.pet",
	},
	{
		ID: "github", Name: "GitHub", Category: "utility", Color: "#f97316",
		Description: "CI/Actions status for your repos",
		LogoURL:     "https://icon.horse/icon/github.com",
	},
}

// widgetByID indexes the catalog for O(1) lookup. It also stamps Order from
// declaration position and defaults RequiredTier, so the entries above stay
// readable and the catalog file is the single place that decides order.
var widgetByID = func() map[string]WidgetDef {
	m := make(map[string]WidgetDef, len(catalog))
	for i := range catalog {
		catalog[i].Order = i
		if catalog[i].RequiredTier == "" {
			catalog[i].RequiredTier = "free"
		}
		if _, dup := m[catalog[i].ID]; dup {
			panic("duplicate widget id in catalog: " + catalog[i].ID)
		}
		m[catalog[i].ID] = catalog[i]
	}
	return m
}()

// Catalog returns the full widget catalog in display order. Served by
// GET /catalog; clients cache it and fall back to a bundled snapshot offline.
func Catalog() []WidgetDef { return catalog }

// WidgetByID returns a catalog entry, if it exists.
func WidgetByID(id string) (WidgetDef, bool) {
	def, ok := widgetByID[id]
	return def, ok
}

// widgetSourcePrefixes maps a widget-id prefix to its backing data source, so
// ids the catalog does not enumerate (a sports league added server-side, a
// user's own feed widget) still route to the right ingester.
var widgetSourcePrefixes = map[string]string{
	"sports_":  "sports",
	"finance_": "finance",
	"fantasy_": "fantasy",
	"news_":    "rss",
	"rss_":     "rss",
}

// DataSourceForWidget returns the backing data source for a widget id.
// Resolution order: catalog entry → source prefix → "" (unknown, or a utility
// with no data source). Subscription code switches on this so it never
// hardcodes a source name.
func DataSourceForWidget(widgetType string) string {
	if def, ok := widgetByID[widgetType]; ok {
		return def.Source
	}
	for prefix, src := range widgetSourcePrefixes {
		if len(widgetType) > len(prefix) && strings.HasPrefix(widgetType, prefix) {
			return src
		}
	}
	return ""
}

// IsKnownWidgetType reports whether a widget id is acceptable on create:
// anything in the catalog, plus anything resolving to a known source via
// prefix. A bare prefix with no suffix ("sports_") is rejected.
func IsKnownWidgetType(widgetType string) bool {
	if _, ok := widgetByID[widgetType]; ok {
		return true
	}
	return DataSourceForWidget(widgetType) != ""
}

// IsUtilityWidgetType reports whether a widget id is a local-only utility.
// Utilities live in desktop preferences, not user_widgets — CreateWidget
// rejects them so they cannot double-count against the slot cap (once as a
// row, once via local_widgets).
func IsUtilityWidgetType(widgetType string) bool {
	def, ok := widgetByID[widgetType]
	return ok && def.Source == ""
}
