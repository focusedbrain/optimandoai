import { handleElectronRpc, type ElectronRpcRequest } from './rpc/electronRpc'
import { WEBMCP_RESULT_VERSION } from './vault/autofill/webMcpConstants'
import type { BgWebMcpErrorCode } from './vault/autofill/webMcpAdapter'

declare global {
  var vaultRpcCallbacks: Map<string, (data: any) => void> | undefined
  var emailCallbacks: Map<string, (data: any) => void> | undefined
}

let ws: WebSocket | null = null;
let isConnecting = false;
let autoConnectInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let connectionAttempts = 0;
let lastConnectionTime = 0;
// Feature flag to completely disable WebSocket auto-connection
const WS_ENABLED = true;
// Track sidebar visibility per tab
const tabSidebarStatus = new Map<number, boolean>();
// Track if we've already tried to launch Electron this session
let electronLaunchAttempted = false;
let electronLaunchInProgress = false;
// Track the dashboard-launched popup window id so we can restore focus when it closes
let dashboardPopupWindowId: number | null = null;
// Track if MailGuard should be active (persists across reconnections)
let mailGuardShouldBeActive = false;
let lastMailGuardWindowInfo: any = null;
let lastMailGuardTheme: string = 'default';
// Track which tab has MailGuard activated (for hide/show on tab switch)
let mailGuardActiveTabId: number | null = null;

// ---------------------------------------------------------------------------
// VSBT (Vault Session Binding Token) cache
// Stored in background memory so it survives content-script reloads (popup
// close/reopen, page navigation) without requiring the user to re-unlock.
// Also persisted to chrome.storage.session (in-memory only, MV3) so it
// survives service-worker suspension without ever touching disk.
// ---------------------------------------------------------------------------
let _cachedVsbt: string | null = null;

// ---------------------------------------------------------------------------
// VSBT TTL — the cached token expires after VSBT_MAX_AGE_MS.
// If the Electron app is unreachable (crash, WS disconnect) the TTL ensures
// the extension cannot keep using a stale session indefinitely.
// The timestamp is set whenever _cacheVsbt(token) stores a non-null token.
// ---------------------------------------------------------------------------
/** Maximum age of a cached VSBT before it is considered expired (15 minutes). */
export const VSBT_MAX_AGE_MS = 15 * 60 * 1000
let _vsbtCachedAt = 0

// ---------------------------------------------------------------------------
// LAUNCH SECRET — per-launch HTTP authentication token.
// Received from the Electron main process via WebSocket handshake
// (ELECTRON_HANDSHAKE message).  Attached as X-Launch-Secret header
// on every HTTP request to 127.0.0.1:51248.  Rotates on every
// Electron app restart.  Never persisted to disk.
// ---------------------------------------------------------------------------
let _launchSecret: string | null = null;

// ---------------------------------------------------------------------------
// WebMCP rate-limit tracking: maps tabId → last invocation timestamp (ms).
// Enforces a minimum 2s gap between WEBMCP_FILL_PREVIEW calls per tab.
// ---------------------------------------------------------------------------
let _webMcpRateMap: Map<number, number> | null = null;

// ---------------------------------------------------------------------------
// WebMCP global rate limiter — sliding window (MAX_WEBMCP_PER_MIN in 60s)
// ---------------------------------------------------------------------------
/** Max WEBMCP_FILL_PREVIEW requests accepted globally in a 60-second window. */
export const MAX_WEBMCP_PER_MIN = 20
const WEBMCP_WINDOW_MS = 60_000
/** Ring buffer of accepted request timestamps for the sliding window. */
let _webMcpGlobalTimestamps: number[] = []

// ---------------------------------------------------------------------------
// WebMCP circuit breaker — trips after repeated rejection-class errors
// ---------------------------------------------------------------------------
/** Rejects in the observation window that trip the circuit. */
export const WEBMCP_CB_THRESHOLD = 10
/** Observation window for reject counting (ms). */
export const WEBMCP_CB_WINDOW_MS = 30_000
/** How long the circuit stays open once tripped (ms). */
export const WEBMCP_CB_COOLDOWN_MS = 10_000

/** Timestamps of rejection-class events (invalid params, restricted URL, forbidden). */
let _webMcpCbRejects: number[] = []
/** Epoch ms when circuit was opened; 0 = closed. */
let _webMcpCbOpenedAt = 0

/**
 * Fail-closed numeric sanitizer for rate-limit / circuit-breaker constants.
 *
 * Returns `fallback` if `value` is not a finite positive number.
 * Security degrades to STRICTER defaults — never looser.
 */
function _safePositiveInt(value: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

/** Sanitized accessor for MAX_WEBMCP_PER_MIN (fallback: 10 — stricter). */
function _effectiveMaxPerMin(): number { return _safePositiveInt(MAX_WEBMCP_PER_MIN, 10) }
/** Sanitized accessor for WEBMCP_WINDOW_MS (fallback: 60 000). */
function _effectiveWindowMs(): number { return _safePositiveInt(WEBMCP_WINDOW_MS, 60_000) }
/** Sanitized accessor for WEBMCP_CB_THRESHOLD (fallback: 5 — stricter). */
function _effectiveCbThreshold(): number { return _safePositiveInt(WEBMCP_CB_THRESHOLD, 5) }
/** Sanitized accessor for WEBMCP_CB_WINDOW_MS (fallback: 30 000). */
function _effectiveCbWindowMs(): number { return _safePositiveInt(WEBMCP_CB_WINDOW_MS, 30_000) }
/** Sanitized accessor for WEBMCP_CB_COOLDOWN_MS (fallback: 10 000). */
function _effectiveCbCooldownMs(): number { return _safePositiveInt(WEBMCP_CB_COOLDOWN_MS, 10_000) }

/**
 * Record a WebMCP rejection-class event and trip the circuit breaker
 * if the threshold is met within the observation window.
 *
 * Rejection-class events: invalid params, invalid tabId, restricted URL.
 * Per-tab rate limiting is NOT counted (it's a normal flow-control response).
 */
function _recordWebMcpReject(now: number): void {
  const cbWindowMs = _effectiveCbWindowMs()
  const cbThreshold = _effectiveCbThreshold()
  const cbCooldownMs = _effectiveCbCooldownMs()

  // Prune entries outside the observation window
  const windowStart = now - cbWindowMs
  _webMcpCbRejects = _webMcpCbRejects.filter(t => t > windowStart)
  _webMcpCbRejects.push(now)

  if (_webMcpCbRejects.length >= cbThreshold) {
    _webMcpCbOpenedAt = now
    console.warn('[BG] WEBMCP_CIRCUIT_OPEN: too many rejected requests — blocking for', cbCooldownMs, 'ms')
  }
}

// ---------------------------------------------------------------------------
// Audit Export — UI context allowlist
//
// EXPORT_AUDIT_LOG is privileged: only popup-chat.html and sidepanel.html may call
// it, and only when the vault is unlocked (VSBT present).
// ---------------------------------------------------------------------------

/** Allowed UI page filenames for EXPORT_AUDIT_LOG. */
const AUDIT_EXPORT_ALLOWED_PAGES = ['/src/popup-chat.html', '/sidepanel.html']

/** Stable result version for EXPORT_AUDIT_LOG responses. */
export const AUDIT_EXPORT_RESULT_VERSION = 'audit-export-v1'

/** Stable error codes for EXPORT_AUDIT_LOG rejection responses. */
export type AuditExportErrorCode = 'FORBIDDEN' | 'LOCKED' | 'HA_BLOCKED' | 'INTERNAL_ERROR'

/**
 * Returns true if `sender` is from an allowed extension UI context
 * (popup or sidepanel), NOT from a content-script or external page.
 *
 * Fail-closed checks (all must pass):
 *   1. sender.tab must NOT be defined — content scripts always have a tab,
 *      whereas popup / sidepanel messages do not attach a tab object.
 *   2. sender.url must be a non-empty string starting with
 *      chrome-extension://<extensionId>/.
 *   3. The path component of sender.url must match an allowed page.
 *
 * Extension popup/sidepanel have sender.url like:
 *   chrome-extension://<id>/src/popup-chat.html
 *   chrome-extension://<id>/sidepanel.html
 */
function _isExtensionUiContext(
  sender: chrome.runtime.MessageSender | undefined,
  extensionId: string,
): boolean {
  if (!sender || !sender.url || typeof sender.url !== 'string') return false

  // ── Fail-closed: content scripts always have sender.tab ──
  // Popup / sidepanel messages do NOT have sender.tab.
  if (sender.tab) return false

  const expectedPrefix = `chrome-extension://${extensionId}`
  if (!sender.url.startsWith(expectedPrefix)) return false

  // Check that the path portion matches an allowed page
  const pathStart = sender.url.indexOf('/', expectedPrefix.length)
  if (pathStart === -1) return false
  const path = sender.url.slice(pathStart).split('?')[0].split('#')[0]

  return AUDIT_EXPORT_ALLOWED_PAGES.some(allowed => path === allowed)
}

/**
 * Returns true if the vault is currently unlocked (VSBT is cached and not expired).
 *
 * The VSBT is set on successful vault login and cleared on logout/lock/WS-close.
 * Expires after VSBT_MAX_AGE_MS (fail-closed: stale token = locked).
 * This is a synchronous, zero-overhead check — no Electron RPC needed.
 */
function _isVaultUnlocked(): boolean {
  if (typeof _cachedVsbt !== 'string' || _cachedVsbt.length === 0) return false
  // TTL check — if the token is older than VSBT_MAX_AGE_MS, treat as expired
  if (_vsbtCachedAt > 0 && (Date.now() - _vsbtCachedAt) >= VSBT_MAX_AGE_MS) {
    _cacheVsbt(null) // proactively clear expired token
    return false
  }
  return true
}

/**
 * Log an EXPORT_AUDIT_LOG access decision (allowed or blocked).
 *
 * Uses dynamic import of hardening to avoid top-level dependency.
 * Message is generic — no tabId, URL, sender.url, vault state, or secrets.
 *
 * Codes:
 *   EXPORT_AUDIT_ALLOWED          — successful export (info / security under HA)
 *   EXPORT_AUDIT_BLOCKED_CONTEXT  — sender is not an allowed UI context
 *   EXPORT_AUDIT_BLOCKED_LOCKED   — vault is locked / VSBT absent
 *   EXPORT_AUDIT_BLOCKED_HA       — blocked because HA mode is active (always security)
 *
 * @param code  Audit event code
 * @param msg   Short, safe message (no PII/secrets/URLs)
 * @param ha    Whether HA mode is currently active
 */
function _auditExportLog(
  code: 'EXPORT_AUDIT_ALLOWED' | 'EXPORT_AUDIT_BLOCKED_CONTEXT' | 'EXPORT_AUDIT_BLOCKED_LOCKED' | 'EXPORT_AUDIT_BLOCKED_HA',
  msg: string,
  ha: boolean,
): void {
  import('./vault/autofill/hardening').then(({ auditLog }) => {
    // HA-blocked is always 'security'; allowed is info/security; other blocks are warn/security
    let level: 'info' | 'warn' | 'security'
    if (code === 'EXPORT_AUDIT_BLOCKED_HA') {
      level = 'security'
    } else if (code === 'EXPORT_AUDIT_ALLOWED') {
      level = ha ? 'security' : 'info'
    } else {
      level = ha ? 'security' : 'warn'
    }
    auditLog(level, code, msg)
  }).catch(() => {
    console.warn(`[BG] ${code}`)
  })
}

/**
 * Ensure the per-launch secret is available before making HTTP requests.
 * If the secret is missing (e.g. after service worker restart), attempts to
 * (re)connect the WebSocket and waits for the ELECTRON_HANDSHAKE message.
 *
 * @param maxWaitMs  Maximum time to wait for the handshake (default 5 s)
 * @returns true if the secret is now available, false otherwise
 */
async function ensureLaunchSecret(maxWaitMs = 10000): Promise<boolean> {
  if (_launchSecret) return true;

  // Trigger WebSocket (re)connection — this is a no-op if already connected
  try { await connectToWebSocketServer(); } catch { /* ignore */ }

  // Poll until the handshake delivers the secret or we time out
  const start = Date.now();
  while (!_launchSecret && Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 250));
  }

  return !!_launchSecret;
}

function _cacheVsbt(token: string | null) {
  _cachedVsbt = token
  _vsbtCachedAt = token ? Date.now() : 0
  // chrome.storage.session is in-memory only (never persisted to disk)
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    if (token) {
      chrome.storage.session.set({ _vsbt: token, _vsbtAt: _vsbtCachedAt }).catch(() => {})
    } else {
      chrome.storage.session.remove(['_vsbt', '_vsbtAt']).catch(() => {})
    }
  }
}

// Restore VSBT from session storage on service-worker startup
if (typeof chrome !== 'undefined' && chrome.storage?.session) {
  chrome.storage.session.get(['_vsbt', '_vsbtAt']).then((result: any) => {
    if (result?._vsbt) {
      const age = typeof result._vsbtAt === 'number' ? Date.now() - result._vsbtAt : Infinity
      if (age < VSBT_MAX_AGE_MS) {
        _cachedVsbt = result._vsbt
        _vsbtCachedAt = result._vsbtAt
        console.log('[BG] Restored VSBT from session storage')
      } else {
        // Expired — clear stale session storage
        chrome.storage.session.remove(['_vsbt', '_vsbtAt']).catch(() => {})
        console.log('[BG] VSBT from session storage expired — discarded')
      }
    }
  }).catch(() => {})
}

// =================================================================
// Production-Grade Connection Health Monitor
// =================================================================

let healthMonitorInterval: ReturnType<typeof setInterval> | null = null;
let lastHealthCheck = 0;
let consecutiveFailures = 0;
let isElectronHealthy = false;

const HEALTH_CHECK_INTERVAL = 30000;  // Check every 30 seconds
const MAX_CONSECUTIVE_FAILURES = 3;   // After 3 failures, try to restart
const HEALTH_CHECK_TIMEOUT = 5000;    // 5 second timeout for health checks

/**
 * Start the background health monitor
 * This ensures Electron stays running and auto-restarts if needed
 */
function startHealthMonitor(): void {
  if (healthMonitorInterval) {
    console.log('[BG-HEALTH] Monitor already running');
    return;
  }
  
  console.log('[BG-HEALTH] Starting connection health monitor');
  
  // Initial health check after 5 seconds
  setTimeout(() => performHealthCheck(), 5000);
  
  // Regular health checks
  healthMonitorInterval = setInterval(() => {
    performHealthCheck();
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Perform a health check and handle failures
 */
async function performHealthCheck(): Promise<void> {
  lastHealthCheck = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
    
    // Use /api/health instead of /api/orchestrator/status — the health endpoint
    // is always available and doesn't depend on optional services like the DB.
    // /api/orchestrator/status can return 500 if the SQLite service fails to init,
    // causing the extension to incorrectly report "Desktop app not running."
    let healthy = false;
    
    try {
      const response = await fetch(`${ELECTRON_BASE_URL}/api/health`, {
        method: 'GET',
        headers: _electronHeaders(),
        signal: controller.signal
      });
      healthy = response.ok;
    } catch {
      healthy = false;
    }
    
    clearTimeout(timeoutId);
    
    if (healthy) {
      if (!isElectronHealthy || consecutiveFailures > 0) {
        console.log('[BG-HEALTH] ✅ Electron connection restored');
      }
      isElectronHealthy = true;
      consecutiveFailures = 0;
    } else {
      throw new Error('Health check failed');
    }
  } catch {
    consecutiveFailures++;
    isElectronHealthy = false;
    console.log(`[BG-HEALTH] ❌ Health check failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`);
    
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log('[BG-HEALTH] 🔄 Max failures reached, attempting recovery...');
      consecutiveFailures = 0;  // Reset to prevent spam
      
      // Try to restart Electron
      electronLaunchAttempted = false;  // Allow new launch attempt
      const launched = await ensureElectronRunning();
      if (launched) {
        console.log('[BG-HEALTH] ✅ Electron recovered successfully');
        isElectronHealthy = true;
      } else {
        console.log('[BG-HEALTH] ⚠️ Could not recover Electron, will retry next interval');
      }
    }
  }
}

/**
 * Get current connection status
 */
function getConnectionStatus(): { healthy: boolean; lastCheck: number; failures: number } {
  return {
    healthy: isElectronHealthy,
    lastCheck: lastHealthCheck,
    failures: consecutiveFailures
  };
}

// Start health monitor when extension loads
startHealthMonitor();

// =================================================================
// Production-Grade HTTP Client for Electron Communication
// =================================================================

const ELECTRON_BASE_URL = 'http://127.0.0.1:51248';

/**
 * Build headers for a direct fetch() call to the Electron HTTP API.
 * Automatically injects the per-launch auth secret (X-Launch-Secret).
 * Use this for all scattered fetch() calls that bypass electronRequest().
 */
function _electronHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (_launchSecret) {
    headers['X-Launch-Secret'] = _launchSecret
  }
  if (extra) Object.assign(headers, extra)
  return headers
}

// Retry configuration
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
  timeoutMs: 30000
};

// =================================================================
// Build Integrity Check — defense-in-depth kill-switch trigger
// =================================================================
//
// On extension startup, queries the Electron app's /api/integrity
// endpoint.  If the build is NOT verified, automatically enables
// the writes kill-switch to prevent any DOM writes from autofill.
//
// This is a best-effort check: if the Electron app is not running
// or the endpoint is unreachable, writes remain enabled (fail-open
// for availability — the kill-switch can still be set manually).
//

async function checkElectronIntegrity(): Promise<void> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${ELECTRON_BASE_URL}/api/integrity`, {
      method: 'GET',
      headers: _electronHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn('[BG-INTEGRITY] Integrity endpoint returned:', response.status)
      return
    }

    const status = await response.json()

    if (status && status.verified === false) {
      console.warn('[BG-INTEGRITY] ⚠ BUILD NOT VERIFIED — enabling writes kill-switch')
      console.warn('[BG-INTEGRITY] Reason:', status.summary)

      // Enable the writes kill-switch via chrome.storage.local
      // This is the same key the writesKillSwitch module reads.
      try {
        await chrome.storage.local.set({ wrvault_writes_disabled: true })
        console.warn('[BG-INTEGRITY] Writes kill-switch ENABLED due to failed integrity check')
      } catch (storageErr) {
        console.error('[BG-INTEGRITY] Failed to set kill-switch:', storageErr)
      }
    } else if (status && status.verified === true) {
      console.log('[BG-INTEGRITY] Build integrity verified')
    }
  } catch {
    // Electron not running or endpoint unreachable — fail open for availability
    // The kill-switch can still be manually enabled if needed.
  }
}

// OAuth-specific configuration (longer timeouts for user interaction)
const OAUTH_RETRY_CONFIG = {
  maxRetries: 1,  // Don't retry OAuth flows
  baseDelayMs: 0,
  maxDelayMs: 0,
  timeoutMs: 6 * 60 * 1000  // 6 minutes for OAuth
};

/**
 * Check if Electron HTTP API is available
 * Uses health endpoint first, falls back to orchestrator status for compatibility
 */
async function isElectronRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    // Try health endpoint first (new)
    try {
      const response = await fetch(`${ELECTRON_BASE_URL}/api/health`, {
        method: 'GET',
        headers: _electronHeaders(),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        return data.ok === true;
      }
    } catch {
      // Health endpoint might not exist yet, try fallback
    }
    
    // Fallback to orchestrator status (old endpoint)
    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => controller2.abort(), 2000);
    const response = await fetch(`${ELECTRON_BASE_URL}/api/orchestrator/status`, {
      method: 'GET',
      headers: _electronHeaders(),
      signal: controller2.signal
    });
    clearTimeout(timeoutId2);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if Electron is ready for operations (not in the middle of OAuth flow)
 */
async function isElectronReady(): Promise<{ running: boolean; ready: boolean; oauthInProgress: boolean }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    // Try health endpoint first
    try {
      const response = await fetch(`${ELECTRON_BASE_URL}/api/health`, {
        method: 'GET',
        headers: _electronHeaders(),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const data = await response.json();
        return {
          running: true,
          ready: data.ready === true,
          oauthInProgress: data.services?.oauth?.flowInProgress === true
        };
      }
    } catch {
      // Health endpoint might not exist yet
    }
    
    // Fallback: if orchestrator status responds, assume ready (old behavior)
    const controller2 = new AbortController();
    const timeoutId2 = setTimeout(() => controller2.abort(), 2000);
    const response = await fetch(`${ELECTRON_BASE_URL}/api/orchestrator/status`, {
      method: 'GET',
      headers: _electronHeaders(),
      signal: controller2.signal
    });
    clearTimeout(timeoutId2);
    if (response.ok) {
      return { running: true, ready: true, oauthInProgress: false };
    }
    return { running: false, ready: false, oauthInProgress: false };
  } catch {
    return { running: false, ready: false, oauthInProgress: false };
  }
}

/**
 * Check if Electron app is running and return status
 * 
 * NOTE: This function NO LONGER attempts to launch via custom protocol (wrcode://, opengiraffe://).
 * The custom protocol launch was removed because it caused Windows "Open Electron?" prompts
 * and errors when the protocol handler was not correctly registered.
 * 
 * Instead, users must manually start the desktop app from Start Menu or desktop shortcut.
 */
async function ensureElectronRunning(): Promise<boolean> {
  // Check if already running
  if (await isElectronRunning()) {
    console.log('[BG] ✅ Electron app is already running');
    return true;
  }
  
  // Check if app becomes available (in case user is starting it now)
  return launchElectronAppDirect();
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number {
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(delay + jitter);
}

/**
 * Production-grade HTTP request to Electron with retry logic
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Configurable retries and timeouts
 * - Auto-launch Electron if not running
 * - Health check before long operations
 * - Clear error messages for users
 */
async function electronRequest(
  endpoint: string,
  options: RequestInit = {},
  config: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    timeoutMs?: number;
    checkHealthFirst?: boolean;
  } = {}
): Promise<{ ok: boolean; data?: any; error?: string; errorCode?: string }> {
  const {
    maxRetries = DEFAULT_RETRY_CONFIG.maxRetries,
    baseDelayMs = DEFAULT_RETRY_CONFIG.baseDelayMs,
    maxDelayMs = DEFAULT_RETRY_CONFIG.maxDelayMs,
    timeoutMs = DEFAULT_RETRY_CONFIG.timeoutMs,
    checkHealthFirst = false
  } = config;

  const url = `${ELECTRON_BASE_URL}${endpoint}`;
  let lastError: string = 'Unknown error';
  let lastErrorCode: string = 'UNKNOWN';

  // Ensure Electron is running
  const electronRunning = await ensureElectronRunning();
  if (!electronRunning) {
    return { 
      ok: false, 
      error: 'OpenGiraffe desktop app is not running. Please start it manually or check if it is installed.',
      errorCode: 'ELECTRON_NOT_RUNNING'
    };
  }

  // Check health before long operations (like OAuth)
  if (checkHealthFirst) {
    const health = await isElectronReady();
    if (health.oauthInProgress) {
      return {
        ok: false,
        error: 'Another authentication flow is in progress. Please complete or cancel it first.',
        errorCode: 'OAUTH_IN_PROGRESS'
      };
    }
  }

  // Retry loop with exponential backoff
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = calculateBackoff(attempt - 1, baseDelayMs, maxDelayMs);
      console.log(`[BG] Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      
      // Check if Electron is still running before retry
      if (!(await isElectronRunning())) {
        console.log('[BG] Electron stopped running, attempting to restart...');
        if (!(await ensureElectronRunning())) {
          return {
            ok: false,
            error: 'OpenGiraffe desktop app stopped unexpectedly. Please restart it.',
            errorCode: 'ELECTRON_STOPPED'
          };
        }
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log(`[BG] Request timeout after ${timeoutMs}ms: ${endpoint}`);
      controller.abort();
    }, timeoutMs);

    try {
      // Inject per-launch auth secret into every request
      const mergedHeaders = new Headers((options as any)?.headers)
      if (_launchSecret) {
        mergedHeaders.set('X-Launch-Secret', _launchSecret)
      }
      const response = await fetch(url, {
        ...options,
        headers: mergedHeaders,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        const text = await response.text();
        console.error(`[BG] HTTP ${response.status}:`, text.slice(0, 200));
        
        // Don't retry client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return { 
            ok: false, 
            error: `Request failed: ${text.slice(0, 100)}`,
            errorCode: `HTTP_${response.status}`
          };
        }
        
        lastError = `Server error (${response.status})`;
        lastErrorCode = `HTTP_${response.status}`;
        continue; // Retry on server errors (5xx)
      }

      if (!contentType.includes('application/json')) {
        const text = await response.text();
        console.error('[BG] Non-JSON response:', contentType, text.slice(0, 200));
        lastError = 'Invalid response from server';
        lastErrorCode = 'INVALID_RESPONSE';
        continue;
      }

      const data = await response.json();
      return { ok: true, data };

    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error(`[BG] Request error (attempt ${attempt + 1}):`, err.name, err.message);

      if (err.name === 'AbortError') {
        lastError = `Request timed out after ${Math.round(timeoutMs / 1000)} seconds`;
        lastErrorCode = 'TIMEOUT';
        // Don't retry timeouts for OAuth flows
        if (timeoutMs >= OAUTH_RETRY_CONFIG.timeoutMs) {
          return { ok: false, error: lastError + '. The operation may still be in progress.', errorCode: lastErrorCode };
        }
        continue;
      }

      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        lastError = 'Cannot connect to OpenGiraffe desktop app';
        lastErrorCode = 'NETWORK_ERROR';
        continue;
      }

      lastError = err.message || 'Request failed';
      lastErrorCode = 'REQUEST_ERROR';
    }
  }

  // All retries exhausted
  return { 
    ok: false, 
    error: `${lastError}. Please try again or restart OpenGiraffe.`,
    errorCode: lastErrorCode
  };
}

/**
 * Convenience wrapper for OAuth operations with appropriate timeouts
 */
async function electronOAuthRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: any; error?: string; errorCode?: string }> {
  return electronRequest(endpoint, options, {
    ...OAUTH_RETRY_CONFIG,
    checkHealthFirst: true
  });
}

/**
 * Legacy wrapper for backward compatibility
 * @deprecated Use electronRequest instead
 */
async function fetchWithElectronAutoStart(
  url: string, 
  options: RequestInit = {},
  timeoutMs: number = 30000
): Promise<{ ok: boolean; data?: any; error?: string }> {
  // Extract endpoint from URL
  const endpoint = url.replace(ELECTRON_BASE_URL, '');
  return electronRequest(endpoint, options, { timeoutMs });
}

// Robust WebSocket connection with exponential backoff
function connectToWebSocketServer(forceReconnect = false): Promise<boolean> {
  return new Promise((resolve) => {
    if (!WS_ENABLED) {
      resolve(false);
      return;
    }
    
    // If already connected, resolve immediately
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[BG] ✅ WebSocket already connected');
      resolve(true);
      return;
    }
    
    // If connecting, wait for result
    if (ws && ws.readyState === WebSocket.CONNECTING && !forceReconnect) {
      console.log('[BG] ⏳ WebSocket connection in progress...');
      // Wait up to 3 seconds for connection
      const checkInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(ws?.readyState === WebSocket.OPEN);
      }, 3000);
      return;
    }
    
    if (isConnecting && !forceReconnect) {
      resolve(false);
      return;
    }

    // Force close existing connection if reconnecting
    if (forceReconnect && ws) {
      try { ws.close(); } catch {}
      ws = null;
    }

    isConnecting = true;
    connectionAttempts++;

    const wsUrl = 'ws://127.0.0.1:51247/';

    try {
      console.log(`[BG] 🔗 Connecting to WebSocket (attempt ${connectionAttempts}): ${wsUrl}`);

      ws = new WebSocket(wsUrl);
      
      const connectionTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
          console.log('[BG] ⏱️ Connection timeout, closing...');
          try { ws.close(); } catch {}
          ws = null;
          isConnecting = false;
          resolve(false);
        }
      }, 5000);

      ws.addEventListener('open', () => {
        clearTimeout(connectionTimeout);
        isConnecting = false;
        connectionAttempts = 0; // Reset on success
        lastConnectionTime = Date.now();
        console.log('[BG] ✅ WebSocket connected successfully!');

        // Send initial ping
        ws?.send(JSON.stringify({ type: 'ping', from: 'extension', timestamp: Date.now() }));

        // Start heartbeat (more frequent for stability)
        startHeartbeat();

        // Update badge
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#00FF00' });
        
        // Store connection state
        chrome.storage.local.set({ ws_connected: true, ws_last_connect: Date.now() });
        
        // Auto-restore MailGuard if it was active before disconnect
        if (mailGuardShouldBeActive && lastMailGuardWindowInfo) {
          console.log('[BG] 🛡️ Auto-restoring MailGuard overlay after reconnection...');
          try {
            ws?.send(JSON.stringify({ 
              type: 'MAILGUARD_ACTIVATE', 
              windowInfo: lastMailGuardWindowInfo,
              theme: lastMailGuardTheme
            }));
          } catch (err) {
            console.error('[BG] Failed to restore MailGuard:', err);
          }
        }
        
        resolve(true);
      });

      ws.addEventListener('message', (e) => {
        try {
          const payload = String(e.data)
          const data = JSON.parse(payload)
          
          // Check if this is a vault RPC response
          if (data.id && globalThis.vaultRpcCallbacks && globalThis.vaultRpcCallbacks.has(data.id)) {
            console.log('[BG] Vault RPC response received for ID:', data.id)
            const callback = globalThis.vaultRpcCallbacks.get(data.id)
            globalThis.vaultRpcCallbacks.delete(data.id)
            callback?.(data)
            return
          }
          
          // Check if this is an email gateway response
          if (data.id && globalThis.emailCallbacks && globalThis.emailCallbacks.has(data.id)) {
            console.log('[BG] 📧 Email response received for ID:', data.id)
            const callback = globalThis.emailCallbacks.get(data.id)
            globalThis.emailCallbacks.delete(data.id)
            callback?.(data)
            return
          }
          
          if (data && data.type) {
            if (data.type === 'pong') {
              // Connection is alive
              try { chrome.runtime.sendMessage({ type: 'pong' }) } catch {}
            } else if (data.type === 'ELECTRON_HANDSHAKE') {
              // Receive per-launch HTTP auth secret from Electron main process.
              // This secret is required in the X-Launch-Secret header on every
              // HTTP request.  Without it, the server returns 401.
              if (data.launchSecret && typeof data.launchSecret === 'string') {
                _launchSecret = data.launchSecret
                console.log('[BG] 🔑 Launch secret received from Electron handshake')
              }
              if (data.message) {
                console.log('[BG] 📋 Electron Handshake:', data.message)
              }
            } else if (data.type === 'ELECTRON_LOG') {
              console.log('[BG] 📋 Electron Log:', data.message, data.rawMessage || data.parsedMessage || '')
              try { chrome.runtime.sendMessage({ type: 'ELECTRON_LOG', data }) } catch {}
            } else if (data.type === 'SELECTION_RESULT' || data.type === 'SELECTION_RESULT_IMAGE' || data.type === 'SELECTION_RESULT_VIDEO') {
              const kind = data.kind || (data.type.includes('VIDEO') ? 'video' : 'image')
              const dataUrl = data.dataUrl || data.url || null
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tabId = tabs[0]?.id
                if (!tabId) return
                try { chrome.tabs.sendMessage(tabId, { type: 'ELECTRON_SELECTION_RESULT', kind, dataUrl }) } catch {}
              })
              try { chrome.runtime.sendMessage({ type: 'COMMAND_POPUP_APPEND', kind, url: dataUrl }) } catch {}
              try { chrome.runtime.sendMessage({ type: 'ELECTRON_SELECTION_RESULT', kind, dataUrl }) } catch {}
            } else if (data.type === 'TRIGGERS_UPDATED') {
              try { chrome.runtime.sendMessage({ type: 'TRIGGERS_UPDATED' }) } catch {}
            } else if (data.type === 'SHOW_TRIGGER_PROMPT') {
              console.log('📝 Received SHOW_TRIGGER_PROMPT from Electron:', data)
              chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tabId = tabs[0]?.id
                const tabUrl = tabs[0]?.url || ''
                if (!tabId) return
                
                const message = { 
                  type: 'SHOW_TRIGGER_PROMPT', 
                  mode: data.mode, 
                  rect: data.rect, 
                  displayId: data.displayId, 
                  imageUrl: data.imageUrl, 
                  videoUrl: data.videoUrl,
                  createTrigger: data.createTrigger,
                  addCommand: data.addCommand,
                  tabUrl: tabUrl
                }
                
                try { chrome.tabs.sendMessage(tabId, message) } catch (e) {
                  console.log('❌ Failed to send SHOW_TRIGGER_PROMPT to content script:', e)
                }
                try { chrome.runtime.sendMessage(message) } catch {}
              })
            } 
            // ===== MAILGUARD HANDLERS =====
            else if (data.type === 'MAILGUARD_ACTIVATED') {
              console.log('[BG] 🛡️ MailGuard activated')
              // Query all email tabs (Gmail and Outlook)
              chrome.tabs.query({}, (tabs) => {
                tabs.filter(t => 
                  t.url?.includes('mail.google.com') || 
                  t.url?.includes('outlook.live.com') ||
                  t.url?.includes('outlook.office.com') ||
                  t.url?.includes('outlook.office365.com')
                ).forEach(tab => {
                  if (tab.id) {
                    try { chrome.tabs.sendMessage(tab.id, { type: 'MAILGUARD_ACTIVATED' }) } catch {}
                  }
                })
              })
            } else if (data.type === 'MAILGUARD_DEACTIVATED') {
              console.log('[BG] 🛡️ MailGuard deactivated')
              // Query all email tabs (Gmail and Outlook)
              chrome.tabs.query({}, (tabs) => {
                tabs.filter(t => 
                  t.url?.includes('mail.google.com') || 
                  t.url?.includes('outlook.live.com') ||
                  t.url?.includes('outlook.office.com') ||
                  t.url?.includes('outlook.office365.com')
                ).forEach(tab => {
                  if (tab.id) {
                    try { chrome.tabs.sendMessage(tab.id, { type: 'MAILGUARD_DEACTIVATED' }) } catch {}
                  }
                })
              })
            } else if (data.type === 'OPEN_COMMAND_CENTER_POPUP') {
              // Open popup from Electron dashboard request
              console.log('[BG] 📨 OPEN_COMMAND_CENTER_POPUP from Electron, launchMode:', data.launchMode, 'bounds:', data.bounds, 'windowState:', data.windowState)
              const themeHint = typeof data.theme === 'string' ? data.theme : null
              const launchModeHint = typeof data.launchMode === 'string' ? data.launchMode : null
              const dashboardBounds = data.bounds && typeof data.bounds === 'object' ? data.bounds : null
              const dashboardWindowState = typeof data.windowState === 'string' ? data.windowState : 'normal'
              
              let url = chrome.runtime.getURL('src/popup-chat.html')
              const params: string[] = []
              if (themeHint) params.push('t=' + encodeURIComponent(themeHint))
              if (launchModeHint) params.push('launchMode=' + encodeURIComponent(launchModeHint))
              if (params.length) url += '?' + params.join('&')
              
              // Check if dashboard is maximized or fullscreen - we'll maximize after creation
              const shouldMaximize = (dashboardWindowState === 'maximized' || dashboardWindowState === 'fullscreen')
              
              // Use dashboard bounds if provided, otherwise use defaults
              // Note: Chrome popup windows don't support state in create options, so always use 'normal'
              const opts: chrome.windows.CreateData = {
                url,
                type: 'popup',
                width: dashboardBounds?.width || 520,
                height: dashboardBounds?.height || 720,
                left: dashboardBounds?.x ?? 100,
                top: dashboardBounds?.y ?? 100,
                focused: true
              }

              const trackPopupId = (winId: number) => {
                dashboardPopupWindowId = winId
                console.log('[BG] 📌 Tracking popup window id for focus-restore:', winId)
              }
              
              // Prevent duplicates: if our tracked popup already exists, update its bounds and focus
              try {
                chrome.windows.getAll({ populate: false, windowTypes: ['popup'] }, (wins) => {
                  const existing = dashboardPopupWindowId !== null
                    && wins.find(w => w.id === dashboardPopupWindowId)
                  if (existing && existing.id) {
                    trackPopupId(existing.id)
                    // Update existing popup: set state to match dashboard, set bounds, and focus
                    if (shouldMaximize) {
                      chrome.windows.update(existing.id, { focused: true, state: 'maximized' })
                    } else {
                      chrome.windows.update(existing.id, { 
                        focused: true,
                        state: 'normal',
                        left: opts.left,
                        top: opts.top,
                        width: opts.width,
                        height: opts.height
                      })
                    }
                  } else {
                    // Create new popup, then force focus after it has rendered
                    chrome.windows.create(opts, (newWindow) => {
                      if (newWindow?.id) {
                        const winId = newWindow.id
                        trackPopupId(winId)
                        if (shouldMaximize) {
                          setTimeout(() => {
                            try {
                              chrome.windows.update(winId, { focused: true, state: 'maximized' })
                            } catch {}
                          }, 100)
                        } else {
                          // Give the window time to render before forcing focus
                          setTimeout(() => {
                            try { chrome.windows.update(winId, { focused: true, state: 'normal' }) } catch {}
                          }, 100)
                          setTimeout(() => {
                            try { chrome.windows.update(winId, { focused: true }) } catch {}
                          }, 300)
                        }
                      }
                    })
                  }
                })
              } catch (err) {
                console.error('[BG] Error creating popup:', err)
                chrome.windows.create(opts)
              }
            } else if (data.type === 'CLOSE_COMMAND_CENTER_POPUP') {
              // Close popup on logout from Electron dashboard
              console.log('[BG] 📨 CLOSE_COMMAND_CENTER_POPUP from Electron - closing popup window')
              try {
                chrome.windows.getAll({ populate: false, windowTypes: ['popup'] }, (wins) => {
                  wins.forEach(w => {
                    if (w.type === 'popup' && typeof w.id === 'number') {
                      try {
                        chrome.windows.remove(w.id)
                        console.log('[BG] ✅ Closed popup window:', w.id)
                      } catch {}
                    }
                  })
                })
              } catch (err) {
                console.error('[BG] Error closing popup:', err)
              }
            } else if (data.type === 'MAILGUARD_EXTRACT_EMAIL') {
              console.log('[BG] 🛡️ MailGuard extract email request:', data.rowId)
              // Query both Gmail and Outlook tabs
              chrome.tabs.query({ active: true }, (tabs) => {
                const emailTab = tabs.find(t => 
                  t.url?.includes('mail.google.com') || 
                  t.url?.includes('outlook.live.com') ||
                  t.url?.includes('outlook.office.com') ||
                  t.url?.includes('outlook.office365.com')
                )
                if (emailTab?.id) {
                  console.log('[BG] 🛡️ Sending extract request to tab:', emailTab.url)
                  try { chrome.tabs.sendMessage(emailTab.id, { type: 'MAILGUARD_EXTRACT_EMAIL', rowId: data.rowId }) } catch {}
                } else {
                  console.log('[BG] 🛡️ No email tab found for extraction')
                }
              })
            } else if (data.type === 'MAILGUARD_SCROLL') {
              // Forward scroll events to email tabs for passthrough scrolling
              console.log('[BG] 🛡️ MAILGUARD_SCROLL received, forwarding to tabs...')
              chrome.tabs.query({}, (tabs) => {
                const emailTabs = tabs.filter(t => 
                  t.url?.includes('mail.google.com') || 
                  t.url?.includes('outlook.live.com') ||
                  t.url?.includes('outlook.office.com') ||
                  t.url?.includes('outlook.office365.com')
                )
                console.log('[BG] 🛡️ Found', emailTabs.length, 'email tabs')
                emailTabs.forEach(tab => {
                  if (tab.id) {
                    console.log('[BG] 🛡️ Sending scroll to tab:', tab.id, tab.url)
                    try { 
                      chrome.tabs.sendMessage(tab.id, { 
                        type: 'MAILGUARD_SCROLL', 
                        deltaX: data.deltaX,
                        deltaY: data.deltaY,
                        x: data.x,
                        y: data.y
                      }) 
                    } catch (e) {
                      console.log('[BG] 🛡️ Failed to send scroll:', e)
                    }
                  }
                })
              })
            } else if (data.type === 'MAILGUARD_STATUS_RESPONSE') {
              console.log('[BG] 🛡️ MailGuard status:', data.active)
              // Query all email tabs (Gmail and Outlook)
              chrome.tabs.query({}, (tabs) => {
                tabs.filter(t => 
                  t.url?.includes('mail.google.com') || 
                  t.url?.includes('outlook.live.com') ||
                  t.url?.includes('outlook.office.com') ||
                  t.url?.includes('outlook.office365.com')
                ).forEach(tab => {
                  if (tab.id) {
                    try { chrome.tabs.sendMessage(tab.id, { type: 'MAILGUARD_STATUS_RESPONSE', active: data.active }) } catch {}
                  }
                })
              })
            }
          }
        } catch (error) {
          // ignore parse errors
        }
      });

      ws.addEventListener('error', (error) => {
        clearTimeout(connectionTimeout);
        console.log(`[BG] ❌ WebSocket error`);
        isConnecting = false;
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        chrome.storage.local.set({ ws_connected: false });
        resolve(false);
      });

      ws.addEventListener('close', (event) => {
        clearTimeout(connectionTimeout);
        console.log(`[BG] 🔌 WebSocket closed (Code: ${event.code})`);
        ws = null;
        isConnecting = false;
        
        // Fail-closed: clear VSBT on WS disconnect.  If Electron crashed or
        // was killed, the vault session is no longer valid.  The user must
        // re-unlock after reconnection.  This closes the "Electron crash →
        // stale VSBT" staleness window.
        _cacheVsbt(null)
        
        stopHeartbeat();

        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        chrome.storage.local.set({ ws_connected: false });
        
        // Quick reconnect with exponential backoff (max 5 seconds)
        const delay = Math.min(500 * Math.pow(1.5, connectionAttempts), 5000);
        console.log(`[BG] 🔄 Reconnecting in ${delay}ms...`);
        setTimeout(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            connectToWebSocketServer();
          }
        }, delay);
        
        resolve(false);
      });

    } catch (error) {
      console.log(`[BG] ❌ Connection error: ${error}`);
      isConnecting = false;
      chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      resolve(false);
    }
  });
}

// Ensure connection is ready (with retries)
async function ensureConnection(maxRetries = 3): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return true;
    }
    
    console.log(`[BG] 🔄 Ensuring connection (attempt ${i + 1}/${maxRetries})...`);
    const connected = await connectToWebSocketServer(i > 0); // Force reconnect after first attempt
    
    if (connected) {
      return true;
    }
    
    // Wait before retry
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return false;
}

// Start heartbeat to keep connection alive (more frequent for stability)
function startHeartbeat() {
  if (!WS_ENABLED) return;
  stopHeartbeat();
  
  // Send heartbeat every 8 seconds (was 5s) - better CPU efficiency
  heartbeatInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'ping', from: 'extension', timestamp: Date.now() }));
      } catch (err) {
        console.log('[BG] 💔 Heartbeat send failed, reconnecting...');
        stopHeartbeat();
        connectToWebSocketServer();
      }
    } else {
      console.log('[BG] 💔 Heartbeat: connection lost, reconnecting...');
      stopHeartbeat();
      connectToWebSocketServer();
    }
  }, 8000);  // 8 seconds (was 5s)
}

// Stop heartbeat
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Start automatic connection with aggressive retry
function startAutoConnect() {
  if (!WS_ENABLED) return;
  console.log('[BG] 🚀 Starting WebSocket auto-connect...');

  // Connect immediately
  connectToWebSocketServer();

  // Retry every 3 seconds if not connected
  if (autoConnectInterval) {
    clearInterval(autoConnectInterval);
  }

  autoConnectInterval = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToWebSocketServer();
    }
  }, 5000); // Check every 5 seconds (was 3s)
}

// Toggle sidebars visibility for current tab
function toggleSidebars() {
  // Get current active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0 || !tabs[0].id) return;
    
    const tabId = tabs[0].id;
    const currentStatus = tabSidebarStatus.get(tabId) || false;
    const newStatus = !currentStatus;
    
    // Update status for this tab
    tabSidebarStatus.set(tabId, newStatus);
    
    console.log(`🔄 Tab ${tabId}: Sidebars ${newStatus ? 'einblenden' : 'ausblenden'}`);
    
    // Send message to this specific tab
    try {
      chrome.tabs.sendMessage(tabId, { 
        type: 'TOGGLE_SIDEBARS', 
        visible: newStatus 
      });
    } catch (err) {
      console.warn('⚠️ Failed to send message to tab, it may have closed:', err)
    }

    // Update badge to show status for current tab
    chrome.action.setBadgeText({ text: newStatus ? 'ON' : 'OFF' });
    chrome.action.setBadgeBackgroundColor({
      color: newStatus ? '#00FF00' : '#FF0000'
    });
  });
}

// Keep service worker alive with alarms (survives suspension)
function setupKeepAlive() {
  // Create an alarm that fires every 25 seconds to keep service worker active
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 }); // ~24 seconds
  
  // Connection check alarm - every 12 seconds (was 6s)
  chrome.alarms.create('checkConnection', { periodInMinutes: 0.2 }); // ~12 seconds
}

// Handle alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Just wake up - the alarm listener itself keeps the service worker alive
    console.log('[BG] ⏰ Keep-alive ping');
  } else if (alarm.name === 'checkConnection') {
    // Check and reconnect if needed
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[BG] ⏰ Connection check: not connected, reconnecting...');
      connectToWebSocketServer();
    }
  }
});

// Start connection when extension loads
chrome.runtime.onStartup.addListener(() => {
  console.log('[BG] 🚀 Extension started');
  setupKeepAlive();
  if (WS_ENABLED) {
    connectToWebSocketServer();
  }
  checkElectronIntegrity()
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[BG] 📦 Extension installed');
  setupKeepAlive();
  if (WS_ENABLED) {
    connectToWebSocketServer();
  }
  checkElectronIntegrity()
});

// Also try to connect when service worker wakes up for any reason
if (WS_ENABLED) {
  console.log('[BG] 🔌 Service worker active, checking connection...');
  setupKeepAlive();
  // Small delay to let things initialize
  setTimeout(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToWebSocketServer();
    }
  }, 100);
}

// Track if display grids are active per tab
const tabDisplayGridsActive = new Map<number, boolean>();

// Remove sidepanel disabling - we'll show minimal UI instead

// Handle extension icon click: open the side panel + open wrdesk.com if not logged in
chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Check if display grids are active for this tab
    if (tab.id && tabDisplayGridsActive.get(tab.id)) {
      console.log('🚫 Side panel blocked - display grids are active');
      return;
    }
    
    // Open side panel for the current tab
    if (tab.id && chrome.sidePanel) {
      await chrome.sidePanel.open({ tabId: tab.id })
      console.log('✅ Side panel opened')
    }
    
    // Check if user is logged in - if not, open wrdesk.com immediately
    try {
      const response = await fetch(`${ELECTRON_BASE_URL}/api/auth/status`, {
        method: 'GET',
        headers: _electronHeaders(),
        signal: AbortSignal.timeout(3000),
      });
      const data = await response.json();
      if (!data.loggedIn) {
        // Not logged in - open wrdesk.com
        await openWrdeskHomeIfNeeded();
      }
    } catch {
      // Electron not reachable - user is not logged in, open wrdesk.com
      await openWrdeskHomeIfNeeded();
    }
  } catch (e) {
    console.error('Failed to open side panel:', e)
  }
});

// Helper to open wrdesk.com without tab spam
async function openWrdeskHomeIfNeeded(): Promise<void> {
  try {
    // Debounce: check if we opened recently
    const { wrdeskHomeOpenedAt } = await chrome.storage.session.get('wrdeskHomeOpenedAt');
    const now = Date.now();
    if (wrdeskHomeOpenedAt && (now - wrdeskHomeOpenedAt) < 5000) {
      console.log('[BG] openWrdeskHomeIfNeeded: debounced (opened recently)');
      return;
    }
    
    // Check if wrdesk.com is already open in any tab
    const existingTabs = await chrome.tabs.query({ url: 'https://wrdesk.com/*' });
    if (existingTabs.length > 0) {
      console.log('[BG] openWrdeskHomeIfNeeded: tab already exists, skipping');
      return;
    }
    
    // Create new tab
    console.log('[BG] openWrdeskHomeIfNeeded: creating new tab');
    await chrome.tabs.create({ url: 'https://wrdesk.com', active: true });
    await chrome.storage.session.set({ wrdeskHomeOpenedAt: now });
  } catch (e: any) {
    console.error('[BG] openWrdeskHomeIfNeeded error:', e.message);
  }
}

// Handle keyboard command Alt+O to toggle overlay per domain
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-overlay') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) return
      chrome.tabs.sendMessage(tab.id, { type: 'OG_TOGGLE_OVERLAY' })
    })
  }
})

// Update badge when switching tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabId = activeInfo.tabId;
  const isActive = tabSidebarStatus.get(tabId) || false;
  
  chrome.action.setBadgeText({ text: isActive ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({
    color: isActive ? '#00FF00' : '#FF0000'
  });
  
  // Hide/show MailGuard overlay based on which tab is active
  if (mailGuardShouldBeActive && mailGuardActiveTabId !== null) {
    if (tabId === mailGuardActiveTabId) {
      // User switched back to the email tab - show overlay
      console.log('[BG] 🛡️ Tab switch: showing MailGuard overlay (back to email tab)');
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_SHOW' })) } catch {}
      }
    } else {
      // User switched to a different tab - hide overlay
      console.log('[BG] 🛡️ Tab switch: hiding MailGuard overlay (left email tab)');
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_HIDE' })) } catch {}
      }
    }
  }
});

// Clean up WebMCP rate-limit entries when tabs close (bounded growth)
chrome.tabs.onRemoved.addListener((tabId) => {
  if (_webMcpRateMap) {
    _webMcpRateMap.delete(tabId)
  }
  tabSidebarStatus.delete(tabId)
});

// When the dashboard-launched popup is closed, restore focus to the Electron dashboard
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === dashboardPopupWindowId) {
    dashboardPopupWindowId = null
    console.log('[BG] 🔙 Dashboard popup closed — restoring focus to Electron dashboard')
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'FOCUS_DASHBOARD' })) } catch {}
    }
  }
});

// Notify Electron when the popup window gains / loses focus so it can
// manage its always-on-top state (dashboard below popup, above tabs).
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (dashboardPopupWindowId === null) return
  if (windowId === dashboardPopupWindowId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'POPUP_FOCUSED' })) } catch {}
    }
  } else if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'POPUP_BLURRED' })) } catch {}
    }
  }
});

/**
 * Check if Electron app is running and launch it if needed
 * Uses a Windows-compatible notification approach (buttons don't work on Windows)
 */
async function checkAndLaunchElectronApp(sendResponse: (response: any) => void, theme?: string): Promise<void> {
  const themePayload = theme && ['standard', 'dark', 'pro'].includes(theme) ? { theme } : {}
  try {
    // First check if app is running via HTTP
    const isRunning = await isElectronRunning()
    
    if (isRunning) {
      // App is running, try WebSocket connection again
      console.log('[BG] Electron app is running, retrying WebSocket connection...')
      connectToWebSocketServer()
      setTimeout(async () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'OPEN_ANALYSIS_DASHBOARD', ...themePayload })) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          // WebSocket still not connected, but app is running - try direct HTTP to open window
          console.log('[BG] WebSocket not ready, trying direct HTTP to open dashboard...')
          try {
            const response = await fetch(`${ELECTRON_BASE_URL}/api/dashboard/open`, {
              method: 'POST',
              headers: _electronHeaders(),
              signal: AbortSignal.timeout(5000)
            })
            if (response.ok) {
              try { sendResponse({ success: true }) } catch {}
            } else {
              try { sendResponse({ success: false, error: 'App is running but could not open dashboard. Please try again.' }) } catch {}
            }
          } catch {
            try { sendResponse({ success: false, error: 'App is running but connection failed. Please try again.' }) } catch {}
          }
        }
      }, 1000)
      return
    }
    
    // App is not running - try to launch automatically first (user already clicked the brain icon)
    console.log('[BG] Electron app is not running, attempting to launch...')
    
    // Try to launch directly since user explicitly clicked the brain icon
    const launched = await launchElectronAppDirect()
    
    if (launched) {
      // Successfully launched - wait for it to be ready and open dashboard
      console.log('[BG] ✅ Electron app launched successfully')
      setTimeout(async () => {
        connectToWebSocketServer()
        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'OPEN_ANALYSIS_DASHBOARD', ...themePayload })) } catch {}
            try { sendResponse({ success: true }) } catch {}
          } else {
            // App started but WebSocket not ready yet
            try { sendResponse({ success: true, message: 'Dashboard is starting...' }) } catch {}
          }
        }, 2000)
      }, 1000)
    } else {
      // Failed to launch - show clickable notification (Windows compatible, no buttons)
      console.log('[BG] ⚠️ Auto-launch failed, showing notification to guide user...')
      
      // Create a unique notification ID to track this notification
      const notificationId = 'wrcode-launch-' + Date.now()
      
      // Show a clickable notification (click anywhere to launch)
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon-128.png'),
        title: 'WR Desk Analysis Dashboard',
        message: 'Click here to start the Analysis Dashboard, or start it from the Start Menu.',
        priority: 2,
        requireInteraction: true
      }, (createdNotificationId) => {
        if (chrome.runtime.lastError) {
          console.error('[BG] Failed to create notification:', chrome.runtime.lastError)
          try { sendResponse({ success: false, error: 'Please start the WR Desk Analysis Dashboard from the Start Menu.' }) } catch {}
          return
        }
        
        // Handle notification click - check if user has started the app manually
        const clickHandler = async (clickedNotificationId: string) => {
          if (clickedNotificationId === createdNotificationId) {
            chrome.notifications.clear(createdNotificationId)
            chrome.notifications.onClicked.removeListener(clickHandler)
            // Check if user started the app manually (no custom protocol launch)
            const running = await isElectronRunning()
            if (running) {
              console.log('[BG] ✅ App is now running after user action')
              try { sendResponse({ success: true }) } catch {}
            } else {
              console.log('[BG] App still not running - user may need to start from Start Menu')
              try { sendResponse({ success: false, error: 'Please start WR Desk from the Start Menu.' }) } catch {}
            }
          }
        }
        
        chrome.notifications.onClicked.addListener(clickHandler)
        
        // Auto-clear after 30 seconds if not clicked
        setTimeout(() => {
          chrome.notifications.clear(createdNotificationId)
          chrome.notifications.onClicked.removeListener(clickHandler)
        }, 30000)
      })
      
      try { sendResponse({ success: false, error: 'Dashboard is not running. Please click the notification or start from Start Menu.' }) } catch {}
    }
  } catch (err) {
    console.error('[BG] Error checking Electron app:', err)
    try { sendResponse({ success: false, error: 'Failed to check app status' }) } catch {}
  }
}

/**
 * Check if Electron app can be reached (is already running)
 * 
 * IMPORTANT: This function NO LONGER attempts to launch the app via custom protocol (wrcode://, opengiraffe://)
 * 
 * WHY: Launching via custom protocol (wrcode://start) caused Windows "Open Electron?" prompts
 * and "Unable to find Electron app / Cannot find module 'C:\Windows\System32\wrcode\start'" errors
 * when the protocol handler was not correctly registered. This is a broken UX.
 * 
 * SOLUTION: The extension should only communicate with an ALREADY RUNNING Electron app via HTTP/WebSocket.
 * Users must manually start the desktop app from Start Menu or desktop shortcut.
 * 
 * @returns true if app is already running, false otherwise (does NOT attempt auto-launch)
 */
async function launchElectronAppDirect(): Promise<boolean> {
  console.log('[BG] 🔍 Checking if Electron app is running (no protocol launch)...')
  
  // Check if already running
  if (await isElectronRunning()) {
    console.log('[BG] ✅ App is already running')
    return true
  }
  
  // Prevent concurrent check attempts
  if (electronLaunchInProgress) {
    console.log('[BG] ⏳ Check already in progress, waiting...')
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (!electronLaunchInProgress) break
      if (await isElectronRunning()) return true
    }
    return isElectronRunning()
  }
  
  electronLaunchInProgress = true
  
  try {
    // ============================================================================
    // Protocol launch (wrcode://, wrdesk://) DISABLED on all platforms.
    // - Windows: Caused "Open Electron?" prompts and "Cannot find module" errors.
    // - Linux: Triggers "xdg-open öffnen?" when protocol handler not registered
    //   (common in dev mode or when .desktop file doesn't register the handler).
    // Users must start WR Desk manually from application menu or desktop shortcut.
    // ============================================================================

    // Wait briefly and check if app is starting (user may have started manually)
    console.log('[BG] ⏳ Waiting briefly to see if app is starting...')
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 500))
      if (await isElectronRunning()) {
        console.log('[BG] ✅ App detected - it was starting up')
        electronLaunchInProgress = false
        return true
      }
    }
    
    console.log('[BG] ❌ App is not running - user must start manually')
    electronLaunchInProgress = false
    return false
  } catch (err) {
    console.error('[BG] ❌ Error checking app status:', err)
    electronLaunchInProgress = false
    return false
  }
}

/**
 * Check if the Electron app is running and respond with status
 * 
 * NOTE: This function NO LONGER attempts to launch via custom protocol (wrcode://).
 * If the app is not running, it shows a notification to guide the user.
 */
async function launchElectronApp(sendResponse: (response: any) => void): Promise<void> {
  try {
    console.log('[BG] Checking if Electron app is running...')
    
    const launched = await launchElectronAppDirect()
    
    if (launched) {
      // Wait a bit for WebSocket to connect, then send the open command
      setTimeout(async () => {
        connectToWebSocketServer()
        setTimeout(async () => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'OPEN_ANALYSIS_DASHBOARD' })) } catch {}
            try { sendResponse({ success: true }) } catch {}
          } else {
            // App started but WebSocket not ready - try HTTP fallback
            console.log('[BG] WebSocket not ready, trying HTTP to open dashboard...')
            try {
              const response = await fetch(`${ELECTRON_BASE_URL}/api/dashboard/open`, {
                method: 'POST',
                headers: _electronHeaders(),
                signal: AbortSignal.timeout(5000)
              })
              if (response.ok) {
                try { sendResponse({ success: true }) } catch {}
              } else {
                try { sendResponse({ success: true, message: 'Dashboard started. Please wait a moment...' }) } catch {}
              }
            } catch {
              try { sendResponse({ success: true, message: 'Dashboard is starting...' }) } catch {}
            }
          }
        }, 2000)
      }, 1000)
    } else {
      // Failed to launch - show helpful notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon-128.png'),
        title: 'WR Desk Analysis Dashboard',
        message: 'Could not start automatically. Please start WR Code from the Start Menu or desktop shortcut.',
        priority: 2,
        requireInteraction: false
      })
      try { sendResponse({ success: false, error: 'Please start the Analysis Dashboard from the Start Menu' }) } catch {}
    }
  } catch (err) {
    console.error('[BG] Error launching Electron app:', err)
    try { sendResponse({ success: false, error: 'Failed to launch app' }) } catch {}
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ════════════════════════════════════════════════════════════════════════
  // UNIVERSAL SENDER GATE — reject messages from foreign extensions.
  //
  // Every message that triggers a side-effect (auth, vault, Electron IPC,
  // WebMCP, etc.) MUST originate from our own extension contexts (content
  // scripts, popup, sidepanel, service worker).  Cross-extension messages
  // are rejected immediately.
  //
  // This gate runs BEFORE any handler dispatch.
  // ════════════════════════════════════════════════════════════════════════
  if (!msg || !msg.type) return true

  if (!sender || sender.id !== chrome.runtime.id) {
    console.warn('[BG] Rejected message from foreign sender:', sender?.id, msg.type)
    try {
      if (msg.type === 'WEBMCP_FILL_PREVIEW') {
        sendResponse({ resultVersion: WEBMCP_RESULT_VERSION, success: false, error: { code: 'FORBIDDEN', message: 'Sender not trusted' } })
      } else {
        sendResponse({ success: false, error: 'Forbidden: sender not trusted' })
      }
    } catch {}
    return true
  }

  // ════════════════════════════════════════════════════════════════════════
  // WEBMCP FILL PREVIEW — route to content script for overlay preview
  //
  // Defense-in-depth layers (order matters):
  //   1. Sender gate (already checked above)
  //   2. Circuit breaker (fast reject when abuse detected)
  //   3. Schema validation
  //   4. Per-tab rate limiter (2 s/tab)
  //   5. Global sliding-window rate limiter (MAX_WEBMCP_PER_MIN / 60 s)
  //   6. Restricted URL check
  //   7. Forward to content script
  // ════════════════════════════════════════════════════════════════════════
  if (msg.type === 'WEBMCP_FILL_PREVIEW') {
    const now = Date.now()

    // Helper: structured error response for the orchestrator UI.
    // Every rejection carries resultVersion so the UI can parse uniformly.
    const _bgErr = (code: BgWebMcpErrorCode, message: string, extra?: { retryAfterMs: number }) => ({
      resultVersion: WEBMCP_RESULT_VERSION,
      success: false as const,
      error: { code, message },
      ...(extra ? { retryAfterMs: extra.retryAfterMs } : {}),
    })

    // ── Layer 2: Circuit breaker (fail-closed via sanitized accessors) ──
    // If the circuit is open, reject immediately until cooldown expires.
    if (_webMcpCbOpenedAt > 0) {
      const cbCooldownMs = _effectiveCbCooldownMs()
      const elapsed = now - _webMcpCbOpenedAt
      if (elapsed < cbCooldownMs) {
        const retryAfterMs = cbCooldownMs - elapsed
        sendResponse(_bgErr('TEMP_BLOCKED', 'Temporarily blocked', { retryAfterMs }))
        return true
      }
      // Cooldown expired — close circuit, reset reject history
      _webMcpCbOpenedAt = 0
      _webMcpCbRejects = []
    }

    // ── Layer 3: Schema validation ──
    const params = msg.params
    if (!params || typeof params !== 'object' || !params.itemId || !params.tabId) {
      _recordWebMcpReject(now)
      sendResponse(_bgErr('INVALID_PARAMS', 'Missing required parameters'))
      return true
    }

    const tabId = params.tabId
    if (typeof tabId !== 'number' || tabId <= 0 || !Number.isInteger(tabId)) {
      _recordWebMcpReject(now)
      sendResponse(_bgErr('INVALID_TAB', 'Invalid tab identifier'))
      return true
    }

    // ── Layer 4: Per-tab rate limiter (2 s per tab) ──
    if (!_webMcpRateMap) _webMcpRateMap = new Map()
    const lastInvoke = _webMcpRateMap.get(tabId) ?? 0
    if (now - lastInvoke < 2000) {
      console.warn('[BG] WEBMCP rate limited for tab', tabId)
      const retryAfterMs = 2000 - (now - lastInvoke)
      sendResponse(_bgErr('RATE_LIMITED', 'Rate limited', { retryAfterMs: Math.max(retryAfterMs, 1) }))
      return true
    }
    _webMcpRateMap.set(tabId, now)

    // ── Layer 5: Global sliding-window rate limiter (fail-closed via sanitized accessors) ──
    // Prune timestamps older than the window, then check count.
    const effectiveWindowMs = _effectiveWindowMs()
    const effectiveMaxPerMin = _effectiveMaxPerMin()
    const windowStart = now - effectiveWindowMs
    _webMcpGlobalTimestamps = _webMcpGlobalTimestamps.filter(t => t > windowStart)
    if (_webMcpGlobalTimestamps.length >= effectiveMaxPerMin) {
      // Compute when the oldest entry in the window will expire
      const oldestInWindow = _webMcpGlobalTimestamps[0]
      const retryAfterMs = oldestInWindow + effectiveWindowMs - now
      sendResponse(_bgErr('RATE_LIMITED', 'Rate limited', { retryAfterMs: Math.max(retryAfterMs, 1) }))
      return true
    }
    _webMcpGlobalTimestamps.push(now)

    // ── Layer 6: Restricted URL check (async) ──
    ;(async () => {
      try {
        const tab = await chrome.tabs.get(tabId)
        const url = tab.url ?? ''
        if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
            url.startsWith('about:') || url.startsWith('file://') || !url) {
          _recordWebMcpReject(now)
          sendResponse(_bgErr('RESTRICTED_PAGE', 'Cannot operate on this page'))
          return
        }

        // Forward to content script
        chrome.tabs.sendMessage(
          tabId,
          { type: 'WEBMCP_FILL_PREVIEW_REQUEST', itemId: params.itemId, targetHints: params.targetHints },
          (response) => {
            if (chrome.runtime.lastError) {
              sendResponse(_bgErr('TAB_UNREACHABLE', 'Content script unreachable'))
              return
            }
            // Relay adapter response.  If adapter already includes resultVersion,
            // pass through; otherwise wrap with version for safety.
            if (response && typeof response === 'object' && response.resultVersion === WEBMCP_RESULT_VERSION) {
              sendResponse(response)
            } else if (response && typeof response === 'object') {
              sendResponse({ ...response, resultVersion: WEBMCP_RESULT_VERSION })
            } else {
              sendResponse(_bgErr('INTERNAL_ERROR', 'No response from content script'))
            }
          },
        )
      } catch (err: any) {
        sendResponse(_bgErr('INVALID_TAB', 'Tab not found'))
      }
    })()
    return true // async
  }

  // ════════════════════════════════════════════════════════════════════════
  // VAULT_SET_WRITES_DISABLED — Global writes kill-switch toggle
  //
  // Operator/admin control: enable/disable ALL DOM write operations.
  // Gated by sender.id (already validated above) and strict schema.
  // ════════════════════════════════════════════════════════════════════════
  if (msg.type === 'VAULT_SET_WRITES_DISABLED') {
    const { disabled } = msg
    if (typeof disabled !== 'boolean') {
      sendResponse({ success: false, error: 'Invalid VAULT_SET_WRITES_DISABLED payload: disabled must be boolean' })
      return true
    }
    ;(async () => {
      try {
        const { setWritesDisabled } = await import('./vault/autofill/writesKillSwitch')
        await setWritesDisabled(disabled)
        console.log(`[BG] Writes kill-switch set to: ${disabled}`)
        sendResponse({ success: true, disabled })
      } catch (err: any) {
        console.error('[BG] Failed to set writes kill-switch:', err)
        sendResponse({ success: false, error: 'Failed to update writes kill-switch' })
      }
    })()
    return true // async
  }

  // ════════════════════════════════════════════════════════════════════════
  // EXPORT_AUDIT_LOG — Export sanitized audit log as JSONL
  //
  // Privileged operation.  Defense layers (in order):
  //   1. Universal sender gate (already enforced above)
  //   2. Context gate — sender must be extension UI (no sender.tab,
  //      sender.url matches chrome-extension://<id>/popup|sidepanel)
  //   3. Vault unlocked gate — VSBT must be present (cleared on lock/logout)
  //   4. HA gate — if HA mode active, block export entirely (fail-closed)
  //   5. Export logic
  //
  // On rejection: { success:false, error:{ code, message }, resultVersion }
  // On success:   { success:true, jsonl, truncated, resultVersion }
  // Hard cap: MAX_EXPORT_BYTES (512 KB); truncated=true if exceeded.
  // ════════════════════════════════════════════════════════════════════════
  if (msg.type === 'EXPORT_AUDIT_LOG') {
    // ── Layer 2: Context gate (fail-closed, synchronous) ──
    // Reject if sender.tab exists (content-script), or sender.url is
    // missing / not from our extension's allowed UI pages.
    if (!_isExtensionUiContext(sender, chrome.runtime.id)) {
      _auditExportLog('EXPORT_AUDIT_BLOCKED_CONTEXT', 'Audit export rejected — invalid context', true)
      sendResponse({ success: false, error: { code: 'FORBIDDEN' as AuditExportErrorCode, message: 'Forbidden' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION })
      return true
    }

    // ── Layer 3: Vault unlocked gate (fail-closed, synchronous) ──
    // VSBT is cleared synchronously on lock (/lock endpoint) and logout
    // (AUTH_LOGOUT). If the cache is stale, we fail-closed (empty = locked).
    if (!_isVaultUnlocked()) {
      _auditExportLog('EXPORT_AUDIT_BLOCKED_LOCKED', 'Audit export rejected — vault locked', true)
      sendResponse({ success: false, error: { code: 'LOCKED' as AuditExportErrorCode, message: 'Vault is locked' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION })
      return true
    }

    // ── Layer 4 + 5: HA gate + export (async for dynamic import) ──
    ;(async () => {
      try {
        let ha = true // fail-closed default
        try {
          const { isHAEnforced } = await import('./vault/autofill/haGuard')
          ha = isHAEnforced()
        } catch {
          // Cannot determine HA state — fail-closed: treat as HA active
        }

        // ── Layer 4: HA gate — block entirely under HA (fail-closed) ──
        if (ha) {
          _auditExportLog('EXPORT_AUDIT_BLOCKED_HA', 'Audit export rejected — HA mode active', true)
          sendResponse({ success: false, error: { code: 'HA_BLOCKED' as AuditExportErrorCode, message: 'Export blocked by security policy' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION })
          return
        }

        // ── Layer 4b: Double-check VSBT (guard against async race) ──
        if (!_isVaultUnlocked()) {
          _auditExportLog('EXPORT_AUDIT_BLOCKED_LOCKED', 'Audit export rejected — vault locked (async recheck)', false)
          sendResponse({ success: false, error: { code: 'LOCKED' as AuditExportErrorCode, message: 'Vault is locked' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION })
          return
        }

        // ── Layer 5: Export logic ──
        const { exportAuditLogJsonl } = await import('./vault/autofill/hardening')
        const result = exportAuditLogJsonl()
        _auditExportLog('EXPORT_AUDIT_ALLOWED', 'Audit log exported', false)
        sendResponse({ success: true, jsonl: result.jsonl, truncated: result.truncated, resultVersion: AUDIT_EXPORT_RESULT_VERSION })
      } catch {
        sendResponse({ success: false, error: { code: 'INTERNAL_ERROR' as AuditExportErrorCode, message: 'Export failed' }, resultVersion: AUDIT_EXPORT_RESULT_VERSION })
      }
    })()
    return true // async
  }

  // Check desktop app status (for BackendConfigLightbox)
  if (msg.type === 'CHECK_DESKTOP_APP_STATUS') {
    console.log('[BG] Checking desktop app status...');
    (async () => {
      try {
        const response = await fetch(`${ELECTRON_BASE_URL}/api/orchestrator/status`, {
          method: 'GET',
          headers: _electronHeaders(),
          signal: AbortSignal.timeout(3000),
        });
        console.log('[BG] Desktop app responded:', response.status);
        sendResponse({ running: true, status: response.status });
      } catch (e: any) {
        console.log('[BG] Desktop app check failed:', e.name, e.message);
        sendResponse({ running: false, error: e.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // ── Typed Electron RPC (replaces ELECTRON_API_PROXY) ──────────────────────
  //
  // SECURITY: No generic proxy.  Each RPC method maps to exactly one
  // hardcoded HTTP endpoint.  Payload is Zod-validated, sender is
  // checked (extension ID only), and the launch secret is injected
  // server-side — never exposed to the caller.
  //
  // See: src/rpc/electronRpc.ts for the full registry + schemas.
  //
  // Waits for launch secret before dispatching — same as AUTH_LOGIN.
  // Without this, the sidepanel/popup Command Chat can open before the
  // WebSocket handshake completes, causing 401 and "No models available".
  // ─────────────────────────────────────────────────────────────────────────
  if (msg && msg.type === 'ELECTRON_RPC') {
    ;(async () => {
      await ensureLaunchSecret(10000)
      handleElectronRpc(
        msg as ElectronRpcRequest,
        sender,
        sendResponse,
        _launchSecret,
        ELECTRON_BASE_URL,
      )
    })()
    return true
  }

  // ===== AUTH HANDLERS =====
  
  // Handle SSO login request
  // New approach: Extension gets auth URL from Electron and opens it in a Chrome tab directly.
  // This avoids all Windows "App auswählen" / Smart App Control issues.
  if (msg && msg.type === 'AUTH_LOGIN') {
    console.log('[BG] AUTH_LOGIN request received');
    (async () => {
      try {
        // ── Step 0: Ensure launch secret is available ──
        // After a machine restart or service-worker restart the WebSocket
        // handshake may not have completed yet.  Without the secret every
        // HTTP request to Electron (except /api/health) returns 401.
        const hasSecret = await ensureLaunchSecret(10000);

        if (!hasSecret) {
          // Secret still missing – check if Electron is at least alive
          // via the secret-exempt /api/health endpoint.
          // Retry up to 3 times (app may still be starting on Linux)
          let healthCheck: Response | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            healthCheck = await fetch(`${ELECTRON_BASE_URL}/api/health`, {
              method: 'GET',
              signal: AbortSignal.timeout(3000),
            }).catch(() => null);
            if (healthCheck?.ok) break;
            await new Promise(r => setTimeout(r, 500));
          }

          if (healthCheck && healthCheck.ok) {
            // Electron is running but the WebSocket handshake hasn't completed.
            console.log('[AUTH] Electron running but launch secret not yet received');
            sendResponse({ ok: false, error: 'Connecting to desktop app – please try again in a few seconds.' });
          } else {
            console.log('[AUTH] Electron not reachable (no secret, health check failed)');
            sendResponse({ ok: false, electronNotRunning: true, error: 'Desktop app is not running.' });
          }
          return;
        }

        // ── Step 0b: Authenticated health check ──
        // Use /api/health rather than /api/orchestrator/status so we don't
        // false-negative when the SQLite orchestrator service is still initializing.
        const healthCheck = await fetch(`${ELECTRON_BASE_URL}/api/health`, {
          method: 'GET',
          headers: _electronHeaders(),
          signal: AbortSignal.timeout(3000),
        }).catch(() => null);
        
        const electronReachable = healthCheck && healthCheck.ok;
        console.log('[BG][A] Health check: electronReachable=' + electronReachable);
        
        if (!electronReachable) {
          console.log('[AUTH] Electron not reachable (authenticated check failed)');
          sendResponse({ ok: false, electronNotRunning: true, error: 'Desktop app is not running.' });
          return;
        }
        
        // Step 1: Get auth URL from Electron (Electron starts loopback server but does NOT open browser)
        console.log('[BG] Requesting auth URL from Electron...');
        const urlResponse = await fetch(`${ELECTRON_BASE_URL}/api/auth/login-url`, {
          method: 'POST',
          headers: _electronHeaders(),
          signal: AbortSignal.timeout(10000),
        });
        const urlData = await urlResponse.json();
        
        if (!urlData.ok || !urlData.authUrl) {
          console.error('[BG] Failed to get auth URL:', urlData.error);
          sendResponse({ ok: false, error: urlData.error || 'Failed to prepare SSO' });
          return;
        }
        
        // Step 2: Open the auth URL in a Chrome tab (this is 100% reliable - we ARE Chrome!)
        console.log('[BG] Opening auth URL in Chrome tab...');
        const authTab = await chrome.tabs.create({ url: urlData.authUrl, active: true });
        console.log('[BG] Auth tab created: id=' + authTab.id);
        
        // Step 3: Wait for Electron to receive the callback (long-poll)
        console.log('[BG] Waiting for SSO callback via Electron...');
        const waitResponse = await fetch(`${ELECTRON_BASE_URL}/api/auth/login-wait`, {
          method: 'POST',
          headers: _electronHeaders(),
          signal: AbortSignal.timeout(130000), // 130s = Electron's 120s LOGIN_TIMEOUT_MS + 10s buffer
        });
        const waitData = await waitResponse.json();
        console.log('[BG] AUTH_LOGIN response:', waitData);
        
        if (waitData.ok) {
          // Store auth state including tier
          await chrome.storage.local.set({ 
            authLoggedIn: true,
            authTier: waitData.tier || 'free'
          });
          // Delay before closing the auth tab so the user can see the
          // "You're signed in" confirmation page.  Without this delay the
          // Electron dashboard window steals focus almost instantly and the
          // tab is removed before the confirmation page is ever visible.
          await new Promise(r => setTimeout(r, 3000));
          // Close the Keycloak auth tab if still open
          try {
            if (authTab.id) await chrome.tabs.remove(authTab.id);
          } catch (_) { /* tab may already be closed */ }
        }
        sendResponse({ ok: waitData.ok, error: waitData.error, tier: waitData.tier });
      } catch (e: any) {
        console.error('[BG] AUTH_LOGIN error:', e.message);
        sendResponse({ ok: false, error: e.message || 'Login failed' });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle auth status check
  // Returns: { loggedIn, role?, displayName?, email?, initials? }
  if (msg && msg.type === 'AUTH_STATUS') {
    console.log('[BG] AUTH_STATUS request received');
    (async () => {
      try {
        // Ensure launch secret is available (may need WebSocket handshake)
        await ensureLaunchSecret(3000);

        const response = await fetch(`${ELECTRON_BASE_URL}/api/auth/status`, {
          method: 'GET',
          headers: _electronHeaders(),
          signal: AbortSignal.timeout(5000),
        });
        const data = await response.json();
        // [CHECKPOINT B] Log status response (no secrets)
        console.log('[BG][B] AUTH_STATUS response: loggedIn=' + data.loggedIn + ', tier=' + (data.tier ?? 'null') + ', hasDisplayName=' + !!data.displayName);
        // Update stored state (including user info, tier, and picture for cached display)
        await chrome.storage.local.set({ 
          authLoggedIn: data.loggedIn,
          authTier: data.tier || null,
          authDisplayName: data.displayName || null,
          authEmail: data.email || null,
          authInitials: data.initials || null,
          authPicture: data.picture || null
        });
        // Pass through all user info, tier, and picture
        sendResponse({ 
          loggedIn: data.loggedIn,
          tier: data.tier,
          displayName: data.displayName,
          email: data.email,
          initials: data.initials,
          picture: data.picture
        });
      } catch (e: any) {
        console.log('[BG] AUTH_STATUS error (Electron not reachable):', e.message);
        // FAIL-CLOSED: If we can't reach Electron, treat user as logged out.
        // We cannot validate the session without Electron, so we don't trust cached state.
        // Clear cached login state to prevent stale data issues.
        await chrome.storage.local.set({ 
          authLoggedIn: false,
          authTier: null
        });
        sendResponse({ 
          loggedIn: false,
          tier: null,
          displayName: null,
          email: null,
          initials: null,
          picture: null
        });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle logout request
  // Clears session on backend and all cached auth state
  if (msg && msg.type === 'AUTH_LOGOUT') {
    console.log('[BG] AUTH_LOGOUT request received');
    // Immediately clear VSBT (fail-closed: no stale session survives logout)
    _cacheVsbt(null)
    ;(async () => {
      // Clear all auth state immediately (fail-closed)
      const clearAuthState = async () => {
        await chrome.storage.local.set({ 
          authLoggedIn: false,
          authTier: null,
          authDisplayName: null,
          authEmail: null,
          authInitials: null,
          authPicture: null
        });
      };
      
      try {
        const response = await fetch(`${ELECTRON_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: _electronHeaders(),
          signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        console.log('[BG] AUTH_LOGOUT response:', data);
        // Clear stored state
        await clearAuthState();
        sendResponse({ ok: data.ok, error: data.error });
      } catch (e: any) {
        console.error('[BG] AUTH_LOGOUT error:', e.message);
        // Clear stored state anyway (fail-closed)
        await clearAuthState();
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle "Open WRDesk Home" - opens wrdesk.com if not already open (NO tab spam)
  // Used when extension popup/sidepanel is opened in logged-out state
  if (msg && msg.type === 'OPEN_WRDESK_HOME_IF_NEEDED') {
    console.log('[BG] OPEN_WRDESK_HOME_IF_NEEDED request received');
    (async () => {
      try {
        // Check if we've already opened wrdesk.com recently (debounce within 5 seconds)
        const storage = await chrome.storage.session.get(['wrdeskHomeOpenedAt']);
        const lastOpened = storage.wrdeskHomeOpenedAt as number | undefined;
        const now = Date.now();
        
        if (lastOpened && (now - lastOpened) < 5000) {
          console.log('[BG] OPEN_WRDESK_HOME_IF_NEEDED: debounced (opened recently)');
          sendResponse({ ok: true, action: 'debounced' });
          return;
        }
        
        // Query all tabs for existing wrdesk.com tab
        const existingTabs = await chrome.tabs.query({ url: 'https://wrdesk.com/*' });
        
        if (existingTabs.length > 0) {
          console.log('[BG] OPEN_WRDESK_HOME_IF_NEEDED: tab already exists, skipping');
          sendResponse({ ok: true, action: 'already_open', tabId: existingTabs[0].id });
          return;
        }
        
        // No existing tab - create one without stealing focus
        console.log('[BG] OPEN_WRDESK_HOME_IF_NEEDED: creating new tab');
        const newTab = await chrome.tabs.create({ 
          url: 'https://wrdesk.com',
          active: false  // Do NOT steal focus
        });
        
        // Mark that we opened wrdesk.com (for debouncing)
        await chrome.storage.session.set({ wrdeskHomeOpenedAt: now });
        
        sendResponse({ ok: true, action: 'created', tabId: newTab.id });
      } catch (e: any) {
        console.error('[BG] OPEN_WRDESK_HOME_IF_NEEDED error:', e.message);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // Keep channel open for async response
  }

  // Handle "Create Account" - opens wrdesk.com
  if (msg && msg.type === 'OPEN_REGISTER_PAGE') {
    console.log('[BG] OPEN_REGISTER_PAGE request received');
    (async () => {
      try {
        // Check if wrdesk.com is already open
        const existingTabs = await chrome.tabs.query({ url: 'https://wrdesk.com/*' });
        if (existingTabs.length > 0 && existingTabs[0].id) {
          // Activate existing tab
          await chrome.tabs.update(existingTabs[0].id, { active: true });
          console.log('[BG] OPEN_REGISTER_PAGE: activated existing wrdesk.com tab');
        } else {
          // Open new tab
          await chrome.tabs.create({ url: 'https://wrdesk.com', active: true });
          console.log('[BG] OPEN_REGISTER_PAGE: opened new wrdesk.com tab');
        }
        sendResponse({ ok: true });
      } catch (e: any) {
        console.error('[BG] OPEN_REGISTER_PAGE error:', e.message);
        chrome.tabs.create({ url: 'https://wrdesk.com', active: true });
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // NOTE: The per-type SENDER_GATED_TYPES check was removed because the
  // universal sender gate at the top of this handler now rejects ALL
  // messages from foreign extensions before any dispatch occurs.

  // Check if this is a vault RPC message (has type: 'VAULT_RPC')
  if (msg && msg.type === 'VAULT_RPC') {
    console.log('[BG] Received VAULT_RPC:', msg.method)

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[BG] WebSocket not connected for vault RPC')
      sendResponse({ success: false, error: 'Not connected to Electron app' })
      return true
    }

    const VSBT_EXEMPT_RPC = new Set(['vault.create', 'vault.unlock', 'vault.getStatus'])
    const needsBinding = !VSBT_EXEMPT_RPC.has(msg.method)

    ;(async () => {
      try {
        // If the in-memory VSBT is missing (MV3 service worker restarted since unlock),
        // eagerly recover it from chrome.storage.session before deciding whether to bind.
        // The startup restore at module level is fire-and-forget; this ensures we don't
        // skip binding just because the async restore hasn't resolved yet.
        if (needsBinding && !_cachedVsbt && typeof chrome !== 'undefined' && chrome.storage?.session) {
          try {
            const stored = await chrome.storage.session.get(['_vsbt', '_vsbtAt'])
            if (stored?._vsbt) {
              const age = typeof stored._vsbtAt === 'number' ? Date.now() - stored._vsbtAt : Infinity
              if (age < VSBT_MAX_AGE_MS) {
                _cachedVsbt = stored._vsbt
                _vsbtCachedAt = stored._vsbtAt
                console.log('[BG] VAULT_RPC: recovered VSBT from session storage for bind')
              }
            }
          } catch { /* storage unavailable — fall through, bind will be skipped */ }
        }

        // If this RPC requires a bound session and we have a cached VSBT (from HTTP unlock),
        // bind the WebSocket connection first. The WebSocket is separate from HTTP, so
        // unlock via VAULT_HTTP_API does not auto-bind the WS connection.
        if (needsBinding && _cachedVsbt) {
          const bindId = `vault-bind-${Date.now()}-${Math.random().toString(36).slice(2)}`
          const bindPromise = new Promise<void>((resolve, reject) => {
            if (!globalThis.vaultRpcCallbacks) globalThis.vaultRpcCallbacks = new Map()
            globalThis.vaultRpcCallbacks.set(bindId, (r: any) => {
              if (r?.success) resolve()
              else reject(new Error(r?.error || 'vault.bind failed'))
            })
          })
          ws.send(JSON.stringify({
            id: bindId,
            method: 'vault.bind',
            params: { vsbt: _cachedVsbt }
          }))
          await bindPromise
          console.log('[BG] WebSocket vault session bound via vault.bind')
        }

        const rpcMessage = {
          id: msg.id,
          method: msg.method,
          params: msg.params || {}
        }
        console.log('[BG] Forwarding to WebSocket:', rpcMessage)
        ws.send(JSON.stringify(rpcMessage))

        if (!globalThis.vaultRpcCallbacks) globalThis.vaultRpcCallbacks = new Map()
        globalThis.vaultRpcCallbacks.set(msg.id, sendResponse)
      } catch (error: any) {
        console.error('[BG] Error in vault RPC flow:', error)
        sendResponse({ success: false, error: error.message })
      }
    })()
    return true
  }
  
  if (!msg || !msg.type) return true;

  console.log(`📨 Nachricht erhalten: ${msg.type}`);

  switch (msg.type) {
    case 'VAULT_HTTP_API': {
      // Relay vault HTTP API calls from content scripts (bypasses CSP)
      const { endpoint, body, vsbt } = msg
      console.log('[BG] Relaying vault HTTP API call:', endpoint)
      console.log('[BG] Request body:', body)

      // Resolve the effective VSBT: prefer the one sent by the content script,
      // fall back to the background-cached copy (survives content script reloads).
      const effectiveVsbt = vsbt || _cachedVsbt
      if (!vsbt && _cachedVsbt) {
        console.log('[BG] Content script had no VSBT — using background-cached token')
      }

      const VAULT_API_URL = 'http://127.0.0.1:51248/api/vault'
      const fullUrl = `${VAULT_API_URL}${endpoint}`
      
      // Retry function with exponential backoff
      const retryFetch = async (url: string, options: RequestInit, retries = 3, delay = 500): Promise<Response> => {
        for (let i = 0; i < retries; i++) {
          try {
            console.log(`[BG] Fetch attempt ${i + 1}/${retries}:`, url)
            const response = await fetch(url, options)
            // If successful, return immediately
            if (response.ok || i === retries - 1) {
              return response
            }
            // If not ok and not last retry, wait and retry
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)))
            }
          } catch (error: any) {
            console.error(`[BG] Fetch attempt ${i + 1} failed:`, error.name, error.message)
            // Only retry network errors (TypeError, AbortError)
            if ((error.name === 'TypeError' || error.name === 'AbortError') && i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)))
              continue
            }
            // For other errors or last retry, throw
            throw error
          }
        }
        throw new Error('Max retries exceeded')
      }
      
      // Determine HTTP method based on endpoint
      // Only /health uses GET, all others use POST
      const isGetRequest = endpoint === '/health'
      const method = isGetRequest ? 'GET' : 'POST'
      
      console.log('[BG] Fetching:', fullUrl, 'Method:', method)
      
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout
      
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (effectiveVsbt) {
        headers['X-Vault-Session'] = effectiveVsbt
      }
      if (_launchSecret) {
        headers['X-Launch-Secret'] = _launchSecret
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      }
      
      if (body !== undefined && body !== null && method === 'POST') {
        fetchOptions.body = JSON.stringify(body)
      }
      
      // Use retry logic
      retryFetch(fullUrl, fetchOptions)
        .then(response => {
          clearTimeout(timeoutId) // Clear timeout on successful response
          console.log('[BG] Vault API response status:', response.status, response.statusText)
          // Fail-closed: 401 means the session is no longer valid on the
          // Electron side.  Clear the VSBT immediately to prevent stale
          // session usage across the extension.
          if (response.status === 401) {
            _cacheVsbt(null)
            console.log('[BG] VSBT cleared — Electron returned 401 (session invalid)')
          }
          if (!response.ok) {
            return response.text().then(text => {
              console.error('[BG] Vault API error response:', text)
              throw new Error(`HTTP ${response.status}: ${text}`)
            })
          }
          return response.json()
        })
        .then(data => {
          console.log('[BG] Vault API response data:', data)

          // Cache VSBT from unlock/create responses so it survives content-script reloads
          if (data?.sessionToken) {
            _cacheVsbt(data.sessionToken)
            console.log('[BG] VSBT cached from', endpoint)
          }
          // Clear VSBT cache when the vault is locked or deleted
          if (data?.success && (endpoint === '/lock' || endpoint === '/delete')) {
            _cacheVsbt(null)
            console.log('[BG] VSBT cache cleared on', endpoint)
          }

          // Check if sendResponse is still valid (service worker might have suspended)
          try {
            // Store response in chrome.storage as fallback
            chrome.storage.local.set({ [`vault_response_${Date.now()}`]: data }).catch(() => {})
            sendResponse(data)
          } catch (e: any) {
            console.error('[BG] Error sending response (service worker may have suspended):', e)
            // If sendResponse fails, try to notify via storage event
            chrome.storage.local.set({ 
              vault_last_error: { 
                error: 'Service worker suspended', 
                endpoint,
                timestamp: Date.now()
              }
            }).catch(() => {})
            // Try one more time
            try {
              sendResponse({ success: false, error: 'Service worker suspended - please retry', endpoint })
            } catch {}
          }
        })
        .catch(error => {
          clearTimeout(timeoutId) // Clear timeout on error
          console.error('[BG] Vault API fetch error after retries:', error)
          console.error('[BG] Error name:', error.name)
          console.error('[BG] Error message:', error.message)
          
          // Check if it's a network error
          if (error.name === 'TypeError' || error.message.includes('Failed to fetch') || error.name === 'AbortError') {
            console.error('[BG] Network error - server may not be running on port 51248')
            // Update connection state
            chrome.storage.local.set({ 
              vault_connection_state: { 
                connected: false, 
                last_error: error.message,
                timestamp: Date.now()
              }
            }).catch(() => {})
          }
          
          try {
            sendResponse({ 
              success: false, 
              error: error.name === 'AbortError' ? 'Request timeout - server may not be responding' : (error.message || String(error)),
              errorType: error.name,
              details: error.stack
            })
          } catch (e) {
            console.error('[BG] Error sending error response:', e)
            // Last resort: store in chrome.storage
            chrome.storage.local.set({ 
              vault_last_error: { 
                success: false,
                error: error.message || String(error),
                endpoint,
                timestamp: Date.now()
              }
            }).catch(() => {})
          }
        })
      
      return true // Keep channel open for async response
    }
    
    case 'CAPTURE_VISIBLE_TAB': {
      try {
        chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
          try { sendResponse({ success: true, dataUrl }) } catch {}
        })
      } catch(e) { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_START_SELECTION': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'START_SELECTION',
            source: msg.source || 'browser',
            mode: msg.mode || 'area',
            options: msg.options || {}
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          // Try to connect on-demand to 127.0.0.1:53247 and retry
          try {
            const url = 'ws://127.0.0.1:51247/'
            const temp = new WebSocket(url)
            temp.addEventListener('open', () => {
              try { ws = temp as any } catch {}
              try { ws?.send(JSON.stringify({ type: 'START_SELECTION', source: msg.source || 'browser', mode: msg.mode || 'area', options: msg.options || {} })) } catch {}
              try { sendResponse({ success: true }) } catch {}
            })
            temp.addEventListener('error', () => { try { sendResponse({ success:false, error:'WS not connected' }) } catch {} })
          } catch { try { sendResponse({ success:false, error:'WS not connected' }) } catch {} }
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_CANCEL_SELECTION': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = { type: 'CANCEL_SELECTION', source: msg.source || 'browser' }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_OPEN_ANALYSIS_DASHBOARD': {
      // Open the Electron Analysis Dashboard window
      (async () => {
        try {
          // First check if WebSocket is connected
          if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
            const payload: Record<string, unknown> = { type: 'OPEN_ANALYSIS_DASHBOARD' }
            if (msg.theme && ['standard', 'dark', 'pro'].includes(msg.theme)) payload.theme = msg.theme
            try { ws.send(JSON.stringify(payload)) } catch {}
            try { sendResponse({ success: true }) } catch {}
            return
          }
          
          // Try to connect on-demand
          const url = 'ws://127.0.0.1:51247/'
          const temp = new WebSocket(url)
          
          const timeout = setTimeout(() => {
            temp.close()
            // Check if Electron app is running via HTTP
            checkAndLaunchElectronApp(sendResponse, msg.theme)
          }, 2000) // 2 second timeout
          
          temp.addEventListener('open', () => {
            clearTimeout(timeout)
            try { ws = temp as any } catch {}
            const payload: Record<string, unknown> = { type: 'OPEN_ANALYSIS_DASHBOARD' }
            if (msg.theme && ['standard', 'dark', 'pro'].includes(msg.theme)) payload.theme = msg.theme
            try { ws?.send(JSON.stringify(payload)) } catch {}
            try { sendResponse({ success: true }) } catch {}
          })
          
          temp.addEventListener('error', () => {
            clearTimeout(timeout)
            // Check if Electron app is running via HTTP
            checkAndLaunchElectronApp(sendResponse, msg.theme)
          })
        } catch (err) {
          // Check if Electron app is running via HTTP
          checkAndLaunchElectronApp(sendResponse, msg.theme)
        }
      })()
      return true // Indicate async response
    }
    case 'ELECTRON_SAVE_TRIGGER': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'SAVE_TRIGGER',
            name: msg.name,
            mode: msg.mode,
            rect: msg.rect,
            displayId: msg.displayId,
            imageUrl: msg.imageUrl,
            videoUrl: msg.videoUrl
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'EXTENSION_SAVE_TRIGGER': {
      // Extension-native trigger (no displayId) - forward to Electron
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'SAVE_TRIGGER',
            name: msg.name,
            mode: msg.mode,
            rect: msg.rect,
            displayId: undefined, // Extension trigger has no displayId
            imageUrl: msg.imageUrl,
            videoUrl: msg.videoUrl
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'ELECTRON_EXECUTE_TRIGGER': {
      try {
        if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
          const payload = {
            type: 'EXECUTE_TRIGGER',
            trigger: msg.trigger
          }
          try { ws.send(JSON.stringify(payload)) } catch {}
          try { sendResponse({ success: true }) } catch {}
        } else {
          try { sendResponse({ success: false, error: 'WS not connected' }) } catch {}
        }
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'REQUEST_START_SELECTION_POPUP': {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id
          const winId = tabs[0]?.windowId
          if (!tabId) { try { sendResponse({ success:false }) } catch {}; return }
          try { if (typeof winId === 'number') chrome.windows.update(winId, { focused: true }) } catch {}
          try { chrome.tabs.highlight({ tabs: tabs[0].index }, () => {}) } catch {}
          setTimeout(() => {
            try { chrome.tabs.sendMessage(tabId, { type: 'OG_BEGIN_SELECTION_FOR_POPUP' }, ()=>{ try { sendResponse({ success:true }) } catch {} }) } catch { try { sendResponse({ success:false }) } catch {} }
          }, 50)
        })
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    case 'TEST_CONNECTION':
      connectToWebSocketServer();
      sendResponse({ success: true, message: 'Verbindung wird getestet' });
      break;

    case 'CONNECT':
      connectToWebSocketServer();
      sendResponse({ success: true, message: 'Verbindung wird hergestellt' });
      break;

    case 'DISCONNECT':
      if (ws) {
        ws.close();
        ws = null;
      }
      sendResponse({ success: true, message: 'Verbindung getrennt' });
      break;

    case 'GET_STATUS':
      const status = {
        isConnected: ws && ws.readyState === WebSocket.OPEN,
        readyState: ws ? ws.readyState : null
      };
      
      sendResponse({ success: true, data: status });
      chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', data: status });
      break;

    case 'LAUNCH_ELECTRON_APP': {
      // Launch Electron app - try multiple approaches with improved feedback
      console.log('[BG] 🚀 LAUNCH_ELECTRON_APP request received');
      (async () => {
        try {
          // First check if already running
          if (await isElectronRunning()) {
            console.log('[BG] ✅ Electron is already running');
            connectToWebSocketServer();
            sendResponse({ success: true });
            return;
          }
          
          // Try the improved multi-method launcher
          console.log('[BG] 🚀 Trying to launch via launchElectronAppDirect...');
          const launched = await launchElectronAppDirect();
          
          if (launched) {
            console.log('[BG] ✅ Electron started successfully');
            setTimeout(() => {
              connectToWebSocketServer();
              setTimeout(() => {
                const newStatus = {
                  isConnected: ws && ws.readyState === WebSocket.OPEN,
                  readyState: ws ? ws.readyState : null
                };
                chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', data: newStatus });
              }, 1500);
            }, 500);
            sendResponse({ success: true });
            return;
          }
          
          // All launch methods failed - show manual instructions immediately
          console.log('[BG] ❌ All launch methods failed - showing manual instructions');
          
          // Show a clickable notification with clear instructions
          chrome.notifications.create('wrdesk-launch-help', {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon-128.png'),
            title: 'WR Desk Dashboard',
            message: 'Please start "WR Desk" from the Start Menu or desktop shortcut, then click Retry Connection.',
            priority: 2,
            requireInteraction: true
          });
          
          // Always show manual instructions when launch fails
          sendResponse({ 
            success: false, 
            error: 'Please start "WR Desk" from the Start Menu or desktop shortcut.',
            showManualInstructions: true
          });
        } catch (err) {
          console.error('[BG] Failed to launch Electron:', err);
          sendResponse({ 
            success: false, 
            error: 'Please start the WR Desk Dashboard manually from the Start Menu.',
            showManualInstructions: true
          });
        }
      })();
      return true; // Keep channel open for async response
    }

    // ===== MAILGUARD MESSAGE HANDLERS =====
    case 'MAILGUARD_ACTIVATE': {
      console.log('[BG] 🛡️ MailGuard activate request received')
      console.log('[BG] 🛡️ Window info:', msg.windowInfo)
      console.log('[BG] 🛡️ Theme:', msg.theme)
      
      // Store state for auto-restore after reconnection
      mailGuardShouldBeActive = true;
      lastMailGuardWindowInfo = msg.windowInfo;
      lastMailGuardTheme = msg.theme || 'default';
      
      // Track which tab has MailGuard active (for hide/show on tab switch)
      mailGuardActiveTabId = sender.tab?.id ?? null;
      console.log('[BG] 🛡️ MailGuard active on tab:', mailGuardActiveTabId);
      
      if (!WS_ENABLED) {
        console.log('[BG] 🛡️ WebSocket disabled')
        try { sendResponse({ success: false, error: 'WebSocket disabled' }) } catch {}
        break
      }
      
      // Use robust connection with retries
      ensureConnection(5).then((connected) => {
        if (connected && ws && ws.readyState === WebSocket.OPEN) {
          console.log('[BG] 🛡️ Connection ready, sending MAILGUARD_ACTIVATE...')
          try { 
            ws.send(JSON.stringify({ 
              type: 'MAILGUARD_ACTIVATE', 
              windowInfo: msg.windowInfo, 
              theme: msg.theme || 'default' 
            })) 
            console.log('[BG] 🛡️ MAILGUARD_ACTIVATE sent successfully!')
            try { sendResponse({ success: true }) } catch {}
          } catch (e) {
            console.error('[BG] 🛡️ Error sending MAILGUARD_ACTIVATE:', e)
            try { sendResponse({ success: false, error: 'Failed to send message' }) } catch {}
          }
        } else {
          console.log('[BG] 🛡️ Connection failed after retries')
          try { 
            sendResponse({ 
              success: false, 
              error: 'Could not connect to OpenGiraffe. Make sure the Electron app is running.' 
            }) 
          } catch {}
        }
      })
      
      return true // Keep channel open for async response
    }
    
    case 'MAILGUARD_DEACTIVATE': {
      console.log('[BG] 🛡️ MailGuard deactivate request')
      // Clear the stored state so it doesn't auto-restore
      mailGuardShouldBeActive = false;
      lastMailGuardWindowInfo = null;
      mailGuardActiveTabId = null;  // Clear active tab tracking
      
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_DEACTIVATE' })) } catch {}
        try { sendResponse({ success: true }) } catch {}
      } else {
        try { sendResponse({ success: false, error: 'Electron not connected' }) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_UPDATE_ROWS': {
      // Content script sends email row positions to forward to Electron
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_UPDATE_ROWS', rows: msg.rows, provider: msg.provider || 'gmail' })) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_CHECK_STATUS': {
      // Content script wants to verify overlay is still active
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_STATUS' })) } catch {}
        try { sendResponse({ connected: true }) } catch {}
      } else {
        // WebSocket not connected - overlay might have disappeared
        try { sendResponse({ connected: false }) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_UPDATE_BOUNDS': {
      // Content script sends email list container bounds to forward to Electron
      // This is used to position the overlay only over the email list area (not sidebar)
      console.log('[BG] 🛡️ Forwarding email list bounds to Electron')
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_UPDATE_BOUNDS', bounds: msg.bounds })) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_WINDOW_POSITION': {
      // Content script sends browser window position updates for overlay anchoring
      // This keeps the overlay locked to the browser window when it moves
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_WINDOW_POSITION', windowInfo: msg.windowInfo })) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_HIDE_FOR_LIGHTBOX': {
      // Hide overlay when a lightbox is opened from sidepanel
      // Click blocking remains active in the content script
      console.log('[BG] 🛡️ Hiding overlay for lightbox')
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_HIDE' })) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_SHOW_AFTER_LIGHTBOX': {
      // Show overlay after lightbox is closed
      console.log('[BG] 🛡️ Showing overlay after lightbox closed')
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_SHOW' })) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_EMAIL_CONTENT': {
      // Content script sends sanitized email content to forward to Electron
      console.log('[BG] 🛡️ Forwarding sanitized email to Electron')
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_EMAIL_CONTENT', email: msg.email })) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_STATUS': {
      // Check if MailGuard is active
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_STATUS' })) } catch {}
        try { sendResponse({ success: true }) } catch {}
      } else {
        try { sendResponse({ success: false, active: false }) } catch {}
      }
      break
    }
    
    case 'MAILGUARD_CLOSE_LIGHTBOX': {
      // Forward close lightbox command to Electron
      console.log('[BG] 🛡️ Closing MailGuard lightbox')
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'MAILGUARD_CLOSE_LIGHTBOX' })) } catch {}
      }
      break
    }
    
    // ===== EMAIL GATEWAY MESSAGE HANDLERS (using HTTP API with auto-start) =====
    // ===== EMAIL GATEWAY MESSAGE HANDLERS (using robust HTTP client) =====
    case 'EMAIL_LIST_ACCOUNTS': {
      console.log('[BG] 📧 Email list accounts request')
      
      electronRequest('/api/email/accounts')
        .then(result => {
          console.log('[BG] 📧 Email accounts response:', result.ok ? 'success' : result.error)
          if (result.ok) {
            sendResponse(result.data)
          } else {
            sendResponse({ ok: false, error: result.error, errorCode: result.errorCode })
          }
        })
      
      return true // Keep channel open for async response
    }
    
    case 'EMAIL_CONNECT_GMAIL': {
      console.log('[BG] 📧 Email connect Gmail request (OAuth flow)')
      
      // Use OAuth-specific request with health check
      electronOAuthRequest('/api/email/accounts/connect/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: msg.displayName || 'Gmail Account' })
      })
        .then(result => {
          console.log('[BG] 📧 Gmail connect response:', result.ok ? 'success' : result.error)
          if (result.ok) {
            sendResponse(result.data)
          } else {
            sendResponse({ ok: false, error: result.error, errorCode: result.errorCode })
          }
        })
      
      return true // Keep channel open for async response
    }
    
    case 'EMAIL_CONNECT_OUTLOOK': {
      console.log('[BG] 📧 Email connect Outlook request (OAuth flow)')
      
      // Use OAuth-specific request with health check
      electronOAuthRequest('/api/email/accounts/connect/outlook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: msg.displayName || 'Outlook Account' })
      })
        .then(result => {
          console.log('[BG] 📧 Outlook connect response:', result.ok ? 'success' : result.error)
          if (result.ok) {
            sendResponse(result.data)
          } else {
            sendResponse({ ok: false, error: result.error, errorCode: result.errorCode })
          }
        })
      
      return true // Keep channel open for async response
    }
    
    case 'EMAIL_CONNECT_IMAP': {
      console.log('[BG] 📧 Email connect IMAP request')
      
      electronRequest('/api/email/accounts/connect/imap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: msg.displayName,
          email: msg.email,
          host: msg.host,
          port: msg.port,
          username: msg.username,
          password: msg.password,
          security: msg.security
        })
      })
        .then(result => {
          console.log('[BG] 📧 IMAP connect response:', result.ok ? 'success' : result.error)
          if (result.ok) {
            sendResponse(result.data)
          } else {
            sendResponse({ ok: false, error: result.error, errorCode: result.errorCode })
          }
        })
      
      return true // Keep channel open for async response
    }
    
    case 'EMAIL_DELETE_ACCOUNT': {
      console.log('[BG] 📧 Email delete account request:', msg.accountId)
      
      electronRequest(`/api/email/accounts/${msg.accountId}`, {
        method: 'DELETE'
      })
        .then(result => {
          console.log('[BG] 📧 Delete account response:', result.ok ? 'success' : result.error)
          if (result.ok) {
            sendResponse(result.data)
          } else {
            sendResponse({ ok: false, error: result.error, errorCode: result.errorCode })
          }
        })
      
      return true // Keep channel open for async response
    }
    
    case 'EMAIL_CHECK_GMAIL_CREDENTIALS': {
      console.log('[BG] 📧 Check Gmail credentials')
      
      electronRequest('/api/email/credentials/gmail')
        .then(result => {
          console.log('[BG] 📧 Gmail credentials check:', result.ok ? 'configured' : 'not configured')
          sendResponse(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error })
        })
      
      return true
    }
    
    case 'EMAIL_SAVE_GMAIL_CREDENTIALS': {
      console.log('[BG] 📧 Save Gmail credentials')
      
      electronRequest('/api/email/credentials/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: msg.clientId, clientSecret: msg.clientSecret })
      })
        .then(result => {
          console.log('[BG] 📧 Gmail credentials save:', result.ok ? 'success' : result.error)
          sendResponse(result.ok ? { ok: true } : { ok: false, error: result.error })
        })
      
      return true
    }
    
    case 'EMAIL_CHECK_OUTLOOK_CREDENTIALS': {
      console.log('[BG] 📧 Check Outlook credentials')
      
      electronRequest('/api/email/credentials/outlook')
        .then(result => {
          console.log('[BG] 📧 Outlook credentials check:', result.ok ? 'configured' : 'not configured')
          sendResponse(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error })
        })
      
      return true
    }
    
    case 'EMAIL_SAVE_OUTLOOK_CREDENTIALS': {
      console.log('[BG] 📧 Save Outlook credentials')
      
      electronRequest('/api/email/credentials/outlook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: msg.clientId, clientSecret: msg.clientSecret })
      })
        .then(result => {
          console.log('[BG] 📧 Outlook credentials save:', result.ok ? 'success' : result.error)
          sendResponse(result.ok ? { ok: true } : { ok: false, error: result.error })
        })
      
      return true
    }
    
    case 'EMAIL_GET_PRESETS': {
      console.log('[BG] 📧 Email get IMAP presets request (via HTTP)')
      
      fetch('http://127.0.0.1:51248/api/email/presets', { headers: _electronHeaders() })
        .then(res => res.json())
        .then(data => {
          console.log('[BG] 📧 IMAP presets response:', data)
          sendResponse(data)
        })
        .catch(err => {
          console.error('[BG] 📧 IMAP presets error:', err)
          sendResponse({ ok: false, error: err.message || 'Failed to fetch presets' })
        })
      
      return true // Keep channel open for async response
    }
    
    case 'EMAIL_GET_MESSAGE': {
      console.log('[BG] 📧 Email get message request (via HTTP):', msg.accountId, msg.messageId)
      
      fetch(`http://127.0.0.1:51248/api/email/accounts/${msg.accountId}/messages/${msg.messageId}`, { headers: _electronHeaders() })
        .then(res => res.json())
        .then(data => {
          console.log('[BG] 📧 Get message response:', data)
          sendResponse(data)
        })
        .catch(err => {
          console.error('[BG] 📧 Get message error:', err)
          sendResponse({ ok: false, error: err.message || 'Failed to fetch message' })
        })
      
      return true // Keep channel open for async response
    }
    
    case 'EMAIL_LIST_MESSAGES': {
      console.log('[BG] 📧 Email list messages request (via HTTP):', msg.accountId)
      
      const params = new URLSearchParams()
      if (msg.folder) params.append('folder', msg.folder)
      if (msg.limit) params.append('limit', String(msg.limit))
      if (msg.from) params.append('from', msg.from)
      if (msg.subject) params.append('subject', msg.subject)
      
      fetch(`http://127.0.0.1:51248/api/email/accounts/${msg.accountId}/messages?${params}`, { headers: _electronHeaders() })
        .then(res => res.json())
        .then(data => {
          console.log('[BG] 📧 List messages response:', data)
          sendResponse(data)
        })
        .catch(err => {
          console.error('[BG] 📧 List messages error:', err)
          sendResponse({ ok: false, error: err.message || 'Failed to list messages' })
        })
      
      return true // Keep channel open for async response
    }

    case 'DISPLAY_GRIDS_OPENED': {
      // Display grids were opened - minimize sidepanel (only on display grid tabs, not master tabs)
      if (sender.tab?.id && sender.tab?.url) {
        const tabId = sender.tab.id;
        
        // Check if this is a master tab (has hybrid_master_id in URL)
        try {
          const url = new URL(sender.tab.url);
          const hybridMasterId = url.searchParams.get('hybrid_master_id');
          
          if (hybridMasterId !== null) {
            // This is a master tab - DO NOT disable sidepanel
            console.log(`🖥️ Master tab detected (ID: ${hybridMasterId}) - keeping sidepanel enabled`);
            try { sendResponse({ success: true, isMasterTab: true }) } catch {}
            break;
          }
        } catch (e) {
          console.error('Error checking if tab is master tab:', e);
        }
        
        // This is a display grid tab - just track it (sidepanel controls its own width now)
        tabDisplayGridsActive.set(tabId, true);
        console.log(`📱 Display grid tab ${tabId} - sidepanel will adjust width to 0`);
      }
      try { sendResponse({ success: true }) } catch {}
      break;
    }
    case 'DISPLAY_GRIDS_CLOSED': {
      // Display grids were closed - sidepanel will auto-adjust width
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        tabDisplayGridsActive.set(tabId, false);
        console.log(`✅ Display grids closed for tab ${tabId} - sidepanel will adjust width`);
      }
      try { sendResponse({ success: true }) } catch {}
      break;
    }
    case 'DELETE_DISPLAY_GRID_AGENT_BOX': {
      // Delete agent box from display grid - remove from SQLite database
      const { sessionKey, identifier } = msg;
      console.log('🗑️ BG: Deleting display grid agent box:', identifier, 'from session:', sessionKey);
      
      if (!sessionKey || !identifier) {
        console.error('❌ BG: Missing sessionKey or identifier');
        try { sendResponse({ success: false, error: 'Missing sessionKey or identifier' }) } catch {}
        break;
      }
      
      // Use HTTP API to get session from SQLite
      fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(sessionKey)}`, { headers: _electronHeaders() })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then((result: any) => {
          const session = result.data || {}
          
          if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
            const beforeCount = session.agentBoxes.length;
            session.agentBoxes = session.agentBoxes.filter((box: any) => box.identifier !== identifier);
            const afterCount = session.agentBoxes.length;
            
            console.log(`🗑️ BG: Removed ${beforeCount - afterCount} agent box(es) from SQLite, ${afterCount} remaining`);
            
            // Save back to SQLite
            return fetch('http://127.0.0.1:51248/api/orchestrator/set', {
              method: 'POST',
              headers: _electronHeaders(),
              body: JSON.stringify({ key: sessionKey, value: session })
            })
          } else {
            console.warn('⚠️ BG: No agentBoxes array in session');
            throw new Error('No agentBoxes in session')
          }
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then(() => {
          console.log('✅ BG: Agent box deleted from SQLite database');
          try { sendResponse({ success: true }) } catch {}
        })
        .catch(error => {
          console.error('❌ BG: Error deleting from SQLite:', error);
          try { sendResponse({ success: false, error: String(error) }) } catch {}
        })
      
      return true; // Keep channel open for async response
    }
    
    case 'DELETE_AGENT_BOX_FROM_SQLITE': {
      // Delete agent box from master tab - remove from SQLite database
      const { sessionKey, agentId, identifier } = msg;
      console.log('🗑️ BG: DELETE_AGENT_BOX_FROM_SQLITE');
      console.log('🔑 BG: Session key:', sessionKey);
      console.log('🆔 BG: Agent ID:', agentId);
      console.log('🏷️ BG: Identifier:', identifier);
      
      if (!sessionKey) {
        console.error('❌ BG: Missing sessionKey');
        try { sendResponse({ success: false, error: 'Missing sessionKey' }) } catch {}
        return true;
      }
      
      if (!agentId && !identifier) {
        console.error('❌ BG: Missing both agentId and identifier');
        try { sendResponse({ success: false, error: 'Missing both agentId and identifier' }) } catch {}
        return true;
      }
      
      // Use HTTP API to get session from SQLite
      fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(sessionKey)}`, { headers: _electronHeaders() })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then((result: any) => {
          const session = result.data || {}
          
          console.log('📋 BG: Loaded session from SQLite');
          console.log('📊 BG: Agent boxes before deletion:', session.agentBoxes?.length || 0);
          
          if (session.agentBoxes && Array.isArray(session.agentBoxes)) {
            const beforeCount = session.agentBoxes.length;
            
            // Log all agent boxes for debugging
            console.log('🔍 BG: All agent boxes in session:');
            session.agentBoxes.forEach((box: any, index: number) => {
              console.log(`  [${index}] id=${box.id}, identifier=${box.identifier}`);
            });
            
            // Remove by EITHER identifier OR id (master tab boxes use 'id', display grid boxes use 'identifier')
            session.agentBoxes = session.agentBoxes.filter((box: any) => {
              const matchesIdentifier = identifier && box.identifier === identifier;
              const matchesId = agentId && box.id === agentId;
              const shouldRemove = matchesIdentifier || matchesId;
              
              if (shouldRemove) {
                console.log(`🗑️ BG: Removing box: id=${box.id}, identifier=${box.identifier}`);
              }
              
              return !shouldRemove;
            });
            
            const afterCount = session.agentBoxes.length;
            const removedCount = beforeCount - afterCount;
            
            console.log(`🗑️ BG: Removed ${removedCount} agent box(es) from SQLite, ${afterCount} remaining`);
            
            if (removedCount === 0) {
              console.warn('⚠️ BG: No agent boxes were removed! Check if id/identifier match.');
            }
            
            // Save back to SQLite
            return fetch('http://127.0.0.1:51248/api/orchestrator/set', {
              method: 'POST',
              headers: _electronHeaders(),
              body: JSON.stringify({ key: sessionKey, value: session })
            })
          } else {
            console.warn('⚠️ BG: No agentBoxes array in session');
            throw new Error('No agentBoxes in session')
          }
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then(() => {
          console.log('✅ BG: Agent box deleted from SQLite database');
          try { sendResponse({ success: true }) } catch {}
        })
        .catch(error => {
          console.error('❌ BG: Error deleting from SQLite:', error);
          try { sendResponse({ success: false, error: String(error) }) } catch {}
        })
      
      return true; // Keep channel open for async response
    }
    case 'REOPEN_SIDEPANEL': {
      // Expand sidepanel (sidepanel will adjust width automatically)
      if (sender.tab?.id) {
        const tabId = sender.tab.id;
        console.log(`🔓 Expanding sidepanel for tab ${tabId} - width will auto-adjust`);
        tabDisplayGridsActive.set(tabId, false);
        try { sendResponse({ success: true }) } catch {}
      } else {
        try { sendResponse({ success: false, error: 'No tab ID' }) } catch {}
      }
      break;
    }
    case 'LAUNCH_DBEAVER': {
      // Forward to Electron app to launch DBeaver via WebSocket
      if (WS_ENABLED && ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'LAUNCH_DBEAVER' }));
          // Wait for response
          const wsRef = ws;
          const responseHandler = (event: MessageEvent) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'LAUNCH_DBEAVER_RESULT') {
                wsRef.removeEventListener('message', responseHandler);
                try { sendResponse({ success: data.ok, message: data.message }) } catch {}
              }
            } catch {}
          };
          wsRef.addEventListener('message', responseHandler);
          setTimeout(() => {
            wsRef.removeEventListener('message', responseHandler);
            try { sendResponse({ success: false, error: 'Timeout waiting for response' }) } catch {}
          }, 5000);
        } catch (err) {
          console.error('Failed to send LAUNCH_DBEAVER message:', err);
          try { sendResponse({ success: false, error: 'WebSocket not connected' }) } catch {}
        }
      } else {
        // WebSocket not available - show helpful message
        try { sendResponse({ success: false, error: 'Electron app not connected. Please start the desktop app first.' }) } catch {}
      }
      return true; // Keep channel open for async response
    }

    case 'SAVE_GRID_CONFIG':
      console.log('📥 SAVE_GRID_CONFIG received');
      sendResponse({ success: true, message: 'Config received' });
      break;
    case 'OG_TOGGLE_OVERLAY':
      // Forwarded from UI (gear icon) to broadcast or simply acknowledge
      sendResponse({ success: true })
      break;

    case 'OPEN_COMMAND_CENTER_POPUP': {
      const themeHint = typeof msg.theme === 'string' ? msg.theme : null
      const createPopup = (bounds: chrome.system.display.Bounds | null) => {
        // Use React-based popup-chat.html for full WRGuard and BEAP Messages functionality
        const url = chrome.runtime.getURL('src/popup-chat.html' + (themeHint ? ('?t=' + encodeURIComponent(themeHint)) : ''))
        const opts: chrome.windows.CreateData = {
          url,
          type: 'popup',
          width: 520,
          height: 720
        }
        if (bounds) {
          opts.left = Math.max(0, bounds.left + 40)
          opts.top = Math.max(0, bounds.top + 40)
        }
        // Prevent duplicates: if a popup already exists, focus instead of opening any new one
        try {
          chrome.windows.getAll({ populate: false, windowTypes: ['popup', 'normal'] }, (wins) => {
            const existing = wins && wins.find(w => (w.type === 'popup' && typeof w.id === 'number'))
            if (existing && existing.id) {
              chrome.windows.update(existing.id, { focused: true })
              sendResponse({ success: true })
            } else {
              chrome.windows.create(opts, () => sendResponse({ success: true }))
            }
          })
        } catch {
          chrome.windows.create(opts, () => sendResponse({ success: true }))
        }
      }

      if (chrome.system?.display) {
        chrome.system.display.getInfo((displays) => {
          const primary = displays.find(d => d.isPrimary)
          const secondary = displays.find(d => !d.isPrimary)
          createPopup((secondary?.workArea || primary?.workArea) || null)
        })
      } else {
        createPopup(null)
      }
      break
    }

    case 'COMMAND_POPUP_APPEND': {
      try {
        // Forward to popup page to append media
        chrome.runtime.sendMessage({ type: 'COMMAND_POPUP_APPEND', kind: msg.kind, url: msg.url })
      } catch {}
      try { sendResponse({ success: true }) } catch {}
      break
    }

    case 'LAUNCH_LMGTFY': {
      // Disable silent popup launcher to avoid extra UI
      try { sendResponse({ success: true }) } catch {}
      break
    }
    case 'OG_CAPTURE_SAVED_TAG': {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs[0]?.id
          if (!tabId) { try { sendResponse({ success:false }) } catch {}; return }
          try { chrome.tabs.sendMessage(tabId, { type: 'OG_CAPTURE_SAVED_TAG', index: msg.index }, ()=>{ try { sendResponse({ success:true }) } catch {} }) } catch { try { sendResponse({ success:false }) } catch {} }
        })
      } catch { try { sendResponse({ success:false }) } catch {} }
      break
    }
    
    case 'PING': {
      // Simple ping-pong to wake up service worker
      console.log('🏓 BG: Received PING')
      try { sendResponse({ success: true }) } catch {}
      return true
    }
    
    // Removed DB_WEBSOCKET_MESSAGE handler - database operations now use HTTP API directly
    
    case 'GRID_SAVE': {
      console.log('📥 BG: Received GRID_SAVE message:', msg)
      const { payload } = msg
      
      console.log('📦 BG: Payload:', JSON.stringify(payload, null, 2))
      console.log('🔑 BG: Session key:', payload.sessionKey)
      
      if (!payload.sessionKey) {
        console.error('❌ BG: No sessionKey provided')
        try { sendResponse({ success: false, error: 'No session key' }) } catch {}
        break
      }
      
      // Load current session using storage wrapper
      import('./storage/storageWrapper').then(({ storageGet, storageSet }) => {
        storageGet([payload.sessionKey], (result: any) => {
        const session = result[payload.sessionKey] || {}
        
        console.log('📋 BG: Loaded session:', JSON.stringify(session, null, 2))
        
        // Initialize arrays if needed
        if (!session.displayGrids) {
          console.log('🆕 BG: Initializing displayGrids array')
          session.displayGrids = []
        }
        if (!session.agentBoxes) {
          console.log('🆕 BG: Initializing agentBoxes array')
          session.agentBoxes = []
        }
        
        // Find or create grid entry
        let gridEntry = session.displayGrids.find((g: any) => g.sessionId === payload.sessionId)
        if (!gridEntry) {
          console.log('🆕 BG: Creating new grid entry for sessionId:', payload.sessionId)
          gridEntry = {
            layout: payload.layout,
            sessionId: payload.sessionId,
            config: payload.config || { slots: {} },
            agentBoxes: payload.agentBoxes || []
          }
          session.displayGrids.push(gridEntry)
        } else {
          console.log('♻️ BG: Updating existing grid entry for sessionId:', payload.sessionId)
          gridEntry.config = payload.config || gridEntry.config
          gridEntry.agentBoxes = payload.agentBoxes || []
        }
        
        // Merge agent boxes into session (deduplicating by identifier)
        if (payload.agentBoxes && payload.agentBoxes.length > 0) {
          console.log('📦 BG: Merging', payload.agentBoxes.length, 'agent boxes into session')
          
          payload.agentBoxes.forEach((newBox: any) => {
            const existingIndex = session.agentBoxes.findIndex(
              (b: any) => b.identifier === newBox.identifier
            )
            if (existingIndex !== -1) {
              // Update existing
              session.agentBoxes[existingIndex] = newBox
              console.log('♻️ BG: Updated existing agent box:', newBox.identifier)
            } else {
              // Add new
              session.agentBoxes.push(newBox)
              console.log('🆕 BG: Added new agent box:', newBox.identifier)
            }
          })
        }
        
        console.log('💾 BG: Saving session with', session.agentBoxes.length, 'total agent boxes')
        console.log('📊 BG: Full grid entry:', JSON.stringify(gridEntry, null, 2))
        
        // Save updated session using storage wrapper
        storageSet({ [payload.sessionKey]: session }, () => {
          console.log('✅ BG: Session saved with grid config and agent boxes!')
          console.log('✅ BG: Total agent boxes in session:', session.agentBoxes.length)
          try { sendResponse({ success: true }) } catch {}
        })
      });
      });
      
      return true  // Keep message channel open for async response
    }
    
    case 'GET_SESSION_FROM_SQLITE': {
      console.log('📥 BG: GET_SESSION_FROM_SQLITE for key:', msg.sessionKey)
      
      if (!msg.sessionKey) {
        console.error('❌ BG: No sessionKey provided')
        try { sendResponse({ success: false, error: 'No session key' }) } catch (e) {
          console.error('❌ BG: Failed to send error response:', e)
        }
        return true
      }
      
      // Use direct HTTP API call to avoid document access issues (correct format: ?key= not ?keys=)
      fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(msg.sessionKey)}`, { headers: _electronHeaders() })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then((result: any) => {
          const session = result.data || null
          console.log('✅ BG: Loaded session from SQLite via HTTP:', session ? 'Found' : 'Not found')
          try { 
            sendResponse({ 
              success: true, 
              session: session 
            }) 
          } catch (e) {
            console.error('❌ BG: Failed to send response:', e)
          }
        })
        .catch((error: any) => {
          console.error('❌ BG: Error loading session via HTTP:', error)
          // Fallback to Chrome Storage
          chrome.storage.local.get([msg.sessionKey], (result: any) => {
            const session = result[msg.sessionKey] || null
            console.log('⚠️ BG: Fallback to Chrome Storage:', session ? 'Found' : 'Not found')
            try {
              sendResponse({ success: true, session: session })
            } catch (e) {
              console.error('❌ BG: Failed to send fallback response:', e)
            }
          })
        })
      
      return true  // Keep message channel open for async response
    }
    
    case 'SAVE_SESSION_TO_SQLITE': {
      // Save full session data to SQLite (single source of truth)
      const { sessionKey, session } = msg
      
      if (!sessionKey || !session) {
        console.error('❌ BG: Missing sessionKey or session data')
        try { sendResponse({ success: false, error: 'Missing data' }) } catch {}
        return true
      }
      
      // Save to SQLite via HTTP API
      fetch('http://127.0.0.1:51248/api/orchestrator/set', {
        method: 'POST',
        headers: _electronHeaders(),
        body: JSON.stringify({ key: sessionKey, value: session })
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then(() => {
          console.log('✅ BG: Session saved to SQLite:', sessionKey)
          try { sendResponse({ success: true }) } catch {}
        })
        .catch((error: any) => {
          console.error('❌ BG: Error saving session to SQLite:', error)
          try { sendResponse({ success: false, error: String(error) }) } catch {}
        })
      
      return true  // Keep message channel open for async response
    }
    
    case 'GET_ALL_SESSIONS_FROM_SQLITE': {
      console.log('📥 BG: GET_ALL_SESSIONS_FROM_SQLITE')
      
      // Get all session keys from SQLite
      fetch('http://127.0.0.1:51248/api/orchestrator/keys', { headers: _electronHeaders() })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then((result: any) => {
          const sessionKeys = (result.data || []).filter((key: string) => key.startsWith('session_'))
          console.log('✅ BG: Found session keys:', sessionKeys.length)
          
          if (sessionKeys.length === 0) {
            try {
              sendResponse({ success: true, sessions: {} })
            } catch (e) {
              console.error('❌ BG: Failed to send response:', e)
            }
            return
          }
          
          // Fetch all sessions
          const fetchPromises = sessionKeys.map((key: string) => 
            fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(key)}`, { headers: _electronHeaders() })
              .then(r => r.json())
              .then(result => ({ key, data: result.data }))
          )
          
          return Promise.all(fetchPromises)
        })
        .then((sessions) => {
          if (!sessions) return
          const sessionsMap: Record<string, any> = {}
          sessions.forEach(({ key, data }) => {
            if (data) {
              sessionsMap[key] = data
            }
          })
          
          console.log('✅ BG: Loaded all sessions from SQLite:', Object.keys(sessionsMap).length)
          try {
            sendResponse({ success: true, sessions: sessionsMap })
          } catch (e) {
            console.error('❌ BG: Failed to send response:', e)
          }
        })
        .catch((error: any) => {
          console.error('❌ BG: Error loading all sessions from SQLite:', error)
          try {
            sendResponse({ success: false, error: String(error) })
          } catch (e) {
            console.error('❌ BG: Failed to send error response:', e)
          }
        })
      
      return true  // Keep message channel open for async response
    }
    
    case 'SAVE_AGENT_BOX_TO_SQLITE': {
      console.log('📥 BG: SAVE_AGENT_BOX_TO_SQLITE')
      console.log('📦 BG: Agent box:', msg.agentBox)
      console.log('🔑 BG: Session key:', msg.sessionKey)
      
      if (!msg.sessionKey || !msg.agentBox) {
        console.error('❌ BG: Missing sessionKey or agentBox')
        try { sendResponse({ success: false, error: 'Missing required data' }) } catch (e) {
          console.error('❌ BG: Failed to send error response:', e)
        }
        return true
      }
      
      // Use direct HTTP API call to avoid document access issues (correct format: ?key= not ?keys=)
      fetch(`http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(msg.sessionKey)}`, { headers: _electronHeaders() })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          return response.json()
        })
        .then((result: any) => {
          const session = result.data || {}
          
          console.log('📋 BG: Loaded session from SQLite via HTTP:', session ? 'Found' : 'Not found')
          console.log('📊 BG: Session before save:', {
            hasAgentBoxes: !!session.agentBoxes,
            agentBoxesCount: session.agentBoxes?.length || 0,
            hasDisplayGrids: !!session.displayGrids,
            displayGridsCount: session.displayGrids?.length || 0
          })
          
          // Initialize arrays if needed
          if (!session.agentBoxes) session.agentBoxes = []
          if (!session.displayGrids) session.displayGrids = []
          
          // Add or update agent box
          const existingIndex = session.agentBoxes.findIndex(
            (b: any) => b.identifier === msg.agentBox.identifier
          )
          
          if (existingIndex !== -1) {
            session.agentBoxes[existingIndex] = msg.agentBox
            console.log('♻️ BG: Updated existing agent box:', msg.agentBox.identifier)
          } else {
            session.agentBoxes.push(msg.agentBox)
            console.log('🆕 BG: Added new agent box:', msg.agentBox.identifier)
          }
          
          // 🤖 AUTO-CREATE AGENT SHELL (Master Tab + Display Grid)
          if (!session.agents) session.agents = []
          
          const agentNumber = msg.agentBox.agentNumber || 1
          const agentKey = `agent${agentNumber}`
          
          console.log(`[TRACE BG] Checking for existing agent: key="${agentKey}", number=${agentNumber}`)
          console.log(`[TRACE BG] Current agents in session:`, session.agents.map((a: any) => ({ key: a.key, number: a.number, name: a.name })))
          
          const existingAgent = session.agents.find((a: any) => {
            const matches = a.key === agentKey || a.number === agentNumber
            if (matches) {
              console.log(`[TRACE BG] Found existing agent match:`, { key: a.key, number: a.number, name: a.name })
            }
            return matches
          })
          
          if (!existingAgent) {
            const newAgent = {
              key: agentKey,
              name: msg.agentBox.title || `Agent ${String(agentNumber).padStart(2, '0')}`,
              icon: '🤖',
              number: agentNumber,
              kind: 'custom',
              scope: 'session',
              enabled: false,  // ← Start disabled, will be enabled when user configures
              config: {}
            }
            
            session.agents.push(newAgent)
            console.log(`🤖 BG: Auto-created agent shell (disabled) for agent box ${msg.agentBox.identifier}`)
            console.log(`[TRACE BG] New agent added:`, { key: newAgent.key, number: newAgent.number, name: newAgent.name })
          } else {
            console.log(`🤖 BG: Agent shell already exists for ${agentKey}, skipping auto-creation`)
          }
          
          // 🔍 DEBUG: Log the agentBox being saved
          console.log('📦 BG: AgentBox details:', {
            identifier: msg.agentBox.identifier,
            locationId: msg.agentBox.locationId,
            boxNumber: msg.agentBox.boxNumber,
            title: msg.agentBox.title,
            source: msg.agentBox.source
          })
          
          // Update or add grid metadata if provided
          if (msg.gridMetadata) {
            const gridIndex = session.displayGrids.findIndex(
              (g: any) => g.sessionId === msg.gridMetadata.sessionId
            )
            if (gridIndex !== -1) {
              session.displayGrids[gridIndex] = msg.gridMetadata
              console.log('♻️ BG: Updated grid metadata')
            } else {
              session.displayGrids.push(msg.gridMetadata)
              console.log('🆕 BG: Added grid metadata')
            }
          }
          
          console.log('💾 BG: Saving to SQLite with', session.agentBoxes.length, 'agent boxes')
          
          // 🔍 DEBUG: Log all agentBoxes being saved
          session.agentBoxes.forEach((box: any, index: number) => {
            console.log(`  [${index}] ${box.identifier}: locationId=${box.locationId || 'MISSING'}`)
          })
          
          // Save updated session using direct HTTP API (correct format: {key, value})
          return fetch('http://127.0.0.1:51248/api/orchestrator/set', {
            method: 'POST',
            headers: _electronHeaders(),
            body: JSON.stringify({ key: msg.sessionKey, value: session })
          })
        })
        .then(response => {
          if (!response.ok) {
            // Get error details from response
            return response.text().then(errorText => {
              console.error('❌ BG: SQLite HTTP error:', response.status, errorText)
              throw new Error(`HTTP ${response.status}: ${errorText}`)
            })
          }
          return response.json()
        })
        .then((result: any) => {
          console.log('✅ BG: Session saved to SQLite via HTTP!')
          // Get updated session to count boxes
          return fetch(`http://127.0.0.1:51248/api/orchestrator/get?keys=${encodeURIComponent(msg.sessionKey)}`, { headers: _electronHeaders() })
        })
        .then(response => response.json())
        .then((result: any) => {
          const session = result.data?.[msg.sessionKey] || {}
          const totalBoxes = session.agentBoxes?.length || 0
          
          console.log('✅ BG: Session saved to SQLite successfully!')
          console.log('📦 BG: Session now has', totalBoxes, 'agentBoxes')
          
          try { 
            sendResponse({ 
              success: true, 
              totalBoxes: totalBoxes
            }) 
          } catch (e) {
            console.error('❌ BG: Failed to send response:', e)
          }
        })
        .catch((error: any) => {
          console.error('❌ BG: Error saving to SQLite via HTTP:', error)
          console.error('❌ BG: Error details:', error.message)
          console.error('❌ BG: SQLite is the only backend - fix the Electron app!')
          
          try {
            sendResponse({ success: false, error: 'Failed to save to SQLite: ' + String(error) })
          } catch (e) {
            console.error('❌ BG: Failed to send error response:', e)
          }
        })
      
      return true  // Keep message channel open for async response
    }
  }
  
  return true;
});
