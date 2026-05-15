/**
 * Toolbar badge: surfaces local Ollama GPU offload readiness without requiring a failed chat attempt.
 */

import { useCallback, useEffect, useState } from 'react'

type BadgeVisual = 'loading' | 'ok' | 'issue'

export function GpuInferenceBarBadge(): JSX.Element | null {
  const [visual, setVisual] = useState<BadgeVisual>('loading')
  const [titleParts, setTitleParts] = useState<string>('Checking GPU offload…')

  const refresh = useCallback(async () => {
    const api = typeof window !== 'undefined' ? window.llm : undefined
    if (!api?.getGpuStatus) return
    try {
      const res = await api.getGpuStatus()
      if (!res.ok) {
        setVisual('issue')
        setTitleParts(`GPU status unavailable: ${res.error}`)
        return
      }
      const d = res.data
      const ok = d.available === true
      setVisual(ok ? 'ok' : 'issue')
      const parts: string[] = [d.userMessage]
      if (!ok) {
        parts.push('', 'Technical summary (for support):', String(d.technicalSummary ?? ''))
      }
      setTitleParts(parts.join('\n'))
    } catch (e: unknown) {
      setVisual('issue')
      setTitleParts(e instanceof Error ? e.message : 'GPU status refresh failed.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 45_000)
    const api = typeof window !== 'undefined' ? window.llm : undefined
    const off = api?.onActiveModelChanged?.(() => void refresh())
    return () => {
      window.clearInterval(id)
      try {
        off?.()
      } catch {
        /* ignore */
      }
    }
  }, [refresh])

  if (typeof window === 'undefined' || !window.llm?.getGpuStatus) {
    return null
  }

  const bg =
    visual === 'loading' ? '#64748b' : visual === 'ok' ? '#15803d' : '#b91c1c'
  const label = visual === 'loading' ? 'GPU …' : visual === 'ok' ? 'GPU OK' : 'GPU Issue'

  return (
    <div
      className="hs-gpu-badge"
      style={{
        marginLeft: 8,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
      title={titleParts}
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
