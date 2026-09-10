package accounts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
)

var (
	analyticsPageSize = 100
	analyticsMaxPages = 20
)

type SignupStageMetrics struct {
	Events int `json:"events"`
	Errors int `json:"errors"`
}

type SignupErrorReason struct {
	Reason string `json:"reason"`
	Count  int    `json:"count"`
}

type SignupCoverage struct {
	Status        string `json:"status"`
	RequestedFrom string `json:"requested_from"`
	ObservedFrom  string `json:"observed_from,omitempty"`
	ObservedTo    string `json:"observed_to,omitempty"`
	Pages         int    `json:"pages"`
	UniqueLogs    int    `json:"unique_logs"`
	Retention     string `json:"retention"`
	Note          string `json:"note"`
}

type SignupAttemptConversion struct {
	Available bool   `json:"available"`
	Note      string `json:"note"`
}

type SignupAnalytics struct {
	Application       string                        `json:"application"`
	WindowDays        int                           `json:"window_days"`
	GeneratedAt       string                        `json:"generated_at"`
	Measurement       string                        `json:"measurement"`
	Stages            map[string]SignupStageMetrics `json:"stages"`
	ErrorReasons      []SignupErrorReason           `json:"error_reasons"`
	Coverage          SignupCoverage                `json:"coverage"`
	AttemptConversion SignupAttemptConversion       `json:"attempt_conversion"`
}

type logtoAnalyticsLog struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	CreatedAt int64  `json:"createdAt"`
	Payload   struct {
		Result string          `json:"result"`
		Error  json.RawMessage `json:"error"`
	} `json:"payload"`
}

var signupStageKeys = map[string]string{
	"Interaction.Register.Create":                                    "started",
	"Interaction.Register.Identifier.Submit":                         "identifier_submitted",
	"Interaction.Register.Verification.EmailVerificationCode.Create": "email_code_sent",
	"Interaction.Register.Verification.EmailVerificationCode.Submit": "email_code_verified",
	"Interaction.Register.Verification.PhoneVerificationCode.Create": "phone_code_sent",
	"Interaction.Register.Verification.PhoneVerificationCode.Submit": "phone_code_verified",
	"Interaction.Register.Verification.Password.Submit":              "password_verified",
	"Interaction.Register.Verification.NewPasswordIdentity.Submit":   "password_created",
	"Interaction.Register.Verification.Social.Create":                "social_started",
	"Interaction.Register.Verification.Social.Submit":                "social_verified",
	"Interaction.Register.Verification.WebAuthn.Create":              "passkey_started",
	"Interaction.Register.Verification.WebAuthn.Submit":              "passkey_verified",
	"Interaction.Register.Profile.Update":                            "profile_updated",
	"Interaction.Register.Submit":                                    "submitted",
}

func FetchSignupAnalytics(ctx context.Context, application string, days int, now time.Time) (SignupAnalytics, error) {
	report := SignupAnalytics{
		Application:  application,
		WindowDays:   days,
		GeneratedAt:  now.UTC().Format(time.RFC3339),
		Measurement:  "events",
		Stages:       make(map[string]SignupStageMetrics),
		ErrorReasons: make([]SignupErrorReason, 0),
		Coverage: SignupCoverage{
			Status:        "unknown",
			RequestedFrom: now.AddDate(0, 0, -days).UTC().Format(time.RFC3339),
			Retention:     "unknown",
			Note:          "All returned pages were scanned, but this deployment does not publish stable ordering or audit retention.",
		},
		AttemptConversion: SignupAttemptConversion{
			Note: "Unavailable: Logto does not document a registration-attempt correlation contract for these events.",
		},
	}

	appID, err := signupAnalyticsAppID(application)
	if err != nil {
		return report, err
	}
	cutoff := now.AddDate(0, 0, -days).UnixMilli()
	seen := make(map[string]struct{})
	reasons := make(map[string]int)
	var observedFrom, observedTo int64
	malformed := false
	exhausted := false
	partialNotes := make([]string, 0, 2)

	for page := 1; page <= analyticsMaxPages; page++ {
		logs, err := fetchSignupAnalyticsPage(ctx, appID, page)
		if err != nil {
			if page == 1 {
				return report, err
			}
			report.Coverage.Status = "partial"
			partialNotes = append(partialNotes, "Logto became unavailable before the bounded scan finished.")
			break
		}
		report.Coverage.Pages = page
		if len(logs) < analyticsPageSize {
			exhausted = true
		}
		for _, entry := range logs {
			if entry.ID == "" || entry.CreatedAt <= 0 {
				malformed = true
				continue
			}
			if _, ok := seen[entry.ID]; ok {
				continue
			}
			seen[entry.ID] = struct{}{}
			if observedFrom == 0 || entry.CreatedAt < observedFrom {
				observedFrom = entry.CreatedAt
			}
			if entry.CreatedAt > observedTo {
				observedTo = entry.CreatedAt
			}
			if entry.CreatedAt < cutoff || entry.CreatedAt > now.UnixMilli() {
				continue
			}
			stage, ok := signupStageKeys[entry.Key]
			if !ok {
				continue
			}
			metrics := report.Stages[stage]
			metrics.Events++
			if entry.Payload.Result == "Error" {
				metrics.Errors++
				reasons[safeSignupErrorReason(entry.Payload.Error)]++
			}
			report.Stages[stage] = metrics
		}
		if exhausted {
			break
		}
	}

	report.Coverage.UniqueLogs = len(seen)
	if observedFrom > 0 {
		report.Coverage.ObservedFrom = time.UnixMilli(observedFrom).UTC().Format(time.RFC3339)
		report.Coverage.ObservedTo = time.UnixMilli(observedTo).UTC().Format(time.RFC3339)
	}
	if !exhausted && report.Coverage.Status == "unknown" {
		report.Coverage.Status = "partial"
		partialNotes = append(partialNotes, "The bounded Logto scan reached its page limit.")
	}
	if malformed {
		report.Coverage.Status = "partial"
		partialNotes = append(partialNotes, "Malformed Logto rows without stable IDs or timestamps were excluded.")
	}
	if len(partialNotes) > 0 {
		report.Coverage.Note = "Partial: " + strings.Join(partialNotes, " ")
	}
	for reason, count := range reasons {
		report.ErrorReasons = append(report.ErrorReasons, SignupErrorReason{Reason: reason, Count: count})
	}
	sort.Slice(report.ErrorReasons, func(i, j int) bool {
		if report.ErrorReasons[i].Count != report.ErrorReasons[j].Count {
			return report.ErrorReasons[i].Count > report.ErrorReasons[j].Count
		}
		return report.ErrorReasons[i].Reason < report.ErrorReasons[j].Reason
	})
	return report, nil
}

func signupAnalyticsAppID(application string) (string, error) {
	var id string
	switch application {
	case "website":
		id = os.Getenv("LOGTO_WEB_APP_ID")
	case "desktop":
		id = os.Getenv("LOGTO_EXTENSION_APP_ID")
	default:
		return "", fmt.Errorf("unsupported analytics application")
	}
	if id == "" {
		return "", fmt.Errorf("analytics application is not configured")
	}
	return id, nil
}

func fetchSignupAnalyticsPage(ctx context.Context, appID string, page int) ([]logtoAnalyticsLog, error) {
	cfg := getM2MConfig()
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("Logto endpoint is not configured")
	}
	token, err := getM2MTokenContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("get Logto management token: %w", err)
	}
	query := url.Values{
		"applicationId": {appID},
		"page":          {strconv.Itoa(page)},
		"page_size":     {strconv.Itoa(analyticsPageSize)},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.Endpoint+"/api/logs?"+query.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("create Logto audit request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := (&http.Client{Timeout: platform.LogtoM2MTokenTimeout}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("Logto audit request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Logto audit request returned status %d", resp.StatusCode)
	}
	var logs []logtoAnalyticsLog
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&logs); err != nil {
		return nil, fmt.Errorf("decode Logto audit response")
	}
	return logs, nil
}

func safeSignupErrorReason(raw json.RawMessage) string {
	var detail struct {
		Code string `json:"code"`
	}
	if json.Unmarshal(raw, &detail) != nil {
		return "unknown"
	}
	code := strings.ToLower(detail.Code)
	switch {
	case strings.Contains(code, "verification_code"):
		return "verification_code"
	case strings.Contains(code, "password"):
		return "password"
	case strings.Contains(code, "identifier") || strings.Contains(code, "user_exists"):
		return "identifier"
	case strings.Contains(code, "social") || strings.Contains(code, "connector"):
		return "provider"
	case strings.Contains(code, "captcha") || strings.Contains(code, "rate_limit"):
		return "abuse_protection"
	default:
		return "unknown"
	}
}
