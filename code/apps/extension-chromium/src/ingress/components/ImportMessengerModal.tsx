/**
 * Import from Messenger Modal
 * 
 * Modal for importing BEAP messages via paste from messenger apps.
 * 
 * @version 1.0.0
 */

import React, { useState, useCallback } from 'react'
import { importFromMessenger, validateImportPayload } from '../importPipeline'
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
  secondaryButtonStyle,
  notificationStyle,
} from '../../shared/ui/lightboxTheme'

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
  const t = getThemeTokens(theme)
  
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

  const isDisabled = !pastedText.trim() || importing || success

  return (
    <div style={overlayStyle(t)} onClick={handleClose}>
      <div style={panelStyle(t)} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>💬</span>
            <div>
              <p style={headerMainTitleStyle()}>Import from Messenger</p>
              <p style={headerSubtitleStyle()}>Paste BEAP™ insert text from any messenger app</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={closeButtonStyle(t)}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.closeHoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.closeBg; }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={bodyStyle(t)}>
          <div style={{ maxWidth: '680px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{
              padding: '12px 14px',
              background: t.cardBg,
              border: `1px solid ${t.border}`,
              borderRadius: '8px',
              fontSize: '12px',
              color: t.textMuted,
              lineHeight: 1.6,
            }}>
              <strong style={{ color: t.text }}>Instructions:</strong><br />
              1. Copy the BEAP™ insert text from your messenger (WhatsApp, Signal, Telegram, etc.)<br />
              2. Paste it in the box below<br />
              3. Click Import to add to your Inbox
            </div>

            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: t.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Paste BEAP Insert Text
              </div>
              <textarea
                value={pastedText}
                onChange={e => handleTextChange(e.target.value)}
                placeholder="📦 BEAP™ Package&#10;---&#10;[Paste your BEAP insert text here]&#10;..."
                style={{
                  width: '100%',
                  height: '220px',
                  padding: '14px',
                  borderRadius: '10px',
                  border: `1px solid ${t.inputBorder}`,
                  background: t.inputBg,
                  color: t.text,
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                disabled={importing || success}
              />
            </div>

            {validationHint && (
              <div style={{ fontSize: '12px', color: t.success }}>{validationHint}</div>
            )}
            {error && <div style={notificationStyle('error')}>✕ {error}</div>}
            {success && <div style={{ ...notificationStyle('success'), textAlign: 'center' }}>✓ Message imported successfully! Redirecting...</div>}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={handleClose} style={secondaryButtonStyle(t)}>Cancel</button>
              <button
                onClick={handleImport}
                disabled={isDisabled}
                style={{
                  padding: '11px 22px',
                  borderRadius: '9px',
                  border: 'none',
                  background: isDisabled ? t.cardBg : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  color: isDisabled ? t.textMuted : 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  boxShadow: isDisabled ? 'none' : '0 4px 14px rgba(34,197,94,0.3)',
                  transition: 'all 0.18s',
                }}
              >
                {importing ? 'Importing...' : success ? 'Done!' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

