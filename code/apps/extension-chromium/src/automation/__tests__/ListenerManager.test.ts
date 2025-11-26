/**
 * ListenerManager Unit Tests
 */

import { ListenerManager } from '../ListenerManager'
import { TriggerRegistry } from '../triggers/TriggerRegistry'
import { WorkflowRegistry } from '../workflows/WorkflowRegistry'
import { ChatTrigger } from '../triggers/ChatTrigger'
import type { AutomationConfig, NormalizedEvent, Condition } from '../types'

describe('ListenerManager', () => {
  let manager: ListenerManager
  let triggerRegistry: TriggerRegistry
  let workflowRegistry: WorkflowRegistry

  beforeEach(() => {
    triggerRegistry = new TriggerRegistry()
    workflowRegistry = new WorkflowRegistry()
    manager = new ListenerManager(triggerRegistry, workflowRegistry)
  })

  afterEach(() => {
    manager.stop()
    manager.clear()
    triggerRegistry.clear()
  })

  const createTestAutomation = (overrides: Partial<AutomationConfig> = {}): AutomationConfig => ({
    id: 'test-automation',
    name: 'Test Automation',
    enabled: true,
    mode: 'active',
    trigger: {
      source: 'chat',
      scope: 'global',
      modalities: ['text']
    },
    sensorWorkflows: [],
    conditions: null,
    reasoningProfile: 'agent1',
    allowedActions: [],
    ...overrides
  })

  const createTestEvent = (overrides: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
    id: 'evt_test',
    timestamp: Date.now(),
    source: 'chat',
    scope: 'global',
    modalities: ['text'],
    input: 'Test message',
    metadata: {},
    ...overrides
  })

  describe('register / unregister', () => {
    it('should register an automation', () => {
      const automation = createTestAutomation()
      manager.register(automation)
      
      expect(manager.get('test-automation')).toBeDefined()
      expect(manager.getAll()).toHaveLength(1)
    })

    it('should throw for automation without id', () => {
      const automation = createTestAutomation({ id: '' })
      expect(() => manager.register(automation)).toThrow()
    })

    it('should unregister an automation', () => {
      manager.register(createTestAutomation())
      manager.unregister('test-automation')
      
      expect(manager.get('test-automation')).toBeUndefined()
    })
  })

  describe('getMatchingAutomations', () => {
    it('should match by source', () => {
      manager.register(createTestAutomation({ id: 'chat-auto', trigger: { source: 'chat', scope: 'global', modalities: [] } }))
      manager.register(createTestAutomation({ id: 'dom-auto', trigger: { source: 'dom', scope: 'global', modalities: [] } }))
      
      const event = createTestEvent({ source: 'chat' })
      const matches = manager.getMatchingAutomations(event)
      
      expect(matches).toHaveLength(1)
      expect(matches[0].config.id).toBe('chat-auto')
    })

    it('should match by pattern', () => {
      manager.register(createTestAutomation({ 
        id: 'invoice-auto', 
        patterns: ['Invoice'] 
      }))
      
      const event = createTestEvent({ input: 'Process @Invoice please' })
      const matches = manager.getMatchingAutomations(event)
      
      expect(matches).toHaveLength(1)
      expect(matches[0].matchReason).toContain('Invoice')
    })

    it('should match by expected context', () => {
      manager.register(createTestAutomation({ 
        id: 'invoice-auto', 
        expectedContext: 'invoice processing billing' 
      }))
      
      const event = createTestEvent({ input: 'Need help with billing issue' })
      const matches = manager.getMatchingAutomations(event)
      
      expect(matches).toHaveLength(1)
    })

    it('should filter by website', () => {
      manager.register(createTestAutomation({ 
        id: 'example-auto', 
        website: 'example.com'
      }))
      
      const matchingEvent = createTestEvent({ url: 'https://example.com/page' })
      const nonMatchingEvent = createTestEvent({ url: 'https://other.com/page' })
      
      expect(manager.getMatchingAutomations(matchingEvent)).toHaveLength(1)
      expect(manager.getMatchingAutomations(nonMatchingEvent)).toHaveLength(0)
    })

    it('should not match disabled automations', () => {
      manager.register(createTestAutomation({ enabled: false }))
      
      const event = createTestEvent()
      const matches = manager.getMatchingAutomations(event)
      
      expect(matches).toHaveLength(0)
    })

    it('should match by modality', () => {
      manager.register(createTestAutomation({ 
        id: 'image-auto',
        trigger: { source: 'chat', scope: 'global', modalities: ['image'] }
      }))
      manager.register(createTestAutomation({ 
        id: 'text-auto',
        trigger: { source: 'chat', scope: 'global', modalities: ['text'] }
      }))
      
      const textEvent = createTestEvent({ modalities: ['text'] })
      const imageEvent = createTestEvent({ modalities: ['image'] })
      
      const textMatches = manager.getMatchingAutomations(textEvent)
      const imageMatches = manager.getMatchingAutomations(imageEvent)
      
      expect(textMatches.find(m => m.config.id === 'text-auto')).toBeDefined()
      expect(imageMatches.find(m => m.config.id === 'image-auto')).toBeDefined()
    })
  })

  describe('processEvent', () => {
    it('should process event through pipeline', async () => {
      manager.register(createTestAutomation({
        conditions: null // Always pass
      }))
      
      const event = createTestEvent()
      const results = await manager.processEvent(event)
      
      expect(results).toHaveLength(1)
      expect(results[0].automationId).toBe('test-automation')
      expect(results[0].conditionsPassed).toBe(true)
    })

    it('should not process when conditions fail', async () => {
      const failingCondition: Condition = { 
        field: 'input', 
        op: 'eq', 
        value: 'specific text that does not match' 
      }
      
      manager.register(createTestAutomation({
        conditions: failingCondition
      }))
      
      const event = createTestEvent({ input: 'Some other text' })
      const results = await manager.processEvent(event)
      
      expect(results).toHaveLength(1)
      expect(results[0].conditionsPassed).toBe(false)
    })

    it('should call reasoning callback', async () => {
      const reasoningCallback = jest.fn().mockResolvedValue({ response: 'LLM response' })
      manager.setReasoningCallback(reasoningCallback)
      
      manager.register(createTestAutomation())
      
      const event = createTestEvent()
      const results = await manager.processEvent(event)
      
      expect(reasoningCallback).toHaveBeenCalled()
      expect(results[0].reasoningResult).toEqual({ response: 'LLM response' })
    })

    it('should return empty array when no matches', async () => {
      manager.register(createTestAutomation({
        trigger: { source: 'dom', scope: 'global', modalities: [] }
      }))
      
      const event = createTestEvent({ source: 'chat' })
      const results = await manager.processEvent(event)
      
      expect(results).toHaveLength(0)
    })
  })

  describe('start / stop', () => {
    it('should start processing events', () => {
      expect(manager.getIsRunning()).toBe(false)
      
      manager.start()
      
      expect(manager.getIsRunning()).toBe(true)
    })

    it('should stop processing events', () => {
      manager.start()
      manager.stop()
      
      expect(manager.getIsRunning()).toBe(false)
    })

    it('should warn when starting twice', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      
      manager.start()
      manager.start()
      
      expect(consoleSpy).toHaveBeenCalledWith('[ListenerManager] Already running')
      consoleSpy.mockRestore()
    })
  })

  describe('integration with TriggerRegistry', () => {
    it('should process events from registered triggers', async () => {
      const chatTrigger = new ChatTrigger('chat-test')
      triggerRegistry.registerTrigger(chatTrigger)
      
      manager.register(createTestAutomation({
        patterns: ['Help']
      }))
      
      const processSpy = jest.spyOn(manager, 'processEvent')
      
      manager.start()
      chatTrigger.handleMessage({ text: '@Help me please' })
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(processSpy).toHaveBeenCalled()
    })
  })
})


