/**
 * BEAP ingestor role container.
 *
 * External boundary of the pod.  Accepts POST /ingest from the Electron app,
 * calls ingestion-core's ingestInput(), then forwards the candidate capsule
 * envelope to the validator container over the pod-internal network.
 *
 * Endpoints:
 *   POST /ingest  — external (no pod-auth; this is the pod's external boundary)
 *   GET  /health  — always 200 { status:'ok', role:'ingestor', version }
 *   GET  /ready   — 200 only when validator /ready returns 200
 *
 * The ingestor is the wall-clock owner for the whole pipeline.
 * It applies both the body-size gate and the pipeline timeout before a single
 * byte reaches ingestInput().
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ingestInput, INGESTION_CONSTANTS } from '@repo/ingestion-core';
import type { RawInput, SourceType, TransportMetadata } from '@repo/ingestion-core';
import { requirePodAuthSecret, podAuthFetch } from '../shared/podAuth.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE = 'ingestor';
const DEFAULT_PORT = 18100;
const DEFAULT_VALIDATOR_BASE = 'http://127.0.0.1:18101';
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

// ── Wire types ────────────────────────────────────────────────────────────────

/** JSON envelope expected in POST /ingest body. */
interface IngestRequestBody {
  /** The raw message content (string; binary should be base64-encoded). */
  body: string;
  source_type?: SourceType;
  mime_type?: string;
  filename?: string;
  /** Forwarded to RawInput.headers (transport-level headers). */
  headers?: Record<string, string>;
  // TransportMetadata overlay
  channel_id?: string;
  message_id?: string;
  sender_address?: string;
  recipient_address?: string;
  /**
   * Optional per-request qBEAP decryption keys.
   * Provided by Electron when the package is qBEAP-encrypted;
   * forwarded verbatim to the validator → depackager pipeline.
   */
  depackage_keys?: {
    x25519_priv_b64: string;
    mlkem_secret_b64?: string;
  };
}

// ── Config (dependency-injectable for testing) ────────────────────────────────

export interface IngestorConfig {
  validatorBase?: string;
  version?: string;
  /**
   * Body-size limit in bytes applied at the HTTP layer, before ingestInput().
   * Defaults to INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES (15 MB).
   */
  maxBodyBytes?: number;
  /**
   * Wall-clock timeout in ms for the full ingest→validate pipeline.
   * Defaults to INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS (10 s).
   */
  timeoutMs?: number;
  /**
   * Fetch function with pod-auth headers already applied.
   * Defaults to podAuthFetch(secret).
   * Inject a vi.fn() mock in tests.
   */
  authedFetch?: typeof fetch;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/**
 * Stream-read the request body up to maxBytes.
 *
 * Fast-path: if Content-Length header > maxBytes, rejects immediately without
 * reading the body.  Streaming path: counts bytes as they arrive and stops
 * once the limit is exceeded.
 *
 * Returns { tooLarge: true } when the limit is exceeded; the caller MUST send
 * a 413 response to close the connection.
 */
async function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<{ data: Buffer; tooLarge: boolean }> {
  const clHeader = req.headers['content-length'];
  if (clHeader !== undefined && Number(clHeader) > maxBytes) {
    req.resume(); // drain so the socket stays reusable
    return { data: Buffer.alloc(0), tooLarge: true };
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const rawChunk of req) {
    const chunk = rawChunk as Buffer;
    total += chunk.length;
    if (total > maxBytes) {
      req.resume(); // discard any remaining data
      return { data: Buffer.alloc(0), tooLarge: true };
    }
    chunks.push(chunk);
  }

  return { data: Buffer.concat(chunks), tooLarge: false };
}

// ── Request handler ───────────────────────────────────────────────────────────

function makeHandler(
  authedFetch: typeof fetch,
  validatorBase: string,
  version: string,
  maxBodyBytes: number,
  timeoutMs: number,
): http.RequestListener {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    // ── GET /health ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok', role: ROLE, version });
      return;
    }

    // ── GET /ready ───────────────────────────────────────────────────────────
    // 200 only when the validator container is also ready.
    if (req.method === 'GET' && path === '/ready') {
      try {
        const r = await authedFetch(`${validatorBase}/ready`);
        if (r.ok) {
          sendJson(res, 200, { status: 'ready', role: ROLE });
        } else {
          sendJson(res, 503, { status: 'not_ready', role: ROLE, reason: 'validator_not_ready' });
        }
      } catch {
        sendJson(res, 503, { status: 'not_ready', role: ROLE, reason: 'validator_unreachable' });
      }
      return;
    }

    // ── POST /ingest ─────────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/ingest') {
      // ① Size gate — must happen before ingestInput() (test: "413 before ingestInput")
      const { data, tooLarge } = await readBody(req, maxBodyBytes);
      if (tooLarge) {
        res.writeHead(413, {
          'Content-Type': 'application/json',
          'Connection': 'close', // avoids 4 s wait when Content-Length ≠ bytes sent
        });
        res.end(JSON.stringify({ error: 'Payload too large', limit_bytes: maxBodyBytes }));
        return;
      }

      // ② Content-Type
      const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (ct !== 'application/json' && ct !== 'application/vnd.beap+json') {
        sendJson(res, 415, {
          error: 'Content-Type must be application/json or application/vnd.beap+json',
        });
        return;
      }

      // ③ Parse request envelope
      let parsed: IngestRequestBody;
      try {
        parsed = JSON.parse(data.toString('utf8')) as IngestRequestBody;
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      if (typeof parsed.body !== 'string') {
        sendJson(res, 400, { error: 'Missing or invalid "body" field in request' });
        return;
      }

      const rawInput: RawInput = {
        body: parsed.body,
        headers: parsed.headers,
        mime_type: parsed.mime_type,
        filename: parsed.filename,
      };

      const sourceType: SourceType = parsed.source_type ?? 'api';
      const transportMeta: Partial<TransportMetadata> = {
        channel_id: parsed.channel_id,
        message_id: parsed.message_id,
        sender_address: parsed.sender_address,
        recipient_address: parsed.recipient_address,
      };

      // ④ Pipeline with wall-clock timeout
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // ingestInput is synchronous — produce the CandidateCapsuleEnvelope
        const candidate = ingestInput(rawInput, sourceType, transportMeta);

        // ⑤ Forward to validator; relay the response status + body verbatim
        const validatorRes = await authedFetch(`${validatorBase}/validate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidate,
            raw_package_bytes_b64: Buffer.from(parsed.body, 'utf8').toString('base64'),
            ...(parsed.depackage_keys ? { depackage_keys: parsed.depackage_keys } : {}),
          }),
          signal: controller.signal,
        });

        const responseText = await validatorRes.text();
        res.writeHead(validatorRes.status, { 'Content-Type': 'application/json' });
        res.end(responseText);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          sendJson(res, 504, { error: 'Pipeline timeout', timeout_ms: timeoutMs });
        } else {
          // Never expose internal error details to the external caller
          sendJson(res, 502, { error: 'Upstream validator error' });
        }
      } finally {
        clearTimeout(timer);
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create an ingestor HTTP server.
 *
 * @param secret  Inter-container shared secret (value of POD_AUTH_SECRET).
 * @param config  Optional overrides.  Use in tests to inject mocks.
 */
export function createIngestorServer(secret: string, config?: IngestorConfig): http.Server {
  const validatorBase = config?.validatorBase ?? DEFAULT_VALIDATOR_BASE;
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES;
  const timeoutMs = config?.timeoutMs ?? INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS;
  const authedFetch = config?.authedFetch ?? podAuthFetch(secret);

  return http.createServer(
    makeHandler(authedFetch, validatorBase, version, maxBodyBytes, timeoutMs),
  );
}

/** Start the ingestor server, reading PORT / INGESTOR_HOST / POD_AUTH_SECRET from env. */
export function startIngestorServer(): void {
  const secret = requirePodAuthSecret();
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['INGESTOR_HOST'] ?? '127.0.0.1';
  const server = createIngestorServer(secret);

  server.listen(port, host, () => {
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${VERSION})`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    server.close(() => process.exit(0));
  });
}

// ── Entrypoint detection ──────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/ingestor.js')) {
  startIngestorServer();
}
