// === TEMPORARY DEBUG LOG VIEWER (remove before production) ===
import { useState, useEffect, useRef, useCallback } from 'react'
import type { EmailInboxBridge } from './handshakeViewTypes'
import { buildClipboardText, filterLogEntries } from '../lib/debugLogClipboard'

export interface MainProcessLogEntry {
  ts: string
  level: string
  line: string
}

export function DebugLogViewer() {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<MainProcessLogEntry[]>([])
  const [filter, setFilter] = useState('')
  const [nativeBeapCount, setNativeBeapCount] = useState<number | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<{ ok: boolean; msg?: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const w = window as Window & {
      debugLogs?: {
        onLog: (cb: (entry: MainProcessLogEntry) => void) => () => void
        removeLogListener?: () => void
      }
    }
    if (!w.debugLogs?.onLog) return
    const unsub = w.debugLogs.onLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry]
        return next.length > 500 ? next.slice(-500) : next
      })
    })
    return () => {
      unsub?.()
      w.debugLogs?.removeLogListener?.()
    }
  }, [])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const w = window as Window & { emailInbox?: EmailInboxBridge }
        const res = await w.emailInbox?.listMessageIds?.({ sourceType: 'direct_beap', limit: 10000 })
        if (cancelled) return
        if (res?.ok && res.data?.total != null) setNativeBeapCount(res.data.total)
        else setNativeBeapCount(0)
      } catch {
        if (!cancelled) setNativeBeapCount(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const filtered = filterLogEntries(logs, filter)

  const levelColor = (l: string) =>
    l === 'error' ? '#ff6666' : l === 'warn' ? '#ffaa00' : '#aaaaaa'

  const copyLogs = useCallback(async (entries: MainProcessLogEntry[], plain: boolean) => {
    const text = buildClipboardText(entries, plain)
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    try {
      await navigator.clipboard.writeText(text)
      setCopyFeedback({ ok: true })
      copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 1500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setCopyFeedback({ ok: false, msg: msg.slice(0, 60) })
      copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 3000)
    }
  }, [])

  const chipBtn = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        border: 'none',
        background: active ? '#555' : '#333',
        color: '#eee',
        cursor: 'pointer',
        fontSize: 11,
      }}
    >
      {label}
    </button>
  )

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 99999,
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          background: '#333',
          color: '#fff',
          cursor: 'pointer',
          fontSize: 14,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        🔧 Logs ({logs.length})
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 99999,
        width: '80vw',
        maxWidth: 900,
        maxHeight: '60vh',
        background: '#1a1a1a',
        color: '#eee',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 'bold', fontSize: 14 }}>Main Process Logs</span>
        <input
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            minWidth: 120,
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #444',
            background: '#222',
            color: '#eee',
          }}
        />
        {chipBtn('All', filter === '', () => setFilter(''))}
        {(['P2P', 'Coordination', 'BEAP', 'Error', 'insert'] as const).map((f) =>
          chipBtn(f, filter === f, () => setFilter(filter === f ? '' : f)),
        )}
        {/* ── Copy controls ── */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 4 }}>
          <button
            type="button"
            onClick={() => void copyLogs(filtered, false)}
            title={`Copy ${filtered.length} visible line(s) with timestamps`}
            style={{
              padding: '2px 8px',
              borderRadius: '4px 0 0 4px',
              border: 'none',
              background: '#1a4a6b',
              color: '#90cdf4',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 'bold',
            }}
          >
            📋 Copy filtered ({filtered.length})
          </button>
          <button
            type="button"
            onClick={() => void copyLogs(filtered, true)}
            title="Copy visible lines — payload only, no HH:MM:SS [LEVEL] prefix"
            style={{
              padding: '2px 6px',
              borderRadius: '0 4px 4px 0',
              border: 'none',
              borderLeft: '1px solid #0d2d45',
              background: '#0f3354',
              color: '#63b3ed',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            plain
          </button>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            onClick={() => void copyLogs(logs, false)}
            title={`Copy all ${logs.length} buffered lines regardless of filter`}
            style={{
              padding: '2px 8px',
              borderRadius: '4px 0 0 4px',
              border: 'none',
              background: '#2d3748',
              color: '#a0aec0',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            📋 Copy all ({logs.length})
          </button>
          <button
            type="button"
            onClick={() => void copyLogs(logs, true)}
            title="Copy all buffered lines — payload only, no HH:MM:SS [LEVEL] prefix"
            style={{
              padding: '2px 6px',
              borderRadius: '0 4px 4px 0',
              border: 'none',
              borderLeft: '1px solid #1a202c',
              background: '#1a202c',
              color: '#718096',
              cursor: 'pointer',
              fontSize: 10,
            }}
          >
            plain
          </button>
        </span>
        {copyFeedback && (
          <span
            style={{
              fontSize: 11,
              color: copyFeedback.ok ? '#4ade80' : '#f87171',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
            }}
          >
            {copyFeedback.ok ? '✓ Copied!' : `✗ ${copyFeedback.msg ?? 'Copy failed'}`}
          </span>
        )}
        <button
          type="button"
          onClick={() => setLogs([])}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: 'none',
            background: '#333',
            color: '#eee',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
        {nativeBeapCount != null && nativeBeapCount > 0 && (
          <button
            type="button"
            title="Dev only: removes direct_beap rows from local SQLite (attachments + pending queue match)"
            onClick={async () => {
              if (
                !confirm(
                  'Delete ALL native BEAP messages from the local inbox? This cannot be undone.',
                )
              ) {
                return
              }
              const w = window as Window & { emailInbox?: EmailInboxBridge }
              const res = await w.emailInbox?.deleteAllDirectBeap?.()
              if (res?.ok) setNativeBeapCount(0)
            }}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid #7f1d1d',
              background: '#3f1515',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Delete all native BEAP ({nativeBeapCount})
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: 'none',
            background: '#c33',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 8px' }}>
        {filtered.length === 0 && (
          <div style={{ color: '#666', padding: 16, textAlign: 'center' }}>
            {logs.length === 0 ? 'Waiting for logs...' : 'No matching entries'}
          </div>
        )}
        {filtered.map((l, i) => (
          <div
            key={`${l.ts}-${i}`}
            style={{
              padding: '2px 0',
              borderBottom: '1px solid #222',
              color: levelColor(l.level),
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            <span style={{ color: '#666' }}>{l.ts.slice(11, 19)}</span>{' '}
            <span
              style={{
                color: levelColor(l.level),
                fontWeight: l.level === 'error' ? 'bold' : 'normal',
              }}
            >
              [{l.level.toUpperCase()}]
            </span>{' '}
            {l.line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
// === END TEMPORARY DEBUG LOG VIEWER ===
