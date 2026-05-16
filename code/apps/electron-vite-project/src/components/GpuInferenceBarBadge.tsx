/**
 * Toolbar badge: compact inference capability indicator.
 *
 * Consumes `llm:resolveInferenceCapability` (tier-ranked resolver) instead of
 * probing local GPU hardware directly.  This prevents the misleading "GPU Issue"
 * label when inference is valid via CPU or remote host.
 *
 * Labels:
 *   GPU        — local GPU offload is healthy
 *   CPU        — CPU fallback is active (CPU-safe model, no GPU)
 *   Remote     — sandbox routing to paired host
 *   Info       — unavailable with a specific reason (model too large, etc.)
 *   Unavailable — no Ollama, no remote, no model
 */

import { useCallback, useEffect, useState } from 'react'
import { useOrchestratorMode } from '../hooks/useOrchestratorMode'

type BadgeVariant = 'loading' | 'gpu' | 'cpu' | 'remote' | 'info' | 'unavailable'

const VARIANT_COLORS: Record<BadgeVariant, string> = {
  loading:     '#64748b',
  gpu:         '#15803d',
  cpu:         '#1d4ed8',
  remote:      '#7c3aed',
  info:        '#92400e',
  unavailable: '#b91c1c',
}

const VARIANT_LABELS: Record<BadgeVariant, string> = {
  loading:     'Checking…',
  gpu:         'GPU',
  cpu:         'CPU',
  remote:      'Remote',
  info:        'Info',
  unavailable: 'Unavailable',
}

function backendToVariant(backend: InferenceCapabilityForUi['backend']): BadgeVariant {
  switch (backend) {
    case 'local-gpu':   return 'gpu'
    case 'local-cpu':   return 'cpu'
    case 'remote-host': return 'remote'
    case 'unavailable': return 'info'
    default:            return 'unavailable'
  }
}

export function GpuInferenceBarBadge(): JSX.Element | null {
  const [variant, setVariant] = useState<BadgeVariant>('loading')
  const [tooltip, setTooltip] = useState('Checking inference capability…')

  const { ready: orchestratorModeReady, ledgerProvesInternalSandboxToHost } = useOrchestratorMode()

  const refresh = useCallback(async () => {
    if (!orchestratorModeReady) return
    const api = typeof window !== 'undefined' ? window.llm : undefined
    if (!api?.resolveInferenceCapability) return
    try {
      const res = await api.resolveInferenceCapability()
      if (!res.ok) {
        setVariant('unavailable')
        setTooltip(`Capability check failed: ${res.error}`)
        return
      }
      const cap = res.data
      const v = backendToVariant(cap.backend)
      setVariant(v)
      const parts: string[] = []
      if (cap.userMessage) parts.push(cap.userMessage)
      if (cap.modelName)   parts.push(`Model: ${cap.modelName}`)
      if (cap.backend === 'remote-host' && cap.remoteBaseUrl) {
        parts.push(`Host: ${cap.remoteBaseUrl}`)
      }
      if (cap.unavailableReason) parts.push(`Reason: ${cap.unavailableReason}`)
      setTooltip(parts.join('\n') || VARIANT_LABELS[v])
    } catch (e: unknown) {
      setVariant('unavailable')
      setTooltip(e instanceof Error ? e.message : 'Capability check failed.')
    }
  }, [orchestratorModeReady])

  useEffect(() => {
    // On sandbox devices that have confirmed internal-sandbox-to-host role,
    // the badge still applies (shows Remote or GPU depending on host availability).
    void refresh()
    const id = window.setInterval(() => void refresh(), 45_000)
    const api = typeof window !== 'undefined' ? window.llm : undefined
    const off = api?.onActiveModelChanged?.(() => void refresh())
    return () => {
      window.clearInterval(id)
      try { off?.() } catch { /* ignore */ }
    }
  }, [refresh])

  // Hide if orchestrator mode not yet loaded or if API is unavailable.
  if (typeof window === 'undefined' || !window.llm?.resolveInferenceCapability) {
    return null
  }
  if (!orchestratorModeReady) return null

  const bg = VARIANT_COLORS[variant]
  const label = VARIANT_LABELS[variant]

  return (
    <div
      className="hs-gpu-badge"
      style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}
      title={tooltip}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: 'uppercase',
          color: '#f8fafc',
          background: bg,
          borderRadius: 4,
          padding: '3px 7px',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          cursor: 'default',
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
    </div>
  )
}
