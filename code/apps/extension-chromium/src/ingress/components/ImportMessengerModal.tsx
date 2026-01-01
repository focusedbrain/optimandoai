/**
 * Import from Messenger Modal
 * 
 * Modal for importing BEAP messages via paste from messenger apps.
 * 
 * @version 1.0.0
 */

import React, { useState, useCallback } from 'react'
import { importFromMessenger, validateImportPayload } from '../importPipeline'

interface ImportMessengerModalProps {
  isOpen: boolean
  onClose: () => void
  theme: 'default' | 'dark' | 'professional'
}

export const ImportMessengerModal: React.FC<ImportMessengerModalProps> = ({
  isOpen,
  onClose,
  theme
}) => {
  const isProfessional = theme === 'professional'
  
  // Theming
  const bgColor = isProfessional ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const inputBg = isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)'
  
  // State
  const [pastedText, setPastedText] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [validationHint, setValidationHint] = useState<string | null>(null)
  
  // Handle text change
  const handleTextChange = useCallback((text: string) => {
    setPastedText(text)
    setError(null)
    setSuccess(false)
    
    if (text.trim().length > 0) {
      const validation = validateImportPayload(text, 'messenger')
      if (validation.valid) {
        setValidationHint(`✓ Valid BEAP format detected (${validation.formatHint || 'unknown'})`)
      } else {
        setValidationHint(null)
      }
    } else {
      setValidationHint(null)
    }
  }, [])
  
  // Handle import
  const handleImport = useCallback(async () => {
    if (!pastedText.trim()) {
      setError('Please paste BEAP content')
      return
    }
    
    setImporting(true)
    setError(null)
    
    try {
      const result = await importFromMessenger(pastedText)
      
      if (result.success) {
        setSuccess(true)
        setPastedText('')
        setValidationHint(null)
        
        // Close after short delay
        setTimeout(() => {
          onClose()
          setSuccess(false)
        }, 1500)
      } else {
        setError(result.error || 'Import failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [pastedText, onClose])
  
  // Handle close
  const handleClose = useCallback(() => {
    setPastedText('')
    setError(null)
    setSuccess(false)
    setValidationHint(null)
    onClose()
  }, [onClose])
  
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
      onClick={handleClose}
    >
      <div
        style={{
          background: bgColor,
          borderRadius: '16px',
          width: '500px',
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
              💬 Import from Messenger
            </div>
            <div style={{ fontSize: '12px', color: mutedColor, marginTop: '4px' }}>
              Paste BEAP™ insert text from any messenger app
            </div>
          </div>
          <button
            onClick={handleClose}
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
        <div style={{ padding: '20px' }}>
          {/* Instructions */}
          <div style={{
            fontSize: '12px',
            color: mutedColor,
            marginBottom: '16px',
            padding: '12px',
            background: inputBg,
            borderRadius: '8px',
            lineHeight: 1.5
          }}>
            <strong>Instructions:</strong><br />
            1. Copy the BEAP™ insert text from your messenger (WhatsApp, Signal, Telegram, etc.)<br />
            2. Paste it in the box below<br />
            3. Click Import to add to your Inbox
          </div>
          
          {/* Paste Box */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
              Paste BEAP Insert Text:
            </div>
            <textarea
              value={pastedText}
              onChange={e => handleTextChange(e.target.value)}
              placeholder="📦 BEAP™ Package
---
[Paste your BEAP insert text here]
..."
              style={{
                width: '100%',
                height: '200px',
                padding: '14px',
                borderRadius: '10px',
                border: `1px solid ${borderColor}`,
                background: inputBg,
                color: textColor,
                fontSize: '13px',
                fontFamily: 'monospace',
                resize: 'none',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              disabled={importing || success}
            />
          </div>
          
          {/* Validation Hint */}
          {validationHint && (
            <div style={{
              fontSize: '12px',
              color: '#22c55e',
              marginBottom: '16px'
            }}>
              {validationHint}
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
              marginBottom: '16px',
              textAlign: 'center'
            }}>
              ✓ Message imported successfully! Redirecting...
            </div>
          )}
          
          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              onClick={handleClose}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: `1px solid ${borderColor}`,
                background: 'transparent',
                color: mutedColor,
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={!pastedText.trim() || importing || success}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                background: !pastedText.trim() || importing || success
                  ? mutedColor
                  : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: 'white',
                fontSize: '13px',
                fontWeight: 600,
                cursor: !pastedText.trim() || importing || success ? 'not-allowed' : 'pointer'
              }}
            >
              {importing ? 'Importing...' : success ? 'Done!' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

