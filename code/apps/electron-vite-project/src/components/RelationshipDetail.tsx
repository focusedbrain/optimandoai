/**
 * RelationshipDetail — Detail view for a selected handshake relationship
 *
 * Displays:
 *   - Status badge (ACTIVE / PENDING / REVOKED / EXPIRED)
 *   - Chain metadata (relationship_id, seq counts, last capsule hash)
 *   - Capsule count and last activity timestamp
 *   - State indicator for content availability
 */

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
  initiator_context_commitment: string | null
  acceptor_context_commitment: string | null
}

interface Props {
  record: HandshakeRecord
  contextBlockCount: number
  onRevoke?: () => void
}

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

export default function RelationshipDetail({ record, contextBlockCount, onRevoke }: Props) {
  const counterparty = record.local_role === 'initiator' ? record.acceptor : record.initiator
  const counterpartyLabel = counterparty?.email ?? '(pending acceptance)'

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
          {record.state === 'ACTIVE' && onRevoke && (
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
          <StateBadge state={record.state} />
        </div>
      </div>

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
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
            This relationship has been terminated. No further capsules can be exchanged.
          </div>
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
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
            This relationship has expired. Start a new handshake to re-establish trust.
          </div>
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
      ) : (
        <div style={{
          padding: '14px 16px',
          background: contextBlockCount > 0 ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${contextBlockCount > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)'}`,
          borderRadius: '8px',
        }}>
          <div style={{
            fontSize: '12px', fontWeight: 600,
            color: contextBlockCount > 0 ? '#22c55e' : '#f59e0b',
            marginBottom: '4px',
          }}>
            {contextBlockCount > 0
              ? `${contextBlockCount} Context Block${contextBlockCount > 1 ? 's' : ''} — content available`
              : 'Handshake active. Waiting for first BEAP-Capsule for content.'}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)' }}>
            {contextBlockCount > 0
              ? 'Context data has been received via the BEAP-Capsule pipeline.'
              : 'Context blocks enter only through fully validated BEAP Capsules, not handshake capsules.'}
          </div>
        </div>
      )}
    </div>
  )
}
