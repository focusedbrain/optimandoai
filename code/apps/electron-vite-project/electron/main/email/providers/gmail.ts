/**
 * Gmail Provider
 * 
 * Email provider implementation for Gmail using the Gmail API.
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
function loadOAuthConfig(): { clientId: string; clientSecret: string } | null {
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
 * Save OAuth client credentials
 */
export function saveOAuthConfig(clientId: string, clientSecret: string): void {
  try {
    const configPath = getOAuthConfigPath()
    fs.writeFileSync(configPath, JSON.stringify({ clientId, clientSecret }), 'utf-8')
  } catch (err) {
    console.error('[Gmail] Error saving OAuth config:', err)
  }
}

export class GmailProvider extends BaseEmailProvider {
  readonly providerType = 'gmail' as const
  
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private tokenExpiresAt: number = 0
  private authWindow: BrowserWindow | null = null
  private localServer: http.Server | null = null
  
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
      queryParts.push(`after:${options.fromDate}`)
    }
    
    if (options?.toDate) {
      queryParts.push(`before:${options.toDate}`)
    }
    
    const query = queryParts.join(' ')
    const limit = options?.limit || 50
    
    // List messages
    const listParams = new URLSearchParams({
      maxResults: limit.toString(),
      ...(query ? { q: query } : {})
    })
    
    const listResponse = await this.apiRequest(
      'GET', 
      `/users/me/messages?${listParams.toString()}`
    )
    
    const messageIds = (listResponse.messages || []).map((m: any) => m.id)
    
    // Fetch each message
    const messages: RawEmailMessage[] = []
    
    for (const id of messageIds) {
      const msg = await this.fetchMessage(id)
      if (msg) {
        messages.push(msg)
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
  // OAuth2 Flow
  // =================================================================
  
  /**
   * Start OAuth2 authorization flow
   * Returns account config with tokens
   */
  async startOAuthFlow(email?: string): Promise<EmailAccountConfig['oauth']> {
    const oauthConfig = loadOAuthConfig()
    if (!oauthConfig) {
      throw new Error('OAuth client credentials not configured')
    }
    
    return new Promise((resolve, reject) => {
      // Start local server for callback
      this.startLocalServer()
        .then(codePromise => {
          // Open auth window
          const authUrl = this.buildAuthUrl(oauthConfig.clientId, email)
          
          this.authWindow = new BrowserWindow({
            width: 600,
            height: 700,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true
            },
            title: 'Sign in with Google'
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
        .then(tokens => {
          if (this.authWindow) {
            this.authWindow.close()
          }
          resolve(tokens)
        })
        .catch(err => {
          if (this.authWindow) {
            this.authWindow.close()
          }
          reject(err)
        })
    })
  }
  
  private buildAuthUrl(clientId: string, email?: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:58924/oauth/callback',
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      ...(email ? { login_hint: email } : {})
    })
    
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
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
          
          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h1>Authorization Failed</h1><p>You can close this window.</p></body></html>')
            codeRejecter(new Error(error))
          } else if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end('<html><body><h1>Success!</h1><p>You can close this window and return to WR Code.</p></body></html>')
            codeResolver(code)
          }
        }
      })
      
      this.localServer.listen(58924, '127.0.0.1', () => {
        console.log('[Gmail] OAuth callback server listening on port 58924')
        resolve(codePromise)
      })
      
      this.localServer.on('error', reject)
    })
  }
  
  private async exchangeCodeForTokens(
    oauthConfig: { clientId: string; clientSecret: string },
    code: string
  ): Promise<EmailAccountConfig['oauth']> {
    return new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        code,
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        redirect_uri: 'http://localhost:58924/oauth/callback',
        grant_type: 'authorization_code'
      }).toString()
      
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
    const oauthConfig = loadOAuthConfig()
    if (!oauthConfig || !this.refreshToken) {
      throw new Error('Cannot refresh token: missing credentials')
    }
    
    return new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        refresh_token: this.refreshToken!,
        grant_type: 'refresh_token'
      }).toString()
      
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
              reject(new Error(json.error_description || json.error))
            } else {
              this.accessToken = json.access_token
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
      }
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
    
    lines.push(`To: ${payload.to.join(', ')}`)
    if (payload.cc?.length) {
      lines.push(`Cc: ${payload.cc.join(', ')}`)
    }
    lines.push(`Subject: ${payload.subject}`)
    lines.push('MIME-Version: 1.0')
    lines.push('Content-Type: text/plain; charset=utf-8')
    
    if (payload.inReplyTo) {
      lines.push(`In-Reply-To: ${payload.inReplyTo}`)
    }
    if (payload.references?.length) {
      lines.push(`References: ${payload.references.join(' ')}`)
    }
    
    lines.push('')
    lines.push(payload.bodyText)
    
    return lines.join('\r\n')
  }
}

export const gmailProvider = new GmailProvider()

