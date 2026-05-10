import { useState, useMemo } from "react";
import {
  Search,
  Rocket,
  HelpCircle,
  Wrench,
  BookOpen,
  CreditCard,
  MessageCircle,
} from "lucide-react";
import clsx from "clsx";
import { searchSupportContent } from "./support-content";
import { getAllChannels } from "../../channels/registry";
import { getAllWidgets } from "../../widgets/registry";
import type { SearchResult, SearchResultSection } from "./support-content";

export type SectionId =
  | "getting-started"
  | "faq"
  | "troubleshooting"
  | "guides"
  | "billing"
  | "contact";

interface SupportHubProps {
  onSelectSection: (id: SectionId) => void;
}

const CATEGORIES: Array<{
  id: SectionId;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  {
    id: "getting-started",
    label: "Getting Started",
    description: "New to Scrollr? Start here",
    icon: Rocket,
  },
  {
    id: "faq",
    label: "FAQ",
    description: "Common questions answered",
    icon: HelpCircle,
  },
  {
    id: "troubleshooting",
    label: "Troubleshooting",
    description: "Fix common issues",
    icon: Wrench,
  },
  {
    id: "guides",
    label: "Feature Guides",
    description: "Learn how each feature works",
    icon: BookOpen,
  },
  {
    id: "billing",
    label: "Account & Billing",
    description: "Plans, payments, and subscriptions",
    icon: CreditCard,
  },
  {
    id: "contact",
    label: "Contact Us",
    description: "Report bugs, request features, or send feedback",
    icon: MessageCircle,
  },
];

const SECTION_BADGE_COLORS: Record<SearchResultSection, string> = {
  faq: "bg-blue-500/15 text-blue-400",
  troubleshooting: "bg-amber-500/15 text-amber-400",
  "getting-started": "bg-accent/10 text-accent",
  billing: "bg-purple-500/15 text-purple-400",
  guides: "bg-cyan-500/15 text-cyan-400",
};

const SECTION_LABELS: Record<SearchResultSection, string> = {
  faq: "FAQ",
  troubleshooting: "Troubleshooting",
  "getting-started": "Getting Started",
  billing: "Account & Billing",
  guides: "Feature Guides",
};

function buildFeatureGuideResults(query: string): SearchResult[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  const channels = getAllChannels();
  channels.forEach((ch, i) => {
    const text = `${ch.name} ${ch.info.about} ${ch.info.usage.join(" ")}`.toLowerCase();
    if (text.includes(q)) {
      results.push({
        section: "guides",
        sectionLabel: "Feature Guides",
        title: ch.name,
        preview: ch.info.about.slice(0, 120),
        index: i,
      });
    }
  });

  const widgets = getAllWidgets();
  widgets.forEach((w, i) => {
    const text = `${w.name} ${w.info.about} ${w.info.usage.join(" ")}`.toLowerCase();
    if (text.includes(q)) {
      results.push({
        section: "guides",
        sectionLabel: "Feature Guides",
        title: w.name,
        preview: w.info.about.slice(0, 120),
        index: channels.length + i,
      });
    }
  });

  return results;
}

export default function SupportHub({ onSelectSection }: SupportHubProps) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const contentResults = searchSupportContent(query);
    const guideResults = buildFeatureGuideResults(query);

    // Deduplicate guide results by title (content index may already have some)
    const existingTitles = new Set(contentResults.map((r) => r.title));
    const uniqueGuides = guideResults.filter((r) => !existingTitles.has(r.title));

    return [...contentResults, ...uniqueGuides];
  }, [query]);

  const hasQuery = query.trim().length > 0;

  // Header is provided by PageLayout in the parent route — this
  // component just renders the search input and the result/category
  // body.
  return (
    <div>
      {/* Search input */}
      <div className="relative mb-5">
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search support articles..."
          className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-surface-2 border border-edge/30 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:border-accent/60 transition-colors"
        />
      </div>

      {/* Content area */}
      <div>
        {hasQuery ? (
          results.length > 0 ? (
            <div className="flex flex-col gap-1">
              {results.map((result, i) => (
                <button
                  key={`${result.section}-${result.index}-${i}`}
                  onClick={() => onSelectSection(result.section as SectionId)}
                  className="flex flex-col gap-1.5 p-3 rounded-lg text-left hover:bg-surface-2/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                        SECTION_BADGE_COLORS[result.section],
                      )}
                    >
                      {SECTION_LABELS[result.section]}
                    </span>
                    <span className="text-sm font-semibold text-fg">
                      {result.title}
                    </span>
                  </div>
                  <p className="text-xs text-fg-3 line-clamp-2">{result.preview}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-fg-3">
              <Search size={24} className="mb-3 opacity-40" />
              <p className="text-sm">No results found</p>
              <p className="text-xs mt-1">Try a different search term</p>
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  onClick={() => onSelectSection(cat.id)}
                  className="border border-edge/30 rounded-lg p-4 text-left hover:border-accent/40 hover:bg-surface-2/50 transition-colors cursor-pointer"
                >
                  <Icon size={18} className="text-accent mb-2.5" />
                  <h3 className="text-sm font-bold text-fg mb-1">{cat.label}</h3>
                  <p className="text-sm text-fg-3">{cat.description}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
