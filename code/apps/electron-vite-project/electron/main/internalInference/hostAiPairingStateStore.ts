/**
 * Sandbox: persisted Host AI ↔ Host reciprocity and terminal pairing errors.
 * When the Host has no matching internal handshake, probes return NO_ACTIVE_INTERNAL_HOST_HANDSHAKE
 * and we mark ledger asymmetric (no further repair/probe until re-pairing).
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { InternalInferenceErrorCode } from './errors'

const FILE = 'host-ai-pairing-state.json'

export const HOST_AI_RECIPROCITY_TTL_MS = 48 * 60 * 60 * 1000

type TerminalKind = 'ledger_asymmetric' | 'pairing_stale'

type EntryV1 = {
  peerHostDeviceId: string
  /** Set when a capabilities/policy probe proved the host has the handshake (reciprocal). */
  lastReciprocalAckAt: number | null
  /** Terminal: do not run repair, cap probe, or policy GET until re-pair. */
  terminal: TerminalKind | null
  terminalAt: number | null
}

type DiskV1 = { v: 1; byHandshake: Record<string, EntryV1> }

function storePath(): string {
  return path.join(app.getPath('userData'), FILE)
}

let cache: DiskV1 | null = null

function ensureDisk(): DiskV1 {
  if (cache) return cache
  const p = storePath()
  try {
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<DiskV1>
      if (j && j.v === 1 && j.byHandshake && typeof j.byHandshake === 'object') {
        cache = { v: 1, byHandshake: { ...j.byHandshake } }
        return cache
      }
    }
  } catch {
    /* fall through */
  }
  cache = { v: 1, byHandshake: {} }
  return cache
}

function persist(): void {
  const d = ensureDisk()
  try {
    fs.writeFileSync(storePath(), JSON.stringify(d, null, 2), 'utf-8')
  } catch {
    /* no-op */
  }
}

/** @internal */
export function _resetHostAiPairingStateStoreForTests(): void {
  cache = { v: 1, byHandshake: {} }
}

function entryFor(
  hid: string,
  peerHostDeviceId: string,
  existing?: EntryV1,
): EntryV1 {
  return {
    peerHostDeviceId,
    lastReciprocalAckAt: existing?.lastReciprocalAckAt ?? null,
    terminal: existing?.terminal ?? null,
    terminalAt: existing?.terminalAt ?? null,
  }
}

/**
 * If the row’s host coordination id changes, clear poisoned state for this handshake.
 */
export function reconcileHostAiPairingEntry(handshakeId: string, peerHostDeviceId: string | null | undefined): void {
  const hid = String(handshakeId ?? '').trim()
  const peer = String(peerHostDeviceId ?? '').trim()
  if (!hid || !peer) return
  const d = ensureDisk()
  const e = d.byHandshake[hid]
  if (!e) return
  if (e.peerHostDeviceId !== peer) {
    delete d.byHandshake[hid]
    persist()
  }
}

export function recordHostAiReciprocalCapabilitiesSuccess(handshakeId: string, peerHostDeviceId: string): void {
  const hid = String(handshakeId ?? '').trim()
  const peer = String(peerHostDeviceId ?? '').trim()
  if (!hid || !peer) return
  const d = ensureDisk()
  const now = Date.now()
  d.byHandshake[hid] = {
    peerHostDeviceId: peer,
    lastReciprocalAckAt: now,
    terminal: null,
    terminalAt: null,
  }
  persist()
}

export function recordHostAiLedgerAsymmetric(handshakeId: string, peerHostDeviceId: string): void {
  const hid = String(handshakeId ?? '').trim()
  const peer = String(peerHostDeviceId ?? '').trim()
  if (!hid || !peer) return
  const d = ensureDisk()
  const now = Date.now()
  d.byHandshake[hid] = {
    ...entryFor(hid, peer, d.byHandshake[hid]),
    peerHostDeviceId: peer,
    terminal: 'ledger_asymmetric',
    terminalAt: now,
  }
  persist()
}

export function recordHostAiPairingStale(handshakeId: string, peerHostDeviceId: string): void {
  const hid = String(handshakeId ?? '').trim()
  const peer = String(peerHostDeviceId ?? '').trim()
  if (!hid || !peer) return
  const d = ensureDisk()
  const now = Date.now()
  d.byHandshake[hid] = {
    ...entryFor(hid, peer, d.byHandshake[hid]),
    peerHostDeviceId: peer,
    terminal: 'pairing_stale',
    terminalAt: now,
  }
  persist()
}

/**
 * If reciprocity is older than TTL, mark as pairing stale (call from list / probe, not on every read).
 */
export function refreshHostAiPairingStaleByTtl(handshakeId: string, peerHostDeviceId: string, now: number = Date.now()): void {
  const hid = String(handshakeId ?? '').trim()
  const peer = String(peerHostDeviceId ?? '').trim()
  if (!hid || !peer) return
  const d = ensureDisk()
  const e = d.byHandshake[hid]
  if (!e || e.peerHostDeviceId !== peer) return
  if (e.terminal === 'ledger_asymmetric') return
  const last = e.lastReciprocalAckAt
  if (last == null) return
  if (now - last > HOST_AI_RECIPROCITY_TTL_MS) {
    if (e.terminal !== 'pairing_stale') {
      d.byHandshake[hid] = { ...e, terminal: 'pairing_stale', terminalAt: now }
      persist()
    }
  }
}

export function clearHostAiPairingStateForHandshake(handshakeId: string): void {
  const hid = String(handshakeId ?? '').trim()
  if (!hid) return
  const d = ensureDisk()
  if (d.byHandshake[hid]) {
    delete d.byHandshake[hid]
    persist()
  }
}

export function hostAiPairingListBlock(
  handshakeId: string,
  peerHostDeviceId: string,
): { block: true; code: string; userMessage: string } | { block: false } {
  const hid = String(handshakeId ?? '').trim()
  const peer = String(peerHostDeviceId ?? '').trim()
  if (!hid || !peer) return { block: false }
  const d = ensureDisk()
  const e = d.byHandshake[hid]
  if (!e || e.peerHostDeviceId !== peer) return { block: false }
  if (e.terminal === 'ledger_asymmetric') {
    return {
      block: true,
      code: InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC,
      userMessage: 'Host pairing is stale. Re-link this Host (ledger missing on the Host machine).',
    }
  }
  /**
   * `pairing_stale` (TTL) does **not** block: we must allow capability probes to refresh
   * `lastReciprocalAckAt`. A dedicated probe failure or policy path may still surface
   * `HOST_AI_PAIRING_STALE` to the UI.
   */
  return { block: false }
}

export function shouldSkipAllHostAiProbesForHandshake(handshakeId: string, peerHostDeviceId: string): boolean {
  return hostAiPairingListBlock(handshakeId, peerHostDeviceId).block
}

export function isHostAiLedgerAsymmetricTerminal(handshakeId: string, peerHostDeviceId: string): boolean {
  const b = hostAiPairingListBlock(handshakeId, peerHostDeviceId)
  return b.block && b.code === InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC
}
