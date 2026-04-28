import { useState } from "react";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { exportUserData } from "../../api/client";

type ButtonState = "idle" | "loading" | "error";

export default function AccountExportButton() {
  const [state, setState] = useState<ButtonState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleClick() {
    setState("loading");
    setErrorMessage("");
    try {
      const blob = await exportUserData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `myscrollr-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMessage(msg);
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-50 self-start"
      >
        {state === "loading" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Preparing your data…</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            <span>Download my data</span>
          </>
        )}
      </button>
      {state === "error" && (
        <div className="flex items-center gap-1.5 text-xs text-down">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Failed: {errorMessage}</span>
        </div>
      )}
      <p className="text-xs text-fg-4">
        To delete your account, visit{" "}
        <span className="text-fg-3">myscrollr.com/account</span>.
      </p>
    </div>
  );
}
