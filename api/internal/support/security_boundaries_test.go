package support

import (
	"context"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/testsupport"
	"github.com/gofiber/fiber/v2"
)

func TestApprovalVerifierRejectsEmptyKeyAndMissingExpiry(t *testing.T) {
	t.Setenv("SUPPORT_APPROVAL_HMAC_SECRET", "")
	t.Setenv("LOGTO_M2M_APP_SECRET", "")
	body, _ := json.Marshal(SupportApprovalToken{DraftID: 1, Action: "send", Exp: time.Now().Add(time.Hour).Unix()})
	encoded := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, nil)
	mac.Write([]byte(encoded))
	if _, err := verifyApprovalToken(encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))); err == nil {
		t.Fatal("empty-key forgery accepted")
	}
	t.Setenv("SUPPORT_APPROVAL_HMAC_SECRET", "test-key")
	token, err := signApprovalToken(SupportApprovalToken{DraftID: 1, Action: "send"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifyApprovalToken(token); err == nil {
		t.Fatal("nonexpiring token accepted")
	}
}

func TestApprovalGETCannotSendAndPOSTIsSingleUse(t *testing.T) {
	if !testsupport.DBAvailable(t) {
		return
	}
	resetCases(t)
	t.Setenv("SUPPORT_APPROVAL_HMAC_SECRET", "fixture")
	var calls atomic.Int32
	original := sendApprovedReply
	sendApprovedReply = func(context.Context, *SupportDraft, string) error { calls.Add(1); return nil }
	defer func() { sendApprovedReply = original }()
	draft := seedPendingDraft(t, "security-approval", "fixture")
	token, err := signApprovalToken(SupportApprovalToken{DraftID: draft.ID, Action: "send", Exp: time.Now().Add(time.Hour).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Get("/support/send", HandleSupportSend)
	app.Post("/support/send", HandleSupportSend)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go app.Listener(listener)
	defer app.Shutdown()
	base := "http://" + listener.Addr().String()
	client := &http.Client{Timeout: 3 * time.Second}

	resp, err := client.Get(base + "/support/send?token=" + token)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), `method="post"`) || calls.Load() != 0 || draftStatus(t, draft.ID) != "pending" {
		t.Fatalf("GET did not preserve draft: status=%d calls=%d draft=%q body=%s", resp.StatusCode, calls.Load(), draftStatus(t, draft.ID), body)
	}
	for i, want := range []int{200, 409} {
		req := httptest.NewRequest("POST", base+"/support/send", strings.NewReader(url.Values{"token": {token}}.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.RequestURI = ""
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("POST %d returned %d, want %d", i, resp.StatusCode, want)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("sent %d times", calls.Load())
	}
}

func TestDiscordStaffGate(t *testing.T) {
	t.Setenv("DISCORD_GUILD_ID", "our-guild")
	t.Setenv("DISCORD_APPLICATION_ID", "our-app")
	ix := discordInteraction{GuildID: "our-guild", ApplicationID: "our-app", Member: &discordMember{User: &discordUser{ID: "staff"}, Permissions: "8"}}
	if !discordStaffAuthorized(&ix) {
		t.Fatal("administrator denied")
	}
	for _, p := range []string{"", "0", "1024", "invalid"} {
		ix.Member.Permissions = p
		if discordStaffAuthorized(&ix) {
			t.Fatal("ordinary member permitted")
		}
	}
	ix.Member.Permissions = "32"
	if !discordStaffAuthorized(&ix) {
		t.Fatal("server manager denied")
	}
	ix.GuildID = "foreign"
	if discordStaffAuthorized(&ix) {
		t.Fatal("foreign guild permitted")
	}
	ix.GuildID = "our-guild"
	ix.ApplicationID = "foreign"
	if discordStaffAuthorized(&ix) {
		t.Fatal("foreign app permitted")
	}
	ix.ApplicationID = "our-app"
	ix.Member = nil
	if discordStaffAuthorized(&ix) {
		t.Fatal("direct message permitted")
	}
}

func TestSignedDiscordInteractionStillRequiresStaffPermission(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("DISCORD_PUBLIC_KEY", hex.EncodeToString(pub))
	t.Setenv("DISCORD_GUILD_ID", "our-guild")
	t.Setenv("DISCORD_APPLICATION_ID", "our-app")
	app := fiber.New()
	app.Post("/discord", HandleDiscordInteractions)
	for _, kind := range []int{discordInteractionMessageComponent, discordInteractionModalSubmit, discordInteractionApplicationCommand} {
		body, _ := json.Marshal(discordInteraction{Type: kind, GuildID: "our-guild", ApplicationID: "our-app", Member: &discordMember{User: &discordUser{ID: "ordinary-member"}, Permissions: "0"}})
		stamp := strconv.FormatInt(time.Now().Unix(), 10)
		req := httptest.NewRequest("POST", "/discord", strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Signature-Timestamp", stamp)
		req.Header.Set("X-Signature-Ed25519", hex.EncodeToString(ed25519.Sign(private, append([]byte(stamp), body...))))
		resp, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		result, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 || !strings.Contains(string(result), "require an administrator") {
			t.Fatalf("signed nonstaff interaction %d escaped authorization: %d %s", kind, resp.StatusCode, result)
		}
	}
}

func TestDraftPromptExcludesOtherCustomers(t *testing.T) {
	in := TriageInput{Body: "my current ticket", Similar: []SimilarCase{{UserWrote: "FOREIGN_PRIVATE_MESSAGE", WeSent: "FOREIGN_PRIVATE_REPLY", Subject: "FOREIGN_SUBJECT"}}}
	prompt := buildDraftPrompt(in, &classification{})
	if strings.Contains(prompt, "FOREIGN_") {
		t.Fatal("another customer's content entered a reply prompt")
	}
	if !strings.Contains(prompt, "my current ticket") {
		t.Fatal("current ticket missing")
	}
}
