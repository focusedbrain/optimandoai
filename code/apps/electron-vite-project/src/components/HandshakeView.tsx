/**
 * HandshakeView — Three-panel layout for the Analysis Dashboard
 *
 * Left:   Relationships list (ACTIVE / REVOKED / …) with selection + "New Handshake"
 * Center: Detail + Chat sidebar scoped to the selected relationship
 * Right:  Pending panel (PENDING_ACCEPT) with accept/decline + .beap upload zone
 */

import { useEffect, useState, useCallback } from 'react'
import CapsuleUploadZone from './CapsuleUploadZone'
import HandshakeWorkspace from './HandshakeWorkspace'
import HandshakeChatSidebar from './HandshakeChatSidebar'
import PendingSlideOut from './PendingSlideOut'
import AcceptHandshakeModal from './AcceptHandshakeModal'

// ── Types ──

interface HandshakeRecord {
  handshake_id: string
  relationship_id: string
  state: 'PENDING_ACCEPT' | 'PENDING_REVIEW' | 'ACCEPTED' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  initiator: { email: string; wrdesk_user_id: string } | null
  acceptor: { email: string; wrdesk_user_id: string } | null
  local_role: 'initiator' | 'acceptor'
  sharing_mode: string | null
  created_at: string
  activated_at: string | null
  expires_at: string | null
  last_seq_received: number
  last_seq_sent?: number
  last_capsule_hash_received: string
  last_capsule_hash_sent?: string
  initiator_context_commitment?: string | null
  acceptor_context_commitment?: string | null
  p2p_endpoint?: string | null
  receiver_email?: string | null
  context_sync_pending?: boolean
  policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean }
  handshake_type?: 'internal' | 'standard' | null
  initiator_device_name?: string | null
  acceptor_device_name?: string | null
  initiator_device_role?: 'host' | 'sandbox' | null
  acceptor_device_role?: 'host' | 'sandbox' | null
  initiator_coordination_device_id?: string | null
  acceptor_coordination_device_id?: string | null
  internal_peer_device_id?: string | null
  internal_peer_computer_name?: string | null
  internal_coordination_identity_complete?: boolean
  internal_coordination_repair_needed?: boolean
}

import './handshakeViewTypes'
import {
  formatInternalPairingIdLine,
  formatInternalPrimaryLine,
  isInternalHandshake,
} from '@shared/handshake/internalIdentityUi'

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

interface HandshakeViewProps {
  onNewHandshake?: () => void
  selectedHandshakeId: string | null
  selectedDocumentId?: string | null
  onHandshakeScopeChange: (id: string | null, email?: string) => void
  onDocumentSelect?: (documentId: string | null) => void
  selectedMessageId?: string | null
  onSelectMessage?: (messageId: string | null) => void
  selectedAttachmentId?: string | null
  onSelectAttachment?: (attachmentId: string | null) => void
}

export default function HandshakeView({
  onNewHandshake,
  selectedHandshakeId,
  selectedDocumentId = null,
  onHandshakeScopeChange,
  onDocumentSelect,
  selectedMessageId = null,
  onSelectMessage,
  selectedAttachmentId = null,
  onSelectAttachment,
}: HandshakeViewProps) {
  const [handshakes, setHandshakes] = useState<HandshakeRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [contextBlockCounts, setContextBlockCounts] = useState<Record<string, number>>({})
  const [vaultStatus, setVaultStatus] = useState<{ isUnlocked: boolean; name: string | null }>({ isUnlocked: false, name: null })
  const [vaultWarningEscalated, setVaultWarningEscalated] = useState(false)

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

  const [canUseHsContextProfiles, setCanUseHsContextProfiles] = useState(false)

  useEffect(() => {
    const checkVault = async () => {
      try {
        const status = await window.handshakeView?.getVaultStatus?.()
        setVaultStatus({
          isUnlocked: status?.isUnlocked ?? false,
          name: status?.name ?? null,
        })
        setCanUseHsContextProfiles(status?.canUseHsContextProfiles ?? false)
      } catch {
        setVaultStatus({ isUnlocked: false, name: null })
        setCanUseHsContextProfiles(false)
      }
    }
    checkVault()
    const handler = () => checkVault()
    window.addEventListener('vault-status-changed', handler)
    // Poll every 3s so stale locked-state is corrected without relying on the event alone
    const poll = setInterval(checkVault, 3000)
    return () => {
      window.removeEventListener('vault-status-changed', handler)
      clearInterval(poll)
    }
  }, [])

  const selectedRecord = handshakes.find(h => h.handshake_id === selectedHandshakeId) ?? null

  const active = handshakes.filter(h => h.state === 'ACTIVE')
  const accepted = handshakes.filter(h => h.state === 'ACCEPTED')
  const revoked = handshakes.filter(h => h.state === 'REVOKED')
  const pending = handshakes.filter(h => h.state === 'PENDING_ACCEPT' || h.state === 'PENDING_REVIEW')
  const pendingIncoming = pending.filter(h => h.local_role === 'acceptor')
  const pendingOutgoing = pending.filter(h => h.local_role === 'initiator')

  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [acceptModalRecord, setAcceptModalRecord] = useState<HandshakeRecord | null>(null)
  const [pendingOpen, setPendingOpen] = useState(false)

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
        if (selectedHandshakeId === id) onHandshakeScopeChange(null)
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
        if (selectedHandshakeId === id) onHandshakeScopeChange(null)
        await loadHandshakes()
      }
    } catch { /* UI shows stale state until refresh */ }
  }

  const handleCapsuleSubmitted = () => { loadHandshakes() }

  const handleHandshakeClick = (r: HandshakeRecord) => {
    if (r.handshake_id === selectedHandshakeId) {
      onHandshakeScopeChange(null)
    } else {
      onHandshakeScopeChange(r.handshake_id, counterpartyEmail(r))
    }
  }

  const renderGroup = (title: string, records: HandshakeRecord[]) => {
    if (records.length === 0) return null
    const canRevoke = title === 'Active' || title === 'Accepted'
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
        {records.map(r => {
          const count = contextBlockCounts[r.handshake_id] ?? 0
          const internalPrimary = isInternalHandshake(r) ? formatInternalPrimaryLine(r) : null
          const internalPairing = isInternalHandshake(r) ? formatInternalPairingIdLine(r) : null
          return (
            <div
              key={r.handshake_id}
              style={{
                display: 'flex', alignItems: 'stretch', minWidth: 0,
                background: selectedHandshakeId === r.handshake_id
                  ? 'var(--color-accent-bg, rgba(139,92,246,0.12))'
                  : 'transparent',
                borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              }}
            >
              <button
                onClick={() => handleHandshakeClick(r)}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px',
                  padding: '10px 12px', textAlign: 'left',
                  border: 'none', background: 'transparent',
                  cursor: 'pointer', color: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text, #e2e8f0)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {counterpartyEmail(r)}
                    </span>
                    {r.handshake_type === 'internal' && (
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(83,74,183,0.1)', color: '#534AB7', marginLeft: '6px' }}>
                        Internal
                      </span>
                    )}
                  </div>
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {selectedHandshakeId === r.handshake_id && (
                      <span style={{ fontSize: '16px', color: 'var(--color-accent, #a78bfa)', lineHeight: 1, marginLeft: '8px' }} title="Chat scoped to this handshake">🤝</span>
                    )}
                    <StateBadge state={r.state} />
                  </span>
                </div>
                {internalPrimary && (
                  <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ fontSize: '11px', color: '#e2e8f0', lineHeight: 1.35, fontWeight: 600 }}>
                      {internalPrimary}
                    </div>
                    {internalPairing && (
                      <div style={{ fontSize: '10px', color: '#a5b4ca', lineHeight: 1.35, fontWeight: 500 }}>
                        {internalPairing}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatDate(r.created_at)}
                  {count > 0 && (
                    <span style={{ marginLeft: '6px', color: 'var(--color-accent, #a78bfa)', fontWeight: 600 }}>
                      {count} block{count !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </button>
              <div style={{ display: 'flex', flexShrink: 0, alignItems: 'center', paddingRight: '4px', gap: '2px' }}>
                {canRevoke && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRevoke(r.handshake_id) }}
                    title="Revoke handshake"
                    style={{
                      padding: '4px 7px', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '4px',
                      background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                      cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                    }}
                  >
                    Revoke
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(r.handshake_id) }}
                    title="Delete handshake"
                    style={{
                      padding: '4px 7px', border: '1px solid rgba(107,114,128,0.3)', borderRadius: '4px',
                      background: 'rgba(107,114,128,0.1)', color: '#94a3b8',
                      cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const gridCols = selectedRecord ? '280px 1fr' : '280px 1fr 320px'

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: gridCols,
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

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: 'var(--color-text-muted, #94a3b8)' }}>
              Loading…
            </div>
          ) : (
            <>
              {renderGroup('Active', active)}
              {renderGroup('Accepted', accepted)}
              {renderGroup('Revoked', revoked)}
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

      {/* ── Center: Workspace + Chat (when handshake selected) ── */}
      <div style={{
        display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden',
        position: 'relative', minWidth: 320, minHeight: 0,
      }}>
        {selectedRecord ? (
          <>
            <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
              <HandshakeWorkspace
                record={selectedRecord}
                handshakeEmail={counterpartyEmail(selectedRecord)}
                contextBlockCount={contextBlockCounts[selectedRecord.handshake_id] ?? 0}
                vaultStatus={vaultStatus}
                vaultWarningEscalated={vaultWarningEscalated}
                pendingCount={pending.length}
                onRevoke={(selectedRecord.state === 'ACTIVE' || selectedRecord.state === 'ACCEPTED') ? () => handleRevoke(selectedRecord.handshake_id) : undefined}
                onDelete={selectedRecord.state === 'REVOKED' ? () => handleDelete(selectedRecord.handshake_id) : undefined}
                onPendingClick={() => setPendingOpen(true)}
                onCapsuleSubmitted={handleCapsuleSubmitted}
                selectedDocumentId={selectedDocumentId}
                onDocumentSelect={onDocumentSelect}
                selectedMessageId={selectedMessageId}
                onSelectMessage={onSelectMessage}
                selectedAttachmentId={selectedAttachmentId}
                onSelectAttachment={onSelectAttachment}
              />
            </div>
            <div style={{ flex: '0 0 100px', minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))' }}>
              <HandshakeChatSidebar
                handshakeId={selectedHandshakeId}
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

      {/* ── Right Panel: Pending (only when no handshake selected) ── */}
      {!selectedRecord && (
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
      )}

      {/* ── Pending Slide-Out (when handshake selected) ── */}
      <PendingSlideOut
        open={pendingOpen && !!selectedRecord}
        onClose={() => setPendingOpen(false)}
        pendingOutgoing={pendingOutgoing}
        pendingIncoming={pendingIncoming}
        counterpartyEmail={counterpartyEmail}
        onAccept={openAcceptModal}
        onDecline={handleDecline}
        onCancel={handleDelete}
        acceptError={acceptError}
        acceptModalRecord={acceptModalRecord}
        onCapsuleSubmitted={handleCapsuleSubmitted}
      />

      {acceptModalRecord && (
        <AcceptHandshakeModal
          record={acceptModalRecord}
          onClose={() => setAcceptModalRecord(null)}
          onSuccess={() => { setAcceptModalRecord(null); loadHandshakes() }}
          canUseHsContextProfiles={canUseHsContextProfiles}
        />
      )}
    </div>
  )
}
