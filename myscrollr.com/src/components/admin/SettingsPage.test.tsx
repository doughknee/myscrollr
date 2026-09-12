import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsContent } from './SettingsPage'
import { failed, loaded, loading, settings } from './dashboardFixtures'

describe('SettingsContent', () => {
  it('renders the staff toggle as a switch with its state and provenance', () => {
    const html = renderToStaticMarkup(
      <SettingsContent settings={loaded(settings)} />,
    )
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('Exclude staff from audience and usage analytics')
    expect(html).toContain('does not change payments or earnings')
    expect(html).toContain('cannot be restored')
    expect(html).toContain('(default)')
    expect(html).toContain('by brandon@myscrollr.com')
  })

  it('shows off state and the non-default note', () => {
    const html = renderToStaticMarkup(
      <SettingsContent
        settings={loaded({
          settings: {
            exclude_staff_from_analytics: { value: false, default: true },
          },
        })}
      />,
    )
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('(default on)')
    expect(html).toContain('never changed')
  })

  it('renders loading, error and save-error states', () => {
    expect(
      renderToStaticMarkup(<SettingsContent settings={loading()} />),
    ).toContain('Loading settings')
    expect(
      renderToStaticMarkup(<SettingsContent settings={failed('403')} />),
    ).toContain('403')
    const html = renderToStaticMarkup(
      <SettingsContent
        settings={loaded(settings)}
        saving
        saveError="Could not save the dashboard settings"
      />,
    )
    expect(html).toContain('Could not save the dashboard settings')
    expect(html).toContain('disabled=""')
  })

  it('says when the server did not report the key', () => {
    const html = renderToStaticMarkup(
      <SettingsContent settings={loaded({ settings: {} })} />,
    )
    expect(html).toContain('did not report')
    expect(html).not.toContain('role="switch"')
  })
})
