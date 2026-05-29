import type { AgentConfig, AgentPhase } from './config.js'
import { AgentStorage } from './storage.js'
import { startSetupServer } from './setupServer.js'
import { startPairingServer } from './pairingServer.js'
import { SetupStateMachine } from './setupState.js'
import { isSignedIn } from './sso/session.js'
import { PodManager } from './pod-manager.js'
import { ensureAgentCrypto, migratePairRecordCrypto } from './agentCrypto.js'
import { startAgentApiServer } from './agentApiServer.js'
import { initAgentLogStream } from './log-stream/init.js'
import { ensureAgentRegistryAfterSso } from './registryBootstrap.js'

export interface AgentRuntime {
  phase: AgentPhase
  shutdown(): Promise<void>
}

export async function startAgentRuntime(config: AgentConfig): Promise<AgentRuntime> {
  const storage = new AgentStorage(config.stateDir)
  const state = await storage.loadState()
  if (await isSignedIn(storage) || state.phase === 'paired') {
    await ensureAgentCrypto(storage, config)
    await migratePairRecordCrypto(storage, config)
  }
  let phase: AgentPhase = state.phase === 'paired' ? 'paired' : 'unpaired'
  const setup = new SetupStateMachine()

  if (phase === 'paired') {
    setup.markPairedIdle()
  } else if (await isSignedIn(storage)) {
    if (config.registryBootstrapEnabled) {
      setup.onSignedInRegistryReady()
      void ensureAgentRegistryAfterSso(storage, config).catch((err) => {
        console.warn(
          JSON.stringify({
            level: 'warn',
            source: 'coordination',
            event: 'registry_bootstrap_startup_failed',
            message: String(err),
          }),
        )
      })
    } else {
      setup.onSignedIn()
    }
  }

  const podManager = new PodManager(config, storage)
  const logBuffer = initAgentLogStream(config, storage)

  const agentApi = startAgentApiServer(config, {
    storage,
    podManager,
    getPodAuthSecret: () => podManager.getPodAuthSecret(),
    logBuffer,
  })

  const onPaired = () => {
    phase = 'paired'
    void podManager.startPod().catch((err) => {
      console.error(
        JSON.stringify({
          level: 'error',
          source: 'agent',
          event: 'pod_start_after_pair_failed',
          message: String(err),
        }),
      )
    })
  }

  const pairing = startPairingServer(
    config,
    storage,
    setup,
    async () => {
      const s = await storage.loadState()
      return s.ssoSub ?? null
    },
    onPaired,
  )

  const setupServer = startSetupServer({
    config,
    storage,
    setup,
    podManager,
    getPhase: () => phase,
    onPhaseChange: (next) => {
      phase = next
    },
    onSignedIn: () => {
      if (config.registryBootstrapEnabled) {
        setup.onSignedInRegistryReady()
        void ensureAgentRegistryAfterSso(storage, config).then(() => ensureAgentCrypto(storage, config))
      } else {
        setup.onSignedIn()
        void ensureAgentCrypto(storage, config)
      }
    },
  })

  if (phase === 'paired') {
    void podManager.startPod()
  }

  return {
    phase,
    async shutdown() {
      setupServer.close()
      pairing.close()
      agentApi.close()
      await podManager.stopPod()
    },
  }
}
