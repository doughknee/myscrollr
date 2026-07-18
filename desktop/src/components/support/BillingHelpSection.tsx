import { useState } from "react";
import { Settings, ExternalLink, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { open } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import { isAuthenticated } from "../../auth";
import { authFetch } from "../../api/client";
import { BILLING_FAQ } from "./support-content";

export default function BillingHelpSection() {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const authenticated = isAuthenticated();

  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const res = await authFetch<{ url: string }>(
        "/users/me/subscription/portal",
        { method: "POST" },
      );
      await open(res.url);
    } catch (err) {
      toast.error("Failed to open subscription portal", {
        description: (err as Error).message,
      });
    } finally {
      setPortalLoading(false);
    }
  }

  async function handleViewPlans() {
    await open("https://myscrollr.com/uplink");
  }

  function toggleFaq(index: number) {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }

  return (
    <div className="space-y-5">
      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        {/* Manage Subscription */}
        {authenticated ? (
          <button
            onClick={handleManageSubscription}
            disabled={portalLoading}
            className="flex items-start gap-3 rounded-xl border border-edge/35 bg-base-150/35 p-4 text-left transition-colors hover:bg-base-150/55 disabled:opacity-50 cursor-pointer"
          >
            <Settings size={18} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-ui-body font-semibold">
                {portalLoading ? "Opening..." : "Manage Subscription"}
              </p>
              <p className="mt-0.5 text-ui-meta">
                Update payment, cancel, or change plan
              </p>
            </div>
          </button>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-edge/35 bg-base-150/35 p-4">
            <Settings size={18} className="mt-0.5 shrink-0 text-fg-3" />
            <div className="min-w-0">
              <p className="text-ui-body font-semibold">Manage Subscription</p>
              <p className="mt-0.5 text-ui-meta">
                Sign in to manage your subscription
              </p>
            </div>
          </div>
        )}

        {/* View Plans */}
        <button
          onClick={handleViewPlans}
          className="flex items-start gap-3 rounded-xl border border-edge/35 bg-base-150/35 p-4 text-left transition-colors hover:bg-base-150/55 cursor-pointer"
        >
          <ExternalLink size={18} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="text-ui-body font-semibold">View Plans</p>
            <p className="mt-0.5 text-ui-meta">Compare Uplink tiers</p>
          </div>
        </button>
      </div>

      {/* Billing FAQ — wrapped in a single dense panel to match the
          FAQ section's chrome. */}
      <div>
        <p className="mb-3 text-ui-section">Common Questions</p>
        <div className="rounded-xl border border-edge/35 bg-base-150/35 overflow-hidden">
          {BILLING_FAQ.map((item, i) => {
            const isOpen = expandedIndex === i;
            return (
              <div
                key={i}
                className={clsx(i > 0 && "border-t border-edge/35")}
              >
                <button
                  onClick={() => toggleFaq(i)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-base-150/50 cursor-pointer"
                >
                  <span className="text-ui-body font-medium">
                    {item.question}
                  </span>
                  <ChevronDown
                    size={16}
                    className={clsx(
                      "shrink-0 text-fg-3 transition-transform duration-200",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
                <div
                  className={clsx(
                    "overflow-hidden transition-all duration-200",
                    isOpen
                      ? "max-h-[500px] opacity-100"
                      : "max-h-0 opacity-0",
                  )}
                >
                  <p className="px-4 pb-4 pt-1 text-ui-meta">
                    {item.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
