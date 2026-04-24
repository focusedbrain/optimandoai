import { describe, it, expect } from 'vitest'
import {
  formatInternalBeapTargetSummary,
  formatInternalListSubtitle,
  formatInternalPairingIdLine,
  formatInternalPrimaryLine,
  formatPairingCodeForDisplay,
} from './internalIdentityUi'
import type { InternalIdentitySource } from './internalIdentityUi'

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
