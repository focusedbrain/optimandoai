/**
 * pdf-parser container integration (optional).
 *
 * Run: WRDESK_AGENT_PODMAN_IT=1 pnpm --filter @repo/beap-pod test
 * Requires: beap-components:dev image built (`pnpm --filter @repo/beap-pod docker:build`)
 */

import { describe, test, expect } from 'vitest';
import { execSync } from 'node:child_process';
import http from 'node:http';

const IT = process.env['WRDESK_AGENT_PODMAN_IT'] === '1';
const TEST_SECRET = 'integration-pdf-parser-secret-32b!!';

function httpPostExtract(port: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload = JSON.stringify({
    pdf_bytes_b64: Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8').toString('base64'),
    request_id: 'it-1',
  });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path: '/extract',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(payload)),
          'X-Pod-Auth': TEST_SECRET,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

describe.skipIf(!IT)('pdf-parser podman integration', () => {
  test('container serves /health and /extract', async () => {
    const hostPort = 18107;
    try {
      execSync(`podman rm -f beap-pdf-parser-it 2>/dev/null`, { stdio: 'ignore' });
    } catch {
      /* ignore */
    }

    execSync(
      [
        'podman run -d --name beap-pdf-parser-it',
        `-p ${hostPort}:18107`,
        `-e BEAP_ROLE=pdf-parser`,
        `-e POD_AUTH_SECRET=${TEST_SECRET}`,
        '-e PDF_PARSER_HOST=0.0.0.0',
        'beap-components:dev',
      ].join(' '),
      { stdio: 'inherit' },
    );

    try {
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const health = await new Promise<number>((resolve, reject) => {
            http
              .get(`http://127.0.0.1:${hostPort}/health`, (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
              })
              .on('error', reject);
          });
          if (health === 200) {
            ready = true;
            break;
          }
        } catch {
          /* wait */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(ready).toBe(true);

      const extract = await httpPostExtract(hostPort);
      expect([200, 422]).toContain(extract.status);
      if (extract.status === 200) {
        expect(typeof extract.body['extracted_text']).toBe('string');
        expect(typeof extract.body['structural_hash']).toBe('string');
      } else {
        expect(extract.body['reason_code']).toBeTruthy();
      }
    } finally {
      execSync('podman rm -f beap-pdf-parser-it', { stdio: 'ignore' });
    }
  }, 120_000);
});
