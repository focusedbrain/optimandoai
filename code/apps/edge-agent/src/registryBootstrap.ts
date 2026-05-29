import type { AgentConfig } from './config.js'
import {
  ensureRegistryPairingCodeRegistered,
  registerPairingCode,
} from './coordination/registry.js'
import {
  getOrCreateDeviceIdentity,
  rotateRegistryPairingCode,
  type AgentDeviceIdentity,
} from './deviceIdentity.js'
import { emitAgentLogEvent } from './log-stream/emit.js'
import type { AgentStorage } from './storage.js'
import { ensureFreshAccessToken } from './sso/session.js'

export async function ensureAgentRegistryAfterSso(
  storage: AgentStorage,
  config: AgentConfig,
): Promise<AgentDeviceIdentity> {
  const identity = await getOrCreateDeviceIdentity(config.stateDir)
  const state = await storage.loadState()
  const userId = state.ssoSub?.trim()
  if (!userId) {
    return identity
  }

  const { code, status } = await ensureRegistryPairingCodeRegistered({
    coordinationUrl: config.coordinationUrl,
    getAccessToken: () => ensureFreshAccessToken(storage),
    getUserId: async () => (await storage.loadState()).ssoSub ?? null,
    getIdentity: async () => getOrCreateDeviceIdentity(config.stateDir),
    rotatePairingCode: async () => (await rotateRegistryPairingCode(config.stateDir)).registryPairingCode,
    register: async (pairingCode) => {
      const token = await ensureFreshAccessToken(storage)
      const uid = (await storage.loadState()).ssoSub
      if (!token || !uid) return 'unavailable'
      const id = await getOrCreateDeviceIdentity(config.stateDir)
      return registerPairingCode({
        coordinationUrl: config.coordinationUrl,
        accessToken: token,
        userId: uid,
        instanceId: id.instanceId,
        pairingCode,
        deviceName: id.deviceName,
      })
    },
  })

  emitAgentLogEvent({
    level: status === 'unavailable' || status === 'collision' ? 'warn' : 'info',
    source: 'coordination',
    event_code: 'registry_pairing_code_registered',
    message:
      status === 'unavailable'
        ? 'Registry pairing code not yet registered (coordination unavailable).'
        : status === 'collision'
          ? 'Registry pairing code registration failed after retries (collision).'
          : 'Agent registered in coordination registry.',
    fields: {
      instance_id: identity.instanceId,
      registry_status: status,
      registry_code_last_three: code.slice(-3),
    },
  })

  return getOrCreateDeviceIdentity(config.stateDir)
}
