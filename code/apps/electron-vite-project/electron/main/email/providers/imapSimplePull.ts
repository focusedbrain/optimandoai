/** IMAP list via seq.fetch on newest N by sequence number only (no SEARCH). fromDate filtered client-side. */
import * as ImapMod from 'imap'
import type { RawEmailMessage } from './base'
import type { EmailAccountConfig, MessageSearchOptions } from '../types'
import { imapUsesImplicitTls } from '../domain/securityModeNormalize'

const ImapCtor = (ImapMod as any).default ?? ImapMod

function parseOne(s: string): { email: string; name?: string } {
  if (!s) return { email: '' }
  const m = s.match(/^([^<]*)<([^>]+)>$/)
  if (m) {
    const name = m[1].trim().replace(/^["']|["']$/g, '')
    const email = m[2].trim().toLowerCase()
    return name ? { email, name } : { email }
  }
  return { email: s.trim().toLowerCase() }
}

function parseMany(h: string): Array<{ email: string; name?: string }> {
  if (!h) return []
  const parts: string[] = []
  let cur = ''
  let q = false
  for (const c of h) {
    if (c === '"') q = !q
    else if (c === ',' && !q) {
      if (cur.trim()) parts.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.map(parseOne)
}
function postFilter(rows: RawEmailMessage[], o?: MessageSearchOptions): RawEmailMessage[] {
  let out = rows
  const ft = o?.fromDate ? new Date(o.fromDate).getTime() : NaN
  if (!Number.isNaN(ft)) out = out.filter((m) => m.date.getTime() >= ft)
  const tt = o?.toDate ? new Date(o.toDate).getTime() : NaN
  if (!Number.isNaN(tt)) out = out.filter((m) => m.date.getTime() < tt)
  if (o?.unreadOnly) out = out.filter((m) => !m.flags.seen)
  if (o?.flaggedOnly) out = out.filter((m) => m.flags.flagged)
  out.sort((a, b) => b.date.getTime() - a.date.getTime())
  let lim = o?.limit ?? 50
  if (o?.syncFetchAllPages) lim = o.syncMaxMessages != null ? Math.max(1, o.syncMaxMessages) : out.length
  return out.length > lim ? out.slice(0, lim) : out
}

export async function imapSimplePullListMessages(
  account: EmailAccountConfig,
  folder: string,
  options?: MessageSearchOptions,
): Promise<RawEmailMessage[]> {
  const im = account.imap
  if (!im?.password?.trim()) throw new Error('IMAP password missing')
  if (typeof ImapCtor !== 'function') throw new Error('imap module did not load')
  const client = new ImapCtor({
    user: im.username,
    password: im.password,
    host: im.host,
    port: im.port,
    tls: imapUsesImplicitTls(im.security),
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 10000,
    authTimeout: 10000,
  })
  await new Promise<void>((resolve, reject) => {
    client.once('error', reject)
    client.once('ready', () => {
      client.removeAllListeners('error')
      client.on('error', () => {})
      resolve()
    })
    client.connect()
  })
  try {
    const rows = await new Promise<RawEmailMessage[]>((resolve, reject) => {
      client.openBox(folder, true, (err: Error | null, box?: { messages: { total: number } }) => {
        if (err) {
          reject(err)
          return
        }
        const total = box?.messages.total ?? 0
        if (total === 0) {
          resolve([])
          return
        }
        let n = Math.max(1, options?.limit ?? 50)
        if (options?.syncFetchAllPages && options.syncMaxMessages != null) {
          n = Math.max(n, Math.min(Math.max(1, options.syncMaxMessages), 50000))
        } else if (options?.syncFetchAllPages) n = Math.max(n, 500)
        if (options?.fromDate) n = Math.max(n, 400)
        n = Math.min(total, n)
        const start = Math.max(1, total - n + 1)
        const acc: RawEmailMessage[] = []
        const fetch = client.seq.fetch(`${start}:${total}`, {
          bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)'],
          struct: true,
        })
        const blank = { seen: false, flagged: false, answered: false, draft: false, deleted: false }
        fetch.on('message', (msg: any) => {
          const msgData: Partial<RawEmailMessage> = { id: '', folder, flags: { ...blank }, labels: [] }
          msg.on('body', (stream: NodeJS.ReadableStream, info: { which: string }) => {
            let buf = ''
            stream.on('data', (c: Buffer | string) => {
              buf += c.toString('utf8')
            })
            stream.once('end', () => {
              if (!info.which.includes('HEADER')) return
              const h = ImapCtor.parseHeader(buf)
              msgData.subject = h.subject?.[0] || '(No Subject)'
              msgData.from = parseOne(h.from?.[0] || '')
              msgData.to = parseMany(h.to?.[0] || '')
              msgData.cc = parseMany(h.cc?.[0] || '')
              msgData.date = new Date(h.date?.[0] || Date.now())
              msgData.headers = {
                messageId: h['message-id']?.[0],
                inReplyTo: h['in-reply-to']?.[0],
                references: h.references?.[0]?.split(/\s+/) || [],
              }
            })
          })
          msg.once('attributes', (attrs: { uid?: number; flags?: string[] }) => {
            msgData.id = String(attrs.uid ?? '')
            msgData.uid = msgData.id
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
          msg.once('end', () => acc.push(msgData as RawEmailMessage))
        })
        fetch.once('error', reject)
        fetch.once('end', () => resolve(acc))
      })
    })
    return postFilter(rows, options)
  } finally {
    try {
      client.end()
    } catch {}
  }
}
