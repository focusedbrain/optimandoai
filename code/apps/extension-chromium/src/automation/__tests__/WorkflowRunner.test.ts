/**
 * WorkflowRunner Unit Tests
 */

import { WorkflowRunner } from '../workflows/WorkflowRunner'
import { WorkflowRegistry } from '../workflows/WorkflowRegistry'
import { SensorWorkflow } from '../workflows/SensorWorkflow'
import { ActionWorkflow } from '../workflows/ActionWorkflow'
import type { WorkflowDefinition, WorkflowContext, NormalizedEvent } from '../types'

describe('WorkflowRegistry', () => {
  let registry: WorkflowRegistry

  beforeEach(() => {
    registry = new WorkflowRegistry()
  })

  afterEach(() => {
    registry.clear()
  })

  describe('register', () => {
    it('should register a valid workflow', () => {
      const workflow = SensorWorkflow.create('test')
        .name('Test Workflow')
        .step('step1', 'transform', {})
        .build()

      registry.register(workflow)
      expect(registry.get('test')).toBeDefined()
    })

    it('should throw for invalid workflow', () => {
      const invalid = { id: '', name: 'Invalid' } as any
      expect(() => registry.register(invalid)).toThrow()
    })
  })

  describe('getByType', () => {
    it('should filter workflows by type', () => {
      const sensor = SensorWorkflow.create('sensor1')
        .name('Sensor')
        .step('s1', 'transform', {})
        .build()

      const action = ActionWorkflow.create('action1')
        .name('Action')
        .step('a1', 'notify', { type: 'info', message: 'test' })
        .build()

      registry.register(sensor)
      registry.register(action)

      expect(registry.getSensorWorkflows()).toHaveLength(1)
      expect(registry.getActionWorkflows()).toHaveLength(1)
    })
  })

  describe('validate', () => {
    it('should validate workflow with missing entry step', () => {
      const workflow: WorkflowDefinition = {
        id: 'test',
        name: 'Test',
        type: 'sensor',
        entryStep: 'nonexistent',
        steps: [{ id: 'step1', type: 'transform', config: {}, nextSteps: [] }]
      }

      const result = registry.validate(workflow)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('not found'))).toBe(true)
    })

    it('should validate workflow with duplicate step ids', () => {
      const workflow: WorkflowDefinition = {
        id: 'test',
        name: 'Test',
        type: 'sensor',
        entryStep: 'step1',
        steps: [
          { id: 'step1', type: 'transform', config: {}, nextSteps: [] },
          { id: 'step1', type: 'transform', config: {}, nextSteps: [] }
        ]
      }

      const result = registry.validate(workflow)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true)
    })
  })
})

describe('WorkflowRunner', () => {
  let runner: WorkflowRunner
  let registry: WorkflowRegistry

  beforeEach(() => {
    registry = new WorkflowRegistry()
    runner = new WorkflowRunner(registry)
  })

  const createTestContext = (): WorkflowContext => ({
    event: {
      id: 'evt_test',
      timestamp: Date.now(),
      source: 'chat',
      scope: 'global',
      modalities: ['text'],
      input: 'Test input',
      metadata: {}
    },
    collectedData: {},
    errors: [],
    startTime: Date.now()
  })

  describe('runSensor', () => {
    it('should run sensor workflow and collect data', async () => {
      const workflow = SensorWorkflow.create('test-sensor')
        .name('Test Sensor')
        .transform('collect', () => ({ foo: 'bar' }))
        .build()

      registry.register(workflow)

      const context = createTestContext()
      const result = await runner.runSensor('test-sensor', context)

      expect(result.collect).toEqual({ foo: 'bar' })
      expect(context.collectedData.foo).toBe('bar')
    })

    it('should throw for non-existent workflow', async () => {
      const context = createTestContext()
      await expect(runner.runSensor('nonexistent', context)).rejects.toThrow()
    })

    it('should throw for action workflow', async () => {
      const workflow = ActionWorkflow.create('test-action')
        .name('Test Action')
        .notify('n1', 'info', 'test')
        .build()

      registry.register(workflow)

      const context = createTestContext()
      await expect(runner.runSensor('test-action', context)).rejects.toThrow()
    })
  })

  describe('runAction', () => {
    it('should run action workflow', async () => {
      const workflow = ActionWorkflow.create('test-action')
        .name('Test Action')
        .step('log', 'notify', { type: 'info', message: 'test' })
        .build()

      registry.register(workflow)

      const context = createTestContext()
      const result = await runner.runAction('test-action', context)

      expect(result.log).toEqual({ notified: true, type: 'info', message: 'test' })
    })

    it('should throw for sensor workflow', async () => {
      const workflow = SensorWorkflow.create('test-sensor')
        .name('Test Sensor')
        .transform('t1', () => ({}))
        .build()

      registry.register(workflow)

      const context = createTestContext()
      await expect(runner.runAction('test-sensor', context)).rejects.toThrow()
    })
  })

  describe('step execution', () => {
    it('should execute steps in sequence', async () => {
      const order: string[] = []

      const workflow: WorkflowDefinition = {
        id: 'sequence',
        name: 'Sequence',
        type: 'sensor',
        entryStep: 'step1',
        steps: [
          { 
            id: 'step1', 
            type: 'transform', 
            config: { expression: () => { order.push('step1'); return { a: 1 } } }, 
            nextSteps: ['step2'] 
          },
          { 
            id: 'step2', 
            type: 'transform', 
            config: { expression: () => { order.push('step2'); return { b: 2 } } }, 
            nextSteps: [] 
          }
        ]
      }

      registry.register(workflow)

      const context = createTestContext()
      await runner.runSensor('sequence', context)

      expect(order).toEqual(['step1', 'step2'])
    })

    it('should execute wait step', async () => {
      const workflow: WorkflowDefinition = {
        id: 'wait-test',
        name: 'Wait Test',
        type: 'sensor',
        entryStep: 'wait',
        steps: [
          { id: 'wait', type: 'wait', config: { delay: 10 }, nextSteps: [] }
        ]
      }

      registry.register(workflow)

      const context = createTestContext()
      const start = Date.now()
      await runner.runSensor('wait-test', context)
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(10)
    })

    it('should handle conditional steps', async () => {
      const workflow: WorkflowDefinition = {
        id: 'conditional',
        name: 'Conditional',
        type: 'sensor',
        entryStep: 'check',
        steps: [
          { 
            id: 'check', 
            type: 'condition', 
            config: { 
              condition: (ctx: WorkflowContext) => ctx.event.input.includes('yes'),
              thenStep: 'yes-branch',
              elseStep: 'no-branch'
            }, 
            nextSteps: [] 
          },
          { id: 'yes-branch', type: 'transform', config: { expression: () => ({ branch: 'yes' }) }, nextSteps: [] },
          { id: 'no-branch', type: 'transform', config: { expression: () => ({ branch: 'no' }) }, nextSteps: [] }
        ]
      }

      registry.register(workflow)

      const yesContext = createTestContext()
      yesContext.event.input = 'yes please'
      await runner.runSensor('conditional', yesContext)
      expect(yesContext.collectedData.branch).toBe('yes')

      const noContext = createTestContext()
      noContext.event.input = 'no thanks'
      await runner.runSensor('conditional', noContext)
      expect(noContext.collectedData.branch).toBe('no')
    })
  })

  describe('custom handlers', () => {
    it('should allow registering custom step handlers', async () => {
      runner.registerHandler('transform' as any, async (step, context) => {
        return { custom: true }
      })

      const workflow = SensorWorkflow.create('custom')
        .name('Custom')
        .step('t1', 'transform', {})
        .build()

      registry.register(workflow)

      const context = createTestContext()
      const result = await runner.runSensor('custom', context)

      expect(result.t1).toEqual({ custom: true })
    })
  })

  describe('error handling', () => {
    it('should continue on error when configured', async () => {
      const workflow: WorkflowDefinition = {
        id: 'error-test',
        name: 'Error Test',
        type: 'sensor',
        entryStep: 'fail',
        steps: [
          { 
            id: 'fail', 
            type: 'transform', 
            config: { expression: () => { throw new Error('Test error') } }, 
            nextSteps: ['next'] 
          },
          { id: 'next', type: 'transform', config: { expression: () => ({ reached: true }) }, nextSteps: [] }
        ]
      }

      registry.register(workflow)

      const context = createTestContext()
      await runner.execute(workflow, context, { continueOnError: true })

      expect(context.errors).toHaveLength(1)
    })

    it('should run error handler step', async () => {
      const workflow: WorkflowDefinition = {
        id: 'error-handler',
        name: 'Error Handler',
        type: 'sensor',
        entryStep: 'fail',
        steps: [
          { 
            id: 'fail', 
            type: 'transform', 
            config: { expression: () => { throw new Error('Test error') } }, 
            nextSteps: [],
            onError: 'handle-error'
          },
          { id: 'handle-error', type: 'transform', config: { expression: () => ({ handled: true }) }, nextSteps: [] }
        ]
      }

      registry.register(workflow)

      const context = createTestContext()
      await runner.execute(workflow, context, { continueOnError: true })

      expect(context.collectedData.handled).toBe(true)
    })
  })
})

describe('SensorWorkflow builder', () => {
  it('should build workflow with fluent API', () => {
    const workflow = SensorWorkflow.create('test')
      .name('Test Workflow')
      .description('A test workflow')
      .transform('collect', () => ({ data: true }))
      .wait('pause', 100)
      .transform('process', (data) => ({ processed: data }))
      .build()

    expect(workflow.id).toBe('test')
    expect(workflow.name).toBe('Test Workflow')
    expect(workflow.type).toBe('sensor')
    expect(workflow.steps).toHaveLength(3)
    expect(workflow.entryStep).toBe('collect')
  })

  it('should link steps automatically', () => {
    const workflow = SensorWorkflow.create('test')
      .name('Test')
      .step('a', 'transform', {})
      .step('b', 'transform', {})
      .step('c', 'transform', {})
      .build()

    expect(workflow.steps[0].nextSteps).toContain('b')
    expect(workflow.steps[1].nextSteps).toContain('c')
    expect(workflow.steps[2].nextSteps).toHaveLength(0)
  })
})

describe('ActionWorkflow builder', () => {
  it('should build action workflow with fluent API', () => {
    const workflow = ActionWorkflow.create('notify')
      .name('Notification Workflow')
      .notify('alert', 'success', 'Done!')
      .api('webhook', 'https://example.com/hook', { method: 'POST' })
      .build()

    expect(workflow.id).toBe('notify')
    expect(workflow.type).toBe('action')
    expect(workflow.steps).toHaveLength(2)
  })
})




