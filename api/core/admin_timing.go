package core

import (
	"errors"
	"log"
	"strconv"
	"time"

	"github.com/getsentry/sentry-go"
	sentryfiber "github.com/getsentry/sentry-go/fiber"
	"github.com/gofiber/fiber/v2"
)

// ===== Admin request timing (SCROLLR-324) =====

const (
	// AdminSlowThreshold is the duration above which an /admin request is logged.
	AdminSlowThreshold = time.Second
	// AdminLogServerErrors logs every 5xx regardless of duration.
	AdminLogServerErrors = true
)

// AdminTiming logs `[Admin] METHOD route status ms` for slow or 5xx requests.
// Only the route template is logged: no query string, ids, bodies or tokens.
func AdminTiming(c *fiber.Ctx) error {
	return adminTiming(AdminSlowThreshold)(c)
}

func adminTiming(threshold time.Duration) fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		d := time.Since(start)

		status := c.Response().StatusCode()
		if err != nil {
			// The error handler has not run yet; derive what it will send.
			status = fiber.StatusInternalServerError
			var fe *fiber.Error
			if errors.As(err, &fe) {
				status = fe.Code
			}
		}
		if d <= threshold && !(AdminLogServerErrors && status >= 500) {
			return err
		}

		// c.Route().Path is the template; c.Path() aliases a pooled buffer.
		msg := "[Admin] " + c.Method() + " " + c.Route().Path + " " + strconv.Itoa(status) + " " + strconv.FormatInt(d.Milliseconds(), 10)
		log.Print(msg)
		if hub := sentryfiber.GetHubFromContext(c); hub != nil {
			hub.AddBreadcrumb(&sentry.Breadcrumb{Category: "admin", Message: msg, Level: sentry.LevelWarning}, nil)
		}
		return err
	}
}
