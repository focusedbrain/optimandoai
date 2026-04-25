import { useCallback, useEffect, useState } from 'react'
import type { DirectP2pReachabilityStatus } from '../lib/hostInferenceUiGates'
import { useOrchestratorMode } from './useOrchestratorMode'

export type SandboxPeerRow = {
  handshakeId: string
  peerDisplayName: string
  peerRoleLabel: string
  pairingCodeDisplay: string
  directP2pAvailable: boolean
  endpointHostLabel: string | null
}

/**
 * Host orchestrator: list internal Sandbox peers and probe direct P2P reachability (GET, no body).
 */
export function useHostToSandboxDirectReachability(probeHandshakeId: string | null) {
  const { isHost, ready: modeReady } = useOrchestratorMode()
  const [candidates, setCandidates] = useState<SandboxPeerRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [reachability, setReachability] = useState<DirectP2pReachabilityStatus | null>(null)

  const refresh = useCallback(async () => {
    const api = window.internalInference
    if (typeof api?.listSandboxPeerCandidates !== 'function') {
      setCandidates([])
      setListLoading(false)
      return
    }
    try {
      const r = (await api.listSandboxPeerCandidates()) as {
        ok?: boolean
        candidates?: SandboxPeerRow[]
      }
      if (r?.ok && Array.isArray(r.candidates)) {
        setCandidates(r.candidates)
      } else {
        setCandidates([])
      }
    } catch {
      setCandidates([])
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!modeReady) return
    if (!isHost) {
      setListLoading(false)
      setCandidates([])
      return
    }
    setListLoading(true)
    void refresh()
  }, [isHost, modeReady, refresh])

  useEffect(() => {
    const on = () => {
      if (isHost) void refresh()
    }
    window.addEventListener('handshake-list-refresh', on)
    return () => window.removeEventListener('handshake-list-refresh', on)
  }, [isHost, refresh])

  useEffect(() => {
    if (!isHost || !probeHandshakeId) {
      setReachability(null)
      return
    }
    const c = candidates.find((x) => x.handshakeId === probeHandshakeId)
    if (!c) {
      setReachability(null)
      return
    }
    if (!c.directP2pAvailable) {
      setReachability('missing_endpoint')
      return
    }
    const api = window.internalInference
    if (typeof api?.checkDirectP2pReachability !== 'function') {
      setReachability('unreachable')
      return
    }
    let cancelled = false
    setReachability('unknown')
    void (async () => {
      try {
        const res = (await api.checkDirectP2pReachability(probeHandshakeId)) as {
          ok?: boolean
          status?: DirectP2pReachabilityStatus
        }
        if (cancelled) return
        if (res?.ok && res?.status) {
          setReachability(res.status)
        } else {
          setReachability('unreachable')
        }
      } catch {
        if (!cancelled) setReachability('unreachable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isHost, probeHandshakeId, candidates])

  return {
    isHost: modeReady && isHost,
    listLoading,
    candidates,
    reachability,
    refresh,
  }
}
