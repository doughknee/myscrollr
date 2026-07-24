import { useState, useMemo } from "react";
import Disclosure from "./Disclosure";
import { getAllDataWidgets } from "../../datawidgets/registry";
import { getAllWidgets } from "../../widgets/registry";
import type { DataWidgetManifest, WidgetManifest } from "../../types";

export default function FeatureGuidesSection() {
  const dataWidgets = useMemo(() => getAllDataWidgets(), []);
  const widgets = useMemo(() => getAllWidgets(), []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-5">
      {/* Data sources */}
      <div>
        <p className="mb-3 text-ui-section">Data Widgets</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {dataWidgets.map((ch) => (
            <GuideCard
              key={ch.id}
              manifest={ch}
              isOpen={expandedId === ch.id}
              onToggle={() => toggle(ch.id)}
            />
          ))}
        </div>
      </div>

      {/* Widgets */}
      <div>
        <p className="mb-3 text-ui-section">Widgets</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {widgets.map((w) => (
            <GuideCard
              key={w.id}
              manifest={w}
              isOpen={expandedId === w.id}
              onToggle={() => toggle(w.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GuideCard({
  manifest,
  isOpen,
  onToggle,
}: {
  manifest: DataWidgetManifest | WidgetManifest;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const Icon = manifest.icon;

  return (
    <div className="overflow-hidden rounded-xl border border-edge/35 bg-base-150/35">
      <Disclosure
        open={isOpen}
        onToggle={onToggle}
        header={
          <>
            <span className="shrink-0" style={{ color: manifest.hex }}>
              <Icon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-ui-body font-semibold">{manifest.name}</span>
                <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-ui-chip font-medium leading-none text-accent">
                  Free
                </span>
              </div>
              <p className="mt-0.5 truncate text-ui-meta">
                {manifest.description}
              </p>
            </div>
          </>
        }
      >
        <div className="space-y-3 px-4 pb-4 pt-1">
          <p className="text-ui-meta">{manifest.info.about}</p>
          <div>
            <p className="text-ui-section">How to use</p>
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-ui-meta">
              {manifest.info.usage.map((step, j) => (
                <li key={j}>{step}</li>
              ))}
            </ul>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
