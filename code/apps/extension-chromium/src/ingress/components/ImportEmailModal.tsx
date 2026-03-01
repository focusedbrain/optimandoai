/**
 * Import from Email Modal
 * 
 * Modal for importing BEAP messages from email providers.
 * Requires configured providers in WRGuard.
 * 
 * @version 1.0.0
 */

import React, { useState, useEffect, useCallback } from 'react'
import { useWRGuardStore } from '../../wrguard'
import {
  isEmailImportAvailable,
  getEmailCandidates,
  importFromEmail
} from '../importPipeline'
import type { EmailCandidate } from '../types'
import {
  getThemeTokens,
  overlayStyle,
  panelStyle,
  headerStyle,
  headerTitleStyle,
  headerMainTitleStyle,
  headerSubtitleStyle,
  closeButtonStyle,
  bodyStyle,
  cardStyle,
  primaryButtonStyle,
  notificationStyle,
} from '../../shared/ui/lightboxTheme'

interface ImportEmailModalProps {
  isOpen: boolean
  onClose: () => void
  theme: 'default' | 'dark' | 'professional'
  onNavigateToWRGuard?: () => void
}

export const ImportEmailModal: React.FC<ImportEmailModalProps> = ({
  isOpen,
  onClose,
  theme,
  onNavigateToWRGuard
}) => {
  const t = getThemeTokens(theme)
  
  // State
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<EmailCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Get connected providers
  const getConnectedProviders = useWRGuardStore(state => state.getConnectedProviders)
  const providers = getConnectedProviders()
  
  // Check availability
  const availability = isEmailImportAvailable()
  
  // Fetch candidates when provider selected
  useEffect(() => {
    if (selectedProviderId) {
      setLoading(true)
      setError(null)
      setCandidates([])
      
      getEmailCandidates(selectedProviderId)
        .then(setCandidates)
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    }
  }, [selectedProviderId])
  
  // Handle import
  const handleImport = useCallback(async (candidate: EmailCandidate) => {
    setImporting(candidate.emailId)
    setError(null)
    
    try {
      const result = await importFromEmail(
        candidate.emailId,
        candidate.providerId,
        candidate.sender,
        candidate.subject
      )
      
      if (result.success) {
        setSuccess(`Imported: ${candidate.subject}`)
        // Remove from list
        setCandidates(prev => prev.filter(c => c.emailId !== candidate.emailId))
        setTimeout(() => setSuccess(null), 3000)
      } else {
        setError(result.error || 'Import failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(null)
    }
  }, [])
  
  if (!isOpen) return null

  return (
    <div style={overlayStyle(t)} onClick={onClose}>
      <div style={panelStyle(t)} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>📧</span>
            <div>
              <p style={headerMainTitleStyle()}>Import from Email</p>
              <p style={headerSubtitleStyle()}>Select a provider and import BEAP messages</p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={closeButtonStyle(t)}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.closeHoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.closeBg; }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={bodyStyle(t)}>
          <div style={{ maxWidth: '660px', margin: '0 auto' }}>
            {!availability.available ? (
              <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                <div style={{ fontSize: '16px', fontWeight: 600, color: t.text, marginBottom: '8px' }}>
                  No Email Provider Connected
                </div>
                <div style={{ fontSize: '13px', color: t.textMuted, marginBottom: '24px' }}>
                  {availability.reason}
                </div>
                <button
                  onClick={() => { onClose(); onNavigateToWRGuard?.(); }}
                  style={primaryButtonStyle(t)}
                >
                  Configure Email Providers →
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Provider Selection */}
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: t.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Select Provider
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {providers.map(provider => (
                      <button
                        key={provider.id}
                        onClick={() => setSelectedProviderId(provider.id)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: '8px',
                          border: selectedProviderId === provider.id ? `2px solid ${t.accentColor}` : `1px solid ${t.border}`,
                          background: selectedProviderId === provider.id ? 'rgba(168,85,247,0.12)' : t.cardBg,
                          color: t.text,
                          fontSize: '13px',
                          fontWeight: 500,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.15s',
                        }}
                      >
                        <span>{provider.type === 'gmail' ? '📧' : provider.type === 'outlook' ? '📬' : '✉️'}</span>
                        <span>{provider.email}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {loading && (
                  <div style={{ textAlign: 'center', padding: '30px', color: t.textMuted }}>
                    <div style={{ fontSize: '24px', marginBottom: '10px' }}>⏳</div>
                    Searching for BEAP messages...
                  </div>
                )}

                {error && <div style={notificationStyle('error')}>✕ {error}</div>}
                {success && <div style={notificationStyle('success')}>✓ {success}</div>}

                {!loading && selectedProviderId && candidates.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {candidates.map(candidate => (
                      <div key={candidate.emailId} style={cardStyle(t)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: t.text, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {candidate.subject}
                            </div>
                            <div style={{ fontSize: '12px', color: t.textMuted }}>From: {candidate.sender}</div>
                            <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px' }}>
                              {new Date(candidate.receivedAt).toLocaleString()}
                            </div>
                          </div>
                          <button
                            onClick={() => handleImport(candidate)}
                            disabled={importing === candidate.emailId}
                            style={{
                              padding: '7px 14px',
                              borderRadius: '7px',
                              border: 'none',
                              background: importing === candidate.emailId ? t.cardBg : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                              color: importing === candidate.emailId ? t.textMuted : 'white',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: importing === candidate.emailId ? 'wait' : 'pointer',
                              flexShrink: 0,
                              transition: 'all 0.15s',
                            }}
                          >
                            {importing === candidate.emailId ? 'Importing...' : 'Import'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!loading && selectedProviderId && candidates.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '30px', color: t.textMuted }}>
                    <div style={{ fontSize: '28px', marginBottom: '10px' }}>📭</div>
                    No BEAP messages found in this mailbox.
                  </div>
                )}

                {!loading && !selectedProviderId && (
                  <div style={{ textAlign: 'center', padding: '30px', color: t.textMuted }}>
                    <div style={{ fontSize: '28px', marginBottom: '10px' }}>👆</div>
                    Select a provider to view available messages.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

