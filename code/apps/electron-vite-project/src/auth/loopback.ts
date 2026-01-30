import { createServer, type Server } from 'node:http';
import { URL } from 'node:url';
import { randomString } from './pkce';

export interface CallbackResult {
  code: string | null;
  state: string | null;
  error: string | null;
  error_description: string | null;
}

export interface LoopbackServer {
  redirectUri: string;
  waitForCode: Promise<CallbackResult>;
  close: () => void;
}

/**
 * Preferred ports for OAuth callback loopback server.
 * Using fixed ports ensures Keycloak redirect URI validation works correctly,
 * as some Keycloak versions have issues with wildcard port matching.
 * 
 * These ports should be configured in Keycloak as valid redirect URIs:
 * - http://127.0.0.1:62151/*
 * - http://127.0.0.1:62152/*
 * - http://127.0.0.1:62153/*
 * - http://127.0.0.1:62154/*
 * - http://127.0.0.1:62155/*
 */
const PREFERRED_PORTS = [62151, 62152, 62153, 62154, 62155];

/**
 * Start a loopback HTTP server for OAuth callback
 *
 * Why HTTP loopback?
 * - OAuth 2.0 requires a redirect URI to receive the authorization code
 * - Desktop apps cannot use HTTPS localhost (no valid certificate)
 * - RFC 8252 (OAuth for Native Apps) recommends loopback redirect for desktop apps
 * - Binding to 127.0.0.1 ensures only local processes can receive the callback
 * - Random callback path prevents callback hijacking attacks
 *
 * Port Strategy:
 * - Tries preferred ports (62151-62155) in order for Keycloak compatibility
 * - Falls back to random port (0) only if all preferred ports are busy
 * - Binds ONLY to 127.0.0.1 (not 0.0.0.0)
 * - Uses random callback path: /callback/<random>
 * - Closes after first request
 */
export function startLoopbackServer(): Promise<LoopbackServer> {
  return tryPortsInOrder(PREFERRED_PORTS, 0);
}

/**
 * Try to start server on ports in order, falling back to next port if busy
 */
async function tryPortsInOrder(ports: number[], index: number): Promise<LoopbackServer> {
  // Use the port at current index, or 0 (random) as last resort
  const port = index < ports.length ? ports[index] : 0;
  
  try {
    return await startServerOnPort(port);
  } catch (err: any) {
    // If port is in use and we have more ports to try, try the next one
    if (err.code === 'EADDRINUSE' && index < ports.length) {
      console.log(`[AUTH] Port ${port} in use, trying next port...`);
      return tryPortsInOrder(ports, index + 1);
    }
    // Otherwise, rethrow the error
    throw err;
  }
}

/**
 * Start server on a specific port
 */
function startServerOnPort(port: number): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    const callbackPath = `/callback/${randomString(16)}`;
    let server: Server;
    let resolveCode: (result: CallbackResult) => void;

    const waitForCode = new Promise<CallbackResult>((res) => {
      resolveCode = res;
    });

    server = createServer((req, res) => {
      // Only accept GET requests
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

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
      const error_description = url.searchParams.get('error_description');

      // Respond with simple HTML
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Authentication Complete</h1><p>You can close this window.</p></body></html>');

      // Resolve with result
      resolveCode({ code, state, error, error_description });

      // Close server after first request
      server.close();
    });

    server.on('error', reject);

    // Bind ONLY to 127.0.0.1 with specified port
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
        console.log(`[AUTH] Loopback server started on port ${address.port}`);
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
