/**
 * Sandbox Client — Host-Side Stage 5 Gateway
 * Per A.3.055 Stage 5 and Annex I §I.2 (Normative)
 *
 * The SandboxClient is the ONLY entry point through which the extension
 * renderer (Primary Host Orchestrator) may trigger capsule processing.
 *
 * It manages the lifecycle of a hidden <iframe> pointing to sandbox.html
 * (the Chrome Extension Sandboxed Page), relays SandboxRequests via
 * postMessage, and returns SandboxResponses to callers.
 *
 * The host NEVER decrypts capsule bytes directly — all crypto operations
 * execute inside the sandbox's isolated context.
 *
 * Fail-closed guarantees (host side):
 *   - Sandbox iframe not loaded within `iframeReadyTimeoutMs` → error
 *   - No response within `timeoutMs` → SandboxFailure TIMEOUT
 *   - Response `requestId` mismatch → ignored (potential confused-deputy)
 *   - `iframe.contentWindow` null on response path → SandboxFailure INTERNAL
 *   - Any thrown error in this module → SandboxFailure INTERNAL
 *
 * Usage (in a React component / service):
 *
 *   const client = await SandboxClient.create()
 *   const response = await client.depackage(rawBeapJson, options)
 *   client.dispose()
 *
 *   if (isSandboxSuccess(response)) {
 *     const pkg = response.result
 *     if (pkg.allGatesPassed && pkg.authorizedProcessing.decision === 'AUTHORIZED') {
 *       // Safe to use pkg.capsule
 *     }
 *   }
 */

import {
  type SandboxRequest,
  type SandboxResponse,
  type SandboxDecryptOptions,
  type SandboxSuccess,
  type SandboxFailure,
  SANDBOX_DEPACKAGE_TIMEOUT_MS,
  isMatchingSandboxResponse,
  isSandboxSuccess,
  isSandboxFailure,
  isSandboxAck,
} from './sandboxProtocol'

// Re-export for caller convenience
export { isSandboxSuccess, isSandboxFailure, isSandboxAck }

// =============================================================================
// Constants
// =============================================================================

/** Path to the sandboxed page, relative to the extension root. Lazy to avoid crash in Electron (no chrome.runtime). */
function getSandboxPageUrl(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL('src/beap-messages/sandbox/sandbox.html')
  }
  throw new Error('sandboxClient: chrome.runtime.getURL not available (not in extension context)')
}

/** Time to wait for the sandbox iframe to load and become ready (ms). */
const IFRAME_READY_TIMEOUT_MS = 8_000

/** Attribute set on the managed iframe for identification. */
const SANDBOX_IFRAME_ATTR = 'data-beap-sandbox'

// =============================================================================
// SandboxClient
// =============================================================================

/**
 * Host-side proxy to the BEAP Sandbox Sub-Orchestrator.
 *
 * Lifecycle:
 *   1. `SandboxClient.create()` — injects hidden iframe, waits for load
 *   2. `client.depackage(...)` — sends request, waits for response
 *   3. `client.dispose()` — removes iframe from DOM
 *
 * A single SandboxClient instance handles one depackage call at a time.
 * For concurrent depackaging, create separate instances.
 */
export class SandboxClient {
  private readonly iframe: HTMLIFrameElement
  private readonly messageListener: (ev: MessageEvent) => void

  /** Active pending request map: requestId → resolver. */
  private readonly pending = new Map<
    string,
    {
      resolve: (r: SandboxSuccess | SandboxFailure) => void
      timeoutHandle: ReturnType<typeof setTimeout>
    }
  >()

  private disposed = false

  private constructor(iframe: HTMLIFrameElement) {
    this.iframe = iframe
    this.messageListener = this.handleMessage.bind(this)
    window.addEventListener('message', this.messageListener)
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Create and initialise a SandboxClient.
   *
   * Injects a hidden sandbox iframe into the current document and waits for it
   * to load. Throws if the iframe does not load within `IFRAME_READY_TIMEOUT_MS`.
   *
   * @throws Error if the sandbox page could not be loaded.
   */
  static async create(): Promise<SandboxClient> {
    const iframe = document.createElement('iframe')
    iframe.setAttribute(SANDBOX_IFRAME_ATTR, 'true')
    iframe.src = getSandboxPageUrl()

    // Hide the iframe — it has no visual content.
    iframe.style.cssText = [
      'position:absolute',
      'width:0',
      'height:0',
      'border:0',
      'visibility:hidden',
      'pointer-events:none',
      'top:-9999px',
      'left:-9999px',
    ].join(';')

    document.body.appendChild(iframe)

    // Wait for the iframe to load.
    await waitForIframeLoad(iframe, IFRAME_READY_TIMEOUT_MS)

    return new SandboxClient(iframe)
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Send a raw .beap JSON string into the sandbox for depackaging.
   *
   * Runs the complete canonical pipeline (Stages 0, 2, 4, 6.1–6.3, 7 +
   * Gates 1–6 of Canon §10) inside the sandboxed context and returns
   * a sanitised result. Never returns raw key material.
   *
   * Fail-closed: if the sandbox does not respond within `timeoutMs`, or if
   * any error occurs, returns a `SandboxFailure` — never throws.
   *
   * @param rawBeapJson  - Raw .beap package content (JSON string)
   * @param options      - Serialisable decryption options
   * @param timeoutMs    - Per-request timeout; defaults to SANDBOX_DEPACKAGE_TIMEOUT_MS
   */
  async depackage(
    rawBeapJson: string,
    options: SandboxDecryptOptions = {},
    timeoutMs = SANDBOX_DEPACKAGE_TIMEOUT_MS
  ): Promise<SandboxSuccess | SandboxFailure> {
    if (this.disposed) {
      return this.buildClientFailure('INTERNAL', 'Package verification failed')
    }

    const requestId = generateRequestId()

    return new Promise<SandboxSuccess | SandboxFailure>(resolve => {
      // Register the pending request BEFORE sending, to avoid a race where the
      // sandbox responds before the map entry is inserted.
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(requestId)
        resolve(this.buildClientFailure('TIMEOUT', 'Package verification failed'))
      }, timeoutMs)

      this.pending.set(requestId, { resolve, timeoutHandle })

      // Verify the sandbox window is still alive.
      if (!this.iframe.contentWindow) {
        clearTimeout(timeoutHandle)
        this.pending.delete(requestId)
        resolve(this.buildClientFailure('INTERNAL', 'Package verification failed'))
        return
      }

      const request: SandboxRequest = {
        requestId,
        type: 'DEPACKAGE',
        rawBeapJson,
        options,
        timeoutMs,
      }

      // Post to the sandbox. Using '*' as target origin is correct here:
      // the sandboxed page has a null origin (chrome-extension sandboxed pages
      // have opaque origins). Specifying the extension origin would cause the
      // message to be silently dropped.
      this.iframe.contentWindow.postMessage(request, '*')
    })
  }

  /**
   * Dispose this client and remove the sandbox iframe from the DOM.
   * Any pending requests receive a INTERNAL failure response.
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    window.removeEventListener('message', this.messageListener)

    // Reject all pending requests.
    for (const [requestId, { resolve, timeoutHandle }] of this.pending) {
      clearTimeout(timeoutHandle)
      resolve(this.buildClientFailure('INTERNAL', 'Package verification failed'))
      this.pending.delete(requestId)
    }

    // Remove iframe from DOM.
    if (this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe)
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Message Handling
  // ---------------------------------------------------------------------------

  private handleMessage(event: MessageEvent): void {
    // Only accept messages from our sandbox iframe.
    if (event.source !== this.iframe.contentWindow) return

    const data: unknown = event.data

    // Find which pending request this response belongs to.
    // We iterate the pending map to validate requestId before processing.
    for (const [requestId, { resolve, timeoutHandle }] of this.pending) {
      if (!isMatchingSandboxResponse(data, requestId)) continue

      const response = data as SandboxResponse

      // ACK is informational — do not resolve the promise yet.
      if (response.type === 'ACK') continue

      // Final response: clear timeout, remove from pending, resolve.
      clearTimeout(timeoutHandle)
      this.pending.delete(requestId)

      if (response.type === 'DEPACKAGE_RESULT' || response.type === 'DEPACKAGE_FAILURE') {
        resolve(response)
      }
      break
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Failure Builder
  // ---------------------------------------------------------------------------

  private buildClientFailure(
    stage: SandboxFailure['failureStage'],
    nonDisclosingError: string
  ): SandboxFailure {
    return {
      requestId: 'client-side',
      type: 'DEPACKAGE_FAILURE',
      nonDisclosingError,
      failureStage: stage,
    }
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Wait for an iframe to fire its `load` event.
 * Rejects with an error if the iframe does not load within `timeoutMs`.
 */
function waitForIframeLoad(iframe: HTMLIFrameElement, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false

    const onLoad = () => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      resolve()
    }

    const timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      iframe.removeEventListener('load', onLoad)
      reject(new Error('[BEAP Sandbox] Sandbox iframe did not load within timeout. Stage 5 isolation unavailable.'))
    }, timeoutMs)

    iframe.addEventListener('load', onLoad, { once: true })
  })
}

/**
 * Generate a unique request ID (UUID v4 via WebCrypto).
 */
function generateRequestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// =============================================================================
// Convenience: Single-Shot Depackage
// =============================================================================

/**
 * Convenience function that creates a SandboxClient, performs a single
 * depackage operation, then immediately disposes the client.
 *
 * Preferred for one-off verification calls (e.g. from `verifyImportedMessage`).
 *
 * @param rawBeapJson  - Raw .beap package content
 * @param options      - Serialisable decryption options
 * @param timeoutMs    - Per-request timeout
 */
export async function sandboxDepackage(
  rawBeapJson: string,
  options: SandboxDecryptOptions = {},
  timeoutMs = SANDBOX_DEPACKAGE_TIMEOUT_MS
): Promise<SandboxSuccess | SandboxFailure> {
  let client: SandboxClient | null = null
  try {
    client = await SandboxClient.create()
    return await client.depackage(rawBeapJson, options, timeoutMs)
  } catch (err) {
    // SandboxClient.create() can throw if the iframe fails to load.
    console.error('[BEAP Sandbox] sandboxDepackage error:', err)
    return {
      requestId: 'convenience-api',
      type: 'DEPACKAGE_FAILURE',
      nonDisclosingError: 'Package verification failed',
      failureStage: 'INTERNAL',
    }
  } finally {
    client?.dispose()
  }
}
