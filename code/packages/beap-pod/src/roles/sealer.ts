/**
 * BEAP sealer role container.
 *
 * Responsibilities (P1.6):
 *   – Accept POST /seal from the depackager container (X-Pod-Auth required).
 *   – Compute HMAC-SHA256 seal over depackaged content.
 *   – Return { seal, sealInputJson, rowId }.
 *
 * Security properties (Canon §10, Phase B §2.1):
 *   – SEAL_KEY_HEX env var is read ONCE at startup, decoded to Buffer, then
 *     the env var is immediately overwritten with zeros and deleted.
 *   – The key is NEVER logged, NEVER written to disk, NEVER sent over network.
 *   – No outbound network calls — this role has no fetch/http client code.
 *   – Process exits with code 1 if SEAL_KEY_HEX is missing or invalid.
 *   – Seal verification uses constant-time comparison (timingSafeEqual).
 *
 * Seal algorithm is byte-identical to computeSeal() in:
 *   apps/electron-vite-project/electron/main/validator-process/index.ts
 * Do NOT modify the algorithm here without updating the above, and vice versa.
 *
 * Port:  127.0.0.1:18103  (or PORT env var)
 * Trust: X-Pod-Auth header validated via createPodAuthMiddleware.
 */

import http from 'node:http';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { requirePodAuthSecret, createPodAuthMiddleware } from '../shared/podAuth.js';
import {
  createRoleDiagnosticRuntime,
  healthResponseForRole,
  trackMessageProcessing,
  untrackMessageProcessing,
  wrapRoleRequestListener,
  type RoleDiagnosticRuntime,
} from '../shared/roleDiagnostic.js';
import { messageContextFromEnvelope } from '../shared/reportGenerator.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE = 'sealer';
const DEFAULT_PORT = 18103;
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024; // 32 MB
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

// ── Seal key validation and loading ───────────────────────────────────────────

/**
 * Parse and validate a hex-encoded HMAC seal key.
 *
 * Exported so unit tests can assert on error messages without forking a process.
 * Production code uses this via startSealerServer(), which catches the error and
 * calls process.exit(1).
 *
 * Requirements:
 *   – Must be a valid hex string (even length, only [0-9a-fA-F]).
 *   – Must encode at least 32 bytes (64 hex chars) for a 256-bit HMAC key.
 */
export function parseSealKeyHex(hex: string | undefined): Buffer {
  if (!hex || hex.trim().length === 0) {
    throw new Error(
      'SEAL_KEY_HEX environment variable is not set or is empty. Sealer refuses to start.',
    );
  }
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error(
      'SEAL_KEY_HEX contains non-hex characters. Sealer refuses to start.',
    );
  }
  if (trimmed.length % 2 !== 0) {
    throw new Error(
      'SEAL_KEY_HEX has odd length. Sealer refuses to start.',
    );
  }
  if (trimmed.length < 64) {
    throw new Error(
      `SEAL_KEY_HEX is too short (${trimmed.length / 2} bytes; minimum 32 bytes / 64 hex chars). Sealer refuses to start.`,
    );
  }
  return Buffer.from(trimmed, 'hex');
}

// ── Seal computation ───────────────────────────────────────────────────────────
//
// Algorithm is byte-identical to computeSeal() in:
//   apps/electron-vite-project/electron/main/validator-process/index.ts
//
// Seal input JSON field order MUST match exactly (JSON.stringify preserves insertion order):
//   { content_sha256, nonce, row_id, outcome_class, validator_version, validated_at }

/**
 * Compute an HMAC-SHA256 seal over the given content.
 *
 * Exported for unit tests so they can verify byte-identity against
 * computeSealForTest() in validator-process/index.ts.
 */
export function computeSealPod(
  canonicalJson: string,
  rowId: string,
  outcomeClass: 'validated' | 'rejected',
  validatorVersion: string,
  validatedAt: string,
  key: Buffer,
): { seal: string; sealInputJson: string } {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  // Fresh nonce per invocation (replay resistance — Canon §10 / Architecture L5).
  const nonce = randomBytes(32).toString('base64');

  // Key insertion order must be stable — matches computeSeal() exactly.
  const sealInput = {
    content_sha256: contentSha256,
    nonce,
    row_id: rowId,
    outcome_class: outcomeClass,
    validator_version: validatorVersion,
    validated_at: validatedAt,
  };

  const sealInputJson = JSON.stringify(sealInput);
  const seal = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64');
  return { seal, sealInputJson };
}

/**
 * Verify a seal against a known key (constant-time).
 * Mirrors verifySeal() in validator-process/index.ts.
 */
export function verifySealPod(sealInputJson: string, expectedSeal: string, key: Buffer): boolean {
  const recomputed = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64');
  const a = Buffer.from(recomputed, 'base64');
  const b = Buffer.from(expectedSeal, 'base64');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface SealerConfig {
  version?: string;
  maxBodyBytes?: number;
  diagnostics?: RoleDiagnosticRuntime;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>): void {
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
    if (total > maxBytes) { req.resume(); return { data: Buffer.alloc(0), tooLarge: true }; }
    chunks.push(chunk);
  }
  return { data: Buffer.concat(chunks), tooLarge: false };
}

// ── Request handler ────────────────────────────────────────────────────────────

function makeHandler(
  secret: string,
  sealKey: Buffer,
  version: string,
  maxBodyBytes: number,
  diagnostics: RoleDiagnosticRuntime,
): http.RequestListener {
  const authMiddleware = createPodAuthMiddleware(secret);

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    // ── GET /health ────────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      const health = healthResponseForRole(diagnostics, version);
      sendJson(res, health.statusCode, health.body);
      return;
    }

    // ── GET /ready ─────────────────────────────────────────────────────────────
    // If the server started, the key was loaded — always ready.
    if (req.method === 'GET' && path === '/ready') {
      sendJson(res, 200, { status: 'ready', role: ROLE });
      return;
    }

    // ── POST /seal ─────────────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/seal') {
      // ① Pod-auth gate
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
        res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
        res.end(JSON.stringify({ error: 'Payload too large', limit_bytes: maxBodyBytes }));
        return;
      }

      // ③ Parse
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const depackaged = body['depackaged'] as Record<string, unknown> | undefined;

      // ④ Extract canonicalJson
      // Prefer explicit canonicalJson field; fall back to depackaged.rawCapsuleJson.
      let canonicalJson: string | undefined;
      if (typeof body['canonicalJson'] === 'string') {
        canonicalJson = body['canonicalJson'];
      } else if (depackaged && typeof depackaged['rawCapsuleJson'] === 'string') {
        canonicalJson = depackaged['rawCapsuleJson'];
      }
      if (canonicalJson === undefined) {
        sendJson(res, 400, {
          error: 'Missing canonicalJson or depackaged.rawCapsuleJson in request body',
        });
        return;
      }

      // ⑤ Extract optional seal metadata (defaults mirror computeSeal() callers)
      const rowId =
        typeof body['rowId'] === 'string' && body['rowId'].length > 0
          ? body['rowId']
          : randomUUID();

      const rawOutcome = body['outcomeClass'];
      const outcomeClass: 'validated' | 'rejected' =
        rawOutcome === 'rejected' ? 'rejected' : 'validated';

      const validatorVersion =
        typeof body['validatorVersion'] === 'string' && body['validatorVersion'].length > 0
          ? body['validatorVersion']
          : version;

      const validatedAt =
        typeof body['validatedAt'] === 'string' && body['validatedAt'].length > 0
          ? body['validatedAt']
          : new Date().toISOString();

      // ⑥ Compute seal (key is in memory; never leaves this function scope)
      trackMessageProcessing(
        messageContextFromEnvelope({
          rawBytes: Buffer.from(canonicalJson, 'utf8'),
          envelopeSubject: typeof depackaged?.['subject'] === 'string' ? depackaged['subject'] : '',
        }),
      );
      let sealResult;
      try {
        sealResult = computeSealPod(
          canonicalJson,
          rowId,
          outcomeClass,
          validatorVersion,
          validatedAt,
          sealKey,
        );
      } finally {
        untrackMessageProcessing();
      }
      const { seal, sealInputJson } = sealResult;

      sendJson(res, 200, { sealed: true, seal, sealInputJson, rowId });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function createSealerServer(
  secret: string,
  sealKey: Buffer,
  config?: SealerConfig,
): http.Server {
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const diagnostics = config?.diagnostics ?? createRoleDiagnosticRuntime(ROLE);
  return http.createServer(
    wrapRoleRequestListener(
      diagnostics,
      makeHandler(secret, sealKey, version, maxBodyBytes, diagnostics),
    ),
  );
}

export function startSealerServer(): void {
  const secret = requirePodAuthSecret();

  // Load key — errors here exit the process immediately (fail-fast before accepting connections).
  let sealKey: Buffer;
  try {
    sealKey = parseSealKeyHex(process.env['SEAL_KEY_HEX']);
  } catch (e) {
    // MUST NOT log key material — error message from parseSealKeyHex never contains the key.
    console.error(`[${ROLE}] FATAL: ${(e as Error).message}`);
    process.exit(1);
  }

  // Zero and remove the env var immediately after decoding.
  const rawLen = process.env['SEAL_KEY_HEX']?.length ?? 0;
  process.env['SEAL_KEY_HEX'] = '0'.repeat(rawLen);
  delete process.env['SEAL_KEY_HEX'];

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['SEALER_HOST'] ?? '127.0.0.1';
  const server = createSealerServer(secret, sealKey);

  server.listen(port, host, () => {
    // "sealer ready" — no key material in this message.
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${VERSION}) — sealer ready`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    // Zeroize the key on graceful shutdown.
    sealKey.fill(0);
    server.close(() => process.exit(0));
  });
}

// ── Entrypoint detection ───────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/sealer.js')) {
  startSealerServer();
}
