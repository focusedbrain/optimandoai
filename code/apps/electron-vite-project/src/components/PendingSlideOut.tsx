/**
 * PendingSlideOut — Slide-out panel for pending handshake requests
 *
 * Overlay from the right (320px). Replaces the permanent Pending column
 * when a handshake is selected.
 */

import CapsuleUploadZone from './CapsuleUploadZone'

interface HandshakeRecord {
  handshake_id: string
  relationship_id: string
  state: string
  initiator: { email: string; wrdesk_user_id: string } | null
  acceptor: { email: string; wrdesk_user_id: string } | null
  local_role: 'initiator' | 'acceptor'
  receiver_email?: string | null
  created_at: string
}

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

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    PENDING_ACCEPT: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
    PENDING_REVIEW: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  }
  const c = colors[state] || { bg: 'rgba(107,114,128,0.12)', text: '#6b7280', border: 'rgba(107,114,128,0.3)' }
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

interface PendingSlideOutProps {
  open: boolean
  onClose: () => void
  pendingOutgoing: HandshakeRecord[]
  pendingIncoming: HandshakeRecord[]
  counterpartyEmail: (r: HandshakeRecord) => string
  onAccept: (r: HandshakeRecord) => void
  onDecline: (id: string) => void
  onCancel: (id: string) => void
  acceptError: string | null
  acceptModalRecord: HandshakeRecord | null
  onCapsuleSubmitted: () => void
}

export default function PendingSlideOut({
  open,
  onClose,
  pendingOutgoing,
  pendingIncoming,
  counterpartyEmail,
  onAccept,
  onDecline,
  onCancel,
  acceptError,
  acceptModalRecord,
  onCapsuleSubmitted,
}: PendingSlideOutProps) {
  if (!open) return null

  const pending = [...pendingOutgoing, ...pendingIncoming]

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 99,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '320px',
          height: '100vh',
          backgroundColor: 'var(--color-bg, #0f172a)',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.2)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Pending ({pending.length})</h3>
          <button
            onClick={onClose}
            style={{
              padding: '4px 8px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px',
              color: 'var(--color-text-muted, #94a3b8)',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {pending.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--color-text-muted, #94a3b8)', fontSize: '11px', lineHeight: 1.6 }}>
              No pending handshake requests.
            </div>
          ) : (
            <>
              {pendingOutgoing.map((r) => (
                <div
                  key={r.handshake_id}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    background: 'var(--color-surface, rgba(255,255,255,0.04))',
                    border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                    borderRadius: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', textTransform: 'uppercase' }}>To:</span>
                    <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 600, color: '#f59e0b' }}>Awaiting Approval</span>
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', wordBreak: 'break-all' }}>{r.receiver_email}</div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-muted, #94a3b8)', marginBottom: '8px' }}>
                    {shortId(r.handshake_id)} · {formatDate(r.created_at)}
                  </div>
                  <button
                    onClick={() => onCancel(r.handshake_id)}
                    title="Cancel handshake request"
                    style={{
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: '10px',
                      fontWeight: 600,
                      background: 'rgba(239,68,68,0.12)',
                      color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.3)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel Request
                  </button>
                </div>
              ))}
              {pendingIncoming.map((r) => (
                <div
                  key={r.handshake_id}
                  style={{
                    padding: '12px',
                    marginBottom: '8px',
                    background: 'var(--color-surface, rgba(255,255,255,0.04))',
                    border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                    borderRadius: '8px',
                  }}
                >
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
                    <div style={{ fontSize: '10px', color: '#ef4444', marginBottom: '8px', wordBreak: 'break-word' }}>{acceptError}</div>
                  )}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => onAccept(r)}
                      style={{
                        flex: 1,
                        padding: '7px 12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: 'rgba(34,197,94,0.15)',
                        color: '#22c55e',
                        border: '1px solid rgba(34,197,94,0.3)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => onDecline(r.handshake_id)}
                      style={{
                        flex: 1,
                        padding: '7px 12px',
                        fontSize: '11px',
                        fontWeight: 600,
                        background: 'rgba(239,68,68,0.12)',
                        color: '#ef4444',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}

          <div style={{ marginTop: '12px' }}>
            <CapsuleUploadZone onSubmitted={onCapsuleSubmitted} />
          </div>
        </div>
      </div>
    </>
  )
}
