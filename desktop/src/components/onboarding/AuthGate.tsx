import { Zap } from "lucide-react";
import WindowControls from "../WindowControls";

interface AuthGateProps {
  onLogin: () => void;
}

export default function AuthGate({ onLogin }: AuthGateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen select-none">
      {/* Draggable region for window movement */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-8" />

      {/* Window controls — signed-out is before the app shell/TopBar
          exists, so the frameless window needs its own close/minimize. */}
      <div className="absolute top-0 right-0 flex items-center h-9">
        <WindowControls />
      </div>

      <div className="flex flex-col items-center gap-6 max-w-sm text-center px-6">
        {/* Logo */}
        <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
          <Zap size={28} className="text-accent" />
        </div>

        {/* Tagline */}
        <div>
          <h1 className="text-xl font-semibold text-fg">Scrollr</h1>
          <p className="text-sm text-fg-3 mt-1">
            Your personalized market, sports, and news ticker.
          </p>
        </div>

        {/* Sign in button */}
        <button
          onClick={onLogin}
          className="w-full px-6 py-2.5 rounded-lg bg-accent text-surface text-sm font-medium hover:bg-accent/90 "
        >
          Sign In
        </button>

        {/* Create account link */}
        <p className="text-xs text-fg-4">
          Don&apos;t have an account?{" "}
          <button
            onClick={onLogin}
            className="text-accent hover:text-accent/80 font-medium"
          >
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
