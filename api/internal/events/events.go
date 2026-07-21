package events

import (
	"context"
	"fmt"
	"hash/fnv"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// dispatchDropLog rate-limits the "dispatch queue full" log line to at most
// once per 60s. The drop itself is kept (intentional backpressure on a full
// fan-out queue) but without a log it was silently invisible, which is
// exactly the kind of failure mode Scrollr has been bitten by before.
var (
	dispatchDropLogMu   sync.Mutex
	dispatchDropLogLast time.Time
)

const dispatchDropLogInterval = 60 * time.Second

func logDispatchDrop() {
	dispatchDropLogMu.Lock()
	defer dispatchDropLogMu.Unlock()
	if time.Since(dispatchDropLogLast) < dispatchDropLogInterval {
		return
	}
	dispatchDropLogLast = time.Now()
	log.Printf("[CDC] Dispatch queue full, dropped event (rate-limited log)")
}

// Client represents a single SSE connection tied to an authenticated user.
type Client struct {
	UserID string
	Ch     chan []byte
	// mu + closed serialize channel close against concurrent trySend.
	// Closing a channel while another goroutine sends on it is a data
	// race (the old sync.Once + recover() pattern survived the panic but
	// the race detector rightly flagged the close/send overlap). Senders
	// take the read lock, close takes the write lock — a send can never
	// overlap the close, and double-close is a guarded no-op.
	mu     sync.RWMutex
	closed bool
}

// closeCh closes the client's channel exactly once. Safe to call from any
// number of goroutines / retries, and safe against in-flight trySends.
func (c *Client) closeCh() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.closed {
		c.closed = true
		close(c.Ch)
	}
}

// clientList wraps a []*Client slice so it can be stored in sync.Map.
// sync.Map.CompareAndSwap requires comparable values, and Go slices are NOT
// comparable (using == on a slice panics at runtime). Wrapping in a struct
// and storing a *clientList makes the value a pointer, which IS comparable.
type clientList struct {
	entries []*Client
}

// trySend attempts a non-blocking send. The read lock excludes a concurrent
// closeCh (write lock), so the closed check can't go stale mid-send; the
// recover stays as a last-resort guard against future misuse.
func trySend(client *Client, payload []byte) bool {
	defer func() { recover() }()
	client.mu.RLock()
	defer client.mu.RUnlock()
	if client.closed {
		return false
	}
	select {
	case client.Ch <- payload:
		return true
	default:
		return false
	}
}

// dispatchJob represents a fan-out task for the worker pool.
type dispatchJob struct {
	userID  string
	payload []byte
}

// Hub maintains per-user SSE client connections and a topic subscription
// registry. Messages arrive on topic channels (one per CDC event) and are
// fanned out to subscribed clients via a worker pool.
type Hub struct {
	// clients maps userID -> *clientList
	clients     sync.Map
	clientCount atomic.Int64

	// Topic subscription registry
	registry *topicRegistry

	// Worker pool dispatch channel
	dispatchCh chan dispatchJob

	// Cache-invalidation pipeline: dispatchToUser used to spawn one
	// goroutine per dispatched event (go InvalidateUserCaches). Under a
	// CDC burst with universal SSE that's unbounded — a local soak test
	// piled up 2.4M goroutines while Redis DELs queued behind the pool
	// limit. Instead: a bounded queue drained by a small worker pool,
	// deduplicated per user (invalPending) so a burst of N events for one
	// user costs one DEL, which is all it ever needed.
	invalCh      chan string
	invalPending sync.Map
}

// queueCacheInvalidation coalesces per-user cache invalidation requests.
// Dedup is removed by the worker BEFORE the DEL runs, so an event arriving
// mid-DEL re-queues and cannot be lost. If the queue of unique users is
// somehow full, fall back to the old per-event goroutine — correctness
// (no stale cache) beats strict boundedness in that rare corner.
func (h *Hub) queueCacheInvalidation(userID string) {
	if _, alreadyQueued := h.invalPending.LoadOrStore(userID, struct{}{}); alreadyQueued {
		return
	}
	select {
	case h.invalCh <- userID:
	default:
		h.invalPending.Delete(userID)
		go platform.InvalidateUserCaches(userID)
	}
}

// invalidationWorker drains queued per-user cache invalidations.
func (h *Hub) invalidationWorker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case userID, ok := <-h.invalCh:
			if !ok {
				return
			}
			h.invalPending.Delete(userID)
			platform.InvalidateUserCaches(userID)
		}
	}
}

var globalHub *Hub

// InitHub creates the topic-based hub, starts dispatch workers, and the listener.
func InitHub(ctx context.Context) {
	globalHub = &Hub{
		registry:   &topicRegistry{},
		dispatchCh: make(chan dispatchJob, platform.SSEDispatchQueueSize),
		invalCh:    make(chan string, platform.SSEInvalidationQueueSize),
	}

	// Start dispatch worker pool
	for i := 0; i < platform.SSEDispatchWorkers; i++ {
		go globalHub.dispatchWorker(ctx)
	}
	// Start cache-invalidation workers (see queueCacheInvalidation).
	for i := 0; i < platform.SSEInvalidationWorkers; i++ {
		go globalHub.invalidationWorker(ctx)
	}

	go globalHub.listenToTopics(ctx)

	// Shutdown watcher
	go func() {
		<-ctx.Done()
		log.Println("[EventHub] Hub shutting down")
		close(globalHub.dispatchCh)
		globalHub.clients.Range(func(key, value any) bool {
			list := value.(*clientList)
			for _, c := range list.entries {
				c.closeCh() // once-guarded — may race an in-flight unregister
			}
			globalHub.clients.Delete(key)
			return true
		})
	}()

	log.Printf("[EventHub] Hub started (topic-based mode, %d dispatch workers)", platform.SSEDispatchWorkers)
}

// dispatchWorker processes dispatch jobs from the shared channel.
func (h *Hub) dispatchWorker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case job, ok := <-h.dispatchCh:
			if !ok {
				return
			}
			h.dispatchToUser(job.userID, job.payload)
		}
	}
}

// listenToTopics subscribes to all CDC topic patterns plus the SSE
// control channel and dispatches to registered clients based on the
// topic subscription registry.
func (h *Hub) listenToTopics(ctx context.Context) {
	pubsub := platform.PSubscribe(ctx,
		platform.TopicPrefixFinance+"*",
		platform.TopicPrefixSports+"*",
		platform.TopicPrefixRSS+"*",
		platform.TopicPrefixFantasy+"*",
		platform.TopicPrefixPredictions+"*",
		platform.TopicPrefixCore+"*",
		platform.TopicSSEControlResubscribe,
	)
	defer pubsub.Close()

	ch := pubsub.Channel()

	log.Printf("[EventHub] Listening to topic patterns: %s* %s* %s* %s* %s* %s* + %s",
		platform.TopicPrefixFinance, platform.TopicPrefixSports, platform.TopicPrefixRSS,
		platform.TopicPrefixFantasy, platform.TopicPrefixPredictions, platform.TopicPrefixCore, platform.TopicSSEControlResubscribe)

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			h.handleTopicMessage(msg.Channel, []byte(msg.Payload))
		}
	}
}

// handleTopicMessage routes a single pub/sub message. Split from
// listenToTopics so tests can exercise routing without a live Redis
// subscription loop.
func (h *Hub) handleTopicMessage(topic string, payload []byte) {
	// Control message: a user's widget config changed somewhere in the
	// fleet (ADR-0001). Rebuild local topic subscriptions; replicas
	// holding no connection for the user no-op inside
	// UpdateUserTopicSubscriptions.
	if topic == platform.TopicSSEControlResubscribe {
		UpdateUserTopicSubscriptions(string(payload))
		return
	}

	// Special case: core user-specific topics (user_preferences, user_widgets).
	// These target a single user directly -- no registry lookup needed.
	if strings.HasPrefix(topic, platform.TopicPrefixCore) {
		userID := topic[len(platform.TopicPrefixCore):]
		select {
		case h.dispatchCh <- dispatchJob{userID: userID, payload: payload}:
		default:
			// Queue full — drop to avoid blocking the listener.
			// Rate-limited log so the drop is observable without
			// flooding logs when the queue saturates.
			logDispatchDrop()
		}
		return
	}

	// Look up all users subscribed to this topic
	users := h.registry.getUsersForTopic(topic)
	if users == nil {
		return
	}

	// Fan-out via worker pool (non-blocking enqueue)
	for userID := range users {
		select {
		case h.dispatchCh <- dispatchJob{userID: userID, payload: payload}:
		default:
			// Queue full — drop oldest-style backpressure.
			// Rate-limited log so the drop is observable.
			logDispatchDrop()
		}
	}
}

// dispatchToUser sends a payload to all SSE clients for a given user AND
// invalidates every cache layer that could serve stale data for them.
//
// The cache invalidation fixes the 2026-04-24 "finance symbols jitter"
// bug. Every CDC event means three separate cache entries are now stale:
//
//	cache:dashboard:<user>   — core's aggregated /dashboard response
//	cache:finance:<user>     — the finance source's per-user dashboard cache (finance.go)
//	cache:sports:<user>      — the sports source's per-user dashboard cache (sports.go)
//	cache:rss:<user>         — the rss source's per-user dashboard cache (rss.go)
//
// Without clearing ALL of them, a desktop safety-net refetch (triggered
// ~500ms after the SSE burst) can see the dashboard cache cleared, go
// rebuild the response, and still get stale prices from the per-channel
// caches, then persist those back into the dashboard cache — undoing
// the optimistic merge the SSE event just applied. The UI visibly
// regresses for up to 30s (the TTL) before the next CDC event "fixes"
// it, repeat.
//
// Invalidation happens even when the user has no live SSE clients
// (offline / app closed). Cached entries are still warm from their
// last poll; we want the NEXT poll after they reconnect to see fresh
// data rather than a stale entry from minutes or hours ago.
//
// All DELs are pipelined into a single Redis round-trip and executed on
// a goroutine so this never blocks the dispatch hot path.
func (h *Hub) dispatchToUser(userID string, payload []byte) {
	h.queueCacheInvalidation(userID)

	value, ok := h.clients.Load(userID)
	if !ok {
		return
	}
	list := value.(*clientList)
	for _, client := range list.entries {
		trySend(client, payload)
	}
}

// register adds an authenticated client to the hub.
func (h *Hub) register(client *Client) {
	for {
		existing, loaded := h.clients.Load(client.UserID)
		if loaded {
			old := existing.(*clientList)
			// Copy explicitly — append(old.entries, client) can write into
			// old.entries' spare capacity, so two concurrent registers would
			// both write index len before the CAS settles a winner, and the
			// loser's client could leak into the winner's published list
			// (or be overwritten and silently never receive events).
			entries := make([]*Client, len(old.entries)+1)
			copy(entries, old.entries)
			entries[len(old.entries)] = client
			newList := &clientList{entries: entries}
			if h.clients.CompareAndSwap(client.UserID, old, newList) {
				break
			}
			// CAS failed -- another goroutine modified the list; retry
		} else {
			newList := &clientList{entries: []*Client{client}}
			if _, swapped := h.clients.LoadOrStore(client.UserID, newList); !swapped {
				break
			}
			// Another goroutine stored first; retry with Load path
		}
	}
	h.clientCount.Add(1)
}

// unregister removes a client from the hub, closes its channel, and removes
// all topic subscriptions if this was the user's last connection.
func (h *Hub) unregister(client *Client) {
	var lastConnection bool
	for {
		// Recompute from scratch on every attempt: a CAS that fails after
		// len(newEntries)==0 set this true may retry against a list that
		// gained a concurrent reconnect — carrying the stale true over
		// would wipe the NEW connection's topic subscriptions below.
		lastConnection = false
		existing, ok := h.clients.Load(client.UserID)
		if !ok {
			return
		}
		old := existing.(*clientList)
		var newEntries []*Client
		found := false
		for _, c := range old.entries {
			if c == client {
				found = true
				// Do NOT close here: a failed CAS below re-enters this loop
				// and would close the same channel twice. Close once, after
				// the removal commits.
			} else {
				newEntries = append(newEntries, c)
			}
		}
		if !found {
			return
		}
		if len(newEntries) == 0 {
			lastConnection = true
			if h.clients.CompareAndDelete(client.UserID, old) {
				break
			}
		} else {
			newList := &clientList{entries: newEntries}
			if h.clients.CompareAndSwap(client.UserID, old, newList) {
				break
			}
		}
		// CAS failed; retry
	}
	// The client is atomically removed from the hub — now safe to close its
	// channel exactly once (a concurrent shutdown watcher may also race here;
	// closeCh's sync.Once makes the double-close a no-op).
	client.closeCh()
	h.clientCount.Add(-1)

	// Clean up topic subscriptions when the user's last connection closes
	if lastConnection {
		h.registry.unsubscribeAll(client.UserID)
	}
}

// --- Public API ---

// RegisterClient adds an authenticated client to the hub and subscribes
// them to the correct topics based on their widget configuration.
func RegisterClient(userID string) *Client {
	client := &Client{
		UserID: userID,
		Ch:     make(chan []byte, platform.SSEClientBufferSize),
	}
	globalHub.register(client)

	// Subscribe to topics on first connection for this user.
	// If the user already has connections, this is a no-op (idempotent).
	go subscribeUserToTopics(userID)

	return client
}

// UnregisterClient removes a client from the hub.
func UnregisterClient(client *Client) {
	globalHub.unregister(client)
}

// ClientCount returns the total number of connected SSE clients.
func ClientCount() int {
	return int(globalHub.clientCount.Load())
}

// SubscribeToTopic adds a user to a topic in the registry.
func SubscribeToTopic(userID, topic string) {
	globalHub.registry.subscribe(userID, topic)
}

// UnsubscribeFromTopic removes a user from a topic in the registry.
func UnsubscribeFromTopic(userID, topic string) {
	globalHub.registry.unsubscribe(userID, topic)
}

// UpdateUserTopicSubscriptions rebuilds a user's topic subscriptions on
// THIS replica. Only operates if the user has an active SSE connection
// here — which is why widget CRUD handlers must not call it directly:
// with multiple replicas, the HTTP request and the SSE connection can
// live on different pods. Reached via NotifyTopicSubscriptionChange →
// Redis control message → handleTopicMessage, so every replica runs it
// (ADR-0001).
func UpdateUserTopicSubscriptions(userID string) {
	// The hub only exists after InitHub. Widget writes can reach this
	// (via the NotifyTopicSubscriptionChange fallback) from contexts that
	// never start the hub — notably tests — so no-op instead of panicking.
	if globalHub == nil {
		return
	}
	if _, ok := globalHub.clients.Load(userID); !ok {
		return // No active connection on this replica, nothing to update
	}
	globalHub.registry.unsubscribeAll(userID)
	go subscribeUserToTopics(userID)
}

// NotifyTopicSubscriptionChange tells every replica to rebuild the
// user's SSE topic subscriptions after a widget config change. Goes
// through Redis pub/sub so the replica holding the user's SSE
// connection refreshes even when this HTTP request was served by a
// different replica (ADR-0001). Falls back to a local refresh if the
// publish fails, so a Redis hiccup never makes a single replica worse
// than the old direct call.
func NotifyTopicSubscriptionChange(userID string) {
	if err := platform.PublishRaw(platform.TopicSSEControlResubscribe, []byte(userID)); err != nil {
		log.Printf("[EventHub] resubscribe publish failed for %s (falling back to local refresh): %v", userID, err)
		UpdateUserTopicSubscriptions(userID)
	}
}

// RouteToRecordOwner sends a CDC event directly to the user identified in the record.
// In Phase 3, this publishes to the core topic channel instead of per-user Redis.
func RouteToRecordOwner(record map[string]interface{}, field string, payload []byte) {
	sub, ok := record[field].(string)
	if !ok || sub == "" {
		return
	}
	if err := platform.PublishRaw(platform.TopicPrefixCore+sub, payload); err != nil {
		log.Printf("[EventHub] Failed to publish to core topic for %s: %v", sub, err)
	}
}

// PublishToTopic publishes a CDC payload to a topic channel.
// This is the Phase 3 replacement for SendToUsers.
func PublishToTopic(topic string, payload []byte) {
	if err := platform.PublishRaw(topic, payload); err != nil {
		log.Printf("[EventHub] Failed to publish to topic %s: %v", topic, err)
	}
}

// TopicForRSSFeed returns the topic channel for an RSS feed URL.
// Uses FNV-1a hash because RSS URLs can contain characters that break
// Redis channel patterns (:, *, ?).
func TopicForRSSFeed(feedURL string) string {
	h := fnv.New32a()
	h.Write([]byte(feedURL))
	return fmt.Sprintf("%s%08x", platform.TopicPrefixRSS, h.Sum32())
}

// subscribeUserToTopics reads the user's widget subscriptions from the DB
// and registers them in the Hub's topic registry.
func subscribeUserToTopics(userID string) {
	ctx := context.Background()

	// Core user-specific topics (user_preferences, user_widgets) are handled
	// by direct dispatch in listenToTopics -- no registry entry needed.

	widgets, err := platform.GetUserWidgets(userID)
	if err != nil {
		log.Printf("[EventHub] Failed to load widgets for %s: %v", userID, err)
		return
	}

	for _, ch := range widgets {
		if !ch.Enabled {
			continue
		}

		// Route by the widget's backing data source, not its exact
		// widget_type, so split widgets (sports_nfl, finance_stocks, …)
		// subscribe through the same per-source logic as the legacy coarse
		// types. The per-league/per-symbol values still come from config.
		switch platform.DataSourceForWidget(ch.WidgetType) {
		case "finance":
			symbols := platform.ExtractStringArray(ch.Config, "symbols")
			for _, sym := range symbols {
				globalHub.registry.subscribe(userID, platform.TopicPrefixFinance+sym)
			}

		case "sports":
			// Subscribe only to the user's configured leagues.
			// Config shape: {"leagues": ["NFL", "NBA", ...]}
			leagues := platform.ExtractStringArray(ch.Config, "leagues")
			for _, league := range leagues {
				globalHub.registry.subscribe(userID, platform.TopicPrefixSports+league)
			}

		case "rss":
			feeds := platform.ExtractFeedURLsFromConfig(ch.Config)
			for _, feedURL := range feeds {
				globalHub.registry.subscribe(userID, TopicForRSSFeed(feedURL))
			}

		case "fantasy":
			leagueKeys, err := getUserFantasyLeagues(ctx, userID)
			if err != nil {
				log.Printf("[EventHub] Failed to load fantasy leagues for %s: %v", userID, err)
				continue
			}
			for _, lk := range leagueKeys {
				globalHub.registry.subscribe(userID, platform.TopicPrefixFantasy+lk)
			}

		case "predictions":
			// v1 channel-wide broadcast: every enabled predictions user
			// subscribes to the single "all" topic. No per-entity config.
			globalHub.registry.subscribe(userID, platform.TopicPrefixPredictions+"all")
		}
	}
}

// getUserFantasyLeagues returns the Yahoo league keys a user has imported.
// Uses yahoo_user_leagues junction table (yahoo_leagues.guid was removed).
func getUserFantasyLeagues(ctx context.Context, userID string) ([]string, error) {
	rows, err := platform.DBPool.Query(ctx, `
		SELECT yul.league_key
		FROM yahoo_user_leagues yul
		INNER JOIN yahoo_users yu ON yu.guid = yul.guid
		WHERE yu.logto_sub = $1
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("query fantasy leagues: %w", err)
	}
	defer rows.Close()

	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			continue
		}
		keys = append(keys, key)
	}
	return keys, nil
}
