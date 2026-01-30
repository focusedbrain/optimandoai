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

      // Respond with enterprise-grade success page
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign-in Successful - WR Desk</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f8fafc;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1e293b;
    }
    .container {
      text-align: center;
      padding: 48px 32px;
      max-width: 400px;
    }
    .icon {
      width: 56px;
      height: 56px;
      margin: 0 auto 24px;
      background: #f0fdf4;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon svg {
      width: 28px;
      height: 28px;
      stroke: #22c55e;
      stroke-width: 2.5;
      fill: none;
    }
    h1 {
      font-size: 20px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 12px;
      letter-spacing: -0.01em;
    }
    .message {
      font-size: 14px;
      color: #64748b;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .primary-btn {
      display: inline-block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      border-radius: 8px;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      box-shadow: 0 1px 3px rgba(99, 102, 241, 0.3);
    }
    .primary-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
    }
    .secondary-link {
      display: block;
      margin-top: 16px;
      font-size: 13px;
      color: #94a3b8;
      text-decoration: none;
      cursor: pointer;
    }
    .secondary-link:hover {
      color: #64748b;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>
    <h1>Sign-in successful</h1>
    <p class="message">
      Authentication is complete.<br>
      You can now return to WR Desk.
    </p>
    <a href="javascript:window.close()" class="primary-btn">Return to WR Desk</a>
    <a href="javascript:window.close()" class="secondary-link">Close this tab</a>
  </div>
</body>
</html>`);

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
