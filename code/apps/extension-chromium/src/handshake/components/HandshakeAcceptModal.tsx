/**
 * HandshakeAcceptModal Component
 *
 * Modal for accepting an incoming handshake request.
 * Calls handshake.accept RPC — all crypto and capsule building
 * is handled by the backend pipeline.
 *
 * Sharing-mode selection:
 *   - receive-only: user receives context but does not share back
 *   - reciprocal:   both parties exchange context
 */

import React, { useState } from 'react'
import type { HandshakeRecord } from '../rpcTypes'
import { acceptHandshake, revokeHandshake } from '../handshakeRpc'
import {
  getThemeTokens,
  overlayStyle as themeOverlayStyle,
  panelStyle,
  headerStyle as themeHeaderStyle,
  headerTitleStyle,
  headerMainTitleStyle,
  headerSubtitleStyle,
  closeButtonStyle,
  bodyStyle,
  cardStyle,
  labelStyle as themeLabelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  notificationStyle,
} from '../../shared/ui/lightboxTheme'

type SharingMode = 'receive-only' | 'reciprocal'

interface HandshakeAcceptModalProps {
  handshake: HandshakeRecord
  fromAccountId: string
  theme?: 'default' | 'dark' | 'professional'
  onAccepted?: (handshakeId: string) => void
  onDeclined?: (handshakeId: string) => void
  onClose?: () => void
}

export const HandshakeAcceptModal: React.FC<HandshakeAcceptModalProps> = ({
  handshake,
  fromAccountId,
  theme = 'default',
  onAccepted,
  onDeclined,
  onClose,
}) => {
  const [sharingMode, setSharingMode] = useState<SharingMode>('receive-only')
  const [contextualHandshakes, setContextualHandshakes] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const t = getThemeTokens(theme)

  const handleAccept = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await acceptHandshake(handshake.handshake_id, sharingMode, fromAccountId)
      onAccepted?.(handshake.handshake_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDecline = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await revokeHandshake(handshake.handshake_id)
      onDeclined?.(handshake.handshake_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decline failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const SHARING_DESCRIPTIONS: Record<SharingMode, string> = {
    'receive-only': 'You receive context blocks from the counterparty but do not share back.',
    reciprocal: 'Both parties can exchange context blocks bidirectionally.',
  }

  return (
    <div style={themeOverlayStyle(t)} onClick={onClose}>
      <div style={panelStyle(t)} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={themeHeaderStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>🤝</span>
            <div>
              <p style={headerMainTitleStyle()}>Incoming Handshake Request</p>
              <p style={headerSubtitleStyle()}>from {handshake.counterparty_email}</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              style={closeButtonStyle(t)}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.closeHoverBg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = t.closeBg; }}
            >
              ×
            </button>
          )}
        </div>

        {/* Content */}
        <div style={bodyStyle(t)}>
          <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Sender Info */}
            <div style={cardStyle(t)}>
              <div style={themeLabelStyle(t)}>Sender</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: t.text }}>{handshake.counterparty_email}</div>
              <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '4px' }}>
                ID: {handshake.handshake_id.slice(0, 12)}...
              </div>
              <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '2px' }}>
                Requested: {new Date(handshake.created_at).toLocaleDateString()}
              </div>
            </div>

            {/* Sharing Mode */}
            <div style={cardStyle(t)}>
              <div style={themeLabelStyle(t)}>Sharing Mode</div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                {(['receive-only', 'reciprocal'] as SharingMode[]).map((mode) => {
                  const isActive = sharingMode === mode
                  const colors = {
                    'receive-only': { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)', text: '#60a5fa' },
                    reciprocal: { bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)', text: '#4ade80' },
                  }
                  const c = colors[mode]
                  return (
                    <button
                      key={mode}
                      onClick={() => setSharingMode(mode)}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: isActive ? 600 : 400,
                        cursor: 'pointer',
                        background: isActive ? c.bg : 'transparent',
                        border: `1px solid ${isActive ? c.border : t.border}`,
                        color: isActive ? c.text : t.textMuted,
                        transition: 'all 0.15s',
                      }}
                    >
                      {mode === 'receive-only' ? '📥 Receive Only' : '🔄 Reciprocal'}
                    </button>
                  )
                })}
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: t.textMuted, lineHeight: 1.5 }}>
                {SHARING_DESCRIPTIONS[sharingMode]}
              </p>
            </div>

            {/* Contextual Handshakes toggle */}
            <div style={{
              ...cardStyle(t),
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: t.text }}>Contextual Handshakes</div>
                <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px' }}>
                  {contextualHandshakes ? 'Includes secured business data from your Vault.' : 'Basic mode — no Vault data required.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setContextualHandshakes(v => !v)}
                aria-pressed={contextualHandshakes}
                aria-label="Toggle Contextual Handshakes"
                style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: contextualHandshakes ? '#818cf8' : 'rgba(255,255,255,0.2)', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 }}
              >
                <span style={{ position: 'absolute', top: '3px', left: contextualHandshakes ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </button>
            </div>

            {/* Vault Access Required banner */}
            {contextualHandshakes && error && error.toLowerCase().includes('vault') && (
              <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '18px', flexShrink: 0 }}>🔒</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>Vault Access Required for Contextual Handshakes.</div>
                  <div style={{ fontSize: '11px', color: '#ef4444', lineHeight: 1.5 }}>Contextual handshakes rely on secured business data stored in your Vault.</div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && !(contextualHandshakes && error.toLowerCase().includes('vault')) && (
              <div style={notificationStyle('error')}>
                ✕ {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleDecline}
                disabled={isSubmitting}
                style={{
                  ...secondaryButtonStyle(t, isSubmitting),
                  border: '1px solid rgba(239,68,68,0.35)',
                  color: t.error,
                }}
              >
                Decline
              </button>
              <button
                onClick={handleAccept}
                disabled={isSubmitting}
                style={{
                  padding: '11px 20px',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  border: 'none',
                  borderRadius: '9px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isSubmitting ? 'wait' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1,
                  transition: 'all 0.18s',
                  boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
                }}
              >
                {isSubmitting ? 'Processing...' : '✓ Accept Handshake'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HandshakeAcceptModal
