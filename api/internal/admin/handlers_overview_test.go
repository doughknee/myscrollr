package admin

import (
	"context"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

// The freshness card reads a different column per table, and a wrong name is
// invisible in production: the query errors into the log and the row falls
// through as "no data", which reads as a dead ingester rather than a bug.
// That is exactly what trades did (SCROLLR-214). This asks the database
// whether each configured column is really there, so a rename fails CI.
func TestIngestColumnsExist(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	for _, tbl := range ingestTables {
		t.Run(tbl.Table, func(t *testing.T) {
			if _, err := platform.DBPool.Exec(context.Background(),
				"SELECT "+tbl.Column+" FROM "+tbl.Table+" LIMIT 0"); err != nil {
				t.Fatalf("%s.%s: %v", tbl.Table, tbl.Column, err)
			}
		})
	}
}
