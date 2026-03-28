// === TEMPORARY DEBUG LOG VIEWER (remove before production) ===
import { useState, useEffect, useRef } from 'react'

export interface MainProcessLogEntry {
  ts: string
  level: string
  line: string
}

export function DebugLogViewer() {
  const [open, setOpen] = useState(false)
  const [logs, setLogs] = useState<MainProcessLogEntry[]>([])
  const [filter, setFilter] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

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

  const filtered = filter
    ? logs.filter((l) => {
        const q = filter.toLowerCase()
        if (filter === 'Error') {
          return l.level === 'error' || l.line.toLowerCase().includes('error')
        }
        return l.line.toLowerCase().includes(q) || l.level.toLowerCase().includes(q)
      })
    : logs

  const levelColor = (l: string) =>
    l === 'error' ? '#ff6666' : l === 'warn' ? '#ffaa00' : '#aaaaaa'

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
        <button
          type="button"
          onClick={() => setFilter('')}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: 'none',
            background: filter === '' ? '#555' : '#333',
            color: '#eee',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          All
        </button>
        {(['P2P', 'Coordination', 'BEAP', 'Error', 'insert'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(filter === f ? '' : f)}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: 'none',
              background: filter === f ? '#555' : '#333',
              color: '#eee',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {f}
          </button>
        ))}
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
