package events

import (
	"maps"
	"sync"
)

// topicRegistry maintains bidirectional mappings between users and topics.
// It enables O(1) topic -> user lookups for message dispatch.
//
// Inner maps use COPY-ON-WRITE semantics. The subscribe/unsubscribe methods
// never mutate a map in place -- they clone it, modify the clone, and store
// the clone atomically. This ensures the dispatch goroutine can safely iterate
// a snapshot without holding any lock.
type topicRegistry struct {
	// topicToUsers maps a topic to an immutable snapshot of user IDs.
	topicToUsers sync.Map // topic string -> map[string]struct{} (immutable after store)

	// userToTopics maps a user ID to an immutable snapshot of topic strings.
	userToTopics sync.Map // userID string -> map[string]struct{} (immutable after store)

	mu sync.Mutex // serializes write operations (clone + store)
}

// cloneSet creates a shallow copy of a string set.
func cloneSet(src map[string]struct{}) map[string]struct{} {
	if src == nil {
		return map[string]struct{}{}
	}
	return maps.Clone(src)
}

// subscribe adds a user to a topic (copy-on-write).
func (r *topicRegistry) subscribe(userID, topic string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Clone topic -> users, add user, store new snapshot
	var newUsers map[string]struct{}
	if existing, ok := r.topicToUsers.Load(topic); ok {
		newUsers = cloneSet(existing.(map[string]struct{}))
	} else {
		newUsers = make(map[string]struct{}, 1)
	}
	newUsers[userID] = struct{}{}
	r.topicToUsers.Store(topic, newUsers)

	// Clone user -> topics, add topic, store new snapshot
	var newTopics map[string]struct{}
	if existing, ok := r.userToTopics.Load(userID); ok {
		newTopics = cloneSet(existing.(map[string]struct{}))
	} else {
		newTopics = make(map[string]struct{}, 1)
	}
	newTopics[topic] = struct{}{}
	r.userToTopics.Store(userID, newTopics)
}

// unsubscribe removes a user from a topic (copy-on-write).
func (r *topicRegistry) unsubscribe(userID, topic string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if existing, ok := r.topicToUsers.Load(topic); ok {
		old := existing.(map[string]struct{})
		if _, found := old[userID]; found {
			if len(old) == 1 {
				r.topicToUsers.Delete(topic)
			} else {
				newUsers := cloneSet(old)
				delete(newUsers, userID)
				r.topicToUsers.Store(topic, newUsers)
			}
		}
	}

	if existing, ok := r.userToTopics.Load(userID); ok {
		old := existing.(map[string]struct{})
		if _, found := old[topic]; found {
			if len(old) == 1 {
				r.userToTopics.Delete(userID)
			} else {
				newTopics := cloneSet(old)
				delete(newTopics, topic)
				r.userToTopics.Store(userID, newTopics)
			}
		}
	}
}

// unsubscribeAll removes a user from all topics. Called on disconnect.
func (r *topicRegistry) unsubscribeAll(userID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	topicsVal, ok := r.userToTopics.Load(userID)
	if !ok {
		return
	}
	topics := topicsVal.(map[string]struct{})

	for topic := range topics {
		if existing, ok := r.topicToUsers.Load(topic); ok {
			old := existing.(map[string]struct{})
			if len(old) <= 1 {
				r.topicToUsers.Delete(topic)
			} else {
				newUsers := cloneSet(old)
				delete(newUsers, userID)
				r.topicToUsers.Store(topic, newUsers)
			}
		}
	}

	r.userToTopics.Delete(userID)
}

// getUsersForTopic returns an immutable snapshot of user IDs subscribed to a
// topic. Safe for concurrent iteration -- the returned map is never mutated.
func (r *topicRegistry) getUsersForTopic(topic string) map[string]struct{} {
	usersVal, ok := r.topicToUsers.Load(topic)
	if !ok {
		return nil
	}
	return usersVal.(map[string]struct{})
}
