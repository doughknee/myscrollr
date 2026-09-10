import type { AdminOverview } from '../api/admin'

type State = {
  request: number
  data: AdminOverview | null
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'start'; request: number }
  | { type: 'success'; request: number; data: AdminOverview }
  | { type: 'error'; request: number; error: string }

export function overviewLoad(
  state: State = { request: 0, data: null, loading: true, error: null },
  action: Action,
): State {
  if (action.type === 'start') {
    return { ...state, request: action.request, loading: true, error: null }
  }
  if (action.request !== state.request) return state
  return action.type === 'success'
    ? { ...state, data: action.data, loading: false, error: null }
    : { ...state, error: action.error, loading: false }
}
