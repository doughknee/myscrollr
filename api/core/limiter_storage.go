package core

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// redisLimiterStorage adapts the global Redis client to fiber.Storage so
// the rate-limiter middleware shares one counter pool across replicas
// (ADR-0001). With Fiber's default in-memory storage, every replica
// keeps its own counters, multiplying the effective per-IP budget by
// the replica count.
//
// Fails open by design: when Redis is unreachable, Get reports "no
// entry" and Set/Delete swallow the error (rate-limited log), so
// requests pass instead of erroring. Rate limiting here is abuse
// protection, not a correctness layer — Redis being down already
// degrades SSE delivery, and turning it into a full API outage via
// limiter errors would be strictly worse.
type redisLimiterStorage struct {
	prefix string
}

func newRedisLimiterStorage(prefix string) *redisLimiterStorage {
	return &redisLimiterStorage{prefix: prefix}
}

// Rate-limited error log, same pattern as logDispatchDrop: Redis being
// down would otherwise log once per request.
var (
	limiterLogMu   sync.Mutex
	limiterLogLast time.Time
)

const limiterLogInterval = 60 * time.Second

func logLimiterStorageError(op string, err error) {
	limiterLogMu.Lock()
	defer limiterLogMu.Unlock()
	if time.Since(limiterLogLast) < limiterLogInterval {
		return
	}
	limiterLogLast = time.Now()
	log.Printf("[RateLimit] Redis %s failed, failing open (rate-limited log): %v", op, err)
}

func (s *redisLimiterStorage) Get(key string) ([]byte, error) {
	val, err := Rdb.Get(context.Background(), s.prefix+key).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		logLimiterStorageError("GET", err)
		return nil, nil
	}
	return val, nil
}

func (s *redisLimiterStorage) Set(key string, val []byte, exp time.Duration) error {
	if err := Rdb.Set(context.Background(), s.prefix+key, val, exp).Err(); err != nil {
		logLimiterStorageError("SET", err)
	}
	return nil
}

func (s *redisLimiterStorage) Delete(key string) error {
	if err := Rdb.Del(context.Background(), s.prefix+key).Err(); err != nil {
		logLimiterStorageError("DEL", err)
	}
	return nil
}

// Reset deletes every key under the storage prefix. Fiber's limiter
// never calls this on the request path; it exists to satisfy the
// Storage interface.
func (s *redisLimiterStorage) Reset() error {
	ctx := context.Background()
	iter := Rdb.Scan(ctx, 0, s.prefix+"*", 100).Iterator()
	for iter.Next(ctx) {
		if err := Rdb.Del(ctx, iter.Val()).Err(); err != nil {
			logLimiterStorageError("RESET", err)
			return nil
		}
	}
	if err := iter.Err(); err != nil {
		logLimiterStorageError("RESET-SCAN", err)
	}
	return nil
}

// Close is a no-op: the Redis client's lifecycle is owned by main.
func (s *redisLimiterStorage) Close() error {
	return nil
}
