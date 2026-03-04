/**
 * Shim for extension-chromium audit module — stubs for Electron.
 * Audit trail and archival are not available in the desktop app yet.
 */

export function AuditTrailPanel() { return null }
export function ArchiveButton() { return null }

export function useAuditStore() { return {} }
export function useAuditEvents() { return [] }
export function useAuditChain() { return null }

export function logImportEvent() {}
export function logVerificationEvent() {}
export function logDispatchEvent() {}
export function logDeliveryEvent() {}
export function logReconstructionEvent() {}
export function logArchiveEvent() {}
export function logExportEvent() {}

export async function checkArchiveEligibility() { return { eligible: false, reason: 'Not available in Electron' } }
export async function archiveMessage() { return null }
export async function storeArchiveRecord() {}
export async function getArchiveRecord() { return null }
export function isArchived() { return false }

export async function exportAuditLog() { return '' }
export async function downloadAuditLog() {}
export async function buildProofBundle() { return null }
export async function downloadProofBundle() {}
export async function exportRejectedProof() { return '' }
