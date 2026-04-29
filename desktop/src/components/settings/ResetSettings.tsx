/**
 * ResetSettings — destructive action: wipe every local preference.
 *
 * Lives on its own Settings tab so it cannot be triggered by accident
 * while the user is browsing account/billing controls. Account, billing,
 * and channel data on the server is untouched — this only affects local
 * preferences (theme, ticker layout, channel display, followed players,
 * etc.).
 */
import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import ConfirmDialog from "../ConfirmDialog";
import { Section } from "./SettingsControls";

interface ResetSettingsProps {
  onResetAll: () => void;
}

export default function ResetSettings({ onResetAll }: ResetSettingsProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  const handleConfirm = () => {
    setConfirmReset(false);
    onResetAll();
  };

  return (
    <div>
      <Section title="Reset all settings">
        <div className="px-3 py-2 flex flex-col gap-3">
          <p className="text-[12px] text-fg-3 leading-relaxed">
            Clear every local preference: theme, ticker layout, channel
            display, followed players, and more. Your account, billing, and
            channel data on the server is untouched.
          </p>

          <div className="flex flex-col gap-3 p-3 rounded-lg bg-error/5 border border-error/20">
            <div className="flex items-start gap-2 text-[12px] text-error leading-relaxed">
              <AlertTriangle
                className="w-4 h-4 mt-0.5 shrink-0"
                aria-hidden
              />
              <p>
                This action is local-only and cannot be undone. You will be
                asked to confirm before anything is reset.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="self-start flex items-center gap-2 px-3 py-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors cursor-pointer text-[12px] font-semibold"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
              <span>Reset all settings</span>
            </button>
          </div>
        </div>
      </Section>

      <ConfirmDialog
        open={confirmReset}
        title="Reset all settings?"
        description="This will set everything back to the original settings. Your account and saved content won't change."
        confirmLabel="Reset everything"
        destructive
        onConfirm={handleConfirm}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
