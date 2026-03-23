/**
 * No-Bypass Tests
 *
 * Static analysis ensuring:
 *   - No production file calls tool handler functions directly (outside executeToolRequest.ts)
 *   - The toolRegistry module does not export a direct execution path
 */

import { describe, test, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const ELECTRON_MAIN_DIR = path.resolve(__dirname, '..', '..')

function collectProductionFiles(dir: string): string[] {
  const results: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      results.push(...collectProductionFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      results.push(fullPath)
    }
  }
  return results
}

describe('No-Bypass — Static Analysis', () => {
  // Test 11: No direct tool handler calls outside executeToolRequest.ts
  test('11: no production file calls getToolHandler() and invokes result outside executeToolRequest.ts', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const violations: string[] = []

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      // executeToolRequest.ts is allowed to call getToolHandler
      // toolRegistry.ts defines it
      if (basename === 'executeToolRequest.ts' || basename === 'toolRegistry.ts') continue

      const content = fs.readFileSync(filePath, 'utf-8')

      // Check for direct import of getToolHandler + invocation pattern
      if (
        /getToolHandler\s*\(/.test(content) &&
        !content.includes('// re-export') &&
        !content.includes('export {')
      ) {
        const relativePath = path.relative(ELECTRON_MAIN_DIR, filePath)
        violations.push(`${relativePath}: calls getToolHandler()`)
      }
    }

    expect(
      violations,
      `These files bypass executeToolRequest by calling getToolHandler directly:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  // Test 12: toolRegistry does not export an execute/run function
  test('12: toolRegistry does not export a direct execution function', () => {
    const registryPath = path.resolve(__dirname, '..', 'toolRegistry.ts')
    const content = fs.readFileSync(registryPath, 'utf-8')

    // Should not export functions named execute*, run*, invoke*
    expect(content).not.toMatch(/export\s+(async\s+)?function\s+(execute|run|invoke)\w*\s*\(/)
  })

  test('executeToolRequest.ts is the only file that imports both toolRegistry and authorizeToolInvocation', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const filesImportingBoth: string[] = []

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      if (basename === 'executeToolRequest.ts') continue

      const content = fs.readFileSync(filePath, 'utf-8')
      const importsRegistry = /from\s+['"].*toolRegistry['"]/.test(content) ||
        /from\s+['"].*\/toolRegistry['"]/.test(content)
      const importsAuth = /from\s+['"].*authorizeToolInvocation['"]/.test(content)

      if (importsRegistry && importsAuth) {
        const relativePath = path.relative(ELECTRON_MAIN_DIR, filePath)
        filesImportingBoth.push(relativePath)
      }
    }

    expect(
      filesImportingBoth,
      `These files import both toolRegistry and authorizeToolInvocation, suggesting a bypass path:\n  ${filesImportingBoth.join('\n  ')}`,
    ).toEqual([])
  })

  test('no production file directly invokes a tool handler function by calling toolRegistry[name]()', () => {
    const allFiles = collectProductionFiles(ELECTRON_MAIN_DIR)
    const violations: string[] = []

    for (const filePath of allFiles) {
      const basename = path.basename(filePath)
      if (basename === 'executeToolRequest.ts' || basename === 'toolRegistry.ts') continue

      const content = fs.readFileSync(filePath, 'utf-8')
      if (/toolRegistry\s*\[/.test(content)) {
        const relativePath = path.relative(ELECTRON_MAIN_DIR, filePath)
        violations.push(relativePath)
      }
    }

    expect(violations).toEqual([])
  })
})
