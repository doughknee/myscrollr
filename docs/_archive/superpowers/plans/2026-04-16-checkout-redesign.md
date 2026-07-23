# Checkout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Stripe EmbeddedCheckout with PaymentElement in a custom two-column modal, giving full control over the checkout UI while keeping PCI compliance via Stripe's payment input.

**Architecture:** Two-step backend flow for subscriptions (SetupIntent → create Subscription) and single-step for lifetime (PaymentIntent). New `CheckoutModal` component replaces `CheckoutForm`. Existing plan change, cancel, and portal flows are untouched.

**Tech Stack:** React 19, `@stripe/react-stripe-js` (Elements + PaymentElement), `@stripe/stripe-js`, Go + `stripe-go/v82` (SetupIntent, PaymentIntent, Subscription APIs), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-04-16-checkout-redesign.md`

---

## Task 1: Add Go Response Types for New Endpoints

**Files:**
- Modify: `api/core/models.go:71-98`

This task adds the new request/response types needed by the three new endpoints. The existing `CheckoutRequest` type is reused for `setup-intent`. We add types for the setup intent response, subscribe request/response, and payment intent response.

- [ ] **Step 1: Add new types to models.go**

Add the following types after the existing `CheckoutResponse` struct (line 98 in `api/core/models.go`):

```go
// SetupIntentResponse returns the client secret for the Payment Element (subscription flow).
type SetupIntentResponse struct {
	ClientSecret   string `json:"client_secret"`
	Plan           string `json:"plan"`
	HasTrial       bool   `json:"has_trial"`
	TrialDays      int64  `json:"trial_days,omitempty"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	Interval       string `json:"interval"`
	PublishableKey string `json:"publishable_key"`
}

// SubscribeRequest is the body for POST /checkout/subscribe.
type SubscribeRequest struct {
	SetupIntentID string `json:"setup_intent_id"`
	PriceID       string `json:"price_id"`
}

// SubscribeResponse returns the newly created subscription details.
type SubscribeResponse struct {
	SubscriptionID string `json:"subscription_id"`
	Status         string `json:"status"`
	TrialEnd       *int64 `json:"trial_end,omitempty"`
	Plan           string `json:"plan"`
}

// PaymentIntentResponse returns the client secret for the Payment Element (lifetime flow).
type PaymentIntentResponse struct {
	ClientSecret   string `json:"client_secret"`
	Amount         int64  `json:"amount"`
	Currency       string `json:"currency"`
	PublishableKey string `json:"publishable_key"`
}
```

- [ ] **Step 2: Verify Go build**

Run: `go build ./...` from `api/`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add api/core/models.go
git commit -m "feat(billing): add request/response types for PaymentElement checkout"
```

---

## Task 2: Backend — HandleCreateSetupIntent

**Files:**
- Modify: `api/core/billing.go` (add new handler after line 281)
- Modify: `api/core/server.go:184` (register route)

New import required: `stripeprice "github.com/stripe/stripe-go/v82/price"` and `stripesetupintent "github.com/stripe/stripe-go/v82/setupintent"`.

- [ ] **Step 1: Add imports to billing.go**

Add to the import block in `api/core/billing.go` (lines 3-18):

```go
stripeprice "github.com/stripe/stripe-go/v82/price"
stripesetupintent "github.com/stripe/stripe-go/v82/setupintent"
```

- [ ] **Step 2: Add HandleCreateSetupIntent handler**

Add the following handler after `HandleCreateCheckoutSession` (after line 281) in `api/core/billing.go`:

```go
// HandleCreateSetupIntent creates a Stripe SetupIntent for the Payment Element.
// Used for subscription checkout: collect payment method first, then create subscription.
func HandleCreateSetupIntent(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	var req CheckoutRequest
	if err := c.BodyParser(&req); err != nil || req.PriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "price_id is required",
		})
	}

	// Validate the price is a known recurring price (not lifetime)
	plan := planFromPriceID(req.PriceID)
	if plan == "unknown" || plan == "lifetime" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Invalid price_id for subscription checkout",
		})
	}

	// Check if user already has an active subscription
	var existingPlan string
	var existingStatus string
	var isLifetime bool
	err := DBPool.QueryRow(context.Background(),
		`SELECT plan, status, lifetime FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&existingPlan, &existingStatus, &isLifetime)

	if err == nil && existingPlan != "free" && (existingStatus == "active" || existingStatus == "trialing") {
		// Lifetime members can add Ultimate or Pro on top
		if isLifetime && (isUltimatePlan(plan) || isProPlan(plan)) {
			// Allow through
		} else {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error", Error: "You already have an active subscription",
			})
		}
	}

	email, _ := c.Locals("user_email").(string)
	customerID, err := getOrCreateStripeCustomer(userID, email)
	if err != nil {
		log.Printf("[Billing] Failed to create Stripe customer for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to initialize billing",
		})
	}

	// Check trial eligibility
	var hadPriorSub bool
	_ = DBPool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM stripe_customers WHERE logto_sub = $1 AND plan != 'free')`,
		userID,
	).Scan(&hadPriorSub)

	// Create SetupIntent
	siParams := &stripe.SetupIntentParams{
		Customer: stripe.String(customerID),
		AutomaticPaymentMethods: &stripe.SetupIntentAutomaticPaymentMethodsParams{
			Enabled: stripe.Bool(true),
		},
	}
	siParams.AddMetadata("logto_sub", userID)
	siParams.AddMetadata("plan", plan)
	siParams.AddMetadata("price_id", req.PriceID)

	si, err := stripesetupintent.New(siParams)
	if err != nil {
		log.Printf("[Billing] Failed to create SetupIntent for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to initialize payment setup",
		})
	}

	// Look up price details to return amount/currency/interval
	p, err := stripeprice.Get(req.PriceID, nil)
	if err != nil {
		log.Printf("[Billing] Failed to fetch price %s: %v", req.PriceID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to fetch price details",
		})
	}

	interval := ""
	if p.Recurring != nil {
		interval = string(p.Recurring.Interval)
	}

	hasTrial := !hadPriorSub
	var trialDays int64
	if hasTrial {
		trialDays = 7
	}

	return c.JSON(SetupIntentResponse{
		ClientSecret:   si.ClientSecret,
		Plan:           plan,
		HasTrial:       hasTrial,
		TrialDays:      trialDays,
		Amount:         p.UnitAmount,
		Currency:       string(p.Currency),
		Interval:       interval,
		PublishableKey: os.Getenv("STRIPE_PUBLISHABLE_KEY"),
	})
}
```

- [ ] **Step 3: Register the route in server.go**

In `api/core/server.go`, add after line 184 (after the existing `POST /checkout/session` route):

```go
s.App.Post("/checkout/setup-intent", LogtoAuth, HandleCreateSetupIntent)
```

- [ ] **Step 4: Verify Go build**

Run: `go build ./...` from `api/`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add api/core/billing.go api/core/server.go
git commit -m "feat(billing): add POST /checkout/setup-intent endpoint"
```

---

## Task 3: Backend — HandleConfirmSubscription

**Files:**
- Modify: `api/core/billing.go` (add new handler after the SetupIntent handler)
- Modify: `api/core/server.go` (register route)

New import required: `stripepaymentmethod "github.com/stripe/stripe-go/v82/paymentmethod"`.

- [ ] **Step 1: Add import to billing.go**

Add to the import block:

```go
stripepaymentmethod "github.com/stripe/stripe-go/v82/paymentmethod"
```

- [ ] **Step 2: Add HandleConfirmSubscription handler**

Add after `HandleCreateSetupIntent` in `api/core/billing.go`:

```go
// HandleConfirmSubscription creates a Stripe Subscription after a SetupIntent is confirmed.
// The frontend calls this after stripe.confirmSetup() succeeds.
func HandleConfirmSubscription(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	var req SubscribeRequest
	if err := c.BodyParser(&req); err != nil || req.SetupIntentID == "" || req.PriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "setup_intent_id and price_id are required",
		})
	}

	plan := planFromPriceID(req.PriceID)
	if plan == "unknown" || plan == "lifetime" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Invalid price_id",
		})
	}

	// Retrieve the SetupIntent and verify ownership
	si, err := stripesetupintent.Get(req.SetupIntentID, nil)
	if err != nil {
		log.Printf("[Billing] Failed to retrieve SetupIntent %s: %v", req.SetupIntentID, err)
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Invalid setup intent",
		})
	}

	if si.Status != stripe.SetupIntentStatusSucceeded {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Setup intent not confirmed",
		})
	}

	// Verify the SetupIntent belongs to this user
	if si.Metadata["logto_sub"] != userID {
		return c.Status(fiber.StatusForbidden).JSON(ErrorResponse{
			Status: "error", Error: "Unauthorized",
		})
	}

	paymentMethodID := ""
	if si.PaymentMethod != nil {
		paymentMethodID = si.PaymentMethod.ID
	}
	if paymentMethodID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "No payment method on setup intent",
		})
	}

	customerID := ""
	if si.Customer != nil {
		customerID = si.Customer.ID
	}

	// Attach payment method to customer (idempotent if already attached)
	_, err = stripepaymentmethod.Attach(paymentMethodID, &stripe.PaymentMethodAttachParams{
		Customer: stripe.String(customerID),
	})
	if err != nil {
		// "already been attached" is not a real error
		if !strings.Contains(err.Error(), "already been attached") {
			log.Printf("[Billing] Failed to attach payment method %s to customer %s: %v", paymentMethodID, customerID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error", Error: "Failed to attach payment method",
			})
		}
	}

	// Set as default payment method on the customer
	_, err = stripecustomer.Update(customerID, &stripe.CustomerParams{
		InvoiceSettings: &stripe.CustomerInvoiceSettingsParams{
			DefaultPaymentMethod: stripe.String(paymentMethodID),
		},
	})
	if err != nil {
		log.Printf("[Billing] Failed to set default payment method for customer %s: %v", customerID, err)
	}

	// Check trial eligibility
	var hadPriorSub bool
	_ = DBPool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM stripe_customers WHERE logto_sub = $1 AND plan != 'free')`,
		userID,
	).Scan(&hadPriorSub)

	// Check if lifetime member (for coupon)
	var isLifetime bool
	_ = DBPool.QueryRow(context.Background(),
		`SELECT COALESCE(lifetime, false) FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&isLifetime)

	// Create subscription
	subParams := &stripe.SubscriptionParams{
		Customer: stripe.String(customerID),
		Items: []*stripe.SubscriptionItemsParams{
			{Price: stripe.String(req.PriceID)},
		},
		DefaultPaymentMethod: stripe.String(paymentMethodID),
	}
	subParams.AddMetadata("logto_sub", userID)
	subParams.AddMetadata("plan", plan)

	if !hadPriorSub {
		subParams.TrialPeriodDays = stripe.Int64(7)
	}

	// Lifetime members get 50% off Ultimate
	if isLifetime && isUltimatePlan(plan) {
		couponID := os.Getenv("STRIPE_LIFETIME_ULTIMATE_COUPON_ID")
		if couponID != "" {
			subParams.Coupon = stripe.String(couponID)
			log.Printf("[Billing] Applied lifetime 50%% discount coupon for %s", userID)
		}
	}

	sub, err := stripesubscription.New(subParams)
	if err != nil {
		log.Printf("[Billing] Failed to create subscription for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to create subscription",
		})
	}

	// Upsert DB record
	subStatus := string(sub.Status)
	_, err = DBPool.Exec(context.Background(),
		`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, stripe_subscription_id, plan, status)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (logto_sub) DO UPDATE SET
		   stripe_customer_id = $2, stripe_subscription_id = $3,
		   plan = $4, status = $5, updated_at = now()`,
		userID, customerID, sub.ID, plan, subStatus,
	)
	if err != nil {
		log.Printf("[Billing] Failed to upsert subscription record for %s: %v", userID, err)
	}

	// Assign Logto role
	if subStatus == "trialing" || isUltimatePlan(plan) {
		if err := AssignUltimateRole(userID); err != nil {
			log.Printf("[Billing] Failed to assign ultimate role to %s: %v", userID, err)
		}
	} else if isProPlan(plan) {
		if err := AssignProRole(userID); err != nil {
			log.Printf("[Billing] Failed to assign pro role to %s: %v", userID, err)
		}
	} else {
		if err := AssignUplinkRole(userID); err != nil {
			log.Printf("[Billing] Failed to assign uplink role to %s: %v", userID, err)
		}
	}

	var trialEnd *int64
	if sub.TrialEnd > 0 {
		trialEnd = &sub.TrialEnd
	}

	return c.JSON(SubscribeResponse{
		SubscriptionID: sub.ID,
		Status:         subStatus,
		TrialEnd:       trialEnd,
		Plan:           plan,
	})
}
```

- [ ] **Step 3: Register the route in server.go**

Add after the `setup-intent` route:

```go
s.App.Post("/checkout/subscribe", LogtoAuth, HandleConfirmSubscription)
```

- [ ] **Step 4: Verify Go build**

Run: `go build ./...` from `api/`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add api/core/billing.go api/core/server.go
git commit -m "feat(billing): add POST /checkout/subscribe endpoint"
```

---

## Task 4: Backend — HandleCreatePaymentIntent

**Files:**
- Modify: `api/core/billing.go` (add new handler)
- Modify: `api/core/server.go` (register route)

New import required: `stripepaymentintent "github.com/stripe/stripe-go/v82/paymentintent"`.

- [ ] **Step 1: Add import to billing.go**

Add to the import block:

```go
stripepaymentintent "github.com/stripe/stripe-go/v82/paymentintent"
```

- [ ] **Step 2: Add HandleCreatePaymentIntent handler**

Add after `HandleConfirmSubscription` in `api/core/billing.go`:

```go
// HandleCreatePaymentIntent creates a Stripe PaymentIntent for lifetime purchases.
// The frontend confirms this directly via stripe.confirmPayment().
func HandleCreatePaymentIntent(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	lifetimePrice := os.Getenv("STRIPE_PRICE_LIFETIME")
	if lifetimePrice == "" {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Lifetime pricing not configured",
		})
	}

	// Check eligibility
	var existingPlan string
	var existingStatus string
	var existingLifetime bool
	err := DBPool.QueryRow(context.Background(),
		`SELECT plan, status, lifetime FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&existingPlan, &existingStatus, &existingLifetime)

	if err == nil {
		if existingLifetime {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error", Error: "You already have lifetime access",
			})
		}
		if existingPlan != "free" && (existingStatus == "active" || existingStatus == "trialing") {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error", Error: "Please cancel your current subscription before purchasing lifetime",
			})
		}
	}

	email, _ := c.Locals("user_email").(string)
	customerID, err := getOrCreateStripeCustomer(userID, email)
	if err != nil {
		log.Printf("[Billing] Failed to create Stripe customer for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to initialize billing",
		})
	}

	// Look up the lifetime price amount from Stripe
	p, err := stripeprice.Get(lifetimePrice, nil)
	if err != nil {
		log.Printf("[Billing] Failed to fetch lifetime price %s: %v", lifetimePrice, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to fetch price details",
		})
	}

	// Create PaymentIntent
	piParams := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(p.UnitAmount),
		Currency: stripe.String(string(p.Currency)),
		Customer: stripe.String(customerID),
		AutomaticPaymentMethods: &stripe.PaymentIntentAutomaticPaymentMethodsParams{
			Enabled: stripe.Bool(true),
		},
	}
	piParams.AddMetadata("logto_sub", userID)
	piParams.AddMetadata("plan", "lifetime")

	pi, err := stripepaymentintent.New(piParams)
	if err != nil {
		log.Printf("[Billing] Failed to create PaymentIntent for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to initialize payment",
		})
	}

	return c.JSON(PaymentIntentResponse{
		ClientSecret:   pi.ClientSecret,
		Amount:         p.UnitAmount,
		Currency:       string(p.Currency),
		PublishableKey: os.Getenv("STRIPE_PUBLISHABLE_KEY"),
	})
}
```

- [ ] **Step 3: Register the route in server.go**

Add after the `subscribe` route:

```go
s.App.Post("/checkout/payment-intent", LogtoAuth, HandleCreatePaymentIntent)
```

- [ ] **Step 4: Verify Go build**

Run: `go build ./...` from `api/`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add api/core/billing.go api/core/server.go
git commit -m "feat(billing): add POST /checkout/payment-intent endpoint"
```

---

## Task 5: Backend — Add payment_intent.succeeded Webhook Handler

**Files:**
- Modify: `api/core/stripe_webhook.go`

- [ ] **Step 1: Add payment_intent.succeeded case to the switch**

In `api/core/stripe_webhook.go`, add a new case in the `switch event.Type` block (after line 66, before `default:`):

```go
case "payment_intent.succeeded":
	handlePaymentIntentSucceeded(event)
```

- [ ] **Step 2: Add the handler function**

Add at the end of `api/core/stripe_webhook.go` (before the closing of the file):

```go
// handlePaymentIntentSucceeded handles successful one-time payments (lifetime purchases).
func handlePaymentIntentSucceeded(event stripe.Event) {
	var pi stripe.PaymentIntent
	if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
		log.Printf("[Stripe Webhook] Failed to parse payment_intent.succeeded: %v", err)
		return
	}

	plan := pi.Metadata["plan"]
	logtoSub := pi.Metadata["logto_sub"]

	// Only handle lifetime payments (other PaymentIntents are not ours)
	if plan != "lifetime" || logtoSub == "" {
		log.Printf("[Stripe Webhook] Ignoring payment_intent.succeeded: plan=%s logto_sub=%s", plan, logtoSub)
		return
	}

	customerID := ""
	if pi.Customer != nil {
		customerID = pi.Customer.ID
	}

	log.Printf("[Stripe Webhook] Lifetime payment succeeded: user=%s customer=%s", logtoSub, customerID)

	_, err := DBPool.Exec(context.Background(),
		`INSERT INTO stripe_customers (logto_sub, stripe_customer_id, plan, status, lifetime)
		 VALUES ($1, $2, 'lifetime', 'active', true)
		 ON CONFLICT (logto_sub) DO UPDATE SET
		   stripe_customer_id = $2, plan = 'lifetime', status = 'active',
		   lifetime = true, updated_at = now()`,
		logtoSub, customerID,
	)
	if err != nil {
		log.Printf("[Stripe Webhook] Failed to upsert lifetime for %s: %v", logtoSub, err)
		return
	}

	if err := AssignUltimateRole(logtoSub); err != nil {
		log.Printf("[Stripe Webhook] Failed to assign ultimate role to %s: %v", logtoSub, err)
	}
}
```

- [ ] **Step 3: Verify Go build**

Run: `go build ./...` from `api/`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add api/core/stripe_webhook.go
git commit -m "feat(billing): add payment_intent.succeeded webhook handler for lifetime"
```

---

## Task 6: Frontend — Add New API Client Methods

**Files:**
- Modify: `myscrollr.com/src/api/client.ts`

- [ ] **Step 1: Add new response types**

In `myscrollr.com/src/api/client.ts`, add the following types after the existing `CheckoutReturnStatus` interface (after line 232):

```typescript
export interface SetupIntentResponse {
  client_secret: string
  plan: string
  has_trial: boolean
  trial_days: number
  amount: number
  currency: string
  interval: string
  publishable_key: string
}

export interface SubscribeResponse {
  subscription_id: string
  status: string
  trial_end?: number
  plan: string
}

export interface PaymentIntentResponse {
  client_secret: string
  amount: number
  currency: string
  publishable_key: string
}
```

- [ ] **Step 2: Add new billingApi methods**

In `myscrollr.com/src/api/client.ts`, add the following methods to the `billingApi` object (after the existing `createLifetimeCheckout` method, around line 256):

```typescript
  /** Create a SetupIntent for subscription checkout (PaymentElement flow) */
  createSetupIntent: (
    priceId: string,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<SetupIntentResponse>(
      '/checkout/setup-intent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price_id: priceId }),
      },
      getToken,
    ),

  /** Confirm subscription after SetupIntent is confirmed */
  confirmSubscription: (
    setupIntentId: string,
    priceId: string,
    getToken: () => Promise<string | null>,
  ) =>
    authenticatedFetch<SubscribeResponse>(
      '/checkout/subscribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setup_intent_id: setupIntentId,
          price_id: priceId,
        }),
      },
      getToken,
    ),

  /** Create a PaymentIntent for lifetime purchase (PaymentElement flow) */
  createPaymentIntent: (getToken: () => Promise<string | null>) =>
    authenticatedFetch<PaymentIntentResponse>(
      '/checkout/payment-intent',
      { method: 'POST' },
      getToken,
    ),
```

- [ ] **Step 3: Verify TypeScript build**

Run: `npm run build` from `myscrollr.com/`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add myscrollr.com/src/api/client.ts
git commit -m "feat(billing): add API client methods for PaymentElement checkout"
```

---

## Task 7: Frontend — Create CheckoutModal Component

**Files:**
- Create: `myscrollr.com/src/components/billing/CheckoutModal.tsx`

This is the core frontend component. It replaces `CheckoutForm.tsx` with a two-column modal that uses Stripe's `PaymentElement` instead of `EmbeddedCheckout`.

- [ ] **Step 1: Create CheckoutModal.tsx**

Create `myscrollr.com/src/components/billing/CheckoutModal.tsx` with the following content:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import type { Appearance, StripeElementsOptions } from '@stripe/stripe-js'
import { AlertTriangle, Loader2, Lock, X } from 'lucide-react'
import { billingApi } from '@/api/client'
import type { PaymentIntentResponse, SetupIntentResponse } from '@/api/client'

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
)

// Stripe Elements appearance matching the site's dark theme
const appearance: Appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#6366f1',
    colorBackground: '#1a1a2e',
    colorText: '#e2e8f0',
    colorDanger: '#ef4444',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    borderRadius: '8px',
    spacingUnit: '4px',
  },
  rules: {
    '.Input': {
      border: '1px solid rgba(255, 255, 255, 0.1)',
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    '.Input:focus': {
      border: '1px solid #6366f1',
      boxShadow: '0 0 0 1px #6366f1',
    },
    '.Label': {
      color: '#94a3b8',
      fontSize: '12px',
    },
  },
}

// ── Types ──────────────────────────────────────────────────────────

interface SubscriptionPlan {
  name: string
  tier: 'uplink' | 'pro' | 'ultimate'
  priceId: string
  price: number
  interval: 'monthly' | 'annual'
  perMonth: number
}

interface LifetimePlan {
  name: 'Lifetime'
  tier: 'lifetime'
  price: 399
}

type PlanInfo = SubscriptionPlan | LifetimePlan

interface CheckoutModalProps {
  plan: PlanInfo
  hasTrial: boolean
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}

type CheckoutState = 'idle' | 'loading' | 'ready' | 'submitting' | 'success'

// ── Tier colors ────────────────────────────────────────────────────

const TIER_COLORS: Record<string, { badge: string; accent: string }> = {
  uplink: {
    badge: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    accent: 'text-blue-400',
  },
  pro: {
    badge: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
    accent: 'text-purple-400',
  },
  ultimate: {
    badge: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    accent: 'text-amber-400',
  },
  lifetime: {
    badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    accent: 'text-emerald-400',
  },
}

// ── Helper ─────────────────────────────────────────────────────────

function isLifetimePlan(plan: PlanInfo): plan is LifetimePlan {
  return plan.tier === 'lifetime'
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function trialEndDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Inner Payment Form ─────────────────────────────────────────────

interface PaymentFormProps {
  plan: PlanInfo
  hasTrial: boolean
  setupIntent?: SetupIntentResponse
  getToken: () => Promise<string | null>
  onReady: () => void
  onSuccess: () => void
  onError: (msg: string) => void
}

function PaymentForm({
  plan,
  hasTrial,
  setupIntent,
  getToken,
  onReady,
  onSuccess,
  onError,
}: PaymentFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLifetime = isLifetimePlan(plan)
  const buttonLabel = isLifetime
    ? `Pay $${plan.price}`
    : hasTrial
      ? 'Start free trial'
      : 'Subscribe'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setError(null)

    try {
      // Validate the form
      const { error: submitError } = await elements.submit()
      if (submitError) {
        setError(submitError.message || 'Please check your payment details')
        setSubmitting(false)
        return
      }

      if (isLifetime) {
        // Confirm PaymentIntent directly
        const { error: confirmError } = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url:
              window.location.origin + '/uplink/lifetime?payment=complete',
          },
          redirect: 'if_required',
        })
        if (confirmError) {
          setError(confirmError.message || 'Payment failed')
          setSubmitting(false)
          return
        }
        onSuccess()
      } else {
        // Confirm SetupIntent, then create subscription server-side
        const { error: confirmError, setupIntent: confirmedSi } =
          await stripe.confirmSetup({
            elements,
            confirmParams: {
              return_url:
                window.location.origin + '/uplink?setup=complete',
            },
            redirect: 'if_required',
          })
        if (confirmError) {
          setError(confirmError.message || 'Payment setup failed')
          setSubmitting(false)
          return
        }

        // Create the subscription on the backend
        if (confirmedSi && 'id' in confirmedSi && !isLifetimePlan(plan)) {
          await billingApi.confirmSubscription(
            confirmedSi.id,
            plan.priceId,
            getToken,
          )
        }
        onSuccess()
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(msg)
      onError(msg)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h3 className="text-xs font-semibold text-base-content/50 uppercase tracking-wider">
        Payment method
      </h3>
      <PaymentElement
        options={{ layout: 'tabs' }}
        onReady={onReady}
      />
      {error && (
        <div className="flex items-start gap-2 p-3 bg-error/10 border border-error/20 rounded-lg">
          <AlertTriangle size={14} className="text-error mt-0.5 shrink-0" />
          <p className="text-xs text-error">{error}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full py-3 px-4 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-primary text-primary-content hover:bg-primary/90 active:scale-[0.98]"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Processing...
          </span>
        ) : (
          buttonLabel
        )}
      </button>
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-base-content/30">
        <Lock size={10} />
        <span>Secured by Stripe</span>
      </div>
    </form>
  )
}

// ── Order Summary ──────────────────────────────────────────────────

interface OrderSummaryProps {
  plan: PlanInfo
  hasTrial: boolean
  amount: number // in cents, from Stripe
  currency: string
}

function OrderSummary({ plan, hasTrial, amount, currency }: OrderSummaryProps) {
  const colors = TIER_COLORS[plan.tier]
  const isLifetime = isLifetimePlan(plan)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-3">
          Order summary
        </h3>
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${colors.badge}`}
          >
            {plan.tier === 'lifetime' ? 'Founding Member' : plan.tier}
          </span>
        </div>
        <p className="text-base font-semibold text-base-content">
          {plan.name}
          {!isLifetime && ' Plan'}
        </p>
        <p className="text-xs text-base-content/40 mt-0.5">
          {isLifetime
            ? 'One-time payment — permanent access'
            : `${(plan as SubscriptionPlan).interval === 'annual' ? 'Annual' : 'Monthly'} billing`}
        </p>
      </div>

      <div className="border-t border-base-content/10 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-base-content/50">
            {isLifetime ? 'Lifetime Access' : `${plan.name} — ${(plan as SubscriptionPlan).interval}`}
          </span>
          <span className="text-sm font-semibold text-base-content">
            {formatCurrency(amount)}
            {!isLifetime &&
              `/${(plan as SubscriptionPlan).interval === 'annual' ? 'yr' : 'mo'}`}
          </span>
        </div>
        {!isLifetime && (plan as SubscriptionPlan).interval === 'annual' && (
          <p className="text-[10px] text-base-content/30 text-right mt-0.5">
            ${(plan as SubscriptionPlan).perMonth.toFixed(2)}/mo
          </p>
        )}
      </div>

      {hasTrial && !isLifetime && (
        <div className="bg-primary/5 border border-primary/15 rounded-lg p-3">
          <p className="text-xs font-semibold text-primary mb-1">
            7-day free trial
          </p>
          <p className="text-[10px] text-base-content/40 leading-relaxed">
            You won&apos;t be charged today. Your card will be charged{' '}
            {formatCurrency(amount)} on {trialEndDate(7)}.
          </p>
        </div>
      )}

      <div className="border-t border-base-content/10 pt-3 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-base-content/60">
          Due today
        </span>
        <span className={`text-lg font-bold ${colors.accent}`}>
          {hasTrial && !isLifetime ? '$0.00' : formatCurrency(amount)}
        </span>
      </div>
    </div>
  )
}

// ── Main Modal ─────────────────────────────────────────────────────

export default function CheckoutModal({
  plan,
  hasTrial,
  getToken,
  onSuccess,
  onClose,
}: CheckoutModalProps) {
  const [state, setState] = useState<CheckoutState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [setupIntent, setSetupIntent] = useState<SetupIntentResponse | null>(
    null,
  )
  const [paymentIntent, setPaymentIntent] =
    useState<PaymentIntentResponse | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const isLifetime = isLifetimePlan(plan)

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => dialogRef.current?.focus())
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Fetch intent on mount
  useEffect(() => {
    let cancelled = false
    setState('loading')
    setError(null)

    const fetchIntent = async () => {
      try {
        if (isLifetime) {
          const res = await billingApi.createPaymentIntent(getToken)
          if (!cancelled) setPaymentIntent(res)
        } else {
          const res = await billingApi.createSetupIntent(
            (plan as SubscriptionPlan).priceId,
            getToken,
          )
          if (!cancelled) setSetupIntent(res)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to initialize checkout',
          )
          setState('idle')
        }
      }
    }

    fetchIntent()
    return () => {
      cancelled = true
    }
  }, [plan, isLifetime, getToken])

  // Build Elements options
  const elementsOptions: StripeElementsOptions | null =
    isLifetime && paymentIntent
      ? {
          clientSecret: paymentIntent.client_secret,
          appearance,
        }
      : !isLifetime && setupIntent
        ? {
            clientSecret: setupIntent.client_secret,
            appearance,
          }
        : null

  // Amount for order summary (in cents)
  const amount = isLifetime
    ? (paymentIntent?.amount ?? 39900)
    : (setupIntent?.amount ?? 0)
  const currency = isLifetime
    ? (paymentIntent?.currency ?? 'usd')
    : (setupIntent?.currency ?? 'usd')

  // Error state (intent creation failed)
  if (error && state !== 'ready') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Checkout error"
          tabIndex={-1}
          className="relative w-full max-w-md mx-4 bg-base-200 border border-error/30 rounded-xl p-8"
        >
          <button
            onClick={onClose}
            aria-label="Close checkout"
            className="absolute top-4 right-4 text-base-content/40 hover:text-base-content transition-colors"
          >
            <X size={18} />
          </button>
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertTriangle size={32} className="text-error" />
            <h3 className="text-sm font-semibold text-error">
              Checkout Failed
            </h3>
            <p className="text-xs text-base-content/50">{error}</p>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2 text-xs font-semibold border border-base-content/20 rounded-lg hover:bg-base-content/5 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={isLifetime ? 'Lifetime purchase' : `Subscribe to ${plan.name}`}
        tabIndex={-1}
        className="relative w-full max-w-2xl mx-4 bg-base-200 border border-base-content/10 rounded-xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-base-content/10">
          <h2 className="text-xs font-semibold text-base-content/60 uppercase tracking-wider">
            Checkout
          </h2>
          <button
            onClick={onClose}
            aria-label="Close checkout"
            className="text-base-content/40 hover:text-base-content transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — two columns on md+, stacked on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-6 p-6">
          {/* Left: Order Summary */}
          <div className="pb-6 md:pb-0 md:pr-6 md:border-r border-b md:border-b-0 border-base-content/10">
            <OrderSummary
              plan={plan}
              hasTrial={hasTrial && !isLifetime}
              amount={amount}
              currency={currency}
            />
          </div>

          {/* Right: Payment Form */}
          <div className="pt-6 md:pt-0">
            {elementsOptions ? (
              <Elements stripe={stripePromise} options={elementsOptions}>
                <PaymentForm
                  plan={plan}
                  hasTrial={hasTrial}
                  setupIntent={setupIntent ?? undefined}
                  getToken={getToken}
                  onReady={() => setState('ready')}
                  onSuccess={() => {
                    setState('success')
                    onSuccess()
                  }}
                  onError={() => {}}
                />
              </Elements>
            ) : (
              <div className="flex items-center justify-center h-48">
                <Loader2 size={24} className="animate-spin text-primary" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript build**

Run: `npm run build` from `myscrollr.com/`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add myscrollr.com/src/components/billing/CheckoutModal.tsx
git commit -m "feat(billing): add CheckoutModal with PaymentElement"
```

---

## Task 8: Frontend — Update uplink.tsx to Use CheckoutModal

**Files:**
- Modify: `myscrollr.com/src/routes/uplink.tsx`

This task replaces `CheckoutForm` usage with `CheckoutModal`, removes `session_id` return handling, and updates the state + plan selection logic.

- [ ] **Step 1: Replace CheckoutForm import with CheckoutModal**

In `myscrollr.com/src/routes/uplink.tsx`, replace line 48:

```tsx
const CheckoutForm = lazy(() => import('@/components/billing/CheckoutForm'))
```

with:

```tsx
const CheckoutModal = lazy(
  () => import('@/components/billing/CheckoutModal'),
)
```

- [ ] **Step 2: Remove session_id from route search params**

In the route search validation (around line 74), remove `session_id`:

Replace:
```tsx
    session_id: (search.session_id as string) || undefined,
```

with nothing (delete the line). If `session_id` is the only search param, replace the entire `validateSearch` with an empty object or remove it.

**Note:** Check what other search params exist in the route validation. If `session_id` is the only one, the `validateSearch` block can be simplified to just `{}`.

- [ ] **Step 3: Remove session_id state and checkout return effect**

Remove or comment out:
- `const { session_id } = Route.useSearch()` (line 886)
- `const [checkingSession, setCheckingSession] = useState(false)` (line 892)
- The entire `session_id` return handling `useEffect` (lines 944-965)

- [ ] **Step 4: Update state variables**

Replace these state declarations (lines 888-891):
```tsx
const [selectedPlan, setSelectedPlan] = useState<PlanKey | null>(null)
const [selectedTier, setSelectedTier] = useState<TierKey>('uplink')
const [showCheckout, setShowCheckout] = useState(false)
const [checkoutSuccess, setCheckoutSuccess] = useState(false)
```

with:
```tsx
const [checkoutPlan, setCheckoutPlan] = useState<{
  name: string
  tier: TierKey
  priceId: string
  price: number
  interval: PlanKey
  perMonth: number
} | null>(null)
const [checkoutSuccess, setCheckoutSuccess] = useState(false)
```

- [ ] **Step 5: Update handleSelectPlan**

Replace lines 1003-1007:
```tsx
    // No subscription or same tier — original checkout flow
    setSelectedPlan(plan)
    setSelectedTier(tier)
    setShowCheckout(true)
```

with:
```tsx
    // No subscription or same tier — open checkout modal
    const priceId = getPriceId(tier, plan)
    const pricing = PRICING[tier]
    const periodPricing = pricing[plan as keyof typeof pricing] as {
      price: number
      perMonth: number
    }
    setCheckoutPlan({
      name: TIER_NAMES[tier],
      tier,
      priceId,
      price: periodPricing.price,
      interval: plan,
      perMonth: periodPricing.perMonth,
    })
```

- [ ] **Step 6: Update handleCloseCheckout**

Replace lines 1030-1034:
```tsx
  const handleCloseCheckout = () => {
    setShowCheckout(false)
    setSelectedPlan(null)
    setSelectedTier('uplink')
  }
```

with:
```tsx
  const handleCloseCheckout = () => {
    setCheckoutPlan(null)
  }
```

- [ ] **Step 7: Remove getSelectedPriceId helper**

Delete lines 1036-1039:
```tsx
  const getSelectedPriceId = (): string => {
    if (!selectedPlan) return ''
    return getPriceId(selectedTier, selectedPlan)
  }
```

- [ ] **Step 8: Replace the checkout modal rendering**

Replace lines 1071-1087:
```tsx
      {showCheckout && selectedPlan && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          }
        >
          <CheckoutForm
            priceId={getSelectedPriceId()}
            isUltimate={selectedTier === 'ultimate'}
            getToken={getToken}
            onClose={handleCloseCheckout}
          />
        </Suspense>
      )}
```

with:
```tsx
      {checkoutPlan && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          }
        >
          <CheckoutModal
            plan={checkoutPlan}
            hasTrial={!hadPriorSub}
            getToken={getToken}
            onSuccess={() => {
              setCheckoutPlan(null)
              setCheckoutSuccess(true)
            }}
            onClose={handleCloseCheckout}
          />
        </Suspense>
      )}
```

- [ ] **Step 9: Verify TypeScript build**

Run: `npm run build` from `myscrollr.com/`

Expected: Build succeeds. If there are unused import warnings for `CheckoutForm` or `session_id` types, remove them.

- [ ] **Step 10: Commit**

```bash
git add myscrollr.com/src/routes/uplink.tsx
git commit -m "feat(billing): wire CheckoutModal into uplink pricing page"
```

---

## Task 9: Frontend — Update uplink_.lifetime.tsx to Use CheckoutModal

**Files:**
- Modify: `myscrollr.com/src/routes/uplink_.lifetime.tsx`

- [ ] **Step 1: Replace CheckoutForm import with CheckoutModal**

Replace line 22:
```tsx
const CheckoutForm = lazy(() => import('@/components/billing/CheckoutForm'))
```

with:
```tsx
const CheckoutModal = lazy(
  () => import('@/components/billing/CheckoutModal'),
)
```

- [ ] **Step 2: Remove session_id from route search params**

Remove `session_id` from the route's `validateSearch` (line 32). Same approach as Task 8 Step 2.

- [ ] **Step 3: Remove session_id state and return handling**

Remove:
- `const { session_id } = Route.useSearch()` (line 59)
- `const [checkingSession, setCheckingSession] = useState(false)` (line 63)
- The `session_id` return `useEffect` (lines 82-102)

- [ ] **Step 4: Replace CheckoutForm rendering**

Replace lines 115-129:
```tsx
      {showCheckout && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          }
        >
          <CheckoutForm
            isLifetime
            getToken={getToken}
            onClose={() => setShowCheckout(false)}
          />
        </Suspense>
      )}
```

with:
```tsx
      {showCheckout && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <Loader2 size={24} className="animate-spin text-primary" />
            </div>
          }
        >
          <CheckoutModal
            plan={{ name: 'Lifetime', tier: 'lifetime', price: 399 }}
            hasTrial={false}
            getToken={getToken}
            onSuccess={() => {
              setShowCheckout(false)
              setCheckoutSuccess(true)
            }}
            onClose={() => setShowCheckout(false)}
          />
        </Suspense>
      )}
```

- [ ] **Step 5: Verify TypeScript build**

Run: `npm run build` from `myscrollr.com/`

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add myscrollr.com/src/routes/uplink_.lifetime.tsx
git commit -m "feat(billing): wire CheckoutModal into lifetime page"
```

---

## Task 10: Cleanup — Remove Old CheckoutForm

**Files:**
- Delete: `myscrollr.com/src/components/billing/CheckoutForm.tsx`

- [ ] **Step 1: Verify no remaining references to CheckoutForm**

Run: `grep -r "CheckoutForm" myscrollr.com/src/` 

Expected: No results (all references replaced in Tasks 8 and 9).

- [ ] **Step 2: Delete CheckoutForm.tsx**

```bash
rm myscrollr.com/src/components/billing/CheckoutForm.tsx
```

- [ ] **Step 3: Remove unused old billingApi methods**

In `myscrollr.com/src/api/client.ts`, the following methods are no longer called by the new flow but should be kept temporarily for backward compatibility during rollout:
- `createCheckoutSession` — keep (old flow fallback)
- `createLifetimeCheckout` — keep (old flow fallback)
- `getCheckoutReturn` — keep (old flow fallback)

These can be removed in a follow-up cleanup once the new flow is verified in production.

- [ ] **Step 4: Verify TypeScript build**

Run: `npm run build` from `myscrollr.com/`

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A myscrollr.com/src/components/billing/
git commit -m "chore(billing): remove old CheckoutForm component"
```

---

## Task 11: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Full Go build**

Run: `go build ./...` from `api/`

Expected: Build succeeds with no errors.

- [ ] **Step 2: Full TypeScript build**

Run: `npm run build` from `myscrollr.com/`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Run lint/format**

Run: `npm run check` from `myscrollr.com/`

Expected: No errors. If Prettier/ESLint fix any formatting, commit the changes.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add -A myscrollr.com/
git commit -m "style: format checkout changes"
```
