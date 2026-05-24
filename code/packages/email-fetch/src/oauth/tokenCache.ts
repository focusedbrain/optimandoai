/**
 * In-memory OAuth access-token cache (~50 min TTL, below 1-hour expiry).
 */

import type { MailFetcherCredentialPayload, OAuthRefreshResult } from '../types.js';
import { refreshGoogleAccessToken } from './googleRefresh.js';
import { refreshMicrosoftAccessToken } from './microsoftRefresh.js';

export interface CachedAccessToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

const DEFAULT_CACHE_TTL_MS = 50 * 60 * 1000;

export class AccessTokenCache {
  private readonly cache = new Map<string, CachedAccessToken>();
  private readonly ttlMs: number;

  constructor(ttlMs = DEFAULT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  clear(accountId: string): void {
    this.cache.delete(accountId);
  }

  async getAccessToken(
    accountId: string,
    creds: MailFetcherCredentialPayload,
  ): Promise<string> {
    const now = Date.now();
    const hit = this.cache.get(accountId);
    if (hit && hit.expiresAtMs > now + 30_000) {
      return hit.accessToken;
    }

    const refreshed = await this.refreshForProvider(creds);
    const expiresAtMs = now + Math.min(this.ttlMs, refreshed.expiresInSeconds * 1000);
    this.cache.set(accountId, { accessToken: refreshed.accessToken, expiresAtMs });
    return refreshed.accessToken;
  }

  private async refreshForProvider(creds: MailFetcherCredentialPayload): Promise<OAuthRefreshResult> {
    if (creds.provider === 'google') {
      return refreshGoogleAccessToken({
        clientId: creds.oauth_client_id,
        clientSecret: creds.oauth_client_secret,
        refreshToken: creds.refresh_token,
      });
    }
    return refreshMicrosoftAccessToken({
      clientId: creds.oauth_client_id,
      clientSecret: creds.oauth_client_secret,
      refreshToken: creds.refresh_token,
      tenantId: creds.tenant_id,
    });
  }
}
