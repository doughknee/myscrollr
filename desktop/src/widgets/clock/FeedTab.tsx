import { useRef, useState } from "react";
import { WorldClock } from "./WorldClock";
import { WidgetBar } from "../../components/widget-bar/Bar";
import { SearchBox } from "../../components/widget-bar/SearchBox";
import { useShell } from "../../shell-context";
import type { FeedTabProps } from "../../types";

export default function ClockFeedTab({ mode }: FeedTabProps) {
  // 12h/24h is an app-wide setting (Appearance → Units & formats).
  const format = useShell().prefs.appearance.units.timeFormat;
  // The add-timezone query lives here because the bar writes it and the
  // body renders from it.
  const [addQuery, setAddQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const comfort = mode === "comfort";
  return (
    <div className="flex min-h-full flex-col">
      {comfort && (
        <WidgetBar>
          <div className="ml-auto">
            <SearchBox
              inputRef={searchRef}
              query={addQuery}
              onQueryChange={setAddQuery}
              resultCount={null}
              ariaLabel="Add time zone"
              noun="time zones"
            />
          </div>
        </WidgetBar>
      )}
      <div className="p-3">
        <WorldClock
          compact={mode === "compact"}
          fmt={format}
          addQuery={comfort ? addQuery : undefined}
          onAddQueryChange={comfort ? setAddQuery : undefined}
        />
      </div>
    </div>
  );
}
