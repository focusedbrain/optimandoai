/**
 * Roadmap item 0.26 / decision D-38 — source guard over every relay service-RPC path.
 *   - Only `sealedServiceRpc.ts` itself and the in-capsule `contextSyncSeal.ts` (canonical
 *     `context_blocks_sealed`, v1 by design) may seal unauthenticated envelopes.
 *   - Every relay receiver that opens a sealed envelope requires the authenticated v2 form.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const mainDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...sources(p))
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p)
    }
  }
  return out
}

const files = sources(mainDir).map((p) => ({ rel: relative(mainDir, p).split('\\').join('/'), src: readFileSync(p, 'utf8') }))

describe('relay service RPC is always sender-authenticated', () => {
  it('no unauthenticated sealing outside the allowlist', () => {
    const allowed = new Set(['serviceRpc/sealedServiceRpc.ts', 'handshake/contextSyncSeal.ts'])
    const offenders = files.filter((f) => !allowed.has(f.rel) && /\bsealServiceRpcPayload\s*\(/.test(f.src)).map((f) => f.rel)
    expect(offenders).toEqual([])
  })

  it('every relay receiver opens with requireAuthenticated', () => {
    const receivers = files.filter((f) => f.src.includes('parseSealedServiceRpcEnvelopeFromRelayCapsule(ctx.capsule)'))
    expect(receivers.length).toBeGreaterThanOrEqual(5)
    for (const f of receivers) {
      const opens = [...f.src.matchAll(/openServiceRpcPayload(?:ResolvingLocalKey)?\(([^)]*)\)/g)]
      expect(opens.length, f.rel).toBeGreaterThan(0)
      for (const m of opens) expect(m[0], f.rel).toMatch(/requireAuthenticated: true/)
    }
  })
})
