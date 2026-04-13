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
 *
 * Context Graph: responder can attach their HS Context Profiles and ad-hoc
 * context when accepting, matching the initiator flow.
 */

import React, { useState, useEffect } from 'react'
import type { HandshakeRecord } from '../rpcTypes'
import { acceptHandshake, revokeHandshake } from '../handshakeRpc'
import { isSameAccountHandshakeEmails } from '@shared/handshake/receiverEmailValidation'
import { buildAcceptContextOptions } from '../buildInitiateContextOptions'
import { HandshakeContextProfilePicker } from './HandshakeContextProfilePicker'
import type { ProfileContextItem } from '@shared/handshake/types'
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
  inputStyle as themeInputStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  notificationStyle,
} from '../../shared/ui/lightboxTheme'
import { getVaultStatus } from '../../vault/api'

type SharingMode = 'receive-only' | 'reciprocal'

interface HandshakeAcceptModalProps {
  handshake: HandshakeRecord
  fromAccountId: string
  theme?: 'default' | 'dark' | 'professional'
  onAccepted?: (handshakeId: string) => void
  onDeclined?: (handshakeId: string) => void
  onClose?: () => void
  /** Whether the current user has Publisher/Enterprise tier. */
  canUseHsContextProfiles?: boolean
}

export const HandshakeAcceptModal: React.FC<HandshakeAcceptModalProps> = ({
  handshake,
  fromAccountId,
  theme = 'default',
  onAccepted,
  onDeclined,
  onClose,
  canUseHsContextProfiles = false,
}) => {
  const [sharingMode, setSharingMode] = useState<SharingMode>('receive-only')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Include Vault Profiles — master toggle for attaching context
  const [includeVaultProfiles, setIncludeVaultProfiles] = useState(true)

  // Vault lock status — used to gate profile picker
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    getVaultStatus()
      .then((s) => setIsVaultUnlocked(s?.isUnlocked === true || s?.locked === false))
      .catch(() => setIsVaultUnlocked(false))
  }, [])

  // Context Graph — collapsible, tabbed: Vault Profiles + Ad-hoc
  const [showContextGraph, setShowContextGraph] = useState(false)
  const [contextGraphTab, setContextGraphTab] = useState<'vault' | 'adhoc'>('vault')
  const [contextGraphText, setContextGraphText] = useState('')
  const [contextGraphType, setContextGraphType] = useState<'text' | 'json'>('text')

  // HS Context Profiles (publisher+ only)
  const [selectedProfileItems, setSelectedProfileItems] = useState<ProfileContextItem[]>([])
  const [adhocBlockPolicy, setAdhocBlockPolicy] = useState<{ policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' } }>({ policy_mode: 'inherit' })
  const defaultPolicy = { ai_processing_mode: 'local_only' as const }

  const isInternal =
    handshake.handshake_type === 'internal' ||
    isSameAccountHandshakeEmails(handshake.counterparty_email, handshake.receiver_email)

  const [acceptorDeviceName, setAcceptorDeviceName] = useState('')
  const [acceptorDeviceRole, setAcceptorDeviceRole] = useState<'host' | 'sandbox'>('sandbox')

  const t = getThemeTokens(theme)

  useEffect(() => {
    const opp =
      handshake.initiator_device_role === 'host'
        ? 'sandbox'
        : handshake.initiator_device_role === 'sandbox'
          ? 'host'
          : 'sandbox'
    setAcceptorDeviceRole(opp)
  }, [handshake.handshake_id, handshake.initiator_device_role])

  useEffect(() => {
    const om = (typeof window !== 'undefined' ? (window as unknown as { orchestratorMode?: { getDeviceInfo?: () => Promise<{ deviceName?: string } | null> } }).orchestratorMode : undefined)
    om?.getDeviceInfo?.().then((info) => {
      if (info?.deviceName) setAcceptorDeviceName(info.deviceName)
    }).catch(() => { /* optional */ })
  }, [])

  const handleAccept = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      const contextOpts =
        includeVaultProfiles
          ? await buildAcceptContextOptions({
              policySelections: defaultPolicy,
              selectedProfileItems,
              contextGraphText,
              contextGraphType,
              adhocBlockPolicy,
            })
          : {}

      const opts = Object.keys(contextOpts).length > 0 ? { ...contextOpts } : {}
      if (isInternal) {
        if (acceptorDeviceName.trim()) (opts as { device_name?: string }).device_name = acceptorDeviceName.trim()
        ;(opts as { device_role?: 'host' | 'sandbox' }).device_role = acceptorDeviceRole
      }
      await acceptHandshake(
        handshake.handshake_id,
        sharingMode,
        fromAccountId,
        Object.keys(opts).length > 0 ? opts : undefined,
      )
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

            {/* Add a Context Graph toggle — only when HS Context Profiles available */}
            {canUseHsContextProfiles && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px',
                background: includeVaultProfiles ? 'rgba(129,140,248,0.08)' : 'transparent',
                border: `1px solid ${includeVaultProfiles ? 'rgba(129,140,248,0.30)' : t.border}`,
                borderRadius: '10px',
                transition: 'all 0.18s',
              }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: t.text }}>Add a Context Graph</div>
                  <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px' }}>
                    {includeVaultProfiles ? 'Attach structured business context from your Vault to this handshake.' : 'No context graph will be attached.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIncludeVaultProfiles(v => !v)}
                  aria-pressed={includeVaultProfiles}
                  aria-label="Toggle Context Graph"
                  style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: includeVaultProfiles ? '#818cf8' : 'rgba(255,255,255,0.2)', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 }}
                >
                  <span style={{ position: 'absolute', top: '3px', left: includeVaultProfiles ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                </button>
              </div>
            )}

            {/* Context Graph — collapsible, tabbed: Vault Profiles + Ad-hoc */}
            {canUseHsContextProfiles && (
              <div style={{
                border: `1px solid ${showContextGraph ? 'rgba(129,140,248,0.45)' : 'rgba(129,140,248,0.18)'}`,
                borderRadius: '10px',
                overflow: 'hidden',
                transition: 'border-color 0.15s',
              }}>
                <button
                  type="button"
                  onClick={() => setShowContextGraph(v => !v)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: showContextGraph ? 'rgba(129,140,248,0.12)' : 'rgba(129,140,248,0.05)',
                    border: 'none',
                    color: showContextGraph ? t.text : t.textMuted,
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <span>🧠 Context Graph</span>
                  <span style={{ fontSize: '10px', opacity: 0.7 }}>{showContextGraph ? '▲ Collapse' : '▼ Expand'}</span>
                </button>

                {showContextGraph && (
                  <div style={{ borderTop: `1px solid ${t.border}` }}>
                    <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}` }}>
                      {(['vault', 'adhoc'] as const).map((tab) => {
                        const active = contextGraphTab === tab
                        return (
                          <button
                            key={tab}
                            type="button"
                            onClick={() => setContextGraphTab(tab)}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              fontSize: '11px',
                              fontWeight: active ? 700 : 500,
                              background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
                              border: 'none',
                              borderBottom: active ? '2px solid #818cf8' : '2px solid transparent',
                              color: active ? t.text : t.textMuted,
                              cursor: 'pointer',
                              transition: 'all 0.12s',
                            }}
                          >
                            {tab === 'vault' ? '🗂 Vault Profiles' : '✏️ Ad-hoc Context'}
                          </button>
                        )
                      })}
                    </div>

                    {contextGraphTab === 'vault' && (
                      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ padding: '9px 12px', background: 'rgba(129,140,248,0.08)', borderRadius: '8px', fontSize: '11px', color: t.textMuted, lineHeight: 1.5 }}>
                          🗂 Select reusable context profiles stored in your Vault. Their content is normalized to plain text and attached to this handshake.
                        </div>
                        <HandshakeContextProfilePicker
                          selectedItems={selectedProfileItems}
                          onChange={setSelectedProfileItems}
                          defaultPolicy={defaultPolicy}
                          theme={theme === 'professional' ? 'standard' : 'dark'}
                          disabled={isSubmitting}
                          isVaultUnlocked={isVaultUnlocked}
                        />
                      </div>
                    )}

                    {contextGraphTab === 'adhoc' && (
                      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ padding: '9px 12px', background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: '8px', fontSize: '11px', color: t.textMuted, lineHeight: 1.5 }}>
                          ℹ️ Ad-hoc context is normalized to plain text before sending. JSON is rendered as Key: Value lines.
                        </div>
                        <div>
                          <label style={themeLabelStyle(t)}>Format</label>
                          <select
                            value={contextGraphType}
                            onChange={(e) => setContextGraphType(e.target.value as 'text' | 'json')}
                            disabled={isSubmitting}
                            style={themeInputStyle(t)}
                          >
                            <option value="text">📝 Plain Text</option>
                            <option value="json">📦 JSON / Structured Data</option>
                          </select>
                        </div>
                        <div>
                          <label style={themeLabelStyle(t)}>
                            {contextGraphType === 'json' ? 'JSON Payload' : 'Context Content'}
                          </label>
                          <textarea
                            value={contextGraphText}
                            onChange={(e) => setContextGraphText(e.target.value)}
                            disabled={isSubmitting}
                            placeholder={
                              contextGraphType === 'json'
                                ? '{"key": "value", ...}'
                                : 'Enter context information to share with the initiator...'
                            }
                            rows={4}
                            style={{
                              ...themeInputStyle(t),
                              resize: 'vertical',
                              lineHeight: 1.5,
                              fontFamily: contextGraphType === 'json' ? 'monospace' : 'inherit',
                            }}
                          />
                        </div>
                        <div style={{ padding: '8px 12px', background: 'rgba(139,92,246,0.06)', borderRadius: '8px', border: `1px solid ${t.border}` }}>
                          <div style={{ fontSize: '10px', fontWeight: 600, color: t.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Policy for this ad-hoc context
                          </div>
                          <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                            <button
                              type="button"
                              onClick={() => setAdhocBlockPolicy({ policy_mode: 'inherit' })}
                              disabled={isSubmitting}
                              style={{
                                padding: '4px 10px',
                                fontSize: '11px',
                                background: adhocBlockPolicy.policy_mode === 'inherit' ? 'rgba(139,92,246,0.2)' : 'transparent',
                                border: `1px solid ${adhocBlockPolicy.policy_mode === 'inherit' ? '#8b5cf6' : t.border}`,
                                borderRadius: '6px',
                                color: adhocBlockPolicy.policy_mode === 'inherit' ? '#5b21b6' : t.textMuted,
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Use default
                            </button>
                            <button
                              type="button"
                              onClick={() => setAdhocBlockPolicy({ policy_mode: 'override', policy: { ai_processing_mode: defaultPolicy.ai_processing_mode } })}
                              disabled={isSubmitting}
                              style={{
                                padding: '4px 10px',
                                fontSize: '11px',
                                background: adhocBlockPolicy.policy_mode === 'override' ? 'rgba(139,92,246,0.2)' : 'transparent',
                                border: `1px solid ${adhocBlockPolicy.policy_mode === 'override' ? '#8b5cf6' : t.border}`,
                                borderRadius: '6px',
                                color: adhocBlockPolicy.policy_mode === 'override' ? '#5b21b6' : t.textMuted,
                                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Override
                            </button>
                          </div>
                          {adhocBlockPolicy.policy_mode === 'override' && adhocBlockPolicy.policy && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {(['none', 'local_only', 'internal_and_cloud'] as const).map((m) => (
                                <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: isSubmitting ? 'default' : 'pointer', color: t.text }}>
                                  <input
                                    type="radio"
                                    name="adhoc-ai-policy-accept"
                                    checked={(adhocBlockPolicy.policy.ai_processing_mode ?? 'local_only') === m}
                                    disabled={isSubmitting}
                                    onChange={() => setAdhocBlockPolicy({ ...adhocBlockPolicy, policy: { ai_processing_mode: m } })}
                                    style={{ accentColor: '#8b5cf6' }}
                                  />
                                  <span>{m === 'none' ? 'No AI processing' : m === 'local_only' ? 'Internal AI only' : 'Allow Internal + Cloud AI'}</span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Vault Access Required banner */}
            {includeVaultProfiles && error && error.toLowerCase().includes('vault') && (
              <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '18px', flexShrink: 0 }}>🔒</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>Vault access required to include Vault profiles.</div>
                  <div style={{ fontSize: '11px', color: '#ef4444', lineHeight: 1.5 }}>Contextual handshakes rely on secured business data stored in your Vault.</div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && !(includeVaultProfiles && error.toLowerCase().includes('vault')) && (
              <div style={notificationStyle('error')}>
                ✕ {error}
              </div>
            )}

            {isInternal && (
              <div style={{ marginBottom: '16px', padding: '12px', background: 'rgba(83,74,183,0.06)', borderRadius: '8px' }}>
                <div style={{ fontWeight: 500, marginBottom: '8px', fontSize: '13px', color: t.text }}>
                  Internal handshake — configure this device
                </div>
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontSize: '12px', color: t.textMuted, display: 'block', marginBottom: '4px' }}>
                    Device name
                  </label>
                  <input
                    type="text"
                    value={acceptorDeviceName}
                    onChange={(e) => setAcceptorDeviceName(e.target.value)}
                    placeholder="e.g. Office Mini PC"
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: `1px solid ${t.border}`,
                      fontSize: '13px',
                      background: t.inputBg,
                      color: t.text,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: t.textMuted, display: 'block', marginBottom: '4px' }}>
                    This device is:
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => setAcceptorDeviceRole('host')}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: acceptorDeviceRole === 'host' ? '#534AB7' : 'transparent',
                        color: acceptorDeviceRole === 'host' ? '#fff' : t.textMuted,
                        border: acceptorDeviceRole === 'host' ? 'none' : `1px solid ${t.border}`,
                      }}
                    >Host</button>
                    <button
                      type="button"
                      onClick={() => setAcceptorDeviceRole('sandbox')}
                      style={{
                        flex: 1,
                        padding: '6px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: acceptorDeviceRole === 'sandbox' ? '#534AB7' : 'transparent',
                        color: acceptorDeviceRole === 'sandbox' ? '#fff' : t.textMuted,
                        border: acceptorDeviceRole === 'sandbox' ? 'none' : `1px solid ${t.border}`,
                      }}
                    >Sandbox</button>
                  </div>
                </div>
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
