/**
 * BEAP Inbox — resolve an importable WR session payload from a canonical BeapMessage.
 *
 * Contract (no guessing from free-form message bodies):
 * - Only attachment `semanticContent` is considered (capsule-structured extraction path).
 * - Parsed JSON must pass substance checks and `safeNormalizeImportedSessionPayload`.
 * - v1.0.0 exports may be accepted from any attachment with parseable JSON (strong schema).
 * - Legacy blobs additionally require a “likely session JSON” filename/MIME hint.
 *
 * First matching attachment wins. Future Run / Edit actions should use this module only.
 */

import type { BeapAttachment, BeapMessage } from './beapInboxTypes'
import {
  safeNormalizeImportedSessionPayload,
  type NormalizedSessionImport,
} from '../services/sessionImportCore'

// =============================================================================
// Types
// =============================================================================

export type BeapSessionImportResolution =
  | BeapSessionImportResolutionValid
  | BeapSessionImportResolutionInvalid
  | BeapSessionImportResolutionNone

export interface BeapSessionImportResolutionValid {
  status: 'valid'
  /** Raw JSON object as parsed from semanticContent (before canonical normalization). */
  rawPayload: Record<string, unknown>
  normalized: NormalizedSessionImport
  source: {
    kind: 'attachment_semantic_json'
    attachmentId: string
    filename: string
    mimeType: string
  }
}

export interface BeapSessionImportResolutionInvalid {
  status: 'invalid'
  /** Machine-oriented code for telemetry / tests. */
  code:
    | 'json_parse_error'
    | 'not_object'
    | 'insufficient_substance'
    | 'normalize_failed'
  reason: string
  source?: {
    kind: 'attachment_semantic_json'
    attachmentId: string
    filename: string
  }
}

export interface BeapSessionImportResolutionNone {
  status: 'none'
  code: 'no_candidate_attachment' | 'no_semantic_content'
  reason: string
}

// =============================================================================
// Filename / MIME heuristics (legacy payloads only)
// =============================================================================

export function isLikelySessionJsonAttachment(att: Pick<BeapAttachment, 'filename' | 'mimeType'>): boolean {
  const fn = (att.filename || '').toLowerCase()
  const mime = (att.mimeType || '').toLowerCase()
  if (fn.endsWith('.json') || mime.includes('json')) return true
  if (/\bsession\b/i.test(att.filename)) return true
  if (/\boptimando\b/i.test(att.filename)) return true
  if (/\bwrdesk\b/i.test(att.filename)) return true
  return false
}

/**
 * True when the object looks like a meaningful session/automation payload (not an empty `{}` or unrelated JSON).
 */
export function sessionJsonHasImportableSubstance(obj: Record<string, unknown>): boolean {
  const boxes = obj.agentBoxes
  if (Array.isArray(boxes) && boxes.length > 0) return true
  const agents = obj.agents
  if (Array.isArray(agents) && agents.length > 0) return true

  const uiState = obj.uiState as Record<string, unknown> | undefined
  const hybridFromUi = uiState?.hybridViews
  if (Array.isArray(hybridFromUi) && hybridFromUi.length > 0) return true

  const hybrid = obj.hybridViews ?? obj.hybridAgentBoxes
  if (Array.isArray(hybrid) && hybrid.length > 0) return true

  const grids = obj.displayGrids
  if (Array.isArray(grids) && grids.length > 0) return true

  const helper = obj.helperTabs as { urls?: unknown[] } | null | undefined
  if (helper && Array.isArray(helper.urls) && helper.urls.length > 0) return true

  if (obj.memory && typeof obj.memory === 'object' && obj.memory !== null) return true
  if (obj.context && typeof obj.context === 'object' && obj.context !== null) return true

  return false
}

// =============================================================================
// Parsing
// =============================================================================

function parseSemanticJson(semanticContent: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = semanticContent.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { ok: false, error: 'empty semantic content' }
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown }
  } catch {
    return { ok: false, error: 'JSON.parse failed' }
  }
}

function tryAttachment(
  att: BeapAttachment,
  pageUrlFallback?: string,
): BeapSessionImportResolutionValid | BeapSessionImportResolutionInvalid | null {
  const sc = att.semanticContent
  if (sc === undefined || sc === '') return null

  const parsed = parseSemanticJson(sc)
  if (!parsed.ok) {
    if (isLikelySessionJsonAttachment(att) || /\.json$/i.test(att.filename)) {
      return {
        status: 'invalid',
        code: 'json_parse_error',
        reason: 'Attachment looks like session data but semantic content is not valid JSON.',
        source: {
          kind: 'attachment_semantic_json',
          attachmentId: att.attachmentId,
          filename: att.filename,
        },
      }
    }
    return null
  }

  const value = parsed.value
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      status: 'invalid',
      code: 'not_object',
      reason: 'Parsed attachment JSON is not a session object.',
      source: {
        kind: 'attachment_semantic_json',
        attachmentId: att.attachmentId,
        filename: att.filename,
      },
    }
  }

  const obj = value as Record<string, unknown>
  const isV1 = obj.version === '1.0.0'
  if (!isV1 && !isLikelySessionJsonAttachment(att)) {
    return null
  }

  if (!sessionJsonHasImportableSubstance(obj)) {
    return {
      status: 'invalid',
      code: 'insufficient_substance',
      reason: 'JSON does not contain importable session fields (agents, boxes, grids, etc.).',
      source: {
        kind: 'attachment_semantic_json',
        attachmentId: att.attachmentId,
        filename: att.filename,
      },
    }
  }

  const norm = safeNormalizeImportedSessionPayload(obj, { pageUrl: pageUrlFallback })
  if (!norm.ok) {
    return {
      status: 'invalid',
      code: 'normalize_failed',
      reason: norm.error,
      source: {
        kind: 'attachment_semantic_json',
        attachmentId: att.attachmentId,
        filename: att.filename,
      },
    }
  }

  return {
    status: 'valid',
    rawPayload: obj,
    normalized: norm.normalized,
    source: {
      kind: 'attachment_semantic_json',
      attachmentId: att.attachmentId,
      filename: att.filename,
      mimeType: att.mimeType,
    },
  }
}

/**
 * Scan `message.attachments` in order; return the first valid importable session or an invalid/none result.
 */
export function resolveBeapSessionImportPayload(
  message: BeapMessage,
  options?: { pageUrlFallback?: string },
): BeapSessionImportResolution {
  const pageUrl = options?.pageUrlFallback
  if (!message.attachments || message.attachments.length === 0) {
    return {
      status: 'none',
      code: 'no_candidate_attachment',
      reason: 'This message has no attachments.',
    }
  }

  let sawEmptySemantic = false
  let lastInvalid: BeapSessionImportResolutionInvalid | null = null

  for (const att of message.attachments) {
    if (att.semanticContent === undefined || att.semanticContent === '') {
      sawEmptySemantic = true
      continue
    }

    const r = tryAttachment(att, pageUrl)
    if (r === null) continue
    if (r.status === 'valid') return r
    lastInvalid = r
  }

  if (lastInvalid) return lastInvalid

  if (sawEmptySemantic) {
    return {
      status: 'none',
      code: 'no_semantic_content',
      reason: 'Attachments have no semantic JSON payload yet (nothing importable).',
    }
  }

  return {
    status: 'none',
    code: 'no_candidate_attachment',
    reason: 'No attachment matched the session export contract.',
  }
}

/** Whether future Run-automation / Edit-session actions should be enabled. */
export function beapSessionImportActionsEnabled(resolution: BeapSessionImportResolution): boolean {
  return resolution.status === 'valid'
}

/** Short string for banners, tooltips, or aria-label on disabled controls. */
export function beapSessionImportUiHint(resolution: BeapSessionImportResolution): string {
  if (resolution.status === 'valid') {
    return `Importable session: ${resolution.source.filename}`
  }
  return resolution.reason
}
