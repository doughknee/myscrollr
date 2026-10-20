// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupportPage from './SupportPage'
import { AdminChrome } from './AdminShell'
import { cases, queue } from './supportFixtures'
import type { CaseDetail } from '@/api/admin'
import type { Root } from 'react-dom/client'

const roots: Array<Root> = []
afterEach(async () => {
  await act(() => roots.splice(0).forEach((root) => root.unmount()))
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function caseEvent() {
  vi.useFakeTimers()
  await act(async () => {
    mocks.onEvent!({ ticket_number: '752473' })
    await vi.advanceTimersByTimeAsync(450)
  })
  vi.useRealTimers()
}

/**
 * The Support workbench (SCROLLR-219).
 *
 * The risk in this page is not that it looks wrong — it is that a layout pass
 * quietly drops a verb, a status, or the phone layout. So the assertions are
 * about what survived: the pills are in the console bar and not above the
 * queue, every action button is still there with its label, the three
 * disclosures start closed and open on a click, and the width rules put the
 * reply in a third pane at 1440 and in one column at 390.
 */

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  supportQueue: vi.fn(),
  supportCase: vi.fn(),
  setAutoSendPaused: vi.fn(),
  unsubscribe: vi.fn(),
  holdDraft: vi.fn(),
  onConnection: null as null | ((connected: boolean) => void),
  onEvent: null as null | ((e: { ticket_number?: string }) => void),
}))

vi.mock('@/hooks/useGetToken', () => ({ useGetToken: () => mocks.token }))
vi.mock('@/api/admin', async () => {
  const actual = await vi.importActual('@/api/admin')
  return {
    ...actual,
    adminApi: {
      supportQueue: mocks.supportQueue,
      supportCase: mocks.supportCase,
      setAutoSendPaused: mocks.setAutoSendPaused,
      holdDraft: mocks.holdDraft,
    },
    // Report the stream as live, the way a connected console does.
    subscribeToSupportEvents: (
      _t: unknown,
      on: (e: { ticket_number?: string }) => void,
      setLive: (v: boolean) => void,
    ) => {
      mocks.onEvent = on
      mocks.onConnection = setLive
      setLive(true)
      return mocks.unsubscribe
    },
  }
})

/** jsdom has no matchMedia, and the third pane is a media query. */
function atWidth(px: number) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)
      return {
        matches: px >= min,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }
    },
  })
}

async function render(width: number): Promise<HTMLElement> {
  atWidth(width)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const rootRoute = createRootRoute({
    component: () => (
      <AdminChrome email="staff@example.com">
        <SupportPage />
      </AdminChrome>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/admin/support'] }),
  })
  await router.load()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(<RouterProvider router={router} />)
  })
  // One more flush for the queue read and the case read it triggers.
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

/** Click the queue card for one person, then let the case load. */
async function open(host: HTMLElement, name: string) {
  const card = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent.includes(name),
  )
  expect(card, `no queue card for ${name}`).toBeTruthy()
  await act(async () => {
    card!.click()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
  mocks.supportQueue.mockResolvedValue(queue)
  mocks.supportCase.mockImplementation((_t: unknown, ticket: string) =>
    Promise.resolve(
      (cases[ticket] as CaseDetail | undefined) ?? cases['752473'],
    ),
  )
})

describe('the page frame', () => {
  it('does not present a failed queue read as zero outstanding cases', async () => {
    mocks.supportQueue.mockRejectedValue(new Error('Queue read failed'))
    const host = await render(390)
    expect(host.textContent).toContain('Queue unavailable')
    expect(host.textContent).not.toContain('0 need you')
    expect(host.textContent).toContain('Retry queue')
  })

  it('puts the live and auto-send pills in the console bar, not above the queue', async () => {
    const host = await render(1440)
    const bar = host.querySelector('header')!
    expect(bar.textContent).toContain('connected')
    expect(bar.textContent).toContain('Auto-send on · 60 min hold')

    // The two stacked banners are gone: their sentences are now the pills'
    // titles, and nothing renders them in the body of the page.
    const main = host.querySelector('[aria-label="Staff workspace"]')!
    expect(main.textContent).not.toContain(
      'Live — holds and replies appear here without a refresh.',
    )
    expect(main.textContent).not.toContain('Pause sending')
  })

  it('keeps the auto-send pill a working switch', async () => {
    mocks.setAutoSendPaused.mockResolvedValue({
      ...queue.autosend,
      armed: false,
      paused: true,
    })
    const host = await render(1440)
    const pill = [
      ...host.querySelectorAll<HTMLButtonElement>('header button'),
    ].find((b) => b.textContent.includes('Auto-send'))!
    await act(async () => {
      pill.click()
    })
    expect(mocks.setAutoSendPaused).toHaveBeenCalledWith(mocks.token, true)
  })

  it('counts what needs you, what waits on them, and what is resolved', async () => {
    const host = await render(1440)
    const strip = host.querySelector(
      '[aria-label="Staff workspace"] > div > div',
    )!
    expect(strip.textContent).toContain('3 need you')
    expect(strip.textContent).toContain('2 waiting on them')
    expect(strip.textContent).toContain('2 resolved')
  })

  it('keeps every section, in order, and never reorders them', async () => {
    const host = await render(1440)
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual([
      'Paying customers',
      'Open',
      'Answered, waiting on them',
      'Resolved',
    ])
  })
})

describe('the live stream', () => {
  it('reconciles both queue and open case after reconnecting', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    mocks.supportQueue.mockClear()
    mocks.supportCase.mockClear()
    await act(async () => {
      mocks.onConnection!(false)
    })
    await act(async () => {
      mocks.onConnection!(true)
    })
    expect(mocks.supportQueue).toHaveBeenCalledTimes(1)
    expect(mocks.supportCase).toHaveBeenCalledWith(
      mocks.token,
      '752473',
      expect.any(AbortSignal),
    )
  })

  it('refetches queue and selected case once per burst, and again for a later one', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    vi.useFakeTimers()
    try {
      mocks.supportQueue.mockClear()
      mocks.supportCase.mockClear()
      for (let i = 0; i < 5; i++) {
        mocks.onEvent!({ ticket_number: '752473' })
        await vi.advanceTimersByTimeAsync(40)
      }
      expect(mocks.supportQueue).toHaveBeenCalledTimes(0)
      expect(mocks.supportCase).toHaveBeenCalledTimes(0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(mocks.supportQueue).toHaveBeenCalledTimes(1)
      expect(mocks.supportCase).toHaveBeenCalledTimes(1)
      mocks.onEvent!({})
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
      expect(mocks.supportQueue).toHaveBeenCalledTimes(2)
      expect(mocks.supportCase).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers hidden-tab events and reconnects, then catches up once on return', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    vi.useFakeTimers()
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    mocks.supportQueue.mockClear()
    mocks.supportCase.mockClear()
    await act(async () => {
      mocks.onEvent!({ ticket_number: '752473' })
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
      for (let n = 0; n < 5; n++) mocks.onEvent!({})
      mocks.onConnection!(true)
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mocks.supportQueue).not.toHaveBeenCalled()
    expect(mocks.supportCase).not.toHaveBeenCalled()
    await act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mocks.supportQueue).toHaveBeenCalledTimes(1)
    expect(mocks.supportCase).toHaveBeenCalledTimes(1)
    await act(() => roots.splice(0).forEach((root) => root.unmount()))
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mocks.supportQueue).toHaveBeenCalledTimes(1)
    expect(mocks.supportCase).toHaveBeenCalledTimes(1)
    expect(mocks.unsubscribe).toHaveBeenCalled()
  })
})

describe('the three panes', () => {
  it('gives the reply its own pane at 1440', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const aside = host.querySelector('aside')
    expect(aside).toBeTruthy()
    expect(aside!.querySelector('#reply-body')).toBeTruthy()
    // Exactly one reply box on the page — two would be two drafts.
    expect(host.querySelectorAll('#reply-body')).toHaveLength(1)
  })

  it('appends the reply to the conversation at 1024, still once', async () => {
    const host = await render(1024)
    await open(host, 'Morgan Ellis')
    expect(host.querySelector('aside')).toBeNull()
    expect(host.querySelectorAll('#reply-body')).toHaveLength(1)
  })

  it('keeps the phone layout: one pane and a way back', async () => {
    const host = await render(390)
    expect(host.querySelector('aside')).toBeNull()
    await open(host, 'Morgan Ellis')
    const back = [...host.querySelectorAll('button')].find((b) =>
      b.textContent.includes('All of support'),
    )
    expect(back).toBeTruthy()
    expect(back!.className).toContain('md:hidden')
    expect(host.querySelectorAll('#reply-body')).toHaveLength(1)
  })
})

describe('the case', () => {
  async function editReply(host: HTMLElement, value: string) {
    const input = host.querySelector<HTMLTextAreaElement>('#reply-body')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('retains an unsent reply when opening another ticket and returning', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    await editReply(host, 'My unsent reply')
    await open(host, 'Sam Pryor')
    expect(
      host.querySelector<HTMLTextAreaElement>('#reply-body')?.value,
    ).not.toBe('My unsent reply')
    await open(host, 'Morgan Ellis')
    expect(host.querySelector<HTMLTextAreaElement>('#reply-body')?.value).toBe(
      'My unsent reply',
    )
  })

  it('keeps edits through a failed background refresh and its retry', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    await editReply(host, 'Do not lose this')
    mocks.supportCase.mockRejectedValueOnce(new Error('Connection interrupted'))
    await caseEvent()
    expect(host.querySelector<HTMLTextAreaElement>('#reply-body')?.value).toBe(
      'Do not lose this',
    )
    expect(host.textContent).toContain('Your edits are kept')
    await open(host, 'Retry case')
    expect(host.textContent).not.toContain('Connection interrupted')
    expect(host.querySelector<HTMLTextAreaElement>('#reply-body')?.value).toBe(
      'Do not lose this',
    )
  })

  it('does not replace the selected case with a late action on another ticket', async () => {
    let finish!: (detail: CaseDetail) => void
    mocks.holdDraft.mockReturnValue(
      new Promise<CaseDetail>((resolve) => {
        finish = resolve
      }),
    )
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const hold = [
      ...host.querySelectorAll<HTMLButtonElement>('aside button'),
    ].find((b) => b.textContent === 'Hold')!
    await act(async () => {
      hold.click()
    })
    await open(host, 'Sam Pryor')
    const samReply =
      host.querySelector<HTMLTextAreaElement>('#reply-body')?.value
    await act(async () => {
      finish(cases['752473'])
    })
    expect(host.querySelector<HTMLTextAreaElement>('#reply-body')?.value).toBe(
      samReply,
    )
  })

  it('does not replace a newer draft with a delayed action on the previous draft', async () => {
    let finish!: (detail: CaseDetail) => void
    mocks.holdDraft.mockReturnValue(
      new Promise<CaseDetail>((resolve) => {
        finish = resolve
      }),
    )
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const hold = [
      ...host.querySelectorAll<HTMLButtonElement>('aside button'),
    ].find((b) => b.textContent === 'Hold')!
    await act(() => hold.click())
    const original = cases['752473']
    mocks.supportCase.mockResolvedValue({
      ...original,
      draft: {
        ...original.draft!,
        id: original.draft!.id + 1,
        body: 'A newer server draft',
      },
    })
    await caseEvent()
    expect(host.querySelector<HTMLTextAreaElement>('#reply-body')?.value).toBe(
      'A newer server draft',
    )
    await act(() => finish(original))
    expect(host.querySelector<HTMLTextAreaElement>('#reply-body')?.value).toBe(
      'A newer server draft',
    )
  })

  it('does not reopen a draft sent elsewhere while a Hold response was delayed', async () => {
    let finish!: (detail: CaseDetail) => void
    mocks.holdDraft.mockReturnValue(
      new Promise<CaseDetail>((resolve) => {
        finish = resolve
      }),
    )
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const hold = [
      ...host.querySelectorAll<HTMLButtonElement>('aside button'),
    ].find((b) => b.textContent === 'Hold')!
    await act(() => hold.click())
    const original = cases['752473']
    mocks.supportCase.mockResolvedValue({
      ...original,
      draft: { ...original.draft!, status: 'sent' },
    })
    await caseEvent()
    await act(() => finish(original))
    expect(host.querySelector('#reply-body')).toBeNull()
    expect(host.textContent).toContain('This draft is sent')
  })

  it('still offers every action, by name', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const labels = [...host.querySelectorAll('aside button')].map((b) =>
      b.textContent.trim(),
    )
    for (const verb of [
      'Send reply',
      'Ask something else',
      'Hold',
      'File as bug',
      'Link an issue',
      'Skip',
    ]) {
      expect(labels, `${verb} is missing`).toContain(verb)
    }
  })

  it('starts the three disclosures closed, and opens one on a click', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const closed = [...host.querySelectorAll('aside details')]
    expect(closed).toHaveLength(3)
    expect(closed.map((d) => (d as HTMLDetailsElement).open)).toEqual([
      false,
      false,
      false,
    ])
    expect(closed.map((d) => d.querySelector('summary')?.textContent)).toEqual([
      'Why it decided this',
      'What it knows and wants to ask',
      'Full diagnostics',
    ])

    const first = closed[0] as HTMLDetailsElement
    const summary = first.querySelector('summary') as HTMLElement
    await act(async () => {
      summary.click()
    })
    expect(first.open).toBe(true)
    expect(first.textContent).toContain('What the server decided')
  })

  it('keeps the hold countdown on the case, not in the bar', async () => {
    const host = await render(1440)
    await open(host, 'Sam Pryor')
    const bar = host.querySelector('header')!
    expect(bar.textContent).not.toContain('Sends in')
    const conversation = host.querySelector('[aria-label="Staff workspace"]')!
    expect(conversation.textContent).toContain('Sends in')
  })

  it('pauses a hidden hold countdown and resumes from the deadline', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(now)
    const heldCase = cases['900112']
    mocks.supportCase.mockResolvedValue({
      ...heldCase,
      hold: {
        ...heldCase.hold!,
        until: new Date(now + 120_000).toISOString(),
      },
    })
    const host = await render(1440)
    await open(host, 'Sam Pryor')
    expect(host.textContent).toContain('Sends in 2m 00s')
    let hidden = true
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(host.textContent).toContain('Sends in 2m 00s')
    await act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(host.textContent).toContain('Sends in 1m 30s')
  })

  it('lists the person’s other tickets under the open one', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const others = host.querySelector(
      '[aria-label="Staff workspace"]',
    )!.textContent
    expect(others).toContain('Their other tickets')
    expect(others).toContain('#584802')
    expect(others).toContain('#613084')
    // The open one is not repeated in its own list.
    expect(others).not.toContain('#752473 ')
  })
})
