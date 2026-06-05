/**
 * RemoteHandshakeExecutor (Build C, spec 0017 §3.2) — replaces the Build A stub.
 *
 * Routes a `CriticalJobSpec` over the internal handshake to a linked node, which
 * re-dispatches it locally (see `remote/receiver.ts`) and returns the signed
 * result. Modeled on the `internal_inference_*` request/result plumbing (host
 * side verified SOUND in 0016).
 *
 *   - supports(kind): from KIND_METADATA key-locality — a `consumer-local` kind
 *     (`decrypt-qbeap`) is NEVER supported (routing it would ship keys, INV-6).
 *   - isAvailable(): true iff a linked entry exists whose handshake is ACTIVE and
 *     whose transport endpoint is reachable. Empty topology → false → the
 *     workstation rows fail closed with E_NO_EXECUTOR exactly as in Build A.
 *   - run(): pick the linked entry for the kind → serialize (re-asserting INV-2)
 *     → send `critical_job_request` with a timeout SUBORDINATE to the dispatcher's
 *     `maxWallClockMs` → on result, verify the depackage signature locally before
 *     returning (the dispatcher `verify.ts` post-path then projects it as for any
 *     executor); on a typed `critical_job_error`, surface the receiver's code
 *     (E_REMOTE_KIND_REFUSED / E_KEY_LOCALITY / …); on link-down, a typed error
 *     the call sites map to quarantine/retry (INV-3/INV-7 — never a local
 *     fallback the table did not declare).
 */

import { randomUUID } from 'crypto'
import type { CriticalJobExecutor } from '../executor'
import {
  CriticalJobError,
  KIND_METADATA,
  type CriticalJobKind,
  type CriticalJobResult,
  type CriticalJobSpec,
} from '../types'
import type { HandshakeRecord } from '../../handshake/types'
import { assertRecordForServiceRpc } from '../../internalInference/policy'
import { depackageResultSignatureValid } from '../verify'
import type { LinkedTopologyEntry } from '../topology'
import { CRITICAL_JOB_SCHEMA_VERSION, type CriticalJobRequestWire } from '../remote/wire'
import { serializeCriticalJobSpec, deserializeCriticalJobResult } from '../remote/serialize'
import {
  httpCriticalJobTransport,
  throwTransportError,
  type CriticalJobTransport,
} from '../remote/send'

export interface RemoteHandshakeExecutorDeps {
  /** Linked-topology entries (from `ResolutionContext.topology.linked`). */
  readonly topology?: readonly LinkedTopologyEntry[]
  /** Resolve the handshake record for a linked entry. */
  readonly getRecord?: (handshakeId: string) => HandshakeRecord | null | undefined | Promise<HandshakeRecord | null | undefined>
  /** This node's coordination/instance id (the request sender). */
  readonly thisDeviceId?: () => string
  /** Transport (HTTP in production; mocked in tests). */
  readonly transport?: CriticalJobTransport
  readonly now?: () => number
}

/** Fraction of the wall-clock budget the transport is allowed, leaving headroom
 *  for the dispatcher's own `runWithTimeout` to win the race on a true hang. */
function subordinateTimeout(maxWallClockMs: number): number {
  return Math.max(1000, Math.min(maxWallClockMs - 500, Math.floor(maxWallClockMs * 0.9)))
}

async function defaultGetRecord(handshakeId: string): Promise<HandshakeRecord | null | undefined> {
  const { getHandshakeDbForInternalInference } = await import('../../internalInference/dbAccess')
  const { getHandshakeRecord } = await import('../../handshake/db')
  const db = await getHandshakeDbForInternalInference()
  if (!db) return null
  return getHandshakeRecord(db as never, handshakeId)
}

function defaultThisDeviceId(): string {
  try {
    // Lazy require to avoid pulling electron into pure-table tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../orchestrator/orchestratorModeStore').getInstanceId()
  } catch {
    return ''
  }
}

function peerCoordinationId(record: HandshakeRecord, thisId: string): string {
  const ini = (record.initiator_coordination_device_id ?? '').trim()
  const acc = (record.acceptor_coordination_device_id ?? '').trim()
  if (ini && ini !== thisId) return ini
  if (acc && acc !== thisId) return acc
  return acc || ini || ''
}

export class RemoteHandshakeExecutor implements CriticalJobExecutor {
  readonly id = 'remote-handshake' as const

  private readonly topology: readonly LinkedTopologyEntry[]
  private readonly getRecord: NonNullable<RemoteHandshakeExecutorDeps['getRecord']>
  private readonly thisDeviceId: () => string
  private readonly transport: CriticalJobTransport
  private readonly now: () => number

  constructor(deps: RemoteHandshakeExecutorDeps = {}) {
    this.topology = deps.topology ?? []
    this.getRecord = deps.getRecord ?? defaultGetRecord
    this.thisDeviceId = deps.thisDeviceId ?? defaultThisDeviceId
    this.transport = deps.transport ?? httpCriticalJobTransport
    this.now = deps.now ?? Date.now
  }

  /** consumer-local kinds (decrypt-qbeap) are never routable (INV-6). */
  supports(kind: CriticalJobKind): boolean {
    const meta = KIND_METADATA[kind]
    return !!meta && meta.keyLocality !== 'consumer-local'
  }

  async isAvailable(): Promise<boolean> {
    if (this.topology.length === 0) return false
    for (const entry of this.topology) {
      try {
        const record = await this.getRecord(entry.handshakeId)
        const gate = assertRecordForServiceRpc(record ?? null)
        if (gate.ok && typeof record?.p2p_endpoint === 'string' && record.p2p_endpoint.trim()) {
          return true
        }
      } catch {
        /* probe failure → treat as unavailable for this entry */
      }
    }
    return false
  }

  async run<K extends CriticalJobKind>(spec: CriticalJobSpec<K>): Promise<CriticalJobResult<K>> {
    const entry = this.topology.find((e) => e.jobKinds.includes(spec.kind))
    if (!entry) {
      throw new CriticalJobError('E_NO_EXECUTOR', `no linked entry routes kind "${spec.kind}"`)
    }

    const record = await this.getRecord(entry.handshakeId)
    const gate = assertRecordForServiceRpc(record ?? null)
    if (!gate.ok) {
      throw new CriticalJobError('E_REMOTE_HANDSHAKE_INACTIVE', `linked handshake gate failed: ${gate.code}`)
    }
    const r = gate.record
    const endpoint = typeof r.p2p_endpoint === 'string' ? r.p2p_endpoint.trim() : ''
    if (!endpoint) {
      throw new CriticalJobError('E_REMOTE_LINK_DOWN', 'linked handshake has no direct endpoint')
    }

    const thisId = this.thisDeviceId()
    const nowMs = this.now()
    const timeoutMs = subordinateTimeout(spec.limits.maxWallClockMs)
    const wire: CriticalJobRequestWire = {
      type: 'critical_job_request',
      schema_version: CRITICAL_JOB_SCHEMA_VERSION,
      request_id: randomUUID(),
      handshake_id: entry.handshakeId,
      sender_device_id: thisId,
      target_device_id: peerCoordinationId(r, thisId),
      created_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + timeoutMs).toISOString(),
      job: serializeCriticalJobSpec(spec), // re-asserts INV-2 (no key material)
    }

    const sent = await this.transport({
      endpoint,
      bearer: typeof r.counterparty_p2p_token === 'string' ? r.counterparty_p2p_token : null,
      wire,
      timeoutMs,
    })
    if (!sent.ok) throwTransportError(sent)

    const body = sent.body
    if (body.request_id !== wire.request_id) {
      throw new CriticalJobError('E_REMOTE_PROTOCOL', 'response request_id mismatch')
    }
    if (body.type === 'critical_job_error') {
      // Surface the receiver's typed refusal (E_REMOTE_KIND_REFUSED / E_KEY_LOCALITY / …).
      throw new CriticalJobError(body.code, body.message)
    }

    const result = deserializeCriticalJobResult(body.result) as CriticalJobResult<K>

    // §3.2/§4: verify the depackage signature locally before returning. A tampered
    // result is rejected by the SENDER (no insert). Safe-text re-validation +
    // projection remain the dispatcher's single authoritative post-path.
    if (spec.kind === 'depackage' && result.ok) {
      if (!depackageResultSignatureValid(result as CriticalJobResult<'depackage'>)) {
        throw new CriticalJobError('E_SIGNATURE_INVALID', 'remote depackage result signature invalid')
      }
    }
    return result
  }
}
