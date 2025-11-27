/**
 * Workflow Registry
 * 
 * Manages workflow definitions and provides lookup functionality.
 */

import type { WorkflowDefinition, WorkflowType, ValidationResult } from '../types'

/**
 * Workflow Registry
 * 
 * Central registry for all workflow definitions.
 * 
 * @example
 * ```typescript
 * const registry = new WorkflowRegistry()
 * 
 * registry.register({
 *   id: 'extract-text',
 *   name: 'Extract Text from Image',
 *   type: 'sensor',
 *   entryStep: 'ocr',
 *   steps: [
 *     { id: 'ocr', type: 'api', config: { endpoint: '/ocr' }, nextSteps: [] }
 *   ]
 * })
 * 
 * const workflow = registry.get('extract-text')
 * ```
 */
export class WorkflowRegistry {
  /** Registered workflows */
  private workflows: Map<string, WorkflowDefinition> = new Map()
  
  /**
   * Register a workflow definition
   * 
   * @param workflow - The workflow to register
   */
  register(workflow: WorkflowDefinition): void {
    const validation = this.validate(workflow)
    if (!validation.valid) {
      throw new Error(`Invalid workflow: ${validation.errors.join(', ')}`)
    }
    
    this.workflows.set(workflow.id, workflow)
    console.log(`[WorkflowRegistry] Registered ${workflow.type} workflow: ${workflow.id}`)
  }
  
  /**
   * Unregister a workflow
   * 
   * @param id - The workflow ID to remove
   */
  unregister(id: string): void {
    if (this.workflows.delete(id)) {
      console.log(`[WorkflowRegistry] Unregistered workflow: ${id}`)
    }
  }
  
  /**
   * Get a workflow by ID
   * 
   * @param id - The workflow ID
   * @returns The workflow definition or undefined
   */
  get(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id)
  }
  
  /**
   * Check if a workflow exists
   * 
   * @param id - The workflow ID
   * @returns Whether the workflow exists
   */
  has(id: string): boolean {
    return this.workflows.has(id)
  }
  
  /**
   * Get all workflows
   * 
   * @returns Array of all workflow definitions
   */
  getAll(): WorkflowDefinition[] {
    return Array.from(this.workflows.values())
  }
  
  /**
   * Get workflows by type
   * 
   * @param type - The workflow type to filter by
   * @returns Array of matching workflows
   */
  getByType(type: WorkflowType): WorkflowDefinition[] {
    return Array.from(this.workflows.values()).filter(w => w.type === type)
  }
  
  /**
   * Get all sensor workflows
   */
  getSensorWorkflows(): WorkflowDefinition[] {
    return this.getByType('sensor')
  }
  
  /**
   * Get all action workflows
   */
  getActionWorkflows(): WorkflowDefinition[] {
    return this.getByType('action')
  }
  
  /**
   * Validate a workflow definition
   * 
   * @param workflow - The workflow to validate
   * @returns Validation result
   */
  validate(workflow: WorkflowDefinition): ValidationResult {
    const errors: string[] = []
    
    if (!workflow.id || typeof workflow.id !== 'string') {
      errors.push('Workflow must have a string id')
    }
    
    if (!workflow.name || typeof workflow.name !== 'string') {
      errors.push('Workflow must have a string name')
    }
    
    if (!['sensor', 'action'].includes(workflow.type)) {
      errors.push('Workflow type must be "sensor" or "action"')
    }
    
    if (!Array.isArray(workflow.steps)) {
      errors.push('Workflow must have a steps array')
    } else {
      // Check for entry step
      if (!workflow.entryStep) {
        errors.push('Workflow must have an entryStep')
      } else if (!workflow.steps.find(s => s.id === workflow.entryStep)) {
        errors.push(`Entry step '${workflow.entryStep}' not found in steps`)
      }
      
      // Validate each step
      const stepIds = new Set<string>()
      for (const step of workflow.steps) {
        if (!step.id) {
          errors.push('Each step must have an id')
          continue
        }
        
        if (stepIds.has(step.id)) {
          errors.push(`Duplicate step id: ${step.id}`)
        }
        stepIds.add(step.id)
        
        if (!step.type) {
          errors.push(`Step '${step.id}' must have a type`)
        }
        
        // Check that nextSteps reference valid steps
        if (step.nextSteps) {
          for (const nextId of step.nextSteps) {
            if (!workflow.steps.find(s => s.id === nextId)) {
              errors.push(`Step '${step.id}' references unknown next step '${nextId}'`)
            }
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }
  
  /**
   * Clear all registered workflows
   */
  clear(): void {
    this.workflows.clear()
    console.log('[WorkflowRegistry] Cleared all workflows')
  }
  
  /**
   * Get workflow count
   */
  get size(): number {
    return this.workflows.size
  }
}

/**
 * Default singleton instance
 */
export const workflowRegistry = new WorkflowRegistry()




