/**
 * Regression: Browser-safe imports in extension vault UI
 *
 * Extension vault UI (vault lightbox, HS Context Profiles, autofill) runs in
 * the browser/content-script context where `require` is not defined. Any use of
 * require() causes "require is not defined" at runtime.
 *
 * This test scans key files that run in the browser and asserts they do not
 * use require(). Use static ESM imports instead.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const VAULT_DIR = path.resolve(__dirname, '..')

const BROWSER_EXECUTED_FILES = [
  'autofill/autofillOrchestrator.ts',
  'vault-ui-typescript.ts',
  'hsContext/HsContextProfileList.tsx',
  'hsContext/HsContextProfileEditor.tsx',
  'hsContext/HsContextDocumentUpload.tsx',
  'hsContextProfilesRpc.ts',
]

const REQUIRE_RE = /\brequire\s*\(\s*['"][^'"]+['"]\s*\)/g

describe('browser-safe imports (no require)', () => {
  for (const relPath of BROWSER_EXECUTED_FILES) {
    it(`${relPath} does not use require()`, () => {
      const fullPath = path.join(VAULT_DIR, relPath)
      if (!fs.existsSync(fullPath)) {
        expect.fail(`File not found: ${fullPath}`)
      }
      const source = fs.readFileSync(fullPath, 'utf-8')
      const matches = source.match(REQUIRE_RE)
      expect(matches).toBeNull()
    })
  }
})
