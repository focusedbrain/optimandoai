import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DirectP2pReachabilityStatus } from '../lib/hostInferenceUiGates'
import type { InferenceTargetRefreshReason } from '../lib/inferenceTargetRefreshLog'
import { useOrchestratorMode } from './useOrchestratorMode'

export type HostInferenceCandidateRow = {
  handshakeId: string
  hostDisplayName: string
  hostRoleLabel: string
  pairingCodeDisplay: string
  directP2pAvailable: boolean
  endpointHostLabel: string | null
}

/** Row from `internal-inference:listTargets` / `listInferenceTargets` (Host AI selector). */
export type HostInferenceTargetRow = {
  kind: 'host_internal'
  id: string
  label: string
  model: string | null
  model_id?: string | null
  /** Live label from Host policy GET; preferred over `label` in UI. */
  display_label?: string
  /** Second line: "<host> — Host orchestrator · ID …" (no raw device UUID in normal copy). */
  secondary_label?: string
  provider?: 'host_internal' | 'ollama' | ''
  handshake_id: string
  host_device_id: string
  host_computer_name: string
  host_pairing_code?: string
  host_orchestrator_role?: 'host'
  host_orchestrator_role_label?: string
  internal_identifier_6?: string
  direct_reachable: boolean
  policy_enabled: boolean
  available: boolean
  availability: string
  unavailable_reason?: string
  host_role: string
  inference_error_code?: string
  /** Present when list comes from `handshake:getAvailableModels` / listInference (same as top chat). */
  host_selector_state?: 'available' | 'checking' | 'unavailable'
}

type PolicyState = 'unknown' | 'allow' | 'deny' | 'unreachable' | 'no_direct'

function formatPairingDisplay(code: string | undefined): string {
  const s = (code ?? '').replace(/\D/g, '')
  if (s.length === 6) {
    return `${s.slice(0, 3)}-${s.slice(3)}`
  }
  return code && code.trim() ? code : '—'
}

function targetsToCandidates(targets: HostInferenceTargetRow[]): HostInferenceCandidateRow[] {
  return targets.map((t) => ({
    handshakeId: t.handshake_id,
    hostDisplayName: t.host_computer_name,
    hostRoleLabel: 'Host orchestrator',
    pairingCodeDisplay: formatPairingDisplay(t.host_pairing_code),
    directP2pAvailable: t.direct_reachable,
    endpointHostLabel: null,
  }))
}

/**
 * Merged host rows from `handshake:getAvailableModels` (see main process) + reload (same as chat model list).
 */
export type HostInferenceGavSync = {
  targets: HostInferenceTargetRow[]
  refresh: (reason?: InferenceTargetRefreshReason) => Promise<void>
}

/**
 * Lists internal Host handshakes on Sandbox, probes allowSandboxInference over direct P2P when possible.
 * When `gav` is set (e.g. HybridSearch), Host targets come from `getAvailableModels` (merged with local+cloud in main) instead of a separate `listTargets` call.
 */
export function useSandboxHostInference(
  selectedHandshakeIdForProbe: string | null,
  gav?: HostInferenceGavSync | null,
) {
  const { isSandbox, ready: modeReady } = useOrchestratorMode()
  const [candidates, setCandidates] = useState<HostInferenceCandidateRow[]>([])
  const [inferenceTargets, setInferenceTargets] = useState<HostInferenceTargetRow[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [policy, setPolicy] = useState<PolicyState>('unknown')
  const [policyDetail, setPolicyDetail] = useState<string | null>(null)
  const [directReachability, setDirectReachability] = useState<DirectP2pReachabilityStatus | null>(null)

  const showHostInferenceOption =
    modeReady && isSandbox && inferenceTargets.some((t) => t.direct_reachable && t.available)

  const refresh = useCallback(async (reason?: InferenceTargetRefreshReason) => {
    if (gav) {
      await gav.refresh(reason)
      return
    }
    const api = (window as unknown as {
      internalInference?: {
        listTargets?: () => Promise<unknown>
        listInferenceTargets?: () => Promise<unknown>
        listHostCandidates?: () => Promise<unknown>
      }
    }).internalInference
    const listFn = typeof api?.listTargets === 'function' ? api.listTargets : api?.listInferenceTargets
    if (typeof listFn === 'function') {
      try {
        const r = (await listFn()) as { ok?: boolean; targets?: HostInferenceTargetRow[] }
        if (r?.ok && Array.isArray(r.targets)) {
          setInferenceTargets(r.targets)
          setCandidates(targetsToCandidates(r.targets))
        } else {
          setInferenceTargets([])
          setCandidates([])
        }
      } catch {
        setInferenceTargets([])
        setCandidates([])
      } finally {
        setListLoading(false)
      }
      return
    }
    if (typeof api?.listHostCandidates !== 'function') {
      setInferenceTargets([])
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
        setInferenceTargets(
          r.candidates.map((c) => ({
            kind: 'host_internal' as const,
            id: `host-inference-fallback:${c.handshakeId}`,
            label: c.hostDisplayName,
            display_label: c.hostDisplayName,
            model: '',
            model_id: '',
            provider: '' as const,
            handshake_id: c.handshakeId,
            host_device_id: '',
            host_computer_name: c.hostDisplayName,
            host_pairing_code: c.pairingCodeDisplay,
            host_orchestrator_role: 'host',
            host_orchestrator_role_label: c.hostRoleLabel,
            internal_identifier_6: '',
            direct_reachable: c.directP2pAvailable,
            policy_enabled: true,
            available: c.directP2pAvailable,
            availability: c.directP2pAvailable ? 'available' : 'direct_unreachable',
            unavailable_reason: c.directP2pAvailable
              ? `${c.hostDisplayName} — ${c.hostRoleLabel} · ${c.pairingCodeDisplay}`
              : `Host not directly reachable — ${c.hostDisplayName} — ${c.hostRoleLabel} · ${c.pairingCodeDisplay}`,
            host_role: 'Host',
          })),
        )
      } else {
        setCandidates([])
        setInferenceTargets([])
      }
    } catch {
      setCandidates([])
      setInferenceTargets([])
    } finally {
      setListLoading(false)
    }
  }, [gav])

  useLayoutEffect(() => {
    if (!modeReady || !isSandbox || !gav) {
      return
    }
    setListLoading(false)
    setInferenceTargets(gav.targets)
    setCandidates(targetsToCandidates(gav.targets))
  }, [isSandbox, modeReady, gav, gav?.targets])

  useEffect(() => {
    if (!modeReady) {
      return
    }
    if (!isSandbox) {
      setListLoading(false)
      setCandidates([])
      setInferenceTargets([])
      return
    }
    if (gav) {
      return
    }
    setListLoading(true)
    void refresh()
  }, [isSandbox, modeReady, gav, gav?.targets, refresh])

  useEffect(() => {
    /**
     * When `gav` (HybridSearch) is set, the parent refetches and logs; avoid double `getAvailableModels` here.
     */
    if (gav) {
      return () => {}
    }
    const on = () => {
      if (isSandbox) void refresh()
    }
    window.addEventListener('handshake-list-refresh', on)
    window.addEventListener('orchestrator-mode-changed', on)
    return () => {
      window.removeEventListener('handshake-list-refresh', on)
      window.removeEventListener('orchestrator-mode-changed', on)
    }
  }, [isSandbox, refresh, gav])

  const p2pRefreshSig = useRef<string>('')
  useEffect(() => {
    if (!isSandbox) {
      p2pRefreshSig.current = ''
      return
    }
    if (directReachability == null) return
    const s = String(directReachability)
    if (p2pRefreshSig.current === s) return
    p2pRefreshSig.current = s
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent('inference-target-refresh', { detail: { reason: 'p2p_change' } }),
    )
  }, [isSandbox, directReachability])

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
    inferenceTargets,
    showHostInferenceOption,
    policy,
    policyDetail,
    directReachability,
    refresh,
  }
}
