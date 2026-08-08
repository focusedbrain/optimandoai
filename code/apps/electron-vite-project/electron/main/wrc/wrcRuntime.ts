/**
 * Process-wide WRC client wiring.
 *
 * Deployment reality in Phase 3: there is no WRC service yet. An unconfigured
 * deployment therefore gets {@link createUnconfiguredWrcTransport}, which
 * refuses every call with `not_configured`. That is the fail-closed default on
 * purpose — an unconfigured registry must be visibly unavailable, never
 * indistinguishable from a registry that answered "no such publisher".
 *
 * Configuration is read once and can be replaced by tests. No substitute trust
 * path exists: without a configured registry there is no resolution, and
 * nothing downstream may present a code as validated.
 */

import { app } from 'electron'
import {
  WrcResolutionClient,
  type WrcResolutionResult,
  type ResolvePublisherOptions,
} from './resolutionClient'
import {
  WrcResolvedRecordStore,
  createFilePersistence,
  defaultResolvedRecordPath,
} from './resolvedRecordStore'
import {
  createUnconfiguredWrcTransport,
  createWrcHttpTransport,
  type WrcTransport,
} from './wrcTransport'

export interface WrcRuntimeConfig {
  /** Registry origin, e.g. `https://wrc.example.com`. Absent ⇒ unconfigured. */
  registryBaseUrl?: string | null
  /** Raw base64url Ed25519 public key of the WRC ingest countersigner. */
  ingestPublicKey?: string | null
}

let _client: WrcResolutionClient | null = null
let _configured = false

function readConfigFromEnvironment(): WrcRuntimeConfig {
  // Env only for now: the settings surface for the registry endpoint arrives
  // with the Phase-4 offer work. Contract-first means no half-built UI.
  return {
    registryBaseUrl: process.env.WRDESK_WRC_REGISTRY_URL ?? null,
    ingestPublicKey: process.env.WRDESK_WRC_INGEST_PUBKEY ?? null,
  }
}

function userDataDir(): string {
  try {
    return app.getPath('userData')
  } catch {
    return process.cwd()
  }
}

/** Build (or rebuild) the process client. Tests call {@link setWrcClientForTests}. */
export function initWrcClient(config?: WrcRuntimeConfig): WrcResolutionClient {
  const cfg = config ?? readConfigFromEnvironment()
  const transport: WrcTransport =
    cfg.registryBaseUrl && cfg.ingestPublicKey
      ? createWrcHttpTransport({ registryBaseUrl: cfg.registryBaseUrl })
      : createUnconfiguredWrcTransport()
  _configured = Boolean(cfg.registryBaseUrl && cfg.ingestPublicKey)
  _client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createFilePersistence(defaultResolvedRecordPath(userDataDir()))),
    ingestPublicKey: cfg.ingestPublicKey ?? '',
  })
  return _client
}

export function getWrcClient(): WrcResolutionClient {
  if (!_client) return initWrcClient()
  return _client
}

export function isWrcConfigured(): boolean {
  if (!_client) initWrcClient()
  return _configured
}

/** Test seam: inject a client built on a contract-faithful double. */
export function setWrcClientForTests(client: WrcResolutionClient | null, configured = true): void {
  _client = client
  _configured = client ? configured : false
}

/**
 * Loopback-RPC entry point for the extension (`wrc.resolvePublisher`).
 * Returns the client's typed result unchanged: the renderer must see the same
 * distinct reason the client produced, not a flattened boolean.
 */
export async function handleWrcResolvePublisher(params: {
  publisherPart?: unknown
  entryId?: unknown
  allowSuspended?: unknown
}): Promise<{ success: true; result: WrcResolutionResult } | { success: false; error: string }> {
  const part = typeof params?.publisherPart === 'string' ? params.publisherPart.trim() : ''
  if (!part) return { success: false, error: 'publisherPart is required' }

  const options: ResolvePublisherOptions = {}
  if (typeof params?.entryId === 'string' && params.entryId.trim()) {
    options.entryId = params.entryId.trim()
  }
  if (params?.allowSuspended === true) options.allowSuspended = true

  try {
    return { success: true, result: await getWrcClient().resolvePublisher(part, options) }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
