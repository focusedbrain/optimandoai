/**
 * OAuth Callback Server Manager
 * 
 * Centralized management of the OAuth callback server for all email providers.
 * Provides a production-grade solution with:
 * - Port availability checking with fallback ports
 * - Singleton server instance to prevent conflicts
 * - Proper cleanup on shutdown
 * - State machine for OAuth flow management
 * - Request routing for multiple providers
 */

import * as http from 'http'
import * as net from 'net'
import * as url from 'url'

// OAuth flow states
export enum OAuthState {
  IDLE = 'idle',
  STARTING_SERVER = 'starting_server',
  WAITING_FOR_AUTH = 'waiting_for_auth',
  EXCHANGING_TOKENS = 'exchanging_tokens',
  COMPLETE = 'complete',
  ERROR = 'error'
}

// Callback result types
export interface OAuthCallbackResult {
  success: boolean
  code?: string
  error?: string
  errorDescription?: string
  state?: string
}

// Pending OAuth request
interface PendingOAuthRequest {
  provider: 'gmail' | 'outlook'
  resolve: (result: OAuthCallbackResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
  startTime: number
}

// Server configuration
const PREFERRED_PORT = 51249
const PORT_RANGE = 10  // Will try ports 51249-51258
const DEFAULT_TIMEOUT = 5 * 60 * 1000  // 5 minutes for OAuth flow

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true))
      })
      .listen(port, '127.0.0.1')
  })
}

/**
 * Find an available port in the range
 */
async function findAvailablePort(preferredPort: number, range: number): Promise<number> {
  for (let port = preferredPort; port < preferredPort + range; port++) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available ports in range ${preferredPort}-${preferredPort + range - 1}`)
}

/**
 * Singleton OAuth Server Manager
 */
class OAuthServerManager {
  private server: http.Server | null = null
  private currentPort: number = 0
  private state: OAuthState = OAuthState.IDLE
  private pendingRequest: PendingOAuthRequest | null = null
  private isShuttingDown: boolean = false

  /**
   * Get current OAuth state
   */
  getState(): OAuthState {
    return this.state
  }

  /**
   * Get the current callback URL (with port)
   */
  getCallbackUrl(): string {
    if (this.currentPort === 0) {
      return `http://localhost:${PREFERRED_PORT}/callback`
    }
    return `http://localhost:${this.currentPort}/callback`
  }

  /**
   * Check if the server is currently running
   */
  isServerRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  /**
   * Check if an OAuth flow is in progress
   */
  isFlowInProgress(): boolean {
    return this.state !== OAuthState.IDLE && this.state !== OAuthState.COMPLETE && this.state !== OAuthState.ERROR
  }

  /**
   * Start OAuth flow for a provider
   * Returns a promise that resolves when the callback is received
   */
  async startOAuthFlow(
    provider: 'gmail' | 'outlook',
    timeoutMs: number = DEFAULT_TIMEOUT
  ): Promise<OAuthCallbackResult> {
    // Prevent concurrent OAuth flows
    if (this.isFlowInProgress()) {
      throw new Error('Another OAuth flow is already in progress. Please wait or cancel the current flow.')
    }

    // Cleanup any previous state
    await this.cleanup()

    console.log(`[OAuthServer] Starting OAuth flow for ${provider}`)
    this.state = OAuthState.STARTING_SERVER

    try {
      // Find available port
      this.currentPort = await findAvailablePort(PREFERRED_PORT, PORT_RANGE)
      console.log(`[OAuthServer] Using port ${this.currentPort}`)

      // Start the server
      await this.startServer()

      // Create promise for the callback
      return new Promise<OAuthCallbackResult>((resolve, reject) => {
        // Set up timeout
        const timeout = setTimeout(() => {
          console.log(`[OAuthServer] OAuth flow timed out after ${timeoutMs}ms`)
          this.cleanup()
          reject(new Error('OAuth authentication timed out. Please try again.'))
        }, timeoutMs)

        // Store pending request
        this.pendingRequest = {
          provider,
          resolve,
          reject,
          timeout,
          startTime: Date.now()
        }

        this.state = OAuthState.WAITING_FOR_AUTH
        console.log(`[OAuthServer] Waiting for OAuth callback...`)
      })
    } catch (error: any) {
      console.error(`[OAuthServer] Failed to start OAuth flow:`, error)
      this.state = OAuthState.ERROR
      await this.cleanup()
      throw error
    }
  }

  /**
   * Start the HTTP server for OAuth callbacks
   */
  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.on('error', (err: any) => {
        console.error(`[OAuthServer] Server error:`, err)
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.currentPort} is already in use`))
        } else {
          reject(err)
        }
      })

      this.server.listen(this.currentPort, '127.0.0.1', () => {
        console.log(`[OAuthServer] Callback server listening on http://127.0.0.1:${this.currentPort}`)
        resolve()
      })
    })
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = url.parse(req.url || '', true)
    console.log(`[OAuthServer] Received request: ${parsedUrl.pathname}`)

    // Handle callback path
    if (parsedUrl.pathname === '/callback') {
      const code = parsedUrl.query.code as string
      const error = parsedUrl.query.error as string
      const errorDescription = parsedUrl.query.error_description as string
      const state = parsedUrl.query.state as string

      if (error) {
        console.log(`[OAuthServer] OAuth error received: ${error}`)
        this.sendHtmlResponse(res, 'Authorization Failed', 
          `<h1>Authorization Failed</h1><p>${errorDescription || error}</p><p>You can close this window.</p>`, 
          false)
        this.completeFlow({
          success: false,
          error,
          errorDescription,
          state
        })
      } else if (code) {
        console.log(`[OAuthServer] OAuth code received`)
        this.sendHtmlResponse(res, 'Success', 
          `<h1>Success!</h1><p>You can close this window and return to OpenGiraffe.</p>`, 
          true)
        this.completeFlow({
          success: true,
          code,
          state
        })
      } else {
        console.log(`[OAuthServer] Invalid callback - no code or error`)
        this.sendHtmlResponse(res, 'Invalid Request', 
          `<h1>Invalid Request</h1><p>No authorization code received.</p>`, 
          false)
      }
    } else if (parsedUrl.pathname === '/health') {
      // Health check endpoint for the OAuth server
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        ok: true, 
        state: this.state,
        port: this.currentPort,
        flowInProgress: this.isFlowInProgress()
      }))
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
    }
  }

  /**
   * Send HTML response to browser
   */
  private sendHtmlResponse(res: http.ServerResponse, title: string, body: string, success: boolean): void {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: ${success ? 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)' : 'linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%)'};
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      max-width: 400px;
    }
    h1 {
      color: ${success ? '#2e7d32' : '#c62828'};
      margin-bottom: 16px;
    }
    p {
      color: #666;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  }

  /**
   * Complete the OAuth flow with a result
   */
  private completeFlow(result: OAuthCallbackResult): void {
    if (!this.pendingRequest) {
      console.log(`[OAuthServer] No pending request to complete`)
      return
    }

    const elapsed = Date.now() - this.pendingRequest.startTime
    console.log(`[OAuthServer] OAuth flow completed in ${elapsed}ms`)

    // Clear timeout
    clearTimeout(this.pendingRequest.timeout)

    // Update state
    this.state = result.success ? OAuthState.COMPLETE : OAuthState.ERROR

    // Resolve the promise
    const { resolve } = this.pendingRequest
    this.pendingRequest = null

    // Schedule cleanup (give browser time to show success page)
    setTimeout(() => {
      this.cleanup()
    }, 2000)

    resolve(result)
  }

  /**
   * Cancel the current OAuth flow
   */
  async cancelFlow(): Promise<void> {
    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timeout)
      this.pendingRequest.reject(new Error('OAuth flow was cancelled'))
      this.pendingRequest = null
    }
    this.state = OAuthState.IDLE
    await this.cleanup()
    console.log(`[OAuthServer] OAuth flow cancelled`)
  }

  /**
   * Cleanup server and state
   */
  async cleanup(): Promise<void> {
    if (this.isShuttingDown) return

    console.log(`[OAuthServer] Cleaning up...`)

    // Clear pending request timeout
    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timeout)
    }

    // Close server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          console.log(`[OAuthServer] Server closed`)
          this.server = null
          this.currentPort = 0
          if (this.state !== OAuthState.COMPLETE && this.state !== OAuthState.ERROR) {
            this.state = OAuthState.IDLE
          }
          resolve()
        })

        // Force close after 1 second if not closing gracefully
        setTimeout(() => {
          if (this.server) {
            console.log(`[OAuthServer] Force closing server`)
            this.server = null
            this.currentPort = 0
            resolve()
          }
        }, 1000)
      })
    }
  }

  /**
   * Shutdown the manager (called on app exit)
   */
  async shutdown(): Promise<void> {
    console.log(`[OAuthServer] Shutting down...`)
    this.isShuttingDown = true

    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timeout)
      this.pendingRequest.reject(new Error('Application is shutting down'))
      this.pendingRequest = null
    }

    await this.cleanup()
    console.log(`[OAuthServer] Shutdown complete`)
  }

  /**
   * Get current port (for dynamic redirect URI)
   */
  getCurrentPort(): number {
    return this.currentPort || PREFERRED_PORT
  }
}

// Export singleton instance
export const oauthServerManager = new OAuthServerManager()

// Export types (OAuthCallbackResult already exported as interface above)
export type { PendingOAuthRequest }
