/**
 * BEAP certifier role container (REMOTE_EDGE).
 *
 * Responsibilities (P3.4):
 *   – Accept POST /certify from the depackager (X-Pod-Auth required).
 *   – Load Ed25519 private key, edge pod id, and SSO attestation JWT once at startup.
 *   – Sign edge certificates via @repo/beap-cert (strategy §2.2).
 *   – Return { depackaged_payload, edge_certificate }.
 *
 * Security properties:
 *   – EDGE_PRIVATE_KEY_HEX zeroed and deleted after startup decode.
 *   – Private key NEVER logged, NEVER written to disk.
 *   – No outbound network (no fetch/http client in this role).
 *   – SSO JWT is embedded in the cert only — NOT verified here (verifier role, P3.6).
 *
 * Port: 127.0.0.1:18104 (or PORT env var)
 */

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  capsuleCanonicalHash,
  packageHash,
  signCertificate,
  validationResultDigest,
} from '@repo/beap-cert';
import type { EdgeCertificate, UnsignedCertificate } from '@repo/beap-cert';
import { requirePodAuthSecret, createPodAuthMiddleware } from '../shared/podAuth.js';

const ROLE = 'certifier';
const DEFAULT_PORT = 18104;
const DEFAULT_CERT_TTL_SECONDS = 86_400;
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CertifierConfig {
  version?: string;
  maxBodyBytes?: number;
  certTtlSeconds?: number;
}

export interface CertifierRuntimeState {
  privateKey: Uint8Array;
  edgePodId: string;
  ssoAttestation: string;
  certTtlSeconds: number;
}

export interface CertifyInput {
  rawPackageBytes: Uint8Array;
  canonicalCapsuleBytes: Uint8Array;
  canonicalValidationResultBytes: Uint8Array;
}

/** Parse Ed25519 seed (32 bytes / 64 hex chars). */
export function parseEdgePrivateKeyHex(hex: string | undefined): Uint8Array {
  if (!hex || hex.trim().length === 0) {
    throw new Error(
      'EDGE_PRIVATE_KEY_HEX environment variable is not set or is empty. Certifier refuses to start.',
    );
  }
  const trimmed = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error(
      'EDGE_PRIVATE_KEY_HEX contains non-hex characters. Certifier refuses to start.',
    );
  }
  if (trimmed.length % 2 !== 0) {
    throw new Error('EDGE_PRIVATE_KEY_HEX has odd length. Certifier refuses to start.');
  }
  if (trimmed.length !== 64) {
    throw new Error(
      `EDGE_PRIVATE_KEY_HEX must be 32 bytes (64 hex chars); got ${trimmed.length / 2} bytes. Certifier refuses to start.`,
    );
  }
  return Uint8Array.from(Buffer.from(trimmed, 'hex'));
}

export function parseEdgePodId(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      'EDGE_POD_ID environment variable is not set or is empty. Certifier refuses to start.',
    );
  }
  const trimmed = value.trim();
  if (!UUID_RE.test(trimmed)) {
    throw new Error(
      'EDGE_POD_ID is not a valid UUID string. Certifier refuses to start.',
    );
  }
  return trimmed;
}

/** JWT shape only — Keycloak verification is the verifier role's job (P3.6). */
export function parseSsoAttestationJwt(jwt: string | undefined): string {
  if (!jwt || jwt.trim().length === 0) {
    throw new Error(
      'SSO_ATTESTATION_JWT environment variable is not set or is empty. Certifier refuses to start.',
    );
  }
  const trimmed = jwt.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error(
      'SSO_ATTESTATION_JWT is malformed (expected header.payload.signature). Certifier refuses to start.',
    );
  }
  return trimmed;
}

export function parseCertTtlSeconds(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_CERT_TTL_SECONDS;
  }
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      'CERT_TTL_SECONDS must be a positive integer. Certifier refuses to start.',
    );
  }
  return n;
}

export function loadCertifierRuntimeState(env: NodeJS.ProcessEnv = process.env): CertifierRuntimeState {
  const privateKey = parseEdgePrivateKeyHex(env['EDGE_PRIVATE_KEY_HEX']);
  const edgePodId = parseEdgePodId(env['EDGE_POD_ID']);
  const ssoAttestation = parseSsoAttestationJwt(env['SSO_ATTESTATION_JWT']);
  const certTtlSeconds = parseCertTtlSeconds(env['CERT_TTL_SECONDS']);
  return { privateKey, edgePodId, ssoAttestation, certTtlSeconds };
}

export function buildEdgeCertificate(
  state: CertifierRuntimeState,
  input: CertifyInput,
  now: Date = new Date(),
): EdgeCertificate {
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + state.certTtlSeconds * 1000).toISOString();

  const unsigned: UnsignedCertificate = {
    v: 1,
    package_hash: packageHash(input.rawPackageBytes),
    capsule_canonical_hash: capsuleCanonicalHash(input.canonicalCapsuleBytes),
    validation_result_digest: validationResultDigest(input.canonicalValidationResultBytes),
    edge_pod_id: state.edgePodId,
    issued_at: issuedAt,
    expires_at: expiresAt,
    sso_attestation: state.ssoAttestation,
  };

  return signCertificate(unsigned, state.privateKey);
}

function decodeRequiredBytes(
  body: Record<string, unknown>,
  b64Field: string,
  utf8Field: string,
  label: string,
): Uint8Array | null {
  const b64 = body[b64Field];
  if (typeof b64 === 'string' && b64.length > 0) {
    try {
      return Uint8Array.from(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  }
  const utf8 = body[utf8Field];
  if (typeof utf8 === 'string' && utf8.length > 0) {
    return Uint8Array.from(Buffer.from(utf8, 'utf8'));
  }
  if (body[label] !== undefined) {
    return null;
  }
  return null;
}

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
    if (total > maxBytes) {
      req.resume();
      return { data: Buffer.alloc(0), tooLarge: true };
    }
    chunks.push(chunk);
  }
  return { data: Buffer.concat(chunks), tooLarge: false };
}

function makeHandler(
  secret: string,
  state: CertifierRuntimeState,
  version: string,
  maxBodyBytes: number,
): http.RequestListener {
  const authMiddleware = createPodAuthMiddleware(secret);
  const podAuthReady = secret.length > 0;

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok', role: ROLE, version });
      return;
    }

    if (req.method === 'GET' && path === '/ready') {
      const ready =
        podAuthReady &&
        state.privateKey.length === 32 &&
        state.edgePodId.length > 0 &&
        state.ssoAttestation.length > 0;
      sendJson(res, ready ? 200 : 503, {
        status: ready ? 'ready' : 'not_ready',
        role: ROLE,
        ...(ready ? {} : { reason: 'certifier_not_configured' }),
      });
      return;
    }

    if (req.method === 'POST' && path === '/certify') {
      const authPassed = await new Promise<boolean>((resolveAuth) => {
        const onFinish = () => resolveAuth(false);
        res.once('finish', onFinish);
        authMiddleware(req, res, () => {
          res.removeListener('finish', onFinish);
          resolveAuth(true);
        });
      });
      if (!authPassed) return;

      const { data, tooLarge } = await readBody(req, maxBodyBytes);
      if (tooLarge) {
        res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
        res.end(JSON.stringify({ error: 'Payload too large', limit_bytes: maxBodyBytes }));
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const depackaged = body['depackaged'];
      if (typeof depackaged !== 'object' || depackaged === null || Array.isArray(depackaged)) {
        sendJson(res, 400, { error: 'Missing or invalid "depackaged" field' });
        return;
      }

      const rawPackageBytes = decodeRequiredBytes(
        body,
        'raw_package_bytes_b64',
        'raw_package_bytes',
        'raw_package_bytes_b64',
      );
      const canonicalCapsuleBytes = decodeRequiredBytes(
        body,
        'canonical_capsule_bytes_b64',
        'canonical_capsule_bytes',
        'canonical_capsule_bytes_b64',
      );
      const canonicalValidationResultBytes = decodeRequiredBytes(
        body,
        'canonical_validation_result_bytes_b64',
        'canonical_validation_result_bytes',
        'canonical_validation_result_bytes_b64',
      );

      if (!rawPackageBytes || !canonicalCapsuleBytes || !canonicalValidationResultBytes) {
        sendJson(res, 400, {
          error:
            'Missing certify hash inputs: raw_package_bytes_b64, canonical_capsule_bytes_b64, canonical_validation_result_bytes_b64',
        });
        return;
      }

      const certificate = buildEdgeCertificate(state, {
        rawPackageBytes,
        canonicalCapsuleBytes,
        canonicalValidationResultBytes,
      });

      sendJson(res, 200, {
        certified: true,
        depackaged_payload: depackaged,
        edge_certificate: certificate,
        certificate,
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

export function createCertifierServer(
  secret: string,
  state: CertifierRuntimeState,
  config?: CertifierConfig,
): http.Server {
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return http.createServer(makeHandler(secret, state, version, maxBodyBytes));
}

export function startCertifierServer(): void {
  const secret = requirePodAuthSecret();

  let state: CertifierRuntimeState;
  try {
    state = loadCertifierRuntimeState();
  } catch (e) {
    console.error(`[${ROLE}] FATAL: ${(e as Error).message}`);
    process.exit(1);
  }

  const rawLen = process.env['EDGE_PRIVATE_KEY_HEX']?.length ?? 0;
  process.env['EDGE_PRIVATE_KEY_HEX'] = '0'.repeat(rawLen);
  delete process.env['EDGE_PRIVATE_KEY_HEX'];

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['CERTIFIER_HOST'] ?? '127.0.0.1';
  const server = createCertifierServer(secret, state);

  server.listen(port, host, () => {
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${VERSION}) — certifier ready`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    state.privateKey.fill(0);
    server.close(() => process.exit(0));
  });
}

/** Constant-time compare for tests / future attestation checks. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/certifier.js')) {
  startCertifierServer();
}
