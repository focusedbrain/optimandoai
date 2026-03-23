/**
 * Test IPC Harness
 *
 * Simulates ipcMain.handle / ipcRenderer.invoke by calling the same
 * handleIngestionRPC handler that main.ts registers for IPC and WebSocket.
 *
 * This harness proves that the IPC entry point routes through processIncomingInput()
 * and cannot bypass the ingestion pipeline.
 */

import { handleIngestionRPC } from '../../ipc'
import { handleHandshakeRPC } from '../../../handshake/ipc'
import type { SSOSession } from '../../../handshake/types'

export class IpcHarness {
  constructor(
    private db: any,
    private ssoSession?: SSOSession,
  ) {}

  async invoke(channel: string, ...args: any[]): Promise<any> {
    if (channel === 'ingest-external-input') {
      const [rawInput, sourceType, transportMeta] = args
      return handleIngestionRPC(
        'ingestion.ingest',
        { rawInput, sourceType: sourceType ?? 'extension', transportMeta: transportMeta ?? {} },
        this.db,
        this.ssoSession,
      )
    }

    if (channel.startsWith('handshake.')) {
      return handleHandshakeRPC(channel, args[0] ?? {}, this.db)
    }

    throw new Error(`Unknown IPC channel: ${channel}`)
  }
}
