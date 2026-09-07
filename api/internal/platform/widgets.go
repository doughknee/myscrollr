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

	// Hidden keeps a widget out of the catalog's add grid without removing
	// it: existing rows still resolve by id, still render, still count
	// against slots. For turning something off "for now" without stranding
	// the people who already have it.
	Hidden bool `json:"hidden,omitempty"`

	// Group is the sub-shelf inside a category the directory files this
	// under ("Football", "Soccer", "Business", "Dev"). Optional: a widget
	// without one lists ungrouped. Categories past ~8 entries should carry
	// groups (design_handoff_catalog, "Growth rules").
	Group string `json:"group,omitempty"`

	// Keywords are search aliases that never appear on screen but join the
	// match haystack with name, description, group and category — so
	// "btc" finds Crypto and "epl" finds the Premier League.
	Keywords []string `json:"keywords,omitempty"`

	// AddedAt is the ISO date (YYYY-MM-DD) the entry shipped, driving the
	// "new" tag and the New-this-month strip (30-day window). Dates are the
	// release that carried the entry; widgets older than the catalog itself
	// carry the catalog's own launch (v1.1.0). Day precision is best-effort.
	AddedAt string `json:"added_at,omitempty"`
}

// Release dates for AddedAt — the desktop tag that carried the entry.
const (
	addedV110  = "2026-07-02" // v1.1.0: the catalog itself; every widget that predates it
	addedV1110 = "2026-07-21" // v1.1.10: the sports and news expansion
	addedV152  = "2026-09-05" // v1.5.2
	// The Ultra-plan league expansion (REL-220). The desktop release that
	// carries it had not been cut when this was written, so the day is the
	// PR's date rather than a tag's.
	addedV170 = "2026-09-06"
)

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
		Group: "Markets", AddedAt: addedV110,
		Keywords:      []string{"shares", "etf", "s&p", "nasdaq", "dow", "tickers"},
		Color:         "#16a34a",
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
		Group: "Markets", AddedAt: addedV110,
		Keywords:      []string{"bitcoin", "btc", "eth", "ethereum", "solana", "coins"},
		Color:         "#f7931a",
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
		Group: "Football", AddedAt: addedV110,
		Keywords: []string{"football"},
		Color:    "#013369", LogoURL: "https://icon.horse/icon/nfl.com",
		Description:   "Live NFL scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"NFL"}}, Usage: usageTeamSport,
		About: "Live NFL scores, quarters, and game clock for every matchup on the slate. Follow the whole week or zero in on your team.",
	},
	{
		ID: "sports_nba", Name: "NBA", Category: "sports", Source: "sports",
		Group: "Basketball", AddedAt: addedV110,
		Keywords: []string{"basketball"},
		Color:    "#c9082a", LogoURL: "https://icon.horse/icon/nba.com",
		Description:   "Live NBA scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"NBA"}}, Usage: usageTeamSport,
		About: "Live NBA scores and game state across the association — every quarter, every buzzer-beater, as it happens.",
	},
	{
		ID: "sports_nhl", Name: "NHL", Category: "sports", Source: "sports",
		Group: "Hockey", AddedAt: addedV110,
		Keywords: []string{"hockey"},
		Color:    "#111827", LogoURL: "https://icon.horse/icon/nhl.com",
		Description:   "Live NHL scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"NHL"}}, Usage: usageTeamSport,
		About: "Live NHL scores and period-by-period game state for every game on the ice.",
	},
	{
		ID: "sports_mlb", Name: "MLB", Category: "sports", Source: "sports",
		Group: "Baseball", AddedAt: addedV110,
		Keywords: []string{"baseball"},
		Color:    "#002d72", LogoURL: "https://icon.horse/icon/mlb.com",
		Description:   "Live MLB scores and game states.",
		DefaultConfig: map[string]any{"leagues": []string{"MLB"}}, Usage: usageTeamSport,
		About: "Live MLB scores, innings, and game state across the league, all season long.",
	},
	{
		ID: "sports_f1", Name: "F1", Category: "sports", Source: "sports",
		Group: "Motorsport", AddedAt: addedV110,
		Keywords: []string{"formula 1", "formula one", "grand prix"},
		Color:    "#e10600", LogoURL: "https://icon.horse/icon/formula1.com",
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
		Group: "Soccer", AddedAt: addedV110,
		Keywords: []string{"fifa", "soccer", "football"},
		Color:    "#2e7d46", LogoURL: "https://icon.horse/icon/fifa.com",
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
		Group: "Football", AddedAt: addedV1110,
		Keywords: []string{"college football", "cfb"},
		Color:    "#0b427a", LogoURL: "https://icon.horse/icon/ncaa.com",
		Description:   "Live college football scores across the FBS.",
		DefaultConfig: map[string]any{"leagues": []string{"NCAA Football"}}, Usage: usageTeamSport,
		About: "Live college football scores across the FBS — Saturday slates, rivalry week, and bowl season.",
	},
	{
		ID: "sports_ncaab", Name: "NCAA Basketball", Category: "sports", Source: "sports",
		Group: "Basketball", AddedAt: addedV1110,
		Keywords: []string{"college basketball", "march madness"},
		Color:    "#d2691e", LogoURL: "https://icon.horse/icon/ncaa.com",
		Description:   "Live college basketball scores and the road to March.",
		DefaultConfig: map[string]any{"leagues": []string{"NCAA Basketball"}}, Usage: usageTeamSport,
		About: "Live college basketball scores through conference play and all the way into March Madness.",
	},
	{
		ID: "sports_premierleague", Name: "Premier League", Category: "sports", Source: "sports",
		Group: "Soccer", AddedAt: addedV1110,
		Keywords: []string{"epl", "english", "soccer", "football"},
		Color:    "#37003c", LogoURL: "https://icon.horse/icon/premierleague.com",
		Description:   "Live scores from England's Premier League.",
		DefaultConfig: map[string]any{"leagues": []string{"Premier League"}}, Usage: usageTeamSport,
		About: "Live scores from England's Premier League — all 20 clubs, every matchweek.",
	},
	{
		ID: "sports_laliga", Name: "La Liga", Category: "sports", Source: "sports",
		Group: "Soccer", AddedAt: addedV1110,
		Keywords: []string{"spanish", "soccer"},
		Color:    "#e2001a", LogoURL: "https://icon.horse/icon/laliga.com",
		Description:   "Live scores from Spain's La Liga.",
		DefaultConfig: map[string]any{"leagues": []string{"La Liga"}}, Usage: usageTeamSport,
		About: "Live scores from Spain's La Liga, from the title race to the relegation scrap.",
	},
	{
		ID: "sports_mls", Name: "MLS", Category: "sports", Source: "sports",
		Group: "Soccer", AddedAt: addedV1110,
		Keywords: []string{"american", "soccer"},
		Color:    "#001838", LogoURL: "https://icon.horse/icon/mlssoccer.com",
		Description:   "Live Major League Soccer scores.",
		DefaultConfig: map[string]any{"leagues": []string{"MLS"}}, Usage: usageTeamSport,
		About: "Live Major League Soccer scores across the Eastern and Western conferences.",
	},
	{
		ID: "sports_championsleague", Name: "Champions League", Category: "sports", Source: "sports",
		Group: "Soccer", AddedAt: addedV1110,
		Keywords: []string{"ucl", "uefa", "europe"},
		Color:    "#0e1e5b", LogoURL: "https://icon.horse/icon/uefa.com",
		Description:   "Live UEFA Champions League scores.",
		DefaultConfig: map[string]any{"leagues": []string{"Champions League"}}, Usage: usageTeamSport,
		About: "Live UEFA Champions League scores through the league phase and into the knockout rounds.",
	},
	{
		// icon.horse returns a blank image for ufc.com, so this is pinned to
		// DuckDuckGo's icon CDN, which serves the real opaque wordmark.
		ID: "sports_ufc", Name: "UFC", Category: "sports", Source: "sports",
		Group: "Combat", AddedAt: addedV1110,
		Keywords: []string{"mma", "fights"},
		Color:    "#d20a0a", LogoLight: true,
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
		Group: "Football", AddedAt: addedV1110,
		Keywords: []string{"aussie rules", "australian football"},
		Color:    "#003da5", LogoURL: "https://icon.horse/icon/afl.com.au",
		Description:   "Live Australian Football League scores.",
		DefaultConfig: map[string]any{"leagues": []string{"AFL"}}, Usage: usageTeamSport,
		About: "Live Australian Football League scores across the home-and-away season and finals.",
	},

	// Colours below are measured from each league's own mark (the modal
	// colour of its favicon or official logo), never picked by hand.
	{
		ID: "sports_bundesliga", Name: "Bundesliga", Category: "sports", Source: "sports",
		Group: "Soccer", AddedAt: addedV170,
		Keywords: []string{"german", "germany", "soccer", "football"},
		Color:    "#d20515", LogoURL: "https://icon.horse/icon/bundesliga.com",
		Description:   "Live scores from Germany's Bundesliga.",
		DefaultConfig: map[string]any{"leagues": []string{"Bundesliga"}}, Usage: usageTeamSport,
		About: "Live scores from Germany's Bundesliga — all 18 clubs, every matchday.",
	},
	{
		ID: "sports_seriea", Name: "Serie A", Category: "sports", Source: "sports",
		Group: "Soccer", AddedAt: addedV170,
		Keywords: []string{"italian", "italy", "soccer", "football"},
		Color:    "#0473ff", LogoURL: "https://icon.horse/icon/legaseriea.it",
		Description:   "Live scores from Italy's Serie A.",
		DefaultConfig: map[string]any{"leagues": []string{"Serie A"}}, Usage: usageTeamSport,
		About: "Live scores from Italy's Serie A, from the Scudetto race to the relegation fight.",
	},
	{
		ID: "sports_ligue1", Name: "Ligue 1", Category: "sports", Source: "sports",
		Group: "Soccer", AddedAt: addedV170,
		Keywords: []string{"french", "france", "soccer", "football"},
		Color:    "#085fff", LogoURL: "https://icon.horse/icon/ligue1.com",
		Description:   "Live scores from France's Ligue 1.",
		DefaultConfig: map[string]any{"leagues": []string{"Ligue 1"}}, Usage: usageTeamSport,
		About: "Live scores from France's Ligue 1, every matchday of the season.",
	},
	{
		// icon.horse returns its letter placeholder for every EuroLeague
		// domain, so this is pinned to Google's favicon service, which serves
		// the orange mark.
		ID: "sports_euroleague", Name: "EuroLeague", Category: "sports", Source: "sports",
		Group: "Basketball", AddedAt: addedV170,
		Keywords:      []string{"europe", "european", "basketball"},
		Color:         "#fa5500",
		LogoURL:       "https://www.google.com/s2/favicons?domain=euroleague.net&sz=128",
		Description:   "Live EuroLeague basketball scores.",
		DefaultConfig: map[string]any{"leagues": []string{"EuroLeague"}}, Usage: usageTeamSport,
		About: "Live EuroLeague scores through the regular season, the play-ins and playoffs, and the Final Four.",
	},
	{
		ID: "sports_khl", Name: "KHL", Category: "sports", Source: "sports",
		Group: "Hockey", AddedAt: addedV170,
		Keywords: []string{"kontinental", "russia", "russian", "hockey"},
		Color:    "#17272c", LogoURL: "https://icon.horse/icon/khl.ru",
		Description:   "Live Kontinental Hockey League scores.",
		DefaultConfig: map[string]any{"leagues": []string{"KHL"}}, Usage: usageTeamSport,
		About: "Live KHL scores and period-by-period game state across the Kontinental Hockey League.",
	},
	{
		ID: "sports_npb", Name: "NPB", Category: "sports", Source: "sports",
		Group: "Baseball", AddedAt: addedV170,
		Keywords: []string{"japan", "japanese", "nippon", "baseball"},
		Color:    "#0091db", LogoURL: "https://icon.horse/icon/npb.jp",
		Description:   "Live Nippon Professional Baseball scores.",
		DefaultConfig: map[string]any{"leagues": []string{"NPB"}}, Usage: usageTeamSport,
		About: "Live NPB scores and innings across the Central and Pacific Leagues, Japan Series included.",
	},
	{
		ID: "sports_sixnations", Name: "Six Nations", Category: "sports", Source: "sports",
		Group: "Rugby", AddedAt: addedV170,
		Keywords: []string{"rugby", "rugby union", "6n"},
		Color:    "#0d1c1c", LogoURL: "https://icon.horse/icon/sixnationsrugby.com",
		Description:   "Live Six Nations rugby scores.",
		DefaultConfig: map[string]any{"leagues": []string{"Six Nations"}}, Usage: usageTeamSport,
		About: "Live Six Nations scores — five rounds every spring between England, France, Ireland, Italy, Scotland and Wales.",
	},
	{
		ID: "sports_superrugby", Name: "Super Rugby", Category: "sports", Source: "sports",
		Group: "Rugby", AddedAt: addedV170,
		Keywords: []string{"rugby", "rugby union", "pacific", "australia", "new zealand"},
		Color:    "#00245d", LogoURL: "https://icon.horse/icon/super.rugby",
		Description:   "Live Super Rugby Pacific scores.",
		DefaultConfig: map[string]any{"leagues": []string{"Super Rugby"}}, Usage: usageTeamSport,
		About: "Live Super Rugby scores from Australia, New Zealand and the Pacific, through the regular season and the finals.",
	},
	{
		ID: "sports_premrugby", Name: "Premiership Rugby", Category: "sports", Source: "sports",
		Group: "Rugby", AddedAt: addedV170,
		Keywords: []string{"rugby", "rugby union", "english", "england", "gallagher"},
		Color:    "#2a2b6b", LogoURL: "https://icon.horse/icon/premiershiprugby.com",
		Description:   "Live scores from England's Premiership Rugby.",
		DefaultConfig: map[string]any{"leagues": []string{"Premiership Rugby"}}, Usage: usageTeamSport,
		About: "Live Premiership Rugby scores — England's top flight, every round through to the final.",
	},
	{
		ID: "sports_handballcl", Name: "Handball Champions League", Category: "sports", Source: "sports",
		Group: "Handball", AddedAt: addedV170,
		Keywords: []string{"handball", "ehf", "europe"},
		Color:    "#001432", LogoURL: "https://icon.horse/icon/ehfcl.eurohandball.com",
		Description:   "Live EHF Champions League handball scores.",
		DefaultConfig: map[string]any{"leagues": []string{"Handball Champions League"}}, Usage: usageTeamSport,
		About: "Live EHF Champions League scores through the group phase, the playoffs and the Final4.",
	},
	{
		ID: "sports_hbl", Name: "Handball Bundesliga", Category: "sports", Source: "sports",
		Group: "Handball", AddedAt: addedV170,
		Keywords: []string{"handball", "german", "germany", "hbl"},
		Color:    "#1d2f56", LogoURL: "https://icon.horse/icon/liquimoly-hbl.de",
		Description:   "Live scores from Germany's Handball-Bundesliga.",
		DefaultConfig: map[string]any{"leagues": []string{"Handball Bundesliga"}}, Usage: usageTeamSport,
		About: "Live Handball-Bundesliga scores — Germany's top flight, every matchday.",
	},
	{
		ID: "sports_starligue", Name: "Starligue", Category: "sports", Source: "sports",
		Group: "Handball", AddedAt: addedV170,
		Keywords: []string{"handball", "french", "france", "lnh"},
		Color:    "#e42027", LogoURL: "https://icon.horse/icon/lnh.fr",
		Description:   "Live scores from France's Starligue.",
		DefaultConfig: map[string]any{"leagues": []string{"Starligue"}}, Usage: usageTeamSport,
		About: "Live Starligue scores — France's top handball division, every round.",
	},
	{
		ID: "sports_volleyballcl", Name: "Volleyball Champions League", Category: "sports", Source: "sports",
		Group: "Volleyball", AddedAt: addedV170,
		Keywords: []string{"volleyball", "cev", "europe"},
		Color:    "#0000ff", LogoURL: "https://icon.horse/icon/championsleague.cev.eu",
		Description:   "Live CEV Champions League volleyball scores.",
		DefaultConfig: map[string]any{"leagues": []string{"Volleyball Champions League"}}, Usage: usageTeamSport,
		About: "Live CEV Champions League scores, set by set, through the pools and the knockout rounds.",
	},
	{
		ID: "sports_vnl", Name: "Volleyball Nations League", Category: "sports", Source: "sports",
		Group: "Volleyball", AddedAt: addedV170,
		Keywords: []string{"volleyball", "vnl", "fivb", "nations"},
		Color:    "#bbeb00", LogoURL: "https://icon.horse/icon/volleyballworld.com",
		Description:   "Live Volleyball Nations League scores.",
		DefaultConfig: map[string]any{"leagues": []string{"Volleyball Nations League"}}, Usage: usageTeamSport,
		About: "Live Volleyball Nations League scores, set by set, from the preliminary rounds to the finals.",
	},

	// ── News — curated feeds, each its own widget over the rss source ───
	{
		ID: "news_bbc", Name: "BBC News", Category: "news", Source: "rss",
		Group: "World", AddedAt: addedV110,
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
		Group: "World", AddedAt: addedV1110,
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
		Group: "World", AddedAt: addedV1110,
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
		Group: "World", AddedAt: addedV1110,
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
		Group: "World", AddedAt: addedV1110,
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
		Group: "Business", AddedAt: addedV1110,
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
		Group: "Business", AddedAt: addedV1110,
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
		Group: "Tech & Science", AddedAt: addedV1110,
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
		Group: "Tech & Science", AddedAt: addedV110,
		Keywords: []string{"hn", "ycombinator", "tech", "startups"},
		Color:    "#ff6600", LogoURL: "https://icon.horse/icon/news.ycombinator.com",
		Description: "Top stories from the Hacker News front page.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "Hacker News", "url": "https://hnrss.org/frontpage"},
		}},
		Usage: usageNews,
		About: "Top stories from the Hacker News front page — tech, startups, and programming.",
	},
	{
		ID: "news_theverge", Name: "The Verge", Category: "news", Source: "rss",
		Group: "Tech & Science", AddedAt: addedV1110,
		Color: "#5200ff", LogoURL: "https://icon.horse/icon/theverge.com",
		Description: "Technology, science, art and culture.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "The Verge", "url": "https://www.theverge.com/rss/index.xml"},
		}},
		Usage: usageNews,
		About: "Technology, science, art, and culture from The Verge.",
	},
	{
		ID: "news_drudge", Name: "Drudge Report", Category: "news", Source: "rss",
		Group: "World", AddedAt: addedV152,
		Color: "#4b5563", LogoURL: "https://icon.horse/icon/drudgereport.com", LogoLight: true,
		Description: "The Drudge Report's headline links, as they post.",
		DefaultConfig: map[string]any{"feeds": []map[string]string{
			{"name": "Drudge Report", "url": "https://feeds.feedburner.com/DrudgeReportFeed"},
		}},
		Usage: usageNews,
		About: "Matt Drudge's link aggregator, headline by headline. The feed carries the site's link list as it updates.",
	},
	{
		// Off the add grid for now (2026-09-05) -- the feeds view and its
		// flood behaviour need another pass. Anyone who already has it keeps it.
		ID: "rss_custom", Name: "Custom RSS", Category: "news", Source: "rss", Hidden: true,
		AddedAt:       addedV110,
		Color:         "#ee802f",
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
		Group: "Fantasy", AddedAt: addedV110,
		Keywords: []string{"fantasy football", "league"},
		Color:    "#6001d2", LogoURL: "https://icon.horse/icon/yahoo.com",
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
		Group: "Predictions", AddedAt: addedV110,
		Keywords:    []string{"odds", "prediction market", "bets"},
		Color:       "#1fc9a0",
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
		Group: "Desk", AddedAt: addedV110,
		Keywords:    []string{"time", "timezone", "world clock"},
		Description: "Local time and world clocks",
	},
	{
		ID: "timer", Name: "Timer", Category: "utility", Color: "#f59e0b",
		Group: "Desk", AddedAt: addedV110,
		Keywords:    []string{"pomodoro", "stopwatch", "countdown"},
		Description: "Pomodoro, countdown, and stopwatch tools",
	},
	{
		ID: "weather", Name: "Weather", Category: "utility", Color: "#0ea5e9",
		Group: "Desk", AddedAt: addedV110,
		Keywords:    []string{"forecast", "temperature", "rain"},
		Description: "Current conditions for your locations",
	},
	{
		ID: "sysmon", Name: "System Monitor", Category: "utility", Color: "#06b6d4",
		Group: "Dev", AddedAt: addedV110,
		Keywords:    []string{"cpu", "gpu", "ram", "memory"},
		Description: "Live CPU, memory, and GPU stats",
	},
	{
		ID: "uptime", Name: "Uptime", Category: "utility", Color: "#10b981",
		Group: "Dev", AddedAt: addedV110,
		Keywords:    []string{"kuma", "status", "monitor"},
		Description: "Monitor status from Uptime Kuma",
		LogoURL:     "https://icon.horse/icon/uptime.kuma.pet",
	},
	{
		ID: "github", Name: "GitHub", Category: "utility", Color: "#f97316",
		Group: "Dev", AddedAt: addedV110,
		Keywords:    []string{"actions", "ci", "pull requests"},
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
