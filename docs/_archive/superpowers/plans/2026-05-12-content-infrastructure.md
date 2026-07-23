# Content Infrastructure Implementation Plan (Blog + Docs + Changelog)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plan `2026-05-12-marketing-seo-ssg-migration.md` must be completed first. This plan assumes TanStack Start, the `seo()` helper, and JSON-LD templates already exist.

**Goal:** Add three content surfaces — `/blog`, `/docs`, `/changelog` — to the marketing site, each prerendered at build time with full per-page SEO. Content is authored as MDX (Markdown + React components) and lives in the repo.

**Architecture:** MDX content under `myscrollr.com/content/{blog,docs,changelog}/*.mdx`. A build-time content layer (using `gray-matter` for frontmatter and `@mdx-js/rollup` for compilation) generates virtual modules consumed by TanStack Router routes. Index routes (`/blog`, `/docs`, `/changelog`) list entries; detail routes (`/blog/$slug`, etc.) render individual posts. All content routes are prerendered.

**Tech Stack:** `@mdx-js/rollup`, `gray-matter`, `rehype-slug`, `rehype-autolink-headings`, `rehype-pretty-code` (syntax highlighting via Shiki), `remark-gfm`. Reading-time estimation via `reading-time` package.

**Authoring model:** A single `.mdx` file per entry. Frontmatter for metadata. Body is Markdown with embedded React components allowed.

---

## Task 1: Install MDX toolchain

**Files:**
- Modify: `myscrollr.com/package.json`

- [ ] **Step 1: Install runtime deps**

```bash
cd myscrollr.com && npm install @mdx-js/rollup @mdx-js/react gray-matter reading-time
```

- [ ] **Step 2: Install rehype/remark plugins**

```bash
cd myscrollr.com && npm install --save-dev \
  rehype-slug \
  rehype-autolink-headings \
  rehype-pretty-code \
  remark-gfm \
  shiki
```

- [ ] **Step 3: Install MDX type support**

```bash
cd myscrollr.com && npm install --save-dev @types/mdx
```

- [ ] **Step 4: Verify install**

```bash
cd myscrollr.com && npm run build
```

Expected: build succeeds (no MDX integration yet — just verifying deps don't conflict).

- [ ] **Step 5: Commit**

```bash
cd myscrollr.com && git add package.json package-lock.json
git commit -m "chore(myscrollr.com): add MDX + content toolchain"
```

---

## Task 2: Configure Vite to compile MDX

**Files:**
- Modify: `myscrollr.com/vite.config.ts`
- Create: `myscrollr.com/src/mdx.d.ts`

- [ ] **Step 1: Wire MDX plugin into Vite**

Update `myscrollr.com/vite.config.ts`:
```ts
import { readFileSync } from 'node:fs'
import { URL, fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    'utf8',
  ),
)

export default defineConfig({
  plugins: [
    // MDX must come BEFORE viteReact so JSX from .mdx is handled
    {
      enforce: 'pre',
      ...mdx({
        providerImportSource: '@mdx-js/react',
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: 'append' }],
          [
            rehypePrettyCode,
            {
              theme: { dark: 'github-dark', light: 'github-light' },
              keepBackground: false,
            },
          ],
        ],
      }),
    },
    tanstackStart({
      target: 'static',
      router: { autoCodeSplitting: true },
      spa: { enabled: true },
      prerender: {
        enabled: true,
        crawlLinks: true,
        filter: ({ path }: { path: string }) => {
          const excluded = ['/account', '/callback', '/invite', '/status']
          if (excluded.includes(path)) return false
          if (path.startsWith('/u/')) return false
          return true
        },
        autoStaticPathsDiscovery: true,
      },
    }),
    viteReact(),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

- [ ] **Step 2: Add MDX TypeScript declaration**

Create `myscrollr.com/src/mdx.d.ts`:
```ts
declare module '*.mdx' {
  import type { MDXProps } from 'mdx/types'
  const MDXComponent: (props: MDXProps) => JSX.Element
  export default MDXComponent
  export const frontmatter: Record<string, unknown>
}
```

- [ ] **Step 3: Update `tsconfig.json` to include the .d.ts**

If `tsconfig.json` has an `include` array, ensure `src/**/*` covers it. Otherwise no change needed.

- [ ] **Step 4: Smoke test**

Create a throwaway `myscrollr.com/content/test.mdx`:
```mdx
# Hello

This is a test MDX file. Code block:

\`\`\`ts
const x: number = 42
\`\`\`
```

In `myscrollr.com/src/main.tsx`, temporarily add:
```ts
import Test from '../content/test.mdx'
console.log(Test) // verify the import resolves
```

Run `npm run dev`. Browser console should log a React component function (not `undefined`).

- [ ] **Step 5: Revert smoke test and commit**

Delete the temporary test code and file. Commit the config:

```bash
cd myscrollr.com && rm -f content/test.mdx
# revert main.tsx changes
git add vite.config.ts src/mdx.d.ts
git commit -m "feat(myscrollr.com): configure Vite to compile MDX with code highlighting"
```

---

## Task 3: Build a content loader module

**Files:**
- Create: `myscrollr.com/src/lib/content.ts`

**Rationale:** Single source of truth for loading and listing MDX content. Uses Vite's `import.meta.glob` to enumerate files at build time — no runtime filesystem access required (which is mandatory for static prerender).

- [ ] **Step 1: Write the loader**

Create `myscrollr.com/src/lib/content.ts`:
```ts
import matter from 'gray-matter'
import readingTime from 'reading-time'

export type ContentKind = 'blog' | 'docs' | 'changelog'

export type ContentEntry = {
  slug: string
  kind: ContentKind
  title: string
  description: string
  date: string // ISO date "YYYY-MM-DD"
  author?: string
  tags: Array<string>
  readingMinutes: number
  /** Body component returned by MDX import */
  Component: React.ComponentType
  /** Raw markdown for OG image generation or LLM digests */
  raw: string
}

type RawEntry = {
  raw: string
  Component: React.ComponentType
}

// Vite glob imports — evaluated at build time.
// Each .mdx file exports its compiled React component as `default`.
const blogModules = import.meta.glob<{ default: React.ComponentType }>(
  '../../content/blog/*.mdx',
  { eager: true },
)
const docsModules = import.meta.glob<{ default: React.ComponentType }>(
  '../../content/docs/*.mdx',
  { eager: true },
)
const changelogModules = import.meta.glob<{ default: React.ComponentType }>(
  '../../content/changelog/*.mdx',
  { eager: true },
)

// Raw text imports — for frontmatter parsing + LLM digest export.
// `?raw` suffix tells Vite to import the file contents as a string.
const blogRaws = import.meta.glob<string>('../../content/blog/*.mdx', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const docsRaws = import.meta.glob<string>('../../content/docs/*.mdx', {
  eager: true,
  query: '?raw',
  import: 'default',
})
const changelogRaws = import.meta.glob<string>('../../content/changelog/*.mdx', {
  eager: true,
  query: '?raw',
  import: 'default',
})

function buildEntries(
  kind: ContentKind,
  modules: Record<string, { default: React.ComponentType }>,
  raws: Record<string, string>,
): Array<ContentEntry> {
  return Object.entries(modules).map(([path, mod]) => {
    const slug = path.replace(/.*\//, '').replace(/\.mdx$/, '')
    const raw = raws[path] ?? ''
    const { data } = matter(raw)

    const title = typeof data.title === 'string' ? data.title : slug
    const description =
      typeof data.description === 'string' ? data.description : ''
    const date = typeof data.date === 'string' ? data.date : '1970-01-01'
    const author = typeof data.author === 'string' ? data.author : undefined
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((t): t is string => typeof t === 'string')
      : []

    const { minutes } = readingTime(raw)

    return {
      slug,
      kind,
      title,
      description,
      date,
      author,
      tags,
      readingMinutes: Math.max(1, Math.round(minutes)),
      Component: mod.default,
      raw,
    }
  })
}

const ALL_ENTRIES: Array<ContentEntry> = [
  ...buildEntries('blog', blogModules, blogRaws),
  ...buildEntries('docs', docsModules, docsRaws),
  ...buildEntries('changelog', changelogModules, changelogRaws),
].sort((a, b) => b.date.localeCompare(a.date))

export function listEntries(kind: ContentKind): Array<ContentEntry> {
  return ALL_ENTRIES.filter((e) => e.kind === kind)
}

export function getEntry(
  kind: ContentKind,
  slug: string,
): ContentEntry | undefined {
  return ALL_ENTRIES.find((e) => e.kind === kind && e.slug === slug)
}

export function listSlugs(kind: ContentKind): Array<string> {
  return listEntries(kind).map((e) => e.slug)
}

export function listAllEntries(): Array<ContentEntry> {
  return ALL_ENTRIES
}
```

- [ ] **Step 2: Create the content directories with placeholder files**

```bash
cd myscrollr.com && mkdir -p content/blog content/docs content/changelog
```

Create a starter blog post `myscrollr.com/content/blog/welcome.mdx`:
```mdx
---
title: Welcome to the Scrollr blog
description: A new place to share product updates, technical deep-dives, and what we're learning building Scrollr.
date: 2026-05-12
author: Brandon Ruth
tags:
  - announcement
---

We're starting a blog to share what we're learning building Scrollr.

Expect three kinds of posts here:

1. **Product updates** — what shipped, what's coming next, why.
2. **Technical deep-dives** — how things work behind the scenes. The architecture page is the appetizer; this is the main course.
3. **Field notes** — short-form observations on real-time data, desktop UX, and the engineering of staying out of the way.

The goal isn't volume. It's clarity. We'll publish when we have something worth saying.

— The Scrollr team
```

Create a starter doc `myscrollr.com/content/docs/getting-started.mdx`:
```mdx
---
title: Getting started with Scrollr
description: Install Scrollr, pick your channels, and customize the ticker in under five minutes.
date: 2026-05-12
order: 1
tags:
  - basics
---

## Install

1. Visit [the download page](/download).
2. Pick your platform — macOS, Windows, or Linux.
3. Open the installer.

> No account needed to get started. You can use Scrollr completely anonymously.

## Pick channels

The first time you launch Scrollr, the welcome screen lets you pick channels. Each channel is a data source — finance, sports, news, or fantasy.

You can add and remove channels at any time from Settings → Channels.

## Customize

Settings → Appearance lets you adjust:

- **Size** — independent scale for the ticker and main window.
- **Position** — top or bottom of any screen.
- **Speed** — how fast the ticker scrolls.
- **Theme** — light, dark, or follow system.

That's it. Scrollr should now be running quietly at the edge of your screen.
```

Create a starter changelog entry `myscrollr.com/content/changelog/v2.1.0.mdx`:
```mdx
---
title: v2.1.0 — Marketing site overhaul
description: The myscrollr.com site is now statically prerendered with full SEO, structured data, and AI-crawler-friendly artifacts.
date: 2026-05-12
version: 2.1.0
tags:
  - website
---

### Marketing site changes

- **Static prerender:** every marketing page now ships as fully rendered HTML. Social previews work everywhere — Facebook, LinkedIn, Slack, Discord, Twitter, iMessage.
- **Per-page meta:** unique title, description, and OpenGraph image for every public route.
- **Structured data:** JSON-LD added for Organization, SoftwareApplication, Product, and FAQ. Google can now show rich results in search.
- **Content surfaces:** new `/blog`, `/docs`, and `/changelog` routes.
- **AI crawler support:** `llms.txt` published. Explicit robots rules for GPTBot, ClaudeBot, PerplexityBot, and friends.

No changes to the desktop app in this release.
```

- [ ] **Step 3: Verify content loader works**

In a temporary script `myscrollr.com/scripts/check-content.mjs`:
```js
// This won't actually run via node — it's a placeholder for the verification step.
// Instead, verify via the dev server:
```

Just run `npm run dev` and visit any existing route. The dev server should boot without errors. The content loader is `import`-only — it doesn't execute on page load unless a route imports it.

- [ ] **Step 4: Commit**

```bash
cd myscrollr.com && git add src/lib/content.ts content/
git commit -m "feat(myscrollr.com): add MDX content loader with frontmatter parsing"
```

---

## Task 4: Build shared content presentational components

**Files:**
- Create: `myscrollr.com/src/components/content/ProseLayout.tsx`
- Create: `myscrollr.com/src/components/content/ContentMeta.tsx`
- Create: `myscrollr.com/src/components/content/MdxProvider.tsx`
- Create: `myscrollr.com/src/styles/prose.css`

**Rationale:** All three content surfaces share the same article layout (typography, code blocks, headings). Centralize once.

- [ ] **Step 1: Create the prose stylesheet**

Tailwind v4 zero-config means we can't use `@tailwindcss/typography` as a plugin the usual way. Define prose styles manually in `myscrollr.com/src/styles/prose.css`:

```css
.prose {
  --prose-body: var(--color-base-content);
  --prose-headings: var(--color-base-content);
  --prose-links: var(--color-primary);
  --prose-code: var(--color-base-content);
  --prose-quotes: var(--color-base-content);
  --prose-bullets: color-mix(in oklab, var(--color-base-content) 50%, transparent);
  --prose-borders: color-mix(in oklab, var(--color-base-content) 15%, transparent);

  color: var(--prose-body);
  max-width: 65ch;
  line-height: 1.7;
  font-size: 1.0625rem;
}

.prose h1, .prose h2, .prose h3, .prose h4 {
  color: var(--prose-headings);
  font-weight: 700;
  letter-spacing: -0.02em;
  scroll-margin-top: 6rem;
}

.prose h1 { font-size: 2.5rem; margin-top: 0; margin-bottom: 1.5rem; line-height: 1.15; }
.prose h2 { font-size: 1.875rem; margin-top: 3rem; margin-bottom: 1rem; line-height: 1.25; }
.prose h3 { font-size: 1.375rem; margin-top: 2.25rem; margin-bottom: 0.75rem; line-height: 1.35; }
.prose h4 { font-size: 1.125rem; margin-top: 1.75rem; margin-bottom: 0.5rem; }

.prose p { margin-top: 1.25rem; margin-bottom: 1.25rem; }
.prose p:first-child { margin-top: 0; }
.prose p:last-child { margin-bottom: 0; }

.prose a {
  color: var(--prose-links);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: text-decoration-thickness 150ms ease;
}
.prose a:hover { text-decoration-thickness: 2px; }

.prose ul, .prose ol { margin-top: 1.25rem; margin-bottom: 1.25rem; padding-left: 1.5rem; }
.prose li { margin-top: 0.5rem; margin-bottom: 0.5rem; }
.prose ul li::marker { color: var(--prose-bullets); }
.prose ol li::marker { color: var(--prose-bullets); font-variant-numeric: tabular-nums; }

.prose blockquote {
  border-left: 3px solid var(--prose-borders);
  padding-left: 1.25rem;
  margin: 1.5rem 0;
  font-style: italic;
  color: color-mix(in oklab, var(--prose-body) 80%, transparent);
}

.prose code:not(pre code) {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.9em;
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

.prose pre {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  background: color-mix(in oklab, var(--color-base-content) 5%, transparent);
  border: 1px solid var(--prose-borders);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  margin: 1.5rem 0;
}

.prose pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
}

.prose img {
  margin: 2rem auto;
  border-radius: 8px;
  max-width: 100%;
  height: auto;
}

.prose hr {
  border: none;
  border-top: 1px solid var(--prose-borders);
  margin: 3rem 0;
}

.prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5rem 0;
  font-size: 0.9375rem;
}

.prose th, .prose td {
  border: 1px solid var(--prose-borders);
  padding: 0.625rem 0.875rem;
  text-align: left;
}

.prose th {
  background: color-mix(in oklab, var(--color-base-content) 5%, transparent);
  font-weight: 600;
}

/* Heading anchors (from rehype-autolink-headings) */
.prose .anchor {
  margin-left: 0.5rem;
  opacity: 0;
  transition: opacity 150ms ease;
  text-decoration: none;
  color: var(--prose-bullets);
}
.prose h1:hover .anchor,
.prose h2:hover .anchor,
.prose h3:hover .anchor,
.prose h4:hover .anchor { opacity: 1; }
```

- [ ] **Step 2: Import the stylesheet**

In `myscrollr.com/src/styles.css`, add at the top:
```css
@import './styles/prose.css';
```

- [ ] **Step 3: Build the prose layout component**

Create `myscrollr.com/src/components/content/ProseLayout.tsx`:
```tsx
import type { ReactNode } from 'react'

interface ProseLayoutProps {
  children: ReactNode
  sidebar?: ReactNode
}

export function ProseLayout({ children, sidebar }: ProseLayoutProps) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-16 lg:py-24">
      <div
        className={`grid gap-12 ${sidebar ? 'lg:grid-cols-[16rem_minmax(0,1fr)]' : ''}`}
      >
        {sidebar && (
          <aside className="hidden lg:block">
            <div className="sticky top-24">{sidebar}</div>
          </aside>
        )}
        <article className="prose mx-auto w-full">{children}</article>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build the content meta header component**

Create `myscrollr.com/src/components/content/ContentMeta.tsx`:
```tsx
import type { ContentEntry } from '@/lib/content'

interface ContentMetaProps {
  entry: ContentEntry
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export function ContentMeta({ entry }: ContentMetaProps) {
  // Parse date as local to avoid TZ off-by-one
  const [y, m, d] = entry.date.split('-').map(Number)
  const date = new Date(y, m - 1, d)

  return (
    <header className="mb-8 not-prose">
      {entry.tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {entry.tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-base-200 px-3 py-1 text-xs font-medium uppercase tracking-wider text-base-content/70"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        {entry.title}
      </h1>
      <p className="mt-4 text-lg text-base-content/70">{entry.description}</p>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-base-content/60">
        <time dateTime={entry.date}>{dateFormatter.format(date)}</time>
        {entry.author && (
          <>
            <span aria-hidden="true">•</span>
            <span>By {entry.author}</span>
          </>
        )}
        <span aria-hidden="true">•</span>
        <span>{entry.readingMinutes} min read</span>
      </div>
    </header>
  )
}
```

- [ ] **Step 5: Build the MDX provider component**

Create `myscrollr.com/src/components/content/MdxProvider.tsx`:
```tsx
import { MDXProvider } from '@mdx-js/react'
import type { MDXComponents } from 'mdx/types'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

const components: MDXComponents = {
  // Use TanStack Router's Link for internal links so client-side nav works
  a: ({ href, children, ...rest }) => {
    if (href && href.startsWith('/')) {
      return (
        <Link to={href} {...(rest as Record<string, unknown>)}>
          {children}
        </Link>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  },
}

export function MdxProvider({ children }: { children: ReactNode }) {
  return <MDXProvider components={components}>{children}</MDXProvider>
}
```

- [ ] **Step 6: Type-check and commit**

```bash
cd myscrollr.com && npx tsc --noEmit
git add src/components/content/ src/styles/prose.css src/styles.css
git commit -m "feat(myscrollr.com): add shared content presentational components"
```

---

## Task 5: Build `/blog` index and `/blog/$slug` detail routes

**Files:**
- Create: `myscrollr.com/src/routes/blog.index.tsx`
- Create: `myscrollr.com/src/routes/blog.$slug.tsx`

**Rationale:** Two routes — index lists all posts, detail renders the MDX. Both prerendered.

- [ ] **Step 1: Create the index route**

Create `myscrollr.com/src/routes/blog.index.tsx`:
```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'
import { listEntries } from '@/lib/content'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export const Route = createFileRoute('/blog/')({
  head: () =>
    seo({
      title: 'Blog — Scrollr',
      description:
        'Product updates, technical deep-dives, and field notes from the Scrollr team.',
      path: '/blog',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Blog', path: '/blog' },
      ]),
    }),
  component: BlogIndex,
})

function BlogIndex() {
  const posts = listEntries('blog')

  return (
    <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Blog
        </h1>
        <p className="mt-4 text-lg text-base-content/70">
          Product updates, technical deep-dives, and field notes.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="text-base-content/60">No posts yet — check back soon.</p>
      ) : (
        <ul className="space-y-12 border-t border-base-300 pt-12">
          {posts.map((p) => {
            const [y, m, d] = p.date.split('-').map(Number)
            const date = new Date(y, m - 1, d)
            return (
              <li key={p.slug} className="group">
                <Link
                  to="/blog/$slug"
                  params={{ slug: p.slug }}
                  className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg"
                >
                  <article>
                    <time
                      dateTime={p.date}
                      className="text-sm text-base-content/60"
                    >
                      {dateFormatter.format(date)}
                    </time>
                    <h2 className="mt-2 text-2xl font-bold tracking-tight group-hover:text-primary transition-colors">
                      {p.title}
                    </h2>
                    <p className="mt-3 text-base text-base-content/70">
                      {p.description}
                    </p>
                    <div className="mt-4 flex items-center gap-3 text-sm text-base-content/60">
                      {p.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-base-200 px-2.5 py-0.5 text-xs font-medium"
                        >
                          {t}
                        </span>
                      ))}
                      <span aria-hidden>•</span>
                      <span>{p.readingMinutes} min read</span>
                    </div>
                  </article>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the detail route**

Create `myscrollr.com/src/routes/blog.$slug.tsx`:
```tsx
import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'
import { getEntry, listSlugs } from '@/lib/content'
import { ProseLayout } from '@/components/content/ProseLayout'
import { ContentMeta } from '@/components/content/ContentMeta'
import { MdxProvider } from '@/components/content/MdxProvider'

export const Route = createFileRoute('/blog/$slug')({
  // Static path discovery for prerender — Start uses this to enumerate slugs at build time
  staticData: {
    paths: () =>
      listSlugs('blog').map((slug) => ({ slug })),
  },
  loader: ({ params }) => {
    const entry = getEntry('blog', params.slug)
    if (!entry) throw notFound()
    return { entry }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [], links: [] }
    const { entry } = loaderData
    return seo({
      title: `${entry.title} — Scrollr Blog`,
      description: entry.description,
      path: `/blog/${entry.slug}`,
      type: 'article',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: entry.title,
          description: entry.description,
          datePublished: entry.date,
          author: { '@type': 'Person', name: entry.author ?? 'Scrollr team' },
          keywords: entry.tags.join(', '),
        },
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Blog', path: '/blog' },
          { name: entry.title, path: `/blog/${entry.slug}` },
        ]),
      ],
    })
  },
  component: BlogPost,
})

function BlogPost() {
  const { entry } = Route.useLoaderData()
  const Body = entry.Component

  return (
    <ProseLayout>
      <ContentMeta entry={entry} />
      <MdxProvider>
        <Body />
      </MdxProvider>
      <hr className="my-12" />
      <p className="not-prose">
        <Link
          to="/blog"
          className="text-primary hover:underline text-sm font-medium"
        >
          ← Back to all posts
        </Link>
      </p>
    </ProseLayout>
  )
}
```

- [ ] **Step 3: Build and verify the blog routes render**

```bash
cd myscrollr.com && npm run dev
```

Visit:
- `http://localhost:3000/blog` — should show the welcome post in the list
- `http://localhost:3000/blog/welcome` — should render the MDX content with prose styling

If `Route.useLoaderData()` doesn't exist (older TanStack Router API), use `Route.useParams()` to get the slug and call `getEntry` directly in the component.

- [ ] **Step 4: Verify prerender at build time**

```bash
cd myscrollr.com && npm run build
ls myscrollr.com/dist/client/blog/
```

Expected:
- `index.html` (the listing)
- `welcome.html` or `welcome/index.html` (the post)

If the slug HTML is missing, the `staticData.paths` API may not be the right export in the installed Start version. Alternatives:
1. Add an explicit array to the `vite.config.ts` prerender config: `pages: ['/blog/welcome']`
2. Use Start's `prerender.pages` field with a function that returns `listSlugs('blog').map((s) => `/blog/${s}`)`

Adjust as needed based on Start version's actual API (verify against `@tanstack/react-start` source in `node_modules`).

- [ ] **Step 5: Verify static HTML contains the post body**

```bash
cd myscrollr.com && cat dist/client/blog/welcome.html | grep -o 'Welcome to the Scrollr blog' | head -1
```

Expected: 1+ matches (title appears in both `<title>` and `<h1>`).

- [ ] **Step 6: Commit**

```bash
cd myscrollr.com && git add src/routes/blog.index.tsx src/routes/blog.\$slug.tsx
git commit -m "feat(myscrollr.com): add /blog index + /blog/\$slug routes"
```

---

## Task 6: Build `/docs` index + `/docs/$slug` with optional sidebar nav

**Files:**
- Create: `myscrollr.com/src/routes/docs.index.tsx`
- Create: `myscrollr.com/src/routes/docs.$slug.tsx`
- Create: `myscrollr.com/src/components/content/DocsSidebar.tsx`

**Rationale:** Docs differ from blog: chronological order matters less, hierarchy matters more, and a persistent sidebar improves discoverability. Frontmatter gets an `order` field for sidebar sorting.

- [ ] **Step 1: Build the sidebar nav**

Create `myscrollr.com/src/components/content/DocsSidebar.tsx`:
```tsx
import { Link, useLocation } from '@tanstack/react-router'
import { listEntries } from '@/lib/content'

export function DocsSidebar() {
  const { pathname } = useLocation()
  // Docs are ordered by frontmatter `order` (asc), falling back to title.
  const docs = [...listEntries('docs')].sort((a, b) => {
    const ao = readOrder(a.raw)
    const bo = readOrder(b.raw)
    if (ao !== bo) return ao - bo
    return a.title.localeCompare(b.title)
  })

  return (
    <nav aria-label="Documentation">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-base-content/50">
        Docs
      </h2>
      <ul className="space-y-1">
        {docs.map((d) => {
          const href = `/docs/${d.slug}`
          const active = pathname === href
          return (
            <li key={d.slug}>
              <Link
                to="/docs/$slug"
                params={{ slug: d.slug }}
                className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-base-content/70 hover:bg-base-200 hover:text-base-content'
                }`}
              >
                {d.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function readOrder(raw: string): number {
  const match = raw.match(/^order:\s*(\d+)/m)
  if (!match) return 999
  return parseInt(match[1], 10)
}
```

- [ ] **Step 2: Build the docs index**

Create `myscrollr.com/src/routes/docs.index.tsx`:
```tsx
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'
import { listEntries } from '@/lib/content'

export const Route = createFileRoute('/docs/')({
  head: () =>
    seo({
      title: 'Documentation — Scrollr',
      description:
        'Guides, references, and how-tos for the Scrollr desktop app.',
      path: '/docs',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Docs', path: '/docs' },
      ]),
    }),
  beforeLoad: () => {
    // If "getting-started" exists, redirect to it as the canonical entry point.
    // The redirect happens at navigation time, not at prerender time, so the index
    // still gets a static HTML for SEO purposes.
    const first = listEntries('docs')[0]
    if (first) {
      throw redirect({ to: '/docs/$slug', params: { slug: first.slug } })
    }
  },
  component: DocsIndex,
})

function DocsIndex() {
  const docs = listEntries('docs')

  return (
    <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Documentation
        </h1>
        <p className="mt-4 text-lg text-base-content/70">
          Guides and references for the Scrollr desktop app.
        </p>
      </header>

      {docs.length === 0 ? (
        <p className="text-base-content/60">No docs yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {docs.map((d) => (
            <li key={d.slug}>
              <Link
                to="/docs/$slug"
                params={{ slug: d.slug }}
                className="block rounded-xl border border-base-300 p-5 transition-colors hover:border-primary/50 hover:bg-primary/5"
              >
                <h2 className="text-lg font-semibold">{d.title}</h2>
                <p className="mt-2 text-sm text-base-content/70">
                  {d.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Build the docs detail route**

Create `myscrollr.com/src/routes/docs.$slug.tsx`:
```tsx
import { createFileRoute, notFound } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'
import { getEntry, listSlugs } from '@/lib/content'
import { ProseLayout } from '@/components/content/ProseLayout'
import { MdxProvider } from '@/components/content/MdxProvider'
import { DocsSidebar } from '@/components/content/DocsSidebar'

export const Route = createFileRoute('/docs/$slug')({
  staticData: {
    paths: () => listSlugs('docs').map((slug) => ({ slug })),
  },
  loader: ({ params }) => {
    const entry = getEntry('docs', params.slug)
    if (!entry) throw notFound()
    return { entry }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [], links: [] }
    const { entry } = loaderData
    return seo({
      title: `${entry.title} — Scrollr Docs`,
      description: entry.description,
      path: `/docs/${entry.slug}`,
      type: 'article',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: entry.title,
          description: entry.description,
          datePublished: entry.date,
          dateModified: entry.date,
          author: { '@type': 'Organization', name: 'Scrollr' },
        },
        breadcrumbs([
          { name: 'Home', path: '/' },
          { name: 'Docs', path: '/docs' },
          { name: entry.title, path: `/docs/${entry.slug}` },
        ]),
      ],
    })
  },
  component: DocsPage,
})

function DocsPage() {
  const { entry } = Route.useLoaderData()
  const Body = entry.Component

  return (
    <ProseLayout sidebar={<DocsSidebar />}>
      <h1 className="text-4xl font-bold tracking-tight">{entry.title}</h1>
      <p className="text-base-content/70 text-lg mt-2 mb-8">
        {entry.description}
      </p>
      <MdxProvider>
        <Body />
      </MdxProvider>
    </ProseLayout>
  )
}
```

- [ ] **Step 4: Test, build, verify, commit**

```bash
cd myscrollr.com && npm run dev
# visit /docs → should redirect to /docs/getting-started
# visit /docs/getting-started → should render with sidebar
```

```bash
cd myscrollr.com && npm run build
ls myscrollr.com/dist/client/docs/
```

Expected: `index.html` + each slug as `<slug>.html` or `<slug>/index.html`.

```bash
git add myscrollr.com/src/routes/docs.\*.tsx myscrollr.com/src/components/content/DocsSidebar.tsx
git commit -m "feat(myscrollr.com): add /docs index + /docs/\$slug routes with sidebar"
```

---

## Task 7: Build `/changelog` index + `/changelog/$slug`

**Files:**
- Create: `myscrollr.com/src/routes/changelog.index.tsx`
- Create: `myscrollr.com/src/routes/changelog.$slug.tsx`

**Rationale:** Changelog has the simplest structure — reverse chronological, no sidebar. Each entry is a version. The index page is the canonical view; deep-linking to a specific version is the secondary use case.

- [ ] **Step 1: Build the changelog index (the primary view)**

Create `myscrollr.com/src/routes/changelog.index.tsx`:
```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'
import { listEntries } from '@/lib/content'
import { MdxProvider } from '@/components/content/MdxProvider'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

export const Route = createFileRoute('/changelog/')({
  head: () =>
    seo({
      title: 'Changelog — Scrollr',
      description:
        'Release notes for every version of Scrollr, the desktop app, and the website.',
      path: '/changelog',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Changelog', path: '/changelog' },
      ]),
    }),
  component: ChangelogIndex,
})

function ChangelogIndex() {
  const entries = listEntries('changelog')

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
      <header className="mb-16">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Changelog
        </h1>
        <p className="mt-4 text-lg text-base-content/70">
          Every release. The boring stuff included.
        </p>
      </header>

      {entries.length === 0 ? (
        <p className="text-base-content/60">No releases logged yet.</p>
      ) : (
        <ol className="relative border-l border-base-300 pl-8 space-y-16">
          {entries.map((entry) => {
            const [y, m, d] = entry.date.split('-').map(Number)
            const date = new Date(y, m - 1, d)
            const Body = entry.Component
            return (
              <li key={entry.slug} className="relative">
                <span
                  className="absolute -left-[37px] mt-1.5 h-3 w-3 rounded-full bg-primary ring-4 ring-base-100"
                  aria-hidden="true"
                />
                <header className="mb-4">
                  <Link
                    to="/changelog/$slug"
                    params={{ slug: entry.slug }}
                    className="text-2xl font-bold tracking-tight hover:text-primary transition-colors"
                  >
                    {entry.title}
                  </Link>
                  <div className="mt-1 flex items-center gap-3 text-sm text-base-content/60">
                    <time dateTime={entry.date}>
                      {dateFormatter.format(date)}
                    </time>
                    {entry.tags.length > 0 && (
                      <>
                        <span aria-hidden>•</span>
                        <span>{entry.tags.join(', ')}</span>
                      </>
                    )}
                  </div>
                </header>
                <div className="prose">
                  <MdxProvider>
                    <Body />
                  </MdxProvider>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Build the detail route (deep-link target)**

Create `myscrollr.com/src/routes/changelog.$slug.tsx`:
```tsx
import { createFileRoute, notFound, Link } from '@tanstack/react-router'
import { seo } from '@/lib/seo'
import { breadcrumbs } from '@/lib/structured-data'
import { getEntry, listSlugs } from '@/lib/content'
import { ProseLayout } from '@/components/content/ProseLayout'
import { ContentMeta } from '@/components/content/ContentMeta'
import { MdxProvider } from '@/components/content/MdxProvider'

export const Route = createFileRoute('/changelog/$slug')({
  staticData: {
    paths: () => listSlugs('changelog').map((slug) => ({ slug })),
  },
  loader: ({ params }) => {
    const entry = getEntry('changelog', params.slug)
    if (!entry) throw notFound()
    return { entry }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [], links: [] }
    const { entry } = loaderData
    return seo({
      title: `${entry.title} — Scrollr Changelog`,
      description: entry.description,
      path: `/changelog/${entry.slug}`,
      type: 'article',
      jsonLd: breadcrumbs([
        { name: 'Home', path: '/' },
        { name: 'Changelog', path: '/changelog' },
        { name: entry.title, path: `/changelog/${entry.slug}` },
      ]),
    })
  },
  component: ChangelogEntry,
})

function ChangelogEntry() {
  const { entry } = Route.useLoaderData()
  const Body = entry.Component

  return (
    <ProseLayout>
      <ContentMeta entry={entry} />
      <MdxProvider>
        <Body />
      </MdxProvider>
      <hr className="my-12" />
      <p className="not-prose">
        <Link
          to="/changelog"
          className="text-primary hover:underline text-sm font-medium"
        >
          ← Back to all releases
        </Link>
      </p>
    </ProseLayout>
  )
}
```

- [ ] **Step 3: Build and verify**

```bash
cd myscrollr.com && npm run build
ls myscrollr.com/dist/client/changelog/
```

Expected: `index.html` + `v2.1.0.html` (or `v2.1.0/index.html`).

```bash
cat myscrollr.com/dist/client/changelog/index.html | grep -o 'v2.1.0 — Marketing site overhaul' | head -1
```

Expected: 1 match (title appears in the timeline).

- [ ] **Step 4: Commit**

```bash
git add myscrollr.com/src/routes/changelog.\*.tsx
git commit -m "feat(myscrollr.com): add /changelog timeline + /changelog/\$slug routes"
```

---

## Task 8: Add Blog/Docs/Changelog to navigation

**Files:**
- Modify: `myscrollr.com/src/components/Header.tsx`
- Modify: `myscrollr.com/src/components/Footer.tsx`

**Rationale:** Content surfaces don't help if no one finds them. Add to header (Docs + Blog) and footer (all three).

- [ ] **Step 1: Update header nav**

In `myscrollr.com/src/components/Header.tsx`, find the desktop nav links array. Add `Docs` and `Blog` items — typically between "Channels" and "Pricing":

(Subagent: read the Header file to identify the exact link list structure, then insert `{ to: '/docs', label: 'Docs' }` and `{ to: '/blog', label: 'Blog' }` matching the existing pattern.)

Also add the same entries to the mobile drawer link list.

- [ ] **Step 2: Update footer**

In `myscrollr.com/src/components/Footer.tsx`:
- Add `Blog` to the **Resources** column.
- Add `Docs` to the **Resources** column.
- Add `Changelog` to the **Resources** column (rename column to "Resources" if it isn't already).

- [ ] **Step 3: Update the sitemap generator**

In `myscrollr.com/scripts/generate-sitemap.mjs`, extend the `ROUTES` array:
```js
const ROUTES = [
  // ... existing routes
  { path: '/blog', priority: 0.8, changefreq: 'weekly' },
  { path: '/docs', priority: 0.8, changefreq: 'monthly' },
  { path: '/changelog', priority: 0.7, changefreq: 'weekly' },
]
```

To auto-include individual posts/docs/changelog entries, extend the generator to read from the content directory. Add at the top of `generate-sitemap.mjs`:
```js
import { readdirSync } from 'node:fs'

function listSlugs(kind) {
  try {
    return readdirSync(join(__dirname, '..', 'content', kind))
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => f.replace(/\.mdx$/, ''))
  } catch {
    return []
  }
}

const contentRoutes = [
  ...listSlugs('blog').map((slug) => ({
    path: `/blog/${slug}`,
    priority: 0.6,
    changefreq: 'yearly',
  })),
  ...listSlugs('docs').map((slug) => ({
    path: `/docs/${slug}`,
    priority: 0.7,
    changefreq: 'monthly',
  })),
  ...listSlugs('changelog').map((slug) => ({
    path: `/changelog/${slug}`,
    priority: 0.5,
    changefreq: 'yearly',
  })),
]
```

Append `contentRoutes` to the main `ROUTES` array before generating XML.

- [ ] **Step 4: Update `llms.txt` to advertise the new surfaces**

In `myscrollr.com/public/llms.txt`, add a section near the top:
```markdown
## Content

- [Blog](https://myscrollr.com/blog): Product updates, technical deep-dives, and field notes.
- [Documentation](https://myscrollr.com/docs): Guides for installing, configuring, and using Scrollr.
- [Changelog](https://myscrollr.com/changelog): Release notes for every version.
```

- [ ] **Step 5: Build, verify, commit**

```bash
cd myscrollr.com && npm run build && cat public/sitemap.xml | grep -c '<url>'
```

Expected: 10 base routes + N content slugs = at least 13.

Click through nav in dev to confirm links work.

```bash
cd myscrollr.com && git add src/components/Header.tsx src/components/Footer.tsx scripts/generate-sitemap.mjs public/llms.txt
git commit -m "feat(myscrollr.com): expose Blog/Docs/Changelog in nav + sitemap + llms.txt"
```

---

## Task 9: Build a per-post OG image generator (extends Task 10 of Plan A)

**Files:**
- Modify: `myscrollr.com/scripts/generate-og-images.mjs`

**Rationale:** Each blog post and changelog entry should have its own OG image showing its title. Generating them programmatically prevents the "every share looks identical" problem.

- [ ] **Step 1: Extend the OG generator to enumerate content**

In `myscrollr.com/scripts/generate-og-images.mjs`, after the static `PAGES` array, add:
```js
import { readdirSync, readFileSync } from 'node:fs'
import matter from 'gray-matter'

function loadContentEntries(kind) {
  const dir = join(__dirname, '..', 'content', kind)
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.mdx'))
      .map((f) => {
        const raw = readFileSync(join(dir, f), 'utf8')
        const { data } = matter(raw)
        return {
          file: `${kind}/${f.replace(/\.mdx$/, '')}.png`,
          eyebrow: kind === 'blog' ? 'Blog' : kind === 'docs' ? 'Docs' : 'Changelog',
          title: data.title ?? f,
          subtitle: data.description ?? '',
          accent: kind === 'blog' ? '#7c3aed' : kind === 'docs' ? '#06b6d4' : '#f59e0b',
        }
      })
  } catch {
    return []
  }
}

const CONTENT_PAGES = [
  ...loadContentEntries('blog'),
  ...loadContentEntries('docs'),
  ...loadContentEntries('changelog'),
]
```

Update the main loop to also process `CONTENT_PAGES`:
```js
for (const pg of [...PAGES, ...CONTENT_PAGES]) {
  await page.setContent(template(pg))
  await page.waitForLoadState('networkidle')
  const buf = await page.screenshot({ type: 'png' })
  const outPath = join(outDir, pg.file)
  // Ensure subdirectories exist
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, buf)
  console.log(`✓ ${pg.file}`)
}
```

Make sure `dirname` is imported at the top of the file.

- [ ] **Step 2: Wire OG images into content routes**

Update `blog.$slug.tsx`, `docs.$slug.tsx`, `changelog.$slug.tsx` `head()` to pass the image:
```ts
image: `https://myscrollr.com/og/blog/${entry.slug}.png`,
```
(adjust the path segment for docs/changelog)

- [ ] **Step 3: Regenerate and commit**

```bash
cd myscrollr.com && npm run og-images
ls public/og/blog/ public/og/docs/ public/og/changelog/
```

Expected: one PNG per content entry.

```bash
cd myscrollr.com && git add -A
git commit -m "feat(myscrollr.com): generate per-post OG images for blog/docs/changelog"
```

---

## Task 10: Extend `llms-full.txt` with content body

**Files:**
- Create: `myscrollr.com/scripts/generate-llms-full.mjs`
- Modify: `myscrollr.com/package.json`

**Rationale:** `llms-full.txt` becomes much more valuable when it includes the full blog/docs/changelog body. Generate it at build time from the content directory + a fixed marketing intro.

- [ ] **Step 1: Write the generator**

Create `myscrollr.com/scripts/generate-llms-full.mjs`:
```js
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import matter from 'gray-matter'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const INTRO = `# Scrollr — Full LLM Digest

Scrollr is a quiet desktop ticker for live finance, sports, news, and fantasy data. Open source, privacy-first, and free. Available for macOS, Windows, and Linux.

This digest contains every published blog post, doc, and changelog entry. It is intended for LLM/AI crawler consumption.

---

`

function loadKind(kind) {
  const dir = join(root, 'content', kind)
  let files
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.mdx'))
  } catch {
    return ''
  }

  const entries = files
    .map((f) => {
      const raw = readFileSync(join(dir, f), 'utf8')
      const { data, content } = matter(raw)
      return {
        slug: f.replace(/\.mdx$/, ''),
        title: data.title ?? f,
        description: data.description ?? '',
        date: data.date ?? '1970-01-01',
        content,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  if (entries.length === 0) return ''

  const header = `## ${kind.charAt(0).toUpperCase() + kind.slice(1)}\n\n`
  const body = entries
    .map(
      (e) =>
        `### ${e.title}\n\n_${e.date}_\n\n${e.description}\n\n${e.content.trim()}\n\n---\n`,
    )
    .join('\n')

  return header + body + '\n'
}

const output =
  INTRO +
  loadKind('docs') +
  loadKind('changelog') +
  loadKind('blog')

writeFileSync(join(root, 'public', 'llms-full.txt'), output)
console.log(`✓ llms-full.txt written (${output.length} bytes)`)
```

- [ ] **Step 2: Wire into prebuild**

In `myscrollr.com/package.json`:
```json
"prebuild": "node scripts/fetch-latest-version.mjs && node scripts/generate-sitemap.mjs && node scripts/generate-llms-full.mjs"
```

- [ ] **Step 3: Build and verify**

```bash
cd myscrollr.com && npm run build
head -50 public/llms-full.txt
```

Expected: starts with the intro, then docs (getting-started body), then changelog (v2.1.0 body), then blog (welcome body).

- [ ] **Step 4: Commit**

```bash
cd myscrollr.com && git add scripts/generate-llms-full.mjs package.json public/llms-full.txt
git commit -m "feat(myscrollr.com): auto-generate llms-full.txt from MDX content"
```

---

## Task 11: Add a `/feed.xml` RSS feed for the blog

**Files:**
- Create: `myscrollr.com/scripts/generate-rss.mjs`
- Modify: `myscrollr.com/package.json`
- Modify: `myscrollr.com/src/routes/__root.tsx` (link tag)

**Rationale:** RSS still matters for technical audiences. Cheap to add. Discoverable from blog index via auto-discovery.

- [ ] **Step 1: Write the generator**

Create `myscrollr.com/scripts/generate-rss.mjs`:
```js
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import matter from 'gray-matter'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const blogDir = join(root, 'content', 'blog')
let items = []
try {
  items = readdirSync(blogDir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => {
      const raw = readFileSync(join(blogDir, f), 'utf8')
      const { data, content } = matter(raw)
      return {
        slug: f.replace(/\.mdx$/, ''),
        title: data.title ?? f,
        description: data.description ?? '',
        date: data.date ?? '1970-01-01',
        author: data.author ?? 'Scrollr',
        body: content,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
} catch {
  // No blog dir — emit an empty feed
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Scrollr Blog</title>
    <link>https://myscrollr.com/blog</link>
    <description>Product updates, technical deep-dives, and field notes from the Scrollr team.</description>
    <language>en</language>
    <atom:link href="https://myscrollr.com/feed.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items
  .map((item) => {
    const [y, m, d] = item.date.split('-').map(Number)
    const pubDate = new Date(y, m - 1, d).toUTCString()
    return `    <item>
      <title>${escape(item.title)}</title>
      <link>https://myscrollr.com/blog/${item.slug}</link>
      <guid isPermaLink="true">https://myscrollr.com/blog/${item.slug}</guid>
      <description>${escape(item.description)}</description>
      <pubDate>${pubDate}</pubDate>
      <author>${escape(item.author)}</author>
    </item>`
  })
  .join('\n')}
  </channel>
</rss>
`

writeFileSync(join(root, 'public', 'feed.xml'), xml)
console.log(`✓ feed.xml written (${items.length} items)`)
```

- [ ] **Step 2: Wire into prebuild**

In `myscrollr.com/package.json`:
```json
"prebuild": "node scripts/fetch-latest-version.mjs && node scripts/generate-sitemap.mjs && node scripts/generate-llms-full.mjs && node scripts/generate-rss.mjs"
```

- [ ] **Step 3: Add auto-discovery link tag**

In `myscrollr.com/src/routes/__root.tsx`, inside `RootDocument`'s `<head>`, add:
```tsx
<link
  rel="alternate"
  type="application/rss+xml"
  title="Scrollr Blog"
  href="https://myscrollr.com/feed.xml"
/>
```

- [ ] **Step 4: Build, verify, commit**

```bash
cd myscrollr.com && npm run build
cat public/feed.xml | head -20
```

Expected: valid RSS XML with one item for the welcome post.

Validate with: https://validator.w3.org/feed/ (manual, after deploy).

```bash
cd myscrollr.com && git add scripts/generate-rss.mjs package.json src/routes/__root.tsx public/feed.xml
git commit -m "feat(myscrollr.com): add /feed.xml RSS for the blog"
```

---

## Task 12: Update AGENTS.md with content authoring workflow

**Files:**
- Modify: `myscrollr.com/AGENTS.md` (or root `AGENTS.md`)

- [ ] **Step 1: Add a content section**

Add to the relevant AGENTS.md:
```markdown
## Content authoring (Blog / Docs / Changelog)

Content lives in `myscrollr.com/content/{blog,docs,changelog}/*.mdx`. Each file has frontmatter and a Markdown body.

### Required frontmatter
```yaml
---
title: Post title
description: One-sentence summary, used in meta and link previews.
date: 2026-05-12     # ISO date (YYYY-MM-DD)
tags: [tag1, tag2]   # array of tags (optional)
author: Brandon Ruth # optional (defaults to "Scrollr team")
order: 1             # docs-only, controls sidebar order
version: 2.1.0       # changelog-only, optional
---
```

### Adding a blog post
1. Create `content/blog/my-post-slug.mdx` with frontmatter and Markdown.
2. Run `npm run og-images` to generate the share image.
3. The post auto-appears in `/blog`, sitemap, RSS feed, and `llms-full.txt`.

### Adding a doc
Same as blog, but place in `content/docs/`. Use `order` in frontmatter to control sidebar position.

### Adding a changelog entry
Place in `content/changelog/v{version}.mdx`. Use the version number as the slug for stable URLs.

### Build pipeline
`npm run build` runs:
1. `fetch-latest-version.mjs` (existing) — pin desktop version
2. `generate-sitemap.mjs` — refresh sitemap with content slugs
3. `generate-llms-full.mjs` — refresh LLM digest with content bodies
4. `generate-rss.mjs` — refresh RSS feed from blog
5. `vite build` — prerender all routes including content slugs

### Embedded React components
MDX files can `import` and use React components from `src/components/`. Common pattern:

```mdx
import { Callout } from '@/components/content/Callout'

<Callout type="warning">
This is a warning callout.
</Callout>
```

Components imported in MDX must be SSR-safe (no `window` access at module scope).
```

- [ ] **Step 2: Commit**

```bash
cd myscrollr.com && git add AGENTS.md
git commit -m "docs(myscrollr.com): document content authoring workflow"
```

---

## Self-Review Checklist (post-implementation)

- [ ] `/blog`, `/docs`, `/changelog` indexes prerendered as static HTML
- [ ] Each MDX entry produces a unique `<route>/<slug>.html` (or `<slug>/index.html`)
- [ ] Each content route has unique `<title>`, `<meta description>`, canonical URL, OG image
- [ ] JSON-LD on blog posts (`BlogPosting`), docs (`TechArticle`), changelog (`BreadcrumbList`)
- [ ] Header nav links to Docs and Blog
- [ ] Footer Resources column links to Blog, Docs, Changelog
- [ ] Sitemap includes all content slugs with today's `lastmod`
- [ ] `llms-full.txt` contains full body of every content entry
- [ ] `feed.xml` validates as RSS 2.0 and lists blog posts in reverse chronological order
- [ ] Adding a new `.mdx` file under `content/` causes it to appear in the index, sitemap, OG images, llms-full, and feed on next build with no other code changes
- [ ] Code blocks in MDX render with Shiki syntax highlighting
- [ ] All routes pass `npm run check` (lint + format)
