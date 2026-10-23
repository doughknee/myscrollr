package accounts

import (
	"context"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"golang.org/x/sync/singleflight"
)

const accountAccessTTL = 15 * time.Second

var accountAccessGroup singleflight.Group

// CheckAccountAccess shares a short, non-sliding suspension cache across replicas.
// A Logto outage never extends an old allow decision; clients receive a retryable 503.
func CheckAccountAccess(sub string) error {
	if sub == "" {
		return platform.ErrAccountBlocked
	}
	key := "auth:account-access:" + sub
	read := func() string {
		if platform.Rdb == nil {
			return ""
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		value, _ := platform.Rdb.Get(ctx, key).Result()
		return value
	}
	check := func(value string) error {
		if value == "blocked" {
			return platform.ErrAccountBlocked
		}
		return nil
	}
	if value := read(); value == "active" || value == "blocked" {
		return check(value)
	}
	_, err, _ := accountAccessGroup.Do(sub, func() (interface{}, error) {
		if value := read(); value == "active" || value == "blocked" {
			return nil, check(value)
		}
		started := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		user, err := getLogtoUserContext(ctx, sub)
		if err != nil || (user != nil && user.ID != sub) {
			return nil, platform.ErrAccountCheckUnavailable
		}
		value := "active"
		if user == nil || user.IsSuspended {
			value = "blocked"
		}
		// Slow lookups cannot create a fresh 15-second window for stale state.
		if ttl := accountAccessTTL - time.Since(started); platform.Rdb != nil && ttl > 0 {
			_ = platform.Rdb.Set(ctx, key, value, ttl).Err()
		}
		return nil, check(value)
	})
	return err
}
