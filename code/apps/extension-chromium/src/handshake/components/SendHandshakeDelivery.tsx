/**
 * SendHandshakeDelivery
 *
 * Inline panel for choosing how to deliver a BEAP™ Handshake to a recipient.
 *
 * Delivery modes:
 *  - "Email via API"        → Send directly using a connected mailbox (API send).
 *  - "Email as attachment"  → Download .beap capsule; recipient copies the email template.
 */

import React, { useState, useEffect } from 'react'
import { initiateHandshake, buildHandshakeForDownload } from '../handshakeRpc'
import { HandshakeContextProfilePicker } from './HandshakeContextProfilePicker'
import { buildInitiateContextOptions } from '../buildInitiateContextOptions'
import { parsePolicyToMode } from '@shared/handshake/policyUtils'
import type { ProfileContextItem } from '@shared/handshake/types'
import { getVaultStatus } from '../../vault/api'
import { electronRpc } from '../../rpc/electronRpc'

// =============================================================================
// Types
// =============================================================================

type DeliveryMode = 'api' | 'attachment'

type Theme = 'standard' | 'pro' | 'dark'

export interface EmailAccount {
  id: string
  email: string
  provider?: string
}

export interface SendHandshakeDeliveryProps {
  /** Prefilled subject line */
  defaultSubject?: string
  /** Theme to match the host panel */
  theme?: Theme
  /** Called when the user clicks Cancel / Back */
  onBack?: () => void
  /** The email account ID used for sending */
  fromAccountId?: string
  /** Available email accounts */
  emailAccounts?: EmailAccount[]
  /** Callback when email account changes */
  onSelectEmailAccount?: (id: string) => void
  /** Called on successful handshake creation. May receive result with handshake_id (API send only). */
  onSuccess?: (result?: { handshake_id?: string }) => void
  /** Whether the current user has Publisher/Enterprise tier. */
  canUseHsContextProfiles?: boolean
  /** Policy selections: ai_processing_mode (exclusive) or legacy cloud_ai/internal_ai. */
  policySelections?: { ai_processing_mode?: 'none' | 'local_only' | 'internal_and_cloud' } | { cloud_ai?: boolean; internal_ai?: boolean }
  /** Called when vault is required for current action (e.g. vault profiles selected). */
  onRequiresVaultChange?: (requires: boolean) => void
  /** Optional: vault unlock state provided by the host (Electron app). When provided,
   *  the internal getVaultStatus fetch is skipped and this value is used directly. */
  isVaultUnlocked?: boolean
  /** Same-account handshake: pass internal metadata to initiate/download RPC only (does not change delivery UI). */
  isInternalHandshake?: boolean
  /** When set (e.g. SSO email), recipient field is pre-filled and read-only. */
  lockedRecipientEmail?: string
  deviceName?: string
  deviceRole?: 'host' | 'sandbox'
  /**
   * Local orchestrator 6-digit pairing code — used as a client-side guard so the
   * user can't accidentally type this device's own pairing code into the "other
   * device" field. When omitted, the self-pairing guard is skipped (the backend
   * resolve + validators still enforce distinctness).
   */
  localPairingCode?: string
}

// =============================================================================
// Helpers
// =============================================================================

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Six decimal digits, no separators. Matches the persisted `pairingCode` form. */
const PAIRING_CODE_PATTERN = /^[0-9]{6}$/

/** Strip all non-digit characters and clamp to 6 digits — used as the user types. */
function normalizePairingCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6)
}

/** Format a digit string for display: "482917" → "482-917", "4829" → "4829". */
function formatPairingCodeForInput(digits: string): string {
  if (digits.length <= 3) return digits
  return `${digits.slice(0, 3)}-${digits.slice(3)}`
}

function useThemeTokens(theme: Theme) {
  const isStandard = theme === 'standard'
  const isDark = theme === 'dark'

  return {
    isStandard,
    text: isStandard ? '#0f172a' : '#f1f5f9',
    muted: isStandard ? '#6b7280' : 'rgba(255,255,255,0.55)',
    border: isStandard ? 'rgba(147,51,234,0.14)' : 'rgba(255,255,255,0.12)',
    inputBg: isStandard ? '#ffffff' : isDark ? '#1e293b' : 'rgba(255,255,255,0.08)',
    inputBorder: isStandard ? 'rgba(147,51,234,0.18)' : 'rgba(255,255,255,0.18)',
    sectionBg: isStandard ? '#f8f9fb' : 'rgba(255,255,255,0.04)',
    accentPrimary: '#8b5cf6',
    accentPrimaryLight: isStandard ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.18)',
    accentPrimaryBorder: isStandard ? 'rgba(139,92,246,0.28)' : 'rgba(139,92,246,0.38)',
    dangerBg: isStandard ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.15)',
    dangerBorder: isStandard ? 'rgba(245,158,11,0.30)' : 'rgba(245,158,11,0.35)',
    dangerText: isStandard ? '#92400e' : '#fbbf24',
    errorBg: 'rgba(239,68,68,0.10)',
    errorBorder: 'rgba(239,68,68,0.30)',
    errorText: '#ef4444',
    successBg: 'rgba(34,197,94,0.10)',
    successBorder: 'rgba(34,197,94,0.30)',
    successText: '#22c55e',
    noteBg: isStandard ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.14)',
    noteBorder: isStandard ? 'rgba(59,130,246,0.20)' : 'rgba(59,130,246,0.25)',
    noteText: isStandard ? '#1e40af' : '#93c5fd',
  }
}

// =============================================================================
// Sub-component: Delivery Mode Selector
// =============================================================================

interface DeliveryOptionProps {
  mode: DeliveryMode
  selected: boolean
  label: string
  description: string
  onClick: () => void
  t: ReturnType<typeof useThemeTokens>
}

const DeliveryOption: React.FC<DeliveryOptionProps> = ({
  mode: _mode,
  selected,
  label,
  description,
  onClick,
  t,
}) => {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '4px',
        padding: '11px 13px',
        background: selected
          ? t.accentPrimaryLight
          : hovered
            ? t.isStandard
              ? 'rgba(0,0,0,0.02)'
              : 'rgba(255,255,255,0.05)'
            : 'transparent',
        border: `1.5px solid ${selected ? t.accentPrimary : t.border}`,
        borderRadius: '9px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '7px',
        }}
      >
        {/* Radio indicator */}
        <span
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            border: `2px solid ${selected ? t.accentPrimary : t.muted}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            transition: 'border-color 0.12s',
          }}
        >
          {selected && (
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: t.accentPrimary,
              }}
            />
          )}
        </span>
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: selected ? (t.isStandard ? '#7c3aed' : '#c4b5fd') : t.text,
            transition: 'color 0.12s',
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: '11px',
          color: t.muted,
          lineHeight: 1.45,
          paddingLeft: '21px',
        }}
      >
        {description}
      </span>
    </button>
  )
}

// =============================================================================
// Main Component
// =============================================================================

const DEFAULT_SUBJECT = 'BEAP Handshake – Secure communication invitation'

export const SendHandshakeDelivery: React.FC<SendHandshakeDeliveryProps> = ({
  defaultSubject = DEFAULT_SUBJECT,
  theme = 'dark',
  onBack,
  fromAccountId = '',
  emailAccounts = [],
  onSelectEmailAccount,
  onSuccess,
  canUseHsContextProfiles = false,
  policySelections,
  onRequiresVaultChange,
  isVaultUnlocked: isVaultUnlockedProp,
  isInternalHandshake = false,
  lockedRecipientEmail,
  deviceName,
  deviceRole,
  localPairingCode,
}) => {
  const t = useThemeTokens(theme)

  // Include Vault Profiles — enabled by default when profiles available
  const [includeVaultProfiles, setIncludeVaultProfiles] = useState(true)

  // Vault lock status — prefer prop from host (Electron app) over internal fetch
  const [isVaultUnlockedInternal, setIsVaultUnlockedInternal] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    // Only fetch internally when the host doesn't supply the value
    if (isVaultUnlockedProp !== undefined) return
    getVaultStatus()
      .then((s) => setIsVaultUnlockedInternal(s?.isUnlocked === true || s?.locked === false))
      .catch(() => setIsVaultUnlockedInternal(false))
  }, [isVaultUnlockedProp])
  const isVaultUnlocked = isVaultUnlockedProp !== undefined ? isVaultUnlockedProp : isVaultUnlockedInternal

  // Context Graph
  const [showContextGraph, setShowContextGraph] = useState(false)
  const [contextGraphTab, setContextGraphTab] = useState<'vault' | 'adhoc'>('vault')
  const [contextGraphText, setContextGraphText] = useState('')
  const [contextGraphType, setContextGraphType] = useState<'text' | 'json'>('text')
  const [selectedProfileItems, setSelectedProfileItems] = useState<ProfileContextItem[]>([])
  const [adhocBlockPolicy, setAdhocBlockPolicy] = useState<{ policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' } }>({ policy_mode: 'inherit' })

  // Notify parent when vault is required (vault profiles selected)
  useEffect(() => {
    onRequiresVaultChange?.(includeVaultProfiles && selectedProfileItems.length > 0)
  }, [includeVaultProfiles, selectedProfileItems.length, onRequiresVaultChange])

  // Delivery mode
  const [mode, setMode] = useState<DeliveryMode>('attachment')

  // Shared fields
  const [recipientEmail, setRecipientEmail] = useState(() => (lockedRecipientEmail?.trim() ? lockedRecipientEmail.trim() : ''))
  const [subject, setSubject] = useState(defaultSubject)

  // API-only fields
  const [message, setMessage] = useState('')

  // UI state
  const [touched, setTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [actionDone, setActionDone] = useState<'sent' | 'downloaded' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Phase 3: relay push outcome for internal handshakes. Keeps the form visible (unlike
  // actionDone which replaces the whole panel) so the user can send more or fall back
  // to a manual download without navigating back.
  type InternalRelayOutcome =
    | { kind: 'pushed_live'; handshakeId: string }
    | { kind: 'queued_recipient_offline'; handshakeId: string }
    | { kind: 'coordination_unavailable'; message: string }
    | { kind: 'skipped'; handshakeId: string }
  const [internalRelayOutcome, setInternalRelayOutcome] = useState<InternalRelayOutcome | null>(null)

  // Pairing code typed by the user — stored as a digits-only string (≤6 chars).
  // Display layer adds the dash. Cleared when the form is reset after a send.
  const [counterpartyPairingCode, setCounterpartyPairingCode] = useState('')
  // Resolved counterparty device identity from `orchestrator.resolvePairingCode`.
  // Used for the actual capsule build; the raw pairing code is never sent on the wire.
  const [resolvedCounterparty, setResolvedCounterparty] = useState<{
    instance_id: string
    device_name: string
  } | null>(null)
  const [resolvingPairingCode, setResolvingPairingCode] = useState(false)

  // Drop any cached resolution as soon as the user edits the code so a stale
  // (instance_id, device_name) pair can never be submitted by mistake.
  useEffect(() => {
    setResolvedCounterparty(null)
  }, [counterpartyPairingCode])

  // Inline validation for the pairing code field. We intentionally do NOT mark
  // a partially typed code as invalid (would feel buggy as the user is typing);
  // the submit handler enforces the 6-digit minimum.
  const pairingCodeIsSelf =
    counterpartyPairingCode.length === 6 &&
    !!localPairingCode?.trim() &&
    PAIRING_CODE_PATTERN.test(localPairingCode.trim()) &&
    counterpartyPairingCode === localPairingCode.trim()
  const pairingCodeInlineError: string | null = pairingCodeIsSelf
    ? "That's this device's pairing code. Read the code from your other device's Settings screen."
    : null

  // Validation
  const emailError =
    touched && (!recipientEmail.trim() || !EMAIL_PATTERN.test(recipientEmail.trim()))
      ? !recipientEmail.trim()
        ? 'Recipient email is required.'
        : 'Please enter a valid email address.'
      : null

  useEffect(() => {
    const v = lockedRecipientEmail?.trim()
    if (v) setRecipientEmail(v)
  }, [lockedRecipientEmail])

  const effectiveInternalRole = deviceRole ?? 'sandbox'

  // This device's computer name is auto-derived from orchestrator settings via the
  // `deviceName` prop. There is no longer a manual override — the pairing-code resolve
  // returns the peer's real `device_name` so the previous Advanced section is gone.
  const resolvedLocalComputerName = deviceName?.trim() ?? ''

  // Build the internal RPC extras for the underlying initiate / build-for-download call.
  // Requires a successful resolve first — the wire format wants the real instance_id and
  // device_name, never the 6-digit pairing code.
  const internalRpcExtras = () => {
    if (!isInternalHandshake) return {}
    if (!resolvedCounterparty) return {}
    return {
      handshake_type: 'internal' as const,
      device_name: resolvedLocalComputerName,
      device_role: effectiveInternalRole,
      counterparty_device_id: resolvedCounterparty.instance_id,
      // handshakeRpc.ts infers this as the opposite of device_role, but we still
      // pass it here so older callers / direct RPC consumers get an explicit value.
      counterparty_device_role: effectiveInternalRole === 'host' ? ('sandbox' as const) : ('host' as const),
      counterparty_computer_name:
        resolvedCounterparty.device_name.trim() || 'Other device',
    }
  }

  // Submit gating for the internal flow: a complete (6-digit, non-self) pairing code
  // and a non-empty local device name. The peer's computer name is filled in after
  // resolve, so it isn't part of the precondition check.
  const internalFieldsComplete =
    !isInternalHandshake ||
    (!!resolvedLocalComputerName &&
      counterpartyPairingCode.length === 6 &&
      !pairingCodeInlineError)

  const isValid =
    !!recipientEmail.trim() &&
    EMAIL_PATTERN.test(recipientEmail.trim()) &&
    internalFieldsComplete
  const noEmailAccount = mode === 'api' && emailAccounts.length === 0

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const buildContextOptions = () =>
    buildInitiateContextOptions({
      skipVaultContext: !canUseHsContextProfiles || !includeVaultProfiles,
      policySelections: policySelections ?? { ai_processing_mode: 'local_only' },
      selectedProfileItems,
      messageText: message,
      contextGraphText,
      contextGraphType,
      adhocBlockPolicy,
    })

  /**
   * Resolve the typed 6-digit pairing code to the peer's `instance_id` + `device_name`
   * via the local Electron host bridge, which proxies to the coordination service using
   * the OIDC token (never exposed to the extension).
   *
   * Returns the resolved identity on success, or null on failure (in which case `error`
   * state has already been set with a user-actionable message). Callers should bail out
   * when `null` is returned.
   *
   * Self-pairing is rejected before the network call so the user sees the same
   * inline message that already shows on the field.
   */
  const ensureCounterpartyResolved = async (): Promise<{ instance_id: string; device_name: string } | null> => {
    if (counterpartyPairingCode.length !== 6) {
      setError("Enter the 6-digit pairing code from your other device.")
      return null
    }
    if (pairingCodeIsSelf) {
      setError("That's this device's pairing code. Read the code from your other device's Settings screen.")
      return null
    }
    // Cached resolution from a prior attempt is reused as long as the code hasn't
    // changed (the useEffect above invalidates it on edit).
    if (resolvedCounterparty) return resolvedCounterparty
    setResolvingPairingCode(true)
    try {
      const result = await electronRpc('orchestrator.resolvePairingCode', { code: counterpartyPairingCode })
      if (!result.success) {
        if (result.status === 404) {
          setError(
            "No device found with that pairing code. Check the code on your other device's Settings screen, or regenerate it if it's stale.",
          )
        } else {
          setError(result.error || 'Could not resolve pairing code. Try again in a moment.')
        }
        return null
      }
      const data = result.data as { ok?: boolean; instance_id?: unknown; device_name?: unknown; error?: unknown } | null
      const instance_id = typeof data?.instance_id === 'string' ? data.instance_id.trim() : ''
      const device_name = typeof data?.device_name === 'string' ? data.device_name : ''
      if (!data?.ok || !instance_id) {
        setError(
          (typeof data?.error === 'string' && data.error) ||
            'Pairing code resolution returned no device. Try regenerating the code on your other device.',
        )
        return null
      }
      const resolved = { instance_id, device_name }
      setResolvedCounterparty(resolved)
      return resolved
    } catch (err: any) {
      setError(err?.message || 'Could not reach the coordination service to resolve the pairing code.')
      return null
    } finally {
      setResolvingPairingCode(false)
    }
  }

  const handleSendViaApi = async () => {
    setTouched(true)
    setError(null)
    setInternalRelayOutcome(null)
    if (!isValid) return
    if (isInternalHandshake) {
      // Resolve runs first so a 404 / collision shows up before the user sees the
      // "Sending…" spinner. The button is gated by `sending || resolvingPairingCode`
      // (see button JSX) so a double-click can't fire two resolves in parallel.
      const resolved = await ensureCounterpartyResolved()
      if (!resolved) return
    }
    // Internal handshakes don't need an email account — the coordination relay handles
    // delivery. For external handshakes we still require one because the initiate capsule
    // is delivered via API email in this phase.
    if (!isInternalHandshake && !fromAccountId) {
      setError('No email account selected.')
      return
    }
    setSending(true)
    try {
      const opts = await buildContextOptions()
      const result = await initiateHandshake(
        recipientEmail.trim().toLowerCase(),
        recipientEmail.trim(),
        isInternalHandshake ? (fromAccountId || null) : fromAccountId,
        { ...opts, ...internalRpcExtras() },
      )
      if (!result.handshake_id || result.success === false) {
        setError(result.error || 'Failed to send handshake.')
        return
      }
      if (isInternalHandshake) {
        // Phase 3: the backend pushes the initiate capsule via the coordination relay.
        // We surface the outcome inline and keep the form open so the user can send more
        // handshakes or switch to the download fallback without re-entering state.
        const rd = result.relay_delivery
        if (rd === 'pushed_live') {
          setInternalRelayOutcome({ kind: 'pushed_live', handshakeId: result.handshake_id })
        } else if (rd === 'queued_recipient_offline') {
          setInternalRelayOutcome({ kind: 'queued_recipient_offline', handshakeId: result.handshake_id })
        } else if (rd === 'coordination_unavailable') {
          setInternalRelayOutcome({
            kind: 'coordination_unavailable',
            message:
              result.relay_error ??
              "Couldn't reach the coordination service. Download the capsule and transfer it manually.",
          })
        } else {
          // 'skipped' or null — coordination not configured; treat as successful create
          // but recommend manual transfer.
          setInternalRelayOutcome({ kind: 'skipped', handshakeId: result.handshake_id })
        }
        onSuccess?.({ handshake_id: result.handshake_id })
      } else {
        setActionDone('sent')
        onSuccess?.({ handshake_id: result.handshake_id })
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to send handshake.')
    } finally {
      setSending(false)
    }
  }

  const handleDownloadCapsule = async () => {
    setTouched(true)
    setError(null)
    if (!isValid) return
    if (isInternalHandshake) {
      const resolved = await ensureCounterpartyResolved()
      if (!resolved) return
    }
    setSending(true)
    try {
      const opts = await buildContextOptions()
      const result = await buildHandshakeForDownload(recipientEmail.trim(), fromAccountId, {
        ...opts,
        ...internalRpcExtras(),
      })
      if (!result.success || !result.capsule_json) {
        setError(result.error || 'Failed to build capsule.')
        return
      }
      const blob = new Blob([result.capsule_json], { type: 'application/vnd.beap+json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      const localpart = recipientEmail.trim().split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'unknown'
      const capsuleData = result.capsule_json ? JSON.parse(result.capsule_json) : null
      const shortHash = capsuleData?.capsule_hash?.slice(0, 8) || result.handshake_id?.slice(3, 11) || 'capsule'
      anchor.download = `handshake_${localpart}_${shortHash}.beap`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      setActionDone('downloaded')
      onSuccess?.()
    } catch (err: any) {
      setError(err?.message || 'Failed to build capsule.')
    } finally {
      setSending(false)
    }
  }

  const handleCopyEmailTemplate = async () => {
    const template = [
      `To: ${recipientEmail || '<recipient>'}`,
      `Subject: ${subject}`,
      '',
      'Hi,',
      '',
      "I'd like to establish a secure BEAP™ communication channel with you.",
      'Please find the handshake capsule attached (.beap file).',
      '',
      'To accept, open it in your BEAP-compatible client.',
      '',
      '— Sent via BEAP Secure Handshake',
    ].join('\n')

    try {
      await navigator.clipboard.writeText(template)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    } catch {
      // clipboard not available in this context — silently ignore
    }
  }

  // -------------------------------------------------------------------------
  // Shared style helpers
  // -------------------------------------------------------------------------

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    marginBottom: '5px',
    display: 'block',
    color: t.muted,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  }

  const inputStyle = (hasError?: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '9px 12px',
    background: t.inputBg,
    border: `1px solid ${hasError ? t.errorText : t.inputBorder}`,
    borderRadius: '8px',
    color: t.text,
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    transition: 'border-color 0.12s',
  })

  // -------------------------------------------------------------------------
  // Success state
  // -------------------------------------------------------------------------

  if (actionDone) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '44px 24px',
          textAlign: 'center',
          gap: '14px',
        }}
      >
        <span style={{ fontSize: '48px' }}>{actionDone === 'sent' ? '✅' : '📥'}</span>
        <div style={{ fontSize: '16px', fontWeight: 700, color: t.text }}>
          {actionDone === 'sent' ? 'Handshake sent!' : 'Capsule downloaded!'}
        </div>
        <div style={{ fontSize: '12px', color: t.muted, lineHeight: 1.5, maxWidth: '280px' }}>
          {actionDone === 'sent'
            ? `Handshake email delivered to ${recipientEmail}. It will be active once they accept.`
            : `Attach the .beap file to an email addressed to ${recipientEmail} and send it manually.`}
        </div>
        <button
          onClick={() => {
            setActionDone(null)
            setTouched(false)
            setCounterpartyPairingCode('')
            setResolvedCounterparty(null)
            setRecipientEmail('')
            setSubject(defaultSubject)
            setMessage('')
          }}
          style={{
            marginTop: '8px',
            padding: '9px 20px',
            background: t.accentPrimaryLight,
            border: `1px solid ${t.accentPrimaryBorder}`,
            borderRadius: '8px',
            color: t.isStandard ? '#7c3aed' : '#c4b5fd',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Send another
        </button>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              padding: '7px 16px',
              background: 'transparent',
              border: `1px solid ${t.border}`,
              borderRadius: '8px',
              color: t.muted,
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        )}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ---- Section title ---- */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          <span style={{ fontSize: '17px' }}>📬</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: t.text }}>
            Handshake delivery
          </span>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: `1px solid ${t.border}`,
              borderRadius: '6px',
              color: t.muted,
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        )}
      </div>

      {/* ---- Body ---- */}
      <div
        style={{
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '13px',
        }}
      >
        {/* ---- Delivery mode selector ----
            Phase 3: internal handshakes always push via the coordination relay (with
            a file download fallback offered inline in the action area). The email
            mode selector is only meaningful for external, email-identified peers. */}
        {!isInternalHandshake && (
          <div>
            <label style={labelStyle}>Delivery method</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <DeliveryOption
                mode="api"
                selected={mode === 'api'}
                label="Email via API"
                description="Send directly using your connected mailbox."
                onClick={() => setMode('api')}
                t={t}
              />
              <DeliveryOption
                mode="attachment"
                selected={mode === 'attachment'}
                label="Email as attachment"
                description="Download the BEAP capsule and attach it to an email yourself."
                onClick={() => setMode('attachment')}
                t={t}
              />
            </div>
          </div>
        )}

        {/* ---- Include Vault Profiles toggle (only when HS Context Profiles available) ---- */}
        {canUseHsContextProfiles && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          background: includeVaultProfiles ? t.accentPrimaryLight : 'transparent',
          border: `1px solid ${includeVaultProfiles ? t.accentPrimaryBorder : t.border}`,
          borderRadius: '10px',
          transition: 'all 0.18s',
        }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: t.text }}>Add a Context Graph</div>
            <div style={{ fontSize: '11px', color: t.muted, marginTop: '2px' }}>
              {includeVaultProfiles ? 'Attach structured business context from your Vault to this handshake.' : 'No context graph will be attached.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIncludeVaultProfiles(v => !v)}
            aria-pressed={includeVaultProfiles}
            aria-label="Toggle Context Graph"
            style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: includeVaultProfiles ? t.accentPrimary : (t.isStandard ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'), cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 }}
          >
            <span style={{ position: 'absolute', top: '3px', left: includeVaultProfiles ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
          </button>
        </div>
        )}

        {/* ---- Vault Access Required banner (include profiles ON + vault error) ---- */}
        {includeVaultProfiles && error && error.toLowerCase().includes('vault') && (
          <div style={{
            padding: '12px 14px',
            background: t.errorBg,
            border: `2px solid ${t.errorBorder}`,
            borderRadius: '8px',
            display: 'flex', gap: '10px', alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>🔒</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: t.errorText, marginBottom: '4px' }}>Vault access required to include Vault profiles.</div>
              <div style={{ fontSize: '11px', color: t.errorText, lineHeight: 1.5 }}>Contextual handshakes rely on secured business data stored in your Vault.</div>
            </div>
          </div>
        )}

        {/* ---- Attachment-mode warning ----
            Suppressed for internal handshakes: the warning is about spoofing risk when
            a recipient sees an email from a different address than the BEAP-account
            owner, which doesn't apply to a same-account device-to-device pairing. */}
        {mode === 'attachment' && !isInternalHandshake && (
          <div
            style={{
              padding: '10px 13px',
              background: t.dangerBg,
              border: `1px solid ${t.dangerBorder}`,
              borderRadius: '8px',
              fontSize: '11px',
              color: t.dangerText,
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, fontSize: '13px' }}>⚠️</span>
            <span>
              <strong>Recommendation:</strong> send from the same email address that owns the BEAP
              account to avoid confusion for recipients.
            </span>
          </div>
        )}

        {/* ---- Recipient email ---- */}
        <div>
          <label style={labelStyle}>Recipient email *</label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => {
              if (lockedRecipientEmail?.trim()) return
              setRecipientEmail(e.target.value)
              if (touched) setTouched(true)
            }}
            onBlur={() => setTouched(true)}
            placeholder="recipient@example.com"
            readOnly={!!lockedRecipientEmail?.trim()}
            disabled={sending}
            style={{
              ...inputStyle(!!emailError),
              ...(lockedRecipientEmail?.trim()
                ? { opacity: 0.85, cursor: 'not-allowed', background: t.isStandard ? '#f3f4f6' : 'rgba(255,255,255,0.06)' }
                : {}),
            }}
          />
          {emailError && (
            <div style={{ marginTop: '5px', fontSize: '11px', color: t.errorText }}>
              {emailError}
            </div>
          )}
          <div style={{
            marginTop: '6px',
            padding: '10px 14px',
            background: t.noteBg,
            border: `1px solid ${t.noteBorder}`,
            borderRadius: '8px',
            fontSize: '12px',
            color: t.noteText,
            lineHeight: 1.5,
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
          }}>
            <span style={{ flexShrink: 0, fontSize: '14px' }}>ℹ️</span>
            <span>Use the exact SSO/account email of the intended recipient — not a personal email, alias, or forwarding address. Only the account with that email can accept this handshake.</span>
          </div>
        </div>

        {isInternalHandshake && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              padding: '12px 14px',
              background: t.accentPrimaryLight,
              border: `1px solid ${t.accentPrimaryBorder}`,
              borderRadius: '10px',
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 700, color: t.text }}>
              Internal handshake — device pairing
            </div>
            <p
              data-testid="internal-pairing-helper"
              style={{ fontSize: '11px', color: t.muted, margin: 0, lineHeight: 1.5 }}
            >
              Internal handshakes pair two devices on the same account. You'll need the{' '}
              <strong style={{ color: t.text }}>6-digit Pairing code</strong> from the other device — find it in{' '}
              <strong style={{ color: t.text }}>Settings → Orchestrator mode</strong>.
            </p>
            <div>
              <div
                style={{
                  fontSize: '11px',
                  color: t.muted,
                  marginBottom: '6px',
                  lineHeight: 1.4,
                }}
              >
                On your other device, open Settings → Orchestrator mode and read the 6-digit Pairing code.
              </div>
              <label style={labelStyle}>Pairing code from the other device *</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
                data-testid="internal-counterparty-pairing-code"
                value={formatPairingCodeForInput(counterpartyPairingCode)}
                onChange={(e) =>
                  setCounterpartyPairingCode(normalizePairingCodeInput(e.target.value))
                }
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData('text') ?? ''
                  const digits = normalizePairingCodeInput(pasted)
                  if (digits) {
                    e.preventDefault()
                    setCounterpartyPairingCode(digits)
                  }
                }}
                disabled={sending || resolvingPairingCode}
                placeholder="XXX-XXX"
                aria-invalid={
                  !!pairingCodeInlineError ||
                  (touched && counterpartyPairingCode.length > 0 && counterpartyPairingCode.length < 6)
                }
                style={{
                  ...inputStyle(
                    !!pairingCodeInlineError ||
                      (touched && counterpartyPairingCode.length > 0 && counterpartyPairingCode.length < 6),
                  ),
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                  fontSize: '22px',
                  fontWeight: 600,
                  letterSpacing: '2px',
                  textAlign: 'center',
                  padding: '12px 14px',
                }}
              />
              {pairingCodeInlineError ? (
                <div
                  data-testid="internal-counterparty-pairing-code-error"
                  style={{ marginTop: '5px', fontSize: '11px', color: t.errorText }}
                >
                  {pairingCodeInlineError}
                </div>
              ) : touched && counterpartyPairingCode.length > 0 && counterpartyPairingCode.length < 6 ? (
                <div
                  data-testid="internal-counterparty-pairing-code-error"
                  style={{ marginTop: '5px', fontSize: '11px', color: t.errorText }}
                >
                  Pairing codes are 6 digits — keep typing.
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ---- Subject ---- */}
        <div>
          <label style={labelStyle}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            style={inputStyle()}
          />
        </div>

        {/* ---- Message (API mode only) ---- */}
        {mode === 'api' && (
          <div>
            <label style={labelStyle}>Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a personal note to accompany the handshake…"
              disabled={sending}
              rows={3}
              style={{
                ...inputStyle(),
                resize: 'vertical',
                lineHeight: 1.5,
                minHeight: '76px',
              }}
            />
          </div>
        )}

        {/* ---- Context Graph — collapsible, tabbed: Vault Profiles + Ad-hoc ---- */}
        {/* Always visible for all users. Ad-hoc tab available to all; Vault tab gated by canUseHsContextProfiles. */}
        <div style={{
            border: `1px solid ${showContextGraph ? t.accentPrimaryBorder : t.border}`,
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
                background: showContextGraph ? t.accentPrimaryLight : (t.isStandard ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.04)'),
                border: 'none',
                color: showContextGraph ? (t.isStandard ? '#7c3aed' : '#c4b5fd') : t.muted,
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
                          background: active ? t.accentPrimaryLight : 'transparent',
                          border: 'none',
                          borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
                          color: active ? (t.isStandard ? '#7c3aed' : '#c4b5fd') : t.muted,
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
                    <div style={{ padding: '9px 12px', background: t.accentPrimaryLight, borderRadius: '8px', fontSize: '11px', color: t.muted, lineHeight: 1.5 }}>
                      🗂 Select reusable context profiles stored in your Vault. Their content is normalized to plain text and attached to this handshake.
                    </div>
                    {canUseHsContextProfiles ? (
                      <HandshakeContextProfilePicker
                        selectedItems={selectedProfileItems}
                        onChange={setSelectedProfileItems}
                        defaultPolicy={policySelections ?? { cloud_ai: false, internal_ai: false }}
                        theme={theme}
                        disabled={sending}
                        isVaultUnlocked={isVaultUnlocked}
                      />
                    ) : (
                      <div style={{
                        padding: '16px', textAlign: 'center',
                        border: `1px dashed ${t.border}`, borderRadius: '8px',
                        display: 'flex', flexDirection: 'column', gap: '6px',
                      }}>
                        <div style={{ fontSize: '20px' }}>🔒</div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: t.text }}>Publisher / Enterprise feature</div>
                        <div style={{ fontSize: '11px', color: t.muted, lineHeight: 1.5 }}>
                          Upgrade to attach structured Vault Profiles to your handshakes — including business identity, custom fields, and confidential documents.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {contextGraphTab === 'adhoc' && (
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ padding: '9px 12px', background: t.noteBg, border: `1px solid ${t.noteBorder}`, borderRadius: '8px', fontSize: '11px', color: t.muted, lineHeight: 1.5 }}>
                      ℹ️ Ad-hoc context is normalized to plain text before sending. JSON is rendered as Key: Value lines.
                    </div>
                    <div>
                      <label style={labelStyle}>Format</label>
                      <select
                        value={contextGraphType}
                        onChange={(e) => setContextGraphType(e.target.value as 'text' | 'json')}
                        disabled={sending}
                        style={inputStyle()}
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
                        disabled={sending}
                        placeholder={
                          contextGraphType === 'json'
                            ? '{"key": "value", ...}'
                            : 'Enter context information to share with the recipient...'
                        }
                        rows={4}
                        style={{
                          ...inputStyle(),
                          resize: 'vertical',
                          lineHeight: 1.5,
                          fontFamily: contextGraphType === 'json' ? 'monospace' : 'inherit',
                        }}
                      />
                    </div>
                    <div style={{ padding: '8px 12px', background: t.accentPrimaryLight, borderRadius: '8px', border: `1px solid ${t.border}` }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: t.muted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Policy for this ad-hoc context
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setAdhocBlockPolicy({ policy_mode: 'inherit' })}
                            disabled={sending}
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              background: adhocBlockPolicy.policy_mode === 'inherit' ? 'rgba(139,92,246,0.2)' : 'transparent',
                              border: `1px solid ${adhocBlockPolicy.policy_mode === 'inherit' ? '#8b5cf6' : t.border}`,
                              borderRadius: '6px',
                              color: adhocBlockPolicy.policy_mode === 'inherit' ? (t.isStandard ? '#5b21b6' : '#c4b5fd') : t.muted,
                              cursor: sending ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Use default
                          </button>
                          <button
                            type="button"
                            onClick={() => setAdhocBlockPolicy({ policy_mode: 'override', policy: { ai_processing_mode: parsePolicyToMode(policySelections) } })}
                            disabled={sending}
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              background: adhocBlockPolicy.policy_mode === 'override' ? 'rgba(139,92,246,0.2)' : 'transparent',
                              border: `1px solid ${adhocBlockPolicy.policy_mode === 'override' ? '#8b5cf6' : t.border}`,
                              borderRadius: '6px',
                              color: adhocBlockPolicy.policy_mode === 'override' ? (t.isStandard ? '#5b21b6' : '#c4b5fd') : t.muted,
                              cursor: sending ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Override
                          </button>
                        </div>
                        {adhocBlockPolicy.policy_mode === 'override' && adhocBlockPolicy.policy && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {(['none', 'local_only', 'internal_and_cloud'] as const).map((m) => (
                              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: sending ? 'default' : 'pointer', color: t.text }}>
                                <input
                                  type="radio"
                                  name="adhoc-ai-policy"
                                  checked={(adhocBlockPolicy.policy.ai_processing_mode ?? 'local_only') === m}
                                  disabled={sending}
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

        {/* ---- No email account warning ---- */}
        {noEmailAccount && (
          <div
            style={{
              padding: '10px 13px',
              background: t.dangerBg,
              border: `1px solid ${t.dangerBorder}`,
              borderRadius: '8px',
              fontSize: '11px',
              color: t.dangerText,
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, fontSize: '13px' }}>⚠️</span>
            <span>No email account connected. Connect one in Settings to send via API.</span>
          </div>
        )}

        {/* ---- API sender note ---- */}
        {mode === 'api' && !noEmailAccount && (
          <div
            style={{
              padding: '9px 12px',
              background: t.noteBg,
              border: `1px solid ${t.noteBorder}`,
              borderRadius: '8px',
              fontSize: '11px',
              color: t.noteText,
              lineHeight: 1.45,
            }}
          >
            ℹ️ Sender must match your verified account email (or an approved alias).
          </div>
        )}

        {/* ---- Error banner ---- */}
        {error && !(includeVaultProfiles && error.toLowerCase().includes('vault')) && (
          <div
            style={{
              padding: '10px 13px',
              background: t.errorBg,
              border: `1px solid ${t.errorBorder}`,
              borderRadius: '8px',
              fontSize: '11px',
              color: t.errorText,
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, fontSize: '13px' }}>❌</span>
            <span>{error}</span>
          </div>
        )}

        {/* ---- Phase 3: Internal handshake relay outcome (inline) ---- */}
        {isInternalHandshake && internalRelayOutcome && (
          <div
            data-testid="internal-relay-outcome"
            style={{
              padding: '10px 13px',
              background:
                internalRelayOutcome.kind === 'coordination_unavailable'
                  ? t.dangerBg
                  : t.successBg,
              border: `1px solid ${
                internalRelayOutcome.kind === 'coordination_unavailable'
                  ? t.dangerBorder
                  : t.successBorder
              }`,
              borderRadius: '8px',
              fontSize: '11px',
              color:
                internalRelayOutcome.kind === 'coordination_unavailable'
                  ? t.dangerText
                  : t.successText,
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ flexShrink: 0, fontSize: '13px' }}>
              {internalRelayOutcome.kind === 'coordination_unavailable' ? '⚠️' : '✅'}
            </span>
            <span>
              {internalRelayOutcome.kind === 'pushed_live' &&
                'Sent. Open WR Desk on your other device and accept the handshake request.'}
              {internalRelayOutcome.kind === 'queued_recipient_offline' &&
                "Sent. Your other device is offline right now — it'll appear the moment that device comes online and opens WR Desk."}
              {internalRelayOutcome.kind === 'coordination_unavailable' &&
                internalRelayOutcome.message}
              {internalRelayOutcome.kind === 'skipped' &&
                'Handshake created locally. Coordination service is not configured on this device — use the download fallback to transfer the capsule manually.'}
            </span>
          </div>
        )}

        {/* ---- Actions ---- */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingTop: '2px',
          }}
        >
          {isInternalHandshake ? (
            <>
              <button
                onClick={handleSendViaApi}
                disabled={sending || resolvingPairingCode}
                data-testid="send-to-paired-device"
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: sending || resolvingPairingCode
                    ? 'rgba(139,92,246,0.5)'
                    : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  border: 'none',
                  borderRadius: '9px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: sending || resolvingPairingCode ? 'wait' : 'pointer',
                  opacity: sending || resolvingPairingCode ? 0.75 : 1,
                  transition: 'opacity 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                {resolvingPairingCode
                  ? '⏳ Resolving pairing code…'
                  : sending
                    ? '⏳ Sending…'
                    : '🔗 Send to paired device'}
              </button>
              <button
                type="button"
                onClick={handleDownloadCapsule}
                disabled={sending || resolvingPairingCode}
                data-testid="download-capsule-instead"
                style={{
                  width: '100%',
                  padding: '8px 16px',
                  background: 'transparent',
                  border:
                    internalRelayOutcome?.kind === 'coordination_unavailable'
                      ? `1.5px solid ${t.accentPrimary}`
                      : 'none',
                  borderRadius: '9px',
                  color: t.isStandard ? '#7c3aed' : '#c4b5fd',
                  fontSize: '12px',
                  fontWeight:
                    internalRelayOutcome?.kind === 'coordination_unavailable' ? 700 : 500,
                  textDecoration:
                    internalRelayOutcome?.kind === 'coordination_unavailable'
                      ? 'none'
                      : 'underline',
                  cursor: sending || resolvingPairingCode ? 'wait' : 'pointer',
                  opacity: sending || resolvingPairingCode ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {internalRelayOutcome?.kind === 'coordination_unavailable'
                  ? '💾 Download capsule (.beap)'
                  : 'Download capsule instead'}
              </button>
            </>
          ) : mode === 'api' ? (
            <button
              onClick={handleSendViaApi}
              disabled={sending || noEmailAccount}
              style={{
                width: '100%',
                padding: '10px 16px',
                background: sending
                  ? 'rgba(139,92,246,0.5)'
                  : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                border: 'none',
                borderRadius: '9px',
                color: 'white',
                fontSize: '13px',
                fontWeight: 600,
                cursor: sending ? 'wait' : 'pointer',
                opacity: sending ? 0.75 : 1,
                transition: 'opacity 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '7px',
              }}
            >
              {sending ? '⏳ Sending…' : '📧 Send via API'}
            </button>
          ) : (
            <>
              <button
                onClick={handleDownloadCapsule}
                disabled={sending}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: sending
                    ? 'rgba(139,92,246,0.5)'
                    : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  border: 'none',
                  borderRadius: '9px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: sending ? 'wait' : 'pointer',
                  opacity: sending ? 0.75 : 1,
                  transition: 'opacity 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                {sending ? '⏳ Building…' : '💾 Download capsule (.beap)'}
              </button>

              <button
                onClick={handleCopyEmailTemplate}
                disabled={sending}
                style={{
                  width: '100%',
                  padding: '9px 16px',
                  background: 'transparent',
                  border: `1.5px solid ${t.inputBorder}`,
                  borderRadius: '9px',
                  color: t.isStandard ? '#7c3aed' : '#c4b5fd',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: sending ? 'not-allowed' : 'pointer',
                  opacity: sending ? 0.6 : 1,
                  transition: 'opacity 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '7px',
                }}
              >
                {copySuccess ? '✓ Copied!' : '📋 Copy email template'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default SendHandshakeDelivery
