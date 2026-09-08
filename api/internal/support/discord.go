package support

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

// =============================================================================
// Discord integration — REST client + signature verification
// =============================================================================
//
// Scrollr's support-triage pipeline uses Discord as the partner-facing
// UI for approving / editing / skipping AI-drafted replies. Today we ALSO
// notify via email; Discord runs in addition for now.
//
// All Discord logic lives in core-api (no separate bot service). Two
// directions of traffic:
//
//   Outbound (us → Discord): REST API calls authenticated with bot token
//     - POST /api/v10/channels/{channel_id}/threads     (create thread)
//     - POST /api/v10/channels/{thread_id}/messages     (post in thread)
//     - PATCH /api/v10/channels/{thread_id}             (archive thread)
//     - PUT /api/v10/applications/{app_id}/guilds/{guild_id}/commands
//
//   Inbound (Discord → us): HTTP POSTs to /webhooks/discord/interactions
//     verified via Ed25519 signatures (DISCORD_PUBLIC_KEY).
//
// Failure mode is fail-open: if Discord calls fail, we log and continue.
// The email notification path stays active as a backup.

const (
	discordAPIBase     = "https://discord.com/api/v10"
	discordHTTPTimeout = 10 * time.Second
)

// DiscordConfig groups the env-driven config in one struct so callers
// can quick-check whether Discord integration is enabled (any missing
// required field => disabled, log once at startup).
type DiscordConfig struct {
	BotToken         string // Bot token from Discord application
	PublicKey        string // Hex-encoded Ed25519 public key for verifying inbound interactions
	ApplicationID    string // Discord application snowflake ID
	GuildID          string // Discord server (guild) snowflake ID
	SupportChannelID string // Channel in which support threads are created
}

// loadDiscordConfig reads env vars and returns a config.
// Returns (cfg, true) when ALL required fields are populated; otherwise
// (zero-value, false). Callers should treat false as "Discord disabled".
func loadDiscordConfig() (DiscordConfig, bool) {
	cfg := DiscordConfig{
		BotToken:         os.Getenv("DISCORD_BOT_TOKEN"),
		PublicKey:        os.Getenv("DISCORD_PUBLIC_KEY"),
		ApplicationID:    os.Getenv("DISCORD_APPLICATION_ID"),
		GuildID:          os.Getenv("DISCORD_GUILD_ID"),
		SupportChannelID: os.Getenv("DISCORD_SUPPORT_CHANNEL_ID"),
	}
	if cfg.BotToken == "" || cfg.PublicKey == "" ||
		cfg.ApplicationID == "" || cfg.GuildID == "" ||
		cfg.SupportChannelID == "" {
		return DiscordConfig{}, false
	}
	return cfg, true
}

// loadDiscordPublicKey returns just the public key, which is the only
// field strictly required for handling inbound interactions (PING +
// signature verification on button + modal events). Returns ("", false)
// when DISCORD_PUBLIC_KEY isn't set.
//
// Decoupled from loadDiscordConfig so that URL verification in the
// Discord developer portal can succeed even before all 5 secrets are
// wired — the verification PING only needs the public key. Outbound
// paths (thread creation, message posting, etc.) still gate on the
// full loadDiscordConfig.
func loadDiscordPublicKey() (string, bool) {
	pk := os.Getenv("DISCORD_PUBLIC_KEY")
	if pk == "" {
		return "", false
	}
	return pk, true
}

// notifyMode returns the SUPPORT_NOTIFY env var value. Defaults to
// "both" so existing email notifications keep flowing during rollout.
//
// Returned values: "discord", "email", "both".
func notifyMode() string {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("SUPPORT_NOTIFY")))
	switch v {
	case "discord", "email", "both":
		return v
	default:
		return "both"
	}
}

// shouldNotifyEmail returns true when we should send the email
// notification for this draft (per SUPPORT_NOTIFY).
func shouldNotifyEmail() bool {
	m := notifyMode()
	return m == "email" || m == "both"
}

// shouldNotifyDiscord returns true when Discord integration is enabled
// AND the SUPPORT_NOTIFY mode includes Discord.
func shouldNotifyDiscord() bool {
	if _, ok := loadDiscordConfig(); !ok {
		return false
	}
	m := notifyMode()
	return m == "discord" || m == "both"
}

// =============================================================================
// Outbound Discord REST helpers
// =============================================================================

// discordHTTPClient is shared across requests.
var discordHTTPClient = &http.Client{Timeout: discordHTTPTimeout}

// discordRequest performs an authenticated REST call to Discord.
// Returns the response body bytes and HTTP status code.
//
// All callers should treat non-2xx as failure and log + continue (fail-open).
func discordRequest(ctx context.Context, method, path string, body interface{}) ([]byte, int, error) {
	cfg, ok := loadDiscordConfig()
	if !ok {
		return nil, 0, errors.New("discord not configured")
	}

	var bodyReader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(buf)
	}

	url := discordAPIBase + path
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bot "+cfg.BotToken)
	req.Header.Set("User-Agent", "ScrollrSupportBot (myscrollr.com, 1.0)")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := discordHTTPClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("discord request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return respBody, resp.StatusCode, nil
}

// =============================================================================
// Forum tags — category + status taxonomy on the support channel
// =============================================================================
//
// Forum-channel parents support up to 20 named "tags" with optional
// emoji + colour. We use them to surface ticket category and partner
// action state at-a-glance in the thread list. No extra writes needed
// at runtime once cached — tag IDs live in tagIDByName for the life of
// the pod.

// supportForumTagSpec is one tag we expect to exist on the support
// forum channel. ensureSupportForumTags creates any missing entries
// at startup.
type supportForumTagSpec struct {
	name      string // canonical name (lowercase, matches AI category names)
	emojiName string // unicode emoji rendered in the tag pill
}

// supportForumTagSpecs is the canonical set of tags we apply to
// support threads. Order matters only for UX: status tags first
// (they're the most-glanceable), then category tags.
var supportForumTagSpecs = []supportForumTagSpec{
	// Status tags (mutually exclusive — exactly one applied at any time)
	{"pending", "⏳"},
	{"sent", "✅"},
	{"edited", "✏️"},
	{"asked", "❓"},
	{"skipped", "⏭️"},
	{"closed", "🔒"},
	// Category tags (mutually exclusive within their category set)
	{"bug", "🐛"},
	{"feature", "💡"},
	{"feedback", "💬"},
	{"billing", "💳"},
	{"account", "👤"},
	{"widget", "📡"},
}

// tagIDByName caches the resolved tag IDs after ensureSupportForumTags
// runs. Populated once at startup; lookups in hot paths are O(1).
// Empty when Discord isn't configured or the parent channel isn't a
// forum (Text channels don't support tags) — callers must tolerate
// missing tags.
var tagIDByName sync.Map // map[name string] -> tagID string

// supportForumTagID returns the cached tag ID for a name, or "" when
// not present (Text channel parent, ensure call hasn't run, or unknown
// tag name).
func supportForumTagID(name string) string {
	if v, ok := tagIDByName.Load(name); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// statusTagNames returns the set of status-tag names so callers can
// strip whichever status the thread currently has before applying a
// new one (status tags are mutually exclusive).
var statusTagNames = map[string]struct{}{
	"pending": {},
	"sent":    {},
	"edited":  {},
	"asked":   {},
	"skipped": {},
	"closed":  {},
}

// =============================================================================
// Thread + message primitives
// =============================================================================

// DiscordThread is the minimal subset of Discord's Channel object we
// need from thread-creation responses.
type DiscordThread struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	GuildID  string `json:"guild_id"`
	ParentID string `json:"parent_id"`
}

// discordCreateThread starts a public thread under the support channel.
// Auto-detects parent channel type and uses the appropriate endpoint:
//
//   - Forum channel (type=15): single call to POST /channels/{id}/threads
//     with `message` body (REQUIRED for forums) — the starter message
//     content + buttons go inline. No second message-post needed.
//
//   - Text channel (type=0): two-step flow — POST /threads with `type=11`
//     and no message, then POST /messages to the new thread. The starter
//     content + components are posted as the first thread message.
//
// Returns the thread metadata. Even when the API returns extra info
// (like the starter message), we only need the thread ID downstream.
//
// auto_archive_duration: 4320 = 3 days. Threads auto-archive after this
// many minutes of inactivity. Coupled with our explicit archive-on-close
// path so resolved tickets vanish quickly.
//
// starterContent + starterComponents are required for forum channels and
// optional for text channels. When non-empty on a text channel, we post
// them as a follow-up message after creating the thread.
func discordCreateThread(
	ctx context.Context,
	channelID, name string,
	starterContent string,
	starterEmbed *discordEmbed,
	starterComponents []DiscordActionRow,
	appliedTagIDs []string,
) (*DiscordThread, error) {
	// Discord's hard limit on thread names is 100 characters, and it
	// rejects a name cut inside a multi-byte character outright.
	name = truncateRunes(name, 100)

	parentType, err := discordGetChannelType(ctx, channelID)
	if err != nil {
		return nil, fmt.Errorf("inspect parent channel: %w", err)
	}

	switch parentType {
	case discordChannelTypeForum, discordChannelTypeMedia:
		return discordCreateForumThread(ctx, channelID, name, starterContent, starterEmbed, starterComponents, appliedTagIDs)
	default:
		// Text channels don't support tags — appliedTagIDs is silently
		// dropped. Caller should still pass them; supports the case
		// where someone migrates a forum-channel parent to text.
		return discordCreateTextThread(ctx, channelID, name, starterContent, starterEmbed, starterComponents)
	}
}

// Discord channel types we branch on.
const (
	discordChannelTypeText  = 0
	discordChannelTypeForum = 15
	discordChannelTypeMedia = 16
)

// channelTypeCache memoises channel-type lookups so we only hit
// GET /channels/{id} once per channel per pod lifetime. Channel type
// can't change without recreating the channel, so caching forever is
// safe within a single process.
var channelTypeCache sync.Map // map[channelID string] -> int

// discordGetChannelType returns the channel's type (0=Text, 15=Forum,
// 16=Media, etc.) by hitting GET /channels/{id}. Cached after first call.
func discordGetChannelType(ctx context.Context, channelID string) (int, error) {
	if cached, ok := channelTypeCache.Load(channelID); ok {
		return cached.(int), nil
	}

	respBody, status, err := discordRequest(ctx, http.MethodGet,
		"/channels/"+channelID, nil)
	if err != nil {
		return 0, err
	}
	if status >= 400 {
		return 0, fmt.Errorf("discord get channel: status %d body %s", status, string(respBody))
	}
	var ch struct {
		Type int `json:"type"`
	}
	if err := json.Unmarshal(respBody, &ch); err != nil {
		return 0, fmt.Errorf("parse channel response: %w", err)
	}
	channelTypeCache.Store(channelID, ch.Type)
	return ch.Type, nil
}

// discordCreateForumThread creates a thread in a Forum / Media channel.
// Discord's "Start Thread in Forum or Media Channel" endpoint REQUIRES
// the `message` field — the starter message that becomes the first post.
// Buttons go in the starter message's components.
func discordCreateForumThread(
	ctx context.Context,
	channelID, name, starterContent string,
	starterEmbed *discordEmbed,
	starterComponents []DiscordActionRow,
	appliedTagIDs []string,
) (*DiscordThread, error) {
	if starterContent == "" && starterEmbed == nil {
		// Forum threads require a starter message; fall back to a
		// placeholder so the create call doesn't 400.
		starterContent = "(creating thread)"
	}
	msg := map[string]interface{}{
		"content":          starterContent,
		"allowed_mentions": map[string]interface{}{"parse": []string{}},
	}
	if starterEmbed != nil {
		msg["embeds"] = []*discordEmbed{starterEmbed}
	}
	if len(starterComponents) > 0 {
		msg["components"] = starterComponents
	}
	body := map[string]interface{}{
		"name":                  name,
		"auto_archive_duration": 4320,
		"message":               msg,
	}
	if len(appliedTagIDs) > 0 {
		body["applied_tags"] = appliedTagIDs
	}
	respBody, status, err := discordRequest(ctx, http.MethodPost,
		"/channels/"+channelID+"/threads", body)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("discord create forum thread: status %d body %s", status, string(respBody))
	}
	var t DiscordThread
	if err := json.Unmarshal(respBody, &t); err != nil {
		return nil, fmt.Errorf("parse thread response: %w", err)
	}
	return &t, nil
}

// discordCreateTextThread creates a thread under a Text channel.
// Discord's "Start Thread without Message" endpoint accepts
// `name` + `type` + `auto_archive_duration`, but does NOT accept a
// `message` field. After creation we post the starter content as a
// follow-up message in the new thread.
func discordCreateTextThread(
	ctx context.Context,
	channelID, name, starterContent string,
	starterEmbed *discordEmbed,
	starterComponents []DiscordActionRow,
) (*DiscordThread, error) {
	body := map[string]interface{}{
		"name":                  name,
		"type":                  11, // PUBLIC_THREAD
		"auto_archive_duration": 4320,
	}
	respBody, status, err := discordRequest(ctx, http.MethodPost,
		"/channels/"+channelID+"/threads", body)
	if err != nil {
		return nil, err
	}
	if status >= 400 {
		return nil, fmt.Errorf("discord create text thread: status %d body %s", status, string(respBody))
	}
	var t DiscordThread
	if err := json.Unmarshal(respBody, &t); err != nil {
		return nil, fmt.Errorf("parse thread response: %w", err)
	}

	// Post starter content as the first thread message.
	if starterContent != "" || starterEmbed != nil {
		if _, err := discordPostEmbed(ctx, t.ID, starterContent, starterEmbed, starterComponents); err != nil {
			// Thread is created in Discord; we just couldn't post the
			// starter message. Return the thread anyway — caller
			// shouldn't fail the whole flow over this.
			log.Printf("[Discord] post starter message in text thread %s: %v", t.ID, err)
		}
	}
	return &t, nil
}

// DiscordMessageButton is a minimal action-row button.
type DiscordMessageButton struct {
	Type     int    `json:"type"`  // 2 = Button
	Style    int    `json:"style"` // 1=primary, 2=secondary, 3=success, 4=danger, 5=link
	Label    string `json:"label"`
	CustomID string `json:"custom_id,omitempty"` // for non-link buttons
	Emoji    *struct {
		Name string `json:"name"`
	} `json:"emoji,omitempty"`
}

// DiscordActionRow groups buttons.
type DiscordActionRow struct {
	Type       int                    `json:"type"` // 1 = ACTION_ROW
	Components []DiscordMessageButton `json:"components"`
}

// discordEmbed is the subset of Discord's embed object the support queue
// uses: a titled block of name/value fields that reads as a header above
// the message content. Field values are capped at 1024 chars by Discord.
type discordEmbed struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	URL         string              `json:"url,omitempty"`
	Color       int                 `json:"color,omitempty"`
	Fields      []discordEmbedField `json:"fields,omitempty"`
	Footer      *discordEmbedFooter `json:"footer,omitempty"`
}

type discordEmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

type discordEmbedFooter struct {
	Text string `json:"text"`
}

// discordPostMessage posts a message in a channel or thread, optionally
// with components (buttons). Returns the new message's ID.
//
// channelOrThreadID is either a channel ID or thread ID — Discord
// treats threads as channels for the purpose of posting.
func discordPostMessage(ctx context.Context, channelOrThreadID, content string, components []DiscordActionRow) (string, error) {
	return discordPostEmbed(ctx, channelOrThreadID, content, nil, components)
}

// discordPostEmbed is discordPostMessage with an optional embed attached.
func discordPostEmbed(ctx context.Context, channelOrThreadID, content string, embed *discordEmbed, components []DiscordActionRow) (string, error) {
	body := map[string]interface{}{
		"content":          content,
		"allowed_mentions": map[string]interface{}{"parse": []string{}}, // suppress @ mentions
	}
	if embed != nil {
		body["embeds"] = []*discordEmbed{embed}
	}
	if len(components) > 0 {
		body["components"] = components
	}
	respBody, status, err := discordRequest(ctx, http.MethodPost,
		"/channels/"+channelOrThreadID+"/messages", body)
	if err != nil {
		return "", err
	}
	if status >= 400 {
		return "", fmt.Errorf("discord post message: status %d body %s", status, string(respBody))
	}
	var m struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &m); err != nil {
		return "", fmt.Errorf("parse message response: %w", err)
	}
	return m.ID, nil
}

// discordArchiveThread sets `archived: true` on a thread. No-op if
// thread doesn't exist (returns nil so callers don't crash on race).
func discordArchiveThread(ctx context.Context, threadID string) error {
	body := map[string]interface{}{
		"archived": true,
		"locked":   false, // locked threads can't be unarchived by activity
	}
	respBody, status, err := discordRequest(ctx, http.MethodPatch,
		"/channels/"+threadID, body)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		return nil
	}
	if status >= 400 {
		return fmt.Errorf("discord archive thread: status %d body %s", status, string(respBody))
	}
	return nil
}

// discordUnarchiveThread flips `archived` back to false so a user's
// follow-up lands in the thread the conversation already lives in rather
// than a fresh one. No-op when the thread is gone.
func discordUnarchiveThread(ctx context.Context, threadID string) error {
	body := map[string]interface{}{"archived": false, "locked": false}
	respBody, status, err := discordRequest(ctx, http.MethodPatch, "/channels/"+threadID, body)
	if err != nil {
		return err
	}
	if status == http.StatusNotFound {
		return nil
	}
	if status >= 400 {
		return fmt.Errorf("discord unarchive thread: status %d body %s", status, string(respBody))
	}
	return nil
}

// discordPinForumThread pins a forum post to the top of the channel.
// Discord models this as a channel flag (1 << 1) on the thread, not as a
// pinned message. Used once, for the digest's Queue thread.
func discordPinForumThread(ctx context.Context, threadID string) error {
	body := map[string]interface{}{"flags": 2}
	respBody, status, err := discordRequest(ctx, http.MethodPatch, "/channels/"+threadID, body)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("discord pin thread: status %d body %s", status, string(respBody))
	}
	return nil
}

// discordCompleteDeferred fills in the placeholder left by a deferred
// interaction response. Interaction tokens stay valid for 15 minutes,
// which is what lets a slow path (Linear) answer long after Discord's
// 3-second deadline.
//
// It PATCHes @original rather than POSTing a follow-up: a POST would add
// a second message and leave "the bot is thinking…" sitting there forever.
func discordCompleteDeferred(ctx context.Context, applicationID, interactionToken, content string) error {
	body := map[string]interface{}{
		"content":          content,
		"allowed_mentions": map[string]interface{}{"parse": []string{}},
	}
	path := fmt.Sprintf("/webhooks/%s/%s/messages/@original", applicationID, interactionToken)
	respBody, status, err := discordRequest(ctx, http.MethodPatch, path, body)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("discord complete deferred: status %d body %s", status, string(respBody))
	}
	return nil
}

// =============================================================================
// Slash command registration
// =============================================================================

// discordSlashCommand is the minimal payload for registering a guild
// command. Discord's API supports many more options (subcommands,
// autocomplete, etc.) — we only need the basics.
type discordSlashCommand struct {
	Name        string                      `json:"name"`
	Description string                      `json:"description"`
	Type        int                         `json:"type"` // 1 = CHAT_INPUT
	Options     []discordSlashCommandOption `json:"options,omitempty"`
}

type discordSlashCommandOption struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        int    `json:"type"` // 3 = STRING
	Required    bool   `json:"required,omitempty"`
}

// registerDiscordSlashCommands upserts our guild-scoped slash commands.
// Discord's bulk-overwrite endpoint replaces the entire command set in
// one call, which is what we want — runs idempotently on every startup.
//
// Guild-scoped commands appear instantly; global commands have a 1-hour
// propagation delay. We use guild-scoped because we have one server.
func registerDiscordSlashCommands(ctx context.Context) error {
	cfg, ok := loadDiscordConfig()
	if !ok {
		return errors.New("discord not configured")
	}

	commands := []discordSlashCommand{
		{
			Name:        "inbox",
			Description: "Browse pending support drafts, 10 at a time",
			Type:        1,
		},
		{
			Name:        "case",
			Description: "Show the full timeline for a ticket number",
			Type:        1,
			Options: []discordSlashCommandOption{
				{
					Name:        "number",
					Description: "osTicket ticket number (e.g. 239171)",
					Type:        3,
					Required:    true,
				},
			},
		},
		{
			Name:        "search",
			Description: "Full-text search across support cases and their messages",
			Type:        1,
			Options: []discordSlashCommandOption{
				{
					Name:        "text",
					Description: "What to look for (e.g. \"weather widget crash\")",
					Type:        3,
					Required:    true,
				},
			},
		},
		{
			Name:        "ticket",
			Description: "Show the latest draft for a ticket number",
			Type:        1,
			Options: []discordSlashCommandOption{
				{
					Name:        "number",
					Description: "osTicket ticket number (e.g. 239171)",
					Type:        3,
					Required:    true,
				},
			},
		},
		{
			Name:        "stats",
			Description: "Show AI support pipeline activity for a window (default 24h)",
			Type:        1,
			Options: []discordSlashCommandOption{
				{
					Name:        "hours",
					Description: "Lookback window in hours (default 24, max 168)",
					Type:        3,
					Required:    false,
				},
			},
		},
	}

	path := fmt.Sprintf("/applications/%s/guilds/%s/commands",
		cfg.ApplicationID, cfg.GuildID)
	respBody, status, err := discordRequest(ctx, http.MethodPut, path, commands)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("register slash commands: status %d body %s", status, string(respBody))
	}
	return nil
}

// RegisterDiscordSlashCommandsAtBoot is the public boot hook called
// from main.go. No-op when Discord isn't configured. Errors are logged
// but never fatal — the API stays up either way.
//
// Also bootstraps forum tags on the support channel so threads can be
// tagged with category + status from creation. Tag bootstrap is
// idempotent: existing tags are preserved, only missing ones are
// added in a single PATCH.
func RegisterDiscordSlashCommandsAtBoot(ctx context.Context) {
	cfg, ok := loadDiscordConfig()
	if !ok {
		log.Println("[Discord] not configured; skipping slash command registration")
		return
	}
	if err := registerDiscordSlashCommands(ctx); err != nil {
		log.Printf("[Discord] register slash commands: %v", err)
		// Continue to tag bootstrap even if commands failed.
	} else {
		log.Println("[Discord] slash commands registered (/inbox, /case, /search, /ticket, /stats)")
	}

	if err := ensureSupportForumTags(ctx, cfg.SupportChannelID); err != nil {
		log.Printf("[Discord] ensure forum tags: %v", err)
		return
	}
}

// ensureSupportForumTags makes sure every tag in supportForumTagSpecs
// exists on the support channel. Caches resolved IDs in tagIDByName.
//
// No-op when the parent channel isn't a forum (text channels don't
// support tags). When some tags exist already, only the missing ones
// are added — existing IDs are preserved so already-tagged threads
// don't lose their tags.
func ensureSupportForumTags(ctx context.Context, channelID string) error {
	parentType, err := discordGetChannelType(ctx, channelID)
	if err != nil {
		return fmt.Errorf("get channel type: %w", err)
	}
	if parentType != discordChannelTypeForum && parentType != discordChannelTypeMedia {
		log.Printf("[Discord] channel type=%d (not forum); skipping tag bootstrap", parentType)
		return nil
	}

	// Fetch the channel's current tag set.
	body, status, err := discordRequest(ctx, http.MethodGet, "/channels/"+channelID, nil)
	if err != nil {
		return fmt.Errorf("get channel: %w", err)
	}
	if status >= 400 {
		return fmt.Errorf("get channel: status %d body %s", status, string(body))
	}
	var ch struct {
		AvailableTags []discordForumTag `json:"available_tags"`
	}
	if err := json.Unmarshal(body, &ch); err != nil {
		return fmt.Errorf("parse channel: %w", err)
	}

	// Index existing tags by name (case-sensitive).
	existing := make(map[string]discordForumTag, len(ch.AvailableTags))
	for _, t := range ch.AvailableTags {
		existing[t.Name] = t
	}

	// Determine what we need to add. Preserve all existing tags.
	desired := append([]discordForumTag(nil), ch.AvailableTags...)
	added := 0
	for _, spec := range supportForumTagSpecs {
		if _, ok := existing[spec.name]; ok {
			continue
		}
		desired = append(desired, discordForumTag{
			Name:      spec.name,
			EmojiName: spec.emojiName,
			Moderated: false,
		})
		added++
	}

	// Patch only when we actually added something.
	if added > 0 {
		patchBody := map[string]interface{}{
			"available_tags": desired,
		}
		respBody, status, err := discordRequest(ctx, http.MethodPatch, "/channels/"+channelID, patchBody)
		if err != nil {
			return fmt.Errorf("patch tags: %w", err)
		}
		if status >= 400 {
			return fmt.Errorf("patch tags: status %d body %s", status, string(respBody))
		}
		var updated struct {
			AvailableTags []discordForumTag `json:"available_tags"`
		}
		if err := json.Unmarshal(respBody, &updated); err != nil {
			return fmt.Errorf("parse patched channel: %w", err)
		}
		for _, t := range updated.AvailableTags {
			tagIDByName.Store(t.Name, t.ID)
		}
		log.Printf("[Discord] forum tag bootstrap: created %d tags (total %d)", added, len(updated.AvailableTags))
	} else {
		// No additions needed — cache the existing IDs.
		for _, t := range ch.AvailableTags {
			tagIDByName.Store(t.Name, t.ID)
		}
		log.Printf("[Discord] forum tag bootstrap: %d tags already in place", len(ch.AvailableTags))
	}

	return nil
}

// discordForumTag mirrors Discord's tag object on a forum channel.
// `id` is empty when we're sending a new tag to be created (Discord
// assigns the ID on PATCH); populated when we read existing tags.
type discordForumTag struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name"`
	EmojiName string `json:"emoji_name,omitempty"`
	Moderated bool   `json:"moderated"`
}

// priorityEmojiPrefix returns the lead emoji to glue to the front of
// thread names so partners can scan priority at a glance. Empty for
// "normal" so most threads stay un-prefixed (signal vs noise).
func priorityEmojiPrefix(priority string) string {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "emergency":
		return "🔴 "
	case "high":
		return "🟠 "
	case "low":
		return "🟢 "
	default:
		return "" // normal — no emoji, keeps the name short
	}
}

// discordUpdateThreadName renames a thread by patching the name
// field. Used when transitioning between states (sent/closed/skipped)
// so the prefix flips visibly in the thread list.
func discordUpdateThreadName(ctx context.Context, threadID, newName string) error {
	newName = truncateRunes(newName, 100)
	body := map[string]interface{}{"name": newName}
	respBody, status, err := discordRequest(ctx, http.MethodPatch, "/channels/"+threadID, body)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("rename thread: status %d body %s", status, string(respBody))
	}
	return nil
}

// discordSetThreadTags replaces the applied_tags on a thread with the
// given IDs. Discord requires the FULL desired set on every PATCH —
// can't add/remove individually.
func discordSetThreadTags(ctx context.Context, threadID string, tagIDs []string) error {
	body := map[string]interface{}{"applied_tags": tagIDs}
	respBody, status, err := discordRequest(ctx, http.MethodPatch, "/channels/"+threadID, body)
	if err != nil {
		return err
	}
	if status >= 400 {
		return fmt.Errorf("set thread tags: status %d body %s", status, string(respBody))
	}
	return nil
}

// transitionThreadStatus applies a new status tag (and optionally a
// thread-name prefix update) on state change. Removes any previous
// status tags so we don't accumulate.
//
// applied_tags is the existing thread's tag set; we strip status tags,
// add the new one, and PATCH. When the thread isn't on a forum parent
// (and thus has no tags), this is a no-op.
//
// closing=true ALSO appends the closed tag so a sent+closed thread
// shows as both sent and closed in the thread list.
func transitionThreadStatus(
	ctx context.Context,
	thread *SupportTicketThread,
	newStatus string,
	closing bool,
) {
	newStatusTagID := supportForumTagID(newStatus)
	if newStatusTagID == "" {
		// Not on a forum, or tag bootstrap hasn't run, or unknown name.
		// Skip the tag part — status name change at the title level
		// (handled separately by the caller) is enough to communicate.
		return
	}

	// Fetch the thread's current applied tags so we preserve the
	// category tag (and any other moderator-applied tag) while only
	// flipping the status piece.
	respBody, status, err := discordRequest(ctx, http.MethodGet, "/channels/"+thread.DiscordThreadID, nil)
	if err != nil {
		log.Printf("[Discord] fetch thread for status transition %s: %v", thread.DiscordThreadID, err)
		return
	}
	if status >= 400 {
		log.Printf("[Discord] fetch thread for status transition %s: status %d body %s",
			thread.DiscordThreadID, status, string(respBody))
		return
	}
	var t struct {
		AppliedTags []string `json:"applied_tags"`
	}
	if err := json.Unmarshal(respBody, &t); err != nil {
		log.Printf("[Discord] parse thread for status transition %s: %v", thread.DiscordThreadID, err)
		return
	}

	// Build the new tag set: keep non-status tags, add new status tag,
	// optionally append closed.
	closedTagID := supportForumTagID("closed")
	keep := make([]string, 0, len(t.AppliedTags)+2)
	for _, id := range t.AppliedTags {
		if isStatusTagID(id) || id == closedTagID {
			continue
		}
		keep = append(keep, id)
	}
	keep = append(keep, newStatusTagID)
	if closing && closedTagID != "" && newStatusTagID != closedTagID {
		keep = append(keep, closedTagID)
	}

	if err := discordSetThreadTags(ctx, thread.DiscordThreadID, keep); err != nil {
		log.Printf("[Discord] update thread tags for %s: %v", thread.DiscordThreadID, err)
	}
}

// isStatusTagID returns true if the given ID corresponds to one of
// our mutually-exclusive status tags. Used to strip the previous
// status before applying the new one.
func isStatusTagID(id string) bool {
	for name := range statusTagNames {
		if supportForumTagID(name) == id {
			return true
		}
	}
	return false
}

// =============================================================================
// Inbound signature verification
// =============================================================================

// verifyDiscordSignature checks that a request from Discord is genuine.
// Discord signs every interaction with Ed25519: the signing payload is
// timestamp + body, signed with the application's signing key.
//
// Returns nil if the signature is valid; an error otherwise. Callers
// should respond 401 to the HTTP request when this returns non-nil.
//
// The verification IS time-sensitive in that Discord includes a
// timestamp, but we don't reject old requests by clock — Discord
// retries with the same timestamp. The crypto verification is
// sufficient.
func verifyDiscordSignature(publicKeyHex, signatureHex, timestamp string, body []byte) error {
	pubKey, err := hex.DecodeString(publicKeyHex)
	if err != nil {
		return fmt.Errorf("decode public key: %w", err)
	}
	if len(pubKey) != ed25519.PublicKeySize {
		return fmt.Errorf("public key wrong size: got %d want %d", len(pubKey), ed25519.PublicKeySize)
	}

	signature, err := hex.DecodeString(signatureHex)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	if len(signature) != ed25519.SignatureSize {
		return fmt.Errorf("signature wrong size: got %d want %d", len(signature), ed25519.SignatureSize)
	}

	// The signed payload is timestamp + body, no separator.
	signed := make([]byte, 0, len(timestamp)+len(body))
	signed = append(signed, []byte(timestamp)...)
	signed = append(signed, body...)

	if !ed25519.Verify(pubKey, signed, signature) {
		return errors.New("signature verification failed")
	}
	return nil
}

// =============================================================================
// Thread persistence
// =============================================================================

// SupportTicketThread mirrors the support_ticket_threads table.
type SupportTicketThread struct {
	TicketNumber    string
	DiscordThreadID string
	ChannelID       string
	Archived        bool
	CreatedAt       time.Time
}

// upsertSupportTicketThread inserts or updates the ticket→thread
// mapping. Idempotent on ticket_number (unique key).
func upsertSupportTicketThread(ctx context.Context, t *SupportTicketThread) error {
	const q = `
		INSERT INTO support_ticket_threads
			(ticket_number, discord_thread_id, channel_id, archived)
		VALUES ($1, $2, $3, FALSE)
		ON CONFLICT (ticket_number) DO UPDATE
			SET discord_thread_id = EXCLUDED.discord_thread_id,
				channel_id = EXCLUDED.channel_id,
				archived = FALSE
	`
	_, err := platform.DBPool.Exec(ctx, q, t.TicketNumber, t.DiscordThreadID, t.ChannelID)
	if err != nil {
		return fmt.Errorf("upsert ticket thread: %w", err)
	}
	_, _ = platform.DBPool.Exec(ctx,
		`UPDATE support_cases SET discord_thread_id = $2 WHERE ticket_number = $1`,
		t.TicketNumber, t.DiscordThreadID)
	return nil
}

// loadSupportTicketThread looks up the Discord thread ID for a ticket.
// Returns (nil, nil) when no mapping exists.
func loadSupportTicketThread(ctx context.Context, ticketNumber string) (*SupportTicketThread, error) {
	const q = `
		SELECT ticket_number, discord_thread_id, channel_id, archived, created_at
		FROM support_ticket_threads
		WHERE ticket_number = $1
	`
	var t SupportTicketThread
	err := platform.DBPool.QueryRow(ctx, q, ticketNumber).Scan(
		&t.TicketNumber, &t.DiscordThreadID, &t.ChannelID, &t.Archived, &t.CreatedAt,
	)
	if err != nil {
		// Return nil, nil for "not found" so callers can branch easily.
		// Specifically: pgx returns ErrNoRows on no rows, which we
		// translate here.
		if strings.Contains(err.Error(), "no rows") {
			return nil, nil
		}
		return nil, fmt.Errorf("load ticket thread: %w", err)
	}
	return &t, nil
}

// markSupportTicketThreadArchived flips the archived flag for a ticket's
// thread. Used after auto-close so we don't try to repost in archived
// threads on subsequent user replies (we'll create a new thread instead).
func markSupportTicketThreadArchived(ctx context.Context, ticketNumber string) error {
	const q = `UPDATE support_ticket_threads SET archived = TRUE WHERE ticket_number = $1`
	_, err := platform.DBPool.Exec(ctx, q, ticketNumber)
	return err
}

// markSupportTicketThreadUnarchived clears the archived flag so the next
// draft threads into the existing conversation instead of opening a new one.
func markSupportTicketThreadUnarchived(ctx context.Context, ticketNumber string) error {
	const q = `UPDATE support_ticket_threads SET archived = FALSE WHERE ticket_number = $1`
	_, err := platform.DBPool.Exec(ctx, q, ticketNumber)
	return err
}

// notifyDiscordForUserReply puts a user's follow-up into the thread that
// already holds their conversation, before triage has drafted anything.
//
// Previously a reply only surfaced once the AI had finished drafting, and
// on an archived thread it surfaced in a brand-new one — so a conversation
// scattered across threads and the partner saw the answer before the
// question. Here the thread wakes, the reply lands, the title says [REPLY]
// and the tag goes back to pending; the draft follows a few seconds later.
//
// Fail-open throughout: nothing in here may stop the draft being created.
func notifyDiscordForUserReply(ctx context.Context, ticketNumber, subject, priority, messageHTML string) {
	if !shouldNotifyDiscord() {
		return
	}
	t, err := loadSupportTicketThread(ctx, ticketNumber)
	if err != nil || t == nil {
		// No thread yet — the draft's own path will create one carrying
		// this same message.
		return
	}

	if t.Archived {
		if err := discordUnarchiveThread(ctx, t.DiscordThreadID); err != nil {
			log.Printf("[Discord] unarchive thread for ticket %s: %v", ticketNumber, err)
			return
		}
		if err := markSupportTicketThreadUnarchived(ctx, ticketNumber); err != nil {
			log.Printf("[Discord] clear archived flag for ticket %s: %v", ticketNumber, err)
		}
	}

	body := strings.TrimSpace(htmlToPlain(messageHTML))
	if body == "" {
		body = "(empty message)"
	}
	content := "📨 **The user replied**\n" + blockquoteText(body, len(body))
	for _, chunk := range splitForDiscord(content, discordMessageLimit) {
		if _, err := discordPostMessage(ctx, t.DiscordThreadID, chunk, nil); err != nil {
			log.Printf("[Discord] post user reply for ticket %s: %v", ticketNumber, err)
			return
		}
	}

	transitionThreadStatus(ctx, t, "pending", false)

	name := fmt.Sprintf("[REPLY] %s[#%s] %s",
		priorityEmojiPrefix(priority), ticketNumber, truncateForThreadName(subject, ticketNumber, priority))
	if err := discordUpdateThreadName(ctx, t.DiscordThreadID, name); err != nil {
		log.Printf("[Discord] rename thread (reply) for ticket %s: %v", ticketNumber, err)
	}
}

// truncateForThreadName trims a subject to whatever is left of Discord's
// 100-char thread-name budget after the "[REPLY] " prefix, the priority
// emoji and the ticket number.
func truncateForThreadName(subject, ticketNumber, priority string) string {
	if subject == "" {
		subject = "support ticket"
	}
	budget := 100 - len("[REPLY] ") - len(priorityEmojiPrefix(priority)) - len(ticketNumber) - 4
	if budget < 10 {
		return ""
	}
	return truncateRunes(subject, budget)
}

// =============================================================================
// Notification entry point — called from notifyPartnerAfterDraft
// =============================================================================

// notifyDiscordForDraft posts a new ticket draft to Discord. Creates a
// thread WITH the draft inline as starter message if no thread exists
// for this ticket; posts a follow-up message in the existing thread on
// subsequent drafts (e.g., user replies). Either way, the message
// includes the user's body, the AI summary + drafted reply, and three
// action buttons.
//
// Forum channels REQUIRE the starter message inline at thread creation
// (Discord rejects no-message thread creates with code 50035). For
// existing threads, we use the regular post-message path. discordCreateThread
// branches by parent channel type internally and handles both forum
// and text parents transparently.
//
// Fail-open: any error here is logged and swallowed. The email path
// (if enabled) covers us.
func notifyDiscordForDraft(ctx context.Context, draft *SupportDraft) {
	if !shouldNotifyDiscord() {
		return
	}
	cfg, _ := loadDiscordConfig() // ok already verified by shouldNotifyDiscord

	// A reply-loop draft answers a message notifyDiscordForUserReply has
	// already quoted into this thread. Quoting it twice is noise, so the
	// draft leads with the reply itself — unless there was no thread to
	// post into, in which case this draft's own starter carries it.
	existing, _ := loadSupportTicketThread(ctx, draft.TicketNumber)
	includeUserMessage := !(draft.OSTicketThreadEntryID > 0 && existing != nil && !existing.Archived)

	embed := buildDraftHeaderEmbed(ctx, draft)
	starter, rest := buildDraftMessages(draft, includeUserMessage)
	components := buildDraftActionButtons(draft.ID)

	// Buttons ride on the LAST message so the partner never has to scroll
	// back up past a long draft to act on what they just read. When the
	// draft fits in the starter, that is the starter.
	starterComponents := components
	if len(rest) > 0 {
		starterComponents = nil
	}

	threadID, isNew, err := getOrCreateThreadForTicket(ctx, cfg, draft, starter, embed, starterComponents)
	if err != nil {
		log.Printf("[Discord] getOrCreateThread for ticket %s: %v", draft.TicketNumber, err)
		return
	}

	// If we just created the thread, the starter message went out with it;
	// posting it again would duplicate. Only re-post when threading into
	// an existing thread.
	if !isNew {
		if _, err := discordPostEmbed(ctx, threadID, starter, embed, starterComponents); err != nil {
			log.Printf("[Discord] post draft starter for ticket %s: %v", draft.TicketNumber, err)
			return
		}
	}

	for i, chunk := range rest {
		var comps []DiscordActionRow
		if i == len(rest)-1 {
			comps = components
		}
		if _, err := discordPostMessage(ctx, threadID, chunk, comps); err != nil {
			log.Printf("[Discord] post draft part %d/%d for ticket %s: %v",
				i+1, len(rest), draft.TicketNumber, err)
			return
		}
	}

	scheduleAutoSend(draft)
}

// getOrCreateThreadForTicket looks up an existing thread or creates a
// new one. Threads that have been archived (via the close path) are
// treated as not-existing and a new thread is created.
//
// Returns (threadID, isNewlyCreated, error). When isNewlyCreated=true
// the caller MUST NOT separately post the starter content — it was
// already posted as part of thread creation. When isNewlyCreated=false
// the caller should post-message into the existing thread.
//
// starterContent + starterComponents are required for forum-channel
// parents (Discord 50035 if missing). They're also used for text
// channels' first message, so the caller doesn't need to know the
// channel type.
func getOrCreateThreadForTicket(
	ctx context.Context,
	cfg DiscordConfig,
	draft *SupportDraft,
	starterContent string,
	starterEmbed *discordEmbed,
	starterComponents []DiscordActionRow,
) (string, bool, error) {
	existing, err := loadSupportTicketThread(ctx, draft.TicketNumber)
	if err != nil {
		return "", false, fmt.Errorf("load existing thread: %w", err)
	}
	if existing != nil && !existing.Archived {
		return existing.DiscordThreadID, false, nil
	}

	// Create a new thread.
	subject := draft.OriginalSubject
	if subject == "" {
		subject = "support ticket"
	}
	// Truncate so the formatted name fits Discord's 100-char limit.
	if len(subject) > 70 {
		subject = subject[:70] + "..."
	}
	// Format: "<priority-emoji> [#NNNNNN] <subject>"
	// Priority emoji is empty for "normal" so most threads stay clean.
	name := fmt.Sprintf("%s[#%s] %s",
		priorityEmojiPrefix(draft.AIPriority),
		draft.TicketNumber,
		subject)

	// Initial tags: category (if known) + pending status.
	// Empty IDs are silently skipped by discordCreateThread.
	initialTags := []string{}
	if id := supportForumTagID(strings.ToLower(draft.AICategory)); id != "" {
		initialTags = append(initialTags, id)
	}
	if id := supportForumTagID("pending"); id != "" {
		initialTags = append(initialTags, id)
	}

	thread, err := discordCreateThread(ctx, cfg.SupportChannelID, name, starterContent, starterEmbed, starterComponents, initialTags)
	if err != nil {
		return "", false, fmt.Errorf("create thread: %w", err)
	}

	// Persist the mapping.
	if err := upsertSupportTicketThread(ctx, &SupportTicketThread{
		TicketNumber:    draft.TicketNumber,
		DiscordThreadID: thread.ID,
		ChannelID:       cfg.SupportChannelID,
	}); err != nil {
		// Non-fatal — thread is created in Discord, we just couldn't
		// persist the mapping. Next user reply will create yet another
		// thread, which is bad UX but not a hard failure. Log and
		// continue so the partner still gets the message in the new
		// thread.
		log.Printf("[Discord] persist thread mapping for ticket %s: %v", draft.TicketNumber, err)
	}

	return thread.ID, true, nil
}

// discordMessageLimit is Discord's hard per-message content cap.
const discordMessageLimit = 2000

// userMessageHeadLimit is how much of the user's own message rides on the
// starter message. The rest continues in follow-up messages — a support
// reply is only as good as the complaint behind it, so nothing is dropped.
const userMessageHeadLimit = 1500

// splitForDiscord breaks s into chunks of at most max bytes, preferring to
// cut at a blank line, then at a line break, then at a space. A word is
// only ever split when the word itself is longer than a whole chunk, and
// then only on a rune boundary.
//
// Byte length is the budget rather than rune count: Discord counts
// characters, and bytes >= characters for UTF-8, so this is conservative
// in the safe direction.
func splitForDiscord(s string, max int) []string {
	if max <= 0 {
		return nil
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	var out []string
	for len(s) > max {
		cut := breakPoint(s, max)
		out = append(out, strings.TrimRight(s[:cut], " \t\n"))
		s = strings.TrimLeft(s[cut:], " \t\n")
	}
	if s != "" {
		out = append(out, s)
	}
	return out
}

// breakPoint returns the index to cut s at so the first piece is <= max
// bytes and lands on the nicest boundary available in the last third of
// the budget.
func breakPoint(s string, max int) int {
	window := s[:max]
	floor := max / 3 // don't accept a boundary so early it wastes the message
	for _, sep := range []string{"\n\n", "\n", " "} {
		if i := strings.LastIndex(window, sep); i > floor {
			return i + len(sep)
		}
	}
	// One unbroken run longer than a whole message (a URL, a stack trace,
	// a log line). Back up to a rune boundary so the cut is still valid
	// UTF-8; the caller's chunk stays under max either way.
	cut := max
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return cut
}

// buildDraftMessages renders one draft as the starter message plus however
// many follow-up messages the full text needs. Nothing is truncated: the
// partner reads the complete draft in the thread and decides from it,
// which was the whole failure of the old single 2000-char message.
//
// Returns (starter, rest). The caller puts the action buttons on the last
// message of the pair. includeUserMessage is false when the thread already
// shows the message this draft answers.
func buildDraftMessages(draft *SupportDraft, includeUserMessage bool) (string, []string) {
	var head, tail string
	if includeUserMessage {
		head, tail = splitAtLimit(htmlToPlain(draft.UserMessageHTML), userMessageHeadLimit)
	}

	var msgs []string
	if head != "" {
		// Split after quoting, not before: the "> " on every line is part
		// of what has to fit, and a many-line message can gain hundreds of
		// bytes from it.
		section := "**What the user wrote**\n" + blockquoteText(head, len(head))
		if tail != "" {
			section += "\n_…continues below_"
		}
		msgs = append(msgs, splitForDiscord(section, discordMessageLimit)...)
	}
	if tail != "" {
		msgs = append(msgs, splitForDiscord(blockquoteText(tail, len(tail)), discordMessageLimit)...)
	}

	draftText := strings.TrimSpace(htmlToPlain(draft.DraftBodyHTML))
	if draftText == "" {
		draftText = "_(the AI produced no reply body)_"
	}
	draftChunks := splitForDiscord("**Drafted reply**\n"+draftText, discordMessageLimit)

	// A short ticket is one message: fold the draft in rather than posting
	// a two-line message of its own under a three-line one.
	if len(msgs) == 1 && len(draftChunks) == 1 &&
		len(msgs[0])+len(draftChunks[0])+2 <= discordMessageLimit {
		return msgs[0] + "\n\n" + draftChunks[0], nil
	}

	msgs = append(msgs, draftChunks...)
	return msgs[0], msgs[1:]
}

// splitAtLimit cuts s into a head of at most limit bytes (on a whitespace
// and rune boundary) and the remainder.
func splitAtLimit(s string, limit int) (string, string) {
	s = strings.TrimSpace(s)
	if len(s) <= limit {
		return s, ""
	}
	cut := breakPoint(s, limit)
	return strings.TrimRight(s[:cut], " \t\n"), strings.TrimLeft(s[cut:], " \t\n")
}

// buildDraftHeaderEmbed is the at-a-glance block above the draft: what the
// ticket is, how sure the AI is, and whether the user is even on a version
// that could still have the bug. The internal note (REL-244) shows here
// and only here — it is the AI talking to us, never to the user.
func buildDraftHeaderEmbed(ctx context.Context, draft *SupportDraft) *discordEmbed {
	subject := draft.OriginalSubject
	if subject == "" {
		subject = "(no subject)"
	}
	subject = truncateRunes(subject, 200) // embed titles cap at 256 characters

	e := &discordEmbed{
		Title: fmt.Sprintf("Ticket #%s — %s", draft.TicketNumber, subject),
		Color: 0x5865F2, // Discord blurple
		Fields: []discordEmbedField{
			{Name: "Category", Value: codeOrDash(draft.AICategory), Inline: true},
			{Name: "Priority", Value: codeOrDash(draft.AIPriority), Inline: true},
			{Name: "Confidence", Value: codeOrDash(draft.AIConfidence), Inline: true},
			{Name: "App version", Value: appVersionField(ctx, draft.TicketNumber), Inline: true},
		},
		Footer: &discordEmbedFooter{Text: fmt.Sprintf("draft #%d", draft.ID)},
	}
	if draft.AISummary != "" {
		e.Description = truncateRunes(draft.AISummary, 400)
	}
	if note := strings.TrimSpace(draft.InternalNote); note != "" {
		e.Fields = append(e.Fields, discordEmbedField{
			Name: "Note (internal — not sent)", Value: truncateRunes(note, 1000),
		})
	}
	if ask := strings.TrimSpace(draft.AskUserFor); ask != "" {
		e.Fields = append(e.Fields, discordEmbedField{
			Name: "Needs from the user", Value: truncateRunes(ask, 1000),
		})
	}
	if src := strings.TrimSpace(draft.GroundedIn); src != "" {
		e.Fields = append(e.Fields, discordEmbedField{
			Name: "Grounded in", Value: truncateRunes(src, 1000),
		})
	}
	return e
}

func codeOrDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return "`" + s + "`"
}

// truncateRunes caps a string at n runes (never mid-character), for the
// embed fields Discord limits by character count.
func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	count := 0
	for i := range s {
		if count == n {
			return s[:i] + "…"
		}
		count++
	}
	return s
}

// appVersionField renders the reporter's app version against the version
// we ship today, so "this was fixed two releases ago" is visible before
// anyone reads the draft.
func appVersionField(ctx context.Context, ticketNumber string) string {
	reported := caseAppVersion(ctx, ticketNumber)
	current := currentDesktopVersion()
	switch {
	case reported == "" && current == "":
		return "—"
	case reported == "":
		return fmt.Sprintf("unknown (current %s)", current)
	case current == "" || reported == current:
		return fmt.Sprintf("`%s` (current)", reported)
	default:
		return fmt.Sprintf("`%s` → current `%s`", reported, current)
	}
}

// currentDesktopVersionRe pulls the version line the knowledge base is
// generated with, so there is exactly one source of truth for "current"
// and it is the same one the AI is told about.
var currentDesktopVersionRe = regexp.MustCompile(`(?m)^Current desktop version: \*\*([^*]+)\*\*`)

func currentDesktopVersion() string {
	m := currentDesktopVersionRe.FindStringSubmatch(supportKnowledgeBase())
	if len(m) < 2 {
		return ""
	}
	return strings.TrimSpace(m[1])
}

// caseAppVersion reads the app version the desktop reported at ticket time.
// Empty for web-form tickets and anything that arrived by email.
func caseAppVersion(ctx context.Context, ticketNumber string) string {
	if platform.DBPool == nil {
		return ""
	}
	var v *string
	err := platform.DBPool.QueryRow(ctx,
		`SELECT app_version FROM support_cases WHERE ticket_number = $1`, ticketNumber).Scan(&v)
	if err != nil || v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}

// buildDraftActionButtons returns the action-row components for a
// pending draft. Five buttons is Discord's per-row maximum and exactly
// what the queue needs: three ways to answer, one to defer, one to turn
// the ticket into engineering work.
func buildDraftActionButtons(draftID int64) []DiscordActionRow {
	button := func(style int, label, emoji, action string) DiscordMessageButton {
		b := DiscordMessageButton{
			Type:     2,
			Style:    style,
			Label:    label,
			CustomID: fmt.Sprintf("%s:%d", action, draftID),
		}
		b.Emoji = &struct {
			Name string `json:"name"`
		}{Name: emoji}
		return b
	}
	return []DiscordActionRow{
		{
			Type: 1,
			Components: []DiscordMessageButton{
				button(3, "Send", "✅", "support_send"),
				button(1, "Edit", "✏️", "support_edit"),
				button(1, "Ask", "❓", "support_ask"),
				button(2, "Skip", "⏭️", "support_skip"),
				button(4, "File as bug", "🐛", "support_bug"),
			},
		},
	}
}

// =============================================================================
// Plain-text helpers (Discord's text/markdown is much simpler than HTML)
// =============================================================================

// htmlToPlain strips HTML tags and decodes a few common entities so the
// content reads cleanly in Discord's markdown. Not a full HTML parser —
// the AI drafts and user messages are simple enough that a regex-style
// strip is sufficient.
func htmlToPlain(s string) string {
	out := s

	// Replace common block-ish tags with newlines so paragraphs stay
	// readable in Discord.
	replacements := []struct{ from, to string }{
		{"<br/>", "\n"},
		{"<br />", "\n"},
		{"<br>", "\n"},
		{"</p>", "\n\n"},
		{"</div>", "\n"},
		{"</li>", "\n"},
		{"<li>", "• "},
	}
	for _, r := range replacements {
		out = strings.ReplaceAll(out, r.from, r.to)
		out = strings.ReplaceAll(out, strings.ToUpper(r.from), r.to)
	}

	// Strip remaining tags.
	out = stripHTMLTags(out)

	// Decode a few common entities.
	entities := map[string]string{
		"&nbsp;": " ",
		"&amp;":  "&",
		"&lt;":   "<",
		"&gt;":   ">",
		"&quot;": "\"",
		"&#39;":  "'",
	}
	for from, to := range entities {
		out = strings.ReplaceAll(out, from, to)
	}

	// Collapse 3+ newlines.
	for strings.Contains(out, "\n\n\n") {
		out = strings.ReplaceAll(out, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(out)
}

// stripHTMLTags removes everything between < and >. Naive but
// sufficient for our trusted-input content.
func stripHTMLTags(s string) string {
	var out strings.Builder
	out.Grow(len(s))
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			out.WriteRune(r)
		}
	}
	return out.String()
}

// blockquoteText prefixes each line with `> ` so Discord renders it as
// a quote block. Truncates to maxBytes (rough char count).
func blockquoteText(s string, maxBytes int) string {
	if len(s) > maxBytes {
		s = s[:maxBytes] + "..."
	}
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = "> " + line
	}
	return strings.Join(lines, "\n")
}
