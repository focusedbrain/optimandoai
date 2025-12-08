/**
 * Microsoft Outlook/365 Provider
 * 
 * Email provider implementation for Microsoft 365 and Outlook.com using Microsoft Graph API.
 * Uses OAuth2 for authentication - never stores passwords.
 */

import { BrowserWindow, app } from 'electron'
import * as https from 'https'
import * as http from 'http'
import * as url from 'url'
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

/**
 * Microsoft Graph API scopes
 */
const OUTLOOK_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
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
function loadOutlookOAuthConfig(): { clientId: string; clientSecret?: string } | null {
  try {
    const configPath = getOutlookOAuthConfigPath()
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch (err) {
    console.error('[Outlook] Error loading OAuth config:', err)
  }
  return null
}

/**
 * Save OAuth client credentials for Outlook
 */
export function saveOutlookOAuthConfig(clientId: string, clientSecret?: string): void {
  try {
    const configPath = getOutlookOAuthConfigPath()
    fs.writeFileSync(configPath, JSON.stringify({ clientId, clientSecret }), 'utf-8')
  } catch (err) {
    console.error('[Outlook] Error saving OAuth config:', err)
  }
}

export class OutlookProvider extends BaseEmailProvider {
  readonly providerType = 'microsoft365' as const
  
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiresAt: number = 0
  private authWindow: BrowserWindow | null = null
  private localServer: http.Server | null = null
  
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
  
  async fetchMessages(folder: string, options?: MessageSearchOptions): Promise<RawEmailMessage[]> {
    // Build query parameters
    const params = new URLSearchParams()
    params.append('$top', String(options?.limit || 50))
    params.append('$orderby', 'receivedDateTime desc')
    params.append('$select', 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,body,isRead,flag,isDraft,hasAttachments')
    
    // Build filter
    const filters: string[] = []
    
    if (options?.unreadOnly) {
      filters.push('isRead eq false')
    }
    
    if (options?.flaggedOnly) {
      filters.push("flag/flagStatus eq 'flagged'")
    }
    
    if (options?.hasAttachments) {
      filters.push('hasAttachments eq true')
    }
    
    if (options?.fromDate) {
      filters.push(`receivedDateTime ge ${options.fromDate}`)
    }
    
    if (options?.toDate) {
      filters.push(`receivedDateTime le ${options.toDate}`)
    }
    
    if (filters.length > 0) {
      params.append('$filter', filters.join(' and '))
    }
    
    // Handle search
    if (options?.search || options?.from || options?.subject) {
      const searchTerms: string[] = []
      if (options.search) searchTerms.push(options.search)
      if (options.from) searchTerms.push(`from:${options.from}`)
      if (options.subject) searchTerms.push(`subject:${options.subject}`)
      params.append('$search', `"${searchTerms.join(' ')}"`)
    }
    
    const folderId = folder || 'inbox'
    const response = await this.graphApiRequest(
      'GET', 
      `/me/mailFolders/${folderId}/messages?${params.toString()}`
    )
    
    const messages = response.value || []
    return messages.map((msg: any) => this.parseOutlookMessage(msg, folder))
  }
  
  async fetchMessage(messageId: string): Promise<RawEmailMessage | null> {
    try {
      const response = await this.graphApiRequest(
        'GET',
        `/me/messages/${messageId}?$select=id,conversationId,subject,from,toRecipients,ccRecipients,replyTo,receivedDateTime,body,isRead,flag,isDraft,hasAttachments,internetMessageHeaders`
      )
      
      return this.parseOutlookMessage(response, 'inbox')
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
  
  async sendEmail(payload: SendEmailPayload): Promise<SendResult> {
    try {
      const message = {
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
  // OAuth2 Flow
  // =================================================================
  
  /**
   * Start OAuth2 authorization flow
   * Returns account config with tokens
   */
  async startOAuthFlow(): Promise<{ oauth: EmailAccountConfig['oauth']; email: string }> {
    const oauthConfig = loadOutlookOAuthConfig()
    if (!oauthConfig) {
      throw new Error('Outlook OAuth client credentials not configured. Please set up an Azure AD application.')
    }
    
    return new Promise((resolve, reject) => {
      // Start local server for callback
      this.startLocalServer()
        .then(codePromise => {
          // Open auth window
          const authUrl = this.buildAuthUrl(oauthConfig.clientId)
          
          this.authWindow = new BrowserWindow({
            width: 600,
            height: 700,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true
            },
            title: 'Sign in with Microsoft'
          })
          
          this.authWindow.loadURL(authUrl)
          
          this.authWindow.on('closed', () => {
            this.authWindow = null
            if (this.localServer) {
              this.localServer.close()
              this.localServer = null
            }
          })
          
          return codePromise
        })
        .then(code => this.exchangeCodeForTokens(oauthConfig, code))
        .then(async (tokens) => {
          if (this.authWindow) {
            this.authWindow.close()
          }
          
          if (!tokens) {
            throw new Error('Failed to exchange authorization code for tokens')
          }
          
          // Get user email from profile
          this.accessToken = tokens.accessToken
          const profile = await this.graphApiRequest('GET', '/me')
          const email = profile.mail || profile.userPrincipalName || ''
          
          resolve({ oauth: tokens, email })
        })
        .catch(err => {
          if (this.authWindow) {
            this.authWindow.close()
          }
          reject(err)
        })
    })
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
  
  private buildAuthUrl(clientId: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:58925/oauth/callback',
      response_type: 'code',
      scope: OUTLOOK_SCOPES.join(' '),
      response_mode: 'query',
      prompt: 'consent'
    })
    
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
  }
  
  private startLocalServer(): Promise<Promise<string>> {
    return new Promise((resolve, reject) => {
      let codeResolver: (code: string) => void
      let codeRejecter: (err: Error) => void
      
      const codePromise = new Promise<string>((res, rej) => {
        codeResolver = res
        codeRejecter = rej
      })
      
      this.localServer = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url || '', true)
        
        if (parsedUrl.pathname === '/oauth/callback') {
          const code = parsedUrl.query.code as string
          const error = parsedUrl.query.error as string
          const errorDescription = parsedUrl.query.error_description as string
          
          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`<html><body><h1>Authorization Failed</h1><p>${errorDescription || error}</p><p>You can close this window.</p></body></html>`)
            codeRejecter(new Error(errorDescription || error))
          } else if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h1>Success!</h1><p>You can close this window and return to WR Code.</p></body></html>')
            codeResolver(code)
          }
        }
      })
      
      // Use a different port than Gmail to avoid conflicts
      this.localServer.listen(58925, '127.0.0.1', () => {
        console.log('[Outlook] OAuth callback server listening on port 58925')
        resolve(codePromise)
      })
      
      this.localServer.on('error', reject)
    })
  }
  
  private async exchangeCodeForTokens(
    oauthConfig: { clientId: string; clientSecret?: string },
    code: string
  ): Promise<EmailAccountConfig['oauth']> {
    return new Promise((resolve, reject) => {
      const postParams: Record<string, string> = {
        code,
        client_id: oauthConfig.clientId,
        redirect_uri: 'http://localhost:58925/oauth/callback',
        grant_type: 'authorization_code',
        scope: OUTLOOK_SCOPES.join(' ')
      }
      
      // Client secret is optional for public clients (desktop apps)
      if (oauthConfig.clientSecret) {
        postParams.client_secret = oauthConfig.clientSecret
      }
      
      const postData = new URLSearchParams(postParams).toString()
      
      const options = {
        hostname: 'login.microsoftonline.com',
        path: '/common/oauth2/v2.0/token',
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
    const oauthConfig = loadOutlookOAuthConfig()
    if (!oauthConfig || !this.refreshToken) {
      throw new Error('Cannot refresh token: missing credentials')
    }
    
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
        path: '/common/oauth2/v2.0/token',
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
  
  private async graphApiRequest(method: string, endpoint: string, body?: any): Promise<any> {
    if (this.isTokenExpired() && this.refreshToken) {
      await this.refreshAccessToken()
    }
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'graph.microsoft.com',
        path: `/v1.0${endpoint}`,
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
      bodyText: raw.body?.contentType === 'text' ? raw.body.content : this.stripHtml(raw.body?.content || ''),
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
  
  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

export const outlookProvider = new OutlookProvider()

