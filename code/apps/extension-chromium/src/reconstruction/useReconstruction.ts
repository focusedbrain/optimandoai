/**
 * Reconstruction Hook
 * 
 * React hook that orchestrates the reconstruction pipeline.
 * Integrates reconstruction service with store and messages.
 * 
 * @version 1.0.0
 */

import { useCallback, useState } from 'react'
import { useReconstructionStore } from './useReconstructionStore'
import { useBeapMessagesStore } from '../beap-messages/useBeapMessagesStore'
import { runReconstruction, canReconstruct } from './reconstructionService'
import type { ReconstructionRequest, ReconstructionAttachment } from './types'

// =============================================================================
// Hook Interface
// =============================================================================

interface UseReconstructionReturn {
  /** Start reconstruction for a message */
  reconstruct: (messageId: string) => Promise<boolean>
  
  /** Get reconstruction state for a message */
  getState: (messageId: string) => 'none' | 'running' | 'done' | 'failed'
  
  /** Check if reconstruction is allowed */
  canReconstruct: (messageId: string) => boolean
  
  /** Current processing state */
  isProcessing: boolean
  
  /** Current error if any */
  error: string | null
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useReconstruction(): UseReconstructionReturn {
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Reconstruction store
  const startReconstruction = useReconstructionStore(state => state.startReconstruction)
  const completeReconstruction = useReconstructionStore(state => state.completeReconstruction)
  const failReconstruction = useReconstructionStore(state => state.failReconstruction)
  const getReconstructionState = useReconstructionStore(state => state.getState)
  
  // Messages store
  const getMessageById = useBeapMessagesStore(state => state.getMessageById)
  
  /**
   * Check if reconstruction is allowed for a message
   */
  const canReconstructMessage = useCallback((messageId: string): boolean => {
    const message = getMessageById(messageId)
    if (!message) return false
    
    // Only allowed for accepted messages
    return canReconstruct(message.verificationStatus || message.status)
  }, [getMessageById])
  
  /**
   * Start reconstruction for a message
   */
  const reconstruct = useCallback(async (messageId: string): Promise<boolean> => {
    setError(null)
    
    // Get message
    const message = getMessageById(messageId)
    if (!message) {
      setError('Message not found')
      return false
    }
    
    // Validate state
    if (!canReconstructMessage(messageId)) {
      setError('Reconstruction is only allowed for accepted messages')
      return false
    }
    
    // Check if already running
    const currentState = getReconstructionState(messageId)
    if (currentState === 'running') {
      setError('Reconstruction already in progress')
      return false
    }
    
    setIsProcessing(true)
    
    try {
      // Generate envelope hash (stub)
      const envelopeHash = `env_${messageId}_${Date.now()}`
      
      // Start reconstruction in store
      startReconstruction(messageId, envelopeHash)
      
      // Build reconstruction request
      const attachments: ReconstructionAttachment[] = message.attachments.map((att, idx) => ({
        artefactId: `${messageId}_att_${idx}`,
        name: att.name,
        mimeType: guessMimeType(att.name, att.type),
        size: att.size || 0,
        encryptedRef: `encrypted:${messageId}:${idx}`,
        originalHash: `hash_${messageId}_${idx}`
      }))
      
      const request: ReconstructionRequest = {
        messageId,
        attachments,
        bodyText: message.bodyText,
        envelopeHash
      }
      
      console.log(`[Reconstruction] Starting for ${messageId} with ${attachments.length} attachments`)
      
      // Run reconstruction pipeline
      const result = await runReconstruction(request)
      
      if (result.success) {
        completeReconstruction(
          messageId,
          result.semanticTextByArtefact || [],
          result.rasterRefs || []
        )
        console.log(`[Reconstruction] Completed successfully for ${messageId}`)
        return true
      } else {
        failReconstruction(messageId, result.error || 'Unknown error')
        setError(result.error || 'Reconstruction failed')
        return false
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Reconstruction failed'
      failReconstruction(messageId, errorMessage)
      setError(errorMessage)
      return false
    } finally {
      setIsProcessing(false)
    }
  }, [
    getMessageById,
    canReconstructMessage,
    getReconstructionState,
    startReconstruction,
    completeReconstruction,
    failReconstruction
  ])
  
  return {
    reconstruct,
    getState: getReconstructionState,
    canReconstruct: canReconstructMessage,
    isProcessing,
    error
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Guess MIME type from filename and type hint
 */
function guessMimeType(filename: string, typeHint?: string): string {
  if (typeHint && typeHint !== 'unknown') {
    return typeHint
  }
  
  const ext = filename.split('.').pop()?.toLowerCase()
  
  const mimeMap: Record<string, string> = {
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'html': 'text/html',
    'rtf': 'application/rtf',
    'epub': 'application/epub+zip',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'mp3': 'audio/mpeg',
    'mp4': 'video/mp4',
    'wav': 'audio/wav'
  }
  
  return mimeMap[ext || ''] || 'application/octet-stream'
}

