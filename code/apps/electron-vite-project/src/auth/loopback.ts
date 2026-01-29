import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { randomString } from './pkce';

export interface CallbackResult {
  code: string | null;
  state: string | null;
  error: string | null;
}

export interface LoopbackServer {
  redirectUri: string;
  waitForCode: Promise<CallbackResult>;
  close: () => void;
}

/**
 * Start a loopback HTTP server for OAuth callback
 *
 * Why HTTP loopback?
 * - OAuth 2.0 requires a redirect URI to receive the authorization code
 * - Desktop apps cannot use HTTPS localhost (no valid certificate)
 * - RFC 8252 (OAuth for Native Apps) recommends loopback redirect for desktop apps
 * - Binding to 127.0.0.1 ensures only local processes can receive the callback
 * - Random port and random callback path prevent port hijacking attacks
 *
 * - Binds ONLY to 127.0.0.1
 * - Uses random available port
 * - Uses random callback path: /callback/<random>
 * - Closes after first request
 */
export function startLoopbackServer(): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    const callbackPath = `/callback/${randomString(16)}`;
    let server: Server;
    let resolveCode: (result: CallbackResult) => void;

    const waitForCode = new Promise<CallbackResult>((res) => {
      resolveCode = res;
    });

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      // Only accept the exact callback path
      if (url.pathname !== callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      // Parse query params
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      // Respond with simple HTML
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Authentication Complete</h1><p>You can close this window.</p></body></html>');

      // Resolve with result
      resolveCode({ code, state, error });

      // Close server after first request
      server.close();
    });

    server.on('error', reject);

    // Bind ONLY to 127.0.0.1 with random port
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
        resolve({
          redirectUri,
          waitForCode,
          close: () => server.close(),
        });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
  });
}
