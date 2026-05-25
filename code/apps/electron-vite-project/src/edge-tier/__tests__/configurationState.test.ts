import { describe, it, expect } from 'vitest'

import { configurationStateFromDashboardPayload } from '../configurationState.js'

describe('configurationStateFromDashboardPayload', () => {
  it('reads edge_configuration_state from dashboard payload', () => {
    expect(
      configurationStateFromDashboardPayload({
        edge_configuration_state: 'setup_in_progress',
        replicas: [{ host: '203.0.113.10' }],
      }),
    ).toBe('setup_in_progress')
  })
})
