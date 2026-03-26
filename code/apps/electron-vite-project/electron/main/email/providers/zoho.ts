/**
 * Zoho Mail provider — OAuth2 + Zoho Mail REST API.
 * Datacenter: `com` (default) or `eu` for mail.zoho.eu / accounts.zoho.eu.
 */

import { shell } from 'electron'
import * as https from 'https'
import { URL } from 'url'
import {
  BaseEmailProvider,
  RawEmailMessage,
  RawAttachment,
  FolderInfo,
} from './base'
import {
  EmailAccountConfig,
  MessageSearchOptions,
  SendEmailPayload,
  SendResult,
} from '../types'
import type {
  OrchestratorRemoteOperation,
  OrchestratorRemoteApplyResult,
  OrchestratorRemoteApplyContext,
} from '../domain/orchestratorRemoteTypes'
import { resolveOrchestratorRemoteNames } from '../domain/mailboxLifecycleMapping'
import { oauthServerManager } from '../oauth-server'
import { getCredentialsForOAuth, type ZohoCreds } from '../credentials'

const ZOHO_MAIL_SCOPES = [
  'ZohoMail.messages.READ',
  'ZohoMail.messages.CREATE',
  'ZohoMail.folders.READ',
  'ZohoMail.folders.CREATE',
  'ZohoMail.messages.UPDATE',
  'ZohoMail.accounts.READ',
].join(',')

const ZOHO_COMPOSITE_PREFIX = 'zoho:'

function accountsHost(datacenter: 'com' | 'eu'): string {
  return datacenter === 'eu' ? 'accounts.zoho.eu' : 'accounts.zoho.com'
}

function mailHost(datacenter: 'com' | 'eu'): string {
  return datacenter === 'eu' ? 'mail.zoho.eu' : 'mail.zoho.com'
}

/** Canonical id: `zoho:{folderId}:{messageId}` */
export function buildZohoCompositeMessageId(folderId: string, messageId: string): string {
  return `${ZOHO_COMPOSITE_PREFIX}${folderId}:${messageId}`
}

function parseZohoCompositeMessageId(
  id: string,
): { folderId: string; messageId: string } | null {
  if (!id.startsWith(ZOHO_COMPOSITE_PREFIX)) return null
  const rest = id.slice(ZOHO_COMPOSITE_PREFIX.length)
  const colon = rest.indexOf(':')
  if (colon <= 0) return null
  return {
    folderId: rest.slice(0, colon),
    messageId: rest.slice(colon + 1),
  }
}

function unwrapData(json: any): any {
  if (json == null) return json
  if (typeof json === 'object' && json.data !== undefined) return json.data
  return json
}

export class ZohoProvider extends BaseEmailProvider {
  readonly providerType = 'zoho' as const

  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiresAt: number = 0
  private zohoAccountId: string | null = null
  private datacenter: 'com' | 'eu' = 'com'
  private orchestratorFolderCache: Map<string, string> = new Map()
  /** folderId → display name (for `RawEmailMessage.folder` / inbox lifecycle column). */
  private folderIdToName: Map<string, string> = new Map()

  private mailApiBase(): string {
    return `https://${mailHost(this.datacenter)}`
  }

  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.oauth) {
      throw new Error('Zoho Mail requires OAuth authentication')
    }
    this.config = config
    this.datacenter = config.zohoDatacenter === 'eu' ? 'eu' : 'com'
    this.accessToken = config.oauth.accessToken
    this.refreshToken = config.oauth.refreshToken
    this.tokenExpiresAt = config.oauth.expiresAt
    this.zohoAccountId = null
    this.orchestratorFolderCache.clear()
    this.folderIdToName.clear()

    if (this.isTokenExpired()) {
      await this.refreshAccessToken()
    }
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.accessToken = null
    this.refreshToken = null
    this.tokenExpiresAt = 0
    this.connected = false
    this.config = null
    this.zohoAccountId = null
    this.orchestratorFolderCache.clear()
    this.folderIdToName.clear()
  }

  private isTokenExpired(): boolean {
    return Date.now() > this.tokenExpiresAt - 300_000
  }

  private async ensureZohoAccountId(): Promise<string> {
    if (this.zohoAccountId) return this.zohoAccountId
    const json = await this.zohoApiRequest('GET', '/api/accounts')
    const rows = Array.isArray(unwrapData(json)) ? unwrapData(json) : []
    const want = (this.config?.email || '').trim().toLowerCase()
    const pick = (a: any) =>
      String(
        a?.emailAddress ||
          a?.mailId ||
          a?.accountName ||
          a?.userName ||
          a?.primaryEmailAddress ||
          '',
      )
        .trim()
        .toLowerCase()
    let hit = want ? rows.find((a: any) => pick(a) === want) : undefined
    if (!hit && rows.length === 1) hit = rows[0]
    if (!hit) {
      hit = rows[0]
    }
    const id = hit?.accountId ?? hit?.account_id ?? hit?.zuid
    if (!id) {
      throw new Error('Zoho Mail: could not resolve account id from /api/accounts')
    }
    this.zohoAccountId = String(id)
    return this.zohoAccountId
  }

  private async zohoApiRequest(method: string, path: string, body?: unknown): Promise<any> {
    if (!this.accessToken) {
      throw new Error('Zoho Mail: not authenticated')
    }
    const base = this.mailApiBase()
    const url = new URL(path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`)

    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const opts: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      headers: {
        Authorization: `Zoho-oauthtoken ${this.accessToken}`,
        Accept: 'application/json',
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}),
      },
    }

    return new Promise((resolve, reject) => {
      const req = https.request(opts, (res) => {
        let data = ''
        res.on('data', (c) => {
          data += c
        })
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {}
            if (res.statusCode && res.statusCode >= 400) {
              const msg =
                json?.data?.errorMessage ||
                json?.message ||
                json?.error ||
                data ||
                `HTTP ${res.statusCode}`
              reject(new Error(`Zoho API ${res.statusCode}: ${msg}`))
              return
            }
            if (json?.status?.code && Number(json.status.code) >= 400) {
              reject(new Error(`Zoho API: ${json.status.description || JSON.stringify(json.status)}`))
              return
            }
            resolve(json)
          } catch (e: any) {
            reject(new Error(`Zoho API: invalid JSON (${e?.message})`))
          }
        })
      })
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }

  private async refreshAccessToken(): Promise<void> {
    const oauthConfigRaw = await getCredentialsForOAuth('zoho')
    if (!oauthConfigRaw || !this.refreshToken) {
      throw new Error('Cannot refresh Zoho token: missing credentials')
    }
    const oauthConfig = oauthConfigRaw as ZohoCreds
    const dc =
      this.config?.zohoDatacenter === 'eu'
        ? 'eu'
        : oauthConfig.datacenter === 'eu'
          ? 'eu'
          : 'com'
    const host = accountsHost(dc)
    const postData = new URLSearchParams({
      refresh_token: this.refreshToken,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      grant_type: 'refresh_token',
    }).toString()

    const json: any = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host,
          path: '/oauth/v2/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = ''
          res.on('data', (c) => {
            data += c
          })
          res.on('end', () => {
            try {
              resolve(JSON.parse(data || '{}'))
            } catch {
              resolve({})
            }
          })
        },
      )
      req.on('error', reject)
      req.write(postData)
      req.end()
    })

    if (json.error) {
      throw new Error(json.error_description || json.error || 'Zoho token refresh failed')
    }
    this.accessToken = json.access_token
    if (json.refresh_token) this.refreshToken = json.refresh_token
    this.tokenExpiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000

    if (this.onTokenRefresh && this.refreshToken && this.accessToken) {
      this.onTokenRefresh({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiresAt: this.tokenExpiresAt,
      })
    }
  }

  async testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connect(config)
      await this.ensureZohoAccountId()
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || 'Zoho connection failed' }
    } finally {
      await this.disconnect()
    }
  }

  async listFolders(): Promise<FolderInfo[]> {
    const aid = await this.ensureZohoAccountId()
    const json = await this.zohoApiRequest('GET', `/api/accounts/${aid}/folders`)
    const raw = unwrapData(json)
    const folders = Array.isArray(raw) ? raw : []
    this.folderIdToName.clear()
    const mapped = folders.map((f: any) => ({
      name: String(f.folderName || f.name || f.FOLDERNAME || ''),
      path: String(f.folderId || f.folder_id || f.FOLDERID || ''),
      delimiter: '/',
      flags: f.isSystem || f.systemFolder ? ['\\System'] : [],
      totalMessages: Number(f.messageCount || f.totalMessages || 0) || 0,
      unreadMessages: Number(f.unreadCount || f.unreadMessages || 0) || 0,
    }))
    for (const fo of mapped) {
      if (fo.path) this.folderIdToName.set(fo.path, fo.name)
    }
    return mapped
  }

  private parseZohoAddress(addr: string | undefined): { email: string; name?: string } {
    if (!addr) return { email: '' }
    return this.parseEmailAddress(addr.trim())
  }

  private parseZohoMessageContent(content: any, folderId: string, folderDisplayName?: string): RawEmailMessage {
    const mid = String(content?.messageId || content?.message_id || '')
    const fid = String(content?.folderId || content?.folder_id || folderId)
    const id = buildZohoCompositeMessageId(fid, mid || String(content?.messageID || ''))

    const fromStr = content?.fromAddress || content?.sender || content?.from || ''
    const toStr = content?.toAddress || content?.to || ''
    const ccStr = content?.ccAddress || content?.cc || ''

    const received =
      content?.receivedTime ||
      content?.receivedTimeInGMT ||
      content?.sentTimeInGMT ||
      content?.date
    let date = new Date()
    if (received != null) {
      const n = typeof received === 'number' ? received : Date.parse(String(received))
      if (!Number.isNaN(n)) date = new Date(typeof received === 'number' ? received : n)
    }

    const isRead = content?.isRead === true || content?.isRead === 'true' || content?.read === true
    const isFlagged = content?.isFlagged === true || content?.flagged === true

    const bodyText =
      (typeof content?.content === 'string' && content.content) ||
      (typeof content?.textContent === 'string' && content.textContent) ||
      undefined
    const bodyHtml =
      (typeof content?.htmlContent === 'string' && content.htmlContent) ||
      (typeof content?.html === 'string' && content.html) ||
      undefined

    const attRaw = content?.attachments || content?.attachmentDetails || content?.attachmentInfo
    const attN = Array.isArray(attRaw) ? attRaw.length : 0

    return {
      id,
      threadId: content?.threadId ? String(content.threadId) : undefined,
      subject: String(content?.subject || '(No subject)'),
      from: this.parseZohoAddress(fromStr),
      to: toStr
        ? toStr.split(/[,;]/).map((s) => this.parseZohoAddress(s.trim())).filter((x) => x.email)
        : [],
      cc: ccStr
        ? ccStr.split(/[,;]/).map((s) => this.parseZohoAddress(s.trim())).filter((x) => x.email)
        : undefined,
      date,
      bodyHtml,
      bodyText: bodyText || (bodyHtml ? undefined : ''),
      flags: {
        seen: !!isRead,
        flagged: !!isFlagged,
        answered: false,
        draft: false,
        deleted: false,
      },
      labels: [],
      folder: folderDisplayName || this.folderIdToName.get(fid) || fid,
      headers: {
        messageId: content?.messageIdHeader ? String(content.messageIdHeader) : undefined,
      },
      hasAttachments: attN > 0,
      attachmentCount: attN,
    }
  }

  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const aid = await this.ensureZohoAccountId()
    const folderId = (folder || this.config?.folders?.inbox || '').trim()
    if (!folderId) {
      throw new Error('Zoho fetchMessages: missing inbox folder id — reconnect the account.')
    }
    await this.listFolders()

    const syncAll = options?.syncFetchAllPages === true
    const maxTotal = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? options?.limit ?? 50), 500)

    const fromMs = options?.fromDate ? new Date(options.fromDate).getTime() : null
    const toMs = options?.toDate ? new Date(options.toDate).getTime() : null

    const summaries: Array<{ folderId: string; messageId: string; receivedMs: number }> = []
    let start = 1
    const pageLimit = 200

    for (;;) {
      if (summaries.length >= maxTotal) break
      const params = new URLSearchParams({
        folderId,
        limit: String(Math.min(pageLimit, maxTotal - summaries.length)),
        start: String(start),
        sortBy: 'receivedTime',
        sortorder: 'false',
      })
      const json = await this.zohoApiRequest('GET', `/api/accounts/${aid}/messages/view?${params.toString()}`)
      const rows = Array.isArray(unwrapData(json)) ? unwrapData(json) : []
      if (rows.length === 0) break

      for (const row of rows) {
        if (summaries.length >= maxTotal) break
        const messageId = String(row.messageId || row.message_id || row.mailId || '')
        const fid = String(row.folderId || row.folder_id || folderId)
        if (!messageId) continue
        const rt = row.receivedTime ?? row.receivedTimeInGMT ?? row.sentTimeInGMT
        let receivedMs = Date.now()
        if (rt != null) {
          const t = typeof rt === 'number' ? rt : Date.parse(String(rt))
          if (!Number.isNaN(t)) receivedMs = typeof rt === 'number' ? rt : t
        }
        if (fromMs != null && receivedMs < fromMs) continue
        if (toMs != null && receivedMs > toMs) continue
        summaries.push({ folderId: fid, messageId, receivedMs })
      }

      if (rows.length < pageLimit) break
      start += pageLimit
      if (!syncAll && summaries.length >= (options?.limit ?? 50)) break
    }

    const CONCURRENT = 10
    const out: RawEmailMessage[] = []
    for (let i = 0; i < summaries.length; i += CONCURRENT) {
      const slice = summaries.slice(i, i + CONCURRENT)
      const settled = await Promise.allSettled(slice.map((s) => this.fetchMessage(buildZohoCompositeMessageId(s.folderId, s.messageId))))
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) out.push(r.value)
      }
    }
    return out
  }

  async fetchMessage(messageId: string): Promise<RawEmailMessage | null> {
    try {
      const aid = await this.ensureZohoAccountId()
      const parsed = parseZohoCompositeMessageId(messageId)
      if (!parsed) {
        console.warn('[Zoho] fetchMessage: expected composite id zoho:folderId:messageId, got', messageId?.slice(0, 40))
        return null
      }
      const { folderId, messageId: mid } = parsed
      const json = await this.zohoApiRequest(
        'GET',
        `/api/accounts/${aid}/folders/${folderId}/messages/${mid}/content`,
      )
      const content = unwrapData(json)
      if (this.folderIdToName.size === 0) {
        try {
          await this.listFolders()
        } catch {
          /* ignore */
        }
      }
      return this.parseZohoMessageContent(
        content,
        folderId,
        this.folderIdToName.get(folderId),
      )
    } catch (e) {
      console.error('[Zoho] fetchMessage error:', messageId, e)
      return null
    }
  }

  async listAttachments(messageId: string): Promise<RawAttachment[]> {
    const raw = await this.fetchMessage(messageId)
    if (!raw) return []
    const aid = await this.ensureZohoAccountId()
    const parsed = parseZohoCompositeMessageId(messageId)
    if (!parsed) return []
    try {
      const json = await this.zohoApiRequest(
        'GET',
        `/api/accounts/${aid}/folders/${parsed.folderId}/messages/${parsed.messageId}/content`,
      )
      const content = unwrapData(json)
      const att = content?.attachments || content?.attachmentDetails || content?.attachmentInfo
      const list = Array.isArray(att) ? att : []
      return list.map((a: any, i: number) => ({
        id: String(a.attachmentId || a.attachment_id || a.partId || i),
        filename: String(a.fileName || a.filename || `attachment-${i}`),
        mimeType: String(a.contentType || a.mimeType || 'application/octet-stream'),
        size: Number(a.size || a.attachmentSize || 0) || 0,
        contentId: a.contentId ? String(a.contentId) : undefined,
        isInline: !!a.inline || !!a.isInline,
      }))
    } catch {
      return []
    }
  }

  async fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer | null> {
    const aid = await this.ensureZohoAccountId()
    const parsed = parseZohoCompositeMessageId(messageId)
    if (!parsed) return null
    try {
      const path = `/api/accounts/${aid}/folders/${parsed.folderId}/messages/${parsed.messageId}/attachments/${attachmentId}`
      const json = await this.zohoApiRequest('GET', path)
      const row = unwrapData(json)
      const b64 = row?.content || row?.attachmentContent || row?.data
      if (typeof b64 === 'string' && b64.length > 0) {
        return Buffer.from(b64, 'base64')
      }
      return null
    } catch (e) {
      console.error('[Zoho] fetchAttachment:', e)
      return null
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    const parsed = parseZohoCompositeMessageId(messageId)
    if (!parsed) return
    const aid = await this.ensureZohoAccountId()
    try {
      await this.zohoApiRequest('PUT', `/api/accounts/${aid}/messages/${parsed.messageId}/markRead`)
    } catch {
      await this.zohoApiRequest('POST', `/api/accounts/${aid}/updateMessage`, {
        folderId: parsed.folderId,
        messageId: parsed.messageId,
        mode: 'markAsRead',
      })
    }
  }

  async markAsUnread(messageId: string): Promise<void> {
    const parsed = parseZohoCompositeMessageId(messageId)
    if (!parsed) return
    const aid = await this.ensureZohoAccountId()
    try {
      await this.zohoApiRequest('PUT', `/api/accounts/${aid}/messages/${parsed.messageId}/markUnread`)
    } catch {
      await this.zohoApiRequest('POST', `/api/accounts/${aid}/updateMessage`, {
        folderId: parsed.folderId,
        messageId: parsed.messageId,
        mode: 'markAsUnread',
      })
    }
  }

  async setFlagged(messageId: string, flagged: boolean): Promise<void> {
    const parsed = parseZohoCompositeMessageId(messageId)
    if (!parsed) return
    const aid = await this.ensureZohoAccountId()
    await this.zohoApiRequest('POST', `/api/accounts/${aid}/updateMessage`, {
      folderId: parsed.folderId,
      messageId: parsed.messageId,
      mode: flagged ? 'flag' : 'unflag',
    }).catch(() => {
      /* optional on older accounts */
    })
  }

  async sendEmail(payload: SendEmailPayload): Promise<SendResult> {
    try {
      const aid = await this.ensureZohoAccountId()
      const fromAddr = (this.config?.email || '').trim()
      if (!fromAddr) {
        return { success: false, error: 'Zoho: missing account email for From address' }
      }
      await this.zohoApiRequest('POST', `/api/accounts/${aid}/messages`, {
        fromAddress: fromAddr,
        toAddress: payload.to.join(','),
        ccAddress: payload.cc?.length ? payload.cc.join(',') : undefined,
        subject: payload.subject,
        content: payload.bodyText,
        mailFormat: 'plaintext',
      })
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || 'Zoho send failed' }
    }
  }

  async deleteMessage(messageId: string, _context?: OrchestratorRemoteApplyContext): Promise<void> {
    if (!this.config) throw new Error('Not connected')
    const names = resolveOrchestratorRemoteNames(this.config)
    const trashName = names.zoho.trashFolder
    const trashId = await this.ensureZohoOrchestratorFolder(trashName, { preferSystemTrash: true })
    const parsed = parseZohoCompositeMessageId(messageId)
    if (!parsed) {
      throw new Error('Zoho deleteMessage: expected composite message id')
    }
    const aid = await this.ensureZohoAccountId()
    await this.zohoApiRequest(
      'PUT',
      `/api/accounts/${aid}/messages/${parsed.messageId}/move?folderId=${encodeURIComponent(trashId)}`,
    )
  }

  async applyOrchestratorRemoteOperation(
    messageId: string,
    operation: OrchestratorRemoteOperation,
    _context?: OrchestratorRemoteApplyContext,
  ): Promise<OrchestratorRemoteApplyResult> {
    try {
      if (!this.config) return { ok: false, error: 'Not connected' }
      const names = resolveOrchestratorRemoteNames(this.config)
      let folderName: string
      if (operation === 'archive') {
        folderName = names.zoho.archiveFolder
      } else if (operation === 'pending_review') {
        folderName = names.zoho.pendingReviewFolder
      } else if (operation === 'pending_delete') {
        folderName = names.zoho.pendingDeleteFolder
      } else if (operation === 'urgent') {
        folderName = names.zoho.urgentFolder
      } else {
        return { ok: false, error: `Unknown orchestrator operation: ${operation}` }
      }

      const destId = await this.ensureZohoOrchestratorFolder(folderName, { preferSystemTrash: false })
      const parsed = parseZohoCompositeMessageId(messageId)
      if (!parsed) {
        return { ok: false, error: 'Zoho: message id must be zoho:folderId:messageId' }
      }
      const aid = await this.ensureZohoAccountId()
      console.log(
        `[Zoho] MOVE message ${parsed.messageId.slice(0, 12)}… → folder "${folderName}" (${operation})`,
      )
      await this.zohoApiRequest(
        'PUT',
        `/api/accounts/${aid}/messages/${parsed.messageId}/move?folderId=${encodeURIComponent(destId)}`,
      )
      return { ok: true }
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (
        /same folder|already in|duplicate|not found|does not exist|invalid folder|error code/i.test(msg)
      ) {
        return { ok: true, skipped: true }
      }
      return { ok: false, error: msg }
    }
  }

  private async ensureZohoOrchestratorFolder(
    displayName: string,
    opts: { preferSystemTrash: boolean },
  ): Promise<string> {
    const trimmed = displayName.trim()
    if (!trimmed) throw new Error('Empty Zoho folder name')

    const cached = this.orchestratorFolderCache.get(trimmed)
    if (cached) return cached

    const folders = await this.listFolders()
    if (opts.preferSystemTrash) {
      const t = folders.find(
        (f) =>
          f.name.trim().toLowerCase() === 'trash' ||
          f.flags.some((x) => /trash/i.test(x)),
      )
      if (t?.path) {
        this.orchestratorFolderCache.set(trimmed, t.path)
        return t.path
      }
    }

    const existing = folders.find((f) => f.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (existing?.path) {
      this.orchestratorFolderCache.set(trimmed, existing.path)
      return existing.path
    }

    const aid = await this.ensureZohoAccountId()
    console.log('[Zoho] Creating folder:', trimmed)
    try {
      const created = await this.zohoApiRequest('POST', `/api/accounts/${aid}/folders`, {
        folderName: trimmed,
      })
      const data = unwrapData(created)
      const newId = data?.folderId || data?.folder_id || created?.folderId
      if (!newId) throw new Error('Zoho folder create: no folderId in response')
      const id = String(newId)
      this.orchestratorFolderCache.set(trimmed, id)
      return id
    } catch (createErr) {
      const retry = await this.listFolders()
      const found = retry.find((f) => f.name.trim().toLowerCase() === trimmed.toLowerCase())
      if (found?.path) {
        this.orchestratorFolderCache.set(trimmed, found.path)
        return found.path
      }
      throw createErr
    }
  }

  /**
   * OAuth connect flow — resolves inbox/sent folder ids and primary email.
   */
  async startOAuthFlow(): Promise<{
    oauth: NonNullable<EmailAccountConfig['oauth']>
    email: string
    folders: EmailAccountConfig['folders']
    zohoDatacenter: 'com' | 'eu'
  }> {
    const oauthConfigRawStart = await getCredentialsForOAuth('zoho')
    if (!oauthConfigRawStart) {
      throw new Error(
        'Zoho OAuth client credentials not configured. Add Client ID and Secret in the connect wizard.',
      )
    }
    const oauthConfig = oauthConfigRawStart as ZohoCreds
    if (oauthServerManager.isFlowInProgress()) {
      throw new Error('Another OAuth flow is already in progress.')
    }

    const dc = oauthConfig.datacenter === 'eu' ? 'eu' : 'com'
    this.datacenter = dc

    try {
      const { callbackUrl, resultPromise } = await oauthServerManager.beginOAuthFlow('zoho', 5 * 60 * 1000)
      const authUrl = this.buildAuthUrl(oauthConfig.clientId, dc, callbackUrl)
      await shell.openExternal(authUrl)
      const result = await resultPromise
      if (!result.success) {
        throw new Error(result.errorDescription || result.error || 'Zoho OAuth failed')
      }
      if (!result.code) throw new Error('No authorization code')

      const tokens = await this.exchangeCodeForTokens(oauthConfig, result.code, dc, callbackUrl)
      this.accessToken = tokens.accessToken
      this.refreshToken = tokens.refreshToken
      this.tokenExpiresAt = tokens.expiresAt
      this.config = {
        id: '__zoho_oauth_probe__',
        displayName: 'Zoho',
        email: '',
        provider: 'zoho',
        authType: 'oauth2',
        oauth: tokens,
        folders: { monitored: [], inbox: '' },
        sync: { maxAgeDays: 0, analyzePdfs: true, batchSize: 50 },
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        zohoDatacenter: dc,
      }
      this.connected = true
      this.zohoAccountId = null

      const aid = await this.ensureZohoAccountId()
      const accJson = await this.zohoApiRequest('GET', '/api/accounts')
      const rows = Array.isArray(unwrapData(accJson)) ? unwrapData(accJson) : []
      const row = rows.find((a: any) => String(a?.accountId || a?.account_id) === aid) || rows[0]
      const email = String(
        row?.emailAddress || row?.mailId || row?.primaryEmailAddress || row?.accountName || '',
      ).trim()

      const folderList = await this.listFolders()
      const inbox = folderList.find(
        (f) => f.name.toLowerCase() === 'inbox' || f.flags.some((x) => /inbox/i.test(x)),
      )
      const sent = folderList.find((f) => f.name.toLowerCase() === 'sent' || /sent/i.test(f.name))
      const inboxId = inbox?.path || folderList[0]?.path
      if (!inboxId) {
        throw new Error('Zoho: could not resolve Inbox folder id')
      }

      await this.disconnect()

      return {
        oauth: tokens,
        email: email || '',
        folders: {
          monitored: [inboxId],
          inbox: inboxId,
          sent: sent?.path,
        },
        zohoDatacenter: dc,
      }
    } catch (e: any) {
      await oauthServerManager.cancelFlow().catch(() => {})
      await this.disconnect()
      throw e
    }
  }

  private buildAuthUrl(clientId: string, dc: 'com' | 'eu', redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: ZOHO_MAIL_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    })
    return `https://${accountsHost(dc)}/oauth/v2/auth?${params.toString()}`
  }

  private async exchangeCodeForTokens(
    oauthConfig: { clientId: string; clientSecret: string; datacenter?: 'com' | 'eu' },
    code: string,
    dc: 'com' | 'eu',
    redirectUri: string,
  ): Promise<NonNullable<EmailAccountConfig['oauth']>> {
    const host = accountsHost(dc)
    const postData = new URLSearchParams({
      code,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString()

    const json: any = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host,
          path: '/oauth/v2/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = ''
          res.on('data', (c) => {
            data += c
          })
          res.on('end', () => {
            try {
              resolve(JSON.parse(data || '{}'))
            } catch {
              resolve({})
            }
          })
        },
      )
      req.on('error', reject)
      req.write(postData)
      req.end()
    })

    if (json.error) {
      throw new Error(json.error_description || json.error || 'Zoho token exchange failed')
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token || '',
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      scope: typeof json.scope === 'string' ? json.scope : ZOHO_MAIL_SCOPES,
    }
  }
}

export const zohoProvider = new ZohoProvider()
