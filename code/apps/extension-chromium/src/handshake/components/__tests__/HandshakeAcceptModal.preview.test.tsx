// @vitest-environment jsdom
/**
 * HC5 in the extension's accept dialog: a staged Connect offer shows the
 * preview main hashed and the accept returns that hash. A refused accept
 * (`success: false`) stays in the dialog with plain-language copy; it is never
 * reported as accepted.
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const acceptHandshake = vi.fn()
vi.mock('../../handshakeRpc', () => ({
  acceptHandshake: (...args: unknown[]) => acceptHandshake(...args),
  revokeHandshake: vi.fn(),
}))
vi.mock('../../../vault/api', () => ({ getVaultStatus: async () => ({ isUnlocked: true }) }))
vi.mock('../HandshakeContextProfilePicker', () => ({ HandshakeContextProfilePicker: () => null }))
vi.mock('../../buildInitiateContextOptions', () => ({ buildAcceptContextOptions: async () => ({}) }))

import { HandshakeAcceptModal } from '../HandshakeAcceptModal'
import type { HandshakeRecord } from '../../rpcTypes'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HASH = 'be'.repeat(32)
const PREVIEW = {
  bound_definition: {
    sender_email: 'anna@partner-firm.example',
    receiver_email: 'oscar@example.org',
    profile_id: 'legacy_v0',
    publisher_domain_verified: false,
  },
  scopes: [],
  external_processing: 'none',
  reciprocal_allowed: true,
  expires_at: '2026-10-03T17:28:00.000Z',
  entry: { wr_code_canonical: '', value_statement: '' },
  session_bound_expires_at: '',
}

function handshake(extra: Partial<HandshakeRecord> = {}): HandshakeRecord {
  return {
    handshake_id: 'hs-ext-1',
    state: 'PENDING_REVIEW',
    local_role: 'acceptor',
    counterparty_email: 'anna@partner-firm.example',
    counterparty_user_id: 'sender-001',
    relationship_id: '',
    created_at: '2026-09-26T17:28:00.000Z',
    receiver_email: 'oscar@example.org',
    ...extra,
  } as HandshakeRecord
}

let container: HTMLDivElement
let root: Root
let accepted: string[]

async function render(hs: HandshakeRecord): Promise<void> {
  await act(async () => {
    root.render(<HandshakeAcceptModal handshake={hs} fromAccountId="acct-1" onAccepted={(id) => accepted.push(id)} />)
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function clickAccept(): Promise<void> {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Accept Handshake'))
  if (!btn) throw new Error('Accept button not found')
  await act(async () => {
    btn.click()
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  acceptHandshake.mockReset()
  accepted = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('HandshakeAcceptModal — staged Connect offer preview (HC5)', () => {
  it('shows what the user agrees to and sends the preview hash with the accept', async () => {
    acceptHandshake.mockResolvedValue({ success: true, handshake_id: 'hs-ext-1' })
    await render(handshake({ connect_offer_id: 'offer-1', connect_offer_preview: { preview: PREVIEW, preview_hash: HASH } }))

    const section = container.querySelector('[data-testid="connect-offer-preview"]')
    expect(section?.textContent).toContain('What you are agreeing to')
    expect(section?.textContent).toContain('oscar@example.org')

    await clickAccept()
    expect(acceptHandshake.mock.calls[0]![3]).toMatchObject({ expected_preview_hash: HASH })
    expect(accepted).toEqual(['hs-ext-1'])
  })

  it('a refused accept stays in the dialog with plain-language copy', async () => {
    acceptHandshake.mockResolvedValue({ success: false, reason: 'PREVIEW_HASH_MISMATCH', error: 'PREVIEW_HASH_MISMATCH' })
    await render(handshake({ connect_offer_id: 'offer-1', connect_offer_preview: { preview: PREVIEW, preview_hash: HASH } }))

    await clickAccept()
    expect(accepted).toEqual([])
    expect(container.textContent).toContain('This request changed after you opened it.')
  })

  it('a record without a preview shows none and sends no hash', async () => {
    acceptHandshake.mockResolvedValue({ success: true, handshake_id: 'hs-ext-1' })
    await render(handshake())

    expect(container.querySelector('[data-testid="connect-offer-preview"]')).toBeNull()
    await clickAccept()
    expect(acceptHandshake.mock.calls[0]![3] ?? {}).not.toHaveProperty('expected_preview_hash')
  })
})
