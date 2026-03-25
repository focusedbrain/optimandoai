/**
 * Gmail Provider
 * 
 * Email provider implementation for Gmail using the Gmail API.
 * Uses OAuth2 for authentication - never stores passwords.
 * 
 * Refactored to use centralized OAuth server manager for production-grade reliability.
 */

import { app, shell } from 'electron'
import * as https from 'https'
import * as fs from 'fs'
import * as path from 'path'
import { randomBytes, createHash } from 'node:crypto'
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
import { oauthServerManager } from '../oauth-server'
import { getCredentialsForOAuth } from '../credentials'
import {
  logOAuthDiagnostic,
  oauthClientIdFingerprint,
  getPackagedResourceGoogleOAuthClientId,
  isPackagedProductionGmailStandardConnect,
} from '../googleOAuthBuiltin'
import { resolveGmailOAuthForConnect, type ResolvedGmailOAuth } from '../gmailOAuthResolve'
import {
  clearLastGmailStandardConnectRuntimeProof,
  setLastGmailStandardConnectRuntimeProof,
  type GmailStandardConnectRuntimeProof,
} from '../gmailOAuthRuntimeProof'

function emitGmailStandardConnectFlowProof(
  oauthConfig: ResolvedGmailOAuth,
  params: {
    authorizeClientIdFingerprint: string
    tokenExchangeClientIdFingerprint: string
    redirectUri: string
    hasCodeVerifier: boolean
    googleTokenHttpStatus: number | null
    googleError: string | null
    googleErrorDescription: string | null
  },
): void {
  if (oauthConfig.credentialSourceUsed !== 'builtin_public') return
  const br = oauthConfig.builtinClientResolution
  const shipped = getPackagedResourceGoogleOAuthClientId()
  const oauthMismatch = params.authorizeClientIdFingerprint !== params.tokenExchangeClientIdFingerprint
  const envIgnored = !!br?.packagedStandardConnectIgnoredEnvVarNames?.length

  const payload: Record<string, unknown> = {
    flowType: 'standard_connect',
    credentialSource: oauthConfig.credentialSourceUsed,
    resolution: oauthConfig.resolution,
    authMode: oauthConfig.authMode,
    authorizeClientIdFingerprint: params.authorizeClientIdFingerprint,
    tokenExchangeClientIdFingerprint: params.tokenExchangeClientIdFingerprint,
    oauth_client_id_mismatch_between_authorize_and_token_exchange: oauthMismatch,
    builtinSourceKind: br?.sourceKind,
    builtinSourceLabel: br?.sourcePath ? path.basename(br.sourcePath) : br?.sourceName,
    hasClientSecret: !!(oauthConfig.clientSecret && String(oauthConfig.clientSecret).trim()),
    hasCodeVerifier: params.hasCodeVerifier,
    redirectUri: params.redirectUri,
    tokenExchangeShape:
      oauthConfig.authMode === 'pkce' ? 'pkce_public_no_client_secret' : 'legacy_with_client_secret',
    googleTokenHttpStatus: params.googleTokenHttpStatus,
    googleError: params.googleError,
    googleErrorDescription: params.googleErrorDescription,
    bundledExpectedFingerprint: shipped ? oauthClientIdFingerprint(shipped) : null,
    packagedStandardConnectEnvIgnored: envIgnored,
  }
  logOAuthDiagnostic('gmail_standard_connect_flow_proof', payload)

  const proof: GmailStandardConnectRuntimeProof = {
    flowType: 'standard_connect',
    credentialSource: oauthConfig.credentialSourceUsed,
    resolution: oauthConfig.resolution,
    authMode: oauthConfig.authMode,
    authorizeClientIdFingerprint: params.authorizeClientIdFingerprint,
    tokenExchangeClientIdFingerprint: params.tokenExchangeClientIdFingerprint,
    oauth_client_id_mismatch_between_authorize_and_token_exchange: oauthMismatch,
    builtinSourceKind: br?.sourceKind,
    builtinSourceLabel: br?.sourcePath ? path.basename(br.sourcePath) : br?.sourceName,
    hasClientSecret: !!(oauthConfig.clientSecret && String(oauthConfig.clientSecret).trim()),
    hasCodeVerifier: params.hasCodeVerifier,
    redirectUri: params.redirectUri,
    tokenExchangeShape:
      oauthConfig.authMode === 'pkce' ? 'pkce_public_no_client_secret' : 'legacy_with_client_secret',
    googleTokenHttpStatus: params.googleTokenHttpStatus,
    googleError: params.googleError,
    googleErrorDescription: params.googleErrorDescription,
    bundledExpectedFingerprint: shipped ? oauthClientIdFingerprint(shipped) : null,
    packagedStandardConnectEnvIgnored: envIgnored,
    completedAt: new Date().toISOString(),
  }
  setLastGmailStandardConnectRuntimeProof(proof)
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}
function oauthRandomString(bytes = 32): string {
  return base64url(randomBytes(bytes))
}
function sha256base64url(input: string): string {
  return createHash('sha256').update(input).digest('base64url')
}

/**
 * Gmail API scopes
 */
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send'
]

/**
 * OAuth2 config storage path
 */
function getOAuthConfigPath(): string {
  return path.join(app.getPath('userData'), 'email-oauth-config.json')
}

/**
 * Load OAuth client credentials
 */
export function loadOAuthConfig(): { clientId: string; clientSecret?: string } | null {
  try {
    const configPath = getOAuthConfigPath()
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (err) {
    console.error('[Gmail] Error loading OAuth config:', err)
  }
  return null
}

/**
 * Save OAuth client credentials (secret optional for PKCE-only developer entries).
 */
export function saveOAuthConfig(clientId: string, clientSecret?: string): void {
  try {
    const configPath = getOAuthConfigPath()
    const payload: { clientId: string; clientSecret?: string } = { clientId }
    if (clientSecret) payload.clientSecret = clientSecret
    fs.writeFileSync(configPath, JSON.stringify(payload), 'utf-8')
  } catch (err) {
    console.error('[Gmail] Error saving OAuth config:', err)
  }
}

export class GmailProvider extends BaseEmailProvider {
  readonly providerType = 'gmail' as const
  
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiresAt: number = 0
  /** User-label name → Gmail label id */
  private wrDeskLabelIdCache: Map<string, string> = new Map()
  /** PKCE code_verifier for the in-flight browser OAuth only; cleared after token exchange. */
  private pkceVerifier: string | null = null
  /** Fingerprint of client_id sent to Google authorize URL (standard Connect proof only). */
  private standardConnectAuthorizeClientIdFingerprint: string | null = null
  
  async connect(config: EmailAccountConfig): Promise<void> {
    if (!config.oauth) {
      throw new Error('Gmail requires OAuth authentication')
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
    this.wrDeskLabelIdCache.clear()
  }

  /**
   * Resolve the signed-in mailbox address after OAuth (`users/me/profile`).
   * Connects with the given tokens, fetches profile, then disconnects (avoids leaving a stale singleton session).
   */
  async fetchProfileEmailAddress(oauth: NonNullable<EmailAccountConfig['oauth']>): Promise<string> {
    const probe: EmailAccountConfig = {
      id: '__gmail_profile_probe__',
      displayName: 'Gmail',
      email: '',
      provider: 'gmail',
      authType: 'oauth2',
      oauth,
      folders: { monitored: ['INBOX'], inbox: 'INBOX' },
      sync: { maxAgeDays: 0, analyzePdfs: true, batchSize: 50 },
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await this.connect(probe)
    try {
      const profile = await this.apiRequest('GET', '/users/me/profile')
      const addr = typeof profile?.emailAddress === 'string' ? profile.emailAddress.trim() : ''
      if (!addr) {
        throw new Error('Gmail users/me/profile did not return emailAddress')
      }
      console.log('[Gmail] Profile email resolved:', addr)
      return addr
    } finally {
      await this.disconnect()
    }
  }
  
  async testConnection(config: EmailAccountConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await this.connect(config)
      
      // Try to fetch user profile
      const profile = await this.apiRequest('GET', '/users/me/profile')
      
      if (profile.emailAddress) {
        return { success: true }
      }
      
      return { success: false, error: 'Could not verify Gmail account' }
    } catch (err: any) {
      return { success: false, error: err.message || 'Connection failed' }
    } finally {
      await this.disconnect()
    }
  }
  
  async listFolders(): Promise<FolderInfo[]> {
    const response = await this.apiRequest('GET', '/users/me/labels')
    const labels = response.labels || []
    
    return labels.map((label: any) => ({
      name: label.name,
      path: label.id,
      delimiter: '/',
      flags: label.type === 'system' ? ['\\System'] : [],
      totalMessages: label.messagesTotal || 0,
      unreadMessages: label.messagesUnread || 0
    }))
  }
  
  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    const toGmailAfterDate = (isoOrRaw: string): string => {
      const d = new Date(isoOrRaw)
      if (Number.isNaN(d.getTime())) {
        return isoOrRaw.replace(/-/g, '/').slice(0, 10)
      }
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const day = String(d.getUTCDate()).padStart(2, '0')
      return `${y}/${m}/${day}`
    }

    // Build query
    const queryParts: string[] = []

    // Folder filter (Gmail uses label IDs)
    if (folder) {
      queryParts.push(`in:${folder}`)
    }

    if (options?.search) {
      queryParts.push(options.search)
    }

    if (options?.from) {
      queryParts.push(`from:${options.from}`)
    }

    if (options?.subject) {
      queryParts.push(`subject:${options.subject}`)
    }

    if (options?.unreadOnly) {
      queryParts.push('is:unread')
    }

    if (options?.flaggedOnly) {
      queryParts.push('is:starred')
    }

    if (options?.hasAttachments) {
      queryParts.push('has:attachment')
    }

    if (options?.fromDate) {
      queryParts.push(`after:${toGmailAfterDate(options.fromDate)}`)
    }

    if (options?.toDate) {
      queryParts.push(`before:${toGmailAfterDate(options.toDate)}`)
    }

    const query = queryParts.join(' ')
    const syncAll = options?.syncFetchAllPages === true
    const singleLimit = Math.min(Math.max(1, options?.limit ?? 50), 500)
    const maxTotal = syncAll
      ? options?.syncMaxMessages != null
        ? Math.max(1, options.syncMaxMessages)
        : Number.MAX_SAFE_INTEGER
      : Math.min(Math.max(1, options?.syncMaxMessages ?? singleLimit), 500)
    /** Gmail allows up to 500 ids per messages.list page — use full page size for sync so we minimize list round-trips. */
    const listPageSize = syncAll ? 500 : Math.min(singleLimit, 500)

    // ── Phase 1: paginate messages.list until no nextPageToken (never stop early because a page had zero *new* bodies). ──
    const allIds: string[] = []
    let listPageIdx = 0
    let pageToken: string | undefined

    if (syncAll) {
      for (;;) {
        const remainingSlots = maxTotal - allIds.length
        if (remainingSlots <= 0) break

        listPageIdx++
        const listParams = new URLSearchParams({
          maxResults: Math.min(listPageSize, remainingSlots).toString(),
          ...(query ? { q: query } : {}),
          ...(pageToken ? { pageToken } : {}),
        })

        const listResponse = await this.apiRequest('GET', `/users/me/messages?${listParams.toString()}`)
        const batch = (listResponse.messages || []) as Array<{ id: string }>
        pageToken = listResponse.nextPageToken

        for (const row of batch) {
          if (allIds.length >= maxTotal) break
          if (row?.id) allIds.push(row.id)
        }

        console.log(
          `[Gmail] messages.list page ${listPageIdx}: +${batch.length} id(s), cumulative ${allIds.length}${pageToken ? ', nextPageToken present' : ', no more pages'}`,
        )

        // Continue while the API says there is another page — do NOT break on batch.length===0 if nextPageToken exists.
        if (!pageToken) break
      }
    } else {
      const listParams = new URLSearchParams({
        maxResults: Math.min(listPageSize, maxTotal).toString(),
        ...(query ? { q: query } : {}),
      })
      const listResponse = await this.apiRequest('GET', `/users/me/messages?${listParams.toString()}`)
      const batch = (listResponse.messages || []) as Array<{ id: string }>
      for (const row of batch) {
        if (allIds.length >= maxTotal) break
        if (row?.id) allIds.push(row.id)
      }
    }

    // ── Phase 2: fetch full messages in concurrent batches (dedupe is in syncOrchestrator). ──
    const messages: RawEmailMessage[] = []
    const CONCURRENT_BATCH = 10
    for (let i = 0; i < allIds.length; i += CONCURRENT_BATCH) {
      if (messages.length >= maxTotal) break
      const sliceEnd = Math.min(i + CONCURRENT_BATCH, allIds.length)
      const batchIds = allIds.slice(i, sliceEnd)
      const batchResults = await Promise.allSettled(batchIds.map((id) => this.fetchMessage(id)))
      for (const r of batchResults) {
        if (messages.length >= maxTotal) break
        if (r.status === 'fulfilled' && r.value) {
          messages.push(r.value)
        }
      }
      if (syncAll) {
        console.log(
          `[Gmail] fetch full ${sliceEnd}/${allIds.length} listed (${messages.length} loaded, batch ${CONCURRENT_BATCH} concurrent)`,
        )
      }
    }

    return messages
  }
  
  async fetchMessage(messageId: string): Promise<RawEmailMessage | null> {
    try {
      const response = await this.apiRequest(
        'GET',
        `/users/me/messages/${messageId}?format=full`
      )
      
      return this.parseGmailMessage(response)
    } catch (err) {
      console.error('[Gmail] Error fetching message:', messageId, err)
      return null
    }
  }
  
  async listAttachments(messageId: string): Promise<RawAttachment[]> {
    const msg = await this.apiRequest(
      'GET',
      `/users/me/messages/${messageId}?format=full`
    )
    
    return this.extractAttachments(msg.payload)
  }
  
  async fetchAttachment(messageId: string, attachmentId: string): Promise<Buffer | null> {
    try {
      const response = await this.apiRequest(
        'GET',
        `/users/me/messages/${messageId}/attachments/${attachmentId}`
      )
      
      if (response.data) {
        // Decode base64url
        const base64 = response.data.replace(/-/g, '+').replace(/_/g, '/')
        return Buffer.from(base64, 'base64')
      }
      
      return null
    } catch (err) {
      console.error('[Gmail] Error fetching attachment:', err)
      return null
    }
  }
  
  async markAsRead(messageId: string): Promise<void> {
    await this.apiRequest('POST', `/users/me/messages/${messageId}/modify`, {
      removeLabelIds: ['UNREAD']
    })
  }
  
  async markAsUnread(messageId: string): Promise<void> {
    await this.apiRequest('POST', `/users/me/messages/${messageId}/modify`, {
      addLabelIds: ['UNREAD']
    })
  }
  
  async setFlagged(messageId: string, flagged: boolean): Promise<void> {
    if (flagged) {
      await this.apiRequest('POST', `/users/me/messages/${messageId}/modify`, {
        addLabelIds: ['STARRED']
      })
    } else {
      await this.apiRequest('POST', `/users/me/messages/${messageId}/modify`, {
        removeLabelIds: ['STARRED']
      })
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.apiRequest(
      'POST',
      `/users/me/messages/${messageId}${REMOTE_DELETION_TARGETS.gmail.trashApiSuffix}`,
    )
  }

  /**
   * Gmail mapping (names from `resolveOrchestratorRemoteNames`; defaults match IMAP bucket labels):
   * - **archive** — remove `INBOX` (All Mail / archive semantics).
   * - **pending_review** — user label (default `Pending Review`), remove INBOX + conflicting lifecycle labels.
   * - **pending_delete** — user label (default `Pending Delete`), strip INBOX + other lifecycle labels.
   * - **urgent** — user label (default `Urgent`), strip INBOX + other lifecycle labels.
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
      const reviewId = await this.ensureWrDeskUserLabel(names.gmail.pendingReviewLabel)
      const deleteId = await this.ensureWrDeskUserLabel(names.gmail.pendingDeleteLabel)
      const urgentId = await this.ensureWrDeskUserLabel(names.gmail.urgentLabel)

      if (operation === 'archive') {
        await this.gmailModifyOrIdempotent(messageId, {
          removeLabelIds: names.gmail.archiveRemoveLabelIds,
        })
        return { ok: true }
      }

      if (operation === 'pending_review') {
        await this.gmailModifyOrIdempotent(messageId, {
          addLabelIds: [reviewId],
          removeLabelIds: [...names.gmail.archiveRemoveLabelIds, deleteId, urgentId],
        })
        return { ok: true }
      }

      if (operation === 'pending_delete') {
        await this.gmailModifyOrIdempotent(messageId, {
          addLabelIds: [deleteId],
          removeLabelIds: [...names.gmail.archiveRemoveLabelIds, reviewId, urgentId],
        })
        return { ok: true }
      }

      if (operation === 'urgent') {
        await this.gmailModifyOrIdempotent(messageId, {
          addLabelIds: [urgentId],
          removeLabelIds: [...names.gmail.archiveRemoveLabelIds, reviewId, deleteId],
        })
        return { ok: true }
      }

      return { ok: false, error: `Unknown orchestrator operation: ${operation}` }
    } catch (e: any) {
      const msg = e?.message || String(e)
      if (this.isGmailIdempotentModifyError(msg)) {
        return { ok: true, skipped: true }
      }
      return { ok: false, error: msg }
    }
  }

  private isGmailIdempotentModifyError(message: string): boolean {
    const m = message.toLowerCase()
    return (
      m.includes('invalid label') ||
      m.includes('label not found') ||
      m.includes('cannot remove label') ||
      m.includes('already exists')
    )
  }

  private async gmailModifyOrIdempotent(
    messageId: string,
    body: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Promise<void> {
    try {
      await this.apiRequest('POST', `/users/me/messages/${messageId}/modify`, body)
    } catch (e: any) {
      if (this.isGmailIdempotentModifyError(e?.message || '')) return
      throw e
    }
  }

  /**
   * Batch label changes (up to **1000** message ids per Gmail API call).
   * Use for future drain optimization; current queue still applies per-message `modify`.
   * @see https://developers.google.com/gmail/api/reference/rest/v1/users.messages/batchModify
   */
  async batchModifyMessages(
    messageIds: string[],
    body: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ): Promise<void> {
    const add = body.addLabelIds?.filter(Boolean) ?? []
    const rem = body.removeLabelIds?.filter(Boolean) ?? []
    if (add.length === 0 && rem.length === 0) {
      throw new Error('batchModifyMessages: addLabelIds or removeLabelIds required')
    }
    const ids = [...new Set(messageIds.filter((id) => typeof id === 'string' && id.trim()))]
    if (ids.length === 0) return
    const chunkSize = 1000
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      await this.apiRequest('POST', '/users/me/messages/batchModify', {
        ids: chunk,
        ...(add.length ? { addLabelIds: add } : {}),
        ...(rem.length ? { removeLabelIds: rem } : {}),
      })
    }
  }

  private async ensureWrDeskUserLabel(displayName: string): Promise<string> {
    const cached = this.wrDeskLabelIdCache.get(displayName)
    if (cached) return cached

    const listed = await this.apiRequest('GET', '/users/me/labels')
    const labels = listed.labels || []
    const found = labels.find((l: any) => l.name === displayName && l.type === 'user')
    if (found?.id) {
      this.wrDeskLabelIdCache.set(displayName, found.id)
      return found.id
    }

    const created = await this.apiRequest('POST', '/users/me/labels', {
      name: displayName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    })
    if (!created?.id) throw new Error('Gmail label create returned no id')
    this.wrDeskLabelIdCache.set(displayName, created.id)
    return created.id
  }
  
  async sendEmail(payload: SendEmailPayload): Promise<SendResult> {
    try {
      // Build RFC 2822 message
      const message = this.buildRfc2822Message(payload)
      
      // Base64url encode
      const encoded = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
      
      const response = await this.apiRequest('POST', '/users/me/messages/send', {
        raw: encoded
      })
      
      return {
        success: true,
        messageId: response.id
      }
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
  /**
   * @param resolved Optional pre-resolved client (avoids double resolve when gateway merges oauth metadata).
   */
  async startOAuthFlow(
    email?: string,
    resolved?: ResolvedGmailOAuth,
  ): Promise<NonNullable<EmailAccountConfig['oauth']>> {
    const oauthConfig = resolved ?? (await resolveGmailOAuthForConnect())
    this.standardConnectAuthorizeClientIdFingerprint = null
    if (oauthConfig.credentialSourceUsed === 'builtin_public') {
      clearLastGmailStandardConnectRuntimeProof()
    }
    this.pkceVerifier = null
    let codeChallenge: string | undefined
    if (oauthConfig.authMode === 'pkce') {
      this.pkceVerifier = oauthRandomString(32)
      codeChallenge = sha256base64url(this.pkceVerifier)
    }

    logOAuthDiagnostic('oauth_start', {
      provider: 'gmail',
      authMode: oauthConfig.authMode,
      hasVerifier: !!this.pkceVerifier,
    })

    // Check if another OAuth flow is in progress
    if (oauthServerManager.isFlowInProgress()) {
      throw new Error('Another OAuth flow is already in progress. Please wait or try again.')
    }

    console.log('[Gmail] Starting OAuth flow using centralized server manager...')
    console.log('[Gmail] Current OAuth state:', oauthServerManager.getState())

    try {
      const flowPromise = oauthServerManager.startOAuthFlow('gmail', 5 * 60 * 1000)

      const authUrl = this.buildAuthUrl(oauthConfig.clientId, email, oauthConfig.authMode, codeChallenge)
      if (oauthConfig.credentialSourceUsed === 'builtin_public') {
        this.standardConnectAuthorizeClientIdFingerprint = oauthClientIdFingerprint(oauthConfig.clientId)
      }
      console.log('[Gmail] Opening OAuth in system browser:', authUrl.substring(0, 100) + '...')

      try {
        await shell.openExternal(authUrl)
        console.log('[Gmail] Browser opened successfully')
      } catch (err: any) {
        console.error('[Gmail] Failed to open browser:', err)
        await oauthServerManager.cancelFlow()
        throw new Error('Failed to open browser for authentication')
      }

      console.log('[Gmail] Waiting for OAuth callback...')
      const result = await flowPromise

      logOAuthDiagnostic('oauth_callback_received', {
        provider: 'gmail',
        success: result.success,
        error: result.error,
      })

      if (!result.success) {
        logOAuthDiagnostic('token_exchange_failure', { provider: 'gmail', stage: 'callback', reason: result.error })
        throw new Error(result.errorDescription || result.error || 'OAuth authorization failed')
      }

      if (!result.code) {
        throw new Error('No authorization code received')
      }

      console.log('[Gmail] Auth code received, exchanging for tokens...')
      const tokens = await this.exchangeCodeForTokens(oauthConfig, result.code, this.pkceVerifier)
      this.pkceVerifier = null
      logOAuthDiagnostic('token_exchange_success', { provider: 'gmail'})
      console.log('[Gmail] Tokens received!')
      return tokens
    } catch (err: any) {
      console.error('[Gmail] OAuth flow error:', err.message || err)
      logOAuthDiagnostic('token_exchange_failure', { provider: 'gmail', stage: 'flow', error: err?.message })
      this.pkceVerifier = null
      this.standardConnectAuthorizeClientIdFingerprint = null
      await oauthServerManager.cancelFlow().catch(() => {})
      throw err
    } finally {
      this.standardConnectAuthorizeClientIdFingerprint = null
    }
  }
  
  /**
   * Build the OAuth authorization URL
   * Uses dynamic port from the OAuth server manager
   */
  private buildAuthUrl(
    clientId: string,
    email: string | undefined,
    authMode: ResolvedGmailOAuth['authMode'],
    codeChallenge: string | undefined,
  ): string {
    const redirectUri = oauthServerManager.getCallbackUrl()

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      ...(email ? { login_hint: email } : {}),
    })
    if (authMode === 'pkce' && codeChallenge) {
      params.set('code_challenge', codeChallenge)
      params.set('code_challenge_method', 'S256')
    }

    console.log('[Gmail] Redirect URI:', redirectUri)
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  }

  private async exchangeCodeForTokens(
    oauthConfig: ResolvedGmailOAuth,
    code: string,
    codeVerifier: string | null,
  ): Promise<NonNullable<EmailAccountConfig['oauth']>> {
    const redirectUri = oauthServerManager.getCallbackUrl()
    const authorizeFp =
      this.standardConnectAuthorizeClientIdFingerprint ?? oauthClientIdFingerprint(oauthConfig.clientId)
    const tokenExchangeFp = oauthClientIdFingerprint(oauthConfig.clientId)

    if (oauthConfig.credentialSourceUsed === 'builtin_public') {
      if (authorizeFp !== tokenExchangeFp) {
        emitGmailStandardConnectFlowProof(oauthConfig, {
          authorizeClientIdFingerprint: authorizeFp,
          tokenExchangeClientIdFingerprint: tokenExchangeFp,
          redirectUri,
          hasCodeVerifier: !!codeVerifier,
          googleTokenHttpStatus: null,
          googleError: 'oauth_client_id_mismatch_authorize_vs_token',
          googleErrorDescription: 'authorizeClientIdFingerprint !== tokenExchangeClientIdFingerprint',
        })
        throw new Error(
          'Runtime Gmail OAuth mismatch: authorize and token exchange used different client_id fingerprints',
        )
      }
      if (isPackagedProductionGmailStandardConnect()) {
        const shipped = getPackagedResourceGoogleOAuthClientId()
        if (shipped && oauthClientIdFingerprint(shipped) !== tokenExchangeFp) {
          emitGmailStandardConnectFlowProof(oauthConfig, {
            authorizeClientIdFingerprint: authorizeFp,
            tokenExchangeClientIdFingerprint: tokenExchangeFp,
            redirectUri,
            hasCodeVerifier: !!codeVerifier,
            googleTokenHttpStatus: null,
            googleError: 'local_bundled_client_mismatch',
            googleErrorDescription: 'token exchange client_id fingerprint !== bundled resource file',
          })
          throw new Error(
            'Runtime Gmail OAuth mismatch: token exchange is not using the bundled Desktop client ID',
          )
        }
      }
    }

    const br = oauthConfig.builtinClientResolution
    logOAuthDiagnostic('gmail_token_exchange_request', {
      authMode: oauthConfig.authMode,
      resolution: oauthConfig.resolution,
      credentialSourceUsed: oauthConfig.credentialSourceUsed,
      clientId: oauthConfig.clientId,
      clientIdFingerprintAtExchange: tokenExchangeFp,
      authorizeClientIdFingerprint: authorizeFp,
      redirect_uri: redirectUri,
      tokenExchangeShape:
        oauthConfig.authMode === 'pkce' ? 'pkce_public_no_client_secret' : 'legacy_with_client_secret',
      hasCodeVerifier: !!codeVerifier,
      hasClientSecret: !!(oauthConfig.clientSecret && String(oauthConfig.clientSecret).trim()),
      ...(br
        ? {
            builtinSourceKind: br.sourceKind,
            builtinSourceName: br.sourceName,
            builtinSourcePathBasename: br.sourcePath ? path.basename(br.sourcePath) : null,
            builtinFromBuildTimeInline: br.fromBuildTimeInline,
            builtinFromPackagedResourceFile: br.fromPackagedResourceFile,
          }
        : {}),
    })

    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({
        code,
        client_id: oauthConfig.clientId,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })
      if (oauthConfig.authMode === 'pkce') {
        if (!codeVerifier) {
          if (oauthConfig.credentialSourceUsed === 'builtin_public') {
            emitGmailStandardConnectFlowProof(oauthConfig, {
              authorizeClientIdFingerprint: authorizeFp,
              tokenExchangeClientIdFingerprint: tokenExchangeFp,
              redirectUri,
              hasCodeVerifier: false,
              googleTokenHttpStatus: null,
              googleError: 'local_pkce_missing_verifier',
              googleErrorDescription: 'PKCE code_verifier missing at token exchange',
            })
          }
          reject(new Error('PKCE: missing code_verifier'))
          return
        }
        body.set('code_verifier', codeVerifier)
      } else if (oauthConfig.clientSecret) {
        body.set('client_secret', oauthConfig.clientSecret)
      } else {
        reject(new Error('Gmail OAuth: client secret required for legacy flow'))
        return
      }

      const postData = body.toString()

      const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      }

      const req = https.request(options, (res) => {
        let data = ''
        const httpStatus = res.statusCode ?? 0
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.error) {
              logOAuthDiagnostic('gmail_token_exchange_response', {
                httpStatus,
                ok: false,
                error: json.error,
                error_description: json.error_description,
                responseCharCount: data.length,
              })
              logOAuthDiagnostic('token_exchange_failure', {
                provider: 'gmail',
                stage: 'authorization_code',
                error: json.error,
                httpStatus,
              })
              if (oauthConfig.credentialSourceUsed === 'builtin_public') {
                emitGmailStandardConnectFlowProof(oauthConfig, {
                  authorizeClientIdFingerprint: authorizeFp,
                  tokenExchangeClientIdFingerprint: tokenExchangeFp,
                  redirectUri,
                  hasCodeVerifier: !!codeVerifier,
                  googleTokenHttpStatus: httpStatus,
                  googleError: typeof json.error === 'string' ? json.error : String(json.error),
                  googleErrorDescription:
                    typeof json.error_description === 'string' ? json.error_description : null,
                })
              }
              reject(new Error(json.error_description || json.error))
            } else {
              logOAuthDiagnostic('gmail_token_exchange_response', {
                httpStatus,
                ok: true,
                responseCharCount: data.length,
                expiresIn: typeof json.expires_in === 'number' ? json.expires_in : undefined,
              })
              if (oauthConfig.credentialSourceUsed === 'builtin_public') {
                emitGmailStandardConnectFlowProof(oauthConfig, {
                  authorizeClientIdFingerprint: authorizeFp,
                  tokenExchangeClientIdFingerprint: tokenExchangeFp,
                  redirectUri,
                  hasCodeVerifier: !!codeVerifier,
                  googleTokenHttpStatus: httpStatus,
                  googleError: null,
                  googleErrorDescription: null,
                })
              }
              const expiresInSec =
                typeof json.expires_in === 'number' && Number.isFinite(json.expires_in) ? json.expires_in : 3600
              resolve({
                accessToken: json.access_token,
                refreshToken: json.refresh_token,
                expiresAt: Date.now() + expiresInSec * 1000,
                scope: typeof json.scope === 'string' ? json.scope : '',
                oauthClientId: oauthConfig.clientId,
                gmailRefreshUsesSecret: oauthConfig.authMode === 'legacy_secret',
              })
            }
          } catch (err) {
            logOAuthDiagnostic('gmail_token_exchange_response', {
              httpStatus,
              ok: false,
              parseError: true,
              responseCharCount: data.length,
            })
            if (oauthConfig.credentialSourceUsed === 'builtin_public') {
              emitGmailStandardConnectFlowProof(oauthConfig, {
                authorizeClientIdFingerprint: authorizeFp,
                tokenExchangeClientIdFingerprint: tokenExchangeFp,
                redirectUri,
                hasCodeVerifier: !!codeVerifier,
                googleTokenHttpStatus: httpStatus,
                googleError: 'parse_error',
                googleErrorDescription: err instanceof Error ? err.message : 'token response parse failed',
              })
            }
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
    const stored = this.config?.oauth
    const userCreds = await getCredentialsForOAuth('gmail')
    if (!this.refreshToken) {
      throw new Error('Cannot refresh token: missing credentials')
    }

    const clientId =
      stored?.oauthClientId && stored.oauthClientId.trim()
        ? stored.oauthClientId.trim()
        : userCreds && 'clientId' in userCreds
          ? userCreds.clientId
          : null
    if (!clientId) {
      throw new Error('Cannot refresh token: missing OAuth client id')
    }

    const useSecret = stored?.gmailRefreshUsesSecret === true
    const secret =
      useSecret && userCreds && 'clientSecret' in userCreds && userCreds.clientSecret
        ? userCreds.clientSecret
        : undefined

    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({
        client_id: clientId,
        refresh_token: this.refreshToken!,
        grant_type: 'refresh_token',
      })
      if (useSecret && secret) {
        body.set('client_secret', secret)
      }

      const postData = body.toString()
      
      const options = {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
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
              logOAuthDiagnostic('token_refresh_failure', {
                provider: 'gmail',
                error: json.error,
              })
              reject(new Error(json.error_description || json.error))
            } else {
              logOAuthDiagnostic('token_refresh_success', { provider: 'gmail' })
              this.accessToken = json.access_token
              if (json.refresh_token) {
                this.refreshToken = json.refresh_token
              }
              this.tokenExpiresAt = Date.now() + (json.expires_in * 1000)

              if (this.onTokenRefresh && this.refreshToken) {
                this.onTokenRefresh({
                  accessToken: this.accessToken!,
                  refreshToken: this.refreshToken,
                  expiresAt: this.tokenExpiresAt,
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
  
  private async apiRequest(method: string, endpoint: string, body?: any): Promise<any> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken()
    }
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'gmail.googleapis.com',
        path: `/gmail/v1${endpoint}`,
        method,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        }
      }
      
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {}
            if (json.error) {
              reject(new Error(json.error.message || 'API error'))
            } else {
              resolve(json)
            }
          } catch (err) {
            reject(err)
          }
        })
      })
      
      req.on('error', reject)
      
      if (body) {
        req.write(JSON.stringify(body))
      }
      
      req.end()
    })
  }
  
  private parseGmailMessage(raw: any): RawEmailMessage {
    const headers = raw.payload?.headers || []
    const getHeader = (name: string): string => {
      const h = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
      return h?.value || ''
    }
    
    const labelIds = raw.labelIds || []
    const extractedAttMeta = this.extractAttachments(raw.payload)
    const attN = extractedAttMeta.length

    return {
      id: raw.id,
      threadId: raw.threadId,
      subject: getHeader('Subject'),
      from: this.parseEmailAddress(getHeader('From')),
      to: this.parseEmailAddresses(getHeader('To')),
      cc: this.parseEmailAddresses(getHeader('Cc')),
      replyTo: getHeader('Reply-To') ? this.parseEmailAddress(getHeader('Reply-To')) : undefined,
      date: new Date(getHeader('Date')),
      bodyHtml: this.extractBody(raw.payload, 'text/html'),
      bodyText: this.extractBody(raw.payload, 'text/plain'),
      flags: {
        seen: !labelIds.includes('UNREAD'),
        flagged: labelIds.includes('STARRED'),
        answered: false, // Gmail doesn't have a direct equivalent
        draft: labelIds.includes('DRAFT'),
        deleted: labelIds.includes('TRASH')
      },
      labels: labelIds,
      folder: labelIds.includes('INBOX') ? 'INBOX' : labelIds[0] || 'INBOX',
      headers: {
        messageId: getHeader('Message-ID'),
        inReplyTo: getHeader('In-Reply-To'),
        references: getHeader('References')?.split(/\s+/).filter(Boolean)
      },
      hasAttachments: attN > 0,
      attachmentCount: attN,
    }
  }
  
  private extractBody(payload: any, mimeType: string): string {
    if (!payload) return ''
    
    // Direct body
    if (payload.mimeType === mimeType && payload.body?.data) {
      return this.decodeBase64Url(payload.body.data)
    }
    
    // Search in parts
    if (payload.parts) {
      for (const part of payload.parts) {
        const result = this.extractBody(part, mimeType)
        if (result) return result
      }
    }
    
    return ''
  }
  
  private extractAttachments(payload: any, attachments: RawAttachment[] = []): RawAttachment[] {
    if (!payload) return attachments
    
    if (payload.filename && payload.body?.attachmentId) {
      attachments.push({
        id: payload.body.attachmentId,
        filename: payload.filename,
        mimeType: payload.mimeType || 'application/octet-stream',
        size: payload.body.size || 0,
        contentId: payload.headers?.find((h: any) => h.name === 'Content-ID')?.value,
        isInline: !!payload.headers?.find((h: any) => 
          h.name === 'Content-Disposition' && h.value.includes('inline')
        )
      })
    }
    
    if (payload.parts) {
      for (const part of payload.parts) {
        this.extractAttachments(part, attachments)
      }
    }
    
    return attachments
  }
  
  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(base64, 'base64').toString('utf-8')
  }
  
  private buildRfc2822Message(payload: SendEmailPayload): string {
    const lines: string[] = []
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`
    
    lines.push(`To: ${payload.to.join(', ')}`)
    if (payload.cc?.length) {
      lines.push(`Cc: ${payload.cc.join(', ')}`)
    }
    lines.push(`Subject: ${payload.subject}`)
    lines.push('MIME-Version: 1.0')
    
    if (payload.inReplyTo) {
      lines.push(`In-Reply-To: ${payload.inReplyTo}`)
    }
    if (payload.references?.length) {
      lines.push(`References: ${payload.references.join(' ')}`)
    }
    
    const hasAttachments = payload.attachments?.length && payload.attachments.length > 0
    
    if (hasAttachments) {
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
      lines.push('')
      lines.push(`--${boundary}`)
      lines.push('Content-Type: text/plain; charset=utf-8')
      lines.push('Content-Transfer-Encoding: 7bit')
      lines.push('')
      lines.push(payload.bodyText)
      
      for (const att of payload.attachments!) {
        lines.push(`--${boundary}`)
        const mime = att.mimeType || 'application/octet-stream'
        const safeName = att.filename.replace(/[^\x20-\x7E]/g, '?')
        lines.push(`Content-Type: ${mime}; name="${safeName}"`)
        lines.push('Content-Transfer-Encoding: base64')
        lines.push(`Content-Disposition: attachment; filename="${safeName}"`)
        lines.push('')
        // Split base64 into 76-char lines per RFC 2045
        const b64 = att.contentBase64.replace(/\s/g, '')
        for (let i = 0; i < b64.length; i += 76) {
          lines.push(b64.slice(i, i + 76))
        }
      }
      lines.push(`--${boundary}--`)
    } else {
      lines.push('Content-Type: text/plain; charset=utf-8')
      lines.push('')
      lines.push(payload.bodyText)
    }
    
    return lines.join('\r\n')
  }
}

export const gmailProvider = new GmailProvider()


