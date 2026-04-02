import { app, BrowserWindow, globalShortcut, Tray, Menu, Notification, screen, dialog, shell, ipcMain } from 'electron'
import { loginWithKeycloak, prepareLoginUrl, setUrlOpener } from '../src/auth/login'
import { saveRefreshToken, clearRefreshToken } from '../src/auth/tokenStore'
import { ensureSession, updateSessionFromTokens, clearSession, getCachedUserInfo, getAccessToken } from '../src/auth/session'
import { 
  resolveTier,
  UNKNOWN_TIER,
  type Tier
} from '../src/auth/capabilities'
import {
  DEBUG_AUTOSORT_DIAGNOSTICS,
  autosortDiagLog,
  getAutosortDiagMainState,
  recordVaultLock,
} from './main/autosortDiagnostics'

/** When true, log every `GET /api/auth/status` request and response summary (verbose). */
const DEBUG_AUTH_STATUS_HTTP = false

// === TEMPORARY DEBUG LOG CAPTURE (remove before production) ===
const _originalLog = console.log
const _originalError = console.error
const _originalWarn = console.warn

function formatMainLogArg(a: unknown): string {
  if (typeof a === 'string') return a
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

function broadcastMainProcessLog(level: string, args: unknown[]) {
  const line = args.map(formatMainLogArg).join(' ')
  const entry = { ts: new Date().toISOString(), level, line }
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      win.webContents.send('main-process-log', entry)
    }
  } catch {
    /* never throw from logging */
  }
}

console.log = (...args: unknown[]) => {
  _originalLog(...args)
  broadcastMainProcessLog('log', args)
}
console.error = (...args: unknown[]) => {
  _originalError(...args)
  broadcastMainProcessLog('error', args)
}
console.warn = (...args: unknown[]) => {
  _originalWarn(...args)
  broadcastMainProcessLog('warn', args)
}
// === END TEMPORARY DEBUG LOG CAPTURE ===

// ============================================================================
// INSTANT LOGOUT - Split into fast sync (UI lock) + slow async (cleanup)
// ============================================================================

/**
 * Fast synchronous logout - locks UI instantly
 * Called BEFORE any await to ensure immediate UI update
 */
function logoutFast(): void {
  const t0 = Date.now()
  console.log(`[AUTH][t0] logoutFast() - Locking UI immediately`)
  
  // 1. Lock vault FIRST — clears KEK/DEK from memory before anything else
  lockVaultIfLoaded('logoutFast')
  console.log(`[AUTH][t+${Date.now() - t0}ms] Vault lock requested`)

  // 1b. Close handshake ledger — discards the session-derived key from memory
  closeLedger()
  console.log(`[AUTH][t+${Date.now() - t0}ms] Handshake ledger closed`)

  // 2. Set auth state to locked (blocks all privileged actions)
  hasValidSession = false
  currentTier = UNKNOWN_TIER
  lastKnownGoodTier = null
  lastEntitlementRefreshAt = null
  console.log(`[AUTH][t+${Date.now() - t0}ms] hasValidSession = false, lastKnownGoodTier and lastEntitlementRefreshAt cleared`)
  
  // 3. Clear in-memory tokens (sync, fast)
  clearSession()
  console.log(`[AUTH][t+${Date.now() - t0}ms] In-memory session cleared`)
  
  // 4. Update tray menu to show locked state
  updateTrayMenu()
  console.log(`[AUTH][t+${Date.now() - t0}ms] Tray menu updated`)
  
  // 5. Destroy dashboard window immediately — destroy() bypasses the close
  //    handler (which only hides the window) so the window is truly gone.
  //    A fresh window is created on next login via openDashboardWindow().
  if (win && !win.isDestroyed()) {
    win.destroy()
    win = null
    console.log(`[AUTH][t+${Date.now() - t0}ms] Dashboard window destroyed`)
  }
  
  // 6. Close BEAP Inbox popup via WebSocket message to extension
  const closePopupMsg = JSON.stringify({ type: 'CLOSE_COMMAND_CENTER_POPUP' })
  wsClients.forEach((socket: any) => {
    try {
      socket.send(closePopupMsg)
      console.log(`[AUTH][t+${Date.now() - t0}ms] Sent CLOSE_COMMAND_CENTER_POPUP to extension`)
    } catch {}
  })
  
  console.log(`[AUTH][t+${Date.now() - t0}ms] logoutFast() complete - UI is now locked`)
}

/**
 * Slow async cleanup - runs AFTER UI is already locked
 * Does not block UI update
 */
async function logoutCleanupAsync(): Promise<void> {
  const t0 = Date.now()
  console.log(`[AUTH][cleanup t0] Starting async cleanup (UI already locked)`)
  
  try {
    // Clear refresh token from secure storage (slow - keytar access)
    await clearRefreshToken()
    console.log(`[AUTH][cleanup t+${Date.now() - t0}ms] Refresh token cleared from secure storage`)
  } catch (err: any) {
    // Log but don't fail - UI is already locked
    console.error(`[AUTH][cleanup] Error clearing refresh token:`, err?.message || err)
  }
  
  console.log(`[AUTH][cleanup t+${Date.now() - t0}ms] Async cleanup complete`)
}

// ============================================================================
// AUTH-GATED STARTUP - Track session validity for headless mode
// ============================================================================
let hasValidSession = false  // Set after startup session check

// Display-only cache — used for tray menus, IPC status, and auth responses.
// NEVER use this for security-gated decisions (vault routes, capability checks).
// Those MUST call getEffectiveTier() to get the authoritative tier per-request.
let currentTier: Tier = UNKNOWN_TIER

// Last known good tier — used when session is temporarily missing (refresh failure, etc.).
// Cleared on logout. Never use 'free' as error fallback.
let lastKnownGoodTier: Tier | null = null

// Timestamp of last successful entitlement refresh from Keycloak.
// Used to decide when to force-refresh before /api/vault/status.
let lastEntitlementRefreshAt: number | null = null

const ENTITLEMENT_REFRESH_INTERVAL_MS = 60_000

/**
 * Refresh entitlements from Keycloak (single source of truth).
 * Calls ensureSession(force), derives tier, updates currentTier, lastKnownGoodTier, lastEntitlementRefreshAt.
 * On failure: returns lastKnownGoodTier ?? unknown (never 'free').
 */
async function refreshEntitlements(force = true, source = 'caller'): Promise<Tier> {
  console.log(`[ENTITLEMENT_REFRESH] refresh begin (force=${force}, source=${source})`)
  try {
    const session = await ensureSession(force)
    if (!session.accessToken || !session.userInfo) {
      const fallback = lastKnownGoodTier ?? UNKNOWN_TIER
      console.log(`[ENTITLEMENT_REFRESH] refresh failure: session missing — using ${lastKnownGoodTier != null ? 'lastKnownGoodTier' : 'unknown'}:`, fallback)
      return fallback
    }
    const tier = session.userInfo.canonical_tier ?? resolveTier(
      session.userInfo.wrdesk_plan,
      session.userInfo.roles || [],
      session.userInfo.sso_tier,
    )
    const isValidTier = tier != null && tier !== UNKNOWN_TIER
    currentTier = tier
    if (isValidTier) {
      lastKnownGoodTier = tier
      lastEntitlementRefreshAt = Date.now()
      console.log(`[ENTITLEMENT_REFRESH] refresh success: tier=${tier}, lastKnownGoodTier updated, lastEntitlementRefreshAt set`)
    } else {
      lastEntitlementRefreshAt = Date.now()
      console.log(`[ENTITLEMENT_REFRESH] refresh success: tier=${tier ?? 'unknown'}, lastKnownGoodTier unchanged`)
    }
    return tier
  } catch (err: any) {
    const fallback = lastKnownGoodTier ?? UNKNOWN_TIER
    console.log(`[ENTITLEMENT_REFRESH] refresh failure:`, err?.message || err, `— using ${lastKnownGoodTier != null ? 'lastKnownGoodTier' : 'unknown'}:`, fallback)
    return fallback
  }
}

/**
 * Single entry point for tier for all vault routes and status paths.
 * When refreshIfStale is true and lastEntitlementRefreshAt is null or older than 60s,
 * forces a Keycloak refresh first. Otherwise uses cached session/state.
 */
async function getEffectiveTier(options?: { refreshIfStale?: boolean; caller?: string }): Promise<Tier> {
  const { refreshIfStale = false, caller = 'caller' } = options ?? {}
  const stale = lastEntitlementRefreshAt == null || (Date.now() - lastEntitlementRefreshAt) > ENTITLEMENT_REFRESH_INTERVAL_MS
  if (refreshIfStale && stale) {
    return refreshEntitlements(true, caller)
  }
  return resolveRequestTier()
}

/**
 * Resolve tier from session (no forced refresh).
 * Used internally by getEffectiveTier when not stale.
 */
async function resolveRequestTier(): Promise<Tier> {
  const session = await ensureSession()
  if (!session.accessToken || !session.userInfo) {
    if (lastKnownGoodTier != null) {
      console.log('[ENTITLEMENT] resolveRequestTier: session missing — returning lastKnownGoodTier:', lastKnownGoodTier)
      return lastKnownGoodTier
    }
    console.log('[ENTITLEMENT] resolveRequestTier: session missing, no lastKnownGoodTier — returning unknown')
    return UNKNOWN_TIER
  }
  // Use canonical tier (computed once during session creation); fallback for legacy sessions
  const tier = session.userInfo.canonical_tier ?? resolveTier(
    session.userInfo.wrdesk_plan,
    session.userInfo.roles || [],
    session.userInfo.sso_tier,
  )
  const isValidTier = tier != null && tier !== UNKNOWN_TIER
  if (isValidTier) {
    currentTier = tier
    lastKnownGoodTier = tier
    console.log('[ENTITLEMENT] Valid tier confirmed from session:', tier, '— updated currentTier and lastKnownGoodTier')
  } else {
    currentTier = tier
    console.log('[TIER] resolveRequestTier: canonical_tier=' + (tier || '(none)'))
  }
  return tier
}

// Cached reference to vaultService — set lazily on first vault route access.
// Allows logoutFast() (synchronous) to lock the vault without async import.
// validateToken/getSessionToken used by the VSBT middleware.
let _vaultServiceRef: {
  lock: () => void
  validateToken: (token: string) => boolean
  getSessionToken: () => string | null
} | null = null

/**
 * Lock the vault synchronously if the module has been loaded.
 * Safe to call at any time — no-op if vault was never imported.
 * @param reason Optional caller label for autosort diagnostics (no effect when DEBUG_AUTOSORT_DIAGNOSTICS is false).
 */
function lockVaultIfLoaded(reason?: string): void {
  recordVaultLock(reason)
  const ctx = getAutosortDiagMainState()
  if (ctx.bulkSortActive) {
    console.warn('[AUTH][AUTOSORT] Vault lock while bulk auto-sort is active:', reason ?? '(no reason)')
  }
  if (DEBUG_AUTOSORT_DIAGNOSTICS) {
    autosortDiagLog('lockVaultIfLoaded', {
      reason: reason ?? '(unspecified)',
      ts: new Date().toISOString(),
      bulkSortActive: ctx.bulkSortActive,
      sessionRunId: ctx.runId,
      vaultModuleLoaded: !!_vaultServiceRef,
    })
  }
  if (_vaultServiceRef) {
    try {
      _vaultServiceRef.lock()
      console.log('[AUTH] Vault locked during session teardown')
    } catch (err: any) {
      console.error('[AUTH] Error locking vault:', err?.message || err)
    }
  }
  // Invalidate ALL WS vault session bindings — any bound connection will fail
  // on the next vault.* message and must re-bind after a new unlock.
  if (wsVsbtBindings.size > 0) {
    wsVsbtBindings.clear()
    console.log('[AUTH] Cleared all WS vault session bindings')
  }
}
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import WebSocket, { WebSocketServer } from 'ws'
import express from 'express'
import * as http from 'node:http'
import * as net from 'net'
import * as crypto from 'crypto'

// ============================================================================
// AUTH TEST FUNCTION - Manual trigger only via IPC
// ============================================================================

/**
 * Test Keycloak login flow - DO NOT call automatically on startup
 * Trigger via IPC 'auth:test-login'
 */
async function testLoginOnce(): Promise<void> {
  console.log('[AUTH] Starting Keycloak login test...')
  try {
    const tokens = await loginWithKeycloak()
    if (tokens.refresh_token) {
      await saveRefreshToken(tokens.refresh_token)
      console.log('[AUTH] Refresh token saved to credential store')
    }
    console.log('[AUTH] Login OK - tokens received (access_token, id_token, expires_in:', tokens.expires_in, ')')
  } catch (err) {
    console.error('[AUTH] Login failed:', err instanceof Error ? err.message : String(err))
    throw err
  }
}

// ============================================================================
// AUTH-GATED WINDOW MANAGEMENT
// ============================================================================

/**
 * Check if a valid auth session exists at startup
 * Called once during app initialization
 */
async function checkStartupSession(): Promise<boolean> {
  console.log('[AUTH] Checking for valid session at startup...')
  try {
    const session = await ensureSession()
    if (session.accessToken) {
      console.log('[AUTH] Session valid - user:', session.userInfo?.displayName || session.userInfo?.email || 'unknown')
      hasValidSession = true
      
      // Use canonical tier from session
      const tier = session.userInfo?.canonical_tier ?? resolveTier(
        session.userInfo?.wrdesk_plan,
        session.userInfo?.roles || [],
        session.userInfo?.sso_tier,
      )
      currentTier = tier
      if (tier != null && tier !== UNKNOWN_TIER) {
        lastKnownGoodTier = tier
        console.log('[ENTITLEMENT] Valid tier confirmed at startup:', tier, '— updated lastKnownGoodTier')
      } else {
        console.log('[AUTH] Tier set:', currentTier)
      }
      
      return true
    } else {
      console.log('[AUTH] No valid session found')
      hasValidSession = false
      currentTier = lastKnownGoodTier ?? UNKNOWN_TIER
      return false
    }
  } catch (err) {
    console.error('[AUTH] Session check failed:', err instanceof Error ? err.message : String(err))
    hasValidSession = false
    currentTier = lastKnownGoodTier ?? UNKNOWN_TIER
    return false
  }
}

/**
 * Open the dashboard window - called when:
 * 1) User already has a valid session at startup
 * 2) Login flow completes successfully
 * 3) Explicit user action (tray click, deep link)
 */
async function openDashboardWindow(): Promise<void> {
  console.log('[AUTH] Opening dashboard window...')
  
  if (win && !win.isDestroyed()) {
    // Window exists — destroy and recreate to avoid blank canvas when opened from extension.
    // Hidden windows can have suspended/discarded renderers; reload was unreliable.
    console.log('[AUTH] Dashboard window exists - destroying and recreating for fresh load')
    win.destroy()
    win = null
  }
  if (!win || win.isDestroyed()) {
    // Create new window
    console.log('[AUTH] Creating new dashboard window')
    await createWindow()
    if (win) {
      // Wait for renderer to finish loading before showing — prevents blank white flash
      // on all platforms, but especially important on Linux/Wayland.
      await new Promise<void>((resolve) => {
        if (!win || win.isDestroyed()) { resolve(); return }
        if (!win.webContents.isLoading()) {
          resolve()
        } else {
          win.webContents.once('did-finish-load', () => resolve())
          // Safety timeout — show after 10s even if load event never fires
          setTimeout(resolve, 10_000)
        }
      })
      if (win && !win.isDestroyed()) {
        win.show()
        win.focus()
        // Always send IPC so renderer shows Analysis view (extension brain icon, tray, etc.)
        win.webContents.send('OPEN_ANALYSIS_DASHBOARD', { phase: 'live', theme: currentExtensionTheme })
        console.log('[AUTH] Sent OPEN_ANALYSIS_DASHBOARD to new window')
      }
      // Open DevTools AFTER showing — never during createWindow() because
      // docked DevTools can make a hidden BrowserWindow visible on Windows.
      if (win && !win.isDestroyed()) {
        win.webContents.openDevTools({ mode: 'detach' })
      }
    }
  }
  console.log('[AUTH] Dashboard window opened')
}

/**
 * Request login flow - triggered from extension via IPC/HTTP
 * On success: opens dashboard window and sets tier
 */
async function requestLogin(): Promise<{ ok: boolean; error?: string; tier?: string }> {
  console.log('[AUTH] Login requested - starting Keycloak SSO flow...')
  try {
    const tokens = await loginWithKeycloak()
    
    // Save refresh token to OS credential store
    if (tokens.refresh_token) {
      await saveRefreshToken(tokens.refresh_token)
      console.log('[AUTH] Refresh token saved to credential store')
    }
    
    // Update session with new tokens (this extracts user info including roles)
    const userInfo = updateSessionFromTokens(tokens)
    
    // Mark session as valid
    hasValidSession = true
    
    // Use canonical tier from session
    const tier = userInfo?.canonical_tier ?? resolveTier(
      userInfo?.wrdesk_plan,
      userInfo?.roles || [],
      userInfo?.sso_tier,
    )
    currentTier = tier
    if (tier != null && tier !== UNKNOWN_TIER) {
      lastKnownGoodTier = tier
      console.log('[ENTITLEMENT] Valid tier confirmed at login:', tier, '— updated lastKnownGoodTier')
    } else {
      console.log('[AUTH] Login successful - tier:', currentTier)
    }
    
    // Open the handshake ledger for this new session
    try {
      if (userInfo?.sub && userInfo?.iss) {
        const ledgerToken = buildLedgerSessionToken(userInfo.wrdesk_user_id || userInfo.sub, userInfo.iss)
        openLedger(ledgerToken).then(() => {
          console.log('[AUTH] Handshake ledger opened after login')
          onLedgerReady?.()
        }).catch(err => {
          console.warn('[AUTH] Handshake ledger open after login failed:', err?.message)
        })
      }
    } catch (ledgerErr) {
      console.warn('[AUTH] Handshake ledger open skipped:', ledgerErr)
    }

    // Update tray menu to reflect logged-in state
    updateTrayMenu()
    
    // Open dashboard window after successful login
    await openDashboardWindow()
    
    return { 
      ok: true, 
      tier: currentTier
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[AUTH] Login failed:', message)
    currentTier = lastKnownGoodTier ?? UNKNOWN_TIER
    return { ok: false, error: message }
  }
}

/**
 * Get current auth status including tier
 * Exported for external use (e.g., IPC handlers, HTTP API)
 */
export function getAuthStatus(): { loggedIn: boolean; tier: string | null } {
  return {
    loggedIn: hasValidSession,
    tier: hasValidSession ? currentTier : null
  }
}

// ============================================================================
// SINGLE INSTANCE LOCK - Prevent multiple instances from running
// ============================================================================
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.log('[MAIN] Another instance is already running. Exiting.')
  app.quit()
  // CRITICAL: Exit the process immediately to prevent any further code execution
  process.exit(0)
}

// ============================================================================
// DEBUG MODE - Set to true for verbose logging (impacts performance)
// ============================================================================
const DEBUG_MODE = false

/** Conditional debug logging - only logs when DEBUG_MODE is true */
function debugLog(...args: any[]): void {
  if (DEBUG_MODE) console.log(...args)
}

// ============================================================================
// ROBUST PORT MANAGEMENT - Ensure clean startup
// ============================================================================

const WS_PORT = 51247
const HTTP_PORT = 51248

// ============================================================================
// SECURITY: Per-launch HTTP authentication secret.
//
// Generated once at process start.  Never persisted to disk.
// Required in the X-Launch-Secret header on every HTTP request
// (except /api/health).  Distributed to the extension background
// script via the WebSocket handshake message.
//
// This is the primary defense against Attack Chain 1: even if an
// attacker somehow bypasses CORS (proxy, browser bug, etc.), they
// cannot forge this header because they don't know the secret.
// ============================================================================
// Secret stored as raw Buffer — hex encoding only at transport boundaries.
// Cannot be zeroized on shutdown (module scope, process-lifetime), but keeping
// it as Buffer avoids V8 string interning and makes it eligible for GC if we
// ever move to a shorter-lived scope.
const LAUNCH_SECRET_BUF = crypto.randomBytes(32)

/**
 * Hex-encode the launch secret for transport (WebSocket handshake, logging).
 * Each call creates a short-lived string that is GC'd promptly.
 */
function launchSecretHex(): string {
  return LAUNCH_SECRET_BUF.toString('hex')
}

/**
 * Constant-time comparison of an incoming header value against the launch secret.
 * The incoming string is hex-decoded to a Buffer before comparison.
 */
function validateLaunchSecret(incoming: string): boolean {
  const inBuf = Buffer.from(incoming, 'hex')
  if (inBuf.length !== LAUNCH_SECRET_BUF.length) {
    crypto.timingSafeEqual(LAUNCH_SECRET_BUF, LAUNCH_SECRET_BUF) // consume constant time
    return false
  }
  return crypto.timingSafeEqual(LAUNCH_SECRET_BUF, inBuf)
}

/** Injected by Vite `define` when the main bundle is built — proves which compile is running. */
declare const __ORCHESTRATOR_BUILD_STAMP__: string | undefined

function orchestratorBuildMeta(): { orchestratorBuildStamp: string; orchestratorAppPath: string } {
  const orchestratorBuildStamp =
    typeof __ORCHESTRATOR_BUILD_STAMP__ !== 'undefined' && __ORCHESTRATOR_BUILD_STAMP__
      ? String(__ORCHESTRATOR_BUILD_STAMP__)
      : 'dev'
  return {
    orchestratorBuildStamp,
    /** Process cwd (dev: repo app dir). Compare with your clone path if you suspect a stale binary. */
    orchestratorAppPath: process.cwd(),
  }
}

// CORS: Allowed origins for WRDesk (extension + website). No wildcard in production.
const CORS_ALLOWED_ORIGINS = new Set(['https://wrdesk.com', 'https://www.wrdesk.com'])

/**
 * Electron renderer (Vite dev) runs at http://localhost:&lt;port&gt; or http://127.0.0.1:&lt;port&gt;.
 * Extension library code (@ext/beapCrypto, BeapPackageBuilder) uses fetch to 127.0.0.1:51248 — without
 * this, the browser blocks cross-origin requests from the dev server to the orchestrator HTTP port.
 * Restrict to loopback + non-privileged ports only (not a public CORS *).
 */
function isLocalDevHttpOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:') return false
    if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false
    const port = u.port ? parseInt(u.port, 10) : 80
    if (!Number.isFinite(port)) return false
    return port >= 1024 && port <= 65535
  } catch {
    return false
  }
}

function isCorsAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  if (CORS_ALLOWED_ORIGINS.has(origin)) return true
  if (origin.startsWith('chrome-extension://')) return true
  return isLocalDevHttpOrigin(origin)
}

function corsPnaHeaders(origin: string | undefined, requestPrivateNetwork: boolean): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Launch-Secret, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  }
  if (origin && isCorsAllowedOrigin(origin)) {
    h['Access-Control-Allow-Origin'] = origin
  }
  if (requestPrivateNetwork || (origin && isCorsAllowedOrigin(origin))) {
    h['Access-Control-Allow-Private-Network'] = 'true'
  }
  return h
}

/**
 * Check if a port is available
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close()
      resolve(true)
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Kill process using a specific port (Windows-specific)
 */
async function killProcessOnPort(port: number): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' })
    } catch {}
    return
  }
  
  try {
    // Find PID using the port
    const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' })
    const lines = result.trim().split('\n')
    const pids = new Set<string>()
    
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      const pid = parts[parts.length - 1]
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid)
      }
    }
    
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' })
        console.log(`[PORT-CLEANUP] Killed process ${pid} on port ${port}`)
      } catch {}
    }
  } catch {
    // No process found on port, which is fine
  }
}

/**
 * Kill any stale WR Desk/electron processes that might be holding ports
 */
async function killStaleProcesses(): Promise<void> {
  if (process.platform !== 'win32') return
  
  try {
    // Kill any WR Code processes (renamed electron) except current process
    const currentPid = process.pid
    execSync(`wmic process where "name='wrcode.exe' and processid!=${currentPid}" delete`, { stdio: 'ignore' })
    console.log('[PORT-CLEANUP] Killed stale WR Desk processes')
  } catch {
    // No processes found or wmic not available
  }
}

/**
 * Ensure ports are available before starting servers
 */
async function ensurePortsAvailable(): Promise<void> {
  console.log('[PORT-CLEANUP] Checking port availability...')
  
  // First, try to kill any stale processes by name
  await killStaleProcesses()
  
  let needsWait = false
  
  // Check and clean WebSocket port
  if (!(await isPortAvailable(WS_PORT))) {
    console.log(`[PORT-CLEANUP] Port ${WS_PORT} is in use, cleaning up...`)
    await killProcessOnPort(WS_PORT)
    needsWait = true
  }
  
  // Check and clean HTTP port
  if (!(await isPortAvailable(HTTP_PORT))) {
    console.log(`[PORT-CLEANUP] Port ${HTTP_PORT} is in use, cleaning up...`)
    await killProcessOnPort(HTTP_PORT)
    needsWait = true
  }
  
  // Wait for OS to release ports - need longer delay on Windows
  if (needsWait) {
    console.log('[PORT-CLEANUP] Waiting for OS to release ports...')
    await new Promise(r => setTimeout(r, 3000))
    
    // Verify ports are now available
    for (let retry = 0; retry < 5; retry++) {
      const wsAvailable = await isPortAvailable(WS_PORT)
      const httpAvailable = await isPortAvailable(HTTP_PORT)
      
      if (wsAvailable && httpAvailable) {
        console.log('[PORT-CLEANUP] Ports are now available')
        break
      }
      
      console.log(`[PORT-CLEANUP] Ports still not available, waiting... (${retry + 1}/5)`)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  
  console.log('[PORT-CLEANUP] Ports are ready')
}
// WS bridge removed to avoid port conflicts; extension fallback/deep-link is used
import { registerHandler, LmgtfyChannels, emitCapture } from './lmgtfy/ipc'
import { beginOverlay, closeAllOverlays, showStreamTriggerOverlay } from './lmgtfy/overlay'
import { captureScreenshot, startRegionStream } from './lmgtfy/capture'
import { loadPresets, upsertRegion } from './lmgtfy/presets'
import { registerDbHandlers, testConnection, syncChromeDataToPostgres, getConfig, getPostgresAdapter } from './ipc/db'
import { handleVaultRPC } from './main/vault/rpc'
import { handleHandshakeRPC, registerHandshakeRoutes, setSSOSessionProvider, setOidcTokenProvider, getCurrentSession } from './main/handshake/ipc'
import { sessionFromClaims } from './main/handshake/sessionFactory'
import { handleIngestionRPC, registerIngestionRoutes } from './main/ingestion/ipc'
import {
  openLedger,
  closeLedger,
  getLedgerDb,
  buildLedgerSessionToken,
} from './main/handshake/ledger'
import { setEmailSendFn } from './main/handshake/emailTransport'
import { processOutboundQueue, setOutboundQueueAuthRefresh } from './main/handshake/outboundQueue'
import { pullFromRelay } from './main/p2p/relayPull'
import { createP2PServer } from './main/p2p/p2pServer'
import { createCoordinationWsClient } from './main/p2p/coordinationWs'
import { setBeapRecipientPendingNotifier } from './main/p2p/beapRecipientNotify'
import { processPendingP2PBeapEmails, retryPendingQbeapDecrypt } from './main/email/beapEmailIngestion'
import { getAuditForMessage, getAutoresponderAuditLog } from './main/beap/autoresponderAudit'
import { setBeapInboxDashboardNotifier, notifyBeapInboxDashboard } from './main/email/beapInboxDashboardNotify'
import { getP2PConfig, upsertP2PConfig, computeLocalP2PEndpoint } from './main/p2p/p2pConfig'
import { getP2PHealth, setP2PHealthQueueCounts, setP2PHealthSelfTest, setP2PHealthRelayMode } from './main/p2p/p2pHealth'
import { getQueueStatus, getQueueEntries } from './main/handshake/outboundQueue'
import { migrateHandshakeTables } from './main/handshake/db'
import { completePendingContextSyncs, tryEnqueueContextSync } from './main/handshake/contextSyncEnqueue'
import { setEmailFunctions } from './main/email/beapSync'
import { activateMailGuard, deactivateMailGuard, updateEmailRows, updateProtectedArea, updateWindowPosition, showSanitizedEmail, closeLightbox, isMailGuardActive, hideOverlay, showOverlay } from './mailguard/overlay'

// Storage for email row preview data (for Gmail API matching)
const emailRowPreviewData = new Map<string, { from: string; subject: string }>()

/** Called when ledger opens — triggers P2P/coordination startup immediately instead of waiting for 10s poll */
let onLedgerReady: (() => void) | null = null

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.cjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let pendingLaunchMode: 'screenshot' | 'stream' | null = null
let tray: Tray | null = null
let activeStop: null | (() => Promise<string>) = null
// HTTP bridge server — started early so /api/health is reachable immediately.
// Full Express routes mount on this server once initialization completes.
let httpBridgeServer: http.Server | null = null
// Track connected WS clients (extension bridge)
var wsClients: any[] = (globalThis as any).__og_ws_clients__ || [];
(globalThis as any).__og_ws_clients__ = wsClients;

// Per-socket VSBT binding for vault RPC (connection-bound, not per-message).
// Populated on vault.create / vault.unlock success or explicit vault.bind handshake.
// Cleared on lock / logout / session-expire via lockVaultIfLoaded().
var wsVsbtBindings: Map<any, string> = (globalThis as any).__og_ws_vsbt__ || new Map();
(globalThis as any).__og_ws_vsbt__ = wsVsbtBindings;

export function broadcastToExtensions(message: Record<string, unknown>): void {
  const json = JSON.stringify(message)
  for (const socket of wsClients) {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(json)
      }
    } catch { /* ignore */ }
  }
}

// Current extension theme (synced from extension via WebSocket)
// Values: 'pro' (purple), 'dark', 'standard' (white - default)
let currentExtensionTheme: 'pro' | 'dark' | 'standard' = 'standard';

// Flag to track when app is actually quitting (from tray menu "Quit")
let isAppQuitting = false

// When a Chrome extension popup is open (BEAP Inbox, Handshake), the
// dashboard lowers its z-level so the popup can appear on top.
let popupIsOpen = false

// Set flag when app is actually quitting
app.on('before-quit', async () => {
  isAppQuitting = true
  
  // Shutdown OAuth server manager
  try {
    const { oauthServerManager } = await import('./main/email/oauth-server')
    await oauthServerManager.shutdown()
    console.log('[MAIN] OAuth server manager shutdown complete')
  } catch (err) {
    console.error('[MAIN] Error shutting down OAuth server:', err)
  }
})

// Graceful shutdown - close WebSocket connections and OAuth server
process.on('SIGTERM', async () => {
  console.log('[MAIN] Received SIGTERM, shutting down gracefully...')
  isAppQuitting = true
  
  // Shutdown OAuth server manager
  try {
    const { oauthServerManager } = await import('./main/email/oauth-server')
    await oauthServerManager.shutdown()
    console.log('[MAIN] OAuth server manager shutdown complete')
  } catch (err) {
    console.error('[MAIN] Error shutting down OAuth server:', err)
  }
  
  wsClients.forEach(client => {
    try { client.close() } catch {}
  })
  app.quit()
})

process.on('SIGINT', () => {
  console.log('[MAIN] Received SIGINT, shutting down gracefully...')
  isAppQuitting = true
  wsClients.forEach(client => {
    try { client.close() } catch {}
  })
  app.quit()
})

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (err: any) => {
  // Silently ignore EPIPE errors (broken stdout/stderr pipe from background terminal)
  if (err?.code === 'EPIPE') return
  console.error('[MAIN] Uncaught exception:', err)
  // Don't exit - try to keep running
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MAIN] Unhandled rejection at:', promise, 'reason:', reason)
  // Don't exit - try to keep running
})


function handleDeepLink(raw: string) {
  try {
    const url = new URL(raw)
    // Support opengiraffe://, wrcode://, and wrdesk:// protocols
    if (url.protocol !== 'opengiraffe:' && url.protocol !== 'wrcode:' && url.protocol !== 'wrdesk:') return
    const action = url.hostname // e.g., lmgtfy, start, launch
    const mode = url.searchParams.get('mode') || ''
    
    // Handle 'start' and 'launch' actions - show dashboard if authenticated, or bring app to foreground
    if (action === 'start' || action === 'launch') {
      console.log('[MAIN] Received start deep link')
      if (!hasValidSession) {
        console.log('[MAIN] No valid session - ignoring start deep link (stay in tray)')
        return
      }
      console.log('[MAIN] Session valid - opening dashboard window')
      openDashboardWindow().catch(err => {
        console.error('[MAIN] Error opening dashboard from deep link:', err)
      })
      return
    }
    
    if (action === 'lmgtfy') {
      if (mode === 'screenshot' || mode === 'stream') pendingLaunchMode = mode as any
      if (win) {
        const fire = () => {
          if (!pendingLaunchMode) return
          win?.webContents.send('hotkey', pendingLaunchMode === 'screenshot' ? 'screenshot' : 'stream')
          pendingLaunchMode = null
        }
        if (win.webContents.isLoading()) {
          win.webContents.once('did-finish-load', fire)
        } else {
          fire()
        }
      }
    }
  } catch {}
}

// Remove the default Electron application menu globally.
// This prevents the template-style menu (File, Edit, View, …) from ever
// flashing on screen, even during BrowserWindow creation edge cases.
Menu.setApplicationMenu(null)

// Check if app was started with --hidden flag (auto-start on login)
const startHidden = process.argv.includes('--hidden')
const enableDevTools = process.argv.includes('--enable-devtools')
console.log('[MAIN] Startup args:', process.argv.join(' '))
console.log('[MAIN] Start hidden mode:', startHidden)

async function createWindow() {
  // Security: renderer isolation; tokens must never be exposed to renderer
  // Always create hidden - visibility is controlled by openDashboardWindow()
  win = new BrowserWindow({
    title: 'WR Desk™',
    icon: path.join(process.env.VITE_PUBLIC, 'wrdesk-logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: process.platform !== 'linux',  // Linux has no Chromium sandbox; disable to avoid issues
      webSecurity: true,
    },
    show: false,
    width: 1200,
    height: 800,
    alwaysOnTop: true,
  })

  // Remove the default application menu (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null)

  // ── Always-on-top z-order management ──
  // Default level is 'screen-saver' (HWND_TOPMOST on Windows) so the
  // dashboard stays above all regular browser windows.
  // When a Chrome extension popup is opened from the dashboard (BEAP Inbox,
  // +New Handshake), we temporarily DISABLE alwaysOnTop so the focused
  // Chrome popup sits on top.  The dashboard remains visible behind the
  // popup.  When the popup closes (FOCUS_DASHBOARD), we restore
  // 'screen-saver' level and moveTop() so the dashboard is back above
  // all browser windows.
  const assertAlwaysOnTop = () => {
    try {
      if (win && !win.isDestroyed() && win.isVisible() && !popupIsOpen) {
        win.setAlwaysOnTop(true, 'screen-saver')
        win.moveTop()
      }
    } catch {}
  }
  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('blur', assertAlwaysOnTop)
  win.on('show', assertAlwaysOnTop)

  console.log('[MAIN] Window created (hidden by default)')
  
  // When user clicks X, hide to tray instead of quitting
  win.on('close', (event) => {
    if (!isAppQuitting) {
      event.preventDefault()
      win?.hide()
      console.log('[MAIN] Window hidden to system tray')
    }
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  // Log load failures (blank page in packaged app often caused by failed script/CSS load)
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error('[MAIN] Renderer did-fail-load:', { errorCode, errorDescription, validatedURL })
  })

  if (VITE_DEV_SERVER_URL) {
    console.log('[MAIN] Loading dev server URL:', VITE_DEV_SERVER_URL)
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const { getRendererIndexPath } = await import('./main/platform')
    const indexPath = getRendererIndexPath(__dirname, RENDERER_DIST, app.isPackaged)
    console.log('[MAIN] Loading production file:', indexPath)
    console.log('[MAIN] isPackaged:', app.isPackaged, 'platform:', process.platform)
    win.loadFile(indexPath)
  }

  // Open DevTools in development for debugging — detached mode prevents the
  // BrowserWindow from becoming visible while it should still be hidden.
  // NOTE: Only opened AFTER the window is shown via openDashboardWindow()
  // to avoid the window flashing on screen during headless startup.

  if (pendingLaunchMode) {
    win.webContents.once('did-finish-load', () => {
      if (!pendingLaunchMode) return
      win?.webContents.send('hotkey', pendingLaunchMode === 'screenshot' ? 'screenshot' : 'stream')
      pendingLaunchMode = null
    })
  }

  // LmGTFY IPC wiring
  registerHandler(LmgtfyChannels.GetPresets, () => loadPresets())
  registerHandler(LmgtfyChannels.SavePreset, async (_e, payload) => upsertRegion(payload))
  
  // Database IPC handlers
  registerDbHandlers()
  
  // Overlay direct IPC (renderer->main) to drive capture + posting
  try {
    const { ipcMain } = await import('electron')
    ipcMain.on('overlay-log', (_e, msg: string) => {
      console.log(msg)
    })
    // Handle request for desktop sources (for video recording)
    ipcMain.removeHandler('get-desktop-sources')
    ipcMain.handle('get-desktop-sources', async (_e, opts: any) => {
      try {
        const { desktopCapturer } = await import('electron')
        const sources = await desktopCapturer.getSources(opts)
        return sources.map(s => ({ id: s.id, name: s.name, display_id: s.display_id }))
      } catch (err) {
        console.log('[MAIN] Error getting desktop sources:', err)
        return []
      }
    })
    // Handle overlay cancel (X button or Escape key)
    ipcMain.on('overlay-selection', (_e, msg: any) => {
      try {
        if (msg && msg.cancel) {
          // Just close the overlay without posting anything
          console.log('[MAIN] Overlay cancelled by user')
          try { win?.webContents.send('overlay-close') } catch {}
        }
      } catch {}
    })
    // Handle trigger saved from UI
    ipcMain.on('TRIGGER_SAVED', async () => {
      try {
        console.log('[MAIN] Trigger saved, updating menus...')
        updateTrayMenu()
        // Notify all windows and extension
        try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('TRIGGERS_UPDATED') }catch{} }) } catch {}
        try { wsClients.forEach(c=>{ try { c.send(JSON.stringify({ type: 'TRIGGERS_UPDATED' })) } catch {} }) } catch {}
      } catch (err) {
        console.log('[MAIN] Error updating after trigger save:', err)
      }
    })
    // Handle theme request from renderer
    ipcMain.on('REQUEST_THEME', () => {
      console.log('[MAIN] Theme requested by renderer, current theme:', currentExtensionTheme)
      if (win) {
        // Ensure we send the correct theme name (already mapped in currentExtensionTheme)
        win.webContents.send('THEME_CHANGED', { theme: currentExtensionTheme })
      }
    })
    // Handle theme change from renderer (user changed theme in dashboard)
    ipcMain.on('SET_THEME', (_event, theme: string) => {
      // Map old theme names for backward compatibility
      let mappedTheme = theme
      if (mappedTheme === 'default') mappedTheme = 'pro'
      if (mappedTheme === 'professional') mappedTheme = 'standard'
      
      if (['pro', 'dark', 'standard'].includes(mappedTheme)) {
        console.log('[MAIN] Theme changed from renderer:', mappedTheme)
        currentExtensionTheme = mappedTheme as 'pro' | 'dark' | 'standard'
        // Notify extension via WebSocket if connected
        wsClients.forEach((socket: any) => {
          try {
            socket.send(JSON.stringify({ type: 'THEME_SYNC', theme: currentExtensionTheme }))
          } catch (e) {
            console.error('[MAIN] Error sending theme to extension:', e)
          }
        })
      }
    })
    // Helper: open popup with given launchMode (dashboard-beap | dashboard-beap-draft | dashboard-email-compose)
    const openBeapPopup = (launchMode: 'dashboard-beap' | 'dashboard-beap-draft' | 'dashboard-email-compose') => {
      let bounds = { x: 100, y: 100, width: 520, height: 720 }
      let windowState: 'normal' | 'maximized' | 'fullscreen' = 'normal'
      if (win) {
        const dashBounds = win.getBounds()
        bounds = { x: dashBounds.x, y: dashBounds.y, width: dashBounds.width, height: dashBounds.height }
        if (win.isFullScreen()) windowState = 'fullscreen'
        else if (win.isMaximized()) windowState = 'maximized'
      }
      popupIsOpen = true
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(false)
      }
      const message = JSON.stringify({
        type: 'OPEN_COMMAND_CENTER_POPUP',
        theme: currentExtensionTheme,
        launchMode,
        bounds,
        windowState
      })
      const client = wsClients[0]
      if (client) {
        try {
          client.send(message)
          console.log('[MAIN] 📨 Sent OPEN_COMMAND_CENTER_POPUP to extension with launchMode:', launchMode)
        } catch (e) {
          console.error('[MAIN] Error sending to extension:', e)
        }
      } else {
        console.log('[MAIN] ⚠️ No WebSocket clients connected - popup may not open')
      }
    }
    // Handle BEAP Inbox button from dashboard - open popup in Chrome extension
    ipcMain.on('OPEN_BEAP_INBOX', () => {
      console.log('[MAIN] 📨 BEAP Inbox requested from dashboard')
      openBeapPopup('dashboard-beap')
    })
    // Handle WR Chat button from dashboard - open popup in WR Chat mode (default)
    ipcMain.on('OPEN_WR_CHAT', () => {
      console.log('[MAIN] 📨 WR Chat popup requested from dashboard')
      let bounds = { x: 100, y: 100, width: 520, height: 720 }
      let windowState: 'normal' | 'maximized' | 'fullscreen' = 'normal'
      if (win) {
        const dashBounds = win.getBounds()
        bounds = { x: dashBounds.x, y: dashBounds.y, width: dashBounds.width, height: dashBounds.height }
        if (win.isFullScreen()) windowState = 'fullscreen'
        else if (win.isMaximized()) windowState = 'maximized'
      }
      popupIsOpen = true
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(false)
      }
      const message = JSON.stringify({
        type: 'OPEN_COMMAND_CENTER_POPUP',
        theme: currentExtensionTheme,
        bounds,
        windowState
      })
      const client = wsClients[0]
      if (client) {
        try {
          client.send(message)
          console.log('[MAIN] 📨 Sent OPEN_COMMAND_CENTER_POPUP (wr-chat) to extension')
        } catch (e) {
          console.error('[MAIN] Error sending to extension:', e)
        }
      } else {
        console.log('[MAIN] ⚠️ No WebSocket clients connected - WR Chat popup may not open')
      }
    })
    ipcMain.on('OPEN_BEAP_DRAFT', () => {
      console.log('[MAIN] 📨 BEAP Draft requested from dashboard')
      openBeapPopup('dashboard-beap-draft')
    })
    ipcMain.on('OPEN_EMAIL_COMPOSE', () => {
      console.log('[MAIN] 📨 Email Compose requested from dashboard')
      openBeapPopup('dashboard-email-compose')
    })

    ipcMain.on('OPEN_HANDSHAKE_REQUEST', () => {
      console.log('[MAIN] 📨 Handshake Request popup requested from dashboard')
      let bounds = { x: 100, y: 100, width: 520, height: 720 }
      let windowState: 'normal' | 'maximized' | 'fullscreen' = 'normal'
      if (win) {
        const dashBounds = win.getBounds()
        bounds = { x: dashBounds.x, y: dashBounds.y, width: dashBounds.width, height: dashBounds.height }
        if (win.isFullScreen()) windowState = 'fullscreen'
        else if (win.isMaximized()) windowState = 'maximized'
      }
      popupIsOpen = true
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(false)
      }
      const message = JSON.stringify({
        type: 'OPEN_COMMAND_CENTER_POPUP',
        theme: currentExtensionTheme,
        launchMode: 'dashboard-handshake-request',
        bounds: bounds,
        windowState: windowState
      })
      const client = wsClients[0]
      if (client) {
        try {
          client.send(message)
          console.log('[MAIN] 📨 Sent OPEN_COMMAND_CENTER_POPUP (handshake-request) to extension')
        } catch (e) {
          console.error('[MAIN] Error sending to extension:', e)
        }
      } else {
        console.log('[MAIN] ⚠️ No WebSocket clients connected - handshake popup may not open')
      }
    })

    ipcMain.on('overlay-cmd', async (_e, msg: any) => {
      try {
        console.log('[MAIN] Overlay command received:', msg?.action)
        
        if (!msg || !msg.action) return
        if (msg.action === 'shot') {
          console.log('[MAIN] Screenshot action - createTrigger:', msg.createTrigger)
          const rect = msg.rect || { x:0,y:0,w:0,h:0 }
          const displayId = Number(msg.displayId)||0
          const sel = { displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, dpr: 1 }
          const { filePath } = await captureScreenshot(sel as any)
          await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
          // Close all overlay windows if requested
          if (msg.closeOverlay) {
            try { closeAllOverlays() } catch {}
          }
          // Show trigger prompt UI in extension popup if requested
          if (msg.createTrigger || msg.addCommand) {
            console.log('[MAIN] Requesting trigger prompt in extension for screenshot')
            try {
              // Send to extension via WebSocket to show trigger prompt in popup
              wsClients.forEach(client => {
                try {
                  client.send(JSON.stringify({
                    type: 'SHOW_TRIGGER_PROMPT',
                    mode: 'screenshot',
                    rect,
                    displayId,
                    imageUrl: filePath, // Send the file path so extension can display the image
                    createTrigger: !!msg.createTrigger,
                    addCommand: !!msg.addCommand
                  }))
                } catch {}
              })
              console.log('[MAIN] Trigger prompt request sent to extension')
            } catch (err) {
              console.log('[MAIN] Error sending trigger prompt request:', err)
            }
          }
          return
        }
        if (msg.action === 'stream-post') {
          const dataUrl = typeof msg.dataUrl === 'string' ? msg.dataUrl : ''
          if (dataUrl) {
            try {
              const payload = JSON.stringify({ type: 'SELECTION_RESULT_VIDEO', kind: 'video', dataUrl })
              wsClients.forEach((c) => { try { c.send(payload) } catch {} })
            } catch {}
            try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('COMMAND_POPUP_APPEND',{ kind:'video', url: dataUrl }) }catch{} }) } catch {}
          }
          // Close all overlay windows after video is posted
          try { closeAllOverlays() } catch {}
          return
        }
        if (msg.action === 'stream-start') {
          console.log('[MAIN] Starting stream recording... createTrigger:', msg.createTrigger, 'addCommand:', msg.addCommand)
          const rect = msg.rect || { x:0,y:0,w:0,h:0 }
          const displayId = Number(msg.displayId)||0
          const sel = { displayId, x: rect.x, y: rect.y, w: rect.w, h: rect.h, dpr: 1 }
          // Store trigger info if needed (will show prompt after stream stops)
          const shouldCreateTrigger = msg.createTrigger
          const shouldAddCommand = msg.addCommand
          try {
            const controller = await startRegionStream(sel as any)
            activeStop = controller.stop
            // Store trigger info for after recording
            if (shouldCreateTrigger || shouldAddCommand) {
              (activeStop as any)._triggerInfo = { mode: 'stream', rect, displayId, createTrigger: !!shouldCreateTrigger, addCommand: !!shouldAddCommand }
              console.log('[MAIN] Storing trigger info for after stream stops')
            }
            console.log('[MAIN] Stream recording started successfully')
            // Keep overlay visible during recording; notify UI
            if (win) emitCapture(win, { event: LmgtfyChannels.OnCaptureEvent, mode: 'stream', filePath: '', thumbnailPath: '', meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1, displayId } })
          } catch (err) {
            console.log('[MAIN] Error starting stream:', err)
          }
          return
        }
        if (msg.action === 'stream-stop') {
          console.log('[MAIN] Stopping stream recording...')
          if (!activeStop) {
            console.log('[MAIN] No active recording to stop')
            return
          }
          const triggerInfo = (activeStop as any)._triggerInfo
          console.log('[MAIN] Trigger info:', triggerInfo)
          const out = await activeStop()
          activeStop = null
          console.log('[MAIN] Stream stopped, posting video...')
          await postStreamToPopup(out)
          console.log('[MAIN] Video posted, closing overlays...')
          try { closeAllOverlays() } catch {}
          // Show trigger prompt UI in extension popup if requested
          if (triggerInfo) {
            console.log('[MAIN] Requesting trigger prompt in extension for stream')
            try {
              // Send to extension via WebSocket to show trigger prompt in popup
              wsClients.forEach(client => {
                try {
                  client.send(JSON.stringify({
                    type: 'SHOW_TRIGGER_PROMPT',
                    mode: triggerInfo.mode,
                    rect: triggerInfo.rect,
                    displayId: triggerInfo.displayId,
                    videoUrl: out, // Send the video file path
                    createTrigger: !!triggerInfo.createTrigger,
                    addCommand: !!triggerInfo.addCommand
                  }))
                } catch {}
              })
              console.log('[MAIN] Trigger prompt request sent to extension')
            } catch (err) {
              console.log('[MAIN] Error sending trigger prompt request:', err)
            }
          }
          return
        }
      } catch {}
    })
    
    // ===== MAILGUARD IPC HANDLERS =====
    // Handle when user clicks disable in MailGuard overlay
    ipcMain.on('mailguard-disable', () => {
      console.log('[MAIN] MailGuard disable requested from overlay')
      deactivateMailGuard()
      // Notify extension that MailGuard was disabled
      wsClients.forEach(client => {
        try {
          client.send(JSON.stringify({ type: 'MAILGUARD_DEACTIVATED' }))
        } catch {}
      })
    })
    
    // Handle scroll events from overlay - forward to browser via WebSocket
    ipcMain.on('mailguard-scroll', (_e, scrollData: { deltaX: number; deltaY: number; x: number; y: number }) => {
      debugLog('[MAIN] Scroll event received from overlay, deltaY:', scrollData.deltaY)
      // Forward scroll event to content script via WebSocket
      wsClients.forEach(client => {
        try {
          client.send(JSON.stringify({ 
            type: 'MAILGUARD_SCROLL', 
            deltaX: scrollData.deltaX,
            deltaY: scrollData.deltaY,
            x: scrollData.x,
            y: scrollData.y
          }))
        } catch {}
      })
    })
    
    // Handle when user clicks "Open Safe Email" button
    ipcMain.on('mailguard-open-email', async (_e, rowId: string) => {
      debugLog('[MAIN] mailguard-open-email rowId:', rowId)
      
      // Try Email Gateway first (new secure pipeline)
      try {
        const { emailGateway } = await import('./main/email/gateway')
        const accounts = await emailGateway.listAccounts()
        const activeAccounts = accounts.filter(a => a.status === 'active')
        
        if (activeAccounts.length > 0) {
          const rowData = emailRowPreviewData.get(rowId)
          
          if (rowData && (rowData.from || rowData.subject)) {
            for (const account of activeAccounts) {
              try {
                // Build search - use subject if available, otherwise get recent from sender
                const searchOptions: any = { limit: 20 }
                if (rowData.from) searchOptions.from = rowData.from
                if (rowData.subject) searchOptions.subject = rowData.subject
                
                let messages = await emailGateway.listMessages(account.id, searchOptions)
                
                // If no results with search, try getting recent messages without filter
                if (messages.length === 0 && rowData.from) {
                  messages = await emailGateway.listMessages(account.id, { limit: 50 })
                  // Filter by sender manually
                  const senderLower = rowData.from.toLowerCase()
                  messages = messages.filter(m => 
                    m.from.email.toLowerCase().includes(senderLower) ||
                    (m.from.name && m.from.name.toLowerCase().includes(senderLower))
                  )
                }
                
                if (messages.length > 0) {
                  // Find best match - prefer subject match if available
                  let bestMatch = messages[0]
                  if (rowData.subject && messages.length > 1) {
                    const subjectLower = rowData.subject.toLowerCase()
                    const exactMatch = messages.find(m => m.subject.toLowerCase() === subjectLower)
                    const partialMatch = messages.find(m => m.subject.toLowerCase().includes(subjectLower) || subjectLower.includes(m.subject.toLowerCase()))
                    bestMatch = exactMatch || partialMatch || messages[0]
                  }
                  
                  const fullMessage = await emailGateway.getMessage(account.id, bestMatch.id)
                  if (fullMessage) {
                    showSanitizedEmail({
                      from: `${fullMessage.from.name || ''} <${fullMessage.from.email}>`.trim(),
                      to: fullMessage.to.map(t => t.email).join(', '),
                      subject: fullMessage.subject,
                      date: fullMessage.date,
                      body: fullMessage.bodyText,
                      attachments: [],
                      isFromApi: true
                    })
                    return
                  }
                }
              } catch (accountErr: any) {
                debugLog('[MAIN] Account fetch error:', accountErr?.message)
              }
            }
          }
        }
      } catch (err: any) {
        debugLog('[MAIN] Email Gateway error:', err?.message)
      }
      
      // Try legacy Gmail API as fallback
      try {
        const { isGmailApiAuthenticated, findEmailByPreview } = await import('./mailguard/gmail-api')
        
        if (isGmailApiAuthenticated()) {
          console.log('[MAIN] Fallback: Gmail API is authenticated, trying to fetch...')
          
          const rowData = emailRowPreviewData.get(rowId)
          if (rowData && rowData.from && rowData.subject) {
            const email = await findEmailByPreview(rowData.from, rowData.subject)
            if (email) {
              console.log('[MAIN] Fetched email via legacy Gmail API')
              showSanitizedEmail({
                from: email.from,
                to: email.to,
                subject: email.subject,
                date: email.date,
                body: email.body,
                attachments: email.attachments.map(a => ({ name: a.name, type: a.type })),
                isFromApi: true  // Mark as API-fetched
              })
              return
            }
          }
        }
      } catch (err) {
        console.log('[MAIN] Legacy Gmail API not available, falling back to preview:', err)
      }
      
      // Fall back to extension preview extraction
      console.log('[MAIN] Falling back to extension preview extraction for row:', rowId)
      wsClients.forEach(client => {
        try {
          client.send(JSON.stringify({ type: 'MAILGUARD_EXTRACT_EMAIL', rowId }))
          debugLog('[MAIN] Sent MAILGUARD_EXTRACT_EMAIL to WebSocket client')
        } catch (wsErr) {
          console.log('[MAIN] WebSocket send error:', wsErr)
        }
      })
    })
    
    
    // Handle when lightbox is closed
    ipcMain.on('mailguard-lightbox-closed', () => {
      console.log('[MAIN] MailGuard lightbox closed')
      closeLightbox()
    })
    
    // Handle Email API setup request (from overlay "Connect Email Account" button)
    ipcMain.on('mailguard-api-setup', async () => {
      console.log('[MAIN] Email API setup requested')
      
      // Check if Email Gateway has connected accounts
      try {
        const { emailGateway } = await import('./main/email/gateway')
        const accounts = await emailGateway.listAccounts()
        const activeAccounts = accounts.filter(a => a.status === 'active')
        
        if (activeAccounts.length > 0) {
          // Already connected - show info and option to manage
          const accountList = activeAccounts.map((a) => {
            const label =
              a.provider === 'microsoft365'
                ? 'Microsoft 365 / Outlook'
                : a.provider === 'imap'
                  ? 'Custom email (IMAP)'
                  : a.provider
            return `• ${label}: ${a.email || a.displayName}`
          }).join('\n')
          const result = await dialog.showMessageBox({
            type: 'info',
            title: 'Email Connected',
            message: 'Email Accounts Connected',
            detail: `WR MailGuard is connected to:\n${accountList}\n\nFull email content is being fetched securely via the API. To manage accounts, open the WR Chat sidebar → Email section.`,
            buttons: ['OK', 'Manage Accounts']
          })
          
          if (result.response === 1) {
            // User wants to manage - just close dialog, they can use sidebar
            dialog.showMessageBox({
              type: 'info',
              title: 'Manage Accounts',
              message: 'Open WR Chat Sidebar',
              detail: 'To add or remove email accounts, click the WR Chat extension icon and go to the Email section.'
            })
          }
          return
        }
        
        // No accounts - show setup instructions
        dialog.showMessageBox({
          type: 'info',
          title: 'Connect Email',
          message: 'Set up Email Connection',
          detail: 'To view full email content securely:\n\n1. Click the WR Chat extension icon\n2. Go to the Email section\n3. Click "Connect Email"\n4. Choose Gmail, Microsoft 365 / Outlook, or Custom email (IMAP + SMTP)\n\nOnce connected, full email content will be fetched via the secure API.'
        })
        return
      } catch (err: any) {
        console.log('[MAIN] Email Gateway not available, falling back to legacy setup:', err.message)
      }
      
      // Fallback to legacy gmail-api setup
      const { 
        isGmailApiAuthenticated, 
        setOAuthCredentials, 
        startOAuthFlow,
        disconnectGmailApi
      } = await import('./mailguard/gmail-api')
      
      // Check current status
      const authenticated = isGmailApiAuthenticated()
      
      if (authenticated) {
        // Already connected - offer to disconnect
        const result = await dialog.showMessageBox({
          type: 'info',
          title: 'Gmail API Connected',
          message: 'Gmail API is Connected',
          detail: 'WR MailGuard is connected to your Gmail account. Full email content will be fetched securely via the API.',
          buttons: ['Disconnect', 'Keep Connected']
        })
        
        if (result.response === 0) {
          const { deleteCredentialsFromDisk } = await import('./mailguard/gmail-api')
          disconnectGmailApi()
          deleteCredentialsFromDisk()
          dialog.showMessageBox({
            type: 'info',
            title: 'Disconnected',
            message: 'Gmail API Disconnected',
            detail: 'You have been disconnected from the Gmail API. Only email previews will be shown.'
          })
        }
        return
      }
      
      // Show setup instructions
      const setupResult = await dialog.showMessageBox({
        type: 'info',
        title: 'Gmail API Setup',
        message: 'Set up Gmail API for Full Email Content',
        detail: 'To view full email content securely, you need to:\n\n1. Go to Google Cloud Console (console.cloud.google.com)\n2. Create a new project\n3. Enable the Gmail API\n4. Create OAuth 2.0 credentials (Desktop app)\n5. Enter your Client ID and Client Secret below\n\nThis is a one-time setup. Your emails will be fetched directly via API without being rendered.',
        buttons: ['Enter Credentials', 'Open Google Cloud Console', 'Cancel']
      })
      
      if (setupResult.response === 1) {
        // Open Google Cloud Console
        shell.openExternal('https://console.cloud.google.com/apis/credentials')
        return
      }
      
      if (setupResult.response === 2) {
        return
      }
      
      // Show credentials input dialog
      // ⚠️  SECURITY WARNING: This window uses nodeIntegration:true / contextIsolation:false.
      // It loads only local inline HTML (no remote content), so the immediate risk is
      // limited, but it should be migrated to a safe IPC-based dialog.
      // TODO(P1): Refactor to contextIsolation:true + IPC for credential input.
      const credWindow = new BrowserWindow({
        width: 500,
        height: 400,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
        title: 'Gmail API Credentials',
        modal: true,
        parent: BrowserWindow.getFocusedWindow() || undefined
      })
      
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              padding: 30px;
              background: #f8fafc;
            }
            h2 { color: #0f172a; margin-bottom: 8px; font-size: 20px; }
            p { color: #64748b; font-size: 13px; margin-bottom: 24px; }
            label { display: block; color: #374151; font-size: 13px; font-weight: 500; margin-bottom: 6px; }
            input { 
              width: 100%; 
              padding: 10px 12px; 
              border: 1px solid #d1d5db; 
              border-radius: 6px; 
              font-size: 14px;
              margin-bottom: 16px;
            }
            input:focus { outline: none; border-color: #3b82f6; }
            .buttons { display: flex; gap: 10px; margin-top: 10px; }
            button {
              flex: 1;
              padding: 10px 16px;
              border: none;
              border-radius: 6px;
              font-size: 14px;
              font-weight: 500;
              cursor: pointer;
            }
            .primary { background: #2563eb; color: white; }
            .primary:hover { background: #1d4ed8; }
            .secondary { background: #e5e7eb; color: #374151; }
            .secondary:hover { background: #d1d5db; }
          </style>
        </head>
        <body>
          <h2>Enter Gmail API Credentials</h2>
          <p>Enter the OAuth 2.0 credentials from your Google Cloud project.</p>
          
          <label>Client ID</label>
          <input type="text" id="clientId" placeholder="xxxxx.apps.googleusercontent.com">
          
          <label>Client Secret</label>
          <input type="password" id="clientSecret" placeholder="GOCSPX-xxxxx">
          
          <div class="buttons">
            <button class="secondary" onclick="window.close()">Cancel</button>
            <button class="primary" onclick="submitCredentials()">Connect</button>
          </div>
          
          <script>
            const { ipcRenderer } = require('electron');
            function submitCredentials() {
              const clientId = document.getElementById('clientId').value.trim();
              const clientSecret = document.getElementById('clientSecret').value.trim();
              if (clientId && clientSecret) {
                ipcRenderer.send('gmail-credentials-submit', { clientId, clientSecret });
              }
            }
          </script>
        </body>
        </html>
      `
      
      credWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      
      // Handle credentials submission
      ipcMain.once('gmail-credentials-submit', async (_e, { clientId, clientSecret }) => {
        credWindow.close()
        
        try {
          const { saveCredentialsToDisk } = await import('./mailguard/gmail-api')
          setOAuthCredentials(clientId, clientSecret)
          await startOAuthFlow()
          saveCredentialsToDisk() // Persist credentials
          
          dialog.showMessageBox({
            type: 'info',
            title: 'Success',
            message: 'Gmail API Connected!',
            detail: 'WR MailGuard is now connected to your Gmail account. Full email content will be fetched securely.'
          })
        } catch (err: any) {
          dialog.showMessageBox({
            type: 'error',
            title: 'Connection Failed',
            message: 'Could not connect to Gmail API',
            detail: err.message || 'Unknown error occurred'
          })
        }
      })
    })
  } catch {}
  // Old IPC handlers (now using simple overlay for screenshots)
  registerHandler(LmgtfyChannels.SelectScreenshot, async () => {
    // Using simple overlay now via WebSocket START_SELECTION
    return null
  })
  registerHandler(LmgtfyChannels.SelectStream, async () => {
    // Using simple overlay now via WebSocket START_SELECTION
    return null
  })
  registerHandler(LmgtfyChannels.StopStream, async () => {
    if (!activeStop || !win) return null
    const out = await activeStop()
    activeStop = null
    await postStreamToPopup(out)
    return { filePath: out }
  })
  // Execute saved trigger (headless for screenshots, visible for streams)
  registerHandler(LmgtfyChannels.CapturePreset, async (_e, payload: { mode: 'screenshot'|'stream', rect: { x:number,y:number,w:number,h:number }, displayId?: number }) => {
    if (!win) return null
    console.log('[MAIN] ===== CapturePreset CALLED =====')
    console.log('[MAIN] Payload received:', JSON.stringify(payload, null, 2))
    try {
      // If no displayId or displayId is 0 (invalid), use primary display
      const displayId = (payload.displayId && payload.displayId !== 0) ? payload.displayId : screen.getPrimaryDisplay().id
      console.log('[MAIN] Final displayId to use:', displayId)
      const sel = { displayId: displayId, x: payload.rect.x, y: payload.rect.y, w: payload.rect.w, h: payload.rect.h, dpr: 1 }
      console.log('[MAIN] Selection object:', JSON.stringify(sel, null, 2))
      
      if (payload.mode === 'screenshot') {
        // Screenshot triggers are HEADLESS - capture directly and post to command chat
        console.log('[MAIN] Executing headless screenshot trigger:', sel)
        const { filePath, thumbnailPath } = await captureScreenshot(sel as any)
        console.log('[MAIN] Screenshot captured:', filePath)
        await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
        console.log('[MAIN] Screenshot posted to popup')
        emitCapture(win, { event: LmgtfyChannels.OnCaptureEvent, mode: 'screenshot', filePath, thumbnailPath, meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr, displayId: sel.displayId } })
        return { filePath, thumbnailPath }
      } else {
        // Stream triggers are VISIBLE - show overlay and start recording
        console.log('[MAIN] Executing visible stream trigger:', sel)
        // Show visible overlay at the saved position
        showStreamTriggerOverlay(sel.displayId, { x: sel.x, y: sel.y, w: sel.w, h: sel.h })
        console.log('[MAIN] Stream overlay shown')
        // Start recording immediately
        const controller = await startRegionStream(sel as any)
        activeStop = controller.stop
        console.log('[MAIN] Stream recording started')
        return { ok: true }
      }
    } catch (err) {
      console.log('[MAIN] Error executing trigger:', err)
      return { error: String(err) }
    }
  })

  // Global hotkeys
  globalShortcut.register('Alt+Shift+S', () => win?.webContents.send('hotkey', 'screenshot'))
  globalShortcut.register('Alt+Shift+V', () => win?.webContents.send('hotkey', 'stream'))
  globalShortcut.register('Alt+0', () => win?.webContents.send('hotkey', 'stop'))

  // Process deep link passed on first launch (Windows passes in argv)
  const arg = process.argv.find(a => a.startsWith('opengiraffe://') || a.startsWith('wrcode://') || a.startsWith('wrdesk://'))
  if (arg) handleDeepLink(arg)
}

function createTray() {
  try {
    tray = new Tray(path.join(process.env.VITE_PUBLIC, 'wrdesk-logo.png'))
    updateTrayMenu()
    tray.setToolTip('WR Desk Orchestrator')

    const handleTrayActivate = async () => {
      console.log('[TRAY] Tray icon activated')
      if (hasValidSession) {
        console.log('[TRAY] Session valid - opening dashboard')
        await openDashboardWindow()
      } else {
        console.log('[TRAY] No session - triggering login flow')
        const result = await requestLogin()
        if (!result.ok) {
          console.log('[TRAY] Login cancelled or failed:', result.error)
        }
        // requestLogin() already opens dashboard on success
      }
    }

    // On Linux, tray 'click' is unreliable — popup the context menu instead.
    // On Windows/macOS, left-click opens the dashboard directly.
    if (process.platform === 'linux') {
      tray.on('click', () => tray?.popUpContextMenu())
    } else {
      tray.on('click', handleTrayActivate)
    }
    // Startup toast
    try {
      new Notification({ title: 'WR Desk Orchestrator', body: 'Running in background. Use Alt+Shift+S or chat icons to capture.' }).show()
    } catch {}
  } catch {}
}

function updateTrayMenu() {
  if (!tray) return
  try {
    const presets = loadPresets()
    const triggerMenuItems: Electron.MenuItemConstructorOptions[] = []
    
    if (presets.regions && presets.regions.length > 0) {
      presets.regions.forEach((trigger) => {
        const icon = trigger.mode === 'screenshot' ? '📸' : '🎥'
        triggerMenuItems.push({
          label: `${icon} ${trigger.name}`,
          click: async () => {
            if (!win) return
            // Execute trigger directly
            try {
              const sel = { displayId: trigger.displayId ?? 0, x: trigger.x, y: trigger.y, w: trigger.w, h: trigger.h, dpr: 1 }
              if (trigger.mode === 'screenshot') {
                console.log('[TRAY] Executing screenshot trigger:', trigger.name)
                const { filePath } = await captureScreenshot(sel as any)
                await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
              } else if (trigger.mode === 'stream') {
                console.log('[TRAY] Executing stream trigger:', trigger.name)
                // Show visible overlay at the saved position
                showStreamTriggerOverlay(sel.displayId, { x: sel.x, y: sel.y, w: sel.w, h: sel.h })
                // Start recording immediately
                const controller = await startRegionStream(sel as any)
                activeStop = controller.stop
              }
            } catch (err) {
              console.log('[TRAY] Error executing trigger:', err)
            }
          }
        })
      })
    }
    
    // Get current auto-start setting
    const loginSettings = app.getLoginItemSettings()
    
    const menu = Menu.buildFromTemplate([
      { label: hasValidSession ? 'Show Dashboard' : 'Sign In...', click: async () => { 
        if (hasValidSession) {
          console.log('[TRAY] Show Dashboard clicked - session valid')
          await openDashboardWindow()
        } else {
          console.log('[TRAY] Sign In clicked - triggering login flow')
          const result = await requestLogin()
          if (!result.ok) {
            console.log('[TRAY] Login cancelled or failed:', result.error)
          }
          // requestLogin() already opens dashboard on success
        }
      } },
      { type: 'separator' },
      { label: 'Screenshot (Alt+Shift+S)', click: () => win?.webContents.send('hotkey', 'screenshot') },
      { label: 'Stream (Alt+Shift+V)', click: () => win?.webContents.send('hotkey', 'stream') },
      { label: 'Stop Stream (Alt+0)', click: () => win?.webContents.send('hotkey', 'stop') },
      ...(triggerMenuItems.length > 0 ? [
        { type: 'separator' as const },
        { label: '📌 Saved Triggers', enabled: false },
        ...triggerMenuItems,
      ] : []),
      { type: 'separator' },
      { 
        label: '🚀 Start on Login', 
        type: 'checkbox' as const,
        checked: loginSettings.openAtLogin,
        enabled: !process.env.VITE_DEV_SERVER_URL, // Disable in dev mode
        click: async (menuItem) => {
          // Only allow changing autostart in production to prevent wrong executable registration
          if (process.env.VITE_DEV_SERVER_URL) {
            console.log('[MAIN] Cannot change autostart in dev mode')
            return
          }
          try {
            app.setLoginItemSettings({
              openAtLogin: menuItem.checked,
              args: ['--hidden'],
              name: 'WR Desk',
            })
            console.log('[MAIN] Auto-start on login:', menuItem.checked ? 'enabled' : 'disabled')

            // Keep Task Scheduler in sync with the user's preference
            if (process.platform === 'win32') {
              const { execFile } = await import('child_process')
              const { promisify } = await import('util')
              const execFileAsync = promisify(execFile)
              const taskName = 'WRDeskOrchestrator'
              if (menuItem.checked) {
                // Re-create the task if user re-enables autostart
                try {
                  await execFileAsync('schtasks', [
                    '/Create', '/F', '/TN', taskName,
                    '/TR', `"${process.execPath}" --hidden`,
                    '/SC', 'ONLOGON', '/DELAY', '0000:30', '/RL', 'LIMITED', '/IT',
                  ], { windowsHide: true })
                  console.log('[MAIN] Task Scheduler task re-created:', taskName)
                } catch (e) {
                  console.warn('[MAIN] Task Scheduler re-create failed (non-fatal):', e)
                }
              } else {
                // Delete the task when user disables autostart
                try {
                  await execFileAsync('schtasks', ['/Delete', '/F', '/TN', taskName], { windowsHide: true })
                  console.log('[MAIN] Task Scheduler task deleted:', taskName)
                } catch (e) {
                  console.warn('[MAIN] Task Scheduler delete failed (non-fatal):', e)
                }
              }
            }
          } catch (err) {
            console.error('[MAIN] Failed to update autostart setting:', err)
          }
        }
      },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' as const },
    ])
    tray.setContextMenu(menu)
  } catch (err) {
    console.log('[TRAY] Error updating menu:', err)
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
// NOTE: Single-instance lock is handled at the top of this file
// Handle second instance: focus window and handle deep-links
app.on('second-instance', (_e, argv) => {
  console.log('[MAIN] Second instance detected')
  // Only show the window if user has a valid session — otherwise stay headless
  if (hasValidSession && win && !win.isDestroyed()) {
    console.log('[MAIN] Session valid - showing existing dashboard window')
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else {
    console.log('[MAIN] No valid session or no window - staying in tray')
  }
  // Handle opengiraffe://, wrcode://, and wrdesk:// deep-links (backward compatibility)
  const arg = argv.find(a => a.startsWith('opengiraffe://') || a.startsWith('wrcode://') || a.startsWith('wrdesk://'))
  if (arg) handleDeepLink(arg)
})

// Register protocols: wrcode (primary), wrdesk (Launch WR Desk button), opengiraffe (legacy)
app.setAsDefaultProtocolClient('wrcode')
try {
  app.setAsDefaultProtocolClient('wrdesk') // Used by extension "Launch WR Desk" button
} catch (err) {
  console.log('[MAIN] Could not register wrdesk protocol (may already be registered):', err)
}
try {
  app.setAsDefaultProtocolClient('opengiraffe') // Keep old protocol for backward compatibility
} catch (err) {
  console.log('[MAIN] Could not register opengiraffe protocol (may already be registered):', err)
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.on('will-quit', async () => {
  globalShortcut.unregisterAll()
  
  // Final cleanup of OAuth server (in case before-quit didn't run)
  try {
    const { oauthServerManager } = await import('./main/email/oauth-server')
    await oauthServerManager.shutdown()
  } catch {}
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // Only open dashboard if user has a valid session
  if (BrowserWindow.getAllWindows().length === 0 && hasValidSession) {
    openDashboardWindow()
  }
})

// Setup console logging to file for debugging (before app.whenReady)
let logPath: string = ''
let logFileSetup = false
async function setupFileLogging() {
  if (logFileSetup) return
  try {
    const fs = await import('fs')
    const os = await import('os')
    logPath = path.join(os.default.homedir(), '.opengiraffe', 'electron-console.log')
    const logDir = path.dirname(logPath)
    if (!fs.default.existsSync(logDir)) {
      fs.default.mkdirSync(logDir, { recursive: true })
    }
    // Write initial marker
    fs.default.appendFileSync(logPath, `\n===== Electron Console Log Started: ${new Date().toISOString()} =====\n`)
    
    // Redirect console.log and console.error to both console and file
    // Note: We wrap originalLog/originalError in try-catch to prevent EPIPE crashes
    // when stdout/stderr pipes are broken (e.g. when launched from a background terminal)
    const originalLog = console.log
    const originalError = console.error
    console.log = (...args: any[]) => {
      try { originalLog(...args) } catch (_) { /* ignore EPIPE */ }
      try {
        const logLine = `[${new Date().toISOString()}] ${args.map((a: any) => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
        fs.default.appendFileSync(logPath, logLine)
      } catch (_) { /* ignore log write errors */ }
    }
    console.error = (...args: any[]) => {
      try { originalError(...args) } catch (_) { /* ignore EPIPE */ }
      try {
        const logLine = `[${new Date().toISOString()}] ERROR: ${args.map((a: any) => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
        fs.default.appendFileSync(logPath, logLine)
      } catch (_) { /* ignore log write errors */ }
    }
    logFileSetup = true
    console.log('[MAIN] Console logging to file:', logPath)
  } catch (err) {
    console.error('[MAIN] Failed to setup file logging:', err)
  }
}

// Fix Windows cache permission errors by setting a custom user data directory
const customUserDataPath = path.join(os.homedir(), '.opengiraffe', 'electron-data')
app.setPath('userData', customUserDataPath)
// Disable GPU to prevent crashes on some Windows systems
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('no-sandbox')

// Add crash handlers
process.on('uncaughtException', (error: any) => {
  // Silently ignore EPIPE errors (broken stdout/stderr pipe from background terminal)
  if (error?.code === 'EPIPE') return
  console.error('[MAIN] Uncaught exception:', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] Unhandled rejection:', reason)
})

// Prevent app from quitting when all windows are closed
app.on('window-all-closed', () => {
  console.log('[MAIN] All windows closed, but keeping app running')
  // Don't quit - keep the app and WebSocket server running
})

console.log('[MAIN] About to call app.whenReady()')

// ============================================================================
// Cross-platform DBeaver helpers
// ============================================================================

/**
 * Returns the platform-appropriate DBeaver data directory.
 * - Windows: %APPDATA%\DBeaverData  (e.g. C:\Users\<user>\AppData\Roaming\DBeaverData)
 * - macOS:   ~/Library/DBeaverData
 * - Linux:   ~/.local/share/DBeaverData
 */
function getDbeaverDataPath(os: any, pathMod: any): string {
  if (process.platform === 'win32') {
    return process.env.APPDATA || pathMod.join(os.homedir(), 'AppData', 'Roaming')
  }
  if (process.platform === 'darwin') {
    return pathMod.join(os.homedir(), 'Library', 'DBeaverData')
  }
  // Linux / XDG
  return pathMod.join(process.env.XDG_DATA_HOME || pathMod.join(os.homedir(), '.local', 'share'), 'DBeaverData')
}

/**
 * Launches DBeaver in a cross-platform way.
 * - Windows: checks common .exe install paths, falls back to `start dbeaver`
 * - macOS:   `open -a DBeaver`
 * - Linux:   tries `dbeaver` in PATH
 * Returns { ok, message, path? }
 */
async function launchDBeaver(
  spawn: any,
  exec: any,
  pathMod: any,
  fs: any
): Promise<{ ok: boolean; message: string; path?: string }> {
  if (process.platform === 'win32') {
    const candidates = [
      pathMod.join(process.env.LOCALAPPDATA || '', 'DBeaver', 'dbeaver.exe'),
      'C:\\Program Files\\DBeaver\\dbeaver.exe',
      'C:\\Program Files (x86)\\DBeaver\\dbeaver.exe',
      pathMod.join(process.env.LOCALAPPDATA || '', 'Programs', 'dbeaver-ce', 'dbeaver.exe'),
      pathMod.join(process.env.APPDATA || '', 'DBeaver', 'dbeaver.exe'),
    ]
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          spawn(p, [], { detached: true, stdio: 'ignore' })
          console.log('[MAIN] Launched DBeaver:', p)
          return { ok: true, message: 'DBeaver launched', path: p }
        }
      } catch {}
    }
    // Fallback: Windows Start menu shortcut
    return new Promise(resolve => {
      exec('start "" dbeaver', { shell: true }, (err: any) => {
        if (err) {
          resolve({ ok: false, message: 'DBeaver not found. Please install it from https://dbeaver.io' })
        } else {
          resolve({ ok: true, message: 'DBeaver launched via Start menu' })
        }
      })
    })
  }

  if (process.platform === 'darwin') {
    return new Promise(resolve => {
      exec('open -a DBeaver', (err: any) => {
        if (err) {
          resolve({ ok: false, message: 'DBeaver not found. Install it from https://dbeaver.io' })
        } else {
          resolve({ ok: true, message: 'DBeaver launched' })
        }
      })
    })
  }

  // Linux
  return new Promise(resolve => {
    exec('which dbeaver', (err: any, stdout: string) => {
      const dbeaverBin = stdout?.trim()
      if (!err && dbeaverBin) {
        spawn(dbeaverBin, [], { detached: true, stdio: 'ignore' })
        resolve({ ok: true, message: 'DBeaver launched', path: dbeaverBin })
      } else {
        // Try common Linux install paths
        const linuxPaths = [
          '/usr/share/dbeaver-ce/dbeaver',
          '/opt/dbeaver/dbeaver',
          '/usr/local/bin/dbeaver',
        ]
        const found = linuxPaths.find(p => { try { return require('fs').existsSync(p) } catch { return false } })
        if (found) {
          spawn(found, [], { detached: true, stdio: 'ignore' })
          resolve({ ok: true, message: 'DBeaver launched', path: found })
        } else {
          resolve({ ok: false, message: 'DBeaver not found. Install it from https://dbeaver.io' })
        }
      }
    })
  })
}

app.whenReady().then(async () => {
  console.log('[MAIN] ===== APP READY =====')
  try {
    // ========== STRUCTURED BOOT LOG ==========
    // Written to ~/.opengiraffe/logs/main.log so we can diagnose startup
    // issues in packaged builds where console output is not visible.
    const bootInfo = {
      ts: new Date().toISOString(),
      version: app.getVersion(),
      argv: process.argv,
      startHidden,
      isPackaged: app.isPackaged,
      execPath: process.execPath,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      pid: process.pid,
    }
    console.log('[BOOT] Boot info:', JSON.stringify(bootInfo))
    if (process.env.DEBUG_EMAIL_SECURE_STORAGE === '1') {
      try {
        const { logSecureStorageProbe } = await import('./main/email/secure-storage')
        logSecureStorageProbe('app.whenReady')
      } catch (e: any) {
        console.warn('[SecureStorage] DEBUG probe failed:', e?.message)
      }
    }
    try {
      const fs = await import('fs')
      const bootLogDir = path.join(os.homedir(), '.opengiraffe', 'logs')
      if (!fs.existsSync(bootLogDir)) fs.mkdirSync(bootLogDir, { recursive: true })
      const bootLogPath = path.join(bootLogDir, 'main.log')
      fs.appendFileSync(bootLogPath, JSON.stringify(bootInfo) + '\n')
      console.log('[BOOT] Boot info written to', bootLogPath)
    } catch {}

    // Register Electron's shell.openExternal as the URL opener for SSO login
    // This is more reliable than the 'open' npm package in Electron context
    setUrlOpener((url: string) => shell.openExternal(url))

    // Setup console logging to file for debugging
    await setupFileLogging()

    // ========== BUILD INTEGRITY CHECK (startup) ==========
    // Run offline verification and log the result. If verification fails,
    // the /api/integrity endpoint will report it, and the extension can
    // react by enabling the writes kill-switch (defense-in-depth).
    try {
      const { verifyBuildIntegrity } = await import('./main/integrity/verifier')
      const integrityStatus = verifyBuildIntegrity()
      if (integrityStatus.verified) {
        console.log(`[INTEGRITY] Build verified: ${integrityStatus.summary}`)
      } else {
        console.warn(`[INTEGRITY] ⚠ BUILD NOT VERIFIED: ${integrityStatus.summary}`)
        for (const check of integrityStatus.checks) {
          if (check.status === 'fail') {
            console.warn(`[INTEGRITY]   FAIL: ${check.name} — ${check.detail}`)
          }
        }
      }
    } catch (err: any) {
      console.warn('[INTEGRITY] Verification module error:', err.message)
    }

    // ========== GMAIL OAUTH (built-in client id) ==========
    try {
      const {
        isBuiltinGmailOAuthConfigured,
        isEmailDeveloperModeEnabled,
        getPackagedResourceGoogleOAuthClientId,
        oauthClientIdFingerprint,
        resolveBuiltinGoogleOAuthClientWithMeta,
        resolveBuiltinGoogleOAuthClientSecret,
        getGoogleOauthClientIdEnvVarNamesPresent,
        getGoogleOauthClientSecretEnvVarNamesPresent,
        getGmailOAuthPackagedStartupDiagnostics,
        logOAuthDiagnostic,
        warnOnceIfBuiltinGmailOAuthClientSecretMissingOrPlaceholder,
      } = await import('./main/email/googleOAuthBuiltin')
      warnOnceIfBuiltinGmailOAuthClientSecretMissingOrPlaceholder()
      if (app.isPackaged) {
        logOAuthDiagnostic('gmail_oauth_packaged_startup_diagnostics', {
          startupDiagnostics: getGmailOAuthPackagedStartupDiagnostics(),
        })
      }
      if (app.isPackaged && !isBuiltinGmailOAuthConfigured()) {
        console.error(
          '[GMAIL-OAUTH] Packaged build has no valid built-in Google OAuth client id. End-user Gmail sign-in will not work until the installer is built with GOOGLE_OAUTH_CLIENT_ID or a non-placeholder resources/google-oauth-client-id.txt (and matching Desktop client secret in resources/google-oauth-client-secret.txt or build env).',
        )
      } else if (!isBuiltinGmailOAuthConfigured() && isEmailDeveloperModeEnabled()) {
        console.warn(
          '[GMAIL-OAUTH] No valid built-in client id — for local dev set GOOGLE_OAUTH_CLIENT_ID or replace apps/electron-vite-project/resources/google-oauth-client-id.txt',
        )
      } else if (app.isPackaged && isBuiltinGmailOAuthConfigured()) {
        const packagedProdStandard = app.isPackaged && !isEmailDeveloperModeEnabled()
        const res = resolveBuiltinGoogleOAuthClientWithMeta(
          packagedProdStandard ? { forStandardGmailConnect: true } : undefined,
        )
        const shipped = getPackagedResourceGoogleOAuthClientId()
        logOAuthDiagnostic('gmail_oauth_startup_packaged', {
          builtinSourceKind: res?.sourceKind,
          builtinSourceName: res?.sourceName,
          clientId: res?.clientId,
          packagedResourceFingerprint: shipped ? oauthClientIdFingerprint(shipped) : '(none)',
          googleOauthEnvVarsPresent: getGoogleOauthClientIdEnvVarNamesPresent(),
          googleOauthClientSecretEnvVarsPresent: getGoogleOauthClientSecretEnvVarNamesPresent(),
          hasBuiltinDesktopClientSecret: res ? !!resolveBuiltinGoogleOAuthClientSecret(res) : false,
          packagedStandardConnectResourcePrecedenceEnforced: packagedProdStandard,
        })
      }
    } catch (e: any) {
      console.warn('[GMAIL-OAUTH] Startup check failed:', e?.message)
    }

    // ========== AUTH TEST IPC ==========
    // Manual trigger for Keycloak login test (no auto-start)
    ipcMain.handle('auth:test-login', async () => {
      await testLoginOnce()
      return { success: true }
    })
    console.log('[MAIN] Auth test IPC handler registered (auth:test-login)')
    
    // ========== AUTH-GATED IPC HANDLERS ==========
    // Request login - triggers SSO flow, opens dashboard on success
    ipcMain.handle('auth:request-login', async () => {
      console.log('[IPC] auth:request-login called')
      return await requestLogin()
    })
    console.log('[MAIN] IPC handler registered: auth:request-login')
    
    // Open dashboard window explicitly
    ipcMain.handle('dashboard:open', async () => {
      console.log('[IPC] dashboard:open called')
      await openDashboardWindow()
      return { ok: true }
    })
    console.log('[MAIN] IPC handler registered: dashboard:open')
    
    // Get build integrity status (offline verification)
    ipcMain.handle('integrity:status', async () => {
      try {
        const { verifyBuildIntegrity } = await import('./main/integrity/verifier')
        return verifyBuildIntegrity()
      } catch (err: any) {
        return {
          verified: false,
          timestamp: Date.now(),
          checks: [{ name: 'runtime', status: 'fail', detail: 'Verifier module error' }],
          summary: 'Unverified: internal error',
        }
      }
    })
    console.log('[MAIN] IPC handler registered: integrity:status')

    // ========== HANDSHAKE VIEW IPC HANDLERS (Dashboard) ==========
    /**
     * Returns the best available DB for handshake operations:
     * 1. Ledger DB (already open) — preferred, vault-independent
     * 2. Ledger DB opened on-demand using current SSO session
     * 3. Vault DB fallback
     * Returns null only if no session and no vault.
     */
    async function getHandshakeDb(): Promise<any> {
      let db = getLedgerDb()
      if (!db) {
        try {
          const userInfo = getCachedUserInfo()
          if (userInfo?.sub && userInfo?.iss) {
            const tok = buildLedgerSessionToken(userInfo.wrdesk_user_id || userInfo.sub, userInfo.iss)
            db = await openLedger(tok)
          }
        } catch { /* non-fatal — fall through to vault */ }
      }
      if (!db) {
        const vs = (globalThis as any).__og_vault_service_ref
        db = vs?.getDb?.() ?? vs?.db ?? null
      }
      return db
    }

    /**
     * Ledger-only DB access — no vault fallback.
     * Use for operations that must work without vault unlock: import, list, receive.
     */
    async function getLedgerDbOrOpen(): Promise<any> {
      let db = getLedgerDb()
      if (!db) {
        try {
          const userInfo = getCachedUserInfo()
          if (userInfo?.sub && userInfo?.iss) {
            const tok = buildLedgerSessionToken(userInfo.wrdesk_user_id || userInfo.sub, userInfo.iss)
            db = await openLedger(tok)
          }
        } catch { /* non-fatal */ }
      }
      return db ?? null
    }

    ipcMain.handle('handshake:list', async (_e, filter: any) => {
      try {
        // List uses Ledger only — no vault needed (handshake metadata always in Ledger)
        const db = await getLedgerDbOrOpen()
        if (!db) return []
        const result = await handleHandshakeRPC('handshake.list', { filter }, db)
        return result.records ?? []
      } catch (err: any) {
        console.error('[MAIN] handshake:list error:', err?.message)
        return []
      }
    })

    ipcMain.handle(
      'handshake:sendBeapViaP2P',
      async (_e, payload: { handshakeId: string; packageJson: string; sendSource?: string }) => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { success: false, error: 'Database unavailable' }
        return await handleHandshakeRPC('handshake.sendBeapViaP2P', payload, db)
      } catch (err: any) {
        console.error('[MAIN] handshake:sendBeapViaP2P error:', err?.message)
        return { success: false, error: err?.message ?? 'Send failed' }
      }
    })

    ipcMain.handle('handshake:checkSendReady', async (_e, payload: { handshakeId: string }) => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { ready: false, error: 'Database unavailable' }
        return await handleHandshakeRPC('handshake.checkSendReady', payload, db)
      } catch (err: any) {
        console.error('[MAIN] handshake:checkSendReady error:', err?.message)
        return { ready: false, error: err?.message ?? 'Check failed' }
      }
    })

    ipcMain.handle('outbox:insertSent', async (_e, record: unknown) => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { success: false, error: 'Database unavailable' }
        if (!record || typeof record !== 'object') return { success: false, error: 'Invalid record' }
        const r = record as Record<string, unknown>
        const id = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 128 ? r.id : null
        if (!id) return { success: false, error: 'id required' }
        const deliveryMethod = typeof r.deliveryMethod === 'string' && r.deliveryMethod.length > 0 ? r.deliveryMethod : null
        const deliveryStatus = typeof r.deliveryStatus === 'string' && r.deliveryStatus.length > 0 ? r.deliveryStatus : 'sent'
        if (!deliveryMethod) return { success: false, error: 'deliveryMethod required' }
        const hasEnc = r.hasEncryptedInner === true ? 1 : 0
        db.prepare(
          `INSERT INTO sent_beap_outbox
           (id, created_at, handshake_id, counterparty_display, subject,
            public_body_preview, encrypted_body_preview, has_encrypted_inner,
            delivery_method, delivery_status, delivery_detail_json,
            attachment_summary_json, package_content_hash, outbound_queue_row_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          new Date().toISOString(),
          typeof r.handshakeId === 'string' ? r.handshakeId : null,
          typeof r.counterpartyDisplay === 'string' ? r.counterpartyDisplay.slice(0, 500) : null,
          typeof r.subject === 'string' ? r.subject.slice(0, 500) : 'BEAP™ Message',
          typeof r.publicBodyPreview === 'string' ? r.publicBodyPreview.slice(0, 500) : null,
          typeof r.encryptedBodyPreview === 'string' ? r.encryptedBodyPreview.slice(0, 500) : null,
          hasEnc,
          deliveryMethod,
          deliveryStatus,
          typeof r.deliveryDetailJson === 'string' ? r.deliveryDetailJson.slice(0, 16000) : null,
          typeof r.attachmentSummaryJson === 'string' ? r.attachmentSummaryJson.slice(0, 8000) : null,
          typeof r.packageContentHash === 'string' ? r.packageContentHash.slice(0, 128) : null,
          typeof r.outboundQueueRowId === 'number' && Number.isInteger(r.outboundQueueRowId) ? r.outboundQueueRowId : null,
        )
        return { success: true }
      } catch (e: any) {
        console.error('[Outbox] insertSent failed:', e)
        return { success: false, error: e?.message ?? 'Insert failed' }
      }
    })

    ipcMain.handle('outbox:listSent', async (_e, opts: unknown) => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { success: false, messages: [] as unknown[], error: 'Database unavailable' }
        const o = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : {}
        const limit = typeof o.limit === 'number' && o.limit > 0 && o.limit <= 200 ? Math.floor(o.limit) : 50
        const offset = typeof o.offset === 'number' && o.offset >= 0 ? Math.floor(o.offset) : 0
        const rows = db
          .prepare(
            `SELECT * FROM sent_beap_outbox ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
          )
          .all(limit, offset) as Record<string, unknown>[]
        return { success: true, messages: rows }
      } catch (e: any) {
        console.error('[Outbox] listSent failed:', e)
        return { success: false, messages: [] as unknown[], error: e?.message ?? 'List failed' }
      }
    })

    /**
     * PQ HTTP auth for localhost orchestrator (e.g. POST /api/crypto/pq/mlkem768/encapsulate).
     * Extension gets X-Launch-Secret via WebSocket; Electron renderer gets it only through this IPC + preload.
     */
    ipcMain.handle('crypto:getPqHeaders', async () => {
      return { 'X-Launch-Secret': launchSecretHex() }
    })

    /** Relay-only: forward pre-built package JSON to P2P pipeline (build happens in renderer via BeapPackageBuilder). */
    ipcMain.handle('beap:sendCapsuleReply', async (_e, payload: unknown) => {
      try {
        if (!payload || typeof payload !== 'object') {
          return { success: false, error: 'Invalid payload' }
        }
        const p = payload as Record<string, unknown>
        if (typeof p.handshakeId === 'string' && typeof p.packageJson === 'string' && p.packageJson.length > 0) {
          const db = await getLedgerDbOrOpen()
          if (!db) return { success: false, error: 'Database unavailable' }
          return await handleHandshakeRPC(
            'handshake.sendBeapViaP2P',
            {
              handshakeId: p.handshakeId,
              packageJson: p.packageJson,
              sendSource: 'user_package_builder',
            },
            db,
          )
        }
        return {
          success: false,
          error:
            'Use “Send BEAP Reply” in the inbox panel to build and send from draft fields, or pass { handshakeId, packageJson } after building in the renderer.',
        }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'Send failed' }
      }
    })

    ipcMain.handle('handshake:submitCapsule', async (_e, jsonString: string) => {
      try {
        // Get the SSO session — try refreshing first if not available
        let ssoSession = getCurrentSession()
        console.log('[SUBMIT-CAPSULE] getCurrentSession():', ssoSession ? `ok (user=${ssoSession.email})` : 'null')
        if (!ssoSession) {
          // Try to refresh the session from stored refresh token
          try {
            const refreshed = await ensureSession()
            console.log('[SUBMIT-CAPSULE] ensureSession() result: accessToken=', !!refreshed.accessToken, 'userInfo=', !!refreshed.userInfo)
            if (refreshed.accessToken) {
              // Re-register session info so getCurrentSession() works
              const userInfo = getCachedUserInfo()
              console.log('[SUBMIT-CAPSULE] getCachedUserInfo() after refresh:', userInfo ? `sub=${userInfo.sub}, email=${userInfo.email}` : 'null')
              if (userInfo?.sub && userInfo?.email && userInfo?.iss) {
                ssoSession = sessionFromClaims({
                  wrdesk_user_id: userInfo.wrdesk_user_id || userInfo.sub,
                  email: userInfo.email,
                  iss: userInfo.iss,
                  sub: userInfo.sub!,
                  plan: (userInfo.wrdesk_plan as any) || 'free',
                  canonical_tier: userInfo.canonical_tier as any,
                  session_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                })
                console.log('[SUBMIT-CAPSULE] ssoSession built from refresh:', !!ssoSession)
              }
            }
          } catch (refreshErr) {
            console.warn('[MAIN] handshake:submitCapsule — session refresh failed:', refreshErr)
          }
        }
        console.log('[SUBMIT-CAPSULE] Final ssoSession:', ssoSession ? `ok` : 'null — returning auth error')
        if (!ssoSession) return { success: false, error: 'No active session. Please log in first.' }

        // Open the ledger lazily if it isn't open yet (e.g. startup race condition)
        let db = getLedgerDb()
        console.log('[SUBMIT-CAPSULE] getLedgerDb():', db ? 'ok' : 'null')
        if (!db) {
          try {
            const userInfo = getCachedUserInfo()
            if (userInfo?.sub && userInfo?.iss) {
              const ledgerToken = buildLedgerSessionToken(userInfo.wrdesk_user_id || userInfo.sub, userInfo.iss)
              db = await openLedger(ledgerToken)
              console.log('[SUBMIT-CAPSULE] lazy openLedger():', db ? 'ok' : 'failed')
            }
          } catch (ledgerErr: any) {
            console.warn('[MAIN] handshake:submitCapsule — lazy ledger open failed:', ledgerErr?.message)
          }
        }

        // Fallback to vault DB if ledger still unavailable
        if (!db) {
          const vs = (globalThis as any).__og_vault_service_ref
          db = vs?.getDb?.() ?? vs?.db ?? null
          console.log('[SUBMIT-CAPSULE] vault DB fallback:', db ? 'ok' : 'null')
        }

        if (!db) return { success: false, error: 'Database unavailable. Handshake ledger could not be opened.' }

        return await handleIngestionRPC('ingestion.ingest', {
          rawInput: { body: jsonString, mime_type: 'application/vnd.beap+json', headers: { 'content-type': 'application/vnd.beap+json' } },
          sourceType: 'file_upload',
          transportMeta: { mime_type: 'application/vnd.beap+json' },
        }, db, ssoSession)
      } catch (err: any) {
        console.error('[MAIN] handshake:submitCapsule error:', err?.message)
        return { success: false, error: err?.message }
      }
    })

    ipcMain.handle('handshake:importCapsule', async (_e, capsuleJson: string) => {
      try {
        console.log('[IMPORT] Handler called, capsuleJson length=', capsuleJson?.length ?? 0)
        // Import uses Ledger only — no vault needed (parse, validate, persist PENDING_ACCEPT)
        const db = await getLedgerDbOrOpen()
        if (!db) {
          console.warn('[IMPORT] No DB — user not logged in')
          return { success: false, error: 'Please log in first to import handshake capsules.', reason: 'NOT_LOGGED_IN' }
        }
        const result = await handleHandshakeRPC('handshake.importCapsule', { capsuleJson }, db)
        if (result?.success) {
          console.log('[IMPORT] Record created: PENDING_REVIEW, handshake_id=', result?.handshake_id)
        }
        return result
      } catch (err: any) {
        const errMsg = err?.message ?? String(err)
        const errStack = err?.stack ?? ''
        console.error('[IMPORT] Error:', errMsg, errStack)
        // Write to file for diagnostics when console isn't available
        try {
          const fs = require('fs')
          const path = require('path')
          const logDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.opengiraffe')
          const logFile = path.join(logDir, 'import-error.log')
          fs.mkdirSync(logDir, { recursive: true })
          fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${errMsg}\n${errStack}\n\n`)
        } catch (_) { /* ignore */ }
        return { success: false, error: errMsg, reason: 'INTERNAL_ERROR' }
      }
    })

    ipcMain.handle('handshake:accept', async (_e, id: string, sharingMode: string, fromAccountId: string, contextOpts?: { context_blocks?: any[]; profile_ids?: string[]; profile_items?: any[]; policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean } }) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session. Please log in first.' }
        // Accept requires vault unlock (signing key). If vault exists and is locked, prompt user.
        try {
          const { vaultService } = await import('./main/vault/rpc')
          const status = vaultService.getStatus()
          if (status.exists && status.locked) {
            return {
              success: false,
              reason: 'VAULT_LOCKED',
              error: 'Please unlock your vault to accept this handshake. Your signing key is needed to create a secure connection.',
              action: 'UNLOCK_VAULT',
            }
          }
        } catch { /* vault not initialized — allow (keys in ledger) */ }
        const params: Record<string, unknown> = { handshake_id: id, sharing_mode: sharingMode, fromAccountId }
        if (contextOpts?.context_blocks?.length) params.context_blocks = contextOpts.context_blocks
        if (contextOpts?.profile_ids?.length) params.profile_ids = contextOpts.profile_ids
        if (contextOpts?.profile_items?.length) params.profile_items = contextOpts.profile_items
        if (contextOpts?.policy_selections) params.policy_selections = contextOpts.policy_selections
        const result = await handleHandshakeRPC('handshake.accept', params, db)
        if (!result?.success) {
          console.error('[HANDSHAKE:ACCEPT] failed:', JSON.stringify(result))
        }
        return result
      } catch (err: any) {
        console.error('[HANDSHAKE:ACCEPT] exception:', err?.message, err)
        return { success: false, error: err?.message }
      }
    })

    ipcMain.handle('handshake:decline', async (_e, id: string) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session. Please log in first.' }
        return await handleHandshakeRPC('handshake.initiateRevocation', { handshakeId: id }, db)
      } catch (err: any) {
        return { success: false, error: err?.message }
      }
    })

    ipcMain.handle('handshake:delete', async (_e, id: string) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session. Please log in first.' }
        return await handleHandshakeRPC('handshake.delete', { handshakeId: id }, db)
      } catch (err: any) {
        return { success: false, error: err?.message }
      }
    })

    ipcMain.handle('handshake:getPendingP2PBeapMessages', async () => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { items: [] }
        const result = await handleHandshakeRPC('handshake.getPendingP2PBeapMessages', {}, db)
        return { items: result?.items ?? [] }
      } catch {
        return { items: [] }
      }
    })

    ipcMain.handle('handshake:ackPendingP2PBeap', async (_e, id: number) => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { success: false }
        return await handleHandshakeRPC('handshake.ackPendingP2PBeap', { id }, db)
      } catch {
        return { success: false }
      }
    })

    ipcMain.handle('handshake:getPendingPlainEmails', async () => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { items: [] }
        const result = await handleHandshakeRPC('handshake.getPendingPlainEmails', {}, db)
        return { items: result?.items ?? [] }
      } catch {
        return { items: [] }
      }
    })

    ipcMain.handle('handshake:ackPendingPlainEmail', async (_e, id: number) => {
      try {
        const db = await getLedgerDbOrOpen()
        if (!db) return { success: false }
        return await handleHandshakeRPC('handshake.ackPendingPlainEmail', { id }, db)
      } catch {
        return { success: false }
      }
    })

    ipcMain.handle('handshake:importBeapMessage', async (_e, packageJson: string) => {
      try {
        if (typeof packageJson !== 'string' || packageJson.length === 0 || packageJson.length > 512 * 1024) {
          return { success: false, error: 'Invalid package: expected non-empty string (max 512KB)' }
        }
        const db = await getLedgerDbOrOpen()
        if (!db) return { success: false, error: 'Database unavailable. Please log in first.' }
        const { insertPendingP2PBeap } = await import('./main/handshake/db')
        insertPendingP2PBeap(db, '__file_import__', packageJson)
        return { success: true }
      } catch (err: any) {
        console.error('[BEAP:IMPORT]', err?.message)
        return { success: false, error: err?.message ?? 'Import failed' }
      }
    })

    // Force-revoke: bypasses state checks and directly marks the record REVOKED locally,
    // then delivers a signed revoke capsule to the counterparty best-effort.
    ipcMain.handle('handshake:forceRevoke', async (_e, id: string) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session. Please log in first.' }
        console.log('[HANDSHAKE:FORCE_REVOKE] attempting revoke for id:', id)
        const { revokeHandshake } = await import('./main/handshake/revocation')
        // Check if record exists first
        const { getHandshakeRecord } = await import('./main/handshake/db')
        const record = getHandshakeRecord(db, id)
        console.log('[HANDSHAKE:FORCE_REVOKE] record found:', record ? `state=${record.state}` : 'null')
        if (!record) return { success: false, error: `Handshake ${id} not found in database` }
        const session = getCurrentSession()
        await revokeHandshake(db, id, 'local-user', session?.wrdesk_user_id, session ?? undefined, async () => getAccessToken() ?? null)
        console.log('[HANDSHAKE:FORCE_REVOKE] revoke completed for id:', id)
        return { success: true }
      } catch (err: any) {
        console.error('[HANDSHAKE:FORCE_REVOKE] error:', err?.message, err?.stack)
        return { success: false, error: err?.message }
      }
    })

    ipcMain.handle('handshake:contextBlockCount', async (_e, handshakeId: string) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return 0
        const result = await handleHandshakeRPC('handshake.requestContextBlocks', { handshakeId, scopes: [] }, db)
        return result?.blocks?.length ?? 0
      } catch {
        return 0
      }
    })
    ipcMain.handle('handshake:queryContextBlocks', async (_e, handshakeId: string, purpose?: string) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return []
        const result = await handleHandshakeRPC('handshake.requestContextBlocks', { handshakeId, scopes: [], purpose }, db)
        return result?.blocks ?? []
      } catch {
        return []
      }
    })
    ipcMain.handle('handshake:semanticSearch', async (_e, query: string, scope?: string, limit?: number) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'vault_locked' }
        return await handleHandshakeRPC('handshake.semanticSearch', { query, scope, limit }, db)
      } catch (err: any) {
        console.error('[MAIN] handshake:semanticSearch error:', err?.message)
        return { success: false, error: err?.message ?? 'search_failed' }
      }
    })

    ipcMain.handle('handshake:getAvailableModels', async () => {
      try {
        const localModels: Array<{ id: string; name: string; provider: string; type: 'local' }> = []
        const cloudModels: Array<{ id: string; name: string; provider: string; type: 'cloud' }> = []

        // 1. Fetch local models from Ollama (use OllamaManager — same path as Backend Config)
        try {
          const { ollamaManager } = await import('./main/llm/ollama-manager')
          const installed = await ollamaManager.listModels()
          for (const m of installed) {
            const name = m?.name?.trim?.() || ''
            if (!name) continue
            localModels.push({
              id: name,
              name,
              provider: 'ollama',
              type: 'local',
            })
          }
        } catch (err: any) {
          console.warn('[MAIN] handshake:getAvailableModels Ollama:', err?.message ?? err)
        }

        // 2. Cloud models from OCR router (API keys set via POST /api/ocr/config or ocr:setCloudConfig)
        const { ocrRouter } = await import('./main/ocr/router')
        const providers = ocrRouter.getAvailableProviders()
        const CLOUD_MODEL_MAP: Record<string, { id: string; name: string; provider: string }> = {
          OpenAI: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
          Claude: { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' },
          Gemini: { id: 'gemini-pro', name: 'Gemini Pro', provider: 'google' },
          Grok: { id: 'grok-1', name: 'Grok', provider: 'xai' },
        }
        for (const p of providers) {
          const entry = CLOUD_MODEL_MAP[p]
          if (entry) {
            cloudModels.push({ ...entry, type: 'cloud' })
          }
        }

        // 3. Fallback: orchestrator (optimando-api-keys — same key as extension localStorage)
        if (cloudModels.length === 0) {
          try {
            const { getOrchestratorService } = await import('./main/orchestrator-db/service')
            const service = getOrchestratorService()
            const keys = await service.get<Record<string, string>>('optimando-api-keys')
            if (keys && typeof keys === 'object') {
              const PROVIDER_ORDER = ['OpenAI', 'Claude', 'Gemini', 'Grok'] as const
              for (const p of PROVIDER_ORDER) {
                const val = keys[p]
                if (val && typeof val === 'string' && val.trim()) {
                  const entry = CLOUD_MODEL_MAP[p]
                  if (entry) {
                    cloudModels.push({ ...entry, type: 'cloud' })
                  }
                }
              }
            }
          } catch {
            // Orchestrator not available or key not found
          }
        }

        return {
          success: true,
          models: [...localModels, ...cloudModels],
        }
      } catch (err: any) {
        console.error('[MAIN] handshake:getAvailableModels error:', err?.message)
        return { success: false, error: err?.message ?? 'failed', models: [] }
      }
    })

    /** Policy / auto-run hook point after BEAP session import (orchestrator DB). Intentionally empty until policy work ships. */
    function beapSessionImportPolicyHook(_ctx: {
      importedSessionId: string
      sourceSessionId: string
      sourceMessageId: string
      handshakeId: string | null
    }): void {
      void _ctx
    }

    /** Same as POST /api/orchestrator/connect — renderer must use IPC (avoids CORS from Vite dev origin). */
    ipcMain.handle('orchestrator:connect', async () => {
      try {
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.connect()
        const status = service.getStatus()
        return { success: true, data: status }
      } catch (err: any) {
        console.error('[MAIN] orchestrator:connect', err?.message ?? err)
        return { success: false, error: err?.message ?? 'CONNECT_FAILED' }
      }
    })

    ipcMain.handle('orchestrator:listSessions', async () => {
      try {
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const sessions = await service.listSessions()
        return { success: true, data: sessions }
      } catch (err: any) {
        console.error('[MAIN] orchestrator:listSessions', err?.message ?? err)
        return { success: false, error: err?.message ?? 'LIST_FAILED', data: [] }
      }
    })

    ipcMain.handle('orchestrator:importSessionFromBeap', async (_e, payload: unknown) => {
      try {
        if (!payload || typeof payload !== 'object') {
          return { success: false, error: 'INVALID_PAYLOAD' }
        }
        const p = payload as Record<string, unknown>
        const sessionIdRaw = p.sessionId
        const sessionId = typeof sessionIdRaw === 'string' ? sessionIdRaw.trim() : String(sessionIdRaw ?? '').trim()
        const sessionNameRaw = p.sessionName
        const sessionName =
          typeof sessionNameRaw === 'string' && sessionNameRaw.trim()
            ? sessionNameRaw.trim().slice(0, 500)
            : sessionId || 'Imported session'
        const sourceMessageId =
          typeof p.sourceMessageId === 'string' ? p.sourceMessageId.trim() : String(p.sourceMessageId ?? '').trim()
        if (!sessionId || !sourceMessageId) {
          return { success: false, error: 'MISSING_FIELDS' }
        }
        const config =
          p.config && typeof p.config === 'object' && p.config !== null
            ? (p.config as Record<string, unknown>)
            : {}
        const handshakeId =
          p.handshakeId === null || p.handshakeId === undefined
            ? null
            : String(p.handshakeId)
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const orchestratorService = getOrchestratorService()
        const now = Date.now()
        const importedId = `beap-import-${sessionId}-${now}`
        await orchestratorService.saveSession({
          id: importedId,
          name: sessionName,
          config: {
            ...config,
            importedFrom: 'beap-message',
            sourceMessageId,
            handshakeId,
            importedAt: now,
            beapSourceSessionId: sessionId,
          },
          created_at: now,
          updated_at: now,
          tags: ['beap-import'],
        })
        beapSessionImportPolicyHook({
          importedSessionId: importedId,
          sourceSessionId: sessionId,
          sourceMessageId,
          handshakeId,
        })
        return { success: true, sessionId: importedId }
      } catch (err: any) {
        console.error('[MAIN] orchestrator:importSessionFromBeap', err?.message ?? err)
        return { success: false, error: err?.message ?? 'IMPORT_FAILED' }
      }
    })

    /** Generate a draft reply via LLM (no RAG). Used by BEAP "Draft with AI". */
    ipcMain.handle('handshake:generateDraft', async (_e, prompt: string) => {
      try {
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const modelId = await ollamaManager.getEffectiveChatModelName()
        if (!modelId) {
          return { success: false, error: 'No LLM model installed. Install a model in LLM Settings first.' }
        }
        const response = await ollamaManager.chat(modelId, [{ role: 'user', content: prompt || '' }])
        return { success: true, answer: response?.content ?? '' }
      } catch (err: any) {
        console.error('[MAIN] handshake:generateDraft error:', err?.message)
        return { success: false, error: err?.message ?? 'Draft generation failed' }
      }
    })

    ipcMain.handle('handshake:updatePolicies', async (_e, handshakeId: string, policies: { ai_processing_mode?: string } | { cloud_ai?: boolean; internal_ai?: boolean }) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, reason: 'DB_NOT_AVAILABLE' }
        const { updateHandshakePolicySelections } = await import('./main/handshake/db')
        updateHandshakePolicySelections(db, handshakeId, policies)
        return { success: true }
      } catch (err: any) {
        return { success: false, reason: err?.message ?? 'UPDATE_FAILED' }
      }
    })

    ipcMain.handle('handshake:updateContextItemGovernance', async (
      _e,
      handshakeId: string,
      blockId: string,
      blockHash: string,
      senderUserId: string,
      governance: Record<string, unknown>,
    ) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, reason: 'DB_NOT_AVAILABLE' }
        const { updateContextBlockGovernance, updateContextStoreGovernance } = await import('./main/handshake/db')
        const json = JSON.stringify(governance)
        updateContextBlockGovernance(db, senderUserId, blockId, blockHash, json)
        updateContextStoreGovernance(db, handshakeId, blockId, blockHash, json)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'UPDATE_FAILED' }
      }
    })

    ipcMain.handle('handshake:setBlockVisibility', async (_e, args: {
      sender_wrdesk_user_id: string
      block_id: string
      block_hash: string
      visibility: 'public' | 'private'
    }) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'no_db' }
        const { isVaultCurrentlyUnlocked } = await import('./main/handshake/visibilityFilter')
        const vaultUnlocked = isVaultCurrentlyUnlocked()
        if (!vaultUnlocked) return { success: false, error: 'vault_locked' }
        db.prepare(
          `UPDATE context_blocks SET visibility = ?
           WHERE sender_wrdesk_user_id = ? AND block_id = ? AND block_hash = ?`
        ).run(args.visibility, args.sender_wrdesk_user_id, args.block_id, args.block_hash)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'UPDATE_FAILED' }
      }
    })

    ipcMain.handle('handshake:setBulkBlockVisibility', async (_e, args: {
      handshake_id: string
      visibility: 'public' | 'private'
    }) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'no_db' }
        const { isVaultCurrentlyUnlocked } = await import('./main/handshake/visibilityFilter')
        const vaultUnlocked = isVaultCurrentlyUnlocked()
        if (!vaultUnlocked) return { success: false, error: 'vault_locked' }
        db.prepare(
          `UPDATE context_blocks SET visibility = ? WHERE handshake_id = ?`
        ).run(args.visibility, args.handshake_id)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'UPDATE_FAILED' }
      }
    })

    ipcMain.handle('handshake:requestOriginalDocument', async (_e, documentId: string, acknowledgedWarning: boolean, handshakeId?: string | null) => {
      try {
        const session = await ensureSession()
        const actorUserId = session.userInfo?.wrdesk_user_id ?? session.userInfo?.sub
        if (!actorUserId) return { success: false, error: 'Authentication required' }
        const { vaultService } = await import('./main/vault/rpc')
        const status = vaultService.getStatus()
        if (!status.isUnlocked) return { success: false, error: 'vault_locked' }
        const tier = await getEffectiveTier({ refreshIfStale: true, caller: 'request-original-document' }) as import('./main/vault/types').VaultTier
        const result = await vaultService.requestOriginalDocumentContent(tier, documentId, actorUserId, {
          acknowledgedWarning: !!acknowledgedWarning,
          handshakeId: handshakeId ?? null,
        })
        if (result.success) {
          return {
            success: true,
            contentBase64: result.content.toString('base64'),
            filename: result.filename,
            mimeType: result.mimeType,
          }
        }
        return { success: false, error: result.error, approved: result.approved }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'Request failed' }
      }
    })

    ipcMain.handle('handshake:requestLinkOpenApproval', async (_e, linkEntityId: string, acknowledgedWarning: boolean, handshakeId?: string | null) => {
      try {
        const session = await ensureSession()
        const actorUserId = session.userInfo?.wrdesk_user_id ?? session.userInfo?.sub
        if (!actorUserId) return { success: false, error: 'Authentication required' }
        const { vaultService } = await import('./main/vault/rpc')
        const status = vaultService.getStatus()
        if (!status.isUnlocked) return { success: false, error: 'vault_locked' }
        const result = vaultService.requestLinkOpenApproval(linkEntityId, actorUserId, {
          acknowledgedWarning: !!acknowledgedWarning,
          handshakeId: handshakeId ?? null,
        })
        return result.approved ? { success: true, approved: true } : { success: false, error: result.error, approved: false }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'Request failed' }
      }
    })

    ipcMain.handle('vault:getStatus', async () => {
      try {
        const { vaultService } = await import('./main/vault/rpc')
        const status = vaultService.getStatus()
        const vaults = status.availableVaults ?? []
        const currentId = status.currentVaultId
        const name = currentId ? vaults.find((v: { id: string; name: string }) => v.id === currentId)?.name ?? 'Default Vault' : null
        const tier = await getEffectiveTier({ refreshIfStale: false, caller: 'vault-getStatus' })
        const { canAccessRecordType } = await import('./main/vault/types')
        const canUseHsContextProfiles = canAccessRecordType(tier as any, 'handshake_context', 'share')
        const userInfo = getCachedUserInfo()
        const email = userInfo?.email ?? null
        return {
          isUnlocked: status.isUnlocked ?? !status.locked,
          name: status.exists ? (name ?? 'Default Vault') : null,
          tier: String(tier),
          canUseHsContextProfiles,
          email,
        }
      } catch {
        return { isUnlocked: false, name: null, tier: 'unknown', canUseHsContextProfiles: false, email: null }
      }
    })

    ipcMain.handle('vault:listHsContextProfiles', async (_e, includeArchived?: boolean) => {
      try {
        const { vaultService } = await import('./main/vault/rpc')
        const tier = await getEffectiveTier({ refreshIfStale: false, caller: 'vault-listHsContextProfiles' })
        const profiles = vaultService.listHsProfiles(tier as any, includeArchived === true)
        return { profiles }
      } catch (err: any) {
        throw new Error(err?.message ?? 'Failed to list HS Context Profiles')
      }
    })

    ipcMain.handle('vault:getDocumentPageCount', async (_e, documentId: string) => {
      try {
        const { vaultService } = await import('./main/vault/rpc')
        const tier = await getEffectiveTier({ refreshIfStale: false, caller: 'vault-getDocumentPageCount' })
        const count = vaultService.getDocumentPageCount(tier as any, documentId)
        return { count }
      } catch (err: any) {
        throw new Error(err?.message ?? 'Failed to get document page count')
      }
    })

    ipcMain.handle('vault:getDocumentPage', async (_e, documentId: string, pageNumber: number) => {
      try {
        const { vaultService } = await import('./main/vault/rpc')
        const tier = await getEffectiveTier({ refreshIfStale: false, caller: 'vault-getDocumentPage' })
        const text = vaultService.getDocumentPage(tier as any, documentId, pageNumber)
        return { text }
      } catch (err: any) {
        throw new Error(err?.message ?? 'Failed to get document page')
      }
    })

    ipcMain.handle('vault:getDocumentPageList', async (_e, documentId: string) => {
      try {
        const { vaultService } = await import('./main/vault/rpc')
        const tier = await getEffectiveTier({ refreshIfStale: false, caller: 'vault-getDocumentPageList' })
        const pages = vaultService.getDocumentPageList(tier as any, documentId)
        return { pages }
      } catch (err: any) {
        throw new Error(err?.message ?? 'Failed to get document page list')
      }
    })

    ipcMain.handle('vault:getDocumentFullText', async (_e, documentId: string) => {
      try {
        const { vaultService } = await import('./main/vault/rpc')
        const tier = await getEffectiveTier({ refreshIfStale: false, caller: 'vault-getDocumentFullText' })
        const text = vaultService.getDocumentFullText(tier as any, documentId)
        return { text }
      } catch (err: any) {
        throw new Error(err?.message ?? 'Failed to get document full text')
      }
    })

    ipcMain.handle('vault:searchDocumentPages', async (_e, documentId: string, query: string) => {
      try {
        const { vaultService } = await import('./main/vault/rpc')
        const tier = await getEffectiveTier({ refreshIfStale: false, caller: 'vault-searchDocumentPages' })
        const matches = vaultService.searchDocumentPages(tier as any, documentId, query ?? '')
        return { matches }
      } catch (err: any) {
        throw new Error(err?.message ?? 'Failed to search document pages')
      }
    })

    ipcMain.handle('handshake:chatWithContext', async (_e, systemMessage: string, dataWrapper: string, userMessage: string) => {
      try {
        // Route to the LLM module if available, using the unidirectional prompt structure
        const vs = (globalThis as any).__og_vault_service_ref
        const llmChat = vs?.getLLMChat?.()
        if (llmChat) {
          const messages = [
            { role: 'system' as const, content: systemMessage },
            ...(dataWrapper ? [{ role: 'system' as const, content: dataWrapper }] : []),
            { role: 'user' as const, content: userMessage },
          ]
          const response = await llmChat.complete(messages)
          return typeof response === 'string' ? response : response?.content ?? 'No response.'
        }
        return 'LLM chat backend is not connected. Please ensure the AI service is running.'
      } catch (err: any) {
        return `Error: ${err?.message || 'Chat request failed.'}`
      }
    })

    ipcMain.handle('handshake:chatWithContextRag', async (event, params: { query: string; scope?: string; model: string; provider: string; stream?: boolean; debug?: boolean; conversationContext?: { lastAnswer?: string }; selectedDocumentId?: string }) => {
      const toIPC = (o: unknown) => {
        try { return JSON.parse(JSON.stringify(o)) } catch { return o }
      }
      const totalStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const elapsed = () => Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - totalStart)

      try {
        const db = await getHandshakeDb()
        if (!db) return toIPC({ success: false, error: 'vault_locked' })

        const { getProvider, toEmbeddingService } = await import('./main/handshake/aiProviders')
        const { ocrRouter } = await import('./main/ocr/router')
        const provider = getProvider(
          { provider: params.provider ?? 'ollama', model: params.model },
          (p) => ocrRouter.getApiKey(p as 'OpenAI' | 'Claude' | 'Gemini' | 'Grok')
        )
        const hasEmbedding =
          provider.id === 'ollama' ||
          ('hasEmbeddingSupport' in provider && typeof (provider as any).hasEmbeddingSupport === 'function' && (provider as any).hasEmbeddingSupport())
        const embeddingService = hasEmbedding ? toEmbeddingService(provider) : null

        const filter: { relationship_id?: string; handshake_id?: string } = {}
        const scope = params.scope ?? 'all'
        if (typeof scope === 'string') {
          if (scope.startsWith('hs-')) filter.handshake_id = scope
          else if (scope.startsWith('rel-')) filter.relationship_id = scope
        }

        // Fallback scope: when no handshake selected, use most recent handshake with context
        // so retrieval runs in a sensible default scope instead of empty filter
        if (!filter.handshake_id && !filter.relationship_id && (scope === 'context-graph' || scope === 'all')) {
          try {
            const row = db.prepare(
              `SELECT c.handshake_id FROM context_blocks c
               INNER JOIN handshakes h ON h.handshake_id = c.handshake_id
               WHERE h.state IN ('ACCEPTED','ACTIVE')
               ORDER BY h.created_at DESC
               LIMIT 1`
            ).get() as { handshake_id: string } | undefined
            if (row?.handshake_id) {
              filter.handshake_id = row.handshake_id
              console.log('[Chat] No selection: using fallback handshake', row.handshake_id)
            }
          } catch (e) {
            /* ignore — proceed with empty filter */
          }
        }

        // Structured path (no embedding needed): try first when embedding unavailable
        const { queryClassifier, structuredLookup, structuredLookupMulti, fetchBlocksForStructuredLookup } = await import('./main/handshake/structuredQuery')
        const classifierResult = queryClassifier(params.query ?? '')
        const pathForFetch = classifierResult.fieldPaths?.[0] ?? classifierResult.fieldPath
        if (classifierResult.matched && pathForFetch) {
          const blocks = fetchBlocksForStructuredLookup(db, filter, pathForFetch)
          if (blocks.length > 0) {
            const structResult = classifierResult.fieldPaths && classifierResult.fieldPaths.length > 0
              ? structuredLookupMulti(blocks, classifierResult.fieldPaths)
              : structuredLookup(blocks, classifierResult.fieldPath!)
            if (structResult.found && structResult.value) {
              const src = structResult.source
              const sources = src
                ? [{ handshake_id: src.handshake_id, capsule_id: src.handshake_id, block_id: src.block_id, source: src.source ?? '', score: 1 }]
                : []

              // Route structured result through LLM for a natural-language answer (no raw JSON)
              const { buildPrompt } = await import('./main/handshake/blockRetrieval')
              const trimmedQuery = params.query?.trim() ?? ''
              const structuredContext = `[block_id: ${src?.block_id ?? 'structured'}]\n${structResult.value}`
              const { system, user: userPrompt } = buildPrompt(structuredContext, trimmedQuery)
              const messages = [
                { role: 'system' as const, content: system },
                { role: 'user' as const, content: userPrompt },
              ]

              const doStream = params.stream === true && !!event.sender
              const send = doStream ? (ch: string, payload: unknown) => event.sender.send(ch, payload) : () => {}

              let answer: string
              try {
                if (doStream) {
                  send('handshake:chatStreamStart', { contextBlocks: src ? [src.block_id] : [], sources })
                  answer = await provider.generateChat(messages, {
                    model: params.model,
                    stream: true,
                    send,
                  })
                } else {
                  answer = await provider.generateChat(messages, { model: params.model })
                }
              } catch (err: any) {
                const msg = err?.message ?? 'Unknown error'
                const isNoKey = /no_api_key|API key required/i.test(msg)
                const isUnavailable = /ECONNREFUSED|fetch failed|Failed to fetch|no_api_key|API key/i.test(msg)
                const providerLower = (params.provider ?? 'ollama').toLowerCase()
                if (isNoKey) return toIPC({ success: false, error: 'no_api_key', provider: providerLower, message: msg })
                if (isUnavailable && provider.id === 'ollama') return toIPC({ success: false, error: 'ollama_unavailable', message: msg })
                return toIPC({ success: false, error: 'model_execution_failed', provider: providerLower, message: msg })
              }

              const total_ms = elapsed()
              return toIPC({
                success: true,
                answer,
                sources,
                streamed: doStream,
                resultType: 'context_answer',
              })
            }
          }
        }

        const { hybridSearch } = await import('./main/handshake/hybridSearch')
        const { scoredBlocksToRetrieved, buildRagPrompt, buildPrompt } = await import('./main/handshake/blockRetrieval')

        const embeddingUnavailable = !embeddingService
        // When embedding unavailable: use keyword fallback (same as Search) so Chat can answer from lexical matches
        let hybridResult: Awaited<ReturnType<typeof hybridSearch>>
        if (embeddingUnavailable) {
          const { keywordSearch } = await import('./main/handshake/keywordSearch')
          const keywordBlocks = keywordSearch(db, (params.query ?? '').trim(), filter, 5)
          hybridResult = {
            mode: 'semantic',
            blocks: keywordBlocks,
            metrics: { classification_ms: 0, structured_ms: 0, semantic_ms: 0 },
          }
        } else {
          hybridResult = await hybridSearch(db, params.query ?? '', filter, embeddingService)
        }
        const { getHandshakeRecord } = await import('./main/handshake/db')
        const {
          parseGovernanceJson,
          resolveEffectiveGovernance,
          filterBlocksForCloudAI,
        } = await import('./main/handshake/contextGovernance')
        const { visibilityWhereClause, isVaultCurrentlyUnlocked } = await import('./main/handshake/visibilityFilter')
        const { logCacheHitMetrics, logAIQueryMetrics, checkAILatency, buildLatencyDebugPayload } = await import('./main/handshake/latencyInstrumentation')

        const hasHandshakeScope = !!filter.handshake_id
        const debug = params.debug === true
        const providerLower = (params.provider ?? 'ollama').toLowerCase()

        // ── Intent Detection & Domain Routing ─────────────────────────────────
        const { classifyIntent, queryRequiresAttachmentSelection } = await import('./main/handshake/intentClassifier')
        const { routeByIntent } = await import('./main/handshake/intentRouter')
        const { executeStructuredSearch } = await import('./main/handshake/intentExecution')

        const intentResult = classifyIntent(params.query ?? '')
        const routerResult = routeByIntent(intentResult.intent, hasHandshakeScope)

        console.log('[INTENT] Detected:', intentResult.intent, '| Domain:', routerResult.domain, '| Confidence:', intentResult.confidence)

        // Attachment binding: when query implies "this attachment" but no document selected
        // — auto-bind if exactly one attachment; otherwise return context-aware message
        let selectedDocId = params.selectedDocumentId?.trim()
        if (intentResult.intent === 'document_lookup' && queryRequiresAttachmentSelection(params.query ?? '') && !selectedDocId && filter.handshake_id) {
          const { visibilityWhereClause: visWhere, isVaultCurrentlyUnlocked } = await import('./main/handshake/visibilityFilter')
          const vaultUnlocked = isVaultCurrentlyUnlocked()
          const { sql: visSql, params: visParams } = visWhere('cb', vaultUnlocked)
          const rows = db.prepare(
            `SELECT cb.block_id, cb.payload FROM context_blocks cb WHERE cb.handshake_id = ?${visSql}`
          ).all(filter.handshake_id, ...visParams) as Array<{ block_id: string; payload: string }>
          // Deduplicate by document id — same doc in multiple blocks counts as one
          const docsWithText: Array<{ id: string; block_id: string }> = []
          const seenDocIds = new Set<string>()
          for (const row of rows) {
            try {
              const parsed = JSON.parse(row.payload) as { documents?: Array<{ id?: string; extracted_text?: string | null }> }
              const docs = parsed?.documents
              if (Array.isArray(docs)) {
                for (const d of docs) {
                  if (d?.id && typeof d.extracted_text === 'string' && d.extracted_text.trim() && !seenDocIds.has(d.id)) {
                    seenDocIds.add(d.id)
                    docsWithText.push({ id: d.id, block_id: row.block_id })
                  }
                }
              }
            } catch { /* skip malformed payload */ }
          }
          if (docsWithText.length === 0) {
            const msg = "I couldn't find an attachment in the current handshake context."
            const doStream = params.stream === true && event.sender
            if (doStream) {
              const send = (ch: string, payload: unknown) => event.sender.send(ch, payload)
              send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })
              send('handshake:chatStreamToken', { token: msg })
            }
            return toIPC({ success: true, answer: msg, sources: [], streamed: !!doStream, resultType: 'context_answer' })
          }
          if (docsWithText.length === 1) {
            selectedDocId = docsWithText[0].id
          } else {
            const msg = 'Please select which attachment you want me to summarize.'
            const doStream = params.stream === true && event.sender
            if (doStream) {
              const send = (ch: string, payload: unknown) => event.sender.send(ch, payload)
              send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })
              send('handshake:chatStreamToken', { token: msg })
            }
            return toIPC({ success: true, answer: msg, sources: [], streamed: !!doStream, resultType: 'context_answer' })
          }
        } else if (intentResult.intent === 'document_lookup' && queryRequiresAttachmentSelection(params.query ?? '') && !selectedDocId) {
          // No handshake scope or no filter — cannot list attachments
          const msg = "I couldn't find an attachment in the current handshake context."
          const doStream = params.stream === true && event.sender
          if (doStream) {
            const send = (ch: string, payload: unknown) => event.sender.send(ch, payload)
            send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })
            send('handshake:chatStreamToken', { token: msg })
          }
          return toIPC({ success: true, answer: msg, sources: [], streamed: !!doStream, resultType: 'context_answer' })
        }

        // Attachment binding: when document selected (or auto-bound), scope retrieval to that document's content
        if (intentResult.intent === 'document_lookup' && selectedDocId && filter.handshake_id) {
          const { visibilityWhereClause: visWhere, isVaultCurrentlyUnlocked } = await import('./main/handshake/visibilityFilter')
          const vaultUnlocked = isVaultCurrentlyUnlocked()
          const { sql: visSql, params: visParams } = visWhere('cb', vaultUnlocked)
          const rows = db.prepare(
            `SELECT cb.block_id, cb.payload FROM context_blocks cb WHERE cb.handshake_id = ?${visSql}`
          ).all(filter.handshake_id, ...visParams) as Array<{ block_id: string; payload: string }>
          let docText: string | null = null
          let foundBlockId: string | null = null
          for (const row of rows) {
            try {
              const parsed = JSON.parse(row.payload) as { documents?: Array<{ id?: string; extracted_text?: string | null }> }
              const docs = parsed?.documents
              if (Array.isArray(docs)) {
                const doc = docs.find((d) => d?.id === selectedDocId)
                if (doc && typeof doc.extracted_text === 'string' && doc.extracted_text.trim()) {
                  docText = doc.extracted_text.trim()
                  foundBlockId = row.block_id
                  break
                }
              }
            } catch { /* skip malformed payload */ }
          }
          if (docText && foundBlockId) {
            const { buildPrompt } = await import('./main/handshake/blockRetrieval')
            const docContext = `[block_id: ${foundBlockId}]\n[Document content]\n${docText}`
            const trimmedQuery = params.query?.trim() ?? ''
            const { system, user: userPrompt } = buildPrompt(docContext, trimmedQuery)
            const sources = [{ handshake_id: filter.handshake_id, capsule_id: filter.handshake_id, block_id: foundBlockId, source: 'received', score: 1 }]
            const doStream = params.stream === true && event.sender
            const send = doStream ? (ch: string, payload: unknown) => event.sender.send(ch, payload) : () => {}
            try {
              if (doStream) send('handshake:chatStreamStart', { contextBlocks: [foundBlockId], sources })
              const answer = await provider.generateChat(
                [{ role: 'system' as const, content: system }, { role: 'user' as const, content: userPrompt }],
                { model: params.model, stream: doStream, send: doStream ? send : undefined }
              )
              return toIPC({ success: true, answer, sources, streamed: doStream, resultType: 'context_answer' })
            } catch (err: any) {
              const msg = err?.message ?? 'Unknown error'
              if (/no_api_key|API key required/i.test(msg)) return toIPC({ success: false, error: 'no_api_key', provider: providerLower, message: msg })
              if (/ECONNREFUSED|fetch failed|Failed to fetch/i.test(msg) && provider.id === 'ollama') return toIPC({ success: false, error: 'ollama_unavailable', message: msg })
              return toIPC({ success: false, error: 'model_execution_failed', provider: providerLower, message: msg })
            }
          } else {
            const msg = "I couldn't find that document in the current handshake context. It may not have been extracted yet."
            const doStream = params.stream === true && event.sender
            if (doStream) {
              const send = (ch: string, payload: unknown) => event.sender.send(ch, payload)
              send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })
              send('handshake:chatStreamToken', { token: msg })
            }
            return toIPC({ success: true, answer: msg, sources: [], streamed: !!doStream, resultType: 'context_answer' })
          }
        }

        if (embeddingService && !routerResult.useRagPipeline && routerResult.forceSemanticSearch) {
          const structResult = await executeStructuredSearch(db, params.query ?? '', filter, embeddingService, intentResult.intent)
          const total_ms = elapsed()
          console.log('[INTENT] Result:', structResult.domain, '| Items:', structResult.items.length, '| Latency:', structResult.latency_ms, 'ms')

          const doStream = params.stream === true && event.sender
          const send = doStream ? (ch: string, payload: unknown) => event.sender.send(ch, payload) : () => {}

          const summaryText = structResult.items.length > 0
            ? structResult.title + '\n\n' + structResult.items.map((i, idx) => `${idx + 1}. ${i.title}: ${i.snippet}`).join('\n\n')
            : 'No relevant context found in indexed BEAP data.'

          if (doStream) {
            send('handshake:chatStreamStart', { contextBlocks: structResult.items.map(i => i.block_id), sources: structResult.sources })
            send('handshake:chatStreamToken', { token: summaryText })
          }

          return toIPC({
            success: true,
            answer: summaryText,
            sources: structResult.sources,
            streamed: doStream,
            resultType: structResult.resultType,
            structuredResult: { title: structResult.title, items: structResult.items },
            intent: intentResult.intent,
            domain: structResult.domain,
            ...(debug && { latency: { query_ms_total: total_ms, intent: intentResult.intent, domain: structResult.domain } }),
          })
        }

        // Cache lookup (only when scope is cacheable)
        const { normalizeQuery, resolveCapsuleId, getCached, setCached } = await import('./main/handshake/queryCache')
        const capsuleId = resolveCapsuleId(filter)
        const normalizedQuery = normalizeQuery(params.query ?? '')
        if (capsuleId && normalizedQuery) {
          const cached = getCached(db, capsuleId, normalizedQuery)
          if (cached) {
            const total_ms = elapsed()
            logCacheHitMetrics(total_ms)
            return toIPC({
              success: true,
              answer: cached.answer,
              sources: cached.sources,
              cached: true,
              ...(debug && { latency: buildLatencyDebugPayload({ query_ms_total: total_ms, cache_hit: true }) }),
            })
          }
        }

        const doStream = params.stream === true && event.sender
        const send = doStream ? (ch: string, payload: unknown) => event.sender.send(ch, payload) : () => {}

        // Fast-path: structured result → route through LLM for natural-language answer (no raw JSON)
        if (hybridResult.mode === 'structured' && hybridResult.structured?.found && hybridResult.structured?.value) {
          const src = hybridResult.structured.source
          const structuredValue = hybridResult.structured.value
          const sources = src
            ? [{ handshake_id: src.handshake_id, capsule_id: src.handshake_id, block_id: src.block_id, source: src.source ?? '', score: 1 }]
            : []

          const trimmedQuery = params.query?.trim() ?? ''
          const structuredContext = `[block_id: ${src?.block_id ?? 'structured'}]\n${structuredValue}`
          const { system, user: userPrompt } = buildPrompt(structuredContext, trimmedQuery)
          const messages = [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: userPrompt },
          ]

          let answer: string
          try {
            if (doStream) {
              send('handshake:chatStreamStart', { contextBlocks: src ? [src.block_id] : [], sources })
              answer = await provider.generateChat(messages, {
                model: params.model,
                stream: true,
                send,
              })
            } else {
              answer = await provider.generateChat(messages, { model: params.model })
            }
          } catch (err: any) {
            const msg = err?.message ?? 'Unknown error'
            const isNoKey = /no_api_key|API key required/i.test(msg)
            const isUnavailable = /ECONNREFUSED|fetch failed|Failed to fetch|no_api_key|API key/i.test(msg)
            if (isNoKey) return toIPC({ success: false, error: 'no_api_key', provider: providerLower, message: msg })
            if (isUnavailable && provider.id === 'ollama') return toIPC({ success: false, error: 'ollama_unavailable', message: msg })
            return toIPC({ success: false, error: 'model_execution_failed', provider: providerLower, message: msg })
          }

          const total_ms = elapsed()
          const m = hybridResult.metrics
          if (capsuleId && normalizedQuery) setCached(db, capsuleId, normalizedQuery, { answer, sources })
          return toIPC({
            success: true,
            answer,
            sources,
            streamed: doStream,
            ...(debug && { latency: buildLatencyDebugPayload({ query_ms_total: total_ms, classification_ms: m?.classification_ms, structured_ms: m?.structured_ms, semantic_ms: m?.semantic_ms, cache_hit: false }) }),
          })
        }

        // Semantic path: apply governance, build prompt, call LLM
        let searchResults = hybridResult.blocks ?? []
        // Filter out low-relevance blocks (cosine similarity < 0.4) to avoid unrelated answers.
        // When ALL blocks score below threshold, do NOT fall back to unfiltered results — return
        // explicit "not enough reliable context" instead of weakly grounded answers.
        const SEMANTIC_RELEVANCE_THRESHOLD = 0.4
        const relevantResults = searchResults.filter(r => (r.score ?? 0) >= SEMANTIC_RELEVANCE_THRESHOLD)
        const allFiltered = relevantResults.length === 0 && searchResults.length > 0
        if (allFiltered) {
          searchResults = []
        } else if (relevantResults.length > 0) {
          searchResults = relevantResults
        }
        const isCloud = ['openai', 'anthropic', 'google', 'xai'].includes(providerLower)

        let governanceNote: string | null = null
        if (isCloud && searchResults.length > 0) {
          const vaultUnlocked = isVaultCurrentlyUnlocked()
          const { sql: visSql, params: visParams } = visibilityWhereClause('context_blocks', vaultUnlocked)
          const blocksWithGov: Array<{ governance?: any; [k: string]: any }> = []
          for (const b of searchResults) {
            const row = db.prepare(`SELECT governance_json FROM context_blocks WHERE handshake_id=? AND block_id=? AND block_hash=?${visSql}`).get(b.handshake_id, b.block_id, b.block_hash, ...visParams) as { governance_json?: string } | undefined
            const record = getHandshakeRecord(db, b.handshake_id)
            if (!record) continue
            const itemGov = parseGovernanceJson(row?.governance_json)
            const legacy = {
              block_id: b.block_id,
              type: b.type,
              data_classification: b.data_classification,
              scope_id: b.scope_id,
              sender_wrdesk_user_id: b.sender_wrdesk_user_id,
              publisher_id: b.sender_wrdesk_user_id,
              source: b.source,
            }
            const governance = resolveEffectiveGovernance(itemGov, legacy, record, record.relationship_id)
            blocksWithGov.push({ ...b, governance })
          }
          const originalCount = blocksWithGov.length
          const filtered = filterBlocksForCloudAI(blocksWithGov, null)
          searchResults = filtered
          const filteredCount = originalCount - filtered.length
          if (filteredCount > 0) {
            governanceNote = `${filteredCount} context block(s) were excluded because their governance policy restricts cloud AI processing. Use a local model to access all results.`
          }
        }

        const retrievedBlocks = scoredBlocksToRetrieved(searchResults)
        // retrievalFailed = true only when embedding/vector search failed (unavailable). When we could
        // search but found nothing (or all filtered), use retrievalFailed=false → "retrieved blocks did
        // not contain relevant information". When embedding unavailable but keyword fallback found
        // matches, we have context → retrievalFailed=false. When embedding unavailable and no blocks →
        // retrievalFailed=true → "contextual search unavailable".
        const retrievalFailed = retrievedBlocks.length === 0 && embeddingUnavailable
        const followUpPatterns = [
          /what\s+does\s+(this|that|it)\s+mean/i,
          /explain\s+(this|that|it)/i,
          /could\s+you\s+elaborate/i,
          /clarify/i,
          /simplify/i,
          /in\s+simpler\s+terms/i,
          /what\s+do\s+you\s+mean/i,
          /\belaborate\b/i,
          /more\s+detail/i,
        ]
        const isFollowUp = params.conversationContext?.lastAnswer && followUpPatterns.some((re) => re.test(params.query ?? ''))
        const conversationContext = isFollowUp && params.conversationContext?.lastAnswer
          ? { lastAnswer: params.conversationContext.lastAnswer }
          : undefined
        let { systemPrompt, userPrompt, contextBlocks: contextBlocksStr } = buildRagPrompt(retrievedBlocks, params.query ?? '', {
          retrievalFailed,
          conversationContext,
        })

        if (userPrompt.length > 8000) {
          console.warn('Prompt too large, truncating')
          userPrompt = userPrompt.slice(0, 8000)
        }
        console.log('[RAG] Selected provider:', provider.id)
        console.log('[RAG] Retrieved blocks:', retrievedBlocks.length, '| Block IDs:', retrievedBlocks.map(b => b.block_id))
        console.log('[RAG] LLM prompt size:', userPrompt.length)
        if (debug) {
          console.log('[RAG] Embedding generation:', embeddingUnavailable ? 'skipped (unavailable)' : 'success')
          console.log('[RAG] Context blocks:', contextBlocksStr || '(none - retrieval failed or empty)')
          console.log('[RAG] System prompt:', systemPrompt)
          console.log('[RAG] User prompt:', userPrompt)
        }

        let answer = ''
        const sources = searchResults.map(r => ({
          handshake_id: String(r.handshake_id ?? ''),
          capsule_id: String(r.handshake_id ?? ''),
          block_id: String(r.block_id ?? ''),
          source: String(r.source ?? 'sent'),
          score: typeof r.score === 'number' && !Number.isNaN(r.score) ? r.score : 0,
        }))
        const contextBlocks = retrievedBlocks.map(b => String(b.block_id ?? ''))

        if (doStream) {
          send('handshake:chatStreamStart', { contextBlocks, sources })
        }

        const llmStart = typeof performance !== 'undefined' ? performance.now() : Date.now()
        const messages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt },
        ]
        try {
          answer = await provider.generateChat(messages, {
            model: params.model,
            stream: doStream,
            send: doStream ? send : undefined,
          })
        } catch (err: any) {
          const msg = err?.message ?? 'Unknown error'
          const isUnavailable = /ECONNREFUSED|fetch failed|Failed to fetch|no_api_key|API key/i.test(msg)
          const isNoKey = /no_api_key|API key required/i.test(msg)
          console.error('[RAG] LLM execution error:', err)
          if (isNoKey) {
            return toIPC({ success: false, error: 'no_api_key', provider: providerLower, message: msg })
          }
          if (isUnavailable && provider.id === 'ollama') {
            return toIPC({ success: false, error: 'ollama_unavailable', message: msg })
          }
          return toIPC({ success: false, error: 'model_execution_failed', provider: providerLower, message: msg })
        }

        const llm_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - llmStart)
        const total_ms = elapsed()
        const m = hybridResult.metrics
        logAIQueryMetrics({
          structured_ms: m?.structured_ms ?? 0,
          semantic_ms: m?.semantic_ms ?? 0,
          llm_ms,
          total_ms,
          provider: providerLower,
          classification_ms: m?.classification_ms,
        })
        checkAILatency(total_ms)

        if (capsuleId && normalizedQuery) setCached(db, capsuleId, normalizedQuery, { answer, sources })
        return toIPC({
          success: true,
          answer: doStream ? undefined : answer,
          sources,
          governanceNote: governanceNote ?? undefined,
          streamed: doStream,
          ...(debug && {
            latency: buildLatencyDebugPayload({
              query_ms_total: total_ms,
              classification_ms: m?.classification_ms,
              structured_ms: m?.structured_ms,
              semantic_ms: m?.semantic_ms,
              block_retrieval_ms: m?.semantic_ms,
              llm_ms,
              cache_hit: false,
              provider: providerLower,
            }),
          }),
        })
      } catch (err: any) {
        console.error('LLM execution error:', err)
        return toIPC({
          success: false,
          error: 'model_execution_failed',
          message: err?.message ?? 'Unknown error',
        })
      }
    })

    /** Direct LLM chat — bypasses RAG retrieval entirely.
     *  Used for field-drafting where the renderer provides its own system + user prompt
     *  and does NOT want the context-grounded RAG system prompt. */
    ipcMain.handle('handshake:chatDirect', async (event, params: { model: string; provider: string; systemPrompt: string; userPrompt: string; stream?: boolean }) => {
      const toIPC = (o: unknown) => { try { return JSON.parse(JSON.stringify(o)) } catch { return o } }
      const send = (channel: string, data: unknown) => { try { event.sender.send(channel, toIPC(data)) } catch {} }
      const doStream = params.stream === true
      try {
        const { getProvider } = await import('./main/handshake/aiProviders')
        const { ocrRouter } = await import('./main/ocr/router')
        const provider = getProvider(
          { provider: params.provider ?? 'ollama', model: params.model },
          (p) => ocrRouter.getApiKey(p as 'OpenAI' | 'Claude' | 'Gemini' | 'Grok')
        )
        if (doStream) {
          send('handshake:chatStreamStart', { contextBlocks: [], sources: [] })
        }
        const messages = [
          { role: 'system' as const, content: params.systemPrompt },
          { role: 'user' as const, content: params.userPrompt },
        ]
        const answer = await provider.generateChat(messages, {
          model: params.model,
          stream: doStream,
          send: doStream ? send : undefined,
        })
        return toIPC({ success: true, answer, contextBlocks: [], sources: [] })
      } catch (err: any) {
        console.error('[chatDirect] error:', err)
        return toIPC({ success: false, error: 'model_execution_failed', message: err?.message ?? 'Unknown error' })
      }
    })

    // email:listAccounts is registered by registerEmailHandlers() — do not duplicate here

    ipcMain.handle('handshake:initiate', async (_e, receiverEmail: string, fromAccountId: string, contextOpts?: { skipVaultContext?: boolean; message?: string; context_blocks?: any[]; profile_ids?: string[]; profile_items?: any[]; policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean } }) => {
      try {
        const db = await getHandshakeDb()
        return await handleHandshakeRPC('handshake.initiate', {
          receiverUserId: receiverEmail,
          receiverEmail,
          fromAccountId,
          skipVaultContext: contextOpts?.skipVaultContext ?? false,
          ...(contextOpts?.message ? { message: contextOpts.message } : {}),
          ...(contextOpts?.context_blocks ? { context_blocks: contextOpts.context_blocks } : {}),
          ...(contextOpts?.profile_ids?.length ? { profile_ids: contextOpts.profile_ids } : {}),
          ...(contextOpts?.profile_items?.length ? { profile_items: contextOpts.profile_items } : {}),
          ...(contextOpts?.policy_selections ? { policy_selections: contextOpts.policy_selections } : {}),
        }, db)
      } catch (err: any) {
        return { success: false, error: err?.message || 'Initiation failed.' }
      }
    })

    ipcMain.handle('handshake:buildForDownload', async (_e, receiverEmail: string, contextOpts?: { skipVaultContext?: boolean; message?: string; context_blocks?: any[]; profile_ids?: string[]; profile_items?: any[]; policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean } }) => {
      try {
        const db = await getHandshakeDb()
        if (!db) {
          console.error('[MAIN] handshake:buildForDownload — getHandshakeDb() returned null; refusing export')
          return { success: false, error: 'No active session. Please log in before exporting a handshake capsule.' }
        }
        return await handleHandshakeRPC('handshake.buildForDownload', {
          receiverUserId: receiverEmail,
          receiverEmail,
          skipVaultContext: contextOpts?.skipVaultContext ?? true,
          ...(contextOpts?.message ? { message: contextOpts.message } : {}),
          ...(contextOpts?.context_blocks ? { context_blocks: contextOpts.context_blocks } : {}),
          ...(contextOpts?.profile_ids?.length ? { profile_ids: contextOpts.profile_ids } : {}),
          ...(contextOpts?.profile_items?.length ? { profile_items: contextOpts.profile_items } : {}),
          ...(contextOpts?.policy_selections ? { policy_selections: contextOpts.policy_selections } : {}),
        }, db)
      } catch (err: any) {
        return { success: false, error: err?.message || 'Build failed.' }
      }
    })

    ipcMain.handle('handshake:downloadCapsule', async (_e, capsuleJson: string, suggestedFilename: string) => {
      try {
        const { dialog } = await import('electron')
        const fs = await import('fs')
        const result = await dialog.showSaveDialog({
          defaultPath: suggestedFilename,
          filters: [{ name: 'BEAP Capsule', extensions: ['beap'] }],
        })
        if (result.canceled || !result.filePath) {
          return { success: false, reason: 'cancelled' }
        }
        fs.writeFileSync(result.filePath, capsuleJson, 'utf-8')
        return { success: true, filePath: result.filePath }
      } catch (err: any) {
        return { success: false, error: err?.message || 'Save failed.' }
      }
    })

    ipcMain.handle('vault:unlockForHandshake', async () => {
      try {
        const { vaultService, setupEmbeddingServiceRef } = await import('./main/vault/rpc')
        const status = vaultService.getStatus()
        if (!status?.isUnlocked) {
          return { success: false, reason: 'VAULT_LOCKED', needsUnlock: true }
        }
        const db = getLedgerDb() ?? vaultService.getHsProfileDb?.() ?? null
        setupEmbeddingServiceRef(vaultService, db)
        completePendingContextSyncs(db, getCurrentSession())
        if (db) setImmediate(() => processOutboundQueue(db, getOidcToken).catch(() => {}))
        try { win?.webContents.send('handshake-list-refresh') } catch { /* no window */ }
        try { win?.webContents.send('vault-status-changed') } catch { /* no window */ }
        return { success: true }
      } catch (err: any) {
        return { success: false, reason: err?.message ?? 'UNKNOWN' }
      }
    })

    ipcMain.handle('vault:unlockWithPassword', async (_e, password: string, vaultId?: string) => {
      try {
        if (typeof password !== 'string' || password.length === 0) {
          return { success: false, error: 'Password is required' }
        }
        const { vaultService, setupEmbeddingServiceRef } = await import('./main/vault/rpc')
        await vaultService.unlock(password, vaultId || 'default')
        const db = getLedgerDb() ?? vaultService.getHsProfileDb?.() ?? null
        setupEmbeddingServiceRef(vaultService, db)
        completePendingContextSyncs(db, getCurrentSession())
        if (db) setImmediate(() => processOutboundQueue(db, getOidcToken).catch(() => {}))
        try { win?.webContents.send('handshake-list-refresh') } catch { /* no window */ }
        try { win?.webContents.send('vault-status-changed') } catch { /* no window */ }
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message ?? 'Unlock failed' }
      }
    })

    ipcMain.handle('p2p:getHealth', async () => {
      const h = getP2PHealth()
      try {
        const db = await getHandshakeDb()
        const cfg = getP2PConfig(db)
        return {
          ...h,
          enabled: cfg.enabled,
          relay_mode: cfg.relay_mode,
          last_relay_pull_success: h.last_relay_pull_success,
          last_relay_pull_failure: h.last_relay_pull_failure,
          last_relay_pull_error: h.last_relay_pull_error,
          relay_capsules_pulled: h.relay_capsules_pulled,
        }
      } catch {
        return { ...h, enabled: true, relay_mode: 'local' }
      }
    })

    ipcMain.handle('p2p:getQueueStatus', async (_e, handshakeId: string) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { status: { pending: 0, sent: 0, failed: 0 }, entries: [] }
        const status = getQueueStatus(db, handshakeId)
        const entries = getQueueEntries(db, handshakeId)
        return { status, entries }
      } catch {
        return { status: { pending: 0, sent: 0, failed: 0 }, entries: [] }
      }
    })

    ipcMain.handle('p2p:flushOutboundQueue', async () => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No database' }
        await processOutboundQueue(db, getOidcToken)
        return { success: true }
      } catch (err: any) {
        console.warn('[P2P] flushOutboundQueue error:', err?.message)
        return { success: false, error: err?.message }
      }
    })

    ipcMain.handle('autoresponder:getAudit', async (_e, messageId: unknown) => {
      const id = typeof messageId === 'string' ? messageId : ''
      if (!id) return null
      return getAuditForMessage(id) ?? null
    })

    ipcMain.handle('autoresponder:getFullLog', async () => getAutoresponderAuditLog())

    // ── Relay Setup Wizard IPC ─────────────────────────────────────────────
    ipcMain.handle('relay:generateSecret', async () => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session. Please log in first.' }
        const secret = crypto.randomBytes(32).toString('hex')
        const cfg = getP2PConfig(db)
        upsertP2PConfig(db, { ...cfg, relay_auth_secret: secret })
        return { success: true, secret }
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to generate secret' }
      }
    })

    ipcMain.handle('relay:testConnection', async (_e, url: string) => {
      const u = typeof url === 'string' ? url.trim() : ''
      if (!u) return { success: false, error: 'URL is required' }
      const healthUrl = u.replace(/\/beap\/ingest\/?$/, '').replace(/\/$/, '') + '/health'
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal })
        clearTimeout(timeout)
        if (res.ok) return { success: true }
        const text = await res.text()
        return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
      } catch (err: any) {
        clearTimeout(timeout)
        const msg = err?.message ?? String(err)
        if (msg.includes('ECONNREFUSED') || msg.includes('Connection refused')) {
          return { success: false, error: `Cannot connect to ${healthUrl}. Check that the relay container is running and port 51249 is open.` }
        }
        if (msg.includes('ETIMEDOUT') || msg.includes('timeout') || msg.includes('aborted')) {
          return { success: false, error: 'Connection timed out. Check your server\'s firewall and that the relay is running.' }
        }
        if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
          try {
            const host = new URL(healthUrl).hostname
            return { success: false, error: `Cannot resolve ${host}. Check the URL.` }
          } catch {
            return { success: false, error: 'Cannot resolve hostname. Check the URL.' }
          }
        }
        if (msg.includes('certificate') || msg.includes('SSL') || msg.includes('TLS')) {
          return { success: false, error: 'TLS certificate error. If using self-signed certificates, see the TLS setup guide.' }
        }
        return { success: false, error: msg }
      }
    })

    ipcMain.handle('relay:verifyEndToEnd', async (_e, url: string, secret: string) => {
      const u = typeof url === 'string' ? url.trim() : ''
      const s = typeof secret === 'string' ? secret.trim() : ''
      if (!u || !s) return { success: false, results: [], error: 'URL and secret are required' }
      const base = u.replace(/\/beap\/ingest\/?$/, '').replace(/\/$/, '')
      const healthUrl = base + '/health'
      const registerUrl = base + '/beap/register-handshake'
      const pullUrl = base + '/beap/pull'
      const results: { name: string; ok: boolean; error?: string }[] = []
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const healthRes = await fetch(healthUrl, { method: 'GET', signal: controller.signal })
        clearTimeout(timeout)
        results.push({ name: 'health', ok: healthRes.ok, error: healthRes.ok ? undefined : `HTTP ${healthRes.status}` })
        if (!healthRes.ok) {
          return { success: false, results, error: 'Relay is not reachable' }
        }
      } catch (err: any) {
        clearTimeout(timeout)
        results.push({ name: 'health', ok: false, error: err?.message ?? String(err) })
        return { success: false, results, error: 'Relay unreachable' }
      }
      try {
        const regRes = await fetch(registerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s}` },
          body: JSON.stringify({ handshake_id: '__verify__', expected_token: '__test__', counterparty_email: 'verify@test.local' }),
        })
        results.push({ name: 'auth', ok: regRes.ok || regRes.status === 404, error: regRes.ok ? undefined : regRes.status === 401 ? 'Authentication failed' : `HTTP ${regRes.status}` })
        if (regRes.status === 401) {
          return { success: false, results, error: 'The relay rejected your credentials.' }
        }
      } catch (err: any) {
        results.push({ name: 'auth', ok: false, error: err?.message ?? String(err) })
        return { success: false, results, error: 'Auth check failed' }
      }
      try {
        const pullRes = await fetch(pullUrl, { method: 'GET', headers: { Authorization: `Bearer ${s}` } })
        results.push({ name: 'pull', ok: pullRes.ok, error: pullRes.ok ? undefined : pullRes.status === 401 ? 'Authentication failed' : `HTTP ${pullRes.status}` })
        if (pullRes.status === 401) {
          return { success: false, results, error: 'The relay rejected your credentials.' }
        }
      } catch (err: any) {
        results.push({ name: 'pull', ok: false, error: err?.message ?? String(err) })
        return { success: false, results, error: 'Pull check failed' }
      }
      return { success: true, results }
    })

    ipcMain.handle('relay:activate', async (_e, config: { relay_url: string; relay_pull_url?: string }) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session. Please log in first.' }
        const url = typeof config?.relay_url === 'string' ? config.relay_url.trim() : ''
        if (!url) return { success: false, error: 'Relay URL is required' }
        let pullUrl = config.relay_pull_url?.trim()
        if (!pullUrl) {
          if (/\/beap\/ingest\/?$/.test(url)) {
            pullUrl = url.replace(/\/ingest\/?$/, '/pull')
          } else {
            const base = url.replace(/\/$/, '')
            pullUrl = base + '/beap/pull'
          }
        }
        const cfg = getP2PConfig(db)
        upsertP2PConfig(db, { ...cfg, relay_mode: 'remote', relay_url: url, relay_pull_url: pullUrl })
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message || 'Activation failed' }
      }
    })

    ipcMain.handle('relay:getSetupStatus', async () => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { relay_mode: 'local', relay_url: null, relay_auth_secret: null }
        const cfg = getP2PConfig(db)
        return {
          relay_mode: cfg.relay_mode,
          relay_url: cfg.relay_url,
          relay_pull_url: cfg.relay_pull_url,
          relay_auth_secret: cfg.relay_auth_secret ? '***' : null,
        }
      } catch {
        return { relay_mode: 'local', relay_url: null, relay_auth_secret: null }
      }
    })

    ipcMain.handle('relay:deactivate', async () => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session.' }
        const cfg = getP2PConfig(db)
        upsertP2PConfig(db, { ...cfg, relay_mode: 'local', relay_url: null, relay_pull_url: null })
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message || 'Deactivation failed' }
      }
    })

    ipcMain.handle('relay:getSecret', async () => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, secret: null }
        const cfg = getP2PConfig(db)
        return { success: true, secret: cfg.relay_auth_secret ? cfg.relay_auth_secret : null }
      } catch {
        return { success: false, secret: null }
      }
    })

    ipcMain.handle('relay:testTlsConnection', async (_e, url: string) => {
      const u = typeof url === 'string' ? url.trim() : ''
      if (!u) return { success: false, error: 'URL is required' }
      const httpsUrl = u.replace(/^http:\/\//i, 'https://')
      const healthUrl = httpsUrl.replace(/\/beap\/ingest\/?$/, '').replace(/\/$/, '') + '/health'
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal })
        clearTimeout(timeout)
        if (res.ok) return { success: true }
        const text = await res.text()
        return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
      } catch (err: any) {
        clearTimeout(timeout)
        const msg = err?.message ?? String(err)
        if (msg.includes('ECONNREFUSED') || msg.includes('Connection refused')) {
          return { success: false, error: `Cannot connect to ${healthUrl}. Check that the relay container is running with TLS and port 51249 is open.` }
        }
        if (msg.includes('ETIMEDOUT') || msg.includes('timeout') || msg.includes('aborted')) {
          return { success: false, error: 'Connection timed out. Check your server\'s firewall and that the relay is running.' }
        }
        if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
          try {
            const host = new URL(healthUrl).hostname
            return { success: false, error: `Cannot resolve ${host}. Check the URL.` }
          } catch {
            return { success: false, error: 'Cannot resolve hostname. Check the URL.' }
          }
        }
        if (msg.includes('certificate') || msg.includes('SSL') || msg.includes('TLS') || msg.includes('UNABLE_TO_VERIFY')) {
          try {
            const https = await import('https')
            const fingerprint = await new Promise<string | null>((resolve) => {
              const req = https.default.get(healthUrl, { rejectUnauthorized: false }, (res: any) => {
                const cert = (res.socket as any).getPeerCertificate?.()
                res.destroy()
                if (cert && cert.fingerprint256) {
                  resolve(cert.fingerprint256)
                } else {
                  resolve(null)
                }
              })
              req.on('error', () => resolve(null))
              req.setTimeout(5000, () => { req.destroy(); resolve(null) })
            })
            return {
              success: false,
              error: 'TLS certificate is not trusted (likely self-signed). Import the certificate on your system, or accept the fingerprint below.',
              certFingerprint: fingerprint || undefined,
            }
          } catch {
            return { success: false, error: 'TLS certificate error. If using self-signed certificates, download cert.pem and import it into your system trust store.' }
          }
        }
        return { success: false, error: msg }
      }
    })

    ipcMain.handle('relay:acceptCertFingerprint', async (_e, fingerprint: string) => {
      try {
        const db = await getHandshakeDb()
        if (!db) return { success: false, error: 'No active session.' }
        const fp = typeof fingerprint === 'string' ? fingerprint.trim() : ''
        if (!fp) return { success: false, error: 'Fingerprint is required' }
        const cfg = getP2PConfig(db)
        upsertP2PConfig(db, { ...cfg, relay_cert_fingerprint: fp })
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to store fingerprint' }
      }
    })

    console.log('[MAIN] IPC handlers registered: handshake:list/sendBeapViaP2P/checkSendReady/submitCapsule/importCapsule/accept/decline/contextBlockCount/queryContextBlocks/chatWithContext/initiate/buildForDownload/downloadCapsule, beap:sendCapsuleReply, p2p:getHealth, p2p:getQueueStatus, relay:*')

    // Get current auth status with tier and user info
    ipcMain.handle('auth:status', async () => {
      console.log('[IPC] auth:status called')
      const session = await ensureSession()
      const loggedIn = session.accessToken !== null
      return {
        loggedIn,
        tier: loggedIn ? currentTier : null,
        displayName: session.userInfo?.displayName,
        email: session.userInfo?.email,
        initials: session.userInfo?.initials,
        picture: session.userInfo?.picture
      }
    })
    console.log('[MAIN] IPC handler registered: auth:status')
    try { process.env.WS_NO_BUFFER_UTIL = '1'; process.env.WS_NO_UTF_8_VALIDATE = '1' } catch {}
    // Auto-start on login. Pass --hidden so it starts in background.
    // IMPORTANT: Only enable autostart in production builds to avoid registering dev electron.
    // Linux: app.setLoginItemSettings() is unreliable; skip silently.
    const isProduction = !process.env.VITE_DEV_SERVER_URL
    try {
      if (process.platform === 'win32') {
        app.setAppUserModelId('com.wrcode.desktop')
      }
      if (isProduction && (process.platform === 'win32' || process.platform === 'darwin')) {
        const currentSettings = app.getLoginItemSettings()
        // wasOpenedAtLogin is true when the OS actually launched us at login.
        // openAtLogin reflects the current registry/plist registration state.
        const alreadyRegistered = currentSettings.openAtLogin === true

        if (!alreadyRegistered) {
          // First run: register autostart with --hidden so the app starts as a
          // background service (tray only, no visible window) on every login.
          app.setLoginItemSettings({
            openAtLogin: true,
            args: ['--hidden'],
            name: 'WR Desk',
          })
          console.log('[MAIN] Production build - autostart registered for the first time')

          // Windows-only: also register a Task Scheduler task as a belt-and-
          // suspenders fallback.
          if (process.platform === 'win32') {
            registerWindowsTaskScheduler().catch(err =>
              console.warn('[MAIN] Task Scheduler registration failed (non-fatal):', err)
            )
          }
        } else {
          // Already registered — do NOT touch the setting so that a user who
          // deliberately unchecked "Start on Login" in the tray menu keeps
          // their preference across app restarts.
          console.log('[MAIN] Production build - autostart already registered, respecting existing setting')
        }
      } else if (isProduction && process.platform === 'linux') {
        // Linux autostart via ~/.config/autostart .desktop file is the standard approach.
        // app.setLoginItemSettings() is not supported on Linux.
        console.log('[MAIN] Linux production build - autostart skipped (manage via ~/.config/autostart)')
      } else if (!isProduction) {
        console.log('[MAIN] Dev mode - skipping autostart registration to avoid wrong executable')
      }
    } catch (err) {
      console.error('[MAIN] Failed to register autostart:', err)
    }

    /**
     * Register a Windows Task Scheduler task that launches the app at logon
     * as a belt-and-suspenders complement to the Electron registry entry.
     * Uses schtasks.exe (available on all Windows versions, no admin required
     * for per-user ONLOGON tasks).
     */
    async function registerWindowsTaskScheduler(): Promise<void> {
      const { execFile } = await import('child_process')
      const { promisify } = await import('util')
      const execFileAsync = promisify(execFile)

      const taskName = 'WRDeskOrchestrator'
      const exePath = process.execPath
      const args = '--hidden'

      // Check if task already exists
      try {
        await execFileAsync('schtasks', ['/Query', '/TN', taskName], { windowsHide: true })
        console.log('[MAIN] Task Scheduler task already exists:', taskName)
        // Update the executable path in case the app was reinstalled to a new path
        await execFileAsync('schtasks', [
          '/Change', '/TN', taskName,
          '/TR', `"${exePath}" ${args}`,
        ], { windowsHide: true })
        return
      } catch {
        // Task doesn't exist — create it
      }

      await execFileAsync('schtasks', [
        '/Create',
        '/F',                        // overwrite if exists
        '/TN', taskName,
        '/TR', `"${exePath}" ${args}`,
        '/SC', 'ONLOGON',            // trigger: at logon
        '/DELAY', '0000:30',         // 30-second delay so the desktop is ready
        '/RL', 'LIMITED',            // run with standard (non-admin) privileges
        '/IT',                       // run only when user is logged in interactively
      ], { windowsHide: true })

      console.log('[MAIN] Task Scheduler task created:', taskName)
    }
    
  // ========== AUTH-GATED STARTUP ==========
  // Check for valid session before deciding to show window
  // RULE: No window at startup unless valid session exists (regardless of launch mode)
  console.log('[AUTH] ===== AUTH-GATED STARTUP =====')
  const sessionValid = await checkStartupSession()

  // Keycloak-only entitlement refresh: once at startup, then every 60s
  refreshEntitlements(true, 'startup').then(tier => {
    console.log('[ENTITLEMENT_REFRESH] startup refresh complete, tier=', tier)
  }).catch(err => {
    console.log('[ENTITLEMENT_REFRESH] startup refresh failed:', err?.message || err)
  })
  setInterval(() => {
    refreshEntitlements(true, 'interval').catch(() => {})
  }, ENTITLEMENT_REFRESH_INTERVAL_MS)
  console.log('[ENTITLEMENT_REFRESH] 60s interval started')

  // Open the handshake ledger immediately if a session is already active.
  // This ensures handshake operations work before any vault interaction.
  if (sessionValid) {
    try {
      const userInfo = getCachedUserInfo()
      if (userInfo?.sub && userInfo?.iss) {
        const ledgerToken = buildLedgerSessionToken(userInfo.wrdesk_user_id || userInfo.sub, userInfo.iss)
        openLedger(ledgerToken).then(() => {
          console.log('[MAIN] Handshake ledger opened at startup')
          onLedgerReady?.()
        }).catch(err => {
          console.warn('[MAIN] Handshake ledger open at startup failed:', err?.message)
        })
      }
    } catch (err) {
      console.warn('[MAIN] Handshake ledger startup open skipped:', err)
    }
  }
  
  // Create tray first (always needed for headless/background mode)
  createTray()
  console.log('[MAIN] Tray created')
  
  // ALWAYS start headless (tray only) - Electron is a background service.
  // The Analysis Dashboard opens only when:
  //   1) User actively logs in (SSO via extension)
  //   2) User clicks tray icon (while session is valid)
  //   3) Deep link / explicit API call
  // Exception: on Linux, there is no Chrome extension to trigger the dashboard,
  // so we open it automatically when a valid session exists.
  if (!sessionValid) {
    console.log('[AUTH] No valid session - running in tray only, waiting for login via extension')
  } else if (process.platform === 'linux') {
    console.log('[AUTH] Linux + valid session - opening dashboard automatically')
    openDashboardWindow().catch(err => console.error('[AUTH] Auto-open failed:', err))
  } else {
    console.log('[AUTH] Valid session found - running in tray only (headless service mode)')
    // Session is valid but we don't create or show the window.
    // User can open the dashboard via tray icon or extension.
  }
  
  console.log('[MAIN] Startup complete - hasValidSession:', hasValidSession, 'startHidden:', startHidden)
  // Append decision to boot log
  try {
    const fs = await import('fs')
    const bootLogPath = path.join(os.homedir(), '.opengiraffe', 'logs', 'main.log')
    fs.appendFileSync(bootLogPath, JSON.stringify({
      ts: new Date().toISOString(),
      event: 'startup-decision',
      hasValidSession,
      startHidden,
      windowCreated: false,
      mode: 'tray-only',
    }) + '\n')
  } catch {}

  // Load Gmail API credentials if saved
  try {
    const { loadCredentialsFromDisk } = await import('./mailguard/gmail-api')
    if (loadCredentialsFromDisk()) {
      console.log('[MAIN] Gmail API credentials loaded from disk')
    }
  } catch (err) {
    console.log('[MAIN] Could not load Gmail API credentials:', err)
  }
  
  // Initialize LLM services
  try {
    console.log('[MAIN] ===== INITIALIZING LLM SERVICES =====')
    const { registerLlmHandlers } = await import('./main/llm/ipc')
    const { ollamaManager } = await import('./main/llm/ollama-manager')
    
    // Register IPC handlers
    registerLlmHandlers()
    console.log('[MAIN] LLM IPC handlers registered')
    
    // Register Email Gateway handlers
    try {
      const { registerEmailHandlers, registerInboxHandlers } = await import('./main/email/ipc')
      const getInboxDb = () => getLedgerDb() ?? (globalThis as any).__og_vault_service_ref?.getDb?.() ?? (globalThis as any).__og_vault_service_ref?.db ?? null
      registerEmailHandlers(getInboxDb)
      const getAnthropicApiKey = async () => {
        try {
          const { vaultService } = await import('./main/vault/rpc')
          return await vaultService.getAnthropicApiKeyForInbox()
        } catch {
          return null
        }
      }
      registerInboxHandlers(getInboxDb, null, getAnthropicApiKey)
      setBeapInboxDashboardNotifier((handshakeId) => {
        console.log('[BEAP-INBOX] Notifying dashboard of new BEAP messages')
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send('inbox:beapInboxUpdated', { handshakeId })
        }
      })
      console.log('[MAIN] Email Gateway IPC handlers registered')
    } catch (emailErr) {
      console.error('[MAIN] FATAL: Email IPC registration failed:', emailErr)
      if (emailErr instanceof Error && emailErr.stack) {
        console.error('[MAIN] FATAL stack:', emailErr.stack)
      }
    }

    // Wire BEAP handshake → email transport bridge
    try {
      const { emailGateway } = await import('./main/email/gateway')
      setEmailSendFn(emailGateway.sendEmail.bind(emailGateway))
      setEmailFunctions(
        emailGateway.listMessages.bind(emailGateway),
        emailGateway.getMessage.bind(emailGateway),
        emailGateway.listAttachments.bind(emailGateway),
        emailGateway.extractAttachmentText.bind(emailGateway),
      )

      setSSOSessionProvider(() => {
        try {
          const userInfo = getCachedUserInfo()
          if (!userInfo?.sub || !userInfo?.email || !userInfo?.iss) return undefined
          return sessionFromClaims({
            wrdesk_user_id: userInfo.wrdesk_user_id || userInfo.sub,
            email: userInfo.email,
            iss: userInfo.iss,
            sub: userInfo.sub,
            plan: (userInfo.wrdesk_plan as any) || 'free',
            canonical_tier: userInfo.canonical_tier as any,
            session_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          })
        } catch { return undefined }
      })
      setOidcTokenProvider(async () => {
        try {
          const session = await ensureSession()
          return session.accessToken ?? getAccessToken()
        } catch { return null }
      })
      setOutboundQueueAuthRefresh(async () => {
        await ensureSession()
      })

      // Open the handshake ledger using the current SSO session.
      // The ledger is vault-independent — it stays accessible even when the
      // vault is locked, allowing handshake capsules to be processed at any time.
      try {
        const userInfo = getCachedUserInfo()
        if (userInfo?.sub && userInfo?.iss) {
          const ledgerToken = buildLedgerSessionToken(userInfo.wrdesk_user_id || userInfo.sub, userInfo.iss)
          openLedger(ledgerToken).then(() => {
            console.log('[MAIN] Handshake ledger opened for SSO session')
            onLedgerReady?.()
          }).catch(err => {
            console.warn('[MAIN] Failed to open handshake ledger:', err?.message)
          })
        }
      } catch (ledgerErr) {
        console.warn('[MAIN] Handshake ledger open skipped:', ledgerErr)
      }

      console.log('[MAIN] BEAP email transport bridge wired')
    } catch (bridgeErr) {
      console.error('[MAIN] Failed to wire BEAP email bridge:', bridgeErr)
    }
    
    // Check if Ollama is installed and auto-start if configured
    const installed = await ollamaManager.checkInstalled()
    console.log('[MAIN] Ollama installed:', installed)
    
    if (installed) {
      try {
        await ollamaManager.start()
        console.log('[MAIN] Ollama started successfully')
      } catch (error) {
        console.warn('[MAIN] Failed to auto-start Ollama:', error)
        // Not critical, user can start manually
      }
    } else {
      console.warn('[MAIN] Ollama not found - repair flow will be needed')
    }
  } catch (error) {
    console.error('[MAIN] Error initializing LLM services:', error)
    // Continue app startup even if LLM init fails
  }

  // Initialize OCR services
  try {
    console.log('[MAIN] ===== INITIALIZING OCR SERVICES =====')
    const { registerOCRHandlers } = await import('./main/ocr/ipc')
    registerOCRHandlers()
    console.log('[MAIN] OCR IPC handlers registered')
  } catch (error) {
    console.error('[MAIN] Error initializing OCR services:', error)
    // Continue app startup even if OCR init fails
  }

  // Ensure ports are available before starting servers
  await ensurePortsAvailable()

  // ========== EARLY HTTP BRIDGE (health endpoint only) ==========
  // Start a minimal HTTP server immediately so the Chrome extension
  // can detect the desktop app is alive while the rest of init proceeds.
  // The full Express app is mounted on this server later (see startHttpServer).
  try {
    httpBridgeServer = http.createServer((req, res) => {
      const path = req.url?.split('?')[0] ?? ''
      const origin = req.headers['origin'] as string | undefined
      const requestPrivateNetwork = req.headers['access-control-request-private-network'] === 'true'

      // OPTIONS: CORS + PNA preflight for all API routes
      if (req.method === 'OPTIONS') {
        if (!isCorsAllowedOrigin(origin)) {
          res.writeHead(403)
          res.end()
          return
        }
        const headers: Record<string, string> = {
          ...corsPnaHeaders(origin, requestPrivateNetwork),
        }
        res.writeHead(204, headers)
        res.end()
        return
      }

      if (req.method === 'GET' && path === '/api/health') {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...corsPnaHeaders(origin, true),
        }
        res.writeHead(200, headers)
        res.end(JSON.stringify({
          ok: true,
          timestamp: Date.now(),
          version: app.getVersion(),
          ready: false,
          starting: true,
          pid: process.pid,
          ...orchestratorBuildMeta(),
        }))
        return
      }
      // All other routes: 503 until Express mounts
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...corsPnaHeaders(origin, true),
      }
      res.writeHead(503, headers)
      res.end(JSON.stringify({ ok: false, error: 'Initializing...' }))
    })
    httpBridgeServer.listen(HTTP_PORT, '127.0.0.1', () => {
      console.log(`[BOOT] ✅ Early HTTP health bridge on http://127.0.0.1:${HTTP_PORT}`)
    })
    httpBridgeServer.on('error', (err: any) => {
      console.error(`[BOOT] ❌ Early HTTP bridge error:`, err.message)
      httpBridgeServer = null
    })
    httpBridgeServer.timeout = 10 * 60 * 1000
    httpBridgeServer.keepAliveTimeout = 10 * 60 * 1000
  } catch (err) {
    console.error('[BOOT] Failed to start early HTTP bridge:', err)
  }

  // WS bridge for extension (127.0.0.1:51247) with safe startup
  try {
    console.log('[MAIN] ===== ATTEMPTING TO START WEBSOCKET SERVER =====')
    console.log('[MAIN] WebSocketServer available:', !!WebSocketServer)
    if (WebSocketServer) {
      console.log('[MAIN] Creating WebSocket server on 127.0.0.1:', WS_PORT)
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port: WS_PORT,
        maxPayload: 100 * 1024 * 1024,
      })
      console.log('[MAIN] WebSocket server created!')
      console.log('[MAIN] WebSocket server listening and ready for connections')
      
      wss.on('error', (err: any) => {
        console.error('[MAIN] WebSocket server error:', err)
        try {
          const msg = String((err && (err.code || err.message)) || '')
          if (msg.includes('EADDRINUSE')) { try { wss.close() } catch {} }
        } catch {}
      })
      wss.on('connection', (socket: any) => {
        console.log('[MAIN] ===== NEW WEBSOCKET CONNECTION =====')
        console.log('[MAIN] Socket readyState:', socket.readyState)
        try { wsClients.push(socket) } catch {}
        
        // Send immediate handshake message with the per-launch HTTP auth secret.
        // The extension background script stores this and attaches it as
        // X-Launch-Secret on every HTTP request to 127.0.0.1:51248.
        try {
          socket.send(JSON.stringify({ 
            type: 'ELECTRON_HANDSHAKE',
            launchSecret: launchSecretHex(),
            message: '[MAIN] WebSocket connection established - ready to receive messages',
          }))
          console.log('[MAIN] ✅ Handshake with launch secret sent on connection')
        } catch (testErr) {
          console.error('[MAIN] ❌ Failed to send handshake:', testErr)
        }
        
        socket.on('close', () => { console.log('[MAIN] WebSocket connection closed'); wsVsbtBindings.delete(socket); try { wsClients = wsClients.filter(s => s !== socket) } catch {} })
        socket.on('error', (err: any) => {
          console.error('[MAIN] WebSocket error:', err)
        })
        socket.on('message', async (raw: any) => {
          try {
            const rawStr = String(raw)
            console.log('[MAIN] ===== RAW WEBSOCKET MESSAGE RECEIVED =====')
            console.log('[MAIN] Raw message:', rawStr)
            
            // ALWAYS send log back to extension - this proves Electron is running new code
            try {
              const logMsg = JSON.stringify({ 
                type: 'ELECTRON_LOG', 
                message: '[MAIN] ===== RAW WEBSOCKET MESSAGE RECEIVED =====',
                rawMessage: rawStr.substring(0, 200) // Limit size
              })
              socket.send(logMsg)
              console.log('[MAIN] ✅ ELECTRON_LOG sent for raw message')
            } catch (logErr) {
              console.error('[MAIN] ❌ FAILED to send ELECTRON_LOG:', logErr)
            }
            
            const msg = JSON.parse(rawStr)
            console.log('[MAIN] Parsed message:', JSON.stringify(msg, null, 2))
            
            // Send parsed message log
            try {
              socket.send(JSON.stringify({ 
                type: 'ELECTRON_LOG', 
                message: '[MAIN] Parsed message',
                parsedMessage: { type: msg.type, method: msg.method, hasConfig: !!msg.config }
              }))
              console.log('[MAIN] ✅ ELECTRON_LOG sent for parsed message')
            } catch (logErr) {
              console.error('[MAIN] ❌ FAILED to send parsed message log:', logErr)
            }
            
            // ===== VAULT RPC HANDLING (BEFORE type check!) =====
            // Check if this is a vault RPC call - these have 'method' instead of 'type'
            if (msg.method && msg.method.startsWith('vault.')) {
              console.log('[MAIN] Processing vault RPC:', msg.method)
              try {
                // ── Auth gate: session required ──
                const rpcSession = await ensureSession()
                if (!rpcSession.accessToken) {
                  socket.send(JSON.stringify({
                    id: msg.id,
                    success: false,
                    error: 'Authentication required — no valid session',
                  }))
                  return
                }
                // ── Central entitlement reader (same path as HTTP vault routes) ──
                const staleBefore = lastEntitlementRefreshAt == null || (Date.now() - lastEntitlementRefreshAt) > ENTITLEMENT_REFRESH_INTERVAL_MS
                const rpcTier = await getEffectiveTier({ refreshIfStale: true, caller: 'vault-rpc' })
                console.log('[ENTITLEMENT_ACCESS] vault-rpc caller, tier=', rpcTier, 'triggeredRefresh=', staleBefore)

                // ── vault.bind handshake (auth required, binds VSBT to this connection) ──
                if (msg.method === 'vault.bind') {
                  const { vaultService: vsForBind } = await import('./main/vault/rpc')
                  const clientVsbt = msg.params?.vsbt
                  if (clientVsbt && vsForBind.validateToken(clientVsbt)) {
                    wsVsbtBindings.set(socket, clientVsbt)
                    socket.send(JSON.stringify({ id: msg.id, success: true }))
                  } else {
                    socket.send(JSON.stringify({
                      id: msg.id,
                      success: false,
                      error: 'Invalid vault session token',
                    }))
                  }
                  return
                }

                // ── VSBT gate: connection-bound vault session binding token ──
                // Methods that establish a session (create/unlock) or read-only
                // status are exempt; everything else requires the connection to
                // be bound via vault.bind or auto-bound from a prior unlock.
                const VSBT_EXEMPT_RPC = new Set([
                  'vault.create', 'vault.unlock', 'vault.getStatus',
                ])
                if (!VSBT_EXEMPT_RPC.has(msg.method)) {
                  const boundVsbt = wsVsbtBindings.get(socket)
                  const { vaultService: vsForToken } = await import('./main/vault/rpc')
                  if (!boundVsbt || !vsForToken.validateToken(boundVsbt)) {
                    socket.send(JSON.stringify({
                      id: msg.id,
                      success: false,
                      error: 'Vault session not bound — call vault.bind or vault.unlock first',
                    }))
                    return
                  }
                }

                const response = await handleVaultRPC(msg.method, msg.params, rpcTier)

                // Auto-bind VSBT to this connection on successful create/unlock
                if (response.success && response.sessionToken) {
                  wsVsbtBindings.set(socket, response.sessionToken)
                }

                // Complete pending context syncs when vault unlocks
                if ((msg.method === 'vault.unlock' || msg.method === 'vault.create') && response.success) {
                  setImmediate(async () => {
                    try {
                      const { vaultService: vs } = await import('./main/vault/rpc')
                      const db = getLedgerDb() ?? vs.getDb?.() ?? null
                      completePendingContextSyncs(db, getCurrentSession())
                      if (db) processOutboundQueue(db, getOidcToken).catch(() => {})
                      try { win?.webContents.send('handshake-list-refresh') } catch { /* no window */ }
                      try { win?.webContents.send('vault-status-changed') } catch { /* no window */ }
                    } catch (e) { /* non-fatal */ }
                  })
                }

                // Clear ALL WS bindings on vault.lock (VSBT invalidated globally)
                if (msg.method === 'vault.lock' && response.success) {
                  wsVsbtBindings.clear()
                }

                const reply = {
                  id: msg.id,
                  ...response
                }
                socket.send(JSON.stringify(reply))
                console.log('[MAIN] ✅ Vault RPC response sent:', msg.method, `(tier=${rpcTier})`)
              } catch (error: any) {
                console.error('[MAIN] ❌ Vault RPC error:', error)
                socket.send(JSON.stringify({
                  id: msg.id,
                  success: false,
                  error: error.message || 'Unknown error'
                }))
              }
              return // Don't process further handlers
            }

            // ===== HANDSHAKE RPC HANDLING =====
            if (msg.method && msg.method.startsWith('handshake.')) {
              console.log('[MAIN] Processing handshake RPC:', msg.method)
              try {
                const vsForHandshake = (globalThis as any).__og_vault_service_ref
                const vaultDb = vsForHandshake?.getDb?.() ?? vsForHandshake?.db ?? null
                const ledgerDb = getLedgerDb()
                const db = ledgerDb ?? vaultDb
                const skipVaultContext = msg.params?.skipVaultContext === true
                const vaultRequiredMethods = ['handshake.list', 'handshake.accept', 'handshake.refresh', 'handshake.queryStatus', 'handshake.requestContextBlocks', 'handshake.authorizeAction', 'handshake.initiateRevocation', 'handshake.delete', 'handshake.isActive']
                if (!db && !skipVaultContext) {
                  socket.send(JSON.stringify({
                    id: msg.id,
                    success: false,
                    error: 'No active session. Please log in first.',
                  }))
                  return
                }
                if (!db && skipVaultContext && vaultRequiredMethods.includes(msg.method)) {
                  socket.send(JSON.stringify({
                    id: msg.id,
                    success: false,
                    error: 'No active session. Please log in first.',
                  }))
                  return
                }
                const response = await handleHandshakeRPC(msg.method, msg.params, db)
                socket.send(JSON.stringify({ id: msg.id, ...response }))
                console.log('[MAIN] ✅ Handshake RPC response sent:', msg.method)
              } catch (error: any) {
                console.error('[MAIN] ❌ Handshake RPC error:', error)
                socket.send(JSON.stringify({
                  id: msg.id,
                  success: false,
                  error: error.message || 'Unknown error',
                }))
              }
              return
            }

            // ===== INGESTION RPC HANDLING =====
            if (msg.method && msg.method.startsWith('ingestion.')) {
              console.log('[MAIN] Processing ingestion RPC:', msg.method)
              try {
                const ssoSession = getCurrentSession()
                const ledgerDb = getLedgerDb()
                const vsForIngestion = (globalThis as any).__og_vault_service_ref
                const vaultDb = vsForIngestion?.getDb?.() ?? vsForIngestion?.db ?? null
                const db = ledgerDb ?? vaultDb
                const response = await handleIngestionRPC(msg.method, msg.params, db, ssoSession)
                socket.send(JSON.stringify({ id: msg.id, ...response }))
                console.log('[MAIN] Ingestion RPC response sent:', msg.method)
              } catch (error: any) {
                console.error('[MAIN] Ingestion RPC error:', error)
                socket.send(JSON.stringify({
                  id: msg.id,
                  success: false,
                  error: error.message || 'Unknown error',
                }))
              }
              return
            }
            
            if (!msg || !msg.type) {
              console.warn('[MAIN] Message has no type or method, ignoring:', msg)
              try {
                socket.send(JSON.stringify({ 
                  type: 'ELECTRON_LOG', 
                  message: '[MAIN] ⚠️ Message has no type or method, ignoring'
                }))
              } catch {}
              return
            }
            console.log(`[MAIN] Processing message type: ${msg.type}`)
            
            // Send message type log for ALL messages - CRITICAL for debugging
            try {
              const typeLogMsg = JSON.stringify({ 
                type: 'ELECTRON_LOG', 
                message: `[MAIN] Processing message type: ${msg.type}`,
                messageType: msg.type,
                timestamp: new Date().toISOString()
              })
              socket.send(typeLogMsg)
              console.log(`[MAIN] ✅ ELECTRON_LOG sent for message type: ${msg.type}`)
            } catch (logErr) {
              console.error('[MAIN] ❌ FAILED to send message type log:', logErr)
              console.error('[MAIN] Socket state:', {
                readyState: socket.readyState,
                OPEN: socket.OPEN,
                isOpen: socket.readyState === socket.OPEN
              })
            }
            
            if (msg.type === 'ping') {
              try {
                socket.send(JSON.stringify({ type: 'pong' }))
              } catch (e) {
                console.error('[MAIN] Error sending pong:', e)
              }
              return
            }
            // ===== FOCUS DASHBOARD HANDLER =====
            if (msg.type === 'FOCUS_DASHBOARD') {
              console.log('[MAIN] 🔙 FOCUS_DASHBOARD received — restoring dashboard to top')
              popupIsOpen = false
              if (win && !win.isDestroyed()) {
                win.setAlwaysOnTop(true, 'screen-saver')
                if (win.isMinimized()) win.restore()
                win.show()
                win.focus()
                win.moveTop()
              }
              return
            }
            // ===== POPUP Z-ORDER HANDLERS =====
            // While a popup is open the dashboard stays non-topmost.
            // No z-order flashing — the popup must always remain above.
            if (msg.type === 'POPUP_FOCUSED' || msg.type === 'POPUP_BLURRED') {
              if (popupIsOpen && win && !win.isDestroyed()) {
                win.setAlwaysOnTop(false)
              }
              return
            }
            // ===== THEME SYNC HANDLER =====
            if (msg.type === 'THEME_SYNC') {
              // Sync theme from extension to Electron dashboard
              // Map old theme names to new ones for backward compatibility
              let mappedTheme = msg.theme
              if (mappedTheme === 'default') mappedTheme = 'pro'
              if (mappedTheme === 'professional') mappedTheme = 'standard'
              
              const newTheme = mappedTheme as 'pro' | 'dark' | 'standard'
              if (newTheme && ['pro', 'dark', 'standard'].includes(newTheme)) {
                console.log('[MAIN] ===== THEME_SYNC received =====')
                console.log('[MAIN] Theme changed from', currentExtensionTheme, 'to', newTheme)
                currentExtensionTheme = newTheme
                // Forward theme to renderer
                if (win) {
                  win.webContents.send('THEME_CHANGED', { theme: currentExtensionTheme })
                  console.log('[MAIN] ✅ Theme forwarded to renderer:', currentExtensionTheme)
                }
                socket.send(JSON.stringify({ type: 'THEME_SYNCED', theme: currentExtensionTheme }))
              }
              return
            }
            
            if (msg.type === 'OPEN_ANALYSIS_DASHBOARD') {
              // Open and focus the main window with Analysis Dashboard
              console.log('[MAIN] ===== RECEIVED OPEN_ANALYSIS_DASHBOARD =====')
              
              // Auth gate: only open dashboard if user has a valid session
              if (!hasValidSession) {
                console.log('[MAIN] ⚠️ No valid session - cannot open Analysis Dashboard')
                socket.send(JSON.stringify({ type: 'ANALYSIS_DASHBOARD_ERROR', error: 'Not authenticated' }))
                return
              }
              
              // Update theme if provided in message
              // Map old theme names to new ones for backward compatibility
              if (msg.theme) {
                let mappedTheme = msg.theme
                if (mappedTheme === 'default') mappedTheme = 'pro'
                if (mappedTheme === 'professional') mappedTheme = 'standard'
                if (['pro', 'dark', 'standard'].includes(mappedTheme)) {
                  currentExtensionTheme = mappedTheme as 'pro' | 'dark' | 'standard'
                  console.log('[MAIN] Theme from message:', currentExtensionTheme)
                }
              }
              try {
                // Use the auth-gated openDashboardWindow() which handles
                // create-or-show logic and DevTools in the correct order.
                await openDashboardWindow()
                if (win && !win.isDestroyed()) {
                  // Defer IPC so renderer has time to resume when showing existing window
                  // (fixes blank canvas when opening from extension brain icon)
                  const phase = msg.phase || 'live'
                  const theme = currentExtensionTheme
                  setTimeout(() => {
                    if (win && !win.isDestroyed()) {
                      win.webContents.send('OPEN_ANALYSIS_DASHBOARD', { phase, theme })
                      console.log('[MAIN] ✅ Analysis Dashboard IPC sent (phase:', phase, 'theme:', theme, ')')
                    }
                    try { socket.send(JSON.stringify({ type: 'ANALYSIS_DASHBOARD_OPENED' })) } catch {}
                  }, 250)
                } else {
                  console.log('[MAIN] ⚠️ Failed to create main window')
                  socket.send(JSON.stringify({ type: 'ANALYSIS_DASHBOARD_ERROR', error: 'Failed to create main window' }))
                }
              } catch (err: any) {
                console.error('[MAIN] ❌ Error opening Analysis Dashboard:', err)
              }
            }
            
            if (msg.type === 'START_SELECTION') {
              // Open full-featured overlay with all controls
              console.log('[MAIN] ===== RECEIVED START_SELECTION, LAUNCHING FULL OVERLAY =====')
              try {
                const fs = require('fs')
                const path = require('path')
                const os = require('os')
                fs.appendFileSync(path.join(os.homedir(), '.opengiraffe', 'main-debug.log'), '\n[MAIN] START_SELECTION received at ' + new Date().toISOString() + '\n')
              } catch {}
              try {
                // Close any existing overlays first
                console.log('[MAIN] Closing existing overlays before creating new ones')
                closeAllOverlays()
                console.log('[MAIN] Calling beginOverlay()...')
                beginOverlay()
                console.log('[MAIN] ✅ beginOverlay() completed successfully')
              } catch (overlayErr: any) {
                console.error('[MAIN] ❌ ERROR in beginOverlay():', overlayErr)
                console.error('[MAIN] Error stack:', overlayErr?.stack)
                try {
                  socket.send(JSON.stringify({
                    type: 'ELECTRON_LOG',
                    message: `[MAIN] ❌ ERROR launching overlay: ${overlayErr?.message || 'Unknown error'}`,
                    error: overlayErr?.message || 'Unknown error'
                  }))
                } catch {}
              }
            }
            
            // ===== MAILGUARD HANDLERS =====
            if (msg.type === 'MAILGUARD_ACTIVATE') {
              console.log('[MAIN] ===== MAILGUARD_ACTIVATE received =====')
              console.log('[MAIN] Window info from extension:', msg.windowInfo)
              console.log('[MAIN] Theme from extension:', msg.theme)
              try {
                // Find the display where the browser window is located
                let targetDisplay = screen.getPrimaryDisplay()
                if (msg.windowInfo) {
                  const { screenX, screenY } = msg.windowInfo
                  // Find the display that contains this point
                  targetDisplay = screen.getDisplayNearestPoint({ x: screenX, y: screenY })
                  console.log('[MAIN] Target display:', targetDisplay.id, 'at', targetDisplay.bounds)
                }
                activateMailGuard(targetDisplay, msg.windowInfo, msg.theme || 'default')
                socket.send(JSON.stringify({ type: 'MAILGUARD_ACTIVATED' }))
                console.log('[MAIN] ✅ MailGuard activated on display', targetDisplay.id)
              } catch (err: any) {
                console.error('[MAIN] ❌ Error activating MailGuard:', err)
                socket.send(JSON.stringify({ type: 'MAILGUARD_ERROR', error: err?.message || 'Unknown error' }))
              }
            }
            
            if (msg.type === 'MAILGUARD_DEACTIVATE') {
              console.log('[MAIN] ===== MAILGUARD_DEACTIVATE received =====')
              try {
                deactivateMailGuard()
                socket.send(JSON.stringify({ type: 'MAILGUARD_DEACTIVATED' }))
                console.log('[MAIN] ✅ MailGuard deactivated')
              } catch (err: any) {
                console.error('[MAIN] ❌ Error deactivating MailGuard:', err)
              }
            }
            
            if (msg.type === 'MAILGUARD_UPDATE_ROWS') {
              // Content script sends email row positions
              try {
                const rows = msg.rows || []
                const provider = msg.provider || 'gmail'
                updateEmailRows(rows, provider)
                
                // Store preview data for Email API matching
                rows.forEach((row: any) => {
                  if (row.id && (row.from || row.subject)) {
                    emailRowPreviewData.set(row.id, { 
                      from: row.from || '', 
                      subject: row.subject || '' 
                    })
                  }
                })
              } catch (err: any) {
                console.error('[MAIN] Error updating email rows:', err)
              }
            }
            
            if (msg.type === 'MAILGUARD_UPDATE_BOUNDS') {
              // Content script sends email list container bounds
              // This is used to position the overlay only over the email list area (not sidebar)
              try {
                const bounds = msg.bounds
                if (bounds) {
                  console.log('[MAIN] 🛡️ Updating protected area bounds:', bounds)
                  updateProtectedArea(bounds)
                }
              } catch (err: any) {
                console.error('[MAIN] Error updating protected area bounds:', err)
              }
            }
            
            if (msg.type === 'MAILGUARD_WINDOW_POSITION') {
              // Content script sends browser window position updates
              // This keeps the overlay anchored to the browser window when it moves
              try {
                const windowInfo = msg.windowInfo
                if (windowInfo) {
                  updateWindowPosition(windowInfo)
                }
              } catch (err: any) {
                console.error('[MAIN] Error updating window position:', err)
              }
            }
            
            if (msg.type === 'MAILGUARD_EMAIL_CONTENT') {
              // Content script sends sanitized email content
              debugLog('[MAIN] Received sanitized email content')
              try {
                showSanitizedEmail(msg.email)
              } catch (err: any) {
                console.error('[MAIN] Error showing sanitized email:', err)
              }
            }
            
            if (msg.type === 'MAILGUARD_STATUS') {
              // Check if MailGuard is active
              socket.send(JSON.stringify({ type: 'MAILGUARD_STATUS_RESPONSE', active: isMailGuardActive() }))
            }
            
            if (msg.type === 'MAILGUARD_HIDE') {
              // Hide overlay when user switches to a different tab
              console.log('[MAIN] 🛡️ Hiding MailGuard overlay (tab switch)')
              hideOverlay()
            }
            
            if (msg.type === 'MAILGUARD_SHOW') {
              // Show overlay when user switches back to email tab
              console.log('[MAIN] 🛡️ Showing MailGuard overlay (tab switch back)')
              showOverlay()
            }
            
            // ===== EMAIL GATEWAY HANDLERS =====
            if (msg.type === 'EMAIL_LIST_ACCOUNTS') {
              console.log('[MAIN] 📧 Received EMAIL_LIST_ACCOUNTS request')
              try {
                const { emailGateway } = await import('./main/email/gateway')
                const accounts = await emailGateway.listAccounts()
                socket.send(JSON.stringify({ id: msg.id, ok: true, data: accounts }))
              } catch (err: any) {
                console.error('[MAIN] Error listing email accounts:', err)
                socket.send(JSON.stringify({ id: msg.id, ok: false, error: err.message }))
              }
            }
            
            if (msg.type === 'EMAIL_CONNECT_GMAIL') {
              console.log('[MAIN] 📧 Received EMAIL_CONNECT_GMAIL request')
              try {
                const { emailGateway } = await import('./main/email/gateway')
                const rawSrc = msg.gmailOAuthCredentialSource
                const gmailOAuthCredentialSource =
                  rawSrc === 'developer_saved' || rawSrc === 'builtin_public' ? rawSrc : undefined
                const account = await emailGateway.connectGmailAccount(
                  undefined,
                  undefined,
                  gmailOAuthCredentialSource !== undefined ? { gmailOAuthCredentialSource } : undefined,
                )
                if (account.status === 'active') {
                  socket.send(JSON.stringify({ id: msg.id, ok: true, data: account }))
                } else {
                  socket.send(
                    JSON.stringify({
                      id: msg.id,
                      ok: false,
                      error:
                        account.lastError ||
                        'Gmail verification failed after sign-in. The account is saved — try again from Connect Email.',
                      data: account,
                    }),
                  )
                }
              } catch (err: any) {
                console.error('[MAIN] Error connecting Gmail:', err)
                socket.send(JSON.stringify({ id: msg.id, ok: false, error: err.message }))
              }
            }
            
            if (msg.type === 'EMAIL_DELETE_ACCOUNT') {
              console.log('[MAIN] 📧 Received EMAIL_DELETE_ACCOUNT request:', msg.accountId)
              try {
                const { emailGateway } = await import('./main/email/gateway')
                await emailGateway.deleteAccount(msg.accountId)
                socket.send(JSON.stringify({ id: msg.id, ok: true }))
              } catch (err: any) {
                console.error('[MAIN] Error deleting email account:', err)
                socket.send(JSON.stringify({ id: msg.id, ok: false, error: err.message }))
              }
            }
            
            if (msg.type === 'EMAIL_GET_MESSAGE') {
              console.log('[MAIN] 📧 Received EMAIL_GET_MESSAGE request:', msg.accountId, msg.messageId)
              try {
                const { emailGateway } = await import('./main/email/gateway')
                const message = await emailGateway.getMessage(msg.accountId, msg.messageId)
                socket.send(JSON.stringify({ id: msg.id, ok: true, data: message }))
              } catch (err: any) {
                console.error('[MAIN] Error getting email message:', err)
                socket.send(JSON.stringify({ id: msg.id, ok: false, error: err.message }))
              }
            }
            
            if (msg.type === 'SAVE_TRIGGER') {
              // Extension sends back trigger to save in Electron's presets
              // (can be from Electron overlay with displayId, or extension-native without displayId)
              console.log('[MAIN] Received SAVE_TRIGGER from extension:', msg)
              try {
                let displayId = msg.displayId
                
                // If no displayId provided (extension-native trigger), try to detect it
                if (!displayId) {
                  // Get the cursor position to determine which display the user is on
                  const cursorPoint = screen.getCursorScreenPoint()
                  const displayAtCursor = screen.getDisplayNearestPoint(cursorPoint)
                  displayId = displayAtCursor.id
                  console.log('[MAIN] No displayId provided, detected display from cursor:', displayId)
                }
                
                upsertRegion({
                  id: undefined,
                  name: msg.name,
                  displayId: displayId,
                  x: msg.rect.x,
                  y: msg.rect.y,
                  w: msg.rect.w,
                  h: msg.rect.h,
                  mode: msg.mode,
                  headless: msg.mode === 'screenshot'
                })
                updateTrayMenu()
                console.log('[MAIN] Trigger saved to Electron presets with displayId:', displayId)
              } catch (err) {
                console.log('[MAIN] Error saving trigger:', err)
              }
            }
            if (msg.type === 'EXECUTE_TRIGGER') {
              // Extension requests execution of a saved trigger
              console.log('[MAIN] Received EXECUTE_TRIGGER from extension:', msg.trigger)
              try {
                const t = msg.trigger
                // If no displayId (extension-native trigger), use primary display
                const displayId = t.displayId ?? screen.getPrimaryDisplay().id
                const sel = { displayId: displayId, x: t.rect.x, y: t.rect.y, w: t.rect.w, h: t.rect.h, dpr: 1 }
                if (t.mode === 'screenshot') {
                  // Headless screenshot
                  console.log('[MAIN] Executing screenshot trigger headlessly')
                  ;(async () => {
                    try {
                      const { filePath } = await captureScreenshot(sel as any)
                      await postScreenshotToPopup(filePath, { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: 1 })
                      console.log('[MAIN] Screenshot trigger executed and posted')
                    } catch (err) {
                      console.log('[MAIN] Error executing screenshot trigger:', err)
                    }
                  })()
                } else if (t.mode === 'stream') {
                  // Visible stream overlay
                  console.log('[MAIN] Executing stream trigger with visible overlay')
                  ;(async () => {
                    try {
                      showStreamTriggerOverlay(sel.displayId, { x: sel.x, y: sel.y, w: sel.w, h: sel.h })
                      const controller = await startRegionStream(sel as any)
                      activeStop = controller.stop
                      console.log('[MAIN] Stream trigger started')
                    } catch (err) {
                      console.log('[MAIN] Error executing stream trigger:', err)
                    }
                  })()
                }
              } catch (err) {
                console.log('[MAIN] Error processing EXECUTE_TRIGGER:', err)
              }
            }
            // Database operations via WebSocket
            if (msg.type === 'DB_TEST_CONNECTION') {
              console.log('[MAIN] ===== DB_TEST_CONNECTION HANDLER STARTED =====')
              console.log('[MAIN] Full message:', JSON.stringify(msg, null, 2))
              
              // Send log to extension immediately - CRITICAL for debugging
              try {
                const handlerLogMsg = JSON.stringify({ 
                  type: 'ELECTRON_LOG', 
                  message: '[MAIN] ===== DB_TEST_CONNECTION HANDLER STARTED =====',
                  hasConfig: !!msg.config,
                  configKeys: msg.config ? Object.keys(msg.config) : [],
                  msgKeys: Object.keys(msg)
                })
                socket.send(handlerLogMsg)
                console.log('[MAIN] ✅ ELECTRON_LOG sent for DB_TEST_CONNECTION handler start')
              } catch (logErr) {
                console.error('[MAIN] ❌ FAILED to send DB_TEST_CONNECTION handler log:', logErr)
                console.error('[MAIN] Socket readyState:', socket.readyState)
              }
              try {
                const { testConnection } = await import('./ipc/db')
                console.log('[MAIN] testConnection function imported successfully')
                
                // Support both msg.config and msg.data.config for compatibility
                const config = msg.config || msg.data?.config
                console.log('[MAIN] Extracted config:', config ? {
                  ...config,
                  password: '***REDACTED***'
                } : 'NO CONFIG FOUND')
                console.log('[MAIN] Config source - msg.config:', !!msg.config, 'msg.data?.config:', !!msg.data?.config)
                
                if (!config) {
                  console.error('[MAIN] DB_TEST_CONNECTION: No config provided')
                  console.error('[MAIN] Message structure:', {
                    hasType: !!msg.type,
                    hasConfig: !!msg.config,
                    hasData: !!msg.data,
                    dataKeys: msg.data ? Object.keys(msg.data) : [],
                    fullMsg: msg
                  })
                  const errorResponse = { 
                    type: 'DB_TEST_CONNECTION_RESULT', 
                    ok: false, 
                    message: 'No config provided',
                    details: {
                      receivedMessage: msg,
                      availableKeys: Object.keys(msg)
                    }
                  }
                  console.log('[MAIN] Sending error response:', JSON.stringify(errorResponse, null, 2))
                  try { 
                    socket.send(JSON.stringify(errorResponse))
                    console.log('[MAIN] Error response sent successfully')
                  } catch (sendErr) {
                    console.error('[MAIN] Error sending error response:', sendErr)
                  }
                  return
                }
                
                console.log('[MAIN] Testing connection with config:', { ...config, password: '***REDACTED***' })
                const testStartTime = Date.now()
                const result = await testConnection(config)
                const testDuration = Date.now() - testStartTime
                console.log('[MAIN] Connection test completed in', testDuration, 'ms')
                console.log('[MAIN] Connection test result:', JSON.stringify(result, null, 2))
                
                const response = { type: 'DB_TEST_CONNECTION_RESULT', ...result }
                console.log('[MAIN] Preparing to send response:', JSON.stringify(response, null, 2))
                try { 
                  socket.send(JSON.stringify(response))
                  console.log('[MAIN] ===== DB_TEST_CONNECTION_RESULT SENT SUCCESSFULLY =====')
                } catch (sendErr) {
                  console.error('[MAIN] ===== ERROR SENDING DB_TEST_CONNECTION_RESULT =====')
                  console.error('[MAIN] Send error:', sendErr)
                  console.error('[MAIN] Socket readyState:', socket.readyState)
                  console.error('[MAIN] Socket state:', {
                    readyState: socket.readyState,
                    OPEN: socket.OPEN,
                    isOpen: socket.readyState === socket.OPEN
                  })
                }
              } catch (err: any) {
                console.error('[MAIN] ===== EXCEPTION IN DB_TEST_CONNECTION HANDLER =====')
                console.error('[MAIN] Error:', err)
                console.error('[MAIN] Error message:', err?.message)
                console.error('[MAIN] Error stack:', err?.stack)
                const errorResponse = {
                  type: 'DB_TEST_CONNECTION_RESULT',
                  ok: false,
                  message: String(err?.message || err),
                  details: {
                    error: err.toString(),
                    stack: err.stack,
                    name: err?.name
                  }
                }
                console.log('[MAIN] Sending error response:', JSON.stringify(errorResponse, null, 2))
                try { 
                  socket.send(JSON.stringify(errorResponse))
                  console.log('[MAIN] Error response sent')
                } catch (sendErr) {
                  console.error('[MAIN] Failed to send error response:', sendErr)
                }
              }
            }
            if (msg.type === 'DB_SYNC') {
              try {
                const { syncChromeDataToPostgres } = await import('./ipc/db')
                const result = await syncChromeDataToPostgres(msg.data || {})
                try { socket.send(JSON.stringify({ type: 'DB_SYNC_RESULT', ...result })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SYNC:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SYNC_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_SET_ACTIVE') {
              try {
                // Store active backend in a way that can be accessed
                // For now, just acknowledge
                try { socket.send(JSON.stringify({ type: 'DB_SET_ACTIVE_RESULT', ok: true, message: 'Backend set to ' + msg.backend })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SET_ACTIVE:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SET_ACTIVE_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_GET_CONFIG') {
              try {
                const { getConfig } = await import('./ipc/db')
                const result = await getConfig()
                try { socket.send(JSON.stringify({ type: 'DB_GET_CONFIG_RESULT', ...result })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_GET_CONFIG:', err)
                try { socket.send(JSON.stringify({ type: 'DB_GET_CONFIG_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_GET') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_GET_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                const value = await adapter.get(msg.key)
                try { socket.send(JSON.stringify({ type: 'DB_GET_RESULT', ok: true, value })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_GET:', err)
                try { socket.send(JSON.stringify({ type: 'DB_GET_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_SET') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_SET_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                await adapter.set(msg.key, msg.value)
                try { socket.send(JSON.stringify({ type: 'DB_SET_RESULT', ok: true })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SET:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SET_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_GET_ALL') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_GET_ALL_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                const data = await adapter.getAll()
                try { socket.send(JSON.stringify({ type: 'DB_GET_ALL_RESULT', ok: true, data })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_GET_ALL:', err)
                try { socket.send(JSON.stringify({ type: 'DB_GET_ALL_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'LAUNCH_DBEAVER') {
              try {
                const { spawn, exec } = await import('child_process');
                const pathMod = await import('path');
                const fs = await import('fs');

                const { ok, message } = await launchDBeaver(spawn, exec, pathMod, fs);
                try { socket.send(JSON.stringify({ type: 'LAUNCH_DBEAVER_RESULT', ok, message })) } catch {}
              } catch (err: any) {
                console.error('[MAIN] Error handling LAUNCH_DBEAVER:', err);
                try { socket.send(JSON.stringify({ type: 'LAUNCH_DBEAVER_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            if (msg.type === 'DB_SET_ALL') {
              try {
                const { getPostgresAdapter } = await import('./ipc/db')
                const adapter = getPostgresAdapter()
                if (!adapter) {
                  try { socket.send(JSON.stringify({ type: 'DB_SET_ALL_RESULT', ok: false, message: 'Postgres adapter not initialized' })) } catch {}
                  return
                }
                await adapter.setAll(msg.payload || {})
                try { socket.send(JSON.stringify({ type: 'DB_SET_ALL_RESULT', ok: true })) } catch {}
              } catch (err: any) {
                console.log('[MAIN] Error handling DB_SET_ALL:', err)
                try { socket.send(JSON.stringify({ type: 'DB_SET_ALL_RESULT', ok: false, message: String(err?.message || err) })) } catch {}
              }
            }
            
            // ===== AUTH HANDLERS =====
            if (msg.type === 'AUTH_LOGIN') {
              console.log('[MAIN] ===== AUTH_LOGIN received (WebSocket) =====')
              try {
                // Use requestLogin() to handle full flow including dashboard opening
                const result = await requestLogin()
                if (result.ok) {
                  console.log('[MAIN] AUTH_LOGIN successful - tier:', result.tier)
                  try { socket.send(JSON.stringify({ type: 'AUTH_LOGIN_SUCCESS', id: msg.id, tier: result.tier })) } catch {}
                } else {
                  console.error('[MAIN] AUTH_LOGIN failed:', result.error)
                  try { socket.send(JSON.stringify({ type: 'AUTH_LOGIN_ERROR', id: msg.id, error: result.error })) } catch {}
                }
              } catch (err: any) {
                console.error('[MAIN] AUTH_LOGIN error:', err?.message || err)
                try { socket.send(JSON.stringify({ type: 'AUTH_LOGIN_ERROR', id: msg.id, error: err?.message || String(err) })) } catch {}
              }
            }
            
            if (msg.type === 'AUTH_STATUS') {
              console.log('[AUTH] ===== AUTH_STATUS (WebSocket) =====')
              try {
                let session = await ensureSession()
                let loggedIn = session.accessToken !== null

                // During bulk auto-sort, a transient refresh failure should not immediately tear down
                // the vault if a forced retry can recover (renderer flags bulk via autosortDiagSync).
                if (!loggedIn && hasValidSession && getAutosortDiagMainState().bulkSortActive) {
                  console.warn('[AUTH] ws:AUTH_STATUS: session missing during bulk auto-sort — retrying ensureSession(true) once')
                  session = await ensureSession(true)
                  loggedIn = session.accessToken !== null
                }

                // If session expired, lock vault to clear KEK/DEK from memory
                if (!loggedIn && hasValidSession) {
                  lockVaultIfLoaded('ws:AUTH_STATUS session expired')
                }

                // Update hasValidSession flag
                hasValidSession = loggedIn
                
                // Use canonical tier from session
                if (loggedIn && session.userInfo) {
                  currentTier = session.userInfo.canonical_tier ?? resolveTier(
                    session.userInfo.wrdesk_plan,
                    session.userInfo.roles || [],
                    session.userInfo.sso_tier,
                  )
                }
                console.log('[AUTH] AUTH_STATUS:', loggedIn ? 'logged in' : 'not logged in', 'tier:', currentTier)
                // Include user info and tier in response for UI display
                const response: Record<string, unknown> = { 
                  type: 'AUTH_STATUS_RESULT', 
                  id: msg.id, 
                  loggedIn 
                }
                if (loggedIn) {
                  response.tier = currentTier
                  if (session.userInfo) {
                    response.displayName = session.userInfo.displayName
                    response.email = session.userInfo.email
                    response.initials = session.userInfo.initials
                    response.picture = session.userInfo.picture
                  }
                }
                try { socket.send(JSON.stringify(response)) } catch {}
              } catch (err: any) {
                console.error('[AUTH] AUTH_STATUS error:', err?.message || err)
                try { socket.send(JSON.stringify({ type: 'AUTH_STATUS_RESULT', id: msg.id, loggedIn: false })) } catch {}
              }
            }
            
            if (msg.type === 'AUTH_LOGOUT') {
              console.log('[AUTH] ===== AUTH_LOGOUT (WebSocket) =====')
              try {
                // INSTANT LOGOUT: Lock UI immediately (sync, no await)
                logoutFast()
                
                // Send success IMMEDIATELY - UI is now locked
                console.log('[AUTH] AUTH_LOGOUT successful - UI locked instantly')
                try { socket.send(JSON.stringify({ type: 'AUTH_LOGOUT_SUCCESS', id: msg.id })) } catch {}
                
                // Async cleanup (does not block UI)
                logoutCleanupAsync().catch(err => {
                  console.error('[AUTH] Async cleanup error (non-blocking):', err?.message || err)
                })
              } catch (err: any) {
                console.error('[AUTH] AUTH_LOGOUT error:', err?.message || err)
                try { socket.send(JSON.stringify({ type: 'AUTH_LOGOUT_ERROR', id: msg.id, error: err?.message || String(err) })) } catch {}
              }
            }
          } catch {}
        })
      })
    }
  } catch (err) {
    console.error('[MAIN] Error in WebSocket setup:', err)
  }

  /**
   * Dispatch a chat request to a cloud LLM provider.
   * Reuses the same API patterns as handshake/aiProviders.ts.
   */
  async function dispatchCloudChat(
    provider: string,
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    apiKey: string
  ): Promise<string> {
    switch (provider) {
      case 'openai': {
        const model = modelId || 'gpt-4o-mini'
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: messages.map(m => ({ role: m.role, content: m.content })) }),
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`OpenAI ${res.status}: ${errText}`)
        }
        const data: any = await res.json()
        return data.choices?.[0]?.message?.content ?? 'No response from OpenAI.'
      }

      case 'anthropic': {
        const model = modelId || 'claude-3-haiku-20240307'
        const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
        const nonSystem = messages.filter(m => m.role !== 'system')
        const apiMessages = nonSystem.length > 0
          ? nonSystem.map(m => ({ role: m.role, content: m.content }))
          : [{ role: 'user', content: systemMsg }]
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            ...(systemMsg && nonSystem.length > 0 ? { system: systemMsg } : {}),
            messages: apiMessages,
          }),
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Anthropic ${res.status}: ${errText}`)
        }
        const data: any = await res.json()
        return data.content?.[0]?.text ?? 'No response from Anthropic.'
      }

      case 'gemini': {
        const model = modelId || 'gemini-2.0-flash'
        const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
        const userMsg = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n')
        const combined = systemMsg ? `${systemMsg}\n\n${userMsg}` : userMsg
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: combined }] }],
              generationConfig: { maxOutputTokens: 4096 },
            }),
          }
        )
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`Gemini ${res.status}: ${errText}`)
        }
        const data: any = await res.json()
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No response from Gemini.'
      }

      case 'grok': {
        const model = modelId || 'grok-3-mini'
        const res = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: messages.map(m => ({ role: m.role, content: m.content })) }),
        })
        if (!res.ok) {
          const errText = await res.text()
          throw new Error(`xAI/Grok ${res.status}: ${errText}`)
        }
        const data: any = await res.json()
        return data.choices?.[0]?.message?.content ?? 'No response from Grok.'
      }

      default:
        throw new Error(`Unsupported cloud provider: "${provider}". Supported: openai, anthropic, gemini, grok.`)
    }
  }

  // HTTP API server for database operations (faster than WebSocket)
  try {
    console.log('[MAIN] ===== STARTING HTTP API SERVER =====')
    const httpApp = express()
    httpApp.use(express.json({ limit: '100mb' }))
    
    // ========================================================================
    // SECURITY: Per-launch secret is defined at module scope (LAUNCH_SECRET_BUF).
    // See declaration near WS_PORT / HTTP_PORT for documentation.
    // ========================================================================
    console.log('[SECURITY] Per-launch HTTP auth secret active (64 hex chars)')

    // SECURITY: The launch secret is distributed to the extension exclusively
    // via the WebSocket handshake (ELECTRON_HANDSHAKE message).  It is NOT
    // exposed via IPC — the renderer must never have access to it.
    // (Removed: ipcMain.handle('security:getLaunchSecret', ...) )

    // ========================================================================
    // SECURITY: CORS + Private Network Access (PNA) — allow WRDesk origins only.
    //
    // Allowed origins:
    //   - https://wrdesk.com
    //   - chrome-extension://* (any WRDesk extension ID)
    //
    // Rejects all other origins. No wildcard "*" in production.
    //
    // PNA: Modern Chromium blocks requests from secure contexts to localhost
    // unless the server responds with Access-Control-Allow-Private-Network: true.
    // Required for extension → 127.0.0.1:51248.
    // ========================================================================
    httpApp.use((req, res, next) => {
      const origin = req.headers['origin'] as string | undefined
      const requestPrivateNetwork = req.headers['access-control-request-private-network'] === 'true'

      // OPTIONS: CORS preflight + PNA preflight — do not require auth
      if (req.method === 'OPTIONS') {
        if (!isCorsAllowedOrigin(origin)) {
          res.status(403).end()
          return
        }
        const headers = corsPnaHeaders(origin, requestPrivateNetwork)
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
        res.status(204).end()
        return
      }

      // Non-OPTIONS: reject disallowed origins
      if (origin && !isCorsAllowedOrigin(origin)) {
        console.warn(`[SECURITY] Blocked request with disallowed Origin: ${origin} → ${req.method} ${req.path}`)
        res.status(403).json({ error: 'Forbidden: cross-origin request denied' })
        return
      }

      // Attach CORS headers to response for allowed origins (for actual requests)
      res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
      if (origin && isCorsAllowedOrigin(origin)) {
        const headers = corsPnaHeaders(origin, true)
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
      }

      next()
    })

    // ========================================================================
    // SECURITY: Global auth middleware — per-launch secret required.
    //
    // Every HTTP endpoint (except exempt paths below) must include:
    //   X-Launch-Secret: <64-char hex>
    //
    // This eliminates Attack Chain 1: even if a website could somehow
    // bypass CORS (e.g., via a misconfigured proxy), it would not know
    // the per-launch secret and all requests would be rejected with 401.
    //
    // The secret is communicated to the extension via WebSocket handshake
    // or IPC — never over HTTP, never persisted.
    // ========================================================================
    const AUTH_EXEMPT_PATHS = new Set([
      '/api/health',               // Lightweight liveness probe, returns no sensitive data
      '/api/orchestrator/status',  // Availability check for getActiveAdapter (before WebSocket handshake)
      '/api/crypto/pq/status',     // ML-KEM availability probe (boolean only; no secrets). Extension may call before WS supplies X-Launch-Secret; POST /mlkem768/* still require auth
      // Localhost-only: merge still requires matching inbox row + exact package JSON (or handshake fallback).
      '/api/inbox/merge-depackaged',
    ])

    httpApp.use((req, res, next) => {
      if (AUTH_EXEMPT_PATHS.has(req.path)) return next()

      const secret = req.headers['x-launch-secret'] as string | undefined
      if (!secret || !validateLaunchSecret(secret)) {
        res.status(401).json({ error: 'Unauthorized: missing or invalid launch secret' })
        return
      }

      next()
    })

    // =================================================================
    // Health Check Endpoint - Production-grade service status
    // =================================================================
    
    // GET /api/health - Check if Electron app is running and services are ready
    httpApp.get('/api/health', async (_req, res) => {
      try {
        const { oauthServerManager } = await import('./main/email/oauth-server')
        
        // Check service status
        const oauthFlowInProgress = oauthServerManager.isFlowInProgress()
        const oauthState = oauthServerManager.getState()
        
        res.json({
          ok: true,
          timestamp: Date.now(),
          version: app.getVersion(),
          pid: process.pid,
          ...orchestratorBuildMeta(),
          services: {
            http: true,
            oauth: {
              serverRunning: oauthServerManager.isServerRunning(),
              flowInProgress: oauthFlowInProgress,
              state: oauthState
            }
          },
          ready: !oauthFlowInProgress  // Ready for new operations if no OAuth flow in progress
        })
      } catch (error: any) {
        console.error('[HTTP-HEALTH] Error:', error)
        res.status(500).json({
          ok: false,
          timestamp: Date.now(),
          error: error.message || 'Health check failed'
        })
      }
    })

    // POST /api/inbox/merge-depackaged — Chromium extension Stage-5 → local inbox_messages (decrypted body + optional attachment bytes)
    httpApp.post('/api/inbox/merge-depackaged', async (req, res) => {
      try {
        const { mergeExtensionDepackaged, notifyInboxDepackagedMerged } = await import('./main/email/mergeExtensionDepackaged')
        let db = getLedgerDb()
        if (!db) {
          db =
            (globalThis as any).__og_vault_service_ref?.getDb?.() ??
            (globalThis as any).__og_vault_service_ref?.db ??
            null
        }
        if (!db) {
          res.status(503).json({ ok: false, error: 'Database unavailable' })
          return
        }
        const result = mergeExtensionDepackaged(db, req.body)
        if (!result.ok) {
          res.status(400).json({ ok: false, error: result.error ?? 'merge failed' })
          return
        }
        notifyInboxDepackagedMerged(result.handshakeId)
        res.json({ ok: true, messageId: result.messageId })
      } catch (error: any) {
        console.error('[HTTP] merge-depackaged:', error?.message ?? error)
        res.status(500).json({ ok: false, error: error?.message ?? 'merge failed' })
      }
    })

    // =================================================================
    // Build Integrity Verification — offline, no network required
    // =================================================================

    // GET /api/integrity — Returns build verification status
    httpApp.get('/api/integrity', async (_req, res) => {
      try {
        const { verifyBuildIntegrity } = await import('./main/integrity/verifier')
        const status = verifyBuildIntegrity()
        res.json(status)
      } catch (error: any) {
        console.error('[INTEGRITY] Verification error:', error.message)
        res.json({
          verified: false,
          timestamp: Date.now(),
          checks: [{ name: 'runtime', status: 'fail', detail: 'Verifier module error' }],
          summary: 'Unverified: internal error',
        })
      }
    })

    // =================================================================
    // Dashboard Window Control
    // =================================================================
    
    // POST /api/dashboard/open - Open and focus the Analysis Dashboard window
    httpApp.post('/api/dashboard/open', async (_req, res) => {
      try {
        console.log('[AUTH] POST /api/dashboard/open - Opening dashboard via openDashboardWindow()')
        await openDashboardWindow()
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[AUTH] Error opening dashboard:', error)
        res.status(500).json({
          ok: false,
          error: error.message || 'Failed to open dashboard'
        })
      }
    })
    
    // GET /api/dashboard/status - Get dashboard window status
    httpApp.get('/api/dashboard/status', async (_req, res) => {
      try {
        const windowExists = win && !win.isDestroyed()
        const isVisible = windowExists && win!.isVisible()
        const isFocused = windowExists && win!.isFocused()
        
        res.json({
          ok: true,
          window: {
            exists: windowExists,
            visible: isVisible,
            focused: isFocused,
            minimized: windowExists && win!.isMinimized()
          }
        })
      } catch (error: any) {
        console.error('[HTTP-DASHBOARD] Error getting status:', error)
        res.status(500).json({
          ok: false,
          error: error.message || 'Failed to get dashboard status'
        })
      }
    })

    // POST /api/db/test-connection - Test PostgreSQL connection
    httpApp.post('/api/db/test-connection', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/test-connection')
        const result = await testConnection(req.body)
        res.json(result)
      } catch (error: any) {
        console.error('[HTTP] Error in test-connection:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Connection test failed',
          details: { error: error.toString() }
        })
      }
    })

    // GET /api/db/get?keys=key1,key2 - Get specific keys
    httpApp.get('/api/db/get', async (req, res) => {
      try {
        const keys = req.query.keys ? String(req.query.keys).split(',') : []
        console.log('[HTTP] GET /api/db/get', keys)
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        const results: Record<string, any> = {}
        if (keys.length === 0) {
          const allItems = await adapter.getAll()
          res.json({ ok: true, data: allItems })
          return
        }
        // Fetch keys in parallel
        await Promise.all(keys.map(async (key: string) => {
          try {
            const value = await adapter.get(key)
            if (value !== undefined) {
              results[key] = value
            }
          } catch (err) {
            console.error(`[HTTP] Error getting key ${key}:`, err)
          }
        }))
        res.json({ ok: true, data: results })
      } catch (error: any) {
        console.error('[HTTP] Error in get:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to get values' })
      }
    })

    // POST /api/db/set - Set key-value pair
    httpApp.post('/api/db/set', async (req, res) => {
      try {
        const { key, value } = req.body
        console.log('[HTTP] POST /api/db/set', key)
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        await adapter.set(key, value)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP] Error in set:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to set value' })
      }
    })

    // GET /api/db/get-all - Get all keys
    httpApp.get('/api/db/get-all', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/db/get-all')
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        const data = await adapter.getAll()
        res.json({ ok: true, data })
      } catch (error: any) {
        console.error('[HTTP] Error in get-all:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to get all values' })
      }
    })

    // POST /api/db/set-all - Batch set multiple keys
    httpApp.post('/api/db/set-all', async (req, res) => {
      try {
        const payload = req.body.payload || req.body
        const keyCount = Object.keys(payload).length
        console.log('[HTTP] POST /api/db/set-all', keyCount, 'keys')
        const { getPostgresAdapter } = await import('./ipc/db')
        const adapter = getPostgresAdapter()
        if (!adapter) {
          res.status(500).json({ ok: false, message: 'Postgres adapter not initialized' })
          return
        }
        await adapter.setAll(payload)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP] Error in set-all:', error)
        res.status(500).json({ ok: false, message: error.message || 'Failed to set all values' })
      }
    })

    // POST /api/db/sync - Sync Chrome storage to PostgreSQL
    httpApp.post('/api/db/sync', async (req, res) => {
      try {
        const data = req.body.data || req.body
        console.log('[HTTP] POST /api/db/sync', Object.keys(data).length, 'items')
        const result = await syncChromeDataToPostgres(data)
        res.json(result)
      } catch (error: any) {
        console.error('[HTTP] Error in sync:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Sync failed',
          details: { error: error.toString() }
        })
      }
    })

    // ===== AUTH ENDPOINTS =====
    
    // POST /api/auth/login-url - Get auth URL for extension to open in Chrome tab
    // Returns: { ok, authUrl } - extension opens this URL itself, then polls /api/auth/login-wait
    let _pendingLogin: Awaited<ReturnType<typeof prepareLoginUrl>> | null = null
    httpApp.post('/api/auth/login-url', async (_req, res) => {
      try {
        console.log('[HTTP] POST /api/auth/login-url - Preparing SSO URL for extension')
        // Cancel any previous pending login
        if (_pendingLogin) {
          console.log('[HTTP] Cancelling previous pending login')
          _pendingLogin.cancel()
          _pendingLogin = null
        }
        const prepared = await prepareLoginUrl()
        _pendingLogin = prepared
        console.log('[HTTP] Auth URL prepared, returning to extension')
        res.json({ ok: true, authUrl: prepared.authUrl })
      } catch (error: any) {
        console.error('[HTTP] Failed to prepare login URL:', error?.message || error)
        res.status(500).json({ ok: false, error: error?.message || 'Failed to prepare login' })
      }
    })

    // POST /api/auth/login-wait - Wait for SSO callback (called after extension opens auth URL)
    // Long-polls until user completes login or timeout
    httpApp.post('/api/auth/login-wait', async (_req, res) => {
      try {
        console.log('[HTTP] POST /api/auth/login-wait - Waiting for SSO callback...')
        if (!_pendingLogin) {
          res.status(400).json({ ok: false, error: 'No pending login. Call /api/auth/login-url first.' })
          return
        }
        const tokens = await _pendingLogin.waitForCallback()
        _pendingLogin = null
        
        // Process tokens (same as requestLogin)
        console.log('[HTTP] SSO callback received, processing tokens...')
        const { saveRefreshToken: saveRT } = await import('../src/auth/tokenStore')
        const { updateSessionFromTokens: updateSess } = await import('../src/auth/session')
        const { resolveTier: resolve } = await import('../src/auth/capabilities')
        
        if (tokens.refresh_token) {
          await saveRT(tokens.refresh_token)
        }
        const session = updateSess(tokens)
        hasValidSession = true
        const tier = session?.canonical_tier ?? resolve(session?.wrdesk_plan, session?.roles ?? [], session?.sso_tier)
        
        updateTrayMenu()

        // Open the handshake ledger for this new session
        try {
          if (session?.sub && session?.iss) {
            const ledgerToken = buildLedgerSessionToken(session.wrdesk_user_id || session.sub, session.iss)
            openLedger(ledgerToken).then(() => onLedgerReady?.()).catch(err => {
              console.warn('[HTTP] Handshake ledger open after SSO callback failed:', err?.message)
            })
          }
        } catch { /* non-fatal */ }
        
        console.log('[HTTP] SSO login successful via extension - tier:', tier)
        // Respond to the extension FIRST so it can update its UI, then open
        // the dashboard window.  Opening the dashboard before responding would
        // steal focus from the browser confirmation page before the extension
        // has a chance to keep the auth tab visible for the user.
        res.json({ ok: true, tier })

        // Open dashboard after a short delay so the confirmation page
        // in the browser tab remains visible and focused for the user.
        setTimeout(() => openDashboardWindow().catch(() => {}), 2000)
      } catch (error: any) {
        _pendingLogin = null
        console.error('[HTTP] SSO login-wait failed:', error?.message || error)
        res.status(401).json({ ok: false, error: error?.message || 'Login failed' })
      }
    })
    
    // POST /api/auth/login - Trigger Keycloak SSO login (legacy - opens browser from Electron)
    httpApp.post('/api/auth/login', async (_req, res) => {
      try {
        console.log('[HTTP] POST /api/auth/login - Starting SSO login via requestLogin()')
        const result = await requestLogin()
        if (result.ok) {
          console.log('[HTTP] SSO login successful - tier:', result.tier)
          const handshakeDb = await getHandshakeDb()
          if (handshakeDb) {
            processOutboundQueue(handshakeDb, getOidcToken).catch((err) => {
              console.warn('[P2P] Queue flush after login error:', err?.message)
            })
          }
          res.json({ ok: true, tier: result.tier })
        } else {
          console.error('[HTTP] SSO login failed:', result.error)
          res.status(401).json({ ok: false, error: result.error })
        }
      } catch (error: any) {
        console.error('[HTTP] SSO login failed:', error?.message || error)
        res.status(401).json({ ok: false, error: error?.message || 'Login failed' })
      }
    })

    // GET /api/auth/status - Check if user is logged in
    // Returns: { ok, loggedIn, tier?, displayName?, email?, initials? }
    httpApp.get('/api/auth/status', async (_req, res) => {
      try {
        const statusReqTs = new Date().toISOString()
        if (DEBUG_AUTH_STATUS_HTTP) console.log('[HTTP] GET /api/auth/status')
        const hadSessionBefore = hasValidSession
        let session = await ensureSession()
        let loggedIn = session.accessToken !== null
        let vaultLockForExpire = !loggedIn && hadSessionBefore

        if (vaultLockForExpire && getAutosortDiagMainState().bulkSortActive) {
          console.warn('[AUTH] GET /api/auth/status: session missing during bulk auto-sort — retrying ensureSession(true) once')
          session = await ensureSession(true)
          loggedIn = session.accessToken !== null
          vaultLockForExpire = !loggedIn && hadSessionBefore
        }

        if (DEBUG_AUTOSORT_DIAGNOSTICS) {
          autosortDiagLog('http:GET /api/auth/status', {
            ts: statusReqTs,
            source: 'http:GET /api/auth/status',
            hadSessionBefore,
            loggedInAfterEnsureSession: loggedIn,
            vaultLockForSessionExpiry: vaultLockForExpire,
          })
        }

        // If session expired, lock vault to clear KEK/DEK from memory
        if (vaultLockForExpire) {
          lockVaultIfLoaded('http:GET /api/auth/status session expired')
        }

        // Update hasValidSession flag based on current session state
        hasValidSession = loggedIn
        
        // Use canonical tier from session
        if (loggedIn && session.userInfo) {
          currentTier = session.userInfo.canonical_tier ?? resolveTier(
            session.userInfo.wrdesk_plan,
            session.userInfo.roles || [],
            session.userInfo.sso_tier,
          )
        }
        if (DEBUG_AUTH_STATUS_HTTP) {
          console.log('[HTTP][B] Auth status response: loggedIn=' + loggedIn + ', tier=' + currentTier + ', hasUserInfo=' + !!session.userInfo)
        }
        // Include user info and tier for UI display
        const response: Record<string, unknown> = { ok: true, loggedIn }
        if (loggedIn) {
          response.tier = currentTier
          if (session.userInfo) {
            response.displayName = session.userInfo.displayName
            response.email = session.userInfo.email
            response.initials = session.userInfo.initials
            response.picture = session.userInfo.picture
          }
        }
        res.json(response)
      } catch (error: any) {
        console.error('[HTTP] Auth status error:', error?.message || error)
        res.json({ ok: true, loggedIn: false })
      }
    })

    // POST /api/auth/logout - Logout user (instant UI lock)
    httpApp.post('/api/auth/logout', async (_req, res) => {
      try {
        console.log('[AUTH] POST /api/auth/logout - Logging out user')
        
        // INSTANT LOGOUT: Lock UI immediately (sync, no await)
        logoutFast()
        
        // Send response IMMEDIATELY - UI is now locked
        console.log('[AUTH] Logout successful - UI locked instantly')
        res.json({ ok: true })
        
        // Async cleanup (does not block response)
        logoutCleanupAsync().catch(err => {
          console.error('[AUTH] Async cleanup error (non-blocking):', err?.message || err)
        })
      } catch (error: any) {
        console.error('[AUTH] Logout error:', error?.message || error)
        res.status(500).json({ ok: false, error: error?.message || 'Logout failed' })
      }
    })

    // GET /api/db/config - Get current backend config
    httpApp.get('/api/db/config', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/db/config')
        const result = await getConfig()
        res.json(result)
      } catch (error: any) {
        console.error('[HTTP] Error in config:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to get config',
          details: { error: error.toString() }
        })
      }
    })

    // POST /api/db/insert-test-data - Insert test data for testing PostgreSQL
    httpApp.post('/api/db/insert-test-data', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/insert-test-data')
        let adapter = getPostgresAdapter()
        
        // If adapter not initialized, try to initialize it from request config or stored config
        if (!adapter) {
          console.log('[HTTP] Adapter not initialized, attempting to initialize...')
          const postgresConfig = req.body.postgresConfig || req.body.config
          
          if (postgresConfig) {
            console.log('[HTTP] Using config from request body')
            const { testConnection } = await import('./ipc/db')
            const testResult = await testConnection(postgresConfig)
            if (testResult.ok) {
              adapter = getPostgresAdapter()
              console.log('[HTTP] Successfully initialized adapter from request config')
            } else {
              res.status(500).json({ 
                ok: false, 
                message: 'PostgreSQL connection failed. Please click "Connect Local PostgreSQL" first and ensure the connection succeeds.',
                details: { error: testResult.message }
              })
              return
            }
          } else {
            res.status(500).json({ 
              ok: false, 
              message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first and ensure the connection succeeds.',
              details: { error: 'No PostgreSQL configuration provided' }
            })
            return
          }
        }
        
        if (!adapter) {
          res.status(500).json({ 
            ok: false, 
            message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first and ensure the connection succeeds.'
          })
          return
        }

        // Generate test data matching POSTGRES_KEY_PATTERNS
        const testData: Record<string, any> = {
          // Vault entries
          'vault_github': {
            service: 'GitHub',
            username: 'testuser',
            password: 'test_password_123',
            url: 'https://github.com',
            notes: 'Test GitHub account',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          'vault_email': {
            service: 'Email',
            username: 'test@example.com',
            password: 'email_password_456',
            url: 'https://mail.example.com',
            notes: 'Test email account',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          'vault_database': {
            service: 'PostgreSQL',
            username: 'postgres',
            password: 'test_db_password',
            url: 'postgresql://localhost:5432/testdb',
            notes: 'Test database connection',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          // Log entries
          'log_session_start': {
            level: 'info',
            message: 'Session started',
            timestamp: new Date().toISOString(),
            metadata: {
              sessionId: 'test_session_001',
              userId: 'test_user',
              action: 'session_start'
            }
          },
          'log_agent_execution': {
            level: 'info',
            message: 'Agent executed successfully',
            timestamp: new Date().toISOString(),
            metadata: {
              agentId: 'summarize',
              executionTime: 1234,
              result: 'success'
            }
          },
          'log_error': {
            level: 'error',
            message: 'Test error log entry',
            timestamp: new Date().toISOString(),
            metadata: {
              errorCode: 'TEST_001',
              stack: 'Test stack trace'
            }
          },
          // Vector embeddings
          'vector_document_1': {
            id: 'doc_001',
            content: 'This is a test document for vector search',
            embedding: Array.from({ length: 1536 }, () => Math.random()),
            metadata: {
              title: 'Test Document 1',
              category: 'test',
              createdAt: new Date().toISOString()
            }
          },
          'vector_document_2': {
            id: 'doc_002',
            content: 'Another test document with different content',
            embedding: Array.from({ length: 1536 }, () => Math.random()),
            metadata: {
              title: 'Test Document 2',
              category: 'test',
              createdAt: new Date().toISOString()
            }
          },
          // GIS/spatial data
          'gis_location_1': {
            id: 'loc_001',
            name: 'Test Location',
            coordinates: {
              type: 'Point',
              coordinates: [-122.4194, 37.7749] // San Francisco
            },
            metadata: {
              address: '123 Test St',
              city: 'San Francisco',
              country: 'USA'
            }
          },
          'gis_location_2': {
            id: 'loc_002',
            name: 'Another Location',
            coordinates: {
              type: 'Point',
              coordinates: [-74.0060, 40.7128] // New York
            },
            metadata: {
              address: '456 Sample Ave',
              city: 'New York',
              country: 'USA'
            }
          },
          // Archived session
          'archive_session_test_001': {
            sessionId: 'test_session_001',
            sessionName: 'Test Archived Session',
            createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            archivedAt: new Date().toISOString(),
            data: {
              agentBoxes: [],
              displayGrids: [],
              customAgents: []
            }
          }
        }

        // Insert all test data
        await adapter.setAll(testData)
        const keyCount = Object.keys(testData).length

        console.log(`[HTTP] Inserted ${keyCount} test data items`)
        res.json({
          ok: true,
          message: `Successfully inserted ${keyCount} test data items`,
          count: keyCount,
          keys: Object.keys(testData)
        })
      } catch (error: any) {
        console.error('[HTTP] Error in insert-test-data:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to insert test data',
          details: { error: error.toString() }
        })
      }
    })

    // POST /api/db/launch-dbeaver - Launch DBeaver application and configure connection
    httpApp.post('/api/db/launch-dbeaver', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/launch-dbeaver')
        const postgresConfig = req.body.postgresConfig || req.body.config;
        const { spawn, exec, execSync } = await import('child_process');
        const pathMod = await import('path');
        const fs = await import('fs');

        // Close any running DBeaver instances before reconfiguring (Windows only)
        if (postgresConfig && process.platform === 'win32') {
          try {
            execSync('taskkill /F /IM dbeaver.exe /T 2>nul', { stdio: 'ignore' });
            console.log('[HTTP] Closed existing DBeaver instances');
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (e) {
            console.log('[HTTP] No DBeaver process to close or already closed');
          }
        }

        const { ok: launched, message: launchMessage, path: launchPath } = await launchDBeaver(spawn, exec, pathMod, fs);

        if (!launched) {
          res.status(500).json({ ok: false, message: launchMessage });
          return;
        }

        const launchPathStr = launchPath || '';
        
        // If PostgreSQL config is provided, also configure the connection and download drivers
        if (postgresConfig) {
          console.log('[HTTP] Configuring DBeaver connection and downloading drivers...');
          try {
            // Import the configure-dbeaver logic (we'll inline it here)
            const os = await import('os');
            const https = await import('https');
            
            const appDataPath = getDbeaverDataPath(os, pathMod);
            const dbeaverDataPath = pathMod.join(appDataPath, 'DBeaverData');

            // Download PostgreSQL JDBC driver if not already present
            const driversDir = pathMod.join(dbeaverDataPath, 'drivers', 'maven', 'maven-central');
            const postgresDriverDir = pathMod.join(driversDir, 'org.postgresql', 'postgresql');
            const driverVersion = '42.7.3';
            const driverJarName = `postgresql-${driverVersion}.jar`;
            const driverJarPath = pathMod.join(postgresDriverDir, driverVersion, driverJarName);

            // Ensure driver directory exists
            if (!fs.existsSync(pathMod.dirname(driverJarPath))) {
              fs.mkdirSync(pathMod.dirname(driverJarPath), { recursive: true });
            }
            
            // Download driver if it doesn't exist
            if (!fs.existsSync(driverJarPath)) {
              console.log('[HTTP] Downloading PostgreSQL JDBC driver...');
              const driverUrl = `https://repo1.maven.org/maven2/org/postgresql/postgresql/${driverVersion}/${driverJarName}`;
              
              try {
                await new Promise<void>((resolve, reject) => {
                  const file = fs.createWriteStream(driverJarPath);
                  https.get(driverUrl, (response) => {
                    if (response.statusCode === 301 || response.statusCode === 302) {
                      https.get(response.headers.location!, (redirectResponse) => {
                        redirectResponse.pipe(file);
                        file.on('finish', () => {
                          file.close();
                          console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                          resolve();
                        });
                      }).on('error', (err) => {
                        if (fs.existsSync(driverJarPath)) {
                          fs.unlinkSync(driverJarPath);
                        }
                        reject(err);
                      });
                    } else if (response.statusCode === 200) {
                      response.pipe(file);
                      file.on('finish', () => {
                        file.close();
                        console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                        resolve();
                      });
                    } else {
                      if (fs.existsSync(driverJarPath)) {
                        fs.unlinkSync(driverJarPath);
                      }
                      reject(new Error(`Failed to download driver: HTTP ${response.statusCode}`));
                    }
                  }).on('error', (err) => {
                    if (fs.existsSync(driverJarPath)) {
                      fs.unlinkSync(driverJarPath);
                    }
                    reject(err);
                  });
                });
              } catch (downloadError: any) {
                console.error('[HTTP] Failed to download PostgreSQL JDBC driver:', downloadError);
                console.log('[HTTP] Continuing without driver download - DBeaver will prompt to download if needed');
              }
            } else {
              console.log('[HTTP] PostgreSQL JDBC driver already exists');
            }
            
            // Configure driver in DBeaver's drivers.xml - this ensures the driver is available
            const driversConfigPath = pathMod.join(dbeaverDataPath, 'drivers.xml');
            try {
              // DBeaver will auto-download the driver if we just reference it correctly
              // We create a minimal drivers.xml that references the standard PostgreSQL driver
              let driversXml = `<?xml version="1.0" encoding="UTF-8"?>
<drivers>
</drivers>`;
              
              if (!fs.existsSync(driversConfigPath)) {
                fs.writeFileSync(driversConfigPath, driversXml, 'utf-8');
                console.log('[HTTP] Created minimal drivers.xml');
              }
            } catch (driverConfigError: any) {
              console.error('[HTTP] Error configuring drivers.xml:', driverConfigError);
              // Continue anyway
            }
            
            // Configure connection
            let workspacePath = null;
            try {
              const workspaceDirs = fs.readdirSync(dbeaverDataPath, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('workspace'))
                .map(dirent => pathMod.join(dbeaverDataPath, dirent.name));
              
              if (workspaceDirs.length > 0) {
                workspacePath = workspaceDirs.sort().reverse()[0];
              }
            } catch (err) {
              console.error('[HTTP] Error finding workspace:', err);
            }
            
            if (workspacePath) {
              const dataSourcesPath = pathMod.join(workspacePath, 'General', '.dbeaver', 'data-sources.json');
              const dataSourcesDir = pathMod.dirname(dataSourcesPath);
              
              if (!fs.existsSync(dataSourcesDir)) {
                fs.mkdirSync(dataSourcesDir, { recursive: true });
              }
              
              let dataSources: any = {
                folders: {},
                connections: {},
                'connection-types': {
                  'dev': {
                    name: 'Development',
                    color: '255,255,255',
                    description: 'Regular development database',
                    'auto-commit': true,
                    'confirm-execute': false,
                    'confirm-data-change': false,
                    'smart-commit': false,
                    'smart-commit-recover': true,
                    'auto-close-transactions': true,
                    'close-transactions-period': 1800,
                    'auto-close-connections': true,
                    'close-connections-period': 14400
                  }
                }
              };
              
              if (fs.existsSync(dataSourcesPath)) {
                try {
                  const fileContent = fs.readFileSync(dataSourcesPath, 'utf-8');
                  dataSources = JSON.parse(fileContent);
                  if (!dataSources.connections) {
                    dataSources.connections = {};
                  }
                } catch (err) {
                  console.error('[HTTP] Error reading data-sources.json:', err);
                }
              }
              
              const connectionId = 'postgres-local-wr-code';
              const connectionName = 'Local PostgreSQL (WR Desk)';
              // Include credentials in JDBC URL for automatic authentication
              const jdbcUrl = `jdbc:postgresql://${postgresConfig.host}:${postgresConfig.port}/${postgresConfig.database}?user=${encodeURIComponent(postgresConfig.user)}&password=${encodeURIComponent(postgresConfig.password)}`;
              
              const connectionConfig: any = {
                provider: 'postgresql',
                driver: 'postgres-jdbc',
                name: connectionName,
                'save-password': true,
                configuration: {
                  host: postgresConfig.host,
                  port: postgresConfig.port,
                  database: postgresConfig.database,
                  url: jdbcUrl,
                  type: 'dev',
                  provider: 'postgresql',
                  'configuration-type': 'MANUAL',
                  'auth-model': 'native',
                  handlers: {}
                },
                auth: {
                  properties: {
                    user: postgresConfig.user,
                    password: postgresConfig.password
                  },
                  'save-password': true
                }
              };
              
              dataSources.connections[connectionId] = connectionConfig;
              fs.writeFileSync(dataSourcesPath, JSON.stringify(dataSources, null, 2), 'utf-8');
              console.log('[HTTP] DBeaver connection configured successfully');
              
              // Also create credentials file for automatic authentication
              try {
                const credentialsPath = pathMod.join(workspacePath, 'General', '.dbeaver', 'credentials-config.json');
                const credentialsDir = pathMod.dirname(credentialsPath);
                
                if (!fs.existsSync(credentialsDir)) {
                  fs.mkdirSync(credentialsDir, { recursive: true });
                }
                
                const credentials = {
                  [connectionId]: {
                    '#connection': {
                      user: postgresConfig.user,
                      password: postgresConfig.password
                    }
                  }
                };
                
                fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf-8');
                console.log('[HTTP] DBeaver credentials configured');
              } catch (credError: any) {
                console.error('[HTTP] Error configuring credentials:', credError);
                // Continue anyway
              }
            }
          } catch (configError: any) {
            console.error('[HTTP] Error configuring DBeaver connection:', configError);
            // Continue anyway - DBeaver is launched
          }
        }
        
        res.json({
          ok: true,
          message: postgresConfig 
            ? 'DBeaver launched and configured! The connection "Local PostgreSQL (WR Desk)" is ready. Username is pre-filled. You may need to enter the password on first connect.'
            : 'DBeaver launched successfully',
          path: launchPath,
          configured: !!postgresConfig,
          connectionName: postgresConfig ? 'Local PostgreSQL (WR Desk)' : undefined,
          username: postgresConfig?.user
        });
      } catch (error: any) {
        console.error('[HTTP] Error in launch-dbeaver:', error);
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to launch DBeaver',
          details: { error: error.toString() }
        });
      }
    })

    // POST /api/db/configure-dbeaver - Configure DBeaver with PostgreSQL connection
    httpApp.post('/api/db/configure-dbeaver', async (req, res) => {
      try {
        console.log('[HTTP] POST /api/db/configure-dbeaver')
        const postgresConfig = req.body.postgresConfig || req.body.config
        
        if (!postgresConfig) {
          res.status(400).json({
            ok: false,
            message: 'PostgreSQL configuration is required'
          })
          return
        }

        const path = await import('path');
        const fs = await import('fs');
        const os = await import('os');
        const https = await import('https');
        
        // Find DBeaver workspace directory
        const appDataPath = getDbeaverDataPath(os, path);
        const dbeaverDataPath = path.join(appDataPath, 'DBeaverData');
        
        // Download PostgreSQL JDBC driver if not already present
        const driversDir = path.join(dbeaverDataPath, 'drivers', 'maven', 'maven-central');
        const postgresDriverDir = path.join(driversDir, 'org.postgresql', 'postgresql');
        const driverVersion = '42.7.3'; // Latest stable version
        const driverJarName = `postgresql-${driverVersion}.jar`;
        const driverJarPath = path.join(postgresDriverDir, driverVersion, driverJarName);
        
        // Ensure driver directory exists
        if (!fs.existsSync(path.dirname(driverJarPath))) {
          fs.mkdirSync(path.dirname(driverJarPath), { recursive: true });
        }
        
        // Download driver if it doesn't exist
        if (!fs.existsSync(driverJarPath)) {
          console.log('[HTTP] Downloading PostgreSQL JDBC driver...');
          const driverUrl = `https://repo1.maven.org/maven2/org/postgresql/postgresql/${driverVersion}/${driverJarName}`;
          
          try {
            await new Promise<void>((resolve, reject) => {
              const file = fs.createWriteStream(driverJarPath);
              https.get(driverUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                  // Handle redirect
                  https.get(response.headers.location!, (redirectResponse) => {
                    redirectResponse.pipe(file);
                    file.on('finish', () => {
                      file.close();
                      console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                      resolve();
                    });
                  }).on('error', (err) => {
                    if (fs.existsSync(driverJarPath)) {
                      fs.unlinkSync(driverJarPath);
                    }
                    reject(err);
                  });
                } else if (response.statusCode === 200) {
                  response.pipe(file);
                  file.on('finish', () => {
                    file.close();
                    console.log('[HTTP] PostgreSQL JDBC driver downloaded successfully');
                    resolve();
                  });
                } else {
                  if (fs.existsSync(driverJarPath)) {
                    fs.unlinkSync(driverJarPath);
                  }
                  reject(new Error(`Failed to download driver: HTTP ${response.statusCode}`));
                }
              }).on('error', (err) => {
                if (fs.existsSync(driverJarPath)) {
                  fs.unlinkSync(driverJarPath);
                }
                reject(err);
              });
            });
          } catch (downloadError: any) {
            console.error('[HTTP] Failed to download PostgreSQL JDBC driver:', downloadError);
            // Continue anyway - DBeaver might prompt to download it
            console.log('[HTTP] Continuing without driver download - DBeaver will prompt to download if needed');
          }
        } else {
          console.log('[HTTP] PostgreSQL JDBC driver already exists');
        }
        
        // Find workspace directory
        let workspacePath = null;
        try {
          const workspaceDirs = fs.readdirSync(dbeaverDataPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('workspace'))
            .map(dirent => path.join(dbeaverDataPath, dirent.name));
          
          if (workspaceDirs.length > 0) {
            // Use the most recent workspace (highest number)
            workspacePath = workspaceDirs.sort().reverse()[0];
          }
        } catch (err) {
          console.error('[HTTP] Error finding workspace:', err);
        }
        
        if (!workspacePath) {
          res.status(500).json({
            ok: false,
            message: 'Could not find DBeaver workspace. Please open DBeaver at least once first.'
          })
          return
        }
        
        const dataSourcesPath = path.join(workspacePath, 'General', '.dbeaver', 'data-sources.json');
        const dataSourcesDir = path.dirname(dataSourcesPath);
        
        // Ensure directory exists
        if (!fs.existsSync(dataSourcesDir)) {
          fs.mkdirSync(dataSourcesDir, { recursive: true });
        }
        
        // Read existing data-sources.json or create new
        let dataSources: any = {
          folders: {},
          connections: {},
          'connection-types': {
            'dev': {
              name: 'Development',
              color: '255,255,255',
              description: 'Regular development database',
              'auto-commit': true,
              'confirm-execute': false,
              'confirm-data-change': false,
              'smart-commit': false,
              'smart-commit-recover': true,
              'auto-close-transactions': true,
              'close-transactions-period': 1800,
              'auto-close-connections': true,
              'close-connections-period': 14400
            }
          }
        };
        
        if (fs.existsSync(dataSourcesPath)) {
          try {
            const fileContent = fs.readFileSync(dataSourcesPath, 'utf-8');
            dataSources = JSON.parse(fileContent);
            if (!dataSources.connections) {
              dataSources.connections = {};
            }
          } catch (err) {
            console.error('[HTTP] Error reading data-sources.json:', err);
            // Continue with default structure
          }
        }
        
        // Create connection ID
        const connectionId = 'postgres-local-wr-code';
        const connectionName = 'Local PostgreSQL (WR Desk)';
        
        // Build JDBC URL
        const jdbcUrl = `jdbc:postgresql://${postgresConfig.host}:${postgresConfig.port}/${postgresConfig.database}`;
        
        // Create PostgreSQL connection configuration with driver library
        const connectionConfig: any = {
          provider: 'postgresql',
          driver: 'postgres_jdbc',
          name: connectionName,
          'save-password': true,
          'show-system-objects': true,
          'show-utility-objects': true,
          'read-only': false,
          configuration: {
            host: postgresConfig.host,
            port: postgresConfig.port,
            database: postgresConfig.database,
            url: jdbcUrl,
            type: 'dev',
            provider: 'postgresql',
            'driver-properties': {},
            'configuration-type': 'MANUAL',
            'close-idle-connection': true,
            'auth-model': 'native',
            'user-name': postgresConfig.user,
            'user-password': postgresConfig.password,
            'save-password': true,
            'show-all-schemas': false,
            'show-system-schemas': false,
            'show-utility-schemas': true,
            'public-show': true,
            'public-schema-filter': '',
            'public-schema': postgresConfig.schema || 'public',
            'show-database': true,
            'show-template-database': false,
            'template-database-filter': '',
            'show-default-database-only': false,
            'database-filter': '',
            'show-non-default-database': true,
            'database-pattern': '',
            'database-pattern-type': 'REGEX',
            'schema-pattern': '',
            'schema-pattern-type': 'REGEX',
            'include-schema': '',
            'exclude-schema': '',
            'include-database': '',
            'exclude-database': '',
            'driver-name': 'PostgreSQL',
            'driver-class': 'org.postgresql.Driver',
            'driver-library': driverJarPath.replace(/\\/g, '/'), // Normalize path for DBeaver
            'libraries': {
              'postgresql': [
                {
                  'type': 'maven',
                  'groupId': 'org.postgresql',
                  'artifactId': 'postgresql',
                  'version': driverVersion,
                  'path': driverJarPath.replace(/\\/g, '/')
                }
              ]
            }
          }
        };
        
        // Add or update the connection
        dataSources.connections[connectionId] = connectionConfig;
        
        // Write the updated data-sources.json
        fs.writeFileSync(dataSourcesPath, JSON.stringify(dataSources, null, 2), 'utf-8');
        
        console.log('[HTTP] DBeaver connection configured successfully');
        
        res.json({
          ok: true,
          message: `DBeaver connection configured successfully! PostgreSQL JDBC driver (v${driverVersion}) has been downloaded and configured. You can now connect to the database.`,
          connectionId,
          connectionName,
          driverDownloaded: fs.existsSync(driverJarPath)
        });
      } catch (error: any) {
        console.error('[HTTP] Failed to configure DBeaver:', error);
        res.status(500).json({
          ok: false,
          message: 'Failed to configure DBeaver connection',
          details: { error: error.toString() }
        });
      }
    });

    // GET /api/db/test-data-stats - Get statistics about test data
    httpApp.get('/api/db/test-data-stats', async (_req, res) => {
      try {
        console.log('[HTTP] GET /api/db/test-data-stats')
        let adapter = getPostgresAdapter()
        
        // If adapter not initialized, try to initialize it from config
        if (!adapter) {
          console.log('[HTTP] Adapter not initialized, attempting to initialize from config...')
          const { getConfig } = await import('./ipc/db')
          const configResult = await getConfig()
          
          if (configResult.ok && configResult.details?.postgres?.config) {
            const { testConnection } = await import('./ipc/db')
            const testResult = await testConnection(configResult.details.postgres.config)
            if (testResult.ok) {
              adapter = getPostgresAdapter()
              console.log('[HTTP] Successfully initialized adapter from config')
            } else {
              res.status(500).json({ 
                ok: false, 
                message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first.',
                details: { error: testResult.message }
              })
              return
            }
          } else {
            res.status(500).json({ 
              ok: false, 
              message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first.'
            })
            return
          }
        }
        
        if (!adapter) {
          res.status(500).json({ 
            ok: false, 
            message: 'PostgreSQL not connected. Please click "Connect Local PostgreSQL" first.'
          })
          return
        }

        const allData = await adapter.getAll()
        const stats = {
          total: Object.keys(allData).length,
          vault: Object.keys(allData).filter(k => k.startsWith('vault_')).length,
          logs: Object.keys(allData).filter(k => k.startsWith('log_')).length,
          vectors: Object.keys(allData).filter(k => k.startsWith('vector_')).length,
          gis: Object.keys(allData).filter(k => k.startsWith('gis_')).length,
          archived: Object.keys(allData).filter(k => k.startsWith('archive_session_')).length,
          sampleKeys: Object.keys(allData).slice(0, 10)
        }

        res.json({ ok: true, stats })
      } catch (error: any) {
        console.error('[HTTP] Error in test-data-stats:', error)
        res.status(500).json({
          ok: false,
          message: error.message || 'Failed to get test data stats',
          details: { error: error.toString() }
        })
      }
    })

    // ===== VAULT HTTP API ENDPOINTS (SQLCipher) =====
    // These are separate from PostgreSQL and use SQLCipher for encryption

    // Import capability-gate helpers (lazy — only loaded when vault routes are hit)
    const getVaultCapHelpers = async () => {
      const { canAccessCategory, LEGACY_CATEGORY_TO_RECORD_TYPE } = await import('./main/vault/types')
      return { canAccessCategory, LEGACY_CATEGORY_TO_RECORD_TYPE }
    }

    // Lazy vault service import — caches ref for sync access by logoutFast/lockVaultIfLoaded
    const getVaultService = async () => {
      const { vaultService } = await import('./main/vault/rpc')
      _vaultServiceRef = vaultService
      return vaultService
    }

    // GET /api/vault/health - Health check (lightweight, no vault service import)
    // ========================================================================
    // VSBT (Vault Session Binding Token) Middleware
    // ========================================================================
    // Protects against hostile local processes on 127.0.0.1.
    // Every vault endpoint that operates on an UNLOCKED vault requires
    // the X-Vault-Session header to match the session token generated at
    // unlock time.  Endpoints that work on a LOCKED vault (or establish a
    // session) are exempt.
    // ========================================================================

    const VSBT_EXEMPT_PATHS = new Set([
      '/api/vault/health',
      '/api/vault/status',
      '/api/vault/create',
      '/api/vault/unlock',
    ])

    httpApp.use('/api/vault', (req, res, next) => {
      const fullPath = '/api/vault' + req.path
      if (VSBT_EXEMPT_PATHS.has(fullPath)) return next()

      const vsbt = req.headers['x-vault-session'] as string | undefined
      if (!vsbt) {
        res.status(401).json({ success: false, error: 'Missing vault session token' })
        return
      }

      if (!_vaultServiceRef || !_vaultServiceRef.validateToken(vsbt)) {
        res.status(401).json({ success: false, error: 'Invalid vault session token' })
        return
      }

      next()
    })

    httpApp.get('/api/vault/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() })
    })
    
    // POST /api/vault/status - Get vault status (includes tier for UI gating)
    // When the vault is already unlocked, the response also carries the current
    // VSBT so that freshly-loaded extension UIs (content-script reload, popup
    // reopen) can bind to the existing session without re-entering the password.
    httpApp.post('/api/vault/status', async (_req, res) => {
      try {
        const tier = await getEffectiveTier({ refreshIfStale: true, caller: 'vault-status' })
        const vaultService = await getVaultService()
        const status = await vaultService.getStatus()
        const { canAccessRecordType } = await import('./main/vault/types')
        const canUseHsContextProfiles = canAccessRecordType(tier as any, 'handshake_context', 'share')
        // Attach tier and canUseHsContextProfiles for UI gating (HS Context = Publisher+ only).
        // Include sessionToken when unlocked so the client can bind to the existing session.
        const sessionToken = status.isUnlocked ? vaultService.getSessionToken() : null
        res.json({ success: true, data: { ...status, tier, canUseHsContextProfiles }, ...(sessionToken ? { sessionToken } : {}) })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in status:', error)
        console.error('[HTTP-VAULT] Error stack:', error?.stack)
        res.status(500).json({ success: false, error: error.message || 'Failed to get status', details: error?.stack })
      }
    })

    // POST /api/vault/create - Create new vault (returns VSBT for session binding)
    httpApp.post('/api/vault/create', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/create', { vaultName: req.body.vaultName })
        const vaultService = await getVaultService()
        const vaultId = await vaultService.createVault(req.body.password, req.body.vaultName || 'My Vault', req.body.vaultId)
        res.json({ success: true, data: { vaultId }, sessionToken: vaultService.getSessionToken() })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in create:', error)
        console.error('[HTTP-VAULT] Error message:', error?.message)
        console.error('[HTTP-VAULT] Error stack:', error?.stack)
        res.status(500).json({ success: false, error: error?.message || error?.toString() || 'Failed to create vault' })
      }
    })

    // POST /api/vault/delete - Delete vault (must be unlocked)
    httpApp.post('/api/vault/delete', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/delete', { vaultId: req.body.vaultId })
        const vaultService = await getVaultService()
        await vaultService.deleteVault(req.body.vaultId)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in delete:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to delete vault' })
      }
    })

    // POST /api/vault/unlock - Unlock vault (returns VSBT for session binding)
    httpApp.post('/api/vault/unlock', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/unlock', { vaultId: req.body.vaultId })
        const vaultService = await getVaultService()
        const { setupEmbeddingServiceRef } = await import('./main/vault/rpc')
        await vaultService.unlock(req.body.password, req.body.vaultId || 'default')
        const db = getLedgerDb() ?? vaultService.getHsProfileDb?.() ?? null
        setupEmbeddingServiceRef(vaultService, db)
        res.json({ success: true, sessionToken: vaultService.getSessionToken() })
        setImmediate(() => {
          completePendingContextSyncs(db, getCurrentSession())
          if (db) processOutboundQueue(db, getOidcToken).catch(() => {})
          try { win?.webContents.send('handshake-list-refresh') } catch { /* no window */ }
        })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in unlock:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to unlock vault' })
      }
    })

    // POST /api/vault/lock - Lock vault
    httpApp.post('/api/vault/lock', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/lock')
        const { clearEmbeddingServiceRef } = await import('./main/vault/rpc')
        clearEmbeddingServiceRef()
        const vaultService = await getVaultService()
        await vaultService.lock()
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in lock:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to lock vault' })
      }
    })

    // POST /api/vault/items - List items (capability-gated: only returns allowed categories)
    httpApp.post('/api/vault/items', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/items', req.body)
        const tier = await getEffectiveTier()
        const vaultService = await getVaultService()
        const { canAccessCategory: canAccess } = await getVaultCapHelpers()

        const requestedCategory = req.body.category

        // If a specific category is requested, check permission first (fail-closed)
        if (requestedCategory && !canAccess(tier as any, requestedCategory, 'read')) {
          console.log(`[HTTP-VAULT] ❌ Tier "${tier}" cannot read category "${requestedCategory}"`)
          res.json({ success: true, data: [] })
          return
        }

        const filters = {
          container_id: req.body.containerId,
          category: requestedCategory,
        }
        let items = await vaultService.listItems(filters, tier)

        // Post-filter: defense-in-depth (service already filters by tier)
        items = items.filter(i => canAccess(tier as any, i.category as any, 'read'))

        console.log(`[HTTP-VAULT] Returning ${items.length} items (tier=${tier})`)
        res.json({ success: true, data: items })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in items:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to list items' })
      }
    })

    // POST /api/vault/item/create - Create item (capability-gated)
    httpApp.post('/api/vault/item/create', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/create')
        console.log('[HTTP-VAULT] Request body:', JSON.stringify(req.body, null, 2))
        const tier = await getEffectiveTier()

        // ── Capability gate (before any encryption/storage) ──
        const { canAccessCategory: canAccess } = await getVaultCapHelpers()
        const category = req.body.category
        if (!canAccess(tier as any, category, 'write')) {
          console.log(`[HTTP-VAULT] ❌ Tier "${tier}" cannot write category "${category}"`)
          res.status(403).json({ success: false, error: `Your plan (${tier}) does not allow creating ${category} records. Upgrade to access this feature.` })
          return
        }

        const vaultService = await getVaultService()
        const item = await vaultService.createItem(req.body, tier)
        console.log('[HTTP-VAULT] ✅ Item created successfully:', item.id, 'category:', item.category)
        
        // Immediately verify the item can be retrieved
        try {
          const verifyItems = await vaultService.listItems({ category: item.category })
          const found = verifyItems.find(i => i.id === item.id)
          if (found) {
            console.log('[HTTP-VAULT] ✅ Verified: Item can be retrieved immediately after creation')
          } else {
            console.error('[HTTP-VAULT] ⚠️ WARNING: Item created but NOT found in listItems query!')
            console.error('[HTTP-VAULT] Created item ID:', item.id)
            console.error('[HTTP-VAULT] Items returned:', verifyItems.map(i => ({ id: i.id, title: i.title })))
          }
        } catch (verifyError: any) {
          console.error('[HTTP-VAULT] ⚠️ Verification query failed:', verifyError?.message)
        }
        
        res.json({ success: true, data: item })
      } catch (error: any) {
        console.error('[HTTP-VAULT] ❌ Error in create item:', error)
        console.error('[HTTP-VAULT] Error stack:', error?.stack)
        res.status(500).json({ success: false, error: error.message || 'Failed to create item' })
      }
    })

    // POST /api/vault/item/get - Get item by ID (capability-gated BEFORE decrypt)
    httpApp.post('/api/vault/item/get', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/get')
        const tier = await getEffectiveTier()
        const vaultService = await getVaultService()
        // Tier is passed to getItem() so the capability check runs BEFORE
        // any KEK unwrap / DEK decrypt (fail-closed).
        const item = await vaultService.getItem(req.body.id, tier)
        res.json({ success: true, data: item })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in get item:', error)
        const status = error.message?.includes('cannot read category') ? 403 : 500
        res.status(status).json({ success: false, error: error.message || 'Failed to get item' })
      }
    })

    // POST /api/vault/item/update - Update item (capability-gated BEFORE decrypt)
    httpApp.post('/api/vault/item/update', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/update')
        const tier = await getEffectiveTier()
        const vaultService = await getVaultService()

        // Read category WITHOUT decrypting — no KEK/DEK touched
        const category = vaultService.getItemCategory(req.body.id)
        const { canAccessCategory: canAccess } = await getVaultCapHelpers()
        if (!canAccess(tier as any, category as any, 'write')) {
          console.log(`[HTTP-VAULT] ❌ Tier "${tier}" cannot write category "${category}"`)
          res.status(403).json({ success: false, error: `Your plan (${tier}) does not allow editing ${category} records.` })
          return
        }

        const item = await vaultService.updateItem(req.body.id, req.body.updates, tier)
        res.json({ success: true, data: item })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in update item:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to update item' })
      }
    })

    // POST /api/vault/item/delete - Delete item (capability-gated BEFORE decrypt)
    httpApp.post('/api/vault/item/delete', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/delete')
        const tier = await getEffectiveTier()
        const vaultService = await getVaultService()

        // Read category WITHOUT decrypting — no KEK/DEK touched
        const category = vaultService.getItemCategory(req.body.id)
        const { canAccessCategory: canAccess } = await getVaultCapHelpers()
        if (!canAccess(tier as any, category as any, 'delete')) {
          console.log(`[HTTP-VAULT] ❌ Tier "${tier}" cannot delete category "${category}"`)
          res.status(403).json({ success: false, error: `Your plan (${tier}) does not allow deleting ${category} records.` })
          return
        }

        await vaultService.deleteItem(req.body.id, tier)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in delete item:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to delete item' })
      }
    })

    // ========================================================================
    // Handshake Context Routes (capability-gated, Publisher+)
    // ========================================================================

    // POST /api/vault/item/meta/get - Get item meta (binding policy, capability-gated)
    httpApp.post('/api/vault/item/meta/get', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/meta/get')
        const tier = await getEffectiveTier()
        const vaultService = await getVaultService()
        const { id } = req.body
        if (!id) { res.status(400).json({ success: false, error: 'Missing item id' }); return }

        // getItemMeta now enforces capability check internally
        const meta = vaultService.getItemMeta(id, tier)
        res.json({ success: true, data: meta })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in get item meta:', error)
        const status = error.message?.includes('cannot read category') ? 403 : 500
        res.status(status).json({ success: false, error: error.message || 'Failed to get item meta' })
      }
    })

    // POST /api/vault/item/meta/set - Set item meta (binding policy, capability-gated BEFORE decrypt)
    httpApp.post('/api/vault/item/meta/set', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/item/meta/set')
        const tier = await getEffectiveTier()
        const vaultService = await getVaultService()
        const { id, meta } = req.body
        if (!id || !meta) { res.status(400).json({ success: false, error: 'Missing id or meta' }); return }

        // Read category WITHOUT decrypting — no KEK/DEK touched
        const category = vaultService.getItemCategory(id)
        const { canAccessCategory: canAccess } = await getVaultCapHelpers()
        if (!canAccess(tier as any, category as any, 'write')) {
          res.status(403).json({ success: false, error: `Your plan (${tier}) does not allow editing ${category} records.` })
          return
        }

        vaultService.setItemMeta(id, meta, tier)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in set item meta:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to set item meta' })
      }
    })

    // POST /api/vault/handshake/evaluate - Evaluate context attachment eligibility
    httpApp.post('/api/vault/handshake/evaluate', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/handshake/evaluate')
        const vaultService = await getVaultService()
        const { itemId, target } = req.body
        if (!itemId || !target) {
          res.status(400).json({ success: false, error: 'Missing itemId or target' })
          return
        }

        const tier = await getEffectiveTier()
        const result = await vaultService.evaluateAttach(tier as any, itemId, target)
        res.json({ success: true, data: result })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in handshake evaluate:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to evaluate attachment' })
      }
    })

    // ========================================================================
    // Document Vault Routes (capability-gated, Pro+)
    // ========================================================================

    // POST /api/vault/documents - List documents (metadata only)
    httpApp.post('/api/vault/documents', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/documents')
        const tier = await getEffectiveTier()
        const vaultService = await getVaultService()
        const docs = vaultService.listDocuments(tier as any)
        res.json({ success: true, data: docs })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in list documents:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to list documents' })
      }
    })

    // POST /api/vault/document/upload - Upload/import a document
    httpApp.post('/api/vault/document/upload', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/document/upload')
        const vaultService = await getVaultService()

        const { filename, data, notes } = req.body
        if (!filename || !data) {
          res.status(400).json({ success: false, error: 'Missing filename or data' })
          return
        }

        // Data arrives as base64-encoded string from the frontend
        const buffer = Buffer.from(data, 'base64')
        const tier = await getEffectiveTier()
        const result = await vaultService.importDocument(tier as any, filename, buffer, notes || '')

        console.log('[HTTP-VAULT] ✅ Document imported:', result.document.id, result.deduplicated ? '(deduplicated)' : '')
        res.json({ success: true, data: result })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in document upload:', error)
        const status = error.message?.includes('cannot write') || error.message?.includes('cannot read') ? 403 : 500
        res.status(status).json({ success: false, error: error.message || 'Failed to upload document' })
      }
    })

    // POST /api/vault/document/get - Retrieve and decrypt a document
    httpApp.post('/api/vault/document/get', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/document/get')
        const vaultService = await getVaultService()

        const { id } = req.body
        if (!id) {
          res.status(400).json({ success: false, error: 'Missing document id' })
          return
        }

        const tier = await getEffectiveTier()
        const result = await vaultService.getDocument(tier as any, id)

        // SECURITY: Content is always returned as base64.
        // Content-Disposition semantics are enforced at the UI layer (always "attachment").
        // MIME type is included for display only — the UI must NEVER use it to dispatch an executor.
        res.json({
          success: true,
          data: {
            document: result.document,
            content: result.content.toString('base64'),
          },
        })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in document get:', error)
        const status = error.message?.includes('cannot read') ? 403 : 500
        res.status(status).json({ success: false, error: error.message || 'Failed to get document' })
      }
    })

    // POST /api/vault/document/delete - Delete a document
    httpApp.post('/api/vault/document/delete', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/document/delete')
        const vaultService = await getVaultService()

        const { id } = req.body
        if (!id) {
          res.status(400).json({ success: false, error: 'Missing document id' })
          return
        }

        const tier = await getEffectiveTier()
        vaultService.deleteDocument(tier as any, id)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in document delete:', error)
        const status = error.message?.includes('cannot delete') ? 403 : 500
        res.status(status).json({ success: false, error: error.message || 'Failed to delete document' })
      }
    })

    // POST /api/vault/document/update - Update document metadata (notes)
    httpApp.post('/api/vault/document/update', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/document/update')
        const vaultService = await getVaultService()

        const { id, updates } = req.body
        if (!id) {
          res.status(400).json({ success: false, error: 'Missing document id' })
          return
        }

        const tier = await getEffectiveTier()
        const doc = vaultService.updateDocumentMeta(tier as any, id, updates || {})
        res.json({ success: true, data: doc })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in document update:', error)
        const status = error.message?.includes('cannot write') ? 403 : 500
        res.status(status).json({ success: false, error: error.message || 'Failed to update document' })
      }
    })

    // POST /api/vault/containers - List containers
    httpApp.post('/api/vault/containers', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/containers')
        const vaultService = await getVaultService()
        const containers = await vaultService.listContainers()
        res.json({ success: true, data: containers })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in containers:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to list containers' })
      }
    })

    // POST /api/vault/container/create - Create container
    httpApp.post('/api/vault/container/create', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/container/create')
        const vaultService = await getVaultService()
        const { type, name, favorite } = req.body
        const container = vaultService.createContainer(type, name, favorite || false)
        res.json({ success: true, data: container })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in create container:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to create container' })
      }
    })

    // POST /api/vault/settings - Get settings
    httpApp.post('/api/vault/settings/get', async (_req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/settings/get')
        const vaultService = await getVaultService()
        const settings = await vaultService.getSettings()
        res.json({ success: true, data: settings })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in get settings:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get settings' })
      }
    })

    // POST /api/vault/settings/update - Update settings
    httpApp.post('/api/vault/settings/update', async (req, res) => {
      try {
        console.log('[HTTP-VAULT] POST /api/vault/settings/update')
        const vaultService = await getVaultService()
        const settings = await vaultService.updateSettings(req.body)
        res.json({ success: true, data: settings })
      } catch (error: any) {
        console.error('[HTTP-VAULT] Error in update settings:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to update settings' })
      }
    })

    // ===== INGESTION HTTP API ENDPOINTS =====
    registerIngestionRoutes(httpApp, () => {
      try {
        const ledgerDb = getLedgerDb()
        if (ledgerDb) return ledgerDb
        const vs = (globalThis as any).__og_vault_service_ref
        return vs?.db ?? null
      } catch { return null }
    })

    // ===== HANDSHAKE HTTP API ENDPOINTS =====
    registerHandshakeRoutes(httpApp, () => {
      try {
        const ledgerDb = getLedgerDb()
        if (ledgerDb) return ledgerDb
        const vs = (globalThis as any).__og_vault_service_ref
        return vs?.db ?? null
      } catch { return null }
    })

    // ===== ORCHESTRATOR HTTP API ENDPOINTS (Encrypted SQLite Backend) =====
    // These endpoints provide encrypted storage for all orchestrator data
    
    // POST /api/orchestrator/connect - Connect to orchestrator database (auto-creates if doesn't exist)
    httpApp.post('/api/orchestrator/connect', async (_req, res) => {
      try {
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/connect')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.connect()
        const status = service.getStatus()
        res.json({ success: true, data: status })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in connect:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to connect' })
      }
    })

    // GET /api/orchestrator/status - Get connection status
    httpApp.get('/api/orchestrator/status', async (_req, res) => {
      try {
        console.log('[HTTP-ORCHESTRATOR] GET /api/orchestrator/status')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const status = service.getStatus()
        res.json({ success: true, data: status })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in status:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get status' })
      }
    })

    // GET /api/orchestrator/sessions - List automation sessions (orchestrator SQLite)
    httpApp.get('/api/orchestrator/sessions', async (_req, res) => {
      try {
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const sessions = await service.listSessions()
        res.json({ success: true, data: sessions })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in sessions:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to list sessions' })
      }
    })

    // GET /api/orchestrator/get - Get value by key
    httpApp.get('/api/orchestrator/get', async (req, res) => {
      try {
        const key = req.query.key as string
        console.log('[HTTP-ORCHESTRATOR] GET /api/orchestrator/get', { key })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const value = await service.get(key)
        res.json({ success: true, data: value })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in get:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get value' })
      }
    })

    // POST /api/orchestrator/set - Set value by key
    httpApp.post('/api/orchestrator/set', async (req, res) => {
      try {
        const { key, value } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/set', { key })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.set(key, value)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in set:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to set value' })
      }
    })

    // GET /api/orchestrator/get-all - Get all key-value pairs
    httpApp.get('/api/orchestrator/get-all', async (_req, res) => {
      try {
        console.log('[HTTP-ORCHESTRATOR] GET /api/orchestrator/get-all')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const data = await service.getAll()
        res.json({ success: true, data })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in get-all:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to get all data' })
      }
    })

    // POST /api/orchestrator/set-all - Set multiple key-value pairs
    httpApp.post('/api/orchestrator/set-all', async (req, res) => {
      try {
        const { data } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/set-all', { keyCount: Object.keys(data || {}).length })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.setAll(data)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in set-all:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to set all data' })
      }
    })

    // POST /api/orchestrator/remove - Remove key(s)
    httpApp.post('/api/orchestrator/remove', async (req, res) => {
      try {
        const { keys } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/remove', { keys })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.remove(keys)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in remove:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to remove keys' })
      }
    })

    // POST /api/orchestrator/migrate - Migrate data from Chrome storage
    httpApp.post('/api/orchestrator/migrate', async (req, res) => {
      try {
        const { chromeData } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/migrate', { keyCount: Object.keys(chromeData || {}).length })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.migrateFromChromeStorage(chromeData)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in migrate:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to migrate data' })
      }
    })

    // POST /api/orchestrator/export - Export data (future-ready for JSON/YAML/MD)
    httpApp.post('/api/orchestrator/export', async (req, res) => {
      try {
        const options = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/export', { format: options.format })
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        const exportData = await service.exportData(options)
        res.json({ success: true, data: exportData })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in export:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to export data' })
      }
    })

    // POST /api/orchestrator/import - Import data (future-ready for JSON/YAML/MD)
    httpApp.post('/api/orchestrator/import', async (req, res) => {
      try {
        const { data } = req.body
        console.log('[HTTP-ORCHESTRATOR] POST /api/orchestrator/import')
        const { getOrchestratorService } = await import('./main/orchestrator-db/service')
        const service = getOrchestratorService()
        await service.importData(data)
        res.json({ success: true })
      } catch (error: any) {
        console.error('[HTTP-ORCHESTRATOR] Error in import:', error)
        res.status(500).json({ success: false, error: error.message || 'Failed to import data' })
      }
    })

    // ==================== LLM API ENDPOINTS ====================
    
    // GET /api/llm/hardware - Get hardware information
    httpApp.get('/api/llm/hardware', async (_req, res) => {
      try {
        const { hardwareService } = await import('./main/llm/hardware')
        const hardware = await hardwareService.detect()
        res.json({ ok: true, data: hardware })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error in hardware detection:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/llm/status — same payload as IPC `llm:getStatus` (includes `localRuntime` when built).
    httpApp.get('/api/llm/status', async (_req, res) => {
      try {
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const status = await ollamaManager.getStatus()
        res.json({ ok: true, data: status })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error in get status:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/llm/start - Start Ollama server
    httpApp.post('/api/llm/start', async (_req, res) => {
      try {
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        await ollamaManager.start()
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error starting Ollama:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/llm/stop - Stop Ollama server
    httpApp.post('/api/llm/stop', async (_req, res) => {
      try {
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        await ollamaManager.stop()
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error stopping Ollama:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/llm/models - List installed models
    httpApp.get('/api/llm/models', async (_req, res) => {
      try {
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const models = await ollamaManager.listModels()
        res.json({ ok: true, data: models })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error listing models:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/llm/catalog - Get model catalog
    httpApp.get('/api/llm/catalog', async (_req, res) => {
      try {
        const { MODEL_CATALOG } = await import('./main/llm/config')
        res.json({ ok: true, data: MODEL_CATALOG })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error getting catalog:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/llm/models/install - Install a model
    httpApp.post('/api/llm/models/install', async (req, res) => {
      try {
        const { modelId } = req.body
        console.log('[HTTP-LLM] Install request received - modelId:', modelId)

        if (!modelId) {
          res.status(400).json({ ok: false, error: 'modelId is required' })
          return
        }

        const { ollamaManager } = await import('./main/llm/ollama-manager')

        console.log('[HTTP-LLM] Starting model pull for:', modelId)

        // Start async pull. Progress is stored on ollamaManager.downloadProgress for polling.
        // After completion, verify the model exists and update the terminal progress state.
        ollamaManager.pullModel(modelId, (progress) => {
          // Stored for GET /api/llm/install-progress polling.
        }).then(async () => {
          console.log('[HTTP-LLM] Install stream done, verifying:', modelId)

          // Cache was cleared by pullModel (Patch 1); this re-queries Ollama directly.
          let verified = false
          try {
            const models = await ollamaManager.listModels()
            verified = models.some((m: { name: string }) => m.name === modelId)
            console.log('[HTTP-LLM] Verification result for', modelId, ':', verified ? 'FOUND' : 'NOT FOUND')
          } catch (verifyErr: any) {
            console.error('[HTTP-LLM] Verification listModels failed:', verifyErr)
          }

          // Update downloadProgress to a terminal state so the UI poller gets the final result.
          ollamaManager.downloadProgress = verified
            ? { modelId, status: 'verified', progress: 100 }
            : {
                modelId,
                status: 'verification_failed',
                progress: 0,
                error: `Model "${modelId}" was not found in Ollama after installation. ` +
                  'It may still be processing — try refreshing the model list.',
              }

          console.log('[HTTP-LLM] Terminal progress state set for', modelId, '- verified:', verified)
        }).catch((error: any) => {
          console.error('[HTTP-LLM] Model installation failed:', error)
          ollamaManager.downloadProgress = {
            modelId,
            status: 'error',
            progress: 0,
            error: error.message,
          }
        })

        res.json({ ok: true, message: 'Installation started' })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error installing model:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/llm/install-progress - Get current installation progress
    httpApp.get('/api/llm/install-progress', async (_req, res) => {
      try {
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const progress = ollamaManager.getDownloadProgress()
        console.log('[HTTP-LLM] Returning progress:', progress)
        res.json({ ok: true, progress })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error getting install progress:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // DELETE /api/llm/models/:modelId - Delete a model
    httpApp.delete('/api/llm/models/:modelId', async (req, res) => {
      try {
        const { modelId } = req.params
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        await ollamaManager.deleteModel(modelId)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error deleting model:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/llm/models/activate - Set active model
    httpApp.post('/api/llm/models/activate', async (req, res) => {
      try {
        const { modelId } = req.body
        if (!modelId || typeof modelId !== 'string') {
          res.status(400).json({ ok: false, error: 'modelId is required' })
          return
        }
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const { DEBUG_ACTIVE_OLLAMA_MODEL } = await import('./main/llm/activeOllamaModelStore')
        if (DEBUG_ACTIVE_OLLAMA_MODEL) {
          console.warn('[HTTP-LLM] Set active model requested:', modelId)
        }
        const result = await ollamaManager.setActiveModelPreference(modelId)
        if (!result.ok) {
          res.status(400).json({ ok: false, error: result.error })
          return
        }
        const { broadcastActiveOllamaModelChanged } = await import('./main/llm/broadcastActiveModel')
        broadcastActiveOllamaModelChanged(modelId)
        if (DEBUG_ACTIVE_OLLAMA_MODEL) {
          console.warn('[HTTP-LLM] Set active model persisted:', modelId.trim())
        }
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error setting active model:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/llm/first-available - Preferred chat model (persisted active or first installed)
    httpApp.get('/api/llm/first-available', async (_req, res) => {
      try {
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        const modelId = await ollamaManager.getEffectiveChatModelName()
        
        if (!modelId) {
          res.json({ ok: false, error: 'No models installed. Please install a model first.' })
          return
        }
        
        res.json({ ok: true, data: { modelId } })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error getting first available model:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/llm/chat - Chat with model (local Ollama or cloud provider)
    httpApp.post('/api/llm/chat', async (req, res) => {
      try {
        const { modelId, messages, provider, apiKey } = req.body
        if (!messages || !Array.isArray(messages)) {
          res.status(400).json({ ok: false, error: 'messages array is required' })
          return
        }

        // Cloud provider dispatch: when provider + apiKey are present, call the cloud API directly
        if (provider && apiKey) {
          console.log('[HTTP-LLM] Cloud dispatch:', provider, modelId)
          const cloudContent = await dispatchCloudChat(provider, modelId, messages, apiKey)
          res.json({ ok: true, data: { content: cloudContent } })
          return
        }
        
        const { ollamaManager } = await import('./main/llm/ollama-manager')
        
        // If no modelId specified, use persisted preference or first installed model
        let activeModelId = modelId
        if (!activeModelId) {
          const resolved = await ollamaManager.getEffectiveChatModelName()
          if (!resolved) {
            res.status(400).json({ 
              ok: false, 
              error: 'No models installed. Please go to LLM Settings (Admin panel) and install a model first.' 
            })
            return
          }
          activeModelId = resolved
        }
        
        const response = await ollamaManager.chat(activeModelId, messages)
        res.json({ ok: true, data: response })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error in chat:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/llm/performance/:modelId - Get performance estimate for model
    httpApp.get('/api/llm/performance/:modelId', async (req, res) => {
      try {
        const { modelId } = req.params
        const { hardwareService } = await import('./main/llm/hardware')
        const { getModelConfig } = await import('./main/llm/config')
        
        const hardware = await hardwareService.detect()
        const modelConfig = getModelConfig(modelId)
        
        if (!modelConfig) {
          res.status(404).json({ ok: false, error: 'Model not found in catalog' })
          return
        }
        
        const estimate = hardwareService.estimatePerformance(modelConfig, hardware)
        res.json({ ok: true, data: estimate })
      } catch (error: any) {
        console.error('[HTTP-LLM] Error getting performance estimate:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // ===== OCR API Endpoints =====
    
    // GET /api/ocr/status - Get OCR service status
    httpApp.get('/api/ocr/status', async (_req, res) => {
      try {
        const { ocrService } = await import('./main/ocr/ocr-service')
        const { ocrRouter } = await import('./main/ocr/router')
        const status = ocrService.getStatus()
        const availableProviders = ocrRouter.getAvailableProviders()
        res.json({ 
          ok: true, 
          data: { 
            ...status, 
            cloudAvailable: availableProviders.length > 0,
            availableProviders 
          } 
        })
      } catch (error: any) {
        console.error('[HTTP-OCR] Error getting status:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/ocr/languages - Get supported OCR languages
    httpApp.get('/api/ocr/languages', async (_req, res) => {
      try {
        const { ocrService } = await import('./main/ocr/ocr-service')
        const languages = ocrService.getSupportedLanguages()
        res.json({ ok: true, data: languages })
      } catch (error: any) {
        console.error('[HTTP-OCR] Error getting languages:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/ocr/process - Process an image with OCR
    httpApp.post('/api/ocr/process', async (req, res) => {
      try {
        const { image, options } = req.body
        
        if (!image) {
          res.status(400).json({ ok: false, error: 'image is required (base64 or dataUrl)' })
          return
        }
        
        const { ocrRouter } = await import('./main/ocr/router')
        
        // Determine input type
        const input = image.startsWith('data:') 
          ? { type: 'dataUrl' as const, dataUrl: image }
          : { type: 'base64' as const, data: image }
        
        const result = await ocrRouter.processImage(input, options)
        res.json({ ok: true, data: result })
      } catch (error: any) {
        console.error('[HTTP-OCR] Error processing image:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/ocr/config - Update OCR cloud configuration
    httpApp.post('/api/ocr/config', async (req, res) => {
      try {
        const { ocrRouter } = await import('./main/ocr/router')
        ocrRouter.setCloudConfig(req.body)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP-OCR] Error setting config:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/ocr/routing - Check current routing decision
    httpApp.get('/api/ocr/routing', async (req, res) => {
      try {
        const { ocrRouter } = await import('./main/ocr/router')
        const forceLocal = req.query.forceLocal === 'true'
        const forceCloud = req.query.forceCloud === 'true'
        const decision = ocrRouter.shouldUseCloud({ forceLocal, forceCloud })
        res.json({ ok: true, data: decision })
      } catch (error: any) {
        console.error('[HTTP-OCR] Error checking routing:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // ===== EMAIL GATEWAY API Endpoints =====
    
    // GET /api/email/credentials/gmail - Check Gmail credentials with honest source
    httpApp.get('/api/email/credentials/gmail', async (_req, res) => {
      try {
        console.log('[HTTP-EMAIL] GET /api/email/credentials/gmail')
        const { checkExistingCredentials, isVaultUnlocked } = await import('./main/email/credentials')
        const result = await checkExistingCredentials('gmail')
        const canConnect =
          !!result.credentials || result.builtinOAuthAvailable === true
        const {
          isEmailDeveloperModeEnabled,
          getStandardConnectBuiltinClientDiagnostics,
        } = await import('./main/email/googleOAuthBuiltin')
        const std = getStandardConnectBuiltinClientDiagnostics()
        res.json({
          ok: true,
          data: {
            configured: canConnect,
            developerCredentialsStored: !!result.credentials,
            builtinOAuthAvailable: result.builtinOAuthAvailable === true,
            developerModeEnabled: isEmailDeveloperModeEnabled(),
            clientId: result.clientId,
            source: result.source,
            credentials: result.credentials,
            hasSecret: result.hasSecret,
            vaultUnlocked: isVaultUnlocked(),
            standardConnectBundledClientFingerprint: std.standardConnectBundledClientFingerprint,
            standardConnectBuiltinSourceKind: std.standardConnectBuiltinSourceKind,
          },
        })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error checking Gmail credentials:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/email/credentials/gmail - Save Gmail OAuth credentials
    httpApp.post('/api/email/credentials/gmail', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/credentials/gmail')
        const { clientId, clientSecret } = req.body
        if (!clientId) {
          res.status(400).json({ ok: false, error: 'clientId is required' })
          return
        }
        const { saveCredentials } = await import('./main/email/credentials')
        const storeInVault = req.body.storeInVault !== false
        const result = await saveCredentials(
          'gmail',
          { clientId, clientSecret: typeof clientSecret === 'string' ? clientSecret : undefined },
          storeInVault,
        )
        res.json({ ok: result.ok, savedToVault: result.savedToVault, error: result.error })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error saving Gmail credentials:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/email/credentials/outlook - Check Outlook credentials with honest source
    httpApp.get('/api/email/credentials/outlook', async (_req, res) => {
      try {
        console.log('[HTTP-EMAIL] GET /api/email/credentials/outlook')
        const { checkExistingCredentials, isVaultUnlocked } = await import('./main/email/credentials')
        const result = await checkExistingCredentials('outlook')
        res.json({
          ok: true,
          data: {
            configured: !!result.credentials,
            clientId: result.clientId,
            source: result.source,
            credentials: result.credentials,
            hasSecret: result.hasSecret,
            vaultUnlocked: isVaultUnlocked(),
          },
        })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error checking Outlook credentials:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/email/credentials/outlook - Save Outlook OAuth credentials
    httpApp.post('/api/email/credentials/outlook', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/credentials/outlook')
        const { clientId, clientSecret, tenantId } = req.body
        if (!clientId) {
          res.status(400).json({ ok: false, error: 'clientId is required' })
          return
        }
        const { saveCredentials } = await import('./main/email/credentials')
        const storeInVault = req.body.storeInVault !== false
        const result = await saveCredentials('outlook', { clientId, clientSecret, tenantId }, storeInVault)
        res.json({ ok: result.ok, savedToVault: result.savedToVault, error: result.error })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error saving Outlook credentials:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // GET /api/email/credentials/zoho
    httpApp.get('/api/email/credentials/zoho', async (_req, res) => {
      try {
        console.log('[HTTP-EMAIL] GET /api/email/credentials/zoho')
        const { checkExistingCredentials, isVaultUnlocked } = await import('./main/email/credentials')
        const result = await checkExistingCredentials('zoho')
        res.json({
          ok: true,
          data: {
            configured: !!result.credentials,
            clientId: result.clientId,
            source: result.source,
            credentials: result.credentials,
            hasSecret: result.hasSecret,
            vaultUnlocked: isVaultUnlocked(),
          },
        })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error checking Zoho credentials:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // POST /api/email/credentials/zoho
    httpApp.post('/api/email/credentials/zoho', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/credentials/zoho')
        const { clientId, clientSecret, datacenter } = req.body
        if (!clientId || !clientSecret) {
          res.status(400).json({ ok: false, error: 'clientId and clientSecret are required' })
          return
        }
        const { saveCredentials } = await import('./main/email/credentials')
        const storeInVault = req.body.storeInVault !== false
        const result = await saveCredentials(
          'zoho',
          {
            clientId,
            clientSecret,
            datacenter: datacenter === 'eu' ? 'eu' : 'com',
          },
          storeInVault,
        )
        res.json({ ok: result.ok, savedToVault: result.savedToVault, error: result.error })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error saving Zoho credentials:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/email/accounts - List all email accounts
    httpApp.get('/api/email/accounts', async (_req, res) => {
      try {
        console.log('[HTTP-EMAIL] GET /api/email/accounts')
        const { emailGateway } = await import('./main/email/gateway')
        const accounts = await emailGateway.listAccounts()
        const persistence = emailGateway.getPersistenceDiagnostics()
        res.json({ ok: true, data: accounts, persistence })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error listing accounts:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/email/accounts/:id - Get single account
    httpApp.get('/api/email/accounts/:id', async (req, res) => {
      try {
        const { id } = req.params
        console.log('[HTTP-EMAIL] GET /api/email/accounts/:id', id)
        const { emailGateway } = await import('./main/email/gateway')
        const account = await emailGateway.getAccount(id)
        if (!account) {
          res.status(404).json({ ok: false, error: 'Account not found' })
          return
        }
        res.json({ ok: true, data: account })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error getting account:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/email/accounts/connect/gmail - Connect Gmail account via OAuth
    // Note: OAuth flows can take several minutes as user completes login in browser
    httpApp.post('/api/email/accounts/connect/gmail', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/accounts/connect/gmail')
        
        // Set longer timeout for OAuth flows (6 minutes to be safe)
        // This prevents the connection from timing out while user completes OAuth in browser
        req.setTimeout(6 * 60 * 1000)
        res.setTimeout(6 * 60 * 1000)
        
        const { displayName } = req.body
        const swRaw = req.body?.syncWindowDays
        const syncWindowDays =
          swRaw === 0
            ? 0
            : typeof swRaw === 'number' && Number.isInteger(swRaw) && swRaw > 0
              ? swRaw
              : undefined
        const rawCredSrc = req.body?.gmailOAuthCredentialSource
        const gmailOAuthCredentialSource =
          rawCredSrc === 'developer_saved' || rawCredSrc === 'builtin_public' ? rawCredSrc : undefined
        const { emailGateway } = await import('./main/email/gateway')
        
        // Try to connect - if credentials not set, show setup dialog
        try {
          console.log('[HTTP-EMAIL] Starting Gmail OAuth flow...')
          const account = await emailGateway.connectGmailAccount(
            displayName || 'Gmail Account',
            syncWindowDays,
            gmailOAuthCredentialSource !== undefined ? { gmailOAuthCredentialSource } : undefined,
          )
          if (account.status === 'active') {
            console.log('[HTTP-EMAIL] Gmail OAuth flow completed successfully')
            res.json({ ok: true, data: account })
          } else {
            console.warn('[HTTP-EMAIL] Gmail OAuth finished but account not active:', account.status, account.lastError)
            res.status(200).json({
              ok: false,
              error:
                account.lastError ||
                'Gmail sign-in completed but verification failed. The account is saved — reconnect from the app.',
              data: account,
              needsReconnect: true,
            })
          }
        } catch (credError: any) {
          console.log('[HTTP-EMAIL] OAuth error:', credError.message)
          if (credError.message?.includes('OAuth client credentials not configured')) {
            // Show setup dialog
            console.log('[HTTP-EMAIL] Showing Gmail setup dialog...')
            const { showGmailSetupDialog } = await import('./main/email/ipc')
            const result = await showGmailSetupDialog()
            if (result.success) {
              const accounts = await emailGateway.listAccounts()
              const gmailAccount = accounts.find((a) => a.provider === 'gmail')
              if (gmailAccount?.status === 'active') {
                res.json({ ok: true, data: gmailAccount })
              } else if (gmailAccount) {
                res.status(200).json({
                  ok: false,
                  error:
                    gmailAccount.lastError ||
                    'Gmail credentials configured but the account is not active — reconnect from the app.',
                  data: gmailAccount,
                  needsReconnect: true,
                })
              } else {
                res.json({ ok: false, error: 'Setup completed but account not found' })
              }
            } else {
              res.json({ ok: false, error: 'Setup cancelled' })
            }
          } else {
            throw credError
          }
        }
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error connecting Gmail:', error)
        const { pickOauthDebugFromError } = await import('./main/email/gmailOAuthConnectDebug')
        // HTTP 200 so the extension HTTP client returns JSON body (ok/error/debug) instead of retrying on 5xx.
        res.status(200).json({
          ok: false,
          error: error?.message != null ? String(error.message) : 'Unknown error',
          debug: pickOauthDebugFromError(error),
        })
      }
    })
    
    // POST /api/email/accounts/connect/outlook - Connect Outlook account via OAuth
    // Note: OAuth flows can take several minutes as user completes login in browser
    httpApp.post('/api/email/accounts/connect/outlook', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/accounts/connect/outlook')
        
        // Set longer timeout for OAuth flows (6 minutes to be safe)
        // This prevents the connection from timing out while user completes OAuth in browser
        req.setTimeout(6 * 60 * 1000)
        res.setTimeout(6 * 60 * 1000)
        
        const { displayName } = req.body
        const swRaw = req.body?.syncWindowDays
        const syncWindowDays =
          swRaw === 0
            ? 0
            : typeof swRaw === 'number' && Number.isInteger(swRaw) && swRaw > 0
              ? swRaw
              : undefined
        const { emailGateway } = await import('./main/email/gateway')
        
        // Try to connect - if credentials not set, show setup dialog
        try {
          console.log('[HTTP-EMAIL] Starting Outlook OAuth flow...')
          const account = await emailGateway.connectOutlookAccount(displayName || 'Outlook Account', syncWindowDays)
          if (account.status === 'active') {
            console.log('[HTTP-EMAIL] Outlook OAuth flow completed successfully')
            res.json({ ok: true, data: account })
          } else {
            console.warn(
              '[HTTP-EMAIL] Outlook OAuth finished but account not active:',
              account.status,
              account.lastError,
            )
            res.status(200).json({
              ok: false,
              error:
                account.lastError ||
                'Microsoft 365 sign-in completed but verification failed. The account is saved — reconnect from the app.',
              data: account,
              needsReconnect: true,
            })
          }
        } catch (credError: any) {
          console.log('[HTTP-EMAIL] OAuth error:', credError.message)
          if (credError.message?.includes('OAuth client credentials not configured')) {
            // Show setup dialog
            console.log('[HTTP-EMAIL] Showing Outlook setup dialog...')
            const { showOutlookSetupDialog } = await import('./main/email/ipc')
            const result = await showOutlookSetupDialog()
            if (result.success) {
              const accounts = await emailGateway.listAccounts()
              const outlookAccount = accounts.find((a) => a.provider === 'microsoft365')
              if (outlookAccount?.status === 'active') {
                res.json({ ok: true, data: outlookAccount })
              } else if (outlookAccount) {
                res.status(200).json({
                  ok: false,
                  error:
                    outlookAccount.lastError ||
                    'Microsoft 365 credentials configured but the account is not active — reconnect from the app.',
                  data: outlookAccount,
                  needsReconnect: true,
                })
              } else {
                res.json({ ok: false, error: 'Setup completed but account not found' })
              }
            } else {
              res.json({ ok: false, error: 'Setup cancelled' })
            }
          } else {
            throw credError
          }
        }
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error connecting Outlook:', error)
        const { pickOauthDebugFromError } = await import('./main/email/gmailOAuthConnectDebug')
        res.status(200).json({
          ok: false,
          error: error?.message != null ? String(error.message) : 'Unknown error',
          debug: pickOauthDebugFromError(error),
        })
      }
    })

    httpApp.post('/api/email/accounts/connect/zoho', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/accounts/connect/zoho')
        req.setTimeout(6 * 60 * 1000)
        res.setTimeout(6 * 60 * 1000)
        const { displayName } = req.body
        const swRaw = req.body?.syncWindowDays
        const syncWindowDays =
          swRaw === 0
            ? 0
            : typeof swRaw === 'number' && Number.isInteger(swRaw) && swRaw > 0
              ? swRaw
              : undefined
        const { emailGateway } = await import('./main/email/gateway')
        try {
          const account = await emailGateway.connectZohoAccount(displayName || 'Zoho Mail', syncWindowDays)
          if (account.status === 'active') {
            res.json({ ok: true, data: account })
          } else {
            console.warn('[HTTP-EMAIL] Zoho OAuth finished but account not active:', account.status, account.lastError)
            res.status(200).json({
              ok: false,
              error:
                account.lastError ||
                'Zoho sign-in completed but verification failed. The account is saved — reconnect from the app.',
              data: account,
              needsReconnect: true,
            })
          }
        } catch (credError: any) {
          if (
            credError.message?.includes('not configured') ||
            credError.message?.includes('Client ID')
          ) {
            res.status(200).json({ ok: false, error: credError.message })
          } else {
            throw credError
          }
        }
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error connecting Zoho:', error)
        const { pickOauthDebugFromError } = await import('./main/email/gmailOAuthConnectDebug')
        res.status(200).json({
          ok: false,
          error: error?.message != null ? String(error.message) : 'Unknown error',
          debug: pickOauthDebugFromError(error),
        })
      }
    })
    
    // POST /api/email/accounts/connect/imap - Connect IMAP account
    httpApp.post('/api/email/accounts/connect/imap', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/accounts/connect/imap')
        const { displayName, email, host, port, username, password, security, syncWindowDays: imapSw } = req.body
        const swRaw = imapSw
        const syncWindowDays =
          swRaw === 0
            ? 0
            : typeof swRaw === 'number' && Number.isInteger(swRaw) && swRaw > 0
              ? swRaw
              : undefined
        
        if (!email || !host || !username || !password) {
          res.status(400).json({ ok: false, error: 'Missing required fields: email, host, username, password' })
          return
        }
        
        const { emailGateway } = await import('./main/email/gateway')
        const account = await emailGateway.connectImapAccount({
          displayName: displayName || email,
          email,
          host,
          port: port || 993,
          username,
          password,
          security: security || 'ssl',
          syncWindowDays,
        })
        res.json({ ok: true, data: account })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error connecting IMAP:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // POST /api/email/accounts/connect/custom-mailbox — IMAP + SMTP (both required)
    httpApp.post('/api/email/accounts/connect/custom-mailbox', async (req, res) => {
      try {
        console.log('[HTTP-EMAIL] POST /api/email/accounts/connect/custom-mailbox')
        const b = req.body || {}
        const swRaw = b.syncWindowDays
        const customSyncWindowDays =
          swRaw === 0
            ? 0
            : typeof swRaw === 'number' && Number.isInteger(swRaw) && swRaw > 0
              ? swRaw
              : undefined
        const { emailGateway } = await import('./main/email/gateway')
        const account = await emailGateway.connectCustomImapSmtpAccount({
          displayName: typeof b.displayName === 'string' ? b.displayName : undefined,
          email: String(b.email || ''),
          imapHost: String(b.imapHost || ''),
          imapPort: Number(b.imapPort) || 993,
          imapSecurity: b.imapSecurity === 'starttls' || b.imapSecurity === 'none' ? b.imapSecurity : 'ssl',
          imapUsername: typeof b.imapUsername === 'string' ? b.imapUsername : undefined,
          imapPassword: String(b.imapPassword || ''),
          smtpHost: String(b.smtpHost || ''),
          smtpPort: Number(b.smtpPort) || 587,
          smtpSecurity: b.smtpSecurity === 'ssl' || b.smtpSecurity === 'none' ? b.smtpSecurity : 'starttls',
          smtpUseSameCredentials: b.smtpUseSameCredentials !== false,
          smtpUsername: typeof b.smtpUsername === 'string' ? b.smtpUsername : undefined,
          smtpPassword: typeof b.smtpPassword === 'string' ? b.smtpPassword : undefined,
          ...(customSyncWindowDays !== undefined ? { syncWindowDays: customSyncWindowDays } : {}),
        })
        res.json({ ok: true, data: account })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error connecting custom mailbox:', error)
        res.status(400).json({ ok: false, error: error.message })
      }
    })
    
    // PATCH /api/email/accounts/:id/processing-pause — pause/resume sync (non-destructive)
    httpApp.patch('/api/email/accounts/:id/processing-pause', async (req, res) => {
      try {
        const { id } = req.params
        const paused = req.body?.paused
        if (typeof paused !== 'boolean') {
          res.status(400).json({ ok: false, error: 'paused (boolean) is required' })
          return
        }
        console.log('[HTTP-EMAIL] PATCH /api/email/accounts/:id/processing-pause', id, paused)
        const { emailGateway } = await import('./main/email/gateway')
        const info = await emailGateway.setProcessingPaused(id, paused)
        res.json({ ok: true, data: info })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error setting processing pause:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // DELETE /api/email/accounts/:id - Delete email account
    httpApp.delete('/api/email/accounts/:id', async (req, res) => {
      try {
        const { id } = req.params
        console.log('[HTTP-EMAIL] DELETE /api/email/accounts/:id', id)
        const { emailGateway } = await import('./main/email/gateway')
        await emailGateway.deleteAccount(id)
        res.json({ ok: true })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error deleting account:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/email/accounts/:id/test - Test account connection
    httpApp.post('/api/email/accounts/:id/test', async (req, res) => {
      try {
        const { id } = req.params
        console.log('[HTTP-EMAIL] POST /api/email/accounts/:id/test', id)
        const { emailGateway } = await import('./main/email/gateway')
        const result = await emailGateway.testConnection(id)
        res.json({ ok: true, data: result })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error testing connection:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // POST /api/email/send - Send a new email (used by extension popup)
    httpApp.post('/api/email/send', async (req, res) => {
      try {
        const { accountId, to, subject, bodyText, attachments } = req.body
        if (!accountId || !to || !Array.isArray(to)) {
          res.status(400).json({ ok: false, error: 'accountId and to (array) are required' })
          return
        }
        console.log('[HTTP-EMAIL] POST /api/email/send', accountId)
        const { emailGateway } = await import('./main/email/gateway')
        const payload: { to: string[]; subject: string; bodyText: string; attachments?: { filename: string; mimeType: string; contentBase64: string }[] } = {
          to: Array.isArray(to) ? to : [String(to)],
          subject: subject || '(No subject)',
          bodyText: bodyText || ''
        }
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          payload.attachments = attachments.filter((a: any) => a?.filename && a?.contentBase64).map((a: any) => ({
            filename: String(a.filename),
            mimeType: a.mimeType || 'application/octet-stream',
            contentBase64: String(a.contentBase64)
          }))
        }
        const result = await emailGateway.sendEmail(accountId, payload)
        res.json({ ok: true, data: result })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error sending email:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })

    // POST /api/email/send-beap - Send BEAP package via email (default account row via pickDefaultEmailAccountRowId)
    httpApp.post('/api/email/send-beap', async (req, res) => {
      try {
        const { to, subject, body, attachments } = req.body
        if (!to || typeof to !== 'string') {
          res.status(400).json({ ok: false, error: 'to (recipient email) is required' })
          return
        }
        console.log('[HTTP-EMAIL] POST /api/email/send-beap', to)
        const { emailGateway } = await import('./main/email/gateway')
        const { pickDefaultEmailAccountRowId } = await import('./main/email/domain/accountRowPicker')
        const accounts = await emailGateway.listAccounts()
        const accountId = pickDefaultEmailAccountRowId(accounts)
        if (!accountId) {
          res.status(400).json({ ok: false, error: 'No email account connected. Connect in Settings or use Download.' })
          return
        }
        const payload: { to: string[]; subject: string; bodyText: string; attachments?: { filename: string; mimeType: string; contentBase64: string }[] } = {
          to: [String(to)],
          subject: subject || 'BEAP™ Secure Message',
          bodyText: body || ''
        }
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          payload.attachments = attachments.filter((a: any) => a?.name && a?.data != null).map((a: any) => ({
            filename: String(a.name),
            mimeType: a.mime || 'application/json',
            contentBase64: Buffer.from(String(a.data), 'utf-8').toString('base64')
          }))
        }
        const result = await emailGateway.sendEmail(accountId, payload)
        res.json({ ok: true, data: result })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error sending BEAP email:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/email/accounts/:id/messages - List messages
    httpApp.get('/api/email/accounts/:id/messages', async (req, res) => {
      try {
        const { id } = req.params
        const options = {
          folder: req.query.folder as string,
          limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
          from: req.query.from as string,
          subject: req.query.subject as string,
          unreadOnly: req.query.unreadOnly === 'true',
          hasAttachments: req.query.hasAttachments === 'true'
        }
        console.log('[HTTP-EMAIL] GET /api/email/accounts/:id/messages', id, options)
        const { emailGateway } = await import('./main/email/gateway')
        const messages = await emailGateway.listMessages(id, options)
        res.json({ ok: true, data: messages })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error listing messages:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/email/accounts/:id/messages/:messageId - Get single message
    httpApp.get('/api/email/accounts/:id/messages/:messageId', async (req, res) => {
      try {
        const { id, messageId } = req.params
        console.log('[HTTP-EMAIL] GET /api/email/accounts/:id/messages/:messageId', id, messageId)
        const { emailGateway } = await import('./main/email/gateway')
        const message = await emailGateway.getMessage(id, messageId)
        if (!message) {
          res.status(404).json({ ok: false, error: 'Message not found' })
          return
        }
        res.json({ ok: true, data: message })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error getting message:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // GET /api/email/presets - Get IMAP provider presets
    httpApp.get('/api/email/presets', async (_req, res) => {
      try {
        console.log('[HTTP-EMAIL] GET /api/email/presets')
        const { IMAP_PRESETS } = await import('./main/email/types')
        res.json({ ok: true, data: IMAP_PRESETS })
      } catch (error: any) {
        console.error('[HTTP-EMAIL] Error getting presets:', error)
        res.status(500).json({ ok: false, error: error.message })
      }
    })
    
    // =================================================================
    // PDF Parser API Endpoints
    // =================================================================
    
    // Safety limits for PDF parsing
    const PDF_PARSER_LIMITS = {
      MAX_PAGES: 300,
      MAX_EXTRACTED_CHARS: 5 * 1024 * 1024, // 5MB of text
      MAX_INPUT_SIZE_MB: 100
    }

    /**
     * Shared PDF text extraction for HTTP (extension + X-Launch-Secret) and IPC (trusted Electron renderer).
     * Renderer must NOT call HTTP without the secret — use ipcMain.invoke('parser:extractPdfText') instead.
     */
    async function extractPdfTextForIpc(
      attachmentId: unknown,
      base64: unknown
    ): Promise<
      | { ok: true; json: Record<string, unknown> }
      | { ok: false; status: number; json: { success: false; error: string } }
    > {
      if (!attachmentId || typeof attachmentId !== 'string') {
        return { ok: false, status: 400, json: { success: false, error: 'Missing or invalid attachmentId' } }
      }
      if (!base64 || typeof base64 !== 'string') {
        return { ok: false, status: 400, json: { success: false, error: 'Missing or invalid base64 PDF data' } }
      }
      const inputSizeMB = (base64.length * 0.75) / (1024 * 1024)
      if (inputSizeMB > PDF_PARSER_LIMITS.MAX_INPUT_SIZE_MB) {
        return {
          ok: false,
          status: 400,
          json: {
            success: false,
            error: `PDF too large: ${inputSizeMB.toFixed(1)}MB exceeds ${PDF_PARSER_LIMITS.MAX_INPUT_SIZE_MB}MB limit`,
          },
        }
      }
      try {
        const binaryString = Buffer.from(base64, 'base64')
        const pdfData = new Uint8Array(binaryString)
        const pdfjsLib = await import('pdfjs-dist')
        const { pathToFileURL } = await import('url')
        const path = await import('path')
        const workerPath = path.join(__dirname, 'pdf.worker.mjs')
        pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
        const loadingTask = pdfjsLib.getDocument({ data: pdfData })
        const pdfDoc = await loadingTask.promise
        const pageCount = pdfDoc.numPages
        const pagesToProcess = Math.min(pageCount, PDF_PARSER_LIMITS.MAX_PAGES)
        let truncatedPages = false
        if (pageCount > PDF_PARSER_LIMITS.MAX_PAGES) {
          truncatedPages = true
        }
        const textParts: string[] = []
        let totalChars = 0
        let truncatedChars = false
        for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
          const page = await pdfDoc.getPage(pageNum)
          const textContent = await page.getTextContent()
          let pageText = ''
          for (const item of textContent.items) {
            if ('str' in item && typeof item.str === 'string') {
              pageText += item.str
              if ('hasEOL' in item && item.hasEOL) {
                pageText += '\n'
              }
            }
          }
          pageText = pageText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
          if (totalChars + pageText.length > PDF_PARSER_LIMITS.MAX_EXTRACTED_CHARS) {
            const remaining = PDF_PARSER_LIMITS.MAX_EXTRACTED_CHARS - totalChars
            if (remaining > 0) {
              textParts.push(pageText.substring(0, remaining))
            }
            truncatedChars = true
            break
          }
          textParts.push(pageText)
          totalChars += pageText.length
        }
        let extractedText = textParts.join('\n\n')
        const warnings: string[] = []
        if (truncatedPages) {
          warnings.push(`[TRUNCATED: Only first ${PDF_PARSER_LIMITS.MAX_PAGES} of ${pageCount} pages processed]`)
        }
        if (truncatedChars) {
          warnings.push(`[TRUNCATED: Text exceeded ${PDF_PARSER_LIMITS.MAX_EXTRACTED_CHARS} character limit]`)
        }
        if (warnings.length > 0) {
          extractedText = warnings.join('\n') + '\n\n' + extractedText
        }
        const pdfjsVersion = pdfjsLib.version || 'unknown'
        console.log(`[PDF-PARSER] Extracted ${totalChars} chars from ${pagesToProcess} pages (attachmentId: ${attachmentId})`)
        return {
          ok: true,
          json: {
            success: true,
            pageCount,
            pagesProcessed: pagesToProcess,
            extractedText,
            truncated: truncatedPages || truncatedChars,
            parser: { engine: 'pdfjs', version: pdfjsVersion },
          },
        }
      } catch (error: any) {
        console.error('[PDF-PARSER] Error extracting PDF text:', error.message)
        return {
          ok: false,
          status: 500,
          json: { success: false, error: error.message || 'Failed to extract PDF text' },
        }
      }
    }

    // POST /api/parser/pdf/extract - Extract text from PDF (extension: requires X-Launch-Secret)
    httpApp.post('/api/parser/pdf/extract', async (req, res) => {
      const out = await extractPdfTextForIpc(req.body?.attachmentId, req.body?.base64)
      if (!out.ok) {
        res.status(out.status).json(out.json)
        return
      }
      res.json(out.json)
    })

    ipcMain.handle('parser:extractPdfText', async (_e, payload: unknown) => {
      const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const out = await extractPdfTextForIpc(p.attachmentId, p.base64)
      if (!out.ok) {
        return { success: false, error: out.json.error }
      }
      return out.json
    })
    
    // =================================================================
    // PDF Rasterization Endpoint
    // =================================================================
    
    // Safety limits for PDF rasterization
    const PDF_RASTER_LIMITS = {
      MAX_PAGES: 300,
      MAX_DPI: 300,
      DEFAULT_DPI: 144,
      MIN_DPI: 72,
      MAX_TOTAL_PIXELS: 200 * 1024 * 1024 // 200 megapixels total across all pages
    }
    
    // POST /api/parser/pdf/rasterize - Rasterize PDF pages to PNG artefacts
    httpApp.post('/api/parser/pdf/rasterize', async (req, res) => {
      try {
        const { attachmentId, base64, dpi: requestedDpi } = req.body
        
        if (!attachmentId || typeof attachmentId !== 'string') {
          res.status(400).json({ success: false, error: 'Missing or invalid attachmentId' })
          return
        }
        
        if (!base64 || typeof base64 !== 'string') {
          res.status(400).json({ success: false, error: 'Missing or invalid base64 PDF data' })
          return
        }
        
        // Validate and clamp DPI
        let dpi = PDF_RASTER_LIMITS.DEFAULT_DPI
        if (typeof requestedDpi === 'number') {
          dpi = Math.max(PDF_RASTER_LIMITS.MIN_DPI, Math.min(PDF_RASTER_LIMITS.MAX_DPI, requestedDpi))
        }
        
        // Check input size
        const inputSizeMB = (base64.length * 0.75) / (1024 * 1024)
        if (inputSizeMB > PDF_PARSER_LIMITS.MAX_INPUT_SIZE_MB) {
          res.status(400).json({ 
            success: false, 
            error: `PDF too large: ${inputSizeMB.toFixed(1)}MB exceeds ${PDF_PARSER_LIMITS.MAX_INPUT_SIZE_MB}MB limit` 
          })
          return
        }
        
        // Decode base64 to Uint8Array
        const binaryString = Buffer.from(base64, 'base64')
        const pdfData = new Uint8Array(binaryString)
        
        // Import required modules
        const pdfjsLib = await import('pdfjs-dist')
        const { pathToFileURL } = await import('url')
        const pathModule = await import('path')
        const fsModule = await import('fs')
        const cryptoModule = await import('crypto')
        const { homedir } = await import('os')
        
        // Set worker source to bundled worker
        const workerPath = pathModule.join(__dirname, 'pdf.worker.mjs')
        pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
        
        // Load canvas module (node-canvas with Path2D support)
        let canvasModule: any
        try {
          canvasModule = await import('canvas')
        } catch (canvasErr) {
          console.error('[PDF-RASTER] canvas module not available:', (canvasErr as Error).message)
          res.status(500).json({ 
            success: false, 
            error: 'Canvas module not available for rasterization. Install canvas package.' 
          })
          return
        }
        
        // Load PDF document
        const loadingTask = pdfjsLib.getDocument({ 
          data: pdfData,
          verbosity: 0 // Suppress warnings
        })
        const pdfDoc = await loadingTask.promise
        
        const pageCount = pdfDoc.numPages
        
        // Check page limit
        if (pageCount > PDF_RASTER_LIMITS.MAX_PAGES) {
          res.status(400).json({
            success: false,
            error: `PDF has ${pageCount} pages, exceeds limit of ${PDF_RASTER_LIMITS.MAX_PAGES}`,
            code: 'MAX_PAGES_EXCEEDED'
          })
          return
        }
        
        // Create artefact storage directory
        const artefactDir = pathModule.join(homedir(), '.opengiraffe', 'electron-data', 'raster-artefacts')
        if (!fsModule.existsSync(artefactDir)) {
          fsModule.mkdirSync(artefactDir, { recursive: true })
        }
        
        // Track total pixels for limit enforcement
        let totalPixels = 0
        const pages: Array<{
          page: number
          width: number
          height: number
          bytes: number  // PNG file size in bytes
          sha256: string
          artefactRef: string
          base64: string  // Base64-encoded PNG data
          mime: string    // MIME type (image/png)
        }> = []
        
        // Get PDF.js version for provenance
        const pdfjsVersion = pdfjsLib.version || 'unknown'
        
        // Scale factor for DPI (72 DPI is the PDF default)
        const scale = dpi / 72
        
        for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
          const page = await pdfDoc.getPage(pageNum)
          
          // Calculate dimensions at requested DPI
          const viewport = page.getViewport({ scale })
          const width = Math.floor(viewport.width)
          const height = Math.floor(viewport.height)
          
          // Check pixel limit
          const pagePixels = width * height
          if (totalPixels + pagePixels > PDF_RASTER_LIMITS.MAX_TOTAL_PIXELS) {
            console.log(`[PDF-RASTER] Stopping at page ${pageNum}: pixel limit reached (${totalPixels} + ${pagePixels} > ${PDF_RASTER_LIMITS.MAX_TOTAL_PIXELS})`)
            res.status(400).json({
              success: false,
              error: `Total pixels would exceed limit at page ${pageNum}`,
              code: 'MAX_TOTAL_PIXELS_EXCEEDED',
              processedPages: pages.length
            })
            return
          }
          totalPixels += pagePixels
          
          // Create canvas for this page
          const canvas = canvasModule.createCanvas(width, height)
          const context = canvas.getContext('2d')
          
          // Fill with white background
          context.fillStyle = 'white'
          context.fillRect(0, 0, width, height)
          
          // Render PDF page to canvas
          const renderContext = {
            canvasContext: context,
            viewport: viewport
          }
          
          await page.render(renderContext).promise
          
          // Convert to WEBP buffer (quality 0.85 for good balance of size/quality)
          const webpBuffer = canvas.toBuffer('image/webp', { quality: 0.85 })
          
          // Calculate SHA-256 hash over raw WEBP bytes
          const sha256 = cryptoModule.createHash('sha256').update(webpBuffer).digest('hex')
          
          // Generate artefact reference
          const artefactRef = `raster_${attachmentId}_p${pageNum}_${sha256.substring(0, 8)}.webp`
          const artefactPath = pathModule.join(artefactDir, artefactRef)
          
          // Write WEBP to artefact store
          fsModule.writeFileSync(artefactPath, webpBuffer)
          
          // Convert WEBP buffer to base64 for in-memory transfer
          const webpBase64 = webpBuffer.toString('base64')
          
          pages.push({
            page: pageNum,
            width,
            height,
            bytes: webpBuffer.length,
            sha256,
            artefactRef,
            base64: webpBase64,
            mime: 'image/webp'
          })
          
          // DO NOT log image content (security requirement)
        }
        
        // DO NOT log image bytes (security requirement)
        console.log(`[PDF-RASTER] Rasterized ${pages.length} pages at ${dpi}dpi (attachmentId: ${attachmentId}, totalPixels: ${totalPixels})`)
        
        res.json({
          success: true,
          pageCount,
          pagesRasterized: pages.length,
          pages,
          raster: {
            engine: 'pdfjs',
            version: pdfjsVersion,
            dpi
          }
        })
        
      } catch (error: any) {
        console.error('[PDF-RASTER] Error rasterizing PDF:', error.message)
        res.status(500).json({ 
          success: false, 
          error: error.message || 'Failed to rasterize PDF'
        })
      }
    })
    
    // =================================================================
    // Post-Quantum KEM Endpoints (ML-KEM-768)
    // =================================================================
    // Per canon A.3.054.10: "uses post-quantum encryption as the default for qBEAP"
    // Per canon A.3.13: ".qBEAP MUST be encrypted using post-quantum-ready end-to-end cryptography"
    
    // GET /api/crypto/pq/status - Check if PQ crypto is available
    httpApp.get('/api/crypto/pq/status', async (_req, res) => {
      try {
        // Dynamic import of @noble/post-quantum/ml-kem
        const pq = await import('@noble/post-quantum/ml-kem')
        const mlKem768Available = typeof pq.ml_kem768?.encapsulate === 'function'
        
        res.json({
          success: true,
          pq: {
            available: mlKem768Available,
            kem: 'ML-KEM-768',
            library: '@noble/post-quantum',
            version: '0.2.1'
          }
        })
      } catch (error: any) {
        console.error('[PQ-KEM] Error checking PQ status:', error.message)
        res.json({
          success: true,
          pq: {
            available: false,
            kem: 'ML-KEM-768',
            error: error.message || 'PQ library not available'
          }
        })
      }
    })
    
    // POST /api/crypto/pq/mlkem768/keypair - Generate a new ML-KEM-768 keypair
    httpApp.post('/api/crypto/pq/mlkem768/keypair', async (_req, res) => {
      try {
        const pq = await import('@noble/post-quantum/ml-kem')
        
        // Generate keypair
        const keypair = pq.ml_kem768.keygen()
        
        // Encode to base64
        const publicKeyB64 = Buffer.from(keypair.publicKey).toString('base64')
        const secretKeyB64 = Buffer.from(keypair.secretKey).toString('base64')
        
        // TODO: In production, store secretKey in vault with a keyId
        // For MVP, return it (caller should store securely)
        const keyId = `pq_mlkem768_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`
        
        console.log(`[PQ-KEM] Generated ML-KEM-768 keypair: ${keyId}`)
        
        res.json({
          success: true,
          kem: 'ML-KEM-768',
          keyId,
          publicKeyB64,
          // WARNING: secretKeyB64 should be stored in vault in production
          // Returning here for MVP only
          secretKeyB64
        })
      } catch (error: any) {
        console.error('[PQ-KEM] Error generating keypair:', error.message)
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to generate ML-KEM-768 keypair'
        })
      }
    })
    
    // POST /api/crypto/pq/mlkem768/encapsulate - Encapsulate a shared secret
    // Sender-side operation: creates ciphertext + shared secret using recipient's public key
    httpApp.post('/api/crypto/pq/mlkem768/encapsulate', async (req, res) => {
      try {
        const { peerPublicKeyB64 } = req.body
        
        if (!peerPublicKeyB64 || typeof peerPublicKeyB64 !== 'string') {
          res.status(400).json({
            success: false,
            error: 'peerPublicKeyB64 is required (base64-encoded ML-KEM-768 public key)'
          })
          return
        }
        
        const pq = await import('@noble/post-quantum/ml-kem')
        
        // Decode peer's public key
        const peerPublicKey = new Uint8Array(Buffer.from(peerPublicKeyB64, 'base64'))
        
        // Validate key size (ML-KEM-768 public key is 1184 bytes)
        if (peerPublicKey.length !== 1184) {
          res.status(400).json({
            success: false,
            error: `Invalid ML-KEM-768 public key size: expected 1184 bytes, got ${peerPublicKey.length}`
          })
          return
        }
        
        // Encapsulate: generates ciphertext and shared secret
        const { cipherText, sharedSecret } = pq.ml_kem768.encapsulate(peerPublicKey)
        
        // Encode results to base64
        const ciphertextB64 = Buffer.from(cipherText).toString('base64')
        const sharedSecretB64 = Buffer.from(sharedSecret).toString('base64')
        
        // DO NOT log shared secret (security requirement)
        console.log(`[PQ-KEM] ML-KEM-768 encapsulation successful (ciphertext: ${cipherText.length} bytes)`)
        
        res.json({
          success: true,
          kem: 'ML-KEM-768',
          ciphertextB64,
          sharedSecretB64
        })
      } catch (error: any) {
        console.error('[PQ-KEM] Error during encapsulation:', error.message)
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to encapsulate with ML-KEM-768'
        })
      }
    })
    
    // POST /api/crypto/pq/mlkem768/decapsulate - Decapsulate a shared secret
    // Recipient-side operation: recovers shared secret using local secret key
    httpApp.post('/api/crypto/pq/mlkem768/decapsulate', async (req, res) => {
      try {
        const { ciphertextB64, secretKeyB64 } = req.body
        
        if (!ciphertextB64 || typeof ciphertextB64 !== 'string') {
          res.status(400).json({
            success: false,
            error: 'ciphertextB64 is required (base64-encoded ML-KEM-768 ciphertext)'
          })
          return
        }
        
        if (!secretKeyB64 || typeof secretKeyB64 !== 'string') {
          res.status(400).json({
            success: false,
            error: 'secretKeyB64 is required (base64-encoded ML-KEM-768 secret key)'
          })
          return
        }
        
        const pq = await import('@noble/post-quantum/ml-kem')
        
        // Decode inputs
        const ciphertext = new Uint8Array(Buffer.from(ciphertextB64, 'base64'))
        const secretKey = new Uint8Array(Buffer.from(secretKeyB64, 'base64'))
        
        // Validate sizes
        if (ciphertext.length !== 1088) {
          res.status(400).json({
            success: false,
            error: `Invalid ML-KEM-768 ciphertext size: expected 1088 bytes, got ${ciphertext.length}`
          })
          return
        }
        
        if (secretKey.length !== 2400) {
          res.status(400).json({
            success: false,
            error: `Invalid ML-KEM-768 secret key size: expected 2400 bytes, got ${secretKey.length}`
          })
          return
        }
        
        // Decapsulate: recover shared secret
        const sharedSecret = pq.ml_kem768.decapsulate(ciphertext, secretKey)
        
        // Encode result to base64
        const sharedSecretB64 = Buffer.from(sharedSecret).toString('base64')
        
        // DO NOT log shared secret (security requirement)
        console.log(`[PQ-KEM] ML-KEM-768 decapsulation successful`)
        
        res.json({
          success: true,
          kem: 'ML-KEM-768',
          sharedSecretB64
        })
      } catch (error: any) {
        console.error('[PQ-KEM] Error during decapsulation:', error.message)
        res.status(500).json({
          success: false,
          error: error.message || 'Failed to decapsulate with ML-KEM-768'
        })
      }
    })
    
    // ==========================================================================
    // HTTP API SERVER - FIXED PORT (NO FALLBACK)
    // ==========================================================================
    // CRITICAL: Chrome extension hardcodes port 51248. If we bind to any other
    // port, the extension cannot reach us. Therefore:
    // - We MUST use port 51248 exactly
    // - If port 51248 is unavailable, we MUST fail loudly and exit
    // - NO silent fallback to alternative ports
    // ==========================================================================
    
    // ==========================================================================
    // PHASE: MOUNT EXPRESS on the early HTTP bridge server
    // ==========================================================================
    // The early bridge (started right after ensurePortsAvailable) has been
    // serving /api/health while all routes above were being registered.
    // Now mount the full Express app so every route is reachable.
    // ==========================================================================

    if (httpBridgeServer) {
      httpBridgeServer.removeAllListeners('request')
      httpBridgeServer.on('request', httpApp)
      console.log(`[BOOT] ✅ Full Express app mounted on http://127.0.0.1:${HTTP_PORT}`)
      console.log(`[BOOT] Extension can now connect to Electron (all routes active)`)
    } else {
      // Fallback: early bridge failed to start, create a new server
      console.log(`[BOOT] Starting HTTP API server on FIXED port ${HTTP_PORT}...`)
      console.log(`[BOOT] Extension expects: http://127.0.0.1:${HTTP_PORT}`)

      const server = httpApp.listen(HTTP_PORT, '127.0.0.1', () => {
        console.log(`[BOOT] ✅ HTTP API listening on http://127.0.0.1:${HTTP_PORT}`)
        console.log(`[BOOT] Extension can now connect to Electron`)
        server.timeout = 10 * 60 * 1000
        server.keepAliveTimeout = 10 * 60 * 1000
      })

      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[BOOT] ❌ FATAL: Port ${HTTP_PORT} is already in use`)
          console.error(`[BOOT] ❌ The Chrome extension expects Electron on port ${HTTP_PORT}`)
          dialog.showErrorBox(
            'WRDesk Orchestrator - Port Conflict',
            `Port ${HTTP_PORT} is already in use by another process.\n\n` +
            `The Chrome extension requires Electron to be available on this exact port.\n\n` +
            `Please close any previous WRDesk instance or other application using port ${HTTP_PORT}, then restart WRDesk Orchestrator.`
          )
          app.exit(1)
        } else {
          console.error('[BOOT] ❌ HTTP server error:', err.message)
          app.exit(1)
        }
      })
    }

    // P2P outbound queue + P2P server startup (default-on, start as soon as db available)
    let p2pServerStarted = false
    let coordinationWsClient: ReturnType<typeof createCoordinationWsClient> | null = null
    const getHandshakeDb = () => getLedgerDb() ?? (globalThis as any).__og_vault_service_ref?.getDb?.() ?? (globalThis as any).__og_vault_service_ref?.db ?? null

    setBeapRecipientPendingNotifier((handshakeId) => {
      broadcastToExtensions({ type: 'P2P_BEAP_RECEIVED', handshakeId })
      const db = getHandshakeDb()
      if (!db) return
      try {
        void processPendingP2PBeapEmails(db).then((n) => {
          if (n > 0) notifyBeapInboxDashboard(handshakeId)
          void retryPendingQbeapDecrypt(db).then((r) => {
            if (r > 0) notifyBeapInboxDashboard(handshakeId)
          })
        })
      } catch (e: unknown) {
        console.error('[BEAP-INBOX] Import failed:', (e as Error)?.message ?? e)
      }
    })

    async function getOidcToken(): Promise<string | null> {
      try {
        const session = await ensureSession()
        return session.accessToken ?? getAccessToken()
      } catch {
        return null
      }
    }

    function tryP2PStartup(): void {
      const handshakeDb = getHandshakeDb()
      if (!handshakeDb) {
        return // Ledger not ready yet — will retry in 10s
      }
      try {
        void processPendingP2PBeapEmails(handshakeDb).then((drained) => {
          if (drained > 0) notifyBeapInboxDashboard(null)
          void retryPendingQbeapDecrypt(handshakeDb).then((r) => {
            if (r > 0) notifyBeapInboxDashboard(null)
          })
        })
      } catch (e: unknown) {
        console.error('[BEAP-INBOX] Import failed:', (e as Error)?.message ?? e)
      }
      processOutboundQueue(handshakeDb, getOidcToken).catch((err) => {
        console.warn('[P2P] processOutboundQueue error:', err?.message)
      })

      // Re-trigger context_sync for any ACCEPTED handshakes where we haven't sent yet
      // (context_sync_pending=1, vault now unlocked). Also retry for stuck ACCEPTED
      // handshakes where context_sync_pending=0 but last_seq_received=0 (we sent but
      // counterparty may not have received — re-enqueue so their relay retries delivery).
      const session = getCurrentSession()
      if (session) {
        completePendingContextSyncs(handshakeDb, session)
        try {
          const stuckRows = handshakeDb.prepare(
            `SELECT handshake_id, last_capsule_hash_received, last_seq_received
             FROM handshakes
             WHERE state = 'ACCEPTED'
               AND context_sync_pending = 0
               AND last_seq_received = 0
               AND created_at < datetime('now', '-5 seconds')`
          ).all() as Array<{ handshake_id: string; last_capsule_hash_received: string; last_seq_received: number }>
          for (const row of stuckRows) {
            console.log('[P2P] Re-triggering context_sync for stuck ACCEPTED handshake:', row.handshake_id)
            const result = tryEnqueueContextSync(handshakeDb, row.handshake_id, session, {
              lastCapsuleHash: row.last_capsule_hash_received ?? '',
              lastSeqReceived: 0,
            })
            if (result.success) {
              processOutboundQueue(handshakeDb, getOidcToken).catch(() => {})
            }
          }
        } catch (err: any) {
          console.warn('[P2P] Stuck ACCEPTED re-trigger error:', err?.message)
        }
      }
      const p2pConfig = getP2PConfig(handshakeDb)
      setP2PHealthRelayMode(p2pConfig.relay_mode, p2pConfig.use_coordination)
      // Only pull from relay when relay_mode=remote (coordination mode uses WebSocket push)
      if (p2pConfig.relay_mode === 'remote') {
        pullFromRelay(handshakeDb, () => getCurrentSession()).catch((err) => {
          console.warn('[P2P] pullFromRelay error:', err?.message)
        })
      }
      if (!p2pServerStarted) {
        try {
          migrateHandshakeTables(handshakeDb)
          setOutboundQueueAuthRefresh(async () => {
            await ensureSession()
          })
          const config = getP2PConfig(handshakeDb)
          if (config.enabled) {
            const getDb = () => getHandshakeDb()
            const getSsoSession = () => getCurrentSession()
            const server = createP2PServer(
              config,
              getDb,
              getSsoSession,
              (localEndpoint) => {
                try {
                  upsertP2PConfig(handshakeDb, { local_p2p_endpoint: localEndpoint })
                  console.log('[P2P] local_p2p_endpoint:', localEndpoint)
                  // Self-test: connect to own endpoint
                  fetch(localEndpoint, { method: 'POST', body: JSON.stringify({ handshake_id: 'self-test' }), headers: { 'Content-Type': 'application/json' } })
                    .then(() => setP2PHealthSelfTest(true))
                    .catch(() => setP2PHealthSelfTest(false))
                } catch {}
              },
              () => { p2pServerStarted = false },
            )
            if (server) p2pServerStarted = true
          }
        } catch (err: any) {
          console.warn('[P2P] Server startup skipped:', err?.message)
        }
      }
      // Coordination WebSocket: connect when use_coordination (receives capsules from relay)
      const coordConfig = getP2PConfig(handshakeDb)
      if (coordConfig?.use_coordination && coordConfig?.coordination_enabled) {
        if (!coordinationWsClient) {
          console.log('[P2P] Starting coordination WebSocket client (relay:', coordConfig.coordination_ws_url, ')')
          coordinationWsClient = createCoordinationWsClient(
            coordConfig,
            () => getHandshakeDb(), // Handshake DB (ledger or vault fallback) — receive works when either is ready
            () => getCurrentSession(),
            getOidcToken,
            {
              onHandshakeUpdated: () => {
                try { win?.webContents.send('handshake-list-refresh') } catch { /* no window */ }
              },
            },
          )
          coordinationWsClient.connect().catch((err) => {
            console.warn('[Coordination] WS connect error:', err?.message)
          })
        }
      } else if (coordinationWsClient) {
        coordinationWsClient.disconnect()
        coordinationWsClient = null
      }
    }

    onLedgerReady = tryP2PStartup
    tryP2PStartup()
    setInterval(tryP2PStartup, 10_000)

    // Refresh P2P health queue counts every 60s
    setInterval(() => {
      const db = getHandshakeDb()
      if (!db) return
      try {
        const rows = db.prepare('SELECT status, COUNT(*) as cnt FROM outbound_capsule_queue GROUP BY status').all() as Array<{ status: string; cnt: number }>
        let pending = 0, failed = 0
        for (const r of rows) {
          if (r.status === 'pending') pending = r.cnt
          else if (r.status === 'failed') failed = r.cnt
        }
        setP2PHealthQueueCounts(pending, failed)
      } catch {}
    }, 60_000)

    // Error handling is done via try-catch and httpApp.listen callback
  } catch (err) {
    console.error('[MAIN] Error in HTTP API setup:', err)
    console.error('[MAIN] Error details:', err instanceof Error ? err.message : String(err))
    console.error('[MAIN] Error stack:', err instanceof Error ? err.stack : 'No stack trace')
  }
  } catch (err) {
    console.error('[MAIN] Error in app.whenReady:', err)
  }
})

// Helpers to post to popup chat and close overlay via background
async function postScreenshotToPopup(filePath: string, sel: { x:number,y:number,w:number,h:number,dpr:number }){
  try {
    emitCapture(win!, { event: LmgtfyChannels.OnCaptureEvent, mode: 'screenshot', filePath, thumbnailPath: '', meta: { x: sel.x, y: sel.y, w: sel.w, h: sel.h, dpr: sel.dpr } })
  } catch {}
  try {
    const fs = await import('node:fs')
    const data = fs.readFileSync(filePath)
    const dataUrl = 'data:image/png;base64,' + data.toString('base64')
    const payload = JSON.stringify({ type: 'SELECTION_RESULT_IMAGE', kind: 'image', dataUrl })
    wsClients.forEach((c) => { try { c.send(payload) } catch {} })
    // Ask popup to append directly and show thumbnail
    try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('COMMAND_POPUP_APPEND',{ kind:'image', url: dataUrl, thumbnail: dataUrl }) }catch{} }) } catch {}
    try { win?.webContents.send('overlay-close') } catch {}
  } catch {}
}

async function postStreamToPopup(filePath: string){
  try {
    emitCapture(win!, { event: LmgtfyChannels.OnCaptureEvent, mode: 'stream', filePath, thumbnailPath: '', meta: { presetName: 'finalized', x: 0, y: 0, w: 0, h: 0, dpr: 1 } })
  } catch {}
  try {
    const fs = await import('node:fs')
    let dataUrl = ''
    try {
      const data = fs.readFileSync(filePath)
      const base64 = data.toString('base64')
      dataUrl = 'data:video/mp4;base64,' + base64
    } catch {}
    const payload = JSON.stringify({ type: 'SELECTION_RESULT_VIDEO', kind: 'video', dataUrl })
    wsClients.forEach((c) => { try { c.send(payload) } catch {} })
    try { const { webContents } = await import('electron'); webContents.getAllWebContents().forEach(c=>{ try{ c.send('COMMAND_POPUP_APPEND',{ kind:'video', url: dataUrl, thumbnail: dataUrl }) }catch{} }) } catch {}
    try { win?.webContents.send('overlay-close') } catch {}
  } catch {}
}
