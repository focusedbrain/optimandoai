/**
 * TriggerRegistry Unit Tests
 */

import { TriggerRegistry } from '../triggers/TriggerRegistry'
import { ChatTrigger } from '../triggers/ChatTrigger'
import { CronTrigger } from '../triggers/CronTrigger'
import type { NormalizedEvent } from '../types'

describe('TriggerRegistry', () => {
  let registry: TriggerRegistry

  beforeEach(() => {
    registry = new TriggerRegistry()
  })

  afterEach(() => {
    registry.clear()
  })

  describe('registerTrigger', () => {
    it('should register a trigger', () => {
      const trigger = new ChatTrigger('test-chat')
      registry.registerTrigger(trigger)
      
      const triggers = registry.getTriggers('chat')
      expect(triggers).toHaveLength(1)
      expect(triggers[0].getId()).toBe('test-chat')
    })

    it('should register multiple triggers of same type', () => {
      registry.registerTrigger(new ChatTrigger('chat1'))
      registry.registerTrigger(new ChatTrigger('chat2'))
      
      const triggers = registry.getTriggers('chat')
      expect(triggers).toHaveLength(2)
    })

    it('should register triggers of different types', () => {
      registry.registerTrigger(new ChatTrigger('chat1'))
      registry.registerTrigger(new CronTrigger('cron1'))
      
      expect(registry.getTriggers('chat')).toHaveLength(1)
      expect(registry.getTriggers('cron')).toHaveLength(1)
    })
  })

  describe('unregisterTrigger', () => {
    it('should unregister a trigger by id', () => {
      const trigger = new ChatTrigger('test-chat')
      registry.registerTrigger(trigger)
      
      expect(registry.getTriggers('chat')).toHaveLength(1)
      
      registry.unregisterTrigger('test-chat')
      
      expect(registry.getTriggers('chat')).toHaveLength(0)
    })

    it('should not throw when unregistering non-existent trigger', () => {
      expect(() => registry.unregisterTrigger('non-existent')).not.toThrow()
    })
  })

  describe('subscribe', () => {
    it('should receive events from registered triggers', (done) => {
      const chatTrigger = new ChatTrigger('test-chat')
      registry.registerTrigger(chatTrigger)
      
      registry.subscribe((event: NormalizedEvent) => {
        expect(event.source).toBe('chat')
        expect(event.input).toBe('Hello world')
        done()
      })
      
      chatTrigger.start()
      chatTrigger.handleMessage({ text: 'Hello world' })
    })

    it('should return unsubscribe function', () => {
      const callback = jest.fn()
      const unsubscribe = registry.subscribe(callback)
      
      expect(typeof unsubscribe).toBe('function')
      unsubscribe()
      
      // Event should not be received after unsubscribe
      registry.createAndEmit({
        source: 'chat',
        input: 'test'
      })
      
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('createAndEmit', () => {
    it('should create and emit event', (done) => {
      registry.subscribe((event: NormalizedEvent) => {
        expect(event.source).toBe('api')
        expect(event.input).toBe('webhook data')
        expect(event.modalities).toContain('text')
        done()
      })
      
      registry.createAndEmit({
        source: 'api',
        input: 'webhook data',
        modalities: ['text']
      })
    })

    it('should return the created event', () => {
      const event = registry.createAndEmit({
        source: 'chat',
        input: 'test message'
      })
      
      expect(event.id).toBeDefined()
      expect(event.timestamp).toBeDefined()
      expect(event.source).toBe('chat')
      expect(event.input).toBe('test message')
    })
  })

  describe('startAll / stopAll', () => {
    it('should start all registered triggers', () => {
      const chat = new ChatTrigger('chat1')
      const cron = new CronTrigger('cron1')
      
      registry.registerTrigger(chat)
      registry.registerTrigger(cron)
      
      expect(chat.getIsActive()).toBe(false)
      expect(cron.getIsActive()).toBe(false)
      
      registry.startAll()
      
      expect(chat.getIsActive()).toBe(true)
      expect(cron.getIsActive()).toBe(true)
    })

    it('should stop all registered triggers', () => {
      const chat = new ChatTrigger('chat1')
      const cron = new CronTrigger('cron1')
      
      registry.registerTrigger(chat)
      registry.registerTrigger(cron)
      
      registry.startAll()
      registry.stopAll()
      
      expect(chat.getIsActive()).toBe(false)
      expect(cron.getIsActive()).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all triggers and subscribers', () => {
      const chat = new ChatTrigger('chat1')
      registry.registerTrigger(chat)
      registry.subscribe(() => {})
      
      registry.clear()
      
      expect(registry.getAllTriggers().size).toBe(0)
    })
  })
})

describe('ChatTrigger', () => {
  let trigger: ChatTrigger

  beforeEach(() => {
    trigger = new ChatTrigger('test')
  })

  afterEach(() => {
    trigger.stop()
  })

  describe('handleMessage', () => {
    it('should emit event with text', (done) => {
      trigger.subscribe((event) => {
        expect(event.input).toBe('Hello')
        expect(event.modalities).toContain('text')
        done()
      })
      
      trigger.start()
      trigger.handleMessage({ text: 'Hello' })
    })

    it('should include image modality when hasImage is true', (done) => {
      trigger.subscribe((event) => {
        expect(event.modalities).toContain('image')
        expect(event.imageUrl).toBe('data:image/png;base64,abc')
        done()
      })
      
      trigger.start()
      trigger.handleMessage({ 
        text: 'Check this image',
        hasImage: true,
        imageUrl: 'data:image/png;base64,abc'
      })
    })

    it('should not emit when trigger is not active', () => {
      const callback = jest.fn()
      trigger.subscribe(callback)
      
      // Not started
      trigger.handleMessage({ text: 'Hello' })
      
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('extractMentions', () => {
    it('should extract @mentions from text', () => {
      const mentions = ChatTrigger.extractMentions('Hello @Invoice and @Report')
      expect(mentions).toEqual(['Invoice', 'Report'])
    })

    it('should return empty array for no mentions', () => {
      const mentions = ChatTrigger.extractMentions('Hello world')
      expect(mentions).toEqual([])
    })
  })

  describe('hasMention', () => {
    it('should check for specific mention (case insensitive)', () => {
      expect(ChatTrigger.hasMention('Hello @Invoice', 'invoice')).toBe(true)
      expect(ChatTrigger.hasMention('Hello @Invoice', 'INVOICE')).toBe(true)
      expect(ChatTrigger.hasMention('Hello @Invoice', 'report')).toBe(false)
    })
  })
})

describe('CronTrigger', () => {
  let trigger: CronTrigger

  beforeEach(() => {
    jest.useFakeTimers()
    trigger = new CronTrigger('test-cron', 1000) // 1 second check interval for testing
  })

  afterEach(() => {
    trigger.stop()
    jest.useRealTimers()
  })

  describe('schedule', () => {
    it('should schedule a job', () => {
      trigger.schedule('test-job', '* * * * *')
      
      const jobs = trigger.getJobs()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('test-job')
    })

    it('should throw for invalid cron expression', () => {
      expect(() => trigger.schedule('test-job', 'invalid')).toThrow()
    })
  })

  describe('unschedule', () => {
    it('should remove scheduled job', () => {
      trigger.schedule('test-job', '* * * * *')
      expect(trigger.getJobs()).toHaveLength(1)
      
      trigger.unschedule('test-job')
      expect(trigger.getJobs()).toHaveLength(0)
    })
  })

  describe('triggerNow', () => {
    it('should manually trigger a job', (done) => {
      trigger.schedule('test-job', '0 0 31 2 *') // Feb 31 - never runs naturally
      
      trigger.subscribe((event) => {
        expect(event.metadata.jobId).toBe('test-job')
        done()
      })
      
      trigger.start()
      trigger.triggerNow('test-job')
    })
  })

  describe('cron expression parsing', () => {
    it('should parse every minute expression', () => {
      trigger.schedule('every-minute', '* * * * *')
      const job = trigger.getJobs()[0]
      expect(job.expression).toBe('* * * * *')
    })

    it('should parse specific minute expression', () => {
      trigger.schedule('at-30', '30 * * * *')
      const nextRun = trigger.getNextRun('at-30')
      expect(nextRun).toBeDefined()
      expect(nextRun?.getMinutes()).toBe(30)
    })

    it('should parse step expression', () => {
      trigger.schedule('every-5', '*/5 * * * *')
      const job = trigger.getJobs()[0]
      expect(job.expression).toBe('*/5 * * * *')
    })
  })
})


