/**
 * Google OAuth access-token refresh (shared desktop + mail-fetcher).
 */

import https from 'node:https';
import type { GoogleOAuthRefreshInput, OAuthRefreshResult } from '../types.js';
import { OAuthRefreshRejectedError } from '../types.js';

function postForm(url: URL, body: URLSearchParams): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const postData = body.toString();
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode ?? 0, json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} });
          } catch {
            reject(new Error('OAuth token endpoint returned non-JSON'));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

export async function refreshGoogleAccessToken(input: GoogleOAuthRefreshInput): Promise<OAuthRefreshResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    grant_type: 'refresh_token',
  });
  if (input.clientSecret) {
    body.set('client_secret', input.clientSecret);
  }

  const { status, json } = await postForm(new URL('https://oauth2.googleapis.com/token'), body);
  if (json.error) {
    const desc = typeof json.error_description === 'string' ? json.error_description : String(json.error);
    throw new OAuthRefreshRejectedError(desc);
  }
  if (status < 200 || status >= 300 || typeof json.access_token !== 'string') {
    throw new OAuthRefreshRejectedError('Google token refresh failed');
  }

  return {
    accessToken: json.access_token,
    expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : 3600,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
  };
}
