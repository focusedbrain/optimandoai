/**
 * BEAP Pod — Minimal HTTP server for structural validation and depackaging.
 *
 * Endpoints:
 *   POST /validate  → structural validation (no keys)
 *   POST /depackage → full pipeline (keys in request body)
 *   GET  /health    → { status: 'ok', version }
 *
 * No chrome.* dependencies. Key storage injected via request.
 */

import http from 'node:http';
import { validateBeapStructure } from './beapStructuralValidator.js';

const PORT = Number(process.env.POD_PORT ?? 17180);
const VERSION = process.env.POD_VERSION ?? '1.0.0';
const MAX_BODY_BYTES = 600 * 1024 * 1024; // 600 MB (slightly above 500 MB package limit)

async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<{ body: string; ok: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) return { body: '', ok: false };
    chunks.push(chunk as Buffer);
  }
  return { body: Buffer.concat(chunks).toString('utf8'), ok: true };
}

function sendJson(res: http.ServerResponse, status: number, payload: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function createHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url ?? '';
    const [path] = url.split('?');

    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok', version: VERSION });
      return;
    }

    if (req.method === 'POST' && path === '/validate') {
      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.includes('application/json') && !contentType.includes('application/vnd.beap+json')) {
        sendJson(res, 415, { error: 'Content-Type must be application/json or application/vnd.beap+json' });
        return;
      }
      const { body, ok } = await readBody(req, MAX_BODY_BYTES);
      if (!ok) {
        sendJson(res, 413, { error: 'Payload too large' });
        return;
      }
      const result = validateBeapStructure(body);
      sendJson(res, 200, {
        valid: result.valid,
        inputHash: result.inputHash,
        errors: result.errors,
        warnings: result.warnings,
      });
      return;
    }

    if (req.method === 'POST' && path === '/depackage') {
      const contentType = (req.headers['content-type'] ?? '').toLowerCase();
      if (!contentType.includes('application/json')) {
        sendJson(res, 415, { error: 'Content-Type must be application/json' });
        return;
      }
      const { body, ok } = await readBody(req, MAX_BODY_BYTES);
      if (!ok) {
        sendJson(res, 413, { error: 'Payload too large' });
        return;
      }
      let parsed: { rawBeapJson?: string; keys?: Record<string, unknown> };
      try {
        parsed = JSON.parse(body) as { rawBeapJson?: string; keys?: Record<string, unknown> };
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      const rawBeapJson = parsed?.rawBeapJson;
      if (typeof rawBeapJson !== 'string') {
        sendJson(res, 400, { error: 'Missing or invalid rawBeapJson in request body' });
        return;
      }
      // Structural validation first
      const structuralResult = validateBeapStructure(rawBeapJson);
      if (!structuralResult.valid) {
        sendJson(res, 422, {
          error: 'Structural validation failed',
          errors: structuralResult.errors,
        });
        return;
      }
      // Full depackaging requires keys in request. For MVP, depackage is not yet wired
      // to the extension's pipeline (it uses chrome.storage). Return 501 until we have
      // a standalone depackaging module that accepts keys via request.
      sendJson(res, 501, {
        error: 'Depackage not implemented',
        message: 'Full depackaging pipeline requires keys in request. Use POST /validate for structural validation.',
      });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

export function createPodServer(): http.Server {
  return http.createServer(createHandler());
}

export function startPodServer(port = PORT): http.Server {
  const server = createPodServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`[BEAP Pod] Listening on port ${port} (version ${VERSION})`);
  });
  return server;
}
