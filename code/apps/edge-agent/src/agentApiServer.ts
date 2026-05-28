import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import type { AgentConfig } from './config.js'
import { routeAgentApi, type AgentApiDeps } from './agent-api.js'

export interface AgentApiServerHandle {
  close(): void
}

export function startAgentApiServer(
  config: AgentConfig,
  deps: AgentApiDeps,
): AgentApiServerHandle {
  const server = createServer((req, res) => {
    void handle(req, res)
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const handled = await routeAgentApi(req, res, deps)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'error',
          source: 'agent-api',
          event: 'handler_error',
          message: String(err),
        }),
      )
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error', message: 'Internal error' }))
    }
  }

  server.listen(config.p2pPort, config.p2pHost, () => {
    console.error(
      JSON.stringify({
        level: 'info',
        source: 'agent-api',
        event: 'listening',
        host: config.p2pHost,
        port: config.p2pPort,
      }),
    )
  })

  return { close: () => server.close() }
}
