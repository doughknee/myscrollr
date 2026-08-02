/**
 * SEC 04 ／ MAKE IT YOURS — theme family swatches + mode/pin/density/
 * direction controls, all driving the persistent demo bar (and, for
 * theme + mode, the whole site) through useDemoTicker + useTheme.
 * Mirrors the app's Appearance settings: theme FAMILY and color MODE
 * are separate controls, exactly like the desktop app.
 */

import { SectionRow, TerminalContainer } from '@/components/terminal'
import {
  APP_FAMILY_COUNT,
  DEMO_THEMES,
  useDemoTicker,
} from '@/hooks/useDemoTicker'
import { useTheme } from '@/hooks/useTheme'

function ControlRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-[76px] font-mono text-[11px] tracking-[0.14em] text-base-content/45">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`cursor-pointer rounded-[4px] border px-[18px] py-[9px] font-mono text-[11px] tracking-[0.1em] transition-colors duration-150 hover:border-primary ${
            value === o.id
              ? 'border-primary/45 bg-primary/10 text-primary'
              : 'border-hairline bg-transparent text-base-content/55'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function MakeItYours() {
  const {
    theme,
    pos,
    density,
    direction,
    setTheme,
    setPos,
    setDensity,
    setDirection,
  } = useDemoTicker()
  const { theme: mode, setTheme: setMode } = useTheme()

  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 04 ／ MAKE IT YOURS" />
        <div className="grid items-start gap-10 pb-16 pt-[52px] lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="type-display m-0 mb-[18px] text-[clamp(30px,3.6vw,46px)]">
              {"It's your bar."}
              <br />
              <span className="text-primary">Dress it, park it.</span>
            </h2>
            <p className="m-0 mb-7 max-w-[440px] leading-relaxed text-base-content/60 [text-wrap:pretty]">
              Twenty palettes. Top or bottom of any monitor. Speed, density, all
              of it tunable. Try it right here. The bar takes orders.
            </p>
            <div className="flex flex-col gap-3">
              <ControlRow
                label="MODE"
                value={mode}
                options={[
                  { id: 'dark' as const, label: 'DARK' },
                  { id: 'light' as const, label: 'LIGHT' },
                ]}
                onChange={setMode}
              />
              <ControlRow
                label="PIN"
                value={pos}
                options={[
                  { id: 'bottom' as const, label: 'BOTTOM' },
                  { id: 'top' as const, label: 'TOP' },
                ]}
                onChange={setPos}
              />
              <ControlRow
                label="DENSITY"
                value={density}
                options={[
                  { id: 'compact' as const, label: 'COMPACT' },
                  { id: 'detailed' as const, label: 'DETAILED' },
                ]}
                onChange={setDensity}
              />
              <ControlRow
                label="DIRECTION"
                value={direction}
                options={[
                  { id: 'left' as const, label: '← LEFT' },
                  { id: 'right' as const, label: 'RIGHT →' },
                ]}
                onChange={setDirection}
              />
            </div>
          </div>
          <div>
            <div className="pb-3.5 font-mono text-[11px] tracking-[0.14em] text-base-content/45">
              THEMES — {DEMO_THEMES.length} OF {APP_FAMILY_COUNT} FAMILIES
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {DEMO_THEMES.map((fam) => {
                const pal = fam[mode]
                return (
                  <button
                    key={fam.id}
                    type="button"
                    aria-pressed={theme === fam.id}
                    onClick={() => setTheme(fam.id)}
                    className={`cursor-pointer rounded-[4px] border bg-transparent p-2 text-left transition-colors duration-150 hover:border-primary ${
                      theme === fam.id ? 'border-primary/45' : 'border-hairline'
                    }`}
                  >
                    <span
                      className="mb-2 flex items-center gap-2 rounded-[4px] px-2.5 py-2"
                      style={{
                        background: pal.bg,
                        border: `1px solid ${pal.border}`,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: pal.accent }}
                      />
                      <span
                        className="overflow-hidden whitespace-nowrap font-mono text-[11px]"
                        style={{ color: pal.text }}
                      >
                        <span style={{ color: pal.chips.fin }}>
                          AAPL 232.14
                        </span>
                        <span style={{ color: pal.up }}> ▲</span>
                        {' · '}
                        <span style={{ color: pal.chips.spt }}>
                          KC 24—BUF 21
                        </span>
                      </span>
                    </span>
                    <span className="flex justify-between px-0.5 font-mono text-[10px] tracking-[0.1em] text-base-content/45">
                      <span>{fam.name}</span>
                      {theme === fam.id && (
                        <span className="text-primary">● ACTIVE</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="pt-3 font-mono text-[11px] text-base-content/30">
              + {APP_FAMILY_COUNT - DEMO_THEMES.length} MORE IN THE APP · EVERY
              THEME IN LIGHT & DARK
            </div>
          </div>
        </div>
      </TerminalContainer>
    </section>
  )
}
