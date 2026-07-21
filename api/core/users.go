package core

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
func tierFromRoles(roles []string) string {
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

// GetProfileByUsername returns basic profile info (Logto-sourced username).
func GetProfileByUsername(c *fiber.Ctx) error {
	username := c.Params("username")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error",
			Error:  "Username is required",
		})
	}

	return c.JSON(fiber.Map{
		"username": username,
	})
}
