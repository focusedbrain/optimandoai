/**
 * RelationshipDetail — Detail view for a selected handshake relationship
 *
 * Displays:
 *   - Status badge (ACTIVE / PENDING / REVOKED / …)
 *   - Chain metadata (relationship_id, seq counts, last capsule hash)
 *   - P2P delivery status (per-handshake)
 *   - Capsule count and last activity timestamp
 *   - State indicator for content availability
 */

import { useEffect, useState } from 'react'
import VaultStatusIndicator from './VaultStatusIndicator'
import HandshakeContextSection from './HandshakeContextSection'
import { DEFAULT_AI_POLICY, type PolicySelection } from './PolicyRadioGroup'
import { parsePolicyToMode } from '@shared/handshake/policyUtils'
import type { VerifiedContextBlock } from './contextEscaping'

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
  initiator_context_commitment: string | null
  acceptor_context_commitment: string | null
  p2p_endpoint?: string | null
  context_sync_pending?: boolean
  policy_selections?: PolicySelection | { cloud_ai?: boolean; internal_ai?: boolean }
}

interface VaultStatus {
  isUnlocked: boolean
  name: string | null
}

interface Props {
  record: HandshakeRecord
  contextBlockCount: number
  vaultStatus?: VaultStatus | null
  vaultWarningEscalated?: boolean
  onRevoke?: () => void
  onDelete?: () => void
  onOpenQuickReview?: () => void
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    ACTIVE: { bg: 'rgba(34,197,94,0.12)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
    ACCEPTED: { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
    PENDING_ACCEPT: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
    PENDING_REVIEW: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
    REVOKED: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
    EXPIRED: { bg: 'rgba(107,114,128,0.12)', text: '#6b7280', border: 'rgba(107,114,128,0.3)' },
  }
  const c = colors[state] || colors.EXPIRED
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '3px 10px',
      borderRadius: '5px', background: c.bg, color: c.text,
      border: `1px solid ${c.border}`, textTransform: 'uppercase',
    }}>
      {state.replace('_', ' ')}
    </span>
  )
}

function formatDate(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '—' }
}

function shortHash(hash: string): string {
  if (!hash) return '—'
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0' }}>
      <span style={{
        fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)',
        textTransform: 'uppercase', letterSpacing: '0.4px',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '12px', color: 'var(--color-text, #e2e8f0)',
        fontFamily: 'monospace', maxWidth: '60%', textAlign: 'right',
        wordBreak: 'break-all',
      }}>
        {value}
      </span>
    </div>
  )
}

function CopyableHash({ label, hash }: { label: string; hash: string | null }) {
  const display = hash ? shortHash(hash) : '—'
  const copyable = !!hash

  function handleClick() {
    if (!hash) return
    try { navigator.clipboard.writeText(hash) } catch { /* clipboard may not be available */ }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '6px 0' }}>
      <span style={{
        fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)',
        textTransform: 'uppercase', letterSpacing: '0.4px',
      }}>
        {label}
      </span>
      <span
        onClick={handleClick}
        title={copyable ? hash! : undefined}
        style={{
          fontSize: '12px', color: copyable ? 'var(--color-text, #e2e8f0)' : 'var(--color-text-muted, #94a3b8)',
          fontFamily: 'monospace', maxWidth: '60%', textAlign: 'right',
          wordBreak: 'break-all',
          cursor: copyable ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        {display}
      </span>
    </div>
  )
}

interface P2PQueueEntry {
  status: 'pending' | 'sent' | 'failed'
  retry_count: number
  error: string | null
}

function RelayStatusHint() {
  const [health, setHealth] = useState<{ relay_mode?: string; last_relay_pull_error?: string | null } | null>(null)
  useEffect(() => {
    ;(window as any).p2p?.getHealth?.().then((h: any) => setHealth(h)).catch(() => setHealth(null))
    const t = setInterval(() => {
      ;(window as any).p2p?.getHealth?.().then((h: any) => setHealth(h)).catch(() => {})
    }, 15_000)
    return () => clearInterval(t)
  }, [])
  if (!health || health.relay_mode !== 'remote') return null
  const err = health.last_relay_pull_error
  if (err) {
    const isAuth = err.toLowerCase().includes('auth')
    return (
      <MetaRow
        label="Relay"
        value={isAuth ? 'Auth failed — check configuration' : `Unreachable — ${err.slice(0, 50)}${err.length > 50 ? '…' : ''}`}
      />
    )
  }
  return <MetaRow label="Relay" value="Active — last sync OK" />
}

function P2PDeliveryStatus({ handshakeId, p2pEndpoint }: { handshakeId: string; p2pEndpoint: string | null | undefined }) {
  const [entries, setEntries] = useState<P2PQueueEntry[]>([])
  const [useCoordination, setUseCoordination] = useState(false)
  useEffect(() => {
    if (!handshakeId || !(window as any).p2p?.getQueueStatus) return
    ;(window as any).p2p.getQueueStatus(handshakeId).then((r: { entries: P2PQueueEntry[] }) => {
      setEntries(r?.entries ?? [])
    }).catch(() => setEntries([]))
    ;(window as any).p2p?.getHealth?.().then((h: { use_coordination?: boolean }) => {
      setUseCoordination(!!h?.use_coordination)
    }).catch(() => {})
    const t = setInterval(() => {
      ;(window as any).p2p?.getQueueStatus(handshakeId).then((r: { entries: P2PQueueEntry[] }) => {
        setEntries(r?.entries ?? [])
      }).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [handshakeId])

  if (!p2pEndpoint) return <MetaRow label="P2P" value="No endpoint — context exchanged manually" />
  const pending = entries.filter((e) => e.status === 'pending')
  const sent = entries.filter((e) => e.status === 'sent')
  const failed = entries.filter((e) => e.status === 'failed')
  const deliveryLabel = useCoordination ? 'wrdesk.com' : 'P2P'
  if (sent.length > 0 && pending.length === 0 && failed.length === 0) {
    return <MetaRow label="P2P" value={`Delivered via ${deliveryLabel} ✓`} />
  }
  if (pending.length > 0) {
    return (
      <MetaRow
        label="P2P"
        value={useCoordination ? 'Delivery pending — recipient may be offline' : `Context delivery in progress... (attempt ${(pending[0]?.retry_count ?? 0) + 1})`}
      />
    )
  }
  if (failed.length > 0) {
    const err = failed[0]?.error ?? 'Unknown error'
    return <MetaRow label="P2P" value={`Context delivery failed — ${err.slice(0, 60)}${err.length > 60 ? '…' : ''}`} />
  }
  return <MetaRow label="P2P" value="No queue entries" />
}

export default function RelationshipDetail({ record, contextBlockCount, vaultStatus, vaultWarningEscalated, onRevoke, onDelete, onOpenQuickReview }: Props) {
  const counterparty = record.local_role === 'initiator' ? record.acceptor : record.initiator
  const counterpartyLabel = counterparty?.email ?? '(pending acceptance)'

  const [contextBlocks, setContextBlocks] = useState<VerifiedContextBlock[]>([])
  const [showProofChain, setShowProofChain] = useState(true)
  const [showMyBlockHashes, setShowMyBlockHashes] = useState(false)
  const [showTheirBlockHashes, setShowTheirBlockHashes] = useState(false)
  const [showTechnical, setShowTechnical] = useState(true)
  const initialPolicy: PolicySelection = record.policy_selections
    ? { ai_processing_mode: parsePolicyToMode(record.policy_selections) }
    : DEFAULT_AI_POLICY
  const [policies, setPolicies] = useState<PolicySelection>(initialPolicy)

  const showVaultIndicator = ((record.state === 'PENDING_ACCEPT' || record.state === 'PENDING_REVIEW') && record.local_role === 'acceptor') || record.state === 'ACCEPTED'

  const refreshContextBlocks = () => {
    if ((record.state === 'ACCEPTED' || record.state === 'ACTIVE') && record.handshake_id) {
      window.handshakeView?.queryContextBlocks?.(record.handshake_id).then((blocks) => {
        setContextBlocks(blocks ?? [])
      }).catch(() => setContextBlocks([]))
    }
  }

  useEffect(() => {
    if ((record.state === 'ACCEPTED' || record.state === 'ACTIVE') && record.handshake_id) {
      window.handshakeView?.queryContextBlocks?.(record.handshake_id).then((blocks) => {
        setContextBlocks(blocks ?? [])
      }).catch(() => setContextBlocks([]))
    } else {
      setContextBlocks([])
    }
  }, [record.handshake_id, record.state])

  useEffect(() => {
    setPolicies(
      record.policy_selections
        ? { ai_processing_mode: parsePolicyToMode(record.policy_selections) }
        : DEFAULT_AI_POLICY,
    )
  }, [record.policy_selections])

  const handlePolicyChange = (next: PolicySelection) => {
    setPolicies(next)
    window.handshakeView?.updateHandshakePolicies?.(record.handshake_id, { ai_processing_mode: next.ai_processing_mode })
  }

  const handleAttachData = () => {
    window.dispatchEvent(new CustomEvent('handshake:requestAttachContext', { detail: { handshakeId: record.handshake_id } }))
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: '16px 20px', overflowY: 'auto',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '16px', paddingBottom: '14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        gap: '12px',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {counterpartyLabel}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
            You are the <strong>{record.local_role}</strong>
            {record.sharing_mode && ` · ${record.sharing_mode}`}
            {` · ${formatDate(record.created_at)}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {(record.state === 'ACCEPTED' || record.state === 'ACTIVE') && onOpenQuickReview && (
            <button
              onClick={() => onOpenQuickReview()}
              style={{
                padding: '5px 12px', fontSize: '11px', fontWeight: 600,
                background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
                border: '1px solid rgba(139,92,246,0.3)', borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              📋 Quick Review
            </button>
          )}
          <StateBadge state={record.state} />
          {(record.state === 'ACTIVE' || record.state === 'ACCEPTED') && onRevoke && (
            <button
              onClick={onRevoke}
              style={{
                padding: '5px 12px', fontSize: '11px', fontWeight: 600,
                background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Revoke
            </button>
          )}
          {record.state === 'REVOKED' && onDelete && (
            <button
              onClick={onDelete}
              style={{
                padding: '5px 12px', fontSize: '11px', fontWeight: 600,
                background: 'rgba(107,114,128,0.15)', color: '#94a3b8',
                border: '1px solid rgba(107,114,128,0.3)', borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Vault status indicator ── */}
      {showVaultIndicator && (
        <VaultStatusIndicator
          vaultName={vaultStatus?.name ?? null}
          isUnlocked={vaultStatus?.isUnlocked ?? false}
          warningEscalated={vaultWarningEscalated ?? false}
        />
      )}

      {/* ── State notice for non-context states ── */}
      {record.state === 'PENDING_ACCEPT' && (
        <div style={{
          padding: '14px 16px', marginBottom: '16px',
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>
            Awaiting acceptance
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
            The counterparty has not yet accepted this handshake request.
          </div>
        </div>
      )}

      {record.state === 'REVOKED' && (
        <div style={{
          padding: '14px 16px', marginBottom: '16px',
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444', marginBottom: '4px' }}>
            Handshake revoked
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: onDelete ? '12px' : 0 }}>
            This relationship has been terminated. No further capsules can be exchanged.
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                padding: '7px 14px', fontSize: '11px', fontWeight: 600,
                background: 'rgba(107,114,128,0.2)', color: '#e2e8f0',
                border: '1px solid rgba(107,114,128,0.4)', borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Delete handshake
            </button>
          )}
        </div>
      )}

      {/* ── ACCEPTED: context exchange in progress ── */}
      {record.state === 'ACCEPTED' && !record.context_sync_pending && (
        <div style={{
          marginBottom: '12px', padding: '10px 14px',
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: '8px', fontSize: '11px', color: '#94a3b8',
        }}>
          ⏳ Context exchange in progress — waiting for the other party to complete the roundtrip.
        </div>
      )}

      {/* ── ACTIVE: delivery status banner (only when no blocks yet) ── */}
      {record.state === 'ACTIVE' && contextBlockCount === 0 && !record.p2p_endpoint && (
        <div style={{
          padding: '10px 14px', marginBottom: '12px',
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: '8px', fontSize: '11px', color: '#f59e0b',
        }}>
          No P2P endpoint configured. Enable P2P in settings for automatic context exchange.
        </div>
      )}

      {/* ── MAIN: Context blocks — shown prominently for ACCEPTED/ACTIVE ── */}
      {(record.state === 'ACCEPTED' || record.state === 'ACTIVE') && (
        <HandshakeContextSection
          record={record}
          isVaultUnlocked={vaultStatus?.isUnlocked ?? false}
          policies={policies}
          onPolicyChange={handlePolicyChange}
          onAttachData={handleAttachData}
          contextBlocks={contextBlocks}
          readOnly={record.state === 'ACTIVE'}
          onContextBlocksRefresh={refreshContextBlocks}
        />
      )}

      {/* ── Cryptographic Proof Chain ── */}
      <div style={{ marginTop: '8px' }}>
        <button
          onClick={() => setShowProofChain(!showProofChain)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            width: '100%', padding: '8px 12px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '6px', cursor: 'pointer',
            color: 'var(--color-text-muted, #94a3b8)', fontSize: '11px', fontWeight: 600,
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: '10px' }}>{showProofChain ? '▾' : '▸'}</span>
          Cryptographic Proof Chain
          <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 400 }}>
            Context commitments · capsule chain
          </span>
        </button>

        {showProofChain && (
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '0' }}>
            {(() => {
              const myCommitment = record.local_role === 'initiator' ? record.initiator_context_commitment : record.acceptor_context_commitment
              const counterpartyCommitment = record.local_role === 'initiator' ? record.acceptor_context_commitment : record.initiator_context_commitment
              const myRoleLabel = record.local_role === 'initiator' ? '(Initiator)' : '(Acceptor)'
              const counterpartyRoleLabel = record.local_role === 'initiator' ? '(Acceptor)' : '(Initiator)'
              const lastSeqReceived = record.last_seq_received ?? 0
              const lastSeqSent = record.last_seq_sent ?? 0
              const latestCapsuleHash = lastSeqReceived >= lastSeqSent ? record.last_capsule_hash_received : (record.last_capsule_hash_sent ?? record.last_capsule_hash_received)
              const latestSeq = Math.max(lastSeqReceived, lastSeqSent)
              const bothCommitments = !!record.initiator_context_commitment && !!record.acceptor_context_commitment
              const contextSyncPending = !!record.context_sync_pending

              const copyHash = (hash: string | null) => {
                if (!hash) return
                try { navigator.clipboard.writeText(hash) } catch { /* ignore */ }
              }

              return (
                <div style={{
                  background: 'var(--color-surface, rgba(255,255,255,0.03))',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                  borderRadius: '8px', padding: '12px 14px',
                  borderLeft: '3px solid rgba(139,92,246,0.4)',
                }}>
                  {/* 1. Your Context Commitment */}
                  <div style={{ marginBottom: '12px', paddingLeft: '4px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '4px' }}>
                      Your Context Commitment {myRoleLabel}
                    </div>
                    {myCommitment ? (
                      <span
                        onClick={() => copyHash(myCommitment)}
                        title={myCommitment}
                        style={{
                          fontSize: '12px', fontFamily: 'monospace',
                          color: 'var(--color-text, #e2e8f0)',
                          cursor: 'pointer', userSelect: 'none',
                        }}
                      >
                        {shortHash(myCommitment)}
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #6b7280)', fontStyle: 'italic' }}>
                        Not yet generated
                      </span>
                    )}
                    {(() => {
                      const myBlocks = contextBlocks.filter((b) => b.source === 'sent' && b.block_hash)
                      const count = myBlocks.length
                      if (count === 0) {
                        return (
                          <div style={{ marginTop: '6px', paddingLeft: '12px', fontSize: '10px', color: 'var(--color-text-muted, #6b7280)' }}>
                            No blocks
                          </div>
                        )
                      }
                      return (
                        <div style={{ marginTop: '6px', paddingLeft: '12px', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                          <button
                            type="button"
                            onClick={() => setShowMyBlockHashes(!showMyBlockHashes)}
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              fontSize: '10px', color: 'var(--color-text-muted, #6b7280)',
                              textAlign: 'left', fontFamily: 'inherit',
                            }}
                          >
                            {showMyBlockHashes ? '▾' : '▸'} {count} block hash{count !== 1 ? 'es' : ''} included
                          </button>
                          {showMyBlockHashes && (
                            <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {myBlocks.map((b, i) => {
                                const isLast = i === myBlocks.length - 1
                                const prefix = isLast ? '└── ' : '├── '
                                const typeLabel = b.type || 'Plaintext'
                                const classification = b.data_classification || 'PUBLIC'
                                return (
                                  <div key={b.block_id} style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--color-text-muted, #94a3b8)' }}>
                                    <span
                                      onClick={() => copyHash(b.block_hash ?? null)}
                                      title={b.block_hash ?? undefined}
                                      style={{ cursor: 'pointer', userSelect: 'none' }}
                                    >
                                      {prefix}{shortHash(b.block_hash ?? '')} ({typeLabel}, {classification})
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>

                  {/* 2. Counterparty Context Commitment */}
                  <div style={{ marginBottom: '12px', paddingLeft: '4px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '4px' }}>
                      Counterparty Context Commitment {counterpartyRoleLabel}
                    </div>
                    {counterpartyCommitment ? (
                      <span
                        onClick={() => copyHash(counterpartyCommitment)}
                        title={counterpartyCommitment}
                        style={{
                          fontSize: '12px', fontFamily: 'monospace',
                          color: 'var(--color-text, #e2e8f0)',
                          cursor: 'pointer', userSelect: 'none',
                        }}
                      >
                        {shortHash(counterpartyCommitment)}
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted, #6b7280)', fontStyle: 'italic' }}>
                        Awaiting counterparty
                      </span>
                    )}
                    {(() => {
                      const theirBlocks = contextBlocks.filter((b) => b.source === 'received' && b.block_hash)
                      const count = theirBlocks.length
                      if (count === 0) {
                        return (
                          <div style={{ marginTop: '6px', paddingLeft: '12px', fontSize: '10px', color: 'var(--color-text-muted, #6b7280)' }}>
                            No blocks
                          </div>
                        )
                      }
                      return (
                        <div style={{ marginTop: '6px', paddingLeft: '12px', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
                          <button
                            type="button"
                            onClick={() => setShowTheirBlockHashes(!showTheirBlockHashes)}
                            style={{
                              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                              fontSize: '10px', color: 'var(--color-text-muted, #6b7280)',
                              textAlign: 'left', fontFamily: 'inherit',
                            }}
                          >
                            {showTheirBlockHashes ? '▾' : '▸'} {count} block hash{count !== 1 ? 'es' : ''} included
                          </button>
                          {showTheirBlockHashes && (
                            <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              {theirBlocks.map((b, i) => {
                                const isLast = i === theirBlocks.length - 1
                                const prefix = isLast ? '└── ' : '├── '
                                const typeLabel = b.type || 'Plaintext'
                                const classification = b.data_classification || 'PUBLIC'
                                return (
                                  <div key={b.block_id} style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--color-text-muted, #94a3b8)' }}>
                                    <span
                                      onClick={() => copyHash(b.block_hash ?? null)}
                                      title={b.block_hash ?? undefined}
                                      style={{ cursor: 'pointer', userSelect: 'none' }}
                                    >
                                      {prefix}{shortHash(b.block_hash ?? '')} ({typeLabel}, {classification})
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>

                  {/* 3. Capsule Chain Integrity */}
                  <div style={{ marginBottom: '12px', paddingLeft: '4px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '4px' }}>
                      Capsule Chain Integrity
                    </div>
                    <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--color-text, #e2e8f0)', marginBottom: '6px' }}>
                      {latestCapsuleHash ? (
                        <span
                          onClick={() => copyHash(latestCapsuleHash)}
                          title={latestCapsuleHash}
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                        >
                          {shortHash(latestCapsuleHash)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted, #6b7280)', fontStyle: 'italic' }}>—</span>
                      )}
                      {' · seq '}
                      {latestSeq}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: contextSyncPending ? '#f59e0b' : bothCommitments ? '#22c55e' : '#f59e0b',
                    }}>
                      {contextSyncPending
                        ? '⏳ Context delivery in progress'
                        : bothCommitments
                          ? '✓ Both context commitments are signed into the capsule chain'
                          : '⏳ Awaiting counterparty commitment'}
                    </div>
                  </div>

                  {/* 4. Explanatory note */}
                  <div style={{
                    fontSize: '10px', color: 'var(--color-text-muted, #6b7280)',
                    lineHeight: 1.5, marginTop: '10px', paddingTop: '10px',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    Each context commitment is a SHA-256 hash derived from individual block hashes. The commitment is cryptographically signed into the capsule chain, binding context to the handshake.
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* ── Technical details ── */}
      <div style={{ marginTop: '8px' }}>
        <button
          onClick={() => setShowTechnical(!showTechnical)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            width: '100%', padding: '8px 12px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '6px', cursor: 'pointer',
            color: 'var(--color-text-muted, #94a3b8)', fontSize: '11px', fontWeight: 600,
            textAlign: 'left',
          }}
        >
          <span style={{ fontSize: '10px' }}>{showTechnical ? '▾' : '▸'}</span>
          Technical Details
          <span style={{ marginLeft: 'auto', fontSize: '10px', fontWeight: 400 }}>
            Chain metadata · delivery · commitments
          </span>
        </button>

        {showTechnical && (
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {/* Delivery status */}
            <div style={{
              background: 'var(--color-surface, rgba(255,255,255,0.03))',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              borderRadius: '8px', padding: '12px 14px',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>
                Delivery
              </div>
              <RelayStatusHint />
              <P2PDeliveryStatus handshakeId={record.handshake_id} p2pEndpoint={record.p2p_endpoint} />
            </div>

            {/* Chain Metadata */}
            <div style={{
              background: 'var(--color-surface, rgba(255,255,255,0.03))',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              borderRadius: '8px', padding: '12px 14px',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>
                Chain Metadata
              </div>
              <MetaRow label="Handshake ID" value={record.handshake_id} />
              <MetaRow label="Relationship ID" value={record.relationship_id} />
              <MetaRow label="Last seq received" value={String(record.last_seq_received)} />
              <MetaRow label="Last capsule hash" value={shortHash(record.last_capsule_hash_received)} />
            </div>

            {/* Context Commitments */}
            <div style={{
              background: 'var(--color-surface, rgba(255,255,255,0.03))',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              borderRadius: '8px', padding: '12px 14px',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>
                Context Commitments
              </div>
              <CopyableHash label="Sender" hash={record.initiator_context_commitment} />
              <CopyableHash label="Receiver" hash={record.acceptor_context_commitment} />
            </div>

            {/* Timeline */}
            <div style={{
              background: 'var(--color-surface, rgba(255,255,255,0.03))',
              border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              borderRadius: '8px', padding: '12px 14px',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '6px' }}>
                Timeline
              </div>
              <MetaRow label="Created" value={formatDate(record.created_at)} />
              <MetaRow label="Activated" value={formatDate(record.activated_at)} />
              <MetaRow label="Expires" value={formatDate(record.expires_at)} />
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
