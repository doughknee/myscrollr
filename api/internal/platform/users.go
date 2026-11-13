package platform

import (
	"github.com/gofiber/fiber/v2"
)

// GetUserID extracts the user ID from the Fiber context (set by LogtoAuth middleware).
func GetUserID(c *fiber.Ctx) string {
	if userID, ok := c.Locals("user_id").(string); ok {
		return userID
	}
	return ""
}

// GetUserRoles extracts the user roles from the Fiber context (set by LogtoAuth middleware).
func GetUserRoles(c *fiber.Ctx) []string {
	if roles, ok := c.Locals("user_roles").([]string); ok {
		return roles
	}
	return nil
}

// tierFromRoles determines the subscription tier based on JWT roles.
// Priority: super_user > uplink_ultimate > uplink_pro > uplink > free.
func TierFromRoles(roles []string) string {
	tier := "free"
	for _, r := range roles {
		switch r {
		case "super_user":
			return "super_user" // highest — return immediately
		case "uplink_ultimate":
			return "uplink_ultimate"
		case "uplink_pro":
			if tier != "uplink_ultimate" {
				tier = "uplink_pro"
			}
		case "uplink":
			if tier == "free" {
				tier = "uplink"
			}
		}
	}
	return tier
}

// GetProfileByUsername answers GET /users/:username. There is no public profile
// data behind it (usernames live in Logto, and nothing here reads them), and no
// client calls it: it used to echo whatever name it was given with a 200, which
// made every string look like a real account (SCROLLR-459 / UW-7). It now says
// 404 for every name, so it can neither mislead nor become an oracle for which
// usernames exist.
func GetProfileByUsername(c *fiber.Ctx) error {
	return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
		Status: "not_found",
		Error:  "Profile not found",
	})
}
