package admin

import (
	"context"
	"encoding/json"
	"log"
	"strconv"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/accounts"
	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/singleflight"
)

const signupAnalyticsCacheTTL = 5 * time.Minute

var (
	fetchSignupAnalytics   = accounts.FetchSignupAnalytics
	signupAnalyticsGroup   singleflight.Group
	signupAnalyticsTimeout = 25 * time.Second
)

type cachedAnalyticsResult struct {
	Report accounts.SignupAnalytics
	Hit    bool
}

func HandleGetAnalytics(c *fiber.Ctx) error {
	application := c.Query("application", "website")
	if application != "website" && application != "desktop" {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "application must be website or desktop"})
	}
	days, err := strconv.Atoi(c.Query("days", "7"))
	if err != nil || (days != 7 && days != 30) {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Error: "days must be 7 or 30"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), signupAnalyticsTimeout)
	defer cancel()
	report, hit, err := cachedSignupAnalytics(ctx, application, days)
	if err != nil {
		log.Print("[Admin] signup analytics unavailable")
		return c.Status(fiber.StatusServiceUnavailable).JSON(platform.ErrorResponse{Error: "Signup analytics are unavailable."})
	}
	if hit {
		c.Set("X-Cache", "HIT")
	} else {
		c.Set("X-Cache", "MISS")
	}
	return c.JSON(report)
}

func cachedSignupAnalytics(ctx context.Context, application string, days int) (accounts.SignupAnalytics, bool, error) {
	key := "scrollr:admin:signup_analytics:" + application + ":" + strconv.Itoa(days)
	if report, ok := readSignupAnalyticsCache(ctx, key); ok {
		return report, true, nil
	}
	if err := ctx.Err(); err != nil {
		return accounts.SignupAnalytics{}, false, err
	}

	result := signupAnalyticsGroup.DoChan(key, func() (any, error) {
		scanCtx, cancel := context.WithTimeout(context.Background(), signupAnalyticsTimeout)
		defer cancel()
		if report, ok := readSignupAnalyticsCache(scanCtx, key); ok {
			return cachedAnalyticsResult{Report: report, Hit: true}, nil
		}
		report, err := fetchSignupAnalytics(scanCtx, application, days, time.Now())
		if err != nil {
			return cachedAnalyticsResult{}, err
		}
		if platform.Rdb != nil {
			if raw, err := json.Marshal(report); err == nil {
				_ = platform.Rdb.Set(scanCtx, key, raw, signupAnalyticsCacheTTL).Err()
			}
		}
		return cachedAnalyticsResult{Report: report}, nil
	})
	select {
	case <-ctx.Done():
		return accounts.SignupAnalytics{}, false, ctx.Err()
	case response := <-result:
		if response.Err != nil {
			return accounts.SignupAnalytics{}, false, response.Err
		}
		value := response.Val.(cachedAnalyticsResult)
		return value.Report, value.Hit, nil
	}
}

func readSignupAnalyticsCache(ctx context.Context, key string) (accounts.SignupAnalytics, bool) {
	if platform.Rdb == nil {
		return accounts.SignupAnalytics{}, false
	}
	raw, err := platform.Rdb.Get(ctx, key).Bytes()
	if err != nil {
		return accounts.SignupAnalytics{}, false
	}
	var report accounts.SignupAnalytics
	if json.Unmarshal(raw, &report) != nil {
		return accounts.SignupAnalytics{}, false
	}
	return report, true
}
