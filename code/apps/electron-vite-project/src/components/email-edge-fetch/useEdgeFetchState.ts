import { useCallback, useEffect, useState } from 'react'
import type { EdgeFetchAccountSnapshot } from './edgeFetchCopy.js'

export interface EdgeFetchEligibilityView {
  canMigrate: boolean
  reason?: string
  edgeReady: boolean
  isPaidTier: boolean
  replicas: Array<{ edge_pod_id: string; host: string; port: number }>
}

export function useEdgeFetchState() {
  const [snapshots, setSnapshots] = useState<EdgeFetchAccountSnapshot[]>([])
  const [eligibility, setEligibility] = useState<EdgeFetchEligibilityView | null>(null)

  const refresh = useCallback(async () => {
    const api = window.emailEdgeFetch
    if (!api) return
    const [eligRes, snapRes] = await Promise.all([api.getEligibility(), api.getSnapshots()])
    if (eligRes?.ok && eligRes.data) setEligibility(eligRes.data)
    if (snapRes?.ok && Array.isArray(snapRes.data)) setSnapshots(snapRes.data)
  }, [])

  useEffect(() => {
    void refresh()
    const unsub = window.emailEdgeFetch?.onStateChanged?.((rows) => {
      if (Array.isArray(rows)) setSnapshots(rows)
    })
    return () => unsub?.()
  }, [refresh])

  const snapshotFor = useCallback(
    (accountId: string) => snapshots.find((s) => s.accountId === accountId) ?? null,
    [snapshots],
  )

  return { snapshots, eligibility, refresh, snapshotFor }
}
