/**
 * Run 5 Slice 3 — durable §XVI.13.7 device registry over the WRC security DB.
 *
 * The signed Device Record remains the authority (Run 4); the DB is its
 * durable registry/index/state substrate. What these vectors prove, against
 * the REAL native DB with restart modeled as close-handle → reopen-file →
 * fresh stores:
 *
 *  - pair → restart → the device still resolves; siblings still refuse;
 *  - revocation and generation advancement survive restart and cannot be
 *    rolled back (generation-gated upsert);
 *  - establishment isolation: the same device id under a different C parent
 *    is a different row and a different trust decision;
 *  - pairing commits the slot consumption and the Device Record in ONE
 *    durable transaction — a failed durable write never produces a
 *    successful pairing, and a racing pairing has exactly one winner whose
 *    record exists exactly once after restart;
 *  - a malformed or tampered persisted record fails closed.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import { runWrCodeGatePipeline, type WrCodeGateDeps } from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcDirectoryClient } from '../namespaceDirectory'
import {
  createDbDeviceRegistry,
  verifyDeviceRecord,
  type WrcDeviceRecord,
  type WrcDevicePass,
  type WrcDeviceRegistry,
} from '../deviceRegistry'
import { deriveEntryDesignator, useLimitEntryKey } from '../entryDesignator'
import { acceptDevicePairing, type WrcPairingDeps, type WrcPairingPresentation } from '../pairingSlots'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createDbUseLimitStore, defaultUseLimitProfile, type WrcUseLimitStore } from '../useLimitStore'
import { openWrcSecurityDb, type WrcSecurityDb } from '../wrcSecurityDb'
import {
  buildPublisherFixture,
  createMultiFixtureTransport,
  makeKeyPair,
  signDeviceRecord,
  signObject,
} from './wrcFixtures'

const _require = createRequire(import.meta.url)
let Database: unknown = null
try {
  const D = _require('better-sqlite3')
  const probe = new D(':memory:')
  probe.close()
  Database = D
} catch {
  Database = null
}

const NOW = 1_754_650_100
const TENANT = 'WR7X4K'
const PRINCIPAL = 'party-1'
const SLOT_COMB = 'PRSA01'
const SI_COMB = 'DEVSE1'
const DSPI = `${PRINCIPAL}:new-workstation`

const INGEST = makeKeyPair('wrc-ingest-shared')
const OPERATOR = makeKeyPair('dir-op-shared')

const tenantFx = buildPublisherFixture({
  publisherPart: TENANT,
  domain: 'tenant.test',
  ingestKey: INGEST,
  operatorKey: OPERATOR,
  extraEntries: [
    {
      lookupKey: SLOT_COMB,
      entryId: 'SLOTE1',
      designation: {
        cls: 'I',
        combination: SLOT_COMB,
        receiving_party: { kind: 'principal', id: PRINCIPAL },
        pairing: { slot: true, expected_device_class: 'workstation', expires_at: NOW + 3600 },
      },
    },
    {
      // SI entry bound to the device the pairing below will create.
      lookupKey: SI_COMB,
      entryId: 'RES001',
      designation: {
        cls: 'SI',
        combination: SI_COMB,
        receiving_party: { kind: 'device', id: DSPI },
        parent: { cls: 'I', publisher_part: TENANT },
      },
    },
  ],
})

function iRef(combination: string): string {
  const r = buildWrCodeReference('I', [TENANT, combination])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
}
function siRef(): string {
  const r = buildWrCodeReference('SI', [TENANT, SI_COMB])
  if (!r.ok) throw new Error(r.reason)
  return r.canonical
}

let dir: string
let dbPath: string
let db: WrcSecurityDb

beforeEach(() => {
  if (!Database) return
  dir = mkdtempSync(join(tmpdir(), 'wrc-dev-'))
  dbPath = join(dir, 'wrc-security.db')
  db = openWrcSecurityDb(dbPath)
})

afterEach(() => {
  if (!Database) return
  try {
    db.close()
  } catch {
    /* closed by restart */
  }
  rmSync(dir, { recursive: true, force: true })
})

function restart(): WrcSecurityDb {
  db.close()
  db = openWrcSecurityDb(dbPath)
  return db
}

interface Rig {
  gateDeps: WrCodeGateDeps
  pairingDeps: WrcPairingDeps
  devices: WrcDeviceRegistry
  useLimits: WrcUseLimitStore
}

/** Build a full production-shaped rig over a given DB handle. */
function rigOver(handle: WrcSecurityDb, overrides: Partial<WrcPairingDeps> = {}): Rig {
  const transport = createMultiFixtureTransport([tenantFx])
  const client = new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: INGEST.pub,
    now: () => NOW,
  })
  const directory = new WrcDirectoryClient({
    transport,
    operator: { kid: OPERATOR.kid, pub: OPERATOR.pub },
    now: () => NOW,
  })
  const devices = overrides.devices ?? createDbDeviceRegistry(handle)
  const useLimits = overrides.useLimits ?? createDbUseLimitStore(handle)
  const gateDeps = createWrcGateDeps(client, { useLimits, now: () => NOW, directory, devices })
  const pairingDeps: WrcPairingDeps = {
    gateDeps,
    devices,
    useLimits,
    directory,
    signDeviceRecord: (payload) =>
      signObject(
        { ...payload, kid: tenantFx.root.kid, sig: '' } as unknown as Record<string, unknown>,
        tenantFx.root,
      ) as unknown as WrcDeviceRecord,
    now: () => NOW,
    atomically: (fn) => handle.transaction(fn)(),
    ...overrides,
  }
  return { gateDeps, pairingDeps, devices, useLimits }
}

function declareSlot(useLimits: WrcUseLimitStore) {
  const captured = captureWrCodeReference(iRef(SLOT_COMB))
  if (!captured.ok) throw new Error(captured.reason)
  const derived = deriveEntryDesignator(
    captured,
    { cls: 'I', combination: SLOT_COMB, receiving_party: { kind: 'principal', id: PRINCIPAL } },
    'SLOTE1',
  )
  if (!derived.ok) throw new Error(derived.reason)
  useLimits.declare(TENANT, useLimitEntryKey(derived.designator), defaultUseLimitProfile(1))
  return derived.designator
}

function presentation(overrides: Partial<WrcPairingPresentation> = {}): WrcPairingPresentation {
  return {
    raw: iRef(SLOT_COMB),
    receiver: { party_id: PRINCIPAL },
    device: {
      key_fingerprint: 'sha256:aa11bb22',
      device_class: 'workstation',
      device_name: 'new-workstation',
    },
    requestInstanceId: 'req-1',
    ...overrides,
  }
}

// ── Pair → restart → resolve ──────────────────────────────────────────────────

describe.skipIf(!Database)('pairing survives restart [XVI.13.7 / XVI.5.10]', () => {
  it('pair → restart → the device resolves; the sibling still refuses', async () => {
    const rig = rigOver(db)
    declareSlot(rig.useLimits)
    const paired = await acceptDevicePairing(presentation(), rig.pairingDeps)
    expect(paired.ok, paired.ok ? '' : JSON.stringify(paired)).toBe(true)

    // Restart: nothing in-process survives; the registry is rebuilt on the
    // reopened file.
    const reopened = restart()
    const fresh = rigOver(reopened)

    const onDevice = await runWrCodeGatePipeline(
      { raw: siRef(), receiver: { party_id: PRINCIPAL, device_party_id: DSPI } },
      fresh.gateDeps,
    )
    expect(onDevice.ok, onDevice.ok ? '' : JSON.stringify(onDevice)).toBe(true)

    // Sibling device of the same principal: bound references stay distinct.
    const onSibling = await runWrCodeGatePipeline(
      { raw: siRef(), receiver: { party_id: PRINCIPAL, device_party_id: `${PRINCIPAL}:other-laptop` } },
      fresh.gateDeps,
    )
    expect(onSibling.ok).toBe(false)
    if (onSibling.ok) return
    expect(onSibling.gate).toBe(4)
  })

  it('restart after successful pairing leaves exactly one valid durable record', async () => {
    const rig = rigOver(db)
    declareSlot(rig.useLimits)
    const paired = await acceptDevicePairing(presentation(), rig.pairingDeps)
    expect(paired.ok).toBe(true)

    const reopened = restart()
    const rows = reopened
      .prepare('SELECT record_json FROM wrc_device_record WHERE tenant_part = ?')
      .all(TENANT) as Array<{ record_json: string }>
    expect(rows.length).toBe(1)
    const record = JSON.parse(rows[0]!.record_json) as WrcDeviceRecord
    expect(record.device_party_id).toBe(DSPI)
    expect(verifyDeviceRecord(record, [tenantFx.root]).ok).toBe(true)
  })
})

// ── Revocation and generation across restart ─────────────────────────────────

describe.skipIf(!Database)('revocation and generation monotonicity survive restart', () => {
  it('revoked → restart → still refused', async () => {
    const rig = rigOver(db)
    declareSlot(rig.useLimits)
    expect((await acceptDevicePairing(presentation(), rig.pairingDeps)).ok).toBe(true)
    rig.devices.revokeTenantDevice(TENANT, DSPI)

    const reopened = restart()
    const fresh = rigOver(reopened)
    const r = await runWrCodeGatePipeline(
      { raw: siRef(), receiver: { party_id: PRINCIPAL, device_party_id: DSPI } },
      fresh.gateDeps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('device_binding_unverified')
  })

  it('generation rollback is impossible: an older signed record cannot overwrite a newer row, before or after restart', () => {
    const devices = createDbDeviceRegistry(db)
    const gen1 = signDeviceRecord(tenantFx, {
      principalPartyId: PRINCIPAL,
      devicePartyId: DSPI,
      deviceName: 'new-workstation',
      deviceClass: 'workstation',
      generation: 1,
    })
    const gen2 = signDeviceRecord(tenantFx, {
      principalPartyId: PRINCIPAL,
      devicePartyId: DSPI,
      deviceName: 'new-workstation',
      deviceClass: 'workstation',
      generation: 2,
    })
    devices.registerTenantDevice(gen1)
    devices.registerTenantDevice(gen2)
    expect(devices.tenantDevice(TENANT, DSPI)?.generation).toBe(2)

    // The stale record arrives again (replayed registration): no-op.
    devices.registerTenantDevice(gen1)
    expect(devices.tenantDevice(TENANT, DSPI)?.generation).toBe(2)

    const reopened = restart()
    const after = createDbDeviceRegistry(reopened)
    after.registerTenantDevice(gen1)
    expect(after.tenantDevice(TENANT, DSPI)?.generation).toBe(2)
  })

  it('concurrent registrations settle on the highest generation regardless of arrival order', () => {
    const devices = createDbDeviceRegistry(db)
    const gens = [3, 1, 5, 2, 4].map((g) =>
      signDeviceRecord(tenantFx, {
        principalPartyId: PRINCIPAL,
        devicePartyId: DSPI,
        deviceName: 'new-workstation',
        deviceClass: 'workstation',
        generation: g,
      }),
    )
    for (const r of gens) devices.registerTenantDevice(r)
    expect(devices.tenantDevice(TENANT, DSPI)?.generation).toBe(5)
  })
})

// ── Establishment isolation ───────────────────────────────────────────────────

describe.skipIf(!Database)('C-parent isolation: no aliasing across establishments', () => {
  it('a pass registered under C pair (A,B) confers nothing under (A,C), including after restart', () => {
    const devices = createDbDeviceRegistry(db)
    const record = signDeviceRecord(tenantFx, {
      principalPartyId: PRINCIPAL,
      devicePartyId: DSPI,
      deviceName: 'new-workstation',
      deviceClass: 'workstation',
    })
    const pass: WrcDevicePass = {
      type: 'wrc/device-pass',
      c_initiator_part: 'AAAAAA',
      c_responder_part: TENANT,
      record,
      registered_at: NOW,
      expires_at: NOW + 3600,
      status: 'active',
    }
    devices.registerCounterpartPass(pass)
    expect(devices.counterpartPass('AAAAAA', TENANT, DSPI)?.record.device_party_id).toBe(DSPI)
    expect(devices.counterpartPass('CCCCCC', TENANT, DSPI)).toBeNull()

    const reopened = restart()
    const after = createDbDeviceRegistry(reopened)
    expect(after.counterpartPass('AAAAAA', TENANT, DSPI)?.status).toBe('active')
    expect(after.counterpartPass('CCCCCC', TENANT, DSPI)).toBeNull()
  })
})

// ── Pairing atomicity and races ───────────────────────────────────────────────

describe.skipIf(!Database)('pairing commit is atomic against the durable stores', () => {
  it('a failed durable write does not produce a successful pairing OR a consumed slot', async () => {
    const rig = rigOver(db)
    const designator = declareSlot(rig.useLimits)

    // Registry whose durable write fails inside the commit.
    const failingDevices: WrcDeviceRegistry = {
      ...rig.devices,
      tenantDevice: rig.devices.tenantDevice.bind(rig.devices),
      counterpartPass: rig.devices.counterpartPass.bind(rig.devices),
      registerCounterpartPass: rig.devices.registerCounterpartPass.bind(rig.devices),
      revokeTenantDevice: rig.devices.revokeTenantDevice.bind(rig.devices),
      withdrawCounterpartPass: rig.devices.withdrawCounterpartPass.bind(rig.devices),
      registerTenantDevice: () => {
        throw new Error('SQLITE_FULL: database or disk is full')
      },
    }
    const failing = rigOver(db, { devices: failingDevices, useLimits: rig.useLimits })

    const r = await acceptDevicePairing(presentation(), failing.pairingDeps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.stage).toBe('acceptance')
    if (r.stage !== 'acceptance') return
    expect(r.reason).toBe('slot_not_consumable')
    expect(r.detail).toContain('durable commit failed')

    // The transaction rolled the consume back and the claim was released:
    // the slot is claimable again, and NO device row exists.
    const row = rig.useLimits.read(TENANT, useLimitEntryKey(designator))
    expect(row?.state).toBe('active')
    expect(rig.devices.tenantDevice(TENANT, DSPI)).toBeNull()

    // A subsequent valid attempt still succeeds (claim semantics preserved).
    const retry = await acceptDevicePairing(presentation({ requestInstanceId: 'req-2' }), rig.pairingDeps)
    expect(retry.ok, retry.ok ? '' : JSON.stringify(retry)).toBe(true)
  })

  it('racing pairings: exactly one winner, exactly one durable record, restart preserves it', async () => {
    const rig = rigOver(db)
    declareSlot(rig.useLimits)

    const [a, b] = await Promise.all([
      acceptDevicePairing(
        presentation({ requestInstanceId: 'race-a', device: { key_fingerprint: 'sha256:aaaa', device_class: 'workstation', device_name: 'racer-a' } }),
        rig.pairingDeps,
      ),
      acceptDevicePairing(
        presentation({ requestInstanceId: 'race-b', device: { key_fingerprint: 'sha256:bbbb', device_class: 'workstation', device_name: 'racer-b' } }),
        rig.pairingDeps,
      ),
    ])
    const winners = [a, b].filter((r) => r.ok)
    const losers = [a, b].filter((r) => !r.ok)
    expect(winners.length).toBe(1)
    expect(losers.length).toBe(1)

    const reopened = restart()
    const rows = reopened
      .prepare('SELECT device_party_id FROM wrc_device_record WHERE tenant_part = ?')
      .all(TENANT) as Array<{ device_party_id: string }>
    expect(rows.length).toBe(1)
    const winner = winners[0]!
    if (winner.ok) expect(rows[0]!.device_party_id).toBe(winner.devicePartyId)
  })
})

// ── Malformed / tampered persisted state ──────────────────────────────────────

describe.skipIf(!Database)('malformed or tampered persisted records fail closed', () => {
  it('a garbage row reads as absent (record_missing downstream)', () => {
    db.prepare(
      `INSERT INTO wrc_device_record
         (tenant_part, device_party_id, principal_party_id, device_class, generation, status, record_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(TENANT, 'party-1:ghost', PRINCIPAL, 'workstation', 1, 'active', '{not json', new Date().toISOString())
    const devices = createDbDeviceRegistry(db)
    expect(devices.tenantDevice(TENANT, 'party-1:ghost')).toBeNull()
  })

  it('a decodable but TAMPERED record still fails Ed25519 verification', () => {
    const devices = createDbDeviceRegistry(db)
    const genuine = signDeviceRecord(tenantFx, {
      principalPartyId: PRINCIPAL,
      devicePartyId: DSPI,
      deviceName: 'new-workstation',
      deviceClass: 'workstation',
    })
    devices.registerTenantDevice(genuine)
    // Tamper the persisted JSON directly (an attacker with file access).
    const tampered = { ...genuine, device_class: 'kiosk' }
    db.prepare(
      `UPDATE wrc_device_record SET record_json = ? WHERE tenant_part = ? AND device_party_id = ?`,
    ).run(JSON.stringify(tampered), TENANT, DSPI)

    const read = devices.tenantDevice(TENANT, DSPI)
    expect(read).not.toBeNull()
    const verdict = verifyDeviceRecord(read!, [tenantFx.root])
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.leg).toBe('record_sig_invalid')
  })
})
