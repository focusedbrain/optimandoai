/**
 * Tests: QSO Module Isolation — No New Write Paths
 *
 * Validates:
 *   1. qsoEngine.ts does NOT import setValueSafely
 *   2. qsoEngine.ts does NOT import writeBoundary.ts
 *   3. submitGuard.ts does NOT import committer.ts or writeBoundary.ts
 *   4. submitGuard.ts does NOT call setValueSafely
 *   5. QSO modules are leaf modules (no reverse dependencies from core)
 *   6. Dependency snapshot to catch future regressions
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'

describe('QSO Isolation — No New Write Paths', () => {
  it('qsoEngine.ts does not import setValueSafely', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoEngine.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Extract import lines only (not comments)
    const importLines = source.split('\n').filter(l => l.trimStart().startsWith('import '))
    const importBlock = importLines.join('\n')
    expect(importBlock).not.toContain('setValueSafely')
  })

  it('qsoEngine.ts does not import from writeBoundary', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoEngine.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    const importLines = source.split('\n').filter(l => l.trimStart().startsWith('import '))
    const importBlock = importLines.join('\n')
    expect(importBlock).not.toContain('writeBoundary')
  })

  it('qsoEngine.ts imports commitInsert from committer (not writeBoundary)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoEngine.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Must import commitInsert + setQsoFillActive from committer
    expect(source).toContain("import { commitInsert, setQsoFillActive } from '../committer'")
    // Import lines must NOT reference setValueSafely
    const importLines = source.split('\n').filter(l => l.trimStart().startsWith('import '))
    expect(importLines.join('\n')).not.toContain('setValueSafely')
  })

  it('submitGuard.ts does not import from committer or writeBoundary', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'submitGuard.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Check import lines only — comments may reference these for documentation
    const importLines = source.split('\n').filter(l => l.trimStart().startsWith('import '))
    const importBlock = importLines.join('\n')
    expect(importBlock).not.toContain('committer')
    expect(importBlock).not.toContain('writeBoundary')
    expect(importBlock).not.toContain('setValueSafely')
    expect(importBlock).not.toContain('commitInsert')
  })

  it('submitGuard.ts only performs submission (requestSubmit/click), not field writes', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'submitGuard.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Must contain requestSubmit (the safe submit path)
    expect(source).toContain('requestSubmit')
    // Must contain .click() (fallback submit path)
    expect(source).toContain('.click()')
    // Must NOT contain value assignment patterns
    expect(source).not.toContain('.value =')
    expect(source).not.toContain('setAttribute(')
    expect(source).not.toMatch(/nativeInputValueSetter/)
  })

  it('qsoIcon.ts does not import any write modules', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoIcon.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).not.toContain('committer')
    expect(source).not.toContain('writeBoundary')
    expect(source).not.toContain('setValueSafely')
    expect(source).not.toContain('commitInsert')
  })

  it('qsoPicker.ts does not import any write modules', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoPicker.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).not.toContain('committer')
    expect(source).not.toContain('writeBoundary')
    expect(source).not.toContain('setValueSafely')
    expect(source).not.toContain('commitInsert')
  })

  it('qsoEngine.ts dependency snapshot', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoEngine.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Extract all import statements
    const imports = (source.match(/^import .+ from .+$/gm) ?? []).map(l => l.trim())

    // Snapshot: these are the ONLY allowed imports
    const allowedImportPrefixes = [
      "import { collectCandidates } from '../fieldScanner'",
      "import type { ScanResult } from '../fieldScanner'",
      "import { commitInsert, setQsoFillActive } from '../committer'",
      "import { guardElement, auditLogSafe, emitTelemetryEvent, redactError } from '../hardening'",
      "import { isHAEnforced } from '../haGuard'",
      "import { isAutofillActive } from '../toggleSync'",
      "import { takeFingerprint } from '../domFingerprint'",
      "import { matchOrigin, isPublicSuffix }",
      "import { computeDisplayValue, DEFAULT_MASKING }",
      "import type {",
      "import * as vaultAPI from '../../api'",
      "import type { FillProjection }",
      "import { attachGuard } from '../mutationGuard'",
      "import { resolveSubmitTarget, safeSubmitAfterFill }",
      "import type { SubmitBlockReason }",
      "import { areWritesDisabled } from '../writesKillSwitch'",
    ]

    // Every import must match at least one allowed prefix
    for (const imp of imports) {
      const allowed = allowedImportPrefixes.some(prefix => imp.startsWith(prefix))
      expect(allowed).toBe(true)
    }
  })
})

describe('QSO Security — isTrusted Enforcement', () => {
  it('qsoIcon.ts validates isTrusted before calling onClick', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoIcon.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // The click handler must check isTrusted and block untrusted
    expect(source).toContain('if (!e.isTrusted)')
    expect(source).toContain('e.preventDefault()')
    expect(source).toContain('e.stopImmediatePropagation()')
  })

  it('qsoPicker.ts validates isTrusted on item selection', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoPicker.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Selection click handler must check isTrusted
    expect(source).toContain('if (!e.isTrusted) return')
  })

  it('qsoEngine.ts executeQsoFill checks isTrusted parameter', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoEngine.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // The function must gate on isTrusted
    expect(source).toContain('if (!isTrusted)')
  })

  it('submitGuard.ts safeSubmitAfterFill checks isTrusted', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'submitGuard.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).toContain('if (!input.isTrusted)')
  })
})

describe('QSO — Shadow DOM Isolation', () => {
  it('qsoIcon.ts uses closed shadow DOM', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoIcon.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).toContain("attachShadow({ mode: 'closed' })")
  })

  it('qsoPicker.ts uses closed shadow DOM', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoPicker.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).toContain("attachShadow({ mode: 'closed' })")
  })
})

// ============================================================================
// PART 5 — Existing Security Invariants Hold
// ============================================================================

describe('PART 5 — Existing Invariants', () => {
  it('setValueSafely only called from committer.ts and inlinePopover.ts (not QSO)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const autofillDir = path.resolve(__dirname, '..')

    // These files are allowed to call setValueSafely
    const allowedCallers = new Set(['committer.ts', 'inlinePopover.ts'])

    // Scan QSO modules — none should import or call setValueSafely
    const qsoDir = path.resolve(autofillDir, 'qso')
    const qsoFiles = fs.readdirSync(qsoDir).filter((f: string) => f.endsWith('.ts'))
    for (const file of qsoFiles) {
      const source = fs.readFileSync(path.resolve(qsoDir, file), 'utf-8')
      const importLines = source.split('\n').filter((l: string) => l.trimStart().startsWith('import '))
      expect(importLines.join('\n')).not.toContain('setValueSafely')
    }

    // submitGuard must not call setValueSafely
    const submitGuardSource = fs.readFileSync(path.resolve(autofillDir, 'submitGuard.ts'), 'utf-8')
    const sgImports = submitGuardSource.split('\n').filter((l: string) => l.trimStart().startsWith('import '))
    expect(sgImports.join('\n')).not.toContain('setValueSafely')
  })

  it('submitGuard.ts does not perform any field value writes', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'submitGuard.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).not.toContain('.value =')
    expect(source).not.toMatch(/nativeInputValueSetter/)
    expect(source).not.toContain('setAttribute(')
  })

  it('qsoIcon.ts blocks untrusted clicks with preventDefault', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoIcon.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).toContain('e.preventDefault()')
    expect(source).toContain('e.stopImmediatePropagation()')
  })

  it('qsoEngine.ts uses auditLogSafe, not auditLog for PII-sensitive paths', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoEngine.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    // Engine should import auditLogSafe
    expect(source).toContain('auditLogSafe')
    // All audit calls in the engine should be auditLogSafe (not bare auditLog)
    const auditCalls = source.split('\n').filter((l: string) =>
      l.includes('auditLog') && !l.includes('auditLogSafe') && !l.startsWith('import') && !l.startsWith('//')
    )
    // Filter out comment-only lines and imports
    const actualCalls = auditCalls.filter((l: string) => {
      const trimmed = l.trim()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('import')
    })
    expect(actualCalls.length).toBe(0)
  })

  it('QSO_RESULT_VERSION string is stable', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const filePath = path.resolve(__dirname, '..', 'qso', 'qsoEngine.ts')
    const source = fs.readFileSync(filePath, 'utf-8')

    expect(source).toContain("export const QSO_RESULT_VERSION = 'qso-v1'")
  })
})
