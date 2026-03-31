/**
 * Compact active Ollama model switcher — mounted only in the bulk Auto-Sort progress dock (not header).
 * Reads/writes the same persisted preference as Backend Configuration (`setActiveModelPreference`).
 *
 * Bulk Auto-Sort: each main-process chunk calls `preResolveInboxLlm()` once when handling `aiClassifyBatch`.
 * Changing the model mid-run applies to the **next** chunk only; the in-flight chunk keeps its model.
 */
import { useCallback, useEffect, useState, type ChangeEvent } from 'react'

const MUTED = '#64748b'

export type BulkOllamaModelSelectVariant = 'toolbar' | 'progress'

export function BulkOllamaModelSelect({
  variant,
  disabled,
}: {
  variant: BulkOllamaModelSelectVariant
  /** When true (e.g. sort running), still allow switching — next chunk picks up the new model. */
  disabled?: boolean
}) {
  const compact = variant === 'toolbar'
  const [models, setModels] = useState<string[]>([])
  const [active, setActive] = useState<string | undefined>()
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [runtimeSummary, setRuntimeSummary] = useState<string | undefined>()

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
    }
  }, [])

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

  useEffect(() => {
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const api = typeof window !== 'undefined' ? window.llm : undefined
  if (!api?.getStatus || !api.setActiveModel) return null

  const title =
    'Local Ollama model for inbox AI (same setting as Backend Configuration). If you change it during Auto-Sort, the current batch chunk keeps its already-resolved model; the next chunk uses the new model (see preResolveInboxLlm).' +
    (runtimeSummary ? ` ${runtimeSummary}` : '')

  const onChange = async (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value
    if (!next) return
    setSwitching(true)
    setError(null)
    try {
      const res = await api.setActiveModel(next)
      if (!res.ok) {
        setError(res.error || 'Failed to save active model')
        await refresh()
        return
      }
      await refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save active model'
      setError(msg)
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

  const effectiveValue = active && models.includes(active) ? active : models[0]

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
      <span style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#334155' }}>Ollama model</span>
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
        {models.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {error ? (
        <span style={{ color: '#ef4444', fontSize: 10, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={error}>
          {error}
        </span>
      ) : null}
    </label>
  )
}
