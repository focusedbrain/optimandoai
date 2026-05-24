/**
 * interceptClick — P2.7 unit tests.
 * Pure function, no JSDOM needed.
 */

import { describe, it, expect } from 'vitest'
import { interceptClick } from '../safeLinks'

const MSG_ID = 'msg-001'

describe('interceptClick', () => {
  // ── No AI analysis ──────────────────────────────────────────────────────────

  it('returns sandbox default when no ai_analysis is provided', () => {
    const d = interceptClick('https://example.com/path', { message_id: MSG_ID })
    expect(d.action).toBe('open_in_sandbox')
    expect(d.reason).toBe('all_links_default_to_sandbox')
    expect(d.requiresCredentialAck).toBe(false)
    expect(d.flaggedUrl).toBeUndefined()
  })

  it('returns sandbox default when ai_analysis has no phishing_assessment', () => {
    const d = interceptClick('https://example.com/', { message_id: MSG_ID, ai_analysis: {} })
    expect(d.action).toBe('open_in_sandbox')
    expect(d.requiresCredentialAck).toBe(false)
  })

  it('returns sandbox default when phishing_assessment has empty flagged_urls', () => {
    const d = interceptClick('https://example.com/', {
      message_id: MSG_ID,
      ai_analysis: { phishing_assessment: { flagged_urls: [] } },
    })
    expect(d.action).toBe('open_in_sandbox')
    expect(d.requiresCredentialAck).toBe(false)
    expect(d.flaggedUrl).toBeUndefined()
  })

  // ── Unflagged URL ────────────────────────────────────────────────────────────

  it('returns sandbox default for an unflagged URL even with other flagged URLs present', () => {
    const d = interceptClick('https://safe.example.com/', {
      message_id: MSG_ID,
      ai_analysis: {
        phishing_assessment: {
          flagged_urls: [{ url: 'https://phish.example.com/', reason: 'domain spoof' }],
        },
      },
    })
    expect(d.action).toBe('open_in_sandbox')
    expect(d.reason).toBe('all_links_default_to_sandbox')
    expect(d.flaggedUrl).toBeUndefined()
    expect(d.requiresCredentialAck).toBe(false)
  })

  // ── Flagged URL (non-credential) ─────────────────────────────────────────────

  it('attaches flaggedUrl for an exact-match flagged URL with non-credential reason', () => {
    const flagged = { url: 'https://phish.example.com/verify', reason: 'domain spoof', open_policy: 'warn' }
    const d = interceptClick('https://phish.example.com/verify', {
      message_id: MSG_ID,
      ai_analysis: { phishing_assessment: { flagged_urls: [flagged] } },
    })
    expect(d.action).toBe('open_in_sandbox')
    expect(d.reason).toBe('url_flagged')
    expect(d.flaggedUrl).toEqual(flagged)
    expect(d.requiresCredentialAck).toBe(false)
  })

  it('matches flagged URL with trailing-slash normalization', () => {
    const d = interceptClick('https://phish.example.com/verify/', {
      message_id: MSG_ID,
      ai_analysis: {
        phishing_assessment: {
          flagged_urls: [{ url: 'https://phish.example.com/verify', reason: 'domain spoof' }],
        },
      },
    })
    expect(d.flaggedUrl).toBeDefined()
    expect(d.requiresCredentialAck).toBe(false)
  })

  // ── Credential-request flagged URL ───────────────────────────────────────────

  it('sets requiresCredentialAck for a URL flagged with "credential" in reason', () => {
    const d = interceptClick('https://fake-bank.net/login', {
      message_id: MSG_ID,
      ai_analysis: {
        phishing_assessment: {
          flagged_urls: [{ url: 'https://fake-bank.net/login', reason: 'credential harvest page' }],
        },
      },
    })
    expect(d.action).toBe('open_in_sandbox')
    expect(d.reason).toBe('credential_request_flagged')
    expect(d.requiresCredentialAck).toBe(true)
    expect(d.flaggedUrl).toBeDefined()
  })

  it('sets requiresCredentialAck for a URL with open_policy "credential_request"', () => {
    const d = interceptClick('https://fake-bank.net/verify', {
      message_id: MSG_ID,
      ai_analysis: {
        phishing_assessment: {
          flagged_urls: [
            {
              url: 'https://fake-bank.net/verify',
              reason: 'suspicious domain',
              open_policy: 'credential_request',
            },
          ],
        },
      },
    })
    expect(d.reason).toBe('credential_request_flagged')
    expect(d.requiresCredentialAck).toBe(true)
  })

  it('sets requiresCredentialAck for a URL with "phish" in reason', () => {
    const d = interceptClick('https://evil.co/steal', {
      message_id: MSG_ID,
      ai_analysis: {
        phishing_assessment: {
          flagged_urls: [{ url: 'https://evil.co/steal', reason: 'classic phishing page' }],
        },
      },
    })
    expect(d.requiresCredentialAck).toBe(true)
  })

  it('sets requiresCredentialAck for a URL with "login" in reason', () => {
    const d = interceptClick('https://evil.co/auth', {
      message_id: MSG_ID,
      ai_analysis: {
        phishing_assessment: {
          flagged_urls: [{ url: 'https://evil.co/auth', reason: 'fake login form' }],
        },
      },
    })
    expect(d.requiresCredentialAck).toBe(true)
  })

  it('does NOT set requiresCredentialAck for a generic warning reason without keywords', () => {
    const d = interceptClick('https://sketchy.biz/', {
      message_id: MSG_ID,
      ai_analysis: {
        phishing_assessment: {
          flagged_urls: [{ url: 'https://sketchy.biz/', reason: 'recently registered domain' }],
        },
      },
    })
    expect(d.requiresCredentialAck).toBe(false)
    expect(d.reason).toBe('url_flagged')
  })
})
