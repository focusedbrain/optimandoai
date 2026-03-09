/**
 * RelationshipDetail — Detail view for a selected handshake relationship
 *
 * Displays:
 *   - Status badge (ACTIVE / PENDING / REVOKED / EXPIRED)
 *   - Chain metadata (relationship_id, seq counts, last capsule hash)
 *   - P2P delivery status (per-handshake)
 *   - Capsule count and last activity timestamp
 *   - State indicator for content availability
 */

import { useEffect, useState } from 'react'
import VaultStatusIndicator from './VaultStatusIndicator'
import HandshakeContextSection from './HandshakeContextSection'
import { DEFAULT_POLICIES, type PolicySelection } from './PolicyCheckboxes'
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
  last_capsule_hash_received: string
  initiator_context_commitment: string | null
  acceptor_context_commitment: string | null
  p2p_endpoint?: string | null
  context_sync_pending?: boolean
  policy_selections?: PolicySelection
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

export default function RelationshipDetail({ record, contextBlockCount, vaultStatus, vaultWarningEscalated, onRevoke, onDelete }: Props) {
  const counterparty = record.local_role === 'initiator' ? record.acceptor : record.initiator
  const counterpartyLabel = counterparty?.email ?? '(pending acceptance)'

  const [contextBlocks, setContextBlocks] = useState<VerifiedContextBlock[]>([])
  const [policies, setPolicies] = useState<PolicySelection>(record.policy_selections ?? DEFAULT_POLICIES)

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
    setPolicies(record.policy_selections ?? DEFAULT_POLICIES)
  }, [record.policy_selections])

  const handlePolicyChange = (next: PolicySelection) => {
    setPolicies(next)
    window.handshakeView?.updateHandshakePolicies?.(record.handshake_id, next)
  }

  const handleAttachData = () => {
    window.dispatchEvent(new CustomEvent('handshake:requestAttachContext', { detail: { handshakeId: record.handshake_id } }))
  }

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: '20px', overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '20px', paddingBottom: '16px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
      }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text, #e2e8f0)', marginBottom: '4px' }}>
            {counterpartyLabel}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted, #94a3b8)' }}>
            You are the <strong>{record.local_role}</strong>
            {record.sharing_mode && ` · ${record.sharing_mode}`}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
          {(record.state === 'REVOKED' || record.state === 'EXPIRED') && onDelete && (
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
          <StateBadge state={record.state} />
        </div>
      </div>

      {/* Vault status indicator — PENDING_ACCEPT (acceptor) or ACCEPTED */}
      {showVaultIndicator && (
        <VaultStatusIndicator
          vaultName={vaultStatus?.name ?? null}
          isUnlocked={vaultStatus?.isUnlocked ?? false}
          warningEscalated={vaultWarningEscalated ?? false}
        />
      )}

      {/* Handshake context section — ACCEPTED or ACTIVE */}
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

      {/* ACCEPTED + context sync sent: waiting for other party */}
      {record.state === 'ACCEPTED' && !record.context_sync_pending && (
        <div style={{
          marginBottom: '16px', padding: '10px 14px',
          background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: '8px', fontSize: '11px', color: '#94a3b8',
        }}>
          Completing handshake… Context exchange in progress. Waiting for the other party.
        </div>
      )}

      {/* Chain Metadata */}
      <div style={{
        background: 'var(--color-surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)',
          marginBottom: '8px',
        }}>
          Chain Metadata
        </div>
        <MetaRow label="Handshake ID" value={record.handshake_id} />
        <MetaRow label="Relationship ID" value={record.relationship_id} />
        <MetaRow label="Last seq received" value={String(record.last_seq_received)} />
        <MetaRow label="Last capsule hash" value={shortHash(record.last_capsule_hash_received)} />
        <RelayStatusHint />
        <P2PDeliveryStatus handshakeId={record.handshake_id} p2pEndpoint={record.p2p_endpoint} />
      </div>

      {/* Context Commitments */}
      <div style={{
        background: 'var(--color-surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)',
          marginBottom: '8px',
        }}>
          Context Commitments
        </div>
        <CopyableHash label="Sender Context" hash={record.initiator_context_commitment} />
        <CopyableHash label="Receiver Context" hash={record.acceptor_context_commitment} />
      </div>

      {/* Timeline */}
      <div style={{
        background: 'var(--color-surface, rgba(255,255,255,0.03))',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        borderRadius: '8px', padding: '14px 16px', marginBottom: '16px',
      }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.6px', color: 'var(--color-text-muted, #94a3b8)',
          marginBottom: '8px',
        }}>
          Timeline
        </div>
        <MetaRow label="Created" value={formatDate(record.created_at)} />
        <MetaRow label="Activated" value={formatDate(record.activated_at)} />
        <MetaRow label="Expires" value={formatDate(record.expires_at)} />
      </div>

      {/* Content Availability / State Notice */}
      {record.state === 'REVOKED' ? (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#ef4444', marginBottom: '4px' }}>
            Handshake revoked.
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '12px' }}>
            This relationship has been terminated. No further capsules can be exchanged.
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                background: 'rgba(107,114,128,0.2)', color: '#e2e8f0',
                border: '1px solid rgba(107,114,128,0.4)', borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Delete handshake
            </button>
          )}
        </div>
      ) : record.state === 'EXPIRED' ? (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(107,114,128,0.08)',
          border: '1px solid rgba(107,114,128,0.2)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' }}>
            Handshake expired.
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '12px' }}>
            This relationship has expired. Start a new handshake to re-establish trust.
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              style={{
                padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                background: 'rgba(107,114,128,0.2)', color: '#e2e8f0',
                border: '1px solid rgba(107,114,128,0.4)', borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Delete handshake
            </button>
          )}
        </div>
      ) : record.state === 'PENDING_ACCEPT' ? (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.2)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>
            Awaiting acceptance.
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
            The counterparty has not yet accepted this handshake request.
          </div>
        </div>
      ) : record.state === 'ACCEPTED' ? (
        <div style={{
          padding: '14px 16px',
          background: 'rgba(59,130,246,0.08)',
          border: '1px solid rgba(59,130,246,0.2)',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#3b82f6', marginBottom: '4px' }}>
            Accepted — awaiting context roundtrip.
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
            Handshake accepted. Context exchange in progress. Will become Active when roundtrip completes.
          </div>
        </div>
      ) : (
        <div style={{
          padding: '14px 16px',
          background: (contextBlockCount > 0 || record.last_seq_received >= 1) ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${(contextBlockCount > 0 || record.last_seq_received >= 1) ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`,
          borderRadius: '8px',
        }}>
          <div style={{
            fontSize: '12px', fontWeight: 600,
            color: (contextBlockCount > 0 || record.last_seq_received >= 1) ? '#22c55e' : '#f59e0b',
            marginBottom: '4px',
          }}>
            {record.last_seq_received >= 1
              ? 'Context synced. Ready for BEAP messaging.'
              : contextBlockCount > 0
                ? `${contextBlockCount} Context Block${contextBlockCount > 1 ? 's' : ''} — content available`
                : record.p2p_endpoint
                  ? 'Context sync in progress. P2P delivery may take a few seconds.'
                  : 'P2P not configured. Enable P2P in settings to auto-sync context, or exchange context manually.'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
            {record.last_seq_received >= 1
              ? 'Context has been exchanged via P2P or BEAP capsules.'
              : contextBlockCount > 0
                ? 'Context data has been received via the BEAP-Capsule pipeline.'
                : record.p2p_endpoint
                  ? 'Waiting for counterparty context-sync delivery.'
                  : 'Configure P2P before initiating a handshake for automatic context exchange.'}
          </div>
        </div>
      )}
    </div>
  )
}
