package core

import (
	"os"

	"github.com/gofiber/fiber/v2"
)

// HandleGetMinDesktopVersion serves the minimum desktop version the API
// still supports. The desktop app checks this on boot and blocks with an
// "update required" screen when it's older — the lever for breaking
// deploys (schema/model changes an old client can't render).
//
// Unauthenticated on purpose: the gate must work before sign-in. The value
// comes from MIN_DESKTOP_VERSION (core-config ConfigMap); empty means "no
// minimum" and clients treat any fetch failure the same way (fail open —
// an API blip must never lock users out of a working app).
//
// NOTE: clients older than the first version carrying the gate never call
// this endpoint. Raising the value only bites versions that know to ask.
func HandleGetMinDesktopVersion(c *fiber.Ctx) error {
	// Cache briefly so a fleet of clients booting after a deploy doesn't
	// stampede; 5 minutes still propagates a version bump quickly.
	c.Set("Cache-Control", "public, max-age=300")
	return c.JSON(fiber.Map{
		"min_desktop_version": os.Getenv("MIN_DESKTOP_VERSION"),
	})
}
