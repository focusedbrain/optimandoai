/**
 * B2.1 (D5.2) — inline-parse guard tests.
 *
 * Proves the runtime embodiment of invariant-0:
 *   - flag OFF → the guard is inert (zero behavior change).
 *   - flag ON  → reaching an inline-parse entry point throws the typed
 *                E_INLINE_PARSE_FORBIDDEN (→ quarantine via the mapping table).
 *   - the seam's legitimate carrier re-entry (viaSeam) is NOT blocked.
 *
 * The forced-inline cases exercise the guard at the very first statement of
 * `detectAndRouteMessageInline`, before any DB access — so no real DB is needed.
 */

import { describe, test, expect, afterEach } from 'vitest'
import { assertNoInlineParse, InlineParseForbiddenError, INLINE_PARSE_FORBIDDEN_CODE } from '../inlineParseGuard'
import { detectAndRouteMessageInline } from '../messageRouter'
import type { RawEmailMessage } from '../messageRouter'

const FLAG = 'WRDESK_SEAM_DEPACKAGE_CUTOVER'
function setFlag(on: boolean) {
  if (on) process.env[FLAG] = 'true'
  else delete process.env[FLAG]
}
afterEach(() => setFlag(false))

const rawMsg: RawEmailMessage = {
  id: 'm1',
  subject: 'x',
  from: { address: 'a@b.c' } as any,
  to: [],
  text: 'hello',
} as any

describe('D5.2 — assertNoInlineParse (pure)', () => {
  test('flag OFF → inert (no throw)', () => {
    setFlag(false)
    expect(() => assertNoInlineParse('any.entry')).not.toThrow()
  })

  test('flag ON → throws typed E_INLINE_PARSE_FORBIDDEN with entry point', () => {
    setFlag(true)
    try {
      assertNoInlineParse('gateway.htmlToText')
      throw new Error('expected guard to fire')
    } catch (err) {
      expect(err).toBeInstanceOf(InlineParseForbiddenError)
      expect((err as InlineParseForbiddenError).code).toBe(INLINE_PARSE_FORBIDDEN_CODE)
      expect((err as InlineParseForbiddenError).code).toBe('E_INLINE_PARSE_FORBIDDEN')
      expect((err as InlineParseForbiddenError).entryPoint).toBe('gateway.htmlToText')
    }
  })
})

describe('B2.2 — header-parse surface (completes invariant-0)', () => {
  // The guard now covers body, classification, AND headers. These are the
  // header-parse entry points wired in B2.2 (imap simpleParser, gmail header
  // walk); flag-on, reaching any of them fails closed.
  const HEADER_ENTRY_POINTS = [
    'imap.fetchMessageFromFolder.simpleParser',
    'gmail.parseGmailMessage.headers',
  ]

  test('flag OFF → header entry points are inert', () => {
    setFlag(false)
    for (const ep of HEADER_ENTRY_POINTS) {
      expect(() => assertNoInlineParse(ep)).not.toThrow()
    }
  })

  test('flag ON → each header entry point fails closed with its name', () => {
    setFlag(true)
    for (const ep of HEADER_ENTRY_POINTS) {
      try {
        assertNoInlineParse(ep)
        throw new Error(`expected guard to fire for ${ep}`)
      } catch (err) {
        expect(err).toBeInstanceOf(InlineParseForbiddenError)
        expect((err as InlineParseForbiddenError).entryPoint).toBe(ep)
      }
    }
  })
})

describe('D5.2 — messageRouter inline entry guard', () => {
  test('flag ON + forced inline (viaSeam=false) → fails closed via guard', async () => {
    setFlag(true)
    await expect(
      detectAndRouteMessageInline({} as any, 'acct', rawMsg, null, false),
    ).rejects.toBeInstanceOf(InlineParseForbiddenError)
  })

  test('flag ON + seam carrier re-entry (viaSeam=true) → guard does NOT fire', async () => {
    setFlag(true)
    // Bypasses the guard, then proceeds past it (and ultimately fails on the dummy
    // DB) — the point is the rejection is NOT the inline-parse guard.
    await expect(
      detectAndRouteMessageInline({} as any, 'acct', rawMsg, null, true),
    ).rejects.not.toBeInstanceOf(InlineParseForbiddenError)
  })
})
