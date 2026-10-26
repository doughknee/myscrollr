package platform

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gofiber/fiber/v2"
)

type securityRequest struct {
	Actor, Source, Method, Endpoint string
	Status                          int
}

var auditWarningAt atomic.Int64
var auditSlots = make(chan struct{}, 2)

// Security evidence is separate from product analytics and never sent to Sentry.
// Persist before returning so a pod replacement does not erase a completed write.
func RecordSecurityRequest(c *fiber.Ctx) error {
	err := c.Next()
	status := c.Response().StatusCode()
	var httpErr *fiber.Error
	if errors.As(err, &httpErr) {
		status = httpErr.Code
	} else if err != nil {
		status = 500
	}
	endpoint := "unmatched"
	if r := c.Route(); r != nil && r.Method != "USE" && r.Path != "" {
		endpoint = r.Path
	}
	sensitive := false
	for _, prefix := range []string{"/admin", "/users", "/extension", "/support", "/webhooks", "/internal", "/business-leads"} {
		if strings.HasPrefix(endpoint, prefix) {
			sensitive = true
			break
		}
	}
	if status < 400 && !sensitive {
		return err
	}
	method := c.Method()
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD":
	default:
		method = "OTHER"
	}
	actor, _ := c.Locals("user_id").(string)
	event := securityRequest{HashUserSub(actor), securitySource(c.IP(), time.Now()), method, endpoint, status}
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	if !persistSecurityRequest(ctx, event, actor) {
		now := time.Now().Unix()
		last := auditWarningAt.Load()
		if now-last >= 60 && auditWarningAt.CompareAndSwap(last, now) {
			log.Print("[SecurityAudit] evidence unavailable or daily budget reached; requests remain available")
		}
	}
	return err
}

func securitySource(ip string, at time.Time) string {
	salt := os.Getenv("SENTRY_USER_SALT")
	parsed := net.ParseIP(ip)
	if salt == "" || parsed == nil {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(salt))
	mac.Write([]byte("security-source:" + at.UTC().Format("2006-01-02") + ":" + parsed.String()))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

func persistSecurityRequest(ctx context.Context, e securityRequest, subject string) bool {
	select {
	case auditSlots <- struct{}{}:
		defer func() { <-auditSlots }()
	default:
		return false
	}
	if DBPool == nil {
		return false
	}
	var recorded bool
	err := DBPool.QueryRow(ctx, `SELECT record_security_request($1,$2,$3,$4,$5,$6)`, e.Actor, e.Source, e.Method, e.Endpoint, e.Status, subject).Scan(&recorded)
	return err == nil && recorded
}
