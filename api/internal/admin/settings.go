package admin

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"time"

	"github.com/brandon-relentnet/myscrollr/api/internal/platform"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Dashboard settings (SCROLLR-210).
//
// One key/value table, values as JSON, the same shape support_policy uses for
// the autosend switch. The only key today is the staff-exclusion toggle; a
// second one needs a constant here and nothing else.

const (
	// SettingExcludeStaff hides staff and test accounts from audience and
	// usage figures. Default ON: the owner reading the dashboard is the
	// staff account most likely to be counted otherwise.
	SettingExcludeStaff = "exclude_staff_from_analytics"
)

// settingDefaults is the answer when no row has been written yet. A key
// missing from here is unknown to the API and is refused on write.
var settingDefaults = map[string]bool{
	SettingExcludeStaff: true,
}

// Setting is one toggle as the dashboard reads it.
type Setting struct {
	Value     bool    `json:"value"`
	Default   bool    `json:"default"`
	UpdatedAt *string `json:"updated_at,omitempty"`
	UpdatedBy string  `json:"updated_by,omitempty"`
}

type SettingsResponse struct {
	Settings map[string]Setting `json:"settings"`
}

// ExcludeStaff is the one question every audience/usage reader asks first.
// A database failure answers with the default rather than leaking staff
// figures into a page that promised to exclude them.
func ExcludeStaff(ctx context.Context) bool {
	value, _, err := readBoolSetting(ctx, SettingExcludeStaff)
	if err != nil {
		log.Printf("[Admin] settings read %s: %v", SettingExcludeStaff, err)
		return settingDefaults[SettingExcludeStaff]
	}
	return value
}

func readBoolSetting(ctx context.Context, key string) (value bool, s Setting, err error) {
	s = Setting{Value: settingDefaults[key], Default: settingDefaults[key]}
	if platform.DBPool == nil {
		return s.Value, s, nil
	}
	var raw []byte
	var updatedAt time.Time
	var updatedBy *string
	err = platform.DBPool.QueryRow(ctx,
		`SELECT value, updated_at, updated_by FROM admin_settings WHERE key = $1`, key).
		Scan(&raw, &updatedAt, &updatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return s.Value, s, nil
	}
	if err != nil {
		return s.Value, s, err
	}
	var stored bool
	if err := json.Unmarshal(raw, &stored); err != nil {
		return s.Value, s, err
	}
	s.Value = stored
	formatted := updatedAt.UTC().Format(time.RFC3339)
	s.UpdatedAt = &formatted
	if updatedBy != nil {
		s.UpdatedBy = *updatedBy
	}
	return s.Value, s, nil
}

func writeBoolSetting(ctx context.Context, key string, value bool, by string) error {
	raw, _ := json.Marshal(value)
	_, err := platform.DBPool.Exec(ctx, `
		INSERT INTO admin_settings (key, value, updated_at, updated_by)
		VALUES ($1, $2, now(), NULLIF($3, ''))
		ON CONFLICT (key) DO UPDATE
		SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
		key, raw, by)
	return err
}

func loadSettings(ctx context.Context) (SettingsResponse, error) {
	out := SettingsResponse{Settings: map[string]Setting{}}
	for key := range settingDefaults {
		_, s, err := readBoolSetting(ctx, key)
		if err != nil {
			return out, err
		}
		out.Settings[key] = s
	}
	return out, nil
}

// HandleGetSettings - GET /admin/settings
func HandleGetSettings(c *fiber.Ctx) error {
	out, err := loadSettings(context.Background())
	if err != nil {
		log.Printf("[Admin] settings: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
			Status: "error", Error: "Could not read the dashboard settings",
		})
	}
	return c.JSON(out)
}

// HandlePutSettings - PUT /admin/settings
//
// Body is a flat object of known keys to booleans. Unknown keys are refused
// rather than stored: a typo must not become a silent no-op setting.
func HandlePutSettings(c *fiber.Ctx) error {
	var body map[string]bool
	if err := json.Unmarshal(c.Body(), &body); err != nil || len(body) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
			Status: "error", Error: "Body must be an object of setting keys to booleans",
		})
	}
	for key := range body {
		if _, known := settingDefaults[key]; !known {
			return c.Status(fiber.StatusBadRequest).JSON(platform.ErrorResponse{
				Status: "error", Error: "Unknown setting: " + key,
			})
		}
	}
	ctx := context.Background()
	for key, value := range body {
		if err := writeBoolSetting(ctx, key, value, ActingAdmin(c)); err != nil {
			log.Printf("[Admin] settings write %s: %v", key, err)
			return c.Status(fiber.StatusInternalServerError).JSON(platform.ErrorResponse{
				Status: "error", Error: "Could not save the dashboard settings",
			})
		}
	}
	return HandleGetSettings(c)
}
