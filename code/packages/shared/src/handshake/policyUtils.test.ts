/**
 * AI Policy — Legacy mapping and exclusive mode tests
 */

import { describe, test, expect } from 'vitest'
import {
  legacyToAiProcessingMode,
  parsePolicyToMode,
  modeToUsageFlags,
  modeToLegacy,
  serializePolicyForDb,
  DEFAULT_AI_PROCESSING_MODE,
} from './policyUtils'

describe('legacyToAiProcessingMode', () => {
  test('cloud=true, internal=false => internal_and_cloud', () => {
    expect(legacyToAiProcessingMode({ cloud_ai: true, internal_ai: false })).toBe('internal_and_cloud')
  })

  test('cloud=false, internal=true => local_only', () => {
    expect(legacyToAiProcessingMode({ cloud_ai: false, internal_ai: true })).toBe('local_only')
  })

  test('cloud=false, internal=false => none', () => {
    expect(legacyToAiProcessingMode({ cloud_ai: false, internal_ai: false })).toBe('none')
  })

  test('both true (invalid) => local_only (defensive)', () => {
    expect(legacyToAiProcessingMode({ cloud_ai: true, internal_ai: true })).toBe('local_only')
  })

  test('null/undefined => default', () => {
    expect(legacyToAiProcessingMode(null)).toBe(DEFAULT_AI_PROCESSING_MODE)
    expect(legacyToAiProcessingMode(undefined)).toBe(DEFAULT_AI_PROCESSING_MODE)
  })
})

describe('parsePolicyToMode', () => {
  test('new enum value internal_and_cloud passes through', () => {
    expect(parsePolicyToMode({ ai_processing_mode: 'internal_and_cloud' })).toBe('internal_and_cloud')
    expect(parsePolicyToMode({ ai_processing_mode: 'local_only' })).toBe('local_only')
    expect(parsePolicyToMode({ ai_processing_mode: 'none' })).toBe('none')
  })

  test('backward compat: old cloud_allowed value maps to internal_and_cloud', () => {
    // Existing DB records and old capsules may contain 'cloud_allowed'
    expect(parsePolicyToMode({ ai_processing_mode: 'cloud_allowed' as any })).toBe('internal_and_cloud')
  })

  test('legacy format parsed correctly', () => {
    expect(parsePolicyToMode({ cloud_ai: true, internal_ai: false })).toBe('internal_and_cloud')
    expect(parsePolicyToMode({ cloud_ai: false, internal_ai: true })).toBe('local_only')
    expect(parsePolicyToMode({ cloud_ai: false, internal_ai: false })).toBe('none')
  })

  test('invalid legacy (both true) normalized', () => {
    expect(parsePolicyToMode({ cloud_ai: true, internal_ai: true })).toBe('local_only')
  })
})

describe('modeToLegacy (Boolean mapping)', () => {
  test('none -> cloud=false, internal=false', () => {
    expect(modeToLegacy('none')).toEqual({ cloud_ai: false, internal_ai: false })
  })

  test('local_only -> cloud=false, internal=true', () => {
    expect(modeToLegacy('local_only')).toEqual({ cloud_ai: false, internal_ai: true })
  })

  test('internal_and_cloud -> cloud=true, internal=false', () => {
    expect(modeToLegacy('internal_and_cloud')).toEqual({ cloud_ai: true, internal_ai: false })
  })
})

describe('modeToUsageFlags', () => {
  test('none => both false', () => {
    expect(modeToUsageFlags('none')).toEqual({ local_ai_allowed: false, cloud_ai_allowed: false })
  })

  test('local_only => local true, cloud false', () => {
    expect(modeToUsageFlags('local_only')).toEqual({ local_ai_allowed: true, cloud_ai_allowed: false })
  })

  test('internal_and_cloud => both true', () => {
    expect(modeToUsageFlags('internal_and_cloud')).toEqual({ local_ai_allowed: true, cloud_ai_allowed: true })
  })
})

describe('serializePolicyForDb', () => {
  test('internal_and_cloud: writes new mode and legacy booleans', () => {
    const json = serializePolicyForDb('internal_and_cloud')
    const parsed = JSON.parse(json)
    expect(parsed.ai_processing_mode).toBe('internal_and_cloud')
    expect(parsed.cloud_ai).toBe(true)
    expect(parsed.internal_ai).toBe(false)
  })

  test('local_only: writes new mode and legacy booleans', () => {
    const json = serializePolicyForDb('local_only')
    const parsed = JSON.parse(json)
    expect(parsed.ai_processing_mode).toBe('local_only')
    expect(parsed.cloud_ai).toBe(false)
    expect(parsed.internal_ai).toBe(true)
  })

  test('none: writes new mode and legacy booleans', () => {
    const json = serializePolicyForDb('none')
    const parsed = JSON.parse(json)
    expect(parsed.ai_processing_mode).toBe('none')
    expect(parsed.cloud_ai).toBe(false)
    expect(parsed.internal_ai).toBe(false)
  })
})
