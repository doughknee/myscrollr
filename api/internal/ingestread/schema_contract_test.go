package ingestread

import (
	"context"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// Every read query in this package, executed against the real schema.
//
// These are the queries that turn stored rows into what a user sees, and
// nothing else checks them. They are string literals, so a column rename in
// api/migrations compiles perfectly and fails only when the query runs — at
// which point the failure is nearly invisible: the read path logs and returns
// an empty slice, which is indistinguishable from "this user has no data".
// The widget renders empty, /health stays green, and the only symptom is a
// feed that quietly stopped having anything in it.
//
// So the assertion is deliberately weak on data and strict on execution: an
// empty database is fine, an error is not. Every query must still be valid
// SQL against the schema core actually creates.
//
// Skips without TEST_DATABASE_URL. CI provides one.
func TestReadQueriesMatchTheSchema(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	ctx := context.Background()

	// A user with no widgets. The per-user queries should return empty, not
	// error — that path is the one that runs on every dashboard request.
	const noSuchUser = "logto|schema-contract-probe"

	t.Run("finance", func(t *testing.T) {
		if _, err := queryTrades(ctx); err != nil {
			t.Errorf("queryTrades: %v", err)
		}
		queryTradesBySymbols(ctx, []string{"AAPL"})
		getUserFinanceSymbols(ctx, noSuchUser)
	})

	t.Run("sports", func(t *testing.T) {
		if _, err := querySportsGames(ctx, 20, nil); err != nil {
			t.Errorf("querySportsGames: %v", err)
		}
		if _, err := queryGamesByLeagues(ctx, []string{"NFL"}, 20, nil, false); err != nil {
			t.Errorf("queryGamesByLeagues: %v", err)
		}
		// fairShare = true takes a different SQL path (the side-split CTE).
		if _, err := queryGamesByLeagues(ctx, []string{"NFL"}, 20, nil, true); err != nil {
			t.Errorf("queryGamesByLeagues fairShare: %v", err)
		}
		if _, err := loadLeagueStatus(ctx, []string{"NFL"}); err != nil {
			t.Errorf("loadLeagueStatus: %v", err)
		}
		loadLeagueMeta(ctx, []string{"NFL"})
		getUserSportsLeagues(ctx, noSuchUser)
		getUserFavoriteTeams(ctx, noSuchUser)
	})

	t.Run("rss", func(t *testing.T) {
		if _, err := queryUserCatalog(ctx, noSuchUser, false); err != nil {
			t.Errorf("queryUserCatalog: %v", err)
		}
		if _, err := queryUserCatalog(ctx, noSuchUser, true); err != nil {
			t.Errorf("queryUserCatalog includeFailing: %v", err)
		}
		getUserRSSFeedURLs(ctx, noSuchUser)
		queryRSSItems(ctx, []string{"https://example.com/feed.xml"})
	})

	t.Run("predictions", func(t *testing.T) {
		if _, err := queryMarkets(ctx); err != nil {
			t.Errorf("queryMarkets: %v", err)
		}
		queryMarketsForUser(ctx, []string{"KXPROBE"}, []string{"Politics"})
	})
}
