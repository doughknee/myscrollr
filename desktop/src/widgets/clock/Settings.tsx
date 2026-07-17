/**
 * Clock settings surface — rendered inside the in-feed gear popover.
 * 2026-07-17 unification: ticker content follows what you track (local
 * time + your world clocks), so only widget-level behavior lives here.
 */
import { useCallback } from "react";
import {
  Section,
  SegmentedRow,
} from "../../components/settings/SettingsControls";
import { useStoreData } from "../../hooks/useStoreData";
import { setStore } from "../../lib/store";
import { LS_CLOCK_FORMAT } from "../../constants";
import { loadFormat } from "./storage";
import type { WidgetConfigPanelProps } from "../../hooks/useWidgetConfig";

type ClockFormat = "12h" | "24h";

const FORMAT_OPTIONS: { value: ClockFormat; label: string }[] = [
  { value: "12h", label: "12h" },
  { value: "24h", label: "24h" },
];

export default function ClockSettings(_props: WidgetConfigPanelProps) {
  const [format, setFormatState] = useStoreData(LS_CLOCK_FORMAT, loadFormat);

  const handleFormatChange = useCallback(
    (v: ClockFormat) => {
      setFormatState(v);
      setStore(LS_CLOCK_FORMAT, v);
    },
    [],
  );

  return (
    <Section title="Display">
      <SegmentedRow
        label="Time format"
        description="12-hour or 24-hour clock"
        value={format}
        options={FORMAT_OPTIONS}
        onChange={handleFormatChange}
      />
    </Section>
  );
}
