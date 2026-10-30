/**
 * Phase 4 / 4A exit criteria — acceptance per status, plus the A6 composition.
 *
 * The property that matters is not "each status has a message". It is that the
 * three layers stay separate: admission is conjunctive, the headline is the
 * failing leg closest to the object, every failing leg remains visible, and no
 * enum is merged or extended to make any of that easier.
 */
import { describe, expect, it } from 'vitest'
import { applyExpiryTransition, composeEntryStatus } from '../entryStatusSurface'

const SUSPENSION = { since: 1_754_660_000, reason_code: 'platform_review', reversible: true }

describe('4A — per-status behaviour', () => {
  it('active + published + no suspension → admissible, nothing to surface', () => {
    const c = composeEntryStatus({ publisherStatus: 'active', entryStatus: 'published' })
    expect(c.admissible).toBe(true)
    expect(c.headline).toBeNull()
    expect(c.failing).toHaveLength(0)
    expect(c.unsuppressible_warning).toBe(false)
  })

  it('inactive → "currently not offered", no offer', () => {
    const c = composeEntryStatus({ publisherStatus: 'inactive', entryStatus: 'published' })
    expect(c.admissible).toBe(false)
    expect(c.headline?.reason).toBe('publisher_inactive')
    expect(c.headline?.copy).toMatch(/currently not offering/i)
  })

  it('revoked → plain revocation display, no offer', () => {
    const c = composeEntryStatus({ publisherStatus: 'revoked', entryStatus: 'published' })
    expect(c.admissible).toBe(false)
    expect(c.headline?.reason).toBe('publisher_revoked')
    expect(c.unsuppressible_warning).toBe(false)
  })

  it('superseded → successor SURFACED, never a silent redirect', () => {
    const c = composeEntryStatus({
      publisherStatus: 'superseded',
      entryStatus: 'published',
      successorPublisherPart: 'NEWPUB',
    })
    expect(c.admissible).toBe(false)
    expect(c.headline?.reason).toBe('publisher_superseded')
    expect(c.headline?.successor_publisher_part).toBe('NEWPUB')
    expect(c.successor_publisher_part).toBe('NEWPUB')
    // Surfacing the successor is not offering it: admission is still false, so
    // the successor must complete its own chain before anything proceeds.
    expect(c.admissible).toBe(false)
  })

  it('compromised → treated as revoked PLUS the unsuppressible warning', () => {
    const c = composeEntryStatus({ publisherStatus: 'compromised', entryStatus: 'published' })
    expect(c.admissible).toBe(false)
    expect(c.headline?.reason).toBe('publisher_compromised')
    expect(c.unsuppressible_warning).toBe(true)
  })

  it('every known status produces a status surface (never-fails-silently)', () => {
    for (const s of ['active', 'inactive', 'revoked', 'superseded', 'compromised'] as const) {
      const c = composeEntryStatus({ publisherStatus: s, entryStatus: 'published' })
      if (s === 'active') expect(c.failing).toHaveLength(0)
      else expect(c.failing.length).toBeGreaterThan(0)
    }
  })
})

describe('A6 — three orthogonal layers', () => {
  it('admission is conjunctive and fail-closed', () => {
    expect(composeEntryStatus({ publisherStatus: 'active', entryStatus: 'published' }).admissible).toBe(true)
    expect(composeEntryStatus({ publisherStatus: 'inactive', entryStatus: 'published' }).admissible).toBe(false)
    expect(composeEntryStatus({ publisherStatus: 'active', entryStatus: 'suspended' }).admissible).toBe(false)
    expect(
      composeEntryStatus({ publisherStatus: 'active', entryStatus: 'published', suspension: SUSPENSION })
        .admissible,
    ).toBe(false)
    // No entry fetched cannot satisfy the entry leg.
    expect(composeEntryStatus({ publisherStatus: 'active' }).admissible).toBe(false)
  })

  it('headline is the failing leg CLOSEST to the object', () => {
    const all = composeEntryStatus({
      publisherStatus: 'revoked',
      entryStatus: 'suspended',
      suspension: SUSPENSION,
    })
    expect(all.headline?.layer).toBe('platform')
    // …and every failing leg is still visible, in closeness order.
    expect(all.failing.map((f) => f.layer)).toEqual(['platform', 'entry', 'publisher_part'])
  })

  it('entry outranks publisher-part when there is no platform suspension', () => {
    const c = composeEntryStatus({ publisherStatus: 'revoked', entryStatus: 'retired' })
    expect(c.headline?.layer).toBe('entry')
    expect(c.failing.map((f) => f.layer)).toEqual(['entry', 'publisher_part'])
  })

  it('the two "suspended" statements never conflate', () => {
    const platform = composeEntryStatus({
      publisherStatus: 'active',
      entryStatus: 'published',
      suspension: SUSPENSION,
    })
    const entry = composeEntryStatus({ publisherStatus: 'active', entryStatus: 'suspended' })

    expect(platform.headline?.reason).toBe('platform_suspended')
    expect(entry.headline?.reason).toBe('entry_suspended')
    // Distinct copy per layer — this is the A6.3 requirement, and it is what
    // stops "suspended" from meaning two things on one screen.
    expect(platform.headline?.copy).toMatch(/by the platform/i)
    expect(entry.headline?.copy).toMatch(/by the publisher/i)
    expect(platform.headline?.copy).not.toBe(entry.headline?.copy)
    // A5: the platform record travels with the line, with its audit link.
    expect(platform.headline?.suspension).toEqual(SUSPENSION)
    expect(platform.headline?.audit_link).toBe(true)
  })

  it('no enum is merged or extended', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '..', 'entryStatusSurface.ts'), 'utf8')
    // The module must not invent a combined status type; it composes the three
    // it was given and reports layers.
    expect(src).not.toMatch(/type\s+\w*CombinedStatus/)
    expect(src).not.toMatch(/'active'\s*\|\s*'inactive'[\s\S]{0,80}'suspended'/)
    // Suspension is read from the envelope, never written into a status enum.
    expect(src).toMatch(/WrcEntryStatus/)
    expect(src).toMatch(/WrcPublisherStatus/)
  })
})

describe('4A — expires_at auto-transition', () => {
  const NOW = 2_000

  it('defaults to revoked', () => {
    expect(applyExpiryTransition('active', 1_000, NOW)).toBe('revoked')
  })

  it('honours a publisher-configured transition to inactive', () => {
    expect(applyExpiryTransition('active', 1_000, NOW, 'inactive')).toBe('inactive')
  })

  it('does nothing before the deadline or without one', () => {
    expect(applyExpiryTransition('active', 3_000, NOW)).toBe('active')
    expect(applyExpiryTransition('active', null, NOW)).toBe('active')
    expect(applyExpiryTransition('active', undefined, NOW)).toBe('active')
  })

  it('never resurrects or overwrites a non-active status', () => {
    expect(applyExpiryTransition('revoked', 1_000, NOW)).toBe('revoked')
    expect(applyExpiryTransition('compromised', 1_000, NOW)).toBe('compromised')
    expect(applyExpiryTransition('superseded', 1_000, NOW)).toBe('superseded')
  })
})
