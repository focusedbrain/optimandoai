import { describe, test, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { ensureAgentCrypto } from '../src/agentCrypto.js'
import { loadConfig } from '../src/config.js'
import { applyPairingConfirmation } from '../src/pairingConfirm.js'
import { SetupStateMachine } from '../src/setupState.js'
import { AgentStorage } from '../src/storage.js'
import { EDGE_INGESTOR_HANDSHAKE_TYPE } from '../src/edgeIngestorHandshake.js'

describe('edge_ingestor pairing handshake record', () => {
  test('pairing completion persists edge_ingestor handshake shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-ingestor-'))
    try {
      const storage = new AgentStorage(dir)
      const config = { ...loadConfig(), stateDir: dir }
      await storage.saveState({ phase: 'unpaired', ssoSub: 'user@test' })
      await ensureAgentCrypto(storage, config)
      const setup = new SetupStateMachine()
      setup.onSignedIn()
      const code = setup.ensurePairingCode().code
      const started = setup.initiatePairing({
        pairingCode: code,
        orchestratorSub: 'user@test',
        orchestratorPublicKey: 'a'.repeat(64),
        orchestratorNonce: 'n1',
        agentSignedInSub: 'user@test',
      })
      expect(started.ok).toBe(true)
      if (!started.ok) return

      setup.confirmOrchestrator(started.session.sessionId)
      await applyPairingConfirmation(
        setup,
        storage,
        started.session.sessionId,
        'agent_ui',
        () => undefined,
        config,
        '22222222-2222-2222-2222-222222222222',
      )

      const state = await storage.loadState()
      expect(state.pairRecord?.handshakeType).toBe(EDGE_INGESTOR_HANDSHAKE_TYPE)
      expect(state.pairRecord?.initiatorDeviceRole).toBe('host')
      expect(state.pairRecord?.acceptorDeviceRole).toBe('edge_agent')
      expect(state.pairRecord?.handshakeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
