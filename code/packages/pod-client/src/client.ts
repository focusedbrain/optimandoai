/**
 * packages/pod-client/src/client.ts
 *
 * Thin HTTP client for the BEAP pod ingestor (POST /ingest).
 *
 * Phase 3 (P3.9): optional edge-tier routing — POST to REMOTE_EDGE first,
 * then relay `{ body, edge_certificate }` to the local LOCAL_VERIFY ingestor.
 * The client does not verify certificates; that is the local verifier's job.
 *
 * Retry policy (local pod leg)
 * ────────────────────────────
 * Connection errors (ECONNREFUSED, ECONNRESET, etc.) are retried once.
 *
 * Edge leg: single attempt — unreachable edge → EDGE_UNREACHABLE (reject policy).
 */

import type {
  PodClientConfig,
  PodClient,
  RawInput,
  SourceType,
  TransportMetadata,
  PodIngestResult,
  DepackageKeys,
  EdgeReplica,
  EdgeFallbackPolicy,
} from './types.js'
import {
  PodIngestHttpError,
  PodTimeoutError,
  PodConnectionError,
  PodEdgeUnreachableError,
} from './types.js'

/** Maximum retry attempts on local-pod connection error (1 retry). */
const MAX_RETRIES = 1

export function createPodClient(config: PodClientConfig): PodClient {
  const { baseUrl, requestTimeoutMs } = config
  let edgeReplicas: EdgeReplica[] | null = null
  let fallbackPolicy: EdgeFallbackPolicy = 'reject'

  const client: PodClient = {
    configureEdgeTier(replicas, policy) {
      edgeReplicas = replicas
      if (policy) fallbackPolicy = policy
      if (replicas === null) fallbackPolicy = 'reject'
    },

    ingest(rawInput, sourceType, transportMeta, depackageKeys) {
      if (edgeReplicas && edgeReplicas.length > 0) {
        return ingestViaEdge(
          baseUrl,
          requestTimeoutMs,
          edgeReplicas[0]!,
          fallbackPolicy,
          rawInput,
          sourceType,
          transportMeta,
          depackageKeys,
        )
      }
      return ingestWithRetry(
        baseUrl,
        requestTimeoutMs,
        rawInput,
        sourceType,
        transportMeta,
        depackageKeys,
        0,
      )
    },
  }

  return client
}

function edgeBaseUrl(replica: EdgeReplica): string {
  return `http://${replica.host}:${replica.port}`
}

async function ingestViaEdge(
  localBaseUrl: string,
  timeoutMs: number,
  replica: EdgeReplica,
  fallbackPolicy: EdgeFallbackPolicy,
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: Partial<TransportMetadata> | undefined,
  depackageKeys: DepackageKeys | undefined,
): Promise<PodIngestResult> {
  let edgeResult: PodIngestResult
  try {
    edgeResult = await postIngestOnce(
      edgeBaseUrl(replica),
      timeoutMs,
      rawInput,
      sourceType,
      transportMeta,
      depackageKeys,
    )
  } catch (err) {
    if (fallbackPolicy === 'local_only') {
      // Phase 4/5 — downgrade path not implemented in pod-client yet.
      return ingestWithRetry(
        localBaseUrl,
        timeoutMs,
        rawInput,
        sourceType,
        transportMeta,
        depackageKeys,
        0,
      )
    }
    const cause = err instanceof Error ? err : new Error(String(err))
    if (
      err instanceof PodConnectionError ||
      err instanceof PodTimeoutError ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      throw new PodEdgeUnreachableError(
        { host: replica.host, port: replica.port, edge_pod_id: replica.edge_pod_id },
        cause,
      )
    }
    throw err
  }

  const edgeBody = (edgeResult.body ?? {}) as Record<string, unknown>
  const certificate = edgeBody['certificate'] ?? edgeBody['edge_certificate']
  if (certificate == null) {
    throw new PodIngestHttpError(502, {
      error: 'Edge ingest did not return certificate',
      edge_body: edgeResult.body,
    })
  }

  // Relay original raw bytes + certificate to local LOCAL_VERIFY ingestor.
  return ingestWithRetry(
    localBaseUrl,
    timeoutMs,
    rawInput,
    sourceType,
    transportMeta,
    depackageKeys,
    0,
    { edge_certificate: certificate },
  )
}

async function ingestWithRetry(
  baseUrl: string,
  timeoutMs: number,
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: Partial<TransportMetadata> | undefined,
  depackageKeys: DepackageKeys | undefined,
  attempt: number,
  extraFields?: Record<string, unknown>,
): Promise<PodIngestResult> {
  try {
    return await postIngestOnce(
      baseUrl,
      timeoutMs,
      rawInput,
      sourceType,
      transportMeta,
      depackageKeys,
      extraFields,
    )
  } catch (err) {
    if (err instanceof PodIngestHttpError) throw err
    if (err instanceof PodTimeoutError) throw err
    if (err instanceof PodEdgeUnreachableError) throw err
    if (err instanceof PodConnectionError && attempt < MAX_RETRIES) {
      return ingestWithRetry(
        baseUrl,
        timeoutMs,
        rawInput,
        sourceType,
        transportMeta,
        depackageKeys,
        attempt + 1,
        extraFields,
      )
    }
    throw err
  }
}

function buildIngestEnvelope(
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: Partial<TransportMetadata> | undefined,
  depackageKeys: DepackageKeys | undefined,
  extraFields?: Record<string, unknown>,
): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    body: rawInput.body,
    source_type: sourceType,
  }
  if (rawInput.mime_type !== undefined) envelope['mime_type'] = rawInput.mime_type
  if (rawInput.filename !== undefined) envelope['filename'] = rawInput.filename
  if (rawInput.headers !== undefined) envelope['headers'] = rawInput.headers
  if (transportMeta?.channel_id !== undefined) envelope['channel_id'] = transportMeta.channel_id
  if (transportMeta?.message_id !== undefined) envelope['message_id'] = transportMeta.message_id
  if (transportMeta?.sender_address !== undefined) {
    envelope['sender_address'] = transportMeta.sender_address
  }
  if (transportMeta?.recipient_address !== undefined) {
    envelope['recipient_address'] = transportMeta.recipient_address
  }
  if (depackageKeys !== undefined) envelope['depackage_keys'] = depackageKeys
  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      envelope[key] = value
    }
  }
  return envelope
}

async function postIngestOnce(
  baseUrl: string,
  timeoutMs: number,
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: Partial<TransportMetadata> | undefined,
  depackageKeys: DepackageKeys | undefined,
  extraFields?: Record<string, unknown>,
): Promise<PodIngestResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const envelope = buildIngestEnvelope(
    rawInput,
    sourceType,
    transportMeta,
    depackageKeys,
    extraFields,
  )
  const requestBody = JSON.stringify(envelope)

  let response: Response
  try {
    response = await fetch(`${baseUrl}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(requestBody, 'utf8')),
      },
      body: requestBody,
      signal: controller.signal,
    })
  } catch (fetchErr) {
    clearTimeout(timer)
    const err = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr))
    if (err.name === 'AbortError') {
      throw new PodTimeoutError(timeoutMs)
    }
    throw new PodConnectionError(`Pod connection failed: ${err.message}`, err)
  } finally {
    clearTimeout(timer)
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    throw new PodIngestHttpError(response.status, body)
  }

  return { status: response.status, body }
}
