package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

// =============================================================================
// Desktop presence (SCROLLR-210)
// =============================================================================
//
// The desktop's Rust core checks in every ~30 s while the app runs. Each
// check-in is one session (one running process on one computer) reporting
// what it can see: whether the OS session is locked, whether there was input
// recently, whether the display is asleep, and for every ticker window whether
// it is shown and which catalog widget types it is rendering. Nothing about
// what those widgets contain is accepted — the vocabulary is the server
// catalog and anything else is dropped on receipt.
//
// Live state is Redis (one key per session, 90 s TTL). History is credited
// from the interval between two consecutive check-ins of the same session,
// using the state that held at the START of the interval, split at UTC hour
// boundaries into small aggregate tables. An interval longer than the window
// is an unexplained gap and credits nothing.
//
// The contract is docs/analytics/ADMIN_DASHBOARD.md.

const (
	// PresenceExpiry is how long a session counts as current after its last
	// check-in. Missed shutdowns, crashes and lost networks expire naturally.
	PresenceExpiry = 90 * time.Second
	// presenceInterval is the client's cadence; only documentation here.
	presenceInterval = 30 * time.Second

	presenceIndexKey     = "presence:index"
	presenceSessionKey   = "presence:session:"
	presenceMaxSessions  = 5000
	presenceMaxScreens   = 16
	presenceMaxWidgets   = 64
	presenceMaxSessionID = 64
)

var (
	presenceNow       = time.Now
	presenceSessionRe = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)
	presenceScreenRe  = regexp.MustCompile(`^ticker(-[0-9]{1,3})?$`)

	presenceSessionValues = map[string]struct{}{"unlocked": {}, "locked": {}, "unknown": {}}
	presenceInputValues   = map[string]struct{}{"recent": {}, "idle": {}, "unknown": {}}
	presenceDisplayValues = map[string]struct{}{"awake": {}, "asleep": {}, "unknown": {}}
	presenceTickerValues  = map[string]struct{}{"disabled": {}, "shown": {}, "hidden": {}}
)

// PresenceScreen is one ticker window as the client reports it.
type PresenceScreen struct {
	Screen  string   `json:"screen"`
	Shown   bool     `json:"shown"`
	Widgets []string `json:"widgets"`
}

// presenceCheckIn is the request body. decodeStrict rejects anything else.
type presenceCheckIn struct {
	SessionID string           `json:"session_id"`
	Seq       int64            `json:"seq"`
	Session   string           `json:"session"`
	Input     string           `json:"input"`
	Display   string           `json:"display"`
	Ticker    string           `json:"ticker"`
	Screens   []PresenceScreen `json:"screens"`
	Ended     bool             `json:"ended"`
}

// PresenceLive is one session's live state as kept in Redis.
type PresenceLive struct {
	Sub        string           `json:"sub"`
	SessionID  string           `json:"session_id"`
	Seq        int64            `json:"seq"`
	StartedAt  time.Time        `json:"started_at"`
	At         time.Time        `json:"at"`
	Session    string           `json:"session"`
	Input      string           `json:"input"`
	Display    string           `json:"display"`
	Ticker     string           `json:"ticker"`
	Screens    []PresenceScreen `json:"screens"`
	OS         string           `json:"os"`
	AppVersion string           `json:"app_version"`
	Internal   bool             `json:"internal"`
	// Ended marks a tombstone: the session reported quit or suspend. It stays
	// under the session key for the expiry so a late check-in of that
	// session is rejected, and it is never in the live index.
	Ended bool `json:"ended,omitempty"`
}

// ShownScreens is the number of screens that count as ticker-shown: the
// window is visible, the OS session is not locked and the display is not
// asleep. Idle input never disqualifies — Scrollr is watched, not typed at.
func (p PresenceLive) ShownScreens() int {
	if p.Session == "locked" || p.Display == "asleep" {
		return 0
	}
	n := 0
	for _, s := range p.Screens {
		if s.Shown {
			n++
		}
	}
	return n
}

// ShownWidgets is the union of widget types on screens that count as shown.
func (p PresenceLive) ShownWidgets() map[string]int {
	out := map[string]int{}
	if p.Session == "locked" || p.Display == "asleep" {
		return out
	}
	for _, s := range p.Screens {
		if !s.Shown {
			continue
		}
		for _, w := range s.Widgets {
			out[w]++
		}
	}
	return out
}

func validatePresence(req *presenceCheckIn) error {
	if !presenceSessionRe.MatchString(req.SessionID) {
		return errors.New("session_id must be 8-64 letters, digits or dashes")
	}
	if req.Seq < 0 {
		return errors.New("seq must not be negative")
	}
	if _, ok := presenceSessionValues[req.Session]; !ok {
		return errors.New("session must be unlocked, locked or unknown")
	}
	if _, ok := presenceInputValues[req.Input]; !ok {
		return errors.New("input must be recent, idle or unknown")
	}
	if _, ok := presenceDisplayValues[req.Display]; !ok {
		return errors.New("display must be awake, asleep or unknown")
	}
	if _, ok := presenceTickerValues[req.Ticker]; !ok {
		return errors.New("ticker must be disabled, shown or hidden")
	}
	if len(req.Screens) > presenceMaxScreens {
		return errors.New("too many screens")
	}
	seen := map[string]struct{}{}
	for i := range req.Screens {
		s := &req.Screens[i]
		if !presenceScreenRe.MatchString(s.Screen) {
			return errors.New("screen must be a ticker window label")
		}
		if _, dup := seen[s.Screen]; dup {
			return errors.New("duplicate screen")
		}
		seen[s.Screen] = struct{}{}
		if len(s.Widgets) > presenceMaxWidgets {
			return errors.New("too many widgets")
		}
		s.Widgets = knownWidgetTypes(s.Widgets)
	}
	return nil
}

// knownWidgetTypes keeps only catalog ids, deduplicated and sorted. The
// closed vocabulary is the privacy boundary: a value that is not a catalog id
// never reaches storage, whatever it was.
func knownWidgetTypes(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]struct{}{}
	for _, w := range in {
		if _, ok := platform.WidgetByID(w); !ok {
			continue
		}
		if _, dup := seen[w]; dup {
			continue
		}
		seen[w] = struct{}{}
		out = append(out, w)
	}
	sort.Strings(out)
	return out
}

// HandlePresenceCheckIn - POST /users/me/presence
//
// 204 when the account has usage analytics off: the desktop cannot always
// know, and a check-in that is not wanted is simply not recorded. 200 with
// {"recorded": true} otherwise.
func HandlePresenceCheckIn(c *fiber.Ctx) error {
	userID := platform.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(platform.ErrorResponse{Status: "unauthorized", Error: "Authentication required"})
	}
	var req presenceCheckIn
	if err := decodeStrict(c.Body(), &req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: "Unknown presence field"})
	}
	if err := validatePresence(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{Status: "error", Error: err.Error()})
	}
	if platform.Rdb == nil || platform.DBPool == nil {
		return c.SendStatus(fiber.StatusNoContent)
	}
	version, os := platform.ParseClientUA(c.Get(fiber.HeaderUserAgent))
	recorded, err := recordPresence(context.Background(), userID, req, version, os, presenceNow().UTC())
	if errors.Is(err, errNotEnrolled) {
		return c.SendStatus(fiber.StatusNoContent)
	}
	if err != nil {
		log.Printf("[Presence] check-in: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{Status: "error", Error: "Could not record presence"})
	}
	return c.JSON(fiber.Map{"recorded": recorded})
}

// IsExcludedActor reports whether a sub is on the configured test-account
// list (POSTHOG_EXCLUDED_LOGTO_SUBS). Exported for the admin readers that
// remove those accounts from audience figures.
func IsExcludedActor(sub string) bool { return postHogActorExcluded(sub) }

func presenceKey(sub, session string) string {
	return presenceSessionKey + sub + ":" + session
}

func presenceMember(sub, session string) string {
	return sub + "\x00" + session
}

func splitPresenceMember(member string) (sub, session string, ok bool) {
	i := strings.IndexByte(member, 0)
	if i < 0 {
		return "", "", false
	}
	return member[:i], member[i+1:], true
}

// recordPresence credits the interval since the previous check-in of the same
// session and stores the new live state. The reported value is false when the
// check-in was stale (an older seq than the one on record) and was ignored.
func recordPresence(ctx context.Context, sub string, req presenceCheckIn, version, os string, now time.Time) (bool, error) {
	key := presenceKey(sub, req.SessionID)

	tx, err := platform.DBPool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if err := lockAccountMutation(ctx, tx, sub); err != nil {
		return false, err
	}
	// Staff is a table, not a stored flag: an account pinned to admin_users
	// after it enrolled is internal from its next check-in, not from its
	// next consent re-read.
	var internal bool
	if err := tx.QueryRow(ctx, `
		SELECT e.internal OR EXISTS (SELECT 1 FROM admin_users a WHERE a.logto_sub = e.logto_sub)
		  FROM product_analytics_enrollments e WHERE e.logto_sub = $1 FOR UPDATE`, sub).
		Scan(&internal); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Opted out (or never in): drop any live state this session left.
			removeLivePresenceSession(ctx, sub, req.SessionID)
			return false, errNotEnrolled
		}
		return false, err
	}

	// The previous state is read under the account lock so two check-ins of
	// the same session (a tick in flight when quit sends `ended`) serialize
	// on read-check-write instead of both crediting the same interval.
	var prev *PresenceLive
	if raw, err := platform.Rdb.Get(ctx, key).Bytes(); err == nil {
		var p PresenceLive
		if json.Unmarshal(raw, &p) == nil && p.Sub == sub {
			prev = &p
		}
	} else if !errors.Is(err, redis.Nil) {
		return false, fmt.Errorf("read live session: %w", err)
	}
	if prev != nil && req.Seq <= prev.Seq {
		// Out of order or replayed — including a tick that lost the race
		// against the session's own `ended` tombstone. The newer state on
		// record wins.
		return false, nil
	}

	next := PresenceLive{
		Sub: sub, SessionID: req.SessionID, Seq: req.Seq, StartedAt: now, At: now,
		Session: req.Session, Input: req.Input, Display: req.Display, Ticker: req.Ticker,
		Screens: req.Screens, OS: os, AppVersion: version, Internal: internal,
	}
	if req.Screens == nil {
		next.Screens = []PresenceScreen{}
	}
	// An ended session's tombstone proves nothing about the gap after it: a
	// resume within 90 s starts a fresh interval.
	if prev != nil && !prev.Ended {
		next.StartedAt = prev.StartedAt
		if err := creditPresence(ctx, tx, *prev, now); err != nil {
			return false, fmt.Errorf("credit interval: %w", err)
		}
	}
	day := now.Truncate(24 * time.Hour)
	if _, err := tx.Exec(ctx, `
		INSERT INTO presence_accounts (logto_sub, first_seen_day, internal)
		VALUES ($1, $2, $3)
		ON CONFLICT (logto_sub) DO UPDATE SET internal = EXCLUDED.internal`,
		sub, day, internal); err != nil {
		return false, err
	}
	// Live state is written before the commit, still under the lock: a
	// commit that then fails under-credits one interval rather than
	// inventing one. `ended` leaves a tombstone under the same key (same
	// TTL, out of the index) so a late tick of the dead session is rejected
	// by the seq guard instead of resurrecting it for 90 s.
	next.Ended = req.Ended
	raw, _ := json.Marshal(next)
	pipe := platform.Rdb.Pipeline()
	pipe.Set(ctx, key, raw, PresenceExpiry)
	if req.Ended {
		pipe.ZRem(ctx, presenceIndexKey, presenceMember(sub, req.SessionID))
	} else {
		pipe.ZAdd(ctx, presenceIndexKey, redis.Z{Score: float64(now.Unix()), Member: presenceMember(sub, req.SessionID)})
	}
	pipe.ZRemRangeByScore(ctx, presenceIndexKey, "-inf", strconv.FormatInt(now.Add(-PresenceExpiry).Unix(), 10))
	if _, err := pipe.Exec(ctx); err != nil {
		return false, fmt.Errorf("write live session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func removeLivePresenceSession(ctx context.Context, sub, session string) {
	if platform.Rdb == nil {
		return
	}
	pipe := platform.Rdb.Pipeline()
	pipe.Del(ctx, presenceKey(sub, session))
	pipe.ZRem(ctx, presenceIndexKey, presenceMember(sub, session))
	_, _ = pipe.Exec(ctx)
}

// RemoveLivePresence drops every live session of an account. Called on
// opt-out and purge, in the same breath as the database cascade.
func RemoveLivePresence(ctx context.Context, sub string) {
	if platform.Rdb == nil {
		return
	}
	members, err := platform.Rdb.ZRange(ctx, presenceIndexKey, 0, -1).Result()
	if err != nil {
		return
	}
	for _, m := range members {
		s, session, ok := splitPresenceMember(m)
		if ok && s == sub {
			removeLivePresenceSession(ctx, sub, session)
		}
	}
}

// ── Crediting ────────────────────────────────────────────────────────────────

// hourSlice is part of one interval that falls inside one UTC hour.
type hourSlice struct {
	Hour    time.Time
	Seconds int
}

// splitByHour cuts [from, to) at UTC hour boundaries. Seconds are whole and
// rounded per slice: check-ins arrive with network jitter either side of
// 30 s, and truncation would lose a whole second on every early arrival.
func splitByHour(from, to time.Time) []hourSlice {
	var out []hourSlice
	if !to.After(from) {
		return out
	}
	cursor := from
	for cursor.Before(to) {
		hour := cursor.Truncate(time.Hour)
		next := hour.Add(time.Hour)
		if next.After(to) {
			next = to
		}
		if secs := int(math.Round(next.Sub(cursor).Seconds())); secs > 0 {
			out = append(out, hourSlice{Hour: hour, Seconds: secs})
		}
		cursor = next
	}
	return out
}

// creditPresence writes what the interval [prev.At, now) proves, using the
// state prev reported. A gap longer than PresenceExpiry proves nothing.
func creditPresence(ctx context.Context, tx pgx.Tx, prev PresenceLive, now time.Time) error {
	if !now.After(prev.At) || now.Sub(prev.At) > PresenceExpiry {
		return nil
	}
	shownScreens := prev.ShownScreens()
	tickerShown := shownScreens > 0
	widgets := prev.ShownWidgets()

	// Per session (per computer): plain sums.
	for _, s := range splitByHour(prev.At, now) {
		ticker := 0
		if tickerShown {
			ticker = s.Seconds
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO presence_session_hourly
				(logto_sub, session_id, hour, os, app_version, internal,
				 running_seconds, ticker_seconds, screen_seconds, max_shown_screens)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (logto_sub, session_id, hour) DO UPDATE SET
				running_seconds   = presence_session_hourly.running_seconds + EXCLUDED.running_seconds,
				ticker_seconds    = presence_session_hourly.ticker_seconds + EXCLUDED.ticker_seconds,
				screen_seconds    = presence_session_hourly.screen_seconds + EXCLUDED.screen_seconds,
				max_shown_screens = GREATEST(presence_session_hourly.max_shown_screens, EXCLUDED.max_shown_screens),
				os = EXCLUDED.os, app_version = EXCLUDED.app_version, internal = EXCLUDED.internal`,
			prev.Sub, prev.SessionID, s.Hour, prev.OS, prev.AppVersion, prev.Internal,
			s.Seconds, ticker, s.Seconds*shownScreens, shownScreens); err != nil {
			return err
		}
		if prev.Session == "locked" || prev.Display == "asleep" {
			continue
		}
		for _, screen := range prev.Screens {
			if !screen.Shown {
				continue
			}
			for _, w := range screen.Widgets {
				if _, err := tx.Exec(ctx, `
					INSERT INTO presence_widget_hourly
						(logto_sub, session_id, screen, hour, widget_type, internal, screen_seconds)
					VALUES ($1, $2, $3, $4, $5, $6, $7)
					ON CONFLICT (logto_sub, session_id, screen, hour, widget_type) DO UPDATE SET
						screen_seconds = presence_widget_hourly.screen_seconds + EXCLUDED.screen_seconds,
						internal = EXCLUDED.internal`,
					prev.Sub, prev.SessionID, screen.Screen, s.Hour, w, prev.Internal, s.Seconds); err != nil {
					return err
				}
			}
		}
	}

	// Per account: overlapping sessions count once, through watermarks.
	keys := []string{"running"}
	if tickerShown {
		keys = append(keys, "ticker")
	}
	for w := range widgets {
		keys = append(keys, "widget:"+w)
	}
	sort.Strings(keys)
	marks, err := loadWatermarks(ctx, tx, prev.Sub, keys)
	if err != nil {
		return err
	}
	for _, key := range keys {
		from := prev.At
		if wm, ok := marks[key]; ok && wm.After(from) {
			from = wm
		}
		if !now.After(from) {
			continue
		}
		for _, s := range splitByHour(from, now) {
			switch {
			case key == "running":
				if _, err := tx.Exec(ctx, `
					INSERT INTO presence_account_hourly (logto_sub, hour, internal, running_seconds)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (logto_sub, hour) DO UPDATE SET
						running_seconds = presence_account_hourly.running_seconds + EXCLUDED.running_seconds,
						internal = EXCLUDED.internal`,
					prev.Sub, s.Hour, prev.Internal, s.Seconds); err != nil {
					return err
				}
			case key == "ticker":
				if _, err := tx.Exec(ctx, `
					INSERT INTO presence_account_hourly (logto_sub, hour, internal, ticker_seconds)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (logto_sub, hour) DO UPDATE SET
						ticker_seconds = presence_account_hourly.ticker_seconds + EXCLUDED.ticker_seconds,
						internal = EXCLUDED.internal`,
					prev.Sub, s.Hour, prev.Internal, s.Seconds); err != nil {
					return err
				}
			default:
				if _, err := tx.Exec(ctx, `
					INSERT INTO presence_widget_account_hourly (logto_sub, hour, widget_type, internal, user_seconds)
					VALUES ($1, $2, $3, $4, $5)
					ON CONFLICT (logto_sub, hour, widget_type) DO UPDATE SET
						user_seconds = presence_widget_account_hourly.user_seconds + EXCLUDED.user_seconds,
						internal = EXCLUDED.internal`,
					prev.Sub, s.Hour, strings.TrimPrefix(key, "widget:"), prev.Internal, s.Seconds); err != nil {
					return err
				}
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO presence_watermarks (logto_sub, key, credited_until)
			VALUES ($1, $2, $3)
			ON CONFLICT (logto_sub, key) DO UPDATE SET
				credited_until = GREATEST(presence_watermarks.credited_until, EXCLUDED.credited_until)`,
			prev.Sub, key, now); err != nil {
			return err
		}
	}
	return nil
}

func loadWatermarks(ctx context.Context, tx pgx.Tx, sub string, keys []string) (map[string]time.Time, error) {
	rows, err := tx.Query(ctx, `
		SELECT key, credited_until FROM presence_watermarks
		 WHERE logto_sub = $1 AND key = ANY($2) FOR UPDATE`, sub, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]time.Time{}
	for rows.Next() {
		var key string
		var until time.Time
		if err := rows.Scan(&key, &until); err != nil {
			return nil, err
		}
		out[key] = until.UTC()
	}
	return out, rows.Err()
}

// ── Live readers ─────────────────────────────────────────────────────────────

// LivePresenceSessions returns every current session, oldest check-in first.
// Expired index entries are swept on the way past.
func LivePresenceSessions(ctx context.Context, now time.Time) ([]PresenceLive, error) {
	if platform.Rdb == nil {
		return nil, errors.New("redis unavailable")
	}
	cutoff := strconv.FormatInt(now.Add(-PresenceExpiry).Unix(), 10)
	_ = platform.Rdb.ZRemRangeByScore(ctx, presenceIndexKey, "-inf", "("+cutoff).Err()
	members, err := platform.Rdb.ZRangeByScore(ctx, presenceIndexKey, &redis.ZRangeBy{
		Min: cutoff, Max: "+inf", Count: presenceMaxSessions,
	}).Result()
	if err != nil {
		return nil, err
	}
	if len(members) == 0 {
		return []PresenceLive{}, nil
	}
	keys := make([]string, 0, len(members))
	for _, m := range members {
		sub, session, ok := splitPresenceMember(m)
		if ok {
			keys = append(keys, presenceKey(sub, session))
		}
	}
	values, err := platform.Rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}
	out := make([]PresenceLive, 0, len(values))
	for _, v := range values {
		s, ok := v.(string)
		if !ok {
			continue
		}
		var p PresenceLive
		if json.Unmarshal([]byte(s), &p) != nil {
			continue
		}
		if now.Sub(p.At) > PresenceExpiry {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

// PresenceHeadline is the strip on the Overview, plus the state breakdown
// behind it.
type PresenceHeadline struct {
	ActiveUsers int `json:"active_users"`
	TickerUsers int `json:"ticker_users"`
	Screens     int `json:"screens"`
	Sessions    int `json:"sessions"`

	// Breakdowns are per session (per computer); a user with two computers
	// appears in both.
	SessionState map[string]int `json:"session_state"`
	InputState   map[string]int `json:"input_state"`
	DisplayState map[string]int `json:"display_state"`
	TickerState  map[string]int `json:"ticker_state"`
	// ScreensPerUser buckets active users by how many shown screens they
	// have across all their computers: "0", "1", "2+".
	ScreensPerUser map[string]int `json:"screens_per_user"`
	OS             map[string]int `json:"os"`
	AppVersion     map[string]int `json:"app_version"`
}

// SummarizePresence folds live sessions into the headline. Users are
// deduplicated by account; screens add across computers.
func SummarizePresence(sessions []PresenceLive, excludeInternal bool) PresenceHeadline {
	h := PresenceHeadline{
		SessionState: map[string]int{}, InputState: map[string]int{}, DisplayState: map[string]int{},
		TickerState: map[string]int{}, ScreensPerUser: map[string]int{}, OS: map[string]int{}, AppVersion: map[string]int{},
	}
	screensByUser := map[string]int{}
	for _, s := range sessions {
		if excludeInternal && s.Internal {
			continue
		}
		h.Sessions++
		h.SessionState[s.Session]++
		h.InputState[s.Input]++
		h.DisplayState[s.Display]++
		tickerState := s.Ticker
		if s.ShownScreens() > 0 {
			tickerState = "shown"
		} else if tickerState == "shown" {
			tickerState = "hidden"
		}
		h.TickerState[tickerState]++
		h.OS[s.OS]++
		h.AppVersion[s.AppVersion]++
		shown := s.ShownScreens()
		h.Screens += shown
		if _, seen := screensByUser[s.Sub]; !seen {
			screensByUser[s.Sub] = 0
		}
		screensByUser[s.Sub] += shown
	}
	h.ActiveUsers = len(screensByUser)
	for _, n := range screensByUser {
		switch {
		case n == 0:
			h.ScreensPerUser["0"]++
		case n == 1:
			h.ScreensPerUser["1"]++
			h.TickerUsers++
		default:
			h.ScreensPerUser["2+"]++
			h.TickerUsers++
		}
	}
	return h
}

// ── Concurrency sampler ──────────────────────────────────────────────────────

// StartPresenceSampler writes one concurrency sample per minute. Every
// replica samples the same Redis index and the upsert takes the maximum, so
// two replicas agree and no leader election is needed.
func StartPresenceSampler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				samplePresence(ctx, time.Now())
			}
		}
	}()
	log.Println("[Presence] concurrency sampler started (1m)")
}

func samplePresence(ctx context.Context, now time.Time) {
	if platform.DBPool == nil || platform.Rdb == nil {
		return
	}
	sessions, err := LivePresenceSessions(ctx, now)
	if err != nil {
		log.Printf("[Presence] sample: %v", err)
		return
	}
	// Samples exclude staff: the peak is a customer number, and the toggle
	// cannot un-mix a maximum after the fact.
	h := SummarizePresence(sessions, true)
	if _, err := platform.DBPool.Exec(ctx, `
		INSERT INTO presence_concurrency_minute (minute, users, ticker_users, screens)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (minute) DO UPDATE SET
			users = GREATEST(presence_concurrency_minute.users, EXCLUDED.users),
			ticker_users = GREATEST(presence_concurrency_minute.ticker_users, EXCLUDED.ticker_users),
			screens = GREATEST(presence_concurrency_minute.screens, EXCLUDED.screens)`,
		now.UTC().Truncate(time.Minute), h.ActiveUsers, h.TickerUsers, h.Screens); err != nil {
		log.Printf("[Presence] sample write: %v", err)
	}
}
