// ============================================================================
// WRVault Autofill — Comprehensive Unit Test Index
// ============================================================================
//
// This file is a catalogue of ALL unit tests needed across the autofill
// pipeline.  Each entry specifies:
//   - Test ID (stable, for tracking)
//   - Module under test
//   - What is being tested
//   - Status: ✅ = implemented, 🔲 = skeleton/pending
//
// Existing test files:
//   committer.test.ts        — 28 tests (setValueSafely, commitInsert, runSafetyChecks)
//   fieldScanner.test.ts     — ~40 tests (collectCandidates, scoreCandidate, pickBestMapping)
//   hardening.test.ts        — ~35 tests (guardElement, safeMode, audit, telemetry)
//
// This index adds the missing test specifications.
//
// ============================================================================

export {}  // Make this a module

// ============================================================================
// SECTION A: FIELD SCANNER (fieldScanner.ts)
// ============================================================================
//
// File: fieldScanner.test.ts
//
// A-SCAN-01  ✅  collectCandidates: password field with autocomplete=current-password → login.password, confidence ≥ 80
// A-SCAN-02  ✅  collectCandidates: username field with autocomplete=username → login.username, confidence ≥ 80
// A-SCAN-03  ✅  collectCandidates: email field with type=email → login.email, confidence ≥ 70
// A-SCAN-04  ✅  collectCandidates: hidden inputs excluded
// A-SCAN-05  ✅  collectCandidates: zero-size elements excluded
// A-SCAN-06  ✅  collectCandidates: cross-origin elements excluded
// A-SCAN-07  ✅  collectCandidates: section toggle OFF excludes that section
// A-SCAN-08  ✅  collectCandidates: throttling returns cached result within window
// A-SCAN-09  ✅  collectCandidates: invalidateScanCache forces fresh scan
// A-SCAN-10  ✅  scoreCandidate: returns allScores sorted descending
// A-SCAN-11  ✅  scoreCandidate: anti-signals reduce confidence
// A-SCAN-12  ✅  scoreCandidate: form context boost applied for login context
// A-SCAN-13  ✅  pickBestMapping: greedy assignment, each element used once
// A-SCAN-14  ✅  pickBestMapping: domain-specific profiles prioritized over global
// A-SCAN-15  ✅  pickBestMapping: rejects below CONFIDENCE_THRESHOLD
// A-SCAN-16  ✅  pickBestMapping: flags ambiguous (runner-up within 15 pts)
// A-SCAN-17  ✅  MutationObserver: adding input triggers debounced rescan
// A-SCAN-18  ✅  MutationObserver: attribute change on input triggers rescan
// A-SCAN-19  ✅  MutationObserver: non-form mutations ignored
// A-SCAN-20  ✅  resolveLabel: reads <label for="id">, aria-label, placeholder, title
// A-SCAN-21  ✅  detectFormContext: login pattern recognized
// A-SCAN-22  ✅  detectFormContext: signup pattern recognized
// A-SCAN-23  ✅  identity fields: given-name autocomplete → identity.first_name
// A-SCAN-24  ✅  identity fields: address-line1 autocomplete → identity.street
// A-SCAN-25  ✅  company fields: name_id "vat_number" → company.vat_number
// A-SCAN-26  🔲  company fields: German label "USt-IdNr" → company.vat_number
// A-SCAN-27  🔲  company fields: IBAN with autocomplete=off → company.iban
// A-SCAN-28  🔲  ANTI_SIGNALS: search field suppressed (name=search → negative weight)
// A-SCAN-29  🔲  ANTI_SIGNALS: coupon/promo field suppressed
// A-SCAN-30  🔲  performance: 100 fields scanned in < 50ms
//
// ============================================================================


// ============================================================================
// SECTION B: COMMIT INSERT (committer.ts)
// ============================================================================
//
// File: committer.test.ts
//
// B-COMMIT-01  ✅  setValueSafely: native setter writes value and returns success
// B-COMMIT-02  ✅  setValueSafely: dispatches input + change events (not keyboard)
// B-COMMIT-03  ✅  setValueSafely: falls back to direct assignment
// B-COMMIT-04  ✅  setValueSafely: falls back to setAttribute
// B-COMMIT-05  ✅  setValueSafely: rejects disabled element
// B-COMMIT-06  ✅  setValueSafely: rejects readonly element
// B-COMMIT-07  ✅  commitInsert: rejects expired session
// B-COMMIT-08  ✅  commitInsert: rejects non-preview state
// B-COMMIT-09  ✅  commitInsert: atomic — zero writes if any check fails
// B-COMMIT-10  ✅  commitInsert: fills all targets on success
// B-COMMIT-11  ✅  runSafetyChecks: detects detached element
// B-COMMIT-12  ✅  runSafetyChecks: detects hidden element (display:none)
// B-COMMIT-13  ✅  runSafetyChecks: detects disabled element
// B-COMMIT-14  ✅  runSafetyChecks: detects cross-origin iframe
// B-COMMIT-15  ✅  runSafetyChecks: detects blocked input type (hidden)
// B-COMMIT-16  ✅  runSafetyChecks: detects bounding rect shift
// B-COMMIT-17  ✅  runSafetyChecks: detects fingerprint mismatch
// B-COMMIT-18  ✅  telemetry hook fires with correct structure (no values)
// B-COMMIT-19  🔲  commitInsert: guardElement gate blocks covered elements
// B-COMMIT-20  🔲  commitInsert: value-overwrite retry detects framework reactivity
// B-COMMIT-21  🔲  commitInsert: audit log records success/failure
// B-COMMIT-22  🔲  commitInsert: telemetryEvent emitted with duration
// B-COMMIT-23  🔲  runSafetyChecks: detects inert subtree
// B-COMMIT-24  🔲  runSafetyChecks: detects opacity < 0.01
//
// ============================================================================


// ============================================================================
// SECTION C: SETTINGS SYNC (toggleSync.ts)
// ============================================================================
//
// File: toggleSync.test.ts (TO BE CREATED)
//
// C-SYNC-01  🔲  initContentToggleSync reads from chrome.storage.local
// C-SYNC-02  🔲  getToggles returns cached state (no async)
// C-SYNC-03  🔲  getEffectiveToggles merges global + section toggles
// C-SYNC-04  🔲  isAutofillActive returns false when enabled=false
// C-SYNC-05  🔲  isAutofillActive returns false when vaultUnlocked=false
// C-SYNC-06  🔲  onToggleChange fires when storage changes
// C-SYNC-07  🔲  pushToggleUpdate broadcasts to all tabs
// C-SYNC-08  🔲  markVaultLocked sets vaultUnlocked=false and broadcasts
// C-SYNC-09  🔲  handleToggleRequest responds with current state
// C-SYNC-10  🔲  DEFAULT_TOGGLE_STATE has all sections ON
// C-SYNC-11  🔲  missing keys default to ON (safe default)
// C-SYNC-12  🔲  concurrent storage writes don't corrupt state
//
// ============================================================================


// ============================================================================
// SECTION D: OVERLAY MANAGER (overlayManager.ts)
// ============================================================================
//
// File: overlayManager.test.ts (TO BE CREATED; Shadow DOM requires real browser for some tests)
//
// D-OVERLAY-01  🔲  showOverlay creates Shadow DOM host with mode=closed
// D-OVERLAY-02  🔲  showOverlay positions below field (or above if no space)
// D-OVERLAY-03  🔲  showOverlay calls guardElement and rejects if unsafe
// D-OVERLAY-04  🔲  hideOverlay resolves promise with action=cancel
// D-OVERLAY-05  🔲  isOverlayVisible returns true when host exists
// D-OVERLAY-06  🔲  password field shows masked value (bullets)
// D-OVERLAY-07  🔲  reveal button toggles mask state
// D-OVERLAY-08  🔲  auto-remask after revealTimeoutMs
// D-OVERLAY-09  🔲  peek on hover shows first+last char
// D-OVERLAY-10  🔲  copy button writes to clipboard + auto-clears
// D-OVERLAY-11  🔲  Enter key resolves with action=insert
// D-OVERLAY-12  🔲  Escape key resolves with action=cancel
// D-OVERLAY-13  🔲  Tab cycles focus within card (trap)
// D-OVERLAY-14  🔲  click outside dismisses overlay
// D-OVERLAY-15  🔲  expire timer resolves with action=expired
// D-OVERLAY-16  🔲  position watchdog tracks anchor movement
// D-OVERLAY-17  🔲  anchor detached → auto-dismiss
// D-OVERLAY-18  🔲  overlay host moved off-screen → auto-dismiss (clickjack detection)
// D-OVERLAY-19  🔲  second showOverlay cancels first
// D-OVERLAY-20  🔲  telemetry events emitted for show/consent/cancel/expired
//
// ============================================================================


// ============================================================================
// SECTION E: QUICK SELECT (quickSelect.ts)
// ============================================================================
//
// File: quickSelect.test.ts (TO BE CREATED)
//
// E-QS-01  🔲  quickSelectOpen renders Shadow DOM host with mode=closed
// E-QS-02  🔲  quickSelectOpen calls guardElement on anchor
// E-QS-03  🔲  quickSelectOpen builds index if stale
// E-QS-04  🔲  quickSelectClose removes host from DOM
// E-QS-05  🔲  quickSelectIsOpen returns true when open
// E-QS-06  🔲  search-as-you-type filters results
// E-QS-07  🔲  empty query shows domain matches first
// E-QS-08  🔲  ArrowDown/Up navigates list
// E-QS-09  🔲  Enter selects highlighted item
// E-QS-10  🔲  Escape closes and resolves dismissed
// E-QS-11  🔲  Tab closes (no focus trap)
// E-QS-12  🔲  click outside closes
// E-QS-13  🔲  focus returns to anchor on close
// E-QS-14  🔲  trigger icon positioned inside field right edge
// E-QS-15  🔲  registerShortcut fires on Ctrl+Shift+.
// E-QS-16  🔲  unregisterShortcut removes listener
// E-QS-17  🔲  telemetry events emitted for open/select/dismiss
//
// ============================================================================


// ============================================================================
// SECTION F: VAULT INDEX (vaultIndex.ts)
// ============================================================================
//
// File: vaultIndex.test.ts (TO BE CREATED)
//
// F-IDX-01  🔲  buildIndex fetches items from vault API
// F-IDX-02  🔲  buildIndex strips passwords from IndexEntry
// F-IDX-03  🔲  buildIndex caps at MAX_INDEX_ENTRIES
// F-IDX-04  🔲  buildIndex returns false if already building (debounce)
// F-IDX-05  🔲  buildIndex returns false if fresh (within TTL)
// F-IDX-06  🔲  searchIndex AND semantics: all tokens must match
// F-IDX-07  🔲  searchIndex exact match scores highest
// F-IDX-08  🔲  searchIndex prefix match scores medium
// F-IDX-09  🔲  searchIndex domain boost applied for current domain
// F-IDX-10  🔲  searchIndex favorite boost applied
// F-IDX-11  🔲  searchIndex empty query: domain matches first, then recents
// F-IDX-12  🔲  clearIndex drops all entries
// F-IDX-13  🔲  invalidateIndex forces rebuild on next search
// F-IDX-14  🔲  isIndexStale returns true when empty or past TTL
//
// ============================================================================


// ============================================================================
// SECTION G: SUBMIT WATCHER (submitWatcher.ts)
// ============================================================================
//
// File: submitWatcher.test.ts (TO BE CREATED)
//
// G-SW-01  🔲  form submit extracts username + password
// G-SW-02  🔲  payment form detected and skipped
// G-SW-03  🔲  password < 2 chars skipped
// G-SW-04  🔲  duplicate credentials deduplicated within 3s
// G-SW-05  🔲  findUsernameField: autocomplete=username priority
// G-SW-06  🔲  findUsernameField: type=email fallback
// G-SW-07  🔲  findUsernameField: name/id regex fallback
// G-SW-08  🔲  classifyFormType: 2 password fields → signup
// G-SW-09  🔲  classifyFormType: autocomplete=new-password → signup
// G-SW-10  🔲  classifyFormType: button text "Log In" → login
// G-SW-11  🔲  fetch interception: POST to /api/login detected
// G-SW-12  🔲  XHR interception: POST to /auth detected
// G-SW-13  🔲  history hook: pushState triggers extraction check
// G-SW-14  🔲  stopSubmitWatcher restores original fetch/XHR/history
// G-SW-15  🔲  onCredentialSubmit callback fires with correct shape
//
// ============================================================================


// ============================================================================
// SECTION H: SAVE BAR (saveBar.ts)
// ============================================================================
//
// File: saveBar.test.ts (TO BE CREATED; Shadow DOM needs real browser)
//
// H-SB-01  🔲  showSaveBar creates Shadow DOM host
// H-SB-02  🔲  disk icon positioned near anchor element
// H-SB-03  🔲  clicking icon opens dialog
// H-SB-04  🔲  dialog pre-fills domain, username, masked password
// H-SB-05  🔲  reveal toggle shows/hides password
// H-SB-06  🔲  Save button resolves with action=save
// H-SB-07  🔲  Cancel button resolves with action=cancel
// H-SB-08  🔲  "Never for this site" resolves with action=never
// H-SB-09  🔲  Escape closes dialog
// H-SB-10  🔲  auto-dismiss after SAVE_BAR_TIMEOUT_MS
// H-SB-11  🔲  existing matches: "Update existing" radio shown
// H-SB-12  🔲  selecting update resolves with action=update + itemId
// H-SB-13  🔲  hideSaveBar removes host
// H-SB-14  🔲  isSaveBarVisible returns correct state
//
// ============================================================================


// ============================================================================
// SECTION I: CREDENTIAL STORE (credentialStore.ts)
// ============================================================================
//
// File: credentialStore.test.ts (TO BE CREATED)
//
// I-CS-01  🔲  findExistingCredentials queries vault API by domain
// I-CS-02  🔲  findExistingCredentials handles subdomain matching
// I-CS-03  🔲  executeCredentialSave action=save creates new item
// I-CS-04  🔲  executeCredentialSave action=update calls updateItem
// I-CS-05  🔲  executeCredentialSave action=cancel returns noop
// I-CS-06  🔲  executeCredentialSave action=never adds to blocklist
// I-CS-07  🔲  isNeverSaveDomain checks chrome.storage.local
// I-CS-08  🔲  addToNeverSaveList persists domain
// I-CS-09  🔲  removeFromNeverSaveList deletes domain
//
// ============================================================================


// ============================================================================
// SECTION J: DOM FINGERPRINT (domFingerprint.ts)
// ============================================================================
//
// File: domFingerprint.test.ts (TO BE CREATED)
//
// J-FP-01  🔲  takeFingerprint captures tagName, type, name, id, autocomplete
// J-FP-02  🔲  takeFingerprint captures rounded bounding rect
// J-FP-03  🔲  takeFingerprint captures parent chain (3 levels)
// J-FP-04  🔲  takeFingerprint produces SHA-256 hash
// J-FP-05  🔲  validateFingerprint passes for unchanged element
// J-FP-06  🔲  validateFingerprint fails for changed name
// J-FP-07  🔲  validateFingerprint fails for expired fingerprint
// J-FP-08  🔲  validateFingerprint fails for detached element
// J-FP-09  🔲  validateFingerprint fails for hidden element
// J-FP-10  🔲  validateFingerprint fails for moved element (>4px)
// J-FP-11  🔲  validateFingerprint fails for changed frame origin
//
// ============================================================================


// ============================================================================
// SECTION K: HARDENING (hardening.ts) — see hardening.test.ts
// ============================================================================
//
// K-GUARD-01  ✅  guardElement: normal element → safe
// K-GUARD-02  ✅  guardElement: detached → ELEMENT_DETACHED
// K-GUARD-03  ✅  guardElement: display:none → ELEMENT_HIDDEN
// K-GUARD-04  ✅  guardElement: zero rect → ELEMENT_HIDDEN
// K-GUARD-05  ✅  guardElement: offscreen → ELEMENT_OFFSCREEN
// K-GUARD-06  ✅  guardElement: inert → ELEMENT_NOT_FOCUSABLE
// K-GUARD-07  🔲  guardElement: ancestor opacity<0.01 → CLICKJACK_DETECTED
// K-GUARD-08  🔲  guardElement: elementFromPoint transparent cover → CLICKJACK_DETECTED
// K-GUARD-09  🔲  guardElement: sandboxed iframe → IFRAME_BLOCKED
// K-SAFE-01   ✅  evaluateSafeMode: single profile + high conf → auto_insert
// K-SAFE-02   ✅  evaluateSafeMode: multi-account → show_trigger_icon
// K-SAFE-03   ✅  evaluateSafeMode: unknown context → show_trigger_icon
// K-SAFE-04   ✅  evaluateSafeMode: public suffix → show_trigger_icon
// K-SAFE-05   ✅  evaluateSafeMode: ambiguous mapping → show_trigger_icon
// K-SAFE-06   ✅  evaluateSafeMode: no profiles → do_nothing
// K-SAFE-07   ✅  evaluateSafeMode: no mappings → show_trigger_icon
// K-REDACT-01 ✅  redactSecrets: password patterns
// K-REDACT-02 ✅  redactSecrets: base64 tokens
// K-REDACT-03 ✅  redactSecrets: email addresses
// K-REDACT-04 ✅  redactError: Error objects
// K-REDACT-05 ✅  maskValue: full mask and partial reveal
// K-AUDIT-01  ✅  auditLog: stores + auto-redacts
// K-AUDIT-02  ✅  auditLog: ring buffer cap
// K-AUDIT-03  ✅  auditLog: listener notification
// K-TELEM-01  ✅  emitTelemetryEvent: buffer + listeners
// K-TELEM-02  ✅  clearTelemetry: empties buffer
// K-DOMAIN-01 ✅  isPublicSuffixDomain: github.io, herokuapp.com, vercel.app
// K-DOMAIN-02 ✅  domainRelated: exact, www, subdomain
// K-DOMAIN-03 ✅  countDomainMatches: correct count
// K-MSG-01    ✅  getUserMessage: known codes → specific message
// K-MSG-02    ✅  getUserMessage: unknown codes → generic fallback
// K-CAT-01    ✅  FAILURE_MODES: unique IDs + complete fields
//
// ============================================================================


// ============================================================================
// SECTION L: ORCHESTRATOR (autofillOrchestrator.ts)
// ============================================================================
//
// File: autofillOrchestrator.test.ts (TO BE CREATED)
//
// L-ORCH-01  🔲  initAutofill initializes toggle sync
// L-ORCH-02  🔲  initAutofill registers keyboard shortcut
// L-ORCH-03  🔲  initAutofill starts SPA watcher
// L-ORCH-04  🔲  initAutofill runs initial scan if autofill active
// L-ORCH-05  🔲  teardownAutofill stops all watchers
// L-ORCH-06  🔲  teardownAutofill clears index + audit + telemetry
// L-ORCH-07  🔲  toggle OFF → stops scanner + watcher + hides UI
// L-ORCH-08  🔲  toggle ON → restarts scanner + watcher
// L-ORCH-09  🔲  SPA navigation → dismisses UI + invalidates cache
// L-ORCH-10  🔲  QuickSelect shortcut on non-input → no-op
// L-ORCH-11  🔲  QuickSelect shortcut on input → opens dropdown
// L-ORCH-12  🔲  save password pipeline: form submit → save bar → vault
// L-ORCH-13  🔲  save password pipeline: never-save domain → skipped
// L-ORCH-14  🔲  save password pipeline: login toggle off → skipped
// L-ORCH-15  🔲  forceScan returns fresh result
//
// ============================================================================


// ============================================================================
// SUMMARY
// ============================================================================
//
// Total test specifications:  176
//
//   ✅ Implemented:   ~103 (existing test files + hardening.test.ts)
//   🔲 Pending:        ~73 (skeletons in acceptance-criteria.ts + this index)
//
// Priority order for implementation:
//   1. K-* (hardening)         — security-critical  [DONE]
//   2. B-* (committer)         — value injection     [MOSTLY DONE]
//   3. A-* (fieldScanner)      — matching accuracy   [MOSTLY DONE]
//   4. C-* (toggleSync)        — settings integrity
//   5. G-* (submitWatcher)     — credential capture
//   6. F-* (vaultIndex)        — search correctness
//   7. J-* (domFingerprint)    — tamper detection
//   8. E-* (quickSelect)       — UI correctness
//   9. D-* (overlayManager)    — UI correctness
//  10. H-* (saveBar)           — UI correctness
//  11. I-* (credentialStore)   — vault integration
//  12. L-* (orchestrator)      — integration wiring
//
// ============================================================================
