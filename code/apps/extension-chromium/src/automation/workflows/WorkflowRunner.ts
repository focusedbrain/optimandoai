/**
 * Workflow Runner
 * 
 * Executes workflow steps in sequence or parallel.
 */

import type { 
  WorkflowDefinition, 
  WorkflowStep, 
  WorkflowContext,
  WorkflowStepType
} from '../types'
import { WorkflowRegistry } from './WorkflowRegistry'

/**
 * Step handler function type
 */
export type StepHandler = (
  step: WorkflowStep,
  context: WorkflowContext
) => Promise<any>

/**
 * Workflow execution options
 */
export interface ExecutionOptions {
  /** Timeout for entire workflow in ms (default: 30000) */
  timeout?: number
  
  /** Whether to continue on step error (default: false) */
  continueOnError?: boolean
  
  /** Maximum parallel steps (default: 5) */
  maxParallel?: number
}

/**
 * Workflow Runner
 * 
 * Executes workflow definitions step by step.
 * 
 * @example
 * ```typescript
 * const runner = new WorkflowRunner(registry)
 * 
 * // Register custom step handlers
 * runner.registerHandler('api', async (step, context) => {
 *   const response = await fetch(step.config.url)
 *   return response.json()
 * })
 * 
 * // Run a sensor workflow
 * const result = await runner.runSensor('extract-text', context)
 * ```
 */
export class WorkflowRunner {
  /** Workflow registry */
  private registry: WorkflowRegistry
  
  /** Step handlers by type */
  private handlers: Map<WorkflowStepType, StepHandler> = new Map()
  
  /** Default execution options */
  private defaultOptions: ExecutionOptions = {
    timeout: 30000,
    continueOnError: false,
    maxParallel: 5
  }
  
  constructor(registry: WorkflowRegistry) {
    this.registry = registry
    this.registerDefaultHandlers()
  }
  
  /**
   * Register default step handlers
   */
  private registerDefaultHandlers(): void {
    // Agent step - call an agent
    this.registerHandler('agent', async (step, context) => {
      console.log(`[WorkflowRunner] Agent step: ${step.id}`)
      // Agent calling would be implemented by the ListenerManager's reasoning callback
      return { agentId: step.config.agentId, input: context.event.input }
    })
    
    // Wait step - delay execution
    this.registerHandler('wait', async (step) => {
      const delay = step.config.delay || 1000
      console.log(`[WorkflowRunner] Wait step: ${delay}ms`)
      await new Promise(resolve => setTimeout(resolve, delay))
      return { waited: delay }
    })
    
    // Transform step - transform data
    this.registerHandler('transform', async (step, context) => {
      console.log(`[WorkflowRunner] Transform step: ${step.id}`)
      const { expression } = step.config
      if (typeof expression === 'function') {
        return expression(context.collectedData)
      }
      return context.collectedData
    })
    
    // Store step - store data
    this.registerHandler('store', async (step, context) => {
      console.log(`[WorkflowRunner] Store step: ${step.id}`)
      const { key, value } = step.config
      const resolvedValue = typeof value === 'function' ? value(context) : value
      return { stored: { [key]: resolvedValue } }
    })
    
    // Notify step - send notification
    this.registerHandler('notify', async (step, context) => {
      console.log(`[WorkflowRunner] Notify step: ${step.id}`)
      const { type, message } = step.config
      console.log(`[Notification] ${type}: ${message}`)
      return { notified: true, type, message }
    })
    
    // Condition step - conditional branching
    this.registerHandler('condition', async (step, context) => {
      console.log(`[WorkflowRunner] Condition step: ${step.id}`)
      const { condition, thenStep, elseStep } = step.config
      // Simple condition evaluation
      const result = typeof condition === 'function' 
        ? condition(context) 
        : !!context.collectedData[condition]
      return { 
        condition: result, 
        nextStep: result ? thenStep : elseStep 
      }
    })
    
    // Loop step - iteration
    this.registerHandler('loop', async (step, context) => {
      console.log(`[WorkflowRunner] Loop step: ${step.id}`)
      const { items, itemKey = 'item' } = step.config
      const resolvedItems = typeof items === 'function' 
        ? items(context) 
        : context.collectedData[items] || []
      return { items: resolvedItems, itemKey }
    })
    
    // API step - external API call
    this.registerHandler('api', async (step) => {
      console.log(`[WorkflowRunner] API step: ${step.id}`)
      const { url, method = 'GET', headers = {}, body } = step.config
      
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers
          },
          body: body ? JSON.stringify(body) : undefined
        })
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        
        return await response.json()
      } catch (error) {
        console.error(`[WorkflowRunner] API step failed:`, error)
        throw error
      }
    })
    
    // Parallel step - parallel execution
    this.registerHandler('parallel', async (step, context) => {
      console.log(`[WorkflowRunner] Parallel step: ${step.id}`)
      const { steps: parallelStepIds } = step.config
      // Parallel steps would be executed by the runner
      return { parallelSteps: parallelStepIds }
    })
  }
  
  /**
   * Register a custom step handler
   * 
   * @param type - The step type to handle
   * @param handler - The handler function
   */
  registerHandler(type: WorkflowStepType, handler: StepHandler): void {
    this.handlers.set(type, handler)
  }
  
  /**
   * Run a sensor workflow (read-only, collects data)
   * 
   * @param workflowId - The workflow ID to run
   * @param context - The execution context
   * @param options - Execution options
   * @returns Collected data from the workflow
   */
  async runSensor(
    workflowId: string,
    context: WorkflowContext,
    options?: ExecutionOptions
  ): Promise<Record<string, any>> {
    const workflow = this.registry.get(workflowId)
    
    if (!workflow) {
      throw new Error(`Sensor workflow '${workflowId}' not found`)
    }
    
    if (workflow.type !== 'sensor') {
      throw new Error(`Workflow '${workflowId}' is not a sensor workflow`)
    }
    
    console.log(`[WorkflowRunner] Running sensor workflow: ${workflowId}`)
    return this.execute(workflow, context, options)
  }
  
  /**
   * Run an action workflow (side effects)
   * 
   * @param workflowId - The workflow ID to run
   * @param context - The execution context
   * @param options - Execution options
   * @returns Action result
   */
  async runAction(
    workflowId: string,
    context: WorkflowContext,
    options?: ExecutionOptions
  ): Promise<any> {
    const workflow = this.registry.get(workflowId)
    
    if (!workflow) {
      throw new Error(`Action workflow '${workflowId}' not found`)
    }
    
    if (workflow.type !== 'action') {
      throw new Error(`Workflow '${workflowId}' is not an action workflow`)
    }
    
    console.log(`[WorkflowRunner] Running action workflow: ${workflowId}`)
    return this.execute(workflow, context, options)
  }
  
  /**
   * Execute a workflow
   * 
   * @param workflow - The workflow definition
   * @param context - The execution context
   * @param options - Execution options
   * @returns Execution result
   */
  async execute(
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    options?: ExecutionOptions
  ): Promise<Record<string, any>> {
    const opts = { ...this.defaultOptions, ...options }
    const results: Record<string, any> = {}
    const visited = new Set<string>()
    
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Workflow timeout')), opts.timeout)
    })
    
    // Execute steps starting from entry point
    const executePromise = this.executeStep(
      workflow,
      workflow.entryStep,
      context,
      results,
      visited,
      opts
    )
    
    try {
      await Promise.race([executePromise, timeoutPromise])
    } catch (error) {
      console.error(`[WorkflowRunner] Workflow execution failed:`, error)
      if (!opts.continueOnError) {
        throw error
      }
      context.errors.push(error as Error)
    }
    
    return results
  }
  
  /**
   * Execute a single step and its successors
   */
  private async executeStep(
    workflow: WorkflowDefinition,
    stepId: string,
    context: WorkflowContext,
    results: Record<string, any>,
    visited: Set<string>,
    options: ExecutionOptions
  ): Promise<void> {
    // Prevent infinite loops
    if (visited.has(stepId)) {
      console.warn(`[WorkflowRunner] Skipping already visited step: ${stepId}`)
      return
    }
    visited.add(stepId)
    
    const step = workflow.steps.find(s => s.id === stepId)
    if (!step) {
      throw new Error(`Step '${stepId}' not found in workflow '${workflow.id}'`)
    }
    
    context.currentStep = stepId
    
    // Get handler for step type
    const handler = this.handlers.get(step.type)
    if (!handler) {
      throw new Error(`No handler for step type '${step.type}'`)
    }
    
    try {
      // Execute the step
      const result = await handler(step, context)
      results[stepId] = result
      
      // Merge result into collected data
      if (result && typeof result === 'object') {
        Object.assign(context.collectedData, result)
      }
      
      // Handle conditional branching
      if (step.type === 'condition' && result?.nextStep) {
        await this.executeStep(workflow, result.nextStep, context, results, visited, options)
        return
      }
      
      // Handle parallel execution
      if (step.type === 'parallel' && result?.parallelSteps) {
        const parallelPromises = result.parallelSteps.map((nextId: string) =>
          this.executeStep(workflow, nextId, context, results, new Set(visited), options)
        )
        await Promise.all(parallelPromises.slice(0, options.maxParallel))
        return
      }
      
      // Execute next steps
      for (const nextId of step.nextSteps) {
        await this.executeStep(workflow, nextId, context, results, visited, options)
      }
      
    } catch (error) {
      console.error(`[WorkflowRunner] Step '${stepId}' failed:`, error)
      
      if (step.onError) {
        // Execute error handler step
        await this.executeStep(workflow, step.onError, context, results, visited, options)
      } else if (!options.continueOnError) {
        throw error
      } else {
        context.errors.push(error as Error)
      }
    }
  }
}




