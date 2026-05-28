import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'

import type { AgentConfig } from './config.js'
import type { AgentStorage } from './storage.js'
import {
  handlePairConfirm,
  handlePairInitiate,
  handlePairReject,
  handlePairStatus,
} from './pairingProtocol.js'
import { loadOrCreatePairingTls } from './pairingTls.js'
import type { SetupStateMachine } from './setupState.js'

export interface PairingServerHandle {
  close(): void
  readonly ready: Promise<void>
  getBaseUrl(): string
}

export function startPairingServer(
  config: AgentConfig,
  storage: AgentStorage,
  setup: SetupStateMachine,
  getSignedInSub: () => Promise<string | null>,
  onPaired: () => void,
): PairingServerHandle {
  const useHttp = process.env['WRDESK_AGENT_PAIRING_HTTP'] === '1'
  const host = config.pairingHost
  const port = config.pairingPort

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = req.url?.split('?')[0] ?? '/'
    try {
      if (path === '/pair/initiate') {
        await handlePairInitiate(req, res, setup, storage, getSignedInSub, config)
        return
      }
      if (path === '/pair/confirm') {
        await handlePairConfirm(req, res, setup, storage, onPaired, config)
        return
      }
      if (path === '/pair/status') {
        await handlePairStatus(req, res, setup)
        return
      }
      if (path === '/pair/reject') {
        await handlePairReject(req, res, setup)
        return
      }
      res.writeHead(404)
      res.end('Not found')
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          source: 'agent',
          event: 'pairing_handler_error',
          message: String(err),
        }),
      )
      res.writeHead(500)
      res.end('Internal error')
    }
  }

  const scheme = useHttp ? 'http' : 'https'
  let baseUrl = `${scheme}://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  const onListen = (server: ReturnType<typeof createHttpServer>, listenPort: number) => {
    server.listen(listenPort, host, () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host
        baseUrl = `${scheme}://${connectHost}:${addr.port}`
        logListening(scheme, host, addr.port)
      } else {
        logListening(scheme, host, listenPort)
      }
      resolveReady()
    })
  }

  if (useHttp) {
    const server = createHttpServer((req, res) => void route(req, res))
    onListen(server, port)
    return {
      ready,
      getBaseUrl: () => baseUrl,
      close: () => server.close(),
    }
  }

  const tls = loadOrCreatePairingTls(config.stateDir)
  const server = createHttpsServer({ cert: tls.cert, key: tls.key }, (req, res) => void route(req, res))
  server.listen(port, host, () => {
    const addr = server.address()
    if (addr && typeof addr === 'object') {
      const connectHost = host === '0.0.0.0' ? '127.0.0.1' : host
      baseUrl = `${scheme}://${connectHost}:${addr.port}`
      logListening(scheme, host, addr.port)
    } else {
      logListening(scheme, host, port)
    }
    resolveReady()
  })
  return {
    ready,
    getBaseUrl: () => baseUrl,
    close: () => server.close(),
  }
}

function logListening(scheme: string, host: string, port: number): void {
  console.log(
    JSON.stringify({
      level: 'info',
      source: 'agent',
      event: 'pairing_api_listening',
      scheme,
      host,
      port,
    }),
  )
}
