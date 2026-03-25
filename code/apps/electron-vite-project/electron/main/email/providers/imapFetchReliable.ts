/**
 * Drop-in path for gateway `listMessages` (IMAP only): fresh TCP connection per call,
 * seq.fetch + client-side date filter, hard timeout — avoids hung or stale cached sessions.
 */

import * as ImapMod from 'imap'
import type { EmailAccountConfig, MessageSearchOptions } from '../types'
import type { RawEmailMessage } from './base'
import { imapUsesImplicitTls } from '../domain/securityModeNormalize'
import { IMAP_FETCH_RELIABLE_MS } from '../imapSyncTelemetry'

const ImapCtor = (ImapMod as any).default ?? ImapMod

function parseEmailAddress(addr: string): { email: string; name?: string } {
  if (!addr) return { email: '' }
  const match = addr.match(/^([^<]*)<([^>]+)>$/)
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, '')
    const email = match[2].trim().toLowerCase()
    return name ? { email, name } : { email }
  }
  return { email: addr.trim().toLowerCase() }
}

function parseEmailAddresses(headerValue: string): Array<{ email: string; name?: string }> {
  if (!headerValue) return []
  const addresses: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of headerValue) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      if (current.trim()) addresses.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) addresses.push(current.trim())
  return addresses.map((a) => parseEmailAddress(a))
}

/**
 * Reliable IMAP fetch — own connection, seq.fetch only, timeout, client-side date filter.
 * Does not use the gateway provider cache.
 */
export async function imapFetchReliable(
  account: EmailAccountConfig,
  folder: string,
  options?: MessageSearchOptions,
): Promise<RawEmailMessage[]> {
  const imapConfig = account.imap
  if (!imapConfig) throw new Error('No IMAP config on account')
  if (!imapConfig.password || String(imapConfig.password).trim().length === 0) {
    throw new Error('IMAP password is empty — reconnect the account')
  }

  const useFolder = (folder || 'INBOX').trim() || 'INBOX'
  const useImplicitTls = imapUsesImplicitTls(imapConfig.security)

  return new Promise<RawEmailMessage[]>((resolve, reject) => {
    let settled = false
    let client: InstanceType<typeof ImapCtor> | null = null

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.error(
        '[IMAP-SYNC-PHASE]',
        JSON.stringify({
          event: 'imapFetchReliable_timeout',
          phase: 'imapFetchReliable',
          accountId: account.id,
          folder: useFolder,
          timeoutMs: IMAP_FETCH_RELIABLE_MS,
        }),
      )
      console.error('[imapFetchReliable] TIMEOUT after', IMAP_FETCH_RELIABLE_MS, 'ms for account', account.id)
      try {
        client?.end?.()
      } catch {
        /* noop */
      }
      reject(
        new Error(
          `IMAP fetch timed out after ${IMAP_FETCH_RELIABLE_MS / 1000}s (phase=imapFetchReliable folder=${JSON.stringify(useFolder)})`,
        ),
      )
    }, IMAP_FETCH_RELIABLE_MS)

    const done = (err: Error | null, result?: RawEmailMessage[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        client?.end?.()
      } catch {
        /* noop */
      }
      if (err) reject(err)
      else resolve(result ?? [])
    }

    try {
      if (typeof ImapCtor !== 'function') {
        done(new Error('[imapFetchReliable] imap constructor unavailable'))
        return
      }

      client = new ImapCtor({
        user: imapConfig.username,
        password: imapConfig.password,
        host: imapConfig.host,
        port: imapConfig.port,
        tls: useImplicitTls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10_000,
        authTimeout: 10_000,
      })

      client.once('error', (err: Error) => {
        console.error('[imapFetchReliable] connection error:', err?.message || err)
        done(err)
      })

      client.once('ready', () => {
        client!.openBox(useFolder, true, (err: Error | null, box: { messages?: { total?: number } }) => {
          if (err) {
            done(err)
            return
          }

          const total = box?.messages?.total ?? 0
          if (total === 0) {
            done(null, [])
            return
          }

          let fetchCount = options?.syncMaxMessages ?? options?.limit ?? 50
          if (options?.syncFetchAllPages) {
            fetchCount = Math.min(total, options?.syncMaxMessages ?? 500)
          }
          fetchCount = Math.max(1, Math.min(fetchCount, total))

          /** Pull More: oldest seq range; else newest window (matches ImapProvider.fetchMessages). */
          const seqStart = options?.toDate && !options?.fromDate ? 1 : Math.max(1, total - fetchCount + 1)
          const seqEnd = options?.toDate && !options?.fromDate ? fetchCount : total
          const range = `${seqStart}:${seqEnd}`

          const messages: RawEmailMessage[] = []

          let fetch: ReturnType<NonNullable<typeof client>['seq']['fetch']>
          try {
            fetch = client!.seq.fetch(range, {
              bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)'],
              struct: true,
            })
          } catch (fetchErr: unknown) {
            done(fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)))
            return
          }

          fetch.on('message', (msg: import('imap').ImapMessage) => {
            const msgData: Partial<RawEmailMessage> = {
              id: '',
              folder: useFolder,
              flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false },
              labels: [],
            }

            msg.on('body', (stream, info) => {
              let buffer = ''
              stream.on('data', (chunk: Buffer | string) => {
                buffer += chunk.toString('utf8')
              })
              stream.once('end', () => {
                if (info.which.includes('HEADER')) {
                  const headers = ImapCtor.parseHeader(buffer)
                  msgData.subject = headers.subject?.[0] || '(No Subject)'
                  msgData.from = parseEmailAddress(headers.from?.[0] || '')
                  msgData.to = parseEmailAddresses(headers.to?.[0] || '')
                  msgData.cc = parseEmailAddresses(headers.cc?.[0] || '')
                  msgData.date = new Date(headers.date?.[0] || Date.now())
                  msgData.headers = {
                    messageId: headers['message-id']?.[0],
                    inReplyTo: headers['in-reply-to']?.[0],
                    references: headers.references?.[0]?.split(/\s+/) || [],
                  }
                }
              })
            })

            msg.once('attributes', (attrs: { uid?: number; flags?: string[] }) => {
              const uidStr = String(attrs.uid ?? '')
              msgData.id = uidStr
              msgData.uid = uidStr
              if (attrs.flags) {
                msgData.flags = {
                  seen: attrs.flags.includes('\\Seen'),
                  flagged: attrs.flags.includes('\\Flagged'),
                  answered: attrs.flags.includes('\\Answered'),
                  draft: attrs.flags.includes('\\Draft'),
                  deleted: attrs.flags.includes('\\Deleted'),
                }
              }
            })

            msg.once('end', () => {
              if (msgData.date == null) {
                msgData.date = new Date()
              }
              messages.push(msgData as RawEmailMessage)
            })
          })

          fetch.once('error', (fetchErr: Error) => {
            console.error('[imapFetchReliable] fetch error:', fetchErr?.message || fetchErr)
            done(fetchErr)
          })

          fetch.once('end', () => {
            let result = messages
            if (options?.fromDate) {
              const since = new Date(options.fromDate).getTime()
              if (!Number.isNaN(since)) {
                result = result.filter((m) => m.date.getTime() >= since)
              }
            }
            if (options?.toDate) {
              const before = new Date(options.toDate).getTime()
              if (!Number.isNaN(before)) {
                result = result.filter((m) => m.date.getTime() < before)
              }
            }
            result.sort((a, b) => Number(b.uid || b.id) - Number(a.uid || a.id))
            done(null, result)
          })
        })
      })

      client.connect()
    } catch (outerErr: unknown) {
      done(outerErr instanceof Error ? outerErr : new Error(String(outerErr)))
    }
  })
}
