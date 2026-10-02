import { describe, expect, it } from 'vitest'
import { barSrc } from './LiveBar'

describe('barSrc', () => {
  it("leaves the widgets to the bar until the visitor picks, and keeps the app's defaults off the URL", () => {
    expect(barSrc({ theme: 'scrollr-dark' })).toBe('/bar/?theme=scrollr-dark')
    expect(
      barSrc({
        theme: 'nord-light',
        widgets: ['sports_nfl', 'news_npr'],
        mode: 'continuous',
        keypad: false,
      }),
    ).toBe(
      '/bar/?widgets=sports_nfl%2Cnews_npr&theme=nord-light&mode=continuous&keypad=0',
    )
  })
})
