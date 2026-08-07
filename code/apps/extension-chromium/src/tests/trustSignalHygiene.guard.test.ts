/**
 * Guard — trust signals fail CLOSED, and the UI never claims a check no code
 * performs (Phase 1C, corrected).
 *
 * Two separate defects are pinned here.
 *
 * 1. `InputCoordinator.evaluateEventTagConditions` used to hardcode
 *    `passed = true` for trust conditions. Its input carries no sender address
 *    (the sources are inline chat and OCR), so a configured whitelist was an
 *    assertion about a check that never ran — the most dangerous shape a
 *    security control can take, because a required condition silently admitted
 *    everything.
 *
 * 2. `wrcode_valid` was retired outright. Channel provenance (SPF/DKIM/DMARC)
 *    and publisher resolution are MANDATORY pipeline stages that run before a
 *    WR code is extracted at all; a message failing them yields no code and no
 *    affordance [IX.3.1, XVI]. So there is no class of "WRCode-stamped email"
 *    that a per-trigger checkbox could opt into. Disabling the control was not
 *    enough — a disabled control still names a concept that does not exist.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { InputCoordinator } from '../services/InputCoordinator'
import { EventTagMatcher } from '../automation/conditions/EventTagMatcher'
import { TriggerMigration } from '../automation/adapters/TriggerMigration'
import type { EventTagRoutingInput } from '../automation/types'

const here = fileURLToPath(new URL('.', import.meta.url))
const extensionSrc = resolve(here, '..')

const coordinator = new InputCoordinator({ debug: false })

function inputWithConditions(conditions: unknown[]): EventTagRoutingInput {
  return {
    classifiedInput: {
      rawText: '#invoice please handle this',
      normalizedText: '#invoice please handle this',
      triggers: ['#invoice'],
      entities: [],
      source: 'inline_chat',
    },
    agents: [
      {
        id: 'agent-1',
        name: 'Invoice Agent',
        number: 1,
        enabled: true,
        listening: {
          unifiedTriggers: [
            { id: 'T1', type: 'direct_tag', tag: '#invoice', channel: 'email', eventTagConditions: conditions },
          ],
        },
      } as any,
    ],
    agentBoxes: [],
  }
}

function evaluate(conditions: unknown[]) {
  const batch = coordinator.routeEventTagTrigger(inputWithConditions(conditions))
  // A failing condition drops the agent from the batch, so read the verdicts
  // through the private evaluator and corroborate them against routing.
  const evaluated = (coordinator as any).evaluateEventTagConditions(
    { eventTagConditions: conditions },
    inputWithConditions(conditions).classifiedInput,
    undefined,
  )
  return {
    verdicts: evaluated.conditions as Array<{ type: string; passed: boolean; details: string }>,
    allPassed: evaluated.allPassed as boolean,
    routed: batch.results.length > 0,
  }
}

describe('InputCoordinator — trust conditions fail closed', () => {
  it('a configured sender_whitelist fails, and the agent is not routed', () => {
    const { verdicts, routed } = evaluate([
      { type: 'sender_whitelist', allowedSenders: ['accounting@company.test'] },
    ])
    const verdict = verdicts.find((c) => c.type === 'sender_whitelist')
    expect(verdict?.passed).toBe(false)
    expect(verdict?.details).toMatch(/no sender address/i)
    expect(routed).toBe(false)
  })

  it('an empty sender_whitelist passes — no restriction was configured', () => {
    const { verdicts, routed } = evaluate([{ type: 'sender_whitelist', allowedSenders: [] }])
    expect(verdicts.find((c) => c.type === 'sender_whitelist')?.passed).toBe(true)
    expect(routed).toBe(true)
  })

  it('an unknown condition type fails closed rather than being waved through', () => {
    const { verdicts, allPassed, routed } = evaluate([{ type: 'not_a_real_condition' }])
    expect(verdicts.find((c) => c.type === 'not_a_real_condition')?.passed).toBe(false)
    expect(allPassed).toBe(false)
    expect(routed).toBe(false)
  })

  it('the fail-closed branches are not placeholders that hardcode a pass', () => {
    const source = readFileSync(resolve(extensionSrc, 'services/InputCoordinator.ts'), 'utf8')
    const section = source.slice(
      source.indexOf("case 'sender_whitelist':"),
      source.indexOf("case 'body_keywords':"),
    )
    expect(section.length).toBeGreaterThan(0)
    expect(section).not.toMatch(/Placeholder/i)
  })
})

describe('EventTagMatcher — already fail-closed, keep it that way', () => {
  const matcher = new EventTagMatcher()
  const event = EventTagMatcher.normalizeEmailEvent({
    subject: '#invoice',
    body: 'please pay',
    senderAddress: 'stranger@elsewhere.test',
  }) as any

  it('an unknown condition type fails closed', () => {
    const res = matcher.evaluate(event, {
      type: 'direct_tag',
      tag: '#invoice',
      eventTagConditions: [{ type: 'not_a_real_condition' }],
    } as any)
    expect(res.matched).toBe(false)
  })

  it('a sender outside the whitelist fails', () => {
    const res = matcher.evaluate(event, {
      type: 'direct_tag',
      tag: '#invoice',
      eventTagConditions: [{ type: 'sender_whitelist', allowedSenders: ['accounting@company.test'] }],
    } as any)
    expect(res.matched).toBe(false)
  })
})

describe('wrcode_valid is retired, not merely disabled', () => {
  const retired = { type: 'wrcode_valid', required: true }

  it('a stale stored condition is stripped, not routed into the unknown-type branch', () => {
    // It must not survive as an unrecognized type, which now fails closed and
    // would silently kill triggers that were never actually gated on anything.
    const { verdicts, allPassed } = evaluate([retired])
    expect(verdicts.some((c) => c.type === 'wrcode_valid')).toBe(false)
    expect(verdicts.some((c) => c.type === 'unknown')).toBe(false)
    expect(allPassed).toBe(true)
  })

  it('the matcher strips it too', () => {
    const event = EventTagMatcher.normalizeEmailEvent({
      subject: '#invoice',
      body: 'please pay',
      senderAddress: 'anyone@elsewhere.test',
    }) as any
    const res = new EventTagMatcher().evaluate(event, {
      type: 'direct_tag',
      tag: '#invoice',
      eventTagConditions: [retired],
    } as any)
    expect(res.matched).toBe(true)
    expect(res.conditionResults?.some((c) => c.type === 'wrcode_valid')).toBe(false)
  })

  it('migration drops it from a stored trigger and reports the change', () => {
    const migrator = new TriggerMigration()
    const trigger = { id: 'T1', type: 'direct_tag' as const, tag: '#invoice', eventTagConditions: [retired] as any }
    expect(migrator.needsMigration(trigger)).toBe(true)
    const result = migrator.migrateTrigger(trigger)
    expect(result.migrated).toBe(true)
    expect(result.trigger.eventTagConditions?.some((c: any) => c.type === 'wrcode_valid')).toBe(false)
  })

  it('no evaluator, type, or UI control references it any more', () => {
    for (const file of [
      'services/InputCoordinator.ts',
      'automation/conditions/EventTagMatcher.ts',
      'automation/types.ts',
    ]) {
      const source = readFileSync(resolve(extensionSrc, file), 'utf8')
      expect(source, `${file} still evaluates wrcode_valid`).not.toMatch(/case 'wrcode_valid'/)
      expect(source, `${file} still declares a WRCode verdict field`).not.toMatch(/wrcodeValid|WRCodeCondition/)
    }
  })

  it('the trigger editor offers no WRCode control and no longer names the concept', () => {
    const source = readFileSync(resolve(extensionSrc, 'content-script.tsx'), 'utf8')
    expect(source).not.toMatch(/trigger-wrcode/)
    expect(source).not.toMatch(/WRCode-stamped/i)
    expect(source).not.toMatch(/Requires cryptographic verification of sender authenticity/i)
  })

  it('the security section states that provenance is automatic and mandatory', () => {
    const source = readFileSync(resolve(extensionSrc, 'content-script.tsx'), 'utf8')
    const markup = source.slice(
      source.indexOf('Source & Security'),
      source.indexOf('class="trigger-sender-whitelist"'),
    )
    expect(markup).toMatch(/SPF, DKIM, DMARC/)
    expect(markup).toMatch(/mandatory/i)
  })
})
