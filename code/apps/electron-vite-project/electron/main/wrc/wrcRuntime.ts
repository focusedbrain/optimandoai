/**
 * Process-wide WRC client wiring — the PRODUCTION COMPOSITION ROOT (Run 5).
 *
 * One dependency graph. Every trust-bearing dependency of the six gates —
 * directory client, generation floors, use-limit store, device registry,
 * relay, claim identity, admission material, replay/idempotency ledgers —
 * is instantiated and owned HERE, once per process. Capture surfaces provide
 * untrusted input and request context only; no caller can hand the runtime a
 * preverified directory state, a canonical designator, an accepted device,
 * a successful release, an admitted capsule, or a replay approval. Those are
 * derived inside this trust boundary or not at all.
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
import { randomBytes } from 'node:crypto'
import { getCachedUserInfo } from '../../../src/auth/sessionCache'
import { captureWrCodeReference, type WrCodeCaptureResult } from '@repo/ingestion-core'
import {
  detectWrCodeReferencesInEmailBody,
  type WrCodeEmailDetection,
} from '../email/wrCodeEmailDetection'
import {
  claimantIdOf,
  runWrCodeGatePipeline,
  type WrCodeGateOutcome,
  type WrCodeReceiverIdentity,
} from './gatePipeline'
import { useLimitEntryKey } from './entryDesignator'
import { createWrcGateDeps, type WrcGateAdapterOptions } from './gatePipelineAdapter'
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
import { createDbEpochFloorStore } from './epochFloorStore'
import {
  createUnconfiguredWrcTransport,
  createWrcHttpTransport,
  type WrcTransport,
} from './wrcTransport'
import { WrcDirectoryClient } from './namespaceDirectory'
import { createDbUseLimitStore, type WrcUseLimitStore } from './useLimitStore'
import {
  createDbDirectoryGenerationFloorStore,
  maintainWrcSecurityDb,
  openWrcSecurityDb,
  type WrcSecurityDb,
} from './wrcSecurityDb'
import { createDbAdmissionReplayStore, type WrcAdmissionReplayStore } from './capsuleAdmission'
import { readRuntimeIdentityFromEnvironment, type WrcRuntimeIdentity } from './wrcIdentity'
import { createDbDeviceRegistry, type WrcDeviceRegistry } from './deviceRegistry'
import { createDbRelay, type WrcRelayClient } from './relayRelease'

export interface WrcRuntimeConfig {
  /** Registry origin, e.g. `https://wrc.example.com`. Absent ⇒ unconfigured. */
  registryBaseUrl?: string | null
  /** Raw base64url Ed25519 public key of the WRC ingest countersigner. */
  ingestPublicKey?: string | null
  /**
   * §XVI.6.4 pinned directory-operator trust anchor (Run 4). Absent ⇒ no
   * namespace directory ⇒ Gate 2 refuses (`directory_not_configured`).
   */
  directoryOperatorKid?: string | null
  directoryOperatorPub?: string | null
}

let _client: WrcResolutionClient | null = null
let _directory: WrcDirectoryClient | null = null
let _configured = false
/**
 * Run 5 — process-lifetime security singletons. The admission replay ledger
 * in particular must NEVER be constructed per submission (a per-call ledger
 * forgets every request id the moment it answered, which is no replay
 * protection at all). Built once by {@link initWrcClient}; durable backing
 * arrives with the security-DB slices.
 */
let _identity: WrcRuntimeIdentity | null = null
let _identityInjected = false
let _admissionReplay: WrcAdmissionReplayStore | null = null
let _admissionReplayInjected = false
/**
 * Device registry and relay: owned by the composition root, both durable on
 * the WRC security DB (Slices 3 and 4). Null (only reachable via test seams)
 * is fail-closed at Gate 4 (device-bound refuses) and Gate 5
 * (public-offering path only) — never permissive.
 */
let _devices: WrcDeviceRegistry | null = null
let _devicesInjected = false
let _relay: WrcRelayClient | null = null
let _relayInjected = false

function cachedSsoEmail(): string | null {
  try {
    return getCachedUserInfo()?.email ?? null
  } catch {
    return null
  }
}

function readConfigFromEnvironment(): WrcRuntimeConfig {
  // Env only for now: the settings surface for the registry endpoint arrives
  // with the Phase-4 offer work. Contract-first means no half-built UI.
  return {
    registryBaseUrl: process.env.WRDESK_WRC_REGISTRY_URL ?? null,
    ingestPublicKey: process.env.WRDESK_WRC_INGEST_PUBKEY ?? null,
    directoryOperatorKid: process.env.WRDESK_WRC_DIRECTORY_OPERATOR_KID ?? null,
    directoryOperatorPub: process.env.WRDESK_WRC_DIRECTORY_OPERATOR_PUBKEY ?? null,
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
 * Run 5 — the WRC security DB is THE durable substrate for trust floors,
 * one-time-use state, and (from the later slices) device, relay-replay, and
 * admission-idempotency state. There is NO in-memory production fallback:
 * `openWrcSecurityDb` throws when persistence is unavailable, and everything
 * downstream fails closed with a visible error. The Slice-0 inventory
 * documents why the previous handshake-ledger discovery could never find the
 * v77/v78 tables in production (frozen handle) and silently degraded to
 * memory — that path is deliberately gone.
 */
let _securityDb: WrcSecurityDb | null = null

function resolveSecurityDb(): WrcSecurityDb {
  if (_securityDb) return _securityDb
  _securityDb = openWrcSecurityDb()
  // Slice 13 — bounded lazy maintenance, once per process at first use. Only
  // prunes rows past their security relevance (see maintainWrcSecurityDb);
  // a maintenance failure never blocks resolution — pruning less is safe,
  // pruning wrong would not be.
  try {
    maintainWrcSecurityDb(_securityDb)
  } catch (e) {
    console.warn('[WRC] security-DB maintenance skipped:', e instanceof Error ? e.message : e)
  }
  return _securityDb
}

/** Test seam: inject a security DB handle (null restores the default path). */
export function setWrcSecurityDbForTests(db: WrcSecurityDb | null): void {
  _securityDb = db
  _useLimits = null
}

/**
 * §XVI.8.4 one-time-use state — durable, CAS-by-statement, no fallback:
 * a missing DB is a thrown error, never an empty memory store.
 */
let _useLimits: WrcUseLimitStore | null = null

async function resolveUseLimitStore(): Promise<WrcUseLimitStore> {
  if (_useLimits) return _useLimits
  _useLimits = createDbUseLimitStore(resolveSecurityDb())
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
  // Run 5 — durable trust state, fail-closed: a security DB that cannot open
  // throws HERE, and the runtime is visibly unavailable. No memory fallback.
  const securityDb = resolveSecurityDb()
  _client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(
      createFilePersistence(defaultResolvedRecordPath(userDataDir())),
      createDbEpochFloorStore(securityDb),
    ),
    ingestPublicKey: cfg.ingestPublicKey ?? '',
  })
  // Run 4 (§XVI.6.4): the Gate-2 trust path exists only when the operator
  // anchor is pinned. No anchor ⇒ no directory client ⇒ Gate 2 fails closed.
  // Run 5: the generation floor is the durable security-DB store, so a
  // restart can never lower the accepted-record floor.
  _directory =
    cfg.directoryOperatorKid && cfg.directoryOperatorPub
      ? new WrcDirectoryClient({
          transport,
          operator: { kid: cfg.directoryOperatorKid, pub: cfg.directoryOperatorPub },
          generationFloors: createDbDirectoryGenerationFloorStore(securityDb),
        })
      : null

  // Run 5 — the identity is resolved from the sanctioned sources (SSO session
  // + deployment config), never from a caller. A test-injected identity is
  // left in place: tests own the seam, callers own nothing.
  if (!_identityInjected) _identity = readRuntimeIdentityFromEnvironment(cachedSsoEmail())

  // Run 5 Slice 3 — the device registry is the durable security-DB store:
  // Device Records, counterpart passes, and revocations survive restart.
  if (!_devicesInjected) _devices = createDbDeviceRegistry(securityDb)

  // Run 5 Slices 4+5 — Gate-5 relay custody/replay and Gate-6 request-id
  // idempotency on the same durable substrate: a used claim or admitted
  // request id stays used across restart. The relay verifies delegations
  // against DIRECTORY state (§XVI.6.5), through the same verified-record path
  // Gate 2 uses — never against caller-carried keys.
  if (!_relayInjected) {
    _relay = createDbRelay(securityDb, {
      directoryKeys: async (publisherPart) => {
        if (!_directory) return null
        const lookup = await _directory.getVerifiedRecord(publisherPart)
        return lookup.ok ? lookup.record.keys : null
      },
    })
  }
  if (!_admissionReplayInjected) _admissionReplay = createDbAdmissionReplayStore(securityDb)
  return _client
}

/**
 * Run 5 — the ONE production dependency graph. Every store here is a
 * process-lifetime singleton; the option OBJECT is assembled per submission
 * (cheap), but the security state behind it never is. The admission replay
 * ledger in particular must not be constructed per submission — a per-call
 * ledger forgets every request id the moment it answered.
 */
async function currentGateOptions(): Promise<WrcGateAdapterOptions> {
  // Durable, fail-closed: no security DB ⇒ resolveSecurityDb throws ⇒ the
  // submission errors visibly. Never an empty memory ledger in production.
  _admissionReplay = _admissionReplay ?? createDbAdmissionReplayStore(resolveSecurityDb())
  return {
    useLimits: await resolveUseLimitStore(),
    directory: _directory ?? undefined,
    devices: _devices ?? undefined,
    relay: _relay ?? undefined,
    claimIdentity: _identity?.claimIdentity ?? undefined,
    admission: {
      decryptKey: _identity?.decryptKey ?? null,
      replay: _admissionReplay,
    },
  }
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

/** Test seam: inject a directory client (null restores the env-configured one). */
export function setWrcDirectoryForTests(directory: WrcDirectoryClient | null): void {
  _directory = directory
}

/**
 * Test seam: inject the FULL runtime identity (null restores the sanctioned
 * environment/session source). This is the only way to control who the
 * receiver is — deliberately not reachable through any RPC parameter.
 */
export function setWrcIdentityForTests(identity: WrcRuntimeIdentity | null): void {
  _identity = identity
  _identityInjected = identity !== null
}

/** Test seam: inject the admission replay ledger (null restores discovery). */
export function setWrcAdmissionReplayForTests(store: WrcAdmissionReplayStore | null): void {
  _admissionReplay = store
  _admissionReplayInjected = store !== null
}

/** Test seam: inject the device registry (null restores the production one). */
export function setWrcDevicesForTests(devices: WrcDeviceRegistry | null): void {
  _devices = devices
  _devicesInjected = devices !== null
}

/** Test seam: inject the relay client (null restores the production one). */
export function setWrcRelayForTests(relay: WrcRelayClient | null): void {
  _relay = relay
  _relayInjected = relay !== null
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
 * Loopback-RPC entry point (`wrc.detectReferences`) — the explicit user
 * trigger for scanning free text, e.g. "find WR codes in this message".
 * Annex XVI §XVI.3/§XVI.7.4a: loose textual references are never
 * auto-detected; they are captured only on the user's request. Local and
 * pure like `wrc.captureReference`: no network, no store; every candidate is
 * check-verified and still has to be submitted explicitly.
 */
export function handleWrcDetectReferences(params: {
  text?: unknown
}): { success: true; result: WrCodeEmailDetection[] } | { success: false; error: string } {
  if (typeof params?.text !== 'string') return { success: false, error: 'text is required' }
  return { success: true, result: detectWrCodeReferencesInEmailBody(params.text) }
}

/**
 * Submission — the ONE resolution path (`wrc.submitReference`). Runs the six
 * ordered gates of §XVI.7.6 end to end: syntax (the Run-1 grammar module),
 * namespace, entry, self-match, relay-release, capsule-admission. Every
 * capture surface (manual entry, e-mail detection, clipboard/selection) exits
 * into this call when the user's explicit submission act occurs; nothing may
 * present a reference as resolvable without the admission returned here, and
 * no caller can reorder or skip a gate — the pipeline owns the order.
 *
 * Run 5 structural rule: the caller provides the RAW REFERENCE and a request
 * instance id — nothing else. Receiver identity (party, publisher, current
 * device, SSO email) is the RUNTIME's, from the sanctioned identity source.
 * A caller-supplied `receiver` object is ignored: accepting it would let any
 * capture surface declare itself `trusted-device-X` and walk through Gate 4.
 */
export async function handleWrcSubmitReference(params: {
  raw?: unknown
  requestInstanceId?: unknown
}): Promise<
  | { success: true; result: WrCodeGateOutcome; acceptanceToken?: string }
  | { success: false; error: string }
> {
  if (typeof params?.raw !== 'string' || !params.raw.trim()) {
    return { success: false, error: 'raw is required' }
  }
  try {
    const client = await getWrcClient()
    const receiver: WrCodeReceiverIdentity = { ..._identity?.receiver }
    if (!_identityInjected) {
      // The SSO session may have appeared or changed since init — the
      // identity stays live against the session, never cached beyond it.
      const email = cachedSsoEmail()
      if (email) receiver.sso_email = email
    }
    const requestInstanceId =
      typeof params?.requestInstanceId === 'string' ? params.requestInstanceId : null
    const outcome = await runWrCodeGatePipeline(
      { raw: params.raw, receiver, requestInstanceId },
      createWrcGateDeps(client, await currentGateOptions()),
    )
    if (!outcome.ok) return { success: true, result: outcome }
    // Run 5 Slice 9 — mint the acceptance binding INSIDE the trust boundary:
    // the token is the only path to consumption, and it references what THIS
    // admission established (entry, claimant, request, capsule), never what a
    // later caller asserts.
    const acceptanceToken = mintAcceptance(outcome, receiver, requestInstanceId)
    return { success: true, result: outcome, acceptanceToken }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Explicit acceptance (Run 5, Slice 9) ─────────────────────────────────────
//
// Run 4 established: ADMISSION does not consume; EXPLICIT ACCEPTANCE consumes
// once (§XVI.8.4 consume_at = acceptance). The runtime boundary between the
// two is this token protocol:
//
//  - a successful `wrc.submitReference` mints an opaque, unguessable token
//    bound to the admission's canonical entry key, claimant identity, request
//    instance id, and admitted capsule id;
//  - `wrc.acceptReference` is the ONLY consumption surface, and it accepts
//    nothing but such a token — a caller can never name an arbitrary entry
//    and mark it consumed;
//  - consumption itself is the Run-2 durable CAS (`WrcUseLimitStore.consume`),
//    conditional on the claimant still holding the §XVI.8.4 claim — so a
//    forged or stale acceptance cannot take a use, racing acceptances have
//    exactly one winner decided in the DB statement, and a crash AFTER the
//    CAS leaves the use durably taken (restart does not restore it) while a
//    crash BEFORE it leaves the claim to its normal timeout release.
//
// The pending map is deliberately process-memory: it holds no security
// authority (the durable use state does), and losing it on crash simply means
// the admission was never accepted — the claim times out, §XVI.8.4 intact.

interface WrcPendingAcceptance {
  publisherPart: string
  entryKey: string
  claimant: string | null
  requestInstanceId: string | null
  capsuleId: string | null
  mintedAtMs: number
}

/**
 * Conservative operational default (the Annex leaves the acceptance window
 * unspecified): tokens outlive the default §XVI.8.4 claim timeout slightly,
 * configurable via `WRDESK_WRC_ACCEPTANCE_TOKEN_TTL_S`.
 */
const ACCEPTANCE_TOKEN_TTL_S = (() => {
  const env = Number(process.env.WRDESK_WRC_ACCEPTANCE_TOKEN_TTL_S)
  return Number.isFinite(env) && env > 0 ? env : 900
})()
const ACCEPTANCE_MAX_PENDING = 1000

const _pendingAcceptances = new Map<string, WrcPendingAcceptance>()

function prunePendingAcceptances(nowMs: number): void {
  for (const [token, p] of _pendingAcceptances) {
    if (nowMs - p.mintedAtMs > ACCEPTANCE_TOKEN_TTL_S * 1000) _pendingAcceptances.delete(token)
  }
  // Bounded regardless of clock behavior: drop oldest beyond the cap.
  while (_pendingAcceptances.size > ACCEPTANCE_MAX_PENDING) {
    const oldest = _pendingAcceptances.keys().next().value
    if (oldest === undefined) break
    _pendingAcceptances.delete(oldest)
  }
}

function mintAcceptance(
  outcome: Extract<WrCodeGateOutcome, { ok: true }>,
  receiver: WrCodeReceiverIdentity,
  requestInstanceId: string | null,
): string {
  const nowMs = Date.now()
  prunePendingAcceptances(nowMs)
  const token = randomBytes(24).toString('base64url')
  const capsule = outcome.released.capsule as { capsule_id?: unknown } | null
  _pendingAcceptances.set(token, {
    publisherPart: outcome.designator.publisher_part,
    entryKey: useLimitEntryKey(outcome.designator),
    claimant: claimantIdOf(receiver),
    requestInstanceId,
    capsuleId: typeof capsule?.capsule_id === 'string' ? capsule.capsule_id : null,
    mintedAtMs: nowMs,
  })
  return token
}

export interface WrcAcceptanceResult {
  accepted: true
  /** True when a §XVI.8.4 use was durably taken; false = no declared limit. */
  consumed: boolean
  usesTaken?: number
  capsuleId: string | null
}

/**
 * `wrc.acceptReference` — THE consumption boundary (§XVI.8.4 consume_at =
 * acceptance). Single-shot per token: the token leaves the pending map before
 * the durable CAS runs (run-to-completion makes that atomic against racing
 * calls), and is restored only if the store THREW (infrastructure failure,
 * not a protocol refusal — a refused acceptance is spent).
 */
export async function handleWrcAcceptReference(params: {
  acceptanceToken?: unknown
}): Promise<{ success: true; result: WrcAcceptanceResult } | { success: false; error: string }> {
  const token = typeof params?.acceptanceToken === 'string' ? params.acceptanceToken : ''
  if (!token) return { success: false, error: 'acceptanceToken is required' }
  prunePendingAcceptances(Date.now())
  const pending = _pendingAcceptances.get(token)
  if (!pending) {
    // Unknown, expired, or already spent — deliberately one indistinct answer.
    return { success: false, error: 'acceptance_unknown' }
  }
  _pendingAcceptances.delete(token)
  try {
    const useLimits = await resolveUseLimitStore()
    const nowS = Math.floor(Date.now() / 1000)
    const row = useLimits.read(pending.publisherPart, pending.entryKey)
    if (!row) {
      // No declared §XVI.8.4 profile: acceptance succeeds, nothing to consume.
      return {
        success: true,
        result: { accepted: true, consumed: false, capsuleId: pending.capsuleId },
      }
    }
    if (!pending.claimant) {
      return { success: false, error: 'acceptance_refused: no claimant identity' }
    }
    const consumed = useLimits.consume(
      pending.publisherPart,
      pending.entryKey,
      pending.claimant,
      pending.requestInstanceId,
      nowS,
    )
    if (!consumed.ok) {
      // Protocol refusal (lost claim, consumed elsewhere, exhausted): the
      // token is spent — a failed acceptance never consumes, and retrying
      // with the same token cannot become a second chance at the state.
      return { success: false, error: `acceptance_refused: ${consumed.reason}` }
    }
    return {
      success: true,
      result: {
        accepted: true,
        consumed: true,
        usesTaken: consumed.usesTaken,
        capsuleId: pending.capsuleId,
      },
    }
  } catch (e) {
    // Infrastructure failure (DB unavailable): fail closed, but the decision
    // was never made — restore the token so a recovered store can decide.
    _pendingAcceptances.set(token, pending)
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Test seam: drop all pending acceptances (models a process restart). */
export function clearWrcPendingAcceptancesForTests(): void {
  _pendingAcceptances.clear()
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
