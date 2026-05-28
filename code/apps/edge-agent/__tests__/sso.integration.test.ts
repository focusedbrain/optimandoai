import { describe, test } from 'vitest'

describe.skipIf(!process.env['WRDESK_AGENT_KEYCLOAK_IT'])('SSO integration (real Keycloak)', () => {
  test('authorization code flow against test realm', async () => {
    // Manual: set WRDESK_AGENT_KEYCLOAK_IT=1 and run vitest with network + registered client.
  })
})
