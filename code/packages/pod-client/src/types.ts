/**
 * packages/pod-client/src/types.ts
 *
 * Public surface types for the pod-client package.
 *
 * Mirror types
 * ────────────
 * SourceType, TransportMetadata, and RawInput mirror the definitions in
 * @repo/ingestion-core/src/types.ts.  They are redefined here — not imported
 * — so that pod-client has zero runtime dependencies on ingestion-core and can
 * be used in any context (browser test harness, Electron renderer, etc.).
 *
 * Structural compatibility is enforced: if a call site already holds an
 * ingestion-core `RawInput`, it can be passed directly to `PodClient.ingest`
 * because the shapes are identical.
 *
 * Note: ingestion-core's RawInput.body accepts `string | Buffer`.  The pod
 * HTTP transport only accepts strings (buffers must be serialised to base64 by
 * the caller before passing).  Phase 1 callers always pass strings; this
 * constraint is documented via the type below.
 */

// ── Mirrored ingestion-core types ─────────────────────────────────────────────

export type SourceType =
  | 'email'
  | 'file_upload'
  | 'api'
  | 'extension'
  | 'internal'
  | 'p2p'
  | 'p2p_relay'
  | 'relay_pull'
  | 'coordination_service'
  | 'coordination_ws';

export interface TransportMetadata {
  readonly channel_id?: string;
  readonly message_id?: string;
  readonly sender_address?: string;
  readonly recipient_address?: string;
  readonly received_headers?: ReadonlyArray<string>;
  readonly mime_type?: string;
  readonly content_length?: number;
  readonly source_ip?: string;
}

/**
 * Raw message input for the pod ingestor.
 *
 * Structurally compatible with ingestion-core's RawInput.  The body field
 * here is restricted to string because the pod HTTP transport does not accept
 * binary buffers directly (callers must base64-encode them first).
 */
export interface RawInput {
  readonly body: string;
  readonly headers?: Record<string, string>;
  readonly mime_type?: string;
  readonly filename?: string;
}

// ── Pod client config & interface ─────────────────────────────────────────────

export interface PodClientConfig {
  /** Base URL of the ingestor container, e.g. 'http://127.0.0.1:18100'. */
  readonly baseUrl: string;
  /** Per-request wall-clock timeout in milliseconds. */
  readonly requestTimeoutMs: number;
}

export interface PodClient {
  /**
   * Send a raw message through the pod ingest pipeline.
   *
   * Resolves with a PodIngestResult on HTTP 2xx.
   * Rejects with PodIngestHttpError on HTTP 4xx/5xx.
   * Rejects with PodTimeoutError when the request exceeds requestTimeoutMs.
   * Rejects with PodConnectionError on network failures (retried once).
   */
  ingest(
    rawInput: RawInput,
    sourceType: SourceType,
    transportMeta?: Partial<TransportMetadata>,
  ): Promise<PodIngestResult>;
}

// ── Result & error types ──────────────────────────────────────────────────────

/** Successful response from the pod ingestor (HTTP 2xx). */
export interface PodIngestResult {
  /** HTTP status code (2xx). */
  readonly status: number;
  /** Parsed JSON body from the ingestor/validator pipeline. */
  readonly body: unknown;
}

/**
 * Thrown when the pod ingestor returns a non-2xx HTTP response.
 *
 * Retry policy: NOT retried (deterministic failure — malformed input, quota
 * exceeded, etc.).
 */
export class PodIngestHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Pod ingest HTTP error ${status}`)
    this.name = 'PodIngestHttpError'
    this.status = status
    this.body = body
  }
}

/**
 * Thrown when the per-request timeout fires before the response arrives.
 *
 * Retry policy: NOT retried — the timeout is absolute and indicates a
 * pod-side hang or resource exhaustion.
 */
export class PodTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Pod ingest timed out after ${timeoutMs}ms`)
    this.name = 'PodTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/**
 * Thrown when the network connection to the pod ingestor fails (ECONNREFUSED,
 * ECONNRESET, etc.) before an HTTP response is received.
 *
 * Retry policy: retried once (the pod may still be starting up).
 */
export class PodConnectionError extends Error {
  readonly cause: Error;

  constructor(message: string, cause: Error) {
    super(message)
    this.name = 'PodConnectionError'
    this.cause = cause
  }
}
