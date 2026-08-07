/**
 * Guard — trust signals fail CLOSED and the UI never claims a check no code
 * performs (Phase 1C; report contradiction G4-1).
 *
 * `InputCoordinator.evaluateEventTagConditions` used to hardcode `passed = true`
 * for `wrcode_valid` and `sender_whitelist` and report "WRCode validation
 * passed". Nothing validates a WR Code on that surface, and its input carries
 * no sender address, so those were assertions about checks that never ran —
 * the most dangerous shape a security control can take, because a required
 * condition silently admitted everything.
 *
 * These tests pin the corrected behaviour AND the honesty of the copy, because
 * a future refactor could restore either half independently.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { InputCoordinator } from '../services/InputCoordinator'
import { EventTagMatcher } from '../automation/conditions/EventTagMatcher'
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

/** The single condition verdict the coordinator produced for `type`. */
function verdictFor(conditions: unknown[], type: string) {
  const batch = coordinator.routeEventTagTrigger(inputWithConditions(conditions))
  // A failing condition drops the agent from the batch, so read the verdict
  // through the private evaluator and corroborate it against routing below.
  const evaluated = (coordinator as any).evaluateEventTagConditions(
    { eventTagConditions: conditions },
    inputWithConditions(conditions).classifiedInput,
    undefined,
  )
  const condition = evaluated.conditions.find((c: any) => c.type === type)
  expect(condition, `no verdict produced for ${type}`).toBeTruthy()
  return { condition, routed: batch.results.length > 0, allPassed: evaluated.allPassed }
}

describe('InputCoordinator — required trust conditions fail closed', () => {
  it('a required wrcode_valid condition fails, and the agent is not routed', () => {
    const { condition, routed, allPassed } = verdictFor([{ type: 'wrcode_valid', required: true }], 'wrcode_valid')
    expect(condition.passed).toBe(false)
    expect(allPassed).toBe(false)
    expect(routed).toBe(false)
  })

  it('the failure detail states there is no verdict, and never claims one passed', () => {
    const { condition } = verdictFor([{ type: 'wrcode_valid', required: true }], 'wrcode_valid')
    expect(condition.details).toMatch(/no WRCode verdict is available/i)
    expect(condition.details).not.toMatch(/validation passed/i)
  })

  it('an optional wrcode_valid condition still passes — it asserts nothing', () => {
    const { condition, routed } = verdictFor([{ type: 'wrcode_valid', required: false }], 'wrcode_valid')
    expect(condition.passed).toBe(true)
    expect(routed).toBe(true)
  })

  it('a configured sender_whitelist fails, and the agent is not routed', () => {
    const conditions = [{ type: 'sender_whitelist', allowedSenders: ['accounting@company.test'] }]
    const { condition, routed } = verdictFor(conditions, 'sender_whitelist')
    expect(condition.passed).toBe(false)
    expect(condition.details).toMatch(/no sender address/i)
    expect(routed).toBe(false)
  })

  it('an empty sender_whitelist passes — no restriction was configured', () => {
    const { condition, routed } = verdictFor([{ type: 'sender_whitelist', allowedSenders: [] }], 'sender_whitelist')
    expect(condition.passed).toBe(true)
    expect(routed).toBe(true)
  })

  it('the fail-closed branches are not placeholders that hardcode a pass', () => {
    const source = readFileSync(resolve(extensionSrc, 'services/InputCoordinator.ts'), 'utf8')
    const section = source.slice(
      source.indexOf("case 'wrcode_valid':"),
      source.indexOf("case 'body_keywords':"),
    )
    expect(section.length).toBeGreaterThan(0)
    expect(section).not.toMatch(/Placeholder/i)
    expect(section).not.toMatch(/WRCode validation passed/)
  })
})

describe('EventTagMatcher — already fail-closed, keep it that way', () => {
  const matcher = new EventTagMatcher()
  const event = EventTagMatcher.normalizeEmailEvent({
    subject: '#invoice',
    body: 'please pay',
    senderAddress: 'stranger@elsewhere.test',
  }) as any

  it('a required wrcode_valid condition fails when the event carries no verdict', () => {
    const res = matcher.evaluate(event, {
      type: 'direct_tag',
      tag: '#invoice',
      eventTagConditions: [{ type: 'wrcode_valid', required: true }],
    } as any)
    expect(res.matched).toBe(false)
  })

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

describe('trigger editor UI — the WRCode control claims nothing', () => {
  const source = readFileSync(resolve(extensionSrc, 'content-script.tsx'), 'utf8')
  const markup = source.slice(
    source.indexOf('class="trigger-wrcode"') - 200,
    source.indexOf('class="trigger-sender-whitelist"'),
  )

  it('the checkbox is disabled', () => {
    expect(markup).toMatch(/<input[^>]*class="trigger-wrcode"[^>]*\sdisabled/)
  })

  it('the copy states the check is not available yet', () => {
    expect(markup).toMatch(/Not available yet/i)
  })

  it('no copy claims verification that no code performs', () => {
    expect(markup).not.toMatch(/Requires cryptographic verification/i)
    expect(source).not.toMatch(/Requires cryptographic verification of sender authenticity/i)
  })
})
