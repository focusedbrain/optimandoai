// ============================================================================
// WRVault Autofill — Error Resistance & Hardening
// ============================================================================
//
// This module is the single source of truth for:
//   1. Failure mode catalogue — every known way the autofill pipeline can fail
//   2. Error codes + user-friendly messages
//   3. Safe-mode policy — when uncertain, show QuickInsert not auto-insert
//   4. Visibility / iframe / clickjacking guards
//   5. Race-condition mitigations (DOM change between preview & commit)
//   6. SPA navigation handling
//   7. Multi-account & subdomain policy
//   8. Data-minimization invariants
//   9. Local-only audit logger with secret redaction
//
// Every public function is a pure guard or utility — no DOM mutation, no UI.
// Modules import guards from here and call them at their boundaries.
//
// ============================================================================

// ============================================================================
// §1  FAILURE MODE CATALOGUE
// ============================================================================
//
// Each entry documents:
//   ID          — stable identifier (used in error codes + telemetry)
//   Category    — which concern it addresses
//   Trigger     — when/how it occurs
//   Mitigation  — what the code does about it
//   Severity    — 'block' (abort pipeline) | 'warn' (degrade gracefully)
//
// ============================================================================

export interface FailureMode {
  id: string
  category: FailureCategory
  trigger: string
  mitigation: string
  severity: 'block' | 'warn'
}

export type FailureCategory =
  | 'visibility'
  | 'iframe'
  | 'clickjacking'
  | 'race_condition'
  | 'spa_navigation'
  | 'multi_account'
  | 'data_minimization'
  | 'logging'
  | 'session'
  | 'dom_integrity'
  | 'vault'

export const FAILURE_MODES: readonly FailureMode[] = [
  // ── Visibility ──
  {
    id: 'VIS_ZERO_RECT',
    category: 'visibility',
    trigger: 'Target element has zero-dimension bounding rect (display:none, collapsed parent, off-screen)',
    mitigation: 'Block commit. Reject at safety check gate. Show error: "Field is no longer visible."',
    severity: 'block',
  },
  {
    id: 'VIS_OPACITY_ZERO',
    category: 'visibility',
    trigger: 'Element or ancestor has opacity < 0.01 (invisible but interactable — classic clickjacking)',
    mitigation: 'Block commit. Check computed opacity chain up to 3 ancestors.',
    severity: 'block',
  },
  {
    id: 'VIS_OFFSCREEN',
    category: 'visibility',
    trigger: 'Element is positioned outside the viewport (negative coords, overflow:hidden parent)',
    mitigation: 'Block commit. Verify bounding rect intersects viewport.',
    severity: 'block',
  },
  {
    id: 'VIS_COVERED',
    category: 'visibility',
    trigger: 'Another element overlays the target at its center point (overlay / modal / cookie banner)',
    mitigation: 'Warn. Use elementFromPoint to detect if target is obscured. Fall back to QuickInsert.',
    severity: 'warn',
  },

  // ── Iframe ──
  {
    id: 'IFRAME_CROSS_ORIGIN',
    category: 'iframe',
    trigger: 'Target field is inside a cross-origin iframe',
    mitigation: 'Block. Content scripts cannot access cross-origin iframes. Hard-reject in scanner.',
    severity: 'block',
  },
  {
    id: 'IFRAME_SANDBOX',
    category: 'iframe',
    trigger: 'Page is sandboxed iframe without allow-same-origin',
    mitigation: 'Block. Cannot verify origin or fingerprint in sandboxed context.',
    severity: 'block',
  },
  {
    id: 'IFRAME_NESTED_DEEP',
    category: 'iframe',
    trigger: 'Target is nested > 2 iframe levels deep',
    mitigation: 'Warn and fall back to QuickInsert. Deep nesting indicates suspicious page structure.',
    severity: 'warn',
  },

  // ── Clickjacking ──
  {
    id: 'CJ_TRANSPARENT_OVERLAY',
    category: 'clickjacking',
    trigger: 'A transparent or nearly-transparent element covers the target (opacity < 0.1, pointer-events:auto)',
    mitigation: 'Block if covering element is not our own Shadow DOM host. Log and refuse.',
    severity: 'block',
  },
  {
    id: 'CJ_ELEMENT_SWAPPED',
    category: 'clickjacking',
    trigger: 'Between overlay preview and commit, the element at the expected position is a different element',
    mitigation: 'Block. elementFromPoint at commit time must return the same element (or a child of it).',
    severity: 'block',
  },
  {
    id: 'CJ_OVERLAY_REPOSITIONED',
    category: 'clickjacking',
    trigger: 'Page script repositioned our overlay host (e.g., moved it offscreen to make the user click something else)',
    mitigation: 'Block. Position watchdog detects host movement. Auto-dismiss overlay if host is outside viewport.',
    severity: 'block',
  },

  // ── Race conditions ──
  {
    id: 'RACE_DOM_MUTATED',
    category: 'race_condition',
    trigger: 'DOM structure changed between fingerprint capture and commit (class, id, parent, type)',
    mitigation: 'Block. Full fingerprint revalidation at commit time. Hash mismatch → refuse.',
    severity: 'block',
  },
  {
    id: 'RACE_ELEMENT_DETACHED',
    category: 'race_condition',
    trigger: 'Target element removed from DOM between preview and commit (SPA re-render)',
    mitigation: 'Block. isConnected check before commit. Error code: ELEMENT_DETACHED.',
    severity: 'block',
  },
  {
    id: 'RACE_SESSION_EXPIRED',
    category: 'race_condition',
    trigger: 'User took too long; session timeout elapsed between consent and commit',
    mitigation: 'Block. Session timestamp check at commit gate. Error code: SESSION_EXPIRED.',
    severity: 'block',
  },
  {
    id: 'RACE_CONCURRENT_FILL',
    category: 'race_condition',
    trigger: 'Two autofill operations active simultaneously (user clicked insert, then triggered another)',
    mitigation: 'Block second operation. Singleton overlay/session pattern prevents concurrency.',
    severity: 'block',
  },
  {
    id: 'RACE_VALUE_OVERWRITTEN',
    category: 'race_condition',
    trigger: 'Framework reactivity overwrites our injected value immediately after setValueSafely',
    mitigation: 'Warn. Verify value after dispatch. If mismatch, retry once with direct assign strategy.',
    severity: 'warn',
  },

  // ── SPA navigation ──
  {
    id: 'SPA_ROUTE_CHANGED',
    category: 'spa_navigation',
    trigger: 'pushState/replaceState or popstate fired while overlay is open',
    mitigation: 'Auto-dismiss overlay. Invalidate scan cache. Trigger fresh scan after 200ms settle.',
    severity: 'warn',
  },
  {
    id: 'SPA_DOM_REPLACED',
    category: 'spa_navigation',
    trigger: 'MutationObserver detects bulk childList removal (>5 nodes) containing our target',
    mitigation: 'Auto-dismiss overlay if target detached. Rescan DOM after debounce.',
    severity: 'warn',
  },
  {
    id: 'SPA_HISTORY_LOOP',
    category: 'spa_navigation',
    trigger: 'pushState fires repeatedly in rapid succession (>5 in 2s — router thrashing)',
    mitigation: 'Debounce navigation handler. Suppress scan until stable (2s gap between pushStates).',
    severity: 'warn',
  },

  // ── Multi-account / subdomain ──
  {
    id: 'MULTI_SUBDOMAIN_MISMATCH',
    category: 'multi_account',
    trigger: 'Vault entry domain is "app.example.com" but page is "admin.example.com"',
    mitigation: 'Warn. Demote confidence score. Show domain mismatch indicator in QuickSelect results.',
    severity: 'warn',
  },
  {
    id: 'MULTI_ACCOUNT_AMBIGUITY',
    category: 'multi_account',
    trigger: 'Multiple vault entries match the same domain with different usernames',
    mitigation: 'Do not auto-insert. Fall back to QuickInsert with all matching entries listed.',
    severity: 'warn',
  },
  {
    id: 'MULTI_PSL_MISMATCH',
    category: 'multi_account',
    trigger: 'Public suffix mismatch: entry for "github.io" should not match "attacker.github.io"',
    mitigation: 'Block auto-insert for public suffix domains. Require exact subdomain match.',
    severity: 'block',
  },

  // ── Data minimization ──
  {
    id: 'DM_PASSWORD_IN_DOM',
    category: 'data_minimization',
    trigger: 'Password value placed in a DOM attribute or text node (not inside input.value)',
    mitigation: 'Never happens by design: password only set via setValueSafely into input.value. All preview uses masking.',
    severity: 'block',
  },
  {
    id: 'DM_PASSWORD_IN_LOG',
    category: 'data_minimization',
    trigger: 'Password or sensitive field value appears in console.log or telemetry',
    mitigation: 'Audit logger redacts all values. Telemetry only contains field kinds, error codes, timing.',
    severity: 'block',
  },
  {
    id: 'DM_INDEX_LEAKAGE',
    category: 'data_minimization',
    trigger: 'Vault index (vaultIndex.ts) stores password values in search tokens',
    mitigation: 'Never happens by design: index only stores title, domain, username, category. Passwords excluded.',
    severity: 'block',
  },
  {
    id: 'DM_CLIPBOARD_LINGER',
    category: 'data_minimization',
    trigger: 'Copied password remains on clipboard indefinitely',
    mitigation: 'Auto-clear clipboard after 30s (DEFAULT_MASKING.clipboardClearMs). Timer set in overlayManager.',
    severity: 'warn',
  },

  // ── Logging ──
  {
    id: 'LOG_SECRET_LEAK',
    category: 'logging',
    trigger: 'console.error / console.log called with a raw Error that contains sensitive data in stack',
    mitigation: 'All catch blocks use redactError() before logging. Stack traces are kept, values stripped.',
    severity: 'block',
  },
  {
    id: 'LOG_REMOTE_EXFIL',
    category: 'logging',
    trigger: 'Audit events transmitted over the network',
    mitigation: 'Audit log is strictly local (in-memory ring buffer + optional chrome.storage.local). No network.',
    severity: 'block',
  },

  // ── Session ──
  {
    id: 'SESS_VAULT_LOCKED',
    category: 'session',
    trigger: 'Vault locks while overlay is open or commit is in progress',
    mitigation: 'Auto-dismiss overlay. Clear index. Refuse commit. Error code: VAULT_LOCKED.',
    severity: 'block',
  },
  {
    id: 'SESS_TOKEN_EXPIRED',
    category: 'session',
    trigger: 'VSBT token expired during autofill session',
    mitigation: 'API call to vault fails with 401. Catch and dismiss UI gracefully.',
    severity: 'block',
  },

  // ── DOM integrity ──
  {
    id: 'DOM_PROTOTYPE_TAMPERED',
    category: 'dom_integrity',
    trigger: 'Page script overrode HTMLInputElement.prototype.value setter',
    mitigation: 'Warn. Detect in tryNativeSetter. Fall through to direct assign + setAttribute strategies.',
    severity: 'warn',
  },
  {
    id: 'DOM_EVENT_SUPPRESSED',
    category: 'dom_integrity',
    trigger: 'Page script called stopImmediatePropagation on our dispatched input/change events',
    mitigation: 'Warn. No reliable mitigation — verify value after dispatch and retry if needed.',
    severity: 'warn',
  },
] as const


// ============================================================================
// §2  ERROR CODES + USER-FRIENDLY MESSAGES
// ============================================================================

/**
 * Hardened error codes — superset of CommitErrorCode.
 * Covers all pipeline stages, not just commit.
 */
export type HardenedErrorCode =
  // Commit-level (reuse from insertionPipeline.ts)
  | 'FINGERPRINT_MISMATCH'
  | 'FINGERPRINT_EXPIRED'
  | 'ELEMENT_DETACHED'
  | 'ELEMENT_HIDDEN'
  | 'ELEMENT_MOVED'
  | 'ELEMENT_NOT_FOCUSABLE'
  | 'CROSS_ORIGIN_BLOCKED'
  | 'SESSION_EXPIRED'
  | 'SESSION_INVALID'
  | 'VALUE_DISPATCH_FAILED'
  | 'READONLY_ELEMENT'
  | 'FRAMEWORK_SETTER_FAILED'
  | 'VAULT_LOCKED'
  | 'VAULT_ITEM_DELETED'
  | 'CAPABILITY_DENIED'
  | 'SUSPICIOUS_DOM_MUTATION'
  | 'MULTIPLE_ELEMENTS_MATCH'
  | 'USER_CANCELLED'
  // Hardening additions
  | 'ELEMENT_COVERED'
  | 'ELEMENT_OFFSCREEN'
  | 'IFRAME_BLOCKED'
  | 'CLICKJACK_DETECTED'
  | 'SPA_NAVIGATION'
  | 'MULTI_ACCOUNT_AMBIGUOUS'
  | 'PSL_MISMATCH'
  | 'VALUE_OVERWRITTEN'
  | 'CONCURRENT_OPERATION'
  | 'INDEX_BUILD_FAILED'
  | 'SCAN_TIMEOUT'
  | 'SAFE_MODE_FALLBACK'

/** User-friendly error messages — never expose internals or secrets. */
export const ERROR_MESSAGES: Record<HardenedErrorCode, string> = {
  FINGERPRINT_MISMATCH:     'The field changed since the preview was shown. Please try again.',
  FINGERPRINT_EXPIRED:      'The preview expired. Please open a new preview.',
  ELEMENT_DETACHED:         'The field was removed from the page. It may have been a temporary form.',
  ELEMENT_HIDDEN:           'The field is no longer visible on the page.',
  ELEMENT_MOVED:            'The field moved to a different position. Please try again.',
  ELEMENT_NOT_FOCUSABLE:    'The field is currently disabled or not interactive.',
  CROSS_ORIGIN_BLOCKED:     'This field is in a different security context and cannot be filled.',
  SESSION_EXPIRED:          'The session timed out. Please re-open the autofill preview.',
  SESSION_INVALID:          'The session is no longer valid. Please try again.',
  VALUE_DISPATCH_FAILED:    'Could not set the value on this field. The website may prevent autofill.',
  READONLY_ELEMENT:         'This field is read-only and cannot be filled.',
  FRAMEWORK_SETTER_FAILED:  'The website\'s framework blocked the value change. Try clicking the field first.',
  VAULT_LOCKED:             'The vault is locked. Please unlock and try again.',
  VAULT_ITEM_DELETED:       'The vault entry has been deleted.',
  CAPABILITY_DENIED:        'Your current plan does not support this feature.',
  SUSPICIOUS_DOM_MUTATION:   'Suspicious page change detected. Autofill blocked for safety.',
  MULTIPLE_ELEMENTS_MATCH:  'Multiple matching fields found. Please use QuickInsert to select manually.',
  USER_CANCELLED:           'Cancelled.',
  ELEMENT_COVERED:          'The field appears to be covered by another element.',
  ELEMENT_OFFSCREEN:        'The field is not visible in the current viewport.',
  IFRAME_BLOCKED:           'This field is inside a restricted frame and cannot be filled.',
  CLICKJACK_DETECTED:       'Suspicious page overlay detected. Autofill blocked for your safety.',
  SPA_NAVIGATION:           'The page navigated away. Please try again on the new page.',
  MULTI_ACCOUNT_AMBIGUOUS:  'Multiple accounts match this site. Please select one manually.',
  PSL_MISMATCH:             'Domain mismatch: this entry belongs to a different subdomain.',
  VALUE_OVERWRITTEN:        'The website immediately overwrote the filled value. Try a different approach.',
  CONCURRENT_OPERATION:     'Another autofill operation is already in progress.',
  INDEX_BUILD_FAILED:       'Could not load vault entries. Please check your connection.',
  SCAN_TIMEOUT:             'Field scanning took too long and was stopped.',
  SAFE_MODE_FALLBACK:       'Low confidence match. Use QuickInsert to select the correct entry.',
}

/**
 * Get a user-friendly message for an error code.
 * Falls back to a generic message for unknown codes.
 */
export function getUserMessage(code: HardenedErrorCode | string): string {
  return ERROR_MESSAGES[code as HardenedErrorCode] ?? 'An unexpected error occurred. Please try again.'
}


// ============================================================================
// §3  SAFE-MODE POLICY
// ============================================================================
//
// Safe mode defines when auto-insert is suppressed in favor of QuickInsert.
// The principle: "When uncertain, show QuickInsert, never auto-insert."
//
// Auto-insert is ONLY allowed when ALL of the following are true:
//   1. Exactly one vault profile matches the domain (no multi-account ambiguity)
//   2. ALL field mappings are above CONFIDENCE_THRESHOLD (60)
//   3. NO field mapping is flagged as ambiguous (runner-up within 15 points)
//   4. Form context is 'login' or 'signup' (not 'unknown' or 'checkout')
//   5. No anti-signals fired on any target element
//   6. All targets pass visibility + iframe + clickjacking checks
//   7. Domain is not a public-suffix domain (github.io, herokuapp.com, etc.)
//
// If any condition fails → show trigger icon, user clicks → QuickInsert.
// ============================================================================

import type { FieldCandidate, MatchResult } from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { FormContext, VaultProfile } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { CONFIDENCE_THRESHOLD } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import type { FieldMapping } from './fieldScanner'
import {
  matchOrigin,
  isPublicSuffix as isPublicSuffixStrict,
  classifyRelevance,
} from '../../../../../packages/shared/src/vault/originPolicy'
import { isHAActive, type HAModeState } from '../../../../../packages/shared/src/vault/haMode'

/** Result of the safe-mode decision. */
export interface SafeModeDecision {
  /** Whether auto-insert is permitted. */
  autoInsertAllowed: boolean
  /** If not allowed, the reason(s) — for logging and debug. */
  reasons: SafeModeReason[]
  /** Suggested action for the orchestrator. */
  action: 'auto_insert' | 'show_trigger_icon' | 'do_nothing'
}

export type SafeModeReason =
  | 'multi_account_ambiguity'
  | 'low_confidence_mapping'
  | 'ambiguous_mapping'
  | 'unknown_form_context'
  | 'checkout_form'
  | 'anti_signals_fired'
  | 'visibility_check_failed'
  | 'public_suffix_domain'
  | 'no_mappings'
  | 'no_profiles'
  | 'ha_mode_active'

/** Well-known public suffix patterns that should never auto-insert. */
const PUBLIC_SUFFIX_PATTERNS = [
  /\.github\.io$/i,
  /\.herokuapp\.com$/i,
  /\.netlify\.app$/i,
  /\.vercel\.app$/i,
  /\.pages\.dev$/i,
  /\.web\.app$/i,
  /\.firebaseapp\.com$/i,
  /\.azurewebsites\.net$/i,
  /\.cloudfront\.net$/i,
  /\.s3\.amazonaws\.com$/i,
  /\.appspot\.com$/i,
  /\.blogspot\.com$/i,
  /\.wordpress\.com$/i,
  /\.tumblr\.com$/i,
  /\.gitlab\.io$/i,
  /\.bitbucket\.io$/i,
  /\.surge\.sh$/i,
  /\.now\.sh$/i,
  /\.fly\.dev$/i,
  /\.render\.com$/i,
  /\.railway\.app$/i,
]

/**
 * Evaluate whether auto-insert is safe, or whether to fall back to QuickInsert.
 *
 * Call this after pickBestMapping() returns results.
 */
export function evaluateSafeMode(
  mappings: FieldMapping[],
  profiles: VaultProfile[],
  formContext: FormContext,
  domain: string,
  candidates: FieldCandidate[],
  haState?: HAModeState | null,
): SafeModeDecision {
  const reasons: SafeModeReason[] = []

  // ── HA Mode hard block: auto-insert is NEVER allowed ──
  if (isHAActive(haState)) {
    return {
      autoInsertAllowed: false,
      reasons: ['ha_mode_active'],
      action: mappings.length > 0 ? 'show_trigger_icon' : 'do_nothing',
    }
  }

  // 0. No profiles or mappings → nothing to do
  if (profiles.length === 0) {
    return { autoInsertAllowed: false, reasons: ['no_profiles'], action: 'do_nothing' }
  }
  if (mappings.length === 0) {
    return { autoInsertAllowed: false, reasons: ['no_mappings'], action: 'show_trigger_icon' }
  }

  // 1. Multi-account ambiguity: >1 exact-origin-matching profile
  const domainProfiles = profiles.filter(p => {
    if (!p.domain) return false
    const tier = classifyRelevance(p.domain, domain)
    return tier === 'exact_origin' || tier === 'www_equivalent'
  })
  if (domainProfiles.length > 1) {
    reasons.push('multi_account_ambiguity')
  }

  // 2. Low-confidence mapping
  for (const m of mappings) {
    if (m.confidence < CONFIDENCE_THRESHOLD) {
      reasons.push('low_confidence_mapping')
      break
    }
  }

  // 3. Ambiguous mapping
  if (mappings.some(m => m.ambiguous)) {
    reasons.push('ambiguous_mapping')
  }

  // 4. Unknown or checkout form context
  if (formContext === 'unknown') {
    reasons.push('unknown_form_context')
  }
  if (formContext === 'checkout') {
    reasons.push('checkout_form')
  }

  // 5. Anti-signals fired on any candidate
  for (const c of candidates) {
    if (c.match.antiSignals && c.match.antiSignals.length > 0 &&
        c.match.antiSignals.some(s => s.matched)) {
      reasons.push('anti_signals_fired')
      break
    }
  }

  // 6. Public suffix domain
  if (isPublicSuffixDomain(domain)) {
    reasons.push('public_suffix_domain')
  }

  const autoInsertAllowed = reasons.length === 0
  return {
    autoInsertAllowed,
    reasons,
    action: autoInsertAllowed ? 'auto_insert' : 'show_trigger_icon',
  }
}


// ============================================================================
// §4  VISIBILITY + IFRAME + CLICKJACKING GUARDS
// ============================================================================

/** Guard result for pre-scan and pre-overlay element validation. */
export interface ElementGuardResult {
  safe: boolean
  code: HardenedErrorCode | null
  reason: string
}

/**
 * Full guard battery for an element BEFORE creating an overlay session.
 * Runs faster than the commit-time safety checks (no fingerprint).
 *
 * Checks (in order):
 *   1. Connected to DOM
 *   2. Bounding rect non-zero
 *   3. Not display:none / visibility:hidden / opacity:0
 *   4. Within viewport (not offscreen)
 *   5. Not inside cross-origin iframe
 *   6. Not inside sandboxed iframe
 *   7. Not covered by another element (elementFromPoint)
 *   8. Not inside inert subtree
 */
export function guardElement(element: HTMLElement): ElementGuardResult {
  // 1. Connected
  if (!element || !element.isConnected) {
    return { safe: false, code: 'ELEMENT_DETACHED', reason: 'Element is not in the DOM' }
  }

  // 2. Non-zero rect
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return { safe: false, code: 'ELEMENT_HIDDEN', reason: 'Element has zero dimensions' }
  }

  // 3. Computed visibility
  const computed = getComputedStyle(element)
  if (computed.display === 'none') {
    return { safe: false, code: 'ELEMENT_HIDDEN', reason: 'Element has display:none' }
  }
  if (computed.visibility === 'hidden') {
    return { safe: false, code: 'ELEMENT_HIDDEN', reason: 'Element has visibility:hidden' }
  }
  if (parseFloat(computed.opacity) < 0.01) {
    return { safe: false, code: 'ELEMENT_HIDDEN', reason: 'Element has opacity near zero' }
  }

  // Check ancestor opacity (clickjacking vector)
  let ancestor: HTMLElement | null = element.parentElement
  for (let i = 0; i < 3 && ancestor; i++) {
    const ancestorStyle = getComputedStyle(ancestor)
    if (parseFloat(ancestorStyle.opacity) < 0.01) {
      return { safe: false, code: 'CLICKJACK_DETECTED', reason: 'Ancestor has opacity near zero' }
    }
    ancestor = ancestor.parentElement
  }

  // 4. Within viewport
  if (rect.bottom < 0 || rect.top > window.innerHeight ||
      rect.right < 0 || rect.left > window.innerWidth) {
    return { safe: false, code: 'ELEMENT_OFFSCREEN', reason: 'Element is outside the viewport' }
  }

  // 5. Cross-origin iframe
  try {
    if (window.self !== window.top) {
      try {
        // Accessing parent origin throws if cross-origin
        const _parentOrigin = window.parent.location.origin
      } catch {
        return { safe: false, code: 'IFRAME_BLOCKED', reason: 'Content script is in a cross-origin iframe' }
      }
    }
  } catch {
    return { safe: false, code: 'IFRAME_BLOCKED', reason: 'Cannot determine frame context' }
  }

  // 6. Sandboxed iframe
  try {
    if (window.self !== window.top) {
      const frameEl = window.frameElement
      if (frameEl && frameEl.hasAttribute('sandbox')) {
        const sandbox = frameEl.getAttribute('sandbox') ?? ''
        if (!sandbox.includes('allow-same-origin')) {
          return { safe: false, code: 'IFRAME_BLOCKED', reason: 'Inside sandboxed iframe without allow-same-origin' }
        }
      }
    }
  } catch {
    // Cannot access frameElement in cross-origin → already caught above
  }

  // 7. Element covered (elementFromPoint check)
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  try {
    const topEl = document.elementFromPoint(centerX, centerY)
    if (topEl && topEl !== element && !element.contains(topEl) && !isOurShadowHost(topEl)) {
      // Check if the covering element is transparent (clickjacking indicator)
      const coverStyle = getComputedStyle(topEl as HTMLElement)
      if (parseFloat(coverStyle.opacity) < 0.1) {
        return { safe: false, code: 'CLICKJACK_DETECTED', reason: 'Transparent element covers the target' }
      }
      // Non-transparent cover is a warning, not a hard block
      // (could be a legitimate tooltip, dropdown, etc.)
    }
  } catch {
    // elementFromPoint may fail in unusual contexts — not blocking
  }

  // 8. Inert
  if (element.closest('[inert]')) {
    return { safe: false, code: 'ELEMENT_NOT_FOCUSABLE', reason: 'Element is inside an inert subtree' }
  }

  return { safe: true, code: null, reason: 'All element guards passed' }
}

/** Check if an element is one of our injected Shadow DOM hosts. */
function isOurShadowHost(el: Element): boolean {
  return el.hasAttribute('data-wrv-quickselect') ||
         el.hasAttribute('data-wrv-qs-icon') ||
         el.id === 'wrv-autofill-overlay' ||
         el.hasAttribute('data-wrv-save-bar')
}


// ============================================================================
// §5  SPA NAVIGATION HANDLER
// ============================================================================

export interface SPANavigationConfig {
  /** Called when SPA navigation detected — should dismiss overlay, rescan */
  onNavigate: () => void
  /** Debounce ms for rapid pushState calls */
  debounceMs?: number
  /** Maximum navigations in window before throttling */
  maxNavigationsPerWindow?: number
  /** Window size for counting navigations */
  windowMs?: number
}

interface SPAWatcherState {
  originalPushState: typeof history.pushState | null
  originalReplaceState: typeof history.replaceState | null
  popstateHandler: ((e: PopStateEvent) => void) | null
  navigationTimestamps: number[]
  debounceTimer: ReturnType<typeof setTimeout> | null
  running: boolean
}

let _spaState: SPAWatcherState = {
  originalPushState: null,
  originalReplaceState: null,
  popstateHandler: null,
  navigationTimestamps: [],
  debounceTimer: null,
  running: false,
}

/**
 * Start watching for SPA navigation events.
 *
 * Hooks pushState, replaceState, and popstate.
 * Debounces rapid navigations (router thrashing).
 */
export function startSPAWatcher(config: SPANavigationConfig): void {
  stopSPAWatcher()

  const debounceMs = config.debounceMs ?? 300
  const maxNav = config.maxNavigationsPerWindow ?? 5
  const windowMs = config.windowMs ?? 2000

  _spaState.running = true

  function onNavigation(): void {
    const now = Date.now()
    _spaState.navigationTimestamps.push(now)

    // Prune old timestamps
    _spaState.navigationTimestamps = _spaState.navigationTimestamps.filter(
      t => now - t < windowMs,
    )

    // Throttle: too many navigations in window → suppress
    if (_spaState.navigationTimestamps.length > maxNav) {
      auditLog('warn', 'SPA_HISTORY_LOOP', 'Rapid navigation detected, throttling rescan')
      return
    }

    // Debounce
    if (_spaState.debounceTimer) clearTimeout(_spaState.debounceTimer)
    _spaState.debounceTimer = setTimeout(() => {
      config.onNavigate()
    }, debounceMs)
  }

  // Hook pushState
  _spaState.originalPushState = history.pushState
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    _spaState.originalPushState!.apply(this, args)
    onNavigation()
  }

  // Hook replaceState
  _spaState.originalReplaceState = history.replaceState
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    _spaState.originalReplaceState!.apply(this, args)
    onNavigation()
  }

  // Listen for popstate (back/forward)
  _spaState.popstateHandler = () => onNavigation()
  window.addEventListener('popstate', _spaState.popstateHandler)
}

/** Stop the SPA navigation watcher and restore original methods. */
export function stopSPAWatcher(): void {
  if (!_spaState.running) return

  if (_spaState.originalPushState) {
    history.pushState = _spaState.originalPushState
  }
  if (_spaState.originalReplaceState) {
    history.replaceState = _spaState.originalReplaceState
  }
  if (_spaState.popstateHandler) {
    window.removeEventListener('popstate', _spaState.popstateHandler)
  }
  if (_spaState.debounceTimer) {
    clearTimeout(_spaState.debounceTimer)
  }

  _spaState = {
    originalPushState: null,
    originalReplaceState: null,
    popstateHandler: null,
    navigationTimestamps: [],
    debounceTimer: null,
    running: false,
  }
}


// ============================================================================
// §6  MULTI-ACCOUNT & SUBDOMAIN POLICY
// ============================================================================

/**
 * Check if a domain is a public-suffix hosting domain.
 * Auto-insert is blocked on these domains to prevent cross-tenant leakage.
 *
 * Delegates to the canonical `isPublicSuffix` from `originPolicy.ts`.
 */
export function isPublicSuffixDomain(domain: string): boolean {
  return isPublicSuffixStrict(domain)
}

/**
 * Strict origin match: returns true only if the two origins are the same
 * (exact match or www-equivalent).
 *
 * **No wildcard subdomain matching** unless `allowSubdomain` is true.
 *
 * This replaces the legacy `domainRelated()` which allowed any bidirectional
 * subdomain match — a security hole (e.g., `evil-example.com` could match
 * via SQL LIKE patterns).
 */
export function domainRelated(storedDomain: string, currentDomain: string, allowSubdomain: boolean = false): boolean {
  const result = matchOrigin(storedDomain, currentDomain, {
    subdomainPolicy: allowSubdomain ? 'share_parent' : 'exact',
  })
  return result.matches
}

/**
 * Count how many vault profiles match a domain via strict origin matching.
 * Used to detect multi-account scenarios.
 */
export function countDomainMatches(profiles: VaultProfile[], domain: string): number {
  return profiles.filter(p => {
    if (!p.domain) return false
    const tier = classifyRelevance(p.domain, domain)
    return tier === 'exact_origin' || tier === 'www_equivalent'
  }).length
}


// ============================================================================
// §7  DATA MINIMIZATION HELPERS
// ============================================================================

/**
 * Redact sensitive values from a string.
 * Replaces anything that looks like a password, token, or secret.
 */
export function redactSecrets(text: string): string {
  return text
    // Redact values in key=value pairs where key suggests sensitivity
    .replace(/(password|passwd|pass|secret|token|key|credential|auth|cookie|session|bearer|api.?key|vsbt)[=:]["']?[^\s"',}]*/gi, '$1=[REDACTED]')
    // Redact UUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID_REDACTED]')
    // Redact IBAN-like patterns (2 letters + 2 digits + 11-30 alphanumeric)
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[IBAN_REDACTED]')
    // Redact base64-like tokens (> 20 chars of base64 chars)
    .replace(/[A-Za-z0-9+/=]{20,}/g, '[TOKEN_REDACTED]')
    // Redact email-like patterns
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
}

/**
 * Redact an Error object for safe logging.
 * Preserves the error type and message structure, strips sensitive values.
 */
export function redactError(err: unknown): string {
  if (!err) return 'Unknown error'
  if (err instanceof Error) {
    return `${err.constructor.name}: ${redactSecrets(err.message)}`
  }
  if (typeof err === 'string') {
    return redactSecrets(err)
  }
  return redactSecrets(String(err))
}

/**
 * Mask a value for display purposes.
 * Only reveals the last N characters (default: 0).
 */
export function maskValue(value: string, revealLast: number = 0): string {
  if (!value) return ''
  if (revealLast <= 0) return '\u2022'.repeat(Math.min(value.length, 20))
  const masked = '\u2022'.repeat(Math.max(0, value.length - revealLast))
  return masked + value.slice(-revealLast)
}


// ============================================================================
// §8  LOCAL-ONLY AUDIT LOGGER
// ============================================================================
//
// Design:
//   - Ring buffer of AuditEntry objects (in-memory, capped at MAX_ENTRIES)
//   - Optional flush to chrome.storage.local (session key, rotated on lock)
//   - NEVER sends data over the network
//   - All values are redacted before entry creation
//   - Entries contain: timestamp, level, code, message, domain (redacted)
//
// Consumers:
//   - Debug panel in vault settings (read-only)
//   - Local-only telemetry hook in committer.ts
//   - Error reporting in orchestrator (catch blocks)
//
// ============================================================================

export type AuditLevel = 'info' | 'warn' | 'error' | 'security'

export interface AuditEntry {
  /** ISO timestamp. */
  ts: string
  /** Severity level. */
  level: AuditLevel
  /** Error/event code (from HardenedErrorCode or custom). */
  code: string
  /** Human-readable message (redacted). */
  message: string
  /** Domain where the event occurred (normalized, not the full URL). */
  domain: string
  /** Additional structured metadata (no sensitive values). */
  meta?: Record<string, string | number | boolean>
}

/** Maximum number of entries in the in-memory audit ring buffer. */
export const MAX_AUDIT_ENTRIES = 500

/** Maximum age (ms) of entries retained in the buffer. Default: 24 hours. */
export const MAX_AUDIT_AGE_MS = 24 * 60 * 60 * 1000 // 86_400_000

/** Hard cap on export output size in bytes. */
export const MAX_EXPORT_BYTES = 512 * 1024 // 524_288

let _auditBuffer: AuditEntry[] = []
let _auditListeners: Array<(entry: AuditEntry) => void> = []

// ============================================================================
// §8.1  Meta Sanitization — fail-closed, allowlist-only
// ============================================================================
//
// Every meta value passes through sanitizeMeta() before storage.
// Keys not in the allowlist are silently DROPPED.
// String values are redacted, truncated, and pattern-checked.
// Non-primitive values are replaced with "[META_REDACTED]".
//
// This closes the leak vector where callers accidentally put PII in meta.
//

const META_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'sessionId',
  'tabId',
  'fieldCount',
  'candidateCount',
  'evaluatedCount',
  'elementsVisited',
  'durationMs',
  'ha',
  'reason',
  'code',
  'state',
  'partial',
  'partialReason',
  'originTier',
  'matchTier',
  'psl',
  'action',
  'channel',
  'op',
  'retryAfterMs',
])

const META_MAX_STRING_LEN = 80

const META_PII_PATTERNS: readonly RegExp[] = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,         // UUID
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,                                  // email
  /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/,                                         // IBAN-like
  /\b[A-Za-z0-9+/=]{20,}\b/,                                                  // base64-ish >20
  /\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,                      // JWT-ish
]

function sanitizeMetaValue(val: unknown): string | number | boolean | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return Number.isFinite(val) ? val : null

  if (typeof val === 'string') {
    // Check PII patterns on the RAW string first (before redactSecrets
    // partially replaces content and makes patterns unmatchable).
    for (const pattern of META_PII_PATTERNS) {
      if (pattern.test(val)) return '[META_REDACTED]'
    }

    // Run redactSecrets for key=value style redaction
    let s = redactSecrets(val)
    if (s.length > META_MAX_STRING_LEN) {
      s = s.slice(0, META_MAX_STRING_LEN)
    }

    // Second pass: catch anything redactSecrets may have left behind
    for (const pattern of META_PII_PATTERNS) {
      if (pattern.test(s)) return '[META_REDACTED]'
    }
    return s
  }

  // object, array, function, symbol, bigint — not safe
  return '[META_REDACTED]'
}

/**
 * Sanitize a meta record for safe storage in audit entries.
 *
 * - Keys not in META_ALLOWED_KEYS are silently dropped.
 * - String values are redacted (via redactSecrets), truncated to 80 chars,
 *   and pattern-checked for residual PII.  If any pattern matches, the
 *   value becomes "[META_REDACTED]".
 * - Non-primitive values (objects, arrays, functions) become "[META_REDACTED]".
 * - Returns undefined if the input is falsy or all keys are dropped.
 *
 * This function never throws.
 */
export function sanitizeMeta(
  meta?: Record<string, unknown>,
): Record<string, string | number | boolean> | undefined {
  if (!meta || typeof meta !== 'object') return undefined

  let result: Record<string, string | number | boolean> | undefined

  try {
    for (const key of Object.keys(meta)) {
      if (!META_ALLOWED_KEYS.has(key)) continue

      const safe = sanitizeMetaValue(meta[key])
      if (safe === null) continue

      if (!result) result = {}
      result[key] = safe
    }
  } catch {
    // Malformed meta (e.g., getter that throws) — fail closed
    return undefined
  }

  return result
}

/**
 * Log an audit event.
 * Message is automatically redacted. Meta is sanitized (allowlist + redact).
 * Domain is automatically extracted. Never throws.
 */
export function auditLog(
  level: AuditLevel,
  code: string,
  message: string,
  meta?: Record<string, string | number | boolean>,
): void {
  const safeMeta = sanitizeMeta(meta as Record<string, unknown> | undefined)

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    level,
    code,
    message: redactSecrets(message),
    domain: safeHostname(),
    ...(safeMeta ? { meta: safeMeta } : {}),
  }

  // ── Time retention: prune entries older than MAX_AUDIT_AGE_MS ──
  // Run BEFORE push so the new entry is never accidentally pruned.
  // Parsing ISO timestamps is safe (Date.parse returns NaN on failure).
  // We scan from the front since oldest entries are first.
  try {
    const cutoff = Date.now() - MAX_AUDIT_AGE_MS
    let pruneUntil = 0
    for (let i = 0; i < _auditBuffer.length; i++) {
      const entryTs = Date.parse(_auditBuffer[i].ts)
      if (Number.isNaN(entryTs) || entryTs < cutoff) {
        pruneUntil = i + 1
      } else {
        break // buffer is chronologically ordered
      }
    }
    if (pruneUntil > 0) {
      _auditBuffer = _auditBuffer.slice(pruneUntil)
    }
  } catch {
    // Never fail — age pruning is best-effort
  }

  _auditBuffer.push(entry)

  // ── Ring buffer size cap ──
  if (_auditBuffer.length > MAX_AUDIT_ENTRIES) {
    _auditBuffer = _auditBuffer.slice(-MAX_AUDIT_ENTRIES)
  }

  // Notify listeners
  for (const listener of _auditListeners) {
    try { listener(entry) } catch { /* never break caller */ }
  }

  // Console output (development aid — level-gated)
  if (level === 'error' || level === 'security') {
    console.warn(`[WRV-AUDIT] [${level.toUpperCase()}] ${code}: ${entry.message}`)
  }
}

/**
 * Strict audit log wrapper for perimeter code (WebMCP, scanner, IPC handlers).
 *
 * Behavior:
 *   1. Calls sanitizeMeta(meta) — allowlist + PII patterns.
 *   2. If sanitizeMeta returns undefined (meta was fully rejected or empty),
 *      drops meta entirely and logs without it.
 *   3. In dev builds (import.meta.env.DEV), emits a console.warn if meta
 *      was rejected — without printing the raw meta object.
 *   4. Never throws in any build.
 *
 * Preferred over bare auditLog() for call-sites where meta comes from
 * dynamic/external sources (MCP params, scan results, IPC payloads).
 */
export function auditLogSafe(
  level: AuditLevel,
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    let safeMeta: Record<string, string | number | boolean> | undefined
    let metaRejected = false

    if (meta && typeof meta === 'object') {
      safeMeta = sanitizeMeta(meta)

      // Detect if any key was dropped or any value was rejected
      if (safeMeta === undefined && Object.keys(meta).length > 0) {
        metaRejected = true
      } else if (safeMeta) {
        const inputKeys = Object.keys(meta)
        const outputKeys = Object.keys(safeMeta)
        if (outputKeys.length < inputKeys.length) {
          metaRejected = true
        }
        for (const v of Object.values(safeMeta)) {
          if (v === '[META_REDACTED]') {
            metaRejected = true
            break
          }
        }
      }

      // Dev-time warning: flag misuse WITHOUT printing raw meta
      if (metaRejected) {
        try {
          if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
            console.warn(`[WRV-AUDIT] meta rejected for code=${code} — contains disallowed keys or PII patterns`)
          }
        } catch { /* import.meta unavailable in some test environments */ }
      }
    }

    auditLog(level, code, message, safeMeta)
  } catch {
    // Absolute fail-safe: never throw from audit path
    try { auditLog(level, code, message) } catch { /* swallow */ }
  }
}

/**
 * Subscribe to audit events in real time.
 * Returns an unsubscribe function.
 */
export function onAuditEvent(listener: (entry: AuditEntry) => void): () => void {
  _auditListeners.push(listener)
  return () => {
    _auditListeners = _auditListeners.filter(l => l !== listener)
  }
}

/**
 * Get the audit log (most recent entries).
 * @param limit — max entries to return (default: all)
 */
export function getAuditLog(limit?: number): readonly AuditEntry[] {
  if (limit && limit > 0) {
    return _auditBuffer.slice(-limit)
  }
  return [..._auditBuffer]
}

/**
 * Clear the audit log.
 * Called on vault lock (zeroize sensitive context).
 */
export function clearAuditLog(): void {
  _auditBuffer = []
}

// ============================================================================
// §8.3  Audit Log Export — JSONL format, size-capped, no PII
// ============================================================================

/** Schema version stamped into every export line for forward compatibility. */
const AUDIT_EXPORT_SCHEMA = 'auditlog-v1'

/**
 * Export the audit log as JSONL (one JSON object per line).
 *
 * Each line contains: { schemaVersion, ts, level, code, message, domain, meta? }
 *
 * All values are already sanitized (message via redactSecrets, meta via sanitizeMeta).
 * The export is hard-capped at MAX_EXPORT_BYTES.  If the full buffer exceeds that,
 * only the **newest** entries that fit are included, and `truncated` is true.
 *
 * Never throws.
 */
export function exportAuditLogJsonl(): { jsonl: string; truncated: boolean } {
  try {
    // Build JSONL lines from newest to oldest (so we keep newest on truncation)
    const lines: string[] = []
    let totalBytes = 0
    let truncated = false

    for (let i = _auditBuffer.length - 1; i >= 0; i--) {
      const entry = _auditBuffer[i]
      const obj: Record<string, unknown> = {
        schemaVersion: AUDIT_EXPORT_SCHEMA,
        ts: entry.ts,
        level: entry.level,
        code: entry.code,
        message: entry.message,
        domain: entry.domain,
      }
      if (entry.meta) {
        obj.meta = entry.meta
      }

      const line = JSON.stringify(obj)
      const lineBytes = line.length + 1 // +1 for the newline

      if (totalBytes + lineBytes > MAX_EXPORT_BYTES) {
        truncated = true
        break
      }

      lines.push(line)
      totalBytes += lineBytes
    }

    // Reverse back to chronological order
    lines.reverse()

    return { jsonl: lines.join('\n'), truncated }
  } catch {
    // Serialization failure — fail closed with empty export
    return { jsonl: '', truncated: false }
  }
}

/**
 * Flush the audit log to chrome.storage.local.
 * Entries are stored under a session-scoped key and rotated.
 * Safe to call from content script (uses chrome.storage.local).
 */
export async function flushAuditLog(): Promise<void> {
  if (_auditBuffer.length === 0) return

  try {
    const key = `wrv_audit_${Date.now()}`
    const entries = _auditBuffer.slice(-MAX_AUDIT_ENTRIES)
    await chrome.storage.local.set({ [key]: entries })

    // Rotate: keep only the latest 3 audit chunks
    const all = await chrome.storage.local.get(null)
    const auditKeys = Object.keys(all)
      .filter(k => k.startsWith('wrv_audit_'))
      .sort()
    if (auditKeys.length > 3) {
      const toRemove = auditKeys.slice(0, auditKeys.length - 3)
      await chrome.storage.local.remove(toRemove)
    }
  } catch {
    // Storage may be unavailable in some contexts — silent fail
  }
}


// ============================================================================
// §9  TELEMETRY SPEC (Local-Only)
// ============================================================================
//
// Telemetry events are a structured subset of audit entries, designed for
// aggregate analysis of autofill success rates and failure patterns.
//
// Invariants:
//   - NO field values (passwords, usernames, emails)
//   - NO full URLs (only hostname)
//   - NO user identifiers
//   - Stored locally only (ring buffer + optional chrome.storage.local)
//   - Cleared on vault lock
//
// ============================================================================

export interface TelemetryEvent {
  /** Event type. */
  type: TelemetryEventType
  /** ISO timestamp. */
  ts: string
  /** Page hostname (not full URL). */
  domain: string
  /** Duration in ms (for timed operations). */
  durationMs?: number
  /** Structured payload — varies by event type. */
  payload: Record<string, string | number | boolean>
}

export type TelemetryEventType =
  | 'scan_complete'         // Field scan finished
  | 'scan_partial'          // Partial scan completed
  | 'overlay_shown'         // Overlay preview displayed
  | 'overlay_consent'       // User clicked Insert
  | 'overlay_cancel'        // User clicked Cancel / Esc
  | 'overlay_expired'       // Overlay timed out
  | 'overlay_mutation_abort' // Overlay aborted due to DOM mutation
  | 'commit_success'        // All fields filled successfully
  | 'commit_partial'        // Some fields failed
  | 'commit_blocked'        // Safety checks blocked commit
  | 'quickselect_open'      // QuickSelect dropdown opened
  | 'quickselect_select'    // User selected an entry
  | 'quickselect_dismiss'   // User dismissed QuickSelect
  | 'quickselect_interaction' // QuickSelect user interaction
  | 'quickselect_show_all'  // QuickSelect show-all triggered
  | 'save_bar_shown'        // Save password bar appeared
  | 'save_bar_save'         // User saved credentials
  | 'save_bar_update'       // User updated existing credentials
  | 'save_bar_cancel'       // User cancelled save
  | 'save_bar_never'        // User chose "Never for this site"
  | 'safe_mode_fallback'    // Auto-insert suppressed, QuickInsert shown
  | 'consent_rejected'      // User rejected consent prompt
  | 'direct_fill'           // Direct fill triggered
  | 'guarded_submit'        // Guarded form submission
  | 'guarded_submit_blocked' // Guarded submit was blocked
  | 'qso_click'             // QSO click event
  | 'qso_fill'              // QSO fill performed
  | 'qso_submit'            // QSO submit triggered
  | 'qso_remap'             // QSO field remap
  | 'qso_remap_fill'        // QSO remap + fill
  | 'dv_icons_placed'       // Data vault icons placed
  | 'dv_fill_single'        // Data vault single field fill
  | 'dv_fill_all'           // Data vault fill all
  | 'dv_remap'              // Data vault remap
  | 'popover_mode_switch'   // Popover mode switched
  | 'popover_fill'          // Popover fill triggered
  | 'popover_fill_blocked'  // Popover fill was blocked
  | 'popover_autofill'      // Popover autofill triggered
  | 'popover_guarded_submit' // Popover guarded submit
  | 'popover_guarded_submit_blocked' // Popover guarded submit blocked
  | 'auto_submit'           // Automatic form submission
  | 'preview_fill_inject'   // Preview fill injected
  | 'mutation_guard_trip'   // Mutation guard tripped
  | 'ha_deny'               // High-assurance denial
  | 'webmcp_partial_scan'   // WebMCP partial scan
  | 'webmcp_preview'        // WebMCP preview shown
  | 'error'                 // Pipeline error

const MAX_TELEMETRY_EVENTS = 200
let _telemetryBuffer: TelemetryEvent[] = []
let _telemetryListeners: Array<(event: TelemetryEvent) => void> = []

/**
 * Emit a telemetry event.
 * Automatically adds timestamp and domain.
 */
export function emitTelemetryEvent(
  type: TelemetryEventType,
  payload: Record<string, string | number | boolean> = {},
  durationMs?: number,
): void {
  const event: TelemetryEvent = {
    type,
    ts: new Date().toISOString(),
    domain: safeHostname(),
    durationMs,
    payload,
  }

  _telemetryBuffer.push(event)
  if (_telemetryBuffer.length > MAX_TELEMETRY_EVENTS) {
    _telemetryBuffer = _telemetryBuffer.slice(-MAX_TELEMETRY_EVENTS)
  }

  for (const listener of _telemetryListeners) {
    try { listener(event) } catch { /* never break caller */ }
  }
}

/**
 * Subscribe to telemetry events.
 */
export function onTelemetryEvent(listener: (event: TelemetryEvent) => void): () => void {
  _telemetryListeners.push(listener)
  return () => {
    _telemetryListeners = _telemetryListeners.filter(l => l !== listener)
  }
}

/**
 * Get the telemetry buffer.
 */
export function getTelemetryLog(limit?: number): readonly TelemetryEvent[] {
  if (limit && limit > 0) {
    return _telemetryBuffer.slice(-limit)
  }
  return [..._telemetryBuffer]
}

/**
 * Clear telemetry buffer. Called on vault lock.
 */
export function clearTelemetry(): void {
  _telemetryBuffer = []
}


// ============================================================================
// §10  INTERNAL HELPERS
// ============================================================================

/** Safely get the current origin (scheme://host[:port]; never throws). */
function safeHostname(): string {
  try {
    return window.location.origin
  } catch {
    return 'unknown'
  }
}
