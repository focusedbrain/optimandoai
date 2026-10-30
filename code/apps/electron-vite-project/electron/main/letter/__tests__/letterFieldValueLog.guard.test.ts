/**
 * Roadmap item 0.4: letter field values (names, addresses, IBANs, amounts) are never logged.
 * Only field names and counts may reach the log.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const letterDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = readdirSync(letterDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ f, src: readFileSync(join(letterDir, f), 'utf8') }))

describe('letter logs carry no field values', () => {
  it('no console call serialises a fields object', () => {
    for (const { f, src } of sources) {
      expect(src, f).not.toMatch(/console\.\w+\([^;]*JSON\.stringify\(\s*(fields|fieldValues|values)\b/)
      expect(src, f).not.toMatch(/console\.\w+\([^;]*Field values/)
    }
  })
})
