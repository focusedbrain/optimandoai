import { describe, it, expect } from 'vitest'
import {
  deriveInternalHandshakeRoles,
  formatInternalBeapTargetSummary,
  formatInternalListSubtitle,
  formatInternalPairingIdLine,
  formatInternalPrimaryLine,
  formatPairingCodeForDisplay,
} from './internalIdentityUi'
import type { InternalHandshakeRoleSource, InternalIdentitySource } from './internalIdentityUi'

const base: InternalIdentitySource = {
  handshake_type: 'internal',
  local_role: 'initiator',
  initiator_device_role: 'host',
  acceptor_device_role: 'sandbox',
  initiator_device_name: 'Host-PC',
  acceptor_device_name: 'Box',
  internal_peer_computer_name: 'WORKSTATION-01',
  internal_peer_pairing_code: '123456',
  initiator_coordination_device_id: 'uuid-init',
  acceptor_coordination_device_id: 'uuid-acc',
  internal_peer_device_id: null,
}

describe('formatPairingCodeForDisplay', () => {
  it('formats 6 digits as 000-000', () => {
    expect(formatPairingCodeForDisplay('123456')).toBe('123-456')
    expect(formatPairingCodeForDisplay('12-34-56')).toBe('123-456') // normalizes
  })
  it('returns null for invalid', () => {
    expect(formatPairingCodeForDisplay('12345')).toBeNull()
    expect(formatPairingCodeForDisplay(null)).toBeNull()
  })
})

describe('internal display (host viewing sandbox as peer)', () => {
  it('primary line uses computer name and peer orchestrator (sandbox)', () => {
    const line = formatInternalPrimaryLine(base)
    expect(line).toBe('WORKSTATION-01 — Sandbox orchestrator')
  })

  it('pairing id line', () => {
    expect(formatInternalPairingIdLine(base)).toBe('ID: 123-456')
  })

  it('list subtitle is primary only (no uuid)', () => {
    const s = formatInternalListSubtitle(base)
    expect(s).toBe('WORKSTATION-01 — Sandbox orchestrator')
    expect(s).not.toMatch(/[0-9a-f-]{8,}/i) // not a long uuid
  })

  it('formatInternalListSubtitle is computer name + em dash + peer orchestrator label (user-facing row copy)', () => {
    const s = formatInternalListSubtitle(base)
    expect(s).toMatch(/ — /)
    expect(s).toMatch(/(Host|Sandbox) orchestrator/)
  })

  it('beap target combines primary and id', () => {
    expect(formatInternalBeapTargetSummary(base)).toBe(
      'WORKSTATION-01 — Sandbox orchestrator — ID: 123-456',
    )
  })
})

describe('sandbox viewing host (acceptor local_role)', () => {
  it('peer is host; computer name from initiator', () => {
    const r: InternalIdentitySource = {
      ...base,
      local_role: 'acceptor',
      internal_peer_computer_name: 'HOST-DEV',
    }
    expect(formatInternalPrimaryLine(r)).toBe('HOST-DEV — Host orchestrator')
  })
})

describe('no pairing code', () => {
  it('omits id line from beap summary', () => {
    const r: InternalIdentitySource = { ...base, internal_peer_pairing_code: null }
    expect(formatInternalPairingIdLine(r)).toBeNull()
    expect(formatInternalBeapTargetSummary(r)).toBe('WORKSTATION-01 — Sandbox orchestrator')
  })
})

const activeInternal = (over: Partial<InternalHandshakeRoleSource> = {}): InternalHandshakeRoleSource => ({
  handshake_type: 'internal',
  state: 'ACTIVE',
  local_role: 'initiator',
  initiator_device_role: 'sandbox',
  acceptor_device_role: 'host',
  initiator_device_name: 'Laptop',
  acceptor_device_name: 'Konge-AS1',
  internal_peer_computer_name: 'HOST-ALT',
  internal_peer_pairing_code: '482917',
  initiator_coordination_device_id: 'coord-init-uuid-aaaa',
  acceptor_coordination_device_id: 'coord-acc-uuid-bbbb',
  internal_peer_device_id: null,
  ...over,
})

describe('deriveInternalHandshakeRoles', () => {
  it('local initiator sandbox, peer host — ACTIVE internal', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({
        local_role: 'initiator',
        initiator_device_role: 'sandbox',
        acceptor_device_role: 'host',
        initiator_device_name: 'My Sandbox',
        acceptor_device_name: 'The Host',
        internal_peer_pairing_code: '12-34-56',
      }),
    )
    expect(d.isInternal).toBe(true)
    expect(d.localDeviceRole).toBe('sandbox')
    expect(d.peerDeviceRole).toBe('host')
    expect(d.localDeviceName).toBe('My Sandbox')
    expect(d.peerDeviceName).toBe('The Host')
    expect(d.peerPairingCode).toBe('123456')
    expect(d.isLocalSandboxPeerHost).toBe(true)
    expect(d.isLocalHostPeerSandbox).toBe(false)
  })

  it('local acceptor sandbox, peer host', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({
        local_role: 'acceptor',
        acceptor_device_role: 'sandbox',
        initiator_device_role: 'host',
        acceptor_device_name: 'This Sandbox',
        initiator_device_name: 'Home PC',
        internal_peer_computer_name: 'fallback if initiator name empty',
      }),
    )
    expect(d.localDeviceRole).toBe('sandbox')
    expect(d.peerDeviceRole).toBe('host')
    expect(d.localDeviceName).toBe('This Sandbox')
    expect(d.peerDeviceName).toBe('Home PC')
    expect(d.isLocalSandboxPeerHost).toBe(true)
    expect(d.isLocalHostPeerSandbox).toBe(false)
  })

  it('local host, peer sandbox', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({
        local_role: 'initiator',
        initiator_device_role: 'host',
        acceptor_device_role: 'sandbox',
        initiator_device_name: 'Konge',
        acceptor_device_name: 'Laptop S',
      }),
    )
    expect(d.localDeviceRole).toBe('host')
    expect(d.peerDeviceRole).toBe('sandbox')
    expect(d.isLocalSandboxPeerHost).toBe(false)
    expect(d.isLocalHostPeerSandbox).toBe(true)
  })

  it('peer name falls back to internal_peer_computer_name', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({
        local_role: 'initiator',
        acceptor_device_name: null,
        internal_peer_computer_name: 'PEER-ONLY',
      }),
    )
    expect(d.peerDeviceName).toBe('PEER-ONLY')
  })

  it('missing role fields yield null roles and no role flags', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({
        initiator_device_role: undefined,
        acceptor_device_role: undefined,
      }),
    )
    expect(d.localDeviceRole).toBeNull()
    expect(d.peerDeviceRole).toBeNull()
    expect(d.isLocalSandboxPeerHost).toBe(false)
    expect(d.isLocalHostPeerSandbox).toBe(false)
  })

  it('invalid role strings normalize to null', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({
        initiator_device_role: 'host',
        acceptor_device_role: 'nope' as any,
        local_role: 'initiator',
      }),
    )
    expect(d.peerDeviceRole).toBeNull()
  })

  it('external (non-internal) handshake: not internal, flags false', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({
        handshake_type: 'standard',
        initiator_device_role: 'sandbox',
        acceptor_device_role: 'host',
      }),
    )
    expect(d.isInternal).toBe(false)
    expect(d.isLocalSandboxPeerHost).toBe(false)
    expect(d.isLocalHostPeerSandbox).toBe(false)
  })

  it('ACTIVE required for isLocalSandboxPeerHost / isLocalHostPeerSandbox', () => {
    const d = deriveInternalHandshakeRoles(
      activeInternal({ state: 'PENDING_ACCEPT', initiator_device_role: 'sandbox', acceptor_device_role: 'host' }),
    )
    expect(d.isInternal).toBe(true)
    expect(d.localDeviceRole).toBe('sandbox')
    expect(d.peerDeviceRole).toBe('host')
    expect(d.isLocalSandboxPeerHost).toBe(false)
    expect(d.isLocalHostPeerSandbox).toBe(false)
  })

  it('non–six-digit pairing code yields null peerPairingCode (no spurious id)', () => {
    const d = deriveInternalHandshakeRoles(activeInternal({ internal_peer_pairing_code: '12345' }))
    expect(d.peerPairingCode).toBeNull()
  })
})
