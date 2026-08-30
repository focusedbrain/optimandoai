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
import { captureWrCodeReference, type WrCodeCaptureResult } from '@repo/ingestion-core'
import {
  runWrCodeGatePipeline,
  type WrCodeGateOutcome,
  type WrCodeReceiverIdentity,
} from './gatePipeline'
import { createWrcGateDeps } from './gatePipelineAdapter'
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
import {
  createDbUseLimitStore,
  createMemoryUseLimitStore,
  useLimitTablePresent,
  type UseLimitDb,
  type WrcUseLimitStore,
} from './useLimitStore'

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

/**
 * §XVI.8.4 one-time-use state — native-DB protection class, like the epoch
 * floor: claim/consume state must survive a deleted cache file. The in-process
 * fallback is fail-closed in the same sense as the memory floor: it starts
 * with no declarations (unbounded default), and a claim taken in this process
 * still races atomically within it.
 */
let _useLimits: WrcUseLimitStore | null = null

async function resolveUseLimitStore(): Promise<WrcUseLimitStore> {
  if (_useLimits) return _useLimits
  try {
    const { getHandshakeDbForInternalInference } = await import('../internalInference/dbAccess')
    const db = (await getHandshakeDbForInternalInference()) as UseLimitDb | null
    if (db && useLimitTablePresent(db)) {
      _useLimits = createDbUseLimitStore(db)
      return _useLimits
    }
    if (db) {
      console.warn(
        '[WRC] wrc_entry_use_state missing — using an in-process use-limit store. ' +
          'One-time-use state is not durable until migrations run.',
      )
    }
  } catch (e) {
    console.warn('[WRC] use-limit store unavailable:', e instanceof Error ? e.message : e)
  }
  _useLimits = createMemoryUseLimitStore()
  return _useLimits
}

/** Test seam: inject a use-limit store (null restores discovery). */
export function setWrcUseLimitStoreForTests(store: WrcUseLimitStore | null): void {
  _useLimits = store
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
 * Loopback-RPC entry point for the extension (`wrc.captureReference`) — the
 * manual-entry path of §XVI.5.8/§XVI.5.9. Runs the grammar-v2 capture gate
 * (all classes, prefix-aware, fail-closed reason codes) with NO network
 * effect: completeness and the local check are decided here; submission is
 * the caller's separate, explicit `wrc.submitReference` call afterwards.
 * A check failure is a capture error the field can show for character-level
 * correction — nothing was looked up anywhere.
 */
export function handleWrcCaptureReference(params: {
  raw?: unknown
}): { success: true; result: WrCodeCaptureResult } | { success: false; error: string } {
  if (typeof params?.raw !== 'string') return { success: false, error: 'raw is required' }
  return { success: true, result: captureWrCodeReference(params.raw) }
}

/**
 * Submission — the ONE resolution path (`wrc.submitReference`). Runs the six
 * ordered gates of §XVI.7.6 end to end: syntax (the Run-1 grammar module),
 * namespace, entry, self-match, relay-release, capsule-admission. Every
 * capture surface (manual entry, e-mail detection, clipboard/selection) exits
 * into this call when the user's explicit submission act occurs; nothing may
 * present a reference as resolvable without the admission returned here, and
 * no caller can reorder or skip a gate — the pipeline owns the order.
 */
export async function handleWrcSubmitReference(params: {
  raw?: unknown
  receiver?: unknown
  requestInstanceId?: unknown
}): Promise<{ success: true; result: WrCodeGateOutcome } | { success: false; error: string }> {
  if (typeof params?.raw !== 'string' || !params.raw.trim()) {
    return { success: false, error: 'raw is required' }
  }
  const receiver: WrCodeReceiverIdentity = {}
  if (params?.receiver && typeof params.receiver === 'object') {
    const r = params.receiver as Record<string, unknown>
    if (typeof r.publisher_part === 'string') receiver.publisher_part = r.publisher_part
    if (typeof r.party_id === 'string') receiver.party_id = r.party_id
    if (typeof r.device_party_id === 'string') receiver.device_party_id = r.device_party_id
  }
  try {
    const client = await getWrcClient()
    const outcome = await runWrCodeGatePipeline(
      {
        raw: params.raw,
        receiver,
        requestInstanceId:
          typeof params?.requestInstanceId === 'string' ? params.requestInstanceId : null,
      },
      createWrcGateDeps(client, { useLimits: await resolveUseLimitStore() }),
    )
    return { success: true, result: outcome }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Loopback-RPC entry point for the extension (`wrc.resolvePublisher`).
 * Returns the client's typed result unchanged: the renderer must see the same
 * distinct reason the client produced, not a flattened boolean.
 *
 * Run 2 demotion: this is the STATUS / AUDIT surface (and the substrate the
 * gate adapter composes). It is not a resolution-to-offer path — submission
 * goes through `wrc.submitReference` and the §XVI.7.6 pipeline above, which
 * no caller may bypass.
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
