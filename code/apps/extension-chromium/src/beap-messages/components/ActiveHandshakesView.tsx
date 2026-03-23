/**
 * ActiveHandshakesView
 *
 * Lists all ACTIVE handshakes for the current user in the BEAP Messages section.
 * Shows partner name/email, status, date established, and a link to the context/thread.
 * Revoked or expired handshakes are automatically excluded.
 *
 * Fulfills the BEAP Messages acceptance criteria:
 *  - Active handshakes appear after establishment for both parties.
 *  - Revoked/archived handshakes are removed from this view.
 */

import React, { useEffect, useState, useCallback } from 'react'
import { listHandshakes, revokeHandshake } from '../../handshake/handshakeRpc'
import type { HandshakeRecord } from '../../handshake/rpcTypes'

interface Props {
  theme?: 'default' | 'dark' | 'professional'
  onOpenThread?: (handshakeId: string, counterpartyEmail: string) => void
}

function StatusPill({ state }: { state: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    ACTIVE:         { label: 'Active', bg: 'rgba(34,197,94,0.12)', color: '#16a34a' },
    PENDING_ACCEPT: { label: 'Pending', bg: 'rgba(251,191,36,0.12)', color: '#d97706' },
    REVOKED:        { label: 'Revoked', bg: 'rgba(239,68,68,0.12)', color: '#dc2626' },
    EXPIRED:        { label: 'Expired', bg: 'rgba(107,114,128,0.12)', color: '#6b7280' },
  }
  const cfg = map[state] ?? { label: state, bg: 'rgba(107,114,128,0.12)', color: '#6b7280' }
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, padding: '2px 8px',
      borderRadius: '99px', background: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  )
}

export const ActiveHandshakesView: React.FC<Props> = ({ theme = 'dark', onOpenThread }) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'white' : 'rgba(255,255,255,0.04)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.02)'
  const headerBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'

  const [handshakes, setHandshakes] = useState<HandshakeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  const loadHandshakes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const all = await listHandshakes('active')
      setHandshakes(all)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load handshakes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHandshakes() }, [loadHandshakes])

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this handshake? This will terminate the secure channel.')) return
    setRevoking(id)
    try {
      await revokeHandshake(id)
      await loadHandshakes()
      if (selectedId === id) setSelectedId(null)
    } catch (err: any) {
      alert('Revoke failed: ' + err?.message)
    } finally {
      setRevoking(null)
    }
  }

  const selected = handshakes.find((h) => h.handshake_id === selectedId) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: bgColor, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: `1px solid ${borderColor}`,
        background: headerBg, display: 'flex', alignItems: 'center',
        gap: '12px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '16px' }}>🤝</span>
        <span style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>Active Handshakes</span>
        <span style={{
          fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
          background: isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
          color: '#a855f7', fontWeight: 500,
        }}>
          {handshakes.length}
        </span>
        <button
          onClick={loadHandshakes}
          style={{
            marginLeft: 'auto', fontSize: '11px', padding: '4px 10px',
            background: 'transparent', border: `1px solid ${borderColor}`,
            borderRadius: '6px', color: mutedColor, cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {/* Body — split view */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: List */}
        <div style={{
          width: '45%', minWidth: '260px', maxWidth: '380px',
          borderRight: `1px solid ${borderColor}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {loading && (
            <div style={{ padding: '40px', textAlign: 'center', color: mutedColor, fontSize: '13px' }}>
              Loading handshakes…
            </div>
          )}

          {!loading && error && (
            <div style={{
              padding: '14px', background: 'rgba(239,68,68,0.08)',
              borderBottom: `1px solid rgba(239,68,68,0.2)`,
              fontSize: '12px', color: '#ef4444',
            }}>
              {error}
            </div>
          )}

          {!loading && !error && handshakes.length === 0 && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '40px 20px', textAlign: 'center',
            }}>
              <span style={{ fontSize: '40px', marginBottom: '12px' }}>🤝</span>
              <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '6px' }}>
                No active handshakes
              </div>
              <div style={{ fontSize: '12px', color: mutedColor, maxWidth: '240px' }}>
                Initiate a BEAP Handshake Request to establish a secure channel with a counterparty.
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {handshakes.map((hs) => (
              <div
                key={hs.handshake_id}
                onClick={() => setSelectedId(hs.handshake_id)}
                style={{
                  padding: '12px 14px',
                  borderBottom: `1px solid ${borderColor}`,
                  background: selectedId === hs.handshake_id
                    ? (isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)')
                    : cardBg,
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                    {hs.counterparty_email || hs.counterparty_user_id || 'Unknown partner'}
                  </div>
                  <StatusPill state={hs.state} />
                </div>
                <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: mutedColor }}>
                  <span>Role: {hs.local_role}</span>
                  {hs.activated_at && (
                    <span>Established: {new Date(hs.activated_at).toLocaleDateString()}</span>
                  )}
                  {hs.sharing_mode && (
                    <span>{hs.sharing_mode === 'reciprocal' ? '↔ Reciprocal' : '→ Receive-only'}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Detail panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selected ? (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: mutedColor, fontSize: '13px', textAlign: 'center', padding: '20px',
            }}>
              Select a handshake to view details
            </div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Partner info */}
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: textColor, marginBottom: '6px' }}>
                  {selected.counterparty_email || selected.counterparty_user_id}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <StatusPill state={selected.state} />
                  <span style={{ fontSize: '11px', color: mutedColor }}>
                    {selected.local_role === 'initiator' ? 'You initiated' : 'You accepted'}
                  </span>
                </div>
              </div>

              {/* Details grid */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  ['Handshake ID', selected.handshake_id.slice(0, 24) + '…'],
                  ['Relationship ID', selected.relationship_id.slice(0, 24) + '…'],
                  ['Created', new Date(selected.created_at).toLocaleString()],
                  ['Established', selected.activated_at ? new Date(selected.activated_at).toLocaleString() : '—'],
                  ['Sharing Mode', selected.sharing_mode ?? '—'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
                    <span style={{ color: mutedColor, minWidth: '120px', flexShrink: 0 }}>{label}</span>
                    <span style={{ color: textColor, fontFamily: 'monospace', wordBreak: 'break-all' }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                {onOpenThread && (
                  <button
                    onClick={() => onOpenThread(selected.handshake_id, selected.counterparty_email)}
                    style={{
                      padding: '8px 16px',
                      background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                      border: 'none', borderRadius: '8px',
                      color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Open Thread
                  </button>
                )}
                <button
                  onClick={() => handleRevoke(selected.handshake_id)}
                  disabled={revoking === selected.handshake_id}
                  style={{
                    padding: '8px 16px',
                    background: 'transparent',
                    border: '1px solid rgba(239,68,68,0.4)',
                    borderRadius: '8px',
                    color: '#ef4444', fontSize: '12px', fontWeight: 600,
                    cursor: revoking === selected.handshake_id ? 'not-allowed' : 'pointer',
                    opacity: revoking === selected.handshake_id ? 0.6 : 1,
                  }}
                >
                  {revoking === selected.handshake_id ? 'Revoking…' : 'Revoke Handshake'}
                </button>
              </div>

              <div style={{
                padding: '10px 12px',
                background: isProfessional ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.12)',
                borderRadius: '8px', fontSize: '11px', color: mutedColor,
              }}>
                ℹ️ Revoking a handshake permanently terminates the secure channel. Both parties will see this change.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
