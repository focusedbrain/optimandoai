/**
 * Structural-absence checks — Phase 1 dead-path removal acceptance
 * [VII.10.5.5]: no auto-accept / consent-skip control may be representable in
 * schema or UI, and the removed dead paths must leave no references behind.
 *
 * Scans repository SOURCE files (not build artifacts, docs, or analysis
 * reports) for the forbidden tokens.
 */
import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../../../../../..')

const SOURCE_ROOTS = [
  'apps/electron-vite-project/electron',
  'apps/electron-vite-project/src',
  'apps/extension-chromium/src',
  'packages',
]

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|sql)$/
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', '.git', 'coverage'])
// This test file names the forbidden tokens on purpose.
const SELF = 'structuralAbsence.test.ts'

function* walk(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry) || entry.startsWith('build0')) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walk(full)
    } else if (SOURCE_EXT.test(entry) && !full.endsWith(SELF)) {
      yield full
    }
  }
}

function findReferences(token: string): string[] {
  const hits: string[] = []
  for (const root of SOURCE_ROOTS) {
    for (const file of walk(join(repoRoot, root))) {
      const content = readFileSync(file, 'utf8')
      if (content.includes(token)) hits.push(file)
    }
  }
  return hits
}

describe('structural absence — Phase 1 dead-path removal', () => {
  test('no skipConsentForAutomation anywhere in source [VII.10.5.5]', () => {
    expect(findReferences('skipConsentForAutomation')).toEqual([])
  })

  test('no verifyContextVersions (deleted no-op pipeline step, A12)', () => {
    expect(findReferences('verifyContextVersions')).toEqual([])
  })

  test('no handshakeVerification module references (deleted unused verifier, A11)', () => {
    expect(findReferences('verifyHandshakeCapsule')).toEqual([])
  })
})
