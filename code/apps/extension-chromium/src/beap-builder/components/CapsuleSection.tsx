/**
 * CapsuleSection Component
 * 
 * Editable section for constructing the BEAP capsule.
 * Includes message text, attachments, sessions, and data requests.
 * 
 * CRITICAL INVARIANTS:
 * - Attachments are parsed to semantic content only (originals encrypted)
 * - Session selection requires envelope capability
 * - All edits are within envelope-declared bounds
 * - Extracted text is CAPSULE-BOUND ONLY (never in transport)
 * 
 * @version 1.1.0
 */

import React, { useRef, useState, useCallback, useEffect } from 'react'
import type { CapsuleState, CapsuleAttachment, CapsuleSessionRef, CapabilityClass } from '../canonical-types'
import { processAttachmentForParsing, isParseableFormat } from '../parserService'
import { VisionFallbackButton } from './VisionFallbackButton'
import { AttachmentStatusBadge } from './AttachmentStatusBadge'

interface CapsuleSectionProps {
  capsule: CapsuleState
  availableSessions: CapsuleSessionRef[]
  onTextChange: (text: string) => void
  onAddAttachment: (attachment: CapsuleAttachment) => void
  onRemoveAttachment: (id: string) => void
  onUpdateAttachment?: (attachmentId: string, updates: Partial<CapsuleAttachment>) => void
  onSelectSession: (session: CapsuleSessionRef) => void
  onDeselectSession: (sessionId: string) => void
  onDataRequestChange: (request: string) => void
  hasCapability: (cap: CapabilityClass) => boolean
  theme: 'default' | 'dark' | 'professional'
}

export const CapsuleSection: React.FC<CapsuleSectionProps> = ({
  capsule,
  availableSessions,
  onTextChange,
  onAddAttachment,
  onRemoveAttachment,
  onUpdateAttachment,
  onSelectSession,
  onDeselectSession,
  onDataRequestChange,
  hasCapability,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  const inputBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)'
  const inputBorder = isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.15)'
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Store base64 per attachment for Vision AI fallback when parsing fails
  const attachmentDataMap = useRef<Map<string, string>>(new Map())
  
  // Track parsing status per attachment
  const [parsingAttachments, setParsingAttachments] = useState<Set<string>>(new Set())
  const [parseErrors, setParseErrors] = useState<Record<string, string>>({})
  /** Bumps when `attachmentDataMap` gains entries so Vision/Parse buttons re-render. */
  const [, setAttachmentDataEpoch] = useState(0)
  
  // Read file as base64
  const readFileAsBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Remove data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = result.split(',')[1] || result
        resolve(base64)
      }
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsDataURL(file)
    })
  }, [])
  
  /** Load base64 after attach (no parsing) — user clicks Parse when ready. */
  const cacheBase64ForAttachment = useCallback(
    async (attachmentId: string, file: File) => {
      if (!isParseableFormat(file.type)) return
      try {
        const base64Data = await readFileAsBase64(file)
        attachmentDataMap.current.set(attachmentId, base64Data)
        setAttachmentDataEpoch((n) => n + 1)
      } catch {
        setParseErrors((prev) => ({ ...prev, [attachmentId]: 'Failed to read file' }))
      }
    },
    [readFileAsBase64],
  )

  /** Manual Parse — same pipeline as WR Chat draft. */
  const parseAttachmentById = useCallback(
    async (attachment: CapsuleAttachment) => {
      if (!isParseableFormat(attachment.originalType)) return
      const base64Data = attachmentDataMap.current.get(attachment.id)
      if (!base64Data) {
        setParseErrors((prev) => ({
          ...prev,
          [attachment.id]: 'File data not ready — remove and re-attach, then click Parse.',
        }))
        return
      }

      setParsingAttachments((prev) => new Set(prev).add(attachment.id))
      setParseErrors((prev) => {
        const next = { ...prev }
        delete next[attachment.id]
        return next
      })

      try {
        const result = await processAttachmentForParsing(attachment, base64Data)
        if (result.error) {
          setParseErrors((prev) => ({ ...prev, [attachment.id]: result.error! }))
        }
        if (onUpdateAttachment) {
          onUpdateAttachment(attachment.id, {
            semanticContent: result.attachment.semanticContent,
            semanticExtracted: result.attachment.semanticExtracted,
          })
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Parsing failed'
        setParseErrors((prev) => ({ ...prev, [attachment.id]: errorMsg }))
      } finally {
        setParsingAttachments((prev) => {
          const next = new Set(prev)
          next.delete(attachment.id)
          return next
        })
      }
    },
    [onUpdateAttachment],
  )
  
  // Clean up base64 cache when attachments are removed
  useEffect(() => {
    const currentIds = new Set(capsule.attachments.map(a => a.id))
    for (const id of attachmentDataMap.current.keys()) {
      if (!currentIds.has(id)) attachmentDataMap.current.delete(id)
    }
  }, [capsule.attachments])
  
  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    
    for (const file of files) {
      const isMedia = file.type.startsWith('image/') || 
                      file.type.startsWith('video/') || 
                      file.type.startsWith('audio/')
      
      const attachment: CapsuleAttachment = {
        id: crypto.randomUUID(),
        originalName: file.name,
        originalSize: file.size,
        originalType: file.type,
        semanticContent: null,
        semanticExtracted: false,
        encryptedRef: `encrypted_${crypto.randomUUID()}`,
        encryptedHash: '',
        previewRef: null,
        rasterProof: null,
        isMedia,
        hasTranscript: false
      }
      
      onAddAttachment(attachment)

      if (isParseableFormat(file.type)) {
        void cacheBase64ForAttachment(attachment.id, file)
      }
    }
    
    if (e.target) e.target.value = ''
  }
  
  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  
  return (
    <div style={{
      background: cardBg,
      borderRadius: '8px',
      border: `1px solid ${borderColor}`,
      overflow: 'hidden'
    }}>
      {/* Section Header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span style={{ fontSize: '14px' }}>📦</span>
        <span style={{ fontSize: '12px', fontWeight: 600, color: textColor }}>
          Capsule Construction (Editable)
        </span>
      </div>
      
      {/* Content */}
      <div style={{ padding: '14px' }}>
        {/* Message Content */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Message Content
          </div>
          <textarea
            value={capsule.text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Enter your message..."
            style={{
              width: '100%',
              minHeight: '100px',
              padding: '10px 12px',
              fontSize: '13px',
              lineHeight: '1.5',
              color: textColor,
              background: inputBg,
              border: `1px solid ${inputBorder}`,
              borderRadius: '6px',
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit'
            }}
          />
        </div>
        
        {/* Attachments */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Attachments
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${inputBorder}`,
                color: textColor,
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              + Add File
            </button>
          </div>
          
          {capsule.attachments.length === 0 ? (
            <div style={{ fontSize: '12px', color: mutedColor, fontStyle: 'italic', padding: '8px 0' }}>
              No attachments
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {capsule.attachments.map((att) => {
                const isPdf =
                  att.originalType?.toLowerCase() === 'application/pdf' ||
                  att.originalName.toLowerCase().endsWith('.pdf')
                const isParsing = parsingAttachments.has(att.id)
                const isSuccess = !!att.semanticExtracted
                const err = parseErrors[att.id]
                const hasData = !!attachmentDataMap.current.get(att.id)
                const showPdfBadge = isPdf && (isParsing || isSuccess || !!err)
                const parseStatus: 'pending' | 'success' | 'failed' = isParsing
                  ? 'pending'
                  : isSuccess
                    ? 'success'
                    : 'failed'
                const badgeTheme = isProfessional ? 'standard' : 'dark'
                return (
                  <div
                    key={att.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      background: isProfessional ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)',
                      borderRadius: '6px',
                      border: `1px solid ${borderColor}`,
                      flexWrap: 'wrap' as const,
                    }}
                  >
                    <span style={{ fontSize: '14px' }}>{att.isMedia ? '🎬' : '📄'}</span>
                    <div style={{ flex: 1, minWidth: '120px' }}>
                      <div
                        style={{
                          fontSize: '12px',
                          fontWeight: 500,
                          color: textColor,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {att.originalName}
                      </div>
                      <div style={{ fontSize: '10px', color: mutedColor }}>
                        {formatSize(att.originalSize)}
                        {isPdf && !isParsing && !isSuccess && !err && ' • Click Parse to extract text'}
                        {err && !isParsing ? ` • ${err.substring(0, 80)}${err.length > 80 ? '…' : ''}` : null}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap' as const }}>
                      {isPdf && hasData && onUpdateAttachment && (
                        <button
                          type="button"
                          disabled={isParsing || isSuccess}
                          onClick={() => parseAttachmentById(att)}
                          style={{
                            padding: '2px 8px',
                            fontSize: '10px',
                            fontWeight: 600,
                            borderRadius: '4px',
                            cursor: isParsing || isSuccess ? 'not-allowed' : 'pointer',
                            opacity: isParsing || isSuccess ? 0.6 : 1,
                            background: isProfessional ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.25)',
                            border: `1px solid ${isProfessional ? 'rgba(139,92,246,0.35)' : 'rgba(192,132,252,0.4)'}`,
                            color: isProfessional ? '#6d28d9' : '#e9d5ff',
                          }}
                        >
                          {isParsing ? 'Parsing…' : 'Parse'}
                        </button>
                      )}
                      {isPdf &&
                        !att.semanticExtracted &&
                        !isParsing &&
                        hasData &&
                        onUpdateAttachment && (
                          <VisionFallbackButton
                            attachment={att}
                            dataBase64={attachmentDataMap.current.get(att.id)!}
                            onSuccess={(text) => {
                              onUpdateAttachment(att.id, { semanticContent: text, semanticExtracted: true })
                              setParseErrors((prev) => {
                                const next = { ...prev }
                                delete next[att.id]
                                return next
                              })
                            }}
                            theme={
                              theme === 'professional'
                                ? 'professional'
                                : theme === 'dark'
                                  ? 'dark'
                                  : 'default'
                            }
                          />
                        )}
                      <button
                        type="button"
                        onClick={() => onRemoveAttachment(att.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: mutedColor,
                          fontSize: '16px',
                          cursor: 'pointer',
                          padding: '2px 6px',
                        }}
                        aria-label="Remove attachment"
                      >
                        ×
                      </button>
                      {showPdfBadge && (
                        <AttachmentStatusBadge status={parseStatus} theme={badgeTheme} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          
          {/* Attachment Info */}
          <div style={{
            marginTop: '8px',
            padding: '8px 10px',
            background: isProfessional ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.15)',
            borderRadius: '4px',
            fontSize: '10px',
            color: isProfessional ? '#16a34a' : '#86efac'
          }}>
            <div>📝 Semantic content used: parsed text only</div>
            <div>🔐 Original file encrypted; decryptable by receiver under envelope policy</div>
          </div>
        </div>
        
        {/* Sessions / Automation */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Sessions / Automation
          </div>
          
          {availableSessions.length === 0 ? (
            <div style={{ fontSize: '12px', color: mutedColor, fontStyle: 'italic', padding: '8px 0' }}>
              No sessions available
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {availableSessions.map(session => {
                const isSelected = capsule.selectedSessions.some(s => s.sessionId === session.sessionId)
                const canSelect = hasCapability(session.requiredCapability) || hasCapability('session_control')
                
                return (
                  <div
                    key={session.sessionId}
                    onClick={() => {
                      if (isSelected) {
                        onDeselectSession(session.sessionId)
                      } else {
                        onSelectSession(session)
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 10px',
                      background: isSelected 
                        ? (isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)')
                        : (isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.03)'),
                      borderRadius: '6px',
                      border: `1px solid ${isSelected ? 'rgba(139,92,246,0.3)' : borderColor}`,
                      cursor: 'pointer',
                      opacity: canSelect ? 1 : 0.6
                    }}
                  >
                    <div style={{
                      width: '16px',
                      height: '16px',
                      borderRadius: '4px',
                      border: `2px solid ${isSelected ? '#a855f7' : mutedColor}`,
                      background: isSelected ? '#a855f7' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontSize: '10px'
                    }}>
                      {isSelected && '✓'}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: textColor }}>
                        {session.sessionName}
                      </div>
                      <div style={{ fontSize: '10px', color: mutedColor }}>
                        Requires: {session.requiredCapability.replace(/_/g, ' ')}
                      </div>
                    </div>
                    {!canSelect && (
                      <span style={{ fontSize: '10px', color: '#f59e0b' }}>
                        ⚠ Will add capability
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          
          {capsule.selectedSessions.length > 0 && !hasCapability('session_control') && (
            <div style={{
              marginTop: '8px',
              padding: '6px 10px',
              background: 'rgba(245,158,11,0.15)',
              borderRadius: '4px',
              fontSize: '10px',
              color: '#f59e0b'
            }}>
              ⚠ Selecting sessions will add "session_control" capability to envelope
            </div>
          )}
        </div>
        
        {/* Data / Automation Request */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Data / Automation Request
          </div>
          <textarea
            value={capsule.dataRequest}
            onChange={(e) => onDataRequestChange(e.target.value)}
            placeholder="Describe any data or automation you're requesting..."
            style={{
              width: '100%',
              minHeight: '60px',
              padding: '10px 12px',
              fontSize: '12px',
              lineHeight: '1.5',
              color: textColor,
              background: inputBg,
              border: `1px solid ${inputBorder}`,
              borderRadius: '6px',
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit'
            }}
          />
          <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>
            This describes the request. Execution is still bound by envelope capabilities.
          </div>
        </div>
      </div>
    </div>
  )
}

export default CapsuleSection

