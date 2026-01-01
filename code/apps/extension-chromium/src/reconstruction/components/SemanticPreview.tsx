/**
 * Semantic Preview Component
 * 
 * Displays extracted semantic text from attachments.
 * Read-only preview using parsed text from Tika.
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import type { SemanticTextEntry } from '../types'

interface SemanticPreviewProps {
  messageBodyText?: string
  semanticTextEntries: SemanticTextEntry[]
  theme: 'default' | 'dark' | 'professional'
}

export const SemanticPreview: React.FC<SemanticPreviewProps> = ({
  messageBodyText,
  semanticTextEntries,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)'
  const codeBg = isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)'
  
  const [expandedId, setExpandedId] = useState<string | null>(null)
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 700,
          color: textColor,
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>📝</span>
          Semantic Preview (Text)
        </div>
        <div style={{
          fontSize: '10px',
          color: mutedColor,
          fontStyle: 'italic'
        }}>
          Read-only extracted content
        </div>
      </div>
      
      {/* Message Body */}
      {messageBodyText && (
        <div style={{
          padding: '14px',
          background: cardBg,
          borderRadius: '10px',
          border: `1px solid ${borderColor}`
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: mutedColor,
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Message Body
          </div>
          <div style={{
            fontSize: '13px',
            color: textColor,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap'
          }}>
            {messageBodyText}
          </div>
        </div>
      )}
      
      {/* Attachment Text */}
      {semanticTextEntries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: textColor
          }}>
            Attachment Content ({semanticTextEntries.length} files)
          </div>
          
          {semanticTextEntries.map((entry) => (
            <div
              key={entry.artefactId}
              style={{
                background: cardBg,
                borderRadius: '10px',
                border: `1px solid ${borderColor}`,
                overflow: 'hidden'
              }}
            >
              {/* Attachment Header */}
              <div
                onClick={() => setExpandedId(expandedId === entry.artefactId ? null : entry.artefactId)}
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  borderBottom: expandedId === entry.artefactId ? `1px solid ${borderColor}` : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '16px' }}>
                    {entry.unavailable ? '⚠️' : '📄'}
                  </span>
                  <div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: textColor
                    }}>
                      {entry.artefactId.split('_att_')[1] 
                        ? `Attachment ${parseInt(entry.artefactId.split('_att_')[1]) + 1}`
                        : entry.artefactId}
                    </div>
                    <div style={{
                      fontSize: '10px',
                      color: mutedColor,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '2px'
                    }}>
                      <span>{entry.mimeType || 'unknown'}</span>
                      <span>•</span>
                      <span>Source: {entry.source}</span>
                      {entry.unavailable && (
                        <>
                          <span>•</span>
                          <span style={{ color: '#f59e0b' }}>Text unavailable</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <span style={{
                  fontSize: '12px',
                  color: mutedColor,
                  transform: expandedId === entry.artefactId ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }}>
                  ▼
                </span>
              </div>
              
              {/* Expanded Content */}
              {expandedId === entry.artefactId && (
                <div style={{ padding: '14px' }}>
                  {entry.unavailable ? (
                    <div style={{
                      padding: '20px',
                      textAlign: 'center',
                      color: mutedColor
                    }}>
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>📭</div>
                      <div style={{ fontSize: '12px' }}>
                        Semantic text unavailable for this artefact.
                      </div>
                      <div style={{ fontSize: '11px', marginTop: '4px', opacity: 0.7 }}>
                        Media files without transcripts cannot be text-extracted.
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      background: codeBg,
                      borderRadius: '8px',
                      padding: '12px',
                      maxHeight: '300px',
                      overflowY: 'auto'
                    }}>
                      <pre style={{
                        margin: 0,
                        fontSize: '12px',
                        color: textColor,
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.5
                      }}>
                        {entry.text}
                      </pre>
                    </div>
                  )}
                  
                  {/* Hash info */}
                  <div style={{
                    marginTop: '10px',
                    fontSize: '10px',
                    color: mutedColor,
                    fontFamily: 'monospace',
                    opacity: 0.7
                  }}>
                    Hash: {entry.textHash.substring(0, 24)}...
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Empty State */}
      {!messageBodyText && semanticTextEntries.length === 0 && (
        <div style={{
          padding: '30px',
          textAlign: 'center',
          color: mutedColor
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>📝</div>
          <div style={{ fontSize: '13px' }}>No semantic text available</div>
        </div>
      )}
    </div>
  )
}

