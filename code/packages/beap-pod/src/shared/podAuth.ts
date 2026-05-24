/**
 * Inter-container authentication helpers for the BEAP pod.
 *
 * Every role container shares the same image. Lateral HTTP calls between
 * containers are authenticated with a single shared secret delivered via the
 * POD_AUTH_SECRET environment variable.
 *
 * Protocol:
 *   - Server-side: use createPodAuthMiddleware() to reject requests that are
 *     missing or carry an incorrect X-Pod-Auth header.
 *   - Client-side: use podAuthFetch() to get a fetch wrapper that adds the
 *     header automatically.
 *   - Startup: call requirePodAuthSecret() during role initialisation; it
 *     throws (and therefore prevents startup) if the env var is absent.
 *
 * Security notes:
 *   - Comparison is done via HMAC-SHA256 so that timingSafeEqual always
 *     operates on equal-length digests, preventing length-leak side-channels.
 *   - The HMAC key (CMP_KEY) is generated fresh at module load time and never
 *     leaves the process, so an attacker who can read only the header value
 *     cannot mount an offline dictionary attack against the comparison.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';

// Per-process normalisation key.  Never exported or logged.
const CMP_KEY: Buffer = randomBytes(32);

function hmacDigest(value: string): Buffer {
  return createHmac('sha256', CMP_KEY).update(value, 'utf8').digest();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read and return the inter-container secret from POD_AUTH_SECRET.
 *
 * Throws a descriptive error if the variable is absent or empty — intended to
 * be called during role startup so the process fails fast rather than serving
 * unauthenticated requests.
 */
export function requirePodAuthSecret(): string {
  const secret = process.env['POD_AUTH_SECRET'];
  if (!secret || secret.length === 0) {
    throw new Error(
      'POD_AUTH_SECRET environment variable is not set or is empty. ' +
        'The pod refuses to start without an inter-container shared secret.',
    );
  }
  return secret;
}

/** Connect/node:http-compatible next callback. */
export type NextFn = () => void;

/** Connect/node:http-compatible middleware signature. */
export type PodAuthMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: NextFn,
) => void;

/**
 * Return a middleware that enforces the X-Pod-Auth header.
 *
 * Responds 401 + JSON body when the header is absent or incorrect.
 * Calls next() when the header matches secret (constant-time).
 *
 * @param secret  The value that must appear in the X-Pod-Auth header.
 */
export function createPodAuthMiddleware(secret: string): PodAuthMiddleware {
  const expectedDigest = hmacDigest(secret);

  return (req: http.IncomingMessage, res: http.ServerResponse, next: NextFn): void => {
    const raw = req.headers['x-pod-auth'];
    // IncomingHttpHeaders allows string | string[] | undefined
    const provided = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');

    const ok = timingSafeEqual(hmacDigest(provided), expectedDigest);

    if (!ok) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing X-Pod-Auth header' }));
      return;
    }

    next();
  };
}

/**
 * Return a fetch wrapper that attaches the X-Pod-Auth header to every request.
 *
 * Usage:
 *   const authedFetch = podAuthFetch(requirePodAuthSecret());
 *   const res = await authedFetch('http://127.0.0.1:17181/validate', { method: 'POST', ... });
 *
 * @param secret  The value to place in the X-Pod-Auth header.
 */
export function podAuthFetch(secret: string): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set('x-pod-auth', secret);
    return fetch(input, { ...init, headers });
  };
}
