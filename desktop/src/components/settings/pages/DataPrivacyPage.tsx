/**
 * Data & privacy — export, and the danger zone.
 *
 * The reset row stays reachable while signed out. It clears *local*
 * preferences, which is exactly what a signed-out user might need, and
 * gating it behind auth would remove the only way to do that. Export is
 * hidden signed-out because there is no account to export.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { exportUserData, setProductAnalyticsConsent } from "../../../api/client";
import { ActionRow, RowList, SettingsGroup, ToggleRow } from "../SettingsControls";
import ConfirmDialog from "../../ConfirmDialog";
import { Row } from "./Row";
import { SETTINGS_ROWS } from "../rows";

const R = SETTINGS_ROWS.data;
import type { PrivacyPrefs } from "../../../preferences";

interface DataPrivacyPageProps {
  authenticated: boolean;
  privacy: PrivacyPrefs;
  onPrivacyChange: (privacy: PrivacyPrefs) => void;
  onResetAll: () => void;
}

export default function DataPrivacyPage({
  authenticated,
  privacy,
  onPrivacyChange,
  onResetAll,
}: DataPrivacyPageProps) {
  const [exportState, setExportState] = useState<"idle" | "loading">("idle");
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [savingAnalytics, setSavingAnalytics] = useState(false);

  const handleExport = useCallback(async () => {
    if (exportState === "loading") return;
    try {
      setExportState("loading");
      const blob = await exportUserData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `myscrollr-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to export your data",
      );
    } finally {
      setExportState("idle");
    }
  }, [exportState]);

  return (
    <>
      {authenticated && (
        <SettingsGroup>
          <RowList>
            <Row id="export">
              <ActionRow
                label={R.export.label}
                description={R.export.description}
                action={exportState === "loading" ? "Exporting…" : "Export"}
                tone="accent"
                muted={exportState === "loading"}
                onClick={handleExport}
              />
            </Row>
          </RowList>
        </SettingsGroup>
      )}

      <SettingsGroup>
        <RowList>
          {authenticated && (
            <Row id="productAnalytics">
              <ToggleRow
                label={R.productAnalytics.label}
                description={R.productAnalytics.description}
                checked={privacy.shareProductAnalytics}
                disabled={savingAnalytics}
                onChange={async (enabled) => {
                  if (savingAnalytics) return;
                  setSavingAnalytics(true);
                  try {
                    const saved = await setProductAnalyticsConsent(enabled);
                    onPrivacyChange({ ...privacy, shareProductAnalytics: saved.enabled });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Could not update product activity sharing");
                  } finally {
                    setSavingAnalytics(false);
                  }
                }}
              />
            </Row>
          )}
          <Row id="crashReports">
            <ToggleRow
              label={R.crashReports.label}
              description={R.crashReports.description}
              checked={privacy.sendCrashReports}
              onChange={(v) =>
                onPrivacyChange({ ...privacy, sendCrashReports: v })
              }
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <SettingsGroup label="Danger zone" tone="danger">
        <RowList>
          <Row id="resetAll">
            <ActionRow
              label={R.resetAll.label}
              description={R.resetAll.description}
              action="Reset…"
              tone="error"
              onClick={() => setConfirmResetAll(true)}
            />
          </Row>
        </RowList>
      </SettingsGroup>

      <ConfirmDialog
        open={confirmResetAll}
        title="Reset all settings?"
        description="Every setting goes back to its default, Launch at login is turned off, and your local widgets are removed. Your account and saved content won't change."
        confirmLabel="Reset everything"
        destructive
        onConfirm={() => {
          setConfirmResetAll(false);
          onResetAll();
        }}
        onCancel={() => setConfirmResetAll(false)}
      />
    </>
  );
}
