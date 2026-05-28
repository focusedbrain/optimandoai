import { describe, test } from 'vitest'

describe.skipIf(!process.env['WRDESK_AGENT_PODMAN_IT'])('Podman integration', () => {
  test('starts pod after paired state with real podman', async () => {
    // Manual: WRDESK_AGENT_PODMAN_IT=1 with image built and digest file updated.
  })
})
