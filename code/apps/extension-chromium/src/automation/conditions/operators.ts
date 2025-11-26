/**
 * Condition Operators
 * 
 * Implements comparison operators for field conditions.
 */

import type { ConditionOperator } from '../types'

/**
 * Get a nested value from an object using dot notation
 * 
 * @example
 * getNestedValue({ a: { b: 1 } }, 'a.b') // returns 1
 * getNestedValue({ a: [1, 2, 3] }, 'a.1') // returns 2
 * getNestedValue({ a: null }, 'a.b') // returns undefined
 */
export function getNestedValue(obj: any, path: string): any {
  if (obj === null || obj === undefined) {
    return undefined
  }
  
  const parts = path.split('.')
  let current = obj
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined
    }
    
    // Handle array indices
    if (Array.isArray(current)) {
      const index = parseInt(part, 10)
      if (!isNaN(index)) {
        current = current[index]
        continue
      }
    }
    
    current = current[part]
  }
  
  return current
}

/**
 * Evaluate a comparison operator
 * 
 * @param fieldValue - The value from the field
 * @param op - The operator to apply
 * @param compareValue - The value to compare against
 * @returns Whether the condition is satisfied
 */
export function evaluateOperator(
  fieldValue: any, 
  op: ConditionOperator, 
  compareValue: any
): boolean {
  switch (op) {
    case 'eq':
      return fieldValue === compareValue
      
    case 'ne':
      return fieldValue !== compareValue
      
    case 'contains':
      if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
        return fieldValue.includes(compareValue)
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(compareValue)
      }
      return false
      
    case 'startsWith':
      if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
        return fieldValue.startsWith(compareValue)
      }
      return false
      
    case 'endsWith':
      if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
        return fieldValue.endsWith(compareValue)
      }
      return false
      
    case 'gt':
      if (typeof fieldValue === 'number' && typeof compareValue === 'number') {
        return fieldValue > compareValue
      }
      if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
        return fieldValue > compareValue
      }
      return false
      
    case 'lt':
      if (typeof fieldValue === 'number' && typeof compareValue === 'number') {
        return fieldValue < compareValue
      }
      if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
        return fieldValue < compareValue
      }
      return false
      
    case 'gte':
      if (typeof fieldValue === 'number' && typeof compareValue === 'number') {
        return fieldValue >= compareValue
      }
      if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
        return fieldValue >= compareValue
      }
      return false
      
    case 'lte':
      if (typeof fieldValue === 'number' && typeof compareValue === 'number') {
        return fieldValue <= compareValue
      }
      if (typeof fieldValue === 'string' && typeof compareValue === 'string') {
        return fieldValue <= compareValue
      }
      return false
      
    case 'regex':
      if (typeof fieldValue === 'string') {
        try {
          const regex = compareValue instanceof RegExp 
            ? compareValue 
            : new RegExp(compareValue)
          return regex.test(fieldValue)
        } catch {
          return false
        }
      }
      return false
      
    case 'exists':
      // compareValue should be boolean - true means "must exist", false means "must not exist"
      const exists = fieldValue !== null && fieldValue !== undefined
      return compareValue === true ? exists : !exists
      
    case 'in':
      if (Array.isArray(compareValue)) {
        return compareValue.includes(fieldValue)
      }
      return false
      
    case 'nin':
      if (Array.isArray(compareValue)) {
        return !compareValue.includes(fieldValue)
      }
      return true
      
    default:
      // Unknown operator - fail safe
      console.warn(`[ConditionEngine] Unknown operator: ${op}`)
      return false
  }
}



