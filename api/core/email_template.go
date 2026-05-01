package core

import (
	"fmt"
	"strings"
)

// decorateUserReplyHTML wraps the AI-drafted reply body with a small
// branded footer. Output goes into osTicket's reply email which has
// its own outer template wrapping (department signature, etc.) — so
// we keep our addition lightweight and visually distinct from the
// reply text without trying to own the entire email chrome.
//
// Two footer variants:
//
//	shouldClose == false (the common case)
//	  ↳ "Need more help?" + "If we got it sorted, reply with 'thanks'"
//
//	shouldClose == true (AI is closing the ticket on this reply)
//	  ↳ "We're closing this ticket" + "Reply any time to reopen"
//
// The body is appended verbatim — the AI's draft already includes the
// "Best Regards, Scrollr Support" sign-off (per the prompt) so we
// don't double up.
func decorateUserReplyHTML(body string, shouldClose bool) string {
	body = strings.TrimSpace(body)

	footer := userReplyFooterContinue
	if shouldClose {
		footer = userReplyFooterClose
	}

	// The visual wrapper is intentionally minimal — single divider +
	// muted text block. Inline styles only because most email clients
	// strip <style> blocks. Width-bounded so it doesn't blow out of
	// narrow gmail/outlook columns.
	return fmt.Sprintf(`%s

<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-top:1px solid #e5e7eb;">
  <tr>
    <td style="padding:16px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.55;color:#6b7280;">
      %s
    </td>
  </tr>
</table>`, body, footer)
}

const userReplyFooterContinue = `<strong style="color:#111827;">Need more help?</strong> Just reply to this email and we'll keep working on it.<br>
<strong style="color:#10b981;">All sorted?</strong> Reply with <em>"thanks"</em> or <em>"resolved"</em> and we'll close the ticket automatically.`

const userReplyFooterClose = `<strong style="color:#10b981;">✓ We're closing this ticket.</strong> Glad we got it sorted!<br>
If anything else comes up, just reply to this email and we'll reopen the conversation.`
