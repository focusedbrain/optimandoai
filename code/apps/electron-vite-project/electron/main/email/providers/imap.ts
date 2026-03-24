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
import { imapFoldersMatchExact, isLegacyImapMailboxLabel } from '../domain/imapLegacyFolders'
import { imapUsesImplicitTls, smtpTransportTlsFlags } from '../domain/securityModeNormalize'
import { emailDebugLog } from '../emailDebug'

export type { ImapLifecycleValidationEntry, ImapLifecycleValidationResult } from '../types'

/** Runtime constructor: bundled ESM may expose CJS `module.exports` as `.default`. */
const ImapCtor = (ImapMod as any).default ?? ImapMod

/** Connection instance type from @types/imap (`export = Connection`). */
type ImapConnection = ImapApi

type ImapNamespaceInfo = { prefix: string; delimiter: string }

/** Log node-imap SEARCH criteria; nested Dates → ISO (wire format uses IMAP date, typically server-local per node-imap). */
function syncDebugFormatImapSearchCriteria(criteria: unknown): string {
  try {
    return JSON.stringify(criteria, (_k, v) => (v instanceof Date ? (v as Date).toISOString() : v))
  } catch {
    return String(criteria)
  }
}

function normalizeImapPrefix(raw: unknown): string {
  if (raw == null || raw === 'NIL') return ''
  const s = String(raw).trim()
  return s
}

/** After `move()` fails, use COPY+\\Deleted+EXPUNGE only when the error looks like MOVE is unusable (not e.g. missing UID). */
function imapMoveErrWarrantsCopyDeleteFallback(err: unknown): boolean {
  const raw = String((err as { text?: string })?.text ?? (err as Error)?.message ?? err ?? '')
  const t = raw.toLowerCase()
  if (!t.trim()) return false
  const mentionsMove = /\bmove\b/.test(t) || /\[capability\]/i.test(raw)
  const looksUnsupported =
    /not supported|unsupported|unknown command|invalid command|bad command|parse error|unavailable|cannot move|can\x27t move/i.test(
      t,
    )
  return mentionsMove && looksUnsupported
}

/** LIST attribs that indicate well-known mailboxes (RFC 6155 / common servers). */
const IMAP_SPECIAL_USE_ANCHORS = ['\\Sent', '\\Trash', '\\Drafts', '\\Junk']

function imapFolderBasename(path: string, delimiter: string): string {
  const d = delimiter || '/'
  const parts = path.split(d).filter(Boolean)
  return parts[parts.length - 1] || path
}

/**
 * True if LIST contains a mailbox that **exactly** matches the wanted logical or resolved path
 * (case-insensitive, trimmed). Legacy / typo folders (Archieve, WRDesk-*) never count.
 */
function imapFolderListHasExactMailbox(folders: FolderInfo[], wantLogical: string, wantResolved: string): boolean {
  const wl = wantLogical.trim()
  const wr = wantResolved.trim()
  if (!wl && !wr) return false
  return folders.some((f) => {
    if (isLegacyImapMailboxLabel(f.path) || isLegacyImapMailboxLabel(f.name)) return false
    const d = f.delimiter || '/'
    const base = imapFolderBasename(f.path, d)
    const match = (wanted: string) =>
      !!wanted &&
      (imapFoldersMatchExact(f.name, wanted) ||
        imapFoldersMatchExact(f.path, wanted) ||
        imapFoldersMatchExact(base, wanted))
    return (wl && match(wl)) || (wr && match(wr))
  })
}

/**
 * Name-based fallbacks when the server does not expose SPECIAL-USE (localized + English).
 */
function imapPathLooksLikeStandardAnchor(path: string, delimiter: string): boolean {
  const base = imapFolderBasename(path, delimiter).toLowerCase()
  const hints = [
    'sent',
    'trash',
    'drafts',
    'deleted messages',
    'junk',
    'spam',
    'junk e-mail',
    'gesendet',
    'papierkorb',
    'entwürfe',
    'entwuerfe',
    'gelöschte elemente',
    'geloeschte elemente',
  ]
  return hints.some((h) => base === h || base.includes(h))
}

/**
 * From LIST (getBoxes): delimiter from the configured INBOX row; hierarchy pattern from where
 * Sent/Trash/Drafts live vs INBOX (siblings → top-level lifecycle mailboxes; under INBOX → prefix).
 * Avoids hardcoding `INBOX.` — uses the server's delimiter and observed layout (web.de vs Cyrus-style).
 */
function inferMailboxHierarchyFromList(folders: FolderInfo[], inboxLogical: string): ImapNamespaceInfo {
  const ib = inboxLogical.trim() || 'INBOX'
  const ibLower = ib.toLowerCase()
  const inboxRow =
    folders.find((f) => f.path.toLowerCase() === ibLower) ||
    folders.find((f) => f.name.toLowerCase() === ibLower)
  const delimiter = inboxRow?.delimiter || '.'

  const isDirectChildOfInbox = (path: string): boolean => {
    const pl = path.toLowerCase()
    if (pl === ibLower) return false
    const d = delimiter.toLowerCase()
    if (!pl.startsWith(ibLower.toLowerCase() + d)) return false
    const rest = pl.slice(ibLower.length + d.length)
    return rest.length > 0 && !rest.includes(d)
  }

  const isUnderInboxTree = (path: string): boolean => {
    const pl = path.toLowerCase()
    return pl !== ibLower && pl.startsWith(ibLower.toLowerCase() + delimiter.toLowerCase())
  }

  const specialAnchors = folders.filter((f) => {
    if (f.path.toLowerCase() === ibLower) return false
    return (f.flags || []).some((a) => IMAP_SPECIAL_USE_ANCHORS.includes(a))
  })

  const nameAnchors = folders.filter((f) => {
    if (f.path.toLowerCase() === ibLower) return false
    if (specialAnchors.includes(f)) return false
    return imapPathLooksLikeStandardAnchor(f.path, f.delimiter || delimiter)
  })

  const anchors = specialAnchors.length > 0 ? specialAnchors : nameAnchors

  if (anchors.length > 0) {
    const nested = anchors.filter((f) => isUnderInboxTree(f.path))
    const top = anchors.filter((f) => !isUnderInboxTree(f.path))
    if (nested.length > 0 && top.length === 0) {
      return { prefix: ib + delimiter, delimiter }
    }
    if (top.length > 0 && nested.length === 0) {
      return { prefix: '', delimiter }
    }
    // Mixed layout: prefer \Sent (or first special-use) placement
    const sentLike =
      specialAnchors.find((f) => (f.flags || []).includes('\\Sent')) ||
      specialAnchors.find((f) => /sent/i.test(imapFolderBasename(f.path, f.delimiter || delimiter))) ||
      anchors[0]
    if (sentLike) {
      if (isUnderInboxTree(sentLike.path)) return { prefix: ib + delimiter, delimiter }
      return { prefix: '', delimiter }
    }
  }

  // No anchors: if anything is a direct child of INBOX, assume nested lifecycle mailboxes
  const anyChildUnderInbox = folders.some((f) => isDirectChildOfInbox(f.path) || isUnderInboxTree(f.path))
  const prefix = anyChildUnderInbox ? ib + delimiter : ''
  return { prefix, delimiter }
}

/** Nodemailer transport options aligned with SecurityMode (SSL/465 vs STARTTLS/587). */
export function createSmtpTransport(smtp: NonNullable<EmailAccountConfig['smtp']>) {
  const { secure, requireTLS } = smtpTransportTlsFlags(smtp.security)
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure,
    requireTLS,
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
type ImapClientWithNamespaces = ImapConnection & {
  namespaces?: {
    personal?: Array<{ prefix?: string; delimiter?: string }>
    other?: unknown
    shared?: unknown
  }
}

export class ImapProvider extends BaseEmailProvider {
  readonly providerType = 'imap' as const
  
  private client: ImapConnection | null = null
  private transporter: nodemailer.Transporter | null = null
  private messageCache: Map<string, RawEmailMessage> = new Map()
  /** Cached per connection — RFC 2342 NAMESPACE or LIST + Sent/Trash/Drafts layout (see getNamespaceInfo). */
  private namespaceInfoCache: ImapNamespaceInfo | null = null
  /** Snapshot of IMAP CAPABILITY (uppercase); refreshed on `ready` and after mailbox open. `serverSupports()` is authoritative at move time. */
  private serverCapabilities: string[] = []
  
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
      const useImplicitTls = imapUsesImplicitTls(config.imap!.security)
      emailDebugLog('[IMAP-DEBUG] ImapCtor config:', {
        user: config.imap!.username,
        host: config.imap!.host,
        port: config.imap!.port,
        securityRaw: config.imap!.security,
        tls: useImplicitTls,
        hasPassword: !!config.imap!.password,
      })
      const client = new ImapCtor({
        user: config.imap!.username,
        password: config.imap!.password,
        host: config.imap!.host,
        port: config.imap!.port,
        tls: useImplicitTls,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000
      })
      this.client = client
      this.namespaceInfoCache = null
      this.serverCapabilities = []

      /**
       * During connect, first `error` rejects the promise. After `ready`, Node's `imap` may emit
       * further `error` events on the same socket; with **no** listener that crashes the main process
       * and IPC returns "reply was never sent". Always attach a persistent handler post-ready.
       */
      const onConnectError = (err: Error) => {
        emailDebugLog('[IMAP-DEBUG] connection error raw:', err)
        console.error('[IMAP] Connection error:', err)
        this.connected = false
        reject(err)
      }

      client.once('error', onConnectError)

      client.once('ready', () => {
        /* `once` wraps the listener — removeListener(fn) may not match; clear pre-ready error handlers. */
        client.removeAllListeners('error')
        client.on('error', (err: Error) => {
          console.error('[IMAP] Runtime connection error (listener prevents process crash):', err?.message || err)
          this.connected = false
        })
        console.log('[IMAP] Connected to:', config.imap!.host)
        this.refreshImapCapabilitiesSnapshot()
        this.connected = true
        void this.warmImapNamespacePattern().catch((e: any) => {
          console.warn('[IMAP] Early namespace/delimiter detection failed (will retry on demand):', e?.message || e)
        })
        resolve()
      })

      client.once('end', () => {
        console.log('[IMAP] Connection ended')
        this.connected = false
        /** Dead socket must not satisfy `applyOrchestratorRemoteOperation` — forces full reconnect via gateway. */
        this.client = null
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
    this.namespaceInfoCache = null
    this.serverCapabilities = []
  }

  /** Copy `node-imap` internal `_caps` for debugging (CAPABILITY is also run at login). */
  private refreshImapCapabilitiesSnapshot(): void {
    if (!this.client) {
      this.serverCapabilities = []
      return
    }
    const caps = (this.client as ImapConnection & { _caps?: string[] })._caps
    this.serverCapabilities = Array.isArray(caps) ? [...caps] : []
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

  /** After `ready`, prime LIST-based delimiter / Sent-Trash layout so first CREATE uses the right path. */
  private async warmImapNamespacePattern(): Promise<void> {
    if (!this.client || !this.config) return
    await this.getNamespaceInfo()
  }

  /**
   * Personal namespace prefix + hierarchy delimiter (RFC 2342 NAMESPACE when available; else inferred from LIST).
   * Cached for the lifetime of the connection. Used to build full mailbox paths for CREATE/MOVE.
   */
  async getNamespaceInfo(): Promise<ImapNamespaceInfo> {
    if (this.namespaceInfoCache) {
      return this.namespaceInfoCache
    }
    if (!this.client) {
      throw new Error('Not connected')
    }

    const c = this.client as ImapClientWithNamespaces
    const personal = c.namespaces?.personal
    if (personal && personal.length > 0) {
      const p = personal[0]
      const prefix = normalizeImapPrefix(p.prefix)
      const delimiter = p.delimiter != null && p.delimiter !== '' ? String(p.delimiter) : '.'
      this.namespaceInfoCache = { prefix, delimiter }
      this.logImapNamespacePattern('NAMESPACE')
      return this.namespaceInfoCache
    }

    const inboxLogical = (this.config?.folders?.inbox || 'INBOX').trim()
    const folders = await this.listFolders()
    this.namespaceInfoCache = inferMailboxHierarchyFromList(folders, inboxLogical)
    this.logImapNamespacePattern('LIST')
    return this.namespaceInfoCache
  }

  private logImapNamespacePattern(source: 'NAMESPACE' | 'LIST'): void {
    const ns = this.namespaceInfoCache
    if (!ns) return
    const patternDesc = ns.prefix
      ? `nested under configured inbox (hierarchy prefix ${JSON.stringify(ns.prefix)} via ${source})`
      : `top-level folders for new mailboxes (no inbox prefix; ${source})`
    console.log(`[IMAP] Server pattern: ${patternDesc}, delimiter=${JSON.stringify(ns.delimiter)}`)
  }

  /**
   * Map a configured lifecycle folder label (e.g. "Pending Delete") to the full IMAP mailbox path
   * for this server (e.g. "INBOX.Pending Delete" when the personal namespace uses an INBOX. prefix).
   * The configured inbox name itself is never prefixed.
   */
  private async imapResolveMailboxPath(logicalName: string): Promise<string> {
    const trimmed = logicalName.trim()
    if (!trimmed) {
      return trimmed
    }
    const inbox = (this.config?.folders?.inbox || 'INBOX').trim()
    if (trimmed.toLowerCase() === inbox.toLowerCase()) {
      return trimmed
    }

    const ns = await this.getNamespaceInfo()
    if (!ns.prefix) {
      return trimmed
    }
    if (trimmed.toLowerCase().startsWith(ns.prefix.toLowerCase())) {
      return trimmed
    }
    return `${ns.prefix}${trimmed}`
  }

  /**
   * Prefer resolved path; also try the bare label for rows created before namespace-aware sync.
   */
  private async imapExpandMailboxTryPaths(mailboxLabel: string): Promise<string[]> {
    const trimmed = mailboxLabel.trim()
    if (!trimmed) return []
    const resolved = await this.imapResolveMailboxPath(trimmed)
    const out: string[] = []
    if (resolved) out.push(resolved)
    if (resolved.toLowerCase() !== trimmed.toLowerCase()) {
      out.push(trimmed)
    }
    return out
  }

  private async imapLifecycleMailboxCandidatesResolved(
    names: ReturnType<typeof resolveOrchestratorRemoteNames>,
    inbox: string,
    excludeLower?: string,
  ): Promise<string[]> {
    const im = names.imap
    const raw = [
      inbox,
      im.pendingReviewMailbox,
      im.pendingDeleteMailbox,
      im.urgentMailbox,
      im.archiveMailbox,
      im.trashMailbox,
    ].filter((x) => typeof x === 'string' && x.trim().length > 0)

    const out: string[] = []
    const inboxLower = inbox.trim().toLowerCase()
    for (const m of raw) {
      const t = m.trim()
      const tryPaths = t.toLowerCase() === inboxLower ? [t] : await this.imapExpandMailboxTryPaths(t)
      for (const path of tryPaths) {
        if (excludeLower && path.toLowerCase() === excludeLower) continue
        if (!out.some((o) => o.toLowerCase() === path.toLowerCase())) out.push(path)
      }
    }
    return out
  }
  
  /**
   * SEARCH SINCE via node-imap → **UID SEARCH** (returns UIDs). Fetch with `client.fetch` (UID FETCH), not `seq.fetch`.
   */
  private fetchMessagesSince(folder: string, since: Date, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? limit), limit)
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
        const uidStr = String(attrs.uid)
        /** Same as `id` — IMAP UID for list rows; RFC Message-ID lives only in `headers.messageId`. */
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
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err) => {
        if (err) {
          reject(err)
          return
        }
        let searchCriteria: any = ['SINCE', since]
        if (options?.toDate) {
          const before = new Date(options.toDate)
          if (!Number.isNaN(before.getTime())) {
            searchCriteria = ['AND', ['SINCE', since], ['BEFORE', before]]
          }
        }
        emailDebugLog(
          '[SYNC-DEBUG] IMAP SEARCH (fetchMessagesSince): openBox then SEARCH via node-imap; criteria array → SINCE/BEFORE on wire',
          {
            folder,
            sinceIso: since.toISOString(),
            sinceInternalDate: since.toString(),
            toDateOptionIso: options?.toDate ?? null,
            criteriaJson: syncDebugFormatImapSearchCriteria(searchCriteria),
          },
        )
        this.client!.search([searchCriteria], (sErr, uids: number[]) => {
          if (sErr) {
            reject(sErr)
            return
          }
          const n = uids?.length ?? 0
          emailDebugLog('[SYNC-DEBUG] IMAP SEARCH result (UIDs from UID SEARCH)', { folder, matchCount: n })
          if (!uids?.length) {
            emailDebugLog(
              '[SYNC-DEBUG] IMAP fetchMessagesSince: 0 SEARCH matches — no UID fetch attempted for this folder',
              { folder },
            )
            resolve([])
            return
          }
          const sorted = [...uids].sort((a, b) => a - b)
          let pick = syncAll ? sorted : sorted.slice(Math.max(0, sorted.length - limit))
          if (pick.length > maxM) {
            pick = pick.slice(-maxM)
          }

          const all: RawEmailMessage[] = []
          let i = 0
          let imapChunkIdx = 0

          const nextChunk = () => {
            if (i >= pick.length) {
              if (syncAll && pick.length > 0) {
                console.log(`[IMAP] SINCE fetch done: ${all.length} message(s) from ${pick.length} match(es)`)
              }
              resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
              return
            }
            imapChunkIdx++
            const slice = pick.slice(i, i + chunkSize)
            i += chunkSize
            if (syncAll) {
              console.log(
                `[IMAP] SINCE fetch chunk ${imapChunkIdx}: uid ${slice[0]}-${slice[slice.length - 1]} (${slice.length} of ${pick.length} total matches)`,
              )
            }
            const spec = slice.join(',')
            const batch: RawEmailMessage[] = []
            // connection.search() returns UIDs, not sequence numbers.
            // Use this.client!.fetch (UID-based) not seq.fetch (sequence-based).
            const fetch = this.client!.fetch(spec, {
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

  /**
   * SEARCH BEFORE via **UID SEARCH**; take the **newest** `maxM` matches (highest UID), then UID FETCH headers.
   * Used for Pull More (older than local oldest message).
   */
  private fetchMessagesBeforeExclusive(folder: string, before: Date, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? limit), limit)
    const chunkSize = 60

    const attachParser = (msg: any, msgData: Partial<RawEmailMessage>) => {
      msg.on('body', (stream: NodeJS.ReadableStream, info: { which: string }) => {
        let buffer = ''
        stream.on('data', (chunk: Buffer | string) => {
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
      msg.once('attributes', (attrs: { uid?: number; flags?: string[] }) => {
        const uidStr = String(attrs.uid)
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
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err) => {
        if (err) {
          reject(err)
          return
        }
        const beforeCriteria: any[] = ['BEFORE', before]
        emailDebugLog('[SYNC-DEBUG] IMAP SEARCH (fetchMessagesBeforeExclusive)', {
          folder,
          beforeIso: before.toISOString(),
          criteriaJson: syncDebugFormatImapSearchCriteria(beforeCriteria),
        })
        this.client!.search([beforeCriteria], (sErr, uids: number[]) => {
          if (sErr) {
            reject(sErr)
            return
          }
          const n = uids?.length ?? 0
          emailDebugLog('[SYNC-DEBUG] IMAP SEARCH BEFORE result (UIDs)', { folder, matchCount: n })
          if (!uids?.length) {
            emailDebugLog('[SYNC-DEBUG] IMAP fetchMessagesBeforeExclusive: 0 matches — no fetch', { folder })
            resolve([])
            return
          }
          const sortedDesc = [...uids].sort((a, b) => b - a)
          const pick = sortedDesc.slice(0, maxM)

          const all: RawEmailMessage[] = []
          let i = 0
          let imapChunkIdx = 0

          const nextChunk = () => {
            if (i >= pick.length) {
              if (syncAll && pick.length > 0) {
                console.log(`[IMAP] BEFORE fetch done: ${all.length} message(s) from ${pick.length} uid pick(es)`)
              }
              resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
              return
            }
            imapChunkIdx++
            const slice = pick.slice(i, i + chunkSize)
            i += chunkSize
            if (syncAll) {
              console.log(
                `[IMAP] BEFORE fetch chunk ${imapChunkIdx}: uid ${slice[0]}-${slice[slice.length - 1]} (${slice.length} of ${pick.length})`,
              )
            }
            const spec = slice.join(',')
            const batch: RawEmailMessage[] = []
            // connection.search() returns UIDs, not sequence numbers.
            // Use this.client!.fetch (UID-based) not seq.fetch (sequence-based).
            const fetch = this.client!.fetch(spec, {
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
    console.log('[IMAP-PULL-TRACE] ImapProvider.fetchMessages entry:', {
      hasClient: !!this.client,
      isConnected: this.isConnected(),
      folder,
      fromDate: options?.fromDate,
      maxResults: (options as { maxResults?: number } | undefined)?.maxResults,
    })

    if (!this.client) {
      throw new Error('Not connected')
    }

    emailDebugLog('[SYNC-DEBUG] ImapProvider.fetchMessages entry', {
      folder,
      fromDate: options?.fromDate ?? null,
      toDate: options?.toDate ?? null,
      syncFetchAllPages: options?.syncFetchAllPages === true,
      syncMaxMessages: options?.syncMaxMessages ?? null,
    })

    const limit = options?.limit || 50
    const syncAll = options?.syncFetchAllPages === true
    const maxM = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? limit), limit)
    const chunkSize = 60

    if (options?.toDate && !options?.fromDate) {
      const before = new Date(options.toDate)
      if (!Number.isNaN(before.getTime())) {
        return this.fetchMessagesBeforeExclusive(folder, before, options)
      }
    }

    if (options?.fromDate) {
      const since = new Date(options.fromDate)
      if (!Number.isNaN(since.getTime())) {
        return this.fetchMessagesSince(folder, since, options)
      }
      emailDebugLog(
        '[SYNC-DEBUG] IMAP fetchMessages: fromDate present but invalid — falling through to seq-range path (no SINCE SEARCH)',
        { folder, fromDate: options.fromDate },
      )
    }

    return new Promise((resolve, reject) => {
      this.client!.openBox(folder, true, (err, box) => {
        if (err) {
          reject(err)
          return
        }

        const total = box.messages.total
        emailDebugLog('[SYNC-DEBUG] IMAP fetchMessages seq-range path (no fromDate SINCE)', {
          folder,
          openBoxMessageTotal: total,
          syncAll,
        })
        if (total === 0) {
          emailDebugLog('[SYNC-DEBUG] IMAP fetchMessages: mailbox reports 0 messages — no fetch', { folder })
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
              const uidStr = String(attrs.uid)
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
        let imapRangeIdx = 0

        const nextRange = () => {
          if (startSeq > total || all.length >= maxM) {
            if (syncAll && total > 0) {
              console.log(`[IMAP] full mailbox fetch done: ${all.length} message(s) from ${total} in folder`)
            }
            resolve(all.sort((a, b) => Number(b.id) - Number(a.id)))
            return
          }
          imapRangeIdx++
          const endSeq = Math.min(total, startSeq + chunkSize - 1)
          const spec = `${startSeq}:${endSeq}`
          if (syncAll) {
            console.log(`[IMAP] full mailbox range ${imapRangeIdx}: ${spec} (total msgs=${total}, loaded ${all.length})`)
          }
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
              const uidStr = String(attrs.uid)
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
  
  /**
   * Fetch full message body by UID in a specific mailbox.
   * @param softOpen — if true, missing/invalid mailbox or fetch errors yield `null` instead of throwing.
   */
  private fetchMessageFromFolder(
    messageId: string,
    folder: string,
    options: { softOpen: boolean },
  ): Promise<RawEmailMessage | null> {
    const { softOpen } = options
    return new Promise((resolve, reject) => {
      if (!this.client) {
        if (softOpen) resolve(null)
        else reject(new Error('Not connected'))
        return
      }

      this.client.openBox(folder, true, (err) => {
        if (err) {
          if (softOpen) {
            resolve(null)
            return
          }
          reject(err)
          return
        }

        const fetch = this.client!.fetch(messageId, {
          bodies: '',
          struct: true,
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
                    /** IMAP UID (same as `id`); RFC Message-ID is `threadId` / `headers.messageId` only. */
                    uid: messageId,
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
                      deleted: false,
                    },
                    labels: [],
                    folder,
                    headers: {
                      messageId: parsed.messageId,
                      inReplyTo: parsed.inReplyTo,
                      references: Array.isArray(parsed.references)
                        ? parsed.references
                        : typeof parsed.references === 'string'
                          ? [parsed.references]
                          : undefined,
                    },
                  }

                  if (message) {
                    this.messageCache.set(messageId, message)
                  }
                })
                .catch((e) => {
                  if (softOpen) resolve(null)
                  else reject(e)
                })
            })
          })

          msg.once('attributes', (attrs) => {
            if (message && attrs.flags) {
              message.flags = {
                seen: attrs.flags.includes('\\Seen'),
                flagged: attrs.flags.includes('\\Flagged'),
                answered: attrs.flags.includes('\\Answered'),
                draft: attrs.flags.includes('\\Draft'),
                deleted: attrs.flags.includes('\\Deleted'),
              }
            }
          })
        })

        fetch.once('error', (e) => {
          if (softOpen) resolve(null)
          else reject(e)
        })
        fetch.once('end', () => {
          setTimeout(() => resolve(message), 100)
        })
      })
    })
  }

  async fetchMessage(messageId: string): Promise<RawEmailMessage | null> {
    if (!this.client) {
      throw new Error('Not connected')
    }

    const cached = this.messageCache.get(messageId)
    if (cached) {
      return cached
    }

    const inbox = this.config?.folders.inbox || 'INBOX'
    // A: INBOX first (fast path); lifecycle folders only if UID not in INBOX (e.g. already moved by mirror).
    let result = await this.fetchMessageFromFolder(messageId, inbox, { softOpen: false })
    if (result) {
      result.folder = result.folder || inbox
      console.log(`[IMAP] fetchMessage: UID ${messageId} found in ${inbox}`)
      return result
    }

    if (!this.config) {
      return null
    }

    const names = resolveOrchestratorRemoteNames(this.config)
    const logicals = [
      names.imap.archiveMailbox,
      names.imap.pendingDeleteMailbox,
      names.imap.pendingReviewMailbox,
      names.imap.urgentMailbox,
    ]

    for (const logical of logicals) {
      const trimmed = (logical || '').trim()
      if (!trimmed) continue
      const tryPaths = await this.imapExpandMailboxTryPaths(trimmed)
      const seen = new Set<string>()
      for (const folderPath of tryPaths) {
        const key = folderPath.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        if (folderPath.toLowerCase() === inbox.toLowerCase()) continue

        try {
          result = await this.fetchMessageFromFolder(messageId, folderPath, { softOpen: true })
          if (result) {
            result.folder = folderPath
            console.log(`[IMAP] fetchMessage: UID ${messageId} found in lifecycle folder ${folderPath}`)
            return result
          }
        } catch (e: any) {
          console.log(`[IMAP] fetchMessage: skip folder "${folderPath}":`, e?.message || e)
        }
      }
    }

    return null
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
    const trashLogical = names.imap.trashMailbox
    await this.imapEnsureMailbox(trashLogical)
    const trashResolved = await this.imapResolveMailboxPath(trashLogical.trim())
    const rfc = context?.imapRfcMessageId
    const lastMb = context?.imapRemoteMailbox
    const loc = await this.imapLocateMessageForMove(trashResolved, messageId, rfc ?? null, lastMb ?? null)
    if (!loc) {
      throw new Error('IMAP: cannot locate message for delete/trash (not in monitored mailboxes).')
    }
    await this.imapMoveBetweenMailboxes(loc.mailbox, loc.uid, trashResolved)
  }

  /**
   * One-time migration helper: move messages from legacy / duplicate lifecycle folder names into the
   * canonical mailboxes from `resolveOrchestratorRemoteNames`. Does **not** DELETE legacy folders — only
   * empties them when moves succeed. Safe to call multiple times (idempotent for empty legacies).
   */
  async consolidateLifecycleFolders(): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Not connected')
    }
    const names = resolveOrchestratorRemoteNames(this.config)
    const folders = await this.listFolders()

    const legacyByCanonical: Record<string, string[]> = {
      [names.imap.archiveMailbox]: ['Archieve', 'WRDesk-Archive', 'WRDesk-Archieve'],
      [names.imap.pendingDeleteMailbox]: ['WRDesk-PendingDelete', 'WRDesk-Pending Delete'],
      [names.imap.pendingReviewMailbox]: ['WRDesk-PendingReview', 'WRDesk-Pending Review'],
    }

    const processedSourcePaths = new Set<string>()

    for (const [canonicalLogical, legacies] of Object.entries(legacyByCanonical)) {
      const canonicalResolved = await this.imapResolveMailboxPath(canonicalLogical.trim())
      try {
        await this.imapEnsureMailbox(canonicalLogical.trim())
      } catch (e: any) {
        console.warn(
          `[IMAP] Consolidation: could not ensure canonical folder "${canonicalLogical}" (${canonicalResolved}):`,
          e?.message || e,
        )
        continue
      }

      for (const legacyLabel of legacies) {
        const matches = await this.imapFindFoldersMatchingLegacyLabel(folders, legacyLabel)
        for (const folder of matches) {
          const sourcePath = folder.path
          if (processedSourcePaths.has(sourcePath)) continue
          if (sourcePath.toLowerCase() === canonicalResolved.toLowerCase()) continue

          processedSourcePaths.add(sourcePath)
          console.log(
            `[IMAP] Consolidation: migrating messages from legacy folder "${sourcePath}" → canonical "${canonicalResolved}" (role: ${canonicalLogical})`,
          )
          try {
            await this.imapMoveAllMessagesFromLegacyToCanonical(sourcePath, canonicalResolved)
          } catch (e: any) {
            console.warn(
              `[IMAP] Consolidation: batch migrate failed for "${sourcePath}" → "${canonicalResolved}":`,
              e?.message || e,
            )
          }
        }
      }
    }

    console.log('[IMAP] Consolidation: finished legacy folder pass (legacy mailboxes left in place for manual removal if empty).')
  }

  private async imapFindFoldersMatchingLegacyLabel(
    folders: FolderInfo[],
    legacyLabel: string,
  ): Promise<FolderInfo[]> {
    const trimmed = legacyLabel.trim()
    if (!trimmed) return []
    const pathCandidates = await this.imapExpandMailboxTryPaths(trimmed)
    const want = new Set<string>()
    want.add(trimmed.toLowerCase())
    for (const p of pathCandidates) want.add(p.toLowerCase())

    const out: FolderInfo[] = []
    const seen = new Set<string>()
    for (const f of folders) {
      const pl = f.path.toLowerCase()
      const nl = f.name.toLowerCase()
      for (const c of want) {
        if (!c) continue
        if (pl === c || nl === c) {
          if (!seen.has(f.path)) {
            seen.add(f.path)
            out.push(f)
          }
          break
        }
      }
    }
    return out
  }

  private imapSearchAllUidsInCurrentMailbox(): Promise<number[]> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      this.client.search(['ALL'], (err, uids: number[]) => {
        if (err) reject(err)
        else resolve(Array.isArray(uids) && uids.length ? uids : [])
      })
    })
  }

  private imapTryMoveUidWithFallback(sourcePath: string, uid: string, destResolved: string): Promise<void> {
    const client = this.client!
    return new Promise((resolve, reject) => {
      client.openBox(sourcePath, false, (openErr) => {
        if (openErr) {
          reject(openErr)
          return
        }
        client.move(uid, destResolved, (moveErr) => {
          if (!moveErr) {
            resolve()
            return
          }
          console.warn(
            `[IMAP] Consolidation: MOVE failed for UID ${uid} in "${sourcePath}" — trying COPY + \\Deleted + EXPUNGE:`,
            moveErr?.message || moveErr,
          )
          client.copy(uid, destResolved, (copyErr) => {
            if (copyErr) {
              reject(copyErr)
              return
            }
            client.openBox(sourcePath, false, (reopenErr) => {
              if (reopenErr) {
                reject(reopenErr)
                return
              }
              client.addFlags(uid, ['\\Deleted'], (flagErr) => {
                if (flagErr) {
                  reject(flagErr)
                  return
                }
                const conn = client as ImapConnection & { serverSupports?: (cap: string) => boolean }
                if (typeof conn.serverSupports === 'function' && conn.serverSupports('UIDPLUS')) {
                  client.expunge([uid], (expErr) => {
                    if (expErr) reject(expErr)
                    else resolve()
                  })
                } else {
                  client.expunge((expErr) => {
                    if (expErr) reject(expErr)
                    else resolve()
                  })
                }
              })
            })
          })
        })
      })
    })
  }

  private async imapMoveAllMessagesFromLegacyToCanonical(
    sourcePath: string,
    destResolved: string,
  ): Promise<void> {
    await this.imapOpenBox(sourcePath, false)
    const uids = await this.imapSearchAllUidsInCurrentMailbox()
    if (uids.length === 0) {
      console.log(`[IMAP] Consolidation: legacy folder "${sourcePath}" is empty — nothing to move.`)
      return
    }
    let moved = 0
    for (const uidNum of uids) {
      const uid = String(uidNum)
      try {
        await this.imapTryMoveUidWithFallback(sourcePath, uid, destResolved)
        moved++
      } catch (e: any) {
        console.warn(
          `[IMAP] Consolidation: skip UID ${uid} in "${sourcePath}" (could not move to "${destResolved}"):`,
          e?.message || e,
        )
      }
    }
    console.log(
      `[IMAP] Consolidation: moved ${moved}/${uids.length} message(s) from "${sourcePath}" → "${destResolved}"`,
    )
  }

  private imapIsDirectChildOfMailbox(path: string, parentPath: string, delimiter: string): boolean {
    const ib = parentPath.toLowerCase()
    const pl = path.toLowerCase()
    const d = delimiter.toLowerCase()
    if (pl === ib) return false
    if (!pl.startsWith(ib + d)) return false
    const rest = pl.slice(ib.length + d.length)
    return rest.length > 0 && !rest.includes(d)
  }

  private looksLikeSpamMailbox(f: FolderInfo): boolean {
    const delim = f.delimiter || '.'
    const base = imapFolderBasename(f.path, delim).toLowerCase()
    const flags = f.flags || []
    if (flags.includes('\\Junk')) return true
    if (/(spam|junk|bulk)/i.test(base) && !/(sent|draft)/i.test(base)) return true
    return false
  }

  private async imapFindExistingMailboxPathForLabel(folders: FolderInfo[], label: string): Promise<string | null> {
    const trimmed = label.trim()
    if (!trimmed) return null
    const resolved = await this.imapResolveMailboxPath(trimmed)
    const hit = folders.find((f) => {
      if (isLegacyImapMailboxLabel(f.path) || isLegacyImapMailboxLabel(f.name)) return false
      const d = f.delimiter || '/'
      const base = imapFolderBasename(f.path, d)
      return (
        imapFoldersMatchExact(f.name, trimmed) ||
        imapFoldersMatchExact(f.path, trimmed) ||
        imapFoldersMatchExact(base, trimmed) ||
        imapFoldersMatchExact(f.name, resolved) ||
        imapFoldersMatchExact(f.path, resolved) ||
        imapFoldersMatchExact(base, resolved)
      )
    })
    if (hit) return hit.path
    if (/^spam$/i.test(trimmed)) {
      const junk = folders.find(
        (f) =>
          !isLegacyImapMailboxLabel(f.path) &&
          !isLegacyImapMailboxLabel(f.name) &&
          this.looksLikeSpamMailbox(f),
      )
      return junk?.path ?? null
    }
    return null
  }

  private async expandPullFoldersWithDirectInboxChildren(
    basePaths: string[],
    folders: FolderInfo[],
  ): Promise<string[]> {
    if (!this.config) return basePaths
    const inboxLogical = (this.config.folders?.inbox || 'INBOX').trim()
    const ns = await this.getNamespaceInfo()
    const delim = ns.delimiter || '.'
    const inboxRow =
      folders.find((f) => imapFoldersMatchExact(f.path, inboxLogical)) ||
      folders.find((f) => imapFoldersMatchExact(f.name, inboxLogical))
    const inboxPath = inboxRow?.path || inboxLogical

    const names = resolveOrchestratorRemoteNames(this.config)
    const im = names.imap
    const lifecycleLabels = [
      im.archiveMailbox,
      im.pendingDeleteMailbox,
      im.pendingReviewMailbox,
      im.urgentMailbox,
      im.trashMailbox,
    ]
      .map((x) => x.trim())
      .filter(Boolean)

    const lifecyclePathKeys = new Set<string>()
    for (const lab of lifecycleLabels) {
      const r = await this.imapResolveMailboxPath(lab)
      lifecyclePathKeys.add(r.toLowerCase())
      lifecyclePathKeys.add(lab.toLowerCase())
      const match = folders.find((f) => {
        if (isLegacyImapMailboxLabel(f.path) || isLegacyImapMailboxLabel(f.name)) return false
        const d = f.delimiter || '/'
        const b = imapFolderBasename(f.path, d)
        return (
          imapFoldersMatchExact(f.path, lab) ||
          imapFoldersMatchExact(b, lab) ||
          imapFoldersMatchExact(f.name, lab)
        )
      })
      if (match) lifecyclePathKeys.add(match.path.toLowerCase())
    }

    const out = [...basePaths]
    const seen = new Set(out.map((x) => x.toLowerCase()))

    for (const f of folders) {
      if (isLegacyImapMailboxLabel(f.path) || isLegacyImapMailboxLabel(f.name)) continue
      const pl = f.path
      const fdelim = f.delimiter || delim
      if (lifecyclePathKeys.has(pl.toLowerCase())) continue
      const base = imapFolderBasename(pl, fdelim)
      if (lifecyclePathKeys.has(base.toLowerCase())) continue
      if (!this.imapIsDirectChildOfMailbox(pl, inboxPath, fdelim)) continue
      if (imapPathLooksLikeStandardAnchor(pl, fdelim)) continue
      if (!seen.has(pl.toLowerCase())) {
        seen.add(pl.toLowerCase())
        out.push(pl)
      }
    }
    return out
  }

  /**
   * Resolve pull labels to real LIST paths, discover Spam/Junk if needed, append direct INBOX.* children
   * (excludes lifecycle + legacy + Sent/Trash/Drafts-like names).
   */
  async expandPullFoldersForSync(baseLabels: string[]): Promise<string[]> {
    if (!this.client || !this.config) {
      throw new Error('Not connected')
    }
    const folders = await this.listFolders()
    const paths: string[] = []
    const seen = new Set<string>()
    const add = (p: string) => {
      const x = p.trim()
      if (!x) return
      const k = x.toLowerCase()
      if (seen.has(k)) return
      seen.add(k)
      paths.push(x)
    }
    for (const label of baseLabels) {
      const path = await this.imapFindExistingMailboxPathForLabel(folders, label.trim())
      if (path) add(path)
    }
    const hasSpamLike = paths.some((p) => {
      const row = folders.find((f) => f.path === p)
      return row ? this.looksLikeSpamMailbox(row) : false
    })
    if (!hasSpamLike) {
      const junk = folders.find(
        (f) =>
          !isLegacyImapMailboxLabel(f.path) &&
          !isLegacyImapMailboxLabel(f.name) &&
          this.looksLikeSpamMailbox(f),
      )
      if (junk) add(junk.path)
    }
    const expanded = await this.expandPullFoldersWithDirectInboxChildren(paths, folders)
    if (expanded.length === 0) {
      return [this.config.folders?.inbox || 'INBOX']
    }
    return expanded
  }

  /**
   * Debug: full LIST + STATUS (message counts). Read-only — does not CREATE mailboxes.
   * `lifecycleOnServer` uses the same exact-match rules as drain (legacy typo folders do not count).
   */
  async debugListRemoteMailboxesWithStatus(): Promise<{
    folders: Array<{
      path: string
      name: string
      delimiter: string
      flags: string[]
      messages?: number
      unseen?: number
      legacy: boolean
      statusError?: string
    }>
    lifecycleOnServer: Array<{
      role: string
      mailbox: string
      resolved: string
      exactMatch: boolean
    }>
  }> {
    if (!this.client || !this.config) {
      throw new Error('Not connected')
    }
    const folders = await this.listFolders()
    const names = resolveOrchestratorRemoteNames(this.config)
    const specs: { role: string; mailbox: string }[] = [
      { role: 'archive', mailbox: names.imap.archiveMailbox },
      { role: 'pending_review', mailbox: names.imap.pendingReviewMailbox },
      { role: 'pending_delete', mailbox: names.imap.pendingDeleteMailbox },
      { role: 'urgent', mailbox: names.imap.urgentMailbox },
      { role: 'trash', mailbox: names.imap.trashMailbox },
    ]
    const lifecycleOnServer: Array<{
      role: string
      mailbox: string
      resolved: string
      exactMatch: boolean
    }> = []
    for (const { role, mailbox } of specs) {
      const m = mailbox.trim()
      const resolved = m ? await this.imapResolveMailboxPath(m) : ''
      lifecycleOnServer.push({
        role,
        mailbox: m,
        resolved,
        exactMatch: m ? imapFolderListHasExactMailbox(folders, m, resolved) : false,
      })
    }

    const enriched: Array<{
      path: string
      name: string
      delimiter: string
      flags: string[]
      messages?: number
      unseen?: number
      legacy: boolean
      statusError?: string
    }> = []
    for (const f of folders) {
      const legacy = isLegacyImapMailboxLabel(f.path) || isLegacyImapMailboxLabel(f.name)
      const st = await new Promise<{
        box: { messages?: { total?: number; unseen?: number } } | null
        err?: Error
      }>((resolve) => {
        this.client!.status(f.path, (err, mailbox) => {
          if (err) resolve({ box: null, err })
          else resolve({ box: mailbox })
        })
      })
      if (st.err || !st.box) {
        enriched.push({
          path: f.path,
          name: f.name,
          delimiter: f.delimiter,
          flags: f.flags || [],
          legacy,
          statusError: st.err?.message || 'STATUS unavailable',
        })
      } else {
        enriched.push({
          path: f.path,
          name: f.name,
          delimiter: f.delimiter,
          flags: f.flags || [],
          messages: st.box.messages?.total,
          unseen: st.box.messages?.unseen,
          legacy,
        })
      }
    }
    return { folders: enriched, lifecycleOnServer }
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
      { role: 'urgent', mailbox: names.imap.urgentMailbox },
      { role: 'trash', mailbox: names.imap.trashMailbox },
    ]
    const entries: ImapLifecycleValidationEntry[] = []
    for (const { role, mailbox } of specs) {
      const m = mailbox.trim()
      if (!m) {
        entries.push({ role, mailbox, exists: false, error: 'Mailbox name is empty' })
        continue
      }
      const resolved = await this.imapResolveMailboxPath(m)
      const exists = imapFolderListHasExactMailbox(folders, m, resolved)
      if (exists) {
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
    if (!this.config || !this.connected || !this.client) {
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
            : operation === 'urgent'
              ? names.imap.urgentMailbox
              : ''
    if (!dest) {
      return { ok: false, error: `Unknown orchestrator operation: ${operation}` }
    }
    try {
      const rfc = context?.imapRfcMessageId ?? null
      const lastMb = context?.imapRemoteMailbox ?? null
      const destResolved = await this.imapResolveMailboxPath(dest.trim())

      await this.imapEnsureMailbox(dest)

      /* TEMPORARY: disable pre-move idempotent verify — false positives (duplicate Message-ID / stale
       * search) marked rows completed without moving mail on servers like web.de. Re-enable after
       * locate+move path is confirmed reliable. Post-move verification below stays. */
      // const already = await this.imapVerifyMessageInMailbox(destResolved, messageId, rfc)
      // if (already) {
      //   return {
      //     ok: true,
      //     skipped: true,
      //     imapUidAfterMove: already,
      //     imapMailboxAfterMove: destResolved,
      //   }
      // }

      const loc = await this.imapLocateMessageForMove(destResolved, messageId, rfc, lastMb)
      if (!loc) {
        return {
          ok: false,
          error:
            'IMAP: message not found in canonical mailboxes (INBOX + configured Archive / Pending / Urgent / Trash). Reconnect or run Sync Remote — legacy WRDesk-* paths are ignored for locate.',
        }
      }

      await this.imapMoveBetweenMailboxes(loc.mailbox, loc.uid, destResolved)

      /** UID may change after MOVE; RFC Message-ID is authoritative for verification. */
      let newUid =
        (await this.imapVerifyMessageInMailbox(destResolved, loc.uid, rfc)) ||
        (rfc ? await this.imapFindUidByHeaderMessageId(destResolved, rfc) : null)
      if (!newUid) {
        return {
          ok: false,
          error:
            'IMAP: MOVE reported success but message not found in destination (verification failed). Check folder path / namespace (e.g. web.de “.” delimiter) or server MOVE support.',
        }
      }
      return { ok: true, imapUidAfterMove: newUid, imapMailboxAfterMove: destResolved }
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

  /**
   * node-imap `search()` criteria: each criterion is its own array entry.
   * WRONG: `['UID', '90228']` (two top-level items → first parsed as bare `UID` with no args →
   * "Incorrect number of arguments for search option: UID").
   * RIGHT: `[['UID', '90228']]` or `[['UID', '90228:90228']]`, `[['HEADER','MESSAGE-ID', v]]`.
   *
   * All direct `.search(` call sites in this file:
   * - Folder list sync (`listMessages` path): `[['SINCE', since]]` → seq numbers
   * - `imapSearchAllUidsInCurrentMailbox`: `['ALL']`
   * - `imapSearchFirstUid`: normalized criteria (UID / HEADER)
   */
  private normalizeSearchCriteriaForNodeImap(criteria: unknown[]): unknown[] {
    if (!Array.isArray(criteria) || criteria.length === 0) return criteria
    const a0 = criteria[0]
    /* Flat top-level ['UID', id] → [['UID', id]] */
    if (criteria.length === 2 && typeof a0 === 'string' && a0.toUpperCase() === 'UID') {
      return [['UID', criteria[1]]]
    }
    /* Flat ['HEADER', field, value] → [['HEADER', field, value]] */
    if (criteria.length === 3 && typeof a0 === 'string' && a0.toUpperCase() === 'HEADER') {
      return [['HEADER', criteria[1], criteria[2]]]
    }
    return criteria
  }

  /** UID SEARCH in the currently selected mailbox. */
  private imapSearchFirstUid(criteria: unknown[]): Promise<number | null> {
    const normalized = this.normalizeSearchCriteriaForNodeImap(criteria) as any
    return new Promise((resolve) => {
      if (!this.client) {
        resolve(null)
        return
      }
      this.client.search(normalized, (err, uids: number[]) => {
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
      /* node-imap: each criterion must be one nested array (not flat HEADER/UID tuples). */
      const uid = await this.imapSearchFirstUid([['HEADER', 'MESSAGE-ID', v]])
      if (uid != null) return String(uid)
    }
    return null
  }

  private async imapUidPresentInMailbox(mailbox: string, uid: string): Promise<boolean> {
    await this.imapOpenBox(mailbox, true)
    const u = String(uid).trim()
    if (!/^\d+$/.test(u)) return false
    /* node-imap: UID criterion must be nested — flat ['UID', …] throws "Incorrect number of arguments". */
    const n = await this.imapSearchFirstUid([['UID', `${u}:${u}`]])
    return n != null
  }

  /**
   * Paths that match configured inbox + lifecycle mailboxes (resolved), for MOVE source search.
   * Legacy folders (WRDesk-*, "Archieve", etc.) must NOT be searched — they caused false “already moved”
   * when the message was still in Posteingang.
   */
  private async imapPathMatchesCanonicalLifecycle(
    rawPath: string,
    names: ReturnType<typeof resolveOrchestratorRemoteNames>,
    inboxLogical: string,
  ): Promise<boolean> {
    const trimmed = rawPath.trim()
    if (!trimmed) return false
    const candidates = new Set<string>()
    const addLogical = async (logical: string) => {
      const t = logical.trim()
      if (!t) return
      for (const p of await this.imapExpandMailboxTryPaths(t)) {
        candidates.add(p.trim().toLowerCase())
      }
    }
    await addLogical(inboxLogical)
    await addLogical(names.imap.archiveMailbox)
    await addLogical(names.imap.pendingDeleteMailbox)
    await addLogical(names.imap.pendingReviewMailbox)
    await addLogical(names.imap.urgentMailbox)
    await addLogical(names.imap.trashMailbox)
    const expandedRaw = await this.imapExpandMailboxTryPaths(trimmed)
    return expandedRaw.some((p) => candidates.has(p.trim().toLowerCase()))
  }

  private async imapOrderedSearchMailboxes(
    lastMail: string | null | undefined,
    names: ReturnType<typeof resolveOrchestratorRemoteNames>,
    inbox: string,
    destResolved: string,
  ): Promise<string[]> {
    const destL = destResolved.trim().toLowerCase()
    const pool = await this.imapLifecycleMailboxCandidatesResolved(names, inbox, destL)
    const out: string[] = []
    const pushUnique = (p: string) => {
      const t = p.trim()
      if (!t || t.toLowerCase() === destL) return
      if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
    }
    /** Prefer INBOX paths first (most moves originate there). */
    for (const p of await this.imapExpandMailboxTryPaths(inbox)) {
      pushUnique(p)
    }
    for (const p of pool) {
      pushUnique(p)
    }
    if (lastMail?.trim()) {
      const lm = lastMail.trim()
      const canonical = await this.imapPathMatchesCanonicalLifecycle(lm, names, inbox)
      if (canonical) {
        const expanded = await this.imapExpandMailboxTryPaths(lm)
        for (const p of expanded) pushUnique(p)
      } else {
        console.log(
          `[IMAP] locate MOVE source: ignoring non-canonical imap_remote_mailbox (legacy or typo folder): ${JSON.stringify(lm)}`,
        )
      }
    }
    return out
  }

  private async imapLocateMessageForMove(
    destMailboxResolved: string,
    uidHint: string,
    rfcMessageId: string | null | undefined,
    lastMailbox: string | null | undefined,
  ): Promise<{ mailbox: string; uid: string } | null> {
    if (!this.config || !this.client) return null
    const names = resolveOrchestratorRemoteNames(this.config)
    const inbox = this.config.folders?.inbox || 'INBOX'
    const order = await this.imapOrderedSearchMailboxes(lastMailbox, names, inbox, destMailboxResolved)

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

  /**
   * B: Always try `move()` first (`node-imap` uses RFC MOVE or internal COPY chain from CAPABILITY).
   * If MOVE fails with an “unsupported / bad command” style error, fall back to explicit COPY + \\Deleted + EXPUNGE.
   */
  private imapMoveBetweenMailboxes(sourceMailbox: string, uid: string, destMailbox: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected'))
        return
      }
      const client = this.client
      client.openBox(sourceMailbox, false, (err) => {
        if (err) {
          reject(err)
          return
        }
        this.refreshImapCapabilitiesSnapshot()

        const logMoved = (via: 'MOVE' | 'COPY+DELETE') => {
          console.log(`[IMAP] Moved UID ${uid}: "${sourceMailbox}" → "${destMailbox}" via ${via}`)
        }

        const runCopyDeleteFallback = () => {
          client.copy(uid, destMailbox, (copyErr) => {
            if (copyErr) {
              reject(copyErr)
              return
            }
            client.addFlags(uid, ['\\Deleted'], (flagErr) => {
              if (flagErr) {
                reject(flagErr)
                return
              }
              if (client.serverSupports('UIDPLUS')) {
                client.expunge([uid], (expErr) => {
                  if (expErr) reject(expErr)
                  else {
                    logMoved('COPY+DELETE')
                    resolve()
                  }
                })
              } else {
                client.expunge((expErr) => {
                  if (expErr) reject(expErr)
                  else {
                    logMoved('COPY+DELETE')
                    resolve()
                  }
                })
              }
            })
          })
        }

        client.move(uid, destMailbox, (moveErr) => {
          if (!moveErr) {
            logMoved('MOVE')
            resolve()
            return
          }
          if (imapMoveErrWarrantsCopyDeleteFallback(moveErr)) {
            console.warn(
              `[IMAP] MOVE failed for UID ${uid} ("${sourceMailbox}" → "${destMailbox}"), using COPY+DELETE:`,
              (moveErr as Error)?.message || moveErr,
            )
            runCopyDeleteFallback()
            return
          }
          reject(moveErr)
        })
      })
    })
  }

  private async imapEnsureMailbox(mailboxLogicalOrPath: string): Promise<void> {
    if (!this.client) {
      throw new Error('Not connected')
    }
    const logical = mailboxLogicalOrPath.trim()
    const fullPath = await this.imapResolveMailboxPath(logical)
    if (!fullPath) {
      throw new Error('IMAP: empty mailbox name')
    }
    const labelForLog = logical || fullPath
    console.log(
      `[IMAP] Ensuring mailbox: logical=${JSON.stringify(labelForLog)} → CREATE ${JSON.stringify(fullPath)}`,
    )
    return new Promise((resolve, reject) => {
      this.client!.addBox(fullPath, (err) => {
        if (!err) {
          console.log(`[IMAP] Created folder: ${JSON.stringify(labelForLog)} (${JSON.stringify(fullPath)})`)
          resolve()
          return
        }
        const m = String((err as Error).message || err)
        if (/exists|EXISTS|already/i.test(m)) {
          console.log(`[IMAP] Folder already exists: ${JSON.stringify(labelForLog)} (${JSON.stringify(fullPath)})`)
          resolve()
          return
        }
        reject(err)
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

