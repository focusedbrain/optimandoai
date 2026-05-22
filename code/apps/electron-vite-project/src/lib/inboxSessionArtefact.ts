/**
 * Resolve `session_import_artefact` from inbox rows for Run Automation UI.
 * Reads canonical depackaged_json first; falls back to pBEAP package payload when needed.
 */

import type { InboxMessage } from '../stores/useEmailInboxStore'
import { getValidationState, type ValidationState } from '../utils/validationState'

export type SessionImportRequestedAction = 'import_only' | 'import_and_offer_run'

export type InboxSessionArtefactResolution = {
  artefact: Record<string, unknown> | null
  refs: Array<{ sessionId: string; sessionName?: string; requiredCapability?: unknown }>
  requestedAction?: SessionImportRequestedAction
  source: 'depackaged_json' | 'beap_package_pbeap' | 'none'
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw?.trim()) return null
  try {
    const p = JSON.parse(raw) as unknown
    if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return null
}

function decodePBeapCapsuleObject(packageJson: string | null | undefined): Record<string, unknown> | null {
  if (!packageJson?.trim()) return null
  try {
    const pkg = JSON.parse(packageJson.trim()) as Record<string, unknown>
    const header = pkg.header as Record<string, unknown> | undefined
    if (header?.encoding !== 'pBEAP' || typeof pkg.payload !== 'string') return null
    const binary = atob(pkg.payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const capsuleJson = new TextDecoder().decode(bytes)
    return parseJsonObject(capsuleJson)
  } catch {
    return null
  }
}

function readArtefactFromObject(obj: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!obj) return null
  const raw = obj.session_import_artefact
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return null
}

export function artefactToSessionRefs(artefact: Record<string, unknown>): {
  refs: InboxSessionArtefactResolution['refs']
  requestedAction?: SessionImportRequestedAction
} {
  const sessions = artefact.sessions
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return { refs: [] }
  }
  const refs = sessions
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
    .map((s) => ({
      sessionId: typeof s.session_id === 'string' ? s.session_id : String(s.session_id ?? ''),
      sessionName: typeof s.session_name === 'string' ? s.session_name : undefined,
      requiredCapability: Array.isArray(s.capabilities_required)
        ? s.capabilities_required
        : undefined,
    }))
  const requestedAction =
    artefact.requested_action === 'import_only' || artefact.requested_action === 'import_and_offer_run'
      ? (artefact.requested_action as SessionImportRequestedAction)
      : undefined
  return { refs, requestedAction }
}

export function resolveInboxSessionArtefact(message: InboxMessage | null | undefined): InboxSessionArtefactResolution {
  if (!message) {
    return { artefact: null, refs: [], source: 'none' }
  }

  const depackaged = parseJsonObject(message.depackaged_json)
  let artefact = readArtefactFromObject(depackaged)
  let source: InboxSessionArtefactResolution['source'] = artefact ? 'depackaged_json' : 'none'

  if (!artefact) {
    const capsule = decodePBeapCapsuleObject(message.beap_package_json)
    artefact = readArtefactFromObject(capsule)
    if (artefact) source = 'beap_package_pbeap'
  }

  if (!artefact) {
    return { artefact: null, refs: [], source: 'none' }
  }

  const { refs, requestedAction } = artefactToSessionRefs(artefact)
  return { artefact, refs, requestedAction, source }
}

/** Validation gate for session automation affordances (Decision B + legacy rows with artefact). */
export function isSessionAutomationValidationEligible(
  validated_at: string | null | undefined,
  validation_reason: string | null | undefined,
  hasArtefact: boolean,
): boolean {
  const state = getValidationState(validated_at, validation_reason)
  if (state === 'validated') return true
  if (state === 'rejected') return false
  // Legacy / in-flight rows: readable depackaged artefact without an explicit rejection reason.
  return state === 'pending' && hasArtefact && (validation_reason == null || validation_reason === '')
}

export function canShowInboxRunAutomation(
  message: InboxMessage | null | undefined,
  resolution: InboxSessionArtefactResolution = resolveInboxSessionArtefact(message),
): boolean {
  if (!message || !resolution.artefact || resolution.refs.length === 0) return false
  return isSessionAutomationValidationEligible(
    message.validated_at,
    message.validation_reason,
    true,
  )
}

export function inboxValidationState(message: InboxMessage | null | undefined): ValidationState {
  return getValidationState(message?.validated_at, message?.validation_reason)
}

/** Default capability when attaching a session — explicit attach implies runnable automation offer. */
export function capabilitiesForSessionAttach(config: Record<string, unknown>): string[] {
  const raw = config.capabilities_required
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
  }
  return ['session_control']
}
