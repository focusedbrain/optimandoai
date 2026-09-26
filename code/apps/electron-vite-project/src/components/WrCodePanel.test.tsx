// @vitest-environment jsdom
/**
 * WR Code panel (S2b): renders main's view model and never holds a §XVI.8.4
 * reservation longer than the offer is on screen — a new check, closing the
 * panel, or leaving the message declines an open offer; accepting does not.
 * The scan affordance exists only when main allows scanning (HC2, W5).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WrCodePanel } from './WrCodePanel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OFFER = {
  kind: 'offer',
  class_label: 'Publisher offering',
  offer: {
    publisher_part: 'TEST01',
    verified_domain: 'publisher-a.test',
    publisher_domain_verified: true,
    entry_local_part: '10001',
    code_display: 'P-TEST01-10001N',
    value_statement: 'Signed value statement.',
    self_description: 'Signed self description.',
    scope_directory: [],
    next_steps: [],
    audit_url: null,
    catalog_epoch: 1,
    resolution_mode: 'public',
    session_bound: false,
    stale: false,
    suspension: null,
  },
}

let calls: Array<{ method: string; params: Record<string, unknown> }>
let scanAllowed: boolean
let tokens: number

beforeEach(() => {
  calls = []
  scanAllowed = true
  tokens = 0
  ;(window as unknown as { handshakeView: unknown }).handshakeView = {
    vaultRpc: async ({ method, params }: { method: string; params: Record<string, unknown> }) => {
      calls.push({ method, params })
      switch (method) {
        case 'wrc.runtimeStatus':
          return { success: true, result: { flavor: 'wrc-test', configured: true, testRegistry: true } }
        case 'wrc.scanMessage':
          return { success: true, result: { scanAllowed, detections: [] } }
        case 'wrc.captureReference':
          return { success: true, result: { ok: false, reason: 'wrong_length' } }
        case 'wrc.submitReference':
          return { success: true, result: {}, view: OFFER, acceptanceToken: `tok-${++tokens}` }
        case 'wrc.acceptReference':
          return { success: true, result: { accepted: true, consumed: false } }
        case 'wrc.declineReference':
          return { success: true, result: { declined: true } }
      }
      return { success: false, error: 'unexpected' }
    },
  }
})

let container: HTMLDivElement
let root: Root

async function mount(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<WrCodePanel messageId="m1" onClose={() => {}} />)
  })
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement

async function typeAndCheck(value: string): Promise<void> {
  const input = container.querySelector('input') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    button('Check').click()
  })
}

const declines = () => calls.filter((c) => c.method === 'wrc.declineReference').map((c) => c.params.acceptanceToken)

describe('WrCodePanel', () => {
  it('offers the scan only when main allows it', async () => {
    await mount()
    expect(button('Find WR Codes in this message')).toBeTruthy()
    expect(container.textContent).toContain('Test data')
    act(() => root.unmount())
    scanAllowed = false
    await mount()
    expect(button('Find WR Codes in this message')).toBeUndefined()
    expect(container.textContent).toContain('not scanned for WR Codes')
  })

  it('renders the offer from the view model', async () => {
    await mount()
    await typeAndCheck('P-TEST01-10001N')
    expect(container.querySelector('.wrc-offer__statement')?.textContent).toBe('Signed value statement.')
    expect(container.textContent).toContain('publisher-a.test')
  })

  it('a new check declines the offer still open', async () => {
    await mount()
    await typeAndCheck('P-TEST01-10001N')
    await typeAndCheck('P-TEST01-10001N')
    expect(declines()).toEqual(['tok-1'])
  })

  it('leaving the panel declines an open offer', async () => {
    await mount()
    await typeAndCheck('P-TEST01-10001N')
    act(() => root.unmount())
    expect(declines()).toEqual(['tok-1'])
    await mount()
  })

  it('an accepted offer is not declined afterwards', async () => {
    await mount()
    await typeAndCheck('P-TEST01-10001N')
    await act(async () => {
      button('Accept').click()
    })
    expect(container.textContent).toContain('Accepted.')
    act(() => root.unmount())
    expect(declines()).toEqual([])
    await mount()
  })
})
