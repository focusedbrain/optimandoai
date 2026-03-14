/**
 * HandshakeRequestForm
 *
 * Inline panel for initiating a new BEAP™ Handshake Request.
 * Renders directly inside the sidebar / popup (not a modal overlay).
 *
 * Features:
 * - Connected email accounts list + "Send From" selector
 * - Your Fingerprint display (formatted, copyable)
 * - Recipient email field
 * - Personal message textarea
 * - HS Context Profiles picker (Publisher/Enterprise only)
 * - Collapsible Ad-hoc Context section (plain text / JSON)
 *   → Wired to handshake.initiate RPC via buildContextBlocks
 * - Real RPC call via initiateHandshake
 */

import React, { useState, useEffect } from 'react'
import { initiateHandshake } from '../handshakeRpc'
import { buildInitiateContextOptions } from '../buildInitiateContextOptions'
import { TOOLTIPS, POLICY_NOTES } from '../microcopy'
import { formatFingerprintGrouped, formatFingerprintShort } from '../fingerprint'
import { HandshakeContextProfilePicker } from './HandshakeContextProfilePicker'
import type { ProfileContextItem } from '@shared/handshake/types'
import { getVaultStatus } from '../../vault/api'

export interface EmailAccount {
  id: string
  email: string
  displayName: string
  provider: string
  status: string
  lastError?: string
}

export interface HandshakeRequestFormProps {
  /** The sending email account ID */
  fromAccountId: string
  /** Our own fingerprint (full hex) */
  ourFingerprint: string
  /** Our fingerprint short display */
  ourFingerprintShort: string
  /** Connected email accounts list */
  emailAccounts: EmailAccount[]
  /** Loading state for email accounts */
  isLoadingEmailAccounts: boolean
  /** Currently selected account id for sending */
  selectedEmailAccountId: string | null
  onSelectEmailAccount: (id: string) => void
  /** Opens the email setup wizard */
  onConnectEmail: () => void
  /** Disconnects an email account */
  onDisconnectEmail: (id: string) => void
  /** Theme */
  theme: 'standard' | 'pro' | 'dark'
  /** Called after cancel */
  onCancel: () => void
  /** Called after a successful initiation */
  onSuccess: () => void
  /**
   * Whether the current user has Publisher/Enterprise tier.
   * Controls visibility of the HS Context Profile picker.
   */
  canUseHsContextProfiles?: boolean
}

export function HandshakeRequestForm({
  fromAccountId,
  ourFingerprint,
  ourFingerprintShort,
  emailAccounts,
  isLoadingEmailAccounts,
  selectedEmailAccountId,
  onSelectEmailAccount,
  onConnectEmail,
  onDisconnectEmail,
  theme,
  onCancel,
  onSuccess,
  canUseHsContextProfiles = false,
}: HandshakeRequestFormProps) {
  const isStandard = theme === 'standard'
  const textColor = isStandard ? '#1f2937' : 'white'
  const mutedColor = isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)'
  const borderColor = isStandard ? 'rgba(147,51,234,0.15)' : 'rgba(255,255,255,0.15)'
  const inputBg = isStandard ? 'white' : 'rgba(255,255,255,0.08)'
  const sectionBorder = isStandard ? '1px solid rgba(147,51,234,0.12)' : '1px solid rgba(255,255,255,0.1)'

  const [recipientEmail, setRecipientEmail] = useState('')
  const [message, setMessage] = useState('')
  const [fingerprintCopied, setFingerprintCopied] = useState(false)

  // Include Vault Profiles — enabled by default when profiles available
  const [includeVaultProfiles, setIncludeVaultProfiles] = useState(true)

  // Vault lock status — used to gate profile picker
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    getVaultStatus()
      .then((s) => setIsVaultUnlocked(s?.isUnlocked === true || s?.locked === false))
      .catch(() => setIsVaultUnlocked(false))
  }, [])

  // Context Graph
  const [showContextGraph, setShowContextGraph] = useState(false)
  const [contextGraphTab, setContextGraphTab] = useState<'vault' | 'adhoc'>('vault')
  const [contextGraphText, setContextGraphText] = useState('')
  const [contextGraphType, setContextGraphType] = useState<'text' | 'json'>('text')

  // HS Context Profiles (publisher+ only) — structured for per-item policy
  const [selectedProfileItems, setSelectedProfileItems] = useState<ProfileContextItem[]>([])
  const [adhocBlockPolicy, setAdhocBlockPolicy] = useState<{ policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' } }>({ policy_mode: 'inherit' })
  const defaultPolicy = { ai_processing_mode: 'local_only' as const }

  // Send state
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendSuccess, setSendSuccess] = useState(false)

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(ourFingerprint)
      setFingerprintCopied(true)
      setTimeout(() => setFingerprintCopied(false), 2000)
    } catch {}
  }

  const handleSend = async () => {
    if (!recipientEmail.trim()) {
      setSendError('Please enter a recipient email address')
      return
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(recipientEmail.trim())) {
      setSendError('Please enter a valid email address')
      return
    }

    setSendError(null)
    setIsSending(true)

    try {
      const opts = await buildInitiateContextOptions({
        skipVaultContext: !canUseHsContextProfiles || !includeVaultProfiles,
        policySelections: defaultPolicy,
        selectedProfileItems,
        messageText: message,
        contextGraphText,
        contextGraphType,
        adhocBlockPolicy,
      })
      await initiateHandshake(
        recipientEmail.trim().toLowerCase(),
        recipientEmail.trim(),
        fromAccountId,
        opts,
      )

      setSendSuccess(true)
      setTimeout(() => {
        setSendSuccess(false)
        onSuccess()
      }, 1500)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send handshake request')
    } finally {
      setIsSending(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    marginBottom: '6px',
    display: 'block',
    color: mutedColor,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: inputBg,
    border: `1px solid ${borderColor}`,
    borderRadius: '8px',
    color: textColor,
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: sectionBorder, display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '18px' }}>🤝</span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>BEAP™ Handshake Request</span>
      </div>

      {/* Body — plain vertical stack, no overflow tricks */}
      <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

        {/* Connected Email Accounts */}
        <div style={{ padding: '14px', borderRadius: '10px', border: sectionBorder, background: isStandard ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>🔗</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: isStandard ? '#0f172a' : textColor }}>Connected Email Accounts</span>
            </div>
            <button
              onClick={onConnectEmail}
              style={{ background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', border: 'none', color: 'white', borderRadius: '6px', padding: '6px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>+</span> Connect Email
            </button>
          </div>

          {isLoadingEmailAccounts ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px', color: mutedColor }}>Loading accounts...</div>
          ) : emailAccounts.length === 0 ? (
            <div style={{ padding: '20px', background: isStandard ? 'white' : 'rgba(255,255,255,0.05)', borderRadius: '8px', border: isStandard ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)', textAlign: 'center' }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
              <div style={{ fontSize: '13px', color: isStandard ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px' }}>No email accounts connected</div>
              <div style={{ fontSize: '11px', color: isStandard ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>Connect your email to send handshake requests</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {emailAccounts.map(account => (
                <div
                  key={account.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: isStandard ? 'white' : 'rgba(255,255,255,0.08)',
                    borderRadius: '8px',
                    border: account.status === 'active'
                      ? (isStandard ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)')
                      : (isStandard ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)'),
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '18px' }}>
                      {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}
                    </span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: isStandard ? '#0f172a' : textColor }}>
                        {account.email || account.displayName}
                      </div>
                      <div style={{ fontSize: '10px', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: account.status === 'active' ? '#22c55e' : '#ef4444' }} />
                        <span style={{ color: isStandard ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
                          {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onDisconnectEmail(account.id)}
                    title="Disconnect"
                    style={{ background: 'transparent', border: 'none', color: isStandard ? '#94a3b8' : 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px', fontSize: '14px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {emailAccounts.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <label style={labelStyle}>Send From:</label>
              <select
                value={selectedEmailAccountId || emailAccounts[0]?.id || ''}
                onChange={(e) => onSelectEmailAccount(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                {emailAccounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.email || account.displayName} ({account.provider})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Your Fingerprint — prominent */}
        <div style={{
          padding: '12px 14px',
          background: isStandard ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)',
          border: `2px solid ${isStandard ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.3)'}`,
          borderRadius: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              🔐 {TOOLTIPS.FINGERPRINT_TITLE}
              <span style={{ cursor: 'help', fontSize: '11px', fontWeight: 400 }} title={TOOLTIPS.FINGERPRINT}>ⓘ</span>
            </div>
            <button
              onClick={copyFingerprint}
              style={{ padding: '4px 10px', fontSize: '10px', background: isStandard ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', color: mutedColor, cursor: 'pointer' }}
            >
              {fingerprintCopied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '11px', color: textColor, wordBreak: 'break-all', lineHeight: 1.5 }}>
            {formatFingerprintGrouped(ourFingerprint)}
          </div>
          <div style={{ marginTop: '8px', fontSize: '10px', color: isStandard ? '#9ca3af' : 'rgba(255,255,255,0.5)' }}>
            Short: <span style={{ fontFamily: 'monospace' }}>{ourFingerprintShort || formatFingerprintShort(ourFingerprint)}</span>
          </div>
        </div>

        {/* Recipient */}
        <div>
          <label style={labelStyle}>To:</label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="recipient@example.com"
            style={inputStyle}
          />
        </div>

        <div style={{
          padding: '10px 14px',
          background: isStandard ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.12)',
          border: `1px solid ${isStandard ? 'rgba(59,130,246,0.20)' : 'rgba(59,130,246,0.25)'}`,
          borderRadius: '8px',
          fontSize: '12px',
          color: isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)',
          lineHeight: 1.5,
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
        }}>
          <span style={{ flexShrink: 0, fontSize: '14px' }}>ℹ️</span>
          <span>Use the exact SSO/account email of the intended recipient — not a personal email, alias, or forwarding address. Only the account with that email can accept this handshake.</span>
        </div>

        {/* Personal message */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={labelStyle}>Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a personal note to your handshake request (optional)..."
            style={{ ...inputStyle, minHeight: '100px', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>

        {/* Include Vault Profiles toggle — only when HS Context Profiles available */}
        {canUseHsContextProfiles && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: includeVaultProfiles ? (isStandard ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.12)') : 'transparent',
          border: `1px solid ${includeVaultProfiles ? (isStandard ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.35)') : borderColor}`,
          borderRadius: '10px',
          transition: 'all 0.18s',
        }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: textColor }}>Add a Context Graph</div>
            <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
              {includeVaultProfiles ? 'Attach structured business context from your Vault to this handshake.' : 'No context graph will be attached.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIncludeVaultProfiles(v => !v)}
            aria-pressed={includeVaultProfiles}
            aria-label="Toggle Context Graph"
            style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: includeVaultProfiles ? '#8b5cf6' : (isStandard ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'), cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 }}
          >
            <span style={{ position: 'absolute', top: '3px', left: includeVaultProfiles ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </button>
        </div>
        )}

        {/* Vault Access Required banner — include profiles ON + vault error from RPC */}
        {includeVaultProfiles && sendError && sendError.toLowerCase().includes('vault') && (
          <div style={{ padding: '12px 14px', background: isStandard ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.12)', border: `2px solid ${isStandard ? 'rgba(239,68,68,0.35)' : 'rgba(239,68,68,0.4)'}`, borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>🔒</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>Vault access required to include Vault profiles.</div>
              <div style={{ fontSize: '11px', color: '#ef4444', lineHeight: 1.5 }}>Vault profiles require secure access to data stored in your Vault.</div>
            </div>
          </div>
        )}

        {/* Context Graph — collapsible, tabbed: Vault Profiles + Ad-hoc */}
        <div style={{
          border: `1px solid ${showContextGraph ? (isStandard ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.45)') : borderColor}`,
          borderRadius: '10px',
          overflow: 'hidden',
          transition: 'border-color 0.15s',
        }}>
          {/* Header toggle */}
          <button
            type="button"
            onClick={() => setShowContextGraph(v => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: showContextGraph
                ? (isStandard ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.18)')
                : (isStandard ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.04)'),
              border: 'none',
              color: showContextGraph ? (isStandard ? '#7c3aed' : '#c4b5fd') : mutedColor,
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
            <div style={{ borderTop: `1px solid ${borderColor}` }}>
              {/* Tabs */}
              <div style={{ display: 'flex', borderBottom: `1px solid ${borderColor}` }}>
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
                        background: active
                          ? (isStandard ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)')
                          : 'transparent',
                        border: 'none',
                        borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
                        color: active ? (isStandard ? '#7c3aed' : '#c4b5fd') : mutedColor,
                        cursor: 'pointer',
                        transition: 'all 0.12s',
                      }}
                    >
                      {tab === 'vault' ? '🗂 Vault Profiles' : '✏️ Ad-hoc Context'}
                    </button>
                  )
                })}
              </div>

              {/* Tab: Vault Profiles */}
              {contextGraphTab === 'vault' && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ padding: '9px 12px', background: isStandard ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.1)', borderRadius: '8px', fontSize: '11px', color: mutedColor, lineHeight: 1.5 }}>
                    🗂 Select reusable context profiles stored in your Vault. Their content is normalized to plain text and attached to this handshake.
                  </div>
                  {canUseHsContextProfiles ? (
                    <HandshakeContextProfilePicker
                      selectedItems={selectedProfileItems}
                      onChange={setSelectedProfileItems}
                      defaultPolicy={defaultPolicy}
                      theme={theme}
                      disabled={isSending}
                      isVaultUnlocked={isVaultUnlocked}
                    />
                  ) : (
                    <div style={{
                      padding: '16px', textAlign: 'center',
                      border: `1px dashed ${borderColor}`, borderRadius: '8px',
                      display: 'flex', flexDirection: 'column', gap: '6px',
                    }}>
                      <div style={{ fontSize: '20px' }}>🔒</div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: textColor }}>Publisher / Enterprise feature</div>
                      <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.5 }}>
                        Upgrade to attach structured Vault Profiles to your handshakes — including business identity, custom fields, and confidential documents.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab: Ad-hoc Context */}
              {contextGraphTab === 'adhoc' && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ padding: '9px 12px', background: isStandard ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.12)', borderRadius: '8px', fontSize: '11px', color: mutedColor, lineHeight: 1.5 }}>
                    ℹ️ Ad-hoc context is normalized to plain text before sending. JSON is rendered as Key: Value lines.
                  </div>
                  <div>
                    <label style={labelStyle}>Format</label>
                    <select
                      value={contextGraphType}
                      onChange={(e) => setContextGraphType(e.target.value as 'text' | 'json')}
                      style={{ ...inputStyle, cursor: 'pointer' }}
                    >
                      <option value="text">📝 Plain Text</option>
                      <option value="json">📦 JSON / Structured Data</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>
                      {contextGraphType === 'json' ? 'JSON Payload' : 'Context Content'}
                    </label>
                    <textarea
                      value={contextGraphText}
                      onChange={(e) => setContextGraphText(e.target.value)}
                      placeholder={
                        contextGraphType === 'json'
                          ? '{"key": "value", ...}'
                          : 'Enter context information to share with the recipient...'
                      }
                      style={{
                        ...inputStyle,
                        minHeight: '80px',
                        resize: 'vertical',
                        lineHeight: 1.5,
                        fontFamily: contextGraphType === 'json' ? 'monospace' : 'inherit',
                      }}
                    />
                  </div>
                  <div style={{ padding: '8px 12px', background: isStandard ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.12)', borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Policy for this ad-hoc context
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setAdhocBlockPolicy({ policy_mode: 'inherit' })}
                          disabled={isSending}
                          style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            background: adhocBlockPolicy.policy_mode === 'inherit' ? 'rgba(139,92,246,0.2)' : 'transparent',
                            border: `1px solid ${adhocBlockPolicy.policy_mode === 'inherit' ? '#8b5cf6' : borderColor}`,
                            borderRadius: '6px',
                            color: adhocBlockPolicy.policy_mode === 'inherit' ? (isStandard ? '#5b21b6' : '#c4b5fd') : mutedColor,
                            cursor: isSending ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Use default
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdhocBlockPolicy({ policy_mode: 'override', policy: { ai_processing_mode: defaultPolicy.ai_processing_mode } })}
                          disabled={isSending}
                          style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            background: adhocBlockPolicy.policy_mode === 'override' ? 'rgba(139,92,246,0.2)' : 'transparent',
                            border: `1px solid ${adhocBlockPolicy.policy_mode === 'override' ? '#8b5cf6' : borderColor}`,
                            borderRadius: '6px',
                            color: adhocBlockPolicy.policy_mode === 'override' ? (isStandard ? '#5b21b6' : '#c4b5fd') : mutedColor,
                            cursor: isSending ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Override
                        </button>
                      </div>
                      {adhocBlockPolicy.policy_mode === 'override' && adhocBlockPolicy.policy && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(['none', 'local_only', 'internal_and_cloud'] as const).map((m) => (
                            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: isSending ? 'default' : 'pointer', color: textColor }}>
                              <input
                                type="radio"
                                name="adhoc-ai-policy-req"
                                checked={(adhocBlockPolicy.policy.ai_processing_mode ?? 'local_only') === m}
                                disabled={isSending}
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

        {/* Policy note */}
        <div style={{ padding: '10px 12px', background: isStandard ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.12)', borderRadius: '8px', fontSize: '11px', color: mutedColor }}>
          🛡️ {POLICY_NOTES.LOCAL_OVERRIDE}
        </div>

        <div style={{ padding: '10px 12px', background: isStandard ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.12)', borderRadius: '8px', fontSize: '11px', color: mutedColor }}>
          💡 Recipient will appear in your Handshakes once they accept. You can then send BEAP™ Messages directly via the Draft composer.
        </div>

        {/* Error / Success */}
        {sendError && !(includeVaultProfiles && sendError.toLowerCase().includes('vault')) && (
          <div style={{ padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', fontSize: '12px', color: '#ef4444' }}>
            ⚠️ {sendError}
          </div>
        )}
        {sendSuccess && (
          <div style={{ padding: '10px 12px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '8px', fontSize: '12px', color: '#22c55e' }}>
            ✓ Handshake request sent successfully!
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 14px', borderTop: sectionBorder, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${borderColor}`, borderRadius: '8px', color: mutedColor, fontSize: '12px', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSend}
          disabled={isSending}
          style={{
            padding: '8px 20px',
            background: isSending ? 'rgba(139,92,246,0.5)' : 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            fontSize: '12px',
            fontWeight: 600,
            cursor: isSending ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            opacity: isSending ? 0.7 : 1,
          }}
        >
          {isSending ? '⏳ Sending...' : '📧 Send Request'}
        </button>
      </div>
    </div>
  )
}
