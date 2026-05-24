/**
 * In-memory SSH credential consumer registry — snapshot test (P4.5.12).
 *
 * If a new file appears here, confirm it zeroes credentials on every exit path.
 */

import { describe, test, expect } from 'vitest'

/** Sorted list of main-process modules that hold in-memory SSH credentials. */
export const SSH_CREDENTIAL_CONSUMER_FILES = [
  'edge-tier/globalActions.ts',
  'edge-tier/replicaActions.ts',
  'edge-tier/replicaActionsIpc.ts',
  'edge-tier/globalActionsIpc.ts',
  'email/edgeFetch/supervisorPoll.ts',
  'wizard/handlers.ts',
  'wizard/ipc.ts',
  'wizard/sshSession.ts',
  'security/sshSecretBuffers.ts',
  'security/secureMemory.ts',
  'security/zeroize.ts',
].sort()

describe('SSH credential consumer registry', () => {
  test('matches snapshot — update deliberately when adding a new credential holder', () => {
    expect(SSH_CREDENTIAL_CONSUMER_FILES).toMatchSnapshot()
  })
})
