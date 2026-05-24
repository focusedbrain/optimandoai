/**
 * Fetch unseen IMAP messages as raw RFC 822 bytes (OAuth XOAUTH2).
 */

import * as ImapMod from 'imap';
import type { FetchedRfc822Message, ImapOAuthSessionConfig } from '../types.js';
import { buildXoauth2Token } from './xoauth2.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ImapCtor: any = (ImapMod as any).default ?? ImapMod;

const DEFAULT_TIMEOUT_MS = 30_000;

function usesImplicitTls(security: ImapOAuthSessionConfig['imap']['security']): boolean {
  return security === 'ssl';
}

export interface FetchUnseenOptions {
  readonly timeoutMs?: number;
  readonly maxMessages?: number;
}

export async function fetchUnseenRfc822Messages(
  config: ImapOAuthSessionConfig,
  options: FetchUnseenOptions = {},
): Promise<FetchedRfc822Message[]> {
  const folder = config.folder?.trim() || 'INBOX';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxMessages = options.maxMessages ?? 20;
  const xoauth2 = buildXoauth2Token(config.email, config.accessToken);

  return new Promise((resolve, reject) => {
    let settled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = null;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        client?.end?.();
      } catch {
        /* noop */
      }
      reject(new Error(`IMAP fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const done = (err: Error | null, result?: FetchedRfc822Message[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        client?.end?.();
      } catch {
        /* noop */
      }
      if (err) reject(err);
      else resolve(result ?? []);
    };

    try {
      client = new ImapCtor({
        user: config.email,
        xoauth2,
        host: config.imap.host,
        port: config.imap.port,
        tls: usesImplicitTls(config.imap.security),
        tlsOptions: { rejectUnauthorized: true },
        connTimeout: 10_000,
        authTimeout: 10_000,
      });

      client.once('error', (err: Error) => done(err));

      client.once('ready', () => {
        client!.openBox(folder, false, (openErr: Error | null) => {
          if (openErr) {
            done(openErr);
            return;
          }

          client!.search(['UNSEEN'], (searchErr: Error | null, uids: number[]) => {
            if (searchErr) {
              done(searchErr);
              return;
            }
            if (!uids?.length) {
              done(null, []);
              return;
            }

            const slice = uids.slice(-maxMessages);
            const fetch = client!.fetch(slice, { bodies: '', struct: true });
            const messages: FetchedRfc822Message[] = [];
            let pending = slice.length;

            fetch.on('message', (msg: { on: (...args: unknown[]) => void; once: (...args: unknown[]) => void }, seqno: number) => {
              const uid = slice[seqno - 1] ?? slice[0];
              const chunks: Buffer[] = [];
              let messageId = '';
              let from = '';

              msg.on('body', (stream: NodeJS.ReadableStream) => {
                stream.on('data', (chunk: Buffer | string) => {
                  chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
                });
              });

              msg.once('attributes', (attrs: { uid?: number; envelope?: { messageId?: string; from?: Array<{ address?: string }> } }) => {
                const resolvedUid = attrs.uid ?? uid;
                messageId = attrs.envelope?.messageId ?? `uid-${resolvedUid}`;
                from = attrs.envelope?.from?.[0]?.address ?? '';
                msg.on('end', () => {
                  messages.push({
                    uid: resolvedUid,
                    messageId,
                    from,
                    rfc822: Buffer.concat(chunks),
                  });
                  pending -= 1;
                  if (pending === 0) done(null, messages);
                });
              });
            });

            fetch.once('error', (fetchErr: Error) => done(fetchErr));
          });
        });
      });
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function markImapMessageSeen(config: ImapOAuthSessionConfig, uid: number): Promise<void> {
  const folder = config.folder?.trim() || 'INBOX';
  const xoauth2 = buildXoauth2Token(config.email, config.accessToken);

  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let client: any = null;

    const done = (err?: Error) => {
      try {
        client?.end?.();
      } catch {
        /* noop */
      }
      if (err) reject(err);
      else resolve();
    };

    client = new ImapCtor({
      user: config.email,
      xoauth2,
      host: config.imap.host,
      port: config.imap.port,
      tls: usesImplicitTls(config.imap.security),
      tlsOptions: { rejectUnauthorized: true },
      connTimeout: 10_000,
      authTimeout: 10_000,
    });

    client.once('error', (err: Error) => done(err));
    client.once('ready', () => {
      client!.openBox(folder, false, (openErr: Error | null) => {
        if (openErr) {
          done(openErr);
          return;
        }
        client!.addFlags(uid, ['\\Seen'], (flagErr: Error | null) => done(flagErr ?? undefined));
      });
    });
  });
}
