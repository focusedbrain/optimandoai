/**
 * @repo/pod-client
 *
 * Thin HTTP client for the BEAP pod ingestor.
 *
 * Usage:
 *   import { createPodClient } from '@repo/pod-client'
 *   const client = createPodClient({ baseUrl: 'http://127.0.0.1:18100', requestTimeoutMs: 12_000 })
 *   const result = await client.ingest(rawInput, 'email', { message_id: '...' })
 */

export { createPodClient } from './client.js'

export type {
  PodClientConfig,
  PodClient,
  PodIngestResult,
  RawInput,
  SourceType,
  TransportMetadata,
} from './types.js'

export { PodIngestHttpError, PodTimeoutError, PodConnectionError } from './types.js'
