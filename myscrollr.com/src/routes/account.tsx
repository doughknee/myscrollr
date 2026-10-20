import { createFileRoute } from '@tanstack/react-router'
import { AccountHub } from '@/components/account/AccountHub'
import { seo } from '@/lib/seo'

export const Route = createFileRoute('/account')({
  head: () =>
    seo({
      title: 'Account | Scrollr',
      description:
        'Manage your Scrollr account, subscription, and connected services.',
      path: '/account',
      noindex: true,
    }),
  component: AccountHub,
})
