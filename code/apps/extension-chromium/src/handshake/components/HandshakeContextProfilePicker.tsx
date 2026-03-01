/**
 * HandshakeContextProfilePicker
 *
 * Multi-select panel for choosing HS Context Profiles to attach to a
 * handshake request. Only rendered for Publisher/Enterprise tiers.
 *
 * Features:
 *  - Loads profiles via vault.hsProfiles.list RPC
 *  - Shows scope badge, document count, extraction status warnings
 *  - Returns selected profile IDs to parent
 *  - Shows a plain-text preview snippet of selected profiles (first 400 chars)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { listHsProfiles } from '../../vault/hsContextProfilesRpc'
import type { HsContextProfileSummary } from '../../vault/hsContextProfilesRpc'

export interface HandshakeContextProfilePickerProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  theme?: 'standard' | 'pro' | 'dark'
  disabled?: boolean
}

export const HandshakeContextProfilePicker: React.FC<HandshakeContextProfilePickerProps> = ({
  selectedIds,
  onChange,
  theme = 'dark',
  disabled = false,
}) => {
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

  useEffect(() => { loadProfiles() }, [loadProfiles])

  const toggleProfile = (id: string) => {
    if (disabled) return
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const selectedProfiles = profiles.filter((p) => selectedIds.includes(p.id))

  const hasPendingDocs = selectedProfiles.some((p) => {
    // We don't have document details here, just the count — warn if count > 0
    // Full pending/failed state is checked server-side; show a general note if
    // any documents exist so the user knows extraction may be pending.
    return p.document_count > 0
  })

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
      {/* Profile selection list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto' }}>
        {profiles.map((profile) => {
          const isSelected = selectedIds.includes(profile.id)
          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => toggleProfile(profile.id)}
              disabled={disabled}
              style={{
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                padding: '9px 12px', textAlign: 'left', width: '100%',
                background: isSelected ? selectedBg : cardBg,
                border: `1px solid ${isSelected ? selectedBorder : borderColor}`,
                borderRadius: '8px',
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
          )
        })}
      </div>

      {/* Selection summary */}
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
          {hasPendingDocs && (
            <div style={{ color: '#d97706', marginTop: '2px' }}>
              ⚠️ Some profiles have documents — text extraction may still be in progress. Available text will be included.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
