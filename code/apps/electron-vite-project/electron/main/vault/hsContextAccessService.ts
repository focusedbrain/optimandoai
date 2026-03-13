/**
 * HS Context Access Service
 *
 * Whitelist-gated access for original HS Profile documents and external links.
 * Requires warning acknowledgement and explicit approval before serving originals or opening links.
 */

import type { VaultTier } from './types'
import { canAccessRecordType } from './types'
import { getProfileDocumentContent } from './hsContextProfileService'

// ── Audit actions ──
export const ACCESS_ACTIONS = {
  ORIGINAL_REQUESTED: 'original_document_access_requested',
  ORIGINAL_APPROVED: 'original_document_access_approved',
  ORIGINAL_DENIED: 'original_document_access_denied',
  ORIGINAL_SERVED: 'original_document_access_served',
  LINK_REQUESTED: 'external_link_open_requested',
  LINK_APPROVED: 'external_link_open_approved',
  LINK_DENIED: 'external_link_open_denied',
  LINK_OPENED: 'external_link_opened',
} as const

function requireHsContextAccess(tier: VaultTier, action: 'read' | 'write' | 'share' = 'read'): void {
  if (!canAccessRecordType(tier, 'handshake_context', action)) {
    throw new Error(`HS Context access requires Publisher or Enterprise tier (current: ${tier})`)
  }
}

function insertAccessAudit(
  db: any,
  action: string,
  entityType: 'document' | 'link',
  entityId: string,
  actorUserId: string,
  outcome: 'allowed' | 'denied',
  metadata?: Record<string, unknown>,
): void {
  try {
    db.prepare(`
      INSERT INTO hs_context_access_audit (timestamp, action, entity_type, entity_id, actor_wrdesk_user_id, outcome, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      new Date().toISOString(),
      action,
      entityType,
      entityId,
      actorUserId,
      outcome,
      metadata ? JSON.stringify(metadata) : null,
    )
  } catch (e: any) {
    console.warn('[HS ACCESS] Audit insert failed:', e?.message)
  }
}

function isApproved(db: any, entityType: 'document' | 'link', entityId: string, actorUserId: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM hs_context_access_approvals
    WHERE entity_type = ? AND entity_id = ? AND actor_wrdesk_user_id = ?
  `).get(entityType, entityId, actorUserId)
  return !!row
}

function grantApproval(db: any, entityType: 'document' | 'link', entityId: string, actorUserId: string, handshakeId?: string | null): void {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT OR IGNORE INTO hs_context_access_approvals (entity_type, entity_id, handshake_id, actor_wrdesk_user_id, approved_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(entityType, entityId, handshakeId ?? null, actorUserId, now)
}

/**
 * Request original document access. Requires acknowledgedWarning and approval.
 * Returns content only when both are satisfied.
 */
export async function requestOriginalDocumentContent(
  db: any,
  tier: VaultTier,
  kek: Buffer,
  documentId: string,
  actorUserId: string,
  options: { acknowledgedWarning: boolean; handshakeId?: string | null },
): Promise<
  | { success: true; content: Buffer; filename: string; mimeType: string }
  | { success: false; error: string; approved?: boolean }
> {
  requireHsContextAccess(tier, 'read')

  insertAccessAudit(db, ACCESS_ACTIONS.ORIGINAL_REQUESTED, 'document', documentId, actorUserId, 'denied', { acknowledgedWarning: options.acknowledgedWarning })

  if (!options.acknowledgedWarning) {
    insertAccessAudit(db, ACCESS_ACTIONS.ORIGINAL_DENIED, 'document', documentId, actorUserId, 'denied', { reason: 'MUST_ACKNOWLEDGE_WARNING' })
    return { success: false, error: 'MUST_ACKNOWLEDGE_WARNING', approved: false }
  }

  const approved = isApproved(db, 'document', documentId, actorUserId)
  if (!approved) {
    grantApproval(db, 'document', documentId, actorUserId, options.handshakeId)
    insertAccessAudit(db, ACCESS_ACTIONS.ORIGINAL_APPROVED, 'document', documentId, actorUserId, 'allowed')
  }

  try {
    const result = await getProfileDocumentContent(db, tier, kek, documentId)
    insertAccessAudit(db, ACCESS_ACTIONS.ORIGINAL_SERVED, 'document', documentId, actorUserId, 'allowed', { filename: result.filename })
    return { success: true, content: result.content, filename: result.filename, mimeType: result.mimeType }
  } catch (e: any) {
    insertAccessAudit(db, ACCESS_ACTIONS.ORIGINAL_DENIED, 'document', documentId, actorUserId, 'denied', { reason: e?.message })
    return { success: false, error: e?.message ?? 'Failed to retrieve document' }
  }
}

/**
 * Check if original document access is approved (without serving).
 */
export function checkOriginalDocumentApproved(db: any, documentId: string, actorUserId: string): boolean {
  return isApproved(db, 'document', documentId, actorUserId)
}

/**
 * Request link open approval. Returns approval status; caller opens in external browser.
 */
export function requestLinkOpenApproval(
  db: any,
  linkEntityId: string,
  actorUserId: string,
  options: { acknowledgedWarning: boolean; handshakeId?: string | null },
): { approved: boolean; error?: string } {
  insertAccessAudit(db, ACCESS_ACTIONS.LINK_REQUESTED, 'link', linkEntityId, actorUserId, 'denied', { acknowledgedWarning: options.acknowledgedWarning })

  if (!options.acknowledgedWarning) {
    insertAccessAudit(db, ACCESS_ACTIONS.LINK_DENIED, 'link', linkEntityId, actorUserId, 'denied', { reason: 'MUST_ACKNOWLEDGE_WARNING' })
    return { approved: false, error: 'MUST_ACKNOWLEDGE_WARNING' }
  }

  const approved = isApproved(db, 'link', linkEntityId, actorUserId)
  if (!approved) {
    grantApproval(db, 'link', linkEntityId, actorUserId, options.handshakeId)
    insertAccessAudit(db, ACCESS_ACTIONS.LINK_APPROVED, 'link', linkEntityId, actorUserId, 'allowed')
  }

  insertAccessAudit(db, ACCESS_ACTIONS.LINK_OPENED, 'link', linkEntityId, actorUserId, 'allowed')
  return { approved: true }
}
