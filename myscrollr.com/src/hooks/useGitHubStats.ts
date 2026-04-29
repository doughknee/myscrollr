import { useEffect, useState } from 'react'

export interface GitHubStats {
  stars: number
  forks: number
  issues: number
}

const CACHE_KEY_PREFIX = 'gh-stats-cache:'
const CACHE_TTL_MS = 10 * 60 * 1000

interface CachedEntry {
  stars: number
  forks: number
  issues: number
  ts: number
}

function readCache(repo: string): GitHubStats | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY_PREFIX + repo)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedEntry
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null
    return {
      stars: parsed.stars,
      forks: parsed.forks,
      issues: parsed.issues,
    }
  } catch {
    return null // private mode / disabled storage / malformed JSON
  }
}

function writeCache(repo: string, stats: GitHubStats) {
  try {
    sessionStorage.setItem(
      CACHE_KEY_PREFIX + repo,
      JSON.stringify({ ...stats, ts: Date.now() } satisfies CachedEntry),
    )
  } catch {
    // private mode / quota — silently skip
  }
}

export function useGitHubStats(repo: string) {
  const [stats, setStats] = useState<GitHubStats | null>(null)

  useEffect(() => {
    const cached = readCache(repo)
    if (cached) {
      setStats(cached)
      return
    }

    let cancelled = false
    fetch(`https://api.github.com/repos/${repo}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.stargazers_count != null) {
          const next: GitHubStats = {
            stars: data.stargazers_count as number,
            forks: data.forks_count as number,
            issues: data.open_issues_count as number,
          }
          setStats(next)
          writeCache(repo, next)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [repo])

  return stats
}
