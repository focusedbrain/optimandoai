import { useCallback, useEffect, useState } from 'react'
import type { AnalysisDashboardSnapshot } from '../types/analysisDashboardSnapshot'
import { fetchAnalysisDashboardSnapshot } from './fetchAnalysisDashboardSnapshot'

export function useAnalysisDashboardSnapshot(options?: { urgentMessageLimit?: number }): {
  snapshot: AnalysisDashboardSnapshot | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const limit = options?.urgentMessageLimit ?? 12
  const [snapshot, setSnapshot] = useState<AnalysisDashboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { snapshot: next, error: err } = await fetchAnalysisDashboardSnapshot({
        includeHandshakes: false,
        urgentMessageLimit: limit,
      })
      setSnapshot(next)
      setError(err ?? null)
    } catch (e) {
      setSnapshot(null)
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, error, refresh }
}
