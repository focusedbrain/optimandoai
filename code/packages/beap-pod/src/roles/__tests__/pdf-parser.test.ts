/**
 * pdf-parser role — HTTP API tests.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';

const extractPdfFromBufferMock = vi.hoisted(() => vi.fn());

vi.mock('../../shared/pdfExtractCore.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../shared/pdfExtractCore.js')>();
  return {
    ...mod,
    extractPdfFromBuffer: extractPdfFromBufferMock,
  };
});

import { createPdfParserServer, DEFAULT_PORT } from '../pdf-parser/index.js';

const TEST_SECRET = 'pdf-parser-test-secret-32-bytes!!';

function request(
  port: number,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (payload) {
      headers['X-Pod-Auth'] = TEST_SECRET;
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown> = {};
          try {
            json = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            json = { _raw: raw };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('pdf-parser role HTTP', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    extractPdfFromBufferMock.mockReset();
    server = createPdfParserServer(TEST_SECRET);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : DEFAULT_PORT;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('GET /health returns ok', async () => {
    const res = await request(port, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.json['status']).toBe('ok');
    expect(res.json['role']).toBe('pdf-parser');
  });

  test('GET /ready returns ready', async () => {
    const res = await request(port, 'GET', '/ready');
    expect(res.status).toBe(200);
    expect(res.json['status']).toBe('ready');
  });

  test('POST /extract without auth returns 401', async () => {
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      const payload = JSON.stringify({ pdf_bytes_b64: 'aa==', request_id: 'r1' });
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method: 'POST',
          path: '/extract',
          headers: { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) },
        },
        (r) => resolve({ status: r.statusCode ?? 0 }),
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    expect(res.status).toBe(401);
  });

  test('POST /extract success returns extracted fields', async () => {
    extractPdfFromBufferMock.mockResolvedValue({
      ok: true,
      extracted_text: 'Sample text',
      page_count: 1,
      structural_hash: 'abc123',
      pages: ['Sample text'],
    });

    const b64 = Buffer.from('%PDF-1.0 test', 'utf8').toString('base64');
    const res = await request(port, 'POST', '/extract', {
      pdf_bytes_b64: b64,
      request_id: 'req-1',
    });

    expect(res.status).toBe(200);
    expect(res.json['extracted_text']).toBe('Sample text');
    expect(res.json['page_count']).toBe(1);
    expect(res.json['structural_hash']).toBe('abc123');
    expect(res.json['request_id']).toBe('req-1');
    expect(extractPdfFromBufferMock).toHaveBeenCalledOnce();
  });

  test('POST /extract failure returns 422 with reason_code', async () => {
    extractPdfFromBufferMock.mockResolvedValue({
      ok: false,
      reason_code: 'pdf_malformed',
      message: 'bad pdf',
    });

    const res = await request(port, 'POST', '/extract', {
      pdf_bytes_b64: Buffer.from('%PDF', 'utf8').toString('base64'),
    });

    expect(res.status).toBe(422);
    expect(res.json['reason_code']).toBe('pdf_malformed');
  });

  test('POST /extract extractPdf pdf_too_large returns 422', async () => {
    extractPdfFromBufferMock.mockResolvedValue({
      ok: false,
      reason_code: 'pdf_too_large',
      message: 'too big',
    });
    const res = await request(port, 'POST', '/extract', {
      pdf_bytes_b64: Buffer.from('%PDF-1.0', 'utf8').toString('base64'),
    });
    expect(res.status).toBe(422);
    expect(res.json['reason_code']).toBe('pdf_too_large');
  });

  test('POST /extract rejects Content-Length over cap', async () => {
    const res = await new Promise<{ status: number; json: Record<string, unknown> }>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            method: 'POST',
            path: '/extract',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': String(80 * 1024 * 1024),
              'X-Pod-Auth': TEST_SECRET,
            },
          },
          (r) => {
            const chunks: Buffer[] = [];
            r.on('data', (c) => chunks.push(c as Buffer));
            r.on('end', () => {
              resolve({
                status: r.statusCode ?? 0,
                json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
              });
            });
          },
        );
        req.on('error', reject);
        req.end('{}');
      },
    );
    expect(res.status).toBe(422);
    expect(res.json['reason_code']).toBe('pdf_too_large');
  });
});
