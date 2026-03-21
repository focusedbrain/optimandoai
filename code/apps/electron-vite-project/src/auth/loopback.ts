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
      const reqUrl = req.url ?? '/';
      console.log(`[AUTH] Loopback request: ${req.method} ${reqUrl}`);

      // Only accept GET requests
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      const url = new URL(reqUrl, 'http://127.0.0.1');

      // Only accept the exact callback path (favicon, probes, etc. are ignored)
      if (url.pathname !== callbackPath) {
        console.log(`[AUTH] Loopback 404: expected=${callbackPath}, got=${url.pathname}`);
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
  <title>Authentication Complete - WR Desk</title>
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
    .card {
      text-align: center;
      padding: 48px 40px;
      max-width: 460px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04);
    }
    .logo {
      margin-bottom: 32px;
    }
    .logo img,
    .logo svg {
      width: 120px;
      height: auto;
      display: block;
      margin: 0 auto;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    .status svg {
      width: 20px;
      height: 20px;
      stroke: #22c55e;
      stroke-width: 2.5;
      fill: none;
    }
    .status span {
      font-size: 14px;
      font-weight: 500;
      color: #166534;
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
      line-height: 1.7;
    }
    .accordion-section {
      margin-top: 28px;
      padding-top: 24px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .accordion {
      text-align: left;
    }
    .accordion-toggle {
      background: none;
      border: none;
      font-size: 13px;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 8px 0;
    }
    .accordion-toggle:hover {
      color: #64748b;
    }
    .accordion-toggle svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      stroke-width: 2;
      fill: none;
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }
    .accordion-content {
      display: none;
      margin-top: 8px;
      font-size: 13px;
      color: #64748b;
      line-height: 1.6;
      background: #f8fafc;
      padding: 14px 16px;
      border-radius: 8px;
    }
    .accordion-content.open {
      display: block;
    }
    .accordion-content ol {
      margin: 8px 0 0 20px;
    }
    .accordion-content li {
      margin-bottom: 6px;
    }
    .accordion-content p {
      margin: 0;
    }
  </style>
  <script>
    function toggleAccordion(id, btn) {
      var el = document.getElementById(id);
      var isOpen = el.classList.toggle('open');
      btn.querySelector('svg').style.transform = isOpen ? 'rotate(180deg)' : '';
    }
  </script>
</head>
<body>
  <div class="card">
    <div class="logo" role="img" aria-label="WR Desk">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" style="background:transparent">
        <path d="M60 8 L108 26 L108 82 Q108 120 60 142 Q12 120 12 82 L12 26 Z" fill="white" stroke="#1a1a1a" stroke-width="5"/>
        <path d="M60 18 L98 33 L98 78 Q98 110 60 128 Q22 110 22 78 L22 33 Z" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>
        <circle cx="60" cy="25" r="10" fill="#22c55e"/>
        <path d="M54 25 L58 29 L67 20" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="60" y="70" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-size="34" font-weight="900" fill="#1a1a1a">WR</text>
        <text x="60" y="98" text-anchor="middle" font-family="Arial Black, Impact, sans-serif" font-size="24" font-weight="900" fill="#1a1a1a">DESK</text>
        <circle cx="60" cy="122" r="16" fill="#1a1a1a"/>
        <path d="M51 116 L51 110 Q51 101 60 101 Q69 101 69 110 L69 116" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round"/>
        <rect x="49" y="116" width="22" height="15" rx="2" fill="white"/>
        <circle cx="60" cy="121" r="2.5" fill="#1a1a1a"/>
        <rect x="58.5" y="121" width="3" height="6" fill="#1a1a1a"/>
      </svg>
    </div>
    <div class="status">
      <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>Authentication successful</span>
    </div>
    <h1>You're signed in to WR Desk</h1>
    <p class="message">
      Your session is now active. You can continue browsing and access the AI Orchestrator from the WR Desk extension in your browser toolbar.
    </p>
    <div class="accordion-section">
      <div class="accordion">
        <button class="accordion-toggle" onclick="toggleAccordion('help-extension', this)">
          <span>If you don't see the extension</span>
          <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div id="help-extension" class="accordion-content">
          <ol>
            <li>Click the puzzle icon in your browser toolbar</li>
            <li>Find "WR Desk" in the extensions list</li>
            <li>Click the pin icon to keep it visible</li>
          </ol>
        </div>
      </div>
      <div class="accordion">
        <button class="accordion-toggle" onclick="toggleAccordion('help-sso', this)">
          <span>About sign-out and SSO</span>
          <svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div id="help-sso" class="accordion-content">
          <p>WR Desk uses Single Sign-On (SSO) for a unified authentication experience. When you sign out from wrdesk.com, all linked WR Desk sessions—including the browser extension and desktop orchestrator—will also be signed out.</p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);

      // Resolve with result
      console.log('[AUTH] Loopback callback handled successfully, resolving code');
      resolveCode({ code, state, error, error_description });

      // Close server after a delay to ensure the response is fully sent to the browser.
      // Without this delay, server.close() can terminate the socket before the browser
      // receives the full HTML response, causing ERR_CONNECTION_REFUSED.
      // 5 seconds gives ample time for the HTML to render before the server shuts down.
      setTimeout(() => {
        try { server.close(); } catch (_) { /* ignore */ }
      }, 5000);
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
