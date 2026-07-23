# V1 Checklist — High-Confidence Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete 9 high-confidence, isolated checklist items across security, CI, legal docs, and pricing page — all changes that cannot break existing functionality.

**Architecture:** Pure edits to existing files. No new features, no new dependencies, no behavioral changes to existing flows. Security fixes tighten existing configurations. Legal/pricing changes are text-only. Webhook idempotency is additive (guard before existing logic).

**Tech Stack:** Tauri capability JSON, Go (Fiber), GitHub Actions YAML, TypeScript/React (pricing page), TypeScript (legal documents)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `desktop/src-tauri/capabilities/default.json` | Modify | Replace wildcard HTTP scope with explicit domains |
| `desktop/src-tauri/capabilities/ticker.json` | Modify | Replace wildcard HTTP scope with explicit domains |
| `api/core/extension_auth.go` | Modify | Replace `Access-Control-Allow-Origin: *` with env-configurable origins |
| `api/core/handlers_webhook.go` | Modify | Make Sequin webhook secret mandatory |
| `api/core/database.go` | Modify | Add `stripe_webhook_events` table |
| `api/core/stripe_webhook.go` | Modify | Add idempotency check before processing events |
| `.github/workflows/desktop-release.yml` | Modify | Add npm audit + cargo audit steps |
| `myscrollr.com/src/components/legal/documents.ts` | Modify | Remove quarterly billing, update pricing, update extension refs |
| `myscrollr.com/src/routes/uplink.tsx` | Modify | Add Coming Soon badges, remove feed retention row, remove referral program |

---

## Task 1: Tighten Tauri HTTP Scope

**Files:**
- Modify: `desktop/src-tauri/capabilities/default.json:41-49`
- Modify: `desktop/src-tauri/capabilities/ticker.json:24-32`

The main window needs: core API, Logto auth, GitHub API (widget), Open-Meteo (weather), Nominatim (geocoding). The ticker window only needs: core API, Logto auth.

- [ ] **Step 1: Update default.json HTTP scope**

Replace lines 43-48 in the `http:default` allow block:

```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "https://api.myscrollr.relentnet.dev/*" },
    { "url": "https://auth.myscrollr.relentnet.dev/*" },
    { "url": "https://api.github.com/*" },
    { "url": "https://geocoding-api.open-meteo.com/*" },
    { "url": "https://api.open-meteo.com/*" },
    { "url": "https://nominatim.openstreetmap.org/*" }
  ]
}
```

- [ ] **Step 2: Update ticker.json HTTP scope**

Replace lines 26-31 in the `http:default` allow block:

```json
{
  "identifier": "http:default",
  "allow": [
    { "url": "https://api.myscrollr.relentnet.dev/*" },
    { "url": "https://auth.myscrollr.relentnet.dev/*" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src-tauri/capabilities/default.json desktop/src-tauri/capabilities/ticker.json
git commit -m "security: tighten Tauri HTTP scope to explicit domains

Replace wildcard http://*:* and https://*:* with the specific domains
each window actually needs. Main window: core API, auth, GitHub API,
Open-Meteo, Nominatim. Ticker window: core API, auth only."
```

---

## Task 2: Fix Extension Auth CORS

**Files:**
- Modify: `api/core/extension_auth.go:42-47`

Replace the hardcoded `Access-Control-Allow-Origin: *` with an env-configurable origin list. Checks `EXTENSION_CORS_ORIGINS` first, then `ALLOWED_ORIGINS`, then falls back to a default that includes both the website origin and the Chrome extension origin. Uses request `Origin` header matching per CORS spec.

**Deployment note:** If Firefox extension support is needed, set `EXTENSION_CORS_ORIGINS` to include the relevant `moz-extension://` UUID.

- [ ] **Step 1: Update setCORSHeaders function**

Replace the `setCORSHeaders` function (lines 42-47) with:

```go
// defaultExtensionOrigins includes the website and the Chrome extension.
// Firefox moz-extension:// UUIDs are per-install; operators needing Firefox
// support should set EXTENSION_CORS_ORIGINS explicitly.
const defaultExtensionOrigins = "https://myscrollr.com,chrome-extension://pjeafpgbpfbcaddipkcbacohhbfakclb"

// setCORSHeaders sets CORS headers for extension auth endpoints.
// Reads allowed origins from EXTENSION_CORS_ORIGINS env var, falling
// back to ALLOWED_ORIGINS, then defaultExtensionOrigins. Only responds
// with the requesting origin if it appears in the allow-list.
func setCORSHeaders(c *fiber.Ctx) {
	origin := c.Get("Origin")
	if origin == "" {
		return
	}

	allowed := os.Getenv("EXTENSION_CORS_ORIGINS")
	if allowed == "" {
		allowed = os.Getenv("ALLOWED_ORIGINS")
	}
	if allowed == "" {
		allowed = defaultExtensionOrigins
	}

	for _, o := range strings.Split(allowed, ",") {
		if strings.TrimSpace(o) == origin {
			c.Set("Access-Control-Allow-Origin", origin)
			break
		}
	}
	c.Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	c.Set("Access-Control-Allow-Headers", "Content-Type")
}
```

Note: The `strings` and `os` imports are already present in this file.

- [ ] **Step 2: Verify imports**

Ensure `"strings"` is in the import block. It's already imported in this file (line 10: `"strings"`). No changes needed.

- [ ] **Step 3: Commit**

```bash
git add api/core/extension_auth.go
git commit -m "security: replace wildcard CORS on extension auth endpoints

Replace Access-Control-Allow-Origin: * with origin matching against
EXTENSION_CORS_ORIGINS or ALLOWED_ORIGINS env var. Falls back to
DefaultAllowedOrigins. Operators needing Firefox extension support
can set EXTENSION_CORS_ORIGINS to include moz-extension:// origins."
```

---

## Task 3: Make Sequin Webhook Secret Mandatory

**Files:**
- Modify: `api/core/handlers_webhook.go:33-43`

Currently, if `SEQUIN_WEBHOOK_SECRET` is unset, the handler silently skips authentication. Change to return 500 if the secret is missing.

- [ ] **Step 1: Update the secret check**

Replace lines 33-43:

```go
	// Verify webhook secret (mandatory)
	secret := os.Getenv("SEQUIN_WEBHOOK_SECRET")
	if secret == "" {
		log.Println("[Sequin] SEQUIN_WEBHOOK_SECRET not set — rejecting request")
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error",
			Error:  "Webhook authentication not configured",
		})
	}
	auth := c.Get("Authorization")
	if auth != "Bearer "+secret {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized",
			Error:  "Invalid webhook secret",
		})
	}
```

- [ ] **Step 2: Commit**

```bash
git add api/core/handlers_webhook.go
git commit -m "security: make Sequin webhook secret mandatory

Previously, if SEQUIN_WEBHOOK_SECRET was unset, the handler accepted
any request without authentication. Now returns 500 if the env var
is missing, preventing unauthenticated webhook processing."
```

---

## Task 4: Add Stripe Webhook Event Idempotency

**Files:**
- Modify: `api/core/database.go:125-135` (after stripe_customers table)
- Modify: `api/core/stripe_webhook.go:21-54` (HandleStripeWebhook function)

Add a `stripe_webhook_events` table to track processed event IDs, and check before processing.

- [ ] **Step 1: Add table creation in database.go**

After the `ALTER TABLE stripe_customers ADD COLUMN IF NOT EXISTS lifetime` block (after line 134), add:

```go
	// Stripe webhook idempotency — tracks processed event IDs to skip redeliveries
	_, err = DBPool.Exec(context.Background(), `
		CREATE TABLE IF NOT EXISTS stripe_webhook_events (
			event_id   TEXT PRIMARY KEY,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
	`)
	if err != nil {
		log.Printf("Warning: Failed to create stripe_webhook_events table: %v", err)
	}
```

- [ ] **Step 2: Add idempotency check in stripe_webhook.go**

In `HandleStripeWebhook`, add a dedup check BEFORE the switch statement (after line 36), and record the event AFTER the switch block (before `return c.SendStatus(fiber.StatusOK)` on line 53). This ordering ensures failed handler executions are retried by Stripe.

**Before the switch (after line 36), add the dedup check:**

```go
	// Idempotency: skip already-processed events (Stripe may redeliver)
	var exists bool
	err = DBPool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM stripe_webhook_events WHERE event_id = $1)`,
		event.ID,
	).Scan(&exists)
	if err != nil {
		log.Printf("[Stripe Webhook] Failed to check event idempotency: %v", err)
		// Proceed anyway — better to double-process than to drop events
	}
	if exists {
		log.Printf("[Stripe Webhook] Skipping duplicate event %s (type: %s)", event.ID, event.Type)
		return c.SendStatus(fiber.StatusOK)
	}

```

**After the switch block (before `return c.SendStatus(fiber.StatusOK)` on line 53), record the event:**

```go
	// Mark event as processed AFTER successful handling
	_, _ = DBPool.Exec(context.Background(),
		`INSERT INTO stripe_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`,
		event.ID,
	)

```

This ordering is intentional: if a handler panics or its DB write fails, the event is NOT marked as processed, so Stripe's retry will re-attempt it.

- [ ] **Step 3: Commit**

```bash
git add api/core/database.go api/core/stripe_webhook.go
git commit -m "security: add Stripe webhook event idempotency

Create stripe_webhook_events table to track processed event IDs.
Before processing any webhook event, check if the event ID was
already handled. Skip duplicates with a 200 response (so Stripe
doesn't retry). On DB check failure, proceed anyway to avoid
dropping events."
```

---

## Task 5: Add Dependency Auditing to CI

**Files:**
- Modify: `.github/workflows/desktop-release.yml:99-100` (after npm ci, before build)

Add npm audit and cargo audit steps. Use `continue-on-error: true` so audits report issues without blocking releases (can be tightened later).

- [ ] **Step 1: Add audit steps after `npm ci` (line 100)**

Insert after the "Install frontend dependencies" step:

```yaml
      - name: Audit Node dependencies
        run: npm audit --audit-level=high
        continue-on-error: true

      - name: Audit Rust dependencies
        run: cargo install cargo-audit --quiet && cargo audit
        working-directory: src-tauri
        continue-on-error: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/desktop-release.yml
git commit -m "ci: add npm audit and cargo audit to release workflow

Run dependency audits before building. Uses continue-on-error so
known vulnerabilities are surfaced in logs without blocking
releases. npm audit checks for high/critical, cargo audit checks
all Rust dependencies."
```

---

## Task 6: Update Legal Documents

**Files:**
- Modify: `myscrollr.com/src/components/legal/documents.ts`

Three changes:
1. Remove quarterly billing references and old pricing from Subscription & Billing Terms (section 7)
2. Update the "Browser Extension" section in Terms of Service (section 1) to also reference the desktop app
3. Update the Privacy Policy overview (section 2) to also reference the desktop app

Note: Full removal of the "Browser Extension Privacy" document (section 6) and all extension references across all 14 documents is a larger website-overhaul task tracked separately in the checklist. This task handles only the billing terms and the most prominent extension-only references.

- [ ] **Step 1: Update Subscription & Billing Terms pricing (lines 483-485)**

Replace the 'Pricing and Plans' content array:

```typescript
        content: [
          'Uplink is available in three billing options: Monthly at $9.99 per month (Uplink), $24.99 per month (Uplink Pro), or $49.99 per month (Uplink Ultimate). Annual billing is available at $79.99/year (Uplink), $199.99/year (Uplink Pro), or $399.99/year (Uplink Ultimate). A Lifetime option is available at $399.00 (one-time payment, permanent Uplink-tier access with 50% off Ultimate upgrade).',
          'All prices are in US Dollars (USD). Prices may be adjusted with notice to existing subscribers. Existing subscribers will be honored at their original rate for the remainder of their current billing period.',
        ],
```

- [ ] **Step 2: Update billing renewal section (lines 489-493)**

Replace the 'Billing and Renewal' content array:

```typescript
        content: [
          'Monthly and Annual subscriptions automatically renew at the end of each billing period unless cancelled before the renewal date. You will be charged the applicable subscription fee at the beginning of each billing period.',
          'Lifetime subscriptions are a one-time payment and do not renew. Lifetime access is valid for as long as the Scrollr platform operates.',
        ],
```

- [ ] **Step 3: Update cancellation section (lines 496-501)**

Replace the 'Cancellation' content array:

```typescript
        content: [
          'You may cancel your subscription at any time through your account settings or by contacting support. Cancellation takes effect at the end of your current billing period. You will continue to have access to your current tier until the end of the period you have already paid for.',
          'Plan downgrades are scheduled to take effect at the next renewal date. Upgrades are applied immediately with prorated billing. For refund eligibility, see our Refund Policy.',
        ],
```

- [ ] **Step 4: Update refund window to remove quarterly reference (lines 548-550)**

Replace:

```typescript
          'Quarterly and Annual subscriptions: You may request a full refund within 7 days of your initial purchase or any renewal charge. Refund requests made after the 7-day window will not be honored.',
```

With:

```typescript
          'Monthly and Annual subscriptions: You may request a full refund within 7 days of your initial purchase or any renewal charge. Refund requests made after the 7-day window will not be honored.',
```

- [ ] **Step 5: Update Terms of Service to reference desktop app (line 67)**

Replace:

```typescript
          'By accessing or using Scrollr ("the Platform"), including the website at myscrollr.com, the Scrollr browser extension, and any associated APIs or services, you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Platform.',
```

With:

```typescript
          'By accessing or using Scrollr ("the Platform"), including the website at myscrollr.com, the Scrollr desktop application, the Scrollr browser extension, and any associated APIs or services, you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Platform.',
```

- [ ] **Step 6: Update Privacy Policy overview to reference desktop app (line 151)**

Replace:

```typescript
          'This policy applies to the Scrollr website (myscrollr.com), the Scrollr browser extension, and all associated APIs and services.',
```

With:

```typescript
          'This policy applies to the Scrollr website (myscrollr.com), the Scrollr desktop application, the Scrollr browser extension, and all associated APIs and services.',
```

- [ ] **Step 7: Commit**

```bash
git add myscrollr.com/src/components/legal/documents.ts
git commit -m "legal: update billing terms pricing and remove quarterly references

Update Subscription & Billing Terms to reflect current tier pricing
(Uplink/Pro/Ultimate at $9.99/$24.99/$49.99 monthly). Remove all
quarterly billing references ($21.99/quarter). Update Refund Policy
to reference Monthly instead of Quarterly. Add desktop app to Terms
of Service and Privacy Policy scope."
```

---

## Task 7: Pricing Page — Add Coming Soon Badges, Remove Feed Retention, Remove Referral

**Files:**
- Modify: `myscrollr.com/src/routes/uplink.tsx`

Three changes in one file:
1. Add `comingSoon?: boolean` to ComparisonRow and mark 5 post-v1 features
2. Remove the Feed Retention row from COMPARISON and retention refs from TIER_SHOWCASES
3. Remove the Referral Program UI block

- [ ] **Step 1: Add comingSoon to ComparisonRow interface (line 83-93)**

Add `comingSoon?: boolean` to the interface:

```typescript
interface ComparisonRow {
  label: string
  free: string
  uplink: string
  pro: string
  ultimate: string
  uplinkUp?: boolean
  proUp?: boolean
  ultimateUp?: boolean
  comingSoon?: boolean
}
```

- [ ] **Step 2: Mark post-v1 features as Coming Soon in COMPARISON data**

Add `comingSoon: true` to these 5 rows:
- Custom Alerts (around line 176)
- Feed Profiles (around line 184)
- Webhooks & Integrations (around line 212)
- Data Export (around line 220)
- API Access (around line 228)

Example for Custom Alerts:
```typescript
  {
    label: 'Custom Alerts',
    free: 'No',
    uplink: 'No',
    pro: 'Yes',
    ultimate: 'Yes',
    proUp: true,
    ultimateUp: true,
    comingSoon: true,
  },
```

- [ ] **Step 3: Remove Feed Retention row from COMPARISON**

Delete the Feed Retention entry (lines 165-174):
```typescript
  {
    label: 'Feed Retention',
    free: '25 items',
    uplink: '50 items',
    pro: '200 items',
    ultimate: 'Unlimited',
    uplinkUp: true,
    proUp: true,
    ultimateUp: true,
  },
```

- [ ] **Step 4: Remove feed retention from TIER_SHOWCASES**

In the Pro showcase features array (around line 314), remove: `'200 items retention'`

In the Ultimate showcase features array (around line 333), remove: `'Unlimited data retention'`

- [ ] **Step 5: Remove feed retention FAQ**

Remove the FAQ entry with `question: 'How does feed retention work?'` (lines 507-514).

- [ ] **Step 6: Remove the Referral Program UI block**

Delete the entire `{/* Referral Program */}` motion.div block (lines 3704-3760). This is the block starting with `{/* Referral Program */}` and ending at the `</motion.div>` before `{/* Soft Limits */}`.

- [ ] **Step 7: Render Coming Soon badge in comparison table**

In the comparison table row rendering (around line 3130-3133), update the label cell to show a badge:

```tsx
<div className="p-4 pl-6 flex items-center gap-2">
  <span className="text-xs text-base-content/55 font-medium">
    {row.label}
  </span>
  {row.comingSoon && (
    <span className="text-[9px] font-semibold text-warning/60 bg-warning/10 px-1.5 py-0.5 rounded-full whitespace-nowrap">
      Coming Soon
    </span>
  )}
</div>
```

- [ ] **Step 8: Clean up unused imports if needed**

Check if `Gift` and `Users` imports from lucide-react are used elsewhere after removing the referral block. If `Gift` is now unused, remove it from the import. `Users` may be used elsewhere — verify before removing.

- [ ] **Step 9: Commit**

```bash
git add myscrollr.com/src/routes/uplink.tsx
git commit -m "pricing: add Coming Soon badges, remove feed retention and referral

Mark 5 post-v1 features as Coming Soon in comparison table: Custom
Alerts, Feed Profiles, Webhooks, Data Export, API Access. Remove
Feed Retention row from comparison table, showcase features, and
FAQ. Remove Referral Program section (no backend support exists)."
```

---

## Notes

**Comparison table numbers vs checklist tier reference:** The pricing page COMPARISON data has different limits than the v1_checklist.md tier reference table (e.g., Free shows 10 symbols on pricing page vs 5 in checklist; RSS feeds show 5/50/150 vs 1/25/100). This discrepancy is NOT addressed by this plan — it's a separate alignment task.

**Extension references in legal docs:** This plan updates only the Terms of Service and Privacy Policy scope lines to mention the desktop app. Full removal of the "Browser Extension Privacy" document and all extension-specific language across all 14 legal documents is tracked under the Phase 3 website overhaul checklist items.
