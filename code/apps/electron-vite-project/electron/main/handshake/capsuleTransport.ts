/**
 * Capsule Transport — Builder → Ingestor Connector
 *
 * Bridges the sender-side capsule builder to the receiver's ingestion pipeline.
 * A built `HandshakeCapsuleWire` is serialized and submitted as a `RawInput`
 * to `handleIngestionRPC`, which runs it through the full pipeline:
 *   Ingestor → Validator → Distribution Gate → Handshake Pipeline
 *
 * Transport modes:
 *   - LOCAL_RPC: direct in-process call to handleIngestionRPC (same machine,
 *     same Electron process). Used for self-testing and local loopback.
 *   - JSON_STRING: returns the capsule as a serialized JSON string for
 *     out-of-process delivery (email, messenger, file drop). The receiver
 *     submits the string to their own Ingestor endpoint.
 *
 * The capsule is never submitted directly to the handshake layer —
 * it always enters via the Ingestor and is validated before routing.
 *
 * The RawInput is wrapped with:
 *   - mime_type: 'application/vnd.beap+json'   ← triggers MIME detection in Ingestor
 *   - No special headers required (JSON structure detection is the fallback)
 *
 * Note on HTTP vs RPC:
 *   The HTTP route (POST /api/ingestion/ingest) does NOT call
 *   processHandshakeCapsule — it only validates and returns the distribution
 *   decision. Use submitCapsuleViaRpc() for the full pipeline execution.
 */

import type { HandshakeCapsuleWire } from './capsuleBuilder'
import type { SSOSession } from './types'
import { handleIngestionRPC } from '../ingestion/ipc'
import type { RawInput, SourceType } from '../ingestion/types'

export interface SubmitResult {
  success: boolean;
  handshake_result?: any;
  distribution_target?: string;
  error?: string;
}

/**
 * Submit a built capsule through the local RPC ingestion pipeline.
 *
 * This is the canonical path for same-process delivery. The capsule goes
 * through the full Ingestor → Validator → Distribution Gate →
 * Handshake Pipeline chain.
 *
 * @param capsule - Capsule built by buildInitiateCapsule / buildAcceptCapsule
 * @param db      - SQLite database handle (vault must be unlocked)
 * @param session - SSO session of the LOCAL receiver (not the sender)
 * @param sourceType - Defaults to 'internal' for local submissions
 */
export async function submitCapsuleViaRpc(
  capsule: HandshakeCapsuleWire,
  db: any,
  session: SSOSession,
  sourceType: SourceType = 'internal',
): Promise<SubmitResult> {
  const body = JSON.stringify(capsule)

  const rawInput: RawInput = {
    body,
    mime_type: 'application/vnd.beap+json',
    headers: {
      'content-type': 'application/vnd.beap+json',
    },
  }

  try {
    const result = await handleIngestionRPC(
      'ingestion.ingest',
      {
        rawInput,
        sourceType,
        transportMeta: {
          channel_id: 'local-rpc',
          mime_type: 'application/vnd.beap+json',
        },
      },
      db,
      session,
    )

    return {
      success: result.success ?? false,
      handshake_result: result.handshake_result,
      distribution_target: result.distribution_target,
      error: result.error ?? result.reason,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message ?? 'Transport error',
    }
  }
}

/**
 * Serialize a capsule to a JSON string for out-of-process delivery.
 *
 * The receiver submits this string to their Ingestor as:
 *   rawInput = { body: jsonString, mime_type: 'application/vnd.beap+json' }
 *
 * The Ingestor will detect it via MIME type and parse the JSON.
 */
export function serializeCapsule(capsule: HandshakeCapsuleWire): string {
  return JSON.stringify(capsule)
}

/**
 * Deserialize a received JSON string back into a RawInput for the Ingestor.
 */
export function deserializeCapsuleToRawInput(jsonString: string): RawInput {
  return {
    body: jsonString,
    mime_type: 'application/vnd.beap+json',
    headers: {
      'content-type': 'application/vnd.beap+json',
    },
  }
}
