/**
 * Action Workflow
 * 
 * Helper class for creating action workflows with side effects.
 * Action workflows perform operations like sending emails, calling APIs, etc.
 */

import type { 
  WorkflowDefinition, 
  WorkflowStep, 
  WorkflowStepType,
  WorkflowContext 
} from '../types'

/**
 * Action workflow builder
 * 
 * Fluent API for constructing action workflows.
 * 
 * @example
 * ```typescript
 * const workflow = ActionWorkflow.create('send-notification')
 *   .name('Send Notification')
 *   .notify('alert', 'info', 'Processing complete')
 *   .api('webhook', 'https://hooks.example.com/notify', {
 *     method: 'POST',
 *     body: { status: 'complete' }
 *   })
 *   .build()
 * ```
 */
export class ActionWorkflow {
  private definition: Partial<WorkflowDefinition>
  private stepOrder: string[] = []
  
  private constructor(id: string) {
    this.definition = {
      id,
      type: 'action',
      steps: []
    }
  }
  
  /**
   * Create a new action workflow builder
   * 
   * @param id - Unique workflow identifier
   */
  static create(id: string): ActionWorkflow {
    return new ActionWorkflow(id)
  }
  
  /**
   * Set the workflow name
   * 
   * @param name - Human-readable name
   */
  name(name: string): ActionWorkflow {
    this.definition.name = name
    return this
  }
  
  /**
   * Set the workflow description
   * 
   * @param description - Workflow description
   */
  description(description: string): ActionWorkflow {
    this.definition.description = description
    return this
  }
  
  /**
   * Add a step to the workflow
   * 
   * @param id - Step identifier
   * @param type - Step type
   * @param config - Step configuration
   */
  step(id: string, type: WorkflowStepType, config: Record<string, any> = {}): ActionWorkflow {
    const step: WorkflowStep = {
      id,
      type,
      config,
      nextSteps: []
    }
    
    // Link to previous step if exists
    if (this.stepOrder.length > 0) {
      const prevStepId = this.stepOrder[this.stepOrder.length - 1]
      const prevStep = this.definition.steps!.find(s => s.id === prevStepId)
      if (prevStep) {
        prevStep.nextSteps.push(id)
      }
    }
    
    this.definition.steps!.push(step)
    this.stepOrder.push(id)
    
    return this
  }
  
  /**
   * Add a notification step
   * 
   * @param id - Step identifier
   * @param type - Notification type (info, success, warning, error)
   * @param message - Notification message
   */
  notify(id: string, type: 'info' | 'success' | 'warning' | 'error', message: string): ActionWorkflow {
    return this.step(id, 'notify', { type, message })
  }
  
  /**
   * Add an API call step
   * 
   * @param id - Step identifier
   * @param url - API URL
   * @param options - Request options
   */
  api(
    id: string, 
    url: string, 
    options: { 
      method?: string
      headers?: Record<string, string>
      body?: any 
    } = {}
  ): ActionWorkflow {
    return this.step(id, 'api', { url, ...options })
  }
  
  /**
   * Add a wait step
   * 
   * @param id - Step identifier
   * @param delay - Delay in milliseconds
   */
  wait(id: string, delay: number): ActionWorkflow {
    return this.step(id, 'wait', { delay })
  }
  
  /**
   * Add a store step
   * 
   * @param id - Step identifier
   * @param key - Storage key
   * @param value - Value or value function
   */
  store(
    id: string,
    key: string,
    value: any | ((context: WorkflowContext) => any)
  ): ActionWorkflow {
    return this.step(id, 'store', { key, value })
  }
  
  /**
   * Add a conditional step
   * 
   * @param id - Step identifier
   * @param condition - Condition function or field name
   * @param thenStep - Step to run if true
   * @param elseStep - Step to run if false
   */
  condition(
    id: string,
    condition: ((context: WorkflowContext) => boolean) | string,
    thenStep: string,
    elseStep: string
  ): ActionWorkflow {
    return this.step(id, 'condition', { condition, thenStep, elseStep })
  }
  
  /**
   * Add a loop step
   * 
   * @param id - Step identifier
   * @param items - Array field name or function returning array
   * @param itemKey - Key to use for current item in context
   */
  loop(
    id: string,
    items: string | ((context: WorkflowContext) => any[]),
    itemKey: string = 'item'
  ): ActionWorkflow {
    return this.step(id, 'loop', { items, itemKey })
  }
  
  /**
   * Add parallel execution step
   * 
   * @param id - Step identifier
   * @param steps - Step IDs to run in parallel
   */
  parallel(id: string, steps: string[]): ActionWorkflow {
    return this.step(id, 'parallel', { steps })
  }
  
  /**
   * Add an agent call step
   * 
   * @param id - Step identifier
   * @param agentId - Agent to call
   * @param input - Input for the agent
   */
  agent(
    id: string,
    agentId: string,
    input?: string | ((context: WorkflowContext) => string)
  ): ActionWorkflow {
    return this.step(id, 'agent', { agentId, input })
  }
  
  /**
   * Set error handler for the last step
   * 
   * @param errorStepId - Step to run on error
   */
  onError(errorStepId: string): ActionWorkflow {
    if (this.stepOrder.length === 0) {
      throw new Error('No steps to add error handler to')
    }
    
    const lastStepId = this.stepOrder[this.stepOrder.length - 1]
    const lastStep = this.definition.steps!.find(s => s.id === lastStepId)
    if (lastStep) {
      lastStep.onError = errorStepId
    }
    
    return this
  }
  
  /**
   * Build the workflow definition
   * 
   * @returns Complete workflow definition
   */
  build(): WorkflowDefinition {
    if (!this.definition.name) {
      this.definition.name = this.definition.id!
    }
    
    if (this.stepOrder.length === 0) {
      throw new Error('Workflow must have at least one step')
    }
    
    this.definition.entryStep = this.stepOrder[0]
    
    return this.definition as WorkflowDefinition
  }
}

/**
 * Pre-built action workflows for common use cases
 */
export const CommonActionWorkflows = {
  /**
   * Send a notification
   */
  notifySuccess: ActionWorkflow.create('notify-success')
    .name('Success Notification')
    .description('Display a success notification')
    .notify('notify', 'success', 'Operation completed successfully')
    .build(),
  
  /**
   * Send a webhook
   */
  webhookPost: (url: string, bodyFn: (ctx: WorkflowContext) => any) => 
    ActionWorkflow.create('webhook-post')
      .name('Webhook POST')
      .description('Send data to a webhook')
      .step('prepare', 'transform', {
        expression: bodyFn
      })
      .api('send', url, { method: 'POST' })
      .build(),
  
  /**
   * Store result in session
   */
  storeResult: (key: string) =>
    ActionWorkflow.create('store-result')
      .name('Store Result')
      .description('Store the result in session storage')
      .store('save', key, (ctx: WorkflowContext) => ctx.reasoningResult)
      .build()
}



