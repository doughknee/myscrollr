import { renderToStaticMarkup } from 'react-dom/server'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * Render a dashboard component to static markup inside a throwaway memory
 * router, so `<Link>` resolves to a real `href` and a test can assert that a
 * card's link carries the period. Test-only; nothing in the app imports it.
 */
export async function renderWithRouter(node: ReactNode): Promise<string> {
  const rootRoute = createRootRoute({ component: () => <>{node}</> })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return renderToStaticMarkup(<RouterProvider router={router} />)
}
