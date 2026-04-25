import { afterEach, describe, expect, test } from 'vitest'
import {
  _setInternalInferenceLogPackagedForTests,
  isInternalInferenceProdPackagedLogging,
  redactIdForLog,
} from '../internalInferenceLogRedact'

describe('internalInferenceLogRedact', () => {
  afterEach(() => {
    _setInternalInferenceLogPackagedForTests(null)
  })

  test('redactIdForLog truncates in packaged mode', () => {
    _setInternalInferenceLogPackagedForTests(true)
    const u = '01234567-89ab-cdef-0123-456789abcdef'
    expect(redactIdForLog(u)).toBe('01234567…')
  })

  test('redactIdForLog leaves short ids in dev', () => {
    _setInternalInferenceLogPackagedForTests(false)
    expect(isInternalInferenceProdPackagedLogging()).toBe(false)
    expect(redactIdForLog('abc')).toBe('abc')
  })
})
