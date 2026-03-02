/**
 * HandshakeView — Three-panel layout for the Analysis Dashboard
 *
 * Left:   Relationships list (ACTIVE / REVOKED / EXPIRED) with selection + "New Handshake"
 * Center: Detail + Chat sidebar scoped to the selected relationship
 * Right:  Incoming panel (PENDING_ACCEPT) with accept/decline + .beap upload zone
 */

import { useEffect, useState, useCallback } from 'react'
import CapsuleUploadZone from './CapsuleUploadZone'
import RelationshipDetail from './RelationshipDetail'
import HandshakeChatSidebar from './HandshakeChatSidebar'

// ── Types ──

interface HandshakeRecord {
  handshake_id: string
  relationship_id: string
  state: 'PENDING_ACCEPT' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  initiator: { email: string; wrdesk_user_id: string } | null
  acceptor: { email: string; wrdesk_user_id: string } | null
  local_role: 'initiator' | 'acceptor'
  sharing_mode: string | null
  created_at: string
  activated_at: string | null
  expires_at: string | null
  last_seq_received: number
  last_capsule_hash_received: string
}

import './handshakeViewTypes'

// ── Helpers ──

function shortId(id: string): string {
  if (!id) return ''
  return id.length > 16 ? `${id.slice(0, 3)}…${id.slice(-6)}` : id
}

function formatDate(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return '—' }
}

function counterpartyEmail(record: HandshakeRecord): string {
  if (record.local_role === 'initiator') {
    return record.acceptor?.email ?? '(pending)'
  }
  return record.initiator?.email ?? ''
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Status badge ──

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    ACTIVE: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
    PENDING_ACCEPT: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
    REVOKED: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
    EXPIRED: { bg: 'rgba(107,114,128,0.12)', text: '#6b7280', border: 'rgba(107,114,128,0.3)' },
  }
  const c = colors[state] || colors.EXPIRED
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, padding: '2px 7px',
      borderRadius: '4px', background: c.bg, color: c.text,
      border: `1px solid ${c.border}`, textTransform: 'uppercase',
    }}>
      {state.replace('_', ' ')}
    </span>
  )
}

// ── New Handshake Dialog ──

function NewHandshakeDialog({ onCreated, onClose }: {
  onCreated: () => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [mode, setMode] = useState<'api' | 'download'>('download')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const isValid = email.trim() && EMAIL_PATTERN.test(email.trim())

  const handleCreate = async () => {
    if (!isValid) return
    setSending(true)
    setError(null)
    try {
      if (mode === 'api') {
        const res = await window.handshakeView?.initiateHandshake?.(email.trim(), '')
        if (res?.success || res?.handshake_id) {
          setSuccess('Handshake created and email sent.')
          onCreated()
        } else {
          setError(res?.error || 'Failed to create handshake.')
        }
      } else {
        const res = await window.handshakeView?.buildForDownload?.(email.trim())
        if (res?.success && res?.capsule_json) {
          const hsId = res.handshake_id?.slice(3, 11) || 'capsule'
          const filename = `handshake-${hsId}.beap`
          const dlResult = await window.handshakeView?.downloadCapsule?.(res.capsule_json, filename)
          if (dlResult?.success) {
            setSuccess(`Capsule saved to ${dlResult.filePath}`)
          } else if (dlResult?.reason === 'cancelled') {
            return
          } else {
            setSuccess('Capsule built. Check your downloads.')
          }
          onCreated()
        } else {
          setError(res?.error || 'Failed to build capsule.')
        }
      }
    } catch (err: any) {
      setError(err?.message || 'An error occurred.')
    } finally {
      setSending(false)
    }
  }

  if (success) {
    return (
      <div style={{
        padding: '16px',
        background: 'var(--color-surface, rgba(255,255,255,0.04))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: '8px', marginBottom: '12px',
      }}>
        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>{success}</div>
        <button onClick={onClose} style={{
          padding: '6px 14px', fontSize: '11px', fontWeight: 600,
          background: 'var(--color-accent-bg, rgba(139,92,246,0.12))',
          border: '1px solid var(--color-accent-border, rgba(139,92,246,0.3))',
          borderRadius: '6px', color: 'var(--color-accent, #a78bfa)', cursor: 'pointer',
        }}>Done</button>
      </div>
    )
  }

  return (
    <div style={{
      padding: '14px',
      background: 'var(--color-surface, rgba(255,255,255,0.04))',
      border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
      borderRadius: '8px', marginBottom: '12px',
    }}>
      <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px', color: 'var(--color-text, #e2e8f0)' }}>
        New Handshake
      </div>

      <label style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Recipient Email
      </label>
      <input
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="partner@company.com"
        style={{
          width: '100%', padding: '7px 10px', fontSize: '12px', marginTop: '4px', marginBottom: '10px',
          background: 'var(--color-input-bg, rgba(255,255,255,0.06))',
          border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
          borderRadius: '6px', color: 'var(--color-text, #e2e8f0)', outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        {(['api', 'download'] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              flex: 1, padding: '6px 8px', fontSize: '10px', fontWeight: 600,
              background: mode === m ? 'var(--color-accent-bg, rgba(139,92,246,0.15))' : 'transparent',
              border: `1px solid ${mode === m ? 'rgba(139,92,246,0.4)' : 'var(--color-border, rgba(255,255,255,0.1))'}`,
              borderRadius: '6px',
              color: mode === m ? 'var(--color-accent, #a78bfa)' : 'var(--color-text-muted, #94a3b8)',
              cursor: 'pointer',
            }}
          >
            {m === 'api' ? 'Send via API' : 'Download .beap'}
          </button>
        ))}
      </div>

      {error && (
        <div style={{
          marginBottom: '8px', padding: '6px 8px', fontSize: '10px',
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '4px', color: '#ef4444',
        }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={handleCreate}
          disabled={!isValid || sending}
          style={{
            flex: 1, padding: '7px 12px', fontSize: '11px', fontWeight: 600,
            background: !isValid || sending ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
            border: '1px solid rgba(139,92,246,0.3)', borderRadius: '6px',
            color: '#a78bfa', cursor: !isValid || sending ? 'not-allowed' : 'pointer',
            opacity: !isValid ? 0.5 : 1,
          }}
        >
          {sending ? 'Creating…' : 'Create'}
        </button>
        <button onClick={onClose} style={{
          padding: '7px 12px', fontSize: '11px', fontWeight: 600,
          background: 'transparent', color: 'var(--color-text-muted, #94a3b8)',
          border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
          borderRadius: '6px', cursor: 'pointer',
        }}>Cancel</button>
      </div>
    </div>
  )
}

// ── Main Component ──

export default function HandshakeView() {
  const [handshakes, setHandshakes] = useState<HandshakeRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [contextBlockCounts, setContextBlockCounts] = useState<Record<string, number>>({})
  const [showNewDialog, setShowNewDialog] = useState(false)

  const loadHandshakes = useCallback(async () => {
    setLoading(true)
    try {
      const records = await window.handshakeView?.listHandshakes() ?? []
      setHandshakes(records)
      const counts: Record<string, number> = {}
      for (const r of records) {
        try {
          counts[r.handshake_id] = await window.handshakeView?.getContextBlockCount(r.handshake_id) ?? 0
        } catch { counts[r.handshake_id] = 0 }
      }
      setContextBlockCounts(counts)
    } catch {
      setHandshakes([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHandshakes() }, [loadHandshakes])

  const selectedRecord = handshakes.find(h => h.handshake_id === selectedId) ?? null

  const active = handshakes.filter(h => h.state === 'ACTIVE')
  const revoked = handshakes.filter(h => h.state === 'REVOKED')
  const expired = handshakes.filter(h => h.state === 'EXPIRED')
  const pending = handshakes.filter(h => h.state === 'PENDING_ACCEPT')

  const handleAccept = async (id: string) => {
    try {
      const res = await window.handshakeView?.acceptHandshake(id, 'reciprocal', '')
      if (res?.success !== false) await loadHandshakes()
    } catch { /* UI shows stale state until refresh */ }
  }

  const handleDecline = async (id: string) => {
    try {
      const res = await window.handshakeView?.declineHandshake(id)
      if (res?.success !== false) await loadHandshakes()
    } catch { /* UI shows stale state until refresh */ }
  }

  const handleCapsuleSubmitted = () => { loadHandshakes() }

  const renderGroup = (title: string, records: HandshakeRecord[]) => {
    if (records.length === 0) return null
    return (
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.8px', color: 'var(--color-text-muted, #94a3b8)',
          padding: '4px 12px', marginBottom: '4px',
        }}>
          {title} ({records.length})
        </div>
        {records.map(r => (
          <button
            key={r.handshake_id}
            onClick={() => setSelectedId(r.handshake_id)}
            style={{
              display: 'flex', flexDirection: 'column', gap: '3px',
              width: '100%', padding: '10px 12px', textAlign: 'left',
              background: selectedId === r.handshake_id
                ? 'var(--color-accent-bg, rgba(139,92,246,0.12))'
                : 'transparent',
              border: 'none', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              cursor: 'pointer', color: 'inherit',
              transition: 'background 0.1s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)' }}>
                {counterpartyEmail(r)}
              </span>
              <StateBadge state={r.state} />
            </div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
              {shortId(r.handshake_id)} · {formatDate(r.created_at)}
              {contextBlockCounts[r.handshake_id] > 0 && ` · ${contextBlockCounts[r.handshake_id]} blocks`}
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '280px 1fr 320px',
      height: '100%', overflow: 'hidden',
      background: 'var(--color-bg, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
    }}>
      {/* ── Left Panel: Handshakes ── */}
      <div style={{
        borderRight: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 12px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '13px', fontWeight: 700 }}>Handshakes</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setShowNewDialog(v => !v)}
              style={{
                padding: '4px 8px', fontSize: '10px', fontWeight: 600,
                background: showNewDialog
                  ? 'rgba(139,92,246,0.25)'
                  : 'var(--color-accent-bg, rgba(139,92,246,0.12))',
                border: '1px solid var(--color-accent-border, rgba(139,92,246,0.3))',
                borderRadius: '5px', color: 'var(--color-accent, #a78bfa)',
                cursor: 'pointer',
              }}
            >+ New</button>
            <button
              onClick={loadHandshakes}
              style={{
                padding: '4px 8px', fontSize: '10px', fontWeight: 600,
                background: 'var(--color-accent-bg, rgba(139,92,246,0.12))',
                border: '1px solid var(--color-accent-border, rgba(139,92,246,0.3))',
                borderRadius: '5px', color: 'var(--color-accent, #a78bfa)',
                cursor: 'pointer',
              }}
            >Refresh</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: showNewDialog ? '8px 8px 0' : undefined }}>
          {showNewDialog && (
            <NewHandshakeDialog
              onCreated={() => { loadHandshakes(); setShowNewDialog(false) }}
              onClose={() => setShowNewDialog(false)}
            />
          )}

          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
              Loading…
            </div>
          ) : (
            <>
              {renderGroup('Active', active)}
              {renderGroup('Revoked', revoked)}
              {renderGroup('Expired', expired)}
              {handshakes.length === 0 && (
                <div style={{
                  padding: '28px 16px', textAlign: 'center',
                  color: 'var(--color-text-muted, #94a3b8)',
                }}>
                  <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.4 }}>&#128279;</div>
                  <div style={{ fontSize: '12px', lineHeight: 1.6 }}>
                    No handshakes yet.
                    <br />
                    Start a new handshake or upload a <strong>.beap</strong> file
                    to establish a trusted relationship.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Center Panel: Detail + Chat ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {selectedRecord ? (
          <>
            <div style={{ flex: '0 0 auto', maxHeight: '55%', overflowY: 'auto' }}>
              <RelationshipDetail
                record={selectedRecord}
                contextBlockCount={contextBlockCounts[selectedRecord.handshake_id] ?? 0}
              />
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <HandshakeChatSidebar
                handshakeId={selectedId}
                contextBlockCount={contextBlockCounts[selectedRecord.handshake_id] ?? 0}
              />
            </div>
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--color-text-muted, #94a3b8)',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>&#128064;</div>
            <div style={{ fontSize: '13px' }}>Select a relationship to view details</div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Incoming ── */}
      <div style={{
        borderLeft: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 12px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          fontSize: '13px', fontWeight: 700,
        }}>
          Incoming ({pending.length})
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {pending.length === 0 ? (
            <div style={{
              padding: '20px 12px', textAlign: 'center',
              color: 'var(--color-text-muted, #94a3b8)',
            }}>
              <div style={{ fontSize: '11px', lineHeight: 1.6 }}>
                No pending handshake requests.
              </div>
            </div>
          ) : (
            pending.map(r => (
              <div key={r.handshake_id} style={{
                padding: '12px', marginBottom: '8px',
                background: 'var(--color-surface, rgba(255,255,255,0.04))',
                border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                borderRadius: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>
                    {counterpartyEmail(r)}
                  </span>
                  <StateBadge state={r.state} />
                </div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
                  {shortId(r.handshake_id)} · {formatDate(r.created_at)}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => handleAccept(r.handshake_id)}
                    style={{
                      flex: 1, padding: '7px 12px', fontSize: '11px', fontWeight: 600,
                      background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                      border: '1px solid rgba(34,197,94,0.3)', borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >Accept</button>
                  <button
                    onClick={() => handleDecline(r.handshake_id)}
                    style={{
                      flex: 1, padding: '7px 12px', fontSize: '11px', fontWeight: 600,
                      background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >Decline</button>
                </div>
              </div>
            ))
          )}

          <div style={{ marginTop: '12px' }}>
            <CapsuleUploadZone onSubmitted={handleCapsuleSubmitted} />
          </div>
        </div>

      </div>
    </div>
  )
}
