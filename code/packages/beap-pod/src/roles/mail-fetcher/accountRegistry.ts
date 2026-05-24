/**
 * In-memory account registry + decrypted credential lifecycle.
 */

import type { MailFetcherCredentialPayload } from '@repo/email-fetch';
import {
  AccessTokenCache,
  CredentialDecryptError,
  decryptCredentialBundle,
  parseAccountKeyHex,
  parseCredentialPayload,
  parseEncryptedBundle,
  zeroizeBuffer,
} from '@repo/email-fetch';
import type { CredentialStore } from './credentialStore.js';
import { startAccountLoop, type AccountLoopHandle, type AccountLoopDeps } from './accountLoop.js';
import type { IngestClient } from './ingestClient.js';
import type { MailFetcherAccountState, MailFetcherAccountStatus } from './types.js';
import { MAIL_FETCHER_ACCOUNT_EVENT } from './types.js';
import type { RoleDiagnosticRuntime } from '../../shared/roleDiagnostic.js';

export interface AccountRegistryDeps {
  readonly store: CredentialStore;
  readonly ingest: IngestClient;
  readonly tokenCache?: AccessTokenCache;
  readonly loopFactory?: (deps: AccountLoopDeps) => AccountLoopHandle;
  readonly now?: () => Date;
  readonly diagnostics?: RoleDiagnosticRuntime;
}

interface AccountRecord {
  provider: string;
  state: MailFetcherAccountState;
  lastError?: string;
  accountKey?: Buffer;
  creds?: MailFetcherCredentialPayload;
  loop?: AccountLoopHandle;
}

export class AccountRegistry {
  private readonly records = new Map<string, AccountRecord>();
  private readonly store: CredentialStore;
  private readonly ingest: IngestClient;
  private readonly tokenCache: AccessTokenCache;
  private readonly loopFactory: (deps: AccountLoopDeps) => AccountLoopHandle;
  private readonly now: () => Date;

  private readonly diagnostics?: RoleDiagnosticRuntime;

  constructor(deps: AccountRegistryDeps) {
    this.store = deps.store;
    this.ingest = deps.ingest;
    this.tokenCache = deps.tokenCache ?? new AccessTokenCache();
    this.loopFactory = deps.loopFactory ?? startAccountLoop;
    this.now = deps.now ?? (() => new Date());
    this.diagnostics = deps.diagnostics;
  }

  async restoreFromTmpfs(): Promise<void> {
    const ids = await this.store.listAccountIds();
    for (const accountId of ids) {
      if (this.records.has(accountId)) continue;
      this.records.set(accountId, {
        provider: 'unknown',
        state: 'awaiting_key',
      });
    }
  }

  async startAccount(
    accountId: string,
    provider: string,
    encryptedBundle: string | import('@repo/email-fetch').EncryptedCredentialBundleWire,
    wrappedAccountKey: string,
  ): Promise<void> {
    const bundleJson =
      typeof encryptedBundle === 'string' ? encryptedBundle : JSON.stringify(encryptedBundle);
    await this.store.writeStartFiles(accountId, bundleJson, wrappedAccountKey);
    this.records.set(accountId, {
      provider,
      state: 'awaiting_key',
      lastError: undefined,
    });
  }

  async deliverKey(accountId: string, accountKeyHex: string): Promise<void> {
    const rec = this.records.get(accountId);
    if (!rec) {
      throw new Error('account_not_found');
    }

    let accountKey: Buffer | undefined;
    try {
      accountKey = parseAccountKeyHex(accountKeyHex);
      const rawBundle = await this.store.readEncryptedBundle(accountId);
      const wire = parseEncryptedBundle(JSON.parse(rawBundle));
      const plain = decryptCredentialBundle(wire, accountKey);
      const creds = parseCredentialPayload(plain);

      if (rec.loop) {
        await rec.loop.stop();
      }

      const logger = createAccountLogger(accountId);
      const loop = this.loopFactory({
        accountId,
        creds,
        ingest: this.ingest,
        tokenCache: this.tokenCache,
        logger,
        diagnostics: this.diagnostics,
      });

      rec.creds = creds;
      rec.accountKey = accountKey;
      rec.loop = loop;
      rec.state = loop.isDegraded() ? 'degraded' : 'active';
      rec.lastError = undefined;
    } catch (err) {
      if (accountKey) zeroizeBuffer(accountKey);
      rec.state = 'awaiting_key';
      rec.lastError =
        err instanceof CredentialDecryptError ? err.message : err instanceof Error ? err.message : 'deliver_key_failed';
      throw err;
    }
  }

  async stopAccount(accountId: string): Promise<void> {
    const rec = this.records.get(accountId);
    if (rec?.loop) {
      await rec.loop.stop();
    }
    if (rec?.accountKey) {
      zeroizeBuffer(rec.accountKey);
    }
    this.tokenCache.clear(accountId);
    await this.store.removeAccountFiles(accountId);
    this.records.set(accountId, {
      provider: rec?.provider ?? 'unknown',
      state: 'stopped',
    });
  }

  getStatus(): MailFetcherAccountStatus[] {
    const out: MailFetcherAccountStatus[] = [];
    for (const [accountId, rec] of this.records.entries()) {
      const state = rec.loop?.isDegraded() ? 'degraded' : rec.state;
      out.push({
        account_id: accountId,
        provider: rec.provider,
        state,
        last_fetch_at: rec.loop?.getLastFetchAt(),
        last_error: rec.loop?.getLastError() ?? rec.lastError,
      });
    }
    return out;
  }

  /** Test hook — expose decrypted creds presence without logging secrets. */
  hasDecryptedCreds(accountId: string): boolean {
    return !!this.records.get(accountId)?.creds;
  }
}

function createAccountLogger(accountId: string): AccountLoopDeps['logger'] {
  return {
    info(message: string) {
      // Safe log line — account_id only, no credential material.
      console.log(`[mail-fetcher] ${message}`);
    },
    structured(event) {
      console.log(JSON.stringify(event));
    },
  };
}

export { createAccountLogger };
