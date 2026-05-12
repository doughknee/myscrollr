import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SliderRow,
} from "../../components/settings/SettingsControls";
import ConfigPanelLayout from "../../components/settings/ConfigPanelLayout";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { useTickerExclusion } from "../../hooks/useTickerExclusion";
import { useStoreData } from "../../hooks/useStoreData";
import { DEFAULT_GITHUB_TICKER } from "../../preferences";
import { formatPollInterval } from "../../utils/format";
import { LS_GITHUB_REPOS } from "../../constants";
import { loadRepoData, repoKey, CI_STATUS_LABELS } from "./types";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

export default function GitHubConfigPanel({
  prefs,
  onPrefsChange,
}: WidgetConfigPanelProps) {
  const { config, update, setTicker } = useWidgetConfig("github", prefs, onPrefsChange);
  const [repoData] = useStoreData(LS_GITHUB_REPOS, loadRepoData);
  const { isExcluded: isRepoExcluded, toggle: toggleRepo } =
    useTickerExclusion(config.ticker.excludedRepos, "excludedRepos", setTicker);

  const resetAll = useCallback(() => {
    update({
      pollInterval: 120,
      ticker: { ...DEFAULT_GITHUB_TICKER },
    });
  }, [update]);

  const githubIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-widget-github)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );

  return (
    <ConfigPanelLayout
      icon={githubIcon}
      hex="var(--color-widget-github)"
      title="GitHub Settings"
      subtitle="CI/Actions status for your repos"
      onReset={resetAll}
    >
      <Section title="Ticker">
        {config.repos.map((r) => {
          const key = repoKey(r);
          const rd = repoData.find((d) => repoKey(d) === key);
          const statusLabel = rd ? CI_STATUS_LABELS[rd.status] ?? "Unknown" : "Loading";
          const workflow = rd?.workflowName ? ` \u00B7 ${rd.workflowName}` : "";
          return (
            <ToggleRow
              key={key}
              label={key}
              description={`${statusLabel}${workflow}`}
              checked={!isRepoExcluded(key)}
              onChange={() => toggleRepo(key)}
            />
          );
        })}
        {config.repos.length === 0 && (
          <div className="px-3 py-2.5 text-[11px] text-fg-4">
            Add repos in the GitHub tab to choose what shows on the ticker.
          </div>
        )}
        <TickerPinSection widgetId="github" prefs={prefs} onPrefsChange={onPrefsChange} />
      </Section>

      <Section title="Polling">
        <SliderRow
          label="Refresh interval"
          description="How often to check workflow status"
          value={config.pollInterval}
          min={60}
          max={300}
          step={30}
          displayValue={formatPollInterval(config.pollInterval)}
          onChange={(v) => update({ pollInterval: v })}
        />
      </Section>
    </ConfigPanelLayout>
  );
}
