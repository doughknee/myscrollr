package core

import (
	"context"
	"encoding/json"
	"log"
	"sort"
	"strings"
	"sync"
	"time"
)

// ChannelRoute describes a route registered by a channel.
type ChannelRoute struct {
	Method string `json:"method"`
	Path   string `json:"path"`
	Auth   bool   `json:"auth"`
}

// ChannelInfo describes a discovered channel from Redis.
type ChannelInfo struct {
	Name         string         `json:"name"`
	DisplayName  string         `json:"display_name"`
	InternalURL  string         `json:"internal_url"`
	Capabilities []string       `json:"capabilities"`
	CDCTables    []string       `json:"cdc_tables"`
	Routes       []ChannelRoute `json:"routes"`
}

// Discovery manages runtime channel discovery via Redis.
type Discovery struct {
	mu          sync.RWMutex
	channels    map[string]*ChannelInfo // keyed by name
	lastSummary string                  // for change detection
}

var globalDiscovery = &Discovery{
	channels: make(map[string]*ChannelInfo),
}

// StartDiscovery performs an initial synchronous scan to discover channels,
// then starts a background loop to refresh every 10 seconds.
// The initial scan blocks so that proxy routes can be set up with known channels.
// The background loop respects the provided context for graceful shutdown.
func StartDiscovery(ctx context.Context) {
	globalDiscovery.refresh()
	go globalDiscovery.run(ctx)
}

func (d *Discovery) run(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("[Discovery] Shutting down discovery loop")
			return
		case <-ticker.C:
			d.refresh()
		}
	}
}

func (d *Discovery) refresh() {
	ctx := context.Background()

	// Scan for all channel:* keys
	var cursor uint64
	channels := make(map[string]*ChannelInfo)

	for {
		keys, nextCursor, err := Rdb.Scan(ctx, cursor, "channel:*", 100).Result()
		if err != nil {
			log.Printf("[Discovery] Redis scan error: %v", err)
			return
		}

		for _, key := range keys {
			val, err := Rdb.Get(ctx, key).Result()
			if err != nil {
				continue
			}
			var info ChannelInfo
			if err := json.Unmarshal([]byte(val), &info); err != nil {
				log.Printf("[Discovery] Failed to parse channel %s: %v", key, err)
				continue
			}
			channels[info.Name] = &info
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	// Build a summary string for change detection
	names := make([]string, 0, len(channels))
	for name := range channels {
		names = append(names, name)
	}
	sort.Strings(names)
	summary := strings.Join(names, ",")

	d.mu.Lock()
	changed := summary != d.lastSummary
	d.channels = channels
	d.lastSummary = summary
	d.mu.Unlock()

	if changed {
		log.Printf("[Discovery] Channels updated: %d active [%s]", len(channels), summary)
	}
}

// GetAllChannels returns a snapshot of all discovered channels.
func GetAllChannels() []*ChannelInfo {
	globalDiscovery.mu.RLock()
	defer globalDiscovery.mu.RUnlock()

	result := make([]*ChannelInfo, 0, len(globalDiscovery.channels))
	for _, info := range globalDiscovery.channels {
		result = append(result, info)
	}
	return result
}

// GetChannel returns info for a specific channel by name.
func GetChannel(name string) *ChannelInfo {
	globalDiscovery.mu.RLock()
	defer globalDiscovery.mu.RUnlock()
	return globalDiscovery.channels[name]
}

// GetValidChannelTypes returns a set of all registered channel names.
// These are the valid channel types for user_channels.
func GetValidChannelTypes() map[string]bool {
	globalDiscovery.mu.RLock()
	defer globalDiscovery.mu.RUnlock()

	types := make(map[string]bool, len(globalDiscovery.channels))
	for name := range globalDiscovery.channels {
		types[name] = true
	}
	return types
}

// GetChannelRoutes returns all routes from all discovered channels.
func GetChannelRoutes() []struct {
	Channel *ChannelInfo
	Route   ChannelRoute
} {
	globalDiscovery.mu.RLock()
	defer globalDiscovery.mu.RUnlock()

	var routes []struct {
		Channel *ChannelInfo
		Route   ChannelRoute
	}
	for _, info := range globalDiscovery.channels {
		for _, route := range info.Routes {
			routes = append(routes, struct {
				Channel *ChannelInfo
				Route   ChannelRoute
			}{info, route})
		}
	}
	return routes
}

// HasCapability checks if a channel has a specific capability.
func (info *ChannelInfo) HasCapability(cap string) bool {
	for _, c := range info.Capabilities {
		if c == cap {
			return true
		}
	}
	return false
}
