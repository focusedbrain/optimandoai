import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActiveHandshakeHealthIssue } from '@shared/handshake/activeHandshakeHealthIssue'
import {
  handshakeHealthDismissKey,
  handshakeHealthIssueRank,
} from '../lib/handshakeHealthBannerCopy'

const STORAGE_KEY = 'optimando.handshakeHealthBanner.dismissed'

function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}

function writeDismissed(s: Set<string>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...s]))
  } catch {
    /* noop */
  }
}

export function useActiveHandshakeHealthBanner() {
  const [issues, setIssues] = useState<ActiveHandshakeHealthIssue[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    typeof sessionStorage !== 'undefined' ? readDismissed() : new Set(),
  )

  const refresh = useCallback(async () => {
    const fn = window.handshakeView?.getActiveHandshakeHealthIssues
    if (typeof fn !== 'function') {
      setIssues([])
      return
    }
    try {
      const res = await fn()
      const list = res?.issues
      setIssues(Array.isArray(list) ? list : [])
    } catch {
      setIssues([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onRefresh = () => {
      void refresh()
    }
    window.addEventListener('handshake-list-refresh', onRefresh)
    window.addEventListener('orchestrator-mode-changed', onRefresh)
    const onVis = () => {
      if (document.visibilityState === 'visible') onRefresh()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('handshake-list-refresh', onRefresh)
      window.removeEventListener('orchestrator-mode-changed', onRefresh)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refresh])

  const visibleIssues = useMemo(
    () => issues.filter((i) => !dismissed.has(handshakeHealthDismissKey(i))),
    [issues, dismissed],
  )

  const primaryIssue = useMemo(() => {
    if (visibleIssues.length === 0) return null
    return [...visibleIssues].sort((a, b) => handshakeHealthIssueRank(a) - handshakeHealthIssueRank(b))[0]!
  }, [visibleIssues])

  const extraCount = primaryIssue ? visibleIssues.length - 1 : 0

  const dismiss = useCallback(
    (issue: ActiveHandshakeHealthIssue) => {
      const key = handshakeHealthDismissKey(issue)
      setDismissed((prev) => {
        const next = new Set(prev)
        next.add(key)
        writeDismissed(next)
        return next
      })
    },
    [],
  )

  return { primaryIssue, extraCount, refresh, dismiss }
}
