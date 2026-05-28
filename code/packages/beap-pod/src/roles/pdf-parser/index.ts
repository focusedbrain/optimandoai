/**
 * BEAP pdf-parser role container.
 *
 * Least-privilege PDF text extraction for sibling depackager calls over loopback.
 * Edge depackager invokes automatically during ingest; host depackager on consent only.
 *
 * Port: 127.0.0.1:18107 (or PORT env)
 * UID:  10108 (pod manifests)
 */

import http from 'node:http';

import { requirePodAuthSecret, createPodAuthMiddleware } from '../../shared/podAuth.js';
import {
  createRoleDiagnosticRuntime,
  healthResponseForRole,
  trackMessageProcessing,
  untrackMessageProcessing,
  wrapRoleRequestListener,
  failRoleClosed,
  type RoleDiagnosticRuntime,
} from '../../shared/roleDiagnostic.js';
import { messageContextFromEnvelope } from '../../shared/reportGenerator.js';
import {
  extractPdfFromBuffer,
  PDF_EXTRACTOR_VERSION,
  PDF_PARSER_LIMITS,
  type PdfExtractReasonCode,
} from '../../shared/pdfExtractCore.js';

export const ROLE = 'pdf-parser';
export const DEFAULT_PORT = 18107;
const VERSION = process.env['POD_VERSION'] ?? '1.0.0';

/** Base64-encoded body cap (~4/3 × MAX_PDF_BYTES + JSON overhead). */
const DEFAULT_MAX_BODY_BYTES = Math.ceil(PDF_PARSER_LIMITS.MAX_PDF_BYTES * (4 / 3)) + 65536;

export interface PdfParserConfig {
  version?: string;
  maxBodyBytes?: number;
  diagnostics?: RoleDiagnosticRuntime;
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

function unprocessable(reason_code: PdfExtractReasonCode, message: string): Record<string, unknown> {
  return { error: message, reason_code };
}

function makeHandler(
  secret: string,
  version: string,
  maxBodyBytes: number,
  diagnostics: RoleDiagnosticRuntime,
): http.RequestListener {
  const authMiddleware = createPodAuthMiddleware(secret);

  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const path = (req.url ?? '').split('?')[0]!;

    if (req.method === 'GET' && path === '/health') {
      const health = healthResponseForRole(diagnostics, version);
      sendJson(res, health.statusCode, health.body);
      return;
    }

    if (req.method === 'GET' && path === '/ready') {
      sendJson(res, 200, { status: 'ready', role: ROLE });
      return;
    }

    if (req.method === 'POST' && path === '/extract') {
      const authPassed = await new Promise<boolean>((resolve) => {
        const onFinish = () => resolve(false);
        res.once('finish', onFinish);
        authMiddleware(req, res, () => {
          res.removeListener('finish', onFinish);
          resolve(true);
        });
      });
      if (!authPassed) return;

      const { data, tooLarge } = await readBody(req, maxBodyBytes);
      if (tooLarge) {
        sendJson(
          res,
          422,
          unprocessable('pdf_too_large', `Request body exceeds ${maxBodyBytes} bytes`),
        );
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const requestId =
        typeof body['request_id'] === 'string' && body['request_id'].trim()
          ? body['request_id'].trim()
          : undefined;
      const b64 =
        typeof body['pdf_bytes_b64'] === 'string' ? body['pdf_bytes_b64'].trim() : '';
      if (!b64) {
        sendJson(res, 400, { error: 'Missing pdf_bytes_b64' });
        return;
      }

      let pdfBuffer: Buffer;
      try {
        pdfBuffer = Buffer.from(b64, 'base64');
      } catch {
        sendJson(res, 422, unprocessable('pdf_malformed', 'Invalid base64 in pdf_bytes_b64'));
        return;
      }

      if (pdfBuffer.length === 0) {
        sendJson(res, 422, unprocessable('pdf_malformed', 'Decoded PDF is empty'));
        return;
      }

      if (pdfBuffer.length > PDF_PARSER_LIMITS.MAX_PDF_BYTES) {
        sendJson(
          res,
          422,
          unprocessable(
            'pdf_too_large',
            `PDF exceeds ${PDF_PARSER_LIMITS.MAX_PDF_BYTES} byte limit`,
          ),
        );
        return;
      }

      trackMessageProcessing(
        messageContextFromEnvelope({
          rawBytes: pdfBuffer,
          envelopeSubject: 'pdf-extract',
        }),
      );
      try {
        const result = await extractPdfFromBuffer(pdfBuffer);
        if (!result.ok) {
          sendJson(res, 422, {
            ...unprocessable(result.reason_code, result.message),
            request_id: requestId ?? null,
          });
          return;
        }

        sendJson(res, 200, {
          extracted_text: result.extracted_text,
          page_count: result.page_count,
          structural_hash: result.structural_hash,
          extractor_version: PDF_EXTRACTOR_VERSION,
          request_id: requestId ?? null,
        });
      } catch (exception: unknown) {
        await failRoleClosed({
          runtime: diagnostics,
          exception,
          stage: 'pod_internal',
          sourceFile: 'pdf-parser/index.ts',
          sourceLine: 168,
        });
      } finally {
        untrackMessageProcessing();
      }
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

export function createPdfParserServer(secret: string, config?: PdfParserConfig): http.Server {
  const version = config?.version ?? VERSION;
  const maxBodyBytes = config?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const diagnostics = config?.diagnostics ?? createRoleDiagnosticRuntime(ROLE);
  return http.createServer(
    wrapRoleRequestListener(diagnostics, makeHandler(secret, version, maxBodyBytes, diagnostics)),
  );
}

export function startPdfParserServer(): void {
  const secret = requirePodAuthSecret();
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  const host = process.env['PDF_PARSER_HOST'] ?? '127.0.0.1';
  const server = createPdfParserServer(secret);

  server.listen(port, host, () => {
    console.log(`role: ${ROLE} listening on ${host}:${port} (version ${VERSION})`);
  });

  process.on('SIGTERM', () => {
    console.log(`[${ROLE}] SIGTERM received — shutting down`);
    server.close(() => process.exit(0));
  });
}
