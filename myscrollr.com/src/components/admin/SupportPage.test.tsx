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
import { parseSupportSearch } from '@/lib/adminSearch'

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
  skipDraft: vi.fn(),
  dismissCase: vi.fn(),
  restoreCase: vi.fn(),
  prepareReply: vi.fn(),
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
      skipDraft: mocks.skipDraft,
      dismissCase: mocks.dismissCase,
      restoreCase: mocks.restoreCase,
      prepareReply: mocks.prepareReply,
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

async function render(width: number, query?: string): Promise<HTMLElement> {
  atWidth(width)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const rootRoute = createRootRoute({
    component: () => (
      <AdminChrome email="staff@example.com">
        <SupportPage
          {...(query ? { search: parseSupportSearch({ q: query }) } : {})}
        />
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
  it.each(['', 'missing-ticket'])(
    'explains an empty queue for search "%s"',
    async (query) => {
      mocks.supportQueue.mockResolvedValue({ ...queue, people: [], rows: [] })
      const host = await render(320, query)
      expect(host.textContent).toContain(
        query ? 'No matching conversations' : 'No conversations yet',
      )
      expect(host.textContent).not.toContain(
        'No tickets linked to a paying account.',
      )
      expect(
        [...host.querySelectorAll('button')].some(
          (button) => button.textContent === 'Clear search',
        ),
      ).toBe(Boolean(query))
    },
  )

  it('keeps a failed dismissal open with an accessible explanation', async () => {
    mocks.dismissCase.mockRejectedValue(
      new Error('Connection interrupted. Try again.'),
    )
    const host = await render(320)
    await open(host, 'Morgan Ellis')
    await open(host, 'Dismiss ticket')
    await open(host, 'Dismiss without replying')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Ticket not updated',
    )
    expect(
      host.querySelector('[aria-label="Dismiss without replying"]'),
    ).toBeTruthy()
    expect(host.textContent).toContain('Connection interrupted. Try again.')
  })
  it.each([390, 1440])('moves focus into a case at %ipx', async (width) => {
    const host = await render(width)
    await open(host, 'Morgan Ellis')
    const back = [...host.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Back to queue'),
    )!
    expect(document.activeElement).toBe(
      width < 768
        ? back
        : host.querySelector('[aria-label="Support conversation"]'),
    )
    if (width < 768) {
      await act(() => back.click())
      expect(document.activeElement?.textContent).toContain('Morgan Ellis')
      expect(document.activeElement?.tagName).toBe('BUTTON')
    }
  })

  it('returns focus to search if the originating queue row disappears', async () => {
    const host = await render(390)
    await open(host, 'Morgan Ellis')
    mocks.supportQueue.mockResolvedValue({
      ...queue,
      people: queue.people?.filter((p) => p.key !== 'morgan'),
    })
    await caseEvent()
    const back = [...host.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Back to queue'),
    )!
    await act(() => back.click())
    expect(document.activeElement).toBe(
      host.querySelector('[aria-label="Search people and tickets"]'),
    )
  })

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
    const strip = host.querySelector('[aria-label="Support queue views"]')!
    expect(strip.textContent).toContain('Needs you3')
    expect(strip.textContent).toContain('Waiting2')
    expect(strip.textContent).toContain('Handled2')
  })

  it('keeps every section, in order, and never reorders them', async () => {
    const host = await render(1440)
    const headings = [...host.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual([
      'Paying customers',
      'Open',
      'Answered, waiting on them',
      'Resolved',
      'Select a conversation',
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
      b.textContent.includes('Back to queue'),
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
      group: 'waiting',
    })
    await caseEvent()
    await act(() => finish(original))
    expect(host.querySelector('#reply-body')).toBeNull()
    expect(host.textContent).toContain('This draft is sent')
  })

  it.each([390, 1440])(
    'makes an unanswered follow-up actionable at %ipx without reusing the sent draft',
    async (width) => {
      const original = cases['752473']
      const reason =
        'The user wrote after the latest reply or draft, so this needs a new answer.'
      const followUp: CaseDetail = {
        ...original,
        group: 'needs_you',
        group_reason: reason,
        hold: undefined,
        draft: {
          ...original.draft!,
          status: 'sent',
          disposition_reason: 'OLD REASON',
        },
      }
      mocks.supportCase.mockResolvedValue(followUp)
      const host = await render(width)
      await open(host, 'Morgan Ellis')
      expect(host.textContent).toContain(reason)
      expect(host.textContent).toContain('Customer needs an answer')
      expect(
        host.querySelector('.admin-reply-controls')?.textContent,
      ).not.toContain('This draft is sent')
      const input = host.querySelector<HTMLTextAreaElement>('#new-reply-body')!
      expect(input.value).toBe('')
      await act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )!.set!.call(input, 'Thanks for the update. A new answer.')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const saved = {
        ...followUp,
        draft: {
          ...original.draft!,
          id: original.draft!.id + 1,
          body: input.value,
          status: 'pending',
        },
      }
      mocks.prepareReply.mockResolvedValue(saved)
      const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Save reply for review',
      )!
      await act(async () => save.click())
      expect(mocks.prepareReply).toHaveBeenCalledWith(
        mocks.token,
        original.ticket_number,
        'Thanks for the update. A new answer.',
        original.draft!.id,
      )
      expect(
        host.querySelector<HTMLTextAreaElement>('#reply-body')?.value,
      ).toBe(saved.draft.body)
      expect(host.querySelector('#new-reply-body')).toBeNull()
      expect(host.textContent).toContain('Send reply')
    },
  )

  it('still offers every action, by name', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const labels = [...host.querySelectorAll('button')].map((b) =>
      b.textContent.trim(),
    )
    for (const verb of [
      'Send reply',
      'Ask something else',
      'Hold',
      'File as bug',
      'Link an issue',
      'Dismiss ticket',
    ]) {
      expect(labels, `${verb} is missing`).toContain(verb)
    }
  })

  it('confirms dismissing the selected pending reply without sending', async () => {
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const findButton = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent.trim() === label,
      )!
    await act(() => findButton('Dismiss ticket').click())
    expect(mocks.dismissCase).not.toHaveBeenCalled()
    expect(host.textContent).toContain('without emailing anyone')
    const detail = cases['752473']
    mocks.dismissCase.mockResolvedValue({
      ...detail,
      draft: { ...detail.draft!, status: 'skipped' },
    })
    await act(() => findButton('Dismiss without replying').click())
    expect(mocks.dismissCase).toHaveBeenCalledWith(
      mocks.token,
      detail.ticket_number,
    )
    expect(host.querySelector('#reply-body')).toBeNull()
  })

  it('dismisses and restores a ticket with no draft', async () => {
    const detail = {
      ...cases['752473'],
      draft: null,
      user_email: undefined,
      user_name: undefined,
    }
    mocks.supportCase.mockResolvedValue(detail)
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const button = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (el) => el.textContent.trim() === label,
      )!
    await act(() => button('Dismiss ticket').click())
    const dismissed = {
      ...detail,
      console_status: 'dismissed' as const,
      group: 'handled',
      group_reason: 'Dismissed',
    }
    mocks.dismissCase.mockResolvedValue(dismissed)
    await act(() => button('Dismiss without replying').click())
    expect(mocks.dismissCase).toHaveBeenCalledWith(
      mocks.token,
      detail.ticket_number,
    )
    expect(button('Restore ticket')).toBeDefined()
    expect(host.querySelector('#reply-body')).toBeNull()
    mocks.restoreCase.mockResolvedValue({
      ...detail,
      console_status: 'review',
      group: 'needs_you',
    })
    await act(() => button('Restore ticket').click())
    expect(mocks.restoreCase).toHaveBeenCalledWith(
      mocks.token,
      detail.ticket_number,
    )
    expect(button('Dismiss ticket')).toBeDefined()
    expect(host.querySelector('#reply-body')).toBeNull()
  })

  it('folds diagnostics and internal activity while keeping the customer message readable', async () => {
    const detail = cases['752473']
    mocks.supportCase.mockResolvedValue({
      ...detail,
      messages: [
        {
          kind: 'user',
          created_at: '2026-10-20T10:00:00Z',
          body: 'My ticker stopped.\nSystem Diagnostics{"os":"windows"}\nThanks.',
        },
        {
          kind: 'ai_draft',
          created_at: '2026-10-20T10:01:00Z',
          body: 'Unsent proposal',
        },
        {
          kind: 'sent',
          created_at: '2026-10-20T10:02:00Z',
          body: 'Delivered reply',
        },
      ],
    })
    const host = await render(1440)
    await open(host, 'Morgan Ellis')
    const attachment = [...host.querySelectorAll('details')].find((node) =>
      node.querySelector('summary')?.textContent.includes('System diagnostics'),
    )!
    expect(attachment.open).toBe(false)
    expect(attachment.textContent).toContain('"os":"windows"')
    const message = attachment.closest('article')!
    expect(message.querySelector('p')?.textContent).toBe(
      'My ticker stopped.\n\nThanks.',
    )
    const activity = [...host.querySelectorAll('details')].find((node) =>
      node.querySelector('summary')?.textContent.includes('Bot activity'),
    )!
    expect(activity.open).toBe(false)
    expect(activity.textContent).toContain('Unsent proposal')
    expect(activity.textContent).not.toContain('Delivered reply')
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

it('filters mixed-state people and opens the matching waiting ticket', async () => {
  const host = await render(390)
  const waiting = host.querySelectorAll<HTMLButtonElement>(
    '[aria-label="Support queue views"] button',
  )[2]
  await act(() => waiting.click())
  const cards = Array.from(
    host.querySelectorAll<HTMLButtonElement>('[data-support-row]'),
  )
  expect(cards.map((c) => c.dataset.supportRow)).toEqual([
    'person:morgan',
    'person:sam',
  ])
  expect(cards[0].textContent).not.toContain('needs you')
  await act(async () => cards[0].click())
  expect(mocks.supportCase).toHaveBeenLastCalledWith(
    mocks.token,
    '584802',
    expect.any(AbortSignal),
  )
  expect(host.querySelector('a[href*="view=support"]')?.textContent).toContain(
    'Performance',
  )
})

it('shows handled tickets without requiring the resolved disclosure', async () => {
  const host = await render(1440)
  await act(() =>
    host
      .querySelectorAll<HTMLButtonElement>(
        '[aria-label="Support queue views"] button',
      )[3]
      .click(),
  )
  expect(
    host.querySelector('[data-support-row="person:morgan"]'),
  ).not.toBeNull()
  expect(host.querySelector('[data-support-row="person:sam"]')).toBeNull()
  expect(host.querySelector('[aria-label="Show resolved"]')).toBeNull()
})
