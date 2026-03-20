/**
 * Microsoft Outlook/365 Provider
 * 
 * Email provider implementation for Microsoft 365 and Outlook.com using Microsoft Graph API.
 * Uses OAuth2 for authentication - never stores passwords.
 * 
 * Refactored to use centralized OAuth server manager for production-grade reliability.
 */

import { app, shell } from 'electron'
import type { IncomingHttpHeaders } from 'http'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
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
import type {
  OrchestratorRemoteOperation,
  OrchestratorRemoteApplyResult,
} from '../domain/orchestratorRemoteTypes'
import {
  resolveOrchestratorRemoteNames,
  REMOTE_DELETION_TARGETS,
} from '../domain/mailboxLifecycleMapping'
import { sanitizeHtmlToText } from '../sanitizer'
import { oauthServerManager } from '../oauth-server'
import { getCredentialsForOAuth } from '../credentials'

/**
 * Microsoft Graph API scopes
 */
const OUTLOOK_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send'
]

/**
 * OAuth2 config storage path for Outlook
 */
function getOutlookOAuthConfigPath(): string {
  return path.join(app.getPath('userData'), 'outlook-oauth-config.json')
}

/**
 * Load OAuth client credentials for Outlook
 */
export function loadOutlookOAuthConfig(): { clientId: string; clientSecret?: string; tenantId?: string } | null {
  try {
    const configPath = getOutlookOAuthConfigPath()
    console.log('[Outlook] Loading OAuth config from:', configPath)
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      console.log('[Outlook] Loaded config, clientId:', config.clientId?.substring(0, 8) + '...')
      console.log('[Outlook] TenantId:', config.tenantId || 'common')
      return config
    }
    console.log('[Outlook] Config file does not exist')
  } catch (err) {
    console.error('[Outlook] Error loading OAuth config:', err)
  }
  return null
}

/**
 * Save OAuth client credentials for Outlook
 * @param tenantId - Optional tenant ID. Use 'common' for multi-tenant, 'organizations' for any org, or specific tenant ID
 */
export function saveOutlookOAuthConfig(clientId: string, clientSecret?: string, tenantId?: string): void {
  try {
    const configPath = getOutlookOAuthConfigPath()
    console.log('[Outlook] Saving OAuth config to:', configPath)
    console.log('[Outlook] ClientId:', clientId?.substring(0, 8) + '...')
    console.log('[Outlook] TenantId:', tenantId || 'common (default)')
    fs.writeFileSync(configPath, JSON.stringify({ clientId, clientSecret, tenantId: tenantId || 'organizations' }), 'utf-8')
    console.log('[Outlook] OAuth config saved successfully')
  } catch (err) {
    console.error('[Outlook] Error saving OAuth config:', err)
  }
}

export class OutlookProvider extends BaseEmailProvider {
  readonly providerType = 'microsoft365' as const
  
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiresAt: number = 0
  private orchestratorFolderCache: Map<string, string> = new Map()
  
  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.oauth) {
      throw new Error('Outlook requires OAuth authentication')
    }
    
    this.config = config
    this.accessToken = config.oauth.accessToken
    this.refreshToken = config.oauth.refreshToken
    this.tokenExpiresAt = config.oauth.expiresAt
    
    // Refresh token if expired
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
    this.orchestratorFolderCache.clear()
  }
  
  async testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connect(config)
      
      // Try to fetch user profile
      const profile = await this.graphApiRequest('GET', '/me')
      
      if (profile.mail || profile.userPrincipalName) {
        return { success: true }
      }
      
      return { success: false, error: 'Could not verify Outlook account' }
    } catch (err: any) {
      return { success: false, error: err.message || 'Connection failed' }
    } finally {
      await this.disconnect()
    }
  }
  
  async listFolders(): Promise<FolderInfo[]> {
    const response = await this.graphApiRequest('GET', '/me/mailFolders?$top=50')
    const folders = response.value || []
    
    return folders.map((folder: any) => ({
      name: folder.displayName,
      path: folder.id,
      delimiter: '/',
      flags: folder.isHidden ? ['\\Hidden'] : [],
      totalMessages: folder.totalItemCount || 0,
      unreadMessages: folder.unreadItemCount || 0
    }))
  }
  
  /**
   * Graph mail folder segment: well-known `inbox` or a folder UUID. Avoid upper-case `INBOX` (IMAP) in the path.
   */
  private normalizeGraphMailFolderId(folder: string): string {
    const f = (folder || 'inbox').trim()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(f)) {
      return f
    }
    if (f.toUpperCase() === 'INBOX') return 'inbox'
    return f
  }

  private buildMessagesODataQuery(options?: MessageSearchOptions): URLSearchParams {
    const params = new URLSearchParams()
    const filters: string[] = []

    if (options?.unreadOnly) filters.push('isRead eq false')
    if (options?.flaggedOnly) filters.push("flag/flagStatus eq 'flagged'")
    if (options?.hasAttachments) filters.push('hasAttachments eq true')
    if (options?.fromDate) filters.push(`receivedDateTime ge ${options.fromDate}`)
    if (options?.toDate) filters.push(`receivedDateTime le ${options.toDate}`)

    if (filters.length > 0) params.append('$filter', filters.join(' and '))
    if (!options?.search) params.append('$orderby', 'receivedDateTime desc')
    if (options?.search) params.append('$search', `"${options.search}"`)

    return params
  }

  /**
   * UI / single-page list: one Graph request (optionally paginated when syncFetchAllPages and a low cap).
   */
  private async fetchMessagesListResponse(
    folderId: string,
    options: MessageSearchOptions | undefined,
    pageTop: number,
    selectFields: string,
  ): Promise<{ collected: any[]; useClientFilter: boolean }> {
    const params = this.buildMessagesODataQuery(options)
    params.append('$top', String(pageTop))
    params.append('$select', selectFields)

    const useClientFilter = !!(options?.from || options?.subject)
    const requestUrl = `/me/mailFolders/${folderId}/messages?${params.toString()}`

    const collected: any[] = []
    let response = await this.graphApiRequest('GET', requestUrl)
    let page = response.value || []
    collected.push(...page)
    let graphPageIdx = 1
    console.log(
      `[Outlook] messages page ${graphPageIdx}: +${page.length} (cumulative ${collected.length}, $top=${pageTop})`,
    )

    const syncAll = options?.syncFetchAllPages === true
    const maxTotal = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? pageTop), 999)

    if (syncAll) {
      let nextLink: string | undefined = response['@odata.nextLink']
      while (nextLink && collected.length < maxTotal) {
        graphPageIdx++
        response = await this.graphApiRequestAbsolute('GET', nextLink)
        page = response.value || []
        for (const msg of page) {
          if (collected.length >= maxTotal) break
          collected.push(msg)
        }
        console.log(
          `[Outlook] messages page ${graphPageIdx}: +${page.length} (cumulative ${collected.length}${response['@odata.nextLink'] ? ', nextLink' : ', end'})`,
        )
        nextLink = response['@odata.nextLink']
        if (!page.length && !nextLink) break
      }
    }

    return { collected, useClientFilter }
  }

  /**
   * Full sync: list **all** message IDs with stable paging ($top=100), then GET each message (concurrency 10).
   * Matches Graph guidance for reliable pagination; list+item avoids truncated list payloads.
   */
  private async fetchAllMessagesTwoPhase(
    folderId: string,
    options: MessageSearchOptions | undefined,
    maxIds: number,
  ): Promise<RawEmailMessage[]> {
    const listParamsBase = this.buildMessagesODataQuery(options)
    listParamsBase.append('$select', 'id')
    const LIST_TOP = 100
    listParamsBase.append('$top', String(LIST_TOP))

    const ids: string[] = []
    const seen = new Set<string>()
    const requestUrl = `/me/mailFolders/${folderId}/messages?${listParamsBase.toString()}`
    let response = await this.graphApiRequest('GET', requestUrl)
    let page = response.value || []
    for (const row of page) {
      const id = row?.id as string | undefined
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
        if (ids.length >= maxIds) break
      }
    }
    let nextLink: string | undefined = response['@odata.nextLink']
    let pageIdx = 1
    console.log(
      `[Outlook] sync list-ids page ${pageIdx}: +${page.length} ids (cumulative ${ids.length}, max=${maxIds === Number.MAX_SAFE_INTEGER ? 'unlimited' : maxIds})`,
    )

    while (nextLink && ids.length < maxIds) {
      pageIdx++
      response = await this.graphApiRequestAbsolute('GET', nextLink)
      page = response.value || []
      for (const row of page) {
        const id = row?.id as string | undefined
        if (id && !seen.has(id)) {
          seen.add(id)
          ids.push(id)
          if (ids.length >= maxIds) break
        }
      }
      console.log(
        `[Outlook] sync list-ids page ${pageIdx}: +${page.length} ids (cumulative ${ids.length}${response['@odata.nextLink'] ? ', nextLink' : ', end'})`,
      )
      nextLink = response['@odata.nextLink']
      if (!page.length && !nextLink) break
    }

    const nextAfterList = response['@odata.nextLink']
    if (!nextAfterList && page.length === LIST_TOP && ids.length < maxIds) {
      console.warn(
        `[Outlook] List ended on a full ${LIST_TOP}-id page with no @odata.nextLink (${ids.length} id(s)). ` +
          `If the folder has more mail, this may be Graph throttling or a query edge case — check logs for 429/401.`,
      )
    }

    /** Lower concurrency + small gaps reduce delegated-token throttling (was yielding ~100 successes then nulls). */
    const CONCURRENCY = 4
    const INTER_BATCH_MS = 200
    const out: RawEmailMessage[] = []
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      if (i > 0) await new Promise((r) => setTimeout(r, INTER_BATCH_MS))
      const chunk = ids.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(chunk.map((id) => this.fetchMessage(id, folderId)))
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]
        if (r.status === 'fulfilled' && r.value) {
          out.push(r.value)
        } else if (r.status === 'rejected') {
          console.warn('[Outlook] fetchMessage failed in batch:', chunk[j], (r as PromiseRejectedResult).reason)
        }
      }
      if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= ids.length) {
        console.log(
          `[Outlook] detail-fetch progress: ${Math.min(i + CONCURRENCY, ids.length)}/${ids.length} attempted, ${out.length} retrieved`,
        )
      }
    }

    if (out.length < ids.length) {
      console.warn(
        `[Outlook] two-phase sync: ${ids.length} id(s) listed but only ${out.length} full message(s) retrieved (failures/throttling/null returns)`,
      )
    }
    console.log(`[Outlook] two-phase sync: ${ids.length} id(s) listed, ${out.length} full message(s) retrieved`)
    return out
  }

  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const syncAll = options?.syncFetchAllPages === true
    const folderId = this.normalizeGraphMailFolderId(folder)

    const singleTop = Math.min(Math.max(1, options?.limit ?? 50), 999)
    const maxTotal = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? singleTop), 999)
    const pageTop = syncAll ? Math.min(999, maxTotal) : singleTop

    if (syncAll) {
      const raw = await this.fetchAllMessagesTwoPhase(folderId, options, maxTotal)
      let messages: any[] = raw

      const useClientFilter = !!(options?.from || options?.subject)
      if (useClientFilter && messages.length > 0) {
        const fromFilter = options?.from?.toLowerCase()
        const subjectFilter = options?.subject?.toLowerCase()
        messages = messages.filter((msg: any) => {
          let match = true
          if (fromFilter) {
            const msgFrom = (msg.from?.email || '').toLowerCase()
            const msgFromName = (msg.from?.name || '').toLowerCase()
            match = match && (msgFrom.includes(fromFilter) || msgFromName.includes(fromFilter) || fromFilter.includes(msgFrom))
          }
          if (subjectFilter && match) {
            const msgSubject = (msg.subject || '').toLowerCase()
            match = match && (msgSubject.includes(subjectFilter) || subjectFilter.includes(msgSubject))
          }
          return match
        })
      }
      return messages
    }

    const { collected, useClientFilter } = await this.fetchMessagesListResponse(
      folderId,
      options,
      pageTop,
      'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,isRead,flag,isDraft,hasAttachments',
    )

    let messages = collected
    if (useClientFilter && messages.length > 0) {
      const fromFilter = options?.from?.toLowerCase()
      const subjectFilter = options?.subject?.toLowerCase()
      messages = messages.filter((msg: any) => {
        let match = true
        if (fromFilter) {
          const msgFrom = (msg.from?.emailAddress?.address || '').toLowerCase()
          const msgFromName = (msg.from?.emailAddress?.name || '').toLowerCase()
          match = match && (msgFrom.includes(fromFilter) || msgFromName.includes(fromFilter) || fromFilter.includes(msgFrom))
        }
        if (subjectFilter && match) {
          const msgSubject = (msg.subject || '').toLowerCase()
          match = match && (msgSubject.includes(subjectFilter) || subjectFilter.includes(msgSubject))
        }
        return match
      })
    }

    return messages.map((msg: any) => this.parseOutlookMessage(msg, folderId))
  }
  
  async fetchMessage(messageId: string, folderHint?: string): Promise<RawEmailMessage | null> {
    try {
      const response = await this.graphApiRequest(
        'GET',
        `/me/messages/${messageId}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,replyTo,receivedDateTime,body,isRead,flag,isDraft,hasAttachments,internetMessageHeaders`
      )
      
      return this.parseOutlookMessage(response, folderHint || 'inbox')
    } catch (err) {
      console.error('[Outlook] Error fetching message:', messageId, err)
      return null
    }
  }
  
  async listAttachments(messageId: string): Promise<RawAttachment[]> {
    const response = await this.graphApiRequest(
      'GET',
      `/me/messages/${messageId}/attachments`
    )
    
    const attachments = response.value || []
    return attachments.map((att: any) => ({
      id: att.id,
      filename: att.name,
      mimeType: att.contentType || 'application/octet-stream',
      size: att.size || 0,
      contentId: att.contentId,
      isInline: att.isInline || false
    }))
  }
  
  async fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer | null> {
    try {
      const response = await this.graphApiRequest(
        'GET',
        `/me/messages/${messageId}/attachments/${attachmentId}`
      )
      
      if (response.contentBytes) {
        return Buffer.from(response.contentBytes, 'base64')
      }
      
      return null
    } catch (err) {
      console.error('[Outlook] Error fetching attachment:', err)
      return null
    }
  }
  
  async markAsRead(messageId: string): Promise<void> {
    await this.graphApiRequest('PATCH', `/me/messages/${messageId}`, {
      isRead: true
    })
  }
  
  async markAsUnread(messageId: string): Promise<void> {
    await this.graphApiRequest('PATCH', `/me/messages/${messageId}`, {
      isRead: false
    })
  }
  
  async setFlagged(messageId: string, flagged: boolean): Promise<void> {
    await this.graphApiRequest('PATCH', `/me/messages/${messageId}`, {
      flag: {
        flagStatus: flagged ? 'flagged' : 'notFlagged'
      }
    })
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.graphApiRequest('POST', `/me/messages/${messageId}/move`, {
      destinationId: REMOTE_DELETION_TARGETS.outlook.deletedItemsFolderId,
    })
  }

  /**
   * Microsoft Graph mapping:
   * - **archive** — move to well-known `archive` folder.
   * - **pending_review** / **pending_delete** — child folders under Inbox (created on demand).
   */
  async applyOrchestratorRemoteOperation(
    messageId: string,
    operation: OrchestratorRemoteOperation,
    _context?: import('../domain/orchestratorRemoteTypes').OrchestratorRemoteApplyContext,
  ): Promise<OrchestratorRemoteApplyResult> {
    try {
      if (!this.config) {
        return { ok: false, error: 'Not connected' }
      }
      const names = resolveOrchestratorRemoteNames(this.config)
      let destId: string
      if (operation === 'archive') {
        const arch = await this.graphApiRequest('GET', '/me/mailFolders/archive?$select=id')
        destId = arch.id
      } else if (operation === 'pending_review') {
        destId = await this.ensureOutlookOrchestratorChildFolder(names.outlook.pendingReviewFolder)
      } else if (operation === 'pending_delete') {
        destId = await this.ensureOutlookOrchestratorChildFolder(names.outlook.pendingDeleteFolder)
      } else {
        return { ok: false, error: `Unknown orchestrator operation: ${operation}` }
      }

      await this.graphApiRequest('POST', `/me/messages/${messageId}/move`, {
        destinationId: destId,
      })
      return { ok: true }
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (/same folder|already been moved|item not found|not found/i.test(msg)) {
        return { ok: true, skipped: true }
      }
      return { ok: false, error: msg }
    }
  }

  private async ensureOutlookOrchestratorChildFolder(displayName: string): Promise<string> {
    const hit = this.orchestratorFolderCache.get(displayName)
    if (hit) return hit

    const inbox = await this.graphApiRequest('GET', '/me/mailFolders/inbox?$select=id')
    const inboxId = inbox.id as string
    const kids = await this.graphApiRequest(
      'GET',
      `/me/mailFolders/${inboxId}/childFolders?$select=id,displayName&$top=200`,
    )
    const found = (kids.value || []).find((f: any) => f.displayName === displayName)
    if (found?.id) {
      this.orchestratorFolderCache.set(displayName, found.id)
      return found.id
    }
    const created = await this.graphApiRequest('POST', `/me/mailFolders/${inboxId}/childFolders`, {
      displayName,
    })
    if (!created?.id) throw new Error('Graph folder create returned no id')
    this.orchestratorFolderCache.set(displayName, created.id)
    return created.id
  }
  
  async sendEmail(payload: SendEmailPayload): Promise<SendResult> {
    try {
      const message: Record<string, unknown> = {
        subject: payload.subject,
        body: {
          contentType: 'Text',
          content: payload.bodyText
        },
        toRecipients: payload.to.map(email => ({
          emailAddress: { address: email }
        })),
        ccRecipients: payload.cc?.map(email => ({
          emailAddress: { address: email }
        })) || []
      }
      if (payload.attachments?.length) {
        message.attachments = payload.attachments.map(a => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.filename,
          contentType: a.mimeType || 'application/octet-stream',
          contentBytes: a.contentBase64
        }))
      }
      
      await this.graphApiRequest('POST', '/me/sendMail', {
        message,
        saveToSentItems: true
      })
      
      return { success: true }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Failed to send email'
      }
    }
  }
  
  // =================================================================
  // OAuth2 Flow (using centralized OAuth server manager)
  // =================================================================
  
  /**
   * Start OAuth2 authorization flow
   * Returns account config with tokens
   * 
   * Uses the centralized OAuth server manager for production-grade reliability:
   * - Port availability checking with fallback ports
   * - Proper cleanup on any state
   * - Concurrent request prevention
   * - State machine for flow management
   */
  async startOAuthFlow(): Promise<{ oauth: EmailAccountConfig['oauth']; email: string }> {
    const oauthConfig = await getCredentialsForOAuth('outlook')
    if (!oauthConfig) {
      throw new Error('Outlook OAuth client credentials not configured. Please set up an Azure AD application.')
    }
    
    // Check if another OAuth flow is in progress
    if (oauthServerManager.isFlowInProgress()) {
      throw new Error('Another OAuth flow is already in progress. Please wait or try again.')
    }
    
    console.log('[Outlook] Starting OAuth flow using centralized server manager...')
    console.log('[Outlook] Current OAuth state:', oauthServerManager.getState())
    
    try {
      // Start OAuth flow with the server manager
      // This will start the server, wait for callback, and return the result
      const flowPromise = oauthServerManager.startOAuthFlow('outlook', 5 * 60 * 1000)
      
      // Build auth URL with dynamic port from the manager
      const authUrl = this.buildAuthUrl(oauthConfig.clientId, oauthConfig.tenantId)
      console.log('[Outlook] Opening OAuth in system browser:', authUrl.substring(0, 100) + '...')
      
      // Open browser
      try {
        await shell.openExternal(authUrl)
        console.log('[Outlook] Browser opened successfully')
      } catch (err: any) {
        console.error('[Outlook] Failed to open browser:', err)
        await oauthServerManager.cancelFlow()
        throw new Error('Failed to open browser for authentication')
      }
      
      // Wait for callback
      console.log('[Outlook] Waiting for OAuth callback...')
      const result = await flowPromise
      
      if (!result.success) {
        throw new Error(result.errorDescription || result.error || 'OAuth authorization failed')
      }
      
      if (!result.code) {
        throw new Error('No authorization code received')
      }
      
      console.log('[Outlook] Auth code received, exchanging for tokens...')
      
      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(oauthConfig, result.code)
      if (!tokens) {
        throw new Error('Failed to exchange authorization code for tokens')
      }
      console.log('[Outlook] Tokens received!')
      
      // Get user email from profile
      console.log('[Outlook] Setting access token and fetching profile...')
      this.accessToken = tokens.accessToken
      this.refreshToken = tokens.refreshToken
      this.tokenExpiresAt = tokens.expiresAt
      
      try {
        const profile = await this.graphApiRequest('GET', '/me')
        const email = profile.mail || profile.userPrincipalName || ''
        console.log('[Outlook] User email:', email)
        return { oauth: tokens, email }
      } catch (profileErr: any) {
        console.error('[Outlook] Failed to get profile:', profileErr.message || profileErr)
        // Still return the tokens even if profile fetch fails
        return { oauth: tokens, email: '' }
      }
    } catch (err: any) {
      console.error('[Outlook] OAuth flow error:', err.message || err)
      // Ensure cleanup happens
      await oauthServerManager.cancelFlow().catch(() => {})
      throw err
    }
  }
  
  /**
   * Get user email from connected account
   */
  async getUserEmail(): Promise<string> {
    if (!this.accessToken) {
      throw new Error('Not connected')
    }
    const profile = await this.graphApiRequest('GET', '/me')
    return profile.mail || profile.userPrincipalName || ''
  }
  
  /**
   * Build the OAuth authorization URL
   * Uses dynamic port from the OAuth server manager
   */
  private buildAuthUrl(clientId: string, tenantId?: string): string {
    const tenant = tenantId || 'organizations'
    // Get the callback URL from the OAuth server manager (with dynamic port)
    const redirectUri = oauthServerManager.getCallbackUrl()
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OUTLOOK_SCOPES.join(' '),
      response_mode: 'query',
      prompt: 'consent'
    })
    
    console.log('[Outlook] Using tenant:', tenant)
    console.log('[Outlook] Redirect URI:', redirectUri)
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`
  }
  
  private async exchangeCodeForTokens(
    oauthConfig: { clientId: string; clientSecret?: string; tenantId?: string },
    code: string
  ): Promise<EmailAccountConfig['oauth']> {
    const tenant = oauthConfig.tenantId || 'organizations'
    // Use the same redirect URI that was used for authorization
    const redirectUri = oauthServerManager.getCallbackUrl()
    
    return new Promise((resolve, reject) => {
      const postParams: Record<string, string> = {
        code,
        client_id: oauthConfig.clientId,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: OUTLOOK_SCOPES.join(' ')
      }
      
      // Client secret is optional for public clients (desktop apps)
      if (oauthConfig.clientSecret) {
        postParams.client_secret = oauthConfig.clientSecret
      }

      const postData = new URLSearchParams(postParams).toString()
      const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`

      // TEMPORARY DEBUG - remove after debugging
      console.log('=== OUTLOOK TOKEN EXCHANGE DEBUG ===')
      console.log('Token URL:', tokenUrl)
      console.log('Client ID:', oauthConfig.clientId)
      console.log('Client Secret (first 4 chars):', oauthConfig.clientSecret ? oauthConfig.clientSecret.substring(0, 4) + '...' : '(none)')
      console.log('Tenant ID:', tenant)
      console.log('Redirect URI:', redirectUri)
      console.log('Grant type:', 'authorization_code')
      console.log('Code (first 10 chars):', code?.substring(0, 10) + '...')
      console.log('Scopes:', OUTLOOK_SCOPES.join(' '))
      console.log('=== END DEBUG ===')

      const options = {
        hostname: 'login.microsoftonline.com',
        path: `/${tenant}/oauth2/v2.0/token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }

      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          // TEMPORARY DEBUG - remove after debugging
          try {
            const responseBody = JSON.parse(data)
            console.log('=== OUTLOOK TOKEN RESPONSE ===')
            console.log('Status:', res.statusCode)
            console.log('Body:', JSON.stringify(responseBody))
            console.log('=== END RESPONSE ===')
          } catch {
            console.log('=== OUTLOOK TOKEN RESPONSE ===')
            console.log('Status:', res.statusCode)
            console.log('Body (raw):', data)
            console.log('=== END RESPONSE ===')
          }
          try {
            const json = JSON.parse(data)
            if (json.error) {
              reject(new Error(json.error_description || json.error))
            } else {
              resolve({
                accessToken: json.access_token,
                refreshToken: json.refresh_token,
                expiresAt: Date.now() + (json.expires_in * 1000),
                scope: json.scope
              })
            }
          } catch (err) {
            reject(err)
          }
        })
      })
      
      req.on('error', reject)
      req.write(postData)
      req.end()
    })
  }
  
  // =================================================================
  // Private Helpers
  // =================================================================
  
  private isTokenExpired(): boolean {
    return Date.now() > this.tokenExpiresAt - 300000 // 5 min buffer
  }
  
  private async refreshAccessToken(): Promise<void> {
    const oauthConfig = await getCredentialsForOAuth('outlook')
    if (!oauthConfig || !this.refreshToken) {
      throw new Error('Cannot refresh token: missing credentials')
    }
    
    const tenant = oauthConfig.tenantId || 'organizations'
    return new Promise((resolve, reject) => {
      const postParams: Record<string, string> = {
        client_id: oauthConfig.clientId,
        refresh_token: this.refreshToken!,
        grant_type: 'refresh_token',
        scope: OUTLOOK_SCOPES.join(' ')
      }
      
      if (oauthConfig.clientSecret) {
        postParams.client_secret = oauthConfig.clientSecret
      }
      
      const postData = new URLSearchParams(postParams).toString()
      
      const options = {
        hostname: 'login.microsoftonline.com',
        path: `/${tenant}/oauth2/v2.0/token`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      }
      
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.error) {
              reject(new Error(json.error_description || json.error))
            } else {
              this.accessToken = json.access_token
              if (json.refresh_token) {
                this.refreshToken = json.refresh_token
              }
              this.tokenExpiresAt = Date.now() + (json.expires_in * 1000)
              
              // Persist new tokens via callback
              if (this.onTokenRefresh && this.refreshToken) {
                this.onTokenRefresh({
                  accessToken: this.accessToken!,
                  refreshToken: this.refreshToken,
                  expiresAt: this.tokenExpiresAt
                })
              }
              
              resolve()
            }
          } catch (err) {
            reject(err)
          }
        })
      })
      
      req.on('error', reject)
      req.write(postData)
      req.end()
    })
  }
  
  /**
   * Single HTTPS request to Graph — returns status, headers, parsed JSON (best-effort).
   * Does not retry; use {@link graphApiRequest} / {@link graphApiRequestAbsolute} for 429/401 handling.
   */
  private graphSingleRequest(opts: {
    hostname: string
    path: string
    method: string
    body?: any
  }): Promise<{ statusCode: number; headers: IncomingHttpHeaders; json: any; rawBody: string }> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: opts.hostname,
          path: opts.path,
          method: opts.method,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            let json: any = {}
            try {
              json = data ? JSON.parse(data) : {}
            } catch {
              json = { _parseError: true, _raw: data?.slice?.(0, 500) }
            }
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              json,
              rawBody: data,
            })
          })
        },
      )
      req.on('error', reject)
      if (opts.body) req.write(JSON.stringify(opts.body))
      req.end()
    })
  }

  private getRetryAfterSeconds(headers: IncomingHttpHeaders): number {
    const h = headers['retry-after']
    const v = Array.isArray(h) ? h[0] : h
    const n = parseInt(String(v ?? '5'), 10)
    return Number.isFinite(n) && n > 0 ? Math.min(120, n) : 5
  }

  /**
   * Graph HTTP with 429 (Retry-After), 401 (refresh token), and 5xx backoff.
   * Fixes "exactly 100 messages" when throttling or token skew caused silent failures mid-pull.
   */
  private async graphRequestWithRetries(
    execOnce: () => Promise<{ statusCode: number; headers: IncomingHttpHeaders; json: any }>,
    context: string,
  ): Promise<any> {
    const maxAttempts = 6
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.isTokenExpired() && this.refreshToken) {
        try {
          await this.refreshAccessToken()
        } catch (e: any) {
          console.warn('[Outlook] Pre-request token refresh failed:', e?.message)
        }
      }

      const { statusCode, headers, json } = await execOnce()

      if (statusCode === 429) {
        const waitSec = this.getRetryAfterSeconds(headers)
        console.warn(
          `[Outlook] Graph 429 (${context}), retry in ${waitSec}s (attempt ${attempt + 1}/${maxAttempts})`,
        )
        await new Promise((r) => setTimeout(r, waitSec * 1000))
        continue
      }

      if (statusCode === 401 && this.refreshToken) {
        console.warn(`[Outlook] Graph 401 (${context}), refreshing access token`)
        try {
          await this.refreshAccessToken()
        } catch (e: any) {
          throw new Error(e?.message || 'Token refresh failed after 401')
        }
        continue
      }

      if (statusCode >= 500 && statusCode < 600 && attempt < maxAttempts - 1) {
        const backoff = Math.min(30_000, 1000 * Math.pow(2, attempt))
        console.warn(
          `[Outlook] Graph ${statusCode} (${context}), backoff ${backoff}ms (attempt ${attempt + 1})`,
        )
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }

      if (json?.error) {
        throw new Error(json.error.message || json.error.code || 'API error')
      }

      if (statusCode >= 400) {
        throw new Error(
          `Graph HTTP ${statusCode} (${context}): ${typeof json === 'object' ? JSON.stringify(json).slice(0, 500) : String(json)}`,
        )
      }

      return json
    }
    throw new Error(`[Outlook] Graph max retries exceeded (${context})`)
  }

  /** Follow `@odata.nextLink` from list responses (full URL from Graph). */
  private async graphApiRequestAbsolute(method: string, absoluteUrl: string, body?: any): Promise<any> {
    let hostname = 'graph.microsoft.com'
    let path = ''
    try {
      const u = new URL(absoluteUrl)
      hostname = u.hostname || hostname
      path = (u.pathname || '') + (u.search || '')
    } catch {
      throw new Error('Invalid Graph nextLink URL')
    }

    return this.graphRequestWithRetries(
      () =>
        this.graphSingleRequest({
          hostname,
          path,
          method,
          body,
        }),
      `absolute ${method} ${path.slice(0, 80)}`,
    )
  }

  private async graphApiRequest(method: string, endpoint: string, body?: any): Promise<any> {
    const path = `/v1.0${endpoint}`
    return this.graphRequestWithRetries(
      () =>
        this.graphSingleRequest({
          hostname: 'graph.microsoft.com',
          path,
          method,
          body,
        }),
      `${method} ${endpoint.slice(0, 80)}`,
    )
  }
  
  private parseOutlookMessage(raw: any, folder: string): RawEmailMessage {
    const from = raw.from?.emailAddress || {}
    const toRecipients = raw.toRecipients || []
    const ccRecipients = raw.ccRecipients || []
    const replyTo = raw.replyTo?.[0]?.emailAddress
    
    // Parse headers if available
    const headers: { [key: string]: string } = {}
    if (raw.internetMessageHeaders) {
      for (const h of raw.internetMessageHeaders) {
        headers[h.name.toLowerCase()] = h.value
      }
    }
    
    return {
      id: raw.id,
      threadId: raw.conversationId,
      subject: raw.subject || '',
      from: {
        email: from.address || '',
        name: from.name
      },
      to: toRecipients.map((r: any) => ({
        email: r.emailAddress?.address || '',
        name: r.emailAddress?.name
      })),
      cc: ccRecipients.map((r: any) => ({
        email: r.emailAddress?.address || '',
        name: r.emailAddress?.name
      })),
      replyTo: replyTo ? {
        email: replyTo.address || '',
        name: replyTo.name
      } : undefined,
      date: new Date(raw.receivedDateTime),
      bodyHtml: raw.body?.contentType === 'html' ? raw.body.content : undefined,
      bodyText: raw.body?.contentType === 'text' ? raw.body.content : sanitizeHtmlToText(raw.body?.content || ''),
      flags: {
        seen: raw.isRead || false,
        flagged: raw.flag?.flagStatus === 'flagged',
        answered: false,
        draft: raw.isDraft || false,
        deleted: false
      },
      labels: [],
      folder,
      headers: {
        messageId: headers['message-id'],
        inReplyTo: headers['in-reply-to'],
        references: headers['references']?.split(/\s+/).filter(Boolean)
      }
    }
  }
  
}

export const outlookProvider = new OutlookProvider()

