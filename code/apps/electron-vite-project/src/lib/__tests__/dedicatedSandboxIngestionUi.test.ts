import { describe, it, expect } from 'vitest'
import {
  DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS,
  isDedicatedSandboxHostTriggeredIngestion,
} from '../dedicatedSandboxIngestionUi'

describe('isDedicatedSandboxHostTriggeredIngestion', () => {
  it('true only for dedicated sandbox topology', () => {
    expect(isDedicatedSandboxHostTriggeredIngestion(true, 'dedicated')).toBe(true)
    expect(isDedicatedSandboxHostTriggeredIngestion(true, 'single_machine')).toBe(false)
    expect(isDedicatedSandboxHostTriggeredIngestion(true, 'none')).toBe(false)
    expect(isDedicatedSandboxHostTriggeredIngestion(false, 'dedicated')).toBe(false)
  })
})

describe('DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS', () => {
  it('names host-triggered fetch model', () => {
    expect(DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS).toContain('host device')
  })
})
