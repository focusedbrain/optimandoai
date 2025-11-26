/**
 * LegacyConfigAdapter Unit Tests
 */

import { LegacyConfigAdapter, adaptLegacyConfig, adaptLegacySource } from '../adapters/LegacyConfigAdapter'
import type { LegacyAgentConfig, AutomationConfig } from '../types'

describe('LegacyConfigAdapter', () => {
  let adapter: LegacyConfigAdapter

  beforeEach(() => {
    adapter = new LegacyConfigAdapter()
  })

  describe('adaptLegacySource', () => {
    it('should map chat sources', () => {
      expect(adaptLegacySource('chat')).toBe('chat')
      expect(adaptLegacySource('message')).toBe('chat')
    })

    it('should map dom sources', () => {
      expect(adaptLegacySource('dom')).toBe('dom')
      expect(adaptLegacySource('page')).toBe('dom')
      expect(adaptLegacySource('webpage')).toBe('dom')
      expect(adaptLegacySource('screenshot')).toBe('dom')
    })

    it('should map api sources', () => {
      expect(adaptLegacySource('api')).toBe('api')
      expect(adaptLegacySource('webhook')).toBe('api')
    })

    it('should map cron sources', () => {
      expect(adaptLegacySource('cron')).toBe('cron')
      expect(adaptLegacySource('schedule')).toBe('cron')
      expect(adaptLegacySource('scheduled')).toBe('cron')
    })

    it('should default to chat for unknown sources', () => {
      expect(adaptLegacySource('unknown')).toBe('chat')
      expect(adaptLegacySource(undefined)).toBe('chat')
    })

    it('should treat modality-like sources as chat', () => {
      expect(adaptLegacySource('text')).toBe('chat')
      expect(adaptLegacySource('image')).toBe('chat')
      expect(adaptLegacySource('all')).toBe('chat')
    })
  })

  describe('adaptLegacyConfig', () => {
    const createLegacyAgent = (overrides: Partial<LegacyAgentConfig> = {}): LegacyAgentConfig => ({
      id: 'agent1',
      name: 'Test Agent',
      enabled: true,
      ...overrides
    })

    it('should convert basic agent config', () => {
      const legacy = createLegacyAgent()
      const result = adaptLegacyConfig(legacy)

      expect(result.id).toBe('auto_agent1')
      expect(result.name).toBe('Test Agent')
      expect(result.enabled).toBe(true)
      expect(result.reasoningProfile).toBe('agent1')
    })

    it('should set mode based on passiveEnabled', () => {
      const passiveAgent = createLegacyAgent({
        listening: { passiveEnabled: true }
      })
      const activeAgent = createLegacyAgent({
        listening: { activeEnabled: true }
      })

      expect(adaptLegacyConfig(passiveAgent).mode).toBe('passive')
      expect(adaptLegacyConfig(activeAgent).mode).toBe('active')
    })

    it('should extract trigger patterns from passive triggers', () => {
      const legacy = createLegacyAgent({
        listening: {
          passive: {
            triggers: [
              { tag: { name: 'Invoice' } },
              { tag: { name: 'Report' } }
            ]
          }
        }
      })

      const result = adaptLegacyConfig(legacy)
      expect(result.patterns).toContain('Invoice')
      expect(result.patterns).toContain('Report')
    })

    it('should extract trigger patterns from active triggers', () => {
      const legacy = createLegacyAgent({
        listening: {
          active: {
            triggers: [
              { tag: { name: 'Help' } }
            ]
          }
        }
      })

      const result = adaptLegacyConfig(legacy)
      expect(result.patterns).toContain('Help')
    })

    it('should preserve expectedContext', () => {
      const legacy = createLegacyAgent({
        listening: {
          expectedContext: 'invoice processing billing'
        }
      })

      const result = adaptLegacyConfig(legacy)
      expect(result.expectedContext).toBe('invoice processing billing')
    })

    it('should preserve website filter', () => {
      const legacy = createLegacyAgent({
        listening: {
          website: 'example.com'
        }
      })

      const result = adaptLegacyConfig(legacy)
      expect(result.website).toBe('example.com')
    })

    it('should convert execution workflows to allowedActions', () => {
      const legacy = createLegacyAgent({
        execution: {
          workflows: ['send-email', 'save-document']
        }
      })

      const result = adaptLegacyConfig(legacy)
      expect(result.allowedActions).toContain('send-email')
      expect(result.allowedActions).toContain('save-document')
    })

    it('should infer image modality from tags', () => {
      const legacy = createLegacyAgent({
        listening: {
          tags: ['image', 'screenshot']
        }
      })

      const result = adaptLegacyConfig(legacy)
      expect(result.trigger.modalities).toContain('image')
    })

    it('should infer modality from applyFor', () => {
      const legacy = createLegacyAgent({
        reasoning: {
          applyFor: 'image'
        }
      })

      const result = adaptLegacyConfig(legacy)
      expect(result.trigger.modalities).toContain('image')
    })
  })

  describe('isLegacyConfig', () => {
    it('should identify legacy config by passiveEnabled', () => {
      const legacy = { listening: { passiveEnabled: true } }
      expect(adapter.isLegacyConfig(legacy)).toBe(true)
    })

    it('should identify legacy config by triggers', () => {
      const legacy = { listening: { passive: { triggers: [] } } }
      expect(adapter.isLegacyConfig(legacy)).toBe(true)
    })

    it('should not identify new config as legacy', () => {
      const newConfig: AutomationConfig = {
        id: 'test',
        name: 'Test',
        enabled: true,
        mode: 'active',
        trigger: { source: 'chat', scope: 'global', modalities: [] },
        sensorWorkflows: [],
        conditions: null,
        reasoningProfile: 'agent1',
        allowedActions: []
      }
      expect(adapter.isLegacyConfig(newConfig)).toBe(false)
    })
  })

  describe('isNewConfig', () => {
    it('should identify new config by structure', () => {
      const newConfig: AutomationConfig = {
        id: 'test',
        name: 'Test',
        enabled: true,
        mode: 'active',
        trigger: { source: 'chat', scope: 'global', modalities: [] },
        sensorWorkflows: [],
        conditions: null,
        reasoningProfile: 'agent1',
        allowedActions: []
      }
      expect(adapter.isNewConfig(newConfig)).toBe(true)
    })

    it('should not identify legacy as new config', () => {
      const legacy = { listening: { passiveEnabled: true } }
      expect(adapter.isNewConfig(legacy)).toBe(false)
    })
  })

  describe('ensureNewFormat', () => {
    it('should return new config as-is', () => {
      const newConfig: AutomationConfig = {
        id: 'test',
        name: 'Test',
        enabled: true,
        mode: 'active',
        trigger: { source: 'chat', scope: 'global', modalities: [] },
        sensorWorkflows: [],
        conditions: null,
        reasoningProfile: 'agent1',
        allowedActions: []
      }
      
      const result = adapter.ensureNewFormat(newConfig)
      expect(result).toBe(newConfig)
    })

    it('should convert legacy config', () => {
      const legacy = {
        id: 'agent1',
        name: 'Legacy Agent',
        enabled: true,
        listening: { passiveEnabled: true }
      }
      
      const result = adapter.ensureNewFormat(legacy)
      expect(result.id).toBe('auto_agent1')
      expect(result.mode).toBe('passive')
    })

    it('should create minimal config for unknown format', () => {
      const unknown = { something: 'weird' }
      
      const result = adapter.ensureNewFormat(unknown)
      expect(result.trigger.source).toBe('chat')
      expect(result.sensorWorkflows).toEqual([])
    })
  })

  describe('adaptMany', () => {
    it('should convert array of legacy configs', () => {
      const legacyAgents: LegacyAgentConfig[] = [
        { id: 'agent1', name: 'Agent 1', enabled: true },
        { id: 'agent2', name: 'Agent 2', enabled: false }
      ]
      
      const results = adapter.adaptMany(legacyAgents)
      
      expect(results).toHaveLength(2)
      expect(results[0].name).toBe('Agent 1')
      expect(results[1].name).toBe('Agent 2')
    })
  })
})



