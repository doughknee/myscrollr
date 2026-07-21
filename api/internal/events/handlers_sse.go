package events

import (
	"bufio"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"
)

// GetActiveViewers returns the count of connected SSE clients.
func GetActiveViewers(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{"count": ClientCount()})
}

// StreamEvents handles authenticated Server-Sent Events (SSE).
// Accepts token via Authorization: Bearer header (preferred) or
// ?token= query parameter (fallback for browser EventSource).
func StreamEvents(c *fiber.Ctx) error {
	// 1. Extract token — prefer Authorization header, fall back to query param
	tokenString := ""
	if authHeader := c.Get("Authorization"); authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
			tokenString = parts[1]
		}
	}
	if tokenString == "" {
		tokenString = c.Query("token")
	}
	if tokenString == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Missing token parameter",
		})
	}

	// 2. Validate JWT and get user ID. Real-time delivery is available to
	// every tier (widget/slot redesign, 2026-06-30): the former
	// Ultimate-only gate was removed so the "always-on live ticker" promise
	// holds for all plans. Monetization is now purely the widget-slot count;
	// more SSE subscribers do not increase upstream data-provider quota
	// (CDC fans out already-ingested data via Redis).
	userID, _, err := platform.ValidateToken(tokenString)
	if err != nil {
		log.Printf("[SSE] Auth failed: %v", err)
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "unauthorized",
			Error:  "Invalid or expired token",
		})
	}

	// 3. Set headers for SSE
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Transfer-Encoding", "chunked")

	// 4. Register this authenticated client
	client := RegisterClient(userID)

	log.Printf("[SSE] Client connected: user=%s ip=%s", userID, c.IP())

	// 5. Stream events to the client
	c.Context().SetBodyStreamWriter(fasthttp.StreamWriter(func(w *bufio.Writer) {
		// This runs in a fasthttp-spawned goroutine, so a panic here crashes
		// the whole process — Fiber's Recover middleware only wraps the request
		// goroutine, not this one. Contain any panic (a write to a torn-down
		// connection, a channel race, …): log it and let just this one SSE
		// connection close. Declared first so it runs LAST (LIFO), covering the
		// deferred UnregisterClient below as well.
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[SSE] recovered from panic in stream writer (user=%s): %v", userID, r)
			}
		}()
		ticker := time.NewTicker(platform.SSEHeartbeatInterval)
		defer ticker.Stop()
		defer UnregisterClient(client)

		// Send initial retry interval (3 seconds)
		fmt.Fprintf(w, "retry: %d\n\n", platform.SSERetryIntervalMs)
		w.Flush()

		for {
			select {
			case msg, ok := <-client.Ch:
				if !ok {
					return
				}
				fmt.Fprintf(w, "data: %s\n\n", msg)
				if err := w.Flush(); err != nil {
					return // Client disconnected
				}

			case <-ticker.C:
				// Heartbeat to keep connection alive
				fmt.Fprintf(w, ": ping\n\n")
				if err := w.Flush(); err != nil {
					return // Client disconnected
				}
			}
		}
	}))

	return nil
}
