/**
 * packages/pod-client/src/client.ts
 *
 * Thin HTTP client for the BEAP pod ingestor (POST /ingest).
 *
 * Retry policy
 * ────────────
 * Connection errors (ECONNREFUSED, ECONNRESET, etc.) are retried once.  This
 * handles the window where startLocalPod() is called and the pod containers
 * are still reaching ready state.
 *
 * Timeout errors and HTTP errors (4xx, 5xx) are NOT retried.
 *
 * Secrets / auth
 * ──────────────
 * The ingestor's POST /ingest endpoint is the pod's external boundary and
 * does NOT require X-Pod-Auth.  Only the internal container-to-container
 * endpoints use pod-auth.  This client sends no auth header.
 */

import type {
  PodClientConfig,
  PodClient,
  RawInput,
  SourceType,
  TransportMetadata,
  PodIngestResult,
} from './types.js'
import { PodIngestHttpError, PodTimeoutError, PodConnectionError } from './types.js'

/** Maximum number of retry attempts on connection error (0 = one attempt, 1 = one retry). */
const MAX_RETRIES = 1

/**
 * Create a PodClient configured with the given base URL and per-request timeout.
 *
 * @example
 * const client = createPodClient({
 *   baseUrl: 'http://127.0.0.1:18100',
 *   requestTimeoutMs: 12_000,
 * })
 */
export function createPodClient(config: PodClientConfig): PodClient {
  const { baseUrl, requestTimeoutMs } = config

  return {
    ingest(
      rawInput: RawInput,
      sourceType: SourceType,
      transportMeta?: Partial<TransportMetadata>,
    ): Promise<PodIngestResult> {
      return ingestWithRetry(baseUrl, requestTimeoutMs, rawInput, sourceType, transportMeta, 0)
    },
  }
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────

async function ingestWithRetry(
  baseUrl: string,
  timeoutMs: number,
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: Partial<TransportMetadata> | undefined,
  attempt: number,
): Promise<PodIngestResult> {
  try {
    return await ingestOnce(baseUrl, timeoutMs, rawInput, sourceType, transportMeta)
  } catch (err) {
    // 4xx / 5xx → never retry
    if (err instanceof PodIngestHttpError) throw err
    // Timeout → never retry (absolute wall-clock limit)
    if (err instanceof PodTimeoutError) throw err
    // Connection error → retry once
    if (err instanceof PodConnectionError && attempt < MAX_RETRIES) {
      return ingestWithRetry(
        baseUrl,
        timeoutMs,
        rawInput,
        sourceType,
        transportMeta,
        attempt + 1,
      )
    }
    throw err
  }
}

// ── Single attempt ────────────────────────────────────────────────────────────

async function ingestOnce(
  baseUrl: string,
  timeoutMs: number,
  rawInput: RawInput,
  sourceType: SourceType,
  transportMeta: Partial<TransportMetadata> | undefined,
): Promise<PodIngestResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  // Build the request envelope expected by IngestRequestBody (ingestor.ts)
  const envelope: Record<string, unknown> = {
    body: rawInput.body,
    source_type: sourceType,
  }
  if (rawInput.mime_type !== undefined) envelope['mime_type'] = rawInput.mime_type
  if (rawInput.filename !== undefined) envelope['filename'] = rawInput.filename
  if (rawInput.headers !== undefined) envelope['headers'] = rawInput.headers
  if (transportMeta?.channel_id !== undefined) envelope['channel_id'] = transportMeta.channel_id
  if (transportMeta?.message_id !== undefined) envelope['message_id'] = transportMeta.message_id
  if (transportMeta?.sender_address !== undefined) envelope['sender_address'] = transportMeta.sender_address
  if (transportMeta?.recipient_address !== undefined) envelope['recipient_address'] = transportMeta.recipient_address

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

  // Parse response body — treat parse failures as null body (not fatal)
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
