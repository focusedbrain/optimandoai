/**
 * Archive Button Component
 * 
 * Button to archive a message with eligibility checking.
 * 
 * @version 1.0.0
 */

import React, { useState, useCallback } from 'react'
import { checkArchiveEligibility, archiveMessage } from '../archivalService'
import type { BeapMessageUI } from '../../beap-messages/types'

interface ArchiveButtonProps {
  message: BeapMessageUI
  theme: 'default' | 'dark' | 'professional'
  onArchived?: () => void
}

export const ArchiveButton: React.FC<ArchiveButtonProps> = ({
  message,
  theme,
  onArchived
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  
  const [isArchiving, setIsArchiving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Check eligibility
  const eligibility = checkArchiveEligibility(message)
  
  // Handle archive
  const handleArchive = useCallback(async () => {
    if (!eligibility.eligible || isArchiving) return
    
    setIsArchiving(true)
    setError(null)
    
    try {
      const result = await archiveMessage(message.id)
      
      if (result.success) {
        onArchived?.()
      } else {
        setError(result.error || 'Archive failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed')
    } finally {
      setIsArchiving(false)
    }
  }, [message.id, eligibility.eligible, isArchiving, onArchived])
  
  // Already archived
  if (message.folder === 'archived') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 14px',
        borderRadius: '6px',
        background: 'rgba(34,197,94,0.1)',
        color: '#22c55e',
        fontSize: '12px',
        fontWeight: 500
      }}>
        <span>📁</span>
        <span>Archived</span>
      </div>
    )
  }
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <button
        onClick={handleArchive}
        disabled={!eligibility.eligible || isArchiving}
        title={eligibility.reason}
        style={{
          padding: '8px 14px',
          borderRadius: '6px',
          border: `1px solid ${borderColor}`,
          background: !eligibility.eligible || isArchiving
            ? isProfessional ? 'rgba(100,116,139,0.1)' : 'rgba(255,255,255,0.05)'
            : isProfessional ? 'white' : 'rgba(255,255,255,0.1)',
          color: !eligibility.eligible || isArchiving ? mutedColor : textColor,
          fontSize: '12px',
          fontWeight: 500,
          cursor: !eligibility.eligible || isArchiving ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}
      >
        {isArchiving ? (
          <>
            <span>⏳</span>
            <span>Archiving...</span>
          </>
        ) : (
          <>
            <span>📁</span>
            <span>Archive</span>
          </>
        )}
      </button>
      
      {error && (
        <div style={{
          fontSize: '10px',
          color: '#ef4444'
        }}>
          {error}
        </div>
      )}
      
      {!eligibility.eligible && eligibility.reason && (
        <div style={{
          fontSize: '10px',
          color: mutedColor,
          fontStyle: 'italic'
        }}>
          {eligibility.reason}
        </div>
      )}
    </div>
  )
}

