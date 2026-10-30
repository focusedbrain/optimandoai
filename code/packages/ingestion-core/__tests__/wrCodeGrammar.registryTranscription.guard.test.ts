/**
 * Transcription guard v2 — grammar registry ⇄ registry material.
 *
 * `WR-Code_Reference-Grammar_Registry-Material_v2.0.md` is the transcription
 * target for the grammar-version-2 registry (Annex XVI v1.95 §XVI.5.1–5.4,
 * §XVI.5.8). This guard parses the material's fenced tables and compares them
 * ENTRY FOR ENTRY against `wrCodeGrammar.ts`, in both directions: a table row
 * without a module entry fails exactly like a module entry without a table
 * row. Edit the registry material first, then the module — never one alone.
 *
 * (The check ARITHMETIC has its own byte-level guard:
 * `wrCode.profileTranscription.guard.test.ts` pins `wrCode.ts` to the v1.4
 * check-profile material, ratified upstream in Annex XVI Appendix A.)
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WR_CODE_CLASSES,
  WR_CODE_CLASS_SPECS,
  WR_CODE_CLASS_VALUES,
  classifyWrCodePrefix,
  type WrCodeClass,
} from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const MATERIAL = join(
  resolve(here, '../../..'),
  'docs',
  'spec',
  'WR-Code_Reference-Grammar_Registry-Material_v2.0.md',
)

const doc = readFileSync(MATERIAL, 'utf8').replace(/\r\n/g, '\n')

function fence(tag: string): string[] {
  const m = doc.match(new RegExp('```' + tag + '\\n([\\s\\S]*?)```'))
  expect(m, `fenced block \`${tag}\` missing from the registry material`).not.toBeNull()
  return m![1].split('\n').map((l) => l.trim()).filter((l) => l !== '')
}

describe('grammar registry transcription guard (material v2.0)', () => {
  test('prefix registry matches classifyWrCodePrefix in both directions', () => {
    const rows = fence('prefix-registry').map((line) => {
      const [seq, state] = line.split('|').map((s) => s.trim())
      return { seq, state }
    })
    expect(rows.map((r) => r.seq).sort()).toEqual(['C', 'I', 'P', 'S', 'SC', 'SE', 'SI', 'SP'])
    for (const { seq, state } of rows) {
      const got = classifyWrCodePrefix(seq)
      expect(got.state, seq).toBe(state)
      if (state === 'TERMINAL') expect(got.cls, seq).toBe(seq)
    }
    // Reverse direction: every module class appears as a TERMINAL row.
    const terminals = new Set(rows.filter((r) => r.state === 'TERMINAL').map((r) => r.seq))
    for (const cls of WR_CODE_CLASSES) expect(terminals.has(cls), cls).toBe(true)
  })

  test('class value table matches WR_CODE_CLASS_VALUES exactly', () => {
    const parsed = Object.fromEntries(
      fence('class-values').map((line) => {
        const [sym, value] = line.split('|').map((s) => s.trim())
        return [sym, Number(value)]
      }),
    )
    expect(parsed).toEqual(WR_CODE_CLASS_VALUES)
  })

  test('class form table matches WR_CODE_CLASS_SPECS entry for entry', () => {
    const rows = fence('class-forms').map((line) => {
      const [cls, values, fields, placement, form] = line.split('|').map((s) => s.trim())
      return {
        cls: cls as WrCodeClass,
        classValues: values.split(/\s+/).map(Number),
        fields: fields.split(/\s+/).map((f) => {
          const [role, length] = f.split(':')
          return { role, length: Number(length) }
        }),
        placement,
        form,
      }
    })
    expect(rows.map((r) => r.cls).sort()).toEqual([...WR_CODE_CLASSES].sort())
    for (const row of rows) {
      const spec = WR_CODE_CLASS_SPECS[row.cls]
      expect(spec, row.cls).toBeDefined()
      expect([...spec.classValues], row.cls).toEqual(row.classValues)
      expect(
        spec.fields.map((f) => ({ role: f.role as string, length: f.length })),
        row.cls,
      ).toEqual(row.fields)
      expect(spec.checkPlacement, row.cls).toBe(row.placement)
      // The canonical form column encodes prefix + block lengths + placement.
      const blocks = row.form.split('-')
      expect(blocks[0], row.cls).toBe(row.cls)
      const bodyBlocks = blocks.slice(1, spec.checkPlacement === 'separate' ? -1 : undefined)
      expect(bodyBlocks.length, row.cls).toBe(spec.fields.length)
      bodyBlocks.forEach((b, i) => {
        const expected =
          spec.fields[i].length +
          (spec.checkPlacement === 'attached' && i === spec.fields.length - 1 ? 1 : 0)
        expect(b.length, `${row.cls} block ${i}`).toBe(expected)
      })
      if (spec.checkPlacement === 'separate') expect(blocks[blocks.length - 1], row.cls).toBe('X')
    }
  })

  test('the material pins the authority it was derived from', () => {
    expect(doc).toContain('Annex XVI v1.95')
    expect(doc).toContain('064AAD6D8F28A0B1B7688C516CA3C4D8BA486BF723A5483D8C119D44F875829F')
  })
})
