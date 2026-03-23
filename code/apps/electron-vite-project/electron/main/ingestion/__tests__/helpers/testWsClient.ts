/**
 * Test WebSocket RPC Client
 *
 * Wraps the handleIngestionRPC handler to simulate WebSocket RPC calls
 * in the same way the production main.ts WebSocket message handler does.
 * Uses the same handler function — no mocking of pipeline internals.
 */

import { handleIngestionRPC } from '../../ipc'
import { handleHandshakeRPC } from '../../../handshake/ipc'
import type { SSOSession } from '../../../handshake/types'

export interface WsRpcResult {
  id: string;
  [key: string]: unknown;
}

export async function sendIngestionRpc(
  method: string,
  params: any,
  db: any,
  ssoSession?: SSOSession,
): Promise<WsRpcResult> {
  const response = await handleIngestionRPC(method, params, db, ssoSession)
  return { id: 'rpc-test', ...response }
}

export async function sendHandshakeRpc(
  method: string,
  params: any,
  db: any,
): Promise<WsRpcResult> {
  const response = await handleHandshakeRPC(method, params, db)
  return { id: 'rpc-test', ...response }
}
