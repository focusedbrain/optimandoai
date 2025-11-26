/**
 * Sensor Workflow
 * 
 * Helper class for creating read-only sensor workflows.
 * Sensor workflows collect context data without side effects.
 */

import type { 
  WorkflowDefinition, 
  WorkflowStep, 
  WorkflowStepType,
  WorkflowContext 
} from '../types'

/**
 * Sensor step configuration
 */
export interface SensorStepConfig {
  id: string
  name?: string
  type: WorkflowStepType
  config: Record<string, any>
  nextSteps?: string[]
}

/**
 * Sensor workflow builder
 * 
 * Fluent API for constructing sensor workflows.
 * 
 * @example
 * ```typescript
 * const workflow = SensorWorkflow.create('extract-content')
 *   .name('Extract Page Content')
 *   .step('get-text', 'api', { 
 *     url: '/api/ocr/process',
 *     method: 'POST'
 *   })
 *   .step('parse-data', 'transform', {
 *     expression: (data) => ({ parsed: data.text.split('\n') })
 *   })
 *   .build()
 * ```
 */
export class SensorWorkflow {
  private definition: Partial<WorkflowDefinition>
  private stepOrder: string[] = []
  
  private constructor(id: string) {
    this.definition = {
      id,
      type: 'sensor',
      steps: []
    }
  }
  
  /**
   * Create a new sensor workflow builder
   * 
   * @param id - Unique workflow identifier
   */
  static create(id: string): SensorWorkflow {
    return new SensorWorkflow(id)
  }
  
  /**
   * Set the workflow name
   * 
   * @param name - Human-readable name
   */
  name(name: string): SensorWorkflow {
    this.definition.name = name
    return this
  }
  
  /**
   * Set the workflow description
   * 
   * @param description - Workflow description
   */
  description(description: string): SensorWorkflow {
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
  step(id: string, type: WorkflowStepType, config: Record<string, any> = {}): SensorWorkflow {
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
   * Add an API fetch step
   * 
   * @param id - Step identifier
   * @param url - API URL
   * @param options - Fetch options
   */
  fetch(
    id: string, 
    url: string, 
    options: { method?: string; headers?: Record<string, string>; body?: any } = {}
  ): SensorWorkflow {
    return this.step(id, 'api', { url, ...options })
  }
  
  /**
   * Add a transform step
   * 
   * @param id - Step identifier
   * @param expression - Transform function
   */
  transform(
    id: string, 
    expression: (data: Record<string, any>) => any
  ): SensorWorkflow {
    return this.step(id, 'transform', { expression })
  }
  
  /**
   * Add a wait step
   * 
   * @param id - Step identifier
   * @param delay - Delay in milliseconds
   */
  wait(id: string, delay: number): SensorWorkflow {
    return this.step(id, 'wait', { delay })
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
  ): SensorWorkflow {
    return this.step(id, 'condition', { condition, thenStep, elseStep })
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
  ): SensorWorkflow {
    return this.step(id, 'store', { key, value })
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
 * Pre-built sensor workflows for common use cases
 */
export const CommonSensorWorkflows = {
  /**
   * Extract text from image using OCR
   */
  ocrExtract: SensorWorkflow.create('ocr-extract')
    .name('OCR Text Extraction')
    .description('Extract text from image using OCR service')
    .fetch('ocr', 'http://127.0.0.1:51248/api/ocr/process', {
      method: 'POST'
    })
    .transform('parse', (data) => ({
      extractedText: data.text || '',
      confidence: data.confidence || 0
    }))
    .build(),
  
  /**
   * Get current page metadata
   */
  pageMetadata: SensorWorkflow.create('page-metadata')
    .name('Page Metadata')
    .description('Collect current page metadata')
    .transform('collect', (data) => ({
      url: window.location?.href,
      title: document.title,
      timestamp: Date.now()
    }))
    .build(),
  
  /**
   * Get session context
   */
  sessionContext: SensorWorkflow.create('session-context')
    .name('Session Context')
    .description('Collect session context data')
    .transform('collect', (data) => ({
      sessionKey: localStorage.getItem?.('optimando-active-session-key'),
      timestamp: Date.now()
    }))
    .build()
}


