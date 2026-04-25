import { useCallback, useEffect, useState } from 'react'
import type { DirectP2pReachabilityStatus } from '../lib/hostInferenceUiGates'
import { useOrchestratorMode } from './useOrchestratorMode'

export type HostInferenceCandidateRow = {
  handshakeId: string
  hostDisplayName: string
  hostRoleLabel: string
  pairingCodeDisplay: string
  directP2pAvailable: boolean
  endpointHostLabel: string | null
}

type PolicyState = 'unknown' | 'allow' | 'deny' | 'unreachable' | 'no_direct'

/**
 * Lists internal Host handshakes on Sandbox, probes allowSandboxInference over direct P2P when possible.
 */
export function useSandboxHostInference(selectedHandshakeIdForProbe: string | null) {
  const { isSandbox, ready: modeReady } = useOrchestratorMode()
  const [candidates, setCandidates] = useState<HostInferenceCandidateRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [policy, setPolicy] = useState<PolicyState>('unknown')
  const [policyDetail, setPolicyDetail] = useState<string | null>(null)
  const [directReachability, setDirectReachability] = useState<DirectP2pReachabilityStatus | null>(null)

  const showHostInferenceOption = modeReady && isSandbox && candidates.some((c) => c.directP2pAvailable)

  const refresh = useCallback(async () => {
    const api = (window as unknown as { internalInference?: { listHostCandidates?: () => Promise<unknown> } })
      .internalInference
    if (typeof api?.listHostCandidates !== 'function') {
      setCandidates([])
      setListLoading(false)
      return
    }
    try {
      const r = (await api.listHostCandidates()) as {
        ok?: boolean
        candidates?: HostInferenceCandidateRow[]
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
    if (!modeReady) {
      return
    }
    if (!isSandbox) {
      setListLoading(false)
      setCandidates([])
      return
    }
    setListLoading(true)
    void refresh()
  }, [isSandbox, modeReady, refresh])

  useEffect(() => {
    const on = () => {
      if (isSandbox) void refresh()
    }
    window.addEventListener('handshake-list-refresh', on)
    return () => window.removeEventListener('handshake-list-refresh', on)
  }, [isSandbox, refresh])

  useEffect(() => {
    if (!isSandbox || !selectedHandshakeIdForProbe) {
      setDirectReachability(null)
      return
    }
    const c = candidates.find((x) => x.handshakeId === selectedHandshakeIdForProbe)
    if (!c) {
      setDirectReachability(null)
      return
    }
    if (!c.directP2pAvailable) {
      setDirectReachability('missing_endpoint')
      return
    }
    const api = window.internalInference
    if (typeof api?.checkDirectP2pReachability !== 'function') {
      setDirectReachability('unreachable')
      return
    }
    let cancelled = false
    setDirectReachability('unknown')
    void (async () => {
      try {
        const res = (await api.checkDirectP2pReachability!(selectedHandshakeIdForProbe)) as {
          ok?: boolean
          status?: DirectP2pReachabilityStatus
        }
        if (cancelled) return
        if (res?.ok && res.status) {
          setDirectReachability(res.status)
        } else {
          setDirectReachability('unreachable')
        }
      } catch {
        if (!cancelled) setDirectReachability('unreachable')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isSandbox, selectedHandshakeIdForProbe, candidates])

  useEffect(() => {
    if (!isSandbox || !selectedHandshakeIdForProbe) {
      setPolicy('unknown')
      setPolicyDetail(null)
      return
    }
    const c = candidates.find((x) => x.handshakeId === selectedHandshakeIdForProbe)
    if (!c) {
      setPolicy('unknown')
      setPolicyDetail(null)
      return
    }
    if (!c.directP2pAvailable) {
      setPolicy('no_direct')
      setPolicyDetail(null)
      return
    }
    const api = (window as unknown as { internalInference?: { probeHostPolicy?: (id: string) => Promise<unknown> } })
      .internalInference
    if (typeof api?.probeHostPolicy !== 'function') {
      setPolicy('unreachable')
      return
    }
    let cancelled = false
    setPolicy('unknown')
    void (async () => {
      try {
        const p = (await api.probeHostPolicy!(selectedHandshakeIdForProbe)) as
          | { ok: true; allowSandboxInference: boolean }
          | { ok: false; code?: string; message?: string; directP2pAvailable?: boolean }
        if (cancelled) return
        if (p && 'ok' in p && p.ok) {
          setPolicy(p.allowSandboxInference ? 'allow' : 'deny')
          setPolicyDetail(null)
        } else {
          const any = p as { ok: false; code?: string; directP2pAvailable?: boolean }
          if (any.directP2pAvailable === false) {
            setPolicy('no_direct')
          } else {
            setPolicy('unreachable')
            setPolicyDetail((p as { message?: string })?.message ?? null)
          }
        }
      } catch (e) {
        if (cancelled) return
        setPolicy('unreachable')
        setPolicyDetail((e as Error)?.message ?? null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isSandbox, selectedHandshakeIdForProbe, candidates])

  return {
    isSandbox: modeReady && isSandbox,
    listLoading,
    candidates,
    showHostInferenceOption,
    policy,
    policyDetail,
    directReachability,
    refresh,
  }
}
