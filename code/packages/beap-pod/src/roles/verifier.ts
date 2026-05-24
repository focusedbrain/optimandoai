/**
 * BEAP verifier role container (LOCAL_VERIFY).
 *
 * Responsibilities (P3.6):
 *   – Accept POST /verify-cert from the ingestor (X-Pod-Auth required).
 *   – Load LOCAL_SSO_SUB, preloaded JWKS, and TRUSTED_EDGE_POD_IDS at startup.
 *   – Apply the strategy §2.3 acceptance rule (fail-fast, ordered checks).
 *   – Return { ok: true, edge_pod_id, sub } or { ok: false, reason }.
 *
 * Security properties:
 *   – No outbound network (JWKS preloaded from KEYCLOAK_JWKS_JSON at startup).
 *   – No SQLite, no cert/attestation content in logs (reason code + correlation hash only).
 *   – No side effects on failure beyond the HTTP rejection response.
 *
 * Port: 127.0.0.1:18105 (or PORT env var)
 */

import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { compactVerify, createLocalJWKSet, decodeJwt } from 'jose';
import type { CompactVerifyGetKey, JSONWebKeySet, JWTVerifyGetKey } from 'jose';
import { packageHash, verifyCertificate, capsuleCanonicalHash, validationResultDigest } from '@repo/beap-cert';
import type { EdgeCertificate } from '@repo/beap-cert';
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

const ROLE = 'verifier';

/** JSON audit line type — Electron tails verifier stdout and parses these (P3.10). */
export const BEAP_EDGE_VERIFICATION_AUDIT_TYPE = 'beap_edge_verification';

export interface EdgeVerificationAuditLine {
  type: typeof BEAP_EDGE_VERIFICATION_AUDIT_TYPE;
  timestamp: string;
  edge_pod_id: string;
  sub: string;
  /** `verified` or a VerifyReasonCode string. */
  result: string;
  phase: 'shallow' | 'deep';
}

export function emitVerificationAuditLine(event: Omit<EdgeVerificationAuditLine, 'type'>): void {
  const line: EdgeVerificationAuditLine = {
    type: BEAP_EDGE_VERIFICATION_AUDIT_TYPE,
    ...event,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
const DEFAULT_PORT = 18105;
const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';
const EDGE_PUBKEY_CLAIM = 'edge_pubkey';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ordered acceptance-rule failure codes (strategy §2.3). */
export const VERIFY_REASON = {
  EDGE_NOT_TRUSTED: 'EDGE_NOT_TRUSTED',
  CERT_EXPIRED: 'CERT_EXPIRED',
  PACKAGE_HASH_MISMATCH: 'PACKAGE_HASH_MISMATCH',
  SSO_ATTESTATION_INVALID: 'SSO_ATTESTATION_INVALID',
  SSO_ATTESTATION_EXPIRED: 'SSO_ATTESTATION_EXPIRED',
  SSO_SUB_MISMATCH: 'SSO_SUB_MISMATCH',
  ATTESTATION_POD_ID_MISMATCH: 'ATTESTATION_POD_ID_MISMATCH',
  EDGE_SIGNATURE_INVALID: 'EDGE_SIGNATURE_INVALID',
  CAPSULE_CANONICAL_HASH_MISMATCH: 'CAPSULE_CANONICAL_HASH_MISMATCH',
  VALIDATION_RESULT_DIGEST_MISMATCH: 'VALIDATION_RESULT_DIGEST_MISMATCH',
} as const;

export type VerifyReasonCode = (typeof VERIFY_REASON)[keyof typeof VERIFY_REASON];

export type VerifyCertSuccess = { ok: true; edge_pod_id: string; sub: string };
export type VerifyCertFailure = { ok: false; reason: VerifyReasonCode };
export type VerifyCertResult = VerifyCertSuccess | VerifyCertFailure;

export interface VerifierConfig {
  version?: string;
  maxBodyBytes?: number;
  diagnostics?: RoleDiagnosticRuntime;
}

export interface VerifierRuntimeState {
  localSsoSub: string;
  trustedEdgePodIds: Set<string>;
  jwks: JWTVerifyGetKey;
}

export interface VerifyCertInput {
  rawPackageBytes: Uint8Array;
  certificate: EdgeCertificate;
  expectedCapsuleCanonicalBytes?: Uint8Array;
  expectedValidationResultBytes?: Uint8Array;
}

export function parseLocalSsoSub(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      'LOCAL_SSO_SUB environment variable is not set or is empty. Verifier refuses to start.',
    );
  }
  return value.trim();
}

export function parseTrustedEdgePodIds(value: string | undefined): Set<string> {
  if (!value || value.trim().length === 0) {
    throw new Error(
      'TRUSTED_EDGE_POD_IDS environment variable is not set or is empty. Verifier refuses to start.',
    );
  }
  const ids = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (ids.length === 0) {
    throw new Error(
      'TRUSTED_EDGE_POD_IDS contains no valid UUIDs. Verifier refuses to start.',
    );
  }
  for (const id of ids) {
    if (!UUID_RE.test(id)) {
      throw new Error(
        `TRUSTED_EDGE_POD_IDS entry is not a valid UUID: ${id.slice(0, 8)}… Verifier refuses to start.`,
      );
    }
  }
  return new Set(ids.map((id) => id.toLowerCase()));
}

export function parseKeycloakJwksJson(value: string | undefined): JWTVerifyGetKey {
  if (!value || value.trim().length === 0) {
    throw new Error(
      'KEYCLOAK_JWKS_JSON environment variable is not set or is empty. Verifier refuses to start.',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.trim());
  } catch {
    throw new Error(
      'KEYCLOAK_JWKS_JSON is not valid JSON. Verifier refuses to start.',
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { keys?: unknown }).keys)
  ) {
    throw new Error(
      'KEYCLOAK_JWKS_JSON must be a JWK Set with a "keys" array. Verifier refuses to start.',
    );
  }
  return createLocalJWKSet(parsed as JSONWebKeySet);
}

export function loadVerifierRuntimeState(env: NodeJS.ProcessEnv = process.env): VerifierRuntimeState {
  const localSsoSub = parseLocalSsoSub(env['LOCAL_SSO_SUB']);
  const trustedEdgePodIds = parseTrustedEdgePodIds(env['TRUSTED_EDGE_POD_IDS']);
  const jwksJson = env['KEYCLOAK_JWKS_JSON'];
  const jwksUrl = env['KEYCLOAK_JWKS_URL'];
  if ((!jwksJson || jwksJson.trim().length === 0) && (!jwksUrl || jwksUrl.trim().length === 0)) {
    throw new Error(
      'Neither KEYCLOAK_JWKS_JSON nor KEYCLOAK_JWKS_URL is set. Verifier refuses to start.',
    );
  }
  if (!jwksJson || jwksJson.trim().length === 0) {
    throw new Error(
      'KEYCLOAK_JWKS_URL is set but on-demand JWKS fetch is not supported in Phase 3. ' +
        'Provide KEYCLOAK_JWKS_JSON (preloaded JWKS). Verifier refuses to start.',
    );
  }
  const jwks = parseKeycloakJwksJson(jwksJson);
  return { localSsoSub, trustedEdgePodIds, jwks };
}

/** Parse attestation `edge_pubkey` claim (`ed25519:<hex>` or raw 64-char hex). */
export function parseEdgePubkeyClaim(value: unknown): Uint8Array | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const prefix = 'ed25519:';
  const hex = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return null;
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** Correlation id for logs — first 8 hex chars of sha256(canonical cert fields). Never log full cert. */
export function certCorrelationId(cert: EdgeCertificate): string {
  const material = JSON.stringify({
    v: cert.v,
    package_hash: cert.package_hash,
    edge_pod_id: cert.edge_pod_id,
    expires_at: cert.expires_at,
  });
  return createHash('sha256').update(material).digest('hex').slice(0, 8);
}

function isEdgeCertificate(value: unknown): value is EdgeCertificate {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    c['v'] === 1 &&
    typeof c['package_hash'] === 'string' &&
    typeof c['capsule_canonical_hash'] === 'string' &&
    typeof c['validation_result_digest'] === 'string' &&
    typeof c['edge_pod_id'] === 'string' &&
    typeof c['issued_at'] === 'string' &&
    typeof c['expires_at'] === 'string' &&
    typeof c['sso_attestation'] === 'string' &&
    typeof c['edge_signature'] === 'string'
  );
}

async function verifySsoAttestationSignature(
  jwt: string,
  jwks: JWTVerifyGetKey,
): Promise<{ ok: true } | { ok: false }> {
  try {
    await compactVerify(jwt, jwks as unknown as CompactVerifyGetKey);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function attestationExpired(payload: Record<string, unknown>, nowMs: number): boolean {
  const exp = payload['exp'];
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return true;
  }
  return nowMs >= exp * 1000;
}

/**
 * Apply the §2.3 acceptance rule in order. Fail-fast on first mismatch.
 * Pure aside from async JWT crypto — inject clock and JWKS for tests.
 */
export async function verifyCertificateAcceptance(
  state: VerifierRuntimeState,
  input: VerifyCertInput,
  now: Date = new Date(),
): Promise<VerifyCertResult> {
  const cert = input.certificate;
  const correlation = certCorrelationId(cert);
  const nowMs = now.getTime();

  // 1. cert.edge_pod_id ∈ TRUSTED_EDGE_POD_IDS
  if (!state.trustedEdgePodIds.has(cert.edge_pod_id.toLowerCase())) {
    logRejection(VERIFY_REASON.EDGE_NOT_TRUSTED, correlation);
    return { ok: false, reason: VERIFY_REASON.EDGE_NOT_TRUSTED };
  }

  // 2. now() < cert.expires_at
  const certExpiresMs = Date.parse(cert.expires_at);
  if (Number.isNaN(certExpiresMs) || nowMs >= certExpiresMs) {
    logRejection(VERIFY_REASON.CERT_EXPIRED, correlation);
    return { ok: false, reason: VERIFY_REASON.CERT_EXPIRED };
  }

  // 3. cert.package_hash == sha256(raw_package_bytes)
  const expectedPackageHash = packageHash(input.rawPackageBytes);
  if (cert.package_hash !== expectedPackageHash) {
    logRejection(VERIFY_REASON.PACKAGE_HASH_MISMATCH, correlation);
    return { ok: false, reason: VERIFY_REASON.PACKAGE_HASH_MISMATCH };
  }

  const jwt = cert.sso_attestation.trim();

  // 4. SSO attestation JWT signature verifies against JWKS
  const sigResult = await verifySsoAttestationSignature(jwt, state.jwks);
  if (!sigResult.ok) {
    logRejection(VERIFY_REASON.SSO_ATTESTATION_INVALID, correlation);
    return { ok: false, reason: VERIFY_REASON.SSO_ATTESTATION_INVALID };
  }

  let payload: Record<string, unknown>;
  try {
    payload = decodeJwt(jwt) as Record<string, unknown>;
  } catch {
    logRejection(VERIFY_REASON.SSO_ATTESTATION_INVALID, correlation);
    return { ok: false, reason: VERIFY_REASON.SSO_ATTESTATION_INVALID };
  }

  // 5. SSO attestation not expired
  if (attestationExpired(payload, nowMs)) {
    logRejection(VERIFY_REASON.SSO_ATTESTATION_EXPIRED, correlation);
    return { ok: false, reason: VERIFY_REASON.SSO_ATTESTATION_EXPIRED };
  }

  // 6. attestation.sub == LOCAL_SSO_SUB
  const attSub = payload['sub'];
  if (typeof attSub !== 'string' || attSub !== state.localSsoSub) {
    logRejection(VERIFY_REASON.SSO_SUB_MISMATCH, correlation);
    return { ok: false, reason: VERIFY_REASON.SSO_SUB_MISMATCH };
  }

  // 7. attestation.pod_id == cert.edge_pod_id
  const attPodId = payload['pod_id'];
  if (typeof attPodId !== 'string' || attPodId.toLowerCase() !== cert.edge_pod_id.toLowerCase()) {
    logRejection(VERIFY_REASON.ATTESTATION_POD_ID_MISMATCH, correlation);
    return { ok: false, reason: VERIFY_REASON.ATTESTATION_POD_ID_MISMATCH };
  }

  // 8. Ed25519 signature verifies (edge public key from attestation bound pubkey claim)
  const edgePublicKey = parseEdgePubkeyClaim(payload[EDGE_PUBKEY_CLAIM]);
  if (!edgePublicKey) {
    logRejection(VERIFY_REASON.EDGE_SIGNATURE_INVALID, correlation);
    return { ok: false, reason: VERIFY_REASON.EDGE_SIGNATURE_INVALID };
  }

  const edgeSig = verifyCertificate(cert, edgePublicKey);
  if (!edgeSig.ok) {
    logRejection(VERIFY_REASON.EDGE_SIGNATURE_INVALID, correlation);
    return { ok: false, reason: VERIFY_REASON.EDGE_SIGNATURE_INVALID };
  }

  // Deep checks (§2.3) — only when local validator output is supplied (second pass).
  if (input.expectedCapsuleCanonicalBytes !== undefined) {
    const expectedCapsuleHash = capsuleCanonicalHash(input.expectedCapsuleCanonicalBytes);
    if (cert.capsule_canonical_hash !== expectedCapsuleHash) {
      logRejection(VERIFY_REASON.CAPSULE_CANONICAL_HASH_MISMATCH, correlation);
      return { ok: false, reason: VERIFY_REASON.CAPSULE_CANONICAL_HASH_MISMATCH };
    }
  }

  if (input.expectedValidationResultBytes !== undefined) {
    const expectedDigest = validationResultDigest(input.expectedValidationResultBytes);
    if (cert.validation_result_digest !== expectedDigest) {
      logRejection(VERIFY_REASON.VALIDATION_RESULT_DIGEST_MISMATCH, correlation);
      return { ok: false, reason: VERIFY_REASON.VALIDATION_RESULT_DIGEST_MISMATCH };
    }
  }

  return { ok: true, edge_pod_id: cert.edge_pod_id, sub: attSub };
}

function logRejection(reason: VerifyReasonCode, correlation: string): void {
  console.log(`[${ROLE}] verify-cert rejected reason=${reason} cert=${correlation}`);
}

function decodeBytesField(
  body: Record<string, unknown>,
  b64Field: string,
  utf8Field: string,
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
  state: VerifierRuntimeState,
  version: string,
  maxBodyBytes: number,
  diagnostics: RoleDiagnosticRuntime,
): http.RequestListener {
  const authMiddleware = createPodAuthMiddleware(secret);
  const podAuthReady = secret.length > 0;

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    if (req.method === 'GET' && path === '/health') {
      const health = healthResponseForRole(diagnostics, version);
      sendJson(res, health.statusCode, health.body);
      return;
    }

    if (req.method === 'GET' && path === '/ready') {
      const ready =
        podAuthReady &&
        state.localSsoSub.length > 0 &&
        state.trustedEdgePodIds.size > 0 &&
        state.jwks !== undefined;
      sendJson(res, ready ? 200 : 503, {
        status: ready ? 'ready' : 'not_ready',
        role: ROLE,
        ...(ready ? {} : { reason: 'verifier_not_configured' }),
      });
      return;
    }

    if (req.method === 'POST' && path === '/verify-cert') {
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

      const certRaw = body['certificate'] ?? body['edge_certificate'];
      if (!isEdgeCertificate(certRaw)) {
        sendJson(res, 400, { error: 'Missing or invalid "certificate" field' });
        return;
      }

      const rawPackageBytes = decodeBytesField(
        body,
        'raw_package_bytes_b64',
        'raw_package_bytes',
      );
      if (!rawPackageBytes) {
        sendJson(res, 400, { error: 'Missing raw_package_bytes_b64 or raw_package_bytes' });
        return;
      }

      const expectedCapsuleCanonicalBytes = decodeBytesField(
        body,
        'expected_capsule_canonical_bytes_b64',
        'expected_capsule_canonical_bytes',
      );

      const expectedValidationResultBytes = decodeBytesField(
        body,
        'expected_validation_result_bytes_b64',
        'expected_validation_result_bytes',
      );

      const phase: 'shallow' | 'deep' = expectedCapsuleCanonicalBytes ? 'deep' : 'shallow';

      trackMessageProcessing(
        messageContextFromEnvelope({
          rawBytes: rawPackageBytes,
          envelopeSubject: certRaw.edge_pod_id,
        }),
      );
      let result;
      try {
        result = await verifyCertificateAcceptance(state, {
          rawPackageBytes,
          certificate: certRaw,
          ...(expectedCapsuleCanonicalBytes ? { expectedCapsuleCanonicalBytes } : {}),
          ...(expectedValidationResultBytes ? { expectedValidationResultBytes } : {}),
        });
      } finally {
        untrackMessageProcessing();
      }

      emitVerificationAuditLine({
        timestamp: new Date().toISOString(),
        edge_pod_id: certRaw.edge_pod_id,
        sub: result.ok ? result.sub : state.localSsoSub,
        result: result.ok ? 'verified' : result.reason,
        phase,
      });

      sendJson(res, 200, result as unknown as Record<string, unknown>);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

export function createVerifierServer(
  secret: string,
  state: VerifierRuntimeState,
  config?: VerifierConfig,
): http.Server {
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const diagnostics = config?.diagnostics ?? createRoleDiagnosticRuntime(ROLE);
  return http.createServer(
    wrapRoleRequestListener(
      diagnostics,
      makeHandler(secret, state, version, maxBodyBytes, diagnostics),
    ),
  );
}

export function startVerifierServer(): void {
  const secret = requirePodAuthSecret();

  let state: VerifierRuntimeState;
  try {
    state = loadVerifierRuntimeState();
  } catch (e) {
    console.error(`[${ROLE}] FATAL: ${(e as Error).message}`);
    process.exit(1);
  }

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['VERIFIER_HOST'] ?? '127.0.0.1';
  const server = createVerifierServer(secret, state);

  server.listen(port, host, () => {
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${VERSION}) — verifier ready`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    server.close(() => process.exit(0));
  });
}

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/verifier.js')) {
  startVerifierServer();
}
