import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { channelsApi } from "../../api/client";
import { RECOMMENDED_FEEDS } from "./curated-picks";
import { queryKeys } from "../../api/queries";
import { getLimit, TIER_LIMITS, type NumericLimitKey } from "../../tierLimits";
import { TIER_LABELS } from "../../auth";
import type { ChannelType } from "../../api/client";
import type { AppPreferences } from "../../preferences";
import type { SubscriptionTier } from "../../auth";

import WizardShell from "./WizardShell";
import StepChannels from "./StepChannels";
import StepConfigureFinance from "./StepConfigureFinance";
import StepConfigureSports from "./StepConfigureSports";
import StepConfigureRss from "./StepConfigureRss";
import StepWidgets from "./StepWidgets";

// ── Types ───────────────────────────────────────────────────────

type WizardStep =
  | { kind: "channels" }
  | { kind: "configure"; channel: ChannelType }
  | { kind: "widgets" };

interface OnboardingWizardProps {
  prefs: AppPreferences;
  tier: SubscriptionTier;
  /** Called when the wizard finishes or is skipped. Updated prefs are passed. */
  onComplete: (prefs: AppPreferences) => void;
}

// ── Helper: build step sequence based on selected channels ──────

function buildSteps(selectedChannels: Set<ChannelType>): WizardStep[] {
  const steps: WizardStep[] = [{ kind: "channels" }];
  // Note: 'fantasy' is intentionally omitted — Yahoo OAuth happens later from
  // the Fantasy page itself. The wizard only collects the channel selection
  // (which provisions the channel) but skips the connect step.
  const order: ChannelType[] = ["finance", "sports", "rss"];
  for (const ch of order) {
    if (selectedChannels.has(ch)) {
      steps.push({ kind: "configure", channel: ch });
    }
  }
  steps.push({ kind: "widgets" });
  return steps;
}

// ── Welcome Screen (shown before the wizard steps) ──────────────

function WelcomeScreen({ onStart, onSkip }: {
  onStart: () => void;
  onSkip: (dontShowAgain: boolean) => void;
}) {
  const [dontShow, setDontShow] = useState(true);

  return (
    <div className="flex flex-col h-screen w-screen select-none">
      {/* Draggable region */}
      <div data-tauri-drag-region className="shrink-0 h-8" />

      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="flex flex-col items-center gap-6 max-w-md text-center">
          {/* Logo */}
          <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
            <Zap size={28} className="text-accent" />
          </div>

          {/* Title */}
          <div>
            <h1 className="text-xl font-semibold text-fg">Welcome to Scrollr</h1>
            <p className="text-sm text-fg-3 mt-2">
              Let&apos;s set up your personalized ticker. Pick your channels,
              configure your data sources, and choose your widgets.
            </p>
            <p className="text-xs text-fg-4 mt-2">
              This takes about 1-2 minutes.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col items-center gap-4 w-full max-w-xs">
            <button
              onClick={onStart}
              className="w-full px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
            >
              Get Started
            </button>

            <button
              onClick={() => onSkip(dontShow)}
              className="px-4 py-2 rounded-lg text-sm text-fg-4 hover:text-fg-3 transition-colors"
            >
              Skip Setup
            </button>

            {/* Don't show again checkbox */}
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={dontShow}
                onChange={(e) => setDontShow(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-fg-4 text-accent focus:ring-accent/30 cursor-pointer"
              />
              <span className="text-xs text-fg-4 group-hover:text-fg-3 transition-colors">
                Don&apos;t show this again
              </span>
            </label>
          </div>

          <p className="text-[10px] text-fg-5 mt-2">
            You can re-enable this in Settings &gt; General at any time.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────

export default function OnboardingWizard({ prefs, tier, onComplete }: OnboardingWizardProps) {
  const queryClient = useQueryClient();

  // ── Tier-based channel locks ──
  const channelLimitKeys: Record<ChannelType, NumericLimitKey> = {
    finance: "symbols",
    sports: "leagues",
    rss: "feeds",
    fantasy: "fantasy",
  };

  const lockedChannels = new Set<ChannelType>();
  const minTierLabels: Record<string, string> = {};

  for (const [ch, limitKey] of Object.entries(channelLimitKeys) as [ChannelType, NumericLimitKey][]) {
    if (getLimit(tier, limitKey) === 0) {
      lockedChannels.add(ch);
      // Find the minimum tier that unlocks this channel
      const tiers: SubscriptionTier[] = ["free", "uplink", "uplink_pro", "uplink_ultimate"];
      for (const t of tiers) {
        if (getLimit(t, limitKey) > 0) {
          minTierLabels[ch] = TIER_LABELS[t];
          break;
        }
      }
    }
  }

  function maxItemsFor(channel: ChannelType): number | undefined {
    const limitKey = channelLimitKeys[channel];
    const limit = getLimit(tier, limitKey);
    return limit === Infinity ? undefined : limit;
  }

  // ── Phase: welcome screen or wizard steps ──
  const [started, setStarted] = useState(false);

  // ── Wizard state ──
  const [selectedChannels, setSelectedChannels] = useState<Set<ChannelType>>(new Set());
  const [financeSymbols, setFinanceSymbols] = useState<Set<string>>(new Set());
  const [sportsLeagues, setSportsLeagues] = useState<Set<string>>(new Set());
  const [rssFeeds, setRssFeeds] = useState<Set<string>>(new Set());
  const [selectedWidgets, setSelectedWidgets] = useState<Set<string>>(new Set(["weather", "clock"]));
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  // ── Derived step sequence ──
  const steps = buildSteps(selectedChannels);
  const effectiveIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = steps[effectiveIndex];
  const totalSteps = steps.length;

  // ── Toggle helpers ──
  const toggleChannel = useCallback((id: ChannelType) => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleSymbol = useCallback((s: string) => {
    setFinanceSymbols((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  const toggleLeague = useCallback((name: string) => {
    setSportsLeagues((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const toggleFeed = useCallback((url: string) => {
    setRssFeeds((prev) => {
      const next = new Set(prev);
      next.has(url) ? next.delete(url) : next.add(url);
      return next;
    });
  }, []);

  const toggleWidget = useCallback((id: string) => {
    setSelectedWidgets((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // ── API: create channel + update config ──
  async function provisionChannel(type: ChannelType): Promise<void> {
    try {
      await channelsApi.create(type);
    } catch {
      // Channel may already exist (409), which is fine
    }

    try {
      if (type === "finance" && financeSymbols.size > 0) {
        await channelsApi.update(type, {
          config: { symbols: [...financeSymbols] },
        });
      } else if (type === "sports" && sportsLeagues.size > 0) {
        await channelsApi.update(type, {
          config: { leagues: [...sportsLeagues] },
        });
      } else if (type === "rss" && rssFeeds.size > 0) {
        // RSS config expects { name, url } objects, not bare URL strings
        const feedObjects = [...rssFeeds].map((url) => {
          const pick = RECOMMENDED_FEEDS.find((f) => f.url === url);
          return { name: pick?.name ?? url, url };
        });
        await channelsApi.update(type, {
          config: { feeds: feedObjects },
        });
      }
    } catch {
      toast.error(`Couldn't configure ${type} -- you can set it up in Settings`);
    }
  }

  // ── Finish: provision everything and exit wizard ──
  const finish = useCallback(async () => {
    setBusy(true);

    // Provision all selected channels
    for (const ch of selectedChannels) {
      await provisionChannel(ch);
    }

    // Build final prefs. Sidebar visibility is now derived from
    // enabled state (channels via dashboard.channels, widgets via
    // enabledWidgets) so we no longer write pinnedSources here.
    const widgetIds = [...selectedWidgets];

    const nextPrefs: AppPreferences = {
      ...prefs,
      showSetupOnLogin: false,
      widgets: {
        ...prefs.widgets,
        enabledWidgets: widgetIds,
        widgetsOnTicker: widgetIds,
      },
    };

    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    setBusy(false);
    onComplete(nextPrefs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannels, selectedWidgets, prefs, queryClient, onComplete]);

  // ── Navigation: Next ──
  const handleNext = useCallback(async () => {
    if (busy) return;

    const step = steps[effectiveIndex];

    // If leaving a configure step, provision the channel
    if (step.kind === "configure") {
      setBusy(true);
      await provisionChannel(step.channel);
      setBusy(false);
    }

    // If this is the last step (widgets), finish
    if (effectiveIndex >= steps.length - 1) {
      await finish();
      return;
    }

    setStepIndex((i) => i + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, effectiveIndex, steps, finish]);

  // ── Navigation: Back ──
  const handleBack = useCallback(() => {
    if (effectiveIndex > 0) setStepIndex((i) => i - 1);
  }, [effectiveIndex]);

  // ── Navigation: Skip step ──
  const handleSkip = useCallback(() => {
    if (effectiveIndex >= steps.length - 1) {
      // Skipping the last step = finish with whatever we have
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }, [effectiveIndex, steps.length, finish]);

  // ── Welcome screen skip: just exit wizard ──
  const handleWelcomeSkip = useCallback((dontShowAgain: boolean) => {
    const nextPrefs: AppPreferences = {
      ...prefs,
      showSetupOnLogin: dontShowAgain ? false : prefs.showSetupOnLogin,
    };
    onComplete(nextPrefs);
  }, [prefs, onComplete]);

  // ── Show welcome screen first ──
  if (!started) {
    return (
      <WelcomeScreen
        onStart={() => setStarted(true)}
        onSkip={handleWelcomeSkip}
      />
    );
  }

  // ── Render current step ──
  function renderStep() {
    if (!currentStep) return null;

    switch (currentStep.kind) {
      case "channels":
        return (
          <StepChannels
            selected={selectedChannels}
            onToggle={toggleChannel}
            lockedChannels={lockedChannels}
            minTierLabels={minTierLabels}
          />
        );
      case "configure":
        switch (currentStep.channel) {
          case "finance":
            return <StepConfigureFinance selected={financeSymbols} onToggle={toggleSymbol} maxItems={maxItemsFor("finance")} />;
          case "sports":
            return <StepConfigureSports selected={sportsLeagues} onToggle={toggleLeague} maxItems={maxItemsFor("sports")} />;
          case "rss":
            return <StepConfigureRss selected={rssFeeds} onToggle={toggleFeed} maxItems={maxItemsFor("rss")} />;
          default:
            return null;
        }
      case "widgets":
        return <StepWidgets selected={selectedWidgets} onToggle={toggleWidget} />;
    }
  }

  // ── Shell props per step ──
  function stepTitle(): string {
    if (!currentStep) return "";
    switch (currentStep.kind) {
      case "channels": return "Pick Your Channels";
      case "configure":
        switch (currentStep.channel) {
          case "finance": return "Set Up Finance";
          case "sports": return "Set Up Sports";
          case "rss": return "Set Up RSS Feeds";
          default: return "Configure";
        }
      case "widgets": return "Pick Your Widgets";
    }
  }

  function stepSubtitle(): string | undefined {
    if (!currentStep) return undefined;
    switch (currentStep.kind) {
      case "channels": return "Select the data sources you want on your ticker.";
      case "configure":
        switch (currentStep.channel) {
          case "finance": return "Choose stocks and crypto to track.";
          case "sports": return "Select the leagues you follow.";
          case "rss": return "Pick news and blog feeds.";
          default: return undefined;
        }
      case "widgets": return "Add utility widgets to your ticker.";
    }
  }

  const isLastStep = effectiveIndex >= steps.length - 1;

  return (
    <WizardShell
      stepIndex={effectiveIndex}
      totalSteps={totalSteps}
      title={stepTitle()}
      subtitle={stepSubtitle()}
      showBack={effectiveIndex > 0}
      showSkip
      nextLabel={isLastStep ? "Finish" : "Next"}
      nextDisabled={busy}
      onBack={handleBack}
      onNext={handleNext}
      onSkip={handleSkip}
    >
      {renderStep()}
    </WizardShell>
  );
}
