/**
 * BEAP validator role container.
 *
 * Responsibilities (P1.4):
 *   - Accept POST /validate from the ingestor (X-Pod-Auth required).
 *   - Enforce ALLOWED_CONTENT_TYPES on transport MIME type (audit gap closed here).
 *   - Enforce MAX_STRING_LENGTH on the candidate payload (audit gap closed here).
 *   - Run structural validation via ingestion-core validateCapsule().
 *   - Forward message_package capsules to the depackager at :18102/depackage.
 *   - Return validation result to the ingestor.
 *
 * Port:  127.0.0.1:18101  (or PORT env var)
 * Trust: X-Pod-Auth header validated via createPodAuthMiddleware.
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  validateCapsule,
  findOversizedString,
  INGESTION_CONSTANTS,
} from '@repo/ingestion-core';
import type {
  CandidateCapsuleEnvelope,
  ValidationReasonCode,
} from '@repo/ingestion-core';
import {
  requirePodAuthSecret,
  createPodAuthMiddleware,
  podAuthFetch,
} from '../shared/podAuth.js';
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

const ROLE = 'validator';
const DEFAULT_PORT = 18101;
const DEFAULT_DEPACKAGER_BASE = 'http://127.0.0.1:18102';
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

// ── Config (dependency-injectable for testing) ────────────────────────────────

export interface ValidatorConfig {
  depackagerBase?: string;
  version?: string;
  maxBodyBytes?: number;
  maxStringLength?: number;
  authedFetch?: typeof fetch;
  diagnostics?: RoleDiagnosticRuntime;
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

// ── Rejection helpers ─────────────────────────────────────────────────────────

function rejectValidation(
  res: http.ServerResponse,
  reason: ValidationReasonCode,
  details: string,
): void {
  sendJson(res, 422, { valid: false, reason, details });
}

// ── Request handler ───────────────────────────────────────────────────────────

function makeHandler(
  secret: string,
  authedFetch: typeof fetch,
  depackagerBase: string,
  version: string,
  maxBodyBytes: number,
  maxStringLength: number,
  diagnostics: RoleDiagnosticRuntime,
): http.RequestListener {
  const authMiddleware = createPodAuthMiddleware(secret);

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    // ── GET /health ──────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      const health = healthResponseForRole(diagnostics, version);
      sendJson(res, health.statusCode, health.body);
      return;
    }

    // ── GET /ready ───────────────────────────────────────────────────────────
    // Validator has no external upstream dependencies for its primary job.
    if (req.method === 'GET' && path === '/ready') {
      sendJson(res, 200, { status: 'ready', role: ROLE });
      return;
    }

    // ── POST /validate ───────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/validate') {
      // ① Pod-auth gate
      // next() → resolve(true); 401 sent → finish fires → resolve(false).
      const authPassed = await new Promise<boolean>((resolve) => {
        const onFinish = () => resolve(false);
        res.once('finish', onFinish);
        authMiddleware(req, res, () => {
          res.removeListener('finish', onFinish);
          resolve(true);
        });
      });
      if (!authPassed) return;

      // ② Size gate
      const { data, tooLarge } = await readBody(req, maxBodyBytes);
      if (tooLarge) {
        res.writeHead(413, {
          'Content-Type': 'application/json',
          'Connection': 'close',
        });
        res.end(JSON.stringify({ error: 'Payload too large', limit_bytes: maxBodyBytes }));
        return;
      }

      // ③ Parse envelope
      let parsed: {
        candidate: unknown;
        depackage_keys?: { x25519_priv_b64: string; mlkem_secret_b64?: string };
        raw_package_bytes_b64?: string;
      };
      try {
        parsed = JSON.parse(data.toString('utf8')) as typeof parsed;
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const candidate = parsed.candidate as CandidateCapsuleEnvelope;
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        (candidate as unknown as Record<string, unknown>)['__brand'] !== 'CandidateCapsule'
      ) {
        sendJson(res, 400, { error: 'Missing or invalid "candidate" field — expected CandidateCapsuleEnvelope' });
        return;
      }

      // ④ ALLOWED_CONTENT_TYPES enforcement (strategy §1.3 — canonical rules in validator)
      const rawMime = candidate.provenance.transport_metadata.mime_type;
      if (typeof rawMime === 'string' && rawMime.length > 0) {
        const normalizedMime = rawMime.split(';')[0]!.trim().toLowerCase();
        const allowed = INGESTION_CONSTANTS.ALLOWED_CONTENT_TYPES.map((t) => t.toLowerCase());
        if (!allowed.includes(normalizedMime)) {
          rejectValidation(
            res,
            'CONTENT_TYPE_NOT_ALLOWED',
            `MIME type '${normalizedMime}' is not in the allowed list`,
          );
          return;
        }
      }

      // ⑤ MAX_STRING_LENGTH enforcement — walks raw_payload recursively
      if (candidate.raw_payload !== null && candidate.raw_payload !== undefined) {
        const violation = findOversizedString(candidate.raw_payload, maxStringLength);
        if (violation) {
          rejectValidation(
            res,
            'PAYLOAD_STRING_TOO_LONG',
            `String at path ${violation.path} exceeds limit ${maxStringLength}: ${violation.length} chars`,
          );
          return;
        }
      }

      // ⑥ Structural validation
      trackMessageProcessing(
        messageContextFromEnvelope({
          rawBytes: data,
          envelopeFrom: candidate.provenance.transport_metadata.sender_address ?? '',
          envelopeTo: candidate.provenance.transport_metadata.recipient_address ?? '',
          envelopeDate: candidate.provenance.ingested_at,
          envelopeSubject: candidate.provenance.transport_metadata.message_id ?? '',
        }),
      );
      let result;
      try {
        result = validateCapsule(candidate);
      } finally {
        untrackMessageProcessing();
      }

      if (!result.success) {
        rejectValidation(res, result.reason, result.details);
        return;
      }

      const validated = result.validated;

      // ⑦ Route: message_package capsules require depackaging
      if (validated.capsule.capsule_type === 'message_package') {
        try {
          const depackageRes = await authedFetch(`${depackagerBase}/depackage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              validated,
              ...(parsed.raw_package_bytes_b64
                ? { raw_package_bytes_b64: parsed.raw_package_bytes_b64 }
                : {}),
              ...(parsed.depackage_keys ? { depackage_keys: parsed.depackage_keys } : {}),
            }),
          });
          const depackageText = await depackageRes.text();
          res.writeHead(depackageRes.status, { 'Content-Type': 'application/json' });
          res.end(depackageText);
        } catch {
          sendJson(res, 502, { error: 'Depackager unreachable' });
        }
        return;
      }

      // ⑧ Handshake / internal_draft capsule — return directly
      sendJson(res, 200, {
        valid: true,
        needs_depackaging: false,
        validated,
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createValidatorServer(secret: string, config?: ValidatorConfig): http.Server {
  const depackagerBase = config?.depackagerBase ?? DEFAULT_DEPACKAGER_BASE;
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? INGESTION_CONSTANTS.MAX_RAW_INPUT_BYTES;
  const maxStringLength = config?.maxStringLength ?? INGESTION_CONSTANTS.MAX_STRING_LENGTH;
  const authedFetch = config?.authedFetch ?? podAuthFetch(secret);
  const diagnostics = config?.diagnostics ?? createRoleDiagnosticRuntime(ROLE);

  return http.createServer(
    wrapRoleRequestListener(
      diagnostics,
      makeHandler(
        secret,
        authedFetch,
        depackagerBase,
        version,
        maxBodyBytes,
        maxStringLength,
        diagnostics,
      ),
    ),
  );
}

export function startValidatorServer(): void {
  const secret = requirePodAuthSecret();
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['VALIDATOR_HOST'] ?? '127.0.0.1';
  const server = createValidatorServer(secret);

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
if (_entry === __filename || process.argv[1]?.endsWith('roles/validator.js')) {
  startValidatorServer();
}
