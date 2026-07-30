/**
 * News/RSS — Home preview. Newest first.
 */
import { HOME_PREVIEW_MAX, HomeEmptyRow } from "../home";
import { timeAgo } from "../../utils/format";
import type { HomeRowsProps, RssItem } from "../../types";

export function RssHomeRows({ data, onConfigure }: HomeRowsProps) {
  const items = data as RssItem[];
  const empty = (
    <HomeEmptyRow
      message="No feeds configured yet"
      openLabel="News"
      onConfigure={onConfigure}
    />
  );
  if (items.length === 0) return empty;

  const sorted = [...items]
    .sort((a, b) => {
      const aTime = a.published_at ? new Date(a.published_at).getTime() : 0;
      const bTime = b.published_at ? new Date(b.published_at).getTime() : 0;
      return bTime - aTime;
    })
    .slice(0, HOME_PREVIEW_MAX);

  if (sorted.length === 0) return empty;

  return (
    <>
      {sorted.map((item) => (
        <div key={item.id} className="flex items-center px-4 py-2.5 gap-3">
          <span className="text-ui-meta text-fg flex-1 truncate">{item.title}</span>
          <span className="text-[10px] text-fg-4 shrink-0">{item.source_name}</span>
          <span className="text-[10px] text-fg-4/60 shrink-0 w-8 text-right">
            {timeAgo(item.published_at)}
          </span>
        </div>
      ))}
    </>
  );
}
