// ============================================================================
// WRVault — Typed Electron RPC Layer
// ============================================================================
//
// Replaces the generic ELECTRON_API_PROXY with a strict, typed message
// passing system between extension pages and the background script.
//
// Security properties:
//   - No dynamic endpoint construction — every RPC method maps to exactly
//     one hardcoded URL.
//   - No arbitrary HTTP method — GET / POST / DELETE are fixed per method.
//   - No passthrough of caller-supplied headers.
//   - Payload validated with Zod schemas before dispatch.
//   - Sender validated: only messages from the same extension ID are accepted.
//   - Background script is the only process that holds the launch secret;
//     extension pages never see it.
//
// ============================================================================

import { z } from 'zod'

// ============================================================================
// §1  RPC Method Registry
// ============================================================================
//
// Each entry defines:
//   method  — stable string identifier (sent as msg.method)
//   schema  — Zod schema for the payload (or z.void() for no payload)
//   route   — the Electron HTTP endpoint (hardcoded, no interpolation)
//   http    — the HTTP method (GET, POST, DELETE)
//   build   — optional function to build the URL from validated params
//             (for routes with path params like /models/:id)
//
// ============================================================================

// ── Database (BackendConfigLightbox) ──

const DbTestConnection = {
  method: 'db.testConnection' as const,
  schema: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    database: z.string(),
    user: z.string(),
    password: z.string().optional(),
    ssl: z.boolean().optional(),
  }),
  http: 'POST' as const,
  route: '/api/db/test-connection',
}

const DbTestDataStats = {
  method: 'db.testDataStats' as const,
  schema: z.void(),
  http: 'GET' as const,
  route: '/api/db/test-data-stats',
}

const DbInsertTestData = {
  method: 'db.insertTestData' as const,
  schema: z.object({
    postgresConfig: z.object({
      host: z.string(),
      port: z.number().int().positive(),
      database: z.string(),
      user: z.string(),
      password: z.string().optional(),
      ssl: z.boolean().optional(),
    }),
  }),
  http: 'POST' as const,
  route: '/api/db/insert-test-data',
}

const DbLaunchDbeaver = {
  method: 'db.launchDbeaver' as const,
  schema: z.object({
    postgresConfig: z.object({
      host: z.string(),
      port: z.number().int().positive(),
      database: z.string(),
      user: z.string(),
      password: z.string().optional(),
      ssl: z.boolean().optional(),
    }),
  }),
  http: 'POST' as const,
  route: '/api/db/launch-dbeaver',
}

// ── LLM (LlmSettings) ──

const LlmHardware = {
  method: 'llm.hardware' as const,
  schema: z.void(),
  http: 'GET' as const,
  route: '/api/llm/hardware',
}

const LlmStatus = {
  method: 'llm.status' as const,
  schema: z.void(),
  http: 'GET' as const,
  route: '/api/llm/status',
}

const LlmCatalog = {
  method: 'llm.catalog' as const,
  schema: z.void(),
  http: 'GET' as const,
  route: '/api/llm/catalog',
}

const LlmStart = {
  method: 'llm.start' as const,
  schema: z.void(),
  http: 'POST' as const,
  route: '/api/llm/start',
}

const LlmInstallModel = {
  method: 'llm.installModel' as const,
  schema: z.object({ modelId: z.string().min(1).max(200) }),
  http: 'POST' as const,
  route: '/api/llm/models/install',
}

const LlmDeleteModel = {
  method: 'llm.deleteModel' as const,
  schema: z.object({ modelId: z.string().min(1).max(200) }),
  http: 'DELETE' as const,
  build: (p: { modelId: string }) => `/api/llm/models/${encodeURIComponent(p.modelId)}`,
}

const LlmActivateModel = {
  method: 'llm.activateModel' as const,
  schema: z.object({ modelId: z.string().min(1).max(200) }),
  http: 'POST' as const,
  route: '/api/llm/models/activate',
}

const LlmPerformance = {
  method: 'llm.performance' as const,
  schema: z.object({ modelId: z.string().min(1).max(200) }),
  http: 'GET' as const,
  build: (p: { modelId: string }) => `/api/llm/performance/${encodeURIComponent(p.modelId)}`,
}

const LlmInstallProgress = {
  method: 'llm.installProgress' as const,
  schema: z.void(),
  http: 'GET' as const,
  route: '/api/llm/install-progress',
}

// ── Dashboard ──

const DashboardOpen = {
  method: 'dashboard.open' as const,
  schema: z.void(),
  http: 'POST' as const,
  route: '/api/dashboard/open',
}

const DashboardStatus = {
  method: 'dashboard.status' as const,
  schema: z.void(),
  http: 'GET' as const,
  route: '/api/dashboard/status',
}

// ============================================================================
// §2  Full Registry + Type Extraction
// ============================================================================

const RPC_REGISTRY = [
  DbTestConnection,
  DbTestDataStats,
  DbInsertTestData,
  DbLaunchDbeaver,
  LlmHardware,
  LlmStatus,
  LlmCatalog,
  LlmStart,
  LlmInstallModel,
  LlmDeleteModel,
  LlmActivateModel,
  LlmPerformance,
  LlmInstallProgress,
  DashboardOpen,
  DashboardStatus,
] as const

type RpcDef = (typeof RPC_REGISTRY)[number]
export type RpcMethod = RpcDef['method']

/** Build a lookup map: method → definition.  Used by the background handler. */
const REGISTRY_MAP = new Map<string, RpcDef>(
  RPC_REGISTRY.map(d => [d.method, d])
)

// ============================================================================
// §3  Message Types (wire format)
// ============================================================================

/** Message sent from extension page → background script. */
export interface ElectronRpcRequest {
  type: 'ELECTRON_RPC'
  method: RpcMethod
  params?: unknown
  timeout?: number
}

/** Response from background script → extension page. */
export interface ElectronRpcResponse {
  success: boolean
  status?: number
  data?: unknown
  error?: string
}

// ============================================================================
// §4  Background Handler (called from chrome.runtime.onMessage)
// ============================================================================

/**
 * Handle an incoming ELECTRON_RPC message in the background script.
 *
 * Security checks (in order):
 *   1. Sender must be this extension (sender.id === chrome.runtime.id)
 *   2. Method must exist in the registry (no arbitrary strings)
 *   3. Payload must pass the Zod schema for that method
 *   4. URL is built from hardcoded route, not from caller input
 *   5. Launch secret injected by this function, never exposed to caller
 *
 * @returns true if the message was handled (keeps channel open for async)
 */
export function handleElectronRpc(
  msg: ElectronRpcRequest,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: ElectronRpcResponse) => void,
  launchSecret: string | null,
  electronBaseUrl: string,
): boolean {
  // ── Gate 1: Sender validation ──
  if (sender.id !== chrome.runtime.id) {
    console.warn(`[RPC] Rejected: sender.id=${sender.id} !== ${chrome.runtime.id}`)
    sendResponse({ success: false, error: 'Forbidden: sender not trusted' })
    return true
  }

  // ── Gate 2: Method lookup ──
  const def = REGISTRY_MAP.get(msg.method)
  if (!def) {
    console.warn(`[RPC] Rejected: unknown method "${msg.method}"`)
    sendResponse({ success: false, error: `Unknown RPC method: ${msg.method}` })
    return true
  }

  // ── Gate 3: Schema validation ──
  let validatedParams: unknown = undefined
  if ('parse' in def.schema && def.schema !== z.void()) {
    const result = (def.schema as z.ZodType).safeParse(msg.params)
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
      console.warn(`[RPC] Rejected: schema validation failed for "${msg.method}": ${issues}`)
      sendResponse({ success: false, error: `Invalid params: ${issues}` })
      return true
    }
    validatedParams = result.data
  }

  // ── Dispatch (async) ──
  ;(async () => {
    try {
      // Build URL from hardcoded route or build function — NEVER from caller input
      let url: string
      if ('build' in def && typeof def.build === 'function') {
        url = `${electronBaseUrl}${(def.build as (p: any) => string)(validatedParams)}`
      } else if ('route' in def) {
        url = `${electronBaseUrl}${(def as { route: string }).route}`
      } else {
        sendResponse({ success: false, error: 'Internal: no route defined' })
        return
      }

      // Build headers — launch secret injected here, never exposed to caller
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (launchSecret) {
        headers['X-Launch-Secret'] = launchSecret
      }

      const fetchOptions: RequestInit = {
        method: def.http,
        headers,
        signal: AbortSignal.timeout(msg.timeout ?? 15000),
      }

      // Attach body for POST/PUT/PATCH (from validated params, not raw input)
      if (def.http !== 'GET' && def.http !== 'DELETE' && validatedParams !== undefined) {
        fetchOptions.body = JSON.stringify(validatedParams)
      }
      // DELETE with body (e.g., llm.deleteModel has no body — path param only)
      // POST with body from validated params
      if (def.http === 'POST' && validatedParams !== undefined) {
        fetchOptions.body = JSON.stringify(validatedParams)
      }

      const response = await fetch(url, fetchOptions)
      const text = await response.text()
      let data: unknown
      try { data = JSON.parse(text) } catch { data = text }

      sendResponse({
        success: response.ok,
        status: response.status,
        data,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      })
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e)
      console.error(`[RPC] Error in "${msg.method}":`, error)
      sendResponse({ success: false, error })
    }
  })()

  return true // Keep channel open for async response
}

// ============================================================================
// §5  Client Helper (used by extension pages)
// ============================================================================

/**
 * Call an Electron RPC method from an extension page.
 *
 * This replaces the old `electronApiCall()` function.  The endpoint is
 * specified by method name, not by URL string.  The background script
 * resolves the method to a hardcoded URL.
 *
 * @example
 *   const result = await electronRpc('db.testConnection', { host: 'localhost', port: 5432, ... })
 *   const stats = await electronRpc('db.testDataStats')
 */
export async function electronRpc<M extends RpcMethod>(
  method: M,
  params?: unknown,
  timeout?: number,
): Promise<ElectronRpcResponse> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return { success: false, error: 'Chrome runtime not available' }
  }

  return new Promise<ElectronRpcResponse>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ success: false, error: 'RPC timeout' })
    }, (timeout ?? 15000) + 2000)

    chrome.runtime.sendMessage(
      {
        type: 'ELECTRON_RPC',
        method,
        params,
        timeout,
      } satisfies ElectronRpcRequest,
      (result: ElectronRpcResponse | undefined) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message })
        } else if (result) {
          resolve(result)
        } else {
          resolve({ success: false, error: 'Empty response from background' })
        }
      },
    )
  })
}
