/**
 * HandshakeManagementPanel Component
 *
 * Lists all handshakes grouped by state (Active / Pending / Revoked).
 * Reads from useHandshakes() hook (backend-backed).
 */

import React, { useState, useEffect } from 'react'
import type { HandshakeRecord, HandshakeState } from '../rpcTypes'
import { hasHandshakeKeyMaterial } from '../rpcTypes'
import { useHandshakes } from '../useHandshakes'
import { deleteHandshake } from '../handshakeRpc'
import { HandshakeDetailsPanel } from './HandshakeDetailsPanel'
import { HandshakeAcceptModal } from './HandshakeAcceptModal'
import { InitiateHandshakeDialog } from './InitiateHandshakeDialog'
import { getVaultStatus } from '../../vault/api'
import { useWRGuardStore } from '../../wrguard/useWRGuardStore'

interface HandshakeManagementPanelProps {
  fromAccountId: string
  theme?: 'default' | 'dark' | 'professional'
  onSendMessage?: (handshakeId: string) => void
  /** Navigate to BEAP inbox and select a message. Used when "View in Inbox" is clicked from handshake messages. */
  onViewInInbox?: (messageId: string) => void
  /** Config for BeapMessageDetailPanel reply composer. */
  replyComposerConfig?: import('../../beap-messages/hooks/useReplyComposer').UseReplyComposerConfig
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
  onViewInInbox,
  replyComposerConfig,
}) => {
  const { handshakes, loading, error, refresh } = useHandshakes('all')
  const [selectedHandshake, setSelectedHandshake] = useState<HandshakeRecord | null>(null)
  const [acceptingHandshake, setAcceptingHandshake] = useState<HandshakeRecord | null>(null)
  const [showInitiate, setShowInitiate] = useState(false)
  const [includeVaultProfiles, setIncludeVaultProfiles] = useState(true)
  const [canUseHsContextProfiles, setCanUseHsContextProfiles] = useState(false)
  const selectedHandshakeId = useWRGuardStore((s) => s.selectedHandshakeId)
  const setSelectedHandshakeId = useWRGuardStore((s) => s.setSelectedHandshakeId)

  useEffect(() => {
    getVaultStatus()
      .then((s) => setCanUseHsContextProfiles(s?.canUseHsContextProfiles ?? false))
      .catch(() => setCanUseHsContextProfiles(false))
  }, [])

  // When navigating from inbox ("View Handshake"), select the handshake by ID
  useEffect(() => {
    if (!selectedHandshakeId || handshakes.length === 0) return
    const hs = handshakes.find((h) => h.handshake_id === selectedHandshakeId)
    if (hs) {
      setSelectedHandshake(hs)
      setSelectedHandshakeId(null)
    }
  }, [selectedHandshakeId, handshakes, setSelectedHandshakeId])

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

  const isVaultError = error && error.toLowerCase().includes('vault')

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

      {/* Add a Context Graph toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}`,
        background: includeVaultProfiles
          ? (isProfessional ? 'rgba(129,140,248,0.06)' : 'rgba(129,140,248,0.08)')
          : 'transparent',
        transition: 'background 0.18s',
      }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: isProfessional ? '#1f2937' : 'white' }}>Add a Context Graph</div>
          <div style={{ fontSize: '11px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
            {includeVaultProfiles ? 'Attach structured business context from your Vault to this handshake.' : 'No context graph will be attached.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIncludeVaultProfiles(v => !v)}
          aria-pressed={includeVaultProfiles}
          aria-label="Toggle Context Graph"
          style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: includeVaultProfiles ? '#818cf8' : (isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'), cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 }}
        >
          <span style={{ position: 'absolute', top: '3px', left: includeVaultProfiles ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </button>
      </div>

      {/* Vault Access Required banner */}
      {includeVaultProfiles && isVaultError && (
        <div style={{ margin: '10px 16px', padding: '12px 14px', background: isProfessional ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.12)', border: `2px solid ${isProfessional ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.4)'}`, borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '18px', flexShrink: 0 }}>🔒</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>Vault access required to include Vault profiles.</div>
            <div style={{ fontSize: '11px', color: '#ef4444', lineHeight: 1.5 }}>Contextual handshakes rely on secured business data stored in your Vault.</div>
          </div>
        </div>
      )}

      {/* Non-vault errors shown inline */}
      {error && !isVaultError && (
        <div style={{ margin: '10px 16px', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ color: '#ef4444', fontSize: '12px', flex: 1 }}>{error}</div>
          <button
            onClick={refresh}
            style={{
              padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
              cursor: 'pointer', border: 'none',
              background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
              color: isProfessional ? '#1f2937' : 'white',
              flexShrink: 0,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!error && handshakes.length === 0 ? (
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
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => { setSelectedHandshake(null); setSelectedHandshakeId(null) }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px', width: '100%' }}>
            <HandshakeDetailsPanel
              handshake={selectedHandshake}
              theme={theme}
              onClose={() => { setSelectedHandshake(null); setSelectedHandshakeId(null) }}
              onSendMessage={onSendMessage}
              onViewInInbox={onViewInInbox}
              replyComposerConfig={replyComposerConfig}
              onAccept={
                selectedHandshake.state === 'PENDING_ACCEPT' && selectedHandshake.local_role === 'acceptor'
                  ? () => { setAcceptingHandshake(selectedHandshake); setSelectedHandshake(null) }
                  : undefined
              }
              onRevoke={() => { setSelectedHandshake(null); refresh() }}
              onDelete={async (id) => {
                const res = await deleteHandshake(id)
                if (res?.success !== false) {
                  setSelectedHandshake(null)
                  refresh()
                }
              }}
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
          canUseHsContextProfiles={canUseHsContextProfiles}
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
          canUseHsContextProfiles={canUseHsContextProfiles}
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
            {handshake.state === 'ACTIVE'
              ? (hasHandshakeKeyMaterial(handshake) ? '🔒' : '⚠️')
              : handshake.state === 'PENDING_ACCEPT'
                ? '⏳'
                : '🔒'}
          </span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
              {handshake.counterparty_email}
            </div>
            <div style={{ fontSize: '10px', color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)' }}>
              {handshake.state === 'ACTIVE' && !hasHandshakeKeyMaterial(handshake)
                ? '⚠️ Incomplete — delete and re-establish'
                : `${handshake.local_role === 'initiator' ? 'You initiated' : 'They initiated'}${handshake.sharing_mode ? ` · ${handshake.sharing_mode === 'reciprocal' ? 'Reciprocal' : 'Receive-only'}` : ''}`}
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
