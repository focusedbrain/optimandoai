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
  const isProfessional = theme === 'professional'
  
  // Theming
  const bgColor = isProfessional ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)'
  
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
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: bgColor,
          borderRadius: '16px',
          width: '500px',
          maxHeight: '80vh',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: textColor }}>
              📧 Import from Email
            </div>
            <div style={{ fontSize: '12px', color: mutedColor, marginTop: '4px' }}>
              Select a provider and import BEAP messages
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: mutedColor,
              cursor: 'pointer',
              fontSize: '24px',
              padding: '0'
            }}
          >
            ×
          </button>
        </div>
        
        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', maxHeight: 'calc(80vh - 120px)' }}>
          {!availability.available ? (
            // No providers configured
            <div style={{
              textAlign: 'center',
              padding: '40px 20px'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                No Email Provider Connected
              </div>
              <div style={{ fontSize: '13px', color: mutedColor, marginBottom: '20px' }}>
                {availability.reason}
              </div>
              <button
                onClick={() => {
                  onClose()
                  onNavigateToWRGuard?.()
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Configure Email Providers →
              </button>
            </div>
          ) : (
            <>
              {/* Provider Selection */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                  Select Provider:
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {providers.map(provider => (
                    <button
                      key={provider.id}
                      onClick={() => setSelectedProviderId(provider.id)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: selectedProviderId === provider.id
                          ? '2px solid #a855f7'
                          : `1px solid ${borderColor}`,
                        background: selectedProviderId === provider.id
                          ? 'rgba(168,85,247,0.1)'
                          : cardBg,
                        color: textColor,
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <span>{provider.type === 'gmail' ? '📧' : provider.type === 'outlook' ? '📬' : '✉️'}</span>
                      <span>{provider.email}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Loading */}
              {loading && (
                <div style={{ textAlign: 'center', padding: '30px', color: mutedColor }}>
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>⏳</div>
                  Searching for BEAP messages...
                </div>
              )}
              
              {/* Error */}
              {error && (
                <div style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  color: '#ef4444',
                  fontSize: '13px',
                  marginBottom: '16px'
                }}>
                  {error}
                </div>
              )}
              
              {/* Success */}
              {success && (
                <div style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: 'rgba(34,197,94,0.1)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  color: '#22c55e',
                  fontSize: '13px',
                  marginBottom: '16px'
                }}>
                  ✓ {success}
                </div>
              )}
              
              {/* Candidates List */}
              {!loading && selectedProviderId && candidates.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {candidates.map(candidate => (
                    <div
                      key={candidate.emailId}
                      style={{
                        background: cardBg,
                        borderRadius: '10px',
                        padding: '14px',
                        border: `1px solid ${borderColor}`
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: textColor,
                            marginBottom: '4px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {candidate.subject}
                          </div>
                          <div style={{ fontSize: '12px', color: mutedColor }}>
                            From: {candidate.sender}
                          </div>
                          <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
                            {new Date(candidate.receivedAt).toLocaleString()}
                          </div>
                        </div>
                        <button
                          onClick={() => handleImport(candidate)}
                          disabled={importing === candidate.emailId}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: 'none',
                            background: importing === candidate.emailId
                              ? mutedColor
                              : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: importing === candidate.emailId ? 'wait' : 'pointer',
                            marginLeft: '12px'
                          }}
                        >
                          {importing === candidate.emailId ? 'Importing...' : 'Import'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* No candidates */}
              {!loading && selectedProviderId && candidates.length === 0 && (
                <div style={{ textAlign: 'center', padding: '30px', color: mutedColor }}>
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>📭</div>
                  No BEAP messages found in this mailbox.
                </div>
              )}
              
              {/* No provider selected */}
              {!loading && !selectedProviderId && (
                <div style={{ textAlign: 'center', padding: '30px', color: mutedColor }}>
                  <div style={{ fontSize: '24px', marginBottom: '10px' }}>👆</div>
                  Select a provider to view available messages.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

