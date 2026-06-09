/**
 * Prompt 1 — host-inertness decision (`isOpaqueIngestionActive`) + the inline-parse
 * tripwire it arms. Proves:
 *   - default (no flag, no linked topology) → inactive → tripwire inert (legacy path);
 *   - explicit `WRDESK_SEAM_DEPACKAGE_CUTOVER` → active → tripwire throws;
 *   - an active linked-sandbox topology (the cutover DEFAULT, via
 *     `WRDESK_TOPOLOGY_LINKED`) → active with NO flag → tripwire throws.
 *
 * The tripwire firing is the "a parse attempt on the host throws" guarantee: every
 * host-side parser (`simpleParser`, `parseGmailMessage`, `parseOutlookMessage`)
 * calls `assertNoInlineParse` before touching bytes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isOpaqueIngestionActive,
  hasLinkedDepackageSandbox,
  __resetOpaqueIngestionCacheForTests,
} from '../opaqueIngestion'
import { assertNoInlineParse, InlineParseForbiddenError } from '../inlineParseGuard'

const FLAG = 'WRDESK_SEAM_DEPACKAGE_CUTOVER'
const TOPO = 'WRDESK_TOPOLOGY_LINKED'

function clearEnv() {
  delete process.env[FLAG]
  delete process.env[TOPO]
  __resetOpaqueIngestionCacheForTests()
}

describe('isOpaqueIngestionActive — host-inertness decision', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('default (no flag, no linked topology) → inactive; tripwire is inert', () => {
    expect(isOpaqueIngestionActive()).toBe(false)
    expect(hasLinkedDepackageSandbox()).toBe(false)
    // Legacy/non-isolated path: the guard does nothing (parsing permitted).
    expect(() => assertNoInlineParse('test.site')).not.toThrow()
  })

  it('explicit cutover flag → active; tripwire throws', () => {
    process.env[FLAG] = '1'
    expect(isOpaqueIngestionActive()).toBe(true)
    expect(() => assertNoInlineParse('test.site')).toThrowError(InlineParseForbiddenError)
  })

  it('linked-sandbox topology (cutover DEFAULT, NO flag) → active; tripwire throws', () => {
    process.env[TOPO] = JSON.stringify([
      { role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['depackage-email'] },
    ])
    __resetOpaqueIngestionCacheForTests()
    expect(process.env[FLAG]).toBeUndefined()
    expect(hasLinkedDepackageSandbox()).toBe(true)
    expect(isOpaqueIngestionActive()).toBe(true)
    expect(() => assertNoInlineParse('test.site')).toThrowError(InlineParseForbiddenError)
  })

  it('linked topology that does NOT route email depackaging → inactive', () => {
    process.env[TOPO] = JSON.stringify([
      { role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['validate-native-beap'] },
    ])
    __resetOpaqueIngestionCacheForTests()
    expect(isOpaqueIngestionActive()).toBe(false)
  })
})
