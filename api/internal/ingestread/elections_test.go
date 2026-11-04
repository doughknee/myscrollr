package ingestread

import (
	"context"
	"testing"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestElectionReaderScopesAndPreservesLastKnownResults(t *testing.T) {
	testsupport.DBAvailable(t)
	testsupport.MustExec(t, `DELETE FROM user_widgets WHERE widget_type='elections'; DELETE FROM election_results`)
	t.Cleanup(func() {
		testsupport.MustExec(t, `DELETE FROM user_widgets WHERE widget_type='elections'; DELETE FROM election_results`)
	})
	testsupport.MustExec(t, `INSERT INTO user_widgets (logto_sub,widget_type,config) VALUES ('observer','elections','{"race_ids":[87476]}'),('other','elections','{"race_ids":[]}')`)
	read := func(sub string) []ElectionResult {
		t.Helper()
		rows, err := followedElectionResults(context.Background(), sub)
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	if got := read("other"); len(got) != 0 {
		t.Fatal(got)
	}
	if rows := read("observer"); len(rows) != 1 || rows[0].ID != 87476 || rows[0].SourceUpdatedAt != nil || rows[0].Delayed {
		t.Fatal(rows)
	}
	testsupport.MustExec(t, `INSERT INTO election_results (race_id,snapshot,source_updated_at,next_poll_at,verified_until) VALUES (87476,
	  '{"id":87476,"name":"Tennessee Governor","state":"TN","election_date":"2026-11-03","disputed":false,"percent_reporting":30,"source_updated_at":"2026-11-04T02:06:18Z","candidates":[{"id":1,"name":"Preview A","votes":31,"percent":51,"winner":false,"party":"Test"}]}',
	  '2026-11-04 02:06:18Z',now(),now()-interval '1 minute')`)
	if row := read("observer")[0]; !row.Delayed || row.Candidates[0].Votes != 31 || row.SourceUpdatedAt.Minute() != 6 {
		t.Fatal(row)
	}
	testsupport.MustExec(t, `UPDATE user_widgets SET enabled=false WHERE logto_sub='observer' AND widget_type='elections'`)
	if got := read("observer"); len(got) != 0 {
		t.Fatal(got)
	}
}
