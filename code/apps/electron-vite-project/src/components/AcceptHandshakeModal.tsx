/**
 * AcceptHandshakeModal — Context Graph for handshake acceptance
 *
 * Mirrors the sender-side Context Graph: Vault Profiles + Ad-hoc tabs.
 * Receiver can attach context before accepting. Only hashes/commitments
 * travel in the handshake capsule; raw data syncs via first BEAP-Capsule.
 *
 * Vault gate: Accept is blocked until vault is unlocked. Policy checkboxes
 * are always interactive (no vault needed).
 */

import { useState, useEffect } from 'react'
import { HandshakeContextProfilePicker } from '@ext/handshake/components/HandshakeContextProfilePicker'
import { acceptHandshake } from '@ext/handshake/handshakeRpc'
import { computeBlockHashClient } from '../utils/contextBlockHash'
import VaultStatusIndicator from './VaultStatusIndicator'
import PolicyRadioGroup, { DEFAULT_AI_POLICY, type PolicySelection } from './PolicyRadioGroup'
import type { ProfileContextItem, ContextBlockWithPolicy } from '../../../../packages/shared/src/handshake/types'

interface HandshakeRecord {
  handshake_id: string
  state: string
  initiator: { email: string; wrdesk_user_id: string } | null
  acceptor: { email: string; wrdesk_user_id: string } | null
  local_role: 'initiator' | 'acceptor'
}

interface Props {
  record: HandshakeRecord
  onClose: () => void
  onSuccess: () => void
  canUseHsContextProfiles?: boolean
}

function generateBlockId(): string {
  return `blk_${crypto.randomUUID().slice(0, 12)}`
}

export default function AcceptHandshakeModal({
  record,
  onClose,
  onSuccess,
  canUseHsContextProfiles = false,
}: Props) {
  const [showContextGraph, setShowContextGraph] = useState(false)
  const [contextGraphTab, setContextGraphTab] = useState<'vault' | 'adhoc'>('vault')
  const [contextGraphText, setContextGraphText] = useState('')
  const [contextGraphType, setContextGraphType] = useState<'text' | 'json'>('text')
  const [selectedProfileItems, setSelectedProfileItems] = useState<ProfileContextItem[]>([])
  const [adhocBlockPolicy, setAdhocBlockPolicy] = useState<{ policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' } }>({ policy_mode: 'inherit' })
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(false)
  const [vaultName, setVaultName] = useState<string | null>(null)
  const [vaultWarning, setVaultWarning] = useState(false)
  const [policies, setPolicies] = useState<PolicySelection>(DEFAULT_AI_POLICY)

  const counterpartyEmail = record.initiator?.email ?? '(unknown)'

  useEffect(() => {
    const checkVault = async () => {
      try {
        const status = await window.handshakeView?.getVaultStatus?.()
        setIsVaultUnlocked(status?.isUnlocked ?? false)
        setVaultName(status?.name ?? null)
      } catch {
        setIsVaultUnlocked(false)
        setVaultName(null)
      }
    }
    checkVault()
    const handler = () => checkVault()
    window.addEventListener('vault-status-changed', handler)
    return () => window.removeEventListener('vault-status-changed', handler)
  }, [])

  // Rehydration: restore draft from localStorage when modal opens
  useEffect(() => {
    try {
      const key = `handshake-accept-draft-${record.handshake_id}`
      const raw = localStorage.getItem(key)
      if (raw) {
        const draft = JSON.parse(raw) as {
          selectedProfileItems?: ProfileContextItem[]
          contextGraphText?: string
          contextGraphType?: 'text' | 'json'
          adhocBlockPolicy?: { policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' } }
        }
        if (draft.selectedProfileItems?.length) setSelectedProfileItems(draft.selectedProfileItems)
        if (draft.contextGraphText != null) setContextGraphText(draft.contextGraphText)
        if (draft.contextGraphType) setContextGraphType(draft.contextGraphType)
        if (draft.adhocBlockPolicy) setAdhocBlockPolicy(draft.adhocBlockPolicy)
      }
    } catch {
      /* ignore */
    }
  }, [record.handshake_id])

  // Persist draft to localStorage when context changes
  useEffect(() => {
    try {
      const key = `handshake-accept-draft-${record.handshake_id}`
      const draft = {
        selectedProfileItems,
        contextGraphText,
        contextGraphType,
        adhocBlockPolicy,
      }
      localStorage.setItem(key, JSON.stringify(draft))
    } catch {
      /* ignore */
    }
  }, [record.handshake_id, selectedProfileItems, contextGraphText, contextGraphType, adhocBlockPolicy])

  const buildContextBlocks = async (): Promise<ContextBlockWithPolicy[]> => {
    const blocks: ContextBlockWithPolicy[] = []

    // Ad-hoc: normalize text/JSON to content, compute hash, include per-item policy
    const text = contextGraphText.trim()
    if (text) {
      let content: string | Record<string, unknown>
      if (contextGraphType === 'json') {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>
          content = parsed
        } catch {
          content = text
        }
      } else {
        content = text
      }
      const blockHash = await computeBlockHashClient(content)
      blocks.push({
        block_id: generateBlockId(),
        block_hash: blockHash,
        type: 'plaintext',
        content,
        scope_id: 'acceptor',
        policy_mode: adhocBlockPolicy.policy_mode,
        policy: adhocBlockPolicy.policy,
      })
    }

    return blocks
  }

  const handleAccept = async () => {
    setError(null)
    if (!isVaultUnlocked) {
      setVaultWarning(true)
      return
    }
    setAccepting(true)
    try {
      const context_blocks = await buildContextBlocks()
      const contextOpts: {
        context_blocks?: ContextBlockWithPolicy[]
        profile_ids?: string[]
        profile_items?: ProfileContextItem[]
        policy_selections?: { ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' }
      } = {
        policy_selections: policies,
      }
      if (context_blocks.length > 0) contextOpts.context_blocks = context_blocks
      if (selectedProfileItems.length > 0) {
        contextOpts.profile_ids = selectedProfileItems.map((i) => i.profile_id)
        contextOpts.profile_items = selectedProfileItems
      }

      const result = await acceptHandshake(
        record.handshake_id,
        'reciprocal',
        '',
        contextOpts,
      )

      if (result?.success !== false) {
        try {
          localStorage.removeItem(`handshake-accept-draft-${record.handshake_id}`)
        } catch {
          /* ignore */
        }
        onSuccess()
        onClose()
      } else {
        const reason = (result as any)?.reason
        const msg = (result as any)?.error ?? (result as any)?.local_result?.error ?? 'Accept failed.'
        setError(reason === 'VAULT_LOCKED' ? 'Please unlock your vault to accept. Use the Vault section to unlock, then try again.' : msg)
      }
    } catch (err: any) {
      setError(err?.message ?? 'Accept failed.')
    } finally {
      setAccepting(false)
    }
  }

  const borderColor = 'rgba(147,51,234,0.14)'
  const mutedColor = '#6b7280'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 60px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${borderColor}` }}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
            Handshake Response
          </div>
          <div style={{ fontSize: '12px', color: mutedColor }}>
            From {counterpartyEmail}
          </div>
        </div>

        <div style={{ margin: '0 16px 12px' }}>
          <VaultStatusIndicator
            vaultName={vaultName}
            isUnlocked={isVaultUnlocked}
            warningEscalated={vaultWarning}
          />
        </div>

        <div style={{ margin: '0 16px 12px' }}>
          <PolicyRadioGroup value={policies} onChange={setPolicies} readOnly={false} variant="light" />
        </div>

        {/* Context Graph — same pattern as SendHandshakeDelivery */}
        <div
          style={{
            margin: '12px 16px',
            border: `1px solid ${showContextGraph ? 'rgba(139,92,246,0.28)' : borderColor}`,
            borderRadius: '10px',
            overflow: 'hidden',
            transition: 'border-color 0.15s',
          }}
        >
          <button
            type="button"
            onClick={() => setShowContextGraph((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: showContextGraph ? 'rgba(139,92,246,0.08)' : 'rgba(0,0,0,0.02)',
              border: 'none',
              color: showContextGraph ? '#7c3aed' : mutedColor,
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span>🧠 Add a Context Graph</span>
            <span style={{ fontSize: '10px', opacity: 0.7 }}>
              {showContextGraph ? '▲ Collapse' : '▼ Expand'}
            </span>
          </button>

          {showContextGraph && (
            <div style={{ borderTop: `1px solid ${borderColor}` }}>
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
                        background: active ? 'rgba(139,92,246,0.08)' : 'transparent',
                        border: 'none',
                        borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
                        color: active ? '#7c3aed' : mutedColor,
                        cursor: 'pointer',
                      }}
                    >
                      {tab === 'vault' ? '🗂 Vault Profiles' : '✏️ Ad-hoc Context'}
                    </button>
                  )
                })}
              </div>

              {contextGraphTab === 'vault' && (
                <div style={{ padding: '12px 14px' }}>
                  <div
                    style={{
                      padding: '9px 12px',
                      background: 'rgba(139,92,246,0.08)',
                      borderRadius: '8px',
                      fontSize: '11px',
                      color: mutedColor,
                      lineHeight: 1.5,
                      marginBottom: '10px',
                    }}
                  >
                    Attach your own context profiles to share with the initiator. The initiator's context (if any) will sync automatically once you accept.
                  </div>
                  {canUseHsContextProfiles ? (
                    <HandshakeContextProfilePicker
                      selectedItems={selectedProfileItems}
                      onChange={setSelectedProfileItems}
                      defaultPolicy={policies}
                      theme="standard"
                      disabled={accepting}
                      isVaultUnlocked={isVaultUnlocked}
                    />
                  ) : (
                    <div
                      style={{
                        padding: '16px',
                        textAlign: 'center',
                        border: `1px dashed ${borderColor}`,
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      <div style={{ fontSize: '20px' }}>🔒</div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
                        Publisher / Enterprise feature
                      </div>
                      <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.5 }}>
                        Upgrade to attach Vault Profiles when accepting handshakes.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {contextGraphTab === 'adhoc' && (
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div
                    style={{
                      padding: '9px 12px',
                      background: 'rgba(59,130,246,0.06)',
                      border: '1px solid rgba(59,130,246,0.2)',
                      borderRadius: '8px',
                      fontSize: '11px',
                      color: mutedColor,
                      lineHeight: 1.5,
                    }}
                  >
                    ℹ️ Ad-hoc context is normalized to plain text. JSON is rendered as Key: Value lines.
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        marginBottom: '5px',
                        display: 'block',
                        color: mutedColor,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Format
                    </label>
                    <select
                      value={contextGraphType}
                      onChange={(e) => setContextGraphType(e.target.value as 'text' | 'json')}
                      disabled={accepting}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        background: 'white',
                        border: `1px solid ${borderColor}`,
                        borderRadius: '8px',
                        fontSize: '13px',
                      }}
                    >
                      <option value="text">📝 Plain Text</option>
                      <option value="json">📦 JSON / Structured Data</option>
                    </select>
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        marginBottom: '5px',
                        display: 'block',
                        color: mutedColor,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {contextGraphType === 'json' ? 'JSON Payload' : 'Context Content'}
                    </label>
                    <textarea
                      value={contextGraphText}
                      onChange={(e) => setContextGraphText(e.target.value)}
                      disabled={accepting}
                      placeholder={
                        contextGraphType === 'json'
                          ? '{"key": "value", ...}'
                          : 'Enter context to share with the initiator...'
                      }
                      rows={4}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        background: 'white',
                        border: `1px solid ${borderColor}`,
                        borderRadius: '8px',
                        fontSize: '13px',
                        resize: 'vertical',
                        lineHeight: 1.5,
                        fontFamily: contextGraphType === 'json' ? 'monospace' : 'inherit',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  {contextGraphText.trim() && (
                    <div style={{ padding: '8px 12px', background: 'rgba(139,92,246,0.06)', borderRadius: '8px', border: `1px solid ${borderColor}` }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Policy for this ad-hoc context
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setAdhocBlockPolicy({ policy_mode: 'inherit' })}
                          disabled={accepting}
                          style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            background: adhocBlockPolicy.policy_mode === 'inherit' ? 'rgba(139,92,246,0.2)' : 'transparent',
                            border: `1px solid ${adhocBlockPolicy.policy_mode === 'inherit' ? '#8b5cf6' : borderColor}`,
                            borderRadius: '6px',
                            color: adhocBlockPolicy.policy_mode === 'inherit' ? '#5b21b6' : mutedColor,
                            cursor: accepting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Use default
                        </button>
                        <button
                          type="button"
                            onClick={() => setAdhocBlockPolicy({ policy_mode: 'override', policy: { ai_processing_mode: policies.ai_processing_mode } })}
                          disabled={accepting}
                          style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            background: adhocBlockPolicy.policy_mode === 'override' ? 'rgba(139,92,246,0.2)' : 'transparent',
                            border: `1px solid ${adhocBlockPolicy.policy_mode === 'override' ? '#8b5cf6' : borderColor}`,
                            borderRadius: '6px',
                            color: adhocBlockPolicy.policy_mode === 'override' ? '#5b21b6' : mutedColor,
                            cursor: accepting ? 'not-allowed' : 'pointer',
                          }}
                        >
                          Override
                        </button>
                      </div>
                      {adhocBlockPolicy.policy_mode === 'override' && adhocBlockPolicy.policy && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(['none', 'local_only', 'internal_and_cloud'] as const).map((m) => (
                            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: accepting ? 'default' : 'pointer', color: '#374151' }}>
                              <input
                                type="radio"
                                name="adhoc-ai-policy-accept"
                                checked={(adhocBlockPolicy.policy.ai_processing_mode ?? 'local_only') === m}
                                disabled={accepting}
                                onChange={() => setAdhocBlockPolicy({ ...adhocBlockPolicy, policy: { ai_processing_mode: m } })}
                                style={{ accentColor: '#8b5cf6' }}
                              />
                              <span>{m === 'none' ? 'No AI processing' : m === 'local_only' ? 'Internal AI only' : 'Allow Internal + Cloud AI'}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              margin: '0 16px 12px',
              padding: '10px 13px',
              background: 'rgba(239,68,68,0.10)',
              border: '1px solid rgba(239,68,68,0.30)',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#ef4444',
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            padding: '16px 20px',
            borderTop: `1px solid ${borderColor}`,
            display: 'flex',
            gap: '10px',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '9px 18px',
              background: 'rgba(0,0,0,0.04)',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              color: '#374151',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleAccept}
            disabled={accepting || !isVaultUnlocked}
            title={!isVaultUnlocked ? 'Unlock your Vault to accept' : undefined}
            style={{
              padding: '9px 18px',
              background: accepting || !isVaultUnlocked ? 'rgba(34,197,94,0.4)' : 'rgba(34,197,94,0.9)',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontSize: '12px',
              fontWeight: 600,
              cursor: accepting || !isVaultUnlocked ? 'not-allowed' : 'pointer',
            }}
          >
            {accepting ? 'Accepting…' : !isVaultUnlocked ? '🔒 Unlock Vault to Accept' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}
