/** GitHub settings surface — rendered inside the in-feed gear popover and (until teardown) the Configure page. */
import { useCallback } from "react";
import {
  Section,
  ToggleRow,
  SliderRow,
  ResetButton,
} from "../../components/settings/SettingsControls";
import TickerPinSection from "../../components/settings/TickerPinSection";
import { useWidgetConfig } from "../../hooks/useWidgetConfig";
import { useTickerExclusion } from "../../hooks/useTickerExclusion";
import { useStoreData } from "../../hooks/useStoreData";
import { DEFAULT_GITHUB_TICKER } from "../../preferences";
import { formatPollInterval } from "../../utils/format";
import { LS_GITHUB_REPOS } from "../../constants";
import { loadRepoData, repoKey, CI_STATUS_LABELS } from "./types";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

export default function GitHubSettings({
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

  return (
    <>
      <Section title="Ticker">
        {config.repos.map((r) => {
          const key = repoKey(r);
          const rd = repoData.find((d) => repoKey(d) === key);
          const statusLabel = rd ? CI_STATUS_LABELS[rd.status] ?? "Unknown" : "Loading";
          const workflow = rd?.workflowName ? ` · ${rd.workflowName}` : "";
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

      <div className="flex items-center justify-end px-3 pb-1 pt-2">
        <ResetButton onClick={resetAll} />
      </div>
    </>
  );
}
