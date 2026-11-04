package ingestread

import (
	"context"
	"encoding/json"
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
		rows, err := followedElectionResults(context.Background(), sub, true)
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
	  '{"id":87476,"name":"Tennessee Governor","state":"TN","election_date":"2026-11-03","disputed":false,"percent_reporting":30,"source_updated_at":"2026-11-04T04:06:18Z","candidates":[{"id":1,"name":"Preview A","votes":31,"percent":51,"winner":false,"party":"Test"}]}',
	  '2026-11-04 02:06:18Z',now(),now()-interval '1 minute')`)
	if row := read("observer")[0]; !row.Delayed || row.Candidates[0].Votes != 31 || row.SourceUpdatedAt.Minute() != 6 {
		t.Fatal(row)
	}
	testsupport.MustExec(t, `UPDATE user_widgets SET enabled=false WHERE logto_sub='observer' AND widget_type='elections'`)
	if got := read("observer"); len(got) != 0 {
		t.Fatal(got)
	}
}

func TestNationwideRowIsPrivateToNationalTicker(t *testing.T) {
	testsupport.DBAvailable(t)
	const sub = "nationwide-read-probe"
	testsupport.MustExec(t, "DELETE FROM user_widgets WHERE logto_sub=$1", sub)
	testsupport.MustExec(t, "DELETE FROM election_results WHERE race_id=87476")
	t.Cleanup(func() {
		testsupport.MustExec(t, "DELETE FROM user_widgets WHERE logto_sub=$1", sub)
		testsupport.MustExec(t, "DELETE FROM election_results WHERE race_id=87476")
	})
	testsupport.MustExec(t, `INSERT INTO user_widgets(logto_sub,widget_type,config) VALUES ($1,'elections','{"race_ids":[87476]}')`, sub)
	testsupport.MustExec(t, `INSERT INTO election_results
		(race_id, failures, next_poll_at, verified_until, directory_observed_at, directory_snapshot)
		VALUES (87476,2,now(),now()-interval '1 minute',now(),jsonb_build_object('observed_at',now(),'candidates',
		(SELECT jsonb_agg(c || jsonb_build_object('votes',(c->>'votes')::bigint + 1000))
		FROM jsonb_array_elements($1::jsonb) c)))`, mustCandidateJSON(t))
	for _, national := range []bool{true, false} {
		rows, err := followedElectionResults(context.Background(), sub, national)
		if err != nil || len(rows) != 1 {
			t.Fatal(err, rows)
		}
		if national {
			if rows[0].SnapshotKind != "directory_live" || rows[0].Delayed || rows[0].ObservedAt == nil {
				t.Fatal(rows)
			}
		} else if rows[0].ObservedAt != nil || !rows[0].Delayed {
			t.Fatal("legacy client received bulk results", rows)
		}
	}
}
func mustCandidateJSON(t *testing.T) string {
	t.Helper()
	loadElectionDirectory()
	data, err := json.Marshal(electionSeeds[87476].Candidates)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
