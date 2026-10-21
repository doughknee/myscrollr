package support

import (
	"context"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
)

func TestSupportPopulationScopesQueueTrendsProvenanceAndMedians(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	now := time.Now().UTC()
	testsupport.MustExec(t, `DELETE FROM stripe_customers`)
	testsupport.MustExec(t, `DELETE FROM presence_session_hourly`)
	testsupport.MustExec(t, `INSERT INTO stripe_customers(logto_sub,stripe_customer_id,plan,status)
		VALUES ('pop-win','cus_win','monthly','active'),('pop-mac','cus_mac','monthly','active')`)
	testsupport.MustExec(t, `INSERT INTO product_analytics_enrollments(logto_sub) VALUES ('pop-win'),('pop-mac') ON CONFLICT DO NOTHING`)
	testsupport.MustExec(t, `INSERT INTO presence_session_hourly(logto_sub,session_id,hour,os,app_version)
		VALUES ('pop-win','win',date_trunc('hour',$1::timestamptz),'windows','v1'),
		       ('pop-mac','mac',date_trunc('hour',$1::timestamptz),'macos','v1')`, now.Add(-time.Hour))
	testsupport.MustExec(t, `INSERT INTO support_cases(ticket_number,subject,status,opened_at,updated_at,logto_sub,account_source)
		VALUES ('pop-1','Windows','open',$1,$1,'pop-win','authenticated'),
		       ('pop-2','Mac','open',$1,$1,'pop-mac','authenticated'),
		       ('pop-3','Unverified Windows identity','open',$1,$1,'pop-win','email')`, now.Add(-24*time.Hour))
	testsupport.MustExec(t, `INSERT INTO support_messages(ticket_number,kind,body_text,created_at)
		VALUES ('pop-1','user','question',$1),('pop-1','sent','reply',$1::timestamptz+interval '2 hours'),
		       ('pop-2','user','question',$1),('pop-2','sent','reply',$1::timestamptz+interval '10 hours')`, now.Add(-24*time.Hour))
	testsupport.MustExec(t, `INSERT INTO support_drafts(ticket_number,user_email,original_subject,draft_body_html,status,disposition,sent_at)
		VALUES ('pop-1','fixture@example.test','x','x','sent','auto_send',$1),
		       ('pop-2','fixture@example.test','x','x','sent','auto_send',$1)`, now.Add(-time.Hour))
	ctx, _ := platform.WithAnalyticsPopulation(context.Background(), "windows", "v1", "monthly")
	period, _ := platform.ParsePeriod("7d", now)
	out, err := loadSupportSummary(ctx, period, now)
	if err != nil {
		t.Fatal(err)
	}
	if out.Total.Total != 1 || out.Created.Value != 1 || out.Cases != 1 || out.PayingCreated != 1 || out.RepliedByBot != 1 {
		t.Fatalf("mixed populations in summary: %+v", out)
	}
	if !out.FirstResponseMedianHours.Available || out.FirstResponseMedianHours.Value != 2 {
		t.Fatalf("unfiltered response median: %+v", out.FirstResponseMedianHours)
	}
	sum := float64(0)
	for _, bucket := range out.CreatedCurve {
		sum += bucket.Value
	}
	if sum != 1 {
		t.Fatalf("created curve sum=%v", sum)
	}
}
