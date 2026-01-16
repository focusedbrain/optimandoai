/**
 * Import from File Modal
 * 
 * Modal for importing BEAP messages from file (USB/wallet/download).
 * 
 * @version 1.0.0
 */

import React, { useState, useCallback, useRef } from 'react'
import { importFromFile } from '../importPipeline'

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
  const isProfessional = theme === 'professional'
  
  // Theming
  const bgColor = isProfessional ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const dropZoneBg = isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)'
  
  // State
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  
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
    
    try {
      const result = await importFromFile(selectedFile)
      
      if (result.success) {
        setSuccess(true)
        setSelectedFile(null)
        
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
          width: '460px',
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
              💾 Import from File
            </div>
            <div style={{ fontSize: '12px', color: mutedColor, marginTop: '4px' }}>
              Import a BEAP™ package from USB, wallet, or download
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
          {/* Hidden file input */}
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
              border: `2px dashed ${isDragOver ? '#a855f7' : borderColor}`,
              borderRadius: '12px',
              padding: '40px 20px',
              textAlign: 'center',
              background: isDragOver ? 'rgba(168,85,247,0.05)' : dropZoneBg,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              marginBottom: '16px'
            }}
          >
            {selectedFile ? (
              <>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>📄</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '4px' }}>
                  {selectedFile.name}
                </div>
                <div style={{ fontSize: '12px', color: mutedColor }}>
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </div>
                <div style={{
                  fontSize: '11px',
                  color: '#a855f7',
                  marginTop: '12px'
                }}>
                  Click to change file
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '40px', marginBottom: '12px' }}>
                  {isDragOver ? '📥' : '📁'}
                </div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                  {isDragOver ? 'Drop file here' : 'Drag & drop a BEAP file'}
                </div>
                <div style={{ fontSize: '12px', color: mutedColor }}>
                  or click to browse
                </div>
                <div style={{
                  fontSize: '11px',
                  color: mutedColor,
                  marginTop: '12px',
                  opacity: 0.7
                }}>
                  Supports: .beap, .json, .txt
                </div>
              </>
            )}
          </div>
          
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
              ✓ File imported successfully! Redirecting...
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
              disabled={!selectedFile || importing || success}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                background: !selectedFile || importing || success
                  ? mutedColor
                  : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: 'white',
                fontSize: '13px',
                fontWeight: 600,
                cursor: !selectedFile || importing || success ? 'not-allowed' : 'pointer'
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

