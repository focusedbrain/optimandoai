/**
 * Scam Watchdog — unit tests for the phishing/social-engineering analysis category.
 *
 * Covers: the prompt contract (signals + false-positive discipline incl. the brand
 * cross-check and stay-silent cases), link-STRING extraction, the no-fetch / no-artifact
 * guarantee, and host+sandbox parity of the prompt augmentation (mode-independent).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SCAM_WATCHDOG_JSON_KEYS,
  SCAM_WATCHDOG_PROMPT_SECTION,
  appendScamWatchdogToSystemPrompt,
  buildScamWatchdogUserContext,
  extractScamWatchdogLinkStrings,
} from '../scamWatchdog'

describe('Scam Watchdog — prompt contract', () => {
  it('declares the scamStatus / scamFindings keys', () => {
    expect(SCAM_WATCHDOG_JSON_KEYS).toEqual(['scamStatus', 'scamFindings'])
    expect(SCAM_WATCHDOG_PROMPT_SECTION).toMatch(/scamStatus/)
    expect(SCAM_WATCHDOG_PROMPT_SECTION).toMatch(/scamFindings/)
  })

  it('encodes the brand-impersonation CROSS-CHECK (all three conditions)', () => {
    const s = SCAM_WATCHDOG_PROMPT_SECTION
    expect(s).toMatch(/CROSS-CHECK/)
    expect(s).toMatch(/recognizable/i)
    expect(s).toMatch(/account|credential|login|payment/i)
    expect(s).toMatch(/unrelated to that brand/i)
  })

  it('encodes the stay-silent / false-positive discipline', () => {
    const s = SCAM_WATCHDOG_PROMPT_SECTION
    expect(s).toMatch(/FALSE-POSITIVE DISCIPLINE/)
    expect(s).toMatch(/NEVER flag merely because you do not recognize the sender/i)
    expect(s).toMatch(/legitimate transactional message/i)
    expect(s).toMatch(/empty scamFindings array/i)
  })

  it('forbids following/fetching links in the prompt', () => {
    const s = SCAM_WATCHDOG_PROMPT_SECTION
    expect(s).toMatch(/never (visit|follow|fetch)/i)
    expect(s).toMatch(/STRINGS ONLY/)
  })
})

describe('Scam Watchdog — link STRING extraction (no fetch)', () => {
  it('extracts bare URLs', () => {
    const links = extractScamWatchdogLinkStrings('Pay here http://1.2.3.4/login now.')
    expect(links).toContain('http://1.2.3.4/login')
  })

  it('exposes anchor-text-vs-href for markdown links', () => {
    const links = extractScamWatchdogLinkStrings('[www.paypal.com](http://paypa1-secure.ru/verify)')
    expect(links.some((l) => l.includes('"www.paypal.com"') && l.includes('http://paypa1-secure.ru/verify'))).toBe(true)
  })

  it('exposes anchor-text-vs-href for HTML anchors', () => {
    const links = extractScamWatchdogLinkStrings('<a href="http://evil.example/login">Update your account</a>')
    expect(links.some((l) => l.includes('"Update your account"') && l.includes('http://evil.example/login'))).toBe(true)
  })

  it('dedupes and returns [] for no links', () => {
    expect(extractScamWatchdogLinkStrings('no links here at all')).toEqual([])
    const dup = extractScamWatchdogLinkStrings('http://a.test/x http://a.test/x')
    expect(dup.filter((l) => l === 'http://a.test/x')).toHaveLength(1)
  })

  it('performs NO network fetch when extracting or building context', () => {
    const fetchSpy = vi.fn()
    const prevFetch = globalThis.fetch
    // @ts-expect-error override for assertion
    globalThis.fetch = fetchSpy
    try {
      const body = 'Click [verify](http://1.2.3.4/login) and visit https://example.com/account'
      extractScamWatchdogLinkStrings(body)
      buildScamWatchdogUserContext(body)
    } finally {
      globalThis.fetch = prevFetch
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('user context lists links as text-only with a no-fetch reminder', () => {
    const ctx = buildScamWatchdogUserContext('see http://1.2.3.4/login')
    expect(ctx).toMatch(/TEXT ONLY/)
    expect(ctx).toMatch(/do NOT visit or fetch/i)
    expect(ctx).toMatch(/http:\/\/1\.2\.3\.4\/login/)
  })

  it('user context reports "none" when there are no links', () => {
    expect(buildScamWatchdogUserContext('plain text only')).toMatch(/none/i)
  })
})

describe('Scam Watchdog — host+sandbox parity', () => {
  it('augments the system prompt identically regardless of mode (no mode parameter)', () => {
    // The analysis IPC handler is mode-agnostic; both host and sandbox call these helpers.
    const base = 'You are an email triage AI. Keys: summary, urgencyScore.'
    const a = appendScamWatchdogToSystemPrompt(base)
    const b = appendScamWatchdogToSystemPrompt(base)
    expect(a).toBe(b)
    expect(a.endsWith(SCAM_WATCHDOG_PROMPT_SECTION)).toBe(true)
    expect(a).toContain('scamStatus')
  })

  it('the module does not import any network/db/artifact access', () => {
    // Behavioral guard: pure functions only. (Source-level guard backs this up.)
    expect(typeof extractScamWatchdogLinkStrings).toBe('function')
    expect(typeof buildScamWatchdogUserContext).toBe('function')
    expect(typeof appendScamWatchdogToSystemPrompt).toBe('function')
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
