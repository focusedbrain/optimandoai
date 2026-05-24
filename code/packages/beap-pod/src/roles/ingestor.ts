/**
 * BEAP ingestor role container.
 *
 * External boundary of the pod.  Accepts POST /ingest from the Electron app,
 * calls ingestion-core's ingestInput(), then forwards the candidate capsule
 * envelope to the validator container over the pod-internal network.
 *
 * POD_MODE (read at startup):
 *   LOCAL_HOST    — Phase 1 path: ingest → validator → depackager → sealer
 *   LOCAL_VERIFY  — cert gate + full local validation + deep cert check + seal
 *   REMOTE_EDGE   — ingest → validator → depackager → certifier; return certificate
 *
 * Endpoints:
 *   POST /ingest  — external (no pod-auth; this is the pod's external boundary)
 *   GET  /health  — always 200 { status:'ok', role:'ingestor', version }
 *   GET  /ready   — 200 when upstream role(s) for this mode are ready
 *
 * The ingestor is the wall-clock owner for the whole pipeline.
 * It applies both the body-size gate and the pipeline timeout before a single
 * byte reaches ingestInput().
 *
 * Cert-is-a-gate rule (LOCAL_VERIFY):
 *   The certificate is a gate, NOT a substitute for validation.
 *   Shallow cert verify → validator ALWAYS runs → deep cert verify → seal.
 *   Never short-circuit validation because the cert verified.
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ingestInput, INGESTION_CONSTANTS } from '@repo/ingestion-core';
import type { RawInput, SourceType, TransportMetadata } from '@repo/ingestion-core';
import { requirePodAuthSecret, podAuthFetch } from '../shared/podAuth.js';
import {
  createRoleDiagnosticRuntime,
  healthResponseForRole,
  trackMessageProcessing,
  untrackMessageProcessing,
  wrapRoleRequestListener,
  type RoleDiagnosticRuntime,
} from '../shared/roleDiagnostic.js';
import { messageContextFromEnvelope } from '../shared/reportGenerator.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE = 'ingestor';
const DEFAULT_PORT = 18100;
const DEFAULT_VALIDATOR_BASE = 'http://127.0.0.1:18101';
const DEFAULT_SEALER_BASE = 'http://127.0.0.1:18103';
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

export type PodMode = 'LOCAL_HOST' | 'REMOTE_EDGE' | 'LOCAL_VERIFY';

/** Rejection when LOCAL_VERIFY receives a request without edge_certificate. */
export const CERT_MISSING = 'CERT_MISSING';

/** Edge certificate from a REMOTE_EDGE pod (LOCAL_VERIFY mode). */
export interface EdgeCertificateWire {
  v: number;
  package_hash: string;
  capsule_canonical_hash: string;
  validation_result_digest: string;
  edge_pod_id: string;
  expires_at: string;
  sso_attestation: string;
  edge_signature: string;
  [key: string]: unknown;
}

export interface VerifyMetadataWire {
  canonical_capsule_bytes_b64: string;
  canonical_validation_result_bytes_b64: string;
}

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
  channel_id?: string;
  message_id?: string;
  sender_address?: string;
  recipient_address?: string;
  depackage_keys?: {
    x25519_priv_b64: string;
    mlkem_secret_b64?: string;
  };
  /** LOCAL_VERIFY: edge certificate from REMOTE_EDGE certifier. */
  edge_certificate?: EdgeCertificateWire;
}

// ── Config (dependency-injectable for testing) ────────────────────────────────

export interface IngestorConfig {
  podMode?: PodMode;
  validatorBase?: string;
  verifierBase?: string;
  sealerBase?: string;
  version?: string;
  maxBodyBytes?: number;
  timeoutMs?: number;
  authedFetch?: typeof fetch;
  diagnostics?: RoleDiagnosticRuntime;
}

export function parsePodMode(value: string | undefined): PodMode {
  const mode = (value ?? 'LOCAL_HOST').trim();
  if (mode === 'LOCAL_VERIFY' || mode === 'REMOTE_EDGE' || mode === 'LOCAL_HOST') {
    return mode;
  }
  throw new Error(`Unknown POD_MODE: ${mode}. Ingestor refuses to start.`);
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

async function readBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<{ data: Buffer; tooLarge: boolean }> {
  const clHeader = req.headers['content-length'];
  if (clHeader !== undefined && Number(clHeader) > maxBytes) {
    req.resume();
    return { data: Buffer.alloc(0), tooLarge: true };
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const rawChunk of req) {
    const chunk = rawChunk as Buffer;
    total += chunk.length;
    if (total > maxBytes) {
      req.resume();
      return { data: Buffer.alloc(0), tooLarge: true };
    }
    chunks.push(chunk);
  }

  return { data: Buffer.concat(chunks), tooLarge: false };
}

interface VerifyCertResponse {
  ok?: boolean;
  reason?: string;
  edge_pod_id?: string;
  sub?: string;
}

async function callVerifyCert(
  authedFetch: typeof fetch,
  verifierBase: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
): Promise<VerifyCertResponse> {
  const verifyRes = await authedFetch(`${verifierBase}/verify-cert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  return (await verifyRes.json()) as VerifyCertResponse;
}

function certVerificationRejection(res: http.ServerResponse, reason: string, phase: 'shallow' | 'deep'): void {
  sendJson(res, 403, {
    error: phase === 'shallow' ? 'Certificate verification failed' : 'Certificate deep verification failed',
    verification_failed: true,
    reason,
  });
}

function localVerifyAllowsDirectP2p(): boolean {
  const v = process.env['LOCAL_VERIFY_ALLOW_DIRECT_P2P'];
  return v === '1' || v === 'true' || v === 'yes';
}

// ── Mode-specific ingest handlers ───────────────────────────────────────────

async function handleLocalHostIngest(
  authedFetch: typeof fetch,
  validatorBase: string,
  candidate: unknown,
  parsed: IngestRequestBody,
  res: http.ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const validatorRes = await authedFetch(`${validatorBase}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate,
      raw_package_bytes_b64: Buffer.from(parsed.body, 'utf8').toString('base64'),
      ...(parsed.depackage_keys ? { depackage_keys: parsed.depackage_keys } : {}),
    }),
    signal,
  });

  const responseText = await validatorRes.text();
  res.writeHead(validatorRes.status, { 'Content-Type': 'application/json' });
  res.end(responseText);
}

async function handleRemoteEdgeIngest(
  authedFetch: typeof fetch,
  validatorBase: string,
  candidate: unknown,
  parsed: IngestRequestBody,
  res: http.ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const validatorRes = await authedFetch(`${validatorBase}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate,
      raw_package_bytes_b64: Buffer.from(parsed.body, 'utf8').toString('base64'),
      ...(parsed.depackage_keys ? { depackage_keys: parsed.depackage_keys } : {}),
    }),
    signal,
  });

  const responseText = await validatorRes.text();
  if (!validatorRes.ok) {
    res.writeHead(validatorRes.status, { 'Content-Type': 'application/json' });
    res.end(responseText);
    return;
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    sendJson(res, 502, { error: 'Invalid validator response' });
    return;
  }

  sendJson(res, 200, {
    depackaged_payload: json['depackaged_payload'] ?? json['depackaged'],
    certificate: json['edge_certificate'] ?? json['certificate'],
  });
}

/**
 * LOCAL_VERIFY pipeline (P3.7):
 *   1. Shallow verify-cert (signature, SSO, expiry, pod_id, package_hash)
 *   2. Validator → depackager (seal deferred; returns verify_metadata)
 *   3. Deep verify-cert (capsule_canonical_hash + validation_result_digest)
 *   4. Sealer — only after both verifier OKs
 *
 * The cert is a gate, NOT a substitute for validation — step 2 always runs.
 */
async function handleLocalVerifyIngest(
  authedFetch: typeof fetch,
  validatorBase: string,
  verifierBase: string,
  sealerBase: string,
  candidate: unknown,
  parsed: IngestRequestBody,
  sourceType: SourceType,
  res: http.ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  if (!parsed.edge_certificate) {
    if (localVerifyAllowsDirectP2p() && sourceType === 'p2p') {
      await handleLocalHostIngest(
        authedFetch,
        validatorBase,
        candidate,
        parsed,
        res,
        signal,
      );
      return;
    }
    sendJson(res, 403, {
      error: 'Certificate required for LOCAL_VERIFY ingest',
      verification_failed: true,
      reason: CERT_MISSING,
    });
    return;
  }

  const rawPackageBytesB64 = Buffer.from(parsed.body, 'utf8').toString('base64');
  const cert = parsed.edge_certificate;

  // ① Shallow verify — no expected_capsule_canonical_bytes yet.
  const shallow = await callVerifyCert(
    authedFetch,
    verifierBase,
    { raw_package_bytes_b64: rawPackageBytesB64, certificate: cert },
    signal,
  );
  if (!shallow.ok) {
    certVerificationRejection(res, shallow.reason ?? 'UNKNOWN', 'shallow');
    return;
  }

  // ② Full local validation — cert verified does NOT skip this step.
  const validatorRes = await authedFetch(`${validatorBase}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidate,
      raw_package_bytes_b64: rawPackageBytesB64,
      ...(parsed.depackage_keys ? { depackage_keys: parsed.depackage_keys } : {}),
    }),
    signal,
  });

  const validatorText = await validatorRes.text();
  if (!validatorRes.ok) {
    res.writeHead(validatorRes.status, { 'Content-Type': 'application/json' });
    res.end(validatorText);
    return;
  }

  let validatorJson: Record<string, unknown>;
  try {
    validatorJson = JSON.parse(validatorText) as Record<string, unknown>;
  } catch {
    sendJson(res, 502, { error: 'Invalid validator response' });
    return;
  }

  const verifyMetadata = validatorJson['verify_metadata'] as VerifyMetadataWire | undefined;
  if (!verifyMetadata?.canonical_capsule_bytes_b64 || !verifyMetadata?.canonical_validation_result_bytes_b64) {
    sendJson(res, 502, { error: 'Validator did not return verify_metadata for LOCAL_VERIFY' });
    return;
  }

  // ③ Deep verify — bind cert to local validator output.
  const deep = await callVerifyCert(
    authedFetch,
    verifierBase,
    {
      raw_package_bytes_b64: rawPackageBytesB64,
      certificate: cert,
      expected_capsule_canonical_bytes_b64: verifyMetadata.canonical_capsule_bytes_b64,
      expected_validation_result_bytes_b64: verifyMetadata.canonical_validation_result_bytes_b64,
    },
    signal,
  );
  if (!deep.ok) {
    certVerificationRejection(res, deep.reason ?? 'UNKNOWN', 'deep');
    return;
  }

  // ④ Seal only after shallow + deep verifier OKs.
  const depackagedForSeal = validatorJson['depackaged_for_seal'] ?? validatorJson['depackaged'];
  const sealerRes = await authedFetch(`${sealerBase}/seal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ depackaged: depackagedForSeal }),
    signal,
  });

  if (!sealerRes.ok) {
    sendJson(res, 502, { error: 'Sealer error after certificate verification' });
    return;
  }

  const sealJson = (await sealerRes.json()) as Record<string, unknown>;
  sendJson(res, 200, {
    sealed: sealJson['sealed'] ?? true,
    seal: sealJson['seal'],
    rowId: sealJson['rowId'],
  });
}

// ── Request handler ───────────────────────────────────────────────────────────

function makeHandler(
  authedFetch: typeof fetch,
  podMode: PodMode,
  validatorBase: string,
  verifierBase: string | undefined,
  sealerBase: string,
  version: string,
  maxBodyBytes: number,
  timeoutMs: number,
  diagnostics: RoleDiagnosticRuntime,
): http.RequestListener {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    if (req.method === 'GET' && path === '/health') {
      const health = healthResponseForRole(diagnostics, version, { pod_mode: podMode });
      sendJson(res, health.statusCode, health.body);
      return;
    }

    if (req.method === 'GET' && path === '/ready') {
      try {
        if (podMode === 'LOCAL_VERIFY' && verifierBase) {
          const vr = await authedFetch(`${verifierBase}/ready`);
          if (!vr.ok) {
            sendJson(res, 503, { status: 'not_ready', role: ROLE, reason: 'verifier_not_ready' });
            return;
          }
        }
        const r = await authedFetch(`${validatorBase}/ready`);
        if (r.ok) {
          sendJson(res, 200, { status: 'ready', role: ROLE, pod_mode: podMode });
        } else {
          sendJson(res, 503, { status: 'not_ready', role: ROLE, reason: 'validator_not_ready' });
        }
      } catch {
        sendJson(res, 503, { status: 'not_ready', role: ROLE, reason: 'validator_unreachable' });
      }
      return;
    }

    if (req.method === 'POST' && path === '/ingest') {
      const { data, tooLarge } = await readBody(req, maxBodyBytes);
      if (tooLarge) {
        res.writeHead(413, {
          'Content-Type': 'application/json',
          'Connection': 'close',
        });
        res.end(JSON.stringify({ error: 'Payload too large', limit_bytes: maxBodyBytes }));
        return;
      }

      const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (ct !== 'application/json' && ct !== 'application/vnd.beap+json') {
        sendJson(res, 415, {
          error: 'Content-Type must be application/json or application/vnd.beap+json',
        });
        return;
      }

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

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        trackMessageProcessing(
          messageContextFromEnvelope({
            rawBytes: data,
            envelopeFrom: parsed.sender_address ?? '',
            envelopeTo: parsed.recipient_address ?? '',
            envelopeDate: new Date().toISOString(),
            envelopeSubject: parsed.message_id ?? '',
          }),
        );
        const candidate = ingestInput(rawInput, sourceType, transportMeta);

        if (podMode === 'LOCAL_VERIFY') {
          if (!verifierBase) {
            sendJson(res, 503, { error: 'LOCAL_VERIFY mode requires VERIFIER_BASE' });
            return;
          }
          await handleLocalVerifyIngest(
            authedFetch,
            validatorBase,
            verifierBase,
            sealerBase,
            candidate,
            parsed,
            sourceType,
            res,
            controller.signal,
          );
        } else if (podMode === 'REMOTE_EDGE') {
          await handleRemoteEdgeIngest(
            authedFetch,
            validatorBase,
            candidate,
            parsed,
            res,
            controller.signal,
          );
        } else {
          await handleLocalHostIngest(
            authedFetch,
            validatorBase,
            candidate,
            parsed,
            res,
            controller.signal,
          );
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          sendJson(res, 504, { error: 'Pipeline timeout', timeout_ms: timeoutMs });
        } else {
          sendJson(res, 502, { error: 'Upstream validator error' });
        }
      } finally {
        untrackMessageProcessing();
        clearTimeout(timer);
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createIngestorServer(secret: string, config?: IngestorConfig): http.Server {
  const podMode = config?.podMode ?? parsePodMode(process.env['POD_MODE']);
  const validatorBase = config?.validatorBase ?? DEFAULT_VALIDATOR_BASE;
  const verifierBase =
    config?.verifierBase ??
    (podMode === 'LOCAL_VERIFY' ? process.env['VERIFIER_BASE'] : undefined);
  const sealerBase = config?.sealerBase ?? process.env['SEALER_BASE'] ?? DEFAULT_SEALER_BASE;
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES;
  const timeoutMs = config?.timeoutMs ?? INGESTION_CONSTANTS.PIPELINE_TIMEOUT_MS;
  const authedFetch = config?.authedFetch ?? podAuthFetch(secret);
  const diagnostics = config?.diagnostics ?? createRoleDiagnosticRuntime(ROLE);

  return http.createServer(
    wrapRoleRequestListener(
      diagnostics,
      makeHandler(
        authedFetch,
        podMode,
        validatorBase,
        verifierBase,
        sealerBase,
        version,
        maxBodyBytes,
        timeoutMs,
        diagnostics,
      ),
    ),
  );
}

/** Start the ingestor server, reading POD_MODE / PORT / POD_AUTH_SECRET from env. */
export function startIngestorServer(): void {
  const secret = requirePodAuthSecret();
  let podMode: PodMode;
  try {
    podMode = parsePodMode(process.env['POD_MODE']);
  } catch (e) {
    console.error(`[${ROLE}] FATAL: ${(e as Error).message}`);
    process.exit(1);
  }

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['INGESTOR_HOST'] ?? '127.0.0.1';
  const server = createIngestorServer(secret, { podMode });

  server.listen(port, host, () => {
    console.log(
      `role: ${ROLE} listening on ${host}:${port} (version ${VERSION}, mode ${podMode})`,
    );
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

