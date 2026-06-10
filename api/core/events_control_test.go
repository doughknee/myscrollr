package core

import (
	"context"
	"testing"
	"time"
)

// Tests for the cross-replica SSE resubscribe control message (ADR-0001):
// channel CRUD publishes the affected user's sub on
// TopicSSEControlResubscribe, every replica's hub receives it via
// handleTopicMessage, and only replicas holding an SSE connection for
// that user rebuild their local registry.

// swapHub installs a fresh minimal hub (no dispatch workers, no Redis
// listener) for the duration of a test and restores the previous one.
func swapHub(t *testing.T) *Hub {
	t.Helper()
	prev := globalHub
	globalHub = &Hub{
		registry:   &topicRegistry{},
		dispatchCh: make(chan dispatchJob, 8),
	}
	t.Cleanup(func() { globalHub = prev })
	return globalHub
}

// TestNotifyTopicSubscriptionChange_PublishesControlMessage asserts the
// CRUD-side half: the notification goes out on the control channel with
// the user's sub as payload, where every replica's listener can see it.
func TestNotifyTopicSubscriptionChange_PublishesControlMessage(t *testing.T) {
	_, cleanup := setupMiniRedis(t)
	defer cleanup()
	swapHub(t)

	ctx := context.Background()
	sub := Rdb.Subscribe(ctx, TopicSSEControlResubscribe)
	defer sub.Close()
	// Wait for the subscription to be confirmed before publishing, or
	// the message can be lost (pub/sub has no replay).
	if _, err := sub.Receive(ctx); err != nil {
		t.Fatalf("establish subscription: %v", err)
	}

	NotifyTopicSubscriptionChange("user-control-pub")

	select {
	case msg := <-sub.Channel():
		if msg.Channel != TopicSSEControlResubscribe {
			t.Errorf("channel = %q, want %q", msg.Channel, TopicSSEControlResubscribe)
		}
		if msg.Payload != "user-control-pub" {
			t.Errorf("payload = %q, want %q", msg.Payload, "user-control-pub")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no control message received within 2s")
	}
}

// TestHandleTopicMessage_ControlRefreshesConnectedUser asserts the
// listener-side half on a replica that DOES hold the user's connection:
// stale registry entries are dropped synchronously when the control
// message arrives. Integration-gated because the async re-subscribe
// half reads the user's channels from the DB (the test user has none,
// so nothing comes back).
func TestHandleTopicMessage_ControlRefreshesConnectedUser(t *testing.T) {
	if !testDBAvailable(t) {
		return
	}
	h := swapHub(t)

	const userID = "user-control-connected"
	client := &Client{UserID: userID, Ch: make(chan []byte, 1)}
	h.register(client)
	defer h.unregister(client)

	staleTopic := TopicPrefixFinance + "STALE"
	h.registry.subscribe(userID, staleTopic)

	h.handleTopicMessage(TopicSSEControlResubscribe, []byte(userID))

	if users := h.registry.getUsersForTopic(staleTopic); users != nil {
		if _, ok := users[userID]; ok {
			t.Errorf("user still subscribed to %s after resubscribe control message", staleTopic)
		}
	}
}

// TestHandleTopicMessage_ControlNoConnection_NoOp asserts the
// listener-side half on a replica that does NOT hold the user's
// connection: the control message must be a strict no-op (this is what
// makes broadcasting to every replica safe).
func TestHandleTopicMessage_ControlNoConnection_NoOp(t *testing.T) {
	h := swapHub(t)

	// A registry entry without a client doesn't occur naturally
	// (unregister cleans up), but it's the sharpest probe that the
	// no-connection path touches nothing.
	const userID = "user-control-absent"
	topic := TopicPrefixSports + "NFL"
	h.registry.subscribe(userID, topic)

	h.handleTopicMessage(TopicSSEControlResubscribe, []byte(userID))

	users := h.registry.getUsersForTopic(topic)
	if users == nil {
		t.Fatal("registry entry vanished for a user with no local connection")
	}
	if _, ok := users[userID]; !ok {
		t.Errorf("user removed from %s despite having no local connection", topic)
	}
}

// TestHandleTopicMessage_CoreUserTopicStillDispatches guards the
// pre-existing routing against regressions from the control-message
// split: a cdc:core:user:* message must still enqueue a dispatch job
// for exactly that user.
func TestHandleTopicMessage_CoreUserTopicStillDispatches(t *testing.T) {
	h := swapHub(t)

	const userID = "user-core-dispatch"
	h.handleTopicMessage(TopicPrefixCore+userID, []byte(`{"kind":"prefs"}`))

	select {
	case job := <-h.dispatchCh:
		if job.userID != userID {
			t.Errorf("dispatch job userID = %q, want %q", job.userID, userID)
		}
	default:
		t.Fatal("no dispatch job enqueued for core user topic")
	}
}
