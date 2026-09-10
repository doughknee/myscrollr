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
	fetchSignupAnalytics = accounts.FetchSignupAnalytics
	signupAnalyticsGroup singleflight.Group
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

	report, hit, err := cachedSignupAnalytics(c.Context(), application, days)
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

	value, err, _ := signupAnalyticsGroup.Do(key, func() (any, error) {
		if report, ok := readSignupAnalyticsCache(ctx, key); ok {
			return cachedAnalyticsResult{Report: report, Hit: true}, nil
		}
		report, err := fetchSignupAnalytics(ctx, application, days, time.Now())
		if err != nil {
			return cachedAnalyticsResult{}, err
		}
		if platform.Rdb != nil {
			if raw, err := json.Marshal(report); err == nil {
				_ = platform.Rdb.Set(ctx, key, raw, signupAnalyticsCacheTTL).Err()
			}
		}
		return cachedAnalyticsResult{Report: report}, nil
	})
	if err != nil {
		return accounts.SignupAnalytics{}, false, err
	}
	result := value.(cachedAnalyticsResult)
	return result.Report, result.Hit, nil
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
