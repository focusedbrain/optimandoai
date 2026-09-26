/**
 * Source-walking guard: `src/wrCode.ts` must carry the registry-published
 * check profile VERBATIM.
 *
 * The registry material is the authority [XVI.5.4] — an identifier validated
 * with a different table, mapping, or algorithm is non-conformant. A silent
 * local edit to the transcribed region is exactly the failure this guard
 * exists to catch, so it compares bytes rather than behaviour.
 *
 * SCOPE UNDER ANNEX XVI v1.95. The ratified upstream is now Annex XVI
 * Appendix A (`docs/spec/Annex_XVI_WR_Code_v1.95.pdf`), so the document this
 * guard pins is superseded in part. A.1 and this module now agree on the
 * algebra exactly — A.1's reference implementation is `op(x, y) = mul2(x) ^ y`,
 * which is `star` below — so re-pointing is no longer blocked on any question
 * of substance.
 *
 * It has still not moved, for one mechanical reason: this guard is a BYTE
 * comparison against a `typescript` fence, and Appendix A publishes its
 * reference implementation as illustrative Python. Re-pointing therefore needs
 * a registry-material document at grammar version 2 carrying the same
 * transcribed block, which does not exist yet. Until it does, this guard keeps
 * doing its original job over the v1.4 text, and conformance to what v1.95
 * requires of the check is asserted separately, behaviourally, by
 * `wrCode.annexXVI.appendixA.conformance.test.ts` — including all 1024 cells of
 * A.1's published table. Neither suite subsumes the other: this one pins the
 * bytes, that one pins the result.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

const PROFILE_DOC = join(
  repoRoot,
  'docs',
  'spec',
  'WR-Code_Check-Profile_Registry-Material_v1.4.md',
)
const MODULE = join(repoRoot, 'packages', 'ingestion-core', 'src', 'wrCode.ts')

const BEGIN = '// ─── BEGIN check profile v1.4 §5 — transcribed verbatim, do not edit ─────────'
const END = '// ─── END check profile v1.4 §5 ───────────────────────────────────────────────'

const lf = (s: string): string => s.replace(/\r\n/g, '\n')

describe('wrCode.ts transcribes check profile v1.4 §5 verbatim', () => {
  test('the registry material is present in the repo', () => {
    expect(() => readFileSync(PROFILE_DOC, 'utf8')).not.toThrow()
  })

  test('the transcribed region is byte-identical to the published §5 block', () => {
    const doc = lf(readFileSync(PROFILE_DOC, 'utf8'))
    const source = lf(readFileSync(MODULE, 'utf8'))

    const fences = [...doc.matchAll(/```typescript\n([\s\S]*?)```/g)].map((m) => m[1])
    expect(fences).toHaveLength(1)
    const published = fences[0].trim()

    const beginAt = source.indexOf(BEGIN)
    const endAt = source.indexOf(END)
    expect(beginAt, 'BEGIN marker missing from wrCode.ts').toBeGreaterThanOrEqual(0)
    expect(endAt, 'END marker missing from wrCode.ts').toBeGreaterThan(beginAt)
    const transcribed = source.slice(beginAt + BEGIN.length, endAt).trim()

    expect(transcribed).toBe(published)
  })

  test('the transcribed region performs no I/O and reads no ambient state', () => {
    const source = lf(readFileSync(MODULE, 'utf8'))
    const transcribed = source.slice(
      source.indexOf(BEGIN) + BEGIN.length,
      source.indexOf(END),
    )
    for (const forbidden of [
      'import',
      'require(',
      'fetch(',
      'process.',
      'Date.',
      'Math.random',
      'globalThis',
    ]) {
      expect(transcribed, `${forbidden} in the offline check profile`).not.toContain(forbidden)
    }
  })

  test('the whole module stays offline-capable [XVI.15.1]', () => {
    const source = lf(readFileSync(MODULE, 'utf8'))
    // Comments legitimately mention resolution; code must not reach for it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    for (const forbidden of ['import ', 'fetch(', 'require(', 'node:', 'process.env']) {
      expect(code, `${forbidden} in a pure offline module`).not.toContain(forbidden)
    }
  })
})
