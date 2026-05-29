import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import {
  getOrCreateDeviceIdentity,
  rotateRegistryPairingCode,
} from '../src/deviceIdentity.js'

describe('deviceIdentity', () => {
  let dir = ''

  afterEach(() => {
    dir = ''
  })

  test('creates stable instance id and 6-digit registry code', async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-id-'))
    const a = await getOrCreateDeviceIdentity(dir)
    expect(a.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    expect(a.registryPairingCode).toMatch(/^[0-9]{6}$/)

    const b = await getOrCreateDeviceIdentity(dir)
    expect(b.instanceId).toBe(a.instanceId)
    expect(b.registryPairingCode).toBe(a.registryPairingCode)

    const raw = JSON.parse(await readFile(join(dir, 'agent-device-identity.json'), 'utf8')) as {
      instanceId: string
    }
    expect(raw.instanceId).toBe(a.instanceId)
  })

  test('rotateRegistryPairingCode changes code on disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-id-'))
    const before = await getOrCreateDeviceIdentity(dir)
    const after = await rotateRegistryPairingCode(dir)
    expect(after.instanceId).toBe(before.instanceId)
    expect(after.registryPairingCode).not.toBe(before.registryPairingCode)
  })
})
