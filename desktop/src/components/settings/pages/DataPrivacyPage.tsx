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
import { exportUserData } from "../../../api/client";
import { ActionRow, RowList, SettingsGroup } from "../SettingsControls";
import ConfirmDialog from "../../ConfirmDialog";
import { Row } from "./Row";

interface DataPrivacyPageProps {
  authenticated: boolean;
  onResetAll: () => void;
}

export default function DataPrivacyPage({
  authenticated,
  onResetAll,
}: DataPrivacyPageProps) {
  const [exportState, setExportState] = useState<"idle" | "loading">("idle");
  const [confirmResetAll, setConfirmResetAll] = useState(false);

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
                label="Export your data"
                description="Download your sources, preferences, and account metadata as JSON."
                action={exportState === "loading" ? "Exporting…" : "Export"}
                tone="accent"
                muted={exportState === "loading"}
                onClick={handleExport}
              />
            </Row>
          </RowList>
        </SettingsGroup>
      )}

      <SettingsGroup label="Danger zone" tone="danger">
        <RowList>
          <Row id="resetAll">
            <ActionRow
              label="Reset all settings"
              description="Clear every local preference. Your account, billing, and server data are untouched."
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
        description="This will set everything back to the original settings. Your account and saved content won't change."
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
