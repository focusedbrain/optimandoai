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
  
  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    if (!this.client) {
      throw new Error('Not connected')
    }
    
    const limit = options?.limit || 50
    
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
        
        // Fetch latest messages
        const start = Math.max(1, total - limit + 1)
        const end = total
        
        const fetch = this.client!.seq.fetch(`${start}:${end}`, {
          bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES)', 'TEXT'],
          struct: true
        })
        
        const messages: RawEmailMessage[] = []
        
        fetch.on('message', (msg, seqno) => {
          const msgData: Partial<RawEmailMessage> = {
            id: String(seqno),
            folder,
            flags: {
              seen: false,
              flagged: false,
              answered: false,
              draft: false,
              deleted: false
            },
            labels: []
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
                  references: headers.references?.[0]?.split(/\s+/)
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
                deleted: attrs.flags.includes('\\Deleted')
              }
            }
          })
          
          msg.once('end', () => {
            messages.push(msgData as RawEmailMessage)
          })
        })
        
        fetch.once('error', reject)
        fetch.once('end', () => {
          resolve(messages.reverse()) // Most recent first
        })
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

  async deleteMessage(messageId: string): Promise<void> {
    if (!this.client || !this.config) throw new Error('Not connected')
    const names = resolveOrchestratorRemoteNames(this.config)
    await this.imapEnsureMailbox(names.imap.trashMailbox)
    await this.imapMoveFromInbox(messageId, names.imap.trashMailbox)
  }

  /**
   * IMAP mapping: ensure destination mailbox exists, then `MOVE` from the configured inbox folder.
   * May fail on servers with different folder naming — operators can create folders manually with these names.
   */
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
  ): Promise<OrchestratorRemoteApplyResult> {
    if (!this.config) {
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
      await this.imapEnsureMailbox(dest)
      await this.imapMoveFromInbox(messageId, dest)
      return { ok: true }
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (/no such message|not found|does not exist|try again/i.test(msg)) {
        return { ok: true, skipped: true }
      }
      return { ok: false, error: msg }
    }
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

  private imapMoveFromInbox(uid: string, destMailbox: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      const inbox = this.config?.folders.inbox || 'INBOX'
      this.client.openBox(inbox, false, (err) => {
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

