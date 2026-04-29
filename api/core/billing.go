package core

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/stripe/stripe-go/v82"
	billingportalsession "github.com/stripe/stripe-go/v82/billingportal/session"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
	stripecustomer "github.com/stripe/stripe-go/v82/customer"
	stripeinvoice "github.com/stripe/stripe-go/v82/invoice"
	stripepaymentintent "github.com/stripe/stripe-go/v82/paymentintent"
	stripepaymentmethod "github.com/stripe/stripe-go/v82/paymentmethod"
	stripeprice "github.com/stripe/stripe-go/v82/price"
	stripesetupintent "github.com/stripe/stripe-go/v82/setupintent"
	stripesubscription "github.com/stripe/stripe-go/v82/subscription"
	subscriptionschedule "github.com/stripe/stripe-go/v82/subscriptionschedule"
)

// =============================================================================
// Stripe Billing Handlers
// =============================================================================

// initStripe sets the Stripe API key and optionally redirects the SDK to a
// mock server when STRIPE_API_URL is set (e.g. for local testing with
// stripe-mock).  In production STRIPE_API_URL is unset and the SDK uses
// its default https://api.stripe.com endpoint.
func initStripe() {
	key := os.Getenv("STRIPE_SECRET_KEY")
	if key == "" {
		// STRIPE_DISABLED is the escape hatch for local dev or staging
		// environments that intentionally run without billing. Production
		// must always have a key set; silently continuing used to leave
		// the /users/me/subscription/* routes 500ing forever.
		if os.Getenv("STRIPE_DISABLED") == "true" {
			log.Println("[Billing] STRIPE_SECRET_KEY not set and STRIPE_DISABLED=true — billing endpoints will return errors")
			return
		}
		log.Fatal("[Billing] STRIPE_SECRET_KEY is required (set STRIPE_DISABLED=true to run without billing)")
	}
	stripe.Key = key

	// Allow redirecting all Stripe SDK calls to a mock server for testing.
	if mockURL := os.Getenv("STRIPE_API_URL"); mockURL != "" {
		stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(
			stripe.APIBackend,
			&stripe.BackendConfig{URL: stripe.String(mockURL)},
		))
		log.Printf("[Billing] Stripe API redirected to mock: %s", mockURL)
	}

	log.Println("[Billing] Stripe API initialized")
}

// planFromPriceID maps a Stripe price ID to a human-readable plan name.
// Handles Uplink, Uplink Pro, and Uplink Ultimate tiers.
func planFromPriceID(priceID string) string {
	priceMap := map[string]string{
		// Uplink (base paid tier)
		os.Getenv("STRIPE_PRICE_MONTHLY"):  "monthly",
		os.Getenv("STRIPE_PRICE_ANNUAL"):   "annual",
		os.Getenv("STRIPE_PRICE_LIFETIME"): "lifetime",
		// Uplink Pro (mid-tier)
		os.Getenv("STRIPE_PRICE_PRO_MONTHLY"): "pro_monthly",
		os.Getenv("STRIPE_PRICE_PRO_ANNUAL"):  "pro_annual",
		// Uplink Ultimate (top-tier)
		os.Getenv("STRIPE_PRICE_ULTIMATE_MONTHLY"): "ultimate_monthly",
		os.Getenv("STRIPE_PRICE_ULTIMATE_ANNUAL"):  "ultimate_annual",
	}

	// Remove empty-key entry (unset env vars map to "")
	delete(priceMap, "")

	if plan, ok := priceMap[priceID]; ok {
		return plan
	}
	return "unknown"
}

// isProPlan returns true if the plan name corresponds to the Uplink Pro tier.
func isProPlan(plan string) bool {
	switch plan {
	case "pro_monthly", "pro_annual":
		return true
	}
	return false
}

// isUltimatePlan returns true if the plan name corresponds to the top-tier (Uplink Ultimate).
func isUltimatePlan(plan string) bool {
	switch plan {
	case "ultimate_monthly", "ultimate_annual":
		return true
	}
	return false
}

// planRank returns a numeric rank for comparing plan tiers.
// Higher rank = higher tier. Used to determine upgrade vs downgrade.
func planRank(plan string) int {
	switch {
	case isUltimatePlan(plan):
		return 3
	case isProPlan(plan):
		return 2
	default:
		return 1 // uplink (monthly, annual, lifetime)
	}
}

// getOrCreateStripeCustomer looks up or creates a Stripe customer for the user.
// If a cached customer ID is stale (e.g. Stripe mode switch, deleted customer),
// it deletes the stale record and creates a fresh customer.
func getOrCreateStripeCustomer(logtoSub, email string) (string, error) {
	// Check DB first
	var customerID string
	err := DBPool.QueryRow(context.Background(),
		`SELECT stripe_customer_id FROM stripe_customers WHERE logto_sub = $1`, logtoSub,
	).Scan(&customerID)
	if err == nil && customerID != "" {
		// Verify the cached customer still exists in Stripe and isn't deleted
		c, stripeErr := stripecustomer.Get(customerID, nil)
		if stripeErr == nil && !c.Deleted {
			// Backfill email if the Stripe customer was created without one
			if c.Email == "" && email != "" {
				stripecustomer.Update(customerID, &stripe.CustomerParams{
					Email: stripe.String(email),
				})
			}
			return customerID, nil
		}
		// Stale, deleted, or invalid customer — purge and recreate
		log.Printf("[Billing] Stale Stripe customer %s for %s (deleted=%v), recreating", customerID, logtoSub, c != nil && c.Deleted)
		_, _ = DBPool.Exec(context.Background(),
			`DELETE FROM stripe_customers WHERE logto_sub = $1`, logtoSub)
	}

	// Create Stripe customer
	params := &stripe.CustomerParams{
		Email: stripe.String(email),
	}
	params.AddMetadata("logto_sub", logtoSub)
	c, err := stripecustomer.New(params)
	if err != nil {
		return "", err
	}

	// Insert into DB
	_, err = DBPool.Exec(context.Background(),
		`INSERT INTO stripe_customers (logto_sub, stripe_customer_id)
		 VALUES ($1, $2)
		 ON CONFLICT (logto_sub) DO UPDATE SET stripe_customer_id = $2, updated_at = now()`,
		logtoSub, c.ID,
	)
	if err != nil {
		log.Printf("[Billing] DB insert for customer %s failed: %v", logtoSub, err)
	}

	return c.ID, nil
}

// getFrontendURL determines the frontend origin for Stripe return URLs.
// Prefers the request's Origin header so redirects always match the caller.
func getFrontendURL(c *fiber.Ctx) string {
	if origin := c.Get("Origin"); origin != "" {
		// Desktop app sends "tauri://localhost" which isn't a valid browser URL.
		// Only use the Origin if it's an HTTP(S) URL.
		if strings.HasPrefix(origin, "http://") || strings.HasPrefix(origin, "https://") {
			return strings.TrimSuffix(origin, "/")
		}
	}
	if url := os.Getenv("FRONTEND_URL"); url != "" {
		return url
	}
	return DefaultFrontendURL
}

// HandleCreateCheckoutSession creates a Stripe Checkout Session (embedded UI mode)
// for recurring subscriptions (monthly, quarterly, annual).
func HandleCreateCheckoutSession(c *fiber.Ctx) error {
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

	// Validate the price is one of our known recurring prices
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
		// Lifetime members can add an Ultimate or Pro subscription on top
		// (Ultimate gets 50% off coupon applied below)
		if isLifetime && (isUltimatePlan(plan) || isProPlan(plan)) {
			// Allow through
		} else {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error", Error: "You already have an active subscription",
			})
		}
	}

	// Get email from JWT claims (may be empty)
	email, _ := c.Locals("user_email").(string)

	customerID, err := getOrCreateStripeCustomer(userID, email)
	if err != nil {
		log.Printf("[Billing] Failed to create Stripe customer for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to initialize billing",
		})
	}

	frontendURL := getFrontendURL(c)

	// Only offer a 7-day trial to first-time subscribers.
	// Users who have had any prior paid plan (active, canceled, or past_due) skip the trial.
	var hadPriorSub bool
	_ = DBPool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM stripe_customers WHERE logto_sub = $1 AND plan != 'free')`,
		userID,
	).Scan(&hadPriorSub)

	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		UIMode:   stripe.String(string(stripe.CheckoutSessionUIModeEmbedded)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(req.PriceID),
				Quantity: stripe.Int64(1),
			},
		},
		ReturnURL: stripe.String(frontendURL + "/uplink?session_id={CHECKOUT_SESSION_ID}"),
	}
	if !hadPriorSub {
		params.SubscriptionData = &stripe.CheckoutSessionSubscriptionDataParams{
			TrialPeriodDays: stripe.Int64(7),
		}
	}
	params.AddMetadata("logto_sub", userID)
	params.AddMetadata("plan", plan)

	// Lifetime members get 50% off Ultimate subscriptions
	if isLifetime && isUltimatePlan(plan) {
		couponID := os.Getenv("STRIPE_LIFETIME_ULTIMATE_COUPON_ID")
		if couponID != "" {
			params.Discounts = []*stripe.CheckoutSessionDiscountParams{
				{Coupon: stripe.String(couponID)},
			}
			log.Printf("[Billing] Applied lifetime 50%% discount coupon for %s", userID)
		}
	}

	session, err := checkoutsession.New(params)
	if err != nil {
		log.Printf("[Billing] Failed to create checkout session for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to create checkout session",
		})
	}

	return c.JSON(CheckoutResponse{
		ClientSecret:   session.ClientSecret,
		SessionID:      session.ID,
		PublishableKey: os.Getenv("STRIPE_PUBLISHABLE_KEY"),
	})
}

// HandleCreateLifetimeCheckout creates a one-time payment Checkout Session for lifetime.
func HandleCreateLifetimeCheckout(c *fiber.Ctx) error {
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

	// Check if user already has active subscription or lifetime
	var existingPlan string
	var existingStatus string
	var isLifetime bool
	err := DBPool.QueryRow(context.Background(),
		`SELECT plan, status, lifetime FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&existingPlan, &existingStatus, &isLifetime)
	if err == nil {
		if isLifetime {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error", Error: "You already have a lifetime membership",
			})
		}
		if existingPlan != "free" && existingStatus == "active" {
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

	frontendURL := getFrontendURL(c)

	params := &stripe.CheckoutSessionParams{
		Customer: stripe.String(customerID),
		Mode:     stripe.String(string(stripe.CheckoutSessionModePayment)),
		UIMode:   stripe.String(string(stripe.CheckoutSessionUIModeEmbedded)),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{
				Price:    stripe.String(lifetimePrice),
				Quantity: stripe.Int64(1),
			},
		},
		ReturnURL: stripe.String(frontendURL + "/uplink/lifetime?session_id={CHECKOUT_SESSION_ID}"),
	}
	params.AddMetadata("logto_sub", userID)
	params.AddMetadata("plan", "lifetime")

	session, err := checkoutsession.New(params)
	if err != nil {
		log.Printf("[Billing] Failed to create lifetime checkout for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to create checkout session",
		})
	}

	return c.JSON(CheckoutResponse{
		ClientSecret:   session.ClientSecret,
		SessionID:      session.ID,
		PublishableKey: os.Getenv("STRIPE_PUBLISHABLE_KEY"),
	})
}

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

	// Re-check for active subscription (guards against concurrent tab race condition)
	var existingPlan string
	var existingStatus string
	var existingLifetime bool
	err := DBPool.QueryRow(context.Background(),
		`SELECT plan, status, lifetime FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&existingPlan, &existingStatus, &existingLifetime)

	if err == nil && existingPlan != "free" && (existingStatus == "active" || existingStatus == "trialing") {
		if existingLifetime && (isUltimatePlan(plan) || isProPlan(plan)) {
			// Allow lifetime members to add Ultimate or Pro
		} else {
			return c.Status(fiber.StatusConflict).JSON(ErrorResponse{
				Status: "error", Error: "You already have an active subscription",
			})
		}
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
			subParams.Discounts = []*stripe.SubscriptionDiscountParams{
				{Coupon: stripe.String(couponID)},
			}
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

	InvalidateOverviewCache(c.Context(), userID)

	return c.JSON(SubscribeResponse{
		SubscriptionID: sub.ID,
		Status:         subStatus,
		TrialEnd:       trialEnd,
		Plan:           plan,
	})
}

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

// HandleCheckoutReturn returns the status of a checkout session.
// Frontend calls this after redirect to confirm the outcome.
func HandleCheckoutReturn(c *fiber.Ctx) error {
	sessionID := c.Query("session_id")
	if sessionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "session_id is required",
		})
	}

	session, err := checkoutsession.Get(sessionID, nil)
	if err != nil {
		log.Printf("[Billing] Failed to retrieve session %s: %v", sessionID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to retrieve checkout session",
		})
	}

	return c.JSON(CheckoutReturnResponse{
		Status:    string(session.Status),
		SessionID: session.ID,
	})
}

// HandleGetSubscription returns the current user's subscription status.
func HandleGetSubscription(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	var sc StripeCustomer
	err := DBPool.QueryRow(context.Background(),
		`SELECT logto_sub, stripe_customer_id, stripe_subscription_id, plan, status,
		        current_period_end, lifetime, created_at, updated_at
		 FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&sc.LogtoSub, &sc.StripeCustomerID, &sc.StripeSubscriptionID,
		&sc.Plan, &sc.Status, &sc.CurrentPeriodEnd, &sc.Lifetime,
		&sc.CreatedAt, &sc.UpdatedAt)

	if err != nil {
		// No billing record — user is on free plan
		return c.JSON(SubscriptionResponse{
			Plan:   "free",
			Status: "none",
		})
	}

	// Check if user has ever had a paid subscription (for trial eligibility display)
	var hadPriorSub bool
	_ = DBPool.QueryRow(context.Background(),
		`SELECT EXISTS(SELECT 1 FROM stripe_customers WHERE logto_sub = $1 AND plan != 'free')`,
		userID,
	).Scan(&hadPriorSub)

	resp := SubscriptionResponse{
		Plan:             sc.Plan,
		Status:           sc.Status,
		CurrentPeriodEnd: sc.CurrentPeriodEnd,
		Lifetime:         sc.Lifetime,
		HadPriorSub:      hadPriorSub,
	}

	// Fetch live subscription data from Stripe for billing details + schedule
	if sc.StripeSubscriptionID != nil && *sc.StripeSubscriptionID != "" {
		sub, err := stripesubscription.Get(*sc.StripeSubscriptionID, nil)
		if err != nil {
			// Subscription no longer exists in Stripe (deleted from Dashboard, etc.)
			// Self-heal: reset the DB record so stale data isn't served.
			log.Printf("[Billing] Stripe subscription %s not found, resetting record for %s: %v",
				*sc.StripeSubscriptionID, userID, err)
			_, _ = DBPool.Exec(context.Background(),
				`UPDATE stripe_customers
				 SET plan = 'free', status = 'none', stripe_subscription_id = NULL,
				     current_period_end = NULL, updated_at = now()
				 WHERE logto_sub = $1`, userID)
			return c.JSON(SubscriptionResponse{Plan: "free", Status: "none"})
		}

		// Extract billing details from the subscription's current price
		if len(sub.Items.Data) > 0 {
			price := sub.Items.Data[0].Price
			resp.Amount = price.UnitAmount
			resp.Currency = string(price.Currency)
			if price.Recurring != nil {
				resp.Interval = string(price.Recurring.Interval)
			}
		}

		// Extract trial end timestamp
		if sub.TrialEnd > 0 {
			trialEnd := sub.TrialEnd
			resp.TrialEnd = &trialEnd
		}

		// Check for pending downgrade via subscription schedule
		if sub.Schedule != nil && sub.Schedule.ID != "" {
			sched, err := subscriptionschedule.Get(sub.Schedule.ID, nil)
			if err == nil && len(sched.Phases) > 1 {
				// Phase 0 = current, Phase 1 = scheduled change
				nextPhase := sched.Phases[1]
				if len(nextPhase.Items) > 0 {
					nextPlan := planFromPriceID(nextPhase.Items[0].Price.ID)
					if nextPlan != "unknown" && planRank(nextPlan) < planRank(sc.Plan) {
						resp.PendingDowngradePlan = nextPlan
						changeAt := time.Unix(nextPhase.StartDate, 0)
						resp.ScheduledChangeAt = &changeAt
					}
				}
			}
		}
	}

	return c.JSON(resp)
}

// HandleCancelSubscription cancels the user's Stripe subscription.
// Trials are canceled immediately (no charge occurred). Paid subscriptions
// are scheduled to cancel at the end of the current billing period.
func HandleCancelSubscription(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	var subID *string
	var isLifetime bool
	err := DBPool.QueryRow(context.Background(),
		`SELECT stripe_subscription_id, lifetime FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&subID, &isLifetime)
	if err != nil || subID == nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "No active subscription found",
		})
	}

	if isLifetime {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Lifetime memberships cannot be cancelled",
		})
	}

	// Fetch the subscription to check if it's trialing
	sub, err := stripesubscription.Get(*subID, nil)
	if err != nil {
		log.Printf("[Billing] Failed to fetch subscription %s for %s: %v", *subID, userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to cancel subscription",
		})
	}

	// Trialing: cancel immediately (no payment has been collected)
	if sub.Status == stripe.SubscriptionStatusTrialing {
		_, err := stripesubscription.Cancel(*subID, nil)
		if err != nil {
			log.Printf("[Billing] Failed to cancel trial %s for %s: %v", *subID, userID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error", Error: "Failed to cancel trial",
			})
		}

		// Reset DB to free/canceled
		_, _ = DBPool.Exec(context.Background(),
			`UPDATE stripe_customers SET plan = 'free', status = 'canceled',
			        stripe_subscription_id = NULL, current_period_end = NULL, updated_at = now()
			 WHERE logto_sub = $1`, userID,
		)

		// Remove all Logto roles
		_ = RemoveUplinkRole(userID)
		_ = RemoveProRole(userID)
		_ = RemoveUltimateRole(userID)

		log.Printf("[Billing] Trial canceled immediately for %s", userID)
		InvalidateOverviewCache(c.Context(), userID)
		return c.JSON(fiber.Map{
			"status":  "canceled",
			"message": "Your trial has been ended",
		})
	}

	// Paid subscription: cancel at period end (user keeps access until then)
	params := &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(true),
	}
	sub, err = stripesubscription.Update(*subID, params)
	if err != nil {
		log.Printf("[Billing] Failed to cancel subscription %s for %s: %v", *subID, userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to cancel subscription",
		})
	}

	// Update local DB — in stripe-go v82, CurrentPeriodEnd moved to SubscriptionItem
	var periodEndUnix int64
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		periodEndUnix = sub.Items.Data[0].CurrentPeriodEnd
	}
	periodEnd := time.Unix(periodEndUnix, 0)
	_, _ = DBPool.Exec(context.Background(),
		`UPDATE stripe_customers SET status = 'canceling', current_period_end = $2, updated_at = now()
		 WHERE logto_sub = $1`,
		userID, periodEnd,
	)

	InvalidateOverviewCache(c.Context(), userID)

	return c.JSON(fiber.Map{
		"status":             "canceling",
		"current_period_end": periodEnd,
		"message":            "Your subscription will end at the current billing period",
	})
}

// HandleChangePlan upgrades or downgrades the user's existing subscription.
// Uses Stripe proration to charge or credit the difference immediately.
func HandleChangePlan(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	var req PlanChangeRequest
	if err := c.BodyParser(&req); err != nil || req.PriceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "price_id is required",
		})
	}

	// Validate the price is a known recurring plan
	newPlan := planFromPriceID(req.PriceID)
	if newPlan == "unknown" || newPlan == "lifetime" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Invalid price_id for plan change",
		})
	}

	// Get the current subscription from DB
	var subID *string
	var currentPlan string
	var isLifetime bool
	err := DBPool.QueryRow(context.Background(),
		`SELECT stripe_subscription_id, plan, lifetime FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&subID, &currentPlan, &isLifetime)
	if err != nil || subID == nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "No active subscription found",
		})
	}

	if isLifetime {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Lifetime memberships cannot change plan — subscribe to a new tier instead",
		})
	}

	if currentPlan == newPlan {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "You are already on this plan",
		})
	}

	// Get the current subscription from Stripe to find the item ID
	sub, err := stripesubscription.Get(*subID, nil)
	if err != nil {
		log.Printf("[Billing] Failed to retrieve subscription %s for %s: %v", *subID, userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to retrieve subscription",
		})
	}

	if sub.Items == nil || len(sub.Items.Data) == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Subscription has no items",
		})
	}

	itemID := sub.Items.Data[0].ID
	currentPriceID := sub.Items.Data[0].Price.ID
	var periodEndUnix int64
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		periodEndUnix = sub.Items.Data[0].CurrentPeriodEnd
	}
	periodEnd := time.Unix(periodEndUnix, 0)

	// ── TRIAL: simple price swap, no proration or scheduling ─────
	if sub.Status == stripe.SubscriptionStatusTrialing {
		updateParams := &stripe.SubscriptionParams{
			ProrationBehavior: stripe.String("none"),
			Items: []*stripe.SubscriptionItemsParams{
				{
					ID:    stripe.String(itemID),
					Price: stripe.String(req.PriceID),
				},
			},
		}

		_, err := stripesubscription.Update(*subID, updateParams)
		if err != nil {
			log.Printf("[Billing] Failed to switch trial plan for %s: %v", userID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error", Error: "Failed to switch plan",
			})
		}

		// Update DB plan (status stays trialing)
		_, _ = DBPool.Exec(context.Background(),
			`UPDATE stripe_customers SET plan = $2, updated_at = now() WHERE logto_sub = $1`,
			userID, newPlan,
		)

		trialEnd := time.Unix(sub.TrialEnd, 0)
		log.Printf("[Billing] Trial plan switched for %s: %s → %s (billing starts %s)", userID, currentPlan, newPlan, trialEnd.Format(time.RFC3339))

		InvalidateOverviewCache(c.Context(), userID)

		return c.JSON(SubscriptionResponse{
			Plan:             newPlan,
			Status:           "trialing",
			CurrentPeriodEnd: &trialEnd,
			Lifetime:         false,
		})
	}

	isUpgrade := planRank(newPlan) > planRank(currentPlan)

	if isUpgrade {
		// ── UPGRADE: immediate charge via always_invoice ───────────
		updateParams := &stripe.SubscriptionParams{
			ProrationBehavior: stripe.String("always_invoice"),
			Items: []*stripe.SubscriptionItemsParams{
				{
					ID:    stripe.String(itemID),
					Price: stripe.String(req.PriceID),
				},
			},
		}

		// Use the proration date from preview so the charge matches exactly
		if req.ProrationDate > 0 {
			updateParams.ProrationDate = stripe.Int64(req.ProrationDate)
		}

		// If the subscription was set to cancel at period end, undo that
		if sub.CancelAtPeriodEnd {
			updateParams.CancelAtPeriodEnd = stripe.Bool(false)
		}

		updatedSub, err := stripesubscription.Update(*subID, updateParams)
		if err != nil {
			log.Printf("[Billing] Failed to upgrade plan for %s from %s to %s: %v", userID, currentPlan, newPlan, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error", Error: "Failed to upgrade plan",
			})
		}

		// Update DB optimistically (webhook will also fire and sync)
		var newPeriodEnd int64
		if updatedSub.Items != nil && len(updatedSub.Items.Data) > 0 {
			newPeriodEnd = updatedSub.Items.Data[0].CurrentPeriodEnd
		}
		pe := time.Unix(newPeriodEnd, 0)

		_, _ = DBPool.Exec(context.Background(),
			`UPDATE stripe_customers SET plan = $2, status = 'active', current_period_end = $3, updated_at = now()
			 WHERE logto_sub = $1`,
			userID, newPlan, pe,
		)

		log.Printf("[Billing] Plan upgraded for %s: %s → %s", userID, currentPlan, newPlan)

		InvalidateOverviewCache(c.Context(), userID)

		return c.JSON(SubscriptionResponse{
			Plan:             newPlan,
			Status:           "active",
			CurrentPeriodEnd: &pe,
			Lifetime:         false,
		})
	}

	// ── DOWNGRADE: schedule change at end of billing cycle ────────
	// Create (or reuse existing) subscription schedule, then set two phases:
	// current price until period end, then new (lower) price after.
	var scheduleID string
	var phase1StartDate int64

	if sub.Schedule != nil && sub.Schedule.ID != "" {
		// Schedule already attached — fetch it to get the current phase's start date
		scheduleID = sub.Schedule.ID
		log.Printf("[Billing] Reusing existing schedule %s for %s", scheduleID, userID)

		existing, err := subscriptionschedule.Get(scheduleID, nil)
		if err != nil {
			log.Printf("[Billing] Failed to fetch schedule %s: %v", scheduleID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error", Error: "Failed to fetch existing schedule",
			})
		}
		if len(existing.Phases) > 0 {
			phase1StartDate = existing.Phases[0].StartDate
		}
	} else {
		schedule, err := subscriptionschedule.New(&stripe.SubscriptionScheduleParams{
			FromSubscription: stripe.String(*subID),
		})
		if err != nil {
			log.Printf("[Billing] Failed to create schedule for %s: %v", userID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
				Status: "error", Error: "Failed to schedule downgrade",
			})
		}
		scheduleID = schedule.ID
		if len(schedule.Phases) > 0 {
			phase1StartDate = schedule.Phases[0].StartDate
		}
	}

	_, err = subscriptionschedule.Update(scheduleID, &stripe.SubscriptionScheduleParams{
		EndBehavior: stripe.String("release"),
		Phases: []*stripe.SubscriptionSchedulePhaseParams{
			{
				Items: []*stripe.SubscriptionSchedulePhaseItemParams{
					{Price: stripe.String(currentPriceID)},
				},
				StartDate: stripe.Int64(phase1StartDate),
				EndDate:   stripe.Int64(periodEndUnix),
			},
			{
				Items: []*stripe.SubscriptionSchedulePhaseItemParams{
					{Price: stripe.String(req.PriceID)},
				},
			},
		},
	})
	if err != nil {
		log.Printf("[Billing] Failed to update schedule for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to schedule downgrade",
		})
	}

	log.Printf("[Billing] Downgrade scheduled for %s: %s → %s at %s", userID, currentPlan, newPlan, periodEnd.Format(time.RFC3339))

	InvalidateOverviewCache(c.Context(), userID)

	// Return current plan (unchanged until period end) with pending downgrade info
	return c.JSON(SubscriptionResponse{
		Plan:                 currentPlan,
		Status:               "active",
		CurrentPeriodEnd:     &periodEnd,
		Lifetime:             false,
		PendingDowngradePlan: newPlan,
		ScheduledChangeAt:    &periodEnd,
	})
}

// HandlePreviewPlanChange previews the proration cost of changing plans.
// Returns the exact amount that would be charged or credited today.
func HandlePreviewPlanChange(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	priceID := c.Query("price_id")
	if priceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "price_id query parameter is required",
		})
	}

	// Validate the price
	newPlan := planFromPriceID(priceID)
	if newPlan == "unknown" || newPlan == "lifetime" {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "Invalid price_id for plan change",
		})
	}

	// Get the current subscription from DB
	var subID *string
	var customerID string
	var currentPlan string
	err := DBPool.QueryRow(context.Background(),
		`SELECT stripe_subscription_id, stripe_customer_id, plan FROM stripe_customers WHERE logto_sub = $1`, userID,
	).Scan(&subID, &customerID, &currentPlan)
	if err != nil || subID == nil {
		return c.Status(fiber.StatusBadRequest).JSON(ErrorResponse{
			Status: "error", Error: "No active subscription found",
		})
	}

	// Get the current subscription item ID
	sub, err := stripesubscription.Get(*subID, nil)
	if err != nil {
		log.Printf("[Billing] Failed to retrieve subscription %s for preview: %v", *subID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to retrieve subscription",
		})
	}

	if sub.Items == nil || len(sub.Items.Data) == 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Subscription has no items",
		})
	}

	// Trial: no charge, just a price swap — return immediately
	if sub.Status == stripe.SubscriptionStatusTrialing {
		return c.JSON(PlanPreviewResponse{
			AmountDue:     0,
			Currency:      "usd",
			IsTrialChange: true,
			TrialEnd:      sub.TrialEnd,
		})
	}

	// Check if this is a downgrade
	isDowngrade := planRank(newPlan) < planRank(currentPlan)

	if isDowngrade {
		// Downgrade: no charge, just return the scheduled date (current period end)
		var periodEndUnix int64
		if sub.Items != nil && len(sub.Items.Data) > 0 {
			periodEndUnix = sub.Items.Data[0].CurrentPeriodEnd
		}

		return c.JSON(PlanPreviewResponse{
			AmountDue:     0,
			Currency:      "usd",
			ProrationDate: 0,
			IsDowngrade:   true,
			ScheduledDate: periodEndUnix,
		})
	}

	// Upgrade: get exact proration amount from Stripe
	itemID := sub.Items.Data[0].ID
	prorationDate := time.Now().Unix()

	previewParams := &stripe.InvoiceCreatePreviewParams{
		Customer:     stripe.String(customerID),
		Subscription: stripe.String(*subID),
		SubscriptionDetails: &stripe.InvoiceCreatePreviewSubscriptionDetailsParams{
			Items: []*stripe.InvoiceCreatePreviewSubscriptionDetailsItemParams{
				{
					ID:    stripe.String(itemID),
					Price: stripe.String(priceID),
				},
			},
			ProrationBehavior: stripe.String("always_invoice"),
			ProrationDate:     stripe.Int64(prorationDate),
		},
	}

	inv, err := stripeinvoice.CreatePreview(previewParams)
	if err != nil {
		log.Printf("[Billing] Failed to preview plan change for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to preview plan change",
		})
	}

	return c.JSON(PlanPreviewResponse{
		AmountDue:     inv.AmountDue,
		Currency:      string(inv.Currency),
		ProrationDate: prorationDate,
		IsDowngrade:   false,
	})
}

// =============================================================================
// Stripe Customer Portal
// =============================================================================

// HandleCreatePortalSession creates a Stripe Customer Portal session so users
// can manage payment methods, view invoices, and update billing details.
func HandleCreatePortalSession(c *fiber.Ctx) error {
	userID := GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(ErrorResponse{
			Status: "unauthorized", Error: "Authentication required",
		})
	}

	var customerID string
	err := DBPool.QueryRow(context.Background(),
		`SELECT stripe_customer_id FROM stripe_customers WHERE logto_sub = $1`,
		userID,
	).Scan(&customerID)
	if err != nil {
		log.Printf("[Billing] No Stripe customer found for %s: %v", userID, err)
		return c.Status(fiber.StatusNotFound).JSON(ErrorResponse{
			Status: "error", Error: "No billing account found",
		})
	}

	frontendURL := getFrontendURL(c)

	params := &stripe.BillingPortalSessionParams{
		Customer:  stripe.String(customerID),
		ReturnURL: stripe.String(frontendURL + "/account"),
	}

	session, err := billingportalsession.New(params)
	if err != nil {
		log.Printf("[Billing] Failed to create portal session for %s: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{
			Status: "error", Error: "Failed to create billing portal session",
		})
	}

	return c.JSON(fiber.Map{"url": session.URL})
}
