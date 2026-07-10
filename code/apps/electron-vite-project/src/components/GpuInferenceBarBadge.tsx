/**
 * Top-chat inference capability badge.
 *
 * Labels and when they appear
 * ─────────────────────────────────────────────────────────────────────────────
 *  Host GPU    Sandbox using paired Host GPU inference (remote-host + gpu).
 *  GPU         Local machine running with GPU offload.
 *  CPU         The local LLM (llama.cpp) is running on CPU with a CPU-safe model.
 *  Info        A backend exists but hardware is unknown or model blocked.
 *  Unavailable No usable backend and no actionable reason.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This component MUST NOT call getGpuStatus() directly:
 *  - On a Linux sandbox getGpuStatus() probes the local Linux machine and
 *    maps to "GPU Issue" even when a healthy Windows host is paired.
 *  - The resolveInferenceCapability IPC call handles sandbox vs host routing
 *    and probes the *host* local LLM for sandbox devices.
 */

import { useCallback, useEffect, useState } from 'react'

type BadgeVariant = 'loading' | 'gpu' | 'hostGpu' | 'cpu' | 'info' | 'unavailable'

const BG: Record<BadgeVariant, string> = {
  loading:     '#64748b',
  gpu:         '#15803d',
  hostGpu:     '#15803d',
  cpu:         '#1d4ed8',
  info:        '#92400e',
  unavailable: '#7f1d1d',
}

const LABEL: Record<BadgeVariant, string> = {
  loading:     'Checking…',
  gpu:         'GPU',
  hostGpu:     'Host GPU',
  cpu:         'CPU',
  info:        'Info',
  unavailable: 'Unavailable',
}

/** Map resolved capability to a display variant. */
function toVariant(cap: InferenceCapabilityForUi): BadgeVariant {
  if (cap.backend === 'remote-host') {
    if (cap.hostHardware === 'gpu') return 'hostGpu'
    if (cap.hostHardware === 'cpu') return 'cpu'
    // Sealed-relay / beap_ready host without LAN GPU probe — connected, hardware unknown.
    return 'info'
  }
  if (cap.hostHardware === 'gpu') return 'gpu'
  if (cap.hostHardware === 'cpu') return 'cpu'
  // hardware unknown — show Info if there is a specific reason, else Unavailable
  return cap.unavailableReason ? 'info' : 'unavailable'
}

export function GpuInferenceBarBadge(): JSX.Element | null {
  const [variant, setVariant]   = useState<BadgeVariant>('loading')
  const [tooltip, setTooltip]   = useState('Checking inference capability…')

  const refresh = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.llm : undefined
    // Use resolveInferenceCapability — NOT getGpuStatus — as source of truth.
    if (!api?.resolveInferenceCapability) return
    try {
      const res = await api.resolveInferenceCapability()
      if (!res.ok) {
        setVariant('unavailable')
        setTooltip(`Capability check failed: ${res.error}`)
        return
      }
      const cap = res.data
      setVariant(toVariant(cap))
      const parts: string[] = []
      if (cap.userMessage)       parts.push(cap.userMessage)
      if (cap.modelName)         parts.push(`Model: ${cap.modelName}`)
      if (cap.unavailableReason) parts.push(`Reason: ${cap.unavailableReason}`)
      setTooltip(parts.join('\n') || LABEL[toVariant(cap)])
    } catch (e: unknown) {
      setVariant('unavailable')
      setTooltip(e instanceof Error ? e.message : 'Capability check failed.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id  = window.setInterval(() => void refresh(), 45_000)
    const api = typeof window !== 'undefined' ? window.llm : undefined
    const off = api?.onActiveModelChanged?.(() => void refresh())
    return () => {
      window.clearInterval(id)
      try { off?.() } catch { /* ignore */ }
    }
  }, [refresh])

  // Hide if the IPC bridge is not available (test / SSR environments).
  if (typeof window === 'undefined' || !window.llm?.resolveInferenceCapability) {
    return null
  }

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
          background: BG[variant],
          borderRadius: 4,
          padding: '3px 7px',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          cursor: 'default',
          maxWidth: 132,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {LABEL[variant]}
      </span>
    </div>
  )
}
