/**
 * Guard — provenance gates parsing, and the gate is at the HOST boundary
 * (Order 02 / 2A; contradictions G4-2, G4-5).
 *
 * Three invariants are pinned here, two behavioural and one source-walking,
 * because each can be broken independently:
 *
 * 1. No WR parse or code extraction happens for a message whose `channel_pass`
 *    is false. Enforced structurally: the detector is not called, rather than
 *    called and its result discarded.
 *
 * 2. No affordance is derived from a provenance-failed message — it lands as a
 *    plain row carrying its CPR, indistinguishable downstream from mail that
 *    genuinely contained nothing.
 *
 * 3. Guest package output is UNTRUSTED PAYLOAD. The depackaging guest parses
 *    hostile bytes — that is what it exists for — and header parsing is a
 *    precondition of provenance evaluation, so "no parse before provenance"
 *    can never be literal in-guest. The author's ruling: the guest MAY detect,
 *    the host MUST NOT act. Trust verdicts are computed host-side, never in
 *    the least-trusted environment of the pipeline, and every consumer of
 *    guest package output sits behind the host gate.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const here = fileURLToPath(new URL('.', import.meta.url))
const routerSource = readFileSync(resolve(here, '../messageRouter.ts'), 'utf8')

describe('2A — detection is gated on channel_pass, structurally', () => {
  it('the detector is called exactly once, and only inside the gate', () => {
    const calls = routerSource.match(/detectBeapPackageFromMessage\(/g) ?? []
    // One definition, one call site.
    expect(calls.length, 'detector referenced more than at its definition and single gated call').toBe(2)

    const gate = routerSource.indexOf('channelProvenance.channel_pass')
    const call = routerSource.indexOf('? detectBeapPackageFromMessage(')
    expect(gate, 'no channel_pass gate found').toBeGreaterThan(-1)
    expect(call, 'detector is not called from the gated ternary').toBeGreaterThan(-1)
    expect(call, 'detector call does not sit under the channel_pass gate').toBeGreaterThan(gate)
  })

  it('the CPR is produced before the detector is reached', () => {
    const produce = routerSource.indexOf('produceChannelProvenance({')
    const call = routerSource.indexOf('? detectBeapPackageFromMessage(')
    expect(produce).toBeGreaterThan(-1)
    expect(produce, 'detection precedes CPR production in source order').toBeLessThan(call)
  })

  it('a provenance-failed message resolves to the same shape as found-nothing', () => {
    // NO_DETECTION must not carry a marker a later change could branch on to
    // resurrect an affordance. Only the CPR distinguishes the two cases.
    const block = routerSource.slice(
      routerSource.indexOf('const NO_DETECTION'),
      routerSource.indexOf('})', routerSource.indexOf('const NO_DETECTION')),
    )
    expect(block).toMatch(/beapPackageJson:\s*null/)
    expect(block).toMatch(/handshakeId:\s*null/)
    expect(block).toMatch(/detectedType:\s*'plain'/)
    expect(block).not.toMatch(/suppressed|blocked|provenance|reason/i)
  })
})

describe('2A — the fail-open degradations are closed', () => {
  // The quarantine path is entered when a depackage produced something we could
  // not validate. Falling back to a plain inbox row there presents unvalidated
  // carrier content as ordinary mail.
  // Bounded to the quarantine path itself. The plain-email branch that follows
  // it uses `buildPlainEmailInboxPayload` legitimately — that is the ordinary
  // route for mail that never was a carrier.
  const quarantineBlock = routerSource.slice(
    routerSource.indexOf('// ── Quarantine path ──'),
    routerSource.indexOf('// ── Plain email path'),
  )

  it('the quarantine path contains no plain-inbox fallback', () => {
    expect(quarantineBlock.length).toBeGreaterThan(0)
    expect(quarantineBlock).not.toMatch(/buildPlainEmailInboxPayload/)
  })

  it('all three failure conditions hold instead of degrading', () => {
    for (const reason of ['no_paired_sandbox', 'quarantine_seal_failed', 'quarantine_validator_rejected']) {
      expect(quarantineBlock, `${reason} does not fail closed`).toContain(reason)
    }
    const held = quarantineBlock.match(/throw new DepackageCutoverHeldError\(/g) ?? []
    expect(held.length, 'expected all three branches to hold').toBe(3)
  })

  it('the inline path holds on the same conditions the seam path already did', () => {
    // An invariant that holds on one of two paths is not an invariant. If the
    // seam path ever stops holding, this fails too.
    const seam = routerSource.slice(routerSource.indexOf('async function quarantineRawBytes'))
    for (const reason of ['quarantine_seal_failed', 'quarantine_validator_rejected']) {
      expect(seam, `seam path no longer holds on ${reason}`).toContain(reason)
    }
  })
})

describe('2A — guest package output is untrusted payload behind the host gate', () => {
  it('trust verdicts are never computed in the guest', () => {
    // The guest is the least-trusted environment in the pipeline. A
    // sandbox-computed `channel_pass` would have to be re-verified host-side
    // anyway, so it must not exist.
    for (const file of ['../../depackaging-microvm/emailDepackage.ts', '../../depackaging-microvm/depackageModel.ts']) {
      const source = readFileSync(resolve(here, file), 'utf8')
      expect(source, `${file} computes a channel verdict in-guest`).not.toMatch(
        /computeChannelPass|evaluateChannelAuthentication|channel_pass/,
      )
    }
  })

  it('the guest hands over material, not a verdict', () => {
    // `channelAuthentication` carries capped strings for the host to evaluate.
    const model = readFileSync(resolve(here, '../../depackaging-microvm/depackageModel.ts'), 'utf8')
    expect(model).toMatch(/channelAuthentication/)
  })

  it('every consumer of guest packages is reached through the gated router', () => {
    // The seam re-enters `detectAndRouteMessageInline`, which is gated. If a
    // future change consumes `result.packages` anywhere else, this catches it.
    const seamRegion = routerSource.slice(routerSource.indexOf('const guestMaterial'))
    const packageUses = seamRegion.match(/result\.packages/g) ?? []
    expect(packageUses.length, 'guest packages consumed in unexpected places').toBeLessThanOrEqual(2)
    expect(seamRegion).toContain('detectAndRouteMessageInline(db, accountId, beapRawMsg, session, true)')
  })
})
