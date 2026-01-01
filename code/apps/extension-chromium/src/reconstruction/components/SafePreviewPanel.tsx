/**
 * Safe Preview Panel
 * 
 * Combines reconstruction status, semantic preview, and raster preview
 * into a unified "Open" view for accepted messages.
 * 
 * Shows explicit disclaimer about preview safety.
 * 
 * @version 1.0.0
 */

import React, { useCallback } from 'react'
import { ReconstructionStatus } from './ReconstructionStatus'
import { SemanticPreview } from './SemanticPreview'
import { RasterPreview } from './RasterPreview'
import { useReconstruction } from '../useReconstruction'
import { useReconstructionStore } from '../useReconstructionStore'
import type { BeapMessageUI } from '../../beap-messages/types'

interface SafePreviewPanelProps {
  message: BeapMessageUI
  theme: 'default' | 'dark' | 'professional'
}

export const SafePreviewPanel: React.FC<SafePreviewPanelProps> = ({
  message,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const warningBg = isProfessional ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.15)'
  
  // Reconstruction hook
  const { reconstruct, isProcessing, error } = useReconstruction()
  
  // Reconstruction store
  const reconstructionState = useReconstructionStore(state => state.getState(message.id))
  const record = useReconstructionStore(state => state.getRecord(message.id))
  
  // Handle reconstruct
  const handleReconstruct = useCallback(async () => {
    await reconstruct(message.id)
  }, [reconstruct, message.id])
  
  // Check if message is accepted
  const isAccepted = message.verificationStatus === 'accepted' || message.status === 'accepted'
  
  // If not accepted, show blocked message
  if (!isAccepted) {
    return (
      <div style={{
        padding: '40px 20px',
        textAlign: 'center',
        color: mutedColor
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
          Preview Not Available
        </div>
        <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '300px', margin: '0 auto' }}>
          Content reconstruction is only available for accepted messages.
          This message has not passed verification.
        </div>
      </div>
    )
  }
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Safety Disclaimer */}
      <div style={{
        padding: '14px 16px',
        background: warningBg,
        borderRadius: '10px',
        border: `1px solid rgba(245,158,11,0.3)`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px'
      }}>
        <span style={{ fontSize: '18px' }}>🔒</span>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: isProfessional ? '#b45309' : '#fbbf24',
            marginBottom: '4px'
          }}>
            Safe Preview Mode
          </div>
          <div style={{
            fontSize: '11px',
            color: isProfessional ? '#92400e' : '#fcd34d',
            lineHeight: 1.5
          }}>
            Preview uses parsed text + rasterized references only. 
            Originals remain encrypted and are not rendered or executed.
          </div>
        </div>
      </div>
      
      {/* Reconstruction Status */}
      <ReconstructionStatus
        state={reconstructionState}
        error={error || record?.error}
        onReconstruct={handleReconstruct}
        isProcessing={isProcessing || reconstructionState === 'running'}
        theme={theme}
      />
      
      {/* Previews - only shown when reconstruction is done */}
      {reconstructionState === 'done' && record && (
        <>
          {/* Semantic Preview */}
          <div style={{
            borderTop: `1px solid ${borderColor}`,
            paddingTop: '20px'
          }}>
            <SemanticPreview
              messageBodyText={message.bodyText}
              semanticTextEntries={record.semanticTextByArtefact}
              theme={theme}
            />
          </div>
          
          {/* Raster Preview */}
          <div style={{
            borderTop: `1px solid ${borderColor}`,
            paddingTop: '20px'
          }}>
            <RasterPreview
              rasterRefs={record.rasterRefs}
              theme={theme}
            />
          </div>
          
          {/* Integrity Info */}
          <div style={{
            borderTop: `1px solid ${borderColor}`,
            paddingTop: '16px'
          }}>
            <div style={{
              fontSize: '11px',
              color: mutedColor,
              fontFamily: 'monospace'
            }}>
              <div style={{ marginBottom: '4px' }}>
                <span style={{ fontWeight: 600 }}>Envelope Hash:</span> {record.envelopeHash.substring(0, 32)}...
              </div>
              <div style={{ marginBottom: '4px' }}>
                <span style={{ fontWeight: 600 }}>Reconstruction Version:</span> v{record.version}
              </div>
              {record.completedAt && (
                <div>
                  <span style={{ fontWeight: 600 }}>Completed:</span> {new Date(record.completedAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      
      {/* Not yet reconstructed hint */}
      {reconstructionState === 'none' && (
        <div style={{
          padding: '30px 20px',
          textAlign: 'center',
          color: mutedColor,
          borderTop: `1px solid ${borderColor}`
        }}>
          <div style={{ fontSize: '24px', marginBottom: '12px' }}>📄</div>
          <div style={{ fontSize: '13px', marginBottom: '4px' }}>
            Click <strong>Reconstruct</strong> to generate safe previews
          </div>
          <div style={{ fontSize: '11px', opacity: 0.7 }}>
            This will extract text and create page images without decrypting originals
          </div>
        </div>
      )}
    </div>
  )
}

