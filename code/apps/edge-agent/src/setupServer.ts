import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { AgentConfig, AgentPhase } from './config.js'
import type { AgentStorage } from './storage.js'
import { formatPairingCodeDisplay } from './pairingCode.js'
import { getOrCreateDeviceIdentity, rotateRegistryPairingCode } from './deviceIdentity.js'
import { ensureAgentRegistryAfterSso } from './registryBootstrap.js'
import { applyPairingConfirmation } from './pairingConfirm.js'
import { completeLogin, isSignedIn, startLogin } from './sso/session.js'
import type { SetupStateMachine } from './setupState.js'
import type { PodManager } from './pod-manager.js'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const setupUiDir = join(moduleDir, 'setup-ui')

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`
}

/** Localhost maintenance routes that stay available after pairing (recovery is P2P-only per PR7). */
const PAIRED_MAINTENANCE_PATHS = new Set(['/agent/health'])

export interface SetupServerDeps {
  config: AgentConfig
  storage: AgentStorage
  setup: SetupStateMachine
  podManager: PodManager
  getPhase: () => AgentPhase
  onPhaseChange: (phase: AgentPhase) => void
  onSignedIn: () => void
}

export interface SetupServerHandle {
  close(): void
}

export function startSetupServer(deps: SetupServerDeps): SetupServerHandle {
  const { config, storage, setup, podManager, getPhase, onPhaseChange, onSignedIn } = deps

  const server = createServer((req, res) => {
    void handle(req, res)
  })

  async function buildHealth(): Promise<Record<string, unknown>> {
    const signedIn = await isSignedIn(storage)
    const state = await storage.loadState()
    let setupPhase = setup.getUiPhase()
    if (getPhase() === 'paired') {
      setupPhase = 'pairing_complete'
    } else if (signedIn && setupPhase === 'welcome') {
      onSignedIn()
      setupPhase = setup.getUiPhase()
    }

    const registryBootstrap = config.registryBootstrapEnabled
    const codeState =
      signedIn && !registryBootstrap && setupPhase !== 'registry_ready'
        ? setup.ensurePairingCode()
        : null
    const session = setup.getSession()
    const deviceIdentity = signedIn && registryBootstrap ? await getOrCreateDeviceIdentity(config.stateDir) : null

    const pod = podManager.getStatus()
    return {
      phase: getPhase(),
      setupPhase,
      signedIn,
      registryBootstrapEnabled: registryBootstrap,
      ssoEmail: state.ssoEmail ?? state.ssoSub,
      ssoError: setup.getSsoError(),
      pairingCodeDisplay: codeState ? formatPairingCodeDisplay(codeState.code) : null,
      pairingCodeExpiresAt: codeState?.expiresAt ?? null,
      registryPairingCodeDisplay: deviceIdentity
        ? formatPairingCodeDisplay(deviceIdentity.registryPairingCode)
        : null,
      deviceInstanceId: deviceIdentity?.instanceId ?? null,
      deviceName: deviceIdentity?.deviceName ?? null,
      sessionId: session?.sessionId ?? null,
      fingerprint: session?.fingerprint ?? null,
      podName: config.podName,
      podState: pod.state,
      podLastError: pod.lastError,
      podLastErrorCode: pod.lastErrorCode,
      edgePodId: pod.edgePodId ?? state.edgePodId ?? null,
      edgePublicKeyHex: pod.edgePublicKeyHex ?? state.edgePublicKeyHex ?? null,
      haltedByAnomaly: state.haltedByAnomaly ?? false,
      agentEncryptionPublicKeyB64: state.agentEncryptionPublicKeyB64 ?? null,
      encryptionKeyMigrationRequired: state.encryptionKeyMigrationRequired ?? false,
      imageDigestExpected: pod.imageDigestExpected,
      imageDigestActual: pod.imageDigestActual,
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url?.split('?')[0] ?? '/'

    if (url === '/agent/recover') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found', message: 'Use authenticated P2P /agent/recover' }))
      return
    }

    if (getPhase() === 'paired' && !PAIRED_MAINTENANCE_PATHS.has(url)) {
      res.writeHead(410, { 'Content-Type': 'text/html' })
      res.end(
        htmlPage(
          'Setup complete',
          '<p>Setup is complete. Manage this server from WR Desk.</p>',
        ),
      )
      return
    }

    if (url === '/agent/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(await buildHealth()))
      return
    }

    if (url === '/setup-ui/app.js' && req.method === 'GET') {
      const js = await readFile(join(setupUiDir, 'app.js'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end(js)
      return
    }

    if ((url === '/' || url === '/index.html') && req.method === 'GET') {
      const html = await readFile(join(setupUiDir, 'index.html'), 'utf8')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
      return
    }

    if (url === '/auth/start' && req.method === 'GET') {
      try {
        setup.beginSigningIn()
        const pending = await startLogin()
        res.writeHead(302, { Location: pending.authorizationUrl })
        res.end()
      } catch (err) {
        setup.setSsoError(String(err))
        res.writeHead(302, { Location: '/' })
        res.end()
      }
      return
    }

    if (url === '/sso-callback' && req.method === 'GET') {
      const query = new URL(req.url ?? '/', 'http://local').searchParams
      const error = query.get('error')
      if (error) {
        setup.setSsoError(error)
        res.writeHead(302, { Location: '/' })
        res.end()
        return
      }
      const code = query.get('code')
      const state = query.get('state')
      if (!code || !state) {
        setup.setSsoError('Missing authorization code')
        res.writeHead(302, { Location: '/' })
        res.end()
        return
      }
      try {
        await completeLogin(storage, { code, state })
        onSignedIn()
        res.writeHead(302, { Location: '/' })
        res.end()
      } catch (err) {
        setup.setSsoError(String(err))
        res.writeHead(302, { Location: '/' })
        res.end()
      }
      return
    }

    if (url === '/setup/regenerate-code' && req.method === 'POST') {
      if (config.registryBootstrapEnabled) {
        await rotateRegistryPairingCode(config.stateDir)
        await ensureAgentRegistryAfterSso(storage, config)
      } else {
        setup.regeneratePairingCode()
      }
      res.writeHead(204)
      res.end()
      return
    }

    if (url === '/setup/pair/confirm' && req.method === 'POST') {
      const body = await readJson(req)
      const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
      const outcome = await applyPairingConfirmation(
        setup,
        storage,
        sessionId,
        'agent_ui',
        () => {
          onPhaseChange('paired')
          setup.markPairedIdle()
        },
        config,
      )
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(outcome))
      return
    }

    if (url === '/setup/pair/reject' && req.method === 'POST') {
      setup.rejectSession()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'rejected' }))
      return
    }

    res.writeHead(404)
    res.end('Not found')
  }

  server.listen(config.setupPort, config.setupHost, () => {
    console.log(
      JSON.stringify({
        level: 'info',
        source: 'agent',
        event: 'setup_ui_listening',
        host: config.setupHost,
        port: config.setupPort,
      }),
    )
  })

  return { close: () => server.close() }
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>)
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}
