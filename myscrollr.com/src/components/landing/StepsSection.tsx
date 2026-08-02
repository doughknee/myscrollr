/**
 * SEC 03 ／ HOW IT WORKS — ghost-numeral steps. The widget count in
 * step 02 is computed from the live catalog (never hardcoded).
 */

import { SectionRow, StepsGrid, TerminalContainer } from '@/components/terminal'
import { useCatalog } from '@/lib/catalog'

export function StepsSection() {
  const widgets = useCatalog()
  return (
    <section className="border-b border-hairline">
      <TerminalContainer>
        <SectionRow tag="SEC 03 ／ HOW IT WORKS" />
        <StepsGrid
          steps={[
            {
              num: '01',
              title: 'Download',
              body: 'One small native app — macOS, Windows, Linux. Installed before your coffee cools, no account required.',
            },
            {
              num: '02',
              title: 'Pick your widgets',
              body: `Leagues, markets, feeds, your fantasy team — ${widgets.length} widgets and counting. Each costs one slot. Three are free.`,
            },
            {
              num: '03',
              title: 'Get back to work',
              body: 'The bar floats above every window — 40 pixels of your screen, none of your attention until something happens.',
            },
          ]}
        />
      </TerminalContainer>
    </section>
  )
}
