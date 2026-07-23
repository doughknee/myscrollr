# Checkout Redesign: Embedded Checkout → Payment Element

## Problem

The current checkout uses Stripe's `EmbeddedCheckout` component rendered inside a `fixed inset-0 z-50` modal with `max-w-lg`. The embedded form is a full-page experience (address fields, payment input, order summary, terms) crammed into a dialog — it overflows vertically, feels disconnected from the app, and provides no customization over layout or appearance.

## Solution

Replace `EmbeddedCheckout` with Stripe's `PaymentElement` inside a custom two-column modal. The left column shows an order summary we control (plan name, price, billing period, trial callout, due-today amount). The right column renders the compact `PaymentElement` for payment method collection. This gives full control over layout, styling, and UX while Stripe still handles PCI-compliant payment input.

## Architecture

### Two Distinct Backend Flows

**Subscriptions (with or without trial):**

1. Frontend calls `POST /checkout/setup-intent` with `{ price_id }`.
2. Backend validates price, gets/creates Stripe customer, creates a `SetupIntent` with `automatic_payment_methods: { enabled: true }`. Returns `{ client_secret, customer_id, plan, has_trial, publishable_key }`.
3. Frontend renders `<Elements>` provider with `mode: 'setup'`, wrapping `<PaymentElement>`.
4. User fills in payment details. Frontend calls `elements.submit()` to validate, then `stripe.confirmSetup({ elements, clientSecret, confirmParams: { return_url: window.location.origin + '/uplink?setup=complete' }, redirect: 'if_required' })`. The `return_url` is a fallback for payment methods that require redirect (bank debits, etc.) — cards confirm inline without redirect.
5. On success (no redirect needed for cards), frontend calls `POST /checkout/subscribe` with `{ setup_intent_id, price_id }`.
6. Backend retrieves the confirmed SetupIntent, extracts `payment_method`, creates a `Subscription` with `default_payment_method` set, `trial_period_days: 7` if eligible, and metadata (`logto_sub`, `plan`). Returns `{ subscription_id, status, trial_end }`.
7. Existing webhook handlers (`customer.subscription.created/updated`, `invoice.paid`) handle role assignment and DB sync.

**Lifetime (one-time payment):**

1. Frontend calls `POST /checkout/payment-intent` (no body needed — backend reads lifetime price from env).
2. Backend validates eligibility, gets/creates Stripe customer, creates a `PaymentIntent` with the lifetime price amount, `automatic_payment_methods: { enabled: true }`, and metadata. Returns `{ client_secret, amount, currency, publishable_key }`.
3. Frontend renders `<Elements>` provider with `mode: 'payment', amount, currency`, wrapping `<PaymentElement>`.
4. User fills in payment details. Frontend calls `elements.submit()`, then `stripe.confirmPayment({ elements, clientSecret, confirmParams: { return_url: window.location.origin + '/uplink/lifetime?payment=complete' }, redirect: 'if_required' })`.
5. On success, frontend shows confirmation inline (no second API call needed — webhook handles fulfillment).
6. Backend receives `payment_intent.succeeded` webhook, reads metadata, upserts DB with `lifetime: true`, assigns Logto roles.

### What Changes

| Layer | Before | After |
|-------|--------|-------|
| **Frontend component** | `EmbeddedCheckout` + `EmbeddedCheckoutProvider` | `Elements` + `PaymentElement` + custom UI |
| **Backend (subscriptions)** | Single `POST /checkout/session` creates Checkout Session | Two-step: `POST /checkout/setup-intent` + `POST /checkout/subscribe` |
| **Backend (lifetime)** | `POST /checkout/lifetime` creates Checkout Session | `POST /checkout/payment-intent` creates PaymentIntent |
| **Checkout return** | Stripe redirects to `?session_id=`, frontend polls | Inline confirmation via `redirect: 'if_required'` (no page reload for cards) |
| **Webhook** | `checkout.session.completed` is primary trigger | `payment_intent.succeeded` (lifetime), `customer.subscription.created/updated` (subscriptions) |

### What Stays the Same

- Plan change flow (`previewPlanChange` + `changePlan`) — not part of checkout, untouched.
- Cancel flow — untouched.
- Customer portal — untouched.
- `getOrCreateStripeCustomer()` — reused as-is.
- `planFromPriceID()` — reused as-is.
- Webhook handlers for `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.trial_will_end` — all remain.
- `stripe_webhook_events` idempotency table — remains.
- Trial logic: first-time subscribers get 7-day trial with Ultimate access during trial.
- Lifetime+Ultimate 50% coupon logic — applied server-side when creating the subscription.

## Frontend Design

### New Component: `CheckoutModal`

Replaces `CheckoutForm.tsx`. A two-column modal rendered as a `fixed inset-0 z-50` overlay.

**Props:**
```typescript
interface CheckoutModalProps {
  plan: {
    name: string        // "Uplink", "Pro", "Ultimate"
    tier: string        // "uplink", "pro", "ultimate"
    priceId: string     // Stripe price ID
    price: number       // e.g. 9.99
    interval: 'monthly' | 'annual'
    perMonth: number    // e.g. 6.67 for annual
  } | {
    name: 'Lifetime'
    tier: 'lifetime'
    price: 399
  }
  hasTrial: boolean     // derived as !had_prior_sub from subscription status
  getToken: () => Promise<string | null>
  onSuccess: () => void
  onClose: () => void
}
```

**Layout (desktop — `min-width: 768px`):**
```
┌──────────────────────────────────────────────┐
│  [X]                                         │
│                                              │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │  ORDER SUMMARY   │  │  PAYMENT         │   │
│  │                  │  │                  │   │
│  │  Pro Plan        │  │  ┌────────────┐  │   │
│  │  Annual billing  │  │  │ PaymentEl  │  │   │
│  │                  │  │  │            │  │   │
│  │  $199.99/year    │  │  │            │  │   │
│  │  ($16.67/mo)     │  │  └────────────┘  │   │
│  │                  │  │                  │   │
│  │  ┌────────────┐  │  │  [ Subscribe ]   │   │
│  │  │ 7-day free │  │  │                  │   │
│  │  │ trial      │  │  │  Secure payment  │   │
│  │  │ Due: $0.00 │  │  │  powered by      │   │
│  │  └────────────┘  │  │  Stripe          │   │
│  │                  │  │                  │   │
│  └─────────────────┘  └──────────────────┘   │
│                                              │
└──────────────────────────────────────────────┘
```

**Layout (mobile — below 768px):** Stacks vertically — order summary on top, payment form below. Submit button stays at the bottom of the payment section.

**Order Summary (left column):**

- Plan name and tier badge (color-coded: blue=Uplink, purple=Pro, amber=Ultimate, green=Lifetime)
- Billing period: "Monthly" or "Annual" (subscriptions) or "One-time payment" (lifetime)
- Price line: `$X.XX/year` or `$X.XX/month` or `$399`
- Per-month breakdown for annual: `($X.XX/mo)`
- Trial callout (conditional, subscriptions only): highlighted box with "7-day free trial — you won't be charged today. Your card will be charged $X.XX on [date]."
- Due today: `$0.00` (trial) or full amount

**Payment Section (right column):**

- Heading: "Payment method"
- `<PaymentElement layout="tabs" />` — Stripe handles card, Apple Pay, Google Pay, Link
- Submit button: "Start free trial" (trial) / "Subscribe" (no trial) / "Pay $399" (lifetime)
- Loading state on button during confirmation
- Error message area below button
- "Powered by Stripe" badge and lock icon

### State Machine

```
idle → loading (fetching intent) → ready (PaymentElement mounted) → submitting → success | error
                                                                              ↓
                                                                          error → ready (retry)
```

- **idle**: Modal just opened, no Stripe elements yet.
- **loading**: Calling backend to create SetupIntent or PaymentIntent. Show skeleton in payment column.
- **ready**: `<Elements>` + `<PaymentElement>` rendered. Submit button enabled.
- **submitting**: `elements.submit()` called, then `confirmSetup`/`confirmPayment`. Button shows spinner, disabled.
- **success**: Confirmation received. For subscriptions, call `POST /checkout/subscribe`. Show brief success state, then call `onSuccess()`.
- **error**: Show error message below submit button. User can retry. PaymentElement stays mounted.

### Integration with `uplink.tsx`

The existing `handleSelectPlan` function changes minimally:

1. Auth check remains identical.
2. Existing subscription check → plan change flow remains identical.
3. Instead of setting `showCheckout = true` and rendering `<CheckoutForm>`, set `checkoutPlan` state with the plan details and render `<CheckoutModal>`.
4. Remove `?session_id=` return detection logic (no longer needed — confirmation is inline).
5. `onSuccess` callback: refetch subscription status, show success banner, close modal.

The same applies to `uplink_.lifetime.tsx` — replace CheckoutForm usage with CheckoutModal.

## Backend API Changes

### New Endpoints

**`POST /checkout/setup-intent`** (authenticated)

Request:
```json
{ "price_id": "price_xxx" }
```

Response:
```json
{
  "client_secret": "seti_xxx_secret_xxx",
  "plan": "pro_annual",
  "has_trial": true,
  "trial_days": 7,
  "amount": 19999,
  "currency": "usd",
  "interval": "year",
  "publishable_key": "pk_live_xxx"
}
```

Logic:
1. Validate `price_id` via `planFromPriceID()` — reject "lifetime" and "unknown".
2. Check for existing active subscription (same logic as current `HandleCreateCheckoutSession`).
3. `getOrCreateStripeCustomer()`.
4. Check `had_prior_sub` to determine trial eligibility.
5. Create `SetupIntent` with `Customer`, `AutomaticPaymentMethods: {Enabled: true}`, metadata: `logto_sub`, `plan`, `price_id`.
6. Look up price details from Stripe to return `amount`, `currency`, `interval`.
7. Return response.

**`POST /checkout/subscribe`** (authenticated)

Request:
```json
{ "setup_intent_id": "seti_xxx", "price_id": "price_xxx" }
```

Response:
```json
{
  "subscription_id": "sub_xxx",
  "status": "trialing",
  "trial_end": 1234567890,
  "plan": "pro_annual"
}
```

Logic:
1. Retrieve the SetupIntent from Stripe. Verify `status == "succeeded"` and metadata `logto_sub` matches the authenticated user.
2. Extract `payment_method` from the confirmed SetupIntent.
3. Attach payment method to customer if not already attached.
4. Set it as the customer's default payment method.
5. Create `Subscription` with:
   - `Customer`, `Items: [{Price: price_id}]`
   - `DefaultPaymentMethod: payment_method`
   - `TrialPeriodDays: 7` if eligible (check `had_prior_sub` flag from `stripe_customers` table — same logic as current checkout)
   - Metadata: `logto_sub`, `plan`
   - If lifetime member + Ultimate plan: apply 50% coupon
6. Upsert `stripe_customers` row with subscription details.
7. Assign Logto role (Ultimate during trial, plan-appropriate otherwise).
8. Return subscription details.

**`POST /checkout/payment-intent`** (authenticated)

Request: (no body)

Response:
```json
{
  "client_secret": "pi_xxx_secret_xxx",
  "amount": 39900,
  "currency": "usd",
  "publishable_key": "pk_live_xxx"
}
```

Logic:
1. Validate eligibility (not already lifetime, no active sub without canceling).
2. `getOrCreateStripeCustomer()`.
3. Look up lifetime price from Stripe to get amount.
4. Create `PaymentIntent` with `Amount`, `Currency: "usd"`, `Customer`, `AutomaticPaymentMethods: {Enabled: true}`, metadata: `logto_sub`, `plan: "lifetime"`.
5. Return response.

### Modified Endpoints

**`GET /checkout/return`** — Keep for backward compatibility but no longer called by the new flow. Can be removed in a follow-up cleanup.

### Webhook Changes

**Add handler for `payment_intent.succeeded`:**
- Check metadata for `plan: "lifetime"` and `logto_sub`.
- Upsert `stripe_customers` with `lifetime: true`, `status: 'active'`, `plan: 'lifetime'`.
- Assign Ultimate Logto role.
- This replaces the lifetime path in `handleCheckoutCompleted`.

**`checkout.session.completed`** — Keep for now (handles any in-flight checkout sessions during migration). Can be removed after a transition period.

**All other webhook handlers remain unchanged.**

### Removed Endpoints (after migration)

- `POST /checkout/session` — replaced by `setup-intent` + `subscribe`.
- `POST /checkout/lifetime` — replaced by `payment-intent`.
- `GET /checkout/return` — no longer needed.

These can be deprecated gracefully: keep them functional during rollout, remove once the old CheckoutForm component is fully removed.

## Error Handling

### Frontend Errors

| Error | Handling |
|-------|----------|
| Intent creation fails (network/server) | Show error in modal with retry button. PaymentElement not rendered. |
| `elements.submit()` validation fails | Stripe shows inline field errors. Submit button re-enabled. |
| `confirmSetup`/`confirmPayment` fails | Show Stripe error message below submit button. User can retry. |
| `POST /checkout/subscribe` fails after setup confirmation | Show error with retry. SetupIntent is already confirmed so re-calling subscribe is safe (idempotent). |
| 3DS authentication required | Stripe handles automatically via `redirect: 'if_required'`. Modal shows loading state during redirect. |

### Backend Errors

| Error | Handling |
|-------|----------|
| Invalid price ID | 400 with `"invalid price"` |
| Already subscribed | 409 with `"active subscription exists"` |
| SetupIntent not succeeded | 400 with `"setup intent not confirmed"` |
| SetupIntent user mismatch | 403 with `"unauthorized"` |
| Stripe API failure | 500 with generic error, log details server-side |

## File Changes Summary

### New Files
- `myscrollr.com/src/components/billing/CheckoutModal.tsx` — New checkout modal component

### Modified Files
- `api/core/billing.go` — Add 3 new handlers, keep old ones temporarily
- `api/core/server.go` — Register new routes
- `api/core/stripe_webhook.go` — Add `payment_intent.succeeded` handler
- `myscrollr.com/src/api/client.ts` — Add `createSetupIntent`, `confirmSubscription`, `createPaymentIntent` methods
- `myscrollr.com/src/routes/uplink.tsx` — Replace CheckoutForm with CheckoutModal, remove session_id return handling
- `myscrollr.com/src/routes/uplink_.lifetime.tsx` — Replace CheckoutForm with CheckoutModal

### Files to Remove (after transition)
- `myscrollr.com/src/components/billing/CheckoutForm.tsx` — Replaced by CheckoutModal

## Testing Plan

1. **Subscription with trial (first-time user):** Verify SetupIntent flow, 7-day trial, $0.00 charge, Ultimate access during trial.
2. **Subscription without trial (returning user):** Verify immediate charge, correct role assignment.
3. **Lifetime purchase:** Verify PaymentIntent flow, one-time charge, lifetime flag set.
4. **Lifetime + Ultimate upgrade with coupon:** Verify 50% discount applied.
5. **3DS-required card:** Verify authentication redirect works.
6. **Declined card:** Verify error displayed, retry works.
7. **Mobile layout:** Verify stacked layout below 768px.
8. **Plan change flow:** Verify existing upgrade/downgrade flows still work (unchanged).
9. **Cancel flow:** Verify unchanged.
10. **Webhook idempotency:** Verify duplicate events handled correctly.
