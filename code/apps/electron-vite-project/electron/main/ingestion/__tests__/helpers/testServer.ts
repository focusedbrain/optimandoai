/**
 * Test HTTP Server
 *
 * Starts the SAME Express router that production uses (registerIngestionRoutes),
 * bound to an ephemeral port. Returns a base URL for fetch-based tests.
 *
 * Each test run gets a clean server + clean in-memory SQLite DB.
 */

import express from 'express'
import type { Server } from 'node:http'
import { registerIngestionRoutes } from '../../ipc'
import { createTestDb } from './testDb'

export interface TestServerContext {
  baseUrl: string;
  server: Server;
  db: any;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServerContext> {
  const app = express()
  // Limit must exceed MAX_RAW_INPUT_BYTES (100 MB) so oversized-payload tests
  // pass through to the ingestion handler rather than being rejected here with
  // a 413 HTML response that the test cannot JSON-parse.
  app.use(express.json({ limit: '200mb' }))

  const db = createTestDb()

  registerIngestionRoutes(app, () => db)

  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'))
        return
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`
      resolve({
        baseUrl,
        server,
        db,
        close: () => new Promise<void>((res) => server.close(() => res())),
      })
    })
  })
}
