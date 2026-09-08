package support

import (
	"context"
	"crypto/subtle"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
	_ "time/tzdata" // the scratch-based api image carries no zoneinfo

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
)

// =============================================================================
// Daily digest — one pinned Queue thread (REL-245)
// =============================================================================
//
// The audit that produced this ticket found 13 drafts pending since May,
// some for months. Nothing was broken; nobody was told. The digest is the
// telling: one post a morning in a pinned thread, with what is waiting and
// what happened yesterday. Silence means an empty queue, so an unbroken run
// of no-post mornings is itself the signal that the queue is clear.

const (
	digestHour     = 9 // 09:00 local
	digestTimezone = "America/Chicago"
	// queueThreadKey squats one row in support_ticket_threads rather than
	// adding a table for a single id. Ticket numbers are digits, so it can
	// never collide with a real one.
	queueThreadKey = "__queue__"
)

// StartSupportDigest posts the queue digest every morning at 09:00 Central.
// Redis-locked so one replica posts. No-op when Discord isn't configured.
func StartSupportDigest(ctx context.Context) {
	if !shouldNotifyDiscord() {
		log.Println("[Digest] Discord not configured; digest disabled")
		return
	}
	loc, err := time.LoadLocation(digestTimezone)
	if err != nil {
		log.Printf("[Digest] load %s: %v; digest disabled", digestTimezone, err)
		return
	}

	go func() {
		for {
			wait := time.Until(nextDigestTime(time.Now().In(loc), loc))
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}

			// Day-keyed lock: whichever replica wakes first posts, the
			// rest find the key taken. 23h TTL so it always clears before
			// the next morning.
			if platform.Rdb != nil {
				key := "support:digest:" + time.Now().In(loc).Format("2006-01-02")
				locked, err := platform.Rdb.SetNX(ctx, key, "1", 23*time.Hour).Result()
				if err != nil || !locked {
					continue
				}
			}
			runCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
			if err := postSupportDigest(runCtx, loc); err != nil {
				log.Printf("[Digest] post: %v", err)
			}
			cancel()
		}
	}()
	log.Printf("[Digest] daily queue digest started (%02d:00 %s)", digestHour, digestTimezone)
}

// nextDigestTime is the next digestHour in loc strictly after now.
func nextDigestTime(now time.Time, loc *time.Location) time.Time {
	next := time.Date(now.Year(), now.Month(), now.Day(), digestHour, 0, 0, 0, loc)
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

// digestStats is one morning's numbers.
type digestStats struct {
	Pending   int
	Stale     []staleDraft // pending > 48 h, oldest first
	FollowUps int          // pending drafts that answer a user's reply
	Sent      int
	Edited    int
	Skipped   int
}

type staleDraft struct {
	TicketNumber string
	Summary      string
	Age          time.Duration
}

// Empty reports whether there is nothing worth posting. An empty queue and
// a quiet yesterday means no digest at all.
func (d digestStats) Empty() bool {
	return d.Pending == 0 && d.Sent == 0 && d.Edited == 0 && d.Skipped == 0
}

// collectDigestStats reads the queue state in three queries.
func collectDigestStats(ctx context.Context, loc *time.Location) (digestStats, error) {
	var s digestStats
	if platform.DBPool == nil {
		return s, fmt.Errorf("DB not initialized")
	}

	// Yesterday in the digest's own timezone, not UTC — "yesterday" has to
	// mean the day the person reading it just finished.
	now := time.Now().In(loc)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	yesterdayStart := dayStart.AddDate(0, 0, -1)

	const counts = `
		SELECT
			(SELECT COUNT(*) FROM support_drafts WHERE status = 'pending'),
			(SELECT COUNT(*) FROM support_drafts
			  WHERE status = 'pending' AND osticket_thread_entry_id IS NOT NULL),
			(SELECT COUNT(*) FROM support_drafts
			  WHERE status IN ('approved','sent') AND decided_at >= $1 AND decided_at < $2),
			(SELECT COUNT(*) FROM support_drafts
			  WHERE status = 'edited' AND decided_at >= $1 AND decided_at < $2),
			(SELECT COUNT(*) FROM support_drafts
			  WHERE status = 'skipped' AND decided_at >= $1 AND decided_at < $2)
	`
	if err := platform.DBPool.QueryRow(ctx, counts, yesterdayStart, dayStart).Scan(
		&s.Pending, &s.FollowUps, &s.Sent, &s.Edited, &s.Skipped); err != nil {
		return s, fmt.Errorf("digest counts: %w", err)
	}

	const stale = `
		SELECT ticket_number, COALESCE(NULLIF(ai_summary,''), original_subject, ''), created_at
		FROM support_drafts
		WHERE status = 'pending' AND created_at < now() - interval '48 hours'
		ORDER BY created_at ASC
		LIMIT 15
	`
	rows, err := platform.DBPool.Query(ctx, stale)
	if err != nil {
		return s, fmt.Errorf("digest stale: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d staleDraft
		var created time.Time
		if err := rows.Scan(&d.TicketNumber, &d.Summary, &created); err != nil {
			continue
		}
		d.Age = time.Since(created)
		s.Stale = append(s.Stale, d)
	}
	return s, rows.Err()
}

// renderDigest turns the numbers into the post. Kept separate from the
// posting so the wording is readable — and testable — on its own.
func renderDigest(s digestStats, day time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "**Support queue — %s**\n\n", day.Format("Mon 2 Jan"))

	if s.Pending == 0 {
		b.WriteString("📭 Nothing pending.\n")
	} else {
		fmt.Fprintf(&b, "⏳ **%d pending**", s.Pending)
		if s.FollowUps > 0 {
			fmt.Fprintf(&b, " · %d of them are follow-ups waiting on an answer", s.FollowUps)
		}
		b.WriteString("\n")
	}

	if len(s.Stale) > 0 {
		fmt.Fprintf(&b, "\n🔴 **Waiting more than 48 h (%d):**\n", len(s.Stale))
		for _, d := range s.Stale {
			summary := d.Summary
			if summary == "" {
				summary = "(no summary)"
			}
			summary = truncateRunes(summary, 90)
			fmt.Fprintf(&b, "• **#%s** — %s _(%s)_\n", d.TicketNumber, summary, humanAge(d.Age))
		}
	}

	fmt.Fprintf(&b, "\n**Yesterday:** %d sent · %d edited · %d skipped\n", s.Sent, s.Edited, s.Skipped)
	b.WriteString("\n`/inbox` to work the queue · `/search <text>` to look something up")
	return b.String()
}

// humanAge renders a duration the way a person reads a backlog: days when
// it has been days, hours when it hasn't.
func humanAge(d time.Duration) string {
	if days := int(d.Hours() / 24); days >= 1 {
		if days == 1 {
			return "1 day"
		}
		return fmt.Sprintf("%d days", days)
	}
	return fmt.Sprintf("%dh", int(d.Hours()))
}

// postSupportDigest collects, renders and posts. Returns nil (having done
// nothing) when the queue and yesterday were both empty.
func postSupportDigest(ctx context.Context, loc *time.Location) error {
	stats, err := collectDigestStats(ctx, loc)
	if err != nil {
		return err
	}
	if stats.Empty() {
		log.Println("[Digest] queue empty and yesterday quiet; nothing posted")
		return nil
	}

	threadID, err := ensureQueueThread(ctx)
	if err != nil {
		return err
	}
	content := renderDigest(stats, time.Now().In(loc))
	for _, chunk := range splitForDiscord(content, discordMessageLimit) {
		if _, err := discordPostMessage(ctx, threadID, chunk, nil); err != nil {
			return fmt.Errorf("post digest: %w", err)
		}
	}
	log.Printf("[Digest] posted (%d pending, %d stale)", stats.Pending, len(stats.Stale))
	return nil
}

// HandleRunSupportDigest serves POST /internal/support/digest — the same
// digest the scheduler posts at 09:00, on demand. Gated by the shared
// webhook secret, like the case search beside it.
//
// It exists because a scheduled job you cannot trigger is a job you cannot
// test: this is how the digest was verified on production, and how a
// morning missed to a pod restart gets caught up.
func HandleRunSupportDigest(c *fiber.Ctx) error {
	expected := os.Getenv("SCROLLR_WEBHOOK_SECRET")
	provided := c.Get("X-Scrollr-Webhook-Secret")
	if expected == "" || provided == "" ||
		subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{
			Status: "error", Error: "unauthorized",
		})
	}
	loc, err := time.LoadLocation(digestTimezone)
	if err != nil {
		loc = time.UTC
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	stats, err := collectDigestStats(ctx, loc)
	if err != nil {
		log.Printf("[Digest] manual run: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "digest failed",
		})
	}
	if err := postSupportDigest(ctx, loc); err != nil {
		log.Printf("[Digest] manual run: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: err.Error(),
		})
	}
	return c.JSON(fiber.Map{
		"status": "ok", "posted": !stats.Empty(),
		"pending": stats.Pending, "stale": len(stats.Stale),
	})
}

// ensureQueueThread returns the pinned Queue thread's id, creating and
// pinning it the first time. The id is stored in support_ticket_threads
// under queueThreadKey so it survives restarts.
func ensureQueueThread(ctx context.Context) (string, error) {
	if existing, err := loadSupportTicketThread(ctx, queueThreadKey); err == nil && existing != nil {
		// A digest thread is never archived deliberately, but 3 days of
		// silence does it for us. Wake it rather than starting a new one.
		if existing.Archived {
			_ = discordUnarchiveThread(ctx, existing.DiscordThreadID)
		}
		return existing.DiscordThreadID, nil
	}

	cfg, ok := loadDiscordConfig()
	if !ok {
		return "", fmt.Errorf("discord not configured")
	}
	thread, err := discordCreateThread(ctx, cfg.SupportChannelID, "📋 Queue",
		"The morning digest lands here: what is waiting, what is old, what happened yesterday.",
		nil, nil, nil)
	if err != nil {
		return "", fmt.Errorf("create queue thread: %w", err)
	}
	if err := upsertSupportTicketThread(ctx, &SupportTicketThread{
		TicketNumber:    queueThreadKey,
		DiscordThreadID: thread.ID,
		ChannelID:       cfg.SupportChannelID,
	}); err != nil {
		// Losing the mapping means tomorrow makes a second Queue thread.
		// Worth a loud log, not worth failing today's digest.
		log.Printf("[Digest] persist queue thread id: %v", err)
	}
	if err := discordPinForumThread(ctx, thread.ID); err != nil {
		log.Printf("[Digest] pin queue thread: %v", err)
	}
	return thread.ID, nil
}
