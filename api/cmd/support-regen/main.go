// Command support-regen re-runs triage on tickets the support bot has
// already seen (REL-246). Same work as the /regen slash command — a slash
// command can only be run by a person typing it, and the backlog this exists
// to clear had been waiting four months.
//
// Must run in-cluster: the reply goes out through the osTicket plugin, whose
// API key is bound to the cluster's egress IP, and the drafts land in the
// Discord queue with the bot's token. See k8s/jobs/support-regen.yaml.
//
// Usage:
//
//	./support-regen pending          # every draft sitting in 'pending'
//	./support-regen 486932 269765    # these tickets, drafted or not
//
// Every regenerated draft is an ordinary draft: it reaches its Discord thread
// with its disposition and its hold, and it sends itself when nobody
// intervenes. Read them before the hold expires.
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
	flag.Parse()
	tickets := flag.Args()
	if len(tickets) == 0 {
		log.Fatal("usage: support-regen <ticket>... | pending")
	}
	_ = godotenv.Load()

	platform.ConnectDB()
	defer platform.DBPool.Close()

	// Two model calls per ticket, plus a Discord post and a disposition.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	outcomes := support.RegenTickets(ctx, tickets)
	out, _ := json.Marshal(outcomes)
	fmt.Println(string(out))

	failed := 0
	for _, o := range outcomes {
		if !o.OK {
			failed++
		}
	}
	log.Printf("regenerated %d/%d", len(outcomes)-failed, len(outcomes))
	if failed == len(outcomes) {
		os.Exit(2)
	}
}
