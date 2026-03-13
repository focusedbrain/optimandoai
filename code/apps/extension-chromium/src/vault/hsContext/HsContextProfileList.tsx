/**
 * HsContextProfileList
 *
 * Lists HS Context Profiles for the current user.
 * Allows create, edit, duplicate, archive/delete.
 * Tier-gated: only rendered for Publisher/Enterprise users.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  listHsProfiles,
  archiveHsProfile,
  deleteHsProfile,
  duplicateHsProfile,
} from '../hsContextProfilesRpc'
import type { HsContextProfileSummary } from '../hsContextProfilesRpc'
import { HsContextProfileEditor } from './HsContextProfileEditor'

interface Props {
  theme?: 'dark' | 'standard'
  /** When 'create', opens directly in create mode (for "New HS Context" from WRVault lightbox). */
  initialView?: 'list' | 'create'
  /** When provided, shows a "← Back" button to return to vault dashboard (for full-container replace flows). */
  onBackToDashboard?: () => void
}

export const HsContextProfileList: React.FC<Props> = ({ theme = 'dark', initialView = 'list', onBackToDashboard }) => {
  const isDark = theme === 'dark'
  const textColor = isDark ? '#fff' : '#1f2937'
  const mutedColor = isDark ? 'rgba(255,255,255,0.55)' : '#6b7280'
  const borderColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(147,51,234,0.15)'
  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : 'white'
  const hoverBg = isDark ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.05)'

  const [profiles, setProfiles] = useState<HsContextProfileSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'create' | 'edit'>(initialView)
  const [editingId, setEditingId] = useState<string | undefined>()

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

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`Archive "${name}"? It will be hidden from the list.`)) return
    try {
      await archiveHsProfile(id)
      await loadProfiles()
    } catch (err: any) {
      alert('Failed to archive: ' + err?.message)
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Permanently delete "${name}" and all its documents?`)) return
    try {
      await deleteHsProfile(id)
      await loadProfiles()
    } catch (err: any) {
      alert('Failed to delete: ' + err?.message)
    }
  }

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateHsProfile(id)
      await loadProfiles()
    } catch (err: any) {
      alert('Failed to duplicate: ' + err?.message)
    }
  }

  const handleEditorSaved = async () => {
    setView('list')
    setEditingId(undefined)
    await loadProfiles()
  }

  if (view === 'create' || view === 'edit') {
    return (
      <HsContextProfileEditor
        profileId={editingId}
        onSaved={handleEditorSaved}
        onCancel={() => { setView('list'); setEditingId(undefined) }}
        theme={theme}
      />
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${borderColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
          {onBackToDashboard && (
            <button
              onClick={onBackToDashboard}
              style={{
                padding: '6px 12px',
                background: 'rgba(255,255,255,0.06)',
                border: `1px solid ${borderColor}`,
                borderRadius: '6px',
                color: mutedColor,
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              ← Back
            </button>
          )}
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: textColor }}>HS Context Profiles</div>
            <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
              Structured context attached to Handshake Requests
            </div>
          </div>
        </div>
        <button
          onClick={() => { setEditingId(undefined); setView('create') }}
          style={{
            padding: '7px 16px',
            background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
            border: 'none', borderRadius: '7px',
            color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          + New Profile
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {error && (
          <div style={{
            padding: '10px 12px', background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px',
            fontSize: '12px', color: '#ef4444',
          }}>
            {error}
          </div>
        )}

        {loading && (
          <div style={{ padding: '40px', textAlign: 'center', color: mutedColor, fontSize: '13px' }}>
            Loading profiles…
          </div>
        )}

        {!loading && profiles.length === 0 && (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            border: `1px dashed ${borderColor}`, borderRadius: '10px',
          }}>
            <div style={{ fontSize: '32px', marginBottom: '10px' }}>🗂</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginBottom: '6px' }}>
              No profiles yet
            </div>
            <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '16px' }}>
              Create a profile with your business identity, contacts, and documents to attach to handshakes.
            </div>
            <button
              onClick={() => setView('create')}
              style={{
                padding: '8px 20px',
                background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                border: 'none', borderRadius: '8px',
                color: 'white', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Create First Profile
            </button>
          </div>
        )}

        {profiles.map((profile) => (
          <div
            key={profile.id}
            style={{
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '10px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: textColor }}>
                    {profile.name}
                  </span>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 7px',
                    borderRadius: '99px',
                    background: profile.scope === 'confidential'
                      ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
                    color: profile.scope === 'confidential' ? '#dc2626' : '#16a34a',
                    border: `1px solid ${profile.scope === 'confidential' ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                  }}>
                    {profile.scope === 'confidential' ? 'Confidential' : 'Non-Confidential'}
                  </span>
                </div>
                {profile.description && (
                  <div style={{ fontSize: '11px', color: mutedColor, marginTop: '3px' }}>
                    {profile.description}
                  </div>
                )}
                <div style={{ fontSize: '10px', color: mutedColor, marginTop: '5px', display: 'flex', gap: '12px' }}>
                  <span>📄 {profile.document_count} doc{profile.document_count !== 1 ? 's' : ''}</span>
                  <span>Updated {new Date(profile.updated_at).toLocaleDateString()}</span>
                  {profile.tags.length > 0 && (
                    <span>🏷 {profile.tags.join(', ')}</span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button
                  onClick={() => { setEditingId(profile.id); setView('edit') }}
                  title="Edit"
                  style={{
                    fontSize: '11px', padding: '5px 10px',
                    background: 'rgba(139,92,246,0.12)',
                    border: '1px solid rgba(139,92,246,0.25)',
                    borderRadius: '6px', color: isDark ? '#c4b5fd' : '#7c3aed',
                    cursor: 'pointer',
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDuplicate(profile.id)}
                  title="Duplicate"
                  style={{
                    fontSize: '11px', padding: '5px 10px',
                    background: 'transparent',
                    border: `1px solid ${borderColor}`,
                    borderRadius: '6px', color: mutedColor,
                    cursor: 'pointer',
                  }}
                >
                  Copy
                </button>
                <button
                  onClick={() => handleArchive(profile.id, profile.name)}
                  title="Archive"
                  style={{
                    fontSize: '11px', padding: '5px 10px',
                    background: 'transparent',
                    border: `1px solid ${borderColor}`,
                    borderRadius: '6px', color: mutedColor,
                    cursor: 'pointer',
                  }}
                >
                  Archive
                </button>
                <button
                  onClick={() => handleDelete(profile.id, profile.name)}
                  title="Delete"
                  style={{
                    fontSize: '11px', padding: '5px 10px',
                    background: 'transparent',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '6px', color: '#ef4444',
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
