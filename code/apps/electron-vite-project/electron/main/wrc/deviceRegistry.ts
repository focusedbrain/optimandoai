/**
 * §XVI.13.7 device trust substrate (Run 4): Device Records, the Device Pass /
 * Registered Counterpart Device relationship, and the verification chain
 * behind Gate 4's device-granularity decision.
 *
 * The normative shape, kept exactly:
 *
 *  - A DEVICE RECORD binds name → class → key fingerprint → principal, is
 *    signed by the TENANT under the I umbrella in which the device was
 *    paired, and is verified against the tenant's verification key from its
 *    Namespace Directory Record. A record enters a tenant's list only
 *    through a pairing under this tenant; there is no discovery of foreign
 *    devices and no directory of devices.
 *  - A DEVICE PASS makes exactly one responder device addressable to the C
 *    initiator: the device presented and proved its own tenant-signed record
 *    over the sealed channel of THAT C relationship. The pass is held by the
 *    initiator as a Registered Counterpart Device OF THIS C RELATIONSHIP —
 *    it never extends to a second device, a second identity, or another
 *    establishment. Revocable by either side; expiring; the tenant's
 *    generation check at each resolution invalidates stale records.
 *  - Sibling devices of the same principal remain distinct: a reference
 *    bound to one device resolves ONLY on that device.
 *
 * What is deliberately NOT here: the key-possession proof. That proof
 * happens on the sealed channel at registration and again at P2P session
 * establishment (§XVI.13.7 steps 2 and the key agreement), which is session
 * transport, out of Run-4 scope. This module verifies the RECORD chain —
 * signature, binding, status, generation, expiry — which is what Gate 4
 * consumes at resolution time.
 */

import { wrcVerifyObjectSignature } from './wrcCrypto'

// ── Wire shapes ───────────────────────────────────────────────────────────────

export interface WrcDeviceRecord {
  type: 'wrc/device-record'
  /** The tenant (publisher) whose pairing created this record. */
  tenant_part: string
  principal_party_id: string
  /** Device-Scoped Principal Identifier — the identity Gate 4 matches. */
  device_party_id: string
  /** Unique within its principal; a selection handle, never an authority. */
  device_name: string
  device_class: string
  /** Fingerprint of the device key; the target must prove possession of it. */
  key_fingerprint: string
  /** Renaming bumps generation; revocation invalidates via the generation check. */
  generation: number
  status: 'active' | 'revoked'
  /** Tenant key that signed (must be directory-registered). */
  kid: string
  sig: string
}

/** §XVI.13.7 "Device Pass": a Registered Counterpart Device of ONE C pair. */
export interface WrcDevicePass {
  type: 'wrc/device-pass'
  c_initiator_part: string
  c_responder_part: string
  record: WrcDeviceRecord
  registered_at: number
  expires_at: number
  /** The responder may withdraw the pass without revoking the device. */
  status: 'active' | 'withdrawn'
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

export function decodeDeviceRecord(value: unknown): WrcDeviceRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  if (o.type !== 'wrc/device-record') return null
  if (!isStr(o.tenant_part) || !isStr(o.principal_party_id) || !isStr(o.device_party_id)) return null
  if (!isStr(o.device_name) || !isStr(o.device_class) || !isStr(o.key_fingerprint)) return null
  if (!isInt(o.generation) || o.generation < 1) return null
  if (o.status !== 'active' && o.status !== 'revoked') return null
  if (!isStr(o.kid) || !isStr(o.sig)) return null
  return o as unknown as WrcDeviceRecord
}

// ── Verification legs (deterministic, machine-readable) ───────────────────────

export type WrcDeviceBindingLeg =
  | 'record_missing'
  | 'record_sig_invalid'
  | 'record_revoked'
  | 'record_generation_stale'
  | 'pass_missing'
  | 'pass_expired'
  | 'pass_withdrawn'
  | 'wrong_establishment'
  | 'wrong_tenant'
  | 'device_mismatch'
  | 'unsupported_device_addressing'

export type WrcDeviceBindingVerdict =
  | { ok: true; record: WrcDeviceRecord }
  | { ok: false; leg: WrcDeviceBindingLeg; detail?: string }

/**
 * Verify a tenant-signed Device Record against the tenant's
 * directory-registered verification keys (§XVI.13.7 "Why the name is
 * unambiguous" / Gate-2 assurance).
 */
export function verifyDeviceRecord(
  record: WrcDeviceRecord,
  tenantKeys: ReadonlyArray<{ kid: string; pub: string }>,
): WrcDeviceBindingVerdict {
  const key = tenantKeys.find((k) => k.kid === record.kid)
  if (!key || !wrcVerifyObjectSignature(record as unknown as Record<string, unknown>, key.pub)) {
    return { ok: false, leg: 'record_sig_invalid' }
  }
  if (record.status !== 'active') {
    return { ok: false, leg: 'record_revoked', detail: record.device_party_id }
  }
  return { ok: true, record }
}

export interface VerifyDevicePassInput {
  pass: WrcDevicePass
  /** The C pair from the CANONICAL designator's parent — never caller input. */
  cInitiatorPart: string
  cResponderPart: string
  /** The device the reference is bound to (receiving-party constituent). */
  expectedDevicePartyId: string
  /** Responder tenant's directory-registered verification keys. */
  tenantKeys: ReadonlyArray<{ kid: string; pub: string }>
  /**
   * The tenant's CURRENT record for this device, when reachable — the
   * §XVI.13.7 generation check at each resolution. Null = tenant state
   * unreachable; the pass's own record still verifies, but a revocation or
   * rename recorded by the tenant would be missed, so callers that CAN reach
   * tenant state must pass it.
   */
  currentTenantRecord: WrcDeviceRecord | null
  nowS: number
}

/**
 * The full §XVI.13.7 Device Pass chain, ordered, first failure terminates:
 * establishment binding → tenant binding → device binding → record signature
 * → record status → generation currency → pass lifecycle.
 */
export function verifyDevicePass(input: VerifyDevicePassInput): WrcDeviceBindingVerdict {
  const { pass } = input

  // A valid pass from ANOTHER establishment must confer nothing here.
  if (
    pass.c_initiator_part !== input.cInitiatorPart ||
    pass.c_responder_part !== input.cResponderPart
  ) {
    return {
      ok: false,
      leg: 'wrong_establishment',
      detail: `pass is bound to ${pass.c_initiator_part}↔${pass.c_responder_part}`,
    }
  }

  // The device is addressable outside its tenant ONLY via its own tenant's
  // signature: the record's tenant must be the responder of this pair.
  if (pass.record.tenant_part !== input.cResponderPart) {
    return { ok: false, leg: 'wrong_tenant', detail: pass.record.tenant_part }
  }

  // One pass, one device, one identity.
  if (pass.record.device_party_id !== input.expectedDevicePartyId) {
    return { ok: false, leg: 'device_mismatch', detail: pass.record.device_party_id }
  }

  const record = verifyDeviceRecord(pass.record, input.tenantKeys)
  if (!record.ok) return record

  // §XVI.13.7.5 — "the generation check performed at each resolution": the
  // tenant revoking or re-issuing the record invalidates every reference
  // bound to the stale generation.
  if (input.currentTenantRecord) {
    if (input.currentTenantRecord.status !== 'active') {
      return { ok: false, leg: 'record_revoked', detail: 'tenant revoked the device' }
    }
    if (input.currentTenantRecord.generation > pass.record.generation) {
      return {
        ok: false,
        leg: 'record_generation_stale',
        detail: `pass holds generation ${pass.record.generation}, tenant is at ${input.currentTenantRecord.generation}`,
      }
    }
  }

  if (pass.status !== 'active') {
    return { ok: false, leg: 'pass_withdrawn' }
  }
  if (input.nowS >= pass.expires_at) {
    return { ok: false, leg: 'pass_expired', detail: `expired at ${pass.expires_at}` }
  }

  return { ok: true, record: pass.record }
}

// ── Registry (local state: the tenant list + held counterpart passes) ─────────

/**
 * Local device state, per §XVI.13.7: a tenant holds the signed Device
 * Records of its own principals and nobody else's; an initiator holds a
 * counterpart's record only as a pass the counterpart's device presented.
 * Keyed by (tenant, device) and (initiator, responder, device) — a device
 * registered beneath one C relationship confers nothing beneath another.
 */
export interface WrcDeviceRegistry {
  tenantDevice(tenantPart: string, devicePartyId: string): WrcDeviceRecord | null
  counterpartPass(
    cInitiatorPart: string,
    cResponderPart: string,
    devicePartyId: string,
  ): WrcDevicePass | null
  registerTenantDevice(record: WrcDeviceRecord): void
  registerCounterpartPass(pass: WrcDevicePass): void
  /** Tenant-side revocation: replaces the record with a revoked, bumped generation. */
  revokeTenantDevice(tenantPart: string, devicePartyId: string): void
  /** Responder-side withdrawal without revoking the device. */
  withdrawCounterpartPass(
    cInitiatorPart: string,
    cResponderPart: string,
    devicePartyId: string,
  ): void
}

export function createMemoryDeviceRegistry(): WrcDeviceRegistry {
  const tenant = new Map<string, WrcDeviceRecord>()
  const passes = new Map<string, WrcDevicePass>()
  const tKey = (t: string, d: string) => `${t}|${d}`
  const pKey = (i: string, r: string, d: string) => `${i}|${r}|${d}`
  return {
    tenantDevice: (t, d) => tenant.get(tKey(t, d)) ?? null,
    counterpartPass: (i, r, d) => passes.get(pKey(i, r, d)) ?? null,
    registerTenantDevice(record) {
      tenant.set(tKey(record.tenant_part, record.device_party_id), record)
    },
    registerCounterpartPass(pass) {
      passes.set(
        pKey(pass.c_initiator_part, pass.c_responder_part, pass.record.device_party_id),
        pass,
      )
    },
    revokeTenantDevice(t, d) {
      const cur = tenant.get(tKey(t, d))
      if (cur) {
        // The signature is now stale by construction — that is the point:
        // revocation is a tenant statement, surfaced via the generation check.
        tenant.set(tKey(t, d), { ...cur, status: 'revoked', generation: cur.generation + 1 })
      }
    },
    withdrawCounterpartPass(i, r, d) {
      const cur = passes.get(pKey(i, r, d))
      if (cur) passes.set(pKey(i, r, d), { ...cur, status: 'withdrawn' })
    },
  }
}
