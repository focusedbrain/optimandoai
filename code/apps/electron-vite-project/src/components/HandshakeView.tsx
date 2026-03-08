/**
 * HandshakeView — Three-panel layout for the Analysis Dashboard
 *
 * Left:   Relationships list (ACTIVE / REVOKED / EXPIRED) with selection + "New Handshake"
 * Center: Detail + Chat sidebar scoped to the selected relationship
 * Right:  Pending panel (PENDING_ACCEPT) with accept/decline + .beap upload zone
 */

import { useEffect, useState, useCallback } from 'react'
import CapsuleUploadZone from './CapsuleUploadZone'
import RelationshipDetail from './RelationshipDetail'
import HandshakeChatSidebar from './HandshakeChatSidebar'
import AcceptHandshakeModal from './AcceptHandshakeModal'

// ── Types ──

interface HandshakeRecord {
  handshake_id: string
  relationship_id: string
  state: 'PENDING_ACCEPT' | 'ACCEPTED' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  initiator: { email: string; wrdesk_user_id: string } | null
  acceptor: { email: string; wrdesk_user_id: string } | null
  local_role: 'initiator' | 'acceptor'
  sharing_mode: string | null
  created_at: string
  activated_at: string | null
  expires_at: string | null
  last_seq_received: number
  last_capsule_hash_received: string
  p2p_endpoint?: string | null
  receiver_email?: string | null
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
    return record.acceptor?.email ?? record.receiver_email ?? '(pending)'
  }
  return record.initiator?.email ?? ''
}

// ── Status badge ──

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    ACTIVE: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
    ACCEPTED: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
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

// ── Main Component ──

export default function HandshakeView({ onNewHandshake }: { onNewHandshake?: () => void }) {
  const [handshakes, setHandshakes] = useState<HandshakeRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [contextBlockCounts, setContextBlockCounts] = useState<Record<string, number>>({})

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

  useEffect(() => {
    const onRefresh = () => loadHandshakes()
    window.addEventListener('handshake-list-refresh', onRefresh)
    return () => window.removeEventListener('handshake-list-refresh', onRefresh)
  }, [loadHandshakes])

  const selectedRecord = handshakes.find(h => h.handshake_id === selectedId) ?? null

  const active = handshakes.filter(h => h.state === 'ACTIVE')
  const accepted = handshakes.filter(h => h.state === 'ACCEPTED')
  const revoked = handshakes.filter(h => h.state === 'REVOKED')
  const expired = handshakes.filter(h => h.state === 'EXPIRED')
  const pending = handshakes.filter(h => h.state === 'PENDING_ACCEPT')
  const pendingIncoming = pending.filter(h => h.local_role === 'acceptor')
  const pendingOutgoing = pending.filter(h => h.local_role === 'initiator')

  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [acceptModalRecord, setAcceptModalRecord] = useState<HandshakeRecord | null>(null)

  const openAcceptModal = (record: HandshakeRecord) => {
    setAcceptError(null)
    setAcceptModalRecord(record)
  }

  const handleRevoke = async (id: string) => {
    try {
      console.log('[Revoke] calling forceRevokeHandshake for', id)
      const res = await window.handshakeView?.forceRevokeHandshake(id)
      console.log('[Revoke] result:', res)
      if (res?.success !== false) {
        if (selectedId === id) setSelectedId(null)
        await loadHandshakes()
      } else {
        console.error('[Revoke] failed:', res?.error)
      }
    } catch (err) {
      console.error('[Revoke] exception:', err)
    }
  }

  const handleDecline = async (id: string) => {
    try {
      const res = await window.handshakeView?.declineHandshake(id)
      if (res?.success !== false) await loadHandshakes()
    } catch { /* UI shows stale state until refresh */ }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await window.handshakeView?.deleteHandshake(id)
      if (res?.success !== false) {
        if (selectedId === id) setSelectedId(null)
        await loadHandshakes()
      }
    } catch { /* UI shows stale state until refresh */ }
  }

  const handleCapsuleSubmitted = () => { loadHandshakes() }

  const renderGroup = (title: string, records: HandshakeRecord[]) => {
    if (records.length === 0) return null
    const canDelete = title === 'Revoked' || title === 'Expired'
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
          <div
            key={r.handshake_id}
            style={{
              display: 'flex', alignItems: 'stretch',
              background: selectedId === r.handshake_id
                ? 'var(--color-accent-bg, rgba(139,92,246,0.12))'
                : 'transparent',
              borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            }}
          >
            <button
              onClick={() => setSelectedId(r.handshake_id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', gap: '3px',
                padding: '10px 12px', textAlign: 'left',
                border: 'none', background: 'transparent',
                cursor: 'pointer', color: 'inherit',
                transition: 'background 0.1s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {counterpartyEmail(r)}
                </span>
                <span style={{ flexShrink: 0 }}>
                  <StateBadge state={r.state} />
                </span>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
                {shortId(r.handshake_id)} · {formatDate(r.created_at)}
                {contextBlockCounts[r.handshake_id] > 0 && ` · ${contextBlockCounts[r.handshake_id]} blocks`}
              </div>
            </button>
            {canDelete && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(r.handshake_id) }}
                title="Delete handshake"
                style={{
                  padding: '8px 12px', border: 'none', background: 'transparent',
                  color: 'var(--color-text-muted, #94a3b8)', cursor: 'pointer',
                  fontSize: '12px', display: 'flex', alignItems: 'center',
                }}
              >
                Delete
              </button>
            )}
          </div>
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
              onClick={() => onNewHandshake?.()}
              style={{
                padding: '4px 8px', fontSize: '10px', fontWeight: 600,
                background: 'var(--color-accent-bg, rgba(139,92,246,0.12))',
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

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
              Loading…
            </div>
          ) : (
            <>
              {renderGroup('Active', active)}
              {renderGroup('Accepted', accepted)}
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
                onRevoke={(selectedRecord.state === 'ACTIVE' || selectedRecord.state === 'ACCEPTED') ? () => handleRevoke(selectedRecord.handshake_id) : undefined}
                onDelete={(selectedRecord.state === 'REVOKED' || selectedRecord.state === 'EXPIRED') ? () => handleDelete(selectedRecord.handshake_id) : undefined}
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

      {/* ── Right Panel: Pending ── */}
      <div style={{
        borderLeft: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 12px', borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          fontSize: '13px', fontWeight: 700,
        }}>
          Pending ({pending.length})
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
            <>
              {pendingOutgoing.map(r => (
                <div key={r.handshake_id} style={{
                  padding: '12px', marginBottom: '8px',
                  background: 'var(--color-surface, rgba(255,255,255,0.04))',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                  borderRadius: '8px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', textTransform: 'uppercase' }}>
                      To:
                    </span>
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 600, color: '#f59e0b' }}>
                      Awaiting Approval
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', wordBreak: 'break-all' }}>
                    {r.receiver_email}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '8px' }}>
                    {shortId(r.handshake_id)} · {formatDate(r.created_at)}
                  </div>
                  <button
                    onClick={() => handleDelete(r.handshake_id)}
                    title="Cancel handshake request"
                    style={{
                      width: '100%', padding: '6px 10px', fontSize: '10px', fontWeight: 600,
                      background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >Cancel Request</button>
                </div>
              ))}
              {pendingIncoming.map(r => (
                <div key={r.handshake_id} style={{
                  padding: '12px', marginBottom: '8px',
                  background: 'var(--color-surface, rgba(255,255,255,0.04))',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                  borderRadius: '8px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {counterpartyEmail(r)}
                    </span>
                    <span style={{ flexShrink: 0 }}>
                      <StateBadge state={r.state} />
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '10px' }}>
                    {shortId(r.handshake_id)} · {formatDate(r.created_at)}
                  </div>
                  {acceptError && acceptModalRecord?.handshake_id === r.handshake_id && (
                    <div style={{ fontSize: '10px', color: '#ef4444', marginBottom: '8px', wordBreak: 'break-word' }}>
                      {acceptError}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => openAcceptModal(r)}
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
              ))}
            </>
          )}

          <div style={{ marginTop: '12px' }}>
            <CapsuleUploadZone onSubmitted={handleCapsuleSubmitted} />
          </div>
        </div>

      </div>

      {acceptModalRecord && (
        <AcceptHandshakeModal
          record={acceptModalRecord}
          onClose={() => setAcceptModalRecord(null)}
          onSuccess={() => { setAcceptModalRecord(null); loadHandshakes() }}
          canUseHsContextProfiles={false}
        />
      )}
    </div>
  )
}
