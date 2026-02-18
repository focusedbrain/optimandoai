// ============================================================================
// WRVault DataVault — Orchestrator (PII/Company Autofill Pipeline)
// ============================================================================
//
// Coordinates the DataVault autofill layer:
//   - Hooks into existing field scanning (reuses fieldScanner.ts)
//   - Filters identity/company candidates from the scan result
//   - Applies Site Learning boosts (fingerprint→vaultKey persistence)
//   - Applies optional NLP booster for mid-confidence fields
//   - Applies form-level co-occurrence boosts
//   - Places DataVault inline icons on detected PII fields
//   - Handles icon clicks → opens DataVault popup
//   - Auto mode: click icon → fill all matched fields in form group
//   - Manual mode: click icon → fill only the clicked field
//
// Integration point: called by autofillOrchestrator.ts after each scan.
//
// Hard constraints:
//   - NO form submission / NO button clicking
//   - NO cross-origin iframe filling
//   - Gesture-driven only (user must click an icon)
//   - NEVER log or persist raw PII
//   - Skip readonly/disabled fields
//   - Do NOT overwrite non-empty fields (default)
//
// ============================================================================

import type { FieldCandidate, MatchResult } from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { FieldKind } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import type { ScanResult } from './fieldScanner'
import {
  syncDvFieldIcons,
  clearAllDvIcons,
  setDvIconMatchData,
} from './dataVaultIcons'
import {
  showDvPopup,
  hideDvPopup,
  isDvPopupVisible,
} from './dataVaultPopup'
import {
  listDataVaultProfiles,
  getDataVaultProfile,
  getLastUsedProfileId,
  isDvDenylisted,
} from './dataVaultAdapter'
import { loadQsoAutoConsent } from './inlinePopover'
import { auditLog, emitTelemetryEvent } from './hardening'
import {
  buildFieldFingerprint,
  lookupLearnedMappingsBatch,
  LEARNED_CONFIDENCE_BOOST,
} from './dvSiteLearning'
import type { FieldFingerprint } from './dvSiteLearning'
import {
  semanticClassify,
  extractTextFeatures,
  isNlpBoosterEnabled,
  NLP_BOOSTER_WEIGHT,
} from './dvNlpBooster'

// ============================================================================
// §1  State
// ============================================================================

let _initialized = false
let _denylisted = false
let _hasProfiles = false
let _isAutoMode = false
/** Cached default profile ID for icon coloring. */
let _defaultProfileId: string | null = null
/** Cached set of FieldKinds the default profile has values for. */
let _profileAvailableKinds: Set<FieldKind> = new Set()

// ============================================================================
// §2  Field Kinds Filter
// ============================================================================

/** FieldKinds that qualify for DataVault icons (identity + company PII). */
const DV_FIELD_SECTIONS = new Set(['identity', 'company'])

/** Form contexts where DataVault icons are useful (most non-login forms). */
const DV_ALLOWED_CONTEXTS = new Set<string>([
  'signup', 'checkout', 'address', 'contact', 'unknown',
])

/**
 * Medium confidence threshold: icons are shown grey and require popup
 * confirmation before filling.
 */
const MEDIUM_CONFIDENCE_MIN = 50
const HIGH_CONFIDENCE_MIN = 65

/** NLP booster invocation range: only call NLP for mid-confidence fields. */
const NLP_INVOKE_MIN = 45
const NLP_INVOKE_MAX = 70

/**
 * Filter scan candidates to only identity/company fields for DataVault icons.
 */
function filterDvCandidates(candidates: FieldCandidate[]): FieldCandidate[] {
  return candidates.filter(c => {
    if (!c.matchedKind) return false
    const section = c.matchedKind.split('.')[0]
    if (!DV_FIELD_SECTIONS.has(section)) return false
    if (c.crossOrigin) return false

    // Confidence gate: must be at least medium confidence
    if (c.match.confidence < MEDIUM_CONFIDENCE_MIN) return false

    return true
  })
}

// ============================================================================
// §2.1  Form-Level Co-Occurrence Boosts
// ============================================================================

/**
 * Co-occurrence boost groups: when multiple fields from the same group
 * are detected together in a form, each gets a confidence boost.
 *
 * This is language-agnostic because it relies on structural co-occurrence
 * (the presence of other fields), not on the text content of labels.
 */
const CO_OCCURRENCE_GROUPS: Array<{
  label: string
  kinds: Set<FieldKind>
  minPresent: number
  boost: number
}> = [
  {
    label: 'address_cluster',
    kinds: new Set<FieldKind>([
      'identity.street', 'identity.street_number', 'identity.postal_code',
      'identity.city', 'identity.state', 'identity.country',
      'identity.address_line2',
    ]),
    minPresent: 3,
    boost: 12,
  },
  {
    label: 'company_cluster',
    kinds: new Set<FieldKind>([
      'company.name', 'company.vat_number', 'company.tax_id',
      'company.hrb', 'company.iban',
      'company.street', 'company.postal_code', 'company.city',
      'company.country',
    ]),
    minPresent: 2,
    boost: 15,
  },
  {
    label: 'identity_cluster',
    kinds: new Set<FieldKind>([
      'identity.first_name', 'identity.last_name', 'identity.full_name',
      'identity.email', 'identity.phone', 'identity.birthday',
    ]),
    minPresent: 2,
    boost: 10,
  },
]

/**
 * Apply form-level co-occurrence boosts to candidates.
 *
 * Groups candidates by form/container. Within each group, counts how
 * many different FieldKinds belong to each co-occurrence group. If the
 * count meets `minPresent`, all candidates in that cluster get `boost`
 * added to their confidence.
 *
 * Mutates candidate.match.confidence in place and returns the candidates.
 */
function applyCoOccurrenceBoosts(candidates: FieldCandidate[]): FieldCandidate[] {
  // Group candidates by form ancestor
  const formGroups = new Map<HTMLElement | null, FieldCandidate[]>()
  for (const c of candidates) {
    const el = c.element as HTMLElement
    const form = el.closest('form') as HTMLElement | null
    const group = formGroups.get(form) ?? []
    group.push(c)
    formGroups.set(form, group)
  }

  for (const [, group] of formGroups) {
    // Collect which FieldKinds are present in this form group
    const kindsPresent = new Set<FieldKind>()
    for (const c of group) {
      if (c.matchedKind) kindsPresent.add(c.matchedKind)
    }

    for (const coGroup of CO_OCCURRENCE_GROUPS) {
      // Count how many of this group's kinds are present
      let matchCount = 0
      for (const kind of coGroup.kinds) {
        if (kindsPresent.has(kind)) matchCount++
      }

      if (matchCount >= coGroup.minPresent) {
        // Apply boost to all candidates in this co-occurrence group
        for (const c of group) {
          if (c.matchedKind && coGroup.kinds.has(c.matchedKind)) {
            // Mutate the match result with the boost
            const boosted = c.match as MatchResult & { confidence: number; contextBoost: number }
            boosted.confidence += coGroup.boost
            boosted.contextBoost += coGroup.boost

            // Re-evaluate acceptance threshold
            if (boosted.confidence >= 60 && !boosted.accepted) {
              ;(boosted as any).accepted = true
            }
          }
        }
      }
    }
  }

  return candidates
}

// ============================================================================
// §2.2  Site Learning Integration
// ============================================================================

/**
 * Apply site learning boosts to candidates.
 *
 * For each candidate, look up if a learned mapping exists for its
 * field fingerprint. If found, override the matchedKind and boost
 * confidence to LEARNED_CONFIDENCE_BOOST (0.95).
 */
async function applySiteLearningBoosts(
  candidates: FieldCandidate[],
): Promise<FieldCandidate[]> {
  const origin = window.location.origin

  // Build fingerprints for all elements
  const fpMap = new Map<FieldFingerprint, FieldCandidate>()
  const fingerprints: FieldFingerprint[] = []
  for (const c of candidates) {
    const fp = buildFieldFingerprint(c.element as HTMLElement)
    fpMap.set(fp, c)
    fingerprints.push(fp)
  }

  // Batch lookup
  const learned = await lookupLearnedMappingsBatch(origin, fingerprints)

  // Apply learned overrides
  for (const [fp, learnedKind] of learned) {
    const candidate = fpMap.get(fp)
    if (!candidate) continue

    // Override the matchedKind and boost confidence
    candidate.matchedKind = learnedKind
    const boosted = candidate.match as MatchResult & { confidence: number }
    boosted.confidence = LEARNED_CONFIDENCE_BOOST
    ;(boosted as any).accepted = true
    ;(boosted as any).bestKind = learnedKind

    // Add a signal note for debugging
    candidate.match.signals.push({
      source: 'form_context' as any,
      pattern: `learned:${learnedKind}`,
      matched: true,
      contribution: LEARNED_CONFIDENCE_BOOST,
    })
  }

  return candidates
}

// ============================================================================
// §2.3  NLP Booster Integration
// ============================================================================

/**
 * Apply optional NLP booster to mid-confidence candidates.
 *
 * Only invoked when:
 *   - NLP booster is enabled and a backend is registered
 *   - Candidate confidence is in the mid range (NLP_INVOKE_MIN..NLP_INVOKE_MAX)
 *   - Candidate has meaningful text features (label/placeholder/name)
 *
 * NLP score is merged with a small weight so heuristics remain primary.
 */
async function applyNlpBooster(candidates: FieldCandidate[]): Promise<void> {
  if (!isNlpBoosterEnabled()) return

  for (const c of candidates) {
    const conf = c.match.confidence
    if (conf < NLP_INVOKE_MIN || conf > NLP_INVOKE_MAX) continue

    const el = c.element as HTMLElement
    const features = extractTextFeatures(el)

    // Only invoke if there are meaningful text features
    if (!features.labelText && !features.placeholder && !features.fieldName) continue

    try {
      const nlpResult = await semanticClassify(features)
      if (!nlpResult.invoked || nlpResult.candidates.length === 0) continue

      // Find the NLP candidate that matches or overrides
      const topNlp = nlpResult.candidates[0]
      if (topNlp.score > 0.3) {
        const nlpBoost = topNlp.score * NLP_BOOSTER_WEIGHT
        const boosted = c.match as MatchResult & { confidence: number }
        boosted.confidence += nlpBoost

        // If NLP strongly suggests a different kind and current is ambiguous
        if (topNlp.vaultKey !== c.matchedKind && topNlp.score > 0.7) {
          // Only override if current confidence is below threshold
          if (conf < 60) {
            c.matchedKind = topNlp.vaultKey
            ;(boosted as any).bestKind = topNlp.vaultKey
          }
        }

        // Re-evaluate acceptance
        if (boosted.confidence >= 60 && !boosted.accepted) {
          ;(boosted as any).accepted = true
        }
      }
    } catch {
      // NLP errors should never break autofill — fail open
    }
  }
}

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Initialize the DataVault autofill layer.
 *
 * Called by autofillOrchestrator.initAutofill() after the main pipeline init.
 * Checks the denylist and profile availability.
 */
export async function initDataVault(): Promise<void> {
  if (_initialized) return
  _initialized = true

  // Check if current origin is denylisted
  try {
    _denylisted = await isDvDenylisted(window.location.origin)
  } catch {
    _denylisted = false
  }

  if (_denylisted) {
    auditLog('info', 'DV_DENYLISTED', `DataVault disabled for ${window.location.hostname}`)
    return
  }

  // Check if any DataVault profiles exist
  try {
    const profiles = await listDataVaultProfiles()
    _hasProfiles = profiles.length > 0

    // Pre-load the default profile's field map for icon coloring
    if (_hasProfiles) {
      await loadDefaultProfileFields(profiles.map(p => p.itemId))
    }
  } catch {
    _hasProfiles = false
  }

  // Load auto mode preference (reuses the same global setting)
  try {
    _isAutoMode = await loadQsoAutoConsent()
  } catch {
    _isAutoMode = false
  }

  auditLog('info', 'DV_INIT', `DataVault initialized (profiles=${_hasProfiles}, fields=${_profileAvailableKinds.size}, autoMode=${_isAutoMode})`)
}

/**
 * Process a scan result and place DataVault icons on identity/company fields.
 *
 * Pipeline:
 *   1. Filter to identity/company candidates
 *   2. Apply site learning boosts (fingerprint→vaultKey)
 *   3. Apply form-level co-occurrence boosts
 *   4. Apply optional NLP booster for mid-confidence fields
 *   5. Re-filter with updated confidence
 *   6. Place icons
 *
 * Called after each scan (initial + mutation-triggered rescans).
 */
export async function processScanForDataVault(scanResult: ScanResult): Promise<void> {
  if (!_initialized || _denylisted) return

  // Step 1: initial filter (loose — includes mid-confidence for boosting)
  // Also promote login.email → identity.email on non-login forms, since
  // the scanner may pick login.email due to tie-breaking order even when
  // the field is actually an identity email (registration, checkout, contact).
  const isLoginForm = scanResult.formContext === 'login' || scanResult.formContext === 'password_change'

  let allIdentityCompany = scanResult.candidates.filter(c => {
    if (!c.matchedKind) return false
    if (c.crossOrigin) return false
    const section = c.matchedKind.split('.')[0]
    if (DV_FIELD_SECTIONS.has(section)) return true

    // On non-login forms, promote login.email → identity.email
    if (!isLoginForm && c.matchedKind === 'login.email') {
      c.matchedKind = 'identity.email'
      return true
    }

    return false
  })

  if (allIdentityCompany.length === 0) {
    clearAllDvIcons()
    return
  }

  // Step 2: apply site learning boosts
  try {
    allIdentityCompany = await applySiteLearningBoosts(allIdentityCompany)
  } catch {
    // Learning errors should not break the pipeline
  }

  // Step 3: apply co-occurrence boosts
  allIdentityCompany = applyCoOccurrenceBoosts(allIdentityCompany)

  // Step 4: apply NLP booster (async, for mid-confidence fields)
  try {
    await applyNlpBooster(allIdentityCompany)
  } catch {
    // NLP errors should not break the pipeline
  }

  // Step 5: re-filter with updated confidence
  const dvCandidates = allIdentityCompany.filter(
    c => c.match.confidence >= MEDIUM_CONFIDENCE_MIN,
  )

  if (dvCandidates.length === 0) {
    clearAllDvIcons()
    return
  }

  // Step 6: place DataVault icons
  syncDvFieldIcons(dvCandidates, handleDvIconClick)

  // If profile data hasn't been loaded yet (e.g. vault was locked at init),
  // try loading now so icons can be colored green
  if (_profileAvailableKinds.size === 0 && !_hasProfiles) {
    try {
      const profiles = await listDataVaultProfiles()
      if (profiles.length > 0) {
        _hasProfiles = true
        await loadDefaultProfileFields(profiles.map(p => p.itemId))
      }
    } catch {
      // Will stay grey — non-fatal
    }
  }

  // Update icon color per-field: green if the profile has a value for
  // the matched FieldKind, grey otherwise.
  setDvIconMatchData(_profileAvailableKinds)

  emitTelemetryEvent('dv_icons_placed', {
    count: dvCandidates.length,
    formContext: scanResult.formContext,
  })
}

/**
 * Teardown the DataVault layer.
 */
export function teardownDataVault(): void {
  clearAllDvIcons()
  hideDvPopup()
  _initialized = false
  _denylisted = false
  _hasProfiles = false
  _isAutoMode = false
  _defaultProfileId = null
  _profileAvailableKinds = new Set()
}

/**
 * Handle SPA navigation: clear icons and reset state.
 */
export function handleDvSPANavigation(): void {
  clearAllDvIcons()
  hideDvPopup()
  // Re-check denylist for new origin
  isDvDenylisted(window.location.origin).then(denied => {
    _denylisted = denied
  }).catch(() => {})
}

/**
 * Update auto mode state (called when user toggles in popover).
 */
export function setDvAutoMode(auto: boolean): void {
  _isAutoMode = auto
}

// ============================================================================
// §4  Icon Click Handler
// ============================================================================

/**
 * Handle a click on a DataVault inline icon.
 *
 * Always opens the DataVault popup — icon click never auto-fills.
 * Green/grey is purely a visual indicator (green = matched data exists).
 */
async function handleDvIconClick(
  element: HTMLElement,
  candidate: FieldCandidate,
  iconRect: DOMRect,
): Promise<void> {
  if (isDvPopupVisible()) {
    hideDvPopup()
  }

  const allDvCandidates = getLastDvCandidates()

  try {
    const result = await showDvPopup({
      anchorElement: element,
      candidate,
      allCandidates: allDvCandidates,
      iconRect,
      isAutoMode: _isAutoMode,
    })

    if (result.action === 'filled_single') {
      auditLog('info', 'DV_FILL_SINGLE', `DataVault filled single field: ${result.vaultKey}`)
      emitTelemetryEvent('dv_fill_single', { kind: result.vaultKey })
    } else if (result.action === 'filled_all') {
      auditLog('info', 'DV_FILL_ALL', `DataVault filled ${result.fillResult.filled} fields`)
      emitTelemetryEvent('dv_fill_all', {
        filled: result.fillResult.filled,
        skipped: result.fillResult.skipped,
        failed: result.fillResult.failed,
      })
    } else if (result.action === 'remapped') {
      auditLog('info', 'DV_REMAP', `DataVault remapped field to: ${result.newVaultKey}`)
      emitTelemetryEvent('dv_remap', { from: result.oldVaultKey, to: result.newVaultKey })
    } else if (result.action === 'denied') {
      auditLog('info', 'DV_DENY_ORIGIN', `DataVault denied for origin: ${result.origin}`)
      _denylisted = true
      clearAllDvIcons()
    } else if (result.action === 'mode_changed') {
      _isAutoMode = result.autoMode
      auditLog('info', 'DV_MODE_CHANGE', `DataVault mode changed to ${result.autoMode ? 'auto' : 'manual'}`)
    }
  } catch (err) {
    auditLog('error', 'DV_POPUP_ERROR', 'DataVault popup error')
  }
}

// ============================================================================
// §4.1  Default Profile Field Map (for per-field icon coloring)
// ============================================================================

/**
 * Load the default profile's field map to determine which FieldKinds
 * have values — used for per-field green/grey icon coloring.
 *
 * Resolves the default profile by:
 *   1. Last-used profile for this origin (persisted preference)
 *   2. First available profile (fallback)
 */
async function loadDefaultProfileFields(allProfileIds: string[]): Promise<void> {
  try {
    const origin = window.location.origin
    const lastUsedId = await getLastUsedProfileId(origin)

    let targetId = lastUsedId
    if (!targetId || !allProfileIds.includes(targetId)) {
      targetId = allProfileIds[0] ?? null
    }

    if (!targetId) {
      _profileAvailableKinds = new Set()
      _defaultProfileId = null
      return
    }

    _defaultProfileId = targetId
    const profile = await getDataVaultProfile(targetId)

    // Build the set of FieldKinds this profile has non-empty values for
    _profileAvailableKinds = new Set(profile.fields.keys())
  } catch {
    _profileAvailableKinds = new Set()
    _defaultProfileId = null
  }
}

// ============================================================================
// §5  Candidate Cache (for popup's multi-field fill)
// ============================================================================

let _lastDvCandidates: FieldCandidate[] = []

/** Cache DV candidates from the most recent scan. */
export function cacheDvCandidates(candidates: FieldCandidate[]): void {
  _lastDvCandidates = filterDvCandidates(candidates)
}

function getLastDvCandidates(): FieldCandidate[] {
  return _lastDvCandidates
}
