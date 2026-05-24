/**
 * BEAP depackager role container.
 *
 * Responsibilities (P1.5):
 *   – Accept POST /depackage from the validator container (X-Pod-Auth required).
 *   – Run the 6-gate depackaging pipeline (ported from Electron + extension).
 *   – Sanitize HTML in depackaged email bodies (strict allow-list; no scripts/events/data:).
 *   – Forward depackaged result to the sealer at :18103/seal (X-Pod-Auth).
 *   – Return sealed payload to the validator.
 *
 * Hardening (Canon §10):
 *   – No outbound network except the loopback call to sealer.
 *   – Hard wall-clock timeout per request (default 5 s, configurable via DEPACKAGER_TIMEOUT_MS).
 *   – No persistent scratch space; all work is in-memory (run container with tmpfs for /tmp).
 *
 * Port:  127.0.0.1:18102  (or PORT env var)
 * Trust: X-Pod-Auth header validated via createPodAuthMiddleware.
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import sanitizeHtml from 'sanitize-html';
import type { IOptions as SanitizeOptions } from 'sanitize-html';
import { requirePodAuthSecret, createPodAuthMiddleware, podAuthFetch } from '../shared/podAuth.js';
import {
  runDepackagePipeline,
  type LocalBeapPackage,
} from './depackagePipeline.js';
import { validateBeapStructure } from '../beapStructuralValidator.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE = 'depackager';
const DEFAULT_PORT = 18102;
const DEFAULT_SEALER_BASE = 'http://127.0.0.1:18103';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024; // 16 MB
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

// ── HTML sanitization allow-list ──────────────────────────────────────────────
//
// Security properties (Canon §10 — no rendering, scripting, macro evaluation):
//   – <script>, <style>, <iframe>, <object>, <embed>, <form>, <input> NOT listed → stripped.
//   – All on* event handlers NOT in allowedAttributes → stripped.
//   – javascript: and data: schemes NOT in allowedSchemes → href/src stripped.
//   – img[src] restricted to ['http','https'] via allowedSchemesByTag.
//   – style attribute NOT allowed (prevent CSS-based data exfiltration).
//   – Only class/id/lang allowed as universal attributes.

const HTML_SANITIZE_OPTIONS: SanitizeOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'span', 'section', 'article', 'blockquote',
    'pre', 'code', 'br', 'hr',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'a', 'b', 'i', 'em', 'strong', 'small', 'del', 'ins', 'sub', 'sup', 'mark',
    'img', 'figure', 'figcaption',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    '*': ['class', 'id', 'lang'],
  },
  // No style= attribute; no on* handlers (they're not in allowedAttributes).
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['http', 'https'],  // data: URLs explicitly excluded
  },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'action'],
  disallowedTagsMode: 'discard',
};

/** Sanitize an email body string with the documented allow-list. */
export function sanitizeBeapBody(html: string): string {
  return sanitizeHtml(html, HTML_SANITIZE_OPTIONS);
}

// ── Config (injectable for testing) ───────────────────────────────────────────

export interface DepackagerConfig {
  sealerBase?: string;
  version?: string;
  maxBodyBytes?: number;
  timeoutMs?: number;
  authedFetch?: typeof fetch;
  localX25519PrivB64?: string;
  localMlkemSecretB64?: string;
  skipSignatureVerification?: boolean;
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
  cfg: Required<Omit<DepackagerConfig, 'localMlkemSecretB64'>> & Pick<DepackagerConfig, 'localMlkemSecretB64'>,
): http.RequestListener {
  const authMiddleware = createPodAuthMiddleware(secret);

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    // ── GET /health ────────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok', role: ROLE, version: cfg.version });
      return;
    }

    // ── GET /ready ─────────────────────────────────────────────────────────────
    if (req.method === 'GET' && path === '/ready') {
      const hasKey = Boolean(cfg.localX25519PrivB64);
      sendJson(res, hasKey ? 200 : 503, { status: hasKey ? 'ready' : 'not-ready', role: ROLE, reason: hasKey ? undefined : 'no-key-material' });
      return;
    }

    // ── POST /depackage ────────────────────────────────────────────────────────
    if (req.method === 'POST' && path === '/depackage') {
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

      // ② Wall-clock timeout wraps ALL subsequent processing
      const controller = new AbortController();
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, cfg.timeoutMs);

      const doProcess = async (): Promise<void> => {
        try {
          // ③ Size gate
          const { data, tooLarge } = await readBody(req, cfg.maxBodyBytes);
          if (tooLarge) {
            res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
            res.end(JSON.stringify({ error: 'Payload too large', limit_bytes: cfg.maxBodyBytes }));
            return;
          }

          // ④ Parse envelope
          let body: { validated: unknown };
          try {
            body = JSON.parse(data.toString('utf8')) as { validated: unknown };
          } catch {
            sendJson(res, 400, { error: 'Invalid JSON body' });
            return;
          }

          const validated = body.validated as Record<string, unknown> | null | undefined;
          if (typeof validated !== 'object' || validated === null) {
            sendJson(res, 400, { error: 'Missing or invalid "validated" field' });
            return;
          }

          // ⑤ Extract BEAP package from validated.capsule
          const capsule = validated['capsule'] as LocalBeapPackage | undefined;
          if (!capsule || typeof capsule !== 'object') {
            sendJson(res, 400, { error: 'validated.capsule missing or not an object' });
            return;
          }

          // ⑥ Structural pre-check (validateBeapStructure — no key material needed)
          const pkgJson = JSON.stringify(capsule);
          const structural = validateBeapStructure(pkgJson);
          if (!structural.valid) {
            sendJson(res, 422, {
              error: 'Structural validation failed',
              reason: 'STRUCTURAL_INVALID',
              errors: structural.errors,
            });
            return;
          }

          // ⑦ Key material — from config (env in production, injected in tests)
          const localX25519PrivB64 = cfg.localX25519PrivB64;
          if (!localX25519PrivB64) {
            sendJson(res, 503, { error: 'Depackager not configured: missing local key material' });
            return;
          }

          // ⑧ 6-gate depackaging pipeline
          const pipelineResult = await runDepackagePipeline(capsule, {
            localX25519PrivB64,
            localMlkemSecretB64: cfg.localMlkemSecretB64,
            skipSignatureVerification: cfg.skipSignatureVerification,
          });

          if (!pipelineResult.success) {
            sendJson(res, 422, {
              error: pipelineResult.nonDisclosingError,
              failedGate: pipelineResult.failedGate,
            });
            return;
          }

          // ⑨ Parse and sanitize the decrypted capsule content
          let parsedCapsule: Record<string, unknown>;
          try {
            parsedCapsule = JSON.parse(pipelineResult.capsulePlaintext) as Record<string, unknown>;
          } catch {
            sendJson(res, 422, { error: 'Package verification failed', reason: 'CAPSULE_JSON_INVALID' });
            return;
          }

          const rawBody =
            typeof parsedCapsule['body'] === 'string'
              ? parsedCapsule['body']
              : parsedCapsule['body'] != null
                ? JSON.stringify(parsedCapsule['body'])
                : '';
          const sanitizedBody = sanitizeBeapBody(rawBody);

          const depackaged = {
            subject: typeof parsedCapsule['subject'] === 'string' ? parsedCapsule['subject']
              : typeof parsedCapsule['title'] === 'string' ? parsedCapsule['title'] : '',
            body: sanitizedBody,
            transport_plaintext: typeof parsedCapsule['transport_plaintext'] === 'string'
              ? parsedCapsule['transport_plaintext'] : '',
            encoding: pipelineResult.encoding,
            handshakeId: pipelineResult.handshakeId,
            artefactCount: pipelineResult.artefactCount,
            rawCapsuleJson: pipelineResult.capsulePlaintext,
          };

          // ⑩ Forward to sealer
          let sealerRes: Response;
          try {
            sealerRes = await cfg.authedFetch(`${cfg.sealerBase}/seal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depackaged }),
              signal: controller.signal,
            });
          } catch (e) {
            if (timedOut) {
              sendJson(res, 504, { error: 'Depackager timeout', code: 'DEPACKAGER_TIMEOUT' });
            } else {
              sendJson(res, 502, { error: 'Sealer unreachable' });
            }
            return;
          }

          const sealerText = await sealerRes.text();
          res.writeHead(sealerRes.status, { 'Content-Type': 'application/json' });
          res.end(sealerText);
        } finally {
          clearTimeout(timeoutHandle);
        }
      };

      await doProcess();
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function createDepackagerServer(secret: string, config?: DepackagerConfig): http.Server {
  const sealerBase = config?.sealerBase ?? DEFAULT_SEALER_BASE;
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authedFetch = config?.authedFetch ?? podAuthFetch(secret);
  const localX25519PrivB64 = config?.localX25519PrivB64 ?? process.env['BEAP_LOCAL_X25519_PRIV_B64'] ?? '';
  const localMlkemSecretB64 = config?.localMlkemSecretB64 ?? process.env['BEAP_LOCAL_MLKEM_SECRET_B64'];
  const skipSignatureVerification = config?.skipSignatureVerification ?? true;

  return http.createServer(
    makeHandler(secret, {
      sealerBase,
      version,
      maxBodyBytes,
      timeoutMs,
      authedFetch,
      localX25519PrivB64,
      localMlkemSecretB64,
      skipSignatureVerification,
    }),
  );
}

export function startDepackagerServer(): void {
  const secret = requirePodAuthSecret();
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['DEPACKAGER_HOST'] ?? '127.0.0.1';
  const server = createDepackagerServer(secret);

  server.listen(port, host, () => {
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${VERSION})`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    server.close(() => process.exit(0));
  });
}

// ── Entrypoint detection ───────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const _entry = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
if (_entry === __filename || process.argv[1]?.endsWith('roles/depackager.js')) {
  startDepackagerServer();
}
