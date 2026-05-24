/**
 * P4.5.11 — renderer credential hardening grep checks.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const srcRoot = join(import.meta.dirname, '..', '..')

const FORBIDDEN_KEY_MARKERS = [
  'BEGIN OPENSSH PRIVATE KEY',
  'BEGIN RSA PRIVATE KEY',
  'BEGIN EC PRIVATE KEY',
]

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (name === '__tests__' || name === 'fixtures') continue
      walkSourceFiles(path, out)
      continue
    }
    if (/\.(tsx?|jsx?)$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

describe('P4.5.11 credential hardening — renderer source', () => {
  it('has no SSH private key string literals in production renderer source', () => {
    const hits: string[] = []
    for (const file of walkSourceFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8')
      for (const marker of FORBIDDEN_KEY_MARKERS) {
        if (content.includes(marker)) {
          hits.push(`${file}: ${marker}`)
        }
      }
    }
    expect(hits).toEqual([])
  })

  it('edge-tier-wizard does not use FileReader for SSH key loading', () => {
    const wizardRoot = join(srcRoot, 'edge-tier-wizard')
    const hits: string[] = []
    for (const file of walkSourceFiles(wizardRoot)) {
      const content = readFileSync(file, 'utf8')
      if (content.includes('FileReader')) {
        hits.push(file)
      }
    }
    expect(hits).toEqual([])
  })
})
