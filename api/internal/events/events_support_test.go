package events

import (
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// The staff console is one more subscriber to one more topic on the hub that
// already exists (REL-261), and these pin the two halves of that claim.

// A console connection receives support events and nothing else. The "nothing
// else" is the half that matters: an admin who also runs Scrollr on the same
// account must not get their own ticker's CDC in the support page, and the
// support page's traffic must not reach their ticker.
func TestAdminConsoleClientGetsSupportEventsAndNoCDC(t *testing.T) {
	h := swapHub(t)
	client := RegisterAdminClient("sub-staff")
	t.Cleanup(func() { UnregisterClient(client) })

	// A CDC topic the same person's desktop would be on. The console is not
	// subscribed to it, so nothing is dispatched.
	h.handleTopicMessage(platform.TopicPrefixSports+"NFL", []byte(`{"type":"sports"}`))
	// The desktop's own per-user channel, which targets a logto sub directly.
	// The console registers under a namespaced key precisely so this misses.
	h.handleTopicMessage(platform.TopicPrefixCore+"sub-staff", []byte(`{"type":"core"}`))
	drainDispatch(t, h)
	select {
	case got := <-client.Ch:
		t.Fatalf("the console received CDC traffic: %s", got)
	default:
	}

	h.handleTopicMessage(platform.TopicSupportAdmin, []byte(`{"type":"support","event":"sent"}`))
	drainDispatch(t, h)
	select {
	case got := <-client.Ch:
		if string(got) != `{"type":"support","event":"sent"}` {
			t.Errorf("payload = %s", got)
		}
	case <-time.After(time.Second):
		t.Fatal("the console received no support event")
	}
}

// The subscription goes away with the connection, so a replica does not fan
// out to a browser that closed hours ago.
func TestAdminConsoleUnsubscribesOnDisconnect(t *testing.T) {
	h := swapHub(t)
	client := RegisterAdminClient("sub-staff")
	if users := h.registry.getUsersForTopic(platform.TopicSupportAdmin); len(users) != 1 {
		t.Fatalf("subscribers after connect = %d, want 1", len(users))
	}
	UnregisterClient(client)
	if users := h.registry.getUsersForTopic(platform.TopicSupportAdmin); len(users) != 0 {
		t.Errorf("subscribers after disconnect = %d, want 0", len(users))
	}
}

// drainDispatch runs the dispatch queue synchronously. The worker pool is not
// started in these tests, so this stands in for it and keeps the assertions
// free of sleeps.
func drainDispatch(t *testing.T, h *Hub) {
	t.Helper()
	for {
		select {
		case job := <-h.dispatchCh:
			h.dispatchToUser(job.userID, job.payload)
		default:
			return
		}
	}
}
