package core

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stressEnvInt reads an integer knob from the environment, falling back to
// the given default. Lets the same test scale from a -race correctness run
// to a larger throughput run without code edits.
func stressEnvInt(name string, def int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

// TestHubStress is an opt-in concurrency soak for the SSE hub — the path
// that universal real-time (2026-06-30 widget/slot redesign) puts under
// every user instead of Ultimate-only. It exercises the register/unregister
// CAS loops, the topic registry, and the fan-out worker pool all at once:
//
//   - thousands of users with multiple SSE clients each
//   - producers hammering handleTopicMessage across the topic space
//   - churners registering/unregistering clients the whole time
//
// Run it with the race detector for correctness, without for throughput:
//
//	SSE_STRESS=1 go -C api test ./core/ -race -run TestHubStress -v
//	SSE_STRESS=1 SSE_STRESS_USERS=30000 SSE_STRESS_MSGS=1000000 \
//	  go -C api test ./core/ -run TestHubStress -v
//
// Skipped by default so CI stays fast. Survival without panic or deadlock
// is the primary assertion; clientCount returning to zero and the goroutine
// count returning to baseline guard leaks.
func TestHubStress(t *testing.T) {
	if os.Getenv("SSE_STRESS") == "" {
		t.Skip("set SSE_STRESS=1 to run the hub stress test")
	}
	_, cleanup := setupMiniRedis(t)
	defer cleanup()

	users := stressEnvInt("SSE_STRESS_USERS", 5000)
	clientsPerUser := stressEnvInt("SSE_STRESS_CLIENTS", 2)
	topicCount := stressEnvInt("SSE_STRESS_TOPICS", 200)
	messages := stressEnvInt("SSE_STRESS_MSGS", 200_000)
	const producers = 8
	const churners = 32

	baselineGoroutines := runtime.NumGoroutine()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	h := swapHub(t)
	h.dispatchCh = make(chan dispatchJob, SSEDispatchQueueSize)
	h.invalCh = make(chan string, SSEInvalidationQueueSize)
	for i := 0; i < SSEDispatchWorkers; i++ {
		go h.dispatchWorker(ctx)
	}
	for i := 0; i < SSEInvalidationWorkers; i++ {
		go h.invalidationWorker(ctx)
	}

	userID := func(i int) string { return fmt.Sprintf("stress-user-%d", i) }
	topicName := func(i int) string { return fmt.Sprintf("cdc:stress:topic-%d", i) }

	// ── Populate: register clients + topic subscriptions ────────────
	start := time.Now()
	var reg sync.WaitGroup
	sem := make(chan struct{}, 64) // bound concurrent registrars (race detector goroutine cap)
	clientsMu := sync.Mutex{}
	clients := make([]*Client, 0, users*clientsPerUser)
	for u := 0; u < users; u++ {
		reg.Add(1)
		sem <- struct{}{}
		go func(u int) {
			defer reg.Done()
			defer func() { <-sem }()
			uid := userID(u)
			for c := 0; c < clientsPerUser; c++ {
				cl := &Client{UserID: uid, Ch: make(chan []byte, SSEClientBufferSize)}
				h.register(cl)
				clientsMu.Lock()
				clients = append(clients, cl)
				clientsMu.Unlock()
			}
			// Each user watches 3 pseudo-random topics — overlapping sets so
			// fan-out hits many users per message like real league/symbol topics.
			for k := 0; k < 3; k++ {
				h.registry.subscribe(uid, topicName((u*7+k*13)%topicCount))
			}
		}(u)
	}
	reg.Wait()
	t.Logf("registered %d clients (%d users × %d) + subscriptions in %v",
		len(clients), users, clientsPerUser, time.Since(start))

	// ── Soak: producers fan out while churners add/remove clients ───
	start = time.Now()
	var sent atomic.Int64
	var wg sync.WaitGroup

	for p := 0; p < producers; p++ {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			payload := []byte(`{"stress":true}`)
			rng := rand.New(rand.NewSource(int64(p)))
			for sent.Add(1) <= int64(messages) {
				h.handleTopicMessage(topicName(rng.Intn(topicCount)), payload)
			}
		}(p)
	}

	churnStop := make(chan struct{})
	var churned atomic.Int64
	for c := 0; c < churners; c++ {
		wg.Add(1)
		go func(c int) {
			defer wg.Done()
			rng := rand.New(rand.NewSource(int64(1000 + c)))
			for {
				select {
				case <-churnStop:
					return
				default:
				}
				uid := userID(rng.Intn(users))
				cl := &Client{UserID: uid, Ch: make(chan []byte, 8)}
				h.register(cl)
				h.registry.subscribe(uid, topicName(rng.Intn(topicCount)))
				h.unregister(cl)
				churned.Add(1)
			}
		}(c)
	}

	// Let churners run for the duration of the producer burst.
	producerDone := make(chan struct{})
	go func() {
		// Wait for producers only: they exit once `sent` passes `messages`.
		for sent.Load() <= int64(messages) {
			time.Sleep(10 * time.Millisecond)
		}
		close(producerDone)
	}()
	<-producerDone
	close(churnStop)
	wg.Wait()
	elapsed := time.Since(start)
	t.Logf("soak: %d messages fanned out + %d churn cycles in %v (%.0f msg/s)",
		messages, churned.Load(), elapsed, float64(messages)/elapsed.Seconds())

	// ── Teardown: unregister everything, then check for leaks ───────
	start = time.Now()
	var unreg sync.WaitGroup
	for _, cl := range clients {
		unreg.Add(1)
		sem <- struct{}{}
		go func(cl *Client) {
			defer unreg.Done()
			defer func() { <-sem }()
			h.unregister(cl)
		}(cl)
	}
	unreg.Wait()
	t.Logf("unregistered %d clients in %v", len(clients), time.Since(start))

	if got := h.clientCount.Load(); got != 0 {
		t.Errorf("clientCount after full teardown: want 0, got %d", got)
	}

	// Every user's last connection is gone, so the registry must be empty —
	// leftover entries would leak memory for the lifetime of the process.
	leftover := 0
	for i := 0; i < topicCount; i++ {
		leftover += len(h.registry.getUsersForTopic(topicName(i)))
	}
	if leftover != 0 {
		t.Errorf("topic registry retains %d user entries after teardown", leftover)
	}

	// Let the invalidation backlog drain (a 1M-message soak leaves queued
	// DELs + rare fallback goroutines in flight), then stop the workers and
	// compare against the pre-test baseline. The assertion is about LEAKED
	// goroutines, not in-flight work — so drain first, then measure.
	drainDeadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(drainDeadline) && len(h.invalCh) > 0 {
		time.Sleep(100 * time.Millisecond)
	}
	cancel()
	// The go-redis pool keeps up to PoolSize warm connections and the
	// in-process miniredis holds a handler goroutine per connection — both
	// live until the client closes (test cleanup), legitimately, not a
	// leak. Anything beyond 2×pool + slack is.
	allowance := 2*Rdb.Options().PoolSize + 32
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if runtime.NumGoroutine() <= baselineGoroutines+allowance {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if n := runtime.NumGoroutine(); n > baselineGoroutines+allowance {
		t.Errorf("goroutine leak: baseline %d, now %d (allowance %d for redis pool)", baselineGoroutines, n, allowance)
	} else {
		t.Logf("goroutines: baseline %d, final %d (redis pool allowance %d)", baselineGoroutines, n, allowance)
	}
}
