/**
 * HandshakeContextProfilePicker
 *
 * Multi-select panel for choosing HS Context Profiles to attach to a
 * handshake request. Only rendered for Publisher/Enterprise tiers.
 *
 * Phase 2: Per-item policy support. Each selected profile can inherit
 * the global default or override with its own policy.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { listHsProfiles } from '../../vault/hsContextProfilesRpc'
import type { HsContextProfileSummary } from '../../vault/hsContextProfilesRpc'
import type { ProfileContextItem, PolicySelection } from '../../../../packages/shared/src/handshake/types'

const DEFAULT_POLICY: PolicySelection = { ai_processing_mode: 'local_only' }

export interface HandshakeContextProfilePickerProps {
  /** Selected profile items with per-item policy (Phase 2). */
  selectedItems?: ProfileContextItem[]
  onChange?: (items: ProfileContextItem[]) => void
  /** Global default policy (used when policy_mode = inherit) */
  defaultPolicy?: PolicySelection
  /** Legacy: selected IDs only, all inherit default. Use selectedItems/onChange for per-item policy. */
  selectedIds?: string[]
  /** Legacy: callback with IDs. Use onChange with ProfileContextItem[] for per-item policy. */
  onChangeIds?: (ids: string[]) => void
  theme?: 'standard' | 'pro' | 'dark'
  disabled?: boolean
  /** When false, shows a vault-locked gate instead of the profile list and skips the fetch. */
  isVaultUnlocked?: boolean
}

export const HandshakeContextProfilePicker: React.FC<HandshakeContextProfilePickerProps> = ({
  selectedItems: selectedItemsProp,
  onChange: onChangeProp,
  defaultPolicy = DEFAULT_POLICY,
  selectedIds: selectedIdsLegacy,
  onChangeIds: onChangeIdsLegacy,
  theme = 'dark',
  disabled = false,
  isVaultUnlocked,
}) => {
  // Phase 2: selectedItems + onChange. Legacy: selectedIds + onChangeIds (all inherit)
  const selectedItems = selectedItemsProp ?? (selectedIdsLegacy?.map((id) => ({ profile_id: id, policy_mode: 'inherit' as const })) ?? [])
  const onChange = onChangeProp ?? (onChangeIdsLegacy ? (items: ProfileContextItem[]) => onChangeIdsLegacy(items.map((i) => i.profile_id)) : (() => {}))
  const isStandard = theme === 'standard'
  const textColor = isStandard ? '#1f2937' : 'white'
  const mutedColor = isStandard ? '#6b7280' : 'rgba(255,255,255,0.7)'
  const borderColor = isStandard ? 'rgba(147,51,234,0.15)' : 'rgba(255,255,255,0.15)'
  const cardBg = isStandard ? 'white' : 'rgba(255,255,255,0.05)'
  const selectedBg = isStandard ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)'
  const selectedBorder = 'rgba(139,92,246,0.5)'

  const [profiles, setProfiles] = useState<HsContextProfileSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listHsProfiles()
      setProfiles(result)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load profiles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isVaultUnlocked === false) return
    loadProfiles()
  }, [loadProfiles, isVaultUnlocked])

  const selectedIds = selectedItems.map((i) => i.profile_id)

  const toggleProfile = (id: string) => {
    if (disabled) return
    if (selectedIds.includes(id)) {
      onChange(selectedItems.filter((i) => i.profile_id !== id))
    } else {
      onChange([...selectedItems, { profile_id: id, policy_mode: 'inherit' }])
    }
  }

  const setItemPolicy = (profileId: string, policy_mode: 'inherit' | 'override', policy?: PolicySelection) => {
    onChange(selectedItems.map((i) =>
      i.profile_id === profileId
        ? { profile_id: profileId, policy_mode, policy }
        : i,
    ))
  }

  const selectedProfiles = profiles.filter((p) => selectedIds.includes(p.id))

  const pendingProfiles = selectedProfiles.filter((p) => (p.documents_pending ?? 0) > 0)
  const failedProfiles = selectedProfiles.filter((p) => (p.documents_failed ?? 0) > 0)
  const allReady = pendingProfiles.length === 0 && failedProfiles.length === 0

  if (isVaultUnlocked === false) {
    return (
      <div style={{ padding: '16px', textAlign: 'center' }}>
        <div style={{ fontSize: '20px', marginBottom: '8px' }}>🔒</div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
          Vault is locked
        </div>
        <div style={{ fontSize: '11px', color: mutedColor }}>
          Unlock your Vault to access Context Profiles and attach context data to this handshake.
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: '10px', textAlign: 'center', fontSize: '12px', color: mutedColor }}>
        Loading profiles…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '10px 12px', background: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px',
        fontSize: '12px', color: '#ef4444',
      }}>
        {error}
      </div>
    )
  }

  if (profiles.length === 0) {
    return (
      <div style={{
        padding: '12px 14px', textAlign: 'center', color: mutedColor, fontSize: '12px',
        border: `1px dashed ${borderColor}`, borderRadius: '8px',
      }}>
        No HS Context Profiles found. Create one in the Vault → HS Profiles tab.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '340px', overflowY: 'auto' }}>
        {profiles.map((profile) => {
          const isSelected = selectedIds.includes(profile.id)
          const item = selectedItems.find((i) => i.profile_id === profile.id)
          const policyMode = item?.policy_mode ?? 'inherit'
          const itemPolicy = item?.policy ?? defaultPolicy

          return (
            <div
              key={profile.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
                border: `1px solid ${isSelected ? selectedBorder : borderColor}`,
                borderRadius: '8px',
                overflow: 'hidden',
                background: isSelected ? selectedBg : cardBg,
              }}
            >
              <button
                type="button"
                onClick={() => toggleProfile(profile.id)}
                disabled={disabled}
                style={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  padding: '9px 12px', textAlign: 'left', width: '100%',
                  background: 'transparent',
                  border: 'none',
                  color: textColor, cursor: disabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600 }}>{profile.name}</span>
                    <span style={{
                      fontSize: '9px', fontWeight: 700, padding: '1px 6px',
                      borderRadius: '99px',
                      background: profile.scope === 'confidential'
                        ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                      color: profile.scope === 'confidential' ? '#dc2626' : '#16a34a',
                      border: `1px solid ${profile.scope === 'confidential' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                    }}>
                      {profile.scope === 'confidential' ? 'Confidential' : 'Non-Conf.'}
                    </span>
                    {profile.document_count > 0 && (
                      <span style={{ fontSize: '9px', color: mutedColor }}>
                        📄 {profile.document_count}
                      </span>
                    )}
                  </div>
                  {profile.description && (
                    <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {profile.description}
                    </div>
                  )}
                </div>
                <div style={{
                  width: '16px', height: '16px', borderRadius: '4px', flexShrink: 0, marginLeft: '8px', marginTop: '1px',
                  background: isSelected ? '#8b5cf6' : 'transparent',
                  border: `2px solid ${isSelected ? '#8b5cf6' : borderColor}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected && <span style={{ fontSize: '10px', color: 'white', lineHeight: 1 }}>✓</span>}
                </div>
              </button>

              {isSelected && (
                <div style={{ borderTop: `1px solid ${borderColor}`, padding: '8px 12px', background: isStandard ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.08)' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Policy for this item
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setItemPolicy(profile.id, 'inherit')}
                      disabled={disabled}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11px',
                        background: policyMode === 'inherit' ? 'rgba(139,92,246,0.2)' : 'transparent',
                        border: `1px solid ${policyMode === 'inherit' ? '#8b5cf6' : borderColor}`,
                        borderRadius: '6px',
                        color: policyMode === 'inherit' ? (isStandard ? '#5b21b6' : '#c4b5fd') : mutedColor,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Use default
                    </button>
                    <button
                      type="button"
                      onClick={() => setItemPolicy(profile.id, 'override', { ai_processing_mode: defaultPolicy.ai_processing_mode })}
                      disabled={disabled}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11px',
                        background: policyMode === 'override' ? 'rgba(139,92,246,0.2)' : 'transparent',
                        border: `1px solid ${policyMode === 'override' ? '#8b5cf6' : borderColor}`,
                        borderRadius: '6px',
                        color: policyMode === 'override' ? (isStandard ? '#5b21b6' : '#c4b5fd') : mutedColor,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Override
                    </button>
                  </div>
                  {policyMode === 'override' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {(['none', 'local_only', 'internal_and_cloud'] as const).map((m) => (
                        <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: disabled ? 'default' : 'pointer', color: textColor }}>
                          <input
                            type="radio"
                            name={`profile-policy-${profile.id}`}
                            checked={(itemPolicy.ai_processing_mode ?? 'local_only') === m}
                            disabled={disabled}
                            onChange={() => setItemPolicy(profile.id, 'override', { ai_processing_mode: m })}
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
          )
        })}
      </div>

      {selectedIds.length > 0 && (
        <div style={{
          padding: '8px 12px',
          background: isStandard ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.12)',
          border: `1px solid ${borderColor}`, borderRadius: '8px',
          fontSize: '11px', color: mutedColor,
          display: 'flex', flexDirection: 'column', gap: '4px',
        }}>
          <div style={{ fontWeight: 600, color: textColor }}>
            {selectedIds.length} profile{selectedIds.length > 1 ? 's' : ''} selected
          </div>
          <div>{selectedProfiles.map((p) => p.name).join(', ')}</div>
          {pendingProfiles.length > 0 && (
            <div style={{ color: '#d97706', marginTop: '4px', fontSize: '11px' }}>
              Document extraction in progress: {pendingProfiles.map((p) => `${p.name} has ${p.documents_pending} document(s) still processing`).join('; ')}. You can proceed — available text will be included, but pending documents will be excluded from the cryptographic proof chain.
            </div>
          )}
          {failedProfiles.length > 0 && (
            <div style={{ color: '#ef4444', marginTop: '4px', fontSize: '11px' }}>
              Document extraction failed: {failedProfiles.map((p) => {
                const names = (p.documents_failed_names ?? []).length > 0
                  ? ` (${(p.documents_failed_names ?? []).join(', ')})`
                  : ''
                return `${p.name} has ${p.documents_failed} document(s) that could not be processed${names}`
              }).join('; ')}. These documents will NOT be included in the handshake context.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
