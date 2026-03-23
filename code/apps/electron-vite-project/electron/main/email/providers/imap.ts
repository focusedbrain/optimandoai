/**
 * IMAP Provider
 * 
 * Email provider implementation for IMAP servers.
 * Supports WEB.DE, GMX, Yahoo, iCloud, AOL, and custom IMAP servers.
 */

import * as ImapMod from 'imap'
import * as nodemailer from 'nodemailer'
import type ImapApi from 'imap'
import { simpleParser, ParsedMail } from 'mailparser'
import { 
  BaseEmailProvider, 
  RawEmailMessage, 
  RawAttachment, 
  FolderInfo 
} from './base'
import { 
  EmailAccountConfig, 
  MessageSearchOptions, 
  SendEmailPayload, 
  SendResult,
  type ImapLifecycleValidationEntry,
  type ImapLifecycleValidationResult,
} from '../types'
import type {
  OrchestratorRemoteOperation,
  OrchestratorRemoteApplyResult,
  OrchestratorRemoteApplyContext,
} from '../domain/orchestratorRemoteTypes'
import { resolveOrchestratorRemoteNames } from '../domain/mailboxLifecycleMapping'

export type { ImapLifecycleValidationEntry, ImapLifecycleValidationResult } from '../types'

/** Runtime constructor: bundled ESM may expose CJS `module.exports` as `.default`. */
const ImapCtor = (ImapMod as any).default ?? ImapMod

/** Connection instance type from @types/imap (`export = Connection`). */
type ImapConnection = ImapApi

function imapFolderListHasMailbox(folders: FolderInfo[], want: string): boolean {
  const w = want.toLowerCase().trim()
  if (!w) return false
  return folders.some((f) => {
    const n = f.name.toLowerCase()
    const p = f.path.toLowerCase()
    const d = f.delimiter || '/'
    return n === w || p === w || p.endsWith(`${d}${w}`)
  })
}

/** Nodemailer transport options aligned with SecurityMode (SSL/465 vs STARTTLS/587). */
export function createSmtpTransport(smtp: NonNullable<EmailAccountConfig['smtp']>) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'ssl',
    requireTLS: smtp.security === 'starttls',
    auth: {
      user: smtp.username,
      pass: smtp.password
    },
    tls: { rejectUnauthorized: false }
  })
}

/**
 * IMAP Provider class
 */
export class ImapProvider extends BaseEmailProvider {
  readonly providerType = 'imap' as const
  
  private client: ImapConnection | null = null
  private transporter: nodemailer.Transporter | null = null
  private messageCache: Map<string, RawEmailMessage> = new Map()
  
  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.imap) {
      throw new Error('IMAP configuration required')
    }
    
    this.config = config

    if (typeof ImapCtor !== 'function') {
      const keys =
        ImapMod && typeof ImapMod === 'object' ? Object.keys(ImapMod as object).join(', ') : String(ImapMod)
      throw new Error(
        `[IMAP] imap package interop failed: expected constructor function, got ${typeof ImapCtor}. Module keys: ${keys}`,
      )
    }

    return new Promise((resolve, reject) => {
      const client = new ImapCtor({
        user: config.imap!.username,
        password: config.imap!.password,
        host: config.imap!.host,
        port: config.imap!.port,
        tls: config.imap!.security === 'ssl',
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000
      })
      this.client = client

      client.once('ready', () => {
        console.log('[IMAP] Connected to:', config.imap!.host)
        this.connected = true
        resolve()
      })

      client.once('error', (err: Error) => {
        console.error('[IMAP] Connection error:', err)
        this.connected = false
        reject(err)
      })

      client.once('end', () => {
        console.log('[IMAP] Connection ended')
        this.connected = false
      })

      client.connect()
    })
  }
  
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.end()
      this.client = null
    }
    if (this.transporter) {
      this.transporter.close()
      this.transporter = null
    }
    this.connected = false
    this.config = null
    this.messageCache.clear()
  }
  
  async testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connect(config)
      await this.disconnect()
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || 'Connection failed' }
    }
  }

  /**
   * Verify SMTP authentication and TLS handshake (does not send a message).
   */
  static async testSmtpConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.smtp) {
      return { success: false, error: 'SMTP is not configured' }
    }
    const transporter = createSmtpTransport(config.smtp)
    try {
      await transporter.verify()
      transporter.close()
      return { success: true }
    } catch (err: any) {
      try { transporter.close() } catch { /* ignore */ }
      const msg = err?.message || err?.response || 'SMTP connection failed'
      return {
        success: false,
        error: typeof msg === 'string' ? msg : 'SMTP connection failed'
      }
    }
  }
  
  async listFolders(): Promise<FolderInfo[]> {
    if (!this.client) {
      throw new Error('Not connected')
    }
    
    return new Promise((resolve, reject) => {
      this.client!.getBoxes((err, boxes) => {
        if (err) {
          reject(err)
          return
        }
        
        const folders: FolderInfo[] = []
        
        const processBoxes = (boxObj: ImapApi.MailBoxes, prefix = '') => {
          for (const [name, box] of Object.entries(boxObj)) {
            const path = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name
            folders.push({
              name,
              path,
              delimiter: box.delimiter || '/',
              flags: box.attribs || [],
              totalMessages: 0,
              unreadMessages: 0
            })
            
            if (box.children) {
              processBoxes(box.children, path)
            }
          }
        }
        
        processBoxes(boxes)
        resolve(folders)
      })
    })
  }
  
  /**
   * SEARCH SINCE → sequence numbers; fetch headers in chunks via `seq.fetch` (search returns seq, not UID).
   */
  private fetchMessagesSince(folder: string, since: Date, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = Math.min(Math.max(1, options?.syncMaxMessages ?? (syncAll ? 25_000 : limit)), 100_000)
    const chunkSize = 60

    const attachParser = (msg: ImapConnection.ImapMessage, msgData: Partial<RawEmailMessage>) => {
      msg.on('body', (stream, info) => {
        let buffer = ''
        stream.on('data', (chunk) => {
          buffer += chunk.toString('utf8')
        })
        stream.once('end', () => {
          if (info.which.includes('HEADER')) {
            const headers = ImapCtor.parseHeader(buffer)
            msgData.subject = headers.subject?.[0] || '(No Subject)'
            msgData.from = this.parseEmailAddress(headers.from?.[0] || '')
            msgData.to = this.parseEmailAddresses(headers.to?.[0] || '')
            msgData.cc = this.parseEmailAddresses(headers.cc?.[0] || '')
            msgData.date = new Date(headers.date?.[0] || Date.now())
            msgData.headers = {
              messageId: headers['message-id']?.[0],
              inReplyTo: headers['in-reply-to']?.[0],
              references: headers.references?.[0]?.split(/\s+/) || [],
            }
          }
        })
      })
      msg.once('attributes', (attrs) => {
        msgData.id = String(attrs.uid)
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
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err) => {
        if (err) {
          reject(err)
          return
        }
        this.client!.search([['SINCE', since]], (sErr, seqnums: number[]) => {
          if (sErr) {
            reject(sErr)
            return
          }
          if (!seqnums?.length) {
            resolve([])
            return
          }
          const sorted = [...seqnums].sort((a, b) => a - b)
          let pick = syncAll ? sorted : sorted.slice(Math.max(0, sorted.length - limit))
          if (pick.length > maxM) {
            pick = pick.slice(-maxM)
          }

          const all: RawEmailMessage[] = []
          let i = 0

          const nextChunk = () => {
            if (i >= pick.length) {
              resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
              return
            }
            const slice = pick.slice(i, i + chunkSize)
            i += chunkSize
            const spec = slice.join(',')
            const batch: RawEmailMessage[] = []
            const fetch = this.client!.seq.fetch(spec, {
              bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
              struct: true,
            })
            fetch.on('message', (msg) => {
              const msgData: Partial<RawEmailMessage> = {
                id: '',
                folder,
                flags: {
                  seen: false,
                  flagged: false,
                  answered: false,
                  draft: false,
                  deleted: false,
                },
                labels: [],
              }
              attachParser(msg, msgData)
              msg.once('end', () => {
                batch.push(msgData as RawEmailMessage)
              })
            })
            fetch.once('error', reject)
            fetch.once('end', () => {
              all.push(...batch)
              nextChunk()
            })
          }

          nextChunk()
        })
      })
    })
  }

  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    if (!this.client) {
      throw new Error('Not connected')
    }

    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = Math.min(Math.max(1, options?.syncMaxMessages ?? (syncAll ? 25_000 : limit)), 100_000)
    const chunkSize = 60

    if (options?.fromDate) {
      const since = new Date(options.fromDate)
      if (!Number.isNaN(since.getTime())) {
        return this.fetchMessagesSince(folder, since, options)
      }
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err, box) => {
        if (err) {
          reject(err)
          return
        }

        const total = box.messages.total
        if (total === 0) {
          resolve([])
          return
        }

        if (!syncAll) {
          const start = Math.max(1, total - limit + 1)
          const end = total
          const messages: RawEmailMessage[] = []
          const fetch = this.client!.seq.fetch(`${start}:${end}`, {
            bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
            struct: true,
          })
          fetch.on('message', (msg) => {
            const msgData: Partial<RawEmailMessage> = {
              id: '',
              folder,
              flags: {
                seen: false,
                flagged: false,
                answered: false,
                draft: false,
                deleted: false,
              },
              labels: [],
            }
            msg.on('body', (stream, info) => {
              let buffer = ''
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8')
              })
              stream.once('end', () => {
                if (info.which.includes('HEADER')) {
                  const headers = ImapCtor.parseHeader(buffer)
                  msgData.subject = headers.subject?.[0] || '(No Subject)'
                  msgData.from = this.parseEmailAddress(headers.from?.[0] || '')
                  msgData.to = this.parseEmailAddresses(headers.to?.[0] || '')
                  msgData.cc = this.parseEmailAddresses(headers.cc?.[0] || '')
                  msgData.date = new Date(headers.date?.[0] || Date.now())
                  msgData.headers = {
                    messageId: headers['message-id']?.[0],
                    inReplyTo: headers['in-reply-to']?.[0],
                    references: headers.references?.[0]?.split(/\s+/) || [],
                  }
                }
              })
            })
            msg.once('attributes', (attrs) => {
              msgData.id = String(attrs.uid)
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
              messages.push(msgData as RawEmailMessage)
            })
          })
          fetch.once('error', reject)
          fetch.once('end', () => {
            resolve(messages.reverse())
          })
          return
        }

        const all: RawEmailMessage[] = []
        let startSeq = 1

        const nextRange = () => {
          if (startSeq > total || all.length >= maxM) {
            resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
            return
          }
          const endSeq = Math.min(total, startSeq + chunkSize - 1)
          const spec = `${startSeq}:${endSeq}`
          startSeq = endSeq + 1
          const batch: RawEmailMessage[] = []
          const fetch = this.client!.seq.fetch(spec, {
            bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
            struct: true,
          })
          fetch.on('message', (msg) => {
            const msgData: Partial<RawEmailMessage> = {
              id: '',
              folder,
              flags: {
                seen: false,
                flagged: false,
                answered: false,
                draft: false,
                deleted: false,
              },
              labels: [],
            }
            msg.on('body', (stream, info) => {
              let buffer = ''
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8')
              })
              stream.once('end', () => {
                if (info.which.includes('HEADER')) {
                  const headers = ImapCtor.parseHeader(buffer)
                  msgData.subject = headers.subject?.[0] || '(No Subject)'
                  msgData.from = this.parseEmailAddress(headers.from?.[0] || '')
                  msgData.to = this.parseEmailAddresses(headers.to?.[0] || '')
                  msgData.cc = this.parseEmailAddresses(headers.cc?.[0] || '')
                  msgData.date = new Date(headers.date?.[0] || Date.now())
                  msgData.headers = {
                    messageId: headers['message-id']?.[0],
                    inReplyTo: headers['in-reply-to']?.[0],
                    references: headers.references?.[0]?.split(/\s+/) || [],
                  }
                }
              })
            })
            msg.once('attributes', (attrs) => {
              msgData.id = String(attrs.uid)
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
              batch.push(msgData as RawEmailMessage)
            })
          })
          fetch.once('error', reject)
          fetch.once('end', () => {
            for (const m of batch) {
              if (all.length >= maxM) break
              all.push(m)
            }
            nextRange()
          })
        }

        nextRange()
      })
    })
  }
  
  async fetchMessage(messageId: string): Promise<RawEmailMessage | null> {
    if (!this.client) {
      throw new Error('Not connected')
    }
    
    // Check cache first
    const cached = this.messageCache.get(messageId)
    if (cached) {
      return cached
    }
    
    const folder = this.config?.folders.inbox || 'INBOX'
    
    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err) => {
        if (err) {
          reject(err)
          return
        }
        
        const fetch = this.client!.fetch(messageId, {
          bodies: '',
          struct: true
        })
        
        let message: RawEmailMessage | null = null
        
        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.once('end', () => {
              const buffer = Buffer.concat(chunks)
              simpleParser(buffer)
                .then((parsed: ParsedMail) => {
                  // Helper to extract addresses from AddressObject or AddressObject[]
                  const getAddresses = (addr: any): Array<{ email: string; name?: string }> => {
                    if (!addr) return []
                    const values = Array.isArray(addr) ? addr.flatMap((a: any) => a.value || []) : (addr.value || [])
                    return values.map((a: any) => ({ email: a.address || '', name: a.name }))
                  }
                  
                  const toAddresses = getAddresses(parsed.to)
                  const ccAddresses = getAddresses(parsed.cc)
                  const fromAddresses = getAddresses(parsed.from)
                  const replyToAddresses = getAddresses(parsed.replyTo)
                  
                  message = {
                    id: messageId,
                    threadId: parsed.messageId,
                    subject: parsed.subject || '(No Subject)',
                    from: fromAddresses[0] || { email: '' },
                    to: toAddresses,
                    cc: ccAddresses,
                    replyTo: replyToAddresses[0],
                    date: parsed.date || new Date(),
                    bodyHtml: parsed.html || undefined,
                    bodyText: parsed.text || undefined,
                    flags: {
                      seen: false,
                      flagged: false,
                      answered: false,
                      draft: false,
                      deleted: false
                    },
                    labels: [],
                    folder,
                    headers: {
                      messageId: parsed.messageId,
                      inReplyTo: parsed.inReplyTo,
                      references: Array.isArray(parsed.references) ? parsed.references : 
                        (typeof parsed.references === 'string' ? [parsed.references] : undefined)
                    }
                  }
                  
                  // Cache the message
                  if (message) {
                    this.messageCache.set(messageId, message)
                  }
                })
                .catch(reject)
            })
          })
          
          msg.once('attributes', (attrs) => {
            if (message && attrs.flags) {
              message.flags = {
                seen: attrs.flags.includes('\\Seen'),
                flagged: attrs.flags.includes('\\Flagged'),
                answered: attrs.flags.includes('\\Answered'),
                draft: attrs.flags.includes('\\Draft'),
                deleted: attrs.flags.includes('\\Deleted')
              }
            }
          })
        })
        
        fetch.once('error', reject)
        fetch.once('end', () => {
          // Give simpleParser time to finish
          setTimeout(() => resolve(message), 100)
        })
      })
    })
  }
  
  async listAttachments(_messageId: string): Promise<RawAttachment[]> {
    // TODO: Implement attachment listing - would require more parsing
    return []
  }
  
  async fetchAttachment(_messageId: string, _attachmentId: string): Promise<Buffer | null> {
    // TODO: Implement attachment fetching
    return null
  }
  
  async markAsRead(messageId: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')
    
    const folder = this.config?.folders.inbox || 'INBOX'
    
    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, false, (err) => {
        if (err) { reject(err); return }
        
        this.client!.addFlags(messageId, ['\\Seen'], (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    })
  }
  
  async markAsUnread(messageId: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')
    
    const folder = this.config?.folders.inbox || 'INBOX'
    
    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, false, (err) => {
        if (err) { reject(err); return }
        
        this.client!.delFlags(messageId, ['\\Seen'], (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    })
  }
  
  async setFlagged(messageId: string, flagged: boolean): Promise<void> {
    if (!this.client) throw new Error('Not connected')
    
    const folder = this.config?.folders.inbox || 'INBOX'
    
    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, false, (err) => {
        if (err) { reject(err); return }
        
        if (flagged) {
          this.client!.addFlags(messageId, ['\\Flagged'], (err) => {
            if (err) reject(err)
            else resolve()
          })
        } else {
          this.client!.delFlags(messageId, ['\\Flagged'], (err) => {
            if (err) reject(err)
            else resolve()
          })
        }
      })
    })
  }

  async deleteMessage(messageId: string, context?: OrchestratorRemoteApplyContext): Promise<void> {
    if (!this.client || !this.config) throw new Error('Not connected')
    const names = resolveOrchestratorRemoteNames(this.config)
    const trash = names.imap.trashMailbox
    await this.imapEnsureMailbox(trash)
    const rfc = context?.imapRfcMessageId
    const lastMb = context?.imapRemoteMailbox
    const loc = await this.imapLocateMessageForMove(trash, messageId, rfc ?? null, lastMb ?? null)
    if (!loc) {
      throw new Error('IMAP: cannot locate message for delete/trash (not in monitored mailboxes).')
    }
    await this.imapMoveBetweenMailboxes(loc.mailbox, loc.uid, trash)
  }

  /**
   * LIST mailboxes, then for each configured lifecycle name either confirm it exists or try `CREATE`.
   * Does not guarantee nested paths (e.g. `INBOX/Archive`) — use flat names or pre-create on the server.
   */
  async validateLifecycleRemoteBoxes(): Promise<ImapLifecycleValidationResult> {
    if (!this.client || !this.config) {
      throw new Error('Not connected')
    }
    const names = resolveOrchestratorRemoteNames(this.config)
    const folders = await this.listFolders()
    const specs: { role: ImapLifecycleValidationEntry['role']; mailbox: string }[] = [
      { role: 'archive', mailbox: names.imap.archiveMailbox },
      { role: 'pending_review', mailbox: names.imap.pendingReviewMailbox },
      { role: 'pending_delete', mailbox: names.imap.pendingDeleteMailbox },
      { role: 'trash', mailbox: names.imap.trashMailbox },
    ]
    const entries: ImapLifecycleValidationEntry[] = []
    for (const { role, mailbox } of specs) {
      const m = mailbox.trim()
      if (!m) {
        entries.push({ role, mailbox, exists: false, error: 'Mailbox name is empty' })
        continue
      }
      if (imapFolderListHasMailbox(folders, m)) {
        entries.push({ role, mailbox: m, exists: true })
        continue
      }
      try {
        await this.imapEnsureMailbox(m)
        entries.push({ role, mailbox: m, exists: true, created: true })
      } catch (e: any) {
        entries.push({
          role,
          mailbox: m,
          exists: false,
          error: e?.message || String(e),
        })
      }
    }
    return { ok: entries.every((e) => e.exists), entries }
  }

  async applyOrchestratorRemoteOperation(
    messageId: string,
    operation: OrchestratorRemoteOperation,
    context?: OrchestratorRemoteApplyContext,
  ): Promise<OrchestratorRemoteApplyResult> {
    if (!this.config || !this.client) {
      return { ok: false, error: 'Not connected' }
    }
    const names = resolveOrchestratorRemoteNames(this.config)
    const dest =
      operation === 'archive'
        ? names.imap.archiveMailbox
        : operation === 'pending_review'
          ? names.imap.pendingReviewMailbox
          : operation === 'pending_delete'
            ? names.imap.pendingDeleteMailbox
            : ''
    if (!dest) {
      return { ok: false, error: `Unknown orchestrator operation: ${operation}` }
    }
    try {
      const rfc = context?.imapRfcMessageId ?? null
      const lastMb = context?.imapRemoteMailbox ?? null

      await this.imapEnsureMailbox(dest)

      const already = await this.imapVerifyMessageInMailbox(dest, messageId, rfc)
      if (already) {
        return {
          ok: true,
          skipped: true,
          imapUidAfterMove: already,
          imapMailboxAfterMove: dest,
        }
      }

      const loc = await this.imapLocateMessageForMove(dest, messageId, rfc, lastMb)
      if (!loc) {
        return {
          ok: false,
          error:
            'IMAP: message not found in monitored mailboxes (INBOX + lifecycle folders). Cannot MOVE.',
        }
      }

      await this.imapMoveBetweenMailboxes(loc.mailbox, loc.uid, dest)

      const newUid = (await this.imapVerifyMessageInMailbox(dest, loc.uid, rfc)) || loc.uid
      return { ok: true, imapUidAfterMove: newUid, imapMailboxAfterMove: dest }
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) }
    }
  }

  /** Variants for IMAP SEARCH HEADER Message-ID (angle brackets differ by server). */
  private imapRfcMessageIdSearchVariants(rfc: string | null | undefined): string[] {
    const t = (rfc || '').trim()
    if (!t) return []
    const out: string[] = []
    const add = (s: string) => {
      if (s && !out.includes(s)) out.push(s)
    }
    add(t)
    const inner = t.replace(/^<+/, '').replace(/>+$/, '').trim()
    if (inner) {
      add(inner)
      add(`<${inner}>`)
    }
    return out
  }

  private imapOpenBox(mailbox: string, readOnly: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      this.client.openBox(mailbox, readOnly, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** UID SEARCH in the currently selected mailbox. */
  private imapSearchFirstUid(criteria: unknown[]): Promise<number | null> {
    return new Promise((resolve) => {
      if (!this.client) {
        resolve(null)
        return
      }
      this.client.search(criteria as any, (err, uids: number[]) => {
        if (err || !uids?.length) resolve(null)
        else resolve(uids[0])
      })
    })
  }

  private async imapFindUidByHeaderMessageId(mailbox: string, rfc: string | null): Promise<string | null> {
    const variants = this.imapRfcMessageIdSearchVariants(rfc)
    if (!variants.length) return null
    await this.imapOpenBox(mailbox, true)
    for (const v of variants) {
      const uid = await this.imapSearchFirstUid(['HEADER', 'MESSAGE-ID', v])
      if (uid != null) return String(uid)
    }
    return null
  }

  private async imapUidPresentInMailbox(mailbox: string, uid: string): Promise<boolean> {
    await this.imapOpenBox(mailbox, true)
    const u = String(uid).trim()
    if (!/^\d+$/.test(u)) return false
    /* node-imap: UID criterion expects a UID set (use a single-UID range). */
    const n = await this.imapSearchFirstUid(['UID', `${u}:${u}`])
    return n != null
  }

  private imapLifecycleMailboxCandidates(
    names: ReturnType<typeof resolveOrchestratorRemoteNames>,
    inbox: string,
    excludeLower?: string,
  ): string[] {
    const im = names.imap
    const raw = [
      inbox,
      im.pendingReviewMailbox,
      im.pendingDeleteMailbox,
      im.archiveMailbox,
      im.trashMailbox,
    ].filter((x) => typeof x === 'string' && x.trim().length > 0)
    const out: string[] = []
    for (const m of raw) {
      const t = m.trim()
      if (excludeLower && t.toLowerCase() === excludeLower) continue
      if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
    }
    return out
  }

  private imapOrderedSearchMailboxes(
    lastMail: string | null | undefined,
    names: ReturnType<typeof resolveOrchestratorRemoteNames>,
    inbox: string,
    dest: string,
  ): string[] {
    const destL = dest.trim().toLowerCase()
    const pool = this.imapLifecycleMailboxCandidates(names, inbox, destL)
    const out: string[] = []
    const add = (m?: string | null) => {
      const t = (m || '').trim()
      if (!t || t.toLowerCase() === destL) return
      if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
    }
    add(lastMail)
    for (const p of pool) add(p)
    return out
  }

  private async imapLocateMessageForMove(
    destMailbox: string,
    uidHint: string,
    rfcMessageId: string | null | undefined,
    lastMailbox: string | null | undefined,
  ): Promise<{ mailbox: string; uid: string } | null> {
    if (!this.config || !this.client) return null
    const names = resolveOrchestratorRemoteNames(this.config)
    const inbox = this.config.folders?.inbox || 'INBOX'
    const order = this.imapOrderedSearchMailboxes(lastMailbox, names, inbox, destMailbox)

    for (const mb of order) {
      if (rfcMessageId) {
        const byRfc = await this.imapFindUidByHeaderMessageId(mb, rfcMessageId)
        if (byRfc) return { mailbox: mb, uid: byRfc }
      }
      if (uidHint) {
        const ok = await this.imapUidPresentInMailbox(mb, uidHint)
        if (ok) return { mailbox: mb, uid: uidHint }
      }
    }
    return null
  }

  private async imapVerifyMessageInMailbox(
    destMailbox: string,
    uidHint: string,
    rfcMessageId: string | null | undefined,
  ): Promise<string | null> {
    if (rfcMessageId) {
      const u = await this.imapFindUidByHeaderMessageId(destMailbox, rfcMessageId)
      if (u) return u
    }
    if (uidHint && (await this.imapUidPresentInMailbox(destMailbox, uidHint))) return uidHint
    return null
  }

  private imapMoveBetweenMailboxes(sourceMailbox: string, uid: string, destMailbox: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      this.client.openBox(sourceMailbox, false, (err) => {
        if (err) {
          reject(err)
          return
        }
        this.client!.move(uid, destMailbox, (moveErr) => {
          if (moveErr) reject(moveErr)
          else resolve()
        })
      })
    })
  }

  private imapEnsureMailbox(mailboxName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      this.client.addBox(mailboxName, (err) => {
        if (!err) {
          resolve()
          return
        }
        const m = String((err as Error).message || err)
        if (/exists|EXISTS|already/i.test(m)) resolve()
        else reject(err)
      })
    })
  }

  async sendEmail(payload: SendEmailPayload): Promise<SendResult> {
    if (!this.config?.smtp) {
      return { success: false, error: 'SMTP not configured' }
    }
    
    try {
      if (!this.transporter) {
        this.transporter = createSmtpTransport(this.config.smtp)
      }
      
      const attachments = (payload.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, 'base64'),
        contentType: a.mimeType,
      }))

      const info = await this.transporter.sendMail({
        from: this.config.email,
        to: payload.to.join(', '),
        cc: payload.cc?.join(', '),
        bcc: payload.bcc?.join(', '),
        subject: payload.subject,
        text: payload.bodyText,
        inReplyTo: payload.inReplyTo,
        references: payload.references?.join(' '),
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      
      return {
        success: true,
        messageId: info.messageId
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Failed to send email'
      }
    }
  }
}

export const imapProvider = new ImapProvider()

