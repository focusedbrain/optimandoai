/**
 * Import from File Modal
 * 
 * Modal for importing BEAP messages from file (USB/wallet/download).
 * 
 * @version 1.0.0
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { importFromFile } from '../importPipeline'
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

interface ImportFileModalProps {
  isOpen: boolean
  onClose: () => void
  theme: 'default' | 'dark' | 'professional'
}

// Accepted file types
const ACCEPTED_TYPES = '.beap,.json,.txt,.beap.json,.beap.txt'

export const ImportFileModal: React.FC<ImportFileModalProps> = ({
  isOpen,
  onClose,
  theme
}) => {
  const t = getThemeTokens(theme)
  
  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importPhase, setImportPhase] = useState<'importing' | 'verifying'>('importing')
  const [verifyingSlow, setVerifyingSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Show "this may take a moment" when verification runs >2s
  useEffect(() => {
    if (!importing || importPhase !== 'verifying') {
      setVerifyingSlow(false)
      return
    }
    const t = setTimeout(() => setVerifyingSlow(true), 2000)
    return () => clearTimeout(t)
  }, [importing, importPhase])
  
  // Handle file selection
  const handleFileSelect = useCallback((file: File | null) => {
    setSelectedFile(file)
    setError(null)
    setSuccess(false)
  }, [])
  
  // Handle file input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    handleFileSelect(file)
  }, [handleFileSelect])
  
  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }, [handleFileSelect])
  
  // Handle import
  const handleImport = useCallback(async () => {
    if (!selectedFile) {
      setError('Please select a file')
      return
    }
    
    setImporting(true)
    setError(null)
    setImportPhase('importing')
    setVerifyingSlow(false)
    
    try {
      const result = await importFromFile(selectedFile, {
        onProgress: (phase) => {
          setImportPhase(phase)
          if (phase !== 'verifying') setVerifyingSlow(false)
        },
      })
      
      if (result.success) {
        setSuccess(true)
        setSelectedFile(null)
        
        // Close after short delay (message is already verified and in inbox)
        setTimeout(() => {
          onClose()
          setSuccess(false)
        }, 1500)
      } else {
        const raw = result.error || 'Import failed'
        const isTechnical = /^(TypeError|ReferenceError|SyntaxError|undefined|null is not)/i.test(raw)
        setError(isTechnical ? 'Import failed. Please try again.' : raw)
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Import failed'
      const isTechnical = /^(TypeError|ReferenceError|SyntaxError|undefined|null is not)/i.test(raw)
      setError(isTechnical ? 'Import failed. Please try again.' : raw)
    } finally {
      setImporting(false)
    }
  }, [selectedFile, onClose])
  
  // Handle close
  const handleClose = useCallback(() => {
    setSelectedFile(null)
    setError(null)
    setSuccess(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onClose()
  }, [onClose])
  
  if (!isOpen) return null

  const isDisabled = !selectedFile || importing || success

  return (
    <div style={overlayStyle(t)} onClick={handleClose}>
      <div style={panelStyle(t)} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>💾</span>
            <div>
              <p style={headerMainTitleStyle()}>Import from File</p>
              <p style={headerSubtitleStyle()}>Import a BEAP™ package from USB, wallet, or download</p>
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
          <div style={{ maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />

            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${isDragOver ? t.accentColor : t.border}`,
                borderRadius: '14px',
                padding: '48px 24px',
                textAlign: 'center',
                background: isDragOver ? 'rgba(168,85,247,0.08)' : t.cardBg,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {selectedFile ? (
                <>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>📄</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: t.text, marginBottom: '4px' }}>{selectedFile.name}</div>
                  <div style={{ fontSize: '12px', color: t.textMuted }}>{(selectedFile.size / 1024).toFixed(1)} KB</div>
                  <div style={{ fontSize: '11px', color: t.accentColor, marginTop: '12px' }}>Click to change file</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '44px', marginBottom: '12px' }}>{isDragOver ? '📥' : '📁'}</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: t.text, marginBottom: '8px' }}>
                    {isDragOver ? 'Drop file here' : 'Drag & drop a BEAP file'}
                  </div>
                  <div style={{ fontSize: '12px', color: t.textMuted }}>or click to browse</div>
                  <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '10px', opacity: 0.7 }}>
                    Supports: .beap, .json, .txt
                  </div>
                </>
              )}
            </div>

            {error && <div style={notificationStyle('error')}>✕ {error}</div>}
            {success && <div style={{ ...notificationStyle('success'), textAlign: 'center' }}>✓ File imported and verified. Message is in your inbox.</div>}
            {importing && importPhase === 'verifying' && (
              <div style={{ fontSize: '11px', color: t.textMuted, textAlign: 'center' }}>
                {verifyingSlow ? '⏳ Decrypting and validating…' : '🔐 Verifying package…'}
              </div>
            )}

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
                {importing
                  ? (importPhase === 'verifying'
                      ? (verifyingSlow ? 'Verifying… (may take a moment)' : 'Verifying…')
                      : 'Importing…')
                  : success
                    ? 'Done!'
                    : 'Import'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

