/**
 * IMAP Provider
 * 
 * Email provider implementation for IMAP servers.
 * Supports WEB.DE, GMX, Yahoo, iCloud, AOL, and custom IMAP servers.
 */

import * as Imap from 'imap'
import * as nodemailer from 'nodemailer'
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
  SendResult 
} from '../types'

/**
 * IMAP Provider class
 */
export class ImapProvider extends BaseEmailProvider {
  readonly providerType = 'imap' as const
  
  private client: Imap | null = null
  private transporter: nodemailer.Transporter | null = null
  private messageCache: Map<string, RawEmailMessage> = new Map()
  
  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.imap) {
      throw new Error('IMAP configuration required')
    }
    
    this.config = config
    
    return new Promise((resolve, reject) => {
      this.client = new Imap({
        user: config.imap!.username,
        password: config.imap!.password,
        host: config.imap!.host,
        port: config.imap!.port,
        tls: config.imap!.security === 'ssl',
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000
      })
      
      this.client.once('ready', () => {
        console.log('[IMAP] Connected to:', config.imap!.host)
        this.connected = true
        resolve()
      })
      
      this.client.once('error', (err: Error) => {
        console.error('[IMAP] Connection error:', err)
        this.connected = false
        reject(err)
      })
      
      this.client.once('end', () => {
        console.log('[IMAP] Connection ended')
        this.connected = false
      })
      
      this.client.connect()
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
        
        const processBoxes = (boxObj: Imap.MailBoxes, prefix = '') => {
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
                const headers = Imap.parseHeader(buffer)
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
  
  async sendEmail(payload: SendEmailPayload): Promise<SendResult> {
    if (!this.config?.smtp) {
      return { success: false, error: 'SMTP not configured' }
    }
    
    try {
      if (!this.transporter) {
        this.transporter = nodemailer.createTransport({
          host: this.config.smtp.host,
          port: this.config.smtp.port,
          secure: this.config.smtp.security === 'ssl',
          auth: {
            user: this.config.smtp.username,
            pass: this.config.smtp.password
          }
        })
      }
      
      const info = await this.transporter.sendMail({
        from: this.config.email,
        to: payload.to.join(', '),
        cc: payload.cc?.join(', '),
        bcc: payload.bcc?.join(', '),
        subject: payload.subject,
        text: payload.bodyText,
        inReplyTo: payload.inReplyTo,
        references: payload.references?.join(' ')
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

