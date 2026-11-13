package support

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// SCROLLR-459 / SB-7: the business-lead auto-reply goes to an address the
// submitter typed and nobody has verified, so it carries none of their text.
func TestBusinessLeadAutoReplyIsFixedText(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &got)
		w.WriteHeader(200)
	}))
	defer srv.Close()
	prev := resendEndpoint
	resendEndpoint = srv.URL
	defer func() { resendEndpoint = prev }()
	t.Setenv("RESEND_API_KEY", "test-key")

	if err := sendBusinessLeadAutoReply(context.Background(), "victim@example.com"); err != nil {
		t.Fatal(err)
	}
	if to, _ := got["to"].([]any); len(to) != 1 || to[0] != "victim@example.com" {
		t.Fatalf("to = %v", got["to"])
	}
	// Nothing in the signature can carry submitted text any more; pin the
	// shape so a future parameter has to be argued for.
	subject, _ := got["subject"].(string)
	body, _ := got["html"].(string)
	if subject != "Thanks — we got your note" || strings.Contains(body, "%s") || strings.Contains(body, "%!") {
		t.Fatalf("subject %q / body not fixed text", subject)
	}
}
