/**
 * ConditionEngine Unit Tests
 * 
 * Tests for the AND/OR/NOT condition evaluation logic.
 */

import { ConditionEngine } from '../conditions/ConditionEngine'
import type { Condition, FieldCondition } from '../types'

describe('ConditionEngine', () => {
  let engine: ConditionEngine

  beforeEach(() => {
    engine = new ConditionEngine()
  })

  describe('evaluate', () => {
    describe('null conditions', () => {
      it('should return true for null condition', () => {
        expect(engine.evaluate(null, {})).toBe(true)
      })
    })

    describe('field conditions', () => {
      it('should evaluate eq operator', () => {
        const condition: FieldCondition = { field: 'name', op: 'eq', value: 'test' }
        expect(engine.evaluate(condition, { name: 'test' })).toBe(true)
        expect(engine.evaluate(condition, { name: 'other' })).toBe(false)
      })

      it('should evaluate ne operator', () => {
        const condition: FieldCondition = { field: 'name', op: 'ne', value: 'test' }
        expect(engine.evaluate(condition, { name: 'other' })).toBe(true)
        expect(engine.evaluate(condition, { name: 'test' })).toBe(false)
      })

      it('should evaluate contains operator for strings', () => {
        const condition: FieldCondition = { field: 'text', op: 'contains', value: 'hello' }
        expect(engine.evaluate(condition, { text: 'say hello world' })).toBe(true)
        expect(engine.evaluate(condition, { text: 'goodbye' })).toBe(false)
      })

      it('should evaluate contains operator for arrays', () => {
        const condition: FieldCondition = { field: 'tags', op: 'contains', value: 'urgent' }
        expect(engine.evaluate(condition, { tags: ['urgent', 'important'] })).toBe(true)
        expect(engine.evaluate(condition, { tags: ['normal'] })).toBe(false)
      })

      it('should evaluate gt operator', () => {
        const condition: FieldCondition = { field: 'count', op: 'gt', value: 5 }
        expect(engine.evaluate(condition, { count: 10 })).toBe(true)
        expect(engine.evaluate(condition, { count: 5 })).toBe(false)
        expect(engine.evaluate(condition, { count: 3 })).toBe(false)
      })

      it('should evaluate lt operator', () => {
        const condition: FieldCondition = { field: 'count', op: 'lt', value: 5 }
        expect(engine.evaluate(condition, { count: 3 })).toBe(true)
        expect(engine.evaluate(condition, { count: 5 })).toBe(false)
        expect(engine.evaluate(condition, { count: 10 })).toBe(false)
      })

      it('should evaluate gte operator', () => {
        const condition: FieldCondition = { field: 'count', op: 'gte', value: 5 }
        expect(engine.evaluate(condition, { count: 5 })).toBe(true)
        expect(engine.evaluate(condition, { count: 10 })).toBe(true)
        expect(engine.evaluate(condition, { count: 3 })).toBe(false)
      })

      it('should evaluate lte operator', () => {
        const condition: FieldCondition = { field: 'count', op: 'lte', value: 5 }
        expect(engine.evaluate(condition, { count: 5 })).toBe(true)
        expect(engine.evaluate(condition, { count: 3 })).toBe(true)
        expect(engine.evaluate(condition, { count: 10 })).toBe(false)
      })

      it('should evaluate regex operator', () => {
        const condition: FieldCondition = { field: 'email', op: 'regex', value: '^[a-z]+@example\\.com$' }
        expect(engine.evaluate(condition, { email: 'test@example.com' })).toBe(true)
        expect(engine.evaluate(condition, { email: 'test@other.com' })).toBe(false)
      })

      it('should evaluate exists operator', () => {
        const existsCondition: FieldCondition = { field: 'name', op: 'exists', value: true }
        expect(engine.evaluate(existsCondition, { name: 'test' })).toBe(true)
        expect(engine.evaluate(existsCondition, {})).toBe(false)
        expect(engine.evaluate(existsCondition, { name: null })).toBe(false)

        const notExistsCondition: FieldCondition = { field: 'name', op: 'exists', value: false }
        expect(engine.evaluate(notExistsCondition, {})).toBe(true)
        expect(engine.evaluate(notExistsCondition, { name: 'test' })).toBe(false)
      })

      it('should evaluate in operator', () => {
        const condition: FieldCondition = { field: 'status', op: 'in', value: ['active', 'pending'] }
        expect(engine.evaluate(condition, { status: 'active' })).toBe(true)
        expect(engine.evaluate(condition, { status: 'pending' })).toBe(true)
        expect(engine.evaluate(condition, { status: 'closed' })).toBe(false)
      })

      it('should evaluate nin operator', () => {
        const condition: FieldCondition = { field: 'status', op: 'nin', value: ['deleted', 'archived'] }
        expect(engine.evaluate(condition, { status: 'active' })).toBe(true)
        expect(engine.evaluate(condition, { status: 'deleted' })).toBe(false)
      })

      it('should handle nested field paths', () => {
        const condition: FieldCondition = { field: 'user.profile.age', op: 'gt', value: 18 }
        expect(engine.evaluate(condition, { user: { profile: { age: 25 } } })).toBe(true)
        expect(engine.evaluate(condition, { user: { profile: { age: 15 } } })).toBe(false)
      })

      it('should handle array index paths', () => {
        const condition: FieldCondition = { field: 'items.0.name', op: 'eq', value: 'first' }
        expect(engine.evaluate(condition, { items: [{ name: 'first' }, { name: 'second' }] })).toBe(true)
      })
    })

    describe('ALL (AND) conditions', () => {
      it('should return true when all conditions match', () => {
        const condition: Condition = {
          all: [
            { field: 'a', op: 'eq', value: 1 },
            { field: 'b', op: 'eq', value: 2 }
          ]
        }
        expect(engine.evaluate(condition, { a: 1, b: 2 })).toBe(true)
      })

      it('should return false when any condition fails', () => {
        const condition: Condition = {
          all: [
            { field: 'a', op: 'eq', value: 1 },
            { field: 'b', op: 'eq', value: 2 }
          ]
        }
        expect(engine.evaluate(condition, { a: 1, b: 3 })).toBe(false)
      })

      it('should return true for empty all array (vacuous truth)', () => {
        const condition: Condition = { all: [] }
        expect(engine.evaluate(condition, {})).toBe(true)
      })
    })

    describe('ANY (OR) conditions', () => {
      it('should return true when any condition matches', () => {
        const condition: Condition = {
          any: [
            { field: 'a', op: 'eq', value: 1 },
            { field: 'b', op: 'eq', value: 2 }
          ]
        }
        expect(engine.evaluate(condition, { a: 1, b: 999 })).toBe(true)
        expect(engine.evaluate(condition, { a: 999, b: 2 })).toBe(true)
      })

      it('should return false when no conditions match', () => {
        const condition: Condition = {
          any: [
            { field: 'a', op: 'eq', value: 1 },
            { field: 'b', op: 'eq', value: 2 }
          ]
        }
        expect(engine.evaluate(condition, { a: 999, b: 999 })).toBe(false)
      })

      it('should return false for empty any array', () => {
        const condition: Condition = { any: [] }
        expect(engine.evaluate(condition, {})).toBe(false)
      })
    })

    describe('NOT conditions', () => {
      it('should negate field condition', () => {
        const condition: Condition = {
          not: { field: 'status', op: 'eq', value: 'deleted' }
        }
        expect(engine.evaluate(condition, { status: 'active' })).toBe(true)
        expect(engine.evaluate(condition, { status: 'deleted' })).toBe(false)
      })

      it('should negate compound conditions', () => {
        const condition: Condition = {
          not: {
            all: [
              { field: 'a', op: 'eq', value: 1 },
              { field: 'b', op: 'eq', value: 2 }
            ]
          }
        }
        expect(engine.evaluate(condition, { a: 1, b: 2 })).toBe(false)
        expect(engine.evaluate(condition, { a: 1, b: 3 })).toBe(true)
      })
    })

    describe('nested conditions', () => {
      it('should handle deeply nested conditions', () => {
        const condition: Condition = {
          all: [
            { field: 'enabled', op: 'eq', value: true },
            {
              any: [
                { field: 'priority', op: 'eq', value: 'high' },
                {
                  all: [
                    { field: 'urgent', op: 'eq', value: true },
                    { field: 'deadline', op: 'exists', value: true }
                  ]
                }
              ]
            }
          ]
        }

        // enabled + high priority
        expect(engine.evaluate(condition, { enabled: true, priority: 'high' })).toBe(true)

        // enabled + urgent with deadline
        expect(engine.evaluate(condition, { enabled: true, urgent: true, deadline: '2024-01-01' })).toBe(true)

        // not enabled
        expect(engine.evaluate(condition, { enabled: false, priority: 'high' })).toBe(false)

        // enabled but no matching condition
        expect(engine.evaluate(condition, { enabled: true, priority: 'low', urgent: false })).toBe(false)
      })
    })
  })

  describe('validate', () => {
    it('should validate null condition', () => {
      const result = engine.validate(null)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate valid field condition', () => {
      const condition: FieldCondition = { field: 'name', op: 'eq', value: 'test' }
      const result = engine.validate(condition)
      expect(result.valid).toBe(true)
    })

    it('should catch invalid operator', () => {
      const condition = { field: 'name', op: 'invalid' as any, value: 'test' }
      const result = engine.validate(condition)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('invalid operator'))).toBe(true)
    })

    it('should catch missing field', () => {
      const condition = { field: '', op: 'eq', value: 'test' } as FieldCondition
      const result = engine.validate(condition)
      expect(result.valid).toBe(false)
    })

    it('should validate nested conditions', () => {
      const condition: Condition = {
        all: [
          { field: 'a', op: 'eq', value: 1 },
          {
            any: [
              { field: 'b', op: 'gt', value: 5 }
            ]
          }
        ]
      }
      const result = engine.validate(condition)
      expect(result.valid).toBe(true)
    })
  })

  describe('static helpers', () => {
    it('should create eq condition', () => {
      const condition = ConditionEngine.eq('name', 'test')
      expect(condition).toEqual({ field: 'name', op: 'eq', value: 'test' })
    })

    it('should create all condition', () => {
      const condition = ConditionEngine.all(
        ConditionEngine.eq('a', 1),
        ConditionEngine.eq('b', 2)
      )
      expect(condition).toEqual({
        all: [
          { field: 'a', op: 'eq', value: 1 },
          { field: 'b', op: 'eq', value: 2 }
        ]
      })
    })

    it('should create any condition', () => {
      const condition = ConditionEngine.any(
        ConditionEngine.eq('status', 'active'),
        ConditionEngine.eq('status', 'pending')
      )
      expect(condition).toEqual({
        any: [
          { field: 'status', op: 'eq', value: 'active' },
          { field: 'status', op: 'eq', value: 'pending' }
        ]
      })
    })

    it('should create not condition', () => {
      const condition = ConditionEngine.not(ConditionEngine.eq('deleted', true))
      expect(condition).toEqual({
        not: { field: 'deleted', op: 'eq', value: true }
      })
    })

    it('should create exists condition', () => {
      const condition = ConditionEngine.exists('email')
      expect(condition).toEqual({ field: 'email', op: 'exists', value: true })
    })

    it('should create regex condition', () => {
      const condition = ConditionEngine.regex('email', '^\\w+@\\w+\\.\\w+$')
      expect(engine.evaluate(condition, { email: 'test@example.com' })).toBe(true)
    })
  })
})




