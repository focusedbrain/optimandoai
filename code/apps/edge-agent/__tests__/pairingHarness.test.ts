import { describe, test, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadConfig } from '../src/config.js'
import { ensureAgentCrypto } from '../src/agentCrypto.js'
import { AgentStorage } from '../src/storage.js'
import { SetupStateMachine } from '../src/setupState.js'
import { startPairingServer } from '../src/pairingServer.js'

describe('pairing harness', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) {
      rmSync(dirs.pop()!, { recursive: true, force: true })
    }
  })

  test('happy path: initiate, dual confirm, persist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-pair-'))
    dirs.push(dir)
    process.env['WRDESK_AGENT_PAIRING_HTTP'] = '1'

    const storage = new AgentStorage(dir)
    await storage.saveState({ phase: 'unpaired', ssoSub: 'user@test', ssoEmail: 'user@test' })
    const setup = new SetupStateMachine()
    setup.onSignedIn()
    const config = { ...loadConfig(), stateDir: dir, pairingHost: '127.0.0.1', pairingPort: 0 }
    await ensureAgentCrypto(storage, config)
    const code = setup.ensurePairingCode().code

    let paired = false
    const server = startPairingServer(config, storage, setup, async () => 'user@test', () => {
      paired = true
    })
    await server.ready
    const base = server.getBaseUrl()

    const initRes = await fetch(`${base}/pair/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairing_code: code,
        orchestrator_sub: 'user@test',
        orchestrator_public_key: 'd'.repeat(64),
        orchestrator_nonce: 'orch-nonce',
      }),
    })
    expect(initRes.status).toBe(200)
    const init = (await initRes.json()) as { session_id: string; fingerprint: string }

    let confirmRes = await fetch(`${base}/pair/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: init.session_id,
        party: 'orchestrator',
        orchestrator_p2p_auth_token: '11111111-1111-1111-1111-111111111111',
      }),
    })
    expect((await confirmRes.json()).status).toBe('awaiting_confirmations')

    const { applyPairingConfirmation } = await import('../src/pairingConfirm.js')
    await applyPairingConfirmation(
      setup,
      storage,
      init.session_id,
      'agent_ui',
      () => {
        paired = true
      },
      config,
    )

    expect(paired).toBe(true)
    const saved = await storage.loadState()
    expect(saved.phase).toBe('paired')
      expect(saved.pairRecord?.fingerprint).toBe(init.fingerprint)
      expect(saved.pairRecord?.handshakeType).toBe('edge_ingestor')
    server.close()
  })

  test('rejects wrong pairing code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-pair-'))
    dirs.push(dir)
    const storage = new AgentStorage(dir)
    await storage.saveState({ phase: 'unpaired', ssoSub: 'u' })
    const setup = new SetupStateMachine()
    setup.onSignedIn()
    setup.ensurePairingCode()

    const server = startPairingServer(
      { ...loadConfig(), stateDir: dir, pairingHost: '127.0.0.1', pairingPort: 0 },
      storage,
      setup,
      async () => 'u',
      () => undefined,
    )
    await server.ready
    const res = await fetch(`${server.getBaseUrl()}/pair/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairing_code: '999999',
        orchestrator_sub: 'u',
        orchestrator_public_key: 'a'.repeat(64),
        orchestrator_nonce: 'n',
      }),
    })
    expect(res.status).toBe(401)
    server.close()
  })
})
