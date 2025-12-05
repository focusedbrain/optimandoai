/**
 * Gmail API Service for WR MailGuard
 * 
 * Handles OAuth2 authentication and fetching email content
 * without rendering emails in the browser.
 */

import { BrowserWindow, app } from 'electron'
import * as https from 'https'
import * as http from 'http'
import * as url from 'url'
import * as fs from 'fs'
import * as path from 'path'

// OAuth2 Configuration
// Users need to create their own Google Cloud project and OAuth credentials
const OAUTH_CONFIG = {
  // These will be loaded from stored settings or set by user
  clientId: '',
  clientSecret: '',
  redirectUri: 'http://localhost:58923/oauth/callback',
  scopes: [
    'https://www.googleapis.com/auth/gmail.readonly'
  ]
}

interface TokenData {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface GmailMessage {
  id: string
  threadId: string
  from: string
  to: string
  subject: string
  date: string
  body: string
  attachments: { name: string; type: string; id: string }[]
}

let tokenData: TokenData | null = null
let authWindow: BrowserWindow | null = null
let localServer: http.Server | null = null

/**
 * Check if Gmail API is configured and authenticated
 */
export function isGmailApiConfigured(): boolean {
  return !!(OAUTH_CONFIG.clientId && OAUTH_CONFIG.clientSecret)
}

export function isGmailApiAuthenticated(): boolean {
  if (!tokenData) return false
  // Check if token is expired (with 5 min buffer)
  return tokenData.expiresAt > Date.now() + 300000
}

/**
 * Set OAuth credentials (from user setup)
 */
export function setOAuthCredentials(clientId: string, clientSecret: string): void {
  OAUTH_CONFIG.clientId = clientId
  OAUTH_CONFIG.clientSecret = clientSecret
}

/**
 * Get stored credentials
 */
export function getOAuthCredentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: OAUTH_CONFIG.clientId,
    clientSecret: OAUTH_CONFIG.clientSecret
  }
}

/**
 * Start OAuth2 authorization flow
 */
export function startOAuthFlow(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!OAUTH_CONFIG.clientId || !OAUTH_CONFIG.clientSecret) {
      reject(new Error('OAuth credentials not configured'))
      return
    }

    // Start local server to receive OAuth callback
    startLocalServer()
      .then((callbackPromise) => {
        // Build authorization URL
        const authUrl = buildAuthUrl()
        
        // Open auth window
        authWindow = new BrowserWindow({
          width: 600,
          height: 700,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          },
          title: 'Sign in with Google - WR MailGuard'
        })
        
        authWindow.loadURL(authUrl)
        
        authWindow.on('closed', () => {
          authWindow = null
          if (localServer) {
            localServer.close()
            localServer = null
          }
        })
        
        // Wait for callback
        return callbackPromise
      })
      .then((code) => {
        // Exchange code for tokens
        return exchangeCodeForTokens(code)
      })
      .then((tokens) => {
        tokenData = tokens
        if (authWindow) {
          authWindow.close()
          authWindow = null
        }
        resolve(true)
      })
      .catch((err) => {
        if (authWindow) {
          authWindow.close()
          authWindow = null
        }
        reject(err)
      })
  })
}

/**
 * Build Google OAuth authorization URL
 */
function buildAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    response_type: 'code',
    scope: OAUTH_CONFIG.scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  })
  
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/**
 * Start local HTTP server to receive OAuth callback
 */
function startLocalServer(): Promise<Promise<string>> {
  return new Promise((resolve, reject) => {
    let codeResolver: (code: string) => void
    let codeRejecter: (err: Error) => void
    
    const codePromise = new Promise<string>((res, rej) => {
      codeResolver = res
      codeRejecter = rej
    })
    
    localServer = http.createServer((req, res) => {
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
          res.end('<html><body><h1>Authorization Successful!</h1><p>You can close this window and return to WR MailGuard.</p></body></html>')
          codeResolver(code)
        }
      }
    })
    
    localServer.listen(58923, '127.0.0.1', () => {
      console.log('[GmailAPI] OAuth callback server listening on port 58923')
      resolve(codePromise)
    })
    
    localServer.on('error', (err) => {
      reject(err)
    })
  })
}

/**
 * Exchange authorization code for access/refresh tokens
 */
function exchangeCodeForTokens(code: string): Promise<TokenData> {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      code,
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      redirect_uri: OAUTH_CONFIG.redirectUri,
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
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) {
            reject(new Error(json.error_description || json.error))
          } else {
            resolve({
              accessToken: json.access_token,
              refreshToken: json.refresh_token,
              expiresAt: Date.now() + (json.expires_in * 1000)
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

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(): Promise<void> {
  if (!tokenData?.refreshToken) {
    throw new Error('No refresh token available')
  }
  
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
      refresh_token: tokenData!.refreshToken,
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
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) {
            reject(new Error(json.error_description || json.error))
          } else {
            tokenData = {
              accessToken: json.access_token,
              refreshToken: tokenData!.refreshToken, // Keep existing refresh token
              expiresAt: Date.now() + (json.expires_in * 1000)
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
 * Ensure we have a valid access token
 */
async function ensureValidToken(): Promise<string> {
  if (!tokenData) {
    throw new Error('Not authenticated')
  }
  
  // Refresh if expired or about to expire (5 min buffer)
  if (tokenData.expiresAt < Date.now() + 300000) {
    await refreshAccessToken()
  }
  
  return tokenData.accessToken
}

/**
 * Fetch email content by message ID via Gmail API
 */
export async function fetchEmailById(messageId: string): Promise<GmailMessage> {
  const accessToken = await ensureValidToken()
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gmail.googleapis.com',
      path: `/gmail/v1/users/me/messages/${messageId}?format=full`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
    
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) {
            reject(new Error(json.error.message || 'API error'))
          } else {
            resolve(parseGmailMessage(json))
          }
        } catch (err) {
          reject(err)
        }
      })
    })
    
    req.on('error', reject)
    req.end()
  })
}

/**
 * Search for emails and get their IDs
 */
export async function searchEmails(query: string, maxResults: number = 10): Promise<string[]> {
  const accessToken = await ensureValidToken()
  
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      q: query,
      maxResults: maxResults.toString()
    })
    
    const options = {
      hostname: 'gmail.googleapis.com',
      path: `/gmail/v1/users/me/messages?${params.toString()}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
    
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.error) {
            reject(new Error(json.error.message || 'API error'))
          } else {
            const messageIds = (json.messages || []).map((m: any) => m.id)
            resolve(messageIds)
          }
        } catch (err) {
          reject(err)
        }
      })
    })
    
    req.on('error', reject)
    req.end()
  })
}

/**
 * Find email by subject and sender (to match inbox row preview)
 */
export async function findEmailByPreview(from: string, subject: string): Promise<GmailMessage | null> {
  try {
    // Build search query
    const query = `from:(${from}) subject:(${subject})`
    const messageIds = await searchEmails(query, 1)
    
    if (messageIds.length === 0) {
      return null
    }
    
    return await fetchEmailById(messageIds[0])
  } catch (err) {
    console.error('[GmailAPI] Error finding email:', err)
    return null
  }
}

/**
 * Parse Gmail API message response into our format
 */
function parseGmailMessage(raw: any): GmailMessage {
  const headers = raw.payload?.headers || []
  
  const getHeader = (name: string): string => {
    const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
    return header?.value || ''
  }
  
  // Extract body
  let body = ''
  if (raw.payload?.body?.data) {
    body = decodeBase64Url(raw.payload.body.data)
  } else if (raw.payload?.parts) {
    body = extractBodyFromParts(raw.payload.parts)
  }
  
  // Extract attachments
  const attachments: { name: string; type: string; id: string }[] = []
  if (raw.payload?.parts) {
    extractAttachmentsFromParts(raw.payload.parts, attachments)
  }
  
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: getHeader('From'),
    to: getHeader('To'),
    subject: getHeader('Subject'),
    date: getHeader('Date'),
    body: sanitizeEmailBody(body),
    attachments
  }
}

/**
 * Extract body text from multipart message
 */
function extractBodyFromParts(parts: any[]): string {
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data)
    }
    if (part.mimeType === 'text/html' && part.body?.data) {
      // Convert HTML to text
      return htmlToText(decodeBase64Url(part.body.data))
    }
    if (part.parts) {
      const nested = extractBodyFromParts(part.parts)
      if (nested) return nested
    }
  }
  return ''
}

/**
 * Extract attachments from multipart message
 */
function extractAttachmentsFromParts(parts: any[], attachments: { name: string; type: string; id: string }[]): void {
  for (const part of parts) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        name: part.filename,
        type: part.mimeType || 'application/octet-stream',
        id: part.body.attachmentId
      })
    }
    if (part.parts) {
      extractAttachmentsFromParts(part.parts, attachments)
    }
  }
}

/**
 * Decode base64url encoded string
 */
function decodeBase64Url(data: string): string {
  // Replace URL-safe chars with standard base64 chars
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/**
 * Convert HTML to plain text
 */
function htmlToText(html: string): string {
  // Simple HTML to text conversion
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Sanitize email body (remove any remaining dangerous content)
 */
function sanitizeEmailBody(body: string): string {
  // Already plain text from API, just clean up
  return body
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Disconnect/logout from Gmail API
 */
export function disconnectGmailApi(): void {
  tokenData = null
  OAUTH_CONFIG.clientId = ''
  OAUTH_CONFIG.clientSecret = ''
}

/**
 * Save credentials and tokens to storage
 */
export function exportCredentials(): { clientId: string; clientSecret: string; tokens: TokenData | null } {
  return {
    clientId: OAUTH_CONFIG.clientId,
    clientSecret: OAUTH_CONFIG.clientSecret,
    tokens: tokenData
  }
}

/**
 * Import credentials and tokens from storage
 */
export function importCredentials(data: { clientId: string; clientSecret: string; tokens: TokenData | null }): void {
  OAUTH_CONFIG.clientId = data.clientId
  OAUTH_CONFIG.clientSecret = data.clientSecret
  tokenData = data.tokens
}

/**
 * Get path to credentials storage file
 */
function getCredentialsPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'gmail-api-credentials.json')
}

/**
 * Save credentials to disk
 */
export function saveCredentialsToDisk(): void {
  try {
    const filePath = getCredentialsPath()
    const data = exportCredentials()
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    console.log('[GmailAPI] Credentials saved to disk')
  } catch (err) {
    console.error('[GmailAPI] Error saving credentials:', err)
  }
}

/**
 * Load credentials from disk
 */
export function loadCredentialsFromDisk(): boolean {
  try {
    const filePath = getCredentialsPath()
    if (!fs.existsSync(filePath)) {
      return false
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    importCredentials(data)
    console.log('[GmailAPI] Credentials loaded from disk')
    return true
  } catch (err) {
    console.error('[GmailAPI] Error loading credentials:', err)
    return false
  }
}

/**
 * Delete credentials from disk
 */
export function deleteCredentialsFromDisk(): void {
  try {
    const filePath = getCredentialsPath()
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    console.log('[GmailAPI] Credentials deleted from disk')
  } catch (err) {
    console.error('[GmailAPI] Error deleting credentials:', err)
  }
}

