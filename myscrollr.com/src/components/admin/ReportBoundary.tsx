import { Component } from 'react'
import { ErrorPanel } from './ui'
import type { ReactNode } from 'react'

interface Props {
  label: string
  resetKeys: Array<unknown>
  onRetry?: () => void
  children: ReactNode
}

/** A broken report must not remove the other reports or their navigation. */
export class ReportBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(previous: Props) {
    if (
      this.state.failed &&
      (previous.resetKeys.length !== this.props.resetKeys.length ||
        this.props.resetKeys.some((key, i) => key !== previous.resetKeys[i]))
    ) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section aria-label={`${this.props.label} unavailable`} className="py-5">
        <h2 className="mb-3 text-lg font-semibold">{this.props.label}</h2>
        <ErrorPanel
          message="This report could not be displayed. Retry to load a fresh copy. Other reports are still available."
          onRetry={this.props.onRetry}
        />
      </section>
    )
  }
}
