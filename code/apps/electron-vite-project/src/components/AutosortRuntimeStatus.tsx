/**
 * Compact toolbar badge showing the effective Auto-Sort runtime state.
 * Reads from `llm:resolveAutosortRuntime` — the same strict check that gates autosort start.
 * Refreshes on mount and whenever the active Ollama model changes.
 *
 * Displays:
 *  - Green pill  → GPU verified, model confirmed, autosort allowed
 *  - Red pill    → blocked with actionable message
 *  - Grey pill   → loading or bridge unavailable
 */
import { useCallback, useEffect, useState } from 'react'

const GPU_LABEL: Record<string, string> = {
  gpu_capable: 'GPU',
  gpu_unconfirmed: 'GPU?',
  cpu_likely: 'CPU',
  unknown: '?',
}

const GPU_COLOR: Record<string, string> = {
  gpu_capable: '#15803d',
  gpu_unconfirmed: '#92400e',
  cpu_likely: '#991b1b',
  unknown: '#64748b',
}

interface StatusBadgeState {
  loading: boolean
  allowed: boolean
  model: string | null
  gpu: string
  blockMessage: string | null
  blockReason: string | null
}

const EMPTY: StatusBadgeState = {
  loading: true,
  allowed: false,
  model: null,
  gpu: 'unknown',
  blockMessage: null,
  blockReason: null,
}

export function AutosortRuntimeStatus() {
  const [state, setState] = useState<StatusBadgeState>(EMPTY)

  const refresh = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.llm : undefined
    if (!api?.resolveAutosortRuntime) {
      setState({ ...EMPTY, loading: false })
      return
    }
    setState((s) => ({ ...s, loading: true }))
    try {
      const res = await api.resolveAutosortRuntime()
      if (!res.ok) {
        console.warn('[AutosortRuntimeStatus] resolveAutosortRuntime error:', res.error)
        setState({
          loading: false,
          allowed: false,
          model: null,
          gpu: 'unknown',
          blockMessage: res.error ?? 'Runtime check failed',
          blockReason: 'error',
        })
        return
      }
      const d = res.data
      console.log('[AutosortRuntimeStatus] resolved:', {
        allowed: d.autosortAllowed,
        model: d.model,
        gpu: d.gpuClassification,
        blockReason: d.blockReason ?? null,
      })
      setState({
        loading: false,
        allowed: d.autosortAllowed,
        model: d.model,
        gpu: d.gpuClassification,
        blockMessage: d.blockMessage,
        blockReason: d.blockReason,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Runtime check failed'
      console.error('[AutosortRuntimeStatus] resolveAutosortRuntime threw:', msg)
      setState({
        loading: false,
        allowed: false,
        model: null,
        gpu: 'unknown',
        blockMessage: msg,
        blockReason: 'error',
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.llm : undefined
    if (!api?.onActiveModelChanged) return
    return api.onActiveModelChanged(() => void refresh())
  }, [refresh])

  if (state.loading) {
    return (
      <span
        style={{
          fontSize: 10,
          color: '#94a3b8',
          padding: '1px 6px',
          borderRadius: 3,
          border: '1px solid #e2e8f0',
          whiteSpace: 'nowrap',
        }}
        title="Checking autosort runtime…"
      >
        Runtime…
      </span>
    )
  }

  if (state.allowed) {
    const gpuColor = GPU_COLOR[state.gpu] ?? '#64748b'
    const gpuLabel = GPU_LABEL[state.gpu] ?? '?'
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: 3,
          background: 'rgba(21,128,61,0.10)',
          border: '1px solid rgba(21,128,61,0.35)',
          color: '#15803d',
          whiteSpace: 'nowrap',
          fontWeight: 600,
          cursor: 'default',
        }}
        title={`Auto-Sort ready · provider: local Ollama · model: ${state.model ?? '?'} · GPU: ${state.gpu}`}
      >
        <span>{state.model ?? '?'}</span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '0 3px',
            borderRadius: 2,
            background: gpuColor,
            color: '#fff',
            letterSpacing: '0.03em',
          }}
        >
          {gpuLabel}
        </span>
      </span>
    )
  }

  // Blocked
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 3,
        background: 'rgba(220,38,38,0.10)',
        border: '1px solid rgba(220,38,38,0.40)',
        color: '#dc2626',
        whiteSpace: 'nowrap',
        fontWeight: 600,
        cursor: 'default',
        maxWidth: 260,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={state.blockMessage ?? 'Auto-Sort blocked'}
    >
      ⚠ {state.blockReason ?? 'blocked'}
    </span>
  )
}
