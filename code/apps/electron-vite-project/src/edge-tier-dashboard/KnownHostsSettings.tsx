import { useCallback, useEffect, useState } from 'react'
import { formatFingerprintForDisplay } from './knownHostsFormat.js'

export interface KnownHostRow {
  host: string
  port: number
  key_type: string
  fingerprint_sha256: string
  first_seen: string
  last_verified: string
}

export interface KnownHostsSettingsProps {
  disabled?: boolean
}

export function KnownHostsSettings({ disabled }: KnownHostsSettingsProps) {
  const [rows, setRows] = useState<KnownHostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [removingKey, setRemovingKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const bridge = window.edgeTier
    if (!bridge?.listKnownHosts) {
      setRows([])
      setLoading(false)
      return
    }
    try {
      const list = (await bridge.listKnownHosts()) as KnownHostRow[]
      setRows(Array.isArray(list) ? list : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleRemove = async (host: string, port: number) => {
    const bridge = window.edgeTier
    if (!bridge?.removeKnownHost) return
    const key = `${host}:${port}`
    setRemovingKey(key)
    try {
      await bridge.removeKnownHost({ host, port })
      await refresh()
    } finally {
      setRemovingKey(null)
    }
  }

  return (
    <div data-testid="edge-known-hosts-settings" style={{ marginTop: 20 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Known hosts</h3>
      <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
        SSH host key fingerprints trusted for edge VPS connections. Removing an entry forces a fresh
        trust prompt on the next connect.
      </p>
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }} data-testid="known-hosts-empty">
          No host keys stored yet — fingerprints are saved on first successful SSH connect.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => {
            const rowKey = `${row.host}:${row.port}`
            return (
              <li
                key={rowKey}
                data-testid={`known-host-row-${rowKey}`}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {row.host}:{row.port}{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>({row.key_type})</span>
                </div>
                <code style={{ fontSize: 11, wordBreak: 'break-all' }}>
                  {formatFingerprintForDisplay(row.fingerprint_sha256)}
                </code>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    data-testid={`known-host-remove-${rowKey}`}
                    disabled={disabled || removingKey === rowKey}
                    onClick={() => void handleRemove(row.host, row.port)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
