package events

import (
	"context"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// ClientCount() is per-replica, and core-api runs two (k8s/core-api.yaml).
// Reading it from a request gives you whichever pod the load balancer picked,
// so "connected now" silently reports about half the fleet — the failure is
// invisible because the number still looks plausible.
//
// Each replica therefore heartbeats its own count into one Redis hash keyed by
// pod name, and a reader sums the fields that are still fresh. One key, one
// round trip, and a pod that dies ages out instead of inflating the total
// forever.
const (
	fleetCountKey      = "scrollr:sse:fleet_counts"
	fleetCountInterval = 10 * time.Second
	// A field older than this belongs to a replica that stopped reporting.
	fleetCountStale = 45 * time.Second
)

// replicaName identifies this pod. Kubernetes sets HOSTNAME to the pod name.
func replicaName() string {
	if h := os.Getenv("HOSTNAME"); h != "" {
		return h
	}
	return "unknown"
}

// publishFleetCount heartbeats this replica's SSE client count until ctx ends.
func publishFleetCount(ctx context.Context) {
	name := replicaName()
	ticker := time.NewTicker(fleetCountInterval)
	defer ticker.Stop()

	write := func() {
		if platform.Rdb == nil {
			return
		}
		value := strconv.Itoa(ClientCount()) + ":" + strconv.FormatInt(time.Now().Unix(), 10)
		if err := platform.Rdb.HSet(ctx, fleetCountKey, name, value).Err(); err != nil {
			log.Printf("[EventHub] fleet count heartbeat failed: %v", err)
		}
	}

	write() // publish immediately so a fresh pod isn't invisible for 10s
	for {
		select {
		case <-ctx.Done():
			// Drop this replica's field on the way out rather than leaving a
			// stale count for the reader to age out.
			if platform.Rdb != nil {
				_ = platform.Rdb.HDel(context.Background(), fleetCountKey, name).Err()
			}
			return
		case <-ticker.C:
			write()
		}
	}
}

// FleetClientCount sums the SSE client counts every live replica reported,
// and returns how many replicas contributed. A caller showing the number must
// show the replica count too: one replica reporting when two are running means
// the total is understated, and the reader deserves to see that.
//
// Falls back to this replica's own count (and 1) when Redis is unavailable.
func FleetClientCount(ctx context.Context) (total int, replicas int) {
	if platform.Rdb == nil {
		return ClientCount(), 1
	}

	fields, err := platform.Rdb.HGetAll(ctx, fleetCountKey).Result()
	if err != nil {
		log.Printf("[EventHub] fleet count read failed: %v", err)
		return ClientCount(), 1
	}

	cutoff := time.Now().Add(-fleetCountStale).Unix()
	var stale []string
	for name, value := range fields {
		count, at, ok := parseFleetField(value)
		if !ok || at < cutoff {
			stale = append(stale, name)
			continue
		}
		total += count
		replicas++
	}

	// Self-cleaning: a replica that was scaled down stops being counted above
	// and stops occupying the hash here.
	if len(stale) > 0 {
		_ = platform.Rdb.HDel(ctx, fleetCountKey, stale...).Err()
	}

	if replicas == 0 {
		return ClientCount(), 1
	}
	return total, replicas
}

// parseFleetField splits a "<count>:<unix>" heartbeat value.
func parseFleetField(value string) (count int, at int64, ok bool) {
	sep := strings.LastIndex(value, ":")
	if sep < 0 {
		return 0, 0, false
	}
	count, err := strconv.Atoi(value[:sep])
	if err != nil {
		return 0, 0, false
	}
	at, err = strconv.ParseInt(value[sep+1:], 10, 64)
	if err != nil {
		return 0, 0, false
	}
	return count, at, true
}
