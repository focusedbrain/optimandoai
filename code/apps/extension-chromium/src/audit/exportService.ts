/**
 * Export Service
 * 
 * Controlled export of audit logs and proof bundles.
 * 
 * Rules:
 *   - Do NOT include decrypted originals
 *   - Do NOT include secrets or keys
 * 
 * @version 1.0.0
 */

import type {
  AuditLogExport,
  ProofBundleManifest,
  RejectedProofBundle,
  AuditEvent
} from './types'
import { useAuditStore, logExportEvent } from './useAuditStore'
import { useBeapMessagesStore } from '../beap-messages/useBeapMessagesStore'
import { useReconstructionStore } from '../reconstruction/useReconstructionStore'
import { getArchiveRecord } from './archivalService'

// =============================================================================
// Hash Utilities
// =============================================================================

/**
 * Compute SHA-256 hash
 */
async function computeHash(data: string): Promise<string> {
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// Audit Log Export
// =============================================================================

/**
 * Export audit log as JSON
 */
export async function exportAuditLog(
  messageId: string
): Promise<{ success: boolean; data?: AuditLogExport; error?: string }> {
  const auditStore = useAuditStore.getState()
  
  // Get events
  const events = auditStore.getEvents(messageId)
  if (events.length === 0) {
    return { success: false, error: 'No audit events found for this message' }
  }
  
  // Verify chain integrity
  const chain = auditStore.getChain(messageId)
  const verified = await auditStore.verifyChainIntegrity(messageId)
  
  // Build export
  const exportData: AuditLogExport = {
    version: '1.0',
    exportedAt: Date.now(),
    messageId,
    events,
    chainVerification: {
      headHash: chain?.headHash || '',
      eventCount: events.length,
      verified
    },
    exportHash: '' // Will be computed
  }
  
  // Compute export hash
  const exportContent = JSON.stringify({
    ...exportData,
    exportHash: undefined
  })
  exportData.exportHash = await computeHash(exportContent)
  
  // Log export event
  await logExportEvent(messageId, 'audit', {
    envelopeHash: exportData.exportHash
  })
  
  return { success: true, data: exportData }
}

/**
 * Download audit log as JSON file
 */
export async function downloadAuditLog(messageId: string): Promise<boolean> {
  const result = await exportAuditLog(messageId)
  if (!result.success || !result.data) {
    console.error('[Export] Audit log export failed:', result.error)
    return false
  }
  
  // Create downloadable file
  const content = JSON.stringify(result.data, null, 2)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  
  // Trigger download
  const a = document.createElement('a')
  a.href = url
  a.download = `beap-audit-${messageId}-${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  
  return true
}

// =============================================================================
// Proof Bundle Export
// =============================================================================

/**
 * Build proof bundle contents
 */
export async function buildProofBundle(
  messageId: string
): Promise<{ 
  success: boolean
  manifest?: ProofBundleManifest
  files?: Array<{ path: string; content: string }>
  error?: string 
}> {
  const messagesStore = useBeapMessagesStore.getState()
  const reconstructionStore = useReconstructionStore.getState()
  const auditStore = useAuditStore.getState()
  
  // Get message
  const message = messagesStore.getMessageById(messageId)
  if (!message) {
    return { success: false, error: 'Message not found' }
  }
  
  // Get archive record if exists
  const archiveRecord = getArchiveRecord(messageId)
  
  // Get reconstruction record
  const reconstructionRecord = reconstructionStore.getRecord(messageId)
  
  // Get audit events
  const events = auditStore.getEvents(messageId)
  
  // Export audit log
  const auditExport = await exportAuditLog(messageId)
  
  // Build files list
  const files: Array<{ path: string; content: string; type: string; hash: string; size: number }> = []
  
  // 1. Envelope summary
  const envelopeSummary = {
    messageId,
    fingerprint: message.fingerprintFull || message.fingerprint,
    deliveryMethod: message.deliveryMethod,
    direction: message.direction,
    timestamp: message.timestamp,
    title: message.title,
    senderName: message.senderName,
    channelSite: message.channelSite,
    status: message.status,
    envelopeSummary: message.envelopeSummary,
    capsuleMetadata: message.capsuleMetadata
  }
  const envelopeContent = JSON.stringify(envelopeSummary, null, 2)
  const envelopeHash = await computeHash(envelopeContent)
  files.push({
    path: 'envelope.json',
    content: envelopeContent,
    type: 'envelope',
    hash: envelopeHash,
    size: new Blob([envelopeContent]).size
  })
  
  // 2. Semantic text (if reconstructed)
  if (reconstructionRecord && reconstructionRecord.semanticTextByArtefact.length > 0) {
    const semanticContent = JSON.stringify(reconstructionRecord.semanticTextByArtefact, null, 2)
    const semanticHash = await computeHash(semanticContent)
    files.push({
      path: 'semantic_text.json',
      content: semanticContent,
      type: 'semantic_text',
      hash: semanticHash,
      size: new Blob([semanticContent]).size
    })
  }
  
  // 3. Raster references (if reconstructed)
  if (reconstructionRecord && reconstructionRecord.rasterRefs.length > 0) {
    // Export raster metadata (not actual images to keep bundle small)
    const rasterMetadata = reconstructionRecord.rasterRefs.map(ref => ({
      artefactId: ref.artefactId,
      totalPages: ref.totalPages,
      format: ref.format,
      pages: ref.pages.map(p => ({
        pageNumber: p.pageNumber,
        width: p.width,
        height: p.height,
        imageHash: p.imageHash
      })),
      originalHash: ref.originalHash
    }))
    const rasterContent = JSON.stringify(rasterMetadata, null, 2)
    const rasterHash = await computeHash(rasterContent)
    files.push({
      path: 'raster_metadata.json',
      content: rasterContent,
      type: 'raster',
      hash: rasterHash,
      size: new Blob([rasterContent]).size
    })
  }
  
  // 4. Rejection reason (for rejected messages)
  if (message.rejectionReasonData) {
    const rejectionContent = JSON.stringify({
      code: message.rejectionReasonData.code,
      summary: message.rejectionReasonData.humanSummary,
      details: message.rejectionReasonData.details,
      timestamp: message.rejectionReasonData.timestamp,
      failedStep: message.rejectionReasonData.failedStep
    }, null, 2)
    const rejectionHash = await computeHash(rejectionContent)
    files.push({
      path: 'rejection_reason.json',
      content: rejectionContent,
      type: 'rejection_reason',
      hash: rejectionHash,
      size: new Blob([rejectionContent]).size
    })
  }
  
  // 5. Audit log
  if (auditExport.success && auditExport.data) {
    const auditContent = JSON.stringify(auditExport.data, null, 2)
    files.push({
      path: 'audit_log.json',
      content: auditContent,
      type: 'audit_log',
      hash: auditExport.data.exportHash,
      size: new Blob([auditContent]).size
    })
  }
  
  // Build manifest
  const manifest: ProofBundleManifest = {
    version: '1.0',
    createdAt: Date.now(),
    messageId,
    messageSummary: {
      title: message.title,
      status: message.status,
      direction: message.direction,
      timestamp: message.timestamp
    },
    files: files.map(f => ({
      path: f.path,
      type: f.type as ProofBundleManifest['files'][0]['type'],
      hash: f.hash,
      size: f.size
    })),
    bundleHash: '', // Will be computed
    verificationInstructions: `
To verify this proof bundle:
1. Compute SHA-256 hash of each file and compare with hashes in manifest
2. Verify audit log chain integrity by checking prevEventHash linking
3. Confirm envelope summary matches expected message data
4. For accepted messages: verify semantic text and raster hashes
5. For rejected messages: verify rejection reason is present

Note: This bundle does NOT contain decrypted originals or secrets.
    `.trim()
  }
  
  // Compute bundle hash
  const manifestContent = JSON.stringify({
    ...manifest,
    bundleHash: undefined
  })
  manifest.bundleHash = await computeHash(manifestContent)
  
  // Add manifest to files
  files.unshift({
    path: 'manifest.json',
    content: JSON.stringify(manifest, null, 2),
    type: 'manifest',
    hash: manifest.bundleHash,
    size: new Blob([JSON.stringify(manifest, null, 2)]).size
  })
  
  // Log export event
  await logExportEvent(messageId, 'proof', {
    envelopeHash: manifest.bundleHash
  })
  
  return {
    success: true,
    manifest,
    files: files.map(f => ({ path: f.path, content: f.content }))
  }
}

/**
 * Download proof bundle as ZIP
 * Note: Uses a simple multi-file download approach
 * In production, would use JSZip or similar
 */
export async function downloadProofBundle(messageId: string): Promise<boolean> {
  const result = await buildProofBundle(messageId)
  if (!result.success || !result.files) {
    console.error('[Export] Proof bundle export failed:', result.error)
    return false
  }
  
  // Create a combined JSON file (simplified - no actual ZIP)
  const bundleContent = JSON.stringify({
    _bundleFormat: 'beap-proof-bundle',
    _version: '1.0',
    manifest: result.manifest,
    files: result.files.reduce((acc, f) => {
      acc[f.path] = JSON.parse(f.content)
      return acc
    }, {} as Record<string, unknown>)
  }, null, 2)
  
  // Download as JSON (in production would be ZIP)
  const blob = new Blob([bundleContent], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  
  const a = document.createElement('a')
  a.href = url
  a.download = `beap-proof-bundle-${messageId}-${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  
  return true
}

// =============================================================================
// Rejected Message Proof Export
// =============================================================================

/**
 * Export rejected message proof
 * Includes rejection reason, envelope summary, and audit events up to rejection
 */
export async function exportRejectedProof(
  messageId: string
): Promise<{ success: boolean; data?: RejectedProofBundle; error?: string }> {
  const messagesStore = useBeapMessagesStore.getState()
  const auditStore = useAuditStore.getState()
  
  // Get message
  const message = messagesStore.getMessageById(messageId)
  if (!message) {
    return { success: false, error: 'Message not found' }
  }
  
  // Verify it's rejected
  if (message.folder !== 'rejected' && message.status !== 'rejected') {
    return { success: false, error: 'Message is not rejected' }
  }
  
  // Get audit events
  const events = auditStore.getEvents(messageId)
  
  // Build export
  const auditExportResult = await exportAuditLog(messageId)
  if (!auditExportResult.success || !auditExportResult.data) {
    return { success: false, error: 'Failed to export audit log' }
  }
  
  // Build manifest
  const files = [
    { path: 'envelope_summary.json', type: 'envelope' as const, hash: '', size: 0 },
    { path: 'rejection_reason.json', type: 'rejection_reason' as const, hash: '', size: 0 },
    { path: 'audit_log.json', type: 'audit_log' as const, hash: '', size: 0 }
  ]
  
  const manifest: ProofBundleManifest = {
    version: '1.0',
    createdAt: Date.now(),
    messageId,
    messageSummary: {
      title: message.title,
      status: message.status,
      direction: message.direction,
      timestamp: message.timestamp
    },
    files,
    bundleHash: await computeHash(JSON.stringify(files)),
    verificationInstructions: 'Verify rejection reason and audit chain integrity.'
  }
  
  const rejectedProof: RejectedProofBundle = {
    manifest,
    envelopeSummary: {
      fingerprint: message.fingerprint,
      deliveryMethod: message.deliveryMethod,
      timestamp: message.timestamp,
      ...message.envelopeSummary
    },
    rejectionReason: message.rejectionReasonData ? {
      code: message.rejectionReasonData.code,
      summary: message.rejectionReasonData.humanSummary,
      details: message.rejectionReasonData.details,
      timestamp: message.rejectionReasonData.timestamp
    } : {
      code: 'unknown',
      summary: message.rejectReason || 'Unknown rejection reason',
      timestamp: Date.now()
    },
    auditLog: auditExportResult.data
  }
  
  return { success: true, data: rejectedProof }
}

