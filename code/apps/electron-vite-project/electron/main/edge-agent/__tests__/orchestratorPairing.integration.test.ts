import { describe, test, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadConfig } from '../../../../../edge-agent/src/config.js'
import { AgentStorage } from '../../../../../edge-agent/src/storage.js'
import { SetupStateMachine } from '../../../../../edge-agent/src/setupState.js'
import { startPairingServer } from '../../../../../edge-agent/src/pairingServer.js'
import { applyPairingConfirmation } from '../../../../../edge-agent/src/pairingConfirm.js'
import { pairConfirm, pairInitiate } from '../orchestratorPairing.js'

function opensslAvailable(): boolean {
  try {
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!opensslAvailable())('orchestrator pairing integration', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
    process.env['WRDESK_AGENT_PAIRING_HTTP'] = ''
  })

  test('happy path initiate and confirm', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orch-pair-'))
    dirs.push(dir)
    process.env['WRDESK_AGENT_PAIRING_HTTP'] = '1'

    const storage = new AgentStorage(dir)
    await storage.saveState({ phase: 'unpaired', ssoSub: 'user@test', ssoEmail: 'user@test' })
    const setup = new SetupStateMachine()
    setup.onSignedIn()
    const config = { ...loadConfig(), stateDir: dir, pairingHost: '127.0.0.1', pairingPort: 0 }
    const code = setup.ensurePairingCode().code

    const server = startPairingServer(config, storage, setup, async () => 'user@test', () => undefined)
    await server.ready
    const base = server.getBaseUrl()

    const initiated = await pairInitiate({
      address: base,
      pairingCode: code,
      orchestratorSub: 'user@test',
    })
    expect(initiated.fingerprint).toMatch(/^[a-f0-9]{4}(-[a-f0-9]{4}){3}$/)

    let confirm = await pairConfirm({
      address: base,
      sessionId: initiated.sessionId,
      orchestratorP2pAuthToken: initiated.orchestratorP2pAuthToken,
    })
    expect(confirm.status).toBe('awaiting_confirmations')

    await applyPairingConfirmation(
      setup,
      storage,
      initiated.sessionId,
      'agent_ui',
      () => undefined,
      config,
      initiated.orchestratorP2pAuthToken,
    )

    confirm = await pairConfirm({
      address: base,
      sessionId: initiated.sessionId,
      orchestratorP2pAuthToken: initiated.orchestratorP2pAuthToken,
    })
    expect(confirm.status).toBe('paired')

    server.close()
  })

  test('rejects wrong code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orch-pair-'))
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

    await expect(
      pairInitiate({
        address: server.getBaseUrl(),
        pairingCode: '999999',
        orchestratorSub: 'u',
      }),
    ).rejects.toMatchObject({ code: 'code_mismatch' })

    server.close()
  })
})
