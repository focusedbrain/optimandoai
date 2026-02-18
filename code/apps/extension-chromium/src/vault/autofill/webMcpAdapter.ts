// ============================================================================
// WRVault Autofill — WebMCP Preview-Only Adapter
// ============================================================================
//
// Leaf module: translates WebMCP tool invocations into overlay preview
// sessions.  This adapter creates and displays the overlay but NEVER
// commits values — the user must physically click "Insert" on the overlay.
//
// Security contract:
//   - MUST NOT call commitInsert() or setValueSafely()
//   - MUST NOT mutate session.state (managed by overlayManager + committer)
//   - MUST NOT hold plaintext references beyond session construction
//   - MUST delegate to guardElement(), takeFingerprint(), showOverlay()
//   - MUST respect HA mode enforcement
//   - MUST be a pure leaf — no reverse dependencies
//
// Integration point: Point B (Post-Scanner / Pre-Overlay)
// All 15 security invariants from the architecture report are preserved.
// ============================================================================

import { isAutofillActive } from './toggleSync'
import { collectCandidates } from './fieldScanner'
import type { ScanResult } from './fieldScanner'
import { showOverlay, isOverlayVisible, getActiveSessionId } from './overlayManager'
import { guardElement, auditLog, auditLogSafe, emitTelemetryEvent, redactError } from './hardening'
import { haCheck, isHAEnforced } from './haGuard'
import { takeFingerprint } from './domFingerprint'
import { matchOrigin, isPublicSuffix } from '../../../../../packages/shared/src/vault/originPolicy'
import { computeDisplayValue, DEFAULT_MASKING } from '../../../../../packages/shared/src/vault/insertionPipeline'
import type {
  OverlaySession,
  OverlayTarget,
  FieldCandidate,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import type {
  FieldKind,
  VaultProfile,
  FieldEntry,
} from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import * as vaultAPI from '../api'
import type { FillProjection } from '../api'
import type { Field } from '../types'

// ============================================================================
// §1  Types
// ============================================================================

export interface WebMcpFillPreviewParams {
  /** Vault item ID (UUID format). */
  itemId: string
  /** Optional CSS selector hints per field kind. */
  targetHints?: Record<string, string>
}

/**
 * Stable error codes returned by the WebMCP preview adapter.
 *
 * These codes are part of the public contract — callers may switch on them.
 * They MUST NOT contain PII, selectors, domains, UUIDs, or secrets.
 * Adding a new code is backward-compatible; removing or renaming is breaking.
 */
export type WebMcpErrorCode =
  | 'INVALID_PARAMS'
  | 'AUTOFILL_DISABLED'
  | 'VAULT_ITEM_DELETED'
  | 'ORIGIN_MISMATCH'
  | 'PSL_BLOCKED'
  | 'NO_TARGETS'
  | 'ELEMENT_HIDDEN'
  | 'INTERNAL_ERROR'

/**
 * All known WebMcpErrorCode values as a frozen set for runtime validation.
 * Tests use this to assert no unknown codes leak through.
 */
export const WEBMCP_ERROR_CODES: ReadonlySet<string> = new Set<WebMcpErrorCode>([
  'INVALID_PARAMS',
  'AUTOFILL_DISABLED',
  'VAULT_ITEM_DELETED',
  'ORIGIN_MISMATCH',
  'PSL_BLOCKED',
  'NO_TARGETS',
  'ELEMENT_HIDDEN',
  'INTERNAL_ERROR',
])

/**
 * Error codes produced by the background.ts WEBMCP_FILL_PREVIEW handler.
 * These are distinct from adapter-level codes — they represent IPC/routing
 * layer errors before the adapter is ever called.
 */
export type BgWebMcpErrorCode =
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'TEMP_BLOCKED'
  | 'INVALID_PARAMS'
  | 'INVALID_TAB'
  | 'RESTRICTED_PAGE'
  | 'TAB_UNREACHABLE'
  | 'INTERNAL_ERROR'

export const BG_WEBMCP_ERROR_CODES: ReadonlySet<string> = new Set<BgWebMcpErrorCode>([
  'FORBIDDEN',
  'RATE_LIMITED',
  'TEMP_BLOCKED',
  'INVALID_PARAMS',
  'INVALID_TAB',
  'RESTRICTED_PAGE',
  'TAB_UNREACHABLE',
  'INTERNAL_ERROR',
])

/**
 * Combined set of ALL error codes that can appear in a WebMCP preview result.
 * Useful for orchestrator UI code that handles both adapter and background errors.
 */
export const ALL_WEBMCP_ERROR_CODES: ReadonlySet<string> = new Set([
  ...WEBMCP_ERROR_CODES,
  ...BG_WEBMCP_ERROR_CODES,
])

export interface WebMcpAdapterResult {
  /** Contract version — callers must check this before reading other fields. */
  resultVersion: string
  success: boolean
  sessionId?: string
  previewFieldCount?: number
  /** True if the field scan was truncated by a DoS cap. */
  partialScan?: boolean
  /** If partialScan, why the scan was truncated. */
  partialReason?: 'element_cap' | 'time_budget' | 'candidate_cap'
  /** Number of form controls scored during the scan. */
  evaluatedCount?: number
  /** Total DOM elements visited by the TreeWalker. */
  elementsVisited?: number
  /** Number of candidates found during the scan. */
  candidateCount?: number
  error?: { code: WebMcpErrorCode; message: string }
}

// ============================================================================
// §2  Validation Constants
// ============================================================================

/**
 * Result contract version for WebMcpAdapterResult.
 *
 * Immutable for this major preview contract.  Callers that depend on the
 * result shape should assert `resultVersion === WEBMCP_RESULT_VERSION` before
 * reading any other fields.  A change to this string signals a breaking
 * change in the result schema.
 */
export const WEBMCP_RESULT_VERSION = 'webmcp-preview-v1'

/**
 * Runtime validator: returns true if `x` looks like a valid WebMCP preview
 * result (v1).  Pure function, no dependencies.
 *
 * Checks:
 *   - x is a non-null object
 *   - x.resultVersion === WEBMCP_RESULT_VERSION
 *   - x.success is a boolean
 *   - If success=false: x.error is { code: string, message: string }
 *     and code is in the combined error code set
 *   - If success=true: previewFieldCount is a non-negative integer (if present)
 *   - retryAfterMs, if present, is a finite positive number
 *
 * This validator is safe for the orchestrator to call before parsing any fields.
 */
export function isWebMcpResultV1(x: unknown): x is { resultVersion: string; success: boolean; [k: string]: unknown } {
  if (!x || typeof x !== 'object') return false
  const obj = x as Record<string, unknown>
  if (obj.resultVersion !== WEBMCP_RESULT_VERSION) return false
  if (typeof obj.success !== 'boolean') return false

  if (obj.success === false) {
    if (!obj.error || typeof obj.error !== 'object') return false
    const err = obj.error as Record<string, unknown>
    if (typeof err.code !== 'string') return false
    if (!ALL_WEBMCP_ERROR_CODES.has(err.code)) return false
    if (typeof err.message !== 'string') return false
  }

  if (obj.success === true) {
    if ('previewFieldCount' in obj && obj.previewFieldCount !== undefined) {
      if (typeof obj.previewFieldCount !== 'number' || obj.previewFieldCount < 0) return false
    }
  }

  if ('retryAfterMs' in obj && obj.retryAfterMs !== undefined) {
    if (typeof obj.retryAfterMs !== 'number' || !Number.isFinite(obj.retryAfterMs) || obj.retryAfterMs <= 0) return false
  }

  return true
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SELECTOR_LENGTH = 256
const MAX_HINT_COUNT = 20
const VALID_TARGET_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

// ============================================================================
// §3  Public Entry Point
// ============================================================================

/**
 * Handle a WebMCP fill-preview request from the content script message router.
 *
 * Creates an OverlaySession in 'preview' state and shows the overlay.
 * Returns immediately — does NOT await user consent or commit.
 *
 * The user must physically click "Insert" on the overlay to commit.
 * The adapter never calls commitInsert() or setValueSafely().
 */
export async function handleWebMcpFillPreviewRequest(
  params: WebMcpFillPreviewParams,
): Promise<WebMcpAdapterResult> {
  // HA severity escalation: info→security, warn→security
  const ha = isHAEnforced()
  const infoLevel = ha ? 'security' : 'info'
  const warnLevel = ha ? 'security' : 'warn'

  try {
    // ── Gate 1: Validate parameters ──
    const validation = validateParams(params)
    if (!validation.valid) {
      auditLog(warnLevel, 'WEBMCP_PREVIEW_FAILED', validation.reason!)
      return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'INVALID_PARAMS', message: validation.reason! } }
    }

    // ── Gate 2: Pipeline active? ──
    if (!isAutofillActive()) {
      auditLog(warnLevel, 'WEBMCP_REJECTED_INACTIVE', 'Autofill pipeline not active (vault locked or disabled)')
      return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'AUTOFILL_DISABLED', message: 'Vault is locked or autofill is disabled' } }
    }

    // ── Gate 3: HA mode context (informational — preview-only is always HA-compatible) ──
    if (ha) {
      auditLog('security', 'WEBMCP_HA_CONTEXT', 'HA mode active — overlay consent will be enforced')
    }

    // ── Step 4: Resolve vault item (least-privilege projection) ──
    // Uses getItemForFill() which returns only { id, fields, domain, category, title }.
    // container_id, favorite, created_at, updated_at are stripped client-side.
    let item: FillProjection
    try {
      item = await vaultAPI.getItemForFill(params.itemId)
    } catch (err) {
      auditLog(warnLevel, 'WEBMCP_ITEM_NOT_FOUND', 'Vault item could not be resolved')
      return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'VAULT_ITEM_DELETED', message: 'Vault item not found or deleted' } }
    }

    if (!item || !item.fields || item.fields.length === 0) {
      auditLog(warnLevel, 'WEBMCP_ITEM_NOT_FOUND', 'Vault item has no fillable fields')
      return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'VAULT_ITEM_DELETED', message: 'Vault item has no fillable fields' } }
    }

    // ── Step 5: Origin validation ──
    //
    // Logs origin match tier and HA status but NEVER raw domains or UUIDs.
    // Error codes are stable:
    //   ORIGIN_MISMATCH — domain does not match (HA: hard block)
    //   PSL_BLOCKED     — public suffix domain (HA: hard block, non-HA: flagged)
    //
    const pageOrigin = safeOrigin()
    const itemDomain = item.domain || ''
    let pslDomain = false

    try {
      pslDomain = isPublicSuffix(new URL(pageOrigin).hostname)
    } catch {
      // Unparseable origin — treat as non-PSL, let other gates handle it
    }

    if (itemDomain) {
      const originResult = matchOrigin(itemDomain, pageOrigin)
      const matchTier = originResult.matchType // 'exact' | 'www_equivalent' | 'subdomain_*' | 'none'

      // Always log the match tier + HA status (no raw domains)
      auditLogSafe(infoLevel, 'WEBMCP_ORIGIN_CHECK', 'Origin validation performed', {
        originTier: matchTier,
        ha,
        psl: pslDomain,
      })

      if (!originResult.matches) {
        if (ha) {
          auditLog('security', 'WEBMCP_ORIGIN_MISMATCH', `HA strict: origin mismatch (tier=${matchTier})`)
          return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'ORIGIN_MISMATCH', message: 'Domain mismatch (HA mode enforces strict origin)' } }
        }
        // Non-HA: warn but allow (user decides via overlay)
        auditLog('warn', 'WEBMCP_ORIGIN_MISMATCH', `Origin mismatch (tier=${matchTier}) — user will decide via overlay`)
      }
    } else {
      // No domain on the vault item — log that origin check was skipped
      auditLogSafe(infoLevel, 'WEBMCP_ORIGIN_CHECK', 'Origin validation skipped — no item domain', {
        originTier: 'no_domain',
        ha,
        psl: pslDomain,
      })
    }

    // ── Step 5b: Public suffix check ──
    //
    // PSL domains (e.g., *.github.io, *.netlify.app) are multi-tenant.
    // HA mode: hard-block preview creation entirely (fail-closed).
    // Non-HA:  allow but flag in telemetry for safe-mode downstream.
    //
    if (pslDomain) {
      if (ha) {
        auditLog('security', 'WEBMCP_PSL_BLOCKED', 'HA mode blocks preview on public suffix domain')
        return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'PSL_BLOCKED', message: 'Public suffix domain blocked under HA mode' } }
      }
      // Non-HA: warn, allow preview but downstream safe-mode may restrict
      auditLog('warn', 'WEBMCP_PSL_WARNING', 'Public suffix domain — preview allowed, safe-mode flagged')
    }

    // ── Step 6: Resolve DOM targets ──
    const profile = itemToProfile(item)
    const { targets, scanMeta } = resolveTargets(params.targetHints, profile)

    if (targets.length === 0) {
      auditLog(infoLevel, 'WEBMCP_NO_TARGETS', 'No fillable fields matched on the current page')
      return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'NO_TARGETS', message: 'No fillable fields found on this page' } }
    }

    // ── Step 7: guardElement() on every target ──
    for (const t of targets) {
      const guard = guardElement(t.element as HTMLElement)
      if (!guard.safe) {
        auditLog(warnLevel, 'WEBMCP_TARGET_GUARD_FAILED', `Guard rejected: ${guard.code}`)
        // Clamp to ELEMENT_HIDDEN — guard.code is internal and NOT part of the
        // public WebMcpErrorCode contract.  Callers see a stable enum only.
        return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'ELEMENT_HIDDEN', message: guard.reason } }
      }
    }

    // ── Step 8: Take fingerprints (async — SHA-256) ──
    const overlayTargets: OverlayTarget[] = []
    for (const t of targets) {
      const fingerprint = await takeFingerprint(
        t.element as HTMLElement,
        ha ? 15_000 : undefined,
      )
      const sensitive = t.field.sensitive ?? false
      overlayTargets.push({
        field: t.field,
        element: t.element,
        fingerprint,
        displayValue: computeDisplayValue(t.field.value, sensitive, 'masked', DEFAULT_MASKING),
        commitValue: t.field.value,
      })
    }

    // ── Step 9: Build OverlaySession ──
    const sessionId = crypto.randomUUID()
    const session: OverlaySession = {
      id: sessionId,
      profile,
      targets: overlayTargets,
      createdAt: Date.now(),
      timeoutMs: ha ? 30_000 : 60_000,
      origin: 'quickselect',
      state: 'preview',
    }

    // ── Step 10: Log existing overlay replacement (MAX_ACTIVE_SESSIONS=1) ──
    // showOverlay() enforces the singleton invariant: the previous session
    // is marked 'dismissed' and its promise resolved with { action: 'cancel' }.
    const existingSessionId = getActiveSessionId()
    if (existingSessionId) {
      auditLog(infoLevel, 'WEBMCP_OVERLAY_REPLACED', 'Existing overlay dismissed for new WebMCP preview (MAX_ACTIVE_SESSIONS=1)')
    }

    // ── Step 11: Show overlay (returns promise — we do NOT await it) ──
    // The promise resolves when the user interacts (insert/cancel/expire).
    // We fire-and-forget: the overlay and commit path are entirely user-driven.
    showOverlay(session)

    // ── Step 12: Partial scan detection ──
    // If the scan was truncated (DoS caps), log and flag deterministically.
    // Only numbers are exposed — no selectors, URLs, domains, or PII.
    if (scanMeta?.partial) {
      auditLogSafe(
        warnLevel,
        'WEBMCP_PARTIAL_SCAN',
        'Scan truncated during WebMCP preview',
        {
          partialReason: scanMeta.partialReason ?? 'unknown',
          evaluatedCount: scanMeta.evaluatedCount,
          candidateCount: scanMeta.candidateCount,
          ha,
        },
      )
      emitTelemetryEvent('webmcp_partial_scan', {
        reason: scanMeta.partialReason ?? 'unknown',
        ha,
        evaluatedCount: scanMeta.evaluatedCount,
        candidateCount: scanMeta.candidateCount,
      })
    }

    // ── Step 13: Audit success ──
    auditLogSafe(infoLevel, 'WEBMCP_PREVIEW_CREATED', 'WebMCP preview created', {
      fieldCount: overlayTargets.length,
      ha,
    })
    emitTelemetryEvent('webmcp_preview', {
      fieldCount: overlayTargets.length,
      haMode: ha,
      ...(pslDomain ? { safeMode: 'psl_domain' } : {}),
    })

    return {
      resultVersion: WEBMCP_RESULT_VERSION,
      success: true,
      sessionId,
      previewFieldCount: overlayTargets.length,
      // Partial scan contract: deterministic flags, numbers only
      ...(scanMeta ? {
        partialScan: scanMeta.partial,
        ...(scanMeta.partial ? { partialReason: scanMeta.partialReason } : {}),
        evaluatedCount: scanMeta.evaluatedCount,
        candidateCount: scanMeta.candidateCount,
      } : {}),
    }
  } catch (err) {
    const redacted = redactError(err)
    auditLog('error', 'WEBMCP_PREVIEW_FAILED', `Unexpected error: ${redacted}`)
    return { resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }
  }
}

// ============================================================================
// §4  Parameter Validation
// ============================================================================

interface ValidationResult {
  valid: boolean
  reason?: string
}

function validateParams(params: WebMcpFillPreviewParams): ValidationResult {
  if (!params || typeof params !== 'object') {
    return { valid: false, reason: 'Missing or invalid params object' }
  }

  if (!params.itemId || typeof params.itemId !== 'string') {
    return { valid: false, reason: 'Missing itemId' }
  }

  if (!UUID_RE.test(params.itemId)) {
    return { valid: false, reason: 'itemId is not a valid UUID' }
  }

  if (params.targetHints !== undefined && params.targetHints !== null) {
    if (typeof params.targetHints !== 'object' || Array.isArray(params.targetHints)) {
      return { valid: false, reason: 'targetHints must be a record object' }
    }

    const keys = Object.keys(params.targetHints)
    if (keys.length > MAX_HINT_COUNT) {
      return { valid: false, reason: `targetHints exceeds max count (${MAX_HINT_COUNT})` }
    }

    for (const [kind, selector] of Object.entries(params.targetHints)) {
      if (typeof selector !== 'string') {
        return { valid: false, reason: `targetHints["${kind}"] must be a string` }
      }
      if (selector.length > MAX_SELECTOR_LENGTH) {
        return { valid: false, reason: `targetHints["${kind}"] selector exceeds max length (${MAX_SELECTOR_LENGTH})` }
      }
    }
  }

  return { valid: true }
}

// ============================================================================
// §5  Target Resolution
// ============================================================================

interface ResolvedTarget {
  element: unknown
  field: FieldEntry
}

/** Scan metadata returned alongside resolved targets (numbers only — no PII). */
interface ScanMeta {
  partial: boolean
  partialReason?: 'element_cap' | 'time_budget' | 'candidate_cap'
  evaluatedCount: number
  candidateCount: number
}

interface ResolveResult {
  targets: ResolvedTarget[]
  scanMeta?: ScanMeta
}

/**
 * Resolve DOM targets from optional hints or by scanning the page.
 *
 * Strategy:
 *   1. If targetHints are provided, querySelector each one and match to profile fields.
 *   2. Otherwise, use collectCandidates() and map by FieldKind to profile fields.
 *
 * When scanning, returns scan metadata (partial flag, counts) for the caller
 * to include in the adapter result.  No selectors, URLs, or PII in scanMeta.
 */
function resolveTargets(
  hints: Record<string, string> | undefined,
  profile: VaultProfile,
): ResolveResult {
  if (hints && Object.keys(hints).length > 0) {
    return { targets: resolveFromHints(hints, profile) }
  }
  return resolveFromScan(profile)
}

function resolveFromHints(
  hints: Record<string, string>,
  profile: VaultProfile,
): ResolvedTarget[] {
  const results: ResolvedTarget[] = []

  for (const [kind, selector] of Object.entries(hints)) {
    const field = profile.fields.find(f => f.kind === kind)
    if (!field) continue

    let element: Element | null = null
    try {
      element = document.querySelector(selector)
    } catch {
      // Invalid selector — skip silently
      continue
    }
    if (!element) continue

    // Must be a valid target tag
    if (!VALID_TARGET_TAGS.has(element.tagName)) continue

    results.push({ element, field })
  }

  return results
}

function resolveFromScan(profile: VaultProfile): ResolveResult {
  const scanToggles = { login: true, identity: true, company: true, custom: true }
  const scan: ScanResult = collectCandidates(scanToggles)
  const targets: ResolvedTarget[] = []
  const usedKinds = new Set<string>()

  for (const candidate of scan.candidates) {
    if (!candidate.matchedKind) continue
    if (usedKinds.has(candidate.matchedKind)) continue

    const field = profile.fields.find(f => f.kind === candidate.matchedKind)
    if (!field || !field.value) continue

    usedKinds.add(candidate.matchedKind)
    targets.push({ element: candidate.element, field })
  }

  return {
    targets,
    scanMeta: {
      partial: scan.partial,
      partialReason: scan.partialReason,
      evaluatedCount: scan.elementsEvaluated,
      candidateCount: scan.candidates.length,
    },
  }
}

// ============================================================================
// §6  FillProjection → VaultProfile Conversion
// ============================================================================

/**
 * Convert a FillProjection into a VaultProfile for the overlay session.
 *
 * Maps the flat Field[] array from the vault item to typed FieldEntry[]
 * using the item's category to determine the appropriate FieldKind prefix.
 *
 * Note: FillProjection intentionally omits updated_at — the profile
 * sets it to the current timestamp (session-local, not vault-level).
 */
function itemToProfile(item: FillProjection): VaultProfile {
  const section = categoryToSection(item.category)
  const kindPrefix = sectionToKindPrefix(section)
  const fields: FieldEntry[] = []

  for (const f of item.fields) {
    if (!f.value) continue

    const kind = mapFieldKeyToKind(f.key, kindPrefix)
    if (!kind) continue

    fields.push({
      kind,
      label: f.key.replace(/_/g, ' '),
      value: f.value,
      sensitive: f.type === 'password',
    })
  }

  return {
    itemId: item.id,
    title: item.title,
    section,
    domain: item.domain,
    fields,
    updatedAt: Date.now(),
  }
}

function categoryToSection(category: string): 'login' | 'identity' | 'company' | 'custom' {
  switch (category) {
    case 'password': return 'login'
    case 'identity': return 'identity'
    case 'company': return 'company'
    default: return 'custom'
  }
}

function sectionToKindPrefix(section: string): string {
  switch (section) {
    case 'login': return 'login'
    case 'identity': return 'identity'
    case 'company': return 'company'
    default: return 'custom'
  }
}

/** Map a vault field key (e.g., 'username', 'password') to a canonical FieldKind. */
function mapFieldKeyToKind(key: string, prefix: string): FieldKind | null {
  const FIELD_MAP: Record<string, Record<string, FieldKind>> = {
    login: {
      username: 'login.username',
      email: 'login.email',
      password: 'login.password',
      new_password: 'login.new_password',
      otp_code: 'login.otp_code',
      recovery_code: 'login.recovery_code',
      url: 'login.url',
    },
    identity: {
      first_name: 'identity.first_name',
      surname: 'identity.last_name',
      last_name: 'identity.last_name',
      full_name: 'identity.full_name',
      email: 'identity.email',
      phone: 'identity.phone',
      street: 'identity.street',
      street_number: 'identity.street_number',
      postal_code: 'identity.postal_code',
      city: 'identity.city',
      state: 'identity.state',
      country: 'identity.country',
      date_of_birth: 'identity.birthday',
      tax_id: 'identity.tax_id',
    },
    company: {
      name: 'company.name',
      email: 'company.email',
      phone: 'company.phone',
      vat_number: 'company.vat_number',
      tax_id: 'company.tax_id',
      iban: 'company.iban',
    },
  }

  const sectionMap = FIELD_MAP[prefix]
  if (!sectionMap) return null
  return sectionMap[key] ?? null
}

// ============================================================================
// §7  Helpers
// ============================================================================

function safeOrigin(): string {
  try {
    return window.location.origin
  } catch {
    return 'unknown'
  }
}
