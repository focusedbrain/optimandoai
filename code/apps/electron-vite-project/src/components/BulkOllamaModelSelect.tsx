/**
 * Compact autosort model selector — placed in the autosort toolbar row.
 * Controls the active Ollama model used exclusively for inbox Auto-Sort.
 * Reads/writes the same persisted preference as Backend Configuration (`setActiveModelPreference`).
 *
 * When `showRuntimeChip` is true, renders a compact GPU/blocked chip inline after the dropdown,
 * replacing the need for a separate AutosortRuntimeStatus badge in the toolbar.
 *
 * Separate from any chat model selector. Must be disabled while autosort is running to avoid
 * mid-run model switching that could cause VRAM contention or inconsistent chunk resolution.
 *
 * Bulk Auto-Sort: each main-process chunk calls `preResolveInboxLlm()` once when handling `aiClassifyBatch`.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'

const MUTED = '#64748b'

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

interface RuntimeChipState {
  loading: boolean
  allowed: boolean
  gpu: string
  blockMessage: string | null
  blockReason: string | null
}

const CHIP_EMPTY: RuntimeChipState = {
  loading: true,
  allowed: false,
  gpu: 'unknown',
  blockMessage: null,
  blockReason: null,
}

export type BulkOllamaModelSelectVariant = 'toolbar' | 'progress'

export function BulkOllamaModelSelect({
  variant,
  disabled,
  disabledReason,
  showRuntimeChip = false,
}: {
  variant: BulkOllamaModelSelectVariant
  /** When true, selector is locked and shows a tooltip explaining why. */
  disabled?: boolean
  /** Tooltip text shown when disabled. Defaults to autosort-running message. */
  disabledReason?: string
  /**
   * When true, renders a compact GPU/blocked chip inline next to the dropdown,
   * replacing the need for a separate AutosortRuntimeStatus element in the toolbar.
   */
  showRuntimeChip?: boolean
}) {
  const compact = variant === 'toolbar'
  const [models, setModels] = useState<string[]>([])
  const [active, setActive] = useState<string | undefined>()
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [runtimeSummary, setRuntimeSummary] = useState<string | undefined>()
  const [chip, setChip] = useState<RuntimeChipState>(CHIP_EMPTY)

  const refreshChip = useCallback(async () => {
    if (!showRuntimeChip) return
    const api = typeof window !== 'undefined' ? window.llm : undefined
    if (!api?.resolveAutosortRuntime) {
      setChip({ ...CHIP_EMPTY, loading: false })
      return
    }
    try {
      const res = await api.resolveAutosortRuntime()
      if (!res.ok) {
        setChip({ loading: false, allowed: false, gpu: 'unknown', blockMessage: res.error ?? 'Runtime check failed', blockReason: 'error' })
        return
      }
      const d = res.data
      setChip({ loading: false, allowed: d.autosortAllowed, gpu: d.gpuClassification, blockMessage: d.blockMessage, blockReason: d.blockReason ?? null })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Runtime check failed'
      setChip({ loading: false, allowed: false, gpu: 'unknown', blockMessage: msg, blockReason: 'error' })
    }
  }, [showRuntimeChip])

  const refresh = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.llm : undefined
    if (!api?.getStatus) {
      setLoading(false)
      return
    }
    setError(null)
    try {
      const res = await api.getStatus()
      if (!res.ok) {
        setError(res.error || 'Could not load Ollama status')
        setModels([])
        setActive(undefined)
        setRunning(false)
        setRuntimeSummary(undefined)
        return
      }
      const d = res.data
      setRunning(!!d.running)
      setRuntimeSummary(d.localRuntime?.summary)
      const names = (d.modelsInstalled || []).map((m) => m.name).sort((a, b) => a.localeCompare(b))
      setModels(names)
      setActive(d.activeModel)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not load Ollama status'
      setError(msg)
      setRuntimeSummary(undefined)
    } finally {
      setLoading(false)
      // Refresh chip after model list/status is updated
      void refreshChip()
    }
  }, [refreshChip])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const api = window.llm
    if (!api?.onActiveModelChanged) return
    return api.onActiveModelChanged(() => {
      void refresh()
    })
  }, [refresh])

  const api = typeof window !== 'undefined' ? window.llm : undefined
  if (!api?.getStatus || !api.setActiveModel) return null

  const lockedMsg =
    disabled && disabledReason
      ? disabledReason
      : disabled
        ? 'Autosort model cannot be changed during an active sort.'
        : null

  const title = lockedMsg
    ? lockedMsg
    : 'Select the local Ollama model used for Auto-Sort. This setting is independent of any chat model.' +
      (runtimeSummary ? ` ${runtimeSummary}` : '')

  const onChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (!next) return
    setSwitching(true)
    setError(null)
    console.log('[BulkOllamaModelSelect] model change requested:', next)
    try {
      const res = await api.setActiveModel(next)
      if (!res.ok) {
        setError(res.error || 'Failed to save active model')
        console.warn('[BulkOllamaModelSelect] setActiveModel rejected:', next, res.error)
        await refresh()
        return
      }
      console.log('[BulkOllamaModelSelect] model change persisted:', next)
      await refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save active model'
      setError(msg)
      console.error('[BulkOllamaModelSelect] setActiveModel threw:', msg)
      await refresh()
    } finally {
      setSwitching(false)
    }
  }

  if (loading) {
    return (
      <span style={{ fontSize: compact ? 11 : 10, color: MUTED, whiteSpace: 'nowrap' }} title={title}>
        Model…
      </span>
    )
  }

  if (!running) {
    return (
      <span
        style={{ fontSize: compact ? 11 : 10, color: '#b45309', whiteSpace: 'nowrap' }}
        title={
          title +
          ' Start Ollama from Backend Configuration or your system.' +
          (runtimeSummary ? ` ${runtimeSummary}` : '')
        }
      >
        Ollama off
      </span>
    )
  }

  if (models.length === 0) {
    return (
      <span style={{ fontSize: compact ? 11 : 10, color: MUTED, whiteSpace: 'nowrap' }} title={title}>
        No local models
      </span>
    )
  }

  // Detect mismatch: stored preference exists but is not in installed list.
  // Do NOT silently fall back to models[0] — show an explicit warning instead.
  const storedMissing = !!active && !models.includes(active)
  const effectiveValue = storedMissing ? '' : (active ?? models[0])

  // Runtime chip rendered inline after the selector
  const runtimeChip = showRuntimeChip ? (() => {
    if (chip.loading) {
      return (
        <span
          style={{ fontSize: 9, color: '#94a3b8', padding: '1px 5px', borderRadius: 3, border: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}
          title="Checking autosort runtime…"
        >
          …
        </span>
      )
    }
    if (chip.allowed) {
      const gpuColor = GPU_COLOR[chip.gpu] ?? '#64748b'
      const gpuLabel = GPU_LABEL[chip.gpu] ?? '?'
      return (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            padding: '1px 5px',
            borderRadius: 3,
            background: gpuColor,
            color: '#fff',
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
            cursor: 'default',
          }}
          title={`Auto-Sort ready · GPU: ${chip.gpu}`}
        >
          {gpuLabel}
        </span>
      )
    }
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          padding: '1px 5px',
          borderRadius: 3,
          background: 'rgba(220,38,38,0.12)',
          border: '1px solid rgba(220,38,38,0.40)',
          color: '#dc2626',
          whiteSpace: 'nowrap',
          cursor: 'default',
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'inline-block',
        }}
        title={chip.blockMessage ?? 'Auto-Sort blocked'}
      >
        ⚠ {chip.blockReason ?? 'blocked'}
      </span>
    )
  })() : null

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        fontSize: compact ? 11 : 10,
        color: MUTED,
        cursor: disabled || switching ? 'default' : 'pointer',
        userSelect: 'none',
        minWidth: 0,
        marginLeft: compact ? 8 : 0,
        flex: variant === 'progress' ? '1 1 auto' : undefined,
      }}
      title={title}
    >
      <span style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#334155' }}>Auto-Sort</span>
      {storedMissing ? (
        <span
          style={{
            fontSize: compact ? 11 : 10,
            color: '#dc2626',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            maxWidth: compact ? 200 : 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={`Model "${active}" is selected but not installed. Install it or choose another model.`}
        >
          ⚠ {active} not installed — select a model
        </span>
      ) : (
        <select
          value={effectiveValue}
          onChange={(ev) => void onChange(ev)}
          disabled={!!disabled || switching}
          aria-label="Active Ollama model for inbox AI"
          style={{
            maxWidth: compact ? 148 : 200,
            minWidth: 0,
            fontSize: compact ? 11 : 10,
            padding: '2px 4px',
            borderRadius: 4,
            border: `1px solid ${error ? '#ef4444' : '#cbd5e1'}`,
            background: '#fff',
            color: '#0f172a',
            cursor: disabled || switching ? 'not-allowed' : 'pointer',
          }}
        >
          {!active && (
            <option value="" disabled>
              — select a model —
            </option>
          )}
          {models.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
      {runtimeChip}
      {error ? (
        <span style={{ color: '#ef4444', fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={error}>
          {error}
        </span>
      ) : null}
    </label>
  )
}
