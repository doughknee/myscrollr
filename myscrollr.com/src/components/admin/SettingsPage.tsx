import { useCallback, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ErrorPanel, Loaded, PageFrame, useReport } from './ui'
import type { AdminSettings, Setting } from '@/api/admin'
import type { Report } from './ui'
import { EXCLUDE_STAFF_SETTING, adminApi } from '@/api/admin'
import { useGetToken } from '@/hooks/useGetToken'

/**
 * Settings (SCROLLR-210): one server-backed switch.
 *
 * The toggle flips optimistically — the page shows the new value at once and
 * rolls back if the PUT fails — because a staff member who clicks it wants to
 * see the dashboard change, not watch a spinner. The server's answer is the
 * truth either way: what it returns replaces what was assumed.
 */

export default function SettingsPage() {
  const getToken = useGetToken()
  const settings = useReport(
    useCallback(
      (signal: AbortSignal) => {
        void signal
        return adminApi.settings(getToken)
      },
      [getToken],
    ),
  )
  const [override, setOverride] = useState<AdminSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const current = override ?? settings.data
  const onToggle = (value: boolean) => {
    if (!current) return
    const before = current
    const staff = before.settings[EXCLUDE_STAFF_SETTING]
    setOverride({
      settings: {
        ...before.settings,
        [EXCLUDE_STAFF_SETTING]: {
          value,
          default: staff?.default ?? true,
          updated_at: staff?.updated_at,
          updated_by: staff?.updated_by,
        },
      },
    })
    setSaving(true)
    setSaveError(null)
    adminApi.saveSettings(getToken, { [EXCLUDE_STAFF_SETTING]: value }).then(
      (saved) => {
        setOverride(saved)
        setSaving(false)
      },
      (error: unknown) => {
        setOverride(before)
        setSaving(false)
        setSaveError(
          error instanceof Error ? error.message : 'Could not save the setting',
        )
      },
    )
  }

  return (
    <PageFrame>
      <SettingsContent
        settings={{ ...settings, data: current }}
        saving={saving}
        saveError={saveError}
        onToggle={onToggle}
      />
    </PageFrame>
  )
}

export interface SettingsContentProps {
  settings: Report<AdminSettings>
  saving?: boolean
  saveError?: string | null
  onToggle?: (value: boolean) => void
}

export function SettingsContent({
  settings,
  saving = false,
  saveError = null,
  onToggle = () => {},
}: SettingsContentProps) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-base-content/70">
          Dashboard-wide switches. Saved on the server, so every admin sees the
          same numbers.
        </p>
      </header>
      {saveError && <ErrorPanel message={saveError} />}
      <Loaded report={settings} label="settings">
        {(data) => (
          <StaffToggle
            setting={data.settings[EXCLUDE_STAFF_SETTING]}
            saving={saving}
            onToggle={onToggle}
          />
        )}
      </Loaded>
    </div>
  )
}

function StaffToggle({
  setting,
  saving,
  onToggle,
}: {
  setting: Setting | undefined
  saving: boolean
  onToggle: (value: boolean) => void
}) {
  // The server did not know the key: the toggle cannot be shown as a value
  // it never reported, so it is shown as absent.
  if (!setting) {
    return (
      <div className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
        <p className="text-sm text-base-content/70">
          The server did not report the staff-exclusion setting.
        </p>
      </div>
    )
  }
  const on = setting.value
  return (
    <div className="rounded-xl bg-base-200/40 p-5 ring-1 ring-base-300/60">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2
            id="exclude-staff-label"
            className="text-base font-semibold text-base-content"
          >
            Exclude staff from audience and usage analytics
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-base-content/70">
            Applies to registered-account totals, growth, desktop presence and
            usage, widget analytics, and identified website analytics. It does
            not change payments or earnings, operational support totals, or
            anyone's analytics consent. Test and synthetic accounts stay
            excluded regardless.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-base-content/60">
            Measurements suppressed before this switch existed — staff daily
            activity and identified staff website sessions — were never stored
            and cannot be restored by turning it off.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="exclude-staff-label"
          disabled={saving}
          onClick={() => onToggle(!on)}
          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait ${
            on ? 'bg-primary' : 'bg-base-300'
          }`}
        >
          <span className="sr-only">{on ? 'On' : 'Off'}</span>
          <span
            aria-hidden
            className={`inline-block size-5 rounded-full bg-base-100 shadow transition-transform ${
              on ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-base-content/60">
        {saving && <Loader2 size={12} className="animate-spin" aria-hidden />}
        <span>
          {on ? 'On' : 'Off'}
          {setting.value === setting.default
            ? ' (default)'
            : ` (default ${setting.default ? 'on' : 'off'})`}
        </span>
        {setting.updated_at && (
          <span>
            · changed {new Date(setting.updated_at).toLocaleString()}
            {setting.updated_by ? ` by ${setting.updated_by}` : ''}
          </span>
        )}
        {!setting.updated_at && <span>· never changed</span>}
      </p>
    </div>
  )
}
