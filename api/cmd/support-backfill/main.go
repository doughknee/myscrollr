// Command support-backfill fills support_cases + support_messages from
// osTicket (REL-243). Walks the scrollr-reply-api plugin's list/detail
// endpoints with the server's OSTICKET_API_KEY, links every existing
// support_drafts row, and is idempotent by osTicket entry id — run it
// twice and the counts don't move.
//
// The plugin key is IP-bound to the cluster egress, so this runs from
// inside the cluster: k8s/jobs/support-backfill.yaml. The same pass runs
// nightly in-process (support.StartSupportCaseReconciler) for tickets
// updated in the last 48 h.
//
// Usage:
//
//	go run ./cmd/support-backfill              # every ticket
//	go run ./cmd/support-backfill -since 48h   # only recently updated
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/brandon-relentnet/myscrollr/api/internal/support"
)

func main() {
	since := flag.Duration("since", 0, "only tickets osTicket updated within this window (0 = all)")
	flag.Parse()
	_ = godotenv.Load()

	platform.ConnectDB()
	defer platform.DBPool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	var from time.Time
	if *since > 0 {
		from = time.Now().Add(-*since)
	}
	stats, err := support.BackfillFromOSTicket(ctx, from)
	out, _ := json.Marshal(stats)
	fmt.Println(string(out))
	if err != nil {
		log.Fatalf("backfill: %v", err)
	}
	if stats.Errors > 0 {
		os.Exit(2)
	}
}
