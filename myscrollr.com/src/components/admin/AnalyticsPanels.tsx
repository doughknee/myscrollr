import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** Focused report chapters. Keep visited panels mounted to retain filters and data. */
export function AnalyticsPanels({
  panels,
}: {
  panels: Array<{ label: string; content: ReactNode; lazy?: boolean }>
}) {
  const id = useId()
  const [selected, setSelected] = useState(0)
  const [visited, setVisited] = useState([0])
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const select = (index: number) => {
    setSelected(index)
    setVisited((previous) =>
      previous.includes(index) ? previous : [...previous, index],
    )
  }
  return (
    <div className="analytics-panels">
      <div
        role="tablist"
        aria-label="Report details"
        className="analytics-panel-tabs"
      >
        {panels.map((panel, index) => (
          <button
            key={panel.label}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-controls={`${id}-panel-${index}`}
            aria-selected={selected === index}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => select(index)}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % panels.length
                  : event.key === 'ArrowLeft'
                    ? (index + panels.length - 1) % panels.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? panels.length - 1
                        : null
              if (next === null) return
              event.preventDefault()
              select(next)
              buttons.current[next]?.focus()
            }}
          >
            {panel.label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div
          key={panel.label}
          id={`${id}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`}
          tabIndex={0}
          hidden={selected !== index}
          className="analytics-panel-body"
        >
          {!panel.lazy || visited.includes(index) ? panel.content : null}
        </div>
      ))}
    </div>
  )
}
