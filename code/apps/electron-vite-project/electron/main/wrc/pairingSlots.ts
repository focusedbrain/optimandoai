/**
 * §XVI.5.10 Pairing Slots — device onboarding through the I pairing handshake.
 *
 * Authority: Annex XVI v1.95 (SHA256 064AAD6D…829F), §XVI.5.10 with §XVI.2,
 * §XVI.8.4, §XVI.13.7. The normative model:
 *
 *   "A device joins a principal's context through an I code whose context
 *    constituent is a Pairing Slot: an entry the tenant creates in its own
 *    namespace meaning 'one device of this principal may pair here',
 *    optionally with an expected Device Class and an expiry; the receiving
 *    party is the principal, who is known — the device is not […] The slot is
 *    single-use by construction (§XVI.8.4, consume_at = acceptance) and is
 *    superseded by the resulting Device Record, which is signed by the tenant
 *    under this I umbrella."
 *
 * So a pairing slot is NOT a separate identity namespace: it is an I-class
 * entry (canonical designator = tenant namespace + slot entry + principal
 * receiving party), its single-use is the EXISTING §XVI.8.4 claim/consume
 * cycle, its principal binding is the EXISTING Gate-4 self-match, and its
 * outcome is a §XVI.13.7 Device Record in the EXISTING device registry. This
 * module only adds the acceptance boundary — everything a caller submits goes
 * through `runWrCodeGatePipeline` first; nothing here can reach Gate 3/4/5/6
 * state directly.
 *
 * Acceptance order (all fail-closed, claim released on ANY failure):
 *   1. full six-gate pipeline on the submitted code (claim fires at Gate 5);
 *   2. the admitted entry IS a pairing slot (I class + pairing block);
 *   3. slot's own expiry window (§XVI.5.10 "optionally … an expiry");
 *   4. presented Device Class against the slot's expectation;
 *   5. tenant signs the Device Record; the signature is verified against the
 *      tenant's directory-registered keys BEFORE anything is consumed;
 *   6. §XVI.8.4 consume (consume_at = acceptance) — the single-consumer CAS;
 *   7. the record is registered; the Device-Scoped Principal Identifier
 *      comes into existence (§XVI.2).
 *
 * A pairing never introduces a second identity: the receiver must already be
 * the principal the slot names (Gate 4 refuses NOT_FOR_YOU otherwise), and
 * the record is created under exactly that principal.
 */

import {
  claimantIdOf,
  runWrCodeGatePipeline,
  type WrCodeGateDeps,
  type WrCodeGateRefusal,
  type WrCodeReceiverIdentity,
} from './gatePipeline'
import { useLimitEntryKey, type WrCodeEntryDesignator } from './entryDesignator'
import { verifyDeviceRecord, type WrcDeviceRecord, type WrcDeviceRegistry } from './deviceRegistry'
import { WrcDirectoryClient } from './namespaceDirectory'
import type { WrcUseLimitStore } from './useLimitStore'

// ── Acceptance-boundary reason vocabulary ─────────────────────────────────────

export type WrcPairingFailureReason =
  /** The admitted entry is not a Pairing Slot (wrong class or no pairing block). */
  | 'not_a_pairing_slot'
  /** The joining side presented no principal identity or no device material. */
  | 'pairing_identity_incomplete'
  /** The slot's own expiry has passed (§XVI.5.10 optional slot expiry). */
  | 'slot_expired'
  /** Presented Device Class does not meet the slot's expectation. */
  | 'device_class_mismatch'
  /** The tenant-signed record did not verify against directory-registered keys. */
  | 'record_registration_failed'
  /** The §XVI.8.4 consume did not succeed (claim lost / already consumed). */
  | 'slot_not_consumable'

export type WrcPairingOutcome =
  | {
      ok: true
      /** The tenant-signed §XVI.13.7 Device Record that supersedes the slot. */
      record: WrcDeviceRecord
      /** §XVI.2 Device-Scoped Principal Identifier, created at this acceptance. */
      devicePartyId: string
      /** Canonical designator of the consumed slot (pipeline-derived). */
      slot: WrCodeEntryDesignator
    }
  /** The submitted code refused somewhere in the six gates — verbatim. */
  | { ok: false; stage: 'pipeline'; refusal: WrCodeGateRefusal }
  | { ok: false; stage: 'acceptance'; reason: WrcPairingFailureReason; detail?: string }

// ── Input / deps ──────────────────────────────────────────────────────────────

export interface WrcPairingPresentation {
  /** The I pairing code, exactly as entered on the new device. */
  raw: string
  /**
   * The joining side's identity: MUST carry the principal (`party_id`) the
   * slot is addressed to — "the new device … authenticates as the same
   * principal". Gate 4 enforces the match; a different identity refuses.
   */
  receiver: WrCodeReceiverIdentity
  /** What the new device presents during pairing (§XVI.5.10). */
  device: {
    /** Freshly generated device key, by fingerprint (`sha256:…`). */
    key_fingerprint: string
    device_class: string
    /** Chosen by the user, or defaulted by the tenant. */
    device_name: string
  }
  /** Idempotency handle (§XVI.8.4): a retry of the same acceptance is not a second use. */
  requestInstanceId?: string | null
}

export interface WrcPairingDeps {
  /** THE pipeline deps — the same object every other capture path uses. */
  gateDeps: WrCodeGateDeps
  /** §XVI.13.7 device registry the resulting Device Record lands in. */
  devices: WrcDeviceRegistry
  /** §XVI.8.4 store carrying the slot's single-use declaration. */
  useLimits: WrcUseLimitStore
  /** Directory client — the tenant's registered keys verify the new record. */
  directory: WrcDirectoryClient
  /**
   * Tenant-side signing seam: produce the tenant-signed Device Record for
   * the payload assembled INSIDE this boundary. The returned record is
   * re-verified against the tenant's directory-registered keys before any
   * state changes — a signer that signs with an unregistered key fails the
   * acceptance, it does not weaken it.
   */
  signDeviceRecord(
    payload: Omit<WrcDeviceRecord, 'kid' | 'sig'>,
  ): Promise<WrcDeviceRecord> | WrcDeviceRecord
  /** Unix seconds; injected for deterministic expiry tests. */
  now?(): number
  /**
   * Run 5 — the durable-commit boundary: slot consumption and Device-Record
   * registration must land TOGETHER. The production composition passes the
   * security DB's transaction (`db.transaction(fn)()`), so
   * `slot consumed → crash → record lost` cannot leave a contradictory
   * durable state. Default = plain invocation (in-process stores are already
   * atomic under run-to-completion).
   */
  atomically?<T>(fn: () => T): T
}

// ── Acceptance ────────────────────────────────────────────────────────────────

/**
 * Accept a device pairing against a Pairing-Slot I code (§XVI.5.10).
 *
 * The ONLY route from a pairing code to a Device Record: the full six-gate
 * pipeline runs first (so namespace trust, slot designation, principal
 * self-match, and the §XVI.8.4 claim are all the existing architecture), and
 * every acceptance-stage failure releases the Gate-5 claim — a failed pairing
 * never consumes the slot.
 */
export async function acceptDevicePairing(
  presentation: WrcPairingPresentation,
  deps: WrcPairingDeps,
): Promise<WrcPairingOutcome> {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  const { receiver, device } = presentation

  // The joining side must present a principal and complete device material
  // BEFORE anything is claimed — fail early, claim nothing.
  if (!receiver.party_id) {
    return {
      ok: false,
      stage: 'acceptance',
      reason: 'pairing_identity_incomplete',
      detail: 'pairing requires the principal identity the slot is addressed to',
    }
  }
  if (!device.key_fingerprint || !device.device_class || !device.device_name) {
    return {
      ok: false,
      stage: 'acceptance',
      reason: 'pairing_identity_incomplete',
      detail: 'pairing requires the device key fingerprint, Device Class, and Device Name',
    }
  }

  // 1. The six gates — no bypass, no second path. A refusal is returned
  //    verbatim so the status surface renders the precise gate reason.
  const admission = await runWrCodeGatePipeline(
    {
      raw: presentation.raw,
      receiver,
      requestInstanceId: presentation.requestInstanceId ?? null,
    },
    deps.gateDeps,
  )
  if (!admission.ok) {
    return { ok: false, stage: 'pipeline', refusal: admission }
  }

  const designator = admission.designator
  const party = claimantIdOf(receiver)!

  // From here a §XVI.8.4 claim may be held (Gate 5 fired it): every failure
  // below must revert it — a failed pairing never consumes the slot.
  const failAcceptance = (
    reason: WrcPairingFailureReason,
    detail?: string,
  ): WrcPairingOutcome => {
    deps.useLimits.release(designator.publisher_part, useLimitEntryKey(designator), party)
    return { ok: false, stage: 'acceptance', reason, detail }
  }

  // 2. The admitted entry must BE a pairing slot: an I entry whose signed
  //    designation carries the pairing block (§XVI.5.10). Any other admitted
  //    entry — including a perfectly valid non-pairing I code — refuses.
  const pairing = admission.material.entry?.designation?.pairing ?? null
  if (admission.reference.cls !== 'I' || !pairing) {
    return failAcceptance(
      'not_a_pairing_slot',
      `class ${admission.reference.cls} entry ${admission.material.entry_id} carries no pairing-slot designation`,
    )
  }

  // 3. The slot's own expiry (distinct from entry state and session windows).
  const nowS = now()
  if (pairing.expires_at !== null && nowS >= pairing.expires_at) {
    return failAcceptance('slot_expired', `slot expired at ${pairing.expires_at}`)
  }

  // 4. "the tenant checks the class against the slot's expectation" —
  //    a null expectation admits any class; a named one admits exactly it.
  if (
    pairing.expected_device_class !== null &&
    pairing.expected_device_class !== device.device_class
  ) {
    return failAcceptance(
      'device_class_mismatch',
      `slot expects Device Class ${pairing.expected_device_class}, device presented ${device.device_class}`,
    )
  }

  // 5. Assemble the record INSIDE the boundary (a caller cannot inject one),
  //    have the tenant sign it, and verify the signature against the
  //    tenant's directory-registered keys before any state changes.
  //    §XVI.2: the Device-Scoped Principal Identifier comes into existence
  //    here — principal identity + the tenant-registered Device Name.
  const tenantPart = designator.publisher_part
  const devicePartyId = `${receiver.party_id}:${device.device_name}`
  const priorGeneration = deps.devices.tenantDevice(tenantPart, devicePartyId)?.generation ?? 0

  let record: WrcDeviceRecord
  try {
    record = await deps.signDeviceRecord({
      type: 'wrc/device-record',
      tenant_part: tenantPart,
      principal_party_id: receiver.party_id,
      device_party_id: devicePartyId,
      device_name: device.device_name,
      device_class: device.device_class,
      key_fingerprint: device.key_fingerprint,
      generation: priorGeneration + 1,
      status: 'active',
    })
  } catch (e) {
    return failAcceptance(
      'record_registration_failed',
      e instanceof Error ? e.message : String(e),
    )
  }

  const dir = await deps.directory.getVerifiedRecord(tenantPart)
  if (!dir.ok) {
    return failAcceptance('record_registration_failed', `tenant directory: ${dir.leg ?? dir.reason}`)
  }
  const verdict = verifyDeviceRecord(record, dir.record.keys)
  if (!verdict.ok) {
    return failAcceptance(
      'record_registration_failed',
      verdict.detail ? `${verdict.leg}: ${verdict.detail}` : verdict.leg,
    )
  }
  // The signer must return THE record for THIS pairing, not a substitute.
  if (
    record.tenant_part !== tenantPart ||
    record.principal_party_id !== receiver.party_id ||
    record.device_party_id !== devicePartyId ||
    record.key_fingerprint !== device.key_fingerprint ||
    record.status !== 'active'
  ) {
    return failAcceptance('record_registration_failed', 'signed record does not match the pairing payload')
  }

  // 6 + 7. §XVI.8.4 consume_at = acceptance (THE single-consumer transition)
  //    and the registration that supersedes the slot (§XVI.5.10) — ONE
  //    durable commit (Run 5): either the slot is consumed AND its successor
  //    Device Record exists, or neither happened. We hold the Gate-5 claim,
  //    so the only way the consume fails is a lost/expired reservation —
  //    refuse without registering anything; a throwing durable write rolls
  //    the consume back and never produces a successful pairing.
  const commit = deps.atomically ?? (<T,>(fn: () => T): T => fn())
  let consumed: ReturnType<WrcUseLimitStore['consume']>
  try {
    consumed = commit(() => {
      const c = deps.useLimits.consume(
        designator.publisher_part,
        useLimitEntryKey(designator),
        party,
        presentation.requestInstanceId ?? null,
        nowS,
      )
      if (c.ok) deps.devices.registerTenantDevice(record)
      return c
    })
  } catch (e) {
    return failAcceptance(
      'slot_not_consumable',
      `durable commit failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  if (!consumed.ok) {
    return failAcceptance('slot_not_consumable', consumed.reason)
  }

  return { ok: true, record, devicePartyId, slot: designator }
}
