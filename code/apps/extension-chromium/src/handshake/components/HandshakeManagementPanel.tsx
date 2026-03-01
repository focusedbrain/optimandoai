/**
 * HandshakeManagementPanel Component
 *
 * Lists all handshakes grouped by state (Active / Pending / Revoked).
 * Reads from useHandshakes() hook (backend-backed).
 */

import React, { useState } from 'react'
import type { HandshakeRecord, HandshakeState } from '../rpcTypes'
import { useHandshakes } from '../useHandshakes'
import { HandshakeDetailsPanel } from './HandshakeDetailsPanel'
import { HandshakeAcceptModal } from './HandshakeAcceptModal'
import { InitiateHandshakeDialog } from './InitiateHandshakeDialog'

interface HandshakeManagementPanelProps {
  fromAccountId: string
  theme?: 'default' | 'dark' | 'professional'
  onSendMessage?: (handshakeId: string) => void
}

const STATE_ORDER: HandshakeState[] = ['ACTIVE', 'PENDING_ACCEPT', 'REVOKED', 'EXPIRED']

const STATE_LABELS: Record<HandshakeState, string> = {
  ACTIVE: 'Active',
  PENDING_ACCEPT: 'Pending',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
}

export const HandshakeManagementPanel: React.FC<HandshakeManagementPanelProps> = ({
  fromAccountId,
  theme = 'default',
  onSendMessage,
}) => {
  const { handshakes, loading, error, refresh } = useHandshakes('all')
  const [selectedHandshake, setSelectedHandshake] = useState<HandshakeRecord | null>(null)
  const [acceptingHandshake, setAcceptingHandshake] = useState<HandshakeRecord | null>(null)
  const [showInitiate, setShowInitiate] = useState(false)

  const isProfessional = theme === 'professional'

  const grouped = STATE_ORDER.reduce(
    (acc, state) => {
      const items = handshakes.filter((h) => h.state === state)
      if (items.length > 0) acc.push({ state, items })
      return acc
    },
    [] as { state: HandshakeState; items: HandshakeRecord[] }[],
  )

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)' }}>
        Loading handshakes...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px' }}>{error}</div>
        <button
          onClick={refresh}
          style={{
            padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
            cursor: 'pointer', border: 'none',
            background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
            color: isProfessional ? '#1f2937' : 'white',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Header with Initiate button */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
          Handshakes ({handshakes.length})
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={refresh}
            style={{
              padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
              cursor: 'pointer', border: 'none',
              background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
            }}
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => setShowInitiate(true)}
            style={{
              padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', border: 'none',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
            }}
          >
            + New Handshake
          </button>
        </div>
      </div>

      {handshakes.length === 0 ? (
        <div style={{ padding: '32px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🤝</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white', marginBottom: '6px' }}>
            No Handshakes
          </div>
          <div style={{ fontSize: '12px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginBottom: '16px' }}>
            Initiate a handshake to start exchanging secure BEAP messages.
          </div>
          <button
            onClick={() => setShowInitiate(true)}
            style={{
              padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', border: 'none',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
            }}
          >
            + Initiate Handshake
          </button>
        </div>
      ) : (
        <div style={{ padding: '8px' }}>
          {grouped.map(({ state, items }) => (
            <div key={state} style={{ marginBottom: '16px' }}>
              <div
                style={{
                  fontSize: '10px', fontWeight: 600,
                  color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)',
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  padding: '4px 8px', marginBottom: '6px',
                }}
              >
                {STATE_LABELS[state]} ({items.length})
              </div>
              {items.map((hs) => (
                <HandshakeListItem
                  key={hs.handshake_id}
                  handshake={hs}
                  isProfessional={isProfessional}
                  onClick={() => setSelectedHandshake(hs)}
                  onAccept={
                    hs.state === 'PENDING_ACCEPT' && hs.local_role === 'acceptor'
                      ? () => setAcceptingHandshake(hs)
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedHandshake && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setSelectedHandshake(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px', width: '100%' }}>
            <HandshakeDetailsPanel
              handshake={selectedHandshake}
              theme={theme}
              onClose={() => setSelectedHandshake(null)}
              onSendMessage={onSendMessage}
              onAccept={
                selectedHandshake.state === 'PENDING_ACCEPT' && selectedHandshake.local_role === 'acceptor'
                  ? () => { setAcceptingHandshake(selectedHandshake); setSelectedHandshake(null) }
                  : undefined
              }
              onRevoke={() => { setSelectedHandshake(null); refresh() }}
            />
          </div>
        </div>
      )}

      {/* Accept modal */}
      {acceptingHandshake && (
        <HandshakeAcceptModal
          handshake={acceptingHandshake}
          fromAccountId={fromAccountId}
          theme={theme}
          onAccepted={() => { setAcceptingHandshake(null); refresh() }}
          onDeclined={() => { setAcceptingHandshake(null); refresh() }}
          onClose={() => setAcceptingHandshake(null)}
        />
      )}

      {/* Initiate dialog */}
      {showInitiate && (
        <InitiateHandshakeDialog
          fromAccountId={fromAccountId}
          theme={theme}
          onInitiated={() => { setShowInitiate(false); refresh() }}
          onClose={() => setShowInitiate(false)}
        />
      )}
    </div>
  )
}

const HandshakeListItem: React.FC<{
  handshake: HandshakeRecord
  isProfessional: boolean
  onClick: () => void
  onAccept?: () => void
}> = ({ handshake, isProfessional, onClick, onAccept }) => {
  const stateColors: Record<HandshakeState, string> = {
    ACTIVE: '#22c55e',
    PENDING_ACCEPT: '#f59e0b',
    REVOKED: '#ef4444',
    EXPIRED: '#6b7280',
  }
  const stateColor = stateColors[handshake.state] ?? '#6b7280'

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.04)',
        borderRadius: '8px',
        marginBottom: '4px',
        cursor: 'pointer',
        border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}`,
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>
            {handshake.state === 'ACTIVE' ? '🔐' : handshake.state === 'PENDING_ACCEPT' ? '⏳' : '🔒'}
          </span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
              {handshake.counterparty_email}
            </div>
            <div style={{ fontSize: '10px', color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)' }}>
              {handshake.local_role === 'initiator' ? 'You initiated' : 'They initiated'}
              {handshake.sharing_mode ? ` · ${handshake.sharing_mode === 'reciprocal' ? 'Reciprocal' : 'Receive-only'}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {onAccept && (
            <button
              onClick={(e) => { e.stopPropagation(); onAccept() }}
              style={{
                padding: '3px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: 'rgba(34,197,94,0.15)', color: '#22c55e',
              }}
            >
              Accept
            </button>
          )}
          <span
            style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: stateColor, display: 'inline-block',
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default HandshakeManagementPanel
