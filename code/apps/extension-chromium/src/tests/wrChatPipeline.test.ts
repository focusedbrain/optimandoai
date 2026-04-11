/**
 * Integration-style unit tests for WR Chat pipeline pure logic (no browser, no DOM).
 * Covers tag normalisation (Prompt 5), surface identity (Prompt 1), InputCoordinator
 * routing (Prompts 6–7), and promptContext surface gating (Prompts 3 & 8).
 */

import { describe, expect, it } from 'vitest'
import { normaliseTriggerTag } from '../utils/normaliseTriggerTag'
import { surfaceFromSource } from '../ui/components/wrChatSurface'
import type { WrChatSurface } from '../ui/components/wrChatSurface'
import { InputCoordinator } from '../services/InputCoordinator'
import type { AgentConfig } from '../services/processFlow'

/** Mirrors WR Chat UI: handle SHOW_TRIGGER_PROMPT only when `promptContext` matches this surface. */
function shouldHandleShowTriggerPrompt(promptContext: string | undefined, surface: WrChatSurface): boolean {
  return promptContext === surface
}

function baseAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-test',
    name: 'Test Agent',
    icon: '🤖',
    enabled: true,
    ...overrides,
  }
}

describe('normaliseTriggerTag (Prompt 5)', () => {
  it('normalises # @ and casing', () => {
    expect(normaliseTriggerTag('#a1')).toBe('#a1')
    expect(normaliseTriggerTag('@a1')).toBe('#a1')
    expect(normaliseTriggerTag('a1')).toBe('#a1')
    expect(normaliseTriggerTag('#@a1')).toBe('#a1')
    expect(normaliseTriggerTag('')).toBe('')
    expect(normaliseTriggerTag('  #A1 ')).toBe('#a1')
  })
})

describe('surfaceFromSource (Prompt 1)', () => {
  it('maps capture sources to surfaces with sidepanel fallback', () => {
    expect(surfaceFromSource('sidepanel-docked-chat')).toBe('sidepanel')
    expect(surfaceFromSource('wr-chat-popup')).toBe('popup')
    expect(surfaceFromSource('wr-chat-dashboard')).toBe('dashboard')
    expect(surfaceFromSource('unknown')).toBe('sidepanel')
  })
})

describe('InputCoordinator.evaluateAgentListener', () => {
  const ic = new InputCoordinator({ debug: false })

  const evalListener = (agent: AgentConfig, input: string) => {
    const inputTriggers = ic.extractTriggerPatterns(input)
    return ic.evaluateAgentListener(agent, input, 'text', false, inputTriggers)
  }

  it('accepts WR Chat trigger a1 without keyword or explicit listening capability', () => {
    const agent = baseAgent({
      listening: {
        unifiedTriggers: [{ type: 'wrchat', tag: 'a1' }],
      },
    })
    const r = evalListener(agent, '#a1 take a look at this')
    expect(r.matchType).not.toBe('none')
    expect(r.matchedTriggerName).toBe('a1')
  })

  it('accepts when keyword matches; rejects when keyword missing', () => {
    const agent = baseAgent({
      listening: {
        unifiedTriggers: [
          {
            type: 'wrchat',
            tag: 'a1',
            keywords: 'invoice',
          },
        ],
      },
    })
    const ok = evalListener(agent, '#a1 invoice please')
    expect(ok.matchType).not.toBe('none')

    const bad = evalListener(agent, '#a1 hello')
    expect(bad.matchType).toBe('none')
  })

  it('rejects agent with no triggers and no listener path', () => {
    const agent = baseAgent({
      capabilities: [],
      listening: {},
    })
    const r = evalListener(agent, '#a1 hello')
    expect(r.matchType).toBe('none')
  })

  /**
   * “Listener capability, no tag trigger” path: passive listener on with no passive tags,
   * but `expectedContext` matches (broad listener / context gate).
   */
  it('accepts via expectedContext when listener is active without tag triggers', () => {
    const agent = baseAgent({
      capabilities: ['listening'],
      listening: {
        passiveEnabled: true,
        passive: { triggers: [] },
        expectedContext: 'qualification requirement',
      },
    })
    const r = evalListener(agent, 'Please review the qualification status today')
    expect(r.matchType).toBe('expected_context')
    expect(r.matchesExpectedContext).toBe(true)
  })

  const modeRunOpts = {
    modeExecution: true as const,
    modeLinkedSessionId: 'linked-session-1',
    currentOrchestratorSessionId: 'linked-session-1',
  }

  it('enabled mode_trigger: mode execution with matching sessions matches', () => {
    const agent = baseAgent({
      listening: {
        unifiedTriggers: [{ id: 't1', type: 'mode_trigger', enabled: true }],
      },
    })
    const r = ic.evaluateAgentListener(agent, '', 'text', false, [], undefined, modeRunOpts)
    expect(r.matchType).toBe('active_trigger')
    expect(r.matchedTriggerName).toBe('mode')
  })

  it('mode_trigger without enabled field is treated as enabled', () => {
    const agent = baseAgent({
      listening: {
        unifiedTriggers: [{ id: 't1', type: 'mode_trigger' }],
      },
    })
    const r = ic.evaluateAgentListener(agent, '', 'text', false, [], undefined, modeRunOpts)
    expect(r.matchType).toBe('active_trigger')
  })

  it('disabled mode_trigger: does not satisfy listener gate when it is the only trigger', () => {
    const agent = baseAgent({
      capabilities: [],
      listening: {
        unifiedTriggers: [{ id: 't1', type: 'mode_trigger', enabled: false }],
      },
    })
    const r = ic.evaluateAgentListener(agent, '', 'text', false, [], undefined, modeRunOpts)
    expect(r.matchType).toBe('none')
  })

  it('disabled mode_trigger: mode execution does not match when listening capability carries the gate', () => {
    const agent = baseAgent({
      capabilities: ['listening'],
      listening: {
        unifiedTriggers: [{ id: 't1', type: 'mode_trigger', enabled: false }],
      },
    })
    const r = ic.evaluateAgentListener(agent, '', 'text', false, [], undefined, modeRunOpts)
    expect(r.matchType).toBe('none')
  })

  it('WR Chat still matches when mode_trigger is disabled in the same config', () => {
    const agent = baseAgent({
      listening: {
        unifiedTriggers: [
          { id: 'm1', type: 'mode_trigger', enabled: false },
          { id: 'w1', type: 'wrchat', tag: 'a1' },
        ],
      },
    })
    const inputTriggers = ic.extractTriggerPatterns('#a1 hello')
    const r = ic.evaluateAgentListener(agent, '#a1 hello', 'text', false, inputTriggers)
    expect(r.matchType).not.toBe('none')
    expect(r.matchedTriggerName).toBe('a1')
  })

  it('disabled mode_trigger with a tag does not match via unified hashtag path (no fallback)', () => {
    const agent = baseAgent({
      capabilities: ['listening'],
      listening: {
        unifiedTriggers: [{ id: 'm1', type: 'mode_trigger', enabled: false, tag: 'onlymode' }],
      },
    })
    const inputTriggers = ic.extractTriggerPatterns('#onlymode hello')
    const r = ic.evaluateAgentListener(agent, '#onlymode hello', 'text', false, inputTriggers)
    expect(r.matchType).toBe('none')
  })

  it('disabled wrchat row with tag does not match hashtag path', () => {
    const agent = baseAgent({
      capabilities: ['listening'],
      listening: {
        unifiedTriggers: [{ type: 'wrchat', tag: 'a1', enabled: false }],
      },
    })
    const inputTriggers = ic.extractTriggerPatterns('#a1 hello')
    const r = ic.evaluateAgentListener(agent, '#a1 hello', 'text', false, inputTriggers)
    expect(r.matchType).toBe('none')
  })

  it('routeEventTagTrigger ignores disabled direct_tag rows', () => {
    const agent = baseAgent({
      listening: {
        unifiedTriggers: [{ type: 'direct_tag', tag: 'foo', enabled: false }],
      },
    })
    const batch = ic.routeEventTagTrigger({
      classifiedInput: {
        rawText: '#foo',
        normalizedText: '#foo',
        triggers: ['foo'],
        entities: [],
        source: 'inline_chat',
      },
      agents: [agent as any],
      agentBoxes: [],
    })
    expect(batch.results).toHaveLength(0)
  })
})

describe('SHOW_TRIGGER_PROMPT surface gating (pure)', () => {
  const surfaces: WrChatSurface[] = ['sidepanel', 'popup', 'dashboard']

  it('only the matching surface handles a given promptContext', () => {
    const pc = 'popup' as const
    expect(surfaces.filter((s) => shouldHandleShowTriggerPrompt(pc, s))).toEqual(['popup'])
  })

  it('sidepanel and dashboard return early when promptContext is popup', () => {
    expect(shouldHandleShowTriggerPrompt('popup', 'sidepanel')).toBe(false)
    expect(shouldHandleShowTriggerPrompt('popup', 'dashboard')).toBe(false)
    expect(shouldHandleShowTriggerPrompt('popup', 'popup')).toBe(true)
  })

  it('popup and dashboard return early when promptContext is sidepanel', () => {
    expect(shouldHandleShowTriggerPrompt('sidepanel', 'popup')).toBe(false)
    expect(shouldHandleShowTriggerPrompt('sidepanel', 'dashboard')).toBe(false)
    expect(shouldHandleShowTriggerPrompt('sidepanel', 'sidepanel')).toBe(true)
  })

  it('sidepanel and popup return early when promptContext is dashboard', () => {
    expect(shouldHandleShowTriggerPrompt('dashboard', 'sidepanel')).toBe(false)
    expect(shouldHandleShowTriggerPrompt('dashboard', 'popup')).toBe(false)
    expect(shouldHandleShowTriggerPrompt('dashboard', 'dashboard')).toBe(true)
  })
})
