export interface AnalyticsPopulation {
  os?: string
  version?: string
  plan?: string
}

export function populationQuery(filters: AnalyticsPopulation = {}) {
  const params = new URLSearchParams()
  for (const key of ['os', 'version', 'plan'] as const) {
    if (filters[key]) params.set(key, filters[key])
  }
  return params.toString()
}

/** An older API may ignore new query parameters. Never label that as filtered. */
export function verifyPopulation<T>(
  value: T,
  filters: AnalyticsPopulation = {},
): T {
  if (!populationQuery(filters)) return value
  const applied = (value as { population?: AnalyticsPopulation }).population
  if (
    !applied ||
    (['os', 'version', 'plan'] as const).some(
      (key) => (applied[key] || '') !== (filters[key] || ''),
    )
  ) {
    throw new Error(
      'This API has not applied the selected filters yet. Clear filters to see all accounts, or connect the updated API.',
    )
  }
  return value
}
