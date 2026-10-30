// @vitest-environment jsdom
/**
 * HC5 in the accept dialog: a staged Connect offer shows the preview main
 * hashed, and the accept returns exactly that hash. A record without a preview
 * accepts as before.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const acceptHandshake = vi.fn()
vi.mock('@ext/handshake/handshakeRpc', () => ({ acceptHandshake: (...args: unknown[]) => acceptHandshake(...args) }))
vi.mock('@ext/handshake/components/HandshakeContextProfilePicker', () => ({ HandshakeContextProfilePicker: () => null }))

import AcceptHandshakeModal from './AcceptHandshakeModal'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HASH = 'c0ffee'.padEnd(64, '0')

const PREVIEW = {
  offer_id: 'offer-1',
  handshake_id: 'hs-1',
  bound_definition: {
    sender_email: 'sender@test.com',
    sender_iss: 'iss',
    sender_sub: 'sub',
    sender_wrdesk_user_id: 'sender-001',
    receiver_email: 'receiver@test.com',
    profile_id: 'legacy_v0',
    publisher_domain_verified: false,
  },
  scopes: [],
  external_processing: 'none',
  reciprocal_allowed: true,
  ingress_path: 'beap_invitation',
  staged_at: '2026-09-25T10:00:00.000Z',
  expires_at: '2026-10-02T10:00:00.000Z',
  entry: {
    wr_code_canonical: '',
    publisher_part: '',
    entry_local_part: '',
    entry_status: '',
    umbrella_handshake_id: '',
    catalog_epoch: 0,
    evp_ref: '',
    value_statement: '',
  },
  resolution_mode: '',
  session_bound_expires_at: '',
}

function record(extra: Record<string, unknown> = {}) {
  return {
    handshake_id: 'hs-1',
    state: 'PENDING_REVIEW',
    initiator: { email: 'sender@test.com', wrdesk_user_id: 'sender-001' },
    acceptor: null,
    local_role: 'acceptor' as const,
    receiver_email: 'receiver@test.com',
    ...extra,
  }
}

let container: HTMLDivElement
let root: Root

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function render(rec: ReturnType<typeof record>): Promise<void> {
  await act(async () => {
    root.render(<AcceptHandshakeModal record={rec} onClose={() => {}} onSuccess={() => {}} />)
  })
  await flush()
}

function acceptButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Accept')
  if (!btn) throw new Error('Accept button not found')
  return btn as HTMLButtonElement
}

beforeEach(() => {
  acceptHandshake.mockReset()
  ;(window as unknown as { handshakeView: unknown }).handshakeView = {
    getVaultStatus: async () => ({ isUnlocked: true, name: 'Vault', email: 'receiver@test.com' }),
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

describe('AcceptHandshakeModal — staged Connect offer preview (HC5)', () => {
  it('shows what the user agrees to and returns the preview hash with the accept', async () => {
    acceptHandshake.mockResolvedValue({ success: true })
    await render(record({ connect_offer_id: 'offer-1', connect_offer_preview: { preview: PREVIEW, preview_hash: HASH } }))

    const section = container.querySelector('[data-testid="connect-offer-preview"]')
    expect(section?.textContent).toContain('What you are agreeing to')
    expect(section?.textContent).toContain('sender@test.com')
    expect(section?.textContent).toContain('2026-10-02 10:00 UTC')

    await act(async () => acceptButton().click())
    await flush()
    expect(acceptHandshake).toHaveBeenCalledTimes(1)
    expect(acceptHandshake.mock.calls[0][0]).toBe('hs-1')
    expect(acceptHandshake.mock.calls[0][3]).toMatchObject({ expected_preview_hash: HASH })
  })

  it('explains a preview mismatch in plain language', async () => {
    acceptHandshake.mockResolvedValue({ success: false, reason: 'PREVIEW_HASH_MISMATCH', error: 'PREVIEW_HASH_MISMATCH' })
    await render(record({ connect_offer_id: 'offer-1', connect_offer_preview: { preview: PREVIEW, preview_hash: HASH } }))

    await act(async () => acceptButton().click())
    await flush()
    expect(container.textContent).toContain('This request changed after you opened it.')
    expect(container.textContent).not.toContain('PREVIEW_HASH_MISMATCH')
  })

  it('an existing record without a preview accepts without a hash and shows no preview', async () => {
    acceptHandshake.mockResolvedValue({ success: true })
    await render(record())

    expect(container.querySelector('[data-testid="connect-offer-preview"]')).toBeNull()
    await act(async () => acceptButton().click())
    await flush()
    expect(acceptHandshake.mock.calls[0][3]).not.toHaveProperty('expected_preview_hash')
  })
})
