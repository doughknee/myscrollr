import { loadBoundedAdminReport } from './adminAnalytics'

export type ProductAnalyticsWindow = 7 | 30

export interface DailyProductCount {
  day: string
  count: number
}

export interface RetentionMetric {
  day: 1 | 7 | 30
  eligible: number
  returned: number
  rate: number
  available: boolean
  note?: string
}

export interface ProductAnalytics {
  generated_at: string
  collection_started_at: string | null
  days: ProductAnalyticsWindow
  enrolled_accounts: number
  activity: {
    dau: number
    wau: number
    mau: number
    curve: Array<DailyProductCount>
  }
  activation: {
    first_observed: number
    curve: Array<DailyProductCount>
    definition: string
  }
  retention: {
    d1: RetentionMetric
    d7: RetentionMetric
    d30: RetentionMetric
  }
  features: Array<{ category: string; accounts: number; share: number }>
  population_note: string
}

export function loadProductAnalytics(
  getToken: () => Promise<string | null>,
  days: ProductAnalyticsWindow,
  signal?: AbortSignal,
): Promise<ProductAnalytics> {
  return loadBoundedAdminReport(
    getToken,
    `/admin/product-analytics?days=${days}`,
    'Could not load product analytics',
    'Product analytics took too long. Please retry.',
    signal,
  )
}
