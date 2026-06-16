/**
 * Inbound `/beap/ingest` dispatch for `ingestion_poll_*` (sandbox receiver).
 */

import type * as http from 'http'
import { getHandshakeRecord } from '../../handshake/db'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import {
  INGESTION_POLL_SCHEMA_VERSION,
  isValidIngestionPollBaseEnvelope,
  type IngestionPollRequestWire,
} from './wire'
import { handleIngestionPollRequest, type IngestionPollReceiverDeps } from './receiver'

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

let receiverDepsOverride: Partial<IngestionPollReceiverDeps> | null = null

export function _setIngestionPollReceiverDepsForTests(deps: Partial<IngestionPollReceiverDeps> | null): void {
  receiverDepsOverride = deps
}

export async function tryHandleIngestionPollServiceP2P(
  db: unknown,
  parsed: unknown,
  res: http.ServerResponse,
): Promise<boolean> {
  if (!isValidIngestionPollBaseEnvelope(parsed)) {
    if (parsed && typeof parsed === 'object' && 'type' in (parsed as object)) {
      const t = (parsed as { type?: unknown }).type
      if (t === 'ingestion_poll_request' || t === 'ingestion_poll_result' || t === 'ingestion_poll_error') {
        writeJson(res, 400, {
          type: 'ingestion_poll_error',
          code: 'E_INGESTION_POLL_PROTOCOL',
          message: 'invalid envelope',
        })
        return true
      }
    }
    return false
  }

  if (parsed.schema_version !== INGESTION_POLL_SCHEMA_VERSION) {
    writeJson(res, 400, {
      type: 'ingestion_poll_error',
      code: 'E_INGESTION_POLL_PROTOCOL',
      message: `unsupported schema_version ${parsed.schema_version}`,
    })
    return true
  }

  if (parsed.type === 'ingestion_poll_request') {
    const req = parsed as IngestionPollRequestWire
    const deps: IngestionPollReceiverDeps = {
      db,
      getRecord: (hid) => getHandshakeRecord(db as never, hid),
      ...receiverDepsOverride,
    }
    const localId = getInstanceId().trim()
    const outcome = await handleIngestionPollRequest(req, localId, deps)
    writeJson(res, 200, outcome)
    return true
  }

  writeJson(res, 400, {
    type: 'ingestion_poll_error',
    code: 'E_INGESTION_POLL_PROTOCOL',
    message: `inbound ${parsed.type} not supported (synchronous response-body model)`,
  })
  return true
}
