/**
 * Condition Engine
 * 
 * Evaluates condition trees with AND/OR/NOT logic against a context object.
 * Used to determine if a listener should process an event.
 */

import type { 
  Condition, 
  FieldCondition, 
  AllCondition, 
  AnyCondition, 
  NotCondition,
  ValidationResult 
} from '../types'
import { evaluateOperator, getNestedValue } from './operators'

/**
 * Type guards for condition types
 */
function isAllCondition(c: Condition): c is AllCondition {
  return 'all' in c && Array.isArray((c as AllCondition).all)
}

function isAnyCondition(c: Condition): c is AnyCondition {
  return 'any' in c && Array.isArray((c as AnyCondition).any)
}

function isNotCondition(c: Condition): c is NotCondition {
  return 'not' in c && (c as NotCondition).not !== undefined
}

function isFieldCondition(c: Condition): c is FieldCondition {
  return 'field' in c && 'op' in c
}

/**
 * Condition Engine
 * 
 * Evaluates condition trees against a context object.
 * 
 * @example Basic usage
 * ```typescript
 * const engine = new ConditionEngine()
 * 
 * const condition: Condition = {
 *   all: [
 *     { field: 'source', op: 'eq', value: 'chat' },
 *     { field: 'input.length', op: 'gt', value: 10 }
 *   ]
 * }
 * 
 * const context = { source: 'chat', input: 'Hello, world!' }
 * const result = engine.evaluate(condition, context) // true
 * ```
 */
export class ConditionEngine {
  /**
   * Evaluate a condition tree against a context object
   * 
   * @param condition - The condition tree to evaluate
   * @param context - The context object to evaluate against
   * @returns Whether the condition is satisfied
   */
  evaluate(condition: Condition | null, context: Record<string, any>): boolean {
    // Null condition always passes
    if (condition === null) {
      return true
    }
    
    return this.evaluateCondition(condition, context)
  }
  
  /**
   * Internal recursive evaluation
   */
  private evaluateCondition(condition: Condition, context: Record<string, any>): boolean {
    // Handle ALL (AND) condition
    if (isAllCondition(condition)) {
      return this.evaluateAll(condition.all, context)
    }
    
    // Handle ANY (OR) condition
    if (isAnyCondition(condition)) {
      return this.evaluateAny(condition.any, context)
    }
    
    // Handle NOT condition
    if (isNotCondition(condition)) {
      return this.evaluateNot(condition.not, context)
    }
    
    // Handle field condition
    if (isFieldCondition(condition)) {
      return this.evaluateField(condition, context)
    }
    
    // Unknown condition type - fail safe
    console.warn('[ConditionEngine] Unknown condition type:', condition)
    return false
  }
  
  /**
   * Evaluate ALL (AND) condition - all sub-conditions must be true
   */
  private evaluateAll(conditions: Condition[], context: Record<string, any>): boolean {
    // Empty array is truthy (vacuous truth)
    if (conditions.length === 0) {
      return true
    }
    
    return conditions.every(c => this.evaluateCondition(c, context))
  }
  
  /**
   * Evaluate ANY (OR) condition - at least one must be true
   */
  private evaluateAny(conditions: Condition[], context: Record<string, any>): boolean {
    // Empty array is falsy (no conditions to satisfy)
    if (conditions.length === 0) {
      return false
    }
    
    return conditions.some(c => this.evaluateCondition(c, context))
  }
  
  /**
   * Evaluate NOT condition - sub-condition must be false
   */
  private evaluateNot(condition: Condition, context: Record<string, any>): boolean {
    return !this.evaluateCondition(condition, context)
  }
  
  /**
   * Evaluate a field condition
   */
  private evaluateField(condition: FieldCondition, context: Record<string, any>): boolean {
    const { field, op, value } = condition
    const fieldValue = getNestedValue(context, field)
    return evaluateOperator(fieldValue, op, value)
  }
  
  /**
   * Validate a condition structure
   * 
   * @param condition - The condition to validate
   * @returns Validation result with any errors
   */
  validate(condition: Condition | null): ValidationResult {
    const errors: string[] = []
    
    if (condition === null) {
      return { valid: true, errors: [] }
    }
    
    this.validateCondition(condition, errors, '')
    
    return {
      valid: errors.length === 0,
      errors
    }
  }
  
  /**
   * Internal recursive validation
   */
  private validateCondition(
    condition: Condition, 
    errors: string[], 
    path: string
  ): void {
    if (isAllCondition(condition)) {
      if (!Array.isArray(condition.all)) {
        errors.push(`${path || 'root'}: 'all' must be an array`)
        return
      }
      condition.all.forEach((c, i) => {
        this.validateCondition(c, errors, `${path}.all[${i}]`)
      })
      return
    }
    
    if (isAnyCondition(condition)) {
      if (!Array.isArray(condition.any)) {
        errors.push(`${path || 'root'}: 'any' must be an array`)
        return
      }
      condition.any.forEach((c, i) => {
        this.validateCondition(c, errors, `${path}.any[${i}]`)
      })
      return
    }
    
    if (isNotCondition(condition)) {
      if (condition.not === undefined) {
        errors.push(`${path || 'root'}: 'not' must have a condition`)
        return
      }
      this.validateCondition(condition.not, errors, `${path}.not`)
      return
    }
    
    if (isFieldCondition(condition)) {
      if (typeof condition.field !== 'string' || condition.field.length === 0) {
        errors.push(`${path || 'root'}: 'field' must be a non-empty string`)
      }
      if (!condition.op) {
        errors.push(`${path || 'root'}: 'op' is required`)
      }
      const validOps = [
        'eq', 'ne', 'contains', 'startsWith', 'endsWith',
        'gt', 'lt', 'gte', 'lte', 'regex', 'exists', 'in', 'nin'
      ]
      if (!validOps.includes(condition.op)) {
        errors.push(`${path || 'root'}: invalid operator '${condition.op}'`)
      }
      return
    }
    
    // Unknown condition structure
    errors.push(`${path || 'root'}: invalid condition structure`)
  }
  
  /**
   * Create a simple equals condition
   */
  static eq(field: string, value: any): FieldCondition {
    return { field, op: 'eq', value }
  }
  
  /**
   * Create a simple not-equals condition
   */
  static ne(field: string, value: any): FieldCondition {
    return { field, op: 'ne', value }
  }
  
  /**
   * Create a contains condition
   */
  static contains(field: string, value: string): FieldCondition {
    return { field, op: 'contains', value }
  }
  
  /**
   * Create a greater-than condition
   */
  static gt(field: string, value: number): FieldCondition {
    return { field, op: 'gt', value }
  }
  
  /**
   * Create a less-than condition
   */
  static lt(field: string, value: number): FieldCondition {
    return { field, op: 'lt', value }
  }
  
  /**
   * Create an AND condition
   */
  static all(...conditions: Condition[]): AllCondition {
    return { all: conditions }
  }
  
  /**
   * Create an OR condition
   */
  static any(...conditions: Condition[]): AnyCondition {
    return { any: conditions }
  }
  
  /**
   * Create a NOT condition
   */
  static not(condition: Condition): NotCondition {
    return { not: condition }
  }
  
  /**
   * Create an exists condition
   */
  static exists(field: string): FieldCondition {
    return { field, op: 'exists', value: true }
  }
  
  /**
   * Create a "does not exist" condition
   */
  static notExists(field: string): FieldCondition {
    return { field, op: 'exists', value: false }
  }
  
  /**
   * Create a regex condition
   */
  static regex(field: string, pattern: string | RegExp): FieldCondition {
    return { field, op: 'regex', value: pattern instanceof RegExp ? pattern.source : pattern }
  }
  
  /**
   * Create an "in" condition
   */
  static in(field: string, values: any[]): FieldCondition {
    return { field, op: 'in', value: values }
  }
}


