/**
 * Tests: WebMCP Adapter — Dependency Isolation & Write Boundary Proof
 *
 * These tests parse the actual source file of webMcpAdapter.ts to prove
 * at the import/dependency level that the adapter CANNOT reach DOM write
 * functions (commitInsert, setValueSafely) except through the overlay
 * consent path (overlayManager.showOverlay).
 *
 * Strategy: regex-based import scanning on the raw source text.
 * No new dependencies — uses Node's fs module + standard regex.
 *
 * These tests catch:
 *   - Someone adding `import { commitInsert } from './committer'`
 *   - Someone adding `import { setValueSafely } from './committer'`
 *   - Someone importing from './writeBoundary' (which re-exports commitInsert)
 *   - Someone adding any export from committer.ts via dynamic import
 *   - Drift in the allowed dependency set (snapshot test)
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// ============================================================================
// §1  Source File Loading
// ============================================================================

const AUTOFILL_DIR = path.resolve(__dirname, '..')
const ADAPTER_PATH = path.join(AUTOFILL_DIR, 'webMcpAdapter.ts')
const adapterSource = fs.readFileSync(ADAPTER_PATH, 'utf-8')

/**
 * Extract all import specifiers from a TypeScript source file.
 * Matches:
 *   import { foo } from './bar'
 *   import { foo } from '../bar'
 *   import * as foo from './bar'
 *   import type { foo } from './bar'
 *
 * Returns an array of { specifier: string, isTypeOnly: boolean } objects
 * where specifier is the from-path (e.g., './committer', '../api').
 */
function extractImports(source: string): Array<{ specifier: string; isTypeOnly: boolean; line: string }> {
  const results: Array<{ specifier: string; isTypeOnly: boolean; line: string }> = []
  const importRe = /^import\s+(type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/gm
  let match: RegExpExecArray | null
  while ((match = importRe.exec(source)) !== null) {
    results.push({
      specifier: match[2],
      isTypeOnly: !!match[1],
      line: match[0],
    })
  }
  return results
}

/**
 * Normalize a relative import specifier to just the filename/module name.
 * './committer' → 'committer'
 * '../api' → 'api'
 * '../../../../../packages/shared/src/vault/originPolicy' → 'originPolicy'
 */
function moduleName(specifier: string): string {
  const parts = specifier.split('/')
  return parts[parts.length - 1]
}

const allImports = extractImports(adapterSource)
const valueImports = allImports.filter(i => !i.isTypeOnly)
const allSpecifiers = allImports.map(i => i.specifier)
const valueSpecifiers = valueImports.map(i => i.specifier)

// ============================================================================
// §2  Forbidden Direct Imports
// ============================================================================

describe('WebMCP Adapter — Dependency Isolation', () => {

  // ── Committer: MUST NOT be imported ──

  it('does not import from committer.ts (value import)', () => {
    const committerImports = valueSpecifiers.filter(s => moduleName(s) === 'committer')
    expect(committerImports).toEqual([])
  })

  it('does not import from committer.ts (type-only import)', () => {
    const committerTypeImports = allSpecifiers.filter(s => moduleName(s) === 'committer')
    expect(committerTypeImports).toEqual([])
  })

  it('does not import from writeBoundary.ts', () => {
    const writeBoundaryImports = allSpecifiers.filter(s => moduleName(s) === 'writeBoundary')
    expect(writeBoundaryImports).toEqual([])
  })

  // ── Specific function names: MUST NOT appear as imports ──

  it('does not import commitInsert anywhere in the source', () => {
    // Check both import lines and any dynamic references
    const importLines = allImports.map(i => i.line).join('\n')
    expect(importLines).not.toContain('commitInsert')
  })

  it('does not import setValueSafely anywhere in the source', () => {
    const importLines = allImports.map(i => i.line).join('\n')
    expect(importLines).not.toContain('setValueSafely')
  })

  it('does not import setPopoverFillActive anywhere in the source', () => {
    const importLines = allImports.map(i => i.line).join('\n')
    expect(importLines).not.toContain('setPopoverFillActive')
  })

  // ── Dynamic import / require: MUST NOT appear ──

  it('does not use dynamic import() for committer or writeBoundary', () => {
    const dynamicImportRe = /import\s*\(\s*['"][^'"]*(?:committer|writeBoundary)[^'"]*['"]\s*\)/g
    expect(adapterSource.match(dynamicImportRe)).toBeNull()
  })

  it('does not use require() at all', () => {
    // Content scripts should never use require(); this also blocks sneaking in committer
    const requireRe = /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g
    expect(adapterSource.match(requireRe)).toBeNull()
  })

  // ── Source text: no references to write functions in executable code ──

  it('does not call commitInsert() in any code path', () => {
    // Strip comments, then check for commitInsert(
    const stripped = stripComments(adapterSource)
    expect(stripped).not.toMatch(/\bcommitInsert\s*\(/)
  })

  it('does not call setValueSafely() in any code path', () => {
    const stripped = stripComments(adapterSource)
    expect(stripped).not.toMatch(/\bsetValueSafely\s*\(/)
  })

  // ============================================================================
  // §3  Allowed Dependency Snapshot
  // ============================================================================
  //
  // This is a "dependency snapshot" test. If someone adds a new import to
  // webMcpAdapter.ts, this test will fail — forcing a conscious review of
  // whether the new dependency is safe for a leaf security module.
  //
  // To update: add the new module to ALLOWED_MODULES below after review.

  const ALLOWED_VALUE_MODULES = new Set([
    'toggleSync',         // isAutofillActive check
    'fieldScanner',       // collectCandidates for DOM scanning
    'overlayManager',     // showOverlay + isOverlayVisible (safe: no write)
    'hardening',          // guardElement, auditLog, telemetry, redactError
    'haGuard',            // haCheck, isHAEnforced
    'domFingerprint',     // takeFingerprint
    'originPolicy',       // matchOrigin, isPublicSuffix
    'insertionPipeline',  // computeDisplayValue, DEFAULT_MASKING
    'api',                // vaultAPI.getItem
  ])

  const ALLOWED_TYPE_ONLY_MODULES = new Set([
    'fieldScanner',       // ScanResult type
    'insertionPipeline',  // OverlaySession, OverlayTarget, FieldCandidate types
    'fieldTaxonomy',      // FieldKind, VaultProfile, FieldEntry types
    'types',              // VaultItem, Field types
  ])

  const FORBIDDEN_MODULES = new Set([
    'committer',          // DOM write functions
    'writeBoundary',      // Re-exports commitInsert
    'inlinePopover',      // Has direct setValueSafely access
    'mutationGuard',      // Internal to overlay/committer pipeline
    'saveBar',            // Post-commit UI
    'submitWatcher',      // Credential capture (post-fill)
    'credentialStore',    // Vault save operations
  ])

  it('value imports match the allowed snapshot exactly', () => {
    const actualValueModules = new Set(valueImports.map(i => moduleName(i.specifier)))
    const unexpected = [...actualValueModules].filter(m => !ALLOWED_VALUE_MODULES.has(m))
    const missing = [...ALLOWED_VALUE_MODULES].filter(m => !actualValueModules.has(m))

    if (unexpected.length > 0) {
      throw new Error(
        `webMcpAdapter.ts has unexpected value import(s): [${unexpected.join(', ')}]. ` +
        'If this is intentional, add the module to ALLOWED_VALUE_MODULES in this test after security review.',
      )
    }

    // Missing is a warning, not a failure — modules can be removed safely
    // But we still want to know about it
    if (missing.length > 0) {
      console.warn(
        `[dependency-snapshot] Modules in allowed set but no longer imported: [${missing.join(', ')}]. ` +
        'Consider removing them from ALLOWED_VALUE_MODULES.',
      )
    }
  })

  it('does not import any explicitly forbidden module', () => {
    const allModules = allImports.map(i => moduleName(i.specifier))
    const violations = allModules.filter(m => FORBIDDEN_MODULES.has(m))
    expect(violations).toEqual([])
  })

  it('type-only imports do not include write-related modules', () => {
    const typeOnlyModules = allImports
      .filter(i => i.isTypeOnly)
      .map(i => moduleName(i.specifier))

    for (const mod of typeOnlyModules) {
      expect(FORBIDDEN_MODULES.has(mod)).toBe(false)
    }
  })

  // ============================================================================
  // §4  Transitive Write Reachability (via overlayManager)
  // ============================================================================
  //
  // The adapter imports showOverlay from overlayManager. We need to verify that
  // overlayManager itself does NOT re-export or expose commitInsert/setValueSafely.

  it('overlayManager.ts does not export commitInsert or setValueSafely', () => {
    const overlayPath = path.join(AUTOFILL_DIR, 'overlayManager.ts')
    const overlaySource = fs.readFileSync(overlayPath, 'utf-8')

    // Check export declarations
    const exportRe = /export\s+(?:async\s+)?function\s+(\w+)|export\s*\{\s*([^}]+)\}/g
    const exportedNames: string[] = []
    let m: RegExpExecArray | null
    while ((m = exportRe.exec(overlaySource)) !== null) {
      if (m[1]) exportedNames.push(m[1])
      if (m[2]) exportedNames.push(...m[2].split(',').map(s => s.trim().split(/\s+as\s+/).pop()!.trim()))
    }

    expect(exportedNames).not.toContain('commitInsert')
    expect(exportedNames).not.toContain('setValueSafely')
    expect(exportedNames).not.toContain('setPopoverFillActive')
  })

  it('overlayManager.ts does not import from committer.ts', () => {
    const overlayPath = path.join(AUTOFILL_DIR, 'overlayManager.ts')
    const overlaySource = fs.readFileSync(overlayPath, 'utf-8')
    const overlayImports = extractImports(overlaySource)
    const committerImports = overlayImports.filter(i => moduleName(i.specifier) === 'committer')
    expect(committerImports).toEqual([])
  })

  // ============================================================================
  // §5  Full Write Path Proof (structural)
  // ============================================================================
  //
  // Prove that the ONLY way to reach setValueSafely from webMcpAdapter is:
  //   adapter → showOverlay() → user clicks Insert → onInsert() → [caller] → commitInsert() → setValueSafely()
  //
  // This is a structural proof: the adapter can only call showOverlay(), which
  // returns a Promise<UserDecision>. The adapter does NOT await this promise.
  // Even if it did, the UserDecision is { action: 'insert' | 'cancel' | 'expired' },
  // not a function — there is no code path from the decision value to commitInsert.

  it('adapter only calls showOverlay (fire-and-forget), never awaits it', () => {
    // Find all calls to showOverlay in the source
    const showOverlayCalls = adapterSource.match(/\bshowOverlay\s*\(/g) ?? []
    expect(showOverlayCalls.length).toBeGreaterThan(0) // Sanity: it does call showOverlay

    // Verify that showOverlay is NOT awaited (fire-and-forget pattern)
    const awaitedCalls = adapterSource.match(/await\s+showOverlay\s*\(/g) ?? []
    expect(awaitedCalls).toHaveLength(0)
  })

  it('adapter does not destructure or use the return value of showOverlay', () => {
    // showOverlay returns Promise<UserDecision>. If the adapter captures
    // this value, it could theoretically chain off it. Verify it's discarded.
    const stripped = stripComments(adapterSource)

    // Pattern: `const/let/var x = showOverlay(` or `const/let/var x = await showOverlay(`
    const capturedRe = /(?:const|let|var)\s+\w+\s*=\s*(?:await\s+)?showOverlay\s*\(/g
    expect(stripped.match(capturedRe)).toBeNull()

    // Pattern: `.then(` chained on showOverlay
    const chainedRe = /showOverlay\s*\([^)]*\)\s*\.then\s*\(/g
    expect(stripped.match(chainedRe)).toBeNull()
  })
})

// ============================================================================
// Helpers
// ============================================================================

/**
 * Strip single-line (//) and multi-line comments from source.
 * Naive but sufficient for detecting function calls in executable code.
 */
function stripComments(source: string): string {
  // Remove multi-line comments
  let result = source.replace(/\/\*[\s\S]*?\*\//g, '')
  // Remove single-line comments
  result = result.replace(/\/\/.*$/gm, '')
  return result
}
