/**
 * Per-account fetch loop — OAuth refresh, IMAP fetch, ingest handoff.
 */

import type {
  FetchedRfc822Message,
  MailFetcherCredentialPayload,
} from '@repo/email-fetch';
import {
  AccessTokenCache,
  OAuthRefreshRejectedError,
  fetchUnseenRfc822Messages,
  markImapMessageSeen,
  resolveImapConfig,
} from '@repo/email-fetch';
import type { IngestClient } from './ingestClient.js';
import type { MailFetcherStructuredLog } from './types.js';
import { MAIL_FETCHER_ACCOUNT_EVENT } from './types.js';

export interface AccountLoopLogger {
  info(message: string): void;
  structured(event: MailFetcherStructuredLog): void;
}

export interface AccountLoopDeps {
  readonly accountId: string;
  readonly creds: MailFetcherCredentialPayload;
  readonly ingest: IngestClient;
  readonly tokenCache: AccessTokenCache;
  readonly logger: AccountLoopLogger;
  readonly pollIntervalMs?: number;
  readonly fetchUnseen?: typeof fetchUnseenRfc822Messages;
  readonly markSeen?: typeof markImapMessageSeen;
}

export interface AccountLoopHandle {
  stop(): Promise<void>;
  getLastFetchAt(): string | undefined;
  getLastError(): string | undefined;
  isDegraded(): boolean;
}

export function startAccountLoop(deps: AccountLoopDeps): AccountLoopHandle {
  const pollIntervalMs = deps.pollIntervalMs ?? 60_000;
  const fetchUnseen = deps.fetchUnseen ?? fetchUnseenRfc822Messages;
  const markSeen = deps.markSeen ?? markImapMessageSeen;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = pollIntervalMs;
  let lastFetchAt: string | undefined;
  let lastError: string | undefined;
  let degraded = false;
  let inFlight = false;

  const imapConfig = resolveImapConfig(deps.creds.provider, deps.creds.imap);

  const log = deps.logger;

  async function runCycle(): Promise<void> {
    if (stopped || inFlight || degraded) return;
    inFlight = true;
    try {
      const accessToken = await deps.tokenCache.getAccessToken(deps.accountId, deps.creds);
      const session = {
        email: deps.creds.email,
        accessToken,
        imap: imapConfig,
        folder: 'INBOX',
      };

      const messages = await fetchUnseen(session, { maxMessages: 20 });
      for (const msg of messages) {
        await handleMessage(msg, accessToken);
      }

      lastFetchAt = new Date().toISOString();
      lastError = undefined;
      backoffMs = pollIntervalMs;
    } catch (err) {
      if (err instanceof OAuthRefreshRejectedError) {
        degraded = true;
        lastError = 'refresh_token_rejected';
        log.structured({
          type: MAIL_FETCHER_ACCOUNT_EVENT,
          account_id: deps.accountId,
          event: 'refresh_token_rejected',
          category: 'auth',
        });
        return;
      }
      lastError = err instanceof Error ? err.message : 'fetch_error';
      log.structured({
        type: MAIL_FETCHER_ACCOUNT_EVENT,
        account_id: deps.accountId,
        event: 'fetch_error',
        category: 'network',
      });
      backoffMs = Math.min(backoffMs * 2, 15 * 60_000);
    } finally {
      inFlight = false;
      scheduleNext();
    }
  }

  async function handleMessage(msg: FetchedRfc822Message, accessToken: string): Promise<void> {
    const result = await deps.ingest.postMessage({
      accountId: deps.accountId,
      messageId: msg.messageId || `uid-${msg.uid}`,
      from: msg.from,
      recipient: deps.creds.email,
      rfc822: msg.rfc822,
    });

    if (!result.ok) {
      log.structured({
        type: MAIL_FETCHER_ACCOUNT_EVENT,
        account_id: deps.accountId,
        event: 'ingest_rejected',
        category: 'ingest',
      });
      throw new Error(`ingestor returned ${result.status}`);
    }

    await markSeen(
      {
        email: deps.creds.email,
        accessToken,
        imap: imapConfig,
        folder: 'INBOX',
      },
      msg.uid,
    );
  }

  function scheduleNext(): void {
    if (stopped || degraded) return;
    timer = setTimeout(() => void runCycle(), backoffMs);
  }

  log.info(`account loop started account_id=${deps.accountId}`);
  void runCycle();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      deps.tokenCache.clear(deps.accountId);
      log.info(`account loop stopped account_id=${deps.accountId}`);
    },
    getLastFetchAt: () => lastFetchAt,
    getLastError: () => lastError,
    isDegraded: () => degraded,
  };
}
