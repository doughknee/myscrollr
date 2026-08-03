/**
 * /channels — legacy URL for the widget catalog, which now lives at
 * /widgets. The site is statically hosted (no server-side 301s), so
 * the prerendered HTML carries a meta refresh plus a canonical to the
 * new URL; on the client the router replaces the entry immediately.
 */

import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

const NEW_URL = 'https://myscrollr.com/widgets'

export const Route = createFileRoute('/channels')({
  head: () => ({
    meta: [
      { title: 'Scrollr Widget Catalog' },
      // Static-host redirect: crawlers and no-JS visitors follow this.
      { httpEquiv: 'refresh', content: '0;url=/widgets' },
    ],
    links: [{ rel: 'canonical', href: NEW_URL }],
  }),
  component: ChannelsRedirect,
})

function ChannelsRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    navigate({ to: '/widgets', replace: true })
  }, [navigate])

  return (
    <div className="px-8 py-24 font-mono text-sm text-base-muted">
      The catalog moved to{' '}
      <Link to="/widgets" className="text-primary">
        myscrollr.com/widgets
      </Link>
      .
    </div>
  )
}
