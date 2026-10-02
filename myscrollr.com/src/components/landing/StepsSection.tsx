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
              body: 'One small native app for macOS, Windows, and Linux. No account is required to download it or try local utility widgets; sign in to add live data.',
            },
            {
              num: '02',
              title: 'Pick your widgets',
              body: `Leagues, markets, feeds, your favorite outlets: ${widgets.length} widgets and counting. Each one is a page on your bar. Three are free, and Clock and Weather ride the edge without counting.`,
            },
            {
              num: '03',
              title: 'Get back to work',
              body: 'The bar floats above every window. It takes 64 pixels of your screen and none of your attention until something happens.',
            },
          ]}
        />
      </TerminalContainer>
    </section>
  )
}
