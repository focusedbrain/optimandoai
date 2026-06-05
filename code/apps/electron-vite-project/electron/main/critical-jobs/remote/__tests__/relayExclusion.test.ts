/**
 * Standing assertion (spec 0017 §2.1): the `critical_job_*` family is a DIRECT
 * service RPC over the per-handshake ingest endpoint and is NEVER coordination-
 * relay whitelisted — exactly like `internal_inference_*`. The relay carries
 * handshake signaling only; job bytes go direct. This guards against a future
 * edit that adds a critical_job type to a relay/signal whitelist.
 */

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES } from '../../../handshake/p2pTransport'

const electronMain = join(__dirname, '..', '..', '..')

describe('critical_job_* relay exclusion', () => {
  test('no critical_job_* type is in the coordination relay capsule whitelist', () => {
    for (const t of COORDINATION_RELAY_ALLOWED_CAPSULE_TYPES) {
      expect(t.startsWith('critical_job')).toBe(false)
    }
  })

  test('the p2p signal type whitelist source contains no critical_job_* entry', () => {
    const src = readFileSync(join(electronMain, 'internalInference', 'relayP2pSignalHandler.ts'), 'utf8')
    expect(src).not.toContain('critical_job')
  })

  test('the coordination-service relay whitelist contains no critical_job_* entry', () => {
    const src = readFileSync(
      join(electronMain, '..', '..', '..', '..', 'packages', 'coordination-service', 'src', 'server.ts'),
      'utf8',
    )
    // RELAY_ALLOWED_TYPES line must not mention critical_job
    const relayLine = src.split('\n').find((l) => l.includes('RELAY_ALLOWED_TYPES')) ?? ''
    expect(relayLine).not.toContain('critical_job')
  })
})
