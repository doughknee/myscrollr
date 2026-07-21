package events

import (
	"sync"
	"testing"
)

// TestUnregisterConcurrentNoDoubleClose is a regression guard for the SSE
// crash (handlers_sse.go stream writer): unregister used to close a
// client's channel INSIDE its CAS-retry loop. When two connections for the
// same user unregistered concurrently, one CAS lost, the loser retried, and
// re-closed an already-closed channel → "panic: close of closed channel".
// The panic surfaced in the fasthttp stream-writer goroutine (via the
// deferred UnregisterClient), which Fiber's Recover middleware cannot catch,
// so it crashed the whole process.
//
// A panic in any of these goroutines would crash the test binary, so a clean
// run IS the assertion. clientCount returning to zero confirms the removals
// were all accounted for exactly once.
func TestUnregisterConcurrentNoDoubleClose(t *testing.T) {
	h := swapHub(t)
	const n = 16
	const userID = "race-user"

	clients := make([]*Client, n)
	for i := range clients {
		clients[i] = &Client{UserID: userID, Ch: make(chan []byte, 1)}
		h.register(clients[i])
	}

	var wg sync.WaitGroup
	for _, c := range clients {
		wg.Add(1)
		go func(cl *Client) {
			defer wg.Done()
			h.unregister(cl)
		}(c)
	}
	wg.Wait()

	if got := h.clientCount.Load(); got != 0 {
		t.Errorf("clientCount after unregistering all: want 0, got %d", got)
	}
}

// TestClientCloseChIdempotent confirms the once-guarded close is a no-op on a
// double close (the unregister path and the shutdown watcher can both race to
// close the same client).
func TestClientCloseChIdempotent(t *testing.T) {
	c := &Client{Ch: make(chan []byte, 1)}
	c.closeCh()
	c.closeCh() // must not panic — sync.Once swallows the second close
	if _, ok := <-c.Ch; ok {
		t.Error("channel should be closed after closeCh")
	}
}
