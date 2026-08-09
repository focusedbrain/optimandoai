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
  createDbEpochFloorStore,
  createMemoryEpochFloorStore,
  epochFloorTablePresent,
  type EpochFloorDb,
  type WrcEpochFloorStore,
} from './epochFloorStore'
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

/**
 * The anti-rollback floor lives in the native DB, never in the cache file.
 *
 * When the DB is unavailable we fall back to an in-process floor. That is
 * strictly SAFER than the state this replaces: it starts empty for this
 * process, but it cannot be lowered and it is never written anywhere a file
 * deletion could reset. It is not a substitute for the real store — resolution
 * simply has no accepted history to compare against until the DB is up.
 */
async function resolveEpochFloorStore(): Promise<WrcEpochFloorStore> {
  try {
    const { getHandshakeDbForInternalInference } = await import('../internalInference/dbAccess')
    const db = (await getHandshakeDbForInternalInference()) as EpochFloorDb | null
    if (db && epochFloorTablePresent(db)) return createDbEpochFloorStore(db)
    if (db) {
      console.warn(
        '[WRC] wrc_publisher_epoch_floor missing — using an in-process floor. ' +
          'Accepted-epoch history is unavailable until migrations run.',
      )
    }
  } catch (e) {
    console.warn('[WRC] epoch floor store unavailable:', e instanceof Error ? e.message : e)
  }
  return createMemoryEpochFloorStore()
}

/** Build (or rebuild) the process client. Tests call {@link setWrcClientForTests}. */
export async function initWrcClient(config?: WrcRuntimeConfig): Promise<WrcResolutionClient> {
  const cfg = config ?? readConfigFromEnvironment()
  const transport: WrcTransport =
    cfg.registryBaseUrl && cfg.ingestPublicKey
      ? createWrcHttpTransport({ registryBaseUrl: cfg.registryBaseUrl })
      : createUnconfiguredWrcTransport()
  _configured = Boolean(cfg.registryBaseUrl && cfg.ingestPublicKey)
  _client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(
      createFilePersistence(defaultResolvedRecordPath(userDataDir())),
      await resolveEpochFloorStore(),
    ),
    ingestPublicKey: cfg.ingestPublicKey ?? '',
  })
  return _client
}

export async function getWrcClient(): Promise<WrcResolutionClient> {
  if (!_client) return initWrcClient()
  return _client
}

export async function isWrcConfigured(): Promise<boolean> {
  if (!_client) await initWrcClient()
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
    const client = await getWrcClient()
    return { success: true, result: await client.resolvePublisher(part, options) }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}
